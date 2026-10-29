import {signalSearchQueries} from './focused-search.js';
import {randomUUID} from 'node:crypto';
import {SEARCH_CHANNELS} from './source-workspace-catalog.js';
const day=now=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Kaliningrad',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
const live=r=>['queued','running','cancelling'].includes(r.status);
// Sources own their requests and schedules. Channels using the same upstream
// monitor wait their turn; they never silently widen a request to all sources.
export function createSourceWorkspace({store,monitors,review,clock=()=>new Date(),autoSchedule=false,tickInterval=1000}){
 let stopped=false,timer,ready=false,pumping=false,analysisTask=null,analysisPending=false,analysisEpoch=0,analysisFailure=null;const running=new Map(),runs=[];
 const definition=id=>{const c=SEARCH_CHANNELS.find(c=>c.id===id);if(!c)throw Object.assign(new Error('Источник не найден.'),{status:400});return c;};
 const persist=()=>!runs.length?Promise.resolve():store.update(d=>{d.sourceWorkspace??={settings:{},runs:[]};for(const r of runs){const i=d.sourceWorkspace.runs.findIndex(j=>j.id===r.id);if(i<0)d.sourceWorkspace.runs.push(structuredClone(r));else d.sourceWorkspace.runs[i]=structuredClone(r);}d.sourceWorkspace.runs=d.sourceWorkspace.runs.slice(-300);});
 function summary(){return {analysisPaused:analysisFailure?.message??null,busy:runs.some(live),legacySchedules:Object.entries({play:store.state,web:store.state.web,social:store.state.social,watch:store.state.watch}).filter(([,s])=>s.schedule.enabled).map(([id])=>id),legacyCombined:Boolean(store.state.ai.config.enabled&&store.state.ai.config.collectSources),channels:SEARCH_CHANNELS.map(c=>{
  const settings=store.state.sourceWorkspace?.settings?.[c.id]??{enabled:false,time:'09:00',analyse:false};
  const last=runs.findLast(r=>r.channel===c.id)??store.state.sourceWorkspace?.runs?.findLast(r=>r.channel===c.id),active=last?.jobId?monitors[c.kind].jobs.get(last.jobId):null;
  return {...c,settings,last:last?{...last,status:!ready&&live(last)&&!runs.some(r=>r.id===last.id)?'interrupted':last.status,current:active?.current??'',done:active?.phase==='details'?active.detailDone:active?.searchDone,total:active?.phase==='details'?active.detailTotal:active?.searchTotal,errors:active?.errors?.slice(0,2)??last.errors??[],found:active?.neuralCaptured??last.found??0}:null};
 })};}
 async function save({id,enabled=false,time='09:00',analyse=false}){definition(id);if(typeof enabled!=='boolean'||typeof analyse!=='boolean'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw new Error('Проверьте расписание источника.');await store.update(d=>{d.sourceWorkspace??={settings:{},runs:[]};d.sourceWorkspace.settings[id]={enabled,time,analyse};});return summary();}
 async function start({id,analyse}={}){
  const c=definition(id);if(stopped)throw Object.assign(new Error('Программа останавливается.'),{status:503});
  if(runs.some(r=>r.channel===id&&live(r)))throw Object.assign(new Error('Этот источник уже запущен или ожидает очереди.'),{status:409});
  const shouldAnalyse=analyse??store.state.sourceWorkspace?.settings?.[id]?.analyse??false;if(typeof shouldAnalyse!=='boolean')throw new Error('Проверьте настройку разбора.');
  const r={id:randomUUID(),channel:id,kind:c.kind,status:'queued',analyse:shouldAnalyse,createdAt:clock().toISOString(),jobId:null};runs.push(r);
  try{await persist();}catch(e){runs.splice(runs.indexOf(r),1);throw e;}
  void pump();return structuredClone(r);
 }
 function enqueueAnalysis(){
  const signature=JSON.stringify(store.state.ai.config);if(analysisFailure?.signature===signature)return;if(analysisFailure)analysisFailure=null;
  analysisPending=true;if(analysisTask)return;
  const epoch=analysisEpoch;
  analysisTask=(async()=>{while(analysisPending&&!stopped&&epoch===analysisEpoch){analysisPending=false;if(review.summary({counts:false}).busy)await review.idle();if(stopped||epoch!==analysisEpoch)break;if(!review.summary({counts:false}).configured)break;try{const job=await review.startJob();await review.idle();const final=review.job?.(job?.id);if(final?.errors?.some(e=>e.code?.startsWith('LOCAL_')||['AI_AUTH','AI_QUOTA','GEMINI_AUTH','GEMINI_QUOTA'].includes(e.code))){analysisPending=false;analysisFailure={signature,message:'ИИ после источников приостановлен после ошибки доступа / локального сервера. Исправьте подключение и запустите «Разобрать найденное». Сбор сохраняется.'};break;}}catch(e){if(e.status!==409){analysisPending=false;break;}}}})().catch(()=>{}).finally(()=>{analysisTask=null;if(analysisPending&&!stopped&&epoch===analysisEpoch)enqueueAnalysis();});
 }
 async function run(r){const c=definition(r.channel),m=monitors[c.kind];try{
  r.status='running';await persist();if(stopped||r.status==='cancelling'){r.status='cancelled';return;}
  const filters=m.summary().schedule.filters;
  const eventMode=['news','newsletter','partner','social','advertising'].includes(c.category)?'launches':'signals';
  const input=c.kind==='social'?{...filters,sources:[c.source],focusDomain:c.focusDomain,eventMode,queries:eventMode==='signals'?signalSearchQueries(filters.queries):filters.queries}:{...filters};
  const j=await m.startJob(input,'channel:'+c.id);r.jobId=j.id;await persist();
  if(stopped||r.status==='cancelling')await m.cancel(j.id);
  await m.idle();r.status=j.status;r.found=j.neuralCaptured??j.results?.length??0;r.errors=j.errors?.slice(0,2)??[];
  if(r.analyse&&!stopped&&r.status!=='cancelled')enqueueAnalysis();
 }catch(e){r.status='failed';r.error=e.code==='PERSISTENCE_ERROR'?'Не удалось сохранить источник. Проверьте папку data.':e.message;}finally{r.finishedAt=clock().toISOString();await persist();}}
 async function pump(){if(pumping||stopped)return;pumping=true;try{for(const c of SEARCH_CHANNELS){if(running.has(c.kind)||monitors[c.kind].isBusy())continue;const r=runs.find(r=>r.kind===c.kind&&r.status==='queued');if(!r)continue;const task=run(r);running.set(c.kind,task);void task.catch(()=>{}).finally(()=>{running.delete(c.kind);void pump();});}}finally{pumping=false;}}
 async function cancel(id){definition(id);for(const r of runs.filter(r=>r.channel===id&&live(r))){r.status=r.status==='queued'?'cancelled':'cancelling';if(r.jobId)await monitors[r.kind].cancel(r.jobId);if(running.has(r.kind)&&r.status==='cancelling')await running.get(r.kind);}await persist();return summary();}
 async function tick(){if(stopped)return;await pump();if(!autoSchedule)return;const now=clock(),today=day(now);for(const c of SEARCH_CHANNELS){const s=store.state.sourceWorkspace?.settings?.[c.id];if(!s?.enabled||now<new Date(`${today}T${s.time}:00+02:00`)||runs.some(r=>r.channel===c.id&&live(r))||[...runs,...store.state.sourceWorkspace?.runs??[]].some(r=>r.channel===c.id&&day(new Date(r.createdAt))===today))continue;try{await start({id:c.id});}catch{}}}
 return {summary,save,start,cancel,tick,analysisResumed(){analysisFailure=null;},async cancelAll(){analysisEpoch++;analysisPending=false;for(const r of runs)if(r.status==='queued')r.status='cancelled';await Promise.allSettled(runs.filter(live).map(r=>cancel(r.channel)));await persist();return summary();},async disableLegacy(){await store.update(d=>{for(const section of[d,d.web,d.social,d.watch]){section.schedule.enabled=false;section.schedule.nextRunAt=null;}d.ai.config.collectSources=false;});return summary();},async listen(){if(ready)return;ready=true;if(store.state.sourceWorkspace?.runs?.some(live))await store.update(d=>{d.sourceWorkspace??={settings:{},runs:[]};for(const r of d.sourceWorkspace.runs)if(live(r)){r.status='interrupted';r.error='Предыдущий запуск прерван перезапуском. Повторите только этот источник.';}});timer=setInterval(()=>{void tick().catch(()=>{});},tickInterval);timer.unref();void tick();},async stop(){stopped=true;clearInterval(timer);for(const r of runs)if(r.status==='queued')r.status='cancelled';await Promise.allSettled(runs.filter(live).map(r=>cancel(r.channel)));await Promise.allSettled([...running.values()]);await persist();}};
}
