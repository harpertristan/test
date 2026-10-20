import{setTimeout as sleep}from'node:timers/promises';
export const busyJob=job=>['running','cancelling'].includes(job?.status);
export function cancellationError(){return Object.assign(new Error('Search cancelled'),{name:'AbortError',code:'ABORT_ERR'});}
export function abortable(operation,signal){
 if(signal?.aborted)return Promise.reject(signal.reason??cancellationError());
 return new Promise((resolve,reject)=>{
  const aborted=()=>reject(signal.reason??cancellationError());signal?.addEventListener('abort',aborted,{once:true});
  Promise.resolve().then(()=>{signal?.throwIfAborted();return operation();}).then(resolve,reject).finally(()=>signal?.removeEventListener('abort',aborted));
 });
}
export const pause=(ms,signal)=>sleep(ms,undefined,{signal});
export function runProvider(provider,signal,{timeoutMs=30000,onRequest=()=>{}}={}){
 const scoped={...provider};
 for(const method of ['search','app','related','developer','page'])if(typeof provider[method]==='function')scoped[method]=async(...args)=>{
  signal.throwIfAborted();const deadline=new AbortController(),combined=AbortSignal.any([signal,deadline.signal]);
  const timer=setTimeout(()=>deadline.abort(Object.assign(new Error('Source request timeout'),{code:'API_TIMEOUT'})),timeoutMs);
  onRequest({kind:method,startedAt:new Date().toISOString(),timeoutMs});
  try{return await abortable(()=>provider[method](...args,{signal:combined}),combined);}
  finally{clearTimeout(timer);onRequest(null);}
 };
 if(provider.research)scoped.research=runProvider(provider.research,signal,{timeoutMs,onRequest:info=>onRequest(info?{...info,kind:'website_evidence'}:null)});
 return scoped;
}
