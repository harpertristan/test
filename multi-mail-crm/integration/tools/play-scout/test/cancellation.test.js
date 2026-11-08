import test from'node:test';import assert from'node:assert/strict';import{mkdtemp,writeFile,rm}from'node:fs/promises';import{join}from'node:path';import{tmpdir}from'node:os';
import{createMonitor}from'../lib/monitor.js';import{memoryStore,openStore,initialState}from'../lib/store.js';import{cataloguePreset}from'../lib/discovery.js';import{createApp}from'../server.js';import{braveProvider}from'../lib/brave-provider.js';import{runProvider}from'../lib/run-context.js';
const now=new Date('2026-10-20T08:00:00Z');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const filters={...cataloguePreset(['AT']),keywords:['business account'],seedApps:[],related:false,developerExpansion:false,useWebIndex:false};
const bank={appId:'com.cancel.bank',title:'Business Bank',developer:'Example',developerId:'example-developer',genreId:'FINANCE',free:true,price:0,minInstalls:500,released:'2026-10-01',description:'Open a business account with a German IBAN and EUR SEPA payments for companies in Europe. We are a licensed bank.'};
const make=(provider,patch={})=>createMonitor({store:memoryStore(now),clock:()=>now,delay:0,provider,...patch});

test('cancel releases a never-settling search before returning and late old data cannot change a new run',{timeout:2000},async()=>{
 const pending=deferred(),entered=deferred();let calls=0,sourceSignal;const monitor=make({search:(_,{signal})=>{sourceSignal=signal;return ++calls===1?(entered.resolve(),pending.promise):[];}});
 const first=await monitor.startJob(filters);await entered.promise;await monitor.cancel(first.id);assert.equal(sourceSignal.aborted,true);assert.equal(first.status,'cancelled');assert.equal(monitor.summary().busy,false);assert.equal(monitor.active(),null);assert.deepEqual(first.errors,[]);
 const second=await monitor.startJob(filters);await monitor.idle();assert.equal(second.status,'complete');pending.resolve([bank]);await new Promise(r=>setImmediate(r));assert.equal(second.results.length,0);assert.equal(monitor.findings().length,0);assert.equal(monitor.summary().busy,false);
});
test('cancelled app request keeps its card in the backlog and immediate resume checks it once',{timeout:2000},async()=>{
 const store=memoryStore(now),pending=deferred(),entered=deferred();let apps=0,queries=0;
 const monitor=make({search:async()=>{queries++;return[bank];},app:()=>++apps===1?(entered.resolve(),pending.promise):bank},{store});
 const first=await monitor.startJob(filters);await entered.promise;await monitor.cancel(first.id);assert.equal(first.status,'cancelled');assert.equal(store.state.pendingChecks.length,1);
 const resumed=await monitor.startJob({...store.state.pendingCheckConfig,continuePending:true});await monitor.idle();assert.equal(resumed.results.length,1);assert.equal(queries,1);assert.equal(store.state.pendingChecks.length,0);pending.resolve(bank);await new Promise(r=>setImmediate(r));assert.equal(monitor.findings().length,1);assert.equal(store.state.pendingChecks.length,0);
});
test('recommendation and developer expansion can each be stopped without losing the current card',{timeout:3000},async()=>{
 for(const method of['related','developer']){const entered=deferred(),store=memoryStore(now),provider={search:async()=>[bank],app:async()=>bank,[method]:()=>{entered.resolve();return new Promise(()=>{});}};
 const monitor=make(provider,{store});const job=await monitor.startJob({...filters,related:method==='related',developerExpansion:method==='developer'});await entered.promise;assert.equal(job.request.kind,method);await monitor.cancel(job.id);assert.equal(job.status,'cancelled');assert.deepEqual(job.errors,[]);assert.equal(store.state.pendingChecks.length,1);assert.equal(monitor.summary().busy,false);}
});
test('partial search discovery survives cancellation before detail checking',{timeout:2000},async()=>{
 const entered=deferred(),store=memoryStore(now);let calls=0;const monitor=make({search:()=>++calls===1?[bank]:(setImmediate(()=>entered.resolve()),new Promise(()=>{})),app:()=>new Promise(()=>{})},{store});
 const job=await monitor.startJob({...filters,keywords:['business account','corporate account']});await entered.promise;await monitor.cancel(job.id);assert.equal(store.state.pendingChecks.length,1);assert.equal(store.state.pendingChecks[0].appId,bank.appId);assert.equal(job.detailDone,0);
});
test('cancel interrupts long throttle sleeps as well as network calls',{timeout:2000},async()=>{
 const entered=deferred(),monitor=make({search:async()=>{entered.resolve();return[];}},{delay:60000});const job=await monitor.startJob(filters);await entered.promise;await new Promise(r=>setImmediate(r));await monitor.cancel(job.id);assert.equal(job.status,'cancelled');assert.equal(monitor.summary().busy,false);
});
test('web, publication and page observation monitors also release cancelled requests',{timeout:3000},async()=>{
 for(const kind of['web','social','watch']){const entered=deferred();let calls=0;const get=()=>++calls===1?(entered.resolve(),new Promise(()=>{})):kind==='watch'?{title:'Business',url:'https://example.eu/business',text:bank.description,body:bank.description,contentType:'text/html'}:[];
 const provider={configured:()=>true,search:get,page:get},monitor=make(provider,{kind});const c=kind==='web'?{queries:['business account'],referenceDomains:[]}:kind==='social'?{profile:'business',sources:['finextra'],queries:['business account launch'] }:{watchUrls:['https://example.eu/business'],watchApps:[],autoWatchFindings:false,autoWatchSites:false};
 const first=await monitor.startJob(c);await entered.promise;await monitor.cancel(first.id);assert.equal(first.status,'cancelled',kind);assert.deepEqual(first.errors,[],kind);assert.equal(monitor.summary().busy,false,kind);const next=await monitor.startJob(c);await monitor.idle();assert.equal(next.status,'complete',kind);}
});
test('a source that ignores cancellation is bounded by a whole-operation deadline',{timeout:2000},async()=>{
 const store=memoryStore(now),monitor=make({search:async()=>[bank],app:()=>new Promise(()=>{})},{store,requestTimeoutMs:30});const job=await monitor.startJob(filters);await monitor.idle();assert.equal(job.status,'partial');assert.ok(job.errors.some(e=>e.code==='TIMEOUT'));assert.equal(job.skipped.details,1);assert.equal(store.state.pendingChecks.length,1);assert.equal(monitor.summary().busy,false);
});
test('an aborted queued Brave request never reaches the paid request function',{timeout:2000},async()=>{
 const entered=deferred(),first=deferred();let calls=0;const provider=braveProvider({key:'fixture-only-key',minInterval:0,request:()=>{calls++;entered.resolve();return first.promise;}}),one=new AbortController(),two=new AbortController();
 const running=runProvider(provider,one.signal).search({q:'first',count:1});await entered.promise;const queued=runProvider(provider,two.signal).search({q:'second',count:1});two.abort();await assert.rejects(queued,{name:'AbortError'});first.resolve({web:{results:[]}});await running;await new Promise(r=>setImmediate(r));assert.equal(calls,1);
});
test('HTTP cancellation reports cancelling during checkpoint and responds only after the worker slot is free',{timeout:4000},async t=>{
 const store=memoryStore(now),entered=deferred(),checkpoint=deferred(),blocked=deferred(),original=store.update.bind(store);let updates=0;
 store.update=async change=>{updates++;if(updates===4){blocked.resolve();await checkpoint.promise;}return original(change);};
 const server=createApp({store,delay:0,provider:{search:async()=>[bank],app:()=>{entered.resolve();return new Promise(()=>{});}}});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const base=`http://127.0.0.1:${server.address().port}`,post=(path,body)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const job=await(await post('/api/search',filters)).json();await entered.promise;const stopping=post(`/api/jobs/${job.id}/cancel`,{});await blocked.promise;
 const active=await(await fetch(base+'/api/active')).json();assert.equal(active.status,'cancelling');const rejected=await post('/api/search',filters);assert.equal(rejected.status,409);assert.equal((await rejected.json()).activeJobId,job.id);checkpoint.resolve();assert.equal((await(await stopping).json()).status,'cancelled');assert.equal((await(await fetch(base+'/api/monitor')).json()).busy,false);
 const resumed=await post('/api/search',{...filters,excludeAppIds:[bank.appId]});assert.equal(resumed.status,202);await server.monitor.cancel((await resumed.json()).id);
});
test('restart recovers a persisted cancelling job without clearing history or exclusions',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'cancel-recovery-'));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'state.json'),s=initialState(now);s.jobs=[{id:'stopping-job',status:'cancelling',source:'scheduled',errors:[],results:[],current:'request'}];s.findings=[{appId:bank.appId,title:bank.title}];s.manualExclusions=[{key:'saved',kind:'app',value:'com.excluded.app'}];await writeFile(path,JSON.stringify(s));const recovered=await openStore(path,now);assert.equal(recovered.state.jobs[0].status,'cancelled');assert.equal(recovered.state.jobs[0].errors[0].code,'INTERRUPTED');assert.equal(recovered.state.findings.length,1);assert.equal(recovered.state.manualExclusions.length,1);
});

test('shutdown waits for an in-flight initial checkpoint before cancelling the newly reserved worker',{timeout:3000},async()=>{
 const store=memoryStore(now),original=store.update.bind(store),entered=deferred(),checkpoint=deferred();let first=true,calls=0;
 store.update=async change=>{if(first){first=false;entered.resolve();await checkpoint.promise;}return original(change);};
 const monitor=make({search:async()=>{calls++;return[];}},{store});const starting=monitor.startJob(filters);await entered.promise;const stopping=monitor.stop();checkpoint.resolve();await starting;await stopping;assert.equal(calls,0);assert.equal(monitor.summary().busy,false);assert.equal([...monitor.jobs.values()][0].status,'cancelled');
});
