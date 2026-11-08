// Trusted controller, not an agent. Native API credentials never cross its Unix boundary.
import http from 'node:http';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { bindTask, verifyCapability, validateRequest } from './task_control_policy.mjs';

async function main() {
const require = createRequire('/app/server/package.json');
const { createDb, heartbeatRuns, issues } = await import(require.resolve('@paperclipai/db'));
const { eq } = await import(require.resolve('drizzle-orm'));
const identity = JSON.parse(fs.readFileSync('/run/secrets/task-control.json', 'utf8'));
const signingKey = fs.readFileSync('/run/secrets/task-capability.key');
const db = createDb(process.env.DATABASE_URL);
const socket = '/run/task-control/control.sock';
fs.rmSync(socket, { force:true });
const inFlight = new Set();

// A native review interaction is required before an agent may set in_review.
// The idempotency key is deterministic per run so a failed PATCH cannot create duplicates.
function createReviewPath(issueId, runId, summary) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      kind: 'request_confirmation',
      idempotencyKey: 'hermes-submit-result-' + runId,
      title: 'Проверка результата Hermes',
      summary: summary.slice(0, 1000),
      continuationPolicy: 'none',
      payload: {
        version: 1,
        prompt: 'Подтвердите результат работы Hermes или отклоните его для доработки.',
        detailsMarkdown: summary,
        acceptLabel: 'Принять',
        rejectLabel: 'На доработку'
      }
    });
    const req = http.request({
      hostname: '127.0.0.1', port: 3100,
      path: `/api/issues/${issueId}/interactions`, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'Authorization': `Bearer ${identity.token}`,
        'X-Paperclip-Run-Id': runId
      }
    }, response => {
      let result = '';
      response.on('data', chunk => {
        result += chunk;
        if (result.length > 1048576) response.destroy();
      });
      response.on('end', () => {
        if (![200, 201].includes(response.statusCode)) {
          const error = Error('Review request rejected');
          error.safeCode = 'REVIEW_CREATE_REJECTED';
          error.httpStatus = response.statusCode;
          try {
            const value = JSON.parse(result);
            const code = value.code ?? value.details?.code;
            if (typeof code === 'string' && /^[A-Za-z][A-Za-z0-9_]{1,79}$/.test(code))
              error.nativeCode = code;
          } catch {}
          return reject(error);
        }
        try {
          const review = JSON.parse(result);
          if (review.kind !== 'request_confirmation' || review.status !== 'pending' ||
              typeof review.id !== 'string') {
            const error = Error('Review creation unconfirmed');
            error.safeCode = 'REVIEW_CREATE_UNCONFIRMED';
            return reject(error);
          }
          resolve(review.id);
        } catch {
          const error = Error('Review creation response invalid');
          error.safeCode = 'REVIEW_CREATE_RESPONSE_INVALID';
          reject(error);
        }
      });
    });
    req.setTimeout(15000, () => {
      const error = Error('Review API timeout'); error.safeCode = 'REVIEW_API_TIMEOUT';
      req.destroy(error);
    });
    req.on('error', error => {
      const failure = Error('Review API unavailable');
      failure.safeCode = error.safeCode || 'REVIEW_API_UNAVAILABLE';
      reject(failure);
    });
    req.end(data);
  });
}

function apiPatch(issueId, runId, summary) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ status:'in_review', comment:summary });
    const req = http.request({hostname:'127.0.0.1', port:3100,
      path:`/api/issues/${issueId}`, method:'PATCH',
      headers:{'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(data),
        'Authorization':`Bearer ${identity.token}`, 'X-Paperclip-Run-Id':runId}}, response => {
      let body = '';
      response.on('data', b => { body += b; if (body.length > 1048576) response.destroy(); });
      response.on('end', () => {
        if (response.statusCode !== 200) {
          const error = Error('Task update rejected');
          error.safeCode = 'API_REJECTED';
          error.httpStatus = response.statusCode;
          try {
            const value = JSON.parse(body);
            const code = value.code ?? value.details?.code;
            if (typeof code === 'string' && /^[A-Za-z][A-Za-z0-9_]{1,79}$/.test(code)) error.nativeCode = code;
          } catch {}
          return reject(error);
        }
        try {
          const value = JSON.parse(body);
          if (value.status !== 'in_review') { const error = Error('Task update not confirmed'); error.safeCode = 'API_STATUS_UNCONFIRMED'; return reject(error); }
          resolve({status:'in_review', message:'Результат записан. Задача передана на проверку пользователю.'});
        } catch { const error = Error('Task response invalid'); error.safeCode = 'API_RESPONSE_INVALID'; reject(error); }
      });
    });
    req.setTimeout(15000, () => { const error = Error('Task API timeout'); error.safeCode = 'API_TIMEOUT'; req.destroy(error); });
    req.on('error', error => { const failure = Error('Task API unavailable'); failure.safeCode = error.safeCode || 'API_UNAVAILABLE'; reject(failure); });
    req.end(data);
  });
}


// Only native Paperclip can claim the issue; never edit status or lock columns directly.
function nativeCheckout(issueId, runId) {
  return new Promise((resolve,reject)=>{
    const data=JSON.stringify({agentId:identity.agentId,
      expectedStatuses:['todo','backlog','in_progress']});
    const req=http.request({hostname:'127.0.0.1',port:3100,
      path:'/api/issues/'+issueId+'/checkout',method:'POST',
      headers:{'content-type':'application/json','content-length':Buffer.byteLength(data),
        authorization:'Bearer '+identity.token,'X-Paperclip-Run-Id':runId}},
      response=>{
        response.resume();
        response.on('end',()=>{
          if(![200,201].includes(response.statusCode)){
            const error=Error('Native checkout refused');
            error.safeCode='NATIVE_CHECKOUT_REFUSED';error.httpStatus=response.statusCode;
            reject(error);
          }else resolve();
        });
      });
    req.setTimeout(12000,()=>req.destroy(Error('Native checkout timeout')));
    req.on('error',reject);
    req.end(data);
  });
}

// A request_confirmation is NOT permission to send. Only a real human may accept.
// There is intentionally no SMTP, external upload or production-change executor here.
function createOutboundApproval(issueId,runId,requestBody){
  return new Promise((resolve,reject)=>{
    const digest=createHash('sha256').update(JSON.stringify([
      runId,requestBody.action,requestBody.destination,requestBody.subject,requestBody.details
    ])).digest('hex').slice(0,36);
    const details=[
      'Type: '+requestBody.action,
      'Destination: '+requestBody.destination,
      'Subject: '+requestBody.subject,
      'Proposed exact content or change:',
      requestBody.details,
      '',
      'Approval does not automatically execute the action. A separate trusted executor is required.'
    ].join('\n');
    const payload=JSON.stringify({
      kind:'request_confirmation',resolverPolicy:'human_only',
      continuationPolicy:'wake_assignee',
      idempotencyKey:'hermes-outbound-'+digest,
      title:'Hermes — разрешить внешнее действие?',
      summary:'Разрешение требуется до любого внешнего отправления или изменения.',
      payload:{version:1,prompt:'Одобрить именно это действие?',
        detailsMarkdown:details,acceptLabel:'Одобрить',rejectLabel:'Отклонить'}
    });
    const req=http.request({hostname:'127.0.0.1',port:3100,
      path:'/api/issues/'+issueId+'/interactions',method:'POST',
      headers:{'content-type':'application/json','content-length':Buffer.byteLength(payload),
        authorization:'Bearer '+identity.token,'X-Paperclip-Run-Id':runId}},
      response=>{
        let body='';response.on('data',chunk=>{body+=chunk;if(body.length>131072)response.destroy()});
        response.on('end',()=>{
          if(![200,201].includes(response.statusCode)){
            const error=Error('Native approval request refused');
            error.safeCode='APPROVAL_REQUEST_REFUSED';error.httpStatus=response.statusCode;
            return reject(error);
          }
          try{
            const interaction=JSON.parse(body);
            if(interaction.kind!=='request_confirmation'||
               typeof interaction.id!=='string')throw Error('Invalid interaction');
            resolve({status:'awaiting_human_approval',interactionId:interaction.id,
              executed:false});
          }catch{
            const error=Error('Interaction response invalid');
            error.safeCode='APPROVAL_CONFIRMATION_INVALID';reject(error);
          }
        });
      });
    req.setTimeout(12000,()=>req.destroy(Error('Approval API timeout')));
    req.on('error',reject);
    req.end(payload);
  });
}

const server = http.createServer(async (req, res) => {
  const reply = (status, data) => { res.writeHead(status, {'Content-Type':'application/json'}); res.end(JSON.stringify(data)); };
  if (req.method === 'GET' && req.url === '/health') return reply(200,{status:'ok'});
  let runId;
  let acquired = false;
  let stage = "request";
  try {
    if (req.method !== 'POST' || !['/current','/begin','/submit','/approve-request'].includes(req.url)) return reply(403,{error:'Operation disabled'});
    let raw = '';
    for await (const b of req) { raw += b; if (raw.length > 65536) throw Error('Request too large'); }
    const body = JSON.parse(raw);
    validateRequest(req.url, body);
    if (req.url === '/submit' && body.summary.includes(body.capability)) throw Error('Capability cannot be published');
    stage = "grant";
    runId = verifyCapability(signingKey, body.capability);
    if (inFlight.has(runId)) return reply(409, {error:'Run request already active'});
    inFlight.add(runId);
    acquired = true;
    stage = 'run_lookup';
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id,runId)).limit(1);
    if (!run) { const error = Error('Run not found'); error.safeCode = 'RUN_NOT_FOUND'; throw error; }
    stage = 'issue_lookup';
    const issueId = run.issueId ?? run.contextSnapshot?.issueId ?? run.contextSnapshot?.taskId;
    if (typeof issueId !== 'string') { const error = Error('No task binding'); error.safeCode = 'TASK_BINDING_MISSING'; throw error; }
    const [issue] = await db.select().from(issues).where(eq(issues.id,issueId)).limit(1);
    stage = 'binding';
    bindTask(run, issue, identity, {
      requireLock:req.url==='/submit',
      allowTodo:req.url==='/current'||req.url==='/begin',
      allowNativeCheckout:req.url==='/begin'
    });
    if (req.url === '/current') return reply(200,{id:issue.id, identifier:issue.identifier, title:issue.title, status:issue.status, agentId:identity.agentId, companyId:identity.companyId});
    if(req.url==='/begin'){
      stage='native_checkout';
      await nativeCheckout(issue.id,runId);
      stage='checkout_verify';
      const [checked]=await db.select().from(issues).where(eq(issues.id,issue.id)).limit(1);
      bindTask(run,checked,identity,{requireLock:true});
      return reply(200,{status:'in_progress',identifier:checked.identifier,
        checkoutConfirmed:true});
    }
    if(req.url==='/approve-request'){
      stage='approval_request';
      return reply(200,await createOutboundApproval(issue.id,runId,body));
    }
    stage = 'review_create';
    await createReviewPath(issue.id, runId, body.summary);
    stage = 'api';
    return reply(200, await apiPatch(issue.id,runId,body.summary));
  } catch (error) {
    const event = {event:'task_control_refused',stage,
      code:error.safeCode || (stage === 'run_lookup' || stage === 'issue_lookup' ? 'DB_LOOKUP_FAILED' : 'TASK_OPERATION_REFUSED'),
      httpStatus:error.httpStatus || null, nativeCode:error.nativeCode || null};
    console.log(JSON.stringify(event));
    return reply(403,{error:'Task operation refused; no permission or task state changed',code:event.code});
  } finally {
    if (acquired) inFlight.delete(runId);
  }
});
server.requestTimeout = 20000;
server.headersTimeout = 10000;
server.listen(socket, () => { fs.chmodSync(socket, 0o600); console.log('Scoped task control ready'); });

}
main().catch(() => { console.error('Task controller startup failed; secret output suppressed'); process.exit(1); });
