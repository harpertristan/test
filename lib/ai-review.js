import {canonicalName} from './identity-names.js';
import {cachedPageProvider} from './page-cache.js';
import {freshFinding} from './review-cycle.js';
import {pureCryptoWallet} from './crypto-scope.js';
import {marketPolicy,nonTargetMarketEvidence} from './market-scope.js';
import {utilityQuoteSupported} from './utility-evidence.js';
import {VALIDATION_POLICY_VERSION,namedProductLinks,productHost,scopedDocuments,businessIbanSupported,directFactSuggestions,documentScore,assessmentQuality,russianSummary,supportedServiceName} from './product-evidence.js';
import {verifiedDecision,deliveryEvidence} from './verification-policy.js';
import {researchLicenceSites} from './licence-research.js';
import {inboxEntry,storeInbox} from './neural-inbox.js';
import {licenceLead,officialRegulator} from './licences.js';
import {screenCandidate} from './screening.js';
import {validateLicences,extractLicenceEvents} from './licences.js';
import {nigeriaEvidence} from './geography.js';
import {groupedCandidates} from './neural-inbox.js';
import {assessWebPresence,dashboardLinks} from './web-presence.js';
import {createHash,randomUUID} from 'node:crypto';
import {busyJob,cancellationError,runProvider,settleWorkers} from './run-context.js';
import {reviewConfig,AI_REVIEW_VERSION} from './ai-config.js';
import {aiError} from './openai-provider.js';
import {referenceMatch,referenceByName} from './references.js';
import {manuallyExcluded,effectiveExclusions} from './manual-exclusions.js';
import {assessBanking,validateCriteria,publicURL,plainText,explicitEUIbanClaim} from './qualification.js';
const day=now=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Kaliningrad',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
const normalize=s=>String(s??'').normalize('NFKC').replace(/\s+/g,' ').trim();
const forbidden=/\/(?:login|log-in|signin|sign-in|register|registration|signup|sign-up|identity|onboarding|checkout|account|dashboard)(?:\/|$)/i;
export const reviewCandidates=groupedCandidates;
export const reviewCacheKey=(id,inputHash,model)=>createHash('sha256').update(JSON.stringify([id,inputHash,model,AI_REVIEW_VERSION])).digest('hex');
export function dueReviews(state,model,now=new Date(),options={}){
 const models=Array.isArray(model)?model:[model],c=state.ai.config,previousResults=new Map(state.ai.results.map(r=>[r.id,r]));
 return (options.candidates??reviewCandidates(state,{...options,skipManualQueue:true})).filter(e=>{
  if(state.crm?.reviewCycle&&!freshFinding(state,e,state.crm.records[e.id]??{}))return false;
  if(options.licencesOnly&&!licenceLead(e)&&!e.regulatoryLead)return false;
  if(state.crm?.reviewCycle?.protectedIds?.includes(e.id)||state.crm?.records?.[e.id]?.status==='approved'||state.crm?.records?.[e.id]?.needsManualReview||!screenCandidate(e).eligible||e.reference&&!c.includeKnown||state.crm?.records?.[e.id]?.status==='rejected')return false;
  const current=previousResults.get(e.id),cached=models.map(m=>state.ai.reviewCache?.[reviewCacheKey(e.id,e.inputHash,m)]).find(Boolean);const previous=cached??current;
  if(options.repairOnly)return Boolean(previous?.repairRequired);
  return !previous||previous.inputHash!==e.inputHash||!models.includes(previous.model)||previous.version!==AI_REVIEW_VERSION;
 }).map(entry=>({entry,score:candidateScore(entry)})).sort((a,b)=>Number(Boolean(a.entry.reference))-Number(Boolean(b.entry.reference))||b.score-a.score||String(b.entry.firstFoundAt??'').localeCompare(a.entry.firstFoundAt??'')).map(item=>item.entry);
}
export function evidenceLinks(body,base){
 const parent=publicURL(base);if(!parent)return[];
 const host=parent.hostname.replace(/^www\./,'');
 const links=[...new Set([...String(body).matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map(([,href,label])=>{
  try{const url=publicURL(new URL(href.replaceAll('&amp;','&'),base).href);if(!url||!(url.hostname===host||url.hostname.endsWith('.'+host))||forbidden.test(url.pathname)||!/(?:business|corporate|account|iban|faq|help|terms|legal|pricing|fees|about|company|contact|licensing|regulatory)/i.test(`${url.pathname} ${label}`))return null;url.hash='';return url.href;}catch{return null;}
 }).filter(Boolean))].filter(url=>!/iban[-_/]?(?:calculator|generator|checker)|iban-hesaplama/i.test(url)).sort((a,b)=>Number(/business|corporate|professional/i.test(b))-Number(/business|corporate|professional/i.test(a))||Number(/personal|privacy|cookies/i.test(a))-Number(/personal|privacy|cookies/i.test(b)));
 const identity=links.slice(1).find(url=>/\/(?:about(?:-us)?|company|contact(?:-us)?|legal|licensing|regulatory)(?:\/|$)/i.test(new URL(url).pathname));
 return [links[0],identity??links[1]].filter(Boolean);
}
function excerpt(text){
 const lines=String(text??'').split(/\n+/);const selected=lines.filter((line,i)=>/business|corporate|compan|account|IBAN|SEPA|EUR|euro|банк|бизнес|сч[её]т|licen|checker|calculator|validator|personal|transfer|issuing|issue|regulated|EMI|payments|headquarter|registered|incorporated|our address|based in|jurisdiction|waitlist|coming soon|web[ -]?(?:app|platform)|dashboard|portal|browser|веб|кабинет/i.test(line)||i<2);
 return (selected.length?selected.join('\n'):String(text??'')).slice(0,12000);
}
export async function collectEvidence(entry,{pages,index,signal,onStage=()=>{},mode='economy',isExcluded=()=>false,refreshListing=false}){
 const docs=[],errors=[];const add=(url,text,kind,body,publishedAt,fetched=false)=>{const clean=excerpt(text);if(!clean||!publicURL(url))return;const links=body?dashboardLinks(body,url):[];const previous=docs.find(d=>d.url===url);if(previous){if(kind==='official_page'||fetched)Object.assign(previous,{text:clean,kind,publishedAt:publishedAt??null,dashboardLinks:links});return;}docs.push({id:`s${docs.length+1}`,url,text:clean,kind,publishedAt:publishedAt??null,dashboardLinks:links});};
 if(entry.documents?.length){for(const doc of scopedDocuments(entry,entry.documents))if(!isExcluded({url:doc.url}))add(doc.url,doc.text,doc.kind);}else add(entry.url,entry.screeningText??entry.snippet,entry.section==='social'?'third_party':'listing');
 if(typeof refreshListing==='function'&&entry.appId&&entry.url){try{const page=await refreshListing(entry);signal.throwIfAborted();add(page.url,page.text,'listing',page.body,page.publishedAt,true);}catch(error){if(signal.aborted)throw error;errors.push('Актуальная карточка Google Play недоступна; используется сохранённое описание.');}}
 let site=publicURL(entry.developerWebsite??(entry.section==='web'&&productHost(entry.url)&&!/(?:blog|news|articles?|press|reviews?)(?:\/|$)/i.test(new URL(entry.url).pathname)?entry.url:null));
 if(!site&&!entry.url&&entry.manualReviewRequest&&index?.configured()){
  const name=canonicalName(entry.title),compact=value=>normalize(value).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
  if(name){onStage('Ищем сайт по названию '+entry.title);try{
   const found=await index.search({q:`"${entry.title.replaceAll('"','')}" ("official" OR "business account" OR IBAN)`,count:5,search_lang:'en'});
   for(const candidate of found){const u=publicURL(candidate.url);if(!u||!productHost(u.href)||!compact(u.hostname).includes(name)||/\/(?:blog|news|articles?|press|reviews?)(?:\/|$)/i.test(u.pathname)||isExcluded({title:entry.title,url:u.href,developerWebsite:u.href}))continue;
    try{const page=await pages.page(forbidden.test(u.pathname)?u.origin+'/':u.href),actual=publicURL(page.url);signal.throwIfAborted();if(!actual||!productHost(actual.href)||!compact(actual.hostname).includes(name)||!compact(page.text).includes(name))continue;site=actual;add(page.url,page.text,'official_page',page.body,page.publishedAt,true);break;}catch(error){if(signal.aborted)throw error;}
   }
   if(!site)errors.push('Сайт по названию не удалось надёжно сопоставить; требуется ручная ссылка.');
  }catch(error){if(signal.aborted)throw error;errors.push('Поиск сайта по названию недоступен.');}}
 }
 if(!site&&entry.url&&entry.documents?.some(d=>d.kind==='third_party')){
  onStage('Читаем публикацию и ссылки на продукт');
  try{const page=await pages.page(entry.url);signal.throwIfAborted();add(page.url,page.text,officialRegulator(page.url)?'official_page':'third_party',null,page.publishedAt,true);
   const links=officialRegulator(page.url)?[]:namedProductLinks(page.body,page.url,{title:entry.title,text:page.text});
   if(links.length)site=publicURL(links[0].url);
   else if(!officialRegulator(page.url))errors.push('Сайт провайдера не установлен: внешние ссылки не совпали с названной компанией.');
  }catch(error){if(signal.aborted)throw error;errors.push('Полная публикация недоступна; сохранён фрагмент поисковой выдачи.');}
 }

 if(site&&isExcluded({url:site.href,developerWebsite:site.href}))return{documents:[],originalDocuments:docs,errors:[],blocked:true,productURL:site.href};
 if(site){
  const root=forbidden.test(site.pathname)?site.origin+'/':site.href;
  onStage('Читаем сайт сервиса');
  try{
   const page=await pages.page(root);signal.throwIfAborted();add(page.url,page.text,'official_page',page.body,page.publishedAt);
   const sufficient=assessBanking(docs,validateCriteria()).evidence.euIban.length>0;
   const links=(mode==='economy'&&sufficient?[]:evidenceLinks(page.body,page.url)).filter(url=>!isExcluded({url}));
   const pagesFound=await Promise.allSettled(links.map(link=>pages.page(link)));signal.throwIfAborted();
   for(const item of pagesFound)if(item.status==='fulfilled'){const linked=item.value;add(linked.url,linked.text,'official_page',linked.body);}else errors.push('Одна из страниц сайта недоступна.');
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
 return [...documents].sort((a,b)=>documentScore(b)-documentScore(a)).slice(0,3).map(d=>{
  const parts=String(d.text).split(/\n+|(?<=[.!?;])\s+/u).map((text,i)=>({text,i,score:(/IBAN|SEPA|electronic money|CASP|MiCA|authori[sz]|лиценз/iu.test(text)?5:0)+(/business|corporate|compan|сч[её]т|бизнес/iu.test(text)?4:0)+(/not|without|checker|validator|doesn.t|нет|не предостав/iu.test(text)?3:0)}));
  const chosen=[],budget=Math.min(2500,remaining);let used=0;for(const part of [...parts].sort((a,b)=>b.score-a.score||a.i-b.i)){if(used>=budget)break;const text=part.text.slice(0,budget-used);if(text){chosen.push({...part,text});used+=text.length+8;}}
  const text=chosen.sort((a,b)=>a.i-b.i).map(p=>p.text).join('\n[…]\n').slice(0,remaining);remaining-=text.length;return{...d,text};
 }).filter(d=>d.text);
}
export function validateAssessment(raw,documents){
 const facts={};let rejectedQuotes=0;
 const suggestions=directFactSuggestions(documents),reasons={},recovered=[];
 for(const name of['business','account','euIban','utility']){
  const supplied=raw?.[name],fact=(!supplied||supplied.status==='unknown')&&supplied?.status!=='no'&&suggestions[name]?(recovered.push(name),suggestions[name]):supplied;const evidence=[];
  for(const item of Array.isArray(fact?.evidence)?fact.evidence.slice(0,5):[]){
   const doc=documents.find(d=>d.id===item.sourceId),quote=normalize(item.quote);
   if(name==='utility'&&fact?.status==='yes'&&!utilityQuoteSupported(quote)){rejectedQuotes++;reasons.utility='Цитата описывает функции банка / сервиса и не доказывает, что это утилита.';continue;}
   if(!doc||quote.length<8||quote.length>1600||!normalize(doc.text).includes(quote)){rejectedQuotes++;continue;}
   evidence.push({quote,url:doc.url,kind:doc.kind,sourceId:doc.id});
  }
  facts[name]={status:['yes','no'].includes(fact?.status)&&evidence.length?fact.status:'unknown',evidence};
  if(facts[name].status==='unknown'&&!reasons[name])reasons[name]=evidence.length?'Недостаточно сведений для вывода.':'Нет подтверждённой дословной цитаты.';
 }
 for(const name of ['business','account','euIban'])if(facts[name].status==='yes'&&facts[name].evidence.every(e=>officialRegulator(e.url))){facts[name].status='unknown';reasons[name]='Решение регулятора не подтверждает условия бизнес-счёта на сайте продукта.';}
 if(facts.utility.status==='yes'&&documents.some(d=>d.kind==='listing'&&/play\.google\.com|apps\.apple\.com/.test(d.url))&&facts.utility.evidence.every(e=>/iban[-_/]?(?:calculator|generator|checker)|iban-hesaplama/i.test(e.url))){facts.utility.status='unknown';reasons.utility='Калькулятор на сайте не определяет тип основного приложения банка.';}
 if(facts.euIban.status==='yes'){
  const supported=facts.euIban.evidence.some(item=>businessIbanSupported(item,facts.business.evidence,facts.account.evidence,documents));
  if(!supported){facts.euIban.status='unknown';reasons.euIban='Цитата не связывает IBAN страны ЕС с бизнес-счётом этого продукта.';}
 }
 const extras=extraAssessment(raw,documents);
 const originalSummary=String(raw?.summaryRu??'').slice(0,1600),quality=assessmentQuality({facts,rejectedQuotes,summary:originalSummary,reasons});quality.recoveredFacts=recovered;
 return {facts,decision:verifiedDecision({facts,...extras}),...extras,rejectedQuotes,factReasons:reasons,quality,policyVersion:VALIDATION_POLICY_VERSION,summaryOriginal:originalSummary,summary:russianSummary(facts,recovered.length?'':originalSummary,quality),notice:'Вывод ИИ по указанным текстам. Это не проверка лицензии или гарантии открытия счёта.'};
}
export function createAIReview({store,provider,pages,index,clock=()=>new Date(),autoSchedule=false,isDiscoveryBusy=()=>false,tickInterval=30000,requestTimeoutMs,playSource}){
 const cachedPages=cachedPageProvider(pages);
 let execution=Promise.resolve(),starting=Promise.resolve(),controller=null,currentJob=null,timer,stopped=false,collector=null;
 const active=()=>busyJob(currentJob)?currentJob:store.state.ai.jobs.findLast(busyJob)??null;
 const usage=()=>(['ollama','llamacpp'].includes(store.state.ai.config.engine)?store.state.ai.localUsage:store.state.ai.config.engine==='gemini'?store.state.ai.geminiUsage:store.state.ai.usage)?.[day(clock()).slice(0,7)]??{attempts:0,inputTokens:0,outputTokens:0};
 const selectedProvider=()=>provider.forConfig?.(store.state.ai.config)??provider;
 const blocked=(entry,rules=effectiveExclusions(store.state))=>store.state.crm?.reviewCycle?.protectedIds?.includes(entry.id)||manuallyExcluded(entry,rules)||!entry.manualReviewRequest&&(pureCryptoWallet(entry)||Boolean(nonTargetMarketEvidence(entry,marketPolicy(store.state))))||store.state.crm?.records?.[entry.id]?.status==='rejected';
 const summary=(options={})=>{
  const selected=selectedProvider(),counts=options.counts!==false,candidates=counts?reviewCandidates(store.state,{...options,skipManualQueue:true}):null,dueOptions={...options,candidates};
  return{pausedAfterUpgrade:store.state.ai.pausedAfterUpgrade??false,lastEngine:store.state.ai.jobs.at(-1)?.engine??'openai',engine:store.state.ai.config.engine??'openai',openAIUsage:store.state.ai.usage[day(clock()).slice(0,7)]??{attempts:0,inputTokens:0,outputTokens:0},config:store.state.ai.config,configured:selected.configured(),model:selected.model,busy:Boolean(active()),activeJobId:active()?.id??null,latestJobId:store.state.ai.jobs.at(-1)?.id??null,lastSuccessAt:store.state.ai.lastSuccessAt,due:counts?dueReviews(store.state,selected.models??selected.model,clock(),dueOptions).length:null,lastRepair:store.state.ai.lastRepair??null,repairDue:counts?dueReviews(store.state,selected.models??selected.model,clock(),{...dueOptions,repairOnly:true}).length:null,usage:usage(),inboxOverflow:store.state.ai.inboxOverflow??0,version:AI_REVIEW_VERSION};
 };
 const visibleResults=()=>{const rules=effectiveExclusions(store.state),available=new Set(reviewCandidates(store.state,{rules}).map(r=>r.id));return store.state.ai.results.filter(r=>available.has(r.id)&&!blocked(r,rules)&&!r.autoExcluded).map(r=>({...r,isNew:store.state.ai.newIds?.includes(r.id)??false}));};
 async function startJob({ids,skipIds=[],mode,licencesOnly=false,repairOnly=false,reuseSaved=false,manualRecheck=false,manualAll=false}={}){
  if(ids!==undefined&&(!Array.isArray(ids)||ids.some(id=>typeof id!=='string')))throw Object.assign(new Error('Выберите записи для анализа.'),{status:400});
  if(stopped)throw Object.assign(new Error('Программа останавливается.'),{status:503});
  if(controller)throw Object.assign(new Error('Проверка ИИ уже идёт.'),{status:409});
  const chosenProvider=selectedProvider();
  if(!chosenProvider.configured())throw Object.assign(new Error(aiError({code:store.state.ai.config.engine==='gemini'?'GEMINI_KEY':'MISSING_KEY'}).message),{status:503});
  const config=reviewConfig({...store.state.ai.config,...(mode?{mode}:{})}),engine=config.engine??'openai',usageKey=['ollama','llamacpp'].includes(engine)?'localUsage':engine==='gemini'?'geminiUsage':'usage';
  if((manualRecheck||manualAll)&&(!ids?.length||!manualAll&&ids.some(id=>!store.state.crm.records[id]?.reviewCycleId&&!store.state.crm.records[id]?.manualStatusAt)))throw Object.assign(new Error('Выберите записи повторной ручной проверки.'),{status:400});
 const manual=manualRecheck||manualAll,lanes=(chosenProvider.workers??[{engine,provider:chosenProvider,concurrency:['ollama','llamacpp'].includes(engine)?chosenProvider.concurrency??1:config.cloudConcurrency}]).map(l=>({...l,disabled:false,failures:0}));
 const rules=effectiveExclusions(store.state),wanted=ids?new Set(ids):null,queue=(ids?reviewCandidates(store.state,{rules,allSources:licencesOnly||manual,includeExcluded:manual,includeSuppressed:manual}).filter(e=>wanted.has(e.id)):dueReviews(store.state,chosenProvider.models??chosenProvider.model,clock(),{rules,allSources:licencesOnly,licencesOnly,repairOnly})).map(e=>manual?{...e,manualReviewRequest:true}:e).filter(e=>!skipIds.includes(e.id)&&!blocked(e,rules)&&(manual||screenCandidate(e).eligible));
  const queuedIds=new Set(queue.map(e=>e.id));
  if(!queue.length)throw Object.assign(new Error('Новых находок для проверки нет. Уже проверенные тексты повторно не отправляются.'),{status:409});
  if(manual&&!reuseSaved)cachedPages.clearCache();
  controller=new AbortController();const currentController=controller,signal=controller.signal;
  const job={id:randomUUID(),scope:manualAll?'manual':manualRecheck?'manual_card':'new',reuseSaved,engine,mode:config.mode,status:'running',createdAt:clock().toISOString(),current:'',done:0,total:queue.length,candidateIds:queue.map(e=>e.id),candidateInputs:Object.fromEntries(queue.map(e=>[e.id,e.inputHash])),attempts:0,braveRequests:0,errors:[],results:[],skippedIds:[],remainingIds:queue.map(e=>e.id),workers:[]};currentJob=job;const completed=new Set(),skipped=new Set();const remaining=()=>job.candidateIds.filter(id=>!completed.has(id)&&!skipped.has(id));
  try{starting=store.update(d=>{d.ai.jobs.push(structuredClone(job));d.ai.jobs=d.ai.jobs.slice(-20);d.ai.lastRunAt=clock().toISOString();if(manualAll)d.ai.manualBatch={id:job.id,createdAt:job.createdAt,mode:config.mode,candidateIds:[...job.candidateIds],remainingIds:[...job.candidateIds]};});await starting;}catch(error){controller=null;currentJob=null;throw error;}
  const persist=()=>store.update(d=>{if(manualAll&&d.ai.manualBatch?.id===job.id)d.ai.manualBatch.remainingIds=[...job.remainingIds];const i=d.ai.jobs.findIndex(j=>j.id===job.id);d.ai.jobs[i]=structuredClone(job);});
  const onRequest=request=>{job.request=request;};
  const source=runProvider(cachedPages,signal,{onRequest});
  const research=index?runProvider(index,signal,{onRequest}):null;
  const listingSource=playSource?.app?runProvider(playSource,signal,{timeoutMs:15000,onRequest}):null;let listingFailures=0,listingPaused=false;
  const refreshListing=manualAll&&!reuseSaved&&listingSource?async entry=>{if(listingPaused)throw Error('Google Play listing refresh paused');try{const card=await listingSource.app({appId:entry.appId,country:(entry.detailCountry??entry.countries?.[0]??'DE').toLowerCase(),lang:'en'});if(!card?.title)throw Error('Incomplete listing');listingFailures=0;return{url:entry.url,text:card.title+'. '+plainText(card.description??card.summary??'')};}catch(error){if(signal.aborted)throw error;if((error.status??error.response?.statusCode)===404)listingFailures=0;else if(++listingFailures>=3)listingPaused=true;throw error;}}:null;
  const limitedResearch=research?{...research,search:options=>{job.braveRequests++;return research.search(options);}}:null;
  execution=(async()=>{
   try{
    let cursor=0,halt=false;
    const slots=lanes.flatMap(lane=>Array.from({length:Math.min(lane.concurrency,queue.length)},(_,i)=>({lane,index:i})));
    await settleWorkers(slots.map(async({lane,index})=>{
    const {engine,provider:laneProvider}=lane,usageKey=['ollama','llamacpp'].includes(engine)?'localUsage':engine==='gemini'?'geminiUsage':'usage';
    const worker={engine,model:laneProvider.model,index,current:'',done:0,status:'running'};job.workers.push(worker);
    const streamedProvider={...laneProvider,assess:(input,options)=>laneProvider.assess(input,{...options,onProgress:progress=>{worker.progress={...progress,updatedAt:clock().toISOString()};job.progress=worker.progress;}})};
    const ai=runProvider(streamedProvider,signal,{timeoutMs:requestTimeoutMs??laneProvider.timeoutMs?.(config.mode)??120000,onRequest:request=>{worker.request=request;onRequest(request);}});
    try{while(!halt&&!lane.disabled){const entry=queue[cursor];if(!entry)break;cursor++;
     signal.throwIfAborted();if(blocked(entry)){job.done++;job.skippedIds.push(entry.id);skipped.add(entry.id);continue;}
     job.current=entry.title;worker.current=entry.title;job.progress=null;
     const previous=store.state.ai.results.find(r=>r.id===entry.id);
     const stored=repairOnly||reuseSaved?scopedDocuments(entry,[...entry.documents,...(previous?.sourceDocuments??[])]).map((d,i)=>({...d,id:'s'+(i+1)})):null;
     const evidence=stored?.length?{documents:reviewDocuments(stored,config.mode),originalDocuments:stored,errors:[],productURL:entry.developerWebsite}:await collectEvidence(entry,{pages:source,index:limitedResearch,signal,onStage:stage=>{job.stage=stage;},mode:config.mode,refreshListing,isExcluded:e=>manuallyExcluded(e,effectiveExclusions(store.state))});signal.throwIfAborted();
     if(evidence.blocked){await store.update(d=>{for(const rule of effectiveExclusions(d))if(manuallyExcluded({url:evidence.productURL},[rule])){const saved=d.manualExclusions.find(r=>r.key===rule.key);if(saved)saved.urls=[...new Set([...(saved.urls??[]),entry.url])];}});job.done++;continue;}
     if(blocked(entry)){job.done++;job.skippedIds.push(entry.id);skipped.add(entry.id);continue;}
     if(!evidence.documents.length){job.errors.push({title:entry.title,message:'Нет доступных текстов для ИИ. Находка сохранена, запрос ИИ не выполнен.'});job.done++;continue;}
     const month=day(clock()).slice(0,7);
     const preScreen=screenCandidate({...entry,documents:evidence.originalDocuments,...marketPolicy(store.state)}),preGeo=nigeriaEvidence({...entry,documents:evidence.originalDocuments}),skipAI=!entry.manualReviewRequest&&Boolean(preGeo||!preScreen.eligible);
     const localEvents=officialRegulator(entry.url)?extractLicenceEvents(evidence.originalDocuments):[];
     const allowed=localEvents.length||skipAI?true:await store.update(d=>{if(manuallyExcluded(entry,effectiveExclusions(d))||d.crm?.records?.[entry.id]?.status==='rejected')return false;d.ai[usageKey]??={};const u=d.ai[usageKey][month]??={attempts:0,inputTokens:0,outputTokens:0};u.attempts++;return true;});
     if(!allowed||blocked(entry)){job.done++;continue;}
     signal.throwIfAborted();if(!localEvents.length&&!skipAI)job.attempts++;job.stage=(['ollama','llamacpp'].includes(engine)?'Локальный GPU-агент':engine==='gemini'?'Gemini':'OpenAI')+' разбирает источники';
     let answer;
     try{answer=localEvents.length||skipAI?{assessment:{business:{status:'unknown',evidence:[]},account:{status:'unknown',evidence:[]},euIban:{status:'unknown',evidence:[]},utility:{status:'unknown',evidence:[]},summaryRu:skipAI?'До ИИ: '+(preGeo?'Нигерийская юрисдикция провайдера.':preScreen.reason):'Из официального источника извлечено решение о разрешении. Бизнес-счёт и EU IBAN проверяются на сайте провайдера.',licences:[]},model:laneProvider.model,usage:{inputTokens:0,outputTokens:0},method:skipAI?'pre_ai_screen':'registry_event'}:await ai.assess({title:entry.title,documents:evidence.documents,translateRu:config.translateRu,mode:config.mode});}
     catch(error){if(signal.aborted)throw error;if(['ollama','llamacpp'].includes(engine)&&error.code!=='PERSISTENCE_ERROR'&&!error.code?.startsWith('LOCAL_'))error=Object.assign(new Error(error.message),{code:/timeout|timed out/i.test(error.message)?'LOCAL_TIMEOUT':'LOCAL_RESPONSE'});job.errors.push({title:entry.title,engine,...aiError(error)});job.done++;worker.done++;lane.failures++;if(lane.failures>=3){lane.disabled=true;worker.status='failed';worker.error='Три сбоя ИИ подряд; обработчик приостановлен, очередь сохранена.';job.errors.push({code:'AI_LANE_PAUSED',engine,message:worker.error});break;}if(['ollama','llamacpp'].includes(engine)||['AI_AUTH','AI_QUOTA','GEMINI_AUTH','GEMINI_QUOTA'].includes(aiError(error).code)){lane.disabled=true;worker.status='failed';worker.error=aiError(error).message;break;}continue;}
     lane.failures=0;
     const licences=[...validateLicences(answer.assessment,evidence.documents)];for(const l of extractLicenceEvents(evidence.originalDocuments))if(!licences.some(x=>x.organisation===l.organisation&&x.type===l.type&&x.url===l.url))licences.push(l);
     let providerSites=[];
     if(licences.length&&!entry.regulatoryLead&&licenceLead(entry)){
      const research=await researchLicenceSites(licences.filter(l=>l.status==='authorised'||l.status==='registered'&&l.type!=='vasp'),{pages:source,index:limitedResearch,signal,isExcluded:blocked,onStage:stage=>{job.stage=stage;}});providerSites=research.websites.map(({text,licence,...site})=>site);evidence.errors.push(...research.errors);
      if(research.websites.length){
       await store.update(d=>{const rows=research.websites.map(site=>inboxEntry({title:site.organisation,url:site.url,developerWebsite:site.url,screeningText:site.text,source:'registers',signalType:'licensed_provider',regulatoryLead:true,publishedAt:site.publishedAt,evidenceDocuments:[{url:site.licence.url,text:site.licence.quote,kind:'official_page'}]},'social',clock()));storeInbox(d,rows);});
       const domains=new Set(research.websites.map(s=>new URL(s.url).hostname.replace(/^www\./,''))),added=dueReviews(store.state,chosenProvider.models??chosenProvider.model,clock(),{allSources:licencesOnly}).filter(e=>e.id.startsWith('company:')&&domains.has(e.id.slice(8))&&!queuedIds.has(e.id));
       for(const e of added){queuedIds.add(e.id);job.candidateIds.push(e.id);job.candidateInputs[e.id]=e.inputHash;}queue.splice(cursor,0,...added);job.total+=added.length;
       if(added.length)await store.update(d=>{const ids=added.filter(e=>!e.reference).map(e=>e.id);d.ai.newIds=[...new Set([...d.ai.newIds,...ids])];});
      }
     }
     signal.throwIfAborted();const assessment={...validateAssessment(answer.assessment,evidence.documents),webPresence:assessWebPresence(evidence.documents,{productURL:evidence.productURL??entry.developerWebsite??(entry.id.startsWith('company:')?'https://'+entry.id.slice(8):null)})};
     assessment.serviceName=supportedServiceName(assessment.serviceName,entry,evidence.originalDocuments);
     const postScreen=screenCandidate({...entry,documents:evidence.originalDocuments,...marketPolicy(store.state)});
     const result={id:entry.id,targetId:entry.targetId,section:entry.section,appId:entry.appId,title:entry.title,url:entry.url,developerWebsite:entry.developerWebsite??evidence.productURL,earlySignal:entry.earlySignal||['waitlist','planned'].includes(assessment.availability.status),reference:entry.reference??referenceByName(assessment.serviceName)?.name??null,targets:entry.targets,sources:entry.sources,inputHash:entry.inputHash,version:AI_REVIEW_VERSION,analysisMethod:answer.method??'ai',reviewScope:job.scope,engine,mode:config.mode,sourceDocuments:evidence.originalDocuments,publishedAt:entry.publishedAt??entry.dateReported??evidence.originalDocuments.find(d=>d.url===entry.url)?.publishedAt??null,model:answer.model,metrics:answer.metrics,...assessment,repairRequired:!preGeo&&assessment.quality.status==='needs_review'&&postScreen.eligible,licences,providerSites,delivery:deliveryEvidence(evidence.originalDocuments),autoExcluded:nigeriaEvidence({documents:evidence.originalDocuments})?'Nigeria':!postScreen.eligible?postScreen.kind:null,translations:validatedTranslations(answer.assessment,evidence.documents,config.mode),sourceErrors:[...evidence.errors,...(config.translateRu&&validatedTranslations(answer.assessment,evidence.documents,config.mode).length<evidence.documents.length?['Перевод части текстов не получен; оригиналы сохранены в CRM.']:[])],checkedAt:clock().toISOString(),usage:answer.usage};
     await store.update(d=>{d.ai[usageKey]??={};const u=d.ai[usageKey][month]??={attempts:0,inputTokens:0,outputTokens:0};u.inputTokens+=answer.usage.inputTokens;u.outputTokens+=answer.usage.outputTokens;d.ai.lastSuccessAt=clock().toISOString();const rules=effectiveExclusions(d);if(manuallyExcluded(entry,rules)||manuallyExcluded(result,rules)||d.crm?.records?.[entry.id]?.status==='rejected')return;if(result.autoExcluded)d.ai.newIds=d.ai.newIds.filter(id=>id!==result.id);d.ai.reviewCache??={};d.ai.reviewCache[reviewCacheKey(result.id,result.inputHash,result.model)]=structuredClone(result);const i=d.ai.results.findIndex(r=>r.id===result.id);if(i>=0)d.ai.results[i]=result;else d.ai.results.push(result);if(manualAll&&d.ai.manualBatch?.id===job.id)d.ai.manualBatch.remainingIds=d.ai.manualBatch.remainingIds.filter(id=>id!==result.id);if(result.reference)d.ai.newIds=d.ai.newIds.filter(id=>id!==result.id);});
     job.done++;worker.done++;job.results.push(result.id);completed.add(result.id);job.remainingIds=remaining();if(job.done%10===0)await persist();
    }}finally{worker.current='';if(worker.status==='running')worker.status=signal.aborted?'cancelled':'complete';}
    }),()=>{halt=true;});
    job.status=job.errors.length?job.results.length?'partial':'failed':'complete';
   }catch(error){if(signal.aborted)job.status='cancelled';else{job.status='failed';job.errors.push(aiError(error));}}
   finally{job.remainingIds=remaining();job.current='';job.stage='';job.request=null;job.finishedAt=clock().toISOString();try{await persist();}finally{if(controller===currentController)controller=null;}}
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

export function validatedTranslations(raw,documents,mode='full'){return documents.flatMap(doc=>{const t=raw?.translations?.find(t=>t.sourceId===doc.id&&typeof t.translationRu==='string'&&t.translationRu.trim()&&/[А-Яа-яЁё]/u.test(t.translationRu)&&!/[\u3400-\u9fff]/u.test(t.translationRu));return t?[{sourceId:doc.id,url:doc.url,kind:doc.kind,scope:mode==='economy'?'evidence':'document',original:doc.text,translationRu:t.translationRu.slice(0,50000)}]:[];});}

function candidateScore(e){const text=e.documents?.map(d=>d.text).join(' ')??e.screeningText??'';return (e.sources?.some(s=>['play','apple'].includes(s))?12:0)+(/\bIBAN\b/i.test(text)?3:0)+(/business account|corporate account/i.test(text)?3:0)+(/waitlist|launches|now available|licensed/i.test(text)?2:0)-(/future of|how to choose|best.*accounts|comparison/i.test(e.title)?5:0);}
