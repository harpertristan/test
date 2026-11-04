// Browser UI check with a simulated extension runtime. No extension installation
// is attempted; real Dolphin/extension installation is a separate check.
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {once} from 'node:events';
import {createApp} from '../server.js';
import {hashPassword} from '../lib/security.js';

const temp=mkdtempSync(join(tmpdir(),'assistant-browser-')),origin='http://127.0.0.1:3197';
const {app,db}=createApp({dataDir:join(temp,'data'),origin,ai:{}});
db.prepare('INSERT INTO users(username,password) VALUES(?,?)').run('browser-test',hashPassword('synthetic-test-password-only'));
app.get('/fixture',(_req,res)=>res.type('html').send('<!doctype html><html><head><title>Test bank form</title></head><body><h1>Company registration</h1><form><label>Company name<input name="company_name"></label><label>Country of tax residence<input name="tax_residence"></label><label>Password<input type="password" name="password"></label><button type="submit">Submit</button></form></body></html>'));
app.get('/fixture-panel.js',(_req,res)=>res.sendFile(resolve('extension/panel.js')));
const server=app.listen(3197,'127.0.0.1');await once(server,'listening');let browser;
try{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const context=await browser.newContext(),errors=[];context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  const page=await context.newPage();page.setDefaultTimeout(10000);await page.goto(origin);
  await page.locator('#loginForm [name=username]').fill('browser-test');await page.locator('#loginForm [name=password]').fill('synthetic-test-password-only');await page.locator('#loginForm button').click();await page.locator('#workspace').waitFor({state:'visible'});
  await page.locator('#companyForm [name=name]').fill('Example Limited');await page.locator('#companyForm button').click();await page.locator('#companyWorkspace').waitFor({state:'visible'});
  await page.locator('summary').click();await page.locator('#noteForm [name=title]').fill('Verified director note');await page.locator('#noteForm [name=text]').fill('Company name: Example Limited\n<script>window.documentCompromised=true</script>');await page.locator('#noteForm button').click();await page.locator('#documentText').filter({hasText:'Company name: Example Limited'}).waitFor();
  assert.equal(await page.evaluate(()=>Boolean(window.documentCompromised)),false);
  await page.locator('#factKey').selectOption('company_name');await page.locator('#factForm [name=value]').fill('Example Limited');await page.locator('#factForm [name=quote]').fill('Company name: Example Limited');await page.locator('#factForm [name=confirmed]').check();await page.locator('#factForm button:not([type=button])').click();await page.locator('.fact strong').filter({hasText:'Example Limited'}).waitFor();
  await page.locator('#createToken').click();await page.locator('#tokenBox').waitFor({state:'visible'});const token=await page.locator('#tokenValue').inputValue();
  const bank=await context.newPage();
  await bank.addInitScript(({token,origin})=>{
    const original=Element.prototype.attachShadow;
    Element.prototype.attachShadow=function(options){const shadow=original.call(this,options);if(this.hasAttribute('data-registration-assistant'))window.__testPanelRoot=shadow;return shadow;};
    window.chrome={runtime:{sendMessage:async message=>{
      if(message.type==='openSettings')return {ok:true};
      try{
        const response=await fetch(origin+'/api'+message.path,{method:message.method||'GET',credentials:'omit',headers:{Authorization:'Bearer '+token,...(message.body?{'Content-Type':'application/json'}:{})},body:message.body?JSON.stringify(message.body):undefined});
        const data=await response.json();return response.ok?{ok:true,data}:{ok:false,error:data.error};
      }catch(error){return {ok:false,error:error.message};}
    }}};
  },{token,origin});
  await bank.goto(origin+'/fixture');await bank.addScriptTag({url:origin+'/fixture-panel.js'});
  await bank.waitForFunction(()=>window.__testPanelRoot?.querySelector('select').options.length===2);
  await bank.evaluate(()=>{const select=window.__testPanelRoot.querySelector('select');select.selectedIndex=1;select.dispatchEvent(new Event('change'));});
  await bank.waitForFunction(()=>[...window.__testPanelRoot.querySelectorAll('button')].some(b=>b.textContent==='Вставить в это поле'));
  await bank.evaluate(()=>[...window.__testPanelRoot.querySelectorAll('button')].find(b=>b.textContent==='Вставить в это поле').click());
  await bank.waitForFunction(()=>document.querySelector('[name=company_name]').value==='Example Limited');
  assert.equal(await bank.locator('[name=tax_residence]').inputValue(),'');assert.equal(await bank.locator('[name=password]').inputValue(),'');assert.equal(bank.url(),origin+'/fixture');
  await bank.evaluate(()=>{const form=window.__testPanelRoot.querySelector('.correction-form');form.querySelector('textarea').value='This question needs a different company name. Ask before inserting.';form.dispatchEvent(new Event('submit',{cancelable:true}));});
  await bank.waitForFunction(()=>window.__testPanelRoot.textContent.includes('Для этого поля сохранено исправление'));
  assert.equal(await bank.evaluate(()=>[...window.__testPanelRoot.querySelectorAll('button')].some(b=>b.textContent==='Вставить в это поле')),false);
  await bank.evaluate(()=>{const label=document.createElement('label');label.textContent='Company website';const input=document.createElement('input');input.name='website';label.append(input);document.querySelector('form').prepend(label);});
  await bank.waitForFunction(()=>window.__testPanelRoot.textContent.includes('Company website'));
  // The manual picker requires acknowledgement and exposes the exact source.
  assert.equal(await bank.evaluate(()=>Boolean(window.__testPanelRoot.querySelector('input[type=checkbox][required]'))),true);
  await bank.evaluate(()=>{const label=document.createElement('label');label.textContent='Business entity legal designation';const input=document.createElement('input');input.name='entity_title';label.append(input);document.querySelector('form').append(label);});
  await bank.waitForFunction(()=>window.__testPanelRoot.textContent.includes('Business entity legal designation'));
  await bank.evaluate(()=>{
    const root=window.__testPanelRoot,detail=[...root.querySelectorAll('details')].find(d=>d.querySelector('summary')?.textContent==='Выбрать поле и данные вручную'),form=detail.querySelector('form'),select=form.querySelector('select');
    select.value=[...select.options].find(o=>o.textContent==='Business entity legal designation').value;select.dispatchEvent(new Event('change'));
    form.querySelector('input[type=checkbox]').checked=true;form.dispatchEvent(new Event('submit',{cancelable:true}));
  });
  await bank.waitForFunction(()=>document.querySelector('[name=entity_title]').value==='Example Limited');
  await bank.evaluate(()=>{const input=document.querySelector('[name=entity_title]');input.value='';input.maxLength=3;const root=window.__testPanelRoot,detail=[...root.querySelectorAll('details')].find(d=>d.querySelector('summary')?.textContent==='Выбрать поле и данные вручную'),form=detail.querySelector('form');form.querySelector('input[type=checkbox]').checked=true;form.dispatchEvent(new Event('submit',{cancelable:true}));});
  await bank.waitForFunction(()=>window.__testPanelRoot.textContent.includes('не соответствует ограничениям поля'));
  assert.equal(await bank.locator('[name=entity_title]').inputValue(),'');
  await page.locator('#hideToken').click();
  mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/workspace.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('PASS: real web UI and panel DOM logic; extension runtime simulated. Verified source, explicit insertion, sensitive-field exclusion, scoped corrections and dynamic fields.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));db.close();rmSync(temp,{recursive:true,force:true});}
