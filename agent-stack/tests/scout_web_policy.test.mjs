import test from "node:test";
import assert from "node:assert/strict";
import {publicIPv4,safeWebUrl,safePublicText,validateWebAction,webReadScope} from "../scout_web_policy.mjs";
const id="11111111-1111-4111-8111-111111111111";
const task={id,identifier:"WOR-7",status:"in_progress",agentId:"hermes-test",companyId:"company-test"};
const allow={version:1,grants:{[id]:{issueIdentifier:"WOR-7",
  operations:["scout_web"],workspaceWide:true}}};
test("Only public IPv4 may be pinned for HTTPS",()=>{
 for(const ip of ["8.8.8.8","1.1.1.1","93.184.216.34"])
  assert.equal(publicIPv4(ip),true);
 for(const ip of ["127.0.0.1","0.0.0.0","10.0.1.1","192.168.4.2",
  "172.16.0.5","169.254.169.254","100.64.0.1","198.18.0.1",
  "192.0.2.1","203.0.113.1","::1","::ffff:127.0.0.1"])
  assert.equal(publicIPv4(ip),false,ip);
});
test("Only public HTTPS hostnames, no credentials, ports or private targets",()=>{
 assert.equal(safeWebUrl("https://play.google.com/store/apps/details?id=com.example").hostname,
  "play.google.com");
 for(const url of ["http://bank.co.uk","https://localhost/path",
  "https://127.0.0.1/test","https://foo.local/",
  "https://169.254.169.254/latest","https://bank.co.uk:8443/private",
  "https://user:password@bank.co.uk/","file:///etc/passwd",
  "https://bank.co.uk/?email=alice%40example.com",
  "https://example.com/?token=sk-abcdefghijklmnopqrstuvwxyz0123456789",
  "https://example.com/#hash"]){
  assert.throws(()=>safeWebUrl(url),url);
 }
});
test("Public search queries deny email and opaque data",()=>{
 assert.equal(safePublicText("UK EMI business accounts GBP EUR"),"UK EMI business accounts GBP EUR");
 for(const q of ["user@example.com","GB29 NWBK 6016 1331 9268 19",
  "sk-proj-abcdefghijklmnopqrstuvwxyz0123456","x".repeat(90)])
   assert.throws(()=>safePublicText(q));
});
test("Public browsing requires an active signed issue scope",()=>{
 assert.equal(webReadScope(allow,task),true);
 for(const t of [{...task,status:"todo"},{...task,identifier:"WOR-8"}])
   assert.throws(()=>webReadScope(allow,t));
 assert.throws(()=>webReadScope({version:1,grants:{}},task));
 const agent={version:1,grants:{},agentGrants:{"hermes-test":{
   agentId:"hermes-test",companyId:"company-test",
   workspaceWide:true,operations:["scout_web"]
 }}};
 assert.equal(webReadScope(agent,task),true);
 assert.throws(()=>webReadScope(agent,{...task,companyId:"another"}));
});
test("No arbitrary body, method, outbound payload or model-controlled credentials",()=>{
 const key="synthetic-test-capability-0001";
 assert.deepEqual(validateWebAction({capability:key,action:"search",query:"UK bank"}),{
  action:"search",query:"UK bank"});
 assert.deepEqual(validateWebAction({capability:key,action:"open",url:"https://bank.co.uk/"}),{
  action:"open",url:"https://bank.co.uk/"});
 for(const p of [{capability:key,action:"post",url:"https://bank.co.uk/"},
   {capability:key,action:"open",url:"https://bank.co.uk/",body:"secret"},
   {capability:key,action:"search",query:"bank",cookies:true},
   {capability:key,action:"search",query:"user@example.com"}])
   assert.throws(()=>validateWebAction(p));
});
