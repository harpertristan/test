import {randomUUID,createHash} from 'node:crypto';
import {loadStoredState,StateStore} from './state-journal.js';
import {effectiveExclusions,manuallyExcluded} from './manual-exclusions.js';
import {groupedCandidates} from './neural-inbox.js';
import {REVIEW_RESET_VERSION} from './review-cycle.js';
import {requireStopped} from './profile-transfer.js';
import {crmRows} from './crm.js';
import {matchesCRMView} from './crm-views.js';

const sections=state=>[['play',state],['web',state.web],['social',state.social],['watch',state.watch],['apple',state.apple]];
const digest=text=>createHash('sha256').update(text).digest('hex');
function identity(entry={},section='web'){
 const id=entry.recheckId??entry.id;
 return{...entry,section:entry.originSection??entry.section??section,
  ...(!entry.developerWebsite&&id?.startsWith('company:')?{developerWebsite:'https://'+id.slice(8)+'/'}:{}),
  ...(!entry.appId&&id?.startsWith('app:')?{appId:id.slice(4)}:{}),
  ...(!entry.url&&id?.startsWith('link:')?{url:id.slice(5)}:{})};
}
function recordRule(id,record){
 const kind=id.startsWith('company:')?'domain':id.startsWith('app:')?'app':id.startsWith('link:')?'url':'name',value=kind==='name'?(record.title??record.names?.[0]??id):id.slice(id.indexOf(':')+1);
 return{key:'worked-record:'+digest(id),kind,value,title:record.title??value,names:record.names??[],matchNames:true,reason:'worked',recordId:id,createdAt:record.updatedAt};
}
function archiveRule(rule){
 const appId=rule.kind==='app'?rule.value:rule.appIds?.[0],domain=rule.kind==='domain'?rule.value:rule.domains?.[0],url=rule.url??rule.urls?.[0]??(rule.kind==='url'?rule.value:domain?'https://'+domain+'/':appId&&!appId.startsWith('apple:')?'https://play.google.com/store/apps/details?id='+encodeURIComponent(appId):null);
 const id=rule.recordId??(domain?'company:'+domain:appId?'app:'+appId:'exclusion:'+rule.key);
 return{id,recheckId:id,title:rule.title??rule.value,names:rule.names??[],appId,url,developerWebsite:domain?'https://'+domain+'/':null,originSection:'web',source:'worked_archive',evidenceDocuments:[],registryOnly:true};
}
function validate(state){
 if(state?.version!==1||!Array.isArray(state.findings)||!Array.isArray(state.jobs)||!state.schedule||!state.ai||!Array.isArray(state.ai.results)||!state.crm?.records)throw Error('Некорректная полная история. Очистка не выполнена.');
}
function plan(state){
 validate(state);
 const recordSeeds=Object.entries(state.crm.records).filter(([,r])=>r.exclusionReason==='worked').map(([id,r])=>recordRule(id,r));
 const originalWorked=(state.manualExclusions??[]).filter(r=>r.reason==='worked');
 const enriched=[...originalWorked,...recordSeeds].map(rule=>{
  const aliases=(state.knownProjects??[]).filter(p=>manuallyExcluded({title:p.name,names:p.names,domains:p.domains,url:p.urls?.[0],developerWebsite:p.domains?.[0]?'https://'+p.domains[0]+'/':null,targets:(p.appIds??[]).map(appId=>({appId}))},Object.freeze([rule])));
  return{...rule,...Object.fromEntries(['names','domains','urls','appIds'].map(key=>[key,[...new Set([...rule[key]??[],...aliases.flatMap(p=>p[key]??[])])]]))};
 });
 const base={...state,manualExclusions:enriched,crm:{...state.crm,records:Object.fromEntries(Object.entries(state.crm.records).filter(([,r])=>r.exclusionReason==='worked'))}};
 const seen=new Set(),rules=Object.freeze(effectiveExclusions(base).filter(r=>r.reason==='worked'&&!seen.has(r.key)&&seen.add(r.key)));
 // An old analysis ID is not a manual worked decision. Match the saved
 // identities/targets as CRM does, without inventing a website from that ID.
 const matches=(e,s)=>state.crm.records[e.recheckId??e.id]?.exclusionReason==='worked'||manuallyExcluded({...e,section:e.originSection??e.section??s},rules);
 // Select identities first. Large old result graphs are not projected into CRM.
 const slim={...state,manualExclusions:rules,knownProjects:[],crm:{...state.crm,reviewEntries:(state.crm.reviewEntries??[]).filter(e=>matches(e,e.originSection))},ai:{...state.ai,results:state.ai.results.filter(e=>matches(e)),inbox:(state.ai.inbox??[]).filter(e=>matches(e,e.section))}};
 let removedSourceEntries=0,keptSourceEntries=0,removedJobs=0;
 for(const [kind,section]of sections(state)){
  if(!section)continue;const target={...section};
  for(const field of['findings','reviewCandidates'])if(Array.isArray(section[field])){target[field]=section[field].filter(e=>matches(e,kind));keptSourceEntries+=target[field].length;removedSourceEntries+=section[field].length-target[field].length;}
  target.jobs=(section.jobs??[]).map(job=>{const result={...job};for(const field of['results','existingResults','reviewCandidates','filterExamples'])if(Array.isArray(job[field]))result[field]=job[field].filter(e=>matches(e,kind));return result;}).filter(job=>['results','existingResults','reviewCandidates','filterExamples'].some(k=>job[k]?.length));
  removedJobs+=(section.jobs??[]).length;
  if(kind==='play')Object.assign(slim,{findings:target.findings,reviewCandidates:target.reviewCandidates,jobs:target.jobs});else slim[kind]=target;
 }
 const savedAnalyses=new Map(state.ai.results.map(e=>[e.id,e]));
 const groups=groupedCandidates(slim,{includeExcluded:true,includeSuppressed:true,includeHistory:true,allSources:true,rules}).filter(e=>state.crm.records[e.id]?.exclusionReason==='worked'||manuallyExcluded({...e,serviceName:savedAnalyses.get(e.id)?.serviceName??e.serviceName},rules));
 const archives=groups.map(e=>{const record=state.crm.records[e.id];return{...identity(e,e.originSection),names:[...new Set([...e.names??[],...(record?.exclusionReason==='worked'?[...record.names??[],record.title].filter(Boolean):[])])],recheckId:e.id,source:'worked_archive',evidenceDocuments:e.documents??[],screeningText:'',originSection:e.originSection??'web'};});
 for(const rule of rules)if(!archives.some(e=>manuallyExcluded(e,Object.freeze([rule]))))archives.push(archiveRule(rule));
 const protectedIds=new Set(archives.map(e=>e.id));
 for(const [id,record]of Object.entries(state.crm.records))if(record.exclusionReason==='worked')protectedIds.add(id);
 const analyses=state.ai.results.filter(e=>protectedIds.has(e.id));
 const records=Object.fromEntries(Object.entries(state.crm.records).filter(([id])=>protectedIds.has(id)));
 const summary={protectedProjects:archives.length,protectedRules:rules.length,removedSourceEntries,keptSourceEntries,removedSourceJobs:removedJobs,removedAnalyses:state.ai.results.length-analyses.length,removedInbox:(state.ai.inbox??[]).length,removedPending:(state.pendingChecks??[]).length,removedReviewEntries:(state.crm.reviewEntries??[]).filter(e=>!matches(e,e.originSection)).length,removedManualRules:(state.manualExclusions??[]).filter(r=>r.reason!=='worked').length,knownProjectsPreserved:(state.knownProjects??[]).length,apiCalls:0};
 return{rules,archives,protectedIds,analyses,records,summary};
}
export const cleanupPreview=state=>plan(state).summary;
export function cleanHistory(state,{now=new Date(),backupFile=null}={}){
 const p=plan(state),at=now.toISOString();
 for(const [,section]of sections(state))if(section){section.findings=[];section.jobs=[];if('reviewCandidates'in section)section.reviewCandidates=[];if('lastSourceSuccessAt'in section)section.lastSourceSuccessAt=null;if(section.schedule){section.schedule.lastRunAt=null;section.schedule.lastStatus=null;}}
 state.pendingChecks=[];state.pendingCheckConfig=null;
 if(state.watch)state.watch.snapshots={};
 state.manualExclusions=structuredClone(p.rules);
 state.crm.records=p.records;state.crm.reviewEntries=structuredClone(p.archives);
 delete state.crm.reviewResetHistory;
 state.crm.reviewCycle={id:state.crm.reviewCycle?.id??randomUUID(),startedAt:at,baseline:[],previouslySeenRules:[],protectedIds:[...p.protectedIds],restored:0,protectedCount:p.summary.protectedProjects,backupFile};
 state.reviewResetVersion=REVIEW_RESET_VERSION;
 state.ai.results=p.analyses;state.ai.inbox=[];state.ai.jobs=[];state.ai.gatherJobs=[];state.ai.newIds=[];state.ai.shortlist=[];
 state.ai.reviewCache=Object.fromEntries(Object.entries(state.ai.reviewCache??{}).filter(([,r])=>p.protectedIds.has(r?.id)));
 for(const key of['manualBatch','lastRepair'])delete state.ai[key];
 for(const key of['lastSuccessAt','lastRunAt','lastGatherAt'])state.ai[key]=null;
 state.ai.inboxOverflow=0;
 if(state.sourceWorkspace)state.sourceWorkspace.runs=[];
 state.crm.historyCleanup={id:randomUUID(),at,backupFile,reviewCycleId:state.crm.reviewCycle.id,...p.summary};
 return state.crm.historyCleanup;
}
export async function cleanHistoryFile(file,{apply=false,now=new Date(),checkStopped=()=>requireStopped()}={}){
 await checkStopped();const info=await loadStoredState(file),summary=cleanupPreview(info.state);
 if(!apply)return{applied:false,...summary};
 await checkStopped();const store=new StateStore(file,info.state,info);
 const result=await store.update((draft,{backupFile})=>{
  const cleaned=cleanHistory(draft,{now,backupFile}),rows=crmRows(draft);
  if(rows.some(r=>matchesCRMView(r,'active')||['auto_excluded','reference','source_archive'].includes(r.status)))throw Error('Очистка не завершена: остались карточки вне проектов в работе. Исходная база не изменена; полная резервная копия создана.');
  cleaned.manualRemaining=0;cleaned.autoExcludedRemaining=0;return cleaned;
 },{backup:'before-history-clean'});
 await store.flush();return{applied:true,...result};
}
