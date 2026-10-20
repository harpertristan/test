import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {assessDiscovery,discoveryPreset,cataloguePreset,DISCOVERY_VERSION,REFERENCE_COUNTRIES} from '../lib/discovery.js';
import {assessBanking,eligibleFinding,reviewCandidate} from '../lib/qualification.js';
import {assessLaunch} from '../lib/launches.js';
import {playPageIds,recommendationSection} from '../lib/provider.js';
import {validateConfig,createJob,runSearch} from '../lib/search.js';
import {openStore,memoryStore,initialState} from '../lib/store.js';
import {createMonitor} from '../lib/monitor.js';
import {createApp} from '../server.js';
import {socialPreset,socialPlan} from '../lib/source-catalog.js';
import {validateSocialConfig,evaluatePost} from '../lib/social-search.js';
const now=new Date('2026-10-20T08:00:00Z');
const apps=JSON.parse(await readFile(new URL('./fixtures/play-precision.json',import.meta.url),'utf8')).apps;
const cfg=patch=>validateConfig({...cataloguePreset(['DE']),keywords:['business account'],seedApps:[],referenceDomains:[],useWebIndex:false,developerExpansion:false,...patch},now);
const classify=app=>{const c=cfg(),docs=[{title:app.title,text:app.description,url:app.url}];return assessDiscovery(docs,c,assessBanking(docs,c),app.appId);};
const business=apps.find(a=>a.appId==='com.wamo.business');
const positive=['co.tide.tideplatform.eu','com.bankera.wallet','it.hype.business','com.wamo.business'];
const provider=list=>({search:async()=>list,app:async({appId})=>list.find(a=>a.appId===appId)});

test('all four user examples pass real card screening, without seeds or fictitious EU IBAN proof',async()=>{
 const list=apps.filter(a=>positive.includes(a.appId)),c=cfg({related:false}),job=createJob('user-cards',c);
 await runSearch(job,provider(list),{delay:0});assert.equal(job.status,'complete');assert.deepEqual(job.results.map(a=>a.appId).sort(),positive.sort());
 for(const a of job.results){assert.equal(a.isReference,false);assert.equal(a.discovery.accountProvision,'mentioned');assert.equal(a.discovery.businessAccountVerified,false);assert.ok(a.released<'2025-01-01');}
});
test('real IBAN checkers and generated-number utilities are neither matches nor review candidates',()=>{
 const utilities=apps.filter(a=>/checker|validator|iban check|check digit/i.test(a.title));assert.ok(utilities.length>=4);
 for(const app of utilities){const d=classify(app);assert.equal(d.status,'not_relevant',app.appId);assert.equal(d.rejection,'iban_utility');assert.equal(eligibleFinding({...app,discovery:d},cfg()),false);assert.equal(reviewCandidate({...app,discovery:d},cfg()),false);}
 assert.equal(classify({...business,title:'Business account aggregator',description:'Connect your bank accounts to manage business accounts, payments and invoices in EUR with IBAN recipient details.'}).status,'not_relevant');
 const title='IBAN Checker for Business';assert.equal(classify({...business,title,description:'Check and validate EU business account IBANs. Generate IBAN examples for SEPA payments.'}).rejection,'iban_utility');
 assert.notEqual(classify({...business,description:business.description+' Optional IBAN checker validates recipients.'}).rejection,'iban_utility');
});
test('recommendation parser follows only Similar apps cluster and real card anchors',()=>{
 const html='<section><span>Games</span><a href="/store/apps/details?id=com.game.app">Game</a></section><section><span>Similar apps</span><a href="/store/apps/collection/cluster?gsr=abc&amp;hl=en">More</a><a href="/store/apps/details?id=com.holvi.app">Holvi</a><a href="/store/apps/details?id=com.wamo.business">Self</a></section><script>com.fake.module</script>';
 assert.deepEqual(recommendationSection(html,'com.wamo.business'),{appIds:['com.holvi.app'],cluster:'/store/apps/collection/cluster?gsr=abc&hl=en'});
 assert.deepEqual(playPageIds('<a href="https://evil.test/store/apps/details?id=com.fake.app">Fake</a> import com.fake.module'),[]);
 assert.deepEqual(recommendationSection('<section><span>Games</span></section>','com.wamo.business'),{appIds:[],cluster:null});
});
test('recommendation traversal discovers new cards, prevents cycles, checks criteria and records parents',async()=>{
 const list=[business,{...business,appId:'com.chain.one'},{...business,appId:'com.chain.two'},apps.find(a=>a.appId==='co.randomiban')];let calls=[];
 const job=createJob('chain',cfg({related:true}));await runSearch(job,{...provider(list),search:async()=>[business],related:async({appId})=>{calls.push(appId);return appId===business.appId?[{appId:'com.chain.one'},{appId:'co.randomiban'}]:[{appId:business.appId},{appId:'com.chain.two'}];}},{delay:0});
 assert.deepEqual(job.results.map(a=>a.appId).sort(),[business.appId,'com.chain.one','com.chain.two'].sort());assert.equal(job.detailDone,4);assert.equal(calls.length,2);assert.equal(job.results.find(a=>a.appId==='com.chain.two').isReference,false);assert.deepEqual(job.results.find(a=>a.appId==='com.chain.two').recommendationParents,['com.chain.one']);
});
test('developer expansion verifies app cards rather than trusting their developer',async()=>{
 const other={...business,appId:'com.developer.other'},utility=apps.find(a=>a.appId==='co.randomiban');const list=[business,other,utility],job=createJob('developer',cfg({related:false,developerExpansion:true}));
 await runSearch(job,{...provider(list),search:async()=>[business],developer:async()=>[other,utility]},{delay:0});assert.equal(job.developerChecks,1);assert.equal(job.results.length,2);assert.ok(job.results.some(a=>a.appId===other.appId&&a.discoverySources.includes('developer')));
});
test('card backlog resumes across a real store restart without repeating searches or dropping records',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'precision-backlog-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=join(dir,'state.json');let searches=0;
 const list=Array.from({length:5},(_,i)=>({...business,appId:`com.queue.app${i}`})),p={...provider(list),search:async()=>{searches++;return list;}},filters=cfg({maxDetails:2,related:false});
 let store=await openStore(file,now),m=createMonitor({store,provider:p,clock:()=>now,delay:0});await m.startJob(filters);await m.idle();assert.equal(m.findings().length,2);assert.equal(m.summary().pendingChecks,3);const initialSearches=searches;await m.stop();
 store=await openStore(file,now);m=createMonitor({store,provider:p,clock:()=>now,delay:0});await m.startJob({...store.state.pendingCheckConfig,continuePending:true});await m.idle();assert.equal(m.summary().pendingChecks,1);assert.equal(searches,initialSearches);await m.startJob({...store.state.pendingCheckConfig,continuePending:true});await m.idle();assert.equal(m.findings().length,5);assert.equal(m.summary().pendingChecks,0);assert.equal(new Set(m.findings().map(a=>a.appId)).size,5);await m.stop();
});
test('repeated run shows saved matching apps in latest results but never counts them as new',async()=>{
 const child={...business,appId:'com.saved.related'},store=memoryStore(now),m=createMonitor({store,provider:{...provider([business,child]),search:async()=>[business],related:async({appId})=>appId===business.appId?[child]:[]},clock:()=>now,delay:0}),c=cfg({related:true});
 const first=await m.startJob(c);await m.idle();assert.equal(first.results.length,2);const second=await m.startJob(c);await m.idle();assert.equal(second.results.length,0);assert.equal(second.existingResults.length,2);assert.equal(second.existingResults[0].fromHistory,true);assert.equal(m.findings().length,2);
});
test('upgrade reclassifies stored utility matches, promotes genuine examples and preserves exclusions/history',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'precision-migration-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=join(dir,'state.json'),old=initialState(now);delete old.catalogueVersion;
 old.schedule.filters.excludeAppIds=['com.excluded.app'];old.schedule.enabled=false;
 const entry=a=>({...a,screeningText:a.description,discovery:{version:1,status:'service_match'},firstFoundAt:'2026-10-01T00:00:00Z'});
 old.findings=[entry(apps.find(a=>a.appId==='co.randomiban'))];old.reviewCandidates=[{...entry(business),discovery:{version:1,status:'needs_review'}}];await writeFile(file,JSON.stringify(old));
 const s=await openStore(file,now);assert.equal(s.state.findings.length,2);assert.equal(s.state.findings.find(a=>a.appId==='co.randomiban').discovery.rejection,'iban_utility');assert.equal(s.state.reviewCandidates.length,0);assert.equal(s.state.findings.find(a=>a.appId===business.appId).firstFoundAt,'2026-10-01T00:00:00Z');assert.deepEqual(s.state.schedule.filters.excludeAppIds,['com.excluded.app']);assert.equal(s.state.schedule.enabled,false);assert.equal(DISCOVERY_VERSION,2);
 old.social.schedule.filters.sources=['forums'];delete old.social.schedule.filters.eventMode;await writeFile(file,JSON.stringify(old));const forum=await openStore(file,now);assert.equal(forum.state.social.schedule.filters.eventMode,'signals');assert.equal((await openStore(file,now)).state.social.schedule.filters.eventMode,'signals');
});
test('launch screening separates named product launches from commentary, plans, funding and other products',()=>{
 const desc='Open business accounts with EUR IBAN and SEPA transfers for companies in Europe.';
 for(const title of ['Acme launches business accounts in Europe','Acme introduces multicurrency accounts with IBAN','Introducing Acme: business banking for Europe'])assert.equal(assessLaunch({title,description:desc}).kind,'live_launch',title);
 for(const title of ['How business banking launches are reshaping Europe','The future of business accounts with IBAN','Best new business bank accounts for Europe'])assert.equal(assessLaunch({title,description:desc}).kind,'commentary',title);
 assert.equal(assessLaunch({title:'Acme plans to launch business accounts',description:desc}).kind,'planned_launch');
 assert.equal(assessLaunch({title:'Acme launches AI assistant for business banking',description:desc}).kind,'other_event');
 assert.equal(assessLaunch({title:'Acme raises EUR 10m to build business accounts',description:desc}).kind,'not_launch');
});
test('launch feed uses announcement sources, rejects opinion articles and leaves forums accessible in signals mode',()=>{
 const c=validateSocialConfig(socialPreset(),now),plan=socialPlan(c,now);assert.equal(plan.total,24);assert.equal(plan.cycleDays,3);assert.equal(plan.requests.length,8);assert.ok(!plan.requests.some(r=>['registers','reddit','forums','appstore'].includes(r.source)));
 const entry={url:'https://finextra.com/newsarticle/1/acme',title:'Acme launches business accounts in Europe',description:'Open business accounts with EUR IBAN and SEPA transfers for companies in Europe.',page_age:'2026-10-20'};
 assert.ok(evaluatePost(entry,'finextra',c,now).post);assert.equal(evaluatePost({...entry,title:'How business banking launches are changing Europe'},'finextra',c,now).reason,'commentary');assert.equal(evaluatePost({...entry,title:'Acme plans to launch business accounts'},'finextra',c,now).reason,'planned');
 assert.ok(socialPlan({...c,eventMode:'signals',requestBudget:64},now).requests.some(r=>r.source==='forums'));
});
test('reference storefront URLs retain user DE/AT/IT regions and catalog mode does not claim apps are newly released',()=>{
 const c=cfg({seedApps:['https://play.google.com/store/apps/details?id=it.hype.business&gl=IT']});assert.equal(c.seedCountries['it.hype.business'],'IT');assert.equal(REFERENCE_COUNTRIES['com.bankera.wallet'],'AT');assert.equal(c.ignoreReleaseDate,true);assert.throws(()=>cfg({seedCountries:4}));
});
test('backlog endpoint refuses empty work and retains JSON/auth guards',async t=>{
 const s=createApp({store:memoryStore(now),password:'precision-pass'});await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>s.close(r)));const base=`http://127.0.0.1:${s.address().port}`,headers={Authorization:'Basic '+Buffer.from('admin:precision-pass').toString('base64'),'Content-Type':'application/json'};
 assert.equal((await fetch(base+'/api/backlog/continue',{method:'POST',headers,body:'{}'})).status,409);assert.equal((await fetch(base+'/api/backlog/continue',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);assert.equal((await fetch(base+'/launches.js',{headers})).status,200);
});
