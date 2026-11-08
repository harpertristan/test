import test from "node:test";
import assert from "node:assert/strict";
import {validateScoutDecision,authorizeScoutDecision,proposeStatus}
 from "../scout_crm_manage_policy.mjs";
const task={id:"11111111-1111-4111-8111-111111111111",
  identifier:"WOR-20",mode:"chat",conversationState:"active",status:"in_review",
  companyId:"company",agentId:"hermes"};
const policy={version:1,grants:{},agentGrants:{
  hermes:{companyId:"company",agentId:"hermes",workspaceWide:true,
    operations:["scout_crm_manage"]}}};
const base={capability:"synthetic-grant",reviewId:"app:com.example.bank",
  decision:"suitable",sourceUrl:"https://bank.example/business",
  evidence:"UK Ltd business account confirmed on official public page with supporting terms."};
const row={id:"app:com.example.bank",status:"review",screening:{eligible:true},
 worked:false,manualExcluded:false};
test("Signed active chat and work task can manage only their own scoped internal CRM",()=>{
 const valid=validateScoutDecision(base);
 assert.equal(valid.decision,"suitable");
 assert.equal(authorizeScoutDecision(policy,task),true);
 assert.equal(authorizeScoutDecision(policy,{...task,mode:"task",status:"in_progress"}),true);
 assert.equal(proposeStatus(row,valid,true).status,"confirmed");
 assert.equal(proposeStatus(row,{...valid,decision:"not_suitable"},true).status,"rejected");
 assert.equal(proposeStatus(row,{...valid,decision:"watch"},true).status,"watch");
 assert.throws(()=>proposeStatus(row,valid,false));
});
test("No arbitrary URLs, commands, SMTP, production actions or cross-issue privileges",()=>{
 for(const v of [
  {...base,sourceUrl:"http://bank.example/business"},
  {...base,sourceUrl:"https://localhost/internal"},
  {...base,sourceUrl:"https://user:secret@bank.example/"},
  {...base,decision:"approve_human"},
  {...base,command:"rm -rf /"},
  {...base,reviewId:"../admin"},
  {...base,evidence:"too short"},
  {...base,sourceUrl:"https://192.168.0.1/internal"},
 ])assert.throws(()=>validateScoutDecision(v));
 for(const ctx of [
  {...task,status:"done"},
  {...task,conversationState:"waiting"},
  {...task,companyId:"other"},
  {...task,agentId:"other"},
 ])assert.throws(()=>authorizeScoutDecision(policy,ctx));
 assert.throws(()=>authorizeScoutDecision({...policy,grants:{[task.id]:{
  issueIdentifier:"WRONG",workspaceWide:true,operations:["scout_crm_manage"]}}},task));
 for(const item of [{...row,worked:true},{...row,status:"rejected"},
   {...row,manualExcluded:true}])
   assert.throws(()=>proposeStatus(item,base,true));
});
