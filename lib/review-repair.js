import {marketPolicy} from './market-scope.js';
import {validateAssessment,reviewCacheKey,validatedTranslations} from './ai-review.js';
import {VALIDATION_POLICY_VERSION,scopedDocuments,supportedServiceName,russianSummary} from './product-evidence.js';
import {groupedCandidates} from './neural-inbox.js';
import {effectiveExclusions,manuallyExcluded} from './manual-exclusions.js';
import {validateLicences,extractLicenceEvents} from './licences.js';
import {screenCandidate} from './screening.js';
import {nigeriaEvidence} from './geography.js';
import {assessWebPresence} from './web-presence.js';
import {deliveryEvidence} from './verification-policy.js';
export function mergedDocuments(entry,analysis){
 const docs=new Map();for(const d of [...entry.documents??[],...analysis?.sourceDocuments??[]]){const old=docs.get(d.url);if(!old||String(d.text).length>String(old.text).length)docs.set(d.url,{...d,kind:d.kind==='official_page'||old?.kind==='official_page'?'official_page':d.kind});}
 return scopedDocuments(entry,[...docs.values()]).map((d,i)=>({...d,id:'s'+(i+1)}));
}
export function repairStoredResult(result,entry){
 const documents=mergedDocuments(entry,result),source=quote=>documents.find(d=>d.url===quote.url)?.id;
 const raw=Object.fromEntries(Object.entries(result.facts??{}).map(([key,fact])=>[key,{status:fact.status,evidence:(fact.evidence??[]).map(e=>({sourceId:source(e),quote:e.quote}))}]));
 raw.summaryRu=result.summaryOriginal??result.summary;
 raw.availability={...result.availability,evidence:(result.availability?.evidence??[]).map(e=>({sourceId:source(e),quote:e.quote}))};
 const fixed=validateAssessment(raw,documents),serviceName=supportedServiceName(result.serviceName,entry,documents),licences=validateLicences({licences:(result.licences??[]).map(l=>({...l,sourceId:source(l)}))},documents);
 fixed.quality.recoveredFacts=[...new Set([...fixed.quality.recoveredFacts,...(result.quality?.recoveredFacts??[]).filter(name=>fixed.facts[name]?.status==='yes')])];
 if(fixed.quality.recoveredFacts.length)fixed.summary=russianSummary(fixed.facts,'',fixed.quality);
 for(const l of extractLicenceEvents(documents))if(!licences.some(x=>x.organisation===l.organisation&&x.type===l.type&&x.url===l.url))licences.push(l);
 const translations=validatedTranslations({translations:(result.translations??[]).map(t=>({...t,sourceId:documents.find(d=>d.url===t.url)?.id}))},documents,result.mode??'economy');
 const removed=(result.sourceDocuments??[]).filter(d=>!documents.some(x=>x.url===d.url));
 const removedSourceUrls=[...new Set([...(result.removedSourceUrls??[]),...removed.map(d=>d.url)])];
 const sourceDocumentsOriginal=removedSourceUrls.length?[...new Map([...(result.sourceDocumentsOriginal??[]),...(removed.length?result.sourceDocuments??[]:[])].map(d=>[d.url,d])).values()]:undefined;
 const entityChanged=Boolean(result.serviceName&&!serviceName),screen=screenCandidate({...entry,documents}),geo=nigeriaEvidence({...entry,documents});
 if(entityChanged){fixed.quality.issues.push('entity_mismatch');fixed.quality.status='needs_review';}
 return {...result,...fixed,serviceName,licences,translations,removedSourceUrls,sourceDocumentsOriginal,sourceDocuments:documents,delivery:deliveryEvidence(documents),webPresence:assessWebPresence(documents,{productURL:entry.developerWebsite??(entry.id?.startsWith('company:')?'https://'+entry.id.slice(8):null)}),repairRequired:!geo&&screen.eligible&&(fixed.quality.status==='needs_review'||entityChanged),autoExcluded:geo?'Nigeria':null,policyVersion:VALIDATION_POLICY_VERSION};
}
// Local deterministic migration: no page fetch, AI, provider switch or API usage.
export function revalidateStoredAnalyses(state,now=new Date()){
 const rules=effectiveExclusions(state),groups=groupedCandidates(state,{includeExcluded:true,allSources:true,rules}),entries=new Map(groups.map(e=>[e.id,e])),memo=new Map();let repaired=0,skippedExcluded=0;
 const fix=result=>{
  const entry=entries.get(result.id);if(!entry)return result;
  if(manuallyExcluded(entry,rules)||manuallyExcluded(result,rules)||state.crm?.records?.[entry.id]?.status==='rejected'){skippedExcluded++;return result;}
  const key=JSON.stringify([result.id,result.model,result.inputHash,result.checkedAt]);if(memo.has(key))return structuredClone(memo.get(key));
  const value=repairStoredResult(result,{...entry,...marketPolicy(state)});memo.set(key,value);repaired++;return value;
 };
 state.ai.results=state.ai.results.map(fix);for(const [key,value]of Object.entries(state.ai.reviewCache??{}))state.ai.reviewCache[key]=fix(value);
 state.ai.reviewCache??={};for(const r of state.ai.results)if(r.inputHash&&r.model)state.ai.reviewCache[reviewCacheKey(r.id,r.inputHash,r.model)]=structuredClone(r);
 state.ai.validationPolicyVersion=VALIDATION_POLICY_VERSION;state.ai.lastRepair={at:now.toISOString(),repaired,skippedExcluded,apiCalls:0};return state.ai.lastRepair;
}
