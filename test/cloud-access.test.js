import test from 'node:test';import assert from 'node:assert/strict';
import {cloudAccess} from '../lib/cloud-access.js';
import {memoryStore} from '../lib/store.js';import {createApp,shutdownApp} from '../server.js';
test('cloud requires valid passwords by default; only literal true opts into public administration',()=>{
 for(const flag of [undefined,'false','1','TRUE'])assert.throws(()=>cloudAccess({PLAY_SCOUT_PUBLIC_ADMIN:flag}));
 const env={APP_PASSWORD:'fixture-owner-password',VIEW_PASSWORD:'fixture-viewer-password'};
 assert.equal(cloudAccess(env).password,env.APP_PASSWORD);
 assert.deepEqual(cloudAccess({...env,PLAY_SCOUT_PUBLIC_ADMIN:'true'}),{password:'',viewerPassword:''});
 assert.equal(env.APP_PASSWORD,'fixture-owner-password');
});
test('explicit public mode allows anonymous CRM viewing and editing using the usual API',async t=>{
 const store=memoryStore(),server=createApp({store,manual:true,...cloudAccess({PLAY_SCOUT_PUBLIC_ADMIN:'true',APP_PASSWORD:'fixture-preserved-password'})});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>shutdownApp(server));
 const base='http://127.0.0.1:'+server.address().port,r=await fetch(base+'/api/crm');assert.equal(r.status,200);
 const data=await r.json();assert.equal(data.access.canEdit,true);const id=data.rows[0].id;
 const result=await fetch(base+'/api/crm/update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,notes:'Public access fixture'})});assert.equal(result.status,200);assert.equal(store.state.crm.records[id].notes,'Public access fixture');
});
