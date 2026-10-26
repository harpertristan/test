import test from 'node:test';import assert from 'node:assert/strict';
import{mkdtemp,readFile,writeFile,rm}from'node:fs/promises';import{join}from'node:path';import{tmpdir}from'node:os';
import{validateWebConfig,evaluateWebService,createWebJob,runWebSearch,webPlan,webCSV}from'../lib/web-services.js';
import{manuallyExcluded,canonicalFindingURL}from'../lib/manual-exclusions.js';
import{createApp}from'../server.js';import{memoryStore,openStore,initialState}from'../lib/store.js';import{createMonitor}from'../lib/monitor.js';import{cataloguePreset}from'../lib/discovery.js';
const now=new Date('2026-10-20T08:00:00Z');
const webResult={title:'Example business accounts',url:'https://examplebank.eu/business?utm_source=search',description:'Open a business account with a German IBAN and EUR SEPA payments for companies in Europe. Manage business banking in your browser with our web dashboard.'};
const config=patch=>validateWebConfig({queries:['business account web IBAN'],referenceDomains:[],...patch});
const publicApp=JSON.parse(await readFile(new URL('./fixtures/play-precision.json',import.meta.url),'utf8')).apps.find(a=>a.appId==='com.wamo.business');
async function file(t){const dir=await mkdtemp(join(tmpdir(),'web-exclusion-'));t.after(()=>rm(dir,{recursive:true,force:true}));return join(dir,'state.json');}
async function http(t,options={}){const server=createApp({store:memoryStore(now),clock:()=>now,delay:0,socialDelay:0,watchDelay:0,...options});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const base=`http://127.0.0.1:${server.address().port}`;const call=async(path,body,headers={})=>{const r=await fetch(base+path,body===undefined?{headers}:{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};return {server,base,call};}

test('web discovery retains product sites without Android apps and records evidence instead of inventing a login',()=>{
 const entry=evaluateWebService(webResult,config(),now).post;assert.ok(entry);assert.equal(entry.webAccess.status,'mentioned');assert.equal(entry.discovery.euIban,'explicit_claim');assert.ok(entry.webAccess.evidence.some(e=>e.includes('web dashboard')));assert.equal(entry.appId,undefined);assert.equal(entry.url,'https://examplebank.eu/business');assert.equal(entry.loginUrl,undefined);
 const unknown=evaluateWebService({...webResult,description:'Open a business account with German IBAN and SEPA transfers for companies in Europe.'},config(),now).post;assert.ok(unknown);assert.equal(unknown.webAccess.status,'unknown');assert.equal(evaluateWebService({...webResult,description:unknown.snippet},config({requireWebAccess:true}),now).reason,'webAccess');
});
test('web search rejects articles, publishers, directories, IBAN utilities, account aggregators and future-only accounts',()=>{
 for(const url of ['https://finextra.com/newsarticle/1/example','https://examplebank.eu/blog/new-account','https://producthunt.com/products/bank','https://examplebank.eu/reviews/bank'])assert.equal(evaluateWebService({...webResult,url},config(),now).reason,'notProduct',url);
 for(const [title,description]of [['IBAN Checker for Business',webResult.description],['Business bookkeeping','Connect your bank accounts to manage business accounts, payments and invoices in EUR with IBAN details.'],['New business account','We will offer business accounts with EU IBAN and web banking soon.']])assert.equal(evaluateWebService({...webResult,title,description},config(),now).post,undefined,title);
 assert.equal(evaluateWebService({...webResult,title:'Best business accounts with IBAN'},config(),now).reason,'notProduct');assert.equal(evaluateWebService({...webResult,title:'Acme launches business accounts in Europe',url:'https://unknown-publisher.eu/acme'},config(),now).reason,'notProduct');
});
test('web runner ignores page freshness, deduplicates host paths and processes all queries despite legacy budgets',async()=>{
 const c=config({queries:['one','two','three'],requestBudget:2}),job=createWebJob('web',c,now);let calls=[];
 await runWebSearch(job,{search:async q=>{calls.push(q);return[webResult,{...webResult,url:'https://www.examplebank.eu/accounts'}];}},{delay:0,clock:()=>now});
 assert.equal(job.results.length,1);assert.equal(calls.length,3);assert.ok(calls.every(q=>q.freshness===undefined));assert.equal(job.rotationDays,1);assert.equal(job.status,'complete');assert.equal(job.skipped.duplicate,5);
 const csv=webCSV(job);assert.match(csv,/Веб-кабинет/);assert.match(csv,/mentioned/);
});
test('web source rotation includes developer websites and excludes blocked domains',()=>{
 const c=config({referenceDomains:['examplebank.eu'],requestBudget:1,excludeDomains:['blocked.eu']}),apps=[{developerWebsite:'https://developer.eu/'},{developerWebsite:'https://blocked.eu/'}],queries=new Set();for(let d=0;d<3;d++)for(const q of webPlan(c,apps,new Date(+now+d*86400000)).queries)queries.add(q);
 assert.ok([...queries].some(q=>q.includes('site:developer.eu')));assert.ok([...queries].some(q=>q.includes('site:examplebank.eu')));assert.ok(![...queries].some(q=>q.includes('blocked.eu')));
});
test('web daily schedule, settings and host identity survive restart without duplicate services',async t=>{
 const path=await file(t);let store=await openStore(path,now),clock=now;let monitor=createMonitor({kind:'web',store,provider:{configured:()=>true,search:async()=>[webResult]},delay:0,autoSchedule:true,clock:()=>clock});
 await monitor.saveSchedule({enabled:true,time:'09:20',filters:config()});await monitor.tick();await monitor.idle();const first=monitor.findings()[0];assert.ok(first);await monitor.tick();assert.equal(store.state.web.jobs.length,1);await monitor.stop();
 store=await openStore(path,now);clock=new Date(+now+86400000);monitor=createMonitor({kind:'web',store,provider:{configured:()=>true,search:async()=>[webResult]},delay:0,autoSchedule:true,clock:()=>clock});await monitor.tick();await monitor.idle();assert.equal(monitor.findings().length,1);const job=[...monitor.jobs.values()].at(-1);assert.equal(job.results.length,0);assert.equal(job.existingResults.length,1);assert.equal(monitor.findings()[0].firstFoundAt,first.firstFoundAt);assert.equal(store.state.findings.length,0);assert.equal(store.state.social.findings.length,0);await monitor.stop();
});
test('missing Brave and quota errors are failures, never successful empty web searches',async t=>{
 const {call}=await http(t,{socialProvider:{configured:()=>false}});assert.equal((await call('/api/web/search',config())).status,503);
 const job=createWebJob('quota',config(),now);await runWebSearch(job,{search:async()=>{throw Object.assign(new Error('secret-provider-string'),{status:429});}},{delay:0,clock:()=>now});assert.equal(job.status,'failed');assert.equal(job.requestsMade,1);assert.ok(!JSON.stringify(job).includes('secret-provider-string'));
});
test('manual exclusions canonicalize tracking URLs, scope article links and match app IDs across sources',()=>{
 assert.equal(canonicalFindingURL('https://www.example.eu/a/?utm_source=x#z'),'https://example.eu/a');
 assert.equal(manuallyExcluded({url:'https://example.eu/one'},[{kind:'url',value:'https://example.eu/one'}]),true);assert.equal(manuallyExcluded({url:'https://example.eu/two'},[{kind:'url',value:'https://example.eu/one'}]),false);
 assert.equal(manuallyExcluded({appId:'com.wamo.business',id:'watch:event'},[{kind:'app',value:'com.wamo.business'}]),true);
 assert.equal(manuallyExcluded({developerWebsite:'https://app.examplebank.eu/'},[{kind:'domain',value:'examplebank.eu'}]),true);assert.equal(manuallyExcluded({url:'https://examplebank.eu.attacker.test/'},[{kind:'domain',value:'examplebank.eu'}]),false);
});
test('excluding an app hides latest/history/review/watch/CSV and future runs without deleting history or changing schedules; undo restores it',async t=>{
 const store=memoryStore(now),app={...publicApp,developerWebsite:'https://examplebank.eu/'};
 const {server,call,base}=await http(t,{store,provider:{search:async()=>[app],app:async()=>app}});
 const filters={...cataloguePreset(['AT']),keywords:['business account'],seedApps:[],related:false,developerExpansion:false,useWebIndex:false};
 const first=await call('/api/search',filters);await server.monitor.idle();const id=first.data.id;const saved=store.state.findings[0];store.state.watch.findings.push({...saved,id:'watch:app',signalType:'app_change'});store.state.reviewCandidates.push({...saved,appId:'com.review.app'});
 const schedule=structuredClone(store.state.schedule);const excluded=await call('/api/exclusions',{section:'play',id:app.appId});assert.equal(excluded.status,200);assert.equal(excluded.data.exclusions.length,1);assert.deepEqual(store.state.schedule,schedule);
 for(const route of ['/api/findings','/api/findings?all=1','/api/watch/findings'])assert.equal((await call(route)).data.length,0,route);
 assert.equal((await call(`/api/jobs/${id}`)).data.results.length,0);assert.equal(store.state.findings.length,1);assert.equal(store.state.watch.findings.length,1);
 assert.ok(!(await(await fetch(base+`/api/jobs/${id}/export.csv?all=1`)).text()).includes(app.appId));
 await call('/api/search',filters);await server.monitor.idle();assert.equal(store.state.findings.length,1);assert.equal([...server.monitor.jobs.values()].at(-1).results.length,0);
 await call('/api/exclusions/remove',{key:excluded.data.rule.key});assert.equal((await call('/api/findings')).data.length,1);assert.equal((await call('/api/watch/findings')).data.length,1);
 const review=await call('/api/exclusions',{section:'play',id:'com.review.app'});assert.equal(review.status,200);assert.equal((await call('/api/candidates')).data.some(e=>e.appId==='com.review.app'),false);
});
test('excluding a publication affects only that link; web-domain exclusion also hides associated apps and persists across restart',async t=>{
 const path=await file(t),store=await openStore(path,now);const website=evaluateWebService(webResult,config(),now).post;store.state.web.findings.push({...website,firstFoundAt:now.toISOString()});store.state.findings.push({...publicApp,developerWebsite:webResult.url,discovery:website.discovery});
 const social={...website,source:'finextra',signalType:'publication',title:'Acme launches business accounts in Europe',snippet:webResult.description,url:'https://finextra.com/newsarticle/one'};store.state.social.findings.push({...social,id:'post:one'},{...social,id:'post:two',url:'https://finextra.com/newsarticle/two'});
 const {call}=await http(t,{store});const article=await call('/api/exclusions',{section:'social',id:'post:one'});assert.equal(article.data.rule.kind,'url');assert.equal((await call('/api/social/findings?all=1')).data.length,1);
 const domain=await call('/api/exclusions',{section:'web',id:website.id});assert.equal(domain.data.rule.kind,'domain');assert.equal((await call('/api/web/findings?all=1')).data.length,0);assert.equal((await call('/api/findings?all=1')).data.length,0);
 const reopened=await openStore(path,now);assert.equal(reopened.state.manualExclusions.length,2);assert.equal(reopened.state.web.findings.length,1);assert.equal(reopened.state.findings.length,1);
});
test('manual exclusions and web API retain authentication, JSON, cross-site, validation and safe migration',async t=>{
 const {call,base}=await http(t,{password:'exclusion-test-pass'});for(const path of ['/web','/api/web/monitor','/api/exclusions'])assert.equal((await fetch(base+path)).status,401);
 const headers={Authorization:'Basic '+Buffer.from('admin:exclusion-test-pass').toString('base64')};assert.equal((await call('/api/exclusions',{section:'__proto__',id:'x'},headers)).status,400);assert.equal((await call('/api/exclusions',{section:'play',id:'not-there'},headers)).status,404);assert.equal((await call('/api/exclusions',{section:'play',id:'x'},{...headers,'Sec-Fetch-Site':'cross-site'})).status,403);
 assert.equal((await fetch(base+'/api/exclusions',{method:'POST',headers})).status,415);
 for(const asset of ['/web','/web.js','/exclusions.js','/manual-exclusions.js'])assert.equal((await fetch(base+asset,{headers})).status,200);
 const path=await file(t),old=initialState(now);delete old.web;delete old.manualExclusions;for(const s of[old,old.social,old.watch])s.schedule.enabled=false;await writeFile(path,JSON.stringify(old));const upgraded=await openStore(path,now);assert.equal(upgraded.state.web.schedule.enabled,false);assert.deepEqual(upgraded.state.manualExclusions,[]);assert.equal(upgraded.state.schedule.enabled,false);
});


test('an exclusion added during an active search wins before its match is persisted; failed writes do not claim success',async t=>{
 const store=memoryStore(now),website=evaluateWebService(webResult,config(),now).post;store.state.web.findings.push(website);let release,entered;const started=new Promise(r=>entered=r),waiting=new Promise(r=>release=r);const app={...publicApp,developerWebsite:'https://examplebank.eu/'};
 const {server,call}=await http(t,{store,provider:{search:async()=>[app],app:async()=>{entered();await waiting;return app;}}});
 await call('/api/search',{...cataloguePreset(['AT']),keywords:['business account'],seedApps:[],related:false,developerExpansion:false,useWebIndex:false});await started;
 const response=await call('/api/exclusions',{section:'web',id:website.id});assert.equal(response.status,200);release();await server.monitor.idle();assert.equal(store.state.findings.length,0);assert.equal((await call('/api/findings')).data.length,0);
 const update=store.update.bind(store);store.update=async()=>{throw Object.assign(new Error('disk'),{code:'PERSISTENCE_ERROR'});};const failed=await call('/api/exclusions/remove',{key:response.data.rule.key});assert.equal(failed.status,500);assert.equal(store.state.manualExclusions.length,1);store.update=update;
});
