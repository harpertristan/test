import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";
import {safePath,authorizeWorkspace} from "../developer_workspace_gateway.mjs";
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function call(socket,endpoint,body){
 return new Promise((resolve,reject)=>{
  const text=JSON.stringify(body),req=http.request({socketPath:socket,path:endpoint,
    method:"POST",headers:{"content-type":"application/json",
      "content-length":Buffer.byteLength(text)},timeout:20000},r=>{
      let raw="";r.on("data",b=>raw+=b);
      r.on("end",()=>resolve({status:r.statusCode,data:JSON.parse(raw)}));
   });
   req.on("error",reject);req.on("timeout",()=>req.destroy());
   req.end(text);
 });
}
test("developer source sandbox is bound to real signed chat/task identity",()=>{
 for(const p of ["/etc/passwd","../private/secret","test/.env","a//b.mjs","/srv/hermes.sh"])
   assert.throws(()=>safePath(p));
 assert.equal(safePath("tests/workflow.test.mjs"),"tests/workflow.test.mjs");
 const task={id:"11111111-1111-4111-8111-111111111111",identifier:"WOR-15",
  mode:"chat",conversationState:"active",status:"in_review",agentId:"hermes",
  companyId:"company"};
 const policy={version:1,grants:{},agentGrants:{
  hermes:{agentId:"hermes",companyId:"company",workspaceWide:true,
     operations:["developer_workspace"]}}};
 assert.equal(authorizeWorkspace(policy,task),true);
 assert.throws(()=>authorizeWorkspace(policy,{...task,mode:"task",status:"todo"}));
 assert.throws(()=>authorizeWorkspace(policy,{...task,companyId:"other"}));
 assert.throws(()=>authorizeWorkspace({...policy,grants:{[task.id]:{
    issueIdentifier:"OTHER",operations:["developer_workspace"]}}},task));
});
test("developer workspace can safely stage and compile while source remains unchanged",async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"developer-workspace-test-"));
 const source=path.join(dir,"source"),work=path.join(dir,"work"),
  scope=path.join(dir,"scope.json"),controller=path.join(dir,"control.sock"),
  server=path.join(dir,"work.sock");
 fs.mkdirSync(source);fs.mkdirSync(work);
 fs.writeFileSync(path.join(source,"example.mjs"),"export const answer=1;\n");
 fs.writeFileSync(path.join(source,".env"),"SECRET=never-visible");
 const id="11111111-1111-4111-8111-111111111111";
 fs.writeFileSync(scope,JSON.stringify({version:1,grants:{},agentGrants:{
  "hermes":{agentId:"hermes",companyId:"company",workspaceWide:true,
   operations:["developer_workspace"]}}}));
 const api=http.createServer((req,res)=>{
  let body="";req.on("data",c=>body+=c);req.on("end",()=>{
   const valid=JSON.parse(body).capability==="synthetic-valid";
   res.writeHead(valid?200:403,{"content-type":"application/json"});
   res.end(JSON.stringify(valid?{
    id,identifier:"WOR-15",status:"in_review",mode:"chat",
    conversationState:"active",agentId:"hermes",companyId:"company"
   }:{code:"DENIED"}));
  });
 });
 let child;
 try{
  await new Promise(resolve=>api.listen(controller,resolve));
  child=spawn(process.execPath,[path.join(root,"developer_workspace_gateway.mjs")],{
   env:{...process.env,HERMES_TEST_MODE:"1",HERMES_TEST_DEV_SOCKET:server,
    HERMES_TEST_CONTROL:controller,HERMES_TEST_SCOPE:scope,
    HERMES_TEST_SOURCE:source,HERMES_TEST_WORKSPACE:work},
   stdio:"ignore"
  });
  let ready=false;
  for(let n=0;n<100;n++){
   if(fs.existsSync(server)){ready=true;break;}
   await new Promise(r=>setTimeout(r,20));
  }
  assert.ok(ready);
  const c="synthetic-valid";
  const listing=await call(server,"/work",{capability:c,action:"list"});
  assert.equal(listing.status,200);
  assert.deepEqual(listing.data.files,["example.mjs"]);
  const read=await call(server,"/work",{capability:c,action:"read",path:"example.mjs"});
  assert.equal(read.data.content,"export const answer=1;\n");
  const invalid=await call(server,"/work",{capability:"invalid",action:"list"});
  assert.equal(invalid.status,403);
  const patch=await call(server,"/work",{capability:c,action:"patch",path:"example.mjs",
   old:"answer=1",new:"answer=2"});
  assert.equal(patch.data.status,"staged");
  assert.equal(fs.readFileSync(path.join(source,"example.mjs"),"utf8"),"export const answer=1;\n");
  const lint=await call(server,"/work",{capability:c,action:"test",
    suite:"syntax",path:"example.mjs"});
  assert.equal(lint.data.status,"passed");
  assert.equal(lint.data.kind,"syntax_only");
  const bad=await call(server,"/work",{capability:c,action:"patch",
    path:"../../private.json",old:"hello",new:"private"});
  assert.equal(bad.status,403);
  const reset=await call(server,"/work",{capability:c,action:"reset"});
  assert.equal(reset.status,200);
  assert.equal(fs.readFileSync(path.join(source,"example.mjs"),"utf8"),"export const answer=1;\n");
 }finally{
  child?.kill("SIGTERM");
  await new Promise(r=>api.close(r));
  fs.rmSync(dir,{recursive:true,force:true});
 }
});
