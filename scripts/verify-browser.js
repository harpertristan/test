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
import {notebook} from './fixtures/notebook.js';

const temp=mkdtempSync(join(tmpdir(),'assistant-browser-')),origin='http://127.0.0.1:3197';
const {app,db}=createApp({dataDir:join(temp,'data'),origin,ai:{}});
db.prepare('INSERT INTO users(username,password) VALUES(?,?)').run('browser-test',hashPassword('synthetic-test-password-only'));
app.get('/fixture',(_req,res)=>res.type('html').send(`<!doctype html><html><head><title>Test bank form</title></head><body><h1>Company registration</h1><form>
<label>FIRST NAME<input name="firstName" autocomplete="given-name"></label><label>LAST NAME<input name="last_name" autocomplete="family-name"></label>
<label>COMPANY NAME<input name="company_name"></label><label>WORK EMAIL<input name="work_email" type="email"></label>
<label>DIAL CODE<select name="dial_code"><option value="">Code</option><option value="+44">United Kingdom (+44)</option></select></label><label>PHONE NUMBER<input name="phone_number" type="tel"></label>
<label>WEBSITE<input name="website" type="url"></label><label>My business does not have a website<input type="checkbox" name="no_website"></label>
<label>COUNTRY OF INCORPORATION<select name="incorporation_country"><option value="">Choose</option><option value="GB">United Kingdom</option></select></label>
<label>INDUSTRY<select name="industry"><option value="">Choose</option><option value="retail">Retail</option></select></label>
<label>ANNUALIZED TRANSACTION VOLUME (EUR)<select name="volume"><option value="">Choose</option><option value="low">0–100000</option></select></label>
<label>MESSAGE / ANYTHING ELSE WE SHOULD KNOW<textarea name="message"></textarea></label><label>Password<input type="password" name="password"></label><button type="submit">Submit</button></form></body></html>`));
app.get('/fixture-dom.js',(_req,res)=>res.sendFile(resolve('extension/dom.js')));
app.get('/fixture-panel.js',(_req,res)=>res.sendFile(resolve('extension/panel.js')));
const server=app.listen(3197,'127.0.0.1');await once(server,'listening');let browser;
try{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const context=await browser.newContext(),errors=[];context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  const page=await context.newPage();page.setDefaultTimeout(10000);await page.goto(origin);
  await page.locator('#loginForm [name=username]').fill('browser-test');await page.locator('#loginForm [name=password]').fill('synthetic-test-password-only');await page.locator('#loginForm button').click();await page.locator('#workspace').waitFor({state:'visible'});
  await page.locator('#companyForm [name=name]').fill('EXAMPLE GOODS LTD');await page.locator('#companyForm button').click();await page.locator('#companyWorkspace').waitFor({state:'visible'});
  await page.getByText('Добавить сведения из блокнота или вручную',{exact:true}).click();await page.locator('#noteForm [name=title]').fill('Verified director note');await page.locator('#noteForm [name=text]').fill(notebook+'\n<script>window.documentCompromised=true</script>');await page.locator('#noteForm button').click();await page.locator('#facts strong').filter({hasText:/^EXAMPLE GOODS LTD$/}).waitFor();
  assert.equal(await page.evaluate(()=>Boolean(window.documentCompromised)),false);
  assert.ok(await page.locator('#facts strong').count()>10);
  await page.getByText('Заполнить форму и создать блокнот',{exact:true}).click();
  for(const [key,value] of [['company_name','EXAMPLE GOODS LTD'],['contact_first_name','Alice'],['contact_last_name','Example'],['website','https://example.com']])await page.locator(`#structuredForm [name=${key}]`).fill(value);
  await page.getByRole('button',{name:'Сохранить и сопоставить с документами',exact:true}).click();
  await page.getByText('Совпадает в источниках: 2',{exact:true}).first().waitFor();
  await page.locator('#reviewConfirmed').check();await page.locator('#approveReview').click();await page.locator('#reviewStatus').filter({hasText:'подтверждена'}).waitFor();
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
  await bank.goto(origin+'/fixture');await bank.addScriptTag({url:origin+'/fixture-dom.js'});await bank.addScriptTag({url:origin+'/fixture-panel.js'});
  await bank.waitForFunction(()=>window.__testPanelRoot?.querySelector('select').options.length===2);
  await bank.evaluate(()=>{const select=window.__testPanelRoot.querySelector('select');select.selectedIndex=1;select.dispatchEvent(new Event('change'));});
  await bank.waitForFunction(()=>[...window.__testPanelRoot.querySelectorAll('button')].some(b=>b.textContent==='Вставить в это поле'));
  await bank.evaluate(()=>{window.__submissions=0;document.querySelector('form').addEventListener('submit',event=>{event.preventDefault();window.__submissions++;});[...window.__testPanelRoot.querySelectorAll('button')].find(b=>b.textContent==='Заполнить найденные пустые поля').click();});
  await bank.waitForFunction(()=>document.querySelector('[name=message]').value.includes('sells bags online'));
  assert.equal(await bank.locator('[name=firstName]').inputValue(),'Alice');assert.equal(await bank.locator('[name=last_name]').inputValue(),'Example');
  assert.equal(await bank.locator('[name=company_name]').inputValue(),'EXAMPLE GOODS LTD');assert.equal(await bank.locator('[name=website]').inputValue(),'https://example.com');
  assert.equal(await bank.locator('[name=incorporation_country]').inputValue(),'GB');
  for(const name of ['work_email','phone_number','dial_code','industry','volume','password'])assert.equal(await bank.locator(`[name=${name}]`).inputValue(),'');
  assert.equal(await bank.locator('[name=no_website]').isChecked(),false);assert.equal(await bank.evaluate(()=>window.__submissions),0);
  await bank.locator('[name=website]').fill('https://user-entered.example');
  await bank.evaluate(()=>[...window.__testPanelRoot.querySelectorAll('button')].find(b=>b.textContent==='Заполнить найденные пустые поля').click());
  await bank.waitForFunction(()=>!([...window.__testPanelRoot.querySelectorAll('button')].find(b=>b.textContent==='Заполнить найденные пустые поля').disabled));
  assert.equal(await bank.locator('[name=website]').inputValue(),'https://user-entered.example');
  await bank.evaluate(()=>{const form=window.__testPanelRoot.querySelector('.correction-form'),select=form.querySelector('select');select.value=[...select.options].find(o=>o.textContent==='WEBSITE').value;form.querySelector('textarea').value='Ask before choosing a different company website.';form.dispatchEvent(new Event('submit',{cancelable:true}));});
  await bank.waitForFunction(()=>window.__testPanelRoot.textContent.includes('Для этого поля сохранено исправление'));
  await bank.evaluate(()=>{const label=document.createElement('label');label.textContent='Company website';const input=document.createElement('input');input.name='website';label.append(input);document.querySelector('form').prepend(label);});
  await bank.waitForFunction(()=>window.__testPanelRoot.textContent.includes('Company website'));
  // The manual picker requires acknowledgement and exposes the exact source.
  assert.equal(await bank.evaluate(()=>Boolean(window.__testPanelRoot.querySelector('input[type=checkbox][required]'))),true);
  await bank.evaluate(()=>{const label=document.createElement('label');label.textContent='Business entity legal designation';const input=document.createElement('input');input.name='entity_title';label.append(input);document.querySelector('form').append(label);});
  await bank.waitForFunction(()=>window.__testPanelRoot.textContent.includes('Business entity legal designation'));
  await bank.evaluate(()=>{
    const root=window.__testPanelRoot,detail=[...root.querySelectorAll('details')].find(d=>d.querySelector('summary')?.textContent==='Выбрать поле и данные вручную'),form=detail.querySelector('form'),select=form.querySelector('select');
    select.value=[...select.options].find(o=>o.textContent==='Business entity legal designation').value;select.dispatchEvent(new Event('change'));
    const sources=form.querySelectorAll('select')[1];sources.value=[...sources.options].find(o=>o.textContent==='Юридическое название компании').value;form.querySelector('input[type=checkbox]').checked=true;form.dispatchEvent(new Event('submit',{cancelable:true}));
  });
  await bank.waitForFunction(()=>document.querySelector('[name=entity_title]').value==='EXAMPLE GOODS LTD');
  await bank.evaluate(()=>{const input=document.querySelector('[name=entity_title]');input.value='';input.maxLength=3;const root=window.__testPanelRoot,detail=[...root.querySelectorAll('details')].find(d=>d.querySelector('summary')?.textContent==='Выбрать поле и данные вручную'),form=detail.querySelector('form');form.querySelector('input[type=checkbox]').checked=true;form.dispatchEvent(new Event('submit',{cancelable:true}));});
  await bank.waitForFunction(()=>/не соответствует ограничениям поля|Поле изменилось/.test(window.__testPanelRoot.textContent));
  assert.equal(await bank.locator('[name=entity_title]').inputValue(),'');
  await bank.evaluate(()=>{const auto=[...window.__testPanelRoot.querySelectorAll('label')].find(l=>l.textContent.includes('Автоматически заполнять новые')).querySelector('input');auto.checked=true;auto.dispatchEvent(new Event('change'));});
  await bank.evaluate(()=>{const label=document.createElement('label');label.textContent='Given name';const input=document.createElement('input');input.name='new_given_name';label.append(input);document.querySelector('form').append(label);});
  await bank.waitForFunction(()=>document.querySelector('[name=new_given_name]').value==='Alice');
  assert.equal(await bank.evaluate(()=>window.__submissions),0);
  await page.locator('#hideToken').click();
  mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/workspace.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('PASS: real web UI and panel DOM logic; extension runtime simulated. Automatic notebook extraction, screenshot form batch fill, names, website, country, source provenance, no overwrites, corrections and dynamic autofill.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));db.close();rmSync(temp,{recursive:true,force:true});}
