// Offline integration contract for the Scout-network Unix gateway: no real Scout, email or credentials.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const listen=(srv,target)=>new Promise((resolve,reject)=>{srv.once("error",reject);srv.listen(target,resolve)});
const close=srv=>new Promise(resolve=>srv.close(resolve));
function call(socket,route,body){
 return new Promise((resolve,reject)=>{
  const data=body===null?null:JSON.stringify(body);
  const req=http.request({socketPath:socket,path:route,method:data?"POST":"GET",
   headers:data?{"content-type":"application/json","content-length":Buffer.byteLength(data)}:{}},res=>{
    let result="";res.on("data",b=>result+=b);
    res.on("end",()=>{try{resolve({status:res.statusCode,body:JSON.parse(result)})}catch(e){reject(e)}});
  });req.on("error",reject);req.end(data??undefined);
 });
}
test("Scout gateway reads only signed scoped Scout source and rejects non-Scout or invalid run",async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"hermes-scout-gw-"));
 const controlSocket=path.join(dir,"control.sock"),gatewaySocket=path.join(dir,"gateway.sock"),
 scopeFile=path.join(dir,"scope.json"),state=path.join(dir,"state");
 fs.mkdirSync(state);
 const issue="22222222-2222-4222-8222-222222222222",agent="synthetic-hermes";
 fs.writeFileSync(scopeFile,JSON.stringify({version:1,grants:{},
  agentGrants:{[agent]:{agentId:agent,companyId:"company-test",workspaceWide:true,
   mailConsent:false,companyIds:[],operations:["scout_findings","scout_review_queue","scout_review_item"]}}}));
 const control=http.createServer((req,res)=>{
  let b="";req.on("data",part=>b+=part);
  req.on("end",()=>{
   const authorized=JSON.parse(b).capability==="synthetic-valid";
   res.writeHead(authorized?200:403,{"content-type":"application/json"});
   res.end(JSON.stringify(authorized?{id:issue,identifier:"WOR-TEST",
    status:"in_progress",agentId:agent,companyId:"company-test"}:{code:"GRANT_FORMAT_OR_SIGNATURE"}));
  });
 });
 const scout=http.createServer((req,res)=>{
  res.writeHead(200,{"content-type":"application/json"});
  const row={id:"app:com.example.bank",title:"Synthetic UK EMI",status:"review",
     url:"https://bank.example/business",appId:"com.example.bank",
     facts:{business:{status:"yes"},account:{status:"unknown"},euIban:{status:"unknown"}},
     sources:["play"],screening:{eligible:true},
     documents:[{url:"https://bank.example/terms",text:"UK LTD business accounts, public terms"}],
     notes:"PRIVATE CRM NOTE SHOULD NEVER LEAVE",detailRevision:"a".repeat(64)};
  res.end(JSON.stringify(req.url==="/api/findings"?[{name:"Synthetic UK EMI"}]:
    req.url==="/api/crm"?{rows:[row,{...row,id:"exclude",status:"excluded"}]}:
    req.url==="/api/crm/item?id=app%3Acom.example.bank"?row:
    {busy:false,activeJobId:null}));
 });
 let child;
 try{
  await listen(control,controlSocket);
  await listen(scout,{host:"127.0.0.1",port:0});
  child=spawn(process.execPath,[path.join(root,"scout_start_gateway.mjs")],{
    env:{...process.env,HERMES_TEST_MODE:"1",
     HERMES_TEST_SCOUT_SOCKET:gatewaySocket,HERMES_TEST_CONTROL:controlSocket,
     HERMES_TEST_SCOPE:scopeFile,HERMES_TEST_STATE:state,
     HERMES_TEST_SCOUT_HOST:"127.0.0.1",
     HERMES_TEST_SCOUT_PORT:String(scout.address().port)},stdio:"ignore"
  });
  let ready=false;
  for(let n=0;n<100;n++){
   if(child.exitCode!==null)break;
   try{if((await call(gatewaySocket,"/health",null)).status===200){ready=true;break}}catch{}
   await new Promise(r=>setTimeout(r,30));
  }
  assert.equal(ready,true,"Scout gateway did not start");
  const read=(capability,operation)=>call(gatewaySocket,"/read",{capability,operation,params:{}});
  const success=await read("synthetic-valid","scout_findings");
  assert.equal(success.status,200);
  assert.equal(success.body.data[0].name,"Synthetic UK EMI");
  const queue=await read("synthetic-valid","scout_review_queue");
  assert.equal(queue.status,200);
  assert.equal(queue.body.data.count,1);
  assert.equal(queue.body.data.items[0].title,"Synthetic UK EMI");
  assert.ok(!JSON.stringify(queue.body).includes("PRIVATE CRM NOTE"));
  const detail=await call(gatewaySocket,"/read",{
   capability:"synthetic-valid",operation:"scout_review_item",
   params:{reviewId:"app:com.example.bank"}});
  assert.equal(detail.status,200);
  assert.equal(detail.body.data.evidence[0].source,"https://bank.example/terms");
  assert.ok(!JSON.stringify(detail.body).includes("PRIVATE CRM NOTE"));
  const invalidReview=await read("invalid","scout_review_queue");
  assert.equal(invalidReview.status,403);
  const invalid=await read("invalid","scout_findings");
  assert.equal(invalid.status,403);
  const other=await read("synthetic-valid","mail_messages");
  assert.equal(other.status,403);
  assert.equal(other.body.code,"SCOUT_ONLY");
  const illegalStart=await call(gatewaySocket,"/start",{capability:"invalid"});
  assert.equal(illegalStart.status,403);
  assert.deepEqual(fs.readdirSync(state),[],"Denied start must not create a job marker");
 }finally{
  child?.kill("SIGTERM");
  await close(control).catch(()=>{});
  await close(scout).catch(()=>{});
  fs.rmSync(dir,{recursive:true,force:true});
 }
});
