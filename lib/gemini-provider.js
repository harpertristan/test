import https from 'node:https';
import {HttpsProxyAgent} from 'https-proxy-agent';
import {abortable} from './run-context.js';
import {REVIEW_SCHEMA,REVIEW_INSTRUCTIONS} from './openai-provider.js';
export function geminiProvider({key=process.env.GEMINI_API_KEY,model=process.env.GEMINI_MODEL||'gemini-2.5-flash-lite',request=geminiRequest}={}){
 return {engine:'gemini',model:'gemini:'+model,label:'Google Gemini API',configured:()=>Boolean(key),forModel:next=>geminiProvider({key,model:next,request}),
  async assess({title,documents,translateRu=true,mode='economy'},{signal}={}){
   if(!key)throw Object.assign(new Error('Missing Gemini key'),{code:'GEMINI_KEY'});
   if(!/^gemini-[a-zA-Z0-9._-]{1,90}$/.test(model))throw Object.assign(new Error('Invalid Gemini model'),{code:'GEMINI_MODEL'});
   const body={systemInstruction:{parts:[{text:REVIEW_INSTRUCTIONS}]},contents:[{role:'user',parts:[{text:JSON.stringify({title,mode,translateRu,documents:documents.map(d=>({sourceId:d.id,url:d.url,type:d.kind,text:d.text}))})}]}],generationConfig:{temperature:0,maxOutputTokens:mode==='full'?16000:4000,responseMimeType:'application/json',responseJsonSchema:REVIEW_SCHEMA,...(/^gemini-2\.5-flash/.test(model)?{thinkingConfig:{thinkingBudget:0}}:{})}};
   const data=await abortable(()=>request(body,{key,model,signal}),signal),candidate=data.candidates?.[0];
   if(candidate?.finishReason!=='STOP')throw Object.assign(new Error('Incomplete Gemini response'),{code:'GEMINI_RESPONSE'});
   let assessment;try{assessment=JSON.parse((candidate.content?.parts??[]).map(p=>p.text??'').join(''));}catch{throw Object.assign(new Error('Invalid Gemini JSON'),{code:'GEMINI_RESPONSE'});}
   return {assessment,engine:'gemini',model:'gemini:'+model,usage:{inputTokens:Number(data.usageMetadata?.promptTokenCount)||0,outputTokens:Number(data.usageMetadata?.candidatesTokenCount)||0}};
  }
 };
}
function geminiRequest(body,{key,model,signal}){
 const proxy=process.env.HTTPS_PROXY||process.env.https_proxy,agent=proxy?new HttpsProxyAgent(proxy):undefined;
 return new Promise((resolve,reject)=>{
  let timer,settled=false;const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);agent?.destroy();error?reject(error):resolve(value);};
  const req=https.request(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{method:'POST',signal,agent,headers:{'Content-Type':'application/json','x-goog-api-key':key}},res=>{
   if(res.statusCode!==200){res.resume();finish(Object.assign(new Error('Gemini access failed'),{code:res.statusCode===429?'GEMINI_QUOTA':res.statusCode===401||res.statusCode===403?'GEMINI_AUTH':'GEMINI_RESPONSE'}));return;}
   const chunks=[];let bytes=0;res.on('data',b=>{bytes+=b.length;if(bytes>2*1024*1024)req.destroy(new Error('Gemini response too large'));else chunks.push(b);});res.on('error',e=>finish(e));res.on('aborted',()=>finish(new Error('Gemini response interrupted')));res.on('end',()=>{try{finish(null,JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{finish(Object.assign(new Error('Gemini response invalid'),{code:'GEMINI_RESPONSE'}));}});
  });timer=setTimeout(()=>req.destroy(Object.assign(new Error('Gemini timeout'),{code:'GEMINI_TIMEOUT'})),115000);req.on('error',e=>finish(e));req.end(JSON.stringify(body));
 });
}
