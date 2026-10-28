import {randomUUID} from 'node:crypto';
import {groupedCandidates} from './neural-inbox.js';
import {referenceMatch} from './references.js';
import {busyJob} from './run-context.js';
import {earlyPreset} from './discovery.js';
import {SOCIAL_SOURCES} from './source-catalog.js';
export function createNeuralSearch({store,monitors,review,clock=()=>new Date()}){
 let current=null,execution=Promise.resolve(),starting=Promise.resolve(),running=false,stopped=false;
 const persist=()=>store.update(d=>{const i=d.ai.gatherJobs.findIndex(j=>j.id===current.id);d.ai.gatherJobs[i]=structuredClone(current);});
 const summary=()=>{const job=current??store.state.ai.gatherJobs.at(-1);return job?{...job,busy:running,sources:job.sources.map(s=>{const active=monitors[s.name].jobs.get(s.jobId);return{...s,current:active?.current??'',done:active?.phase==='details'?active.detailDone:active?.searchDone??0,total:active?.phase==='details'?active.detailTotal:active?.searchTotal??0,request:active?.request??null};})}:null;};
 async function start({reuseToday=false,licencesOnly=false}={}){
  if(stopped)throw Object.assign(new Error('Программа останавливается.'),{status:503});
  if(running)throw Object.assign(new Error('Нейронный поиск уже идёт.'),{status:409});
  const before=new Set(groupedCandidates(store.state).map(e=>e.id)),attempted=new Map();let analysis=Promise.resolve(),analysisQueued=false,pump;
  const enqueueReview=()=>{if(analysisQueued||job.aiPaused)return;analysisQueued=true;analysis=analysis.then(async()=>{if(job.status!=='running'||job.aiPaused||!review.summary({counts:false}).configured)return;try{if(review.summary({counts:false}).busy)await review.idle();if(job.status!=='running'||job.aiPaused||!review.summary({allSources:licencesOnly,licencesOnly}).due)return;const ai=await review.startJob({licencesOnly,skipIds:groupedCandidates(store.state).filter(e=>attempted.get(e.id)===e.inputHash).map(e=>e.id)});job.aiJobId=ai.id;for(const id of ai.candidateIds??[])attempted.set(id,ai.candidateInputs?.[id]);await review.idle();const finished=review.job(ai.id);for(const id of finished?.candidateIds??[])attempted.set(id,finished.candidateInputs?.[id]);if(['ollama','llamacpp'].includes(finished?.engine)&&finished.errors?.some(e=>e.code?.startsWith('LOCAL_'))){job.aiPaused=true;job.errors.push('Локальный ИИ приостановлен после ошибки; повторные попытки в этом сборе отключены. Сбор источников продолжается, находки сохранены. После смены режима или модели запустите разбор вручную.');await persist();}else if(['failed','partial'].includes(finished?.status)&&!job.errors.includes('Некоторые записи ИИ не удалось разобрать; они сохранены для повторной проверки.'))job.errors.push('Некоторые записи ИИ не удалось разобрать; они сохранены для повторной проверки.');}catch(error){if(error.status!==409)job.errors.push(error.message);} }).finally(()=>{analysisQueued=false;});analysis.catch(()=>{});};
  running=true;
  const job=current={id:randomUUID(),status:'running',stage:'Собираем источники',createdAt:clock().toISOString(),sources:[],newIds:[],errors:[],aiJobId:null};
  try{starting=store.update(d=>{d.ai.gatherJobs.push(structuredClone(job));d.ai.gatherJobs=d.ai.gatherJobs.slice(-20);d.ai.lastGatherAt=clock().toISOString();});await starting;}catch(error){running=false;job.status='failed';throw error;}
  execution=(async()=>{
   try{
    enqueueReview();pump=setInterval(()=>{if(!analysisQueued)enqueueReview();},2000);pump.unref();
    const tasks=(licencesOnly?['social','watch']:store.state.ai.config.sources).filter(name=>name!=='apple').map(async name=>{
     const control=monitors[name];if(!control)return;const status={name,status:'running',jobId:null};job.sources.push(status);await persist();
     try{
      if(name==='social'||name==='web'){if(!control.summary().connection.configured){status.status='unavailable';status.error='Нужен ключ Brave. Остальные источники продолжаются.';return;}}
      let active=control.active();
      if(!active&&reuseToday){const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Kaliningrad',year:'numeric',month:'2-digit',day:'2-digit'}).format(clock());active=[...control.jobs.values()].findLast(j=>j.status==='complete'&&j.neuralCapture&&new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Kaliningrad',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(j.createdAt))===today&&(name!=='play'||j.config.referenceDiscovery)&&(name!=='social'||j.config.eventMode==='signals'&&SOCIAL_SOURCES.filter(s=>s.id!=='custom'&&!s.retired).every(s=>j.config.sources.includes(s.id))));}

      if(!active){
       const filters=control.summary().schedule.filters;
       const input=licencesOnly&&name==='social'?{...filters,eventMode:'signals',sources:SOCIAL_SOURCES.filter(s=>s.category==='register'&&!s.retired).map(s=>s.id),neuralCapture:true}:licencesOnly&&name==='watch'?{...filters,watchRegisters:true,watchUrls:[],feedUrls:[],watchApps:[],autoWatchFindings:false,autoWatchSites:false}:name==='play'?{...earlyPreset(filters.countries),...filters,referenceDiscovery:true,ignoreReleaseDate:true,minInstalls:0,neuralCapture:true}:name==='social'?{...filters,eventMode:'signals',sources:[...new Set([...filters.sources,...SOCIAL_SOURCES.filter(s=>s.id!=='custom'&&!s.retired).map(s=>s.id)])],neuralCapture:true}:{...filters,neuralCapture:true};
       if(job.status!=='running'){status.status='cancelled';return;}
       active=await control.startJob(input,'neural');
      }else status.reused=true;
      status.jobId=active.id;
      if(job.status!=='running'&&!status.reused)await control.cancel(active.id);
      await control.idle();status.status=active.status;status.successful=active.successfulSearches??0;status.errors=active.errors?.length??0;status.found=active.neuralCaptured??active.results?.length??0;
     }catch(error){status.status='failed';status.error=error.code==='PERSISTENCE_ERROR'?'Не удалось сохранить источник. Проверьте data.':error.status===409?'Источник уже выполняет другое задание. Его находки можно разобрать после завершения.':'Источник недоступен; остальные источники продолжаются.';}
     finally{await persist();enqueueReview();}
    });
    await Promise.allSettled(tasks);
    const after=groupedCandidates(store.state),newIds=after.filter(e=>!before.has(e.id)&&!e.reference&&!referenceMatch(e)).map(e=>e.id);job.newIds=newIds;
    await store.update(d=>{d.ai.newIds=newIds;d.ai.newSinceAt=job.createdAt;d.ai.newDay=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Kaliningrad',year:'numeric',month:'2-digit',day:'2-digit'}).format(clock());});
    if(job.status!=='running')return;
    job.stage='ИИ анализирует общий список';await persist();
    if(!review.summary({counts:false}).configured){job.errors.push('Сбор завершён. Подключите выбранный ИИ (Ollama / Gemini / OpenAI) в настройках.');return;}
    await analysis;enqueueReview();await analysis;
    job.newIds=store.state.ai.newIds;
   }catch(error){job.errors.push(error.code==='PERSISTENCE_ERROR'?'Не удалось сохранить нейронный поиск. Проверьте папку data.':error.message?.includes('лимит')?error.message:'Сбор завершён не полностью. Сохранённые находки доступны для анализа.');}
   finally{
    clearInterval(pump);await analysis;
    if(job.status==='running')job.status=job.errors.length||job.sources.some(s=>['failed','partial','unavailable'].includes(s.status))?'partial':'complete';
    else job.status='cancelled';
    job.stage='';job.finishedAt=clock().toISOString();try{await persist();}finally{running=false;}
   }
  })();execution.catch(()=>{});return structuredClone(job);
 }
 async function cancel(){
  if(!running)return summary();if(!busyJob(current)){await execution;return summary();}current.status='cancelling';await starting.catch(()=>{});
  const stops=current.sources.filter(s=>s.jobId&&!s.reused).map(s=>monitors[s.name].cancel(s.jobId));if(current.aiJobId||review.summary({counts:false}).busy)stops.push(review.cancel());await Promise.allSettled(stops);await execution;return summary();
 }
 return {start,cancel,summary,idle:()=>execution,stop:async()=>{stopped=true;await cancel();}};
}
