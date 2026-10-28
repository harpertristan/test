import {localEndpoints} from './ai-config.js';
import {LOCAL_REVIEW_SCHEMA,LOCAL_REVIEW_INSTRUCTIONS,localEvidence,expandLocalAssessment} from './local-analysis.js';
import {REVIEW_SCHEMA,REVIEW_INSTRUCTIONS} from './openai-provider.js';
const failure=(code,message)=>Object.assign(new Error(message),{code});
export function llamaCppProvider({endpoints=['http://127.0.0.1:8081'],model='play-scout-local',request=serverRequest}={}){
 endpoints=localEndpoints(endpoints);let cursor=0;const available=[...endpoints],leased=new Set();
 return {engine:'llamacpp',label:'llama.cpp · GPU',model:'llamacpp:'+model,concurrency:endpoints.length,configured:()=>Boolean(model&&endpoints.length),timeoutMs:mode=>mode==='full'?300000:180000,
 async status({signal}={}){const workers=await Promise.all(endpoints.map(async endpoint=>{try{const r=await request(endpoint,'/v1/models',null,{signal});const models=(r.data??[]).map(m=>m.id);return{endpoint,ok:true,models,installed:models.includes(model)};}catch{return{endpoint,ok:false,models:[],installed:false};}}));return{ok:workers.every(w=>w.ok&&w.installed),installed:workers.every(w=>w.installed),models:[...new Set(workers.flatMap(w=>w.models))],selected:model,workers};},
 async assess({title,documents,translateRu=true,mode='economy'},{signal,onProgress=()=>{}}={}){
  if(signal?.aborted)throw signal.reason;
  const endpoint=endpoints.slice(cursor).concat(endpoints.slice(0,cursor)).find(e=>available.includes(e)&&!leased.has(e));
  if(!endpoint)throw failure('LOCAL_POOL','Нет свободного GPU-обработчика.');leased.add(endpoint);cursor=(endpoints.indexOf(endpoint)+1)%endpoints.length;
  const compact=mode!=='full',packet=compact?localEvidence(documents):null;
  const body={model,stream:true,stream_options:{include_usage:true},temperature:0,max_tokens:compact?1000:6000,response_format:{type:'json_schema',json_schema:{name:'business_iban_review',strict:true,schema:compact?LOCAL_REVIEW_SCHEMA:REVIEW_SCHEMA}},messages:[{role:'system',content:compact?LOCAL_REVIEW_INSTRUCTIONS:REVIEW_INSTRUCTIONS},{role:'user',content:JSON.stringify({title,mode,translateRu,documents:compact?packet.documents:documents.map(d=>({sourceId:d.id,url:d.url,type:d.kind,text:d.text}))})}]};
  try{onProgress({phase:'loading',outputChars:0,worker:endpoints.indexOf(endpoint)+1});const started=Date.now(),data=await request(endpoint,'/v1/chat/completions',body,{signal,onProgress,timeoutMs:compact?180000:300000});
   if(data.finishReason!=='stop')throw failure(data.finishReason==='length'?'LOCAL_LENGTH':'LOCAL_RESPONSE','Неполный ответ локального ИИ.');
   let assessment;try{assessment=JSON.parse(data.content);}catch{throw failure('LOCAL_RESPONSE','Локальный ИИ вернул некорректный JSON.');}
   if(compact)assessment=expandLocalAssessment(assessment,packet.passages);
   return{assessment,model:'llamacpp:'+model,engine:'llamacpp',metrics:{worker:endpoints.indexOf(endpoint)+1,totalMs:Date.now()-started,generationMs:data.generationMs??0,tokensPerSecond:data.tokensPerSecond??null},usage:{inputTokens:data.usage?.prompt_tokens??0,outputTokens:data.usage?.completion_tokens??0}};
  }finally{leased.delete(endpoint);}
 }
 };
}
// The application sends only to explicitly configured endpoints; public page
// contents can never choose a destination. Abort closes the response stream.
export async function serverRequest(endpoint,path,body,{signal,timeoutMs=180000,idleTimeoutMs=45000,onProgress=()=>{}}={}){
 const controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
 const total=setTimeout(()=>controller.abort(failure('LOCAL_TIMEOUT','Локальный ИИ не ответил вовремя.')),timeoutMs);let idle,reader;
 try{
  const response=await fetch(endpoint+path,{method:body?'POST':'GET',signal:combined,redirect:'error',headers:{'Content-Type':'application/json',...(process.env.LOCAL_AI_API_KEY?{Authorization:'Bearer '+process.env.LOCAL_AI_API_KEY}:{})},body:body?JSON.stringify(body):undefined});
  if(!response.ok)throw failure(response.status===404?'LOCAL_MODEL':'LOCAL_ACCESS','Локальный GPU-сервер недоступен или не загрузил модель.');
  if(!body){const text=await response.text();if(text.length>2*1024*1024)throw failure('LOCAL_RESPONSE','Слишком большой ответ сервера.');return JSON.parse(text);}
  reader=response.body.getReader();const decoder=new TextDecoder();let buffer='',content='',finishReason=null,usage={},bytes=0,done=false,timings;
  const consume=line=>{if(!line.startsWith('data:'))return;const data=line.slice(5).trim();if(data==='[DONE]'){done=true;return;}if(!data)return;let item;try{item=JSON.parse(data);}catch{throw failure('LOCAL_RESPONSE','Некорректный поток локального ИИ.');}if(item.error)throw failure('LOCAL_RESPONSE','Ошибка GPU-обработчика.');content+=item.choices?.[0]?.delta?.content??'';finishReason=item.choices?.[0]?.finish_reason??finishReason;usage=item.usage??usage;timings=item.timings??timings;onProgress({phase:'generating',outputChars:content.length,done});};
  while(true){clearTimeout(idle);idle=setTimeout(()=>controller.abort(failure('LOCAL_TIMEOUT','GPU-сервер перестал передавать данные.')),idleTimeoutMs);const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>2*1024*1024)throw failure('LOCAL_RESPONSE','Слишком большой ответ локального ИИ.');buffer+=decoder.decode(part.value,{stream:true});let end;while((end=buffer.indexOf('\n'))>=0){consume(buffer.slice(0,end).replace(/\r$/,''));buffer=buffer.slice(end+1);}}
  buffer+=decoder.decode();consume(buffer);if(!done||!finishReason)throw failure('LOCAL_RESPONSE','Поток ИИ оборван до завершения.');return{content,finishReason,usage,generationMs:timings?.predicted_ms,tokensPerSecond:timings?.predicted_per_second};
 }catch(e){if(combined.aborted)throw combined.reason;throw e.code?.startsWith('LOCAL_')?e:failure('LOCAL_OFFLINE','Не удалось подключиться к локальному GPU-серверу.');}
 finally{clearTimeout(total);clearTimeout(idle);await reader?.cancel().catch(()=>{});}
}
