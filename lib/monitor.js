import {marketPolicy,nonTargetMarketEvidence} from './market-scope.js';
import {pureCryptoWallet} from './crypto-scope.js';
import {sourceScopeFilter} from './source-scope.js';
import {nigeriaEvidence} from './geography.js';
import {validateAppleConfig,createAppleJob,runAppleSearch} from './app-store.js';
import {inboxEntry,storeInbox,groupedCandidates} from './neural-inbox.js';
import {referenceMatch} from './references.js';
import{runProvider,cancellationError,busyJob}from'./run-context.js';
import{manuallyExcluded,exclusionMatch,visibleJob,effectiveExclusions}from'./manual-exclusions.js';
import{validateWebConfig,webFilters,createWebJob,runWebSearch,webPlan}from'./web-services.js';
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
  requestTimeoutMs=30000,
}) {
  const section = (state) => (kind==='apple'?state.apple:kind==='web'?state.web:kind === "watch" ? state.watch : kind === "social" ? state.social : state);
  const current = () => section(store.state);
  const currentFilters=()=>({...current().schedule.filters,...marketPolicy(store.state)});
  const identify = (entry) => (kind === "play" ? entry.appId : entry.id);
  const validate = kind==='apple'?validateAppleConfig:kind==='web'?validateWebConfig:kind === "watch" ? validateWatchConfig : kind === "social" ? validateSocialConfig : validateConfig;
  const makeJob = kind==='apple'?createAppleJob:kind==='web'?createWebJob:kind === "watch" ? createWatchJob : kind === "social" ? createSocialJob : createJob;
  const run = kind==='apple'?runAppleSearch:kind==='web'?runWebSearch:kind === "watch" ? runWatch : kind === "social" ? runSocialSearch : runSearch;
  const safeError = kind==='web'?socialError:kind === "watch" ? watchError : kind === "social" ? socialError : publicError;
  const configured = () => !['social','web'].includes(kind) || provider.configured();
  const jobs = new Map(
    current().jobs.map((job) => [job.id, structuredClone(job)]),
  );
  let busy = false;
  let stopped = false;
  let timer;
  let execution = Promise.resolve();
  let preparing=Promise.resolve();
  let lastError = null;
  const controllers=new Map();
  const active = () =>
    [...jobs.values()].find(busyJob) ?? null;
  const pendingCandidates = (rules=effectiveExclusions(store.state),allowed=sourceScopeFilter(store.state)) => [...new Map([
    ...(current().reviewCandidates ?? []),
    ...current().findings.filter(entry => reviewCandidate(entry, currentFilters())),
  ].map(entry => [identify(entry), entry])).values()].filter(entry => allowed(entry)&&!manuallyExcluded(entry,rules)&&reviewCandidate(entry,currentFilters()));
  // Compile cross-source exclusions once for this snapshot, never once per row.
  // A shared, request-scoped ruleset also keeps all source counts consistent.
  const summary = ({rules=effectiveExclusions(store.state)}={}) => {
    const allowed=sourceScopeFilter(store.state);
    const rotation=kind==='web'?webPlan(currentFilters(),store.state.findings.filter(e=>!manuallyExcluded(e,rules)),clock()):kind==='social'?socialPlan(currentFilters(),clock()):null;
    return {
    busy,
    stopping:active()?.status==='cancelling',
    schedule: structuredClone(current().schedule),
    ...(kind==='play'?{pendingChecks:store.state.pendingChecks?.length??0}:{}),
    totalFindings: current().findings.filter(entry => allowed(entry)&&!manuallyExcluded(entry,rules)&&eligibleFinding(entry, currentFilters())).length,
    totalCandidates: pendingCandidates(rules,allowed).length,
    legacyFindings: current().findings.filter(entry => allowed(entry)&&!eligibleFinding(entry, currentFilters())).length,
    activeJobId: active()?.id ?? null,
    latestJobId: [...jobs.keys()].at(-1) ?? null,
    lastError,
    ...(kind === "play" ? { evidenceConnection: { configured: Boolean(provider.research?.configured()), verifiedAt:store.state.connections?.brave?.verifiedAt ?? null } } : {}),
    ...(["social","web"].includes(kind)
      ? {
          connection: {
            provider: "Brave Search API",
            configured: configured(),
            verifiedAt: current().lastSourceSuccessAt,
            requiredVariable: "BRAVE_SEARCH_API_KEY",
          },
          requestsPerRun:kind==='web'?rotation.queries.length:rotation.requests.length,
          rotation,
        }
      : {}),
    };
  };

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
    const captureNeural=true;
    const rawBatch=[];
    const beforeNeural=source==='neural'?null:new Set(groupedCandidates(store.state).map(e=>e.id));
    const flushRaw=async()=>{if(!rawBatch.length)return;const rows=rawBatch.splice(0);const overflow=await store.update(d=>{const overflow=storeInbox(d,rows);if(source!=='neural'){const today=calendarWindow(clock()).to;if(d.ai.newDay!==today){d.ai.newIds=[];d.ai.newDay=today;}const ids=groupedCandidates(d).filter(e=>!beforeNeural.has(e.id)&&!e.reference).map(e=>e.id);d.ai.newIds=[...new Set([...d.ai.newIds,...ids])];d.ai.newSinceAt=clock().toISOString();}d.ai.inboxOverflow=(d.ai.inboxOverflow??0)+overflow;return overflow;});if(overflow&&!job.errors.some(e=>e.code==='NEURAL_INBOX_LIMIT'))job.errors.push({code:'NEURAL_INBOX_LIMIT',message:'Входящий список ИИ достиг предела 20000 ссылок. Новые сырые ссылки не сохранены; основной поиск и история продолжают работать.'});};
    const now = clock();
    if(kind==='play'&&input.continuePending&&!store.state.pendingChecks?.length)throw Object.assign(new Error('Нет карточек для продолжения.'),{status:409});
    if (!configured())
      throw Object.assign(
        new Error(socialError({ code: "MISSING_KEY" }).message),
        { status: 503, code: "MISSING_KEY" },
      );
    const config = validate({...input,...marketPolicy(store.state)}, now);
    const sourceFilters=structuredClone(config);
    const rules=effectiveExclusions(store.state).filter(r=>!r.knownProjectId);config.excludeAppIds=[...new Set([...config.excludeAppIds,...rules.flatMap(r=>r.appIds??[])])];config.excludeDomains=[...new Set([...config.excludeDomains,...rules.flatMap(r=>r.domains??[])])];
    busy = true;
    const job = {
      ...makeJob(randomUUID(), config, now),
      neuralCapture:captureNeural,neuralCaptured:0,
      source,
      createdAt: now.toISOString(),
    };
    try {
      preparing=store.update((draft) => {
        draft = section(draft);
        draft.jobs.push(structuredClone(job));
        draft.jobs = draft.jobs.slice(-20);
        if (source === "scheduled") {
          draft.schedule.lastRunAt = now.toISOString();
          draft.schedule.lastStatus = "running";
          draft.schedule.nextRunAt = nextDailyRun(now, draft.schedule.time);
        }
      });
      await preparing;
    } catch (error) {
      busy = false;
      lastError = safeError(error).message;
      throw error;
    }
    jobs.set(job.id, job);
    while (jobs.size > 20) jobs.delete(jobs.keys().next().value);
    const controller=new AbortController();controllers.set(job.id,controller);if(stopped)controller.abort(cancellationError());
    const scopedProvider=runProvider(provider,controller.signal,{timeoutMs:requestTimeoutMs,onRequest:info=>{job.request=info;}});
    execution = (async () => {
      try {
        const runRules=effectiveExclusions(store.state);
        await run(job, scopedProvider, {
          signal:controller.signal,
          onRawCandidate:async entry=>{if(!captureNeural||pureCryptoWallet(entry)||manuallyExcluded(entry,effectiveExclusions(store.state)))return;const row=inboxEntry({...entry,...(source.startsWith('channel:')?{sourceKey:source.slice(8)}:{})},kind,clock());if(row){job.neuralCaptured++;rawBatch.push(row);}if(rawBatch.length>=5)await flushRaw();},
          delay,
          clock,
          pendingCandidates:kind==='play'?(store.state.pendingChecks??[]):[],
          onBacklog:(items,config)=>store.update(draft=>{const backlogRules=effectiveExclusions(draft);draft.pendingChecks=items.filter(e=>!manuallyExcluded(e,backlogRules));draft.pendingCheckConfig=draft.pendingChecks.length?{...structuredClone(config),excludeAppIds:sourceFilters.excludeAppIds,excludeDomains:sourceFilters.excludeDomains}:null;}),
          knownFindings:kind==='play'?current().findings.filter(entry=>!manuallyExcluded(entry,runRules)&&eligibleFinding(entry,config)):[],
          readSnapshot:key=>store.state.watch?.snapshots[key],
          saveSnapshot:(key,snapshot)=>store.update(draft=>{draft.watch.snapshots[key]=snapshot;const keys=Object.keys(draft.watch.snapshots);}),
          knownApps:[...store.state.findings,...(store.state.reviewCandidates??[]),...(store.state.web?.findings??[])].filter(entry=>!manuallyExcluded(entry,runRules)&&!pureCryptoWallet(entry)&&!excluded({text:`${entry.title??''} ${entry.screeningText??''}`,appId:entry.appId,url:entry.developerWebsite},store.state.schedule.filters)),
          isExcluded:entry=>{const match=exclusionMatch(entry,effectiveExclusions(store.state));return Boolean(match&&!match.rule.knownProjectId);},
          isSeen: (id) =>
            manuallyExcluded({appId:id},effectiveExclusions(store.state))||current().findings.some((entry) => identify(entry) === id &&
              (kind==='watch' || config.profile==='business' && kind==='social' ? true : config.profile==='business' ? entry.discovery?.version===DISCOVERY_VERSION && eligibleFinding(entry,config) && !(provider.research?.configured() && entry.discovery.euIban==='unknown' && !entry.siteIndexCheckedAt) && !(entry.checkedAt && +now-Date.parse(entry.checkedAt)>7*86400000) : !config.strictBanking || (entry.qualification?.version === CRITERIA_VERSION && entry.qualification.status === "text_matches" && entry.qualification.institutionType === config.institutionType))),
          onCandidate: (app) => store.update(draft => {
            if(job.status!=='running')throw cancellationError();
            if(manuallyExcluded(app,effectiveExclusions(draft))||pureCryptoWallet(app)||nonTargetMarketEvidence(app,marketPolicy(store.state)))return null;
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
              if(job.status!=='running')throw cancellationError();
            if(manuallyExcluded(app,effectiveExclusions(draft))||pureCryptoWallet(app)||nonTargetMarketEvidence(app,marketPolicy(store.state)))return null;
              draft = section(draft);
              const previous = draft.findings.find(entry => identify(entry) === identify(app));
              if (previous) {
                // Recheck older matches without calling them newly found or losing their identity.
                Object.assign(previous, app);
                if(['play','web'].includes(kind)&&!job.existingResults.some(e=>identify(e)===identify(previous)))job.existingResults.push({...previous,fromHistory:true});
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
              if(kind==='play'&&config.referenceDiscovery&&referenceMatch(app)){entry.reference=referenceMatch(app).name;entry.isReference=true;job.existingResults.push({...entry,fromHistory:true});return null;}
              const savedJob = draft.jobs.find((run) => run.id === job.id);
              Object.assign(savedJob, structuredClone(job), {
                results: [...structuredClone(job.results), entry],
              });
              return entry;
            }),
        });
        await flushRaw();
        if(job.status==='complete'&&job.errors.length)job.status='partial';
        if(job.status==='cancelling'){job.status='cancelled';job.finishedAt=clock().toISOString();job.current='';}
        await store.update((draft) => {
          draft = section(draft);
          const index = draft.jobs.findIndex((run) => run.id === job.id);
          draft.jobs[index] = structuredClone(job);
          if (source === "scheduled") draft.schedule.lastStatus = job.status;
          if (kind === 'play' && job.braveSuccessfulRequests > 0) {
            storeConnection(draft,clock());
          }
          if (["social","web"].includes(kind) && job.successfulSearches > 0)
            draft.lastSourceSuccessAt = clock().toISOString();
        });
        lastError = null;
      } catch (error) {
        job.status = "failed";
        job.finishedAt = clock().toISOString();
        job.errors.push(safeError(error));
        lastError = safeError(error).message;
      } finally {
        try{await flushRaw();}catch(error){job.status='failed';job.errors.push(safeError(error));lastError=safeError(error).message;}
        finally{controllers.delete(job.id);job.request=null;busy = false;}
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
    if(kind==='apple')filters=validateAppleConfig(input.filters);
    else if(kind==='web')filters=webFilters(input.filters);
    else if(kind === "watch")filters=watchFilters(input.filters);
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
    isBusy:()=>busy,
    summary,
    startJob,
    saveSchedule,
    tick,
    candidates: () => structuredClone(pendingCandidates()),
    findings: ({ all = false } = {}) => {const rules=effectiveExclusions(store.state),allowed=sourceScopeFilter(store.state);return structuredClone(current().findings.filter(entry=>allowed(entry)&&!nigeriaEvidence(entry)&&!manuallyExcluded(entry,rules)&&(all||eligibleFinding(entry,currentFilters()))));},
    visibleJob:job=>{const visible=visibleJob(job,effectiveExclusions(store.state)),allowed=sourceScopeFilter(store.state);return visible?{...visible,...Object.fromEntries(['results','existingResults','reviewCandidates'].filter(k=>Array.isArray(visible[k])).map(k=>[k,visible[k].filter(allowed)]))}:visible;},
    async cancel(id, reason = "user") {
      const job = jobs.get(id);
      if(job?.status==='running'){
        job.status='cancelling';job.cancelRequestedAt=clock().toISOString();
        controllers.get(id)?.abort(cancellationError());
        await store.update(draft=>{
          draft=section(draft);const saved=draft.jobs.find(run=>run.id===id);
          if(saved?.status==='running'){saved.status='cancelling';saved.cancelRequestedAt=job.cancelRequestedAt;}
          if(job.source==='scheduled'){
            draft.schedule.lastStatus='cancelling';
            if(reason==='shutdown'&&draft.schedule.enabled)draft.schedule.nextRunAt=clock().toISOString();
          }
        });
      }
      // Includes backlog/final-state persistence. A cancel response guarantees the slot is free.
      if(busyJob(job)||controllers.has(id))await execution;
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
      await preparing.catch(()=>{});
      for (const job of jobs.values())
        if (busyJob(job)) await this.cancel(job.id, "shutdown");
      await execution;
    },
    idle: () => execution,
  };
}

function storeConnection(state,now) {
  state.connections ??= {};state.connections.brave={verifiedAt:now.toISOString()};
}
