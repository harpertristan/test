// End-to-end offline verification of the exact production Unix read gateway.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function listen(server,target){return new Promise((resolve,reject)=>{server.once("error",reject);server.listen(target,resolve)})}
function close(server){return new Promise(resolve=>server.close(resolve))}
function send(socket,route,data){
 return new Promise((resolve,reject)=>{
  const body=data===null?null:JSON.stringify(data);
  const req=http.request({socketPath:socket,path:route,method:body?"POST":"GET",
   headers:body?{"content-type":"application/json","content-length":Buffer.byteLength(body)}:{},timeout:3000},res=>{
    let result="";res.on("data",b=>result+=b);res.on("end",()=>{try{resolve({status:res.statusCode,body:JSON.parse(result)})}catch(e){reject(e)}})
   });
  req.on("error",reject);req.on("timeout",()=>req.destroy(Error("timeout")));req.end(body??undefined);
 })
}
test("Unix sidecar: scoped Scout+mail read, denied task, unknown op and upstream error",async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),"hermes-sidecar-"));
 const socket=path.join(temp,"read.sock"),controllerSocket=path.join(temp,"control.sock"),scope=path.join(temp,"scope.json");
 const taskId="22222222-2222-4222-8222-222222222222",agentId="test-hermes";
 const policy={version:1,grants:{},agentGrants:{[agentId]:{
  agentId,companyId:"test-company",operations:["scout_findings","mail_messages"],
  mailConsent:true,workspaceWide:true,companyIds:[]
 }}};
 fs.writeFileSync(scope,JSON.stringify(policy));
 let taskStatus=200,upstreamStatus=200;
 const controller=http.createServer((req,res)=>{
  res.writeHead(taskStatus,{"content-type":"application/json"});
  res.end(taskStatus===200?JSON.stringify({id:taskId,identifier:"WOR-TEST",status:"in_progress",
    agentId,companyId:"test-company"}):JSON.stringify({code:"TASK_NOT_IN_PROGRESS"}));
 });
 const upstream=http.createServer((req,res)=>{
  res.writeHead(upstreamStatus,{"content-type":"application/json"});
  res.end(JSON.stringify(req.url==="/mail-crm/messages"?
    {items:[{id:"m1",body:"synthetic private mail text"}]}:
    {items:[{name:"Synthetic Bank"}]}));
 });
 let child;
 try{
  await listen(controller,controllerSocket);
  await listen(upstream,{host:"127.0.0.1",port:0});
  child=spawn(process.execPath,[path.join(root,"three_tool_read_sidecar.mjs")],{
   env:{...process.env,HERMES_TEST_MODE:"1",HERMES_TEST_SOCKET:socket,
    HERMES_TEST_CONTROL:controllerSocket,HERMES_TEST_SCOPE:scope,
    HERMES_TEST_GATEWAY:"127.0.0.1",HERMES_TEST_PORT:String(upstream.address().port),
    HERMES_TEST_DIR:temp},stdio:"ignore"
  });
  let ready=false;
  for(let i=0;i<80;i++){
   if(child.exitCode!==null)break;
   try{const h=await send(socket,"/health",null);if(h.status===200){ready=true;break}}catch{}
   await new Promise(r=>setTimeout(r,40));
  }
  assert.equal(ready,true,"Sidecar failed to start");
  const get=(operation,params={})=>send(socket,"/read",{capability:"synthetic-grant",operation,params});
  const scout=await get("scout_findings");
  assert.equal(scout.status,200);
  assert.equal(scout.body.operation,"scout_findings");
  const mail=await get("mail_messages");
  assert.equal(mail.status,200);
  assert.equal(mail.body.data.items[0].body,"synthetic private mail text");
  const unknown=await get("mail_send");
  assert.equal(unknown.status,400);
  assert.equal(unknown.body.code,"UNKNOWN_OR_INVALID_READ_OPERATION");
  taskStatus=403;
  const denied=await get("scout_findings");
  assert.equal(denied.status,403);
  assert.equal(denied.body.code,"TASK_NOT_IN_PROGRESS");
  taskStatus=200;upstreamStatus=500;
  const broken=await get("scout_findings");
  assert.equal(broken.status,502);
  assert.equal(broken.body.code,"UPSTREAM_UNAVAILABLE");
  // Never expose a private mailbox to a disallowed task when an explicit grant overrides defaults.
  policy.grants[taskId]={issueIdentifier:"WOR-TEST",operations:["scout_findings"],workspaceWide:true,
    mailConsent:false,companyIds:[]};
  fs.writeFileSync(scope,JSON.stringify(policy));
  upstreamStatus=200;
  const mailDenied=await get("mail_messages");
  assert.equal(mailDenied.status,403);
  assert.equal(mailDenied.body.code,"OPERATION_NOT_GRANTED");
 } finally {
  child?.kill("SIGTERM");
  await close(controller).catch(()=>{});
  await close(upstream).catch(()=>{});
  fs.rmSync(temp,{recursive:true,force:true});
 }
});
