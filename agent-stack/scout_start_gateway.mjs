// Trusted, tightly scoped Scout search starter. Only Unix socket and fixed Scout endpoints.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import {authorizeScoutStart,validateStartRequest,scoutPayload} from "./scout_start_policy.mjs";

const SOCKET="/run/three-tools/start.sock";
const TASK="/run/task-control/control.sock";
const SCOPE="/run/secrets/three-tool-scope.json";
const STATE="/state";
const SCOUT="play-scout-app-1";
const MAX=8192;
function request(options,body,limit=MAX){
  return new Promise((resolve,reject)=>{
    const bytes=body===null?null:Buffer.from(JSON.stringify(body));
    const req=http.request({...options,headers:{
      ...(bytes?{"content-type":"application/json","content-length":bytes.length}:{accept:"application/json"})
    },timeout:9000},res=>{
      let size=0,parts=[];
      res.on("data",chunk=>{size+=chunk.length;if(size>limit){res.destroy(Error("UPSTREAM_LIMIT"));return;}parts.push(chunk)});
      res.on("error",reject);
      res.on("end",()=>resolve({status:res.statusCode,contentType:res.headers["content-type"]||"",text:Buffer.concat(parts).toString("utf8")}));
    });
    req.on("timeout",()=>req.destroy(Error("UPSTREAM_TIMEOUT")));
    req.on("error",reject);
    req.end(bytes||undefined);
  });
}
function parseJSON(r){
  if(!r.contentType.toLowerCase().includes("application/json"))throw Error("UPSTREAM_NOT_JSON");
  return JSON.parse(r.text);
}
const reply=(res,status,data)=>{
  res.writeHead(status,{"content-type":"application/json","cache-control":"no-store"});
  res.end(JSON.stringify(data));
};
fs.mkdirSync(STATE,{recursive:true});
fs.mkdirSync("/run/three-tools",{recursive:true});
try{fs.unlinkSync(SOCKET)}catch(e){if(e.code!=="ENOENT")throw e}
const server=http.createServer(async(req,res)=>{
  if(req.method==="GET" && req.url==="/health")return reply(res,200,{ok:true});
  if(req.method!=="POST"||req.url!=="/start")return reply(res,404,{code:"NOT_FOUND"});
  let file=null;
  try{
    let size=0,parts=[];
    for await(const part of req){size+=part.length;if(size>1024)throw Error("INVALID_REQUEST");parts.push(part);}
    const capability=validateStartRequest(JSON.parse(Buffer.concat(parts).toString("utf8")));
    const current=await request({socketPath:TASK,path:"/current",method:"POST"}, {capability});
    if(current.status!==200)return reply(res,403,{code:"TASK_NOT_AUTHORIZED"});
    const task=parseJSON(current);
    const scope=JSON.parse(fs.readFileSync(SCOPE,"utf8"));
    const grant=authorizeScoutStart(scope,task);
    const monitor=await request({hostname:SCOUT,port:3000,path:"/api/monitor",method:"GET"},null);
    if(monitor.status!==200)return reply(res,502,{code:"SCOUT_MONITOR_UNAVAILABLE"});
    const state=parseJSON(monitor);
    if(state.busy!==false||state.activeJobId)return reply(res,409,{code:"SCOUT_BUSY"});
    // Atomic persistent one-launch-per-issue gate survives container restarts.
    file=path.join(STATE,grant.issueId+".json");
    let fd;
    try {fd=fs.openSync(file,"wx",0o600);} catch(e) {
      if(e.code==="EEXIST")return reply(res,409,{code:"SCOUT_ALREADY_REQUESTED"});
      throw e;
    }
    try{fs.writeFileSync(fd,JSON.stringify({issueId:grant.issueId,sourceIds:grant.sourceIds,createdAt:new Date().toISOString()}));}
    finally{fs.closeSync(fd)}
    const result=await request({hostname:SCOUT,port:3000,path:"/api/sources/start-many",method:"POST"},scoutPayload(grant));
    if(result.status!==202){
      // A response may have been lost after a successful upstream start.
      // Keep idempotency record: operator must reconcile before retrying.
      return reply(res,502,{code:"SCOUT_START_UNCONFIRMED"});
    }
    parseJSON(result);
    return reply(res,200,{status:"accepted",sourceCount:grant.sourceIds.length,
      requestId:grant.requestId,notice:"Scout search accepted, not yet finished"});
  }catch(e){
    const code=["INVALID_REQUEST","INVALID_SCOPE","TASK_NOT_ACTIVE","SCOUT_START_NOT_AUTHORIZED","SCOUT_SOURCE_SCOPE_INVALID"].includes(e.message)
      ?e.message:"SCOUT_START_REFUSED";
    return reply(res,403,{code});
  }
});
server.requestTimeout=15000;
server.headersTimeout=5000;
server.listen(SOCKET,()=>{fs.chmodSync(SOCKET,0o600);console.log("Scoped Scout start gateway ready")});
