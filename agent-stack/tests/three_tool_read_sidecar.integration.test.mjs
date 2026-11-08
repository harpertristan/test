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
 const socket=path.join(temp,"read.sock"),controllerSocket=path.join(temp,"control.sock"),scoutSocket=path.join(temp,"scout.sock"),scope=path.join(temp,"scope.json");
 const taskId="22222222-2222-4222-8222-222222222222",agentId="test-hermes";
 const policy={version:1,grants:{},agentGrants:{[agentId]:{
  agentId,companyId:"test-company",operations:["scout_findings","mail_messages","assistant_companies","assistant_review"],
  mailConsent:true,assistantConsent:true,workspaceWide:true,companyIds:["company-a"]
 }}};
 fs.writeFileSync(scope,JSON.stringify(policy));
 let taskStatus=200,upstreamStatus=200;
 const upstreamPaths=[];
 const controller=http.createServer((req,res)=>{
  res.writeHead(taskStatus,{"content-type":"application/json"});
  res.end(taskStatus===200?JSON.stringify({id:taskId,identifier:"WOR-TEST",status:"in_progress",
    agentId,companyId:"test-company"}):JSON.stringify({code:"TASK_NOT_IN_PROGRESS"}));
 });
 const scout=http.createServer((req,res)=>{
  res.writeHead(upstreamStatus,{"content-type":"application/json"});
  res.end(JSON.stringify({operation:"scout_findings",data:{items:[{name:"Synthetic Bank"}]}}));
 });
 const upstream=http.createServer((req,res)=>{
  upstreamPaths.push(req.url);
  const assistant=req.url.startsWith("/assistant/");
  if(assistant&&(req.headers["x-workspace-key"]!=="synthetic-workspace-key-for-read-only-tests-0000"||
     req.headers["x-workspace-role"]!=="viewer")){
    res.writeHead(401,{"content-type":"application/json"});
    return res.end(JSON.stringify({error:"workspace viewer authorization required"}));
  }
  if(!assistant&&req.headers["x-workspace-key"]){
    res.writeHead(403,{"content-type":"application/json"});
    return res.end(JSON.stringify({error:"assistant key leaked to another service"}));
  }
  res.writeHead(upstreamStatus,{"content-type":"application/json"});
  if(req.url==="/mail-crm/messages"){
    res.writeHead(200,{"content-type":"text/html"});
    return res.end("<html><title>Mail CRM SPA</title></html>");
  }
  res.end(JSON.stringify(req.url==="/mail-crm/api/messages"?
    {items:[{id:"m1",body:"synthetic private mail text"}]}:
    req.url==="/assistant/api/companies"?[{id:"company-a",name:"Synthetic Ltd"}]:
    req.url==="/assistant/api/companies/company-a/review"?
      {approved:false,issues:[{field:"VAT",status:"requires_review"}]}:
    {items:[{name:"Synthetic Bank"}]}));
 });
 let child;
 try{
  await listen(controller,controllerSocket);
  await listen(scout,scoutSocket);
  await listen(upstream,{host:"127.0.0.1",port:0});
  child=spawn(process.execPath,[path.join(root,"three_tool_read_sidecar.mjs")],{
   env:{...process.env,HERMES_TEST_MODE:"1",HERMES_TEST_SOCKET:socket,
    HERMES_TEST_CONTROL:controllerSocket,HERMES_TEST_SCOUT_SOCKET:scoutSocket,HERMES_TEST_SCOPE:scope,
    HERMES_TEST_GATEWAY:"127.0.0.1",HERMES_TEST_PORT:String(upstream.address().port),
    HERMES_TEST_WORKSPACE_KEY:"synthetic-workspace-key-for-read-only-tests-0000",
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
  const scoutRead=await get("scout_findings");
  assert.equal(scoutRead.status,200);
  assert.equal(scoutRead.body.operation,"scout_findings");
  const companies=await get("assistant_companies");
  assert.equal(companies.status,200);
  assert.equal(companies.body.data[0].id,"company-a");
  const review=await get("assistant_review",{companyId:"company-a"});
  assert.equal(review.status,200);
  assert.equal(review.body.data.issues[0].status,"requires_review");
  const blockedCompany=await get("assistant_review",{companyId:"company-b"});
  assert.equal(blockedCompany.status,403);
  assert.equal(blockedCompany.body.code,"OPERATION_NOT_GRANTED");
    const mail=await get("mail_messages");
  assert.equal(mail.status,200);
  assert.equal(mail.body.data.items[0].body,"synthetic private mail text");
  assert.ok(upstreamPaths.includes("/mail-crm/api/messages"),"Mail must reach /api/messages, not frontend HTML");
  assert.ok(!upstreamPaths.includes("/mail-crm/messages"),"Do not use the SPA fallback route");
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
  assert.equal(broken.body.code,"SCOUT_READ_UNAVAILABLE");
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
  await close(scout).catch(()=>{});
  await close(upstream).catch(()=>{});
  fs.rmSync(temp,{recursive:true,force:true});
 }
});
