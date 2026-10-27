import http from 'node:http';
import {StringDecoder} from 'node:string_decoder';
import {abortable} from './run-context.js';
import {REVIEW_SCHEMA,REVIEW_INSTRUCTIONS} from './openai-provider.js';
import {LOCAL_REVIEW_SCHEMA,LOCAL_REVIEW_INSTRUCTIONS,localEvidence,expandLocalAssessment} from './local-analysis.js';
export function ollamaProvider({model='qwen2.5:3b',request=localRequest}={}){
 const valid=typeof model==='string'&&/^[a-zA-Z0-9_.:/-]{1,100}$/.test(model);
 return {engine:'ollama',label:'Ollama · локально',configured:()=>valid,model:'ollama:'+model,
  timeoutMs:mode=>mode==='full'?300000:180000,
  forModel:next=>ollamaProvider({model:next,request}),
  async status({signal}={}){const result=await request('/api/tags',null,{signal});return{ok:true,models:(result.models??[]).map(m=>m.name),selected:model,installed:(result.models??[]).some(m=>m.name===model)};},
  async assess({title,documents,translateRu=true,mode='economy'},{signal,onProgress=()=>{}}={}){
   if(!valid)throw Object.assign(new Error('Invalid Ollama model'),{code:'LOCAL_MODEL'});
   const compact=mode!=='full',packet=compact?localEvidence(documents):null;
   const body={model,stream:true,format:compact?LOCAL_REVIEW_SCHEMA:REVIEW_SCHEMA,messages:[{role:'system',content:compact?LOCAL_REVIEW_INSTRUCTIONS:REVIEW_INSTRUCTIONS},{role:'user',content:JSON.stringify({title,mode,translateRu,documents:compact?packet.documents:documents.map(d=>({sourceId:d.id,url:d.url,type:d.kind,text:d.text}))})}],options:{temperature:0,num_ctx:compact?4096:16384,num_predict:compact?1200:8000},keep_alive:'10m',...(/^qwen3(?:[.:-]|$)/i.test(model)?{think:false}:{})};
   onProgress({phase:'loading',outputChars:0});
   const result=await abortable(()=>request('/api/chat',body,{signal,onProgress,timeoutMs:compact?180000:300000}),signal);let assessment;
   if(result.done_reason==='length')throw Object.assign(new Error('Ollama response exceeded generation budget'),{code:'LOCAL_LENGTH'});
   try{assessment=JSON.parse(result.message?.content);}catch{throw Object.assign(new Error('Ollama JSON response incomplete'),{code:'LOCAL_RESPONSE'});}
   if(compact)assessment=expandLocalAssessment(assessment,packet.passages);
   const evalMs=(Number(result.eval_duration)||0)/1e6;
   return{assessment,model:'ollama:'+model,engine:'ollama',metrics:{loadMs:(Number(result.load_duration)||0)/1e6,promptMs:(Number(result.prompt_eval_duration)||0)/1e6,generationMs:evalMs,tokensPerSecond:evalMs?Math.round((Number(result.eval_count)||0)*10000/evalMs)/10:null},usage:{inputTokens:Number(result.prompt_eval_count)||0,outputTokens:Number(result.eval_count)||0}};
  }
 };
}
export function localRequest(path,body,{signal,port=11434,timeoutMs=180000,idleTimeoutMs=45000,onProgress=()=>{}}={}){return new Promise((resolve,reject)=>{
 let settled=false,timer;
 const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);req.setTimeout(0);if(error){req.destroy();reject(error);}else resolve(value);};
 const req=http.request(`http://127.0.0.1:${port}`+path,{method:body?'POST':'GET',signal,headers:{'Content-Type':'application/json'}},res=>{
  if(res.statusCode!==200){res.resume();finish(Object.assign(new Error('Ollama model or server unavailable'),{code:res.statusCode===404?'LOCAL_MODEL':'LOCAL_ACCESS'}));return;}
  const streaming=Boolean(body?.stream),decoder=new StringDecoder('utf8');let buffer='',bytes=0,content='',thinkingChars=0,last={},done=false;
  const consume=line=>{if(!line.trim())return;const item=JSON.parse(line);if(item.error)throw Object.assign(new Error('Ollama generation failed'),{code:'LOCAL_RESPONSE'});last=item;content+=item.message?.content??'';thinkingChars+=(item.message?.thinking??'').length;done||=item.done===true;onProgress({phase:'generating',outputChars:content.length,thinkingChars,done});};
  res.on('data',b=>{try{bytes+=b.length;if(bytes>2*1024*1024)throw Object.assign(new Error('Local AI response too large'),{code:'LOCAL_RESPONSE'});if(streaming)req.setTimeout(idleTimeoutMs);buffer+=decoder.write(b);if(streaming){let end;while((end=buffer.indexOf('\n'))!==-1){consume(buffer.slice(0,end));buffer=buffer.slice(end+1);}}}catch(error){finish(Object.assign(error,{code:error.code??'LOCAL_RESPONSE'}));}});
  res.on('error',error=>finish(error));res.on('aborted',()=>finish(Object.assign(new Error('Local AI response interrupted'),{code:'LOCAL_RESPONSE'})));
  res.on('end',()=>{if(settled)return;try{buffer+=decoder.end();if(streaming){consume(buffer);if(!done&&last.done!==undefined)throw Error('Incomplete Ollama stream');finish(null,{...last,message:{role:'assistant',content}});}else finish(null,JSON.parse(buffer));}catch{finish(Object.assign(new Error('Invalid Ollama response'),{code:'LOCAL_RESPONSE'}));}});
 });
 timer=setTimeout(()=>finish(Object.assign(new Error('Ollama request timeout'),{code:'LOCAL_TIMEOUT'})),timeoutMs);
 req.setTimeout(timeoutMs,()=>finish(Object.assign(new Error('Ollama stopped producing output'),{code:'LOCAL_TIMEOUT'})));
 req.on('error',error=>finish(Object.assign(error,{code:error.code==='ECONNREFUSED'?'LOCAL_OFFLINE':error.code})));req.end(body?JSON.stringify(body):undefined);
});}
export function reviewRouter({store,openai,ollama=ollamaProvider(),gemini}){const selected=config=>config.engine==='ollama'?(ollama.forModel?.(config.ollamaModel)??ollama):config.engine==='gemini'?(gemini?.forModel?.(config.geminiModel)??gemini):openai;return{forConfig:selected,get model(){return selected(store.state.ai.config).model;},get engine(){return store.state.ai.config.engine??'openai';},configured:()=>selected(store.state.ai.config).configured()};}
