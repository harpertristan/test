import test from "node:test";
import assert from "node:assert/strict";
import {classifyReason,projectWake,projectAgent,projectIssue,projectRecovery}
 from "../ops/diagnose_paperclip_skip.mjs";
test("Paperclip wake policy and execution recovery are not misdiagnosed as Scout permissions",()=>{
 const cases=[
  ["heartbeat.wakeOnDemand.disabled","ON_DEMAND_WAKE_DISABLED"],
  ["budget.blocked","BUDGET_BLOCKED"],
  ["execution_reconciliation_required","EXECUTION_RECOVERY_HOLD"],
  ["legacy_execution_requires_reconciliation","EXECUTION_RECOVERY_HOLD"],
  ["The previous execution has not released its environment lease.","ENVIRONMENT_LEASE_HOLD"],
  ["deferred_issue_execution","ISSUE_EXECUTION_DEFERRED"],
  ["execution_recovery","ISSUE_EXECUTION_DEFERRED"],
  ["issue_tree_hold_active","ISSUE_DEPENDENCY_HOLD"],
  ["heartbeat.scheduling_suppressed","SCHEDULING_SUPPRESSED"],
  ["Retry is waiting for execution checks","EXECUTION_CHECKS_WAIT"]
 ];
 for(const [raw,expected] of cases)assert.equal(classifyReason(raw),expected);
 assert.equal(classifyReason("unknown"),null);
});
test("Diagnostic projects only bounded metadata and never exposes raw wake error or private payload",()=>{
 const issueId="2d95562b-a3f8-465e-bfa9-842dbd950acb";
 const raw={status:"skipped",source:"on_demand",
   reason:"execution_reconciliation_required",
   payload:{issueId,secret:"PRIVATE_DOCUMENT"},
   error:"environment lease still held secret@example.com sk-proj-AbCdEf098765432112321",
   runId:null,requestedAt:"2026-11-08T18:00:00Z"};
 const result=projectWake(raw,issueId);
 assert.equal(result.errorClass,"ENVIRONMENT_LEASE_HOLD");
 assert.equal(result.reasonCode,"EXECUTION_RECOVERY_HOLD");
 assert.equal(result.issueMatches,true);
 assert.equal(result.hasRun,false);
 assert.ok(!JSON.stringify(result).includes("PRIVATE_DOCUMENT"));
 assert.ok(!JSON.stringify(result).includes("secret@example.com"));
 assert.ok(!JSON.stringify(result).includes("sk-proj"));
});
test("Agent on-demand policy and issue recovery details are projected as safe metadata",()=>{
 const agent=projectAgent({status:"idle",lifecycleState:"ready",
   runtimeConfig:{heartbeat:{enabled:true,wakeOnDemand:false,maxConcurrentRuns:1}},
   token:"secret-key"});
 assert.deepEqual(agent,{status:"idle",lifecycle:"ready",
   heartbeatEnabled:true,wakeOnDemand:false,maxConcurrentRuns:1});
 const issue=projectIssue({status:"todo",assigneeAgentId:"hermes",
   executionRunId:null,checkoutRunId:null,
   executionBlocker:{cause:"legacy_execution_requires_reconciliation",
     recoveryActionId:"sensitive",nextAction:"A human must reconcile failed recovery."}});
 assert.equal(issue.hasExecutionBlocker,true);
 assert.equal(issue.blockerCause,"EXECUTION_RECOVERY_HOLD");
 assert.equal(issue.recoveryActionPresent,true);
 assert.ok(!JSON.stringify(issue).includes("sensitive"));
});

test("Resolved no-replay recovery holds remain visible without exposing raw evidence",()=>{
 const action={kind:"active_run_watchdog",status:"resolved",outcome:"blocked",
   evidence:{automaticRecovery:{replay:"blocked",policy:"preserve_without_replay_v1"},
   privateNotes:"CONFIDENTIAL"},
   sourceIssueId:"private-id"};
 const value=projectRecovery(action);
 assert.equal(value.replayBlock,true);
 assert.equal(value.status,"resolved");
 assert.equal(value.replayPolicy,"preserve_without_replay_v1");
 assert.ok(!JSON.stringify(value).includes("CONFIDENTIAL"));
 assert.ok(!JSON.stringify(value).includes("private-id"));
});
