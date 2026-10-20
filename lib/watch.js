import{pause}from'./run-context.js';
import {createHash} from 'node:crypto';
import {publicURL,validateCriteria,excluded,assessBanking} from './qualification.js';
import {assessDiscovery,parsePlayId} from './discovery.js';
import {feedItems} from './page-provider.js';
export const DEFAULT_WATCH_URLS=['https://lurrapay.com/','https://www.rampy.money/','https://stable.com/','https://www.photonpay.com/uk'];
export function validateWatchConfig(input={}){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Некорректные настройки наблюдения.');
  const urls=(key,fallback)=>{const list=input[key]??fallback;if(!Array.isArray(list)||list.length>20||list.some(x=>typeof x!=='string'||x.length>500||!publicURL(x)))throw new Error('До 20 публичных HTTPS-ссылок в каждом списке.');return [...new Set(list.map(x=>{const u=publicURL(x);u.searchParams.sort();return u.href;}))];};
  const watchApps=input.watchApps??['com.stablecom.app','com.kleos.baas'];
  if(!Array.isArray(watchApps)||watchApps.length>30||watchApps.some(id=>!parsePlayId(id)))throw new Error('До 30 ID или ссылок Google Play.');
  const autoWatchFindings=input.autoWatchFindings??true;
  const autoWatchSites=input.autoWatchSites??true;
  if(typeof autoWatchSites!=='boolean')throw new Error('Проверьте наблюдение за сайтами находок.');
  if(typeof autoWatchFindings!=='boolean')throw new Error('Проверьте автоматическое наблюдение за находками.');
  const country=input.country??'DE';if(typeof country!=='string'||!/^[A-Z]{2}$/.test(country))throw new Error('Страна Google Play: код из двух букв.');
  return {...validateCriteria({profile:'business',strictBanking:false,institutionType:'bank_or_emi',...input}),watchUrls:urls('watchUrls',DEFAULT_WATCH_URLS),feedUrls:urls('feedUrls',[]),watchApps:[...new Set(watchApps.map(parsePlayId))],autoWatchFindings,autoWatchSites,country};
}
export const watchFilters=validateWatchConfig;
export function initialWatchState(now=new Date()){
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Kaliningrad',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  return {schedule:{enabled:true,time:'09:30',timeZone:'Europe/Kaliningrad',nextRunAt:new Date(`${today}T09:30:00+02:00`).toISOString(),lastRunAt:null,lastStatus:null,filters:validateWatchConfig()},findings:[],jobs:[],snapshots:{}};
}
const hash=value=>createHash('sha256').update(value).digest('hex');
export function relevantText(text){return String(text).split(/\n+|(?<=[.!?])\s+/).map(s=>s.replace(/\s+/g,' ').trim()).filter(s=>/\bIBAN\b|\bSEPA\b|\b(?:business|corporate|company|multicurrency|fiat|accounts?|pricing|tariffs?|fees?|onboarding|waitlist)\b|бизнес|сч[её]т|тариф|geschäftskonto/iu.test(s)).slice(0,80).join('\n').slice(0,30000);}
export function watchPlan(config,knownApps=[],now=new Date()){
  const ids=[...new Set(knownApps.map(a=>a.appId).filter(id=>id&&!config.watchApps.includes(id)&&!config.excludeAppIds.includes(id)))].sort();
  const room=Math.max(0,30-config.watchApps.length),day=Math.floor((+now+7200000)/86400000),start=ids.length?(day*room)%ids.length:0;
  const extra=config.autoWatchFindings?Array.from({length:Math.min(room,ids.length)},(_,i)=>ids[(start+i)%ids.length]):[];
  const siteCandidates=[...new Set(knownApps.map(a=>publicURL(a.developerWebsite)?.href).filter(url=>url&&!config.watchUrls.includes(url)))].sort();
  const siteRoom=Math.max(0,20-config.watchUrls.length),siteStart=siteCandidates.length?(day*siteRoom)%siteCandidates.length:0;
  const siteExtra=config.autoWatchSites?Array.from({length:Math.min(siteRoom,siteCandidates.length)},(_,i)=>siteCandidates[(siteStart+i)%siteCandidates.length]):[];
  return [...[...config.watchUrls,...siteExtra].map(url=>({kind:'page',url,key:`page:${hash(url)}`})),...config.feedUrls.map(url=>({kind:'feed',url,key:`feed:${hash(url)}`})),...[...config.watchApps,...extra].filter(appId=>!config.excludeAppIds.includes(appId)).map(appId=>({kind:'app',appId,key:`app:${appId}:${config.country}`}))].filter(target=>!target.url||!excluded({url:target.url},config));
}
export function createWatchJob(id,config){return {id,config,status:'running',phase:'watch',createdAt:new Date().toISOString(),finishedAt:null,current:'',searchDone:0,searchTotal:0,successfulSearches:0,scanned:0,results:[],errors:[],skipped:{baseline:0,unchanged:0,irrelevant:0,excluded:0,previouslySeen:0},sourceStatus:[]};}
export function watchError(error){return {code:error.code==='PERSISTENCE_ERROR'?'PERSISTENCE_ERROR':'WATCH_SOURCE',message:error.code==='PERSISTENCE_ERROR'?'Не удалось сохранить наблюдение. Проверьте папку data.':'Страница, лента или карточка недоступна; предыдущие успешные данные не изменены. Проверьте ссылку и доступность публичного содержимого.'};}
export async function runWatch(job,provider,{signal,clock=()=>new Date(),delay=1000,isSeen=()=>false,onMatch=async entry=>entry,readSnapshot=()=>null,saveSnapshot=async()=>{},knownApps=[]}={}){
 const active=()=>job.status==='running';const config=job.config,plan=watchPlan(config,knownApps,clock());job.searchTotal=plan.length;
 const emit=async entry=>{if(!active())return;if(isSeen(entry.id)){job.skipped.previouslySeen++;return;}const saved=await onMatch(entry);if(saved)job.results.push(saved);else job.skipped.previouslySeen++;};
 try{for(const target of plan){if(!active())break;job.current=target.url??target.appId;
  try{
   const checkedAt=clock().toISOString();let title,url,text,metadata={};
   if(target.kind==='app'){const app=await provider.app({appId:target.appId,country:config.country.toLowerCase(),lang:'en'});if(!app?.title||!app.genreId)throw new Error('Invalid card');title=app.title;url=`https://play.google.com/store/apps/details?id=${encodeURIComponent(target.appId)}&gl=${config.country}`;text=app.description??app.summary??'';metadata={appId:target.appId,developer:app.developer,developerWebsite:publicURL(app.developerWebsite)?.href??null,version:app.version??null,updatedAt:Number.isFinite(app.updated)?new Date(app.updated).toISOString():null};
   }else{const page=await provider.page(target.url);title=page.title;url=page.url;text=page.text;
    if(target.kind==='feed'){
     if(!page.xml||!/<(?:rss|feed)\b/i.test(page.body))throw new Error('Not a feed');
     for(const item of feedItems(page.body)){if(!active())break;job.scanned++;const content=`${item.title}. ${item.description}`;if(excluded({text:content,url:item.url},config)){job.skipped.excluded++;continue;}const docs=[{text:content,url:item.url,label:'Публичная RSS/Atom-лента'}],qualification=assessBanking(docs,config),discovery=assessDiscovery(docs,config,qualification,item.url);
      if(discovery.status!=='service_match'){job.skipped.irrelevant++;continue;}
      await emit({id:`feed:${hash(item.url)}`,title:item.title,snippet:item.description.slice(0,3000),url:item.url,feedUrl:target.url,signalType:'rss_item',trust:'source_claim',qualification,discovery,mentionedRegions:[],dateReported:Number.isFinite(Date.parse(item.date))?new Date(item.date).toISOString():null,checkedAt,reason:'Новая для наблюдения запись ленты. Дата и условия продукта требуют проверки.'});
     }
     job.successfulSearches++;job.sourceStatus.push({target:target.url,status:'ok',kind:'feed'});job.searchDone++;if(active())await pause(delay,signal);continue;
    }
   }
   if(!active())break;job.scanned++;
   if(excluded({text:`${title} ${text}`,appId:target.appId,url,domains:metadata.developerWebsite?[metadata.developerWebsite]:[]},config)){job.skipped.excluded++;job.searchDone++;continue;}
   const relevant=relevantText(text),docs=[{title,text:`${title}. ${text}`,url,label:target.kind==='app'?'Описание Google Play при наблюдении':'Публичная страница продукта'}],qualification=assessBanking(docs,config),discovery=assessDiscovery(docs,config,qualification,target.appId??url);
   const snapshot={key:target.key,title,url,text:relevant,hash:hash(relevant),metadata,discovery,checkedAt};const previous=readSnapshot(target.key);
   if(!previous)job.skipped.baseline++;
   else if(previous.hash===snapshot.hash && previous.metadata?.version===metadata.version && previous.metadata?.updatedAt===metadata.updatedAt)job.skipped.unchanged++;
   else if(!relevant&&!previous.text || discovery.status==='not_relevant'&&previous.discovery?.status==='not_relevant')job.skipped.irrelevant++;
   else{
    const beforeLines=new Set(previous.text.split('\n')),afterLines=new Set(relevant.split('\n'));
    const added=[...afterLines].filter(line=>!beforeLines.has(line)).slice(0,8),removed=[...beforeLines].filter(line=>!afterLines.has(line)).slice(0,8);
    await emit({id:`change:${hash(`${target.key}|${previous.hash}|${snapshot.hash}|${metadata.version}|${metadata.updatedAt}`)}`,title:`${target.kind==='app'?'Изменение приложения':'Изменение страницы'}: ${title}`,url,snippet:(added.length?added:removed).join('\n').slice(0,3000),...metadata,qualification,discovery,signalType:target.kind==='app'?'app_change':'page_change',trust:'source_claim',previousCheckedAt:previous.checkedAt,checkedAt,mentionedRegions:[],dateReported:null,added,removed,previousVersion:previous.metadata?.version??null,reason:previous.hash===snapshot.hash?'Обновились версия или дата приложения; новые условия счёта не подтверждены.':'Изменился текст о счетах или финансовых условиях. Это не подтверждение запуска нового банка.'});
   }
   if(active())await saveSnapshot(target.key,snapshot);
   job.successfulSearches++;job.sourceStatus.push({target:target.url??target.appId,status:'ok',kind:target.kind});
  }catch(error){if(signal?.aborted)throw error;if(error.code==='PERSISTENCE_ERROR')throw error;job.errors.push({...watchError(error),target:target.url??target.appId});job.sourceStatus.push({target:target.url??target.appId,status:'error',kind:target.kind});}
  job.searchDone++;if(active())await pause(delay,signal);
 }
 if(active())job.status=job.errors.length?(job.successfulSearches?'partial':'failed'):'complete';
 }catch(error){if(!signal?.aborted)job.errors.push(watchError(error));if(active())job.status='failed';}
 job.finishedAt=clock().toISOString();job.current='';
}
export function watchCSV(job){const cell=v=>`"${String(v??'').replace(/^[\s]*[=+@-]/,"'$&").replaceAll('"','""')}"`;return '\ufeff'+[['Событие','Тип','Ссылка','Впервые найдено','Добавлено','Удалено','EU IBAN'],...job.results.map(e=>[e.title,e.signalType,e.url,e.firstFoundAt,e.added?.join(' | '),e.removed?.join(' | '),e.discovery?.euIban])].map(row=>row.map(cell).join(';')).join('\r\n')+'\r\n';}
