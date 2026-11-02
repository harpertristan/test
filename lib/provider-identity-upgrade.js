import {canonicalProviderId} from './provider-host.js';
const unique=items=>[...new Set(items??[])];
const documents=items=>[...new Map(items.map(d=>[d.url+'\n'+d.text,d])).values()];
const date=r=>String(r.manualStatusAt??r.updatedAt??r.checkedAt??'');
// One local migration. Original decisions and analyses remain archived; no
// fuzzy name matching, network access, or source/AI scheduling takes place.
export function consolidateProviderIdentities(state,now=new Date()){
 if(state.crm.identityVersion===1)return [];
 const aliases=new Map();
 const note=id=>{const next=canonicalProviderId(id);if(next!==id)aliases.set(id,next);return next;};
 for(const id of Object.keys(state.crm.records))note(id);
 for(const r of state.ai.results)note(r.id);
 for(const id of Object.keys(state.crm.intakeArchive??{}))note(id);
 for(const r of state.crm.reviewEntries??[])note(r.recheckId??r.id);
 for(const id of [...state.ai.shortlist??[],...state.ai.newIds??[],...state.ai.manualBatch?.candidateIds??[],...state.ai.manualBatch?.remainingIds??[],...state.crm.reviewCycle?.baseline??[],...state.crm.reviewCycle?.protectedIds??[],...(state.crm.feedback??[]).map(r=>r.projectId)])note(id);
 for(const job of state.ai.jobs)for(const id of [...job.results??[],...job.candidateIds??[],...job.remainingIds??[]])note(id);
 state.crm.identityVersion=1;if(!aliases.size)return [];
 state.crm.identityAliases??={};state.crm.identityArchive??={};
 for(const [from,to]of aliases){state.crm.identityAliases[from]=to;state.crm.identityArchive[from]={to,at:now.toISOString(),record:structuredClone(state.crm.records[from]??null),analyses:structuredClone(state.ai.results.filter(r=>r.id===from)),intake:structuredClone(state.crm.intakeArchive?.[from]??null)};}
 for(const to of unique(aliases.values()))if(!state.crm.identityArchive[to]&&(state.crm.records[to]||state.ai.results.some(r=>r.id===to)||state.crm.intakeArchive?.[to]))state.crm.identityArchive[to]={to,at:now.toISOString(),canonical:true,record:structuredClone(state.crm.records[to]??null),analyses:structuredClone(state.ai.results.filter(r=>r.id===to)),intake:structuredClone(state.crm.intakeArchive?.[to]??null)};
 const records=new Map();for(const [id,r]of Object.entries(state.crm.records)){const key=note(id);if(!records.has(key))records.set(key,[]);records.get(key).push(r);}
 for(const [id,items]of records){const sorted=[...items].sort((a,b)=>date(a).localeCompare(date(b))),worked=sorted.filter(r=>r.exclusionReason==='worked');state.crm.records[id]={...sorted.at(-1),...(worked.at(-1)??{}),notes:unique(items.map(r=>r.notes).filter(Boolean)).join('\n\n')};}
 for(const id of aliases.keys())delete state.crm.records[id];
 const analyses=new Map();for(const r of state.ai.results){const key=note(r.id);if(!analyses.has(key))analyses.set(key,[]);analyses.get(key).push(r);}
 state.ai.results=[...analyses].map(([id,items])=>{if(!items.some(r=>aliases.has(r.id)))return items[0];const latest=[...items].sort((a,b)=>date(a).localeCompare(date(b))).at(-1);return {...latest,id,sourceDocuments:documents(items.flatMap(r=>r.sourceDocuments??[])),translations:documents(items.flatMap(r=>r.translations??[])),identityMergedFrom:unique(items.map(r=>r.id))};});
 for(const r of state.crm.reviewEntries??[]){r.id=note(r.id);if(r.recheckId)r.recheckId=note(r.recheckId);}
 const archives={};for(const [id,item]of Object.entries(state.crm.intakeArchive??{})){const key=note(id),old=archives[key];archives[key]={...item,id:key,entries:documents([...(old?.entries??[]),...item.entries??[]]),state:old?.state==='returned'||item.state==='returned'?'returned':item.state,firstFoundAt:[old?.firstFoundAt,item.firstFoundAt].filter(Boolean).sort()[0]};}if(state.crm.intakeArchive)state.crm.intakeArchive=archives;
 const ids=items=>unique((items??[]).map(note));
 state.ai.newIds=ids(state.ai.newIds);state.ai.shortlist=ids(state.ai.shortlist);
 if(state.ai.manualBatch)for(const key of ['candidateIds','remainingIds'])state.ai.manualBatch[key]=ids(state.ai.manualBatch[key]);
 for(const job of state.ai.jobs)for(const key of ['results','candidateIds','remainingIds'])if(job[key])job[key]=ids(job[key]);
 if(state.crm.reviewCycle)for(const key of ['baseline','protectedIds'])if(state.crm.reviewCycle[key])state.crm.reviewCycle[key]=ids(state.crm.reviewCycle[key]);
 for(const item of state.crm.feedback??[]){const id=note(item.projectId);if(id!==item.projectId){item.originalProjectId=item.projectId;item.projectId=id;}}
 return unique(aliases.values());
}
