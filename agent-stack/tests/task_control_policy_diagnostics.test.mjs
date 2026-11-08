import test from 'node:test';
import assert from 'node:assert/strict';
import { bindTask } from '../task_control_policy.mjs';

const id = '11111111-1111-4111-8111-111111111111';
const issueId = '22222222-2222-4222-8222-222222222222';
const otherRun = '33333333-3333-4333-8333-333333333333';
const agentId = '44444444-4444-4444-8444-444444444444';
const companyId = '55555555-5555-4555-8555-555555555555';
const identity = { agentId, companyId };
const makeRun = () => ({ id, issueId, status:'running', agentId, companyId });
const makeIssue = () => ({ id:issueId, companyId, assigneeAgentId:agentId,
  status:'in_progress', executionRunId:id, checkoutRunId:null });

const cases = [
  ['TASK_BINDING_MISSING', () => ({run:{...makeRun(), issueId:null, contextSnapshot:null}})],
  ['TASK_RUN_INACTIVE', () => ({run:{...makeRun(), status:'succeeded'}})],
  ['TASK_RUN_IDENTITY', () => ({run:{...makeRun(), agentId:otherRun}})],
  ['TASK_ISSUE_IDENTITY', () => ({issue:{...makeIssue(), companyId:otherRun}})],
  ['TASK_ASSIGNEE_MISMATCH', () => ({issue:{...makeIssue(), assigneeAgentId:otherRun}})],
  ['TASK_NOT_IN_PROGRESS', () => ({issue:{...makeIssue(), status:'todo'}})],
  ['TASK_RUN_LOCK_MISSING', () => ({issue:{...makeIssue(), executionRunId:null}})],
  ['TASK_RUN_LOCK_CONFLICT', () => ({issue:{...makeIssue(), checkoutRunId:otherRun}})],
];
test('valid own running task is allowed', () => {
  assert.equal(bindTask(makeRun(), makeIssue(), identity), issueId);
});
for (const [code, mutate] of cases) {
  test('safe refusal code: ' + code, () => {
    const {run = makeRun(), issue = makeIssue()} = mutate();
    assert.throws(() => bindTask(run, issue, identity),
      error => error.safeCode === code && !JSON.stringify(error).includes(id));
  });
}
