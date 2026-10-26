import https from 'node:https';
import {HttpsProxyAgent} from 'https-proxy-agent';
import {playRequestGate} from './provider.js';
import {validateCriteria,excluded,assessBanking,plainText,developerURL,EU_IBAN_CODES} from './qualification.js';
import {assessDiscovery} from './discovery.js';
import {pause} from './run-context.js';
export const APPLE_CATEGORIES=[{id:'6015',name:'Финансы'},{id:'6000',name:'Бизнес'},{id:'6007',name:'Продуктивность'},{id:'6002',name:'Утилиты'}];
export const APPLE_QUERIES=['business account','business banking','IBAN','multicurrency account','crypto bank','stablecoin business account','SEPA account','corporate account'];
export function validateAppleConfig(input={}){
 const queries=input.queries??APPLE_QUERIES,countries=input.countries??EU_IBAN_CODES,categories=input.categories??APPLE_CATEGORIES.map(c=>c.id),requestBudget=0,limit=input.limit??200;
 if(!Array.isArray(queries)||!queries.length||queries.length>40||queries.some(q=>typeof q!=='string'||!q.trim()||q.length>100))throw new Error('App Store: от 1 до 40 поисковых фраз.');
 const eu=['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE'];
 if(!Array.isArray(countries)||!countries.length||countries.some(c=>!eu.includes(c)))throw new Error('App Store: выберите страны ЕС.');
 if(!Array.isArray(categories)||!categories.length||categories.some(c=>!APPLE_CATEGORIES.some(a=>a.id===c)))throw new Error('Проверьте категории App Store.');
 if(!Number.isInteger(limit)||limit<1||limit>200)throw new Error('App Store: 1–2000 запросов; глубина 1–200 приложений.');
 return {...validateCriteria({profile:'business',strictBanking:false,...input}),queries:[...new Set(queries.map(q=>q.trim()))],countries:[...new Set(countries)],categories:[...new Set(categories)],requestBudget,limit};
}
export function applePlan(config,now=new Date()){
 const all=config.countries.flatMap(country=>config.queries.map(term=>({country,term})));
 const budget=all.length,start=(Math.floor((+now+7200000)/86400000)*budget)%all.length;
 return {requests:Array.from({length:budget},(_,i)=>all[(start+i)%all.length]),total:all.length,cycleDays:Math.ceil(all.length/budget)};
}
export function appleProvider({request=appleRequest,intervalMs=3100}={}){
 const gate=playRequestGate(intervalMs);
 return {async search({term,country,limit=100},{signal}={}){await gate(signal);const url=new URL('https://itunes.apple.com/search');for(const [k,v]of Object.entries({term,country:country.toLowerCase(),entity:'software',media:'software',limit,lang:'en_us'}))url.searchParams.set(k,v);const data=await request(url,{signal});if(!Array.isArray(data.results))throw new Error('Invalid Apple response');return data.results;}};
}
function appleRequest(url,{signal}){
 const proxy=process.env.HTTPS_PROXY||process.env.https_proxy,agent=proxy?new HttpsProxyAgent(proxy):undefined;
 return new Promise((resolve,reject)=>{let timer,settled=false;const done=(e,value)=>{if(settled)return;settled=true;clearTimeout(timer);agent?.destroy();e?reject(e):resolve(value);};const req=https.get(url,{agent,signal,headers:{Accept:'application/json','User-Agent':'PlayScout/3'}},res=>{if(res.statusCode!==200){res.resume();done(Object.assign(new Error('Apple Search access failed'),{status:res.statusCode}));return;}let size=0;const chunks=[];res.on('data',b=>{size+=b.length;if(size>8*1024*1024)req.destroy(new Error('Apple response too large'));else chunks.push(b);});res.on('error',e=>done(e));res.on('aborted',()=>done(new Error('Interrupted Apple response')));res.on('end',()=>{try{done(null,JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{done(new Error('Invalid Apple JSON'));}});});timer=setTimeout(()=>req.destroy(new Error('Apple timeout')),20000);req.on('error',e=>done(e));});
}
export function createAppleJob(id,config,now=new Date()){return {id,config,status:'running',phase:'search',createdAt:now.toISOString(),finishedAt:null,current:'',searchDone:0,searchTotal:0,successfulSearches:0,scanned:0,results:[],existingResults:[],errors:[],skipped:{category:0,paid:0,banking:0,excludedNigeria:0,excludedTerm:0,excludedDomain:0,excludedId:0,previouslySeen:0,duplicate:0}};}
export async function runAppleSearch(job,provider,{signal,clock=()=>new Date(),delay=0,onRawCandidate=async()=>{},onMatch=async e=>e}={}){
 const plan=applePlan(job.config,clock()),seen=new Set();job.searchTotal=plan.requests.length;job.rotationTotal=plan.total;job.rotationDays=plan.cycleDays;
 try{for(const {country,term}of plan.requests){signal?.throwIfAborted();if(job.status!=='running')break;job.current=`${country} · ${term}`;
  let rows;try{rows=await provider.search({term,country,limit:job.config.limit});if(!Array.isArray(rows))throw new Error('Invalid Apple results');job.successfulSearches++;}catch(e){if(signal?.aborted)throw e;job.errors.push({code:e.status===403?'APPLE_ACCESS_DENIED':'APPLE_SOURCE',message:e.status===403?'Apple отклонил запрос (403). Проверьте доступ к itunes.apple.com из этой сети.':'App Store не ответил или ограничил доступ.',country,term});job.searchDone++;if([403,429].includes(e.status)||job.errors.length>=3)break;continue;}
  for(const app of rows){job.scanned++;if(!Number.isSafeInteger(app.trackId))continue;const id=`apple:${app.trackId}`;if(seen.has(id)){job.skipped.duplicate++;continue;}seen.add(id);
   const entry={id,appId:id,source:'apple',title:plainText(app.trackName),developer:plainText(app.sellerName??app.artistName),developerWebsite:developerURL(app.sellerUrl)?.href??null,screeningText:plainText(app.description).slice(0,30000),url:`https://apps.apple.com/${country.toLowerCase()}/app/id${app.trackId}`,released:typeof app.releaseDate==='string'?app.releaseDate.slice(0,10):null,updatedAt:app.currentVersionReleaseDate??null,genreId:String(app.primaryGenreId??''),genres:app.genres??[],countries:[country],checkedAt:clock().toISOString(),store:'apple'};
   let reason=excluded({text:`${entry.title} ${entry.developer} ${entry.screeningText}`,url:entry.developerWebsite,appId:id},job.config);
   reason??=!job.config.categories.some(c=>(app.genreIds??[]).map(String).includes(c)||String(app.primaryGenreId)===c)?'category':app.price!==0?'paid':null;
   const docs=[{title:entry.title,text:entry.screeningText,url:entry.url,label:'Описание Apple App Store'}];entry.qualification=assessBanking(docs,job.config);entry.discovery=assessDiscovery(docs,job.config,entry.qualification,id);reason??=entry.discovery.status==='not_relevant'?'banking':null;
   await onRawCandidate({...entry,preliminaryReason:reason});
   if(reason){job.skipped[reason]=(job.skipped[reason]??0)+1;continue;}const saved=await onMatch(entry);if(saved)job.results.push(saved);else job.skipped.previouslySeen++;
  }
  job.searchDone++;if(delay)await pause(delay,signal);
 }if(job.status==='running')job.status=!job.successfulSearches?'failed':job.errors.length?'partial':'complete';
 }catch(e){if(signal?.aborted||job.status==='cancelling')job.status='cancelled';else{job.status='failed';job.errors.push({code:'APPLE_SOURCE',message:'Не удалось завершить поиск Apple.'});}}
 job.finishedAt=clock().toISOString();job.current='';
}
export function initialAppleState(now=new Date()){return {schedule:{enabled:true,time:'09:10',timeZone:'Europe/Kaliningrad',filters:validateAppleConfig(),nextRunAt:new Date(`${now.toISOString().slice(0,10)}T09:10:00+02:00`).toISOString(),lastRunAt:null,lastStatus:null},findings:[],jobs:[]};}
export const appleCSV=job=>'\uFEFF'+[['Приложение','Ссылка','Первый выпуск'],...job.results.map(e=>[e.title,e.url,e.released])].map(row=>row.map(v=>'"'+String(v??'').replace(/^[\s]*[=+@-]/,"'$&").replaceAll('"','""')+'"').join(',')).join('\r\n');
