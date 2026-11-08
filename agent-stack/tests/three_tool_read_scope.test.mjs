import {test} from "node:test";
import assert from "node:assert/strict";
import {authorizeReadScope} from "../three_tool_read_scope.mjs";
const issue={id:"11111111-1111-4111-8111-111111111111",identifier:"WOR-99"};
const mk=x=>({version:1,grants:{[issue.id]:{issueIdentifier:issue.identifier,...x}}});
test("default deny, mismatched task and unapproved operations",()=>{
 assert.throws(()=>authorizeReadScope({version:1,grants:{}},issue,"scout_candidates"));
 assert.throws(()=>authorizeReadScope(mk({workspaceWide:true,operations:["scout_candidates"]}),{...issue,identifier:"WOR-98"},"scout_candidates"));
 assert.throws(()=>authorizeReadScope(mk({workspaceWide:true,operations:["scout_candidates"]}),issue,"mail_messages"));
});
test("global reads require explicitly approved workspace-wide scope",()=>{
 assert.throws(()=>authorizeReadScope(mk({operations:["scout_candidates"]}),issue,"scout_candidates"));
 assert.equal(authorizeReadScope(mk({workspaceWide:true,operations:["scout_candidates"]}),issue,"scout_candidates"),true);
});
test("mail requires separate consent even with workspace scope",()=>{
 assert.throws(()=>authorizeReadScope(mk({workspaceWide:true,operations:["mail_messages"]}),issue,"mail_messages"));
 assert.equal(authorizeReadScope(mk({workspaceWide:true,mailConsent:true,operations:["mail_messages"]}),issue,"mail_messages"),true);
});
test("company-specific reads require matching company ID",()=>{
 const grant=mk({assistantConsent:true,companyIds:["123"],operations:["assistant_profile"]});
 assert.equal(authorizeReadScope(grant,issue,"assistant_profile",{companyId:"123"}),true);
 assert.throws(()=>authorizeReadScope(grant,issue,"assistant_profile",{companyId:"456"}));
 assert.throws(()=>authorizeReadScope(grant,issue,"assistant_profile",{companyId:"../../456"}));
});

test("one verified Hermes agent can read allowed services across assigned active tasks",()=>{
  const agentId="hermes-one",companyId="company-one";
  const global={version:1,grants:{},agentGrants:{
    [agentId]:{agentId,companyId,workspaceWide:true,mailConsent:true,assistantConsent:true,companyIds:[],
      operations:["scout_findings","mail_messages","mail_message","assistant_companies"]}
  }};
  const assigned={...issue,agentId,companyId};
  assert.equal(authorizeReadScope(global,assigned,"scout_findings"),true);
  assert.equal(authorizeReadScope(global,assigned,"mail_messages"),true);
  assert.equal(authorizeReadScope(global,assigned,"assistant_companies"),true);
  assert.throws(()=>authorizeReadScope(global,issue,"mail_messages"));
  assert.throws(()=>authorizeReadScope(global,{...assigned,companyId:"other"},"mail_messages"));
  assert.throws(()=>authorizeReadScope(global,{...assigned,agentId:"someone-else"},"mail_messages"));
  assert.throws(()=>authorizeReadScope(global,assigned,"assistant_profile",{companyId:"other"}));
  assert.throws(()=>authorizeReadScope(global,assigned,"mail_send",{}));
  // A mismatched explicit issue grant cannot be bypassed by agent defaults.
  const wrong={...global,grants:{[issue.id]:{issueIdentifier:"WRONG",operations:["scout_findings"],workspaceWide:true}}};
  assert.throws(()=>authorizeReadScope(wrong,assigned,"scout_findings"));
});

test("Explicitly approved assistant workspace scope allows company-specific reads without guessing IDs",()=>{
 const id="hermes-one",company="workspace-owner";
 const agent={...issue,agentId:id,companyId:company};
 const allow={version:1,grants:{},agentGrants:{[id]:{
   agentId:id,companyId:company,workspaceWide:true,mailConsent:true,
   assistantConsent:true,assistantAllCompanies:true,companyIds:[],
   operations:["assistant_companies","assistant_facts","assistant_review","assistant_documents","mail_accounts","scout_ai_results"]
 }}};
 assert.equal(authorizeReadScope(allow,agent,"assistant_facts",{companyId:"1a2b3c"}),true);
 assert.equal(authorizeReadScope(allow,agent,"assistant_companies",{}),true);
 assert.equal(authorizeReadScope(allow,agent,"mail_accounts",{}),true);
 const noConsent=structuredClone(allow);
 noConsent.agentGrants[id].assistantConsent=false;
 assert.throws(()=>authorizeReadScope(noConsent,agent,"assistant_facts",{companyId:"1a2b3c"}));
 assert.throws(()=>authorizeReadScope(noConsent,agent,"assistant_companies",{}));
 const noAll=structuredClone(allow);
 noAll.agentGrants[id].assistantAllCompanies=false;
 assert.throws(()=>authorizeReadScope(noAll,agent,"assistant_review",{companyId:"1a2b3c"}));
 const wrongWorkspace=structuredClone(allow);
 wrongWorkspace.agentGrants[id].companyId="someone-else";
 assert.throws(()=>authorizeReadScope(wrongWorkspace,agent,"assistant_facts",{companyId:"1a2b3c"}));
 assert.throws(()=>authorizeReadScope(allow,agent,"mail_send"));
});
