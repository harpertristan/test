import http from 'node:http';
import {abortable} from './run-context.js';
import {REVIEW_SCHEMA,REVIEW_INSTRUCTIONS} from './openai-provider.js';
export function ollamaProvider({model='qwen2.5:3b',request=localRequest}={}){
 const valid=typeof model==='string'&&/^[a-zA-Z0-9_.:/-]{1,100}$/.test(model);
 return {engine:'ollama',label:'Ollama · локально',configured:()=>valid,model:'ollama:'+model,
  forModel:next=>ollamaProvider({model:next,request}),
  async status({signal}={}){const result=await request('/api/tags',null,{signal});return{ok:true,models:(result.models??[]).map(m=>m.name),selected:model,installed:(result.models??[]).some(m=>m.name===model)};},
  async assess({title,documents,translateRu=true,mode='economy'},{signal}={}){
   if(!valid)throw Object.assign(new Error('Invalid Ollama model'),{code:'LOCAL_MODEL'});
   const body={model,stream:false,format:REVIEW_SCHEMA,messages:[{role:'system',content:REVIEW_INSTRUCTIONS},{role:'user',content:JSON.stringify({title,mode,translateRu,documents:documents.map(d=>({sourceId:d.id,url:d.url,type:d.kind,text:d.text}))})}],options:{temperature:0,num_ctx:mode==='full'?16384:8192,num_predict:mode==='full'?8000:3200},keep_alive:'10m'};
   const result=await abortable(()=>request('/api/chat',body,{signal}),signal);let assessment;try{assessment=JSON.parse(result.message?.content);}catch{throw Object.assign(new Error('Ollama JSON response incomplete'),{code:'LOCAL_RESPONSE'});}
   return{assessment,model:'ollama:'+model,engine:'ollama',usage:{inputTokens:Number(result.prompt_eval_count)||0,outputTokens:Number(result.eval_count)||0}};
  }
 };
}
export function localRequest(path,body,{signal,port=11434}={}){return new Promise((resolve,reject)=>{
 const req=http.request(`http://127.0.0.1:${port}`+path,{method:body?'POST':'GET',signal,headers:{'Content-Type':'application/json'}},res=>{
  if(res.statusCode!==200){res.resume();reject(Object.assign(new Error('Ollama model or server unavailable'),{code:res.statusCode===404?'LOCAL_MODEL':'LOCAL_ACCESS'}));return;}
  const chunks=[];let bytes=0;res.on('data',b=>{bytes+=b.length;if(bytes>2*1024*1024)req.destroy(new Error('Local AI response too large'));else chunks.push(b);});res.on('error',reject);res.on('aborted',()=>reject(new Error('Local AI response interrupted')));res.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(Object.assign(new Error('Invalid Ollama response'),{code:'LOCAL_RESPONSE'}));}});
 });req.setTimeout(115000,()=>req.destroy(Object.assign(new Error('Ollama timeout'),{code:'LOCAL_TIMEOUT'})));req.on('error',error=>reject(Object.assign(error,{code:error.code==='ECONNREFUSED'?'LOCAL_OFFLINE':error.code})));req.end(body?JSON.stringify(body):undefined);
});}
export function reviewRouter({store,openai,ollama=ollamaProvider()}){const selected=config=>config.engine==='ollama'?(ollama.forModel?.(config.ollamaModel)??ollama):openai;return{forConfig:selected,get model(){return selected(store.state.ai.config).model;},get engine(){return store.state.ai.config.engine??'openai';},configured:()=>selected(store.state.ai.config).configured()};}
