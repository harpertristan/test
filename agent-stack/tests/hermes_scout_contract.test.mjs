// Cross-language, no-network integration contract for task-bound Hermes read access.
// Runs against synthetic identities and grants; never touches production Paperclip.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { verifyCapability, bindTask } from '../task_control_policy.mjs';
import { authorizeReadScope } from '../three_tool_read_scope.mjs';
import { resolveReadOperation } from '../three_tool_read_policy.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const runId = '11111111-1111-4111-8111-111111111111';
const issueId = '22222222-2222-4222-8222-222222222222';
const companyId = 'company-test';
const agentId = 'agent-test';
const key = Buffer.from('synthetic-cross-language-test-only');
const now = 1800000000;
const identity = { agentId, companyId };
const run = {
  id: runId, issueId, status: 'running', agentId, companyId,
  contextSnapshot: { issueId, taskId: issueId },
};
const issue = {
  id: issueId, identifier: 'WOR-TEST', companyId, assigneeAgentId: agentId,
  status: 'in_progress', executionRunId: runId, checkoutRunId: null,
};
const policy = { version: 1, grants: {
  [issueId]: { issueIdentifier: 'WOR-TEST', operations: ['scout_findings'],
    workspaceWide: true, mailConsent: false, companyIds: [] },
} };

function pythonCapability() {
  const script = [
    'import sys',
    'sys.path.insert(0, sys.argv[1])',
    'from task_capability import issue',
    'print(issue(bytes.fromhex(sys.argv[2]), sys.argv[3], now=int(sys.argv[4])))',
  ].join('\n');
  const result = spawnSync('python3', ['-c', script, root, key.toString('hex'), runId, String(now)], {
    encoding: 'utf8', timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr || 'Python grant generation failed');
  return result.stdout.trim();
}

test('Python signed grant -> JavaScript verification -> active task binding -> authorized Scout route', () => {
  const capability = pythonCapability();
  assert.equal(verifyCapability(key, capability, now), runId);
  assert.equal(bindTask(run, issue, identity), issueId);
  assert.equal(authorizeReadScope(policy, issue, 'scout_findings', {}), true);
  assert.deepEqual(resolveReadOperation('scout_findings', {}),
    { service: 'scout', method: 'GET', path: '/api/findings' });
});

test('no access before checkout, after review, after run completion or with another run lock', () => {
  for (const candidate of [
    { ...issue, status: 'todo' },
    { ...issue, status: 'in_review' },
    { ...issue, executionRunId: null, checkoutRunId: null },
    { ...issue, executionRunId: issueId },
  ]) assert.throws(() => bindTask(run, candidate, identity));
  assert.throws(() => bindTask({ ...run, status: 'succeeded' }, issue, identity));
  assert.throws(() => bindTask({ ...run, id: issueId }, issue, identity));
});

test('read-only Scout access supports active conversation runs without a checkout lock', () => {
  const chatIssue={...issue,executionRunId:null,checkoutRunId:null};
  const capability=pythonCapability();
  assert.equal(verifyCapability(key,capability,now),runId);
  assert.equal(bindTask(run,chatIssue,identity,{requireLock:false}),issueId);
  assert.equal(authorizeReadScope(policy,chatIssue,'scout_findings',{}),true);
  assert.throws(()=>bindTask(run,chatIssue,identity,{requireLock:true}));
});
test('task scope blocks unexpected operations, wrong task and mail without consent', () => {
  assert.throws(() => authorizeReadScope(policy, issue, 'scout_candidates', {}));
  assert.throws(() => authorizeReadScope(policy, { ...issue, identifier: 'WOR-OTHER' }, 'scout_findings', {}));
  const mailPolicy = { version: 1, grants: {
    [issueId]: { ...policy.grants[issueId], operations: ['mail_messages'] },
  } };
  assert.throws(() => authorizeReadScope(mailPolicy, issue, 'mail_messages', {}));
  assert.throws(() => resolveReadOperation('scout_findings', { url: 'https://example.com' }));
});

test('grant cannot be used for another run or signed with a different key', () => {
  const capability = pythonCapability();
  assert.throws(() => verifyCapability(key, capability.replace(runId, issueId), now));
  assert.throws(() => verifyCapability(Buffer.from('different-key'), capability, now));
  assert.throws(() => verifyCapability(key, capability, now + 1801));
});
