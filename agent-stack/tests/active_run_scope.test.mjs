import test from "node:test";
import assert from "node:assert/strict";
import {activeReadContext} from "../active_run_scope.mjs";
import {webReadScope} from "../scout_web_policy.mjs";
import {authorizeCollection} from "../scout_collect_policy.mjs";
const id="11111111-1111-4111-8111-111111111111";
const base={id,identifier:"WOR-CHAT",agentId:"hermes",companyId:"company"};
const grant={version:1,grants:{},agentGrants:{hermes:{
  agentId:"hermes",companyId:"company",workspaceWide:true,
  operations:["scout_web","scout_collect"]}}};
test("A signed active Agent Chat can read allowed data even when task status is in_review",()=>{
 const chat={...base,mode:"chat",conversationState:"active",status:"in_review"};
 assert.equal(activeReadContext(chat),true);
 assert.equal(webReadScope(grant,chat),true);
 assert.equal(authorizeCollection(grant,chat,"web").sourceId,"web");
});
test("An idle chat, arbitrary claimed mode, or ordinary todo task cannot read or collect",()=>{
 for(const task of [
  {...base,mode:"chat",conversationState:"waiting",status:"in_review"},
  {...base,mode:"chat",conversationState:"active",status:"done"},
  {...base,mode:"chat",conversationState:"active",status:"blocked"},
  {...base,mode:"conversation",conversationState:"active",status:"in_review"},
  {...base,mode:"task",status:"todo"},
  {...base,status:"in_review"},
 ]){
  assert.equal(activeReadContext(task),false);
  assert.throws(()=>webReadScope(grant,task));
  assert.throws(()=>authorizeCollection(grant,task,"web"));
 }
});
