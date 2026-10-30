import test from 'node:test';import assert from 'node:assert/strict';import {memoryStore} from '../lib/store.js';import {createCRMReader} from '../lib/crm-reader.js';import {createApp,shutdownApp} from '../server.js';
const text='Open a business account with a dedicated German IBAN. Companies receive EUR payments and SEPA transfers.';
function fixture(n){const store=memoryStore();for(let i=0;i<n;i++)store.state.findings.push({appId:'co.read.app'+i,title:'Read '+i,url:'https://play.google.com/store/apps/details?id=co.read.app'+i,developerWebsite:'https://read'+i+'.eu/',screeningText:text,firstFoundAt:'2026-10-30T08:00:00Z'});return store;}
const context={now:'2026-10-30T12:00:00+02:00',model:'offline',braveConfigured:false};

test('read worker reuses one immutable snapshot for polling/details/export and refreshes after a saved mutation',async t=>{
 const store=fixture(4),reader=createCRMReader();t.after(()=>reader.stop());let walks=0;const jobs=store.state.jobs;Object.defineProperty(store.state,'jobs',{enumerable:true,get(){walks++;return jobs;}});
 const [first,detail,exported]=await Promise.all([reader.read(store.state,context),reader.read(store.state,context,{kind:'detail',id:'company:read0.eu'}),reader.read(store.state,context,{kind:'export',format:'csv',options:{status:'review'}})]);
 assert.equal(first.rows.length,4);assert.equal(detail.title,'Read 0');assert.ok(exported.includes('Read 0'));assert.equal(walks,1);
 await store.update(d=>d.manualExclusions.push({kind:'domain',value:'read0.eu',key:'x',reason:'worked'}));const updated=await reader.read(store.state,context);assert.equal(updated.rows.find(r=>r.id==='company:read0.eu').status,'excluded');assert.equal(updated.manualCount,3);
});

test('health responds while a large CRM projection runs, and shutdown settles queued reads',async t=>{
 const store=fixture(1800);for(const section of[store.state,store.state.web,store.state.social,store.state.watch])section.schedule.enabled=false;const server=createApp({store,socialProvider:{configured:()=>false},aiProvider:{model:'offline',configured:()=>false}});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>shutdownApp(server));const base='http://127.0.0.1:'+server.address().port;
 let projectionDone=false;const list=fetch(base+'/api/crm').then(async r=>{const data=await r.json();projectionDone=true;return data;});await new Promise(r=>setTimeout(r,10));const health=await(await fetch(base+'/api/health')).json();assert.equal(health.status,'ok');assert.equal(projectionDone,false);assert.equal((await list).rows.length,1800);
 const reader=createCRMReader(),pending=reader.read(fixture(20).state,context).then(()=>null,e=>e);await new Promise(r=>setImmediate(r));await reader.stop();assert.match((await pending).message,/останавливается/);await assert.rejects(reader.read(store.state,context),/останавливается/);
});
