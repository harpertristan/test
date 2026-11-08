import test from "node:test";
import assert from "node:assert/strict";
import {collectionModes,validateCollection,authorizeCollection,collectionPayload}
 from "../scout_collect_policy.mjs";
const task={id:"11111111-1111-4111-8111-111111111111",identifier:"WOR-22",
 status:"in_progress",agentId:"hermes-agent",companyId:"company-1"};
const policy={version:1,grants:{},agentGrants:{
 "hermes-agent":{agentId:"hermes-agent",companyId:"company-1",
   workspaceWide:true,mailConsent:true,assistantConsent:true,
   operations:["scout_collect"]}}};
test("Explicit fixed public modes cover Google Play, web, watch and financial sources",()=>{
 assert.deepEqual(collectionModes(),["play","web","watch","ecb","finextra","linkedin","facebook","sifted"]);
 for(const mode of collectionModes()){
   const input=validateCollection({capability:"synthetic-signed",source:mode});
   const grant=authorizeCollection(policy,task,input.mode);
   assert.equal(grant.issueId,task.id);
   const payload=collectionPayload(grant,"11111111-1111-4111-8111-111111111111");
   assert.equal(payload.allowPaid,false);
   assert.equal(payload.analyse,false);
   assert.equal(payload.ids.length,1);
   assert.ok(!JSON.stringify(payload).includes("https:"));
 }
});
test("No caller-controlled IDs, paid flags, payloads, arbitrary URL or public run without signed scope",()=>{
 const good={capability:"synthetic-signed",source:"play"};
 for(const bad of [{...good,allowPaid:true},{...good,source:"apify:facebook"},
  {...good,url:"https://evil.test"},{...good,body:"private"}]){
  assert.throws(()=>validateCollection(bad));
 }
 assert.throws(()=>authorizeCollection(policy,{...task,status:"todo"},"play"));
 assert.throws(()=>authorizeCollection(policy,{...task,companyId:"another"},"play"));
 assert.throws(()=>authorizeCollection(policy,{...task,agentId:"other-agent"},"play"));
 assert.throws(()=>authorizeCollection(policy,task,"unknown"));
 assert.throws(()=>authorizeCollection({version:1,grants:{},agentGrants:{}},task,"play"));
 const separate={...policy,grants:{[task.id]:{issueIdentifier:"WRONG",workspaceWide:true,operations:["scout_collect"]}}};
 assert.throws(()=>authorizeCollection(separate,task,"play"));
});
