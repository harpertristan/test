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

test('file-backed reader keeps its projection for counters/progress and refreshes on notes, results and exclusions',async t=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),{join}=await import('node:path'),{tmpdir}=await import('node:os'),{openStore}=await import('../lib/store.js');
 const dir=await mkdtemp(join(tmpdir(),'scout-reader-cache-'));t.after(()=>rm(dir,{recursive:true,force:true}));const store=await openStore(join(dir,'state.json')),reader=createCRMReader();t.after(()=>reader.stop());await store.update(d=>{d.findings=fixture(1).state.findings;d.jobs.push({id:'progress',status:'running',done:0,results:[],config:d.schedule.filters,errors:[]});});let clones=0;
 const track=()=>Object.defineProperty(store.state,'cloneMarker',{enumerable:true,configurable:true,get(){clones++;return 'saved';}});
 track();await reader.read(store.state,context);assert.equal(clones,1);
 for(const change of[d=>{d.braveUsage['2026-11']=1;},d=>{d.jobs[0].done++;},d=>{d.ai.usage['2026-11']={attempts:1};}]){await store.update(change);track();clones=0;await reader.read(store.state,context);assert.equal(clones,0);}
 await store.update(d=>{d.crm.records['company:read0.eu']={notes:'Changed note'};});track();clones=0;const detail=await reader.read(store.state,context,{kind:'detail',id:'company:read0.eu'});assert.equal(clones,1);assert.equal(detail.notes,'Changed note');
 await store.update(d=>{d.manualExclusions.push({kind:'domain',value:'read0.eu',key:'exclude',reason:'worked'});});const updated=await reader.read(store.state,context);assert.equal(updated.rows.find(r=>r.id==='company:read0.eu').status,'excluded');
});

test('card revisions track saved evidence and decisions without changing for unrelated progress',async t=>{
 const store=fixture(2),reader=createCRMReader();t.after(()=>reader.stop());
 const snapshot=()=>reader.read(store.state,context),detail=id=>reader.read(store.state,context,{kind:'detail',id});
 const first=await snapshot(),id=first.rows[0].id,other=first.rows[1].id,revision=first.rows[0].detailRevision;
 assert.match(revision,/^[a-f0-9]{64}$/);assert.equal((await detail(id)).detailRevision,revision);
 assert.ok(!Object.hasOwn(first.rows[0],'documents'));
 await store.update(d=>{d.braveUsage['2026-11']=10;d.crm.records[other]={notes:'Other provider'};});
 assert.equal((await snapshot()).rows.find(r=>r.id===id).detailRevision,revision);
 await store.update(d=>{d.ai.results.push({id,model:'fixture',inputHash:first.rows[0].currentInputHash,checkedAt:'2026-11-03T12:00:00Z',sourceDocuments:[{url:'https://read0.eu/business',text:'Saved result and source text',kind:'official_page'}]});});
 const reviewed=(await snapshot()).rows.find(r=>r.id===id);assert.notEqual(reviewed.detailRevision,revision);assert.equal((await detail(id)).detailRevision,reviewed.detailRevision);
 // Even a source-only correction must refresh the open card, with no model rerun.
 await store.update(d=>{d.ai.results[0].sourceDocuments[0].text+=' corrected';});
 assert.notEqual((await detail(id)).detailRevision,reviewed.detailRevision);
 const corrected=(await detail(id)).detailRevision;await store.update(d=>{d.crm.records[id]={notes:'Keep my note',status:'approved',approval:{by:'user',at:context.now}};});
 const approved=await detail(id);assert.notEqual(approved.detailRevision,corrected);assert.equal(approved.notes,'Keep my note');assert.equal(approved.approval.by,'user');
});
