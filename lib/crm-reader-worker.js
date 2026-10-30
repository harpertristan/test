import {createHash} from 'node:crypto';
import {parentPort} from 'node:worker_threads';
import {crmRows,crmCSV,crmDOCX,chatPacket,crmExport} from './crm.js';
import {effectiveExclusions} from './manual-exclusions.js';
import {createMonitor} from './monitor.js';
import {createAIReview} from './ai-review.js';
import {matchesCRMView} from './crm-views.js';
let state,context,rows,snapshot,rules,projectionKey;
function keyFor(s,c){return createHash('sha256').update(JSON.stringify([c,s.manualExclusions,s.knownProjects,[s.crm.records,s.crm.settings,s.crm.reviewEntries,s.crm.reviewCycle],s.ai.config,s.ai.results,s.ai.inbox,s.ai.newIds,s.ai.shortlist,...[s,s.web,s.social,s.watch,s.apple].map(section=>[section.findings,section.reviewCandidates,section.schedule.filters,section.jobs.map(j=>[j.results,j.reviewCandidates,j.existingResults])])])).digest('hex');}
parentPort.on('message',({id,state:next,context:nextContext,task})=>{try{
 if(next){const key=keyFor(next,nextContext);state=next;context=nextContext;if(key!==projectionKey){rows=null;snapshot=null;rules=null;projectionKey=key;}}
 if(!rows){rules=effectiveExclusions(state);rows=crmRows(state,{rules});}
 let value;
 if(task.kind==='detail')value=rows.find(r=>r.id===task.id)??null;
 else if(task.kind==='manual')value=rows.filter(r=>matchesCRMView(r,'review')&&!r.worked&&!r.manualExcluded).map(r=>r.id);
 else if(task.kind==='export'){
  const selected=crmExport(state,{...task.options,rows});value=task.format==='csv'?crmCSV(selected):task.format==='docx'?crmDOCX(selected):chatPacket(selected,task.metadata);
 }else{
  if(!snapshot){const store={state},clock=()=>new Date(context.now),monitors={};
   for(const kind of['play','web','social','watch'])monitors[kind]=createMonitor({store,kind,clock,hydrateJobs:false,provider:{configured:()=>context.braveConfigured}}).summary({rules});
   const ai=createAIReview({store,clock,provider:{model:context.model,models:context.models,configured:()=>true}}).summary({rules});
   snapshot={manualCount:rows.filter(r=>matchesCRMView(r,'review')&&!r.worked&&!r.manualExcluded).length,rows:rows.map(({documents,translations,sourceDocuments,sourceDocumentsOriginal,evidenceDocuments,screeningText,snippet,...r})=>({...r,documentCount:documents?.length??0,translationCount:translations?.length??0})),counts:rows.reduce((c,r)=>(c[r.status]=(c[r.status]??0)+1,c),{}),monitors,ai:{due:ai.due,repairDue:ai.repairDue}};
  }value=snapshot;
 }
 parentPort.postMessage({id,value});
 }catch(error){parentPort.postMessage({id,error:error.message});}});
