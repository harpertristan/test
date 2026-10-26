import {initialAppleState,validateAppleConfig} from './app-store.js';
import {initialAIState,reviewConfig} from './ai-config.js';
import {validateWebConfig,webFilters} from './web-services.js';
import {LAUNCH_QUERIES,activeSocialSources} from './source-catalog.js';
import {assessLaunch} from './launches.js';
import {initialWatchState,validateWatchConfig} from './watch.js';
import {SOURCE_CATALOG_VERSION,RECOMMENDED_SOURCES} from './source-catalog.js';
import { discoveryPreset, DISCOVERY_EXCLUSIONS,assessDiscovery,DISCOVERY_VERSION,LEGACY_DISCOVERY_KEYWORDS,DISCOVERY_KEYWORDS,REFERENCE_APPS } from './discovery.js';
import { validateCriteria, DEFAULT_EXCLUDE_TERMS,assessBanking } from "./qualification.js";
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
    pendingChecks:[],
    pendingCheckConfig:null,
    catalogueVersion:2,
    jobs: [],
    braveUsage:{},
    manualExclusions:[],
    ai:initialAIState(),
    crm:{records:{},settings:{}},
    apple:initialAppleState(now),
    web:initialWebState(now),
    social: initialSocialState(now),
    watch: initialWatchState(now),
  };
}

export function initialSocialState(now = new Date()) {
  return {
    schedule: {
      enabled: true,
      time: "09:15",
      timeZone: TIME_ZONE,
      filters: socialFilters(validateSocialConfig({eventMode:'launches',queries:LAUNCH_QUERIES,profile:'business',strictBanking:false,institutionType:'bank_or_emi',excludeTerms:DISCOVERY_EXCLUSIONS}, now)),
      nextRunAt: dailySlot(now, "09:15").toISOString(),
      lastRunAt: null,
      lastStatus: null,
    },
    findings: [],
    jobs: [],
    lastSourceSuccessAt: null,
    sourceCatalogVersion: SOURCE_CATALOG_VERSION,
  };
}

export function initialWebState(now=new Date()) {
  return {schedule:{enabled:true,time:'09:20',timeZone:TIME_ZONE,filters:webFilters(),nextRunAt:dailySlot(now,'09:20').toISOString(),lastRunAt:null,lastStatus:null},findings:[],jobs:[],lastSourceSuccessAt:null};
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
  if(state.watch!==undefined){
    const w=state.watch;
    if(!w||!w.schedule||!Array.isArray(w.findings)||!Array.isArray(w.jobs)||!w.snapshots||typeof w.snapshots!=='object'||Array.isArray(w.snapshots)||typeof w.schedule.enabled!=='boolean'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(w.schedule.time)||w.schedule.timeZone!==TIME_ZONE||w.schedule.nextRunAt!==null&&!Number.isFinite(Date.parse(w.schedule.nextRunAt))||w.findings.some(e=>typeof e.id!=='string')||new Set(w.findings.map(e=>e.id)).size!==w.findings.length)invalid();
    try{validateWatchConfig(w.schedule.filters);for(const value of Object.values(w.snapshots))if(!value||typeof value.hash!=='string'||typeof value.text!=='string')invalid();}catch{invalid();}
  }
  if(state.manualExclusions!==undefined&&(!Array.isArray(state.manualExclusions)||state.manualExclusions.some(e=>!e||typeof e.key!=='string'||!['app','domain','url'].includes(e.kind)||typeof e.value!=='string')))invalid();
  if(state.web!==undefined){const w=state.web;if(!w||!w.schedule||!Array.isArray(w.findings)||!Array.isArray(w.jobs)||typeof w.schedule.enabled!=='boolean'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(w.schedule.time)||w.schedule.timeZone!==TIME_ZONE||w.schedule.nextRunAt!==null&&!Number.isFinite(Date.parse(w.schedule.nextRunAt))||w.findings.some(e=>typeof e.id!=='string')||new Set(w.findings.map(e=>e.id)).size!==w.findings.length)invalid();try{validateWebConfig(w.schedule.filters);}catch{invalid();}}
  if(state.braveUsage!==undefined&&(!state.braveUsage||typeof state.braveUsage!=='object'||Array.isArray(state.braveUsage)||Object.values(state.braveUsage).some(n=>!Number.isInteger(n)||n<0)))invalid();
  if(state.ai?.shortlist!==undefined&&(!Array.isArray(state.ai.shortlist)||state.ai.shortlist.some(id=>typeof id!=='string'||!id.length||id.length>512)))invalid();
  if(state.pendingChecks!==undefined&&(!Array.isArray(state.pendingChecks)||state.pendingChecks.some(e=>!e||typeof e.appId!=='string')))invalid();
  if(state.ai!==undefined){const a=state.ai;if(!a||!Array.isArray(a.results)||!Array.isArray(a.jobs)||!a.usage||typeof a.usage!=='object'||Array.isArray(a.usage))invalid();if(a.inbox!==undefined&&(!Array.isArray(a.inbox)||a.inbox.some(e=>!e||typeof e.id!=='string'||typeof e.url!=='string')))invalid();if(a.newIds!==undefined&&!Array.isArray(a.newIds)||a.gatherJobs!==undefined&&!Array.isArray(a.gatherJobs))invalid();if(a.results.some(r=>!r||typeof r.id!=='string'||!r.facts)||new Set(a.results.map(r=>r.id)).size!==a.results.length||a.jobs.some(j=>!j||typeof j.id!=='string'))invalid();try{reviewConfig(a.config);for(const u of Object.values(a.usage))if(!Number.isInteger(u.attempts)||u.attempts<0)invalid();}catch{invalid();}}
  if(state.apple){if(!Array.isArray(state.apple.findings)||!Array.isArray(state.apple.jobs)||!state.apple.schedule)invalid();try{validateAppleConfig(state.apple.schedule.filters);}catch{invalid();}}
  if(state.crm&&(!state.crm.records||typeof state.crm.records!=='object'||Array.isArray(state.crm.records)||!state.crm.settings||typeof state.crm.settings!=='object'))invalid();
  const store = new StateStore(file, state);
  // Matches are saved in the same transaction as their run, even if a process died mid-run.
  await store.update((draft) => {
    draft.braveUsage??={};
    draft.social??=initialSocialState(now);
    draft.crm??={records:{},settings:{}};
    if(!draft.apple){draft.apple=initialAppleState(now);draft.apple.schedule.enabled=[draft,draft.social,draft.web,draft.watch].some(s=>s?.schedule.enabled);if(!draft.apple.schedule.enabled)draft.apple.schedule.nextRunAt=null;}
    if(!draft.researchV3){draft.schedule.filters.categories??=['FINANCE','BUSINESS','PRODUCTIVITY','TOOLS'];draft.schedule.filters.searchConcurrency??=3;draft.schedule.filters.googleRequestBudget=0;draft.researchV3=true;}

    draft.ai??=initialAIState();
    draft.ai.config=reviewConfig(draft.ai.config);
    if(!draft.crmV3){draft.ai.config.sources=[...new Set([...draft.ai.config.sources,'apple'])];draft.crmV3=true;}
    if((draft.social?.sourceCatalogVersion??0)<SOURCE_CATALOG_VERSION){draft.social.schedule.filters.sources=[...new Set([...draft.social.schedule.filters.sources,...RECOMMENDED_SOURCES])];draft.social.sourceCatalogVersion=SOURCE_CATALOG_VERSION;}
    draft.ai.inbox??=[];draft.ai.newIds??=[];draft.ai.shortlist??=[];draft.ai.gatherJobs??=[];
    for(const job of draft.ai.gatherJobs)if(['running','cancelling'].includes(job.status)){job.status='cancelled';job.finishedAt=now.toISOString();job.error='Сбор источников прерван перезапуском; сохранённые находки доступны.';}
    for(const job of draft.ai.jobs)if(['running','cancelling'].includes(job.status)){job.status='cancelled';job.finishedAt=now.toISOString();job.current='';job.errors??=[];job.errors.push({code:'INTERRUPTED',message:'Проверка ИИ прервана перезапуском. Выполненные обращения сохранены в лимите; незавершённые находки доступны повторно.'});}
    draft.social ??= initialSocialState(now);
    draft.watch ??= initialWatchState(now);
    draft.watch.schedule.filters.watchRegisters??=true;
    draft.manualExclusions??=[];
    // An upgrade must not start paid searches when every existing schedule was disabled.
    if(!draft.web){draft.web=initialWebState(now);draft.web.schedule.enabled=[draft,draft.social,draft.watch].some(s=>s.schedule.enabled);if(!draft.web.schedule.enabled)draft.web.schedule.nextRunAt=null;}
    for(const section of [draft.social,draft.web,draft.apple])if(section?.schedule?.filters)section.schedule.filters.requestBudget=0;
    Object.assign(draft.schedule.filters,{maxDetails:0,googleRequestBudget:0,evidenceBudget:0,recommendationBudget:0,developerBudget:0});
    draft.reviewCandidates ??= [];
    draft.pendingChecks??=[];
    draft.pendingCheckConfig??=null;
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
    if(!draft.social.sourceCatalogVersion){
      const filters=draft.social.schedule.filters;
      filters.sources=[...new Set([...filters.sources,...RECOMMENDED_SOURCES])];
      filters.requestBudget??=8;
      draft.social.sourceCatalogVersion=SOURCE_CATALOG_VERSION;
    }
    if(!draft.catalogueVersion){
      const filters=draft.schedule.filters;
      draft.previousDiscoverySettings??=structuredClone(filters);
      if(JSON.stringify(filters.keywords)===JSON.stringify(LEGACY_DISCOVERY_KEYWORDS))filters.keywords=[...DISCOVERY_KEYWORDS];
      if(filters.maxDetails===300)filters.maxDetails=1000;
      if(filters.limit===100)filters.limit=250;
      filters.related=true;filters.developerExpansion=true;
      filters.seedApps=[...new Set([...(filters.seedApps??[]),...REFERENCE_APPS])];
      draft.catalogueVersion=2;
    }
    const upgrade=(entry,filters)=>{
      if(entry.appId&&entry.screeningText&&entry.discovery&&entry.discovery.version!==DISCOVERY_VERSION){
        const docs=[{title:entry.title,text:entry.screeningText,url:entry.url,label:'Сохранённое описание Google Play'},...Object.values(entry.qualification?.evidence??{}).flat().map(e=>({text:e.text,url:e.url,label:e.label}))];
        entry.discovery=assessDiscovery(docs,filters,entry.qualification??assessBanking(docs,filters),entry.appId);
      }
      if(entry.source){entry.launch=assessLaunch(entry);if(entry.discovery&&entry.discovery.version!==DISCOVERY_VERSION){const docs=[{title:entry.title,text:`${entry.title??''}. ${entry.snippet??''}`,url:entry.url,label:'Сохранённая публикация'}];entry.discovery=assessDiscovery(docs,filters,entry.qualification??assessBanking(docs,filters),entry.id);}}
    };
    for(const entry of [...draft.findings,...draft.reviewCandidates,...draft.jobs.flatMap(j=>[...j.results??[],...j.reviewCandidates??[],...j.existingResults??[]])])upgrade(entry,draft.schedule.filters);
    for(const entry of draft.reviewCandidates.filter(e=>e.discovery?.status==='service_match')){if(!draft.findings.some(e=>e.appId===entry.appId))draft.findings.push(entry);}
    draft.reviewCandidates=draft.reviewCandidates.filter(e=>!draft.findings.some(saved=>saved.appId===e.appId));
    for(const entry of [...draft.social.findings,...draft.social.jobs.flatMap(j=>j.results??[])])upgrade(entry,draft.social.schedule.filters);
    if(!draft.social.schedule.filters.eventMode){
      const filters=draft.social.schedule.filters;filters.eventMode=activeSocialSources({...filters,eventMode:'launches'}).length?'launches':'signals';
      if(filters.eventMode==='launches'&&(JSON.stringify(filters.queries)===JSON.stringify(BUSINESS_SOCIAL_QUERIES)||JSON.stringify(filters.queries)===JSON.stringify(SOCIAL_QUERIES)))filters.queries=[...LAUNCH_QUERIES];
    }
    draft.schedule.filters.ignoreReleaseDate ??= false;
    // Add conservative defaults to old schedules without removing historical findings.
    Object.assign(draft.schedule.filters, validateCriteria(draft.schedule.filters));
    Object.assign(draft.social.schedule.filters, validateCriteria(draft.social.schedule.filters));
    for (const section of [draft, draft.social, draft.watch,draft.web,draft.apple])
      for (const job of section.jobs) {
        if (!["running","cancelling"].includes(job.status)) continue;
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
