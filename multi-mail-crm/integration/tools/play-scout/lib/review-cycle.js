import {referenceByName} from './references.js';
import {randomUUID} from 'node:crypto';
import {canonicalName} from './identity-names.js';
import {groupedCandidates} from './neural-inbox.js';
import {effectiveExclusions,manuallyExcluded,exclusionMatch,canonicalFindingURL} from './manual-exclusions.js';
import {knownProjectRules} from './known-projects.js';
export const REVIEW_RESET_VERSION=1;
export const workedRules=state=>Object.freeze(effectiveExclusions(state).filter(r=>r.reason==='worked'));
const baselines=new WeakMap();
const tokens=entry=>[entry.id&&'id:'+entry.id,...[entry.appId,...entry.appIds??[],...(entry.targets??[]).map(t=>t.appId)].filter(Boolean).map(v=>'app:'+v),...[entry.url,entry.developerWebsite,...entry.urls??[]].map(canonicalFindingURL).filter(Boolean).map(v=>'url:'+v),...[entry.developerWebsite,...entry.domains??[]].flatMap(v=>{try{return['domain:'+new URL(v.includes('://')?v:'https://'+v).hostname.replace(/^www\./,'')];}catch{return[];}}),...[entry.title,entry.name,entry.serviceName,...entry.names??[]].map(canonicalName).filter(Boolean).map(v=>'name:'+v)];
export function freshFinding(state,entry,record={}){
 if(entry.reference||referenceByName(entry.serviceName??entry.title)||record.reviewedAt||record.status==='approved'||record.status==='rejected')return false;
 const cycle=state.crm?.reviewCycle;if(!cycle)return state.ai.newIds?.includes(entry.id)??false;
 if(record.reviewCycleId===cycle.id)return false;
 let baseline=baselines.get(cycle);if(!baseline){baseline={tokens:new Set(cycle.baseline),rules:Object.freeze([...(cycle.previouslySeenRules??[])])};baselines.set(cycle,baseline);}return !manuallyExcluded(entry,baseline.rules)&&!tokens(entry).some(t=>baseline.tokens.has(t))&&Boolean(entry.firstFoundAt&&Date.parse(entry.firstFoundAt)>=Date.parse(cycle.startedAt));
}
export function reviewInventory(state){
 const rules=effectiveExclusions(state),protectedRules=Object.freeze(rules.filter(r=>r.reason==='worked'));
 const live=groupedCandidates(state,{includeExcluded:true,includeSuppressed:true,allSources:true,rules}),all=groupedCandidates(state,{includeExcluded:true,includeSuppressed:true,includeHistory:true,allSources:true,rules}),entries=new Map(all.map(e=>[e.id,e]));
 const appIndex=new Set(all.flatMap(e=>[e.appId,...(e.targets??[]).map(t=>t.appId)]).filter(Boolean)),urlIndex=new Set(all.flatMap(e=>[e.url,...(e.targets??[]).map(t=>t.url)]).map(canonicalFindingURL).filter(Boolean));
 const contains=e=>e.appId&&appIndex.has(e.appId)||e.url&&urlIndex.has(canonicalFindingURL(e.url));
 for(const [section,s]of[['play',state],['web',state.web],['social',state.social],['watch',state.watch],['apple',state.apple]])for(const job of s?.jobs??[])for(const e of job.filterExamples??[]){
  if(contains(e))continue;const url=e.url??(e.appId?'https://play.google.com/store/apps/details?id='+encodeURIComponent(e.appId):null),id=e.appId?'app:'+e.appId:'history:'+section+':'+job.id+':'+entries.size;
  if(e.appId)appIndex.add(e.appId);if(url)urlIndex.add(canonicalFindingURL(url));
  if(!entries.has(id))entries.set(id,{...e,id,url,title:e.title??e.appId??'Запись прежнего отсева',originSection:section,sources:[section],targets:url?[{section,targetId:e.appId??e.id,url,appId:e.appId}]:[],documents:[],previousScreeningReason:e.reason,incompleteArchive:true});
 }
 for(const e of state.pendingChecks??[]){if(!e.appId||appIndex.has(e.appId))continue;appIndex.add(e.appId);const id='app:'+e.appId,url='https://play.google.com/store/apps/details?id='+encodeURIComponent(e.appId);entries.set(id,{id,appId:e.appId,title:e.title??e.hint??e.appId,url,originSection:'play',sources:['play'],targets:[{section:'play',targetId:e.appId,url,appId:e.appId}],documents:[],incompleteArchive:true,previousScreeningReason:'Карточка оставалась в очереди'});}
 const originals=[...state.manualExclusions??[],...knownProjectRules(state)];
 for(const rule of originals){
  const one=Object.freeze([rule]),matched=[...entries.values()].find(e=>manuallyExcluded(e,one));if(matched){if(rule.knownProjectId)matched.reviewAliasIds=[...new Set([...matched.reviewAliasIds??[],rule.knownProjectId])];continue;}
  const appId=rule.appIds?.[0]??(rule.kind==='app'?rule.value:null),domain=rule.domains?.[0]??(rule.kind==='domain'?rule.value:null),url=rule.url??rule.urls?.[0]??(rule.kind==='url'?rule.value:domain?'https://'+domain+'/':appId?'https://play.google.com/store/apps/details?id='+encodeURIComponent(appId):null);
  const id=domain?'company:'+domain:appId?'app:'+appId:'registry:'+rule.key;
  entries.set(id,{id,url,appId,title:rule.title??rule.value,developerWebsite:domain?'https://'+domain+'/':null,originSection:'web',sources:[rule.knownProjectId?'known':'manual'],targets:[],documents:[],registryOnly:true,registryRuleKey:rule.key,reviewAliasIds:rule.knownProjectId?[rule.knownProjectId]:[],names:rule.names??[]});
 }
 for(const [id,r]of Object.entries(state.crm?.records??{}))if(!entries.has(id)&&r.status){const domain=id.startsWith('company:')?id.slice(8):null;entries.set(id,{id,title:r.title??domain??id,url:domain?'https://'+domain+'/':null,developerWebsite:domain?'https://'+domain+'/':null,originSection:'web',sources:['manual'],targets:[],documents:[],registryOnly:true});}
 return{entries:[...entries.values()],liveIds:new Set(live.map(e=>e.id)),protectedRules};
}
export function resetForReview(state,{now=new Date(),backupFile=null}={}){
 const {entries,liveIds,protectedRules}=reviewInventory(state),id=randomUUID(),at=now.toISOString(),baseline=[...new Set(entries.flatMap(tokens))];
 const previouslySeenRules=structuredClone([...state.manualExclusions,...knownProjectRules(state)]),oldRules=effectiveExclusions(state);
 state.crm.reviewResetHistory??=[];state.crm.reviewResetHistory.push({id,at,backupFile,manualExclusions:structuredClone(state.manualExclusions),knownProjects:structuredClone(state.knownProjects),records:structuredClone(state.crm.records),newIds:[...state.ai.newIds],shortlist:[...state.ai.shortlist]});
 let restored=0,protectedCount=0;const protectedIds=new Set();const archives=new Map((state.crm.reviewEntries??[]).map(e=>[e.id,e]));
 for(const e of entries){
  if(!liveIds.has(e.id)){const fields=['id','title','url','appId','developerWebsite','developer','developerAddress','developerCountry','originSection','targets','sourceKeys','released','publishedAt','regulatoryLead','reference','signalType','registryOnly','incompleteArchive','previousScreeningReason'];const archive=Object.fromEntries(fields.filter(k=>e[k]!==undefined).map(k=>[k,e[k]]));archives.set(e.id,{...archive,recheckId:e.id,source:'review_archive',screeningText:e.documents?.length?'':e.screeningText??e.snippet??'',evidenceDocuments:e.documents??[],firstFoundAt:e.firstFoundAt??at});}
  if(manuallyExcluded(e,protectedRules)||state.crm.records[e.id]?.exclusionReason==='worked'){protectedCount++;protectedIds.add(e.id);continue;}
  const old=state.crm.records[e.id]??{},notes=[old.notes,...(e.reviewAliasIds??[]).map(key=>state.crm.records[key]?.notes)].filter(Boolean);state.crm.records[e.id]={...old,...(notes.length?{notes:[...new Set(notes)].join('\n')}:{}),status:'review',reviewCycleId:id,needsManualReview:true,previousStatus:old.status??null,previousExclusionReason:exclusionMatch(e,oldRules)?.rule.reason??old.exclusionReason??null,reviewedAt:null,approval:null,updatedAt:at};restored++;
 }
 state.crm.reviewEntries=[...archives.values()];
 state.manualExclusions=state.manualExclusions.filter(r=>r.reason==='worked');
 for(const p of state.knownProjects??[])if(state.crm.records[p.id]?.exclusionReason!=='worked'&&!manuallyExcluded({title:p.name,names:p.names,domains:p.domains,url:p.urls?.[0],developerWebsite:p.domains?.[0]?'https://'+p.domains[0]+'/':null,appId:p.appIds?.[0],targets:(p.appIds??[]).map(appId=>({appId}))},protectedRules))p.enabled=false;
 state.ai.newIds=state.ai.newIds.filter(key=>protectedIds.has(key));state.ai.shortlist=state.ai.shortlist.filter(key=>protectedIds.has(key));
 state.crm.reviewCycle={id,startedAt:at,baseline,previouslySeenRules,protectedIds:[...protectedIds],restored,protectedCount,backupFile};state.reviewResetVersion=REVIEW_RESET_VERSION;
 return{...state.crm.reviewCycle,baseline:undefined,previouslySeenRules:undefined,protectedIds:undefined,apiCalls:0};
}
