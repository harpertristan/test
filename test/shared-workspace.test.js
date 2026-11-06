import JSZip from 'jszip';import {readFileSync} from 'node:fs';
import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {once} from 'node:events';import {createApp} from '../server.js';
test('shared prefix reuses Scout access, rejects forged/absent gateway keys and keeps extension scope',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'assistant-shared-')),key='synthetic-shared-workspace-key-0123456789';const {app,db}=createApp({dataDir:dir,origin:'http://test.local',basePath:'/assistant',workspaceKey:key,ai:{}});const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{await new Promise(r=>server.close(r));db.close();rmSync(dir,{recursive:true,force:true});});const root='http://127.0.0.1:'+server.address().port;
 const get=(path,headers={})=>fetch(root+path,{headers,redirect:'manual'});assert.equal((await get('/assistant')).status,308);assert.equal((await get('/assistant/')).status,200);assert.equal((await get('/api/me')).status,404);assert.equal((await get('/assistant/api/me')).status,401);
 const headers={'X-Workspace-Key':key,'X-Workspace-Role':'admin',Origin:'http://test.local','X-Assistant-Request':'1','Content-Type':'application/json'};
 assert.equal((await get('/assistant/api/me',{'X-Workspace-Key':'spoof','X-Workspace-Role':'admin'})).status,401);const me=await (await get('/assistant/api/me',headers)).json();assert.equal(me.sharedWorkspace,true);
 const create=await fetch(root+'/assistant/api/companies',{method:'POST',headers,body:JSON.stringify({name:'Synthetic company'})});assert.equal(create.status,201);
 const proposal=await(await fetch(root+'/assistant/api/propose',{method:'POST',headers,body:JSON.stringify({companyId:(await create.clone().json()).id,host:'bank.test',fields:[{id:'ownership',label:'Ownership percentage',type:'number'},{id:'job',label:'Job title',type:'text'},{id:'name',label:'Company name',type:'text'}]})})).json();assert.equal(proposal.fields[0].value,'100');assert.equal(proposal.fields[1].value,'Director');assert.equal(proposal.fields[2].status,'needs_confirmation');
 const viewer={...headers,'X-Workspace-Role':'viewer'};assert.equal((await fetch(root+'/assistant/api/companies',{method:'POST',headers:viewer,body:'{"name":"forbidden"}'})).status,403);
 const token=await (await fetch(root+'/assistant/api/extension-token',{method:'POST',headers,body:'{}'})).json();assert.ok(token.token);assert.equal((await get('/assistant/api/me',{Authorization:'Bearer '+token.token})).status,200);assert.equal((await get('/assistant/api/companies/'+(await create.json()).id+'/documents',{Authorization:'Bearer '+token.token})).status,403);
 assert.equal((await fetch(root+'/assistant/api/login',{method:'POST',headers,body:'{"username":"workspace","password":"unused"}'})).status,409);
 const html=await(await get('/assistant/')).text();assert.match(html,/data-workspace="shared"/);assert.match(html,/content="\/assistant"/);assert.match(html,/\.\/app.js/);
 assert.match(html,/Полная инструкция подключения/);assert.match(html,/id="connectionServerURL"/);
 const download=await get('/assistant/downloads/registration-assistant-extension-0.5.3.zip',headers);assert.equal(download.status,200);
 const bundle=await JSZip.loadAsync(await download.arrayBuffer());
 const manifest=JSON.parse(await bundle.file('registration-assistant-extension/manifest.json').async('string'));assert.equal(manifest.version,'0.5.3');
 for(const name of ['manifest.json','background.js','options.js','options.html','panel.js'])assert.equal(await bundle.file('registration-assistant-extension/'+name).async('string'),readFileSync('extension/'+name,'utf8'));
 assert.ok(Object.keys(bundle.files).every(name=>name.startsWith('registration-assistant-extension/')));

});
