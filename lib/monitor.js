import {validateWatchConfig,watchFilters,createWatchJob,runWatch,watchError} from './watch.js';
import {socialPlan} from './source-catalog.js';
import { DISCOVERY_VERSION, validateDiscovery } from './discovery.js';
import { eligibleFinding, excluded, CRITERIA_VERSION, validateCriteria, reviewCandidate } from "./qualification.js";
import { randomUUID } from "node:crypto";
import {
  calendarWindow,
  validateConfig,
  createJob,
  runSearch,
  publicError,
  playFilters,
} from "./search.js";
import { memoryStore, nextDailyRun, dailySlot } from "./store.js";
import {
  validateSocialConfig,
  socialFilters,
  createSocialJob,
  runSocialSearch,
  socialError,
} from "./social-search.js";

export function createMonitor({
  provider,
  store = memoryStore(),
  delay = 500,
  clock = () => new Date(),
  autoSchedule = false,
  tickInterval = 30000,
  kind = "play",
}) {
  const section = (state) => (kind === "watch" ? state.watch : kind === "social" ? state.social : state);
  const current = () => section(store.state);
  const identify = (entry) => (kind === "play" ? entry.appId : entry.id);
  const validate = kind === "watch" ? validateWatchConfig : kind === "social" ? validateSocialConfig : validateConfig;
  const makeJob = kind === "watch" ? createWatchJob : kind === "social" ? createSocialJob : createJob;
  const run = kind === "watch" ? runWatch : kind === "social" ? runSocialSearch : runSearch;
  const safeError = kind === "watch" ? watchError : kind === "social" ? socialError : publicError;
  const configured = () => kind !== "social" || provider.configured();
  const jobs = new Map(
    current().jobs.map((job) => [job.id, structuredClone(job)]),
  );
  let busy = false;
  let stopped = false;
  let timer;
  let execution = Promise.resolve();
  let lastError = null;
  const active = () =>
    [...jobs.values()].find((job) => job.status === "running") ?? null;
  const pendingCandidates = () => [...new Map([
    ...(current().reviewCandidates ?? []),
    ...current().findings.filter(entry => reviewCandidate(entry, current().schedule.filters)),
  ].map(entry => [identify(entry), entry])).values()].filter(entry => reviewCandidate(entry,current().schedule.filters));
  const summary = () => ({
    schedule: structuredClone(current().schedule),
    ...(kind==='play'?{pendingChecks:store.state.pendingChecks?.length??0}:{}),
    totalFindings: current().findings.filter(entry => eligibleFinding(entry, current().schedule.filters)).length,
    totalCandidates: pendingCandidates().length,
    legacyFindings: current().findings.filter(entry => !eligibleFinding(entry, current().schedule.filters)).length,
    activeJobId: active()?.id ?? null,
    latestJobId: [...jobs.keys()].at(-1) ?? null,
    lastError,
    ...(kind === "play" ? { evidenceConnection: { configured: Boolean(provider.research?.configured()), verifiedAt:store.state.connections?.brave?.verifiedAt ?? null } } : {}),
    ...(kind === "social"
      ? {
          connection: {
            provider: "Brave Search API",
            configured: configured(),
            verifiedAt: current().lastSourceSuccessAt,
            requiredVariable: "BRAVE_SEARCH_API_KEY",
          },
          requestsPerRun:
            socialPlan(current().schedule.filters,clock()).requests.length,
          rotation:socialPlan(current().schedule.filters,clock()),
        }
      : {}),
  });

  async function startJob(input, source = "manual") {
    if (stopped)
      throw Object.assign(new Error("Программа останавливается."), {
        status: 503,
      });
    if (busy)
      throw Object.assign(
        new Error("Поиск уже идёт. Дождитесь завершения или остановите его."),
        { status: 409 },
      );
    const now = clock();
    if(kind==='play'&&input.continuePending&&!store.state.pendingChecks?.length)throw Object.assign(new Error('Нет карточек для продолжения.'),{status:409});
    if (!configured())
      throw Object.assign(
        new Error(socialError({ code: "MISSING_KEY" }).message),
        { status: 503, code: "MISSING_KEY" },
      );
    const config = validate(input, now);
    busy = true;
    const job = {
      ...makeJob(randomUUID(), config, now),
      source,
      createdAt: now.toISOString(),
    };
    try {
      await store.update((draft) => {
        draft = section(draft);
        draft.jobs.push(structuredClone(job));
        draft.jobs = draft.jobs.slice(-20);
        if (source === "scheduled") {
          draft.schedule.lastRunAt = now.toISOString();
          draft.schedule.lastStatus = "running";
          draft.schedule.nextRunAt = nextDailyRun(now, draft.schedule.time);
        }
      });
    } catch (error) {
      busy = false;
      lastError = safeError(error).message;
      throw error;
    }
    jobs.set(job.id, job);
    while (jobs.size > 20) jobs.delete(jobs.keys().next().value);
    execution = (async () => {
      try {
        await run(job, provider, {
          delay,
          clock,
          pendingCandidates:kind==='play'?(store.state.pendingChecks??[]):[],
          onBacklog:(items,config)=>store.update(draft=>{draft.pendingChecks=items;draft.pendingCheckConfig=items.length?structuredClone(config):null;}),
          knownFindings:kind==='play'?current().findings.filter(entry=>eligibleFinding(entry,config)):[],
          readSnapshot:key=>store.state.watch?.snapshots[key],
          saveSnapshot:(key,snapshot)=>store.update(draft=>{draft.watch.snapshots[key]=snapshot;const keys=Object.keys(draft.watch.snapshots);if(keys.length>300)for(const stale of keys.sort((a,b)=>(draft.watch.snapshots[a].checkedAt??'').localeCompare(draft.watch.snapshots[b].checkedAt??'')).slice(0,keys.length-300))delete draft.watch.snapshots[stale];}),
          knownApps:[...store.state.findings,...(store.state.reviewCandidates??[])].filter(entry=>!excluded({text:`${entry.title??''} ${entry.screeningText??''}`,appId:entry.appId,url:entry.developerWebsite},store.state.schedule.filters)),
          isSeen: (id) =>
            current().findings.some((entry) => identify(entry) === id &&
              (kind==='watch' || config.profile==='business' && kind==='social' ? true : config.profile==='business' ? entry.discovery?.version===DISCOVERY_VERSION && eligibleFinding(entry,config) && !(provider.research?.configured() && entry.discovery.euIban==='unknown' && !entry.siteIndexCheckedAt) && !(entry.checkedAt && +now-Date.parse(entry.checkedAt)>7*86400000) : !config.strictBanking || (entry.qualification?.version === CRITERIA_VERSION && entry.qualification.status === "text_matches" && entry.qualification.institutionType === config.institutionType))),
          onCandidate: (app) => store.update(draft => {
            draft = section(draft);
            draft.reviewCandidates ??= [];
            const known = draft.findings.find(entry => identify(entry) === identify(app));
            if (known) { Object.assign(known, app); return null; }
            const previous = draft.reviewCandidates.find(entry => identify(entry) === identify(app));
            if (previous) { Object.assign(previous, app); return null; }
            const entry = {...app, firstFoundAt:clock().toISOString(), firstJobId:job.id};
            draft.reviewCandidates.push(entry);
            const savedJob = draft.jobs.find(run => run.id === job.id);
            Object.assign(savedJob, structuredClone(job), {reviewCandidates:[...structuredClone(job.reviewCandidates ?? []),entry]});
            return entry;
          }),
          onMatch: (app) =>
            store.update((draft) => {
              draft = section(draft);
              const previous = draft.findings.find(entry => identify(entry) === identify(app));
              if (previous) {
                // Recheck older matches without calling them newly found or losing their identity.
                Object.assign(previous, app);
                if(kind==='play'&&!job.existingResults.some(e=>e.appId===previous.appId))job.existingResults.push({...previous,fromHistory:true});
                return null;
              }
              const pending = draft.reviewCandidates?.find(entry => identify(entry) === identify(app));
              if (pending) draft.reviewCandidates = draft.reviewCandidates.filter(entry => identify(entry) !== identify(app));
              const entry = {
                ...app,
                firstFoundAt: pending?.firstFoundAt ?? clock().toISOString(),
                firstJobId: pending?.firstJobId ?? job.id,
              };
              draft.findings.push(entry);
              const savedJob = draft.jobs.find((run) => run.id === job.id);
              Object.assign(savedJob, structuredClone(job), {
                results: [...structuredClone(job.results), entry],
              });
              return entry;
            }),
        });
        await store.update((draft) => {
          draft = section(draft);
          const index = draft.jobs.findIndex((run) => run.id === job.id);
          draft.jobs[index] = structuredClone(job);
          if (source === "scheduled") draft.schedule.lastStatus = job.status;
          if (kind === 'play' && job.braveSuccessfulRequests > 0) {
            storeConnection(draft,clock());
          }
          if (kind === "social" && job.successfulSearches > 0)
            draft.lastSourceSuccessAt = clock().toISOString();
        });
        lastError = null;
      } catch (error) {
        job.status = "failed";
        job.finishedAt = clock().toISOString();
        job.errors.push(safeError(error));
        lastError = safeError(error).message;
      } finally {
        busy = false;
      }
    })();
    return job;
  }

  async function saveSchedule(input) {
    if (
      !input ||
      typeof input.enabled !== "boolean" ||
      typeof input.time !== "string" ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)
    ) {
      throw Object.assign(
        new Error("Укажите время в формате ЧЧ:ММ и состояние расписания."),
        { status: 400 },
      );
    }
    const now = clock();
    let filters;
    if(kind === "watch")filters=watchFilters(input.filters);
    else if (kind === "social")
      filters = socialFilters(validateSocialConfig(input.filters, now));
    else {
      const releaseMonths=validateDiscovery(input.filters).releaseMonths;
      filters=playFilters(validateConfig({...input.filters,...calendarWindow(now,releaseMonths)},now));
    }
    await store.update((draft) => {
      draft = section(draft);
      const previous = draft.schedule;
      // Saving unchanged settings does not trigger another daily run on the same day.
      const sameDay =
        previous.lastRunAt &&
        calendarWindow(new Date(previous.lastRunAt)).to ===
          calendarWindow(now).to;
      draft.schedule = {
        ...previous,
        enabled: input.enabled,
        savedAt: now.toISOString(),
        time: input.time,
        filters,
        nextRunAt: input.enabled
          ? sameDay
            ? nextDailyRun(now, input.time)
            : dailySlot(now, input.time).toISOString()
          : null,
      };
    });
    return summary();
  }

  async function tick() {
    const schedule = current().schedule;
    if (
      stopped ||
      !autoSchedule ||
      busy ||
      !configured() ||
      !schedule.enabled ||
      !schedule.nextRunAt ||
      new Date(schedule.nextRunAt) > clock()
    )
      return;
    try {
      await startJob(
        { ...schedule.filters, ...calendarWindow(clock(),schedule.filters.releaseMonths ?? 1) },
        "scheduled",
      );
    } catch (error) {
      lastError = safeError(error).message;
    }
  }

  return {
    jobs,
    active,
    summary,
    startJob,
    saveSchedule,
    tick,
    candidates: () => structuredClone(pendingCandidates()),
    findings: ({ all = false } = {}) => structuredClone(all ? current().findings : current().findings.filter(entry => eligibleFinding(entry, current().schedule.filters))),
    async cancel(id, reason = "user") {
      const job = jobs.get(id);
      if (job?.status === "running") {
        job.status = "cancelled";
        job.finishedAt = clock().toISOString();
        await store.update((draft) => {
          draft = section(draft);
          const saved = draft.jobs.find((run) => run.id === id);
          saved.status = "cancelled";
          saved.finishedAt = job.finishedAt;
          if (job.source === "scheduled") {
            draft.schedule.lastStatus = "cancelled";
            if (reason === "shutdown" && draft.schedule.enabled)
              draft.schedule.nextRunAt = clock().toISOString();
          }
        });
      }
      return job;
    },
    start() {
      if (!autoSchedule || timer) return;
      timer = setInterval(() => {
        void tick();
      }, tickInterval);
      timer.unref();
      void tick();
    },
    async stop() {
      stopped = true;
      clearInterval(timer);
      for (const job of jobs.values())
        if (job.status === "running") await this.cancel(job.id, "shutdown");
      await execution;
    },
    idle: () => execution,
  };
}

function storeConnection(state,now) {
  state.connections ??= {};state.connections.brave={verifiedAt:now.toISOString()};
}
