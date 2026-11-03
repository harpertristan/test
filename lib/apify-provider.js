import https from 'node:https';
import {HttpsProxyAgent} from 'https-proxy-agent';
import {pause,abortable} from './run-context.js';
import {publicURL} from './qualification.js';
import {canonicalName} from './identity-names.js';
const identifier=value=>typeof value==='string'&&/^[a-zA-Z0-9_~-]{3,120}$/.test(value);
const failure=(code,message)=>Object.assign(new Error(message),{code});
const data=value=>value?.data??value;
const secretFields=/^(?:cookies?|loginCookies?|sessionCookies?|li_at|c_user|xs|password|accessToken|authToken)$/i;
const itemLimit=kind=>kind==='facebook'?500:20;
function inputLimits(input,maxItems){
 let secret=false,fanout=false,limits=[];const walk=(value,depth=0)=>{if(depth>12||!value||typeof value!=='object')return;for(const [key,item]of Object.entries(value)){if(secretFields.test(key)&&item&&(!Array.isArray(item)||item.length))secret=true;if(Array.isArray(item)&&item.length>1&&/urls|profiles|companies|searches|queries|keywords|searchTerms/i.test(key))fanout=true;if(/^(?:resultsLimit|maxPosts|maxItems|maxResults|maxPostsPerProfile|maxPostsPerPage|limit)$/i.test(key)&&Number.isFinite(Number(item)))limits.push(Number(item));if(item&&typeof item==='object')walk(item,depth+1);}};walk(input);
 if(secret)throw failure('APIFY_LOGIN_INPUT','Задача использует логин или cookies. Выберите сборщик публичных данных без входа в соцсеть.');
 if(fanout)throw failure('APIFY_INPUT_LIMIT','Для первого теста оставьте в задаче один URL или один поисковый запрос. Лимит на каждый из многих профилей не ограничивает общий объём.');
 if(!limits.length||limits.some(n=>n<1||n>maxItems))throw failure('APIFY_INPUT_LIMIT',`Задайте в задаче Apify явный лимит от 1 до ${maxItems} результатов (например resultsLimit / maxPosts / maxItems).`);
}
const cleanURL=raw=>{const u=publicURL(raw);if(!u)return null;for(const key of [...u.searchParams.keys()])if(/token|secret|password|signature|^utm_|fbclid|gclid/i.test(key))u.searchParams.delete(key);u.hash='';return u.href;};
export function apifyEntries(items,connector){
 const entries=[];for(const item of items){if(!item||typeof item!=='object')continue;
  const adId=String(item.adArchiveID??item.adId??''),adURL=connector==='facebook'&&/^\d{5,40}$/.test(adId)?'https://www.facebook.com/ads/library/?id='+adId:null;
  const url=cleanURL(item.url??item.postUrl??item.post_url??item.linkedinUrl??item.facebookUrl??item.permalink??item.adSnapshotUrl??item.ad_snapshot_url??item.adLibraryUrl??item.adUrl??adURL);
  const text=[item.text??item.postText??item.message??item.content?.text??item.caption??item.adCreativeBody??item.snapshot?.body?.text,item.snapshot?.title,item.snapshot?.linkDescription,...Array.isArray(item.ad_creative_bodies)?item.ad_creative_bodies:[]].filter(v=>typeof v==='string').join('\n').trim();if(!url||!text)continue;
  const name=[item.pageName,item.snapshot?.pageName,item.authorName,item.author?.name,item.advertiser?.name,item.user?.name,item.companyName,item.company?.name,item.name].find(v=>typeof v==='string'&&v.trim())??'';
  const title=String(name||item.title||text.slice(0,140)).slice(0,300),website=cleanURL(item.website??item.landingPageUrl??item.destinationUrl??item.snapshot?.linkUrl),brand=canonicalName(name)?.replace(/[^a-z0-9]/gi,'');
  const own=website&&brand?.length>=3&&new URL(website).hostname.replace(/[^a-z0-9]/gi,'').includes(brand.toLowerCase())&&!/facebook\.com|linkedin\.com/i.test(new URL(website).hostname)?website:null;
  const stamp=item.publishedAt??item.createdAt??item.timestamp??item.date,date=typeof stamp==='number'?new Date(stamp<1e12?stamp*1000:stamp):new Date(stamp);
  entries.push({title,url,snippet:text.slice(0,18000),developerWebsite:own,advertiserName:name||null,sourceTransport:'apify',source:connector==='facebook'?'facebook':'linkedin',dateReported:Number.isFinite(+date)?date.toISOString():null});
 }return entries;
}
export function apifyProvider({token=process.env.APIFY_TOKEN,tasks={facebook:process.env.APIFY_FACEBOOK_TASK,linkedin:process.env.APIFY_LINKEDIN_TASK},request=apifyRequest,pollMs=2000,beforeRequest=async()=>{}}={}){
 const call=async(path,options={})=>{await beforeRequest();return abortable(()=>{options.onDispatch?.();return request(path,{...options,token});},options.signal);};
 const configured=kind=>Boolean(token&&identifier(tasks[kind]));
 const task=async(kind,signal)=>{if(!configured(kind))throw failure('APIFY_CONFIG','Введите ключ и ID сохранённой задачи: npm run configure:social-api.');const id=tasks[kind];await call('/v2/actor-tasks/'+id,{signal});const input=data(await call('/v2/actor-tasks/'+id+'/input',{signal}));inputLimits(input,itemLimit(kind));return id;};
 return{configured,status:()=>({facebook:configured('facebook'),linkedin:configured('linkedin'),mode:'saved_tasks',maxItems:500,maxItemsByConnector:{facebook:500,linkedin:20},timeoutSecs:120,requestedChargeLimitUsd:1}),
  async probe(kind,{signal}={}){await task(kind,signal);return{status:'ok',access:'task_ready',message:'Ключ и сохранённая задача доступны; лимит ввода проверен. При проверке доступа сбор не запускается.',searchRequests:0};},
  async collect(kind,{signal,onProgress=()=>{}}={}){
   const id=await task(kind,signal),maxItems=itemLimit(kind);let runId=null,finished=false;
   try{let run,dispatched=false;try{run=data(await call('/v2/actor-tasks/'+id+'/runs?timeout=120&maxItems='+maxItems+'&maxTotalChargeUsd=1',{method:'POST',body:{},signal,onDispatch:()=>dispatched=true}));}catch(error){if(!dispatched)throw error;if(String(error.code??'').startsWith('APIFY_'))throw error;throw failure('APIFY_START_UNCERTAIN','Ответ запуска Apify не получен. Запуск мог начаться; проверьте Runs в Apify перед повтором.');}
    if(!identifier(run?.id))throw failure('APIFY_RUN','Apify не вернул проверяемый ID запуска. Проверьте Runs в Apify перед повтором.');runId=run.id;const started=Date.now();
    for(;;){signal?.throwIfAborted();onProgress({runId,runURL:'https://console.apify.com/actors/runs/'+runId,status:run.status,spentUsd:typeof run.usageTotalUsd==='number'?run.usageTotalUsd:null});
     if(run.status==='SUCCEEDED'){finished=true;break;}if(['FAILED','ABORTED','TIMED-OUT'].includes(run.status)){finished=true;throw failure('APIFY_RUN_FAILED','Задача Apify завершилась со статусом '+run.status+'. Проверьте её журнал в Apify.');}
     if(Date.now()-started>125000)throw failure('APIFY_TIMEOUT','Пробный запуск превысил время; отправлена остановка.');await pause(pollMs,signal);run=data(await call('/v2/actor-runs/'+runId,{signal}));
    }
    if(!identifier(run.defaultDatasetId))throw failure('APIFY_DATASET','У запуска нет доступного набора результатов.');const raw=data(await call('/v2/datasets/'+run.defaultDatasetId+'/items?clean=true&format=json&limit='+maxItems,{signal}));if(!Array.isArray(raw))throw failure('APIFY_DATASET','Неподдерживаемый формат результатов Apify.');const entries=apifyEntries(raw.slice(0,maxItems),kind);
    if(raw.length&&!entries.length)throw failure('APIFY_SCHEMA','Задача вернула данные, но поля публикации не распознаны. Нужны URL и text / postText / message; проверьте выбранный сборщик.');return{entries,runId,runURL:'https://console.apify.com/actors/runs/'+runId,spentUsd:typeof run.usageTotalUsd==='number'?run.usageTotalUsd:null};
   }finally{if(runId&&!finished)try{await call('/v2/actor-runs/'+runId+'/abort?gracefully=true',{method:'POST',body:{},signal:AbortSignal.timeout(10000)});}catch{onProgress({runId,abortUnconfirmed:true,runURL:'https://console.apify.com/actors/runs/'+runId});}}
  }
 };
}
export function apifyRequest(path,{token,method='GET',body,signal}={}){
 if(!path.startsWith('/v2/')||/[\r\n]/.test(path))return Promise.reject(failure('APIFY_REQUEST','Некорректный запрос Apify.'));
 const payload=body===undefined?null:JSON.stringify(body),proxy=process.env.HTTPS_PROXY||process.env.https_proxy,agent=proxy?new HttpsProxyAgent(proxy):undefined;
 return new Promise((resolve,reject)=>{let settled=false,timer;const done=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);agent?.destroy();error?reject(error):resolve(value);};
  const req=https.request(new URL(path,'https://api.apify.com'),{method,agent,signal,headers:{Authorization:'Bearer '+token,Accept:'application/json',...(payload?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}:{})}},res=>{
   if(res.statusCode<200||res.statusCode>=300){res.resume();done(failure(res.statusCode===401||res.statusCode===403?'APIFY_AUTH':res.statusCode===402?'APIFY_CREDIT':res.statusCode===429?'APIFY_RATE':'APIFY_HTTP',res.statusCode===401||res.statusCode===403?'Apify отклонил ключ или доступ к задаче.':res.statusCode===402?'Apify сообщил о недостаточном балансе.':res.statusCode===429?'Apify ограничил частоту запросов. Автоматического повтора нет.':'Apify вернул ошибку HTTP '+res.statusCode+'.'));return;}
   const chunks=[];let size=0;res.on('data',chunk=>{size+=chunk.length;if(size>2*1024*1024)req.destroy(failure('APIFY_SIZE','Ответ Apify слишком большой.'));else chunks.push(chunk);});res.on('error',()=>done(failure('APIFY_NETWORK','Ответ Apify прерван.')));res.on('aborted',()=>done(failure('APIFY_NETWORK','Ответ Apify прерван.')));res.on('end',()=>{try{done(null,JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{done(failure('APIFY_JSON','Apify вернул некорректный JSON.'));}});
  });timer=setTimeout(()=>req.destroy(failure('APIFY_TIMEOUT','Apify не ответил за отведённое время.')),20000);req.on('error',error=>done(String(error.code??'').startsWith('APIFY_')?error:failure('APIFY_NETWORK','Не удалось подключиться к Apify.')));if(payload)req.write(payload);req.end();
 });
}
