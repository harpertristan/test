import {groupedCandidates} from './neural-inbox.js';
import {createHash,randomUUID} from 'node:crypto';
import {busyJob,cancellationError,runProvider} from './run-context.js';
import {reviewConfig,AI_REVIEW_VERSION} from './ai-config.js';
import {aiError} from './openai-provider.js';
import {referenceMatch,referenceByName} from './references.js';
import {manuallyExcluded} from './manual-exclusions.js';
import {assessBanking,validateCriteria,publicURL,explicitEUIbanClaim} from './qualification.js';
const day=now=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Kaliningrad',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
const normalize=s=>String(s??'').normalize('NFKC').replace(/\s+/g,' ').trim();
const forbidden=/\/(?:login|log-in|signin|sign-in|register|registration|signup|sign-up|identity|onboarding|checkout|account|dashboard)(?:\/|$)/i;
export const reviewCandidates=groupedCandidates;
export function dueReviews(state,model,now=new Date()){
 const c=state.ai.config;
 return reviewCandidates(state).filter(e=>{
  if(e.reference&&!c.includeKnown)return false;
  const previous=state.ai.results.find(r=>r.id===e.id);
  return !previous||previous.inputHash!==e.inputHash||previous.model!==model||previous.version!==AI_REVIEW_VERSION||+now-Date.parse(previous.checkedAt)>(previous.decision==='match'?7:1)*86400000;
 }).sort((a,b)=>Number(Boolean(a.reference))-Number(Boolean(b.reference))||candidateScore(b)-candidateScore(a)||String(b.firstFoundAt??'').localeCompare(a.firstFoundAt??''));
}
export function evidenceLinks(body,base){
 const parent=publicURL(base);if(!parent)return[];
 const host=parent.hostname.replace(/^www\./,'');
 return [...new Set([...String(body).matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map(([,href,label])=>{
  try{const url=publicURL(new URL(href.replaceAll('&amp;','&'),base).href);if(!url||!(url.hostname===host||url.hostname.endsWith('.'+host))||forbidden.test(url.pathname)||!/(?:business|corporate|account|iban|faq|help|terms|legal|pricing|fees)/i.test(`${url.pathname} ${label}`))return null;url.hash='';return url.href;}catch{return null;}
 }).filter(Boolean))].slice(0,2);
}
function excerpt(text){
 const lines=String(text??'').split(/\n+/);const selected=lines.filter((line,i)=>/business|corporate|compan|account|IBAN|SEPA|EUR|euro|банк|бизнес|сч[её]т|licen|checker|calculator|validator|personal|transfer|issuing|issue|regulated|EMI|payments|waitlist|coming soon/i.test(line)||i<2);
 return (selected.length?selected.join('\n'):String(text??'')).slice(0,12000);
}
export async function collectEvidence(entry,{pages,index,signal,onStage=()=>{}}){
 const docs=[],errors=[];const add=(url,text,kind)=>{const clean=excerpt(text);if(!clean||!publicURL(url))return;const previous=docs.find(d=>d.url===url);if(previous){if(kind==='official_page')Object.assign(previous,{text:clean,kind});return;}docs.push({id:`s${docs.length+1}`,url,text:clean,kind});};
 if(entry.documents?.length){for(const doc of entry.documents)add(doc.url,doc.text,doc.kind);}else add(entry.url,entry.screeningText??entry.snippet,entry.section==='social'?'third_party':'listing');
 const site=publicURL(entry.developerWebsite??(entry.section==='web'?entry.url:null));
 if(site){
  const root=forbidden.test(site.pathname)?site.origin+'/':site.href;
  onStage('Читаем сайт сервиса');
  try{
   const page=await pages.page(root);signal.throwIfAborted();add(page.url,page.text,'official_page');
   for(const link of evidenceLinks(page.body,page.url)){
    try{const linked=await pages.page(link);signal.throwIfAborted();add(linked.url,linked.text,'official_page');}catch(error){if(signal.aborted)throw error;errors.push('Одна из страниц сайта недоступна.');}
   }
  }catch(error){if(signal.aborted)throw error;errors.push('Публичный сайт не прочитан; используются доступные описания и индекс.');}
  // One optional Brave request, only if direct pages did not provide account/IBAN claims.
  const text=docs.filter(d=>d.kind==='official_page').map(d=>d.text).join(' ');
  if(index?.configured()&&!( /IBAN/i.test(text)&&/business|corporate|companies/i.test(text))){
   onStage('Ищем сведения в индексе сайта · Brave');
   try{const results=await index.search({q:`site:${site.hostname.replace(/^www\./,'')} ("business account" OR "corporate account") (IBAN OR SEPA OR EUR)`,count:5,search_lang:'en'});
    for(const r of results){const url=publicURL(r.url),host=site.hostname.replace(/^www\./,'');if(url&&(url.hostname===host||url.hostname.endsWith('.'+host))&&!forbidden.test(url.pathname))add(url.href,[r.title,r.description,...r.extra_snippets??[]].join('. '),'official_index');}
   }catch(error){if(signal.aborted)throw error;errors.push('Индекс Brave недоступен; отзывы не требуются для сохранения находки.');}
  }
 }
 let remaining=24000;
 return {documents:docs.slice(0,6).map(d=>{const text=d.text.slice(0,Math.max(0,remaining));remaining-=text.length;return {...d,text};}).filter(d=>d.text),errors};
}
export function validateAssessment(raw,documents){
 const facts={};let rejectedQuotes=0;
 for(const name of['business','account','euIban','utility']){
  const fact=raw?.[name];const evidence=[];
  for(const item of Array.isArray(fact?.evidence)?fact.evidence.slice(0,5):[]){
   const doc=documents.find(d=>d.id===item.sourceId),quote=normalize(item.quote);
   if(!doc||quote.length<8||quote.length>1600||!normalize(doc.text).includes(quote)){rejectedQuotes++;continue;}
   evidence.push({quote,url:doc.url,kind:doc.kind,sourceId:doc.id});
  }
  facts[name]={status:['yes','no'].includes(fact?.status)&&evidence.length?fact.status:'unknown',evidence};
 }
 if(facts.euIban.status==='yes'){
  const supported=facts.euIban.evidence.some(item=>{
   const context=[...facts.business.evidence,...facts.account.evidence].filter(e=>e.sourceId===item.sourceId).map(e=>e.quote).join('. ');
   return explicitEUIbanClaim(item.quote)&&assessBanking([{text:context+'. '+item.quote,url:item.url,label:'ИИ · проверенная цитата'}],validateCriteria()).evidence.euIban.length>0;
  });
  if(!supported)facts.euIban.status='unknown';
 }
 const official=f=>f.evidence.some(e=>e.kind==='official_page'||e.kind==='listing'&&e.url.includes('play.google.com')||e.kind==='official_index');
 const utility=facts.utility.status==='yes'&&official(facts.utility);
 const extras=extraAssessment(raw,documents);
 const decision=utility?'irrelevant':['waitlist','planned'].includes(extras.availability.status)?'review':facts.business.status==='yes'&&facts.account.status==='yes'&&facts.euIban.status==='yes'&&facts.utility.status!=='yes'?'match':'review';
 return {facts,decision,...extras,rejectedQuotes,summary:String(raw?.summaryRu??'').slice(0,1600),notice:'Вывод ИИ по указанным текстам. Это не проверка лицензии или гарантии открытия счёта.'};
}
export function createAIReview({store,provider,pages,index,clock=()=>new Date(),autoSchedule=false,isDiscoveryBusy=()=>false,tickInterval=30000,requestTimeoutMs=60000}){
 let execution=Promise.resolve(),starting=Promise.resolve(),controller=null,currentJob=null,timer,stopped=false,collector=null;
 const active=()=>busyJob(currentJob)?currentJob:store.state.ai.jobs.findLast(busyJob)??null;
 const usage=()=>store.state.ai.usage[day(clock()).slice(0,7)]??{attempts:0,inputTokens:0,outputTokens:0};
 const summary=()=>({config:store.state.ai.config,configured:provider.configured(),model:provider.model,busy:Boolean(active()),activeJobId:active()?.id??null,latestJobId:store.state.ai.jobs.at(-1)?.id??null,lastSuccessAt:store.state.ai.lastSuccessAt,due:dueReviews(store.state,provider.model,clock()).length,usage:usage(),inboxOverflow:store.state.ai.inboxOverflow??0,version:AI_REVIEW_VERSION});
 const visibleResults=()=>store.state.ai.results.filter(r=>!manuallyExcluded(r,store.state.manualExclusions)).map(r=>({...r,isNew:store.state.ai.newIds?.includes(r.id)??false}));
 async function startJob(){
  if(stopped)throw Object.assign(new Error('Программа останавливается.'),{status:503});
  if(controller)throw Object.assign(new Error('Проверка ИИ уже идёт.'),{status:409});
  if(!provider.configured())throw Object.assign(new Error(aiError({code:'MISSING_KEY'}).message),{status:503});
  const config=store.state.ai.config,remaining=config.monthlyLimit-usage().attempts;
  if(remaining<=0)throw Object.assign(new Error('Достигнут месячный лимит попыток OpenAI. Измените лимит или дождитесь следующего месяца.'),{status:409});
  const queue=dueReviews(store.state,provider.model,clock()).slice(0,Math.min(config.perRun,remaining));
  if(!queue.length)throw Object.assign(new Error('Новых находок для проверки нет. Уже проверенные тексты повторно не отправляются.'),{status:409});
  controller=new AbortController();const currentController=controller,signal=controller.signal;
  const job={id:randomUUID(),status:'running',createdAt:clock().toISOString(),current:'',done:0,total:queue.length,attempts:0,braveRequests:0,errors:[],results:[]};currentJob=job;
  try{starting=store.update(d=>{d.ai.jobs.push(structuredClone(job));d.ai.jobs=d.ai.jobs.slice(-20);d.ai.lastRunAt=clock().toISOString();});await starting;}catch(error){controller=null;currentJob=null;throw error;}
  const persist=()=>store.update(d=>{const i=d.ai.jobs.findIndex(j=>j.id===job.id);d.ai.jobs[i]=structuredClone(job);});
  const onRequest=request=>{job.request=request;};
  const source=runProvider(pages,signal,{onRequest});
  const research=index?runProvider(index,signal,{onRequest}):null;
  const limitedResearch=research?{...research,search:options=>{job.braveRequests++;return research.search(options);}}:null;
  const ai=runProvider(provider,signal,{timeoutMs:requestTimeoutMs,onRequest});
  execution=(async()=>{
   try{
    for(const entry of queue){
     signal.throwIfAborted();if(manuallyExcluded(entry,store.state.manualExclusions))continue;
     job.current=entry.title;await persist();
     const evidence=await collectEvidence(entry,{pages:source,index:job.braveRequests<3?limitedResearch:null,signal,onStage:stage=>{job.stage=stage;}});signal.throwIfAborted();
     if(!evidence.documents.length){job.errors.push({title:entry.title,message:'Нет доступных текстов для ИИ. Находка сохранена, запрос OpenAI не выполнен.'});job.done++;continue;}
     const month=day(clock()).slice(0,7);
     await store.update(d=>{const u=d.ai.usage[month]??={attempts:0,inputTokens:0,outputTokens:0};if(u.attempts>=d.ai.config.monthlyLimit)throw new Error('Monthly AI limit reached');u.attempts++;});
     signal.throwIfAborted();job.attempts++;job.stage='OpenAI разбирает источники';
     let answer;
     try{answer=await ai.assess({title:entry.title,documents:evidence.documents});}
     catch(error){if(signal.aborted)throw error;job.errors.push({title:entry.title,...aiError(error)});break;}
     signal.throwIfAborted();const assessment=validateAssessment(answer.assessment,evidence.documents);
     const result={id:entry.id,targetId:entry.targetId,section:entry.section,appId:entry.appId,title:entry.title,url:entry.url,developerWebsite:entry.developerWebsite,earlySignal:entry.earlySignal||['waitlist','planned'].includes(assessment.availability.status),reference:entry.reference??referenceByName(assessment.serviceName)?.name??null,targets:entry.targets,sources:entry.sources,inputHash:entry.inputHash,version:AI_REVIEW_VERSION,model:answer.model,...assessment,sourceErrors:evidence.errors,checkedAt:clock().toISOString(),usage:answer.usage};
     await store.update(d=>{const u=d.ai.usage[month];u.inputTokens+=answer.usage.inputTokens;u.outputTokens+=answer.usage.outputTokens;d.ai.lastSuccessAt=clock().toISOString();if(manuallyExcluded(result,d.manualExclusions))return;const i=d.ai.results.findIndex(r=>r.id===result.id);if(i>=0)d.ai.results[i]=result;else d.ai.results.push(result);if(result.reference)d.ai.newIds=d.ai.newIds.filter(id=>id!==result.id);});
     job.done++;job.results.push(result.id);await persist();
    }
    job.status=job.errors.length?job.done?'partial':'failed':'complete';
   }catch(error){if(signal.aborted)job.status='cancelled';else{job.status='failed';job.errors.push(aiError(error));}}
   finally{job.current='';job.stage='';job.request=null;job.finishedAt=clock().toISOString();try{await persist();}finally{if(controller===currentController)controller=null;}}
  })();
  execution.catch(()=>{});return structuredClone(job);
 }
 return {summary,active,results:visibleResults,job:id=>currentJob?.id===id?currentJob:store.state.ai.jobs.find(j=>j.id===id)??null,startJob,idle:()=>execution,
  async saveConfig(input){const c=reviewConfig(input);await store.update(d=>{d.ai.config=c;});return summary();},
  async cancel(){if(controller&&currentJob)currentJob.status='cancelling';controller?.abort(cancellationError());await starting.catch(()=>{});if(controller){const job=active();if(job)await store.update(d=>{const saved=d.ai.jobs.find(j=>j.id===job.id);if(saved?.status==='running')saved.status='cancelling';});}await execution;return active()??store.state.ai.jobs.at(-1)??null;},
  setCollector(fn){collector=fn;},
  async tick(){
   const config=store.state.ai.config,now=clock(),slot=new Date(`${day(now)}T${config.time}:00+02:00`);
   if(stopped||controller||isDiscoveryBusy()||!autoSchedule||!config.enabled||now<slot)return;
   if(config.collectSources&&collector){if(store.state.ai.lastGatherAt&&day(new Date(store.state.ai.lastGatherAt))===day(now))return;try{await collector({reuseToday:true});}catch{}return;}
   if(!provider.configured()||!dueReviews(store.state,provider.model,now).length||usage().attempts>=config.monthlyLimit||store.state.ai.lastRunAt&&day(new Date(store.state.ai.lastRunAt))===day(now))return;
   try{await startJob();}catch{}
  },
  start(){if(autoSchedule&&!timer){timer=setInterval(()=>{void this.tick();},tickInterval);timer.unref();void this.tick();}},
  async stop(){stopped=true;clearInterval(timer);await this.cancel();}
 };
}

export function extraAssessment(raw,documents){
 const quotes=items=>(Array.isArray(items)?items:[]).slice(0,3).flatMap(item=>{const d=documents.find(d=>d.id===item.sourceId),q=normalize(item.quote);return d&&q.length>=8&&q.length<=1600&&normalize(d.text).includes(q)?[{quote:q,url:d.url,kind:d.kind}]:[];});
 const availabilityEvidence=quotes(raw?.availability?.evidence),availability={status:availabilityEvidence.length&&['live','waitlist','planned'].includes(raw?.availability?.status)?raw.availability.status:'unknown',evidence:availabilityEvidence};
 const name=normalize(raw?.service?.name),nameEvidence=quotes(raw?.service?.evidence);
 const serviceName=name.length>=2&&name.length<=100&&nameEvidence.some(q=>normalize(q.quote).toLowerCase().includes(name.toLowerCase()))&&!/^(?:bank|business bank|neobank|business account|unknown)$/i.test(name)?name:null;
 return {availability,serviceName};
}

function candidateScore(e){const text=e.documents?.map(d=>d.text).join(' ')??e.screeningText??'';return (e.sources?.includes('play')?6:0)+(/\bIBAN\b/i.test(text)?3:0)+(/business account|corporate account/i.test(text)?3:0)+(/waitlist|launches|now available|licensed/i.test(text)?2:0)-(/future of|how to choose|best.*accounts|comparison/i.test(e.title)?5:0);}
