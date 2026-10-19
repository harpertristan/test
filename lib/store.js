import { discoveryPreset, DISCOVERY_EXCLUSIONS } from './discovery.js';
import { validateCriteria, DEFAULT_EXCLUDE_TERMS } from "./qualification.js";
import { mkdir, readFile, open, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { calendarWindow, validateConfig, playFilters } from "./search.js";
import { validateSocialConfig, socialFilters, SOCIAL_QUERIES, BUSINESS_SOCIAL_QUERIES } from "./social-search.js";

export const TIME_ZONE = "Europe/Kaliningrad";

export function dailySlot(now, time) {
  return new Date(`${calendarWindow(now).to}T${time}:00+02:00`);
}

export function nextDailyRun(now, time) {
  const slot = dailySlot(now, time);
  if (slot <= now) slot.setUTCDate(slot.getUTCDate() + 1);
  return slot.toISOString();
}

export function initialState(now = new Date()) {
  const filters = playFilters(validateConfig(discoveryPreset(validateConfig({},now).countries),now));
  return {
    version: 1,
    schedule: {
      enabled: true,
      time: "09:00",
      timeZone: TIME_ZONE,
      filters,
      nextRunAt: dailySlot(now, "09:00").toISOString(),
      lastRunAt: null,
      lastStatus: null,
    },
    findings: [],
    reviewCandidates: [],
    jobs: [],
    social: initialSocialState(now),
  };
}

export function initialSocialState(now = new Date()) {
  return {
    schedule: {
      enabled: true,
      time: "09:15",
      timeZone: TIME_ZONE,
      filters: socialFilters(validateSocialConfig({profile:'business',strictBanking:false,institutionType:'bank_or_emi',excludeTerms:DISCOVERY_EXCLUSIONS}, now)),
      nextRunAt: dailySlot(now, "09:15").toISOString(),
      lastRunAt: null,
      lastStatus: null,
    },
    findings: [],
    jobs: [],
    lastSourceSuccessAt: null,
  };
}

export function memoryStore(now = new Date()) {
  return new StateStore(null, initialState(now));
}

class StateStore {
  constructor(file, state) {
    this.file = file;
    this.state = state;
    this.pending = Promise.resolve();
  }

  async update(change) {
    const operation = this.pending.then(async () => {
      const draft = structuredClone(this.state);
      const result = change(draft);
      if (this.file) {
        const temp = `${this.file}.${randomUUID()}.tmp`;
        let handle;
        try {
          await mkdir(dirname(this.file), { recursive: true });
          handle = await open(temp, "wx", 0o600);
          await handle.writeFile(JSON.stringify(draft, null, 2) + "\n");
          await handle.sync();
          await handle.close();
          handle = null;
          await rename(temp, this.file);
        } catch (cause) {
          await handle?.close().catch(() => {});
          await unlink(temp).catch(() => {});
          throw Object.assign(
            new Error(
              "Не удалось сохранить историю. Проверьте свободное место и права на папку data.",
              { cause },
            ),
            { code: "PERSISTENCE_ERROR" },
          );
        }
      }
      this.state = draft;
      return result;
    });
    this.pending = operation.catch(() => {});
    return operation;
  }
}

export async function openStore(file, now = new Date()) {
  let state;
  try {
    state = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT")
      throw new Error(
        "Не удалось прочитать data/state.json. История не сброшена: проверьте файл или восстановите резервную копию.",
        { cause: error },
      );
    state = initialState(now);
  }
  const invalid = () => {
    throw new Error(
      "Некорректный формат истории. Файл data/state.json оставлен без изменений.",
    );
  };
  if (
    state?.version !== 1 ||
    !Array.isArray(state.findings) ||
    !Array.isArray(state.jobs) ||
    !state.schedule
  )
    invalid();
  if (
    new Set(state.findings.map((app) => app.appId)).size !==
      state.findings.length ||
    state.findings.some((app) => typeof app.appId !== "string" || !app.appId)
  )
    invalid();
  if (
    typeof state.schedule.enabled !== "boolean" ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(state.schedule.time) ||
    state.schedule.timeZone !== TIME_ZONE
  )
    invalid();
  if (
    state.schedule.nextRunAt !== null &&
    !Number.isFinite(Date.parse(state.schedule.nextRunAt))
  )
    invalid();
  try {
    validateConfig(state.schedule.filters, now);
  } catch {
    invalid();
  }
  if (state.social !== undefined) {
    const social = state.social;
    if (
      !social ||
      !social.schedule ||
      !Array.isArray(social.jobs) ||
      !Array.isArray(social.findings)
    )
      invalid();
    if (
      social.findings.some((post) => typeof post.id !== "string" || !post.id) ||
      new Set(social.findings.map((post) => post.id)).size !==
        social.findings.length
    )
      invalid();
    if (
      typeof social.schedule.enabled !== "boolean" ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(social.schedule.time) ||
      social.schedule.timeZone !== TIME_ZONE
    )
      invalid();
    if (
      social.schedule.nextRunAt !== null &&
      !Number.isFinite(Date.parse(social.schedule.nextRunAt))
    )
      invalid();
    try {
      validateSocialConfig(social.schedule.filters, now);
    } catch {
      invalid();
    }
  }
  if (state.reviewCandidates !== undefined && (!Array.isArray(state.reviewCandidates) ||
      state.reviewCandidates.some(app => typeof app.appId !== 'string' || !app.appId) ||
      new Set(state.reviewCandidates.map(app => app.appId)).size !== state.reviewCandidates.length)) invalid();
  const store = new StateStore(file, state);
  // Matches are saved in the same transaction as their run, even if a process died mid-run.
  await store.update((draft) => {
    draft.social ??= initialSocialState(now);
    draft.reviewCandidates ??= [];
    if (!draft.schedule.filters.profile) {
      const old=draft.schedule.filters;
      draft.previousSearchFilters ??= structuredClone(old);
      const oldDefaults=old.excludeTerms && [...old.excludeTerms].sort().join('|') === [...DEFAULT_EXCLUDE_TERMS].sort().join('|');
      draft.schedule.filters={...old,...discoveryPreset(old.countries ?? validateConfig(old,now).countries),excludeTerms:oldDefaults?DISCOVERY_EXCLUSIONS:(old.excludeTerms ?? DISCOVERY_EXCLUSIONS),excludeAppIds:old.excludeAppIds??[],excludeDomains:old.excludeDomains??[]};
      draft.discoveryMigrationAt=now.toISOString();
    }
    if (!draft.social.schedule.filters.profile) {
      const old=draft.social.schedule.filters;
      const defaults=old.excludeTerms && [...old.excludeTerms].sort().join('|')===[...DEFAULT_EXCLUDE_TERMS].sort().join('|');
      Object.assign(old,{profile:'business',strictBanking:false,institutionType:'bank_or_emi',excludeTerms:defaults?DISCOVERY_EXCLUSIONS:(old.excludeTerms??DISCOVERY_EXCLUSIONS)});
      if(JSON.stringify(old.queries)===JSON.stringify(SOCIAL_QUERIES))old.queries=[...BUSINESS_SOCIAL_QUERIES];
    }
    draft.schedule.filters.ignoreReleaseDate ??= false;
    // Add conservative defaults to old schedules without removing historical findings.
    Object.assign(draft.schedule.filters, validateCriteria(draft.schedule.filters));
    Object.assign(draft.social.schedule.filters, validateCriteria(draft.social.schedule.filters));
    for (const section of [draft, draft.social])
      for (const job of section.jobs) {
        if (job.status !== "running") continue;
        job.status = "cancelled";
        job.finishedAt = now.toISOString();
        job.current = "";
        job.errors.push({
          code: "INTERRUPTED",
          message:
            "Предыдущий поиск прерван выключением программы. Уже сохранённые находки доступны в истории.",
        });
        if (job.source === "scheduled") {
          section.schedule.lastStatus = "cancelled";
          if (section.schedule.enabled)
            section.schedule.nextRunAt = now.toISOString();
        }
      }
  });
  return store;
}
