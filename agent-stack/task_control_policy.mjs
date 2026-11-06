import { createHmac, timingSafeEqual } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function verifyCapability(key, capability, now = Math.floor(Date.now() / 1000)) {
  if (typeof capability !== 'string' || capability.length > 160) throw Error('Invalid capability');
  const [runId, expiryText, signature, extra] = capability.split(':');
  if (extra !== undefined || !UUID.test(runId || '') || !/^\d{10}$/.test(expiryText || '') ||
      !/^[0-9a-f]{64}$/.test(signature || '')) throw Error('Invalid capability');
  const expiry = Number(expiryText);
  if (expiry < now || expiry > now + 1800) throw Error('Expired capability');
  const expected = createHmac('sha256', key).update(`${runId}:${expiry}`).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) throw Error('Invalid capability');
  return runId;
}

export function bindTask(run, issue, identity) {
  const issueId = run?.issueId ?? run?.contextSnapshot?.issueId ?? run?.contextSnapshot?.taskId;
  if (!UUID.test(issueId || '') || !run || run.status !== 'running' ||
      run.agentId !== identity.agentId || run.companyId !== identity.companyId ||
      !issue || issue.id !== issueId || issue.companyId !== identity.companyId ||
      issue.assigneeAgentId !== identity.agentId || issue.status !== 'in_progress' ||
      ![issue.executionRunId,issue.checkoutRunId].some(id => id === run.id) ||
      [issue.executionRunId,issue.checkoutRunId].some(id => id && id !== run.id)) throw Error('Task is not owned by this active run');
  return issueId;
}

export function validateRequest(path, body) {
  if (!['/current', '/submit'].includes(path) || !body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some(k => !['capability', 'summary'].includes(k))) throw Error('Invalid request');
  if (path === '/submit' && (typeof body.summary !== 'string' || !body.summary.trim() || body.summary.length > 8000))
    throw Error('A short result is required');
}
