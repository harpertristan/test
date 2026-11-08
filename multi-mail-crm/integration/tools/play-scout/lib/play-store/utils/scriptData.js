// Parse Play's embedded data as literals. Website code is never evaluated.
import JSON5 from 'json5';
import * as R from 'ramda';

const invalid=()=>Object.assign(new Error('Google Play returned unsupported embedded data'),{code:'PLAY_DATA_INVALID'});
const MAX_LENGTH=8*1024*1024,MAX_DEPTH=128,MAX_NODES=200000;
const forbidden=new Set(['__proto__','prototype','constructor']);

// Bound nesting before handing a literal to the parser, including quoted braces,
// escaped quotes and comments. Expressions, calls and getters are not literals.
function literalEnd(source,start){
 const stack=[];let quote=null,comment=null;
 for(let i=start;i<source.length;i++){
  const c=source[i],next=source[i+1];
  if(comment==='line'){if(c==='\n'||c==='\r')comment=null;continue;}
  if(comment==='block'){if(c==='*'&&next==='/'){comment=null;i++;}continue;}
  if(quote){if(c==='\\'){i++;continue;}if(c===quote)quote=null;continue;}
  if(c==='"'||c==="'"){quote=c;continue;}
  if(c==='/'&&next==='/'){comment='line';i++;continue;}
  if(c==='/'&&next==='*'){comment='block';i++;continue;}
  if(c==='{'||c==='['){stack.push(c);if(stack.length>MAX_DEPTH)throw invalid();}
  else if(c==='}'||c===']'){
   if(stack.pop()!==(c==='}'?'{':'['))throw invalid();
   if(!stack.length)return i+1;
  }
 }
 throw invalid();
}
function literal(source,start){
 if(source[start]!=='{')throw invalid();
 const end=literalEnd(source,start);let value;
 try{value=JSON5.parse(source.slice(start,end));}catch{throw invalid();}
 const todo=[value];let nodes=0;
 while(todo.length){
  if(++nodes>MAX_NODES)throw invalid();
  const item=todo.pop();
  if(typeof item==='number'&&!Number.isFinite(item))throw invalid();
  if(item&&typeof item==='object')for(const key of Object.keys(item)){
   if(forbidden.has(key))throw invalid();todo.push(item[key]);
  }
 }
 return{value,end};
}
function scripts(response){
 if(typeof response!=='string'||response.length>MAX_LENGTH)throw invalid();
 return [...response.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)].map(m=>m[1]);
}
function serviceRequests(blocks){
 for(const body of blocks){
  const match=/(?:^|;)\s*(?:var|let|const)\s+AF_dataServiceRequests\s*=\s*/.exec(body);
  if(!match)continue;
  const {value,end}=literal(body,match.index+match[0].length);
  if(!/^\s*;/.test(body.slice(end)))throw invalid();
  if(!value||typeof value!=='object'||Array.isArray(value))throw invalid();
  for(const [key,item] of Object.entries(value))if(!/^ds:\d+$/.test(key)||!item||typeof item!=='object'||Array.isArray(item))throw invalid();
  return value;
 }
 return{};
}
export function parseServiceRequests(response){return serviceRequests(scripts(response));}
export function parse(response){
 const blocks=scripts(response),data={};
 for(const body of blocks){
  const match=/^\s*AF_initDataCallback\s*\(\s*/.exec(body);if(!match)continue;
  const {value,end}=literal(body,match[0].length);
  if(!/^\s*\)\s*;?\s*$/.test(body.slice(end))||!/^ds:\d+$/.test(value.key??'')||!Object.hasOwn(value,'data'))throw invalid();
  data[value.key]=value.data;
 }
 return{...data,serviceRequestData:serviceRequests(blocks)};
}

// The field mappings are maintained in source, never supplied by a website.
export function extractDataWithServiceRequestId(parsedData,spec){
 const key=Object.keys(parsedData.serviceRequestData??{}).find(k=>parsedData.serviceRequestData[k].id===spec.useServiceRequestId);
 return R.path(key?[key,...spec.path]:spec.path,parsedData);
}
export function extractor(mappings){return parsedData=>R.map(spec=>{
 if(Array.isArray(spec))return R.path(spec,parsedData);
 let input=spec.useServiceRequestId?extractDataWithServiceRequestId(parsedData,spec):R.path(spec.path,parsedData);
 if(input==null&&spec.fallbackPath)input=R.path(spec.fallbackPath,parsedData);
 return spec.fun(input,parsedData);
},mappings);}
export default{parse,parseServiceRequests,extractor,extractDataWithServiceRequestId};
