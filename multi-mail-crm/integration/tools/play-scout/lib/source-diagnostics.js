import {randomUUID} from 'node:crypto';
import {SEARCH_CHANNELS,sourceConnection} from './source-workspace-catalog.js';
import {SOCIAL_SOURCES,sourceRestriction} from './source-catalog.js';
import {publicURL} from './qualification.js';
import {abortable} from './run-context.js';
export const loginWall=text=>/log in to (?:facebook|linkedin)|sign in to (?:facebook|linkedin)|join linkedin|you must log in|войдите (?:в|на) (?:facebook|linkedin)|войти в facebook/iu.test(text??'');
const safeFailure=error=>{const status=error.status??error.response?.statusCode;return status===401||status===403?{code:'ACCESS_DENIED',message:'Доступ отклонён. Это не подтверждает работоспособность источника.'}:status===429?{code:'RATE_LIMIT',message:'Достигнут лимит запросов. Автоматического повтора нет.'}:['ENOTFOUND','EAI_AGAIN','ECONNREFUSED','ETIMEDOUT'].includes(error.code)?{code:error.code,message:'Не удалось подключиться к источнику: '+error.code+'.'}:{code:'SOURCE_UNAVAILABLE',message:'Источник не ответил или не отдал читаемую публичную страницу.'};};
export async function probeSource(channel,{store,index,pages,play,apify,signal}){
 const base={id:channel.id,mode:sourceConnection(channel).mode,searchRequests:0,matched:0};
 if(channel.kind==='apify'){if(!apify?.configured(channel.connector))return{...base,status:'not_configured',message:'Настройте ключ и сохранённую задачу: npm run configure:social-api.'};try{return{...base,...await apify.probe(channel.connector,{signal})};}catch(error){signal.throwIfAborted();return{...base,status:'failed',code:error.code??'APIFY_CONFIG',message:String(error.code??'').startsWith('APIFY_')?error.message:'Проверка Apify не завершена.'};}}
 const read=async url=>{try{const page=await abortable(()=>pages.page(url,{signal}),signal);signal.throwIfAborted();if(loginWall(page.text))return{access:'login_required',message:'Найден экран входа. Доступен только поисковый фрагмент, полный текст не прочитан.'};if(String(page.text??'').length<80)return{access:'unreadable',message:'Недостаточно читаемого текста.'};return{access:'readable',message:'Публичный текст прочитан.',sampleURL:page.url};}catch(error){signal.throwIfAborted();return{access:'unavailable',...safeFailure(error)};}};
 if(channel.kind==='play'){try{await abortable(()=>play.app({appId:'com.transferwise.android',country:'de',lang:'en'},{signal}),signal);return{...base,status:'ok',access:'readable',message:'Контрольная карточка Google Play прочитана. Это не проверка полноты поиска.'};}catch(error){signal.throwIfAborted();return{...base,status:'failed',...safeFailure(error)};}}
 if(channel.kind==='watch'){const config=store.state.watch.schedule.filters,url=[...(config.watchUrls??[]),...(config.feedUrls??[])].find(u=>publicURL(u));if(!url)return{...base,status:'not_configured',message:'Добавьте страницу или RSS в настройках наблюдения.'};const access=await read(url);return{...base,...access,status:access.access==='readable'?'ok':'limited'};}
 if(!index.configured())return{...base,status:'not_configured',code:'MISSING_KEY',message:'Для поиска нужен ключ Brave. Аккаунт соцсети его не заменяет.'};
 const source=SOCIAL_SOURCES.find(s=>s.id===channel.source),domains=channel.focusDomain?[channel.focusDomain]:source?.domains??[];
 const restriction=channel.kind==='web'?'':sourceRestriction(channel.source,{focusDomain:channel.focusDomain});
 try{
  base.searchRequests=1;const results=await abortable(()=>index.search({q:`${restriction} ("business account" OR "IBAN")`,count:3,search_lang:'en'},{signal}),signal);signal.throwIfAborted();
  const matches=results.filter(r=>{const u=publicURL(r.url);return u&&(!domains.length||domains.some(d=>u.hostname===d||u.hostname.endsWith('.'+d)));});base.matched=matches.length;
  if(!matches.length)return{...base,status:'no_results',message:'Brave ответил, но контрольный запрос не нашёл страниц этого источника. Доступ к контенту не подтверждён.'};
  const access=await read(matches[0].url);return{...base,...access,status:access.access==='readable'?'ok':'limited',message:`В индексе найдено: ${matches.length}. ${access.message}`};
 }catch(error){signal.throwIfAborted();return{...base,status:'failed',...safeFailure(error)};}
}
export function createSourceDiagnostics({store,index,pages,play,apify,clock=()=>new Date(),timeoutMs=25000}){
 let current=null,controller=null,execution=Promise.resolve(),stopped=false;
 const summary=()=>({busy:Boolean(controller),job:current??(store.state.sourceWorkspace?.diagnosticJob?{...store.state.sourceWorkspace.diagnosticJob,status:['running','queued'].includes(store.state.sourceWorkspace.diagnosticJob.status)?'interrupted':store.state.sourceWorkspace.diagnosticJob.status}:null),results:store.state.sourceWorkspace?.diagnostics??{}});
 const persist=()=>store.update(d=>{d.sourceWorkspace??={settings:{},runs:[]};d.sourceWorkspace.diagnosticJob=structuredClone(current);});
 return{summary,idle:()=>execution,
  async start({ids}={}){
   if(stopped)throw Object.assign(new Error('Программа останавливается.'),{status:503});if(controller)throw Object.assign(new Error('Проверка источников уже идёт.'),{status:409});
   if(!Array.isArray(ids)||!ids.length||ids.length>SEARCH_CHANNELS.length||ids.some(id=>!SEARCH_CHANNELS.some(c=>c.id===id)))throw new Error('Выберите источники для проверки.');
   const selected=[...new Set(ids)],control=new AbortController();controller=control;current={id:randomUUID(),status:'running',done:0,total:selected.length,ids:selected,current:null,createdAt:clock().toISOString(),results:[]};
   try{await persist();}catch(error){controller=null;current.status='failed';throw error;}
   execution=(async()=>{try{for(const id of selected){control.signal.throwIfAborted();current.current=id;
    const signal=AbortSignal.any([control.signal,AbortSignal.timeout(timeoutMs)]),channel=SEARCH_CHANNELS.find(c=>c.id===id);let result;
    try{result=await probeSource(channel,{store,index,pages,play,apify,signal});}catch(error){control.signal.throwIfAborted();result={id,status:'failed',code:'TIMEOUT',message:'Проверка не завершилась за отведённое время; повтора нет.'};}
    result.checkedAt=clock().toISOString();current.results.push(result);current.done++;
    await store.update(d=>{d.sourceWorkspace.diagnostics??={};d.sourceWorkspace.diagnostics[id]=result;d.sourceWorkspace.diagnosticJob=structuredClone(current);});
   }current.status='complete';}catch(error){current.status=control.signal.aborted?'cancelled':'failed';}finally{current.current=null;current.finishedAt=clock().toISOString();try{await persist();}finally{controller=null;}}})();execution.catch(()=>{});return structuredClone(current);
  },
  async cancel(){controller?.abort();await execution;return summary();},
  async stop(){stopped=true;controller?.abort();await execution;},
 };
}
