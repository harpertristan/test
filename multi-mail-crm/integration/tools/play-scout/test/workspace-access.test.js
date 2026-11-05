import test from 'node:test';import assert from 'node:assert/strict';import {createApp,shutdownApp} from '../server.js';
test('workspace authentication follows existing Scout admin/viewer access and does not add a second password',async t=>{
 const server=createApp({manual:true,password:'synthetic-admin-password',viewerPassword:'synthetic-viewer-password',assistantWorkspace:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>shutdownApp(server));const base='http://127.0.0.1:'+server.address().port;
 assert.equal((await fetch(base+'/api/workspace-auth')).status,401);
 for(const [username,password,role] of [['admin','synthetic-admin-password','admin'],['viewer','synthetic-viewer-password','viewer']]){const headers={Authorization:'Basic '+Buffer.from(username+':'+password).toString('base64')};const response=await fetch(base+'/api/workspace-auth',{headers});assert.equal(response.status,200);assert.equal(response.headers.get('X-Workspace-Role'),role);const access=await(await fetch(base+'/api/access',{headers})).json();assert.equal(access.workspace.enabled,true);assert.equal(access.workspace.assistant,'/assistant/');}
});
