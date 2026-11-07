// Task-scoped read-only Unix HTTP sidecar. No general proxy, URL input or shell.
import http from "node:http";
import fs from "node:fs";
import {resolveReadOperation} from "./three_tool_read_policy.mjs";
const SOCKET="/run/three-tools/read.sock";
const CONTROL="/run/task-control/control.sock";
const GATEWAY="multi-mail-crm-tool-gateway-1";
const LIMIT=16384;
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
    const req=http.get({hostname:GATEWAY,port:3200,path,timeout:8000,headers:{accept:"application/json"}},r=>{
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
    const op=resolveReadOperation(payload.operation,payload.params);
    const task=await postUnix(CONTROL,"/current",{capability:payload.capability});
    if(task.status!==200)return reply(403,{code:"TASK_NOT_AUTHORIZED"});
    const current=JSON.parse(task.body);
    if(!current||!["in_progress"].includes(current.status))
      return reply(403,{code:"TASK_NOT_IN_PROGRESS"});
    const result=await upstream(PATH_PREFIX[op.service]+op.path);
    if(result.status!==200||!result.contentType.toLowerCase().includes("application/json"))
      return reply(502,{code:"UPSTREAM_UNAVAILABLE"});
    let data;
    try{data=JSON.parse(result.body);}catch{return reply(502,{code:"INVALID_UPSTREAM_RESPONSE"});}
    return reply(200,{operation:payload.operation,data});
  }catch(e){return reply(400,{code:"READ_REFUSED"});}
});
server.requestTimeout=10000;
server.headersTimeout=5000;
fs.mkdirSync("/run/three-tools",{recursive:true});
try{fs.unlinkSync(SOCKET);}catch(e){if(e.code!=="ENOENT")throw e;}
server.listen(SOCKET,()=>{fs.chmodSync(SOCKET,0o600);console.log("Three-tool read sidecar ready");});
