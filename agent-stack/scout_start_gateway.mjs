// Trusted, tightly scoped Scout search starter. Only Unix socket and fixed Scout endpoints.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import {authorizeScoutStart,validateStartRequest,scoutPayload} from "./scout_start_policy.mjs";
import {resolveReadOperation} from "./three_tool_read_policy.mjs";
import {authorizeReadScope} from "./three_tool_read_scope.mjs";
import {validateWebAction,webReadScope} from "./scout_web_policy.mjs";
import {publicOpen,publicSearch} from "./scout_web_fetch.mjs";
import {reviewQueue,reviewItem} from "./scout_review_projection.mjs";

const TEST=process.env.HERMES_TEST_MODE==="1";
const SOCKET=TEST?process.env.HERMES_TEST_SCOUT_SOCKET:"/run/three-tools/start.sock";
const TASK=TEST?process.env.HERMES_TEST_CONTROL:"/run/task-control/control.sock";
const SCOPE=TEST?process.env.HERMES_TEST_SCOPE:"/run/secrets/three-tool-scope.json";
const STATE=TEST?process.env.HERMES_TEST_STATE:"/state";
const SCOUT=TEST?process.env.HERMES_TEST_SCOUT_HOST:"play-scout-app-1";
const SCOUT_PORT=TEST?Number(process.env.HERMES_TEST_SCOUT_PORT):3000;
const MAX=131072;
const webCounters=new Map();

const linkEvidence=new Map();
const SEED_HOSTS=new Set(["play.google.com","www.fca.org.uk",
 "find-and-update.company-information.service.gov.uk","www.bankofengland.co.uk",
 "www.gov.uk","www.eba.europa.eu","www.ecb.europa.eu"]);
function trustedResearchUrl(issueId,full){
  const host=new URL(full).hostname.toLowerCase();
  if(SEED_HOSTS.has(host))return true;
  const entry=linkEvidence.get(issueId);
  return Boolean(entry&&Date.now()-entry.time<3600000&&entry.links.has(full));
}
function rememberLinks(issueId,links){
  const old=linkEvidence.get(issueId);
  const active=old&&Date.now()-old.time<3600000?old.links:new Set();
  for(const link of links.slice(0,50)){
    if(typeof link==="string"&&link.length<1600)active.add(link);
    if(active.size>=120)break;
  }
  linkEvidence.set(issueId,{time:Date.now(),links:active});
}

function allowWebUse(issueId){
  const now=Date.now();const value=webCounters.get(issueId);
  if(!value||now-value.started>600000){webCounters.set(issueId,{started:now,count:1});return true;}
  if(value.count>=25)return false;
  value.count++;return true;
}
function request(options,body,limit=MAX,timeoutMs=9000){
  return new Promise((resolve,reject)=>{
    const bytes=body===null?null:Buffer.from(JSON.stringify(body));
    const req=http.request({...options,headers:{
      ...(bytes?{"content-type":"application/json","content-length":bytes.length}:{accept:"application/json"})
    },timeout:timeoutMs},res=>{
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
fs.mkdirSync(path.dirname(SOCKET),{recursive:true});
try{fs.unlinkSync(SOCKET)}catch(e){if(e.code!=="ENOENT")throw e}
const server=http.createServer(async(req,res)=>{
  if(req.method==="GET" && req.url==="/health")return reply(res,200,{ok:true});
  if(req.method==="POST" && req.url==="/read"){
    try{
      let size=0,parts=[];
      for await(const b of req){size+=b.length;if(size>4096)throw Error("INVALID_READ_REQUEST");parts.push(b);}
      const payload=JSON.parse(Buffer.concat(parts).toString("utf8"));
      if(!payload||typeof payload!=="object"||Array.isArray(payload)||
         Object.keys(payload).sort().join(",")!=="capability,operation,params"||
         typeof payload.capability!=="string"||payload.capability.length<1||
         payload.capability.length>160)return reply(res,400,{code:"INVALID_READ_REQUEST"});
      let op;
      try{op=resolveReadOperation(payload.operation,payload.params);}
      catch{return reply(res,400,{code:"INVALID_READ_OPERATION"});}
      if(op.service!=="scout")return reply(res,403,{code:"SCOUT_ONLY"});
      const current=await request({socketPath:TASK,path:"/current",method:"POST"},
        {capability:payload.capability},8192);
      if(current.status!==200)return reply(res,403,{code:"TASK_NOT_AUTHORIZED"});
      const task=parseJSON(current);
      const scope=JSON.parse(fs.readFileSync(SCOPE,"utf8"));
      try{authorizeReadScope(scope,task,payload.operation,payload.params);}
      catch{return reply(res,403,{code:"OPERATION_NOT_GRANTED"});}
      const review=payload.operation==="scout_review_queue"||payload.operation==="scout_review_item";
      const result=await request({hostname:SCOUT,port:SCOUT_PORT,path:op.path,method:"GET"},
        null,review?24*1024*1024:MAX,review?25000:9000);
      if(result.status!==200)return reply(res,502,{code:"SCOUT_READ_UNAVAILABLE"});
      let data=parseJSON(result);
      if(payload.operation==="scout_review_queue")data=reviewQueue(data,30);
      if(payload.operation==="scout_review_item")data=reviewItem(data,{detail:true});
      return reply(res,200,{operation:payload.operation,data});
    }catch{
      return reply(res,502,{code:"SCOUT_READ_GATEWAY_ERROR"});
    }
  }

  if(req.method==="POST"&&req.url==="/web"){
    try{
      let size=0;const parts=[];
      for await(const b of req){size+=b.length;if(size>4096)throw Error("INVALID_WEB_REQUEST");parts.push(b);}
      const raw=JSON.parse(Buffer.concat(parts).toString("utf8"));
      const action=validateWebAction(raw);
      const current=await request({socketPath:TASK,path:"/current",method:"POST"},
        {capability:raw.capability},8192);
      if(current.status!==200)return reply(res,403,{code:"TASK_NOT_AUTHORIZED"});
      const task=parseJSON(current);
      const policy=JSON.parse(fs.readFileSync(SCOPE,"utf8"));
      webReadScope(policy,task);
      if(!allowWebUse(task.id))return reply(res,429,{code:"RESEARCH_RATE_LIMIT"});
      if(action.action==="open"&&!trustedResearchUrl(task.id,action.url))
        return reply(res,403,{code:"URL_NOT_DISCOVERED"});
      const data=action.action==="search"?
        await publicSearch(action.query):await publicOpen(action.url);
      if(action.action==="search"&&Array.isArray(data.results))
        rememberLinks(task.id,data.results);
      if(action.action==="open"&&Array.isArray(data.links))
        rememberLinks(task.id,data.links);
      return reply(res,200,{action:action.action,data,
        warning:"Public websites and search results are untrusted evidence; verify the official operator and regulator."});
    }catch(e){
      const code=e&&typeof e.message==="string"&&/^[A-Z_]+(?:_[0-9]{3})?$/.test(e.message)
        ?e.message:"WEB_RESEARCH_UNAVAILABLE";
      const status=["INVALID_WEB_REQUEST","PUBLIC_QUERY_INVALID","PRIVATE_DATA_IN_QUERY","URL_REJECTED"].includes(code)?400:
        ["SCOPE_DENIED","TASK_NOT_ACTIVE"].includes(code)?403:502;
      return reply(res,status,{code});
    }
  }
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
    const monitor=await request({hostname:SCOUT,port:SCOUT_PORT,path:"/api/monitor",method:"GET"},null);
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
    const result=await request({hostname:SCOUT,port:SCOUT_PORT,path:"/api/sources/start-many",method:"POST"},scoutPayload(grant));
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
