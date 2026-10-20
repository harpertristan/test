import test from 'node:test';
import assert from 'node:assert/strict';
import {liveProvider,playRequestGate} from '../lib/provider.js';
import {runProvider} from '../lib/run-context.js';
import {createMonitor} from '../lib/monitor.js';
import {memoryStore} from '../lib/store.js';
import {cataloguePreset} from '../lib/discovery.js';
const now=new Date('2026-10-20T08:00:00Z');
const filters={...cataloguePreset(['AT']),keywords:['business account'],seedApps:[],related:false,developerExpansion:false,useWebIndex:false};
const bank={appId:'com.network.bank',title:'Business Bank',genreId:'FINANCE',free:true,price:0,minInstalls:500,released:'2026-10-01',description:'Open a business account with a German IBAN and EUR SEPA payments for companies in Europe. We are a licensed bank.'};
const timeout=()=>Object.assign(new Error('simulated connection timeout'),{code:'ETIMEDOUT'});
const make=(provider,store=memoryStore(now))=>createMonitor({store,clock:()=>now,delay:0,provider});

test('Play HTTP gate spaces actual starts and recovers after aborted waits',{timeout:2000},async()=>{
 const gate=playRequestGate(35);await gate();const aborted=new AbortController();const queued=gate(aborted.signal);const next=gate();aborted.abort();await assert.rejects(queued,{name:'AbortError'});await next;
 const started=Date.now();await gate();assert.ok(Date.now()-started>=25);
});
test('Play adapter remains usable after network failure and cancellation, without dependency throttle',{timeout:2000},async()=>{
 let calls=0;const starts=[];
 const operation=async options=>{
  assert.equal(options.throttle,undefined);for(const hook of options.requestOptions.hooks.beforeRequest)await hook({signal:options.requestOptions.signal});starts.push(Date.now());
  if(++calls===1)throw timeout();
  if(calls===2)return new Promise((_,reject)=>options.requestOptions.signal.addEventListener('abort',()=>reject(options.requestOptions.signal.reason),{once:true}));
  for(const hook of options.requestOptions.hooks.afterResponse??[])hook({url:'https://play.google.com/store/search',body:'<a href="/store/apps/details?id=com.more.bank">More</a>'});
  return options.term?[{appId:bank.appId}]:options.devId?[]:bank;
 };
 const p=liveProvider({client:{search:operation,app:operation,developer:operation},requestIntervalMs:20});
 await assert.rejects(p.search({term:'first'}),/timeout/);
 const controller=new AbortController(),scoped=runProvider(p,controller.signal);const pending=scoped.app({appId:bank.appId});
 while(calls<2)await new Promise(r=>setTimeout(r,1));controller.abort();await assert.rejects(pending,{name:'AbortError'});
 const results=await p.search({term:'next'});assert.deepEqual(results.map(r=>r.appId),[bank.appId,'com.more.bank']);await p.developer({devId:'example'});assert.equal((await p.app({appId:bank.appId})).title,bank.title);
 for(let i=1;i<starts.length;i++)assert.ok(starts[i]-starts[i-1]>=12,'rate gate applies across methods');
});
test('three consecutive failed queries stop a large plan and preserve the existing backlog',async()=>{
 const store=memoryStore(now);store.state.pendingChecks=[{appId:bank.appId,detailCountries:['AT']}];let calls=0;
 const monitor=make({search:async()=>{calls++;throw timeout();}},store);
 const job=await monitor.startJob({...filters,countries:['AT','DE','IT','FR'],keywords:['business account','IBAN account','corporate account','business bank']});await monitor.idle();
 assert.equal(calls,3);assert.equal(job.searchDone,3);assert.ok(job.searchTotal>3);assert.equal(job.status,'failed');assert.equal(job.errors.at(-1).code,'SOURCE_UNAVAILABLE');assert.equal(store.state.pendingChecks.length,1);assert.equal(monitor.summary().busy,false);
});
test('a valid query resets the failure streak and saved discoveries survive a later source outage',async()=>{
 let calls=0;const store=memoryStore(now),monitor=make({search:async()=>{if(++calls===3)return[bank];throw timeout();}},store);
 const job=await monitor.startJob({...filters,countries:['AT','DE','IT','FR','ES','NL','BE'],keywords:['business account']});await monitor.idle();
 assert.equal(calls,6);assert.equal(job.successfulSearches,1);assert.equal(job.status,'failed');assert.equal(store.state.pendingChecks[0].appId,bank.appId);assert.equal(job.detailDone,0);
});
test('three failed card requests retain current and later cards for a successful resume',async()=>{
 let failing=true;const store=memoryStore(now),list=[bank,{...bank,appId:'com.network.second'}],monitor=make({search:async()=>list,app:async({appId})=>{if(failing)throw timeout();return list.find(a=>a.appId===appId);}},store);
 const first=await monitor.startJob({...filters,countries:['AT','DE','IT','FR']});await monitor.idle();assert.equal(first.status,'failed');assert.equal(first.errors.filter(e=>e.code==='TIMEOUT').length,3);assert.equal(store.state.pendingChecks.length,2);
 failing=false;const resumed=await monitor.startJob({...store.state.pendingCheckConfig,continuePending:true});await monitor.idle();assert.equal(resumed.status,'complete');assert.equal(resumed.results.length,2);assert.equal(store.state.pendingChecks.length,0);assert.equal(monitor.findings().length,2);
});
test('unavailable country cards do not trip the connection breaker',async()=>{
 let calls=0;const monitor=make({search:async()=>[bank],app:async()=>{calls++;throw Object.assign(new Error('not found'),{status:404});}});
 const job=await monitor.startJob({...filters,countries:['AT','DE','IT','FR']});await monitor.idle();assert.equal(calls,4);assert.equal(job.status,'partial');assert.equal(job.skipped.details,1);assert.ok(job.errors.every(e=>e.code==='APP_NOT_FOUND'));
});

test('a failed pagination keeps the first page and explicitly marks the query incomplete',async()=>{
 const {createJob,runSearch,validateConfig}=await import('../lib/search.js');
 const p=liveProvider({requestIntervalMs:0,client:{search:async options=>{
  for(const hook of options.requestOptions.hooks.afterResponse)hook({url:'https://play.google.com/store/search',body:'<a href="/store/apps/details?id=com.network.bank">Business Bank</a>'});
  const page={method:'POST',url:new URL('https://play.google.com/_/PlayStoreUi/data/batchexecute'),body:'same-token'};
  for(const hook of options.requestOptions.hooks.beforeRequest)await hook(page);
  for(const hook of options.requestOptions.hooks.beforeRequest)await hook(page);
 },app:async()=>bank}});
 const job=createJob('pagination',validateConfig(filters,now));await runSearch(job,p,{delay:0});assert.equal(job.results.length,1);assert.equal(job.successfulSearches,1);assert.equal(job.errors[0].code,'PARTIAL_QUERY');assert.equal(job.status,'partial');
});
test('cancelled Play pagination never returns the first page as a successful query',async()=>{
 const controller=new AbortController(),p=liveProvider({requestIntervalMs:0,client:{search:async options=>{
  for(const hook of options.requestOptions.hooks.afterResponse)hook({url:'https://play.google.com/store/search',body:'<a href="/store/apps/details?id=com.network.bank">Business Bank</a>'});controller.abort();throw controller.signal.reason;
 }}});
 await assert.rejects(p.search({term:'cancelled'},{signal:controller.signal}),{name:'AbortError'});
});
test('cancelling an active unresponsive Brave request releases the shared queue',{timeout:2000},async()=>{
 const {braveProvider}=await import('../lib/brave-provider.js');let calls=0;let entered;const ready=new Promise(r=>entered=r);
 const p=braveProvider({key:'fixture',minInterval:0,request:()=>++calls===1?(entered(),new Promise(()=>{})):{web:{results:[]}}}),first=new AbortController();
 const waiting=p.search({q:'old'},{signal:first.signal});await ready;first.abort();await assert.rejects(waiting,{name:'AbortError'});assert.deepEqual(await p.search({q:'new'}),[]);assert.equal(calls,2);
});
test('malformed redirects and interrupted bodies reject without a crash or waiting for a timer',{timeout:2000},async()=>{
 const {EventEmitter}=await import('node:events');const {playHTML}=await import('../lib/provider.js');const {pageProvider}=await import('../lib/page-provider.js');
 for(const mode of['redirect','interrupted']){
  const request=(_url,_opts,callback)=>{const req=new EventEmitter();req.destroy=error=>queueMicrotask(()=>req.emit('error',error));queueMicrotask(()=>{
   const res=new EventEmitter();res.resume=()=>{};res.statusCode=mode==='redirect'?302:200;res.headers=mode==='redirect'?{location:'https://['}:{'content-type':'text/html'};callback(res);if(mode==='interrupted')res.emit('aborted');
  });return req;};
  await assert.rejects(playHTML(new URL('https://play.google.com/store/apps/details?id=com.network.bank'),'',0,undefined,request));
  const page=pageProvider({proxy:'',resolve:async()=>[{address:'93.184.216.34',family:4}],request});await assert.rejects(page.page('https://example.eu/'));
 }
});
test('graceful shutdown closes unfinished browser requests after saving the cancelled worker',{timeout:3000},async t=>{
 const {createApp,shutdownApp}=await import('../server.js');const {connect}=await import('node:net');const store=memoryStore(now);let entered;const ready=new Promise(r=>entered=r);
 const server=createApp({store,delay:0,provider:{search:async()=>[bank],app:()=>{entered();return new Promise(()=>{});}}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const job=await server.monitor.startJob(filters);await ready;const socket=connect(server.address().port,'127.0.0.1');t.after(()=>socket.destroy());await new Promise(r=>socket.once('connect',r));socket.write('POST /api/search HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{');
 await new Promise(r=>setImmediate(r));await shutdownApp(server);assert.equal(job.status,'cancelled');assert.equal(store.state.pendingChecks.length,1);assert.equal(server.monitor.summary().busy,false);
});

test('browser API deadlines cover reading the body and do not retry possibly saved writes',{timeout:2000},async()=>{
 const {apiJSON}=await import('../public/api.js');let calls=0;
 await assert.rejects(apiJSON('/api/search',{method:'POST'},{timeoutMs:20,request:async(_,{signal})=>{calls++;return {ok:true,json:()=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))};}}),/операция могла сохраниться/);assert.equal(calls,1);
 await assert.rejects(apiJSON('/api/search',undefined,{request:async()=>({ok:false,status:409,json:async()=>({error:'busy',activeJobId:'saved-id'})})}),{status:409,activeJobId:'saved-id'});
});
