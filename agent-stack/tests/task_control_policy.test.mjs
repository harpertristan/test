import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyCapability, bindTask, validateRequest } from '../task_control_policy.mjs';
const runId = '11111111-1111-4111-8111-111111111111';
const issueId = '22222222-2222-4222-8222-222222222222';
const key = Buffer.from('synthetic-test-key');
const value = `${runId}:1800001800`;
const capability = value + ':' + createHmac('sha256',key).update(value).digest('hex');
const identity = {agentId:'hermes',companyId:'own-company'};
const run = {id:runId,issueId,status:'running',...identity};
const issue = {id:issueId,companyId:'own-company',assigneeAgentId:'hermes',status:'in_progress',executionRunId:runId};

test('signed grant verifies only for its original run and limited lifetime', () => {
  assert.equal(verifyCapability(key,capability,1800000000),runId);
  for (const candidate of [capability.replace(runId,issueId), capability+'x', 'invalid'])
    assert.throws(() => verifyCapability(key,candidate,1800000000));
  assert.throws(() => verifyCapability(key,capability,1800001801));
  assert.throws(() => verifyCapability(key,capability,1799999999));
  assert.throws(() => verifyCapability(Buffer.from('other-key'),capability,1800000000));
});

test('binds to active database run and its assigned current task', () => {
  assert.equal(bindTask(run,issue,identity),issueId);
  for (const changed of [
    {...issue,id:runId}, {...issue,companyId:'other-company'},
    {...issue,assigneeAgentId:'other-agent'}, {...issue,executionRunId:issueId},
    {...issue,status:'done'}, {...issue,status:'in_review'},
  ]) assert.throws(() => bindTask(run,changed,identity));
  for (const changed of [ {...run,status:'succeeded'}, {...run,agentId:'other'},
                          {...run,companyId:'other'}, {...run,issueId:runId} ])
    assert.throws(() => bindTask(changed,issue,identity));
});

test('no requested status, task id, URL, approval or external action is accepted', () => {
  validateRequest('/submit',{capability,summary:'Результат готов для проверки'});
  for (const body of [{capability,summary:'x',status:'done'},
                      {capability,summary:'x',taskId:issueId},
                      {capability,summary:'x',url:'https://example.com'},
                      {capability,summary:''}]) assert.throws(() => validateRequest('/submit',body));
  for (const route of ['/send-mail','/publish','/approve','https://example.com/'])
    assert.throws(() => validateRequest(route,{capability,summary:'x'}));
});
