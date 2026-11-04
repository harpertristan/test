// Smoke test with synthetic data; intended to run inside the production image.
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {createApp} from '../server.js';
import {hashPassword} from '../lib/security.js';
const directory=mkdtempSync(join(tmpdir(),'assistant-container-'));
const origin='http://127.0.0.1:3100';const {app,db}=createApp({dataDir:directory,origin,ai:{}});
db.prepare('INSERT INTO users(username,password) VALUES(?,?)').run('container-test',hashPassword('synthetic-container-password'));
const server=app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;let cookie;
async function call(path,body){const response=await fetch(base+'/api'+path,{method:body?'POST':'GET',headers:{Origin:origin,'X-Assistant-Request':'1',...(cookie?{Cookie:cookie}:{}),...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});assert.ok(response.ok,`${path}: ${response.status}`);return {response,data:await response.json()};}
try{
  assert.equal((await call('/health')).data.ok,true);
  cookie=(await call('/login',{username:'container-test',password:'synthetic-container-password'})).response.headers.get('set-cookie').split(';')[0];
  const company=(await call('/companies',{name:'Example Limited'})).data;
  // Use a known raster fixture: slim container images need not contain desktop
  // fonts for drawing test images; OCR itself operates on pixels.
  const data=new FormData();data.append('documents',new Blob([readFileSync(new URL('./fixtures/company.png',import.meta.url))]),'scan.png');
  const uploaded=(await call(`/companies/${company.id}/documents`,data)).data;assert.equal(uploaded[0].status,'extracted',uploaded[0].error);
  const docs=(await call(`/companies/${company.id}/documents`)).data;assert.match(docs[0].pages[0].text,/EXAMPLE LIMITED/);
  await call(`/companies/${company.id}/facts`,{key:'company_name',value:'EXAMPLE LIMITED',documentId:docs[0].id,page:1,quote:'EXAMPLE LIMITED',confirmed:true});
  const proposal=(await call('/propose',{companyId:company.id,host:'bank.example',fields:[{id:'0',label:'Company name',type:'text'}]})).data;assert.equal(proposal.fields[0].value,'EXAMPLE LIMITED');
  console.log('PASS: production container, authentication, image upload, local OCR, verified source and proposal. Node '+process.version);
}finally{await new Promise(resolve=>server.close(resolve));db.close();rmSync(directory,{recursive:true,force:true});}
