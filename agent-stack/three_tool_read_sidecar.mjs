// Task-scoped read-only Unix HTTP sidecar. No general proxy, URL input or shell.
import http from "node:http";
import fs from "node:fs";
import {resolveReadOperation} from "./three_tool_read_policy.mjs";
import {authorizeReadScope} from "./three_tool_read_scope.mjs";
const TEST=process.env.HERMES_TEST_MODE==="1";
const SOCKET=TEST?process.env.HERMES_TEST_SOCKET:"/run/three-tools/read.sock";
const CONTROL=TEST?process.env.HERMES_TEST_CONTROL:"/run/task-control/control.sock";
const SCOPE=TEST?process.env.HERMES_TEST_SCOPE:"/run/secrets/three-tool-scope.json";
const GATEWAY=TEST?process.env.HERMES_TEST_GATEWAY:"multi-mail-crm-tool-gateway-1";
const GATEWAY_PORT=TEST?Number(process.env.HERMES_TEST_PORT):3200;
const LIMIT=131072;
const PATH_PREFIX=Object.freeze({scout:"",assistant:"/assistant",mail:"/mail-crm"});
function postUnix(socketPath,path,body) {
  return new Promise((resolve,reject)=>{
    const data=Buffer.from(JSON.stringify(body));
    const req=http.request({socketPath,path,method:"POST",headers:{"content-type":"application/json","content-length":data.length},timeout:6000},r=>{
      let bytes=0;const parts=[];
      r.on("data",b=>{bytes+=b.length;if(bytes>LIMIT){r.destroy(new Error("Response too large"));return;}parts.push(b);});
      r.on("end",()=>resolve({status:r.statusCode,body:Buffer.concat(parts).toString("utf8")}));
      r.on("error",reject);
    });
    req.on("timeout",()=>req.destroy(new Error("Timeout")));
    req.on("error",reject);
    req.end(data);
  });
}
function upstream(path) {
  return new Promise((resolve,reject)=>{
    const req=http.get({hostname:GATEWAY,port:GATEWAY_PORT,path,timeout:8000,headers:{accept:"application/json"}},r=>{
      let bytes=0;const parts=[];
      r.on("data",b=>{bytes+=b.length;if(bytes>LIMIT){r.destroy(new Error("Response too large"));return;}parts.push(b);});
      r.on("end",()=>resolve({status:r.statusCode,contentType:r.headers["content-type"]||"",body:Buffer.concat(parts).toString("utf8")}));
      r.on("error",reject);
    });
    req.on("timeout",()=>req.destroy(new Error("Timeout")));
    req.on("error",reject);
  });
}
const server=http.createServer(async(req,res)=>{
  const reply=(status,data)=>{res.writeHead(status,{"content-type":"application/json","cache-control":"no-store"});res.end(JSON.stringify(data));};
  if(req.method==="GET"&&req.url==="/health")return reply(200,{ok:true});
  if(req.method!=="POST"||req.url!=="/read")return reply(404,{code:"NOT_FOUND"});
  try{
    let size=0;const parts=[];
    for await(const b of req){size+=b.length;if(size>4096)throw Error("Request too large");parts.push(b);}
    const payload=JSON.parse(Buffer.concat(parts).toString("utf8"));
    if(!payload||typeof payload!=="object"||Array.isArray(payload)||
       Object.keys(payload).sort().join(",")!=="capability,operation,params"||
       typeof payload.capability!=="string"||payload.capability.length>160||!payload.capability)
       return reply(400,{code:"INVALID_REQUEST"});
    let op;
    try {op=resolveReadOperation(payload.operation,payload.params);}
    catch {return reply(400,{code:"UNKNOWN_OR_INVALID_READ_OPERATION"});}
    const task=await postUnix(CONTROL,"/current",{capability:payload.capability});
    if(task.status!==200){
      let code="TASK_NOT_AUTHORIZED";
      try {const val=JSON.parse(task.body);if(typeof val.code==="string"&&/^TASK_[A-Z_]+$/.test(val.code))code=val.code;}catch{}
      return reply(403,{code});
    }
    const current=JSON.parse(task.body);
    if(!current||!["in_progress"].includes(current.status))
      return reply(403,{code:"TASK_NOT_IN_PROGRESS"});
    const scope=JSON.parse(fs.readFileSync(SCOPE,"utf8"));
    try {authorizeReadScope(scope,current,payload.operation,payload.params);}
    catch{return reply(403,{code:"OPERATION_NOT_GRANTED"});}
    const result=await upstream(PATH_PREFIX[op.service]+op.path);
    if(result.status!==200||!result.contentType.toLowerCase().includes("application/json"))
      return reply(502,{code:"UPSTREAM_UNAVAILABLE"});
    let data;
    try{data=JSON.parse(result.body);}catch{return reply(502,{code:"INVALID_UPSTREAM_RESPONSE"});}
    return reply(200,{operation:payload.operation,data});
  }catch(e){
    // Do not mislabel network failures, overlarge responses or invalid upstream JSON
    // as permission denials. Never log mail bodies or capability values.
    const network=["ENOTFOUND","ECONNREFUSED","ETIMEDOUT","EAI_AGAIN"].includes(e?.code);
    if(network)return reply(502,{code:"UPSTREAM_CONNECTION_FAILED"});
    if(e?.message==="Response too large")return reply(502,{code:"UPSTREAM_RESPONSE_TOO_LARGE"});
    if(e?.message==="Timeout")return reply(504,{code:"UPSTREAM_TIMEOUT"});
    return reply(502,{code:"READ_GATEWAY_ERROR"});
  }
});
server.requestTimeout=10000;
server.headersTimeout=5000;
fs.mkdirSync(TEST?fs.realpathSync(process.env.HERMES_TEST_DIR):"/run/three-tools",{recursive:true});
try{fs.unlinkSync(SOCKET);}catch(e){if(e.code!=="ENOENT")throw e;}
server.listen(SOCKET,()=>{fs.chmodSync(SOCKET,0o600);console.log("Three-tool read sidecar ready");});
