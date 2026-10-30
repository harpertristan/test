import {Worker} from 'node:worker_threads';
// Heavy projections run away from the HTTP event loop. Reuse one snapshot for
// concurrent polling/detail/export reads; never cache across a saved mutation.
export function createCRMReader(){
 let worker=null,sequence=0,lastState=null,lastContext='',tail=Promise.resolve(),closed=false;const requests=new Map();
 function fail(error){for(const p of requests.values())p.reject(error);requests.clear();lastState=null;}
 function start(){
  if(worker)return;const current=new Worker(new URL('./crm-reader-worker.js',import.meta.url),{execArgv:[]});worker=current;current.unref();
  current.on('message',m=>{const pending=requests.get(m.id);if(!pending)return;requests.delete(m.id);m.error?pending.reject(new Error(m.error)):pending.resolve(m.value);if(!requests.size)current.unref();});
  current.on('error',error=>{if(worker===current){worker=null;fail(error);}});
  current.on('exit',()=>{if(worker===current){worker=null;lastState=null;if(!closed)fail(new Error('Не удалось подготовить список CRM. Обновите страницу.'));}});
 }
 return{read(state,context={},task={kind:'snapshot'}){
  const operation=tail.then(()=>{if(closed)throw Error('Программа останавливается.');start();const signature=JSON.stringify(context),includeState=state!==lastState||signature!==lastContext,id=++sequence;
   return new Promise((resolve,reject)=>{requests.set(id,{resolve,reject});worker.ref();try{worker.postMessage({id,...(includeState?{state,context}:{}),task});lastState=state;lastContext=signature;}catch(error){requests.delete(id);if(!requests.size)worker.unref();reject(error);}});
  });tail=operation.catch(()=>{});return operation;
 },async stop(){closed=true;fail(new Error('Программа останавливается.'));await worker?.terminate();worker=null;}};
}
