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
 const grant=mk({companyIds:["123"],operations:["assistant_profile"]});
 assert.equal(authorizeReadScope(grant,issue,"assistant_profile",{companyId:"123"}),true);
 assert.throws(()=>authorizeReadScope(grant,issue,"assistant_profile",{companyId:"456"}));
 assert.throws(()=>authorizeReadScope(grant,issue,"assistant_profile",{companyId:"../../456"}));
});
