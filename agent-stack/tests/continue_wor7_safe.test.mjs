import test from "node:test";
import assert from "node:assert/strict";
import {SOURCE_ID,RECOVERY_TITLE,continuationPayload,isReplayBlocked,selectExisting}
 from "../ops/continue_wor7_safe.mjs";
const agentId="11111111-1111-4111-8111-111111111111";
const companyId="33333333-3333-4333-8333-333333333333";
const identity={agentId,companyId};
const issue={id:SOURCE_ID,identifier:"WOR-7",status:"todo",
 assigneeAgentId:agentId,companyId,priority:"medium",
 description:"Research EMI payment institutions offering both EUR and GBP UK limited business accounts.",
 executionRunId:null,checkoutRunId:null};
test("Continuation keeps original research with identity, link and no replay",()=>{
 const payload=continuationPayload(issue,identity);
 assert.equal(payload.title,RECOVERY_TITLE);
 assert.equal(payload.parentId,SOURCE_ID);
 assert.equal(payload.assigneeAgentId,agentId);
 assert.equal(payload.status,"todo");
 assert.match(payload.description,/Research EMI payment institutions/);
 assert.match(payload.description,/Не повторяй действия предыдущих запусков/);
 assert.match(payload.description,/Не отправляй письма/);
 assert.ok(!Object.keys(payload).includes("executionRunId"));
});
test("Only the exactly identified assigned and unlocked WOR-7 is eligible",()=>{
 for(const changed of [
  {...issue,id:agentId},
  {...issue,status:"in_review"},
  {...issue,checkoutRunId:agentId},
  {...issue,executionRunId:agentId},
  {...issue,assigneeAgentId:companyId},
  {...issue,companyId:agentId},
  {...issue,description:"short"}
 ])assert.throws(()=>continuationPayload(changed,identity));
 assert.throws(()=>continuationPayload(issue,{...identity,companyId:agentId}));
});
test("Never touch issues without the exact resolved replay-blocked recovery receipt",()=>{
 const action={sourceIssueId:SOURCE_ID,status:"resolved",outcome:"blocked",
  evidence:{automaticRecovery:{replay:"blocked",policy:"preserve_without_replay_v1"}}};
 assert.equal(isReplayBlocked(action),true);
 for(const candidate of [
  {...action,status:"active"},
  {...action,status:"cancelled"},
  {...action,outcome:"restored"},
  {...action,sourceIssueId:agentId},
  {...action,evidence:{automaticRecovery:{replay:"allowed"}}}
 ])assert.equal(isReplayBlocked(candidate),false);
});
test("Idempotently reuse verified child and reject duplicates or mismatches",()=>{
 const child={id:"44444444-4444-4444-8444-444444444444",
   title:RECOVERY_TITLE,parentId:SOURCE_ID,assigneeAgentId:agentId,
   companyId,status:"todo"};
 assert.equal(selectExisting([],identity),null);
 assert.deepEqual(selectExisting([child],identity),child);
 assert.throws(()=>selectExisting([child,child],identity));
 assert.throws(()=>selectExisting([{...child,companyId:agentId}],identity));
 assert.throws(()=>selectExisting([{...child,assigneeAgentId:companyId}],identity));
 assert.throws(()=>selectExisting([{...child,parentId:agentId}],identity));
});
