// Integration check against synthetic company data only. Requires a local Chromium.
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {once} from 'node:events';
import {createApp} from '../server.js';
import {hashPassword} from '../lib/security.js';

const temp=mkdtempSync(join(tmpdir(),'assistant-browser-'));
const origin='http://127.0.0.1:3197';
const {app,db}=createApp({dataDir:join(temp,'data'),origin,ai:{}});
db.prepare('INSERT INTO users(username,password) VALUES(?,?)').run('browser-test',hashPassword('synthetic-test-password-only'));
app.get('/fixture',(_req,res)=>res.type('html').send('<!doctype html><html><head><title>Test bank form</title></head><body><h1>Company registration</h1><form><label>Company name<input name="company_name"></label><label>Country of tax residence<input name="tax_residence"></label><label>Password<input type="password" name="password"></label><button type="submit">Submit</button></form></body></html>'));
const server=app.listen(3197,'127.0.0.1');await once(server,'listening');
let browser;
try {
  browser=await chromium.launchPersistentContext(join(temp,'browser'),{executablePath:process.env.CHROMIUM_PATH||(existsSync('/usr/lib/chromium/chromium')?'/usr/lib/chromium/chromium':'/usr/bin/chromium'),headless:process.env.HEADED!=='1',ignoreDefaultArgs:['--disable-extensions'],args:['--no-sandbox','--enable-unsafe-extension-debugging']});
  const protocol=await browser.browser().newBrowserCDPSession();
  await protocol.send('Extensions.loadUnpacked',{path:resolve('extension')});
  browser.setDefaultTimeout(12000);
  const watchdog=setTimeout(()=>{console.error('Browser check exceeded 90 seconds.');void browser.close();},90000);watchdog.unref();
  const errors=[];browser.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
  const page=await browser.newPage();await page.goto(origin);
  await page.locator('#loginForm [name=username]').fill('browser-test');await page.locator('#loginForm [name=password]').fill('synthetic-test-password-only');await page.locator('#loginForm button').click();await page.locator('#workspace').waitFor({state:'visible'});
  await page.locator('#companyForm [name=name]').fill('Example Limited');await page.locator('#companyForm button').click();await page.locator('#companyWorkspace').waitFor({state:'visible'});
  await page.getByText('Добавить сведения из блокнота или вручную',{exact:true}).click();await page.locator('#noteForm [name=title]').fill('Verified director note');await page.locator('#noteForm [name=text]').fill('Company name: Example Limited\n<script>window.documentCompromised=true</script>');await page.locator('#noteForm button').click();await page.locator('#facts strong').filter({hasText:/^Example Limited$/}).waitFor();
  assert.equal(await page.evaluate(()=>Boolean(window.documentCompromised)),false);
  await page.locator('#reviewConfirmed').check();await page.locator('#approveReview').click();await page.locator('#reviewStatus').filter({hasText:'подтверждена'}).waitFor();
  await page.locator('#createToken').click();await page.locator('#tokenBox').waitFor({state:'visible'});const token=await page.locator('#tokenValue').inputValue();assert.ok(token);
  console.log('PASS: web workspace and verified source.');
  const worker=browser.serviceWorkers()[0]||await browser.waitForEvent('serviceworker');const extensionId=new URL(worker.url()).host;
  console.log('PASS: extension service worker loaded.');
  const options=await browser.newPage();await options.goto(`chrome-extension://${extensionId}/options.html`);await options.locator('#origin').fill(origin);await options.locator('#token').fill(token);await options.locator('form button').click();await options.getByText('Подключено:',{exact:false}).waitFor({timeout:15000});
  console.log('PASS: extension connected to authenticated server.');
  const bank=await browser.newPage();await bank.goto(origin+'/fixture');
  await worker.evaluate(async base=>{const tabs=await chrome.tabs.query({});const tab=tabs.find(t=>t.url===base+'/fixture');await chrome.scripting.executeScript({target:{tabId:tab.id},files:['panel.js']});},origin);
  // The panel deliberately uses a closed shadow root. Test its controls through
  // the extension's isolated world, leaving page scripts unable to read it.
  const tabId=await worker.evaluate(async base=>(await chrome.tabs.query({})).find(t=>t.url===base+'/fixture').id,origin);
  // A test-only isolated-world probe captures the root by toggling a second clean
  // page injection. Production code never exposes panel data to page JavaScript.
  await bank.goto(origin+'/fixture');
  await worker.evaluate(async tabId=>{
    await chrome.scripting.executeScript({target:{tabId},func:()=>{const original=Element.prototype.attachShadow;Element.prototype.attachShadow=function(options){const root=original.call(this,options);if(this.hasAttribute('data-registration-assistant'))globalThis.__testPanelRoot=root;return root;};}});
    await chrome.scripting.executeScript({target:{tabId},files:['panel.js']});
  },tabId);
  async function panelEval(action){return worker.evaluate(async ({tabId,action})=>{const [result]=await chrome.scripting.executeScript({target:{tabId},func:action=>{
    const root=globalThis.__testPanelRoot;
    if(action==='ready')return root?.querySelector('select').options.length===2;
    if(action==='select'){const select=root.querySelector('select');select.selectedIndex=1;select.dispatchEvent(new Event('change'));return;}
    if(action==='hasInsert')return [...root.querySelectorAll('button')].some(b=>b.textContent==='Вставить в это поле');
    if(action==='insert')return [...root.querySelectorAll('button')].find(b=>b.textContent==='Вставить в это поле').click();
    if(action==='correct'){const form=root.querySelector('.correction-form');form.querySelector('textarea').value='This question needs a different company name. Ask before inserting.';form.dispatchEvent(new Event('submit',{cancelable:true}));return;}
    if(action==='corrected')return root.textContent.includes('Для этого поля сохранено исправление');
    if(action==='dynamic')return root.textContent.includes('Company website');
    return false;
  },args:[action]});return result.result;},{tabId,action});}
  const wait=async fn=>{for(let i=0;i<80;i++){if(await fn())return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Panel condition timed out');};
  await wait(()=>panelEval('ready'));
  await panelEval('select');
  await wait(()=>panelEval('hasInsert'));
  await panelEval('insert');
  await bank.locator('[name=company_name]').waitFor({state:'visible'});
  await wait(async()=>await bank.locator('[name=company_name]').inputValue()==='Example Limited');
  assert.equal(await bank.locator('[name=tax_residence]').inputValue(),'');assert.equal(await bank.locator('[name=password]').inputValue(),'');assert.equal(bank.url(),origin+'/fixture');
  await panelEval('correct');
  await wait(()=>panelEval('corrected'));
  assert.equal(await panelEval('hasInsert'),false);
  await bank.evaluate(()=>{const label=document.createElement('label');label.textContent='Company website';const input=document.createElement('input');input.name='website';label.append(input);document.querySelector('form').prepend(label);});
  await wait(()=>panelEval('dynamic'));
  await page.bringToFront();mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/workspace.png',fullPage:true});
  clearTimeout(watchdog);assert.deepEqual(errors,[]);console.log('PASS: login, company, source verification, XSS resistance, real extension connection, explicit insertion, sensitive-field exclusion, correction memory and live DOM update.');
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));db.close();rmSync(temp,{recursive:true,force:true});}
