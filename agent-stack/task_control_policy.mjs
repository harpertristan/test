import { createHmac, timingSafeEqual } from 'node:crypto';

function refuse(code) { const error = Error('Task policy refused'); error.safeCode = code; throw error; }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function verifyCapability(key, capability, now = Math.floor(Date.now() / 1000)) {
  if (typeof capability !== 'string' || capability.length > 160) refuse('GRANT_FORMAT_OR_SIGNATURE');
  const [runId, expiryText, signature, extra] = capability.split(':');
  if (extra !== undefined || !UUID.test(runId || '') || !/^\d{10}$/.test(expiryText || '') ||
      !/^[0-9a-f]{64}$/.test(signature || '')) refuse('GRANT_FORMAT_OR_SIGNATURE');
  const expiry = Number(expiryText);
  if (expiry < now || expiry > now + 1800) refuse('GRANT_EXPIRED');
  const expected = createHmac('sha256', key).update(`${runId}:${expiry}`).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) refuse('GRANT_FORMAT_OR_SIGNATURE');
  return runId;
}

export function bindTask(run, issue, identity, {requireLock = true, allowTodo = false} = {}) {
  const issueId = run?.issueId ?? run?.contextSnapshot?.issueId ?? run?.contextSnapshot?.taskId;
  if (!UUID.test(issueId || '')) refuse('TASK_BINDING_MISSING');
  if (!run || run.status !== 'running') refuse('TASK_RUN_INACTIVE');
  if (run.agentId !== identity.agentId || run.companyId !== identity.companyId)
    refuse('TASK_RUN_IDENTITY');
  if (!issue || issue.id !== issueId || issue.companyId !== identity.companyId)
    refuse('TASK_ISSUE_IDENTITY');
  if (issue.assigneeAgentId !== identity.agentId) refuse('TASK_ASSIGNEE_MISMATCH');
  if (issue.status !== 'in_progress' && !(allowTodo && issue.status === 'todo')) refuse('TASK_NOT_IN_PROGRESS');
  const locks = [issue.executionRunId, issue.checkoutRunId].filter(Boolean);
  // Never allow a different active run to impersonate the owner, even for reads.
  if (locks.some(id => id !== run.id)) refuse('TASK_RUN_LOCK_CONFLICT');
  // A conversation-triggered Paperclip run may have a signed run identity and
  // exact issue binding without creating a checkout lock. Reading scoped data
  // is allowed for that active assigned run; review/status writes stay locked.
  if (requireLock && !locks.includes(run.id)) refuse('TASK_RUN_LOCK_MISSING');
  return issueId;
}

export function validateRequest(path, body) {
  if (!['/current', '/begin', '/submit'].includes(path) || !body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some(k => !['capability', 'summary'].includes(k))) throw Error('Invalid request');
  if (path === '/submit' && (typeof body.summary !== 'string' || !body.summary.trim() || body.summary.length > 8000))
    throw Error('A short result is required');
}
