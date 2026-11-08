import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

if (!process.env.CRM_SMOKE_FIXTURE) throw Error('Provide an explicitly seeded local fixture ID file');
const fixture = JSON.parse(readFileSync(process.env.CRM_SMOKE_FIXTURE, 'utf8'));
const project = new URL('../..', import.meta.url).pathname;
const docker = ['--host=unix:///var/run/docker.sock', 'compose', '--project-directory', project, 'exec', '-T', 'api', 'python', '-c'];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true, args: process.env.CI ? ['--no-sandbox'] : [] });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const received=[];let welcomeResolve,noticeResolve;const welcome=new Promise(resolve=>welcomeResolve=resolve);const notice=new Promise(resolve=>noticeResolve=resolve);
page.on('websocket',socket=>socket.on('framereceived',frame=>{try{const event=JSON.parse(String(frame.payload));received.push(event.type);if(event.type==='connected')welcomeResolve();if(event.type==='notification'&&event.message_id===fixture.message_id)noticeResolve();}catch{}}));
const timed = (promise, ms, message) => { let timer; return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(message + '; frames: ' + received.join(','))), ms); })]).finally(() => clearTimeout(timer)); };
try {
  await page.goto(process.env.CRM_REAL_BASE_URL || 'http://localhost:3000/mail-crm');
  await page.locator('.connection.online').waitFor();
  await timed(welcome,15000,'No websocket welcome');
  const trigger = `import sys,asyncio
from uuid import UUID
from app.core.db import Session
from app.models import Message
from app.workers.tasks_process import process_new_message
async def prepare():
    async with Session() as session:
        message=await session.get(Message,UUID(sys.argv[1]))
        message.processing_state='pending'
        await session.commit()
asyncio.run(prepare())
process_new_message.delay(sys.argv[1])
`;
  execFileSync('docker', [...docker, trigger, fixture.message_id], { stdio: 'pipe' });
  await timed(notice,60000,'No live notification');
  assert.equal(errors.length,0,errors.join('\n')); 
  await page.goto((process.env.CRM_REAL_BASE_URL || 'http://localhost:3000/mail-crm') + '/?message=' + fixture.message_id);
  await page.locator('.mail-body').waitFor();
  let data = await (await page.request.get((process.env.CRM_REAL_BASE_URL || 'http://localhost:3000/mail-crm') + '/api/messages/' + fixture.message_id)).json();
  assert.equal(data.category, 'other');
  assert.equal(data.is_read, false, 'Classifier must preserve unread');
  assert.equal(data.needs_reply, true);
  const saved=page.waitForResponse(response=>response.url().endsWith('/messages/'+fixture.message_id+'/replied')&&response.request().method()==='POST');
  await page.getByRole('button', { name: 'Отметить: ответил', exact: true }).click();
  assert.equal((await saved).status(),204);
  data = await (await page.request.get((process.env.CRM_REAL_BASE_URL || 'http://localhost:3000/mail-crm') + '/api/messages/' + fixture.message_id)).json();
  assert(data.replied_at); assert.equal(data.needs_reply, false);
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log(JSON.stringify({ noLoginRequired: 'passed', realCeleryClassificationFallback: 'passed', redisWebsocket: 'passed', realNotificationFrame: true, unreadPreserved: 'passed', repliedAt: 'passed', pageErrors: 0 }));
} finally {
  await browser.close();
}
