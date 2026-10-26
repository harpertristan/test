import {screenCandidate} from './screening.js';
import {validateLicences} from './licences.js';
import {nigeriaEvidence} from './geography.js';
import {groupedCandidates} from './neural-inbox.js';
import {assessWebPresence,dashboardLinks} from './web-presence.js';
import {createHash,randomUUID} from 'node:crypto';
import {busyJob,cancellationError,runProvider,settleWorkers} from './run-context.js';
import {reviewConfig,AI_REVIEW_VERSION} from './ai-config.js';
import {aiError} from './openai-provider.js';
import {referenceMatch,referenceByName} from './references.js';
import {manuallyExcluded,effectiveExclusions} from './manual-exclusions.js';
import {assessBanking,validateCriteria,publicURL,explicitEUIbanClaim} from './qualification.js';
const day=now=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Kaliningrad',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
const normalize=s=>String(s??'').normalize('NFKC').replace(/\s+/g,' ').trim();
const forbidden=/\/(?:login|log-in|signin|sign-in|register|registration|signup|sign-up|identity|onboarding|checkout|account|dashboard)(?:\/|$)/i;
export const reviewCandidates=groupedCandidates;
export const reviewCacheKey=(id,inputHash,model)=>createHash('sha256').update(JSON.stringify([id,inputHash,model,AI_REVIEW_VERSION])).digest('hex');
export function dueReviews(state,model,now=new Date(),options={}){
 const c=state.ai.config,previousResults=new Map(state.ai.results.map(r=>[r.id,r]));
 return reviewCandidates(state,options).filter(e=>{
  if(!screenCandidate(e).eligible||e.reference&&!c.includeKnown||state.crm?.records?.[e.id]?.status==='rejected')return false;
  const current=previousResults.get(e.id),cached=state.ai.reviewCache?.[reviewCacheKey(e.id,e.inputHash,model)];const previous=cached??current;
  return !previous||previous.inputHash!==e.inputHash||previous.model!==model||previous.version!==AI_REVIEW_VERSION;
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
 const lines=String(text??'').split(/\n+/);const selected=lines.filter((line,i)=>/business|corporate|compan|account|IBAN|SEPA|EUR|euro|банк|бизнес|сч[её]т|licen|checker|calculator|validator|personal|transfer|issuing|issue|regulated|EMI|payments|waitlist|coming soon|web[ -]?(?:app|platform)|dashboard|portal|browser|веб|кабинет/i.test(line)||i<2);
 return (selected.length?selected.join('\n'):String(text??'')).slice(0,12000);
}
export async function collectEvidence(entry,{pages,index,signal,onStage=()=>{},mode='economy',isExcluded=()=>false}){
 const docs=[],errors=[];const add=(url,text,kind,body)=>{const clean=excerpt(text);if(!clean||!publicURL(url))return;const links=body?dashboardLinks(body,url):[];const previous=docs.find(d=>d.url===url);if(previous){if(kind==='official_page')Object.assign(previous,{text:clean,kind,dashboardLinks:links});return;}docs.push({id:`s${docs.length+1}`,url,text:clean,kind,dashboardLinks:links});};
 if(entry.documents?.length){for(const doc of entry.documents)if(!isExcluded({url:doc.url}))add(doc.url,doc.text,doc.kind);}else add(entry.url,entry.screeningText??entry.snippet,entry.section==='social'?'third_party':'listing');
 let site=publicURL(entry.developerWebsite??(entry.section==='web'?entry.url:null));
 if(!site&&entry.url&&entry.documents?.some(d=>d.kind==='third_party')){
  onStage('Читаем публикацию и ссылки на продукт');
  try{const page=await pages.page(entry.url);signal.throwIfAborted();add(page.url,page.text,'third_party');
   const links=[...String(page.body).matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].flatMap(([,href,label])=>{
    try{const u=publicURL(new URL(href.replaceAll('&amp;','&'),page.url).href);if(!u||u.hostname===new URL(page.url).hostname||/linkedin|facebook|twitter|instagram|youtube|trustpilot|google|apple|doubleclick|substack|t\.co/i.test(u.hostname)||!/business|corporate|account|IBAN|banking|official|website|visit|launch|platform|neobank|stablecoin/i.test(label+' '+u.pathname))return[];return[u];}catch{return[];}
   });
   if(links.length)site=links[0];
  }catch(error){if(signal.aborted)throw error;errors.push('Полная публикация недоступна; сохранён фрагмент поисковой выдачи.');}
 }

 if(site&&isExcluded({url:site.href,developerWebsite:site.href}))return{documents:[],originalDocuments:docs,errors:[],blocked:true,productURL:site.href};
 if(site){
  const root=forbidden.test(site.pathname)?site.origin+'/':site.href;
  onStage('Читаем сайт сервиса');
  try{
   const page=await pages.page(root);signal.throwIfAborted();add(page.url,page.text,'official_page',page.body);
   const sufficient=assessBanking(docs,validateCriteria()).evidence.euIban.length>0;
   for(const link of mode==='economy'&&sufficient?[]:evidenceLinks(page.body,page.url)){
    if(isExcluded({url:link}))continue;
    try{const linked=await pages.page(link);signal.throwIfAborted();add(linked.url,linked.text,'official_page',linked.body);}catch(error){if(signal.aborted)throw error;errors.push('Одна из страниц сайта недоступна.');}
   }
  }catch(error){if(signal.aborted)throw error;errors.push('Публичный сайт не прочитан; используются доступные описания и индекс.');}
  // One optional Brave request, only if direct pages did not provide account/IBAN claims.
  const text=docs.filter(d=>d.kind==='official_page'||d.kind==='listing'&&/play\.google\.com|apps\.apple\.com/.test(d.url)).map(d=>d.text).join(' ');
  if(index?.configured()&&!( /IBAN/i.test(text)&&/business|corporate|companies/i.test(text))){
   onStage('Ищем сведения в индексе сайта · Brave');
   try{const results=await index.search({q:`site:${site.hostname.replace(/^www\./,'')} ("business account" OR "corporate account") (IBAN OR SEPA OR EUR)`,count:5,search_lang:'en'});
    for(const r of results){const url=publicURL(r.url),host=site.hostname.replace(/^www\./,'');if(url&&!isExcluded({url:url.href})&&(url.hostname===host||url.hostname.endsWith('.'+host))&&!forbidden.test(url.pathname))add(url.href,[r.title,r.description,...r.extra_snippets??[]].join('. '),'official_index');}
   }catch(error){if(signal.aborted)throw error;errors.push('Индекс Brave недоступен; отзывы не требуются для сохранения находки.');}
  }
 }
 const originals=docs.filter(d=>!isExcluded({url:d.url}));
 return {documents:reviewDocuments(originals,mode),originalDocuments:originals,errors,productURL:site?.href??null};
}
export function reviewDocuments(documents,mode='economy'){
 if(mode==='full'){let left=24000;return documents.slice(0,6).map(d=>{const text=d.text.slice(0,Math.max(0,left));left-=text.length;return{...d,text};}).filter(d=>d.text);}
 const rank={official_page:4,listing:3,official_index:2,third_party:1};let remaining=6000;
 return [...documents].sort((a,b)=>(rank[b.kind]??0)-(rank[a.kind]??0)).slice(0,3).map(d=>{
  const parts=String(d.text).split(/\n+|(?<=[.!?;])\s+/u).map((text,i)=>({text,i,score:(/IBAN|SEPA|electronic money|CASP|MiCA|authori[sz]|лиценз/iu.test(text)?5:0)+(/business|corporate|compan|сч[её]т|бизнес/iu.test(text)?4:0)+(/not|without|checker|validator|doesn.t|нет|не предостав/iu.test(text)?3:0)}));
  const chosen=[],budget=Math.min(2500,remaining);let used=0;for(const part of [...parts].sort((a,b)=>b.score-a.score||a.i-b.i)){if(used>=budget)break;const text=part.text.slice(0,budget-used);if(text){chosen.push({...part,text});used+=text.length+8;}}
  const text=chosen.sort((a,b)=>a.i-b.i).map(p=>p.text).join('\n[…]\n').slice(0,remaining);remaining-=text.length;return{...d,text};
 }).filter(d=>d.text);
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
 const official=f=>f.evidence.some(e=>e.kind==='official_page'||e.kind==='listing'&&(/play\.google\.com|apps\.apple\.com/.test(e.url))||e.kind==='official_index');
 const utility=facts.utility.status==='yes'&&official(facts.utility);
 const extras=extraAssessment(raw,documents);
 const decision=utility?'irrelevant':['waitlist','planned'].includes(extras.availability.status)?'review':facts.business.status==='yes'&&facts.account.status==='yes'&&facts.euIban.status==='yes'&&facts.utility.status!=='yes'?'match':'review';
 return {facts,decision,...extras,rejectedQuotes,summary:String(raw?.summaryRu??'').slice(0,1600),notice:'Вывод ИИ по указанным текстам. Это не проверка лицензии или гарантии открытия счёта.'};
}
export function createAIReview({store,provider,pages,index,clock=()=>new Date(),autoSchedule=false,isDiscoveryBusy=()=>false,tickInterval=30000,requestTimeoutMs}){
 const pageCache=new Map();const cachedPages={...pages,page:async(url,options)=>{const old=pageCache.get(url);if(old&&Date.now()-old.at<300000)return old.value;const value=await pages.page(url,options);pageCache.set(url,{at:Date.now(),value});return value;}};
 let execution=Promise.resolve(),starting=Promise.resolve(),controller=null,currentJob=null,timer,stopped=false,collector=null;
 const active=()=>busyJob(currentJob)?currentJob:store.state.ai.jobs.findLast(busyJob)??null;
 const usage=()=>(store.state.ai.config.engine==='ollama'?store.state.ai.localUsage:store.state.ai.usage)?.[day(clock()).slice(0,7)]??{attempts:0,inputTokens:0,outputTokens:0};
 const selectedProvider=()=>provider.forConfig?.(store.state.ai.config)??provider;
 const blocked=(entry,rules=effectiveExclusions(store.state))=>manuallyExcluded(entry,rules)||store.state.crm?.records?.[entry.id]?.status==='rejected';
 const summary=(options={})=>({pausedAfterUpgrade:store.state.ai.pausedAfterUpgrade??false,lastEngine:store.state.ai.jobs.at(-1)?.engine??'openai',engine:store.state.ai.config.engine??'openai',openAIUsage:store.state.ai.usage[day(clock()).slice(0,7)]??{attempts:0,inputTokens:0,outputTokens:0},config:store.state.ai.config,configured:selectedProvider().configured(),model:selectedProvider().model,busy:Boolean(active()),activeJobId:active()?.id??null,latestJobId:store.state.ai.jobs.at(-1)?.id??null,lastSuccessAt:store.state.ai.lastSuccessAt,due:dueReviews(store.state,selectedProvider().model,clock(),options).length,usage:usage(),inboxOverflow:store.state.ai.inboxOverflow??0,version:AI_REVIEW_VERSION});
 const visibleResults=()=>{const rules=effectiveExclusions(store.state),available=new Set(reviewCandidates(store.state,{rules}).map(r=>r.id));return store.state.ai.results.filter(r=>available.has(r.id)&&!blocked(r,rules)&&!r.autoExcluded).map(r=>({...r,isNew:store.state.ai.newIds?.includes(r.id)??false}));};
 async function startJob({ids,skipIds=[],mode}={}){
  if(ids!==undefined&&(!Array.isArray(ids)||ids.some(id=>typeof id!=='string')))throw Object.assign(new Error('Выберите записи для анализа.'),{status:400});
  if(stopped)throw Object.assign(new Error('Программа останавливается.'),{status:503});
  if(controller)throw Object.assign(new Error('Проверка ИИ уже идёт.'),{status:409});
  const chosenProvider=selectedProvider();
  if(!chosenProvider.configured())throw Object.assign(new Error(aiError({code:'MISSING_KEY'}).message),{status:503});
  const config=reviewConfig({...store.state.ai.config,...(mode?{mode}:{})}),engine=config.engine??'openai',usageKey=engine==='ollama'?'localUsage':'usage';
  const rules=effectiveExclusions(store.state),queue=(ids?reviewCandidates(store.state,{rules}).filter(e=>ids.includes(e.id)):dueReviews(store.state,chosenProvider.model,clock(),{rules})).filter(e=>!skipIds.includes(e.id)&&!blocked(e,rules)&&screenCandidate(e).eligible);
  if(!queue.length)throw Object.assign(new Error('Новых находок для проверки нет. Уже проверенные тексты повторно не отправляются.'),{status:409});
  controller=new AbortController();const currentController=controller,signal=controller.signal;
  const job={id:randomUUID(),engine,mode:config.mode,status:'running',createdAt:clock().toISOString(),current:'',done:0,total:queue.length,candidateIds:queue.map(e=>e.id),candidateInputs:Object.fromEntries(queue.map(e=>[e.id,e.inputHash])),attempts:0,braveRequests:0,errors:[],results:[]};currentJob=job;
  try{starting=store.update(d=>{d.ai.jobs.push(structuredClone(job));d.ai.jobs=d.ai.jobs.slice(-20);d.ai.lastRunAt=clock().toISOString();});await starting;}catch(error){controller=null;currentJob=null;throw error;}
  const persist=()=>store.update(d=>{const i=d.ai.jobs.findIndex(j=>j.id===job.id);d.ai.jobs[i]=structuredClone(job);});
  const onRequest=request=>{job.request=request;};
  const source=runProvider(cachedPages,signal,{onRequest});
  const research=index?runProvider(index,signal,{onRequest}):null;
  const limitedResearch=research?{...research,search:options=>{job.braveRequests++;return research.search(options);}}:null;
  const streamedProvider={...chosenProvider,assess:(input,options)=>chosenProvider.assess(input,{...options,onProgress:progress=>{
   job.progress={...progress,updatedAt:clock().toISOString()};
   if(engine==='ollama')job.stage=progress.phase==='loading'?'Ollama загружает модель и читает материалы':`Ollama формирует ответ · получено ${progress.outputChars??0} символов${progress.thinkingChars?' · внутреннее рассуждение '+progress.thinkingChars+' символов':''}`;
  }})};
  const ai=runProvider(streamedProvider,signal,{timeoutMs:requestTimeoutMs??chosenProvider.timeoutMs?.(config.mode)??120000,onRequest});
  execution=(async()=>{
   try{
    let cursor=0,halt=false;
    await settleWorkers(Array.from({length:Math.min(engine==='ollama'?1:2,queue.length)},async()=>{
    while(!halt){const entry=queue[cursor++];if(!entry)break;
     signal.throwIfAborted();if(blocked(entry))continue;
     job.current=entry.title;job.progress=null;await persist();
     const evidence=await collectEvidence(entry,{pages:source,index:limitedResearch,signal,onStage:stage=>{job.stage=stage;},mode:config.mode,isExcluded:e=>manuallyExcluded(e,effectiveExclusions(store.state))});signal.throwIfAborted();
     if(evidence.blocked){await store.update(d=>{for(const rule of effectiveExclusions(d))if(manuallyExcluded({url:evidence.productURL},[rule])){const saved=d.manualExclusions.find(r=>r.key===rule.key);saved.urls=[...new Set([...(saved.urls??[]),entry.url])];}});job.done++;continue;}
     if(blocked(entry)){job.done++;continue;}
     if(!evidence.documents.length){job.errors.push({title:entry.title,message:'Нет доступных текстов для ИИ. Находка сохранена, запрос OpenAI не выполнен.'});job.done++;continue;}
     const month=day(clock()).slice(0,7);
     const allowed=await store.update(d=>{if(manuallyExcluded(entry,effectiveExclusions(d))||d.crm?.records?.[entry.id]?.status==='rejected')return false;d.ai[usageKey]??={};const u=d.ai[usageKey][month]??={attempts:0,inputTokens:0,outputTokens:0};u.attempts++;return true;});
     if(!allowed||blocked(entry)){job.done++;continue;}
     signal.throwIfAborted();job.attempts++;job.stage=(engine==='ollama'?'Ollama на вашем компьютере':'OpenAI')+' разбирает источники';
     let answer;
     try{answer=await ai.assess({title:entry.title,documents:evidence.documents,translateRu:config.translateRu,mode:config.mode});}
     catch(error){if(signal.aborted)throw error;if(engine==='ollama'&&error.code!=='PERSISTENCE_ERROR'&&!error.code?.startsWith('LOCAL_'))error=Object.assign(new Error(error.message),{code:/timeout|timed out/i.test(error.message)?'LOCAL_TIMEOUT':'LOCAL_RESPONSE'});job.errors.push({title:entry.title,...aiError(error)});job.done++;if(engine==='ollama'||['AI_AUTH','AI_QUOTA'].includes(aiError(error).code)){halt=true;break;}continue;}
     signal.throwIfAborted();const assessment={...validateAssessment(answer.assessment,evidence.documents),webPresence:assessWebPresence(evidence.documents,{productURL:entry.developerWebsite??(entry.id.startsWith('company:')?'https://'+entry.id.slice(8):null)})};
     const result={id:entry.id,targetId:entry.targetId,section:entry.section,appId:entry.appId,title:entry.title,url:entry.url,developerWebsite:entry.developerWebsite,earlySignal:entry.earlySignal||['waitlist','planned'].includes(assessment.availability.status),reference:entry.reference??referenceByName(assessment.serviceName)?.name??null,targets:entry.targets,sources:entry.sources,inputHash:entry.inputHash,version:AI_REVIEW_VERSION,engine,mode:config.mode,sourceDocuments:evidence.originalDocuments,model:answer.model,metrics:answer.metrics,...assessment,licences:validateLicences(answer.assessment,evidence.documents),autoExcluded:nigeriaEvidence({documents:evidence.documents})?'Nigeria':null,translations:validatedTranslations(answer.assessment,evidence.documents,config.mode),sourceErrors:[...evidence.errors,...(config.translateRu&&validatedTranslations(answer.assessment,evidence.documents,config.mode).length<evidence.documents.length?['Перевод части текстов не получен; оригиналы сохранены в CRM.']:[])],checkedAt:clock().toISOString(),usage:answer.usage};
     await store.update(d=>{const u=d.ai[usageKey][month];u.inputTokens+=answer.usage.inputTokens;u.outputTokens+=answer.usage.outputTokens;d.ai.lastSuccessAt=clock().toISOString();const rules=effectiveExclusions(d);if(manuallyExcluded(entry,rules)||manuallyExcluded(result,rules)||d.crm?.records?.[entry.id]?.status==='rejected')return;if(result.autoExcluded)d.ai.newIds=d.ai.newIds.filter(id=>id!==result.id);d.ai.reviewCache??={};d.ai.reviewCache[reviewCacheKey(result.id,result.inputHash,result.model)]=structuredClone(result);const i=d.ai.results.findIndex(r=>r.id===result.id);if(i>=0)d.ai.results[i]=result;else d.ai.results.push(result);if(result.reference)d.ai.newIds=d.ai.newIds.filter(id=>id!==result.id);});
     job.done++;job.results.push(result.id);await persist();
    }
    }),()=>{halt=true;});
    job.status=job.errors.length?job.results.length?'partial':'failed':'complete';
   }catch(error){if(signal.aborted)job.status='cancelled';else{job.status='failed';job.errors.push(aiError(error));}}
   finally{job.current='';job.stage='';job.request=null;job.finishedAt=clock().toISOString();try{await persist();}finally{if(controller===currentController)controller=null;}}
  })();
  execution.catch(()=>{});return structuredClone(job);
 }
 return {summary,active,results:visibleResults,job:id=>currentJob?.id===id?currentJob:store.state.ai.jobs.find(j=>j.id===id)??null,startJob,idle:()=>execution,
  async saveConfig(input){if(controller)throw Object.assign(new Error('Остановите текущий разбор перед сменой настроек ИИ.'),{status:409});const c=reviewConfig(input),selected=(provider.forConfig?.(c)??provider).model;await store.update(d=>{d.ai.reviewCache??={};for(const r of d.ai.results)if(r.inputHash&&r.model)d.ai.reviewCache[reviewCacheKey(r.id,r.inputHash,r.model)]=structuredClone(r);d.ai.config=c;if(c.enabled)d.ai.pausedAfterUpgrade=false;for(const entry of reviewCandidates(d)){const cached=d.ai.reviewCache[reviewCacheKey(entry.id,entry.inputHash,selected)];if(!cached)continue;const index=d.ai.results.findIndex(r=>r.id===entry.id);if(index>=0)d.ai.results[index]=structuredClone(cached);else d.ai.results.push(structuredClone(cached));}});return summary();},
  async cancel(){if(controller&&currentJob)currentJob.status='cancelling';controller?.abort(cancellationError());await starting.catch(()=>{});if(controller){const job=active();if(job)await store.update(d=>{const saved=d.ai.jobs.find(j=>j.id===job.id);if(saved?.status==='running')saved.status='cancelling';});}await execution;return active()??store.state.ai.jobs.at(-1)??null;},
  setCollector(fn){collector=fn;},
  async tick(){
   const config=store.state.ai.config,now=clock(),slot=new Date(`${day(now)}T${config.time}:00+02:00`);
   if(stopped||controller||!autoSchedule||!config.enabled||now<slot||isDiscoveryBusy())return;
   if(config.collectSources&&collector){if(store.state.ai.lastGatherAt&&day(new Date(store.state.ai.lastGatherAt))===day(now))return;try{await collector({reuseToday:true});}catch{}return;}
   if(!selectedProvider().configured()||!dueReviews(store.state,selectedProvider().model,now).length||store.state.ai.lastRunAt&&day(new Date(store.state.ai.lastRunAt))===day(now))return;
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

export function validatedTranslations(raw,documents,mode='full'){return documents.flatMap(doc=>{const t=raw?.translations?.find(t=>t.sourceId===doc.id&&typeof t.translationRu==='string'&&t.translationRu.trim());return t?[{sourceId:doc.id,url:doc.url,kind:doc.kind,scope:mode==='economy'?'evidence':'document',original:doc.text,translationRu:t.translationRu.slice(0,50000)}]:[];});}

function candidateScore(e){const text=e.documents?.map(d=>d.text).join(' ')??e.screeningText??'';return (e.sources?.some(s=>['play','apple'].includes(s))?12:0)+(/\bIBAN\b/i.test(text)?3:0)+(/business account|corporate account/i.test(text)?3:0)+(/waitlist|launches|now available|licensed/i.test(text)?2:0)-(/future of|how to choose|best.*accounts|comparison/i.test(e.title)?5:0);}
