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

test('verified conversation run can read its assigned task with no lock, never submit or cross issue', () => {
  const chatIssue = {...issue, executionRunId: null, checkoutRunId: null};
  assert.equal(bindTask(run,chatIssue,identity,{requireLock:false}),issueId);
  assert.throws(()=>bindTask(run,chatIssue,identity), /Task policy refused/);
  assert.throws(()=>bindTask({...run,status:'succeeded'},chatIssue,identity,{requireLock:false}));
  assert.throws(()=>bindTask({...run,issueId:runId},chatIssue,identity,{requireLock:false}));
  assert.throws(()=>bindTask({...run,agentId:'other'},chatIssue,identity,{requireLock:false}));
  assert.throws(()=>bindTask(run,{...chatIssue,status:'blocked'},identity,{requireLock:false}));
  assert.throws(()=>bindTask(run,{...chatIssue,checkoutRunId:issueId},identity,{requireLock:false}));
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

test('accepts native checkout lock and rejects conflicting execution ownership', () => {
  assert.equal(bindTask(run,{...issue,executionRunId:null,checkoutRunId:runId},identity),issueId);
  assert.throws(() => bindTask(run,{...issue,executionRunId:null,checkoutRunId:null},identity));
  assert.throws(() => bindTask(run,{...issue,executionRunId:runId,checkoutRunId:issueId},identity));
});

test('Native workflow: signed running agent can inspect todo, but cannot read data or submit before checkout',()=>{
 const todo={...issue,status:"todo",checkoutRunId:null,executionRunId:null};
 assert.equal(bindTask(run,todo,identity,{requireLock:false,allowTodo:true}),issueId);
 assert.throws(()=>bindTask(run,todo,identity,{requireLock:false}));
 assert.throws(()=>bindTask(run,todo,identity,{requireLock:true}));
 const claimed={...todo,status:"in_progress",checkoutRunId:runId};
 assert.equal(bindTask(run,claimed,identity),issueId);
 assert.throws(()=>bindTask(run,{...claimed,checkoutRunId:issueId},identity));
});
test('Native checkout and human approval requests accept exact shapes only',()=>{
 validateRequest('/current',{capability});
 validateRequest('/begin',{capability});
 validateRequest('/approve-request',{capability,action:'email_send',
  destination:'compliance@example.com',subject:'Bank question',details:'Please verify the UK LTD requirements.'});
 for(const values of [
  ['/begin',{capability,extra:'arbitrary'}],
  ['/approve-request',{capability,action:'email_send',destination:'a',subject:'b',details:'c',autoSend:true}],
  ['/approve-request',{capability,action:'wire_transfer',destination:'a',subject:'b',details:'c'}],
  ['/approve-request',{capability,action:'email_send',destination:'a',subject:'b',details:''}],
  ['/submit',{capability,summary:'x',url:'https://bad.example'}],
 ])assert.throws(()=>validateRequest(values[0],values[1]));
});

test('Only native checkout may reclaim an inactive stale run lock; normal reads stay denied',()=>{
 const stale={...issue,status:'in_progress',checkoutRunId:issueId,executionRunId:null};
 assert.throws(()=>bindTask(run,stale,identity,{requireLock:false}));
 assert.equal(bindTask(run,stale,identity,{requireLock:false,allowNativeCheckout:true}),issueId);
 assert.throws(()=>bindTask(run,stale,identity,{requireLock:true}));
 const backlog={...issue,status:'backlog',checkoutRunId:null,executionRunId:null};
 assert.equal(bindTask(run,backlog,identity,{requireLock:false,allowTodo:true,allowNativeCheckout:true}),issueId);
 assert.throws(()=>bindTask(run,backlog,identity,{requireLock:false}));
});
