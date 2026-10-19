import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {assessDiscovery,discoveryPreset,validateDiscovery,searchPlan,parsePlayId,relatedIds} from '../lib/discovery.js';
import {assessBanking,validateCriteria,eligibleFinding} from '../lib/qualification.js';
import {validateConfig,createJob,runSearch,COUNTRIES,playFilters} from '../lib/search.js';
import {memoryStore,openStore,initialState} from '../lib/store.js';
import {createMonitor} from '../lib/monitor.js';
import {createApp} from '../server.js';
import {SOCIAL_QUERIES,BUSINESS_SOCIAL_QUERIES,validateSocialConfig} from '../lib/social-search.js';
const now=new Date('2026-10-19T12:00:00Z');
const fixtures=JSON.parse(await readFile(new URL('./fixtures/play-examples.json',import.meta.url),'utf8')).apps;
const config=(patch={})=>validateConfig({...discoveryPreset(['DE']),seedApps:[],referenceDomains:[],useWebIndex:false,...patch},now);
function classify(app,c=config()) {const docs=[{text:app.description,url:app.developerWebsite,label:'Google Play fixture'}];return assessDiscovery(docs,c,assessBanking(docs,c),app.appId);}
const provider=(list)=>({search:async()=>list,app:async({appId})=>list.find(a=>a.appId===appId)});

test('Stable.com real card matches business-service profile without inventing EU IBAN or a licence',()=>{
 const app=fixtures.find(a=>a.appId==='com.stablecom.app'),result=classify(app);
 assert.equal(result.status,'service_match');assert.equal(result.business,'mentioned');assert.equal(result.iban,'mentioned');assert.equal(result.euIban,'unknown');assert.equal(result.licence,'unknown');assert.equal(result.businessAccountVerified,false);
});
test('Kleos real card is retained for review; its business service cannot be inferred from a Euro IBAN',()=>{
 const result=classify(fixtures.find(a=>a.appId==='com.kleos.baas'));
 assert.equal(result.status,'needs_review');assert.equal(result.business,'unknown');assert.equal(result.iban,'mentioned');assert.equal(result.euIban,'unknown');
});
test('similar names, US expense cards, consumer wallets and pure crypto do not become business EU accounts',()=>{
 for(const id of ['com.equals.stable','com.ramp.android.app','com.cardblue.lirapay','com.mobile.zarpay'])assert.equal(classify(fixtures.find(a=>a.appId===id)).status,'not_relevant',id);
 for(const text of ['Business budgeting: track your money and organize international accounts and transfers.','Open a business account and trade Bitcoin in our Web3 wallet.','Business UPI account with IFSC for local payments.','Personal crypto wallet for DeFi and NFTs.'])assert.equal(classify({appId:'test.app',description:text}).status,'not_relevant',text);
});
test('global business fiat payouts can be reviewed despite a legal no-loans disclaimer',()=>{
 const result=classify(fixtures.find(a=>a.appId==='com.iteller'));assert.equal(result.status,'needs_review');
});
test('planner searches every chosen EU country and includes local-language queries without claiming identical searches',()=>{
 const c=config({countries:COUNTRIES.map(c=>c.code)}),plan=searchPlan(c);
 assert.equal(new Set(plan.map(x=>x.country)).size,27);assert.ok(plan.some(q=>q.lang==='de'));assert.ok(plan.some(q=>q.lang==='fr'));
 assert.ok(plan.filter(q=>q.country==='DE').length>plan.filter(q=>q.country==='AT').length);
 const full=searchPlan({...c,plan:'full'});assert.ok(full.length>plan.length);assert.equal(full.filter(q=>q.country==='AT').length,c.keywords.length);
});
test('direct Play IDs are validated and cards cannot be imported from spoof or unrelated URLs',()=>{
 assert.equal(parsePlayId('https://play.google.com/store/apps/details?id=com.stablecom.app&hl=en'),'com.stablecom.app');
 for(const raw of ['https://play.google.com.attacker.test/store/apps/details?id=com.foo','javascript:alert(1)','https://evil.test/?id=com.foo','https://play.google.com/store/search?id=com.foo','https://u:p@play.google.com/store/apps/details?id=com.foo'])assert.equal(parsePlayId(raw),null);
 for(const patch of [{seedApps:['bad']},{releaseMonths:2},{maxDetails:0},{referenceDomains:['https://stable.com']},{profile:'anything'}])assert.throws(()=>config(patch));
 assert.deepEqual(relatedIds('/store/apps/details?id=com.own /store/apps/details?id=com.other /store/apps/details?id=com.other','com.own'),[{appId:'com.other'}]);
});
test('unseeded search finds Stable and retains Kleos as a candidate using real public descriptions',async()=>{
 const list=fixtures.filter(a=>['com.stablecom.app','com.kleos.baas'].includes(a.appId));const job=createJob('positive',config());
 await runSearch(job,provider(list),{delay:0});assert.equal(job.status,'complete');assert.deepEqual(job.results.map(a=>a.appId),['com.stablecom.app']);assert.deepEqual(job.reviewCandidates.map(a=>a.appId),['com.kleos.baas']);assert.equal(job.results[0].isReference,false);assert.deepEqual(job.results[0].discoverySources,['query']);
});
test('direct examples obey filters and are marked, never manufactured from unrelated search results',async()=>{
 const stable=fixtures.find(a=>a.appId==='com.stablecom.app');const c=config({seedApps:[stable.appId],excludeAppIds:[stable.appId]});const job=createJob('reference',c);
 await runSearch(job,{search:async()=>[],app:async()=>stable},{delay:0});assert.equal(job.results.length,0);assert.equal(job.skipped.excludedId,1);
 const allowed=createJob('allowed',config({seedApps:[stable.appId]}));await runSearch(allowed,{search:async()=>[],app:async()=>stable},{delay:0});assert.equal(allowed.results[0].isReference,true);assert.ok(!allowed.results[0].discoverySources.includes('query'));assert.equal(allowed.results[0].countries.length,0);
});
test('card budget is explicit and a partial search, not a zero-result success',async()=>{
 const stable=fixtures.find(a=>a.appId==='com.stablecom.app'),list=[stable,{...stable,appId:'new.other.app'}];const job=createJob('budget',config({maxDetails:1}));
 await runSearch(job,provider(list),{delay:0});assert.equal(job.status,'partial');assert.equal(job.detailDone,1);assert.equal(job.errors[0].code,'DETAIL_BUDGET');
});
test('extra Play IDs from Brave are source-restricted and do not replace Google Play card verification',async()=>{
 const stable=fixtures.find(a=>a.appId==='com.stablecom.app');let calls=0;
 const c=config({useWebIndex:true}),job=createJob('index',c);
 await runSearch(job,{search:async()=>[],app:async()=>stable,research:{configured:()=>true,search:async()=>{calls++;return [{url:'https://play.google.com/store/apps/details?id=com.stablecom.app'},{url:'https://play.google.com.attacker.test/store/apps/details?id=evil.fake'}];}}},{delay:0});
 assert.equal(job.results.length,1);assert.equal(job.results[0].appId,stable.appId);assert.deepEqual(job.results[0].discoverySources,['webIndex']);assert.equal(calls,3);assert.equal(job.braveRequests,3); // two index lookups and one official-site evidence lookup
});
test('migration switches legacy search to the examples profile while preserving history, countries and custom exclusions',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'profile-migrate-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=join(dir,'state.json');
 const old=initialState(now);old.schedule.filters={keywords:['старый запрос'],countries:['DE','LT'],minInstalls:100,limit:100,excludeTerms:['My exclusion'],excludeAppIds:['ignore.app'],excludeDomains:['bad.example']};old.findings=[{appId:'saved.old',title:'Saved'}];
 assert.deepEqual(old.social.schedule.filters.queries,BUSINESS_SOCIAL_QUERIES);delete old.social.schedule.filters.profile;old.social.schedule.filters.queries=SOCIAL_QUERIES;
 await writeFile(file,JSON.stringify(old));const store=await openStore(file,now),filters=store.state.schedule.filters;
 assert.equal(filters.profile,'business');assert.equal(filters.releaseMonths,12);assert.equal(filters.minInstalls,0);assert.equal(filters.strictBanking,false);assert.deepEqual(filters.countries,['DE','LT']);assert.deepEqual(filters.excludeTerms,['My exclusion']);assert.deepEqual(filters.excludeAppIds,['ignore.app']);assert.equal(store.state.findings[0].appId,'saved.old');
 assert.deepEqual(store.state.social.schedule.filters.queries,BUSINESS_SOCIAL_QUERIES);assert.deepEqual(validateSocialConfig({profile:'business',queries:['my custom query']},now).queries,['my custom query']);
 const again=await openStore(file,now);assert.deepEqual(again.state.schedule.filters,filters);
});
test('daily business schedule preserves a 12-month window and deduplicates apps across runs',async()=>{
 const stable=fixtures.find(a=>a.appId==='com.stablecom.app'),store=memoryStore(now);let clock=now;
 const monitor=createMonitor({store,provider:provider([stable]),delay:0,clock:()=>clock,autoSchedule:true});
 await monitor.saveSchedule({enabled:true,time:'09:00',filters:playFilters(config())});await monitor.tick();await monitor.idle();assert.equal(monitor.findings().length,1);assert.equal([...monitor.jobs.values()][0].config.from,'2025-10-19');
 clock=new Date(+now+86400000);await monitor.tick();await monitor.idle();const second=[...monitor.jobs.values()].at(-1);assert.equal(second.results.length,0);assert.equal(second.skipped.previouslySeen,1);assert.equal(second.config.from,'2025-10-20');
});
test('connection test reports actual API success without revealing keys or source error strings',async t=>{
 let ok=true,calls=0;const server=createApp({socialProvider:{configured:()=>true,search:async()=>{calls++;if(!ok)throw new Error('sensitive-provider-error');return [];}},store:memoryStore(now)});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const base=`http://127.0.0.1:${server.address().port}`;
 let response=await fetch(base+'/api/connections/brave/test',{method:'POST'});assert.equal(response.status,200);assert.equal((await response.json()).ok,true);assert.equal(calls,1);
 assert.ok((await(await fetch(base+'/api/monitor')).json()).evidenceConnection.verifiedAt);
 ok=false;response=await fetch(base+'/api/connections/brave/test',{method:'POST'});assert.equal(response.status,502);assert.ok(!(await response.text()).includes('sensitive-provider-error'));
});

test('requiring an EU-country IBAN is independent from the licence and retains unknowns for review',()=>{
 const stable=fixtures.find(a=>a.appId==='com.stablecom.app');const required=config({euIbanMode:'required'});
 assert.equal(classify(stable,required).status,'needs_review');
 const explicit={appId:'new.service',description:'Open a business account with a German IBAN and make SEPA transfers. We are an electronic money institution.'};
 const result=classify(explicit,required);assert.equal(result.status,'service_match');assert.equal(result.euIban,'explicit_claim');assert.equal(result.licence,'unknown');
 assert.throws(()=>config({euIbanMode:'invented'}));
});
test('phone storefront adds queries without removing chosen EU countries or treating its country as IBAN proof',()=>{
 const c=config({phoneCountry:'RU'}),plan=searchPlan(c);assert.ok(plan.some(q=>q.country==='RU'&&q.lang==='ru'));assert.ok(plan.some(q=>q.country==='DE'));
 assert.equal(searchPlan(validateConfig({countries:['DE'],phoneCountry:'RU'},now)).some(q=>q.country==='RU'),false);
 assert.throws(()=>config({phoneCountry:'RUSSIA'}));
});
test('already found apps are refreshed after a week, keeping their original identity and no duplicate new results',async()=>{
 const stable=fixtures.find(a=>a.appId==='com.stablecom.app'),store=memoryStore(now);let calls=0;
 const monitor=createMonitor({store,delay:0,clock:()=>now,provider:{search:async()=>[stable],app:async()=>{calls++;return stable;}}});
 await monitor.startJob(config());await monitor.idle();assert.equal(calls,1);
 await store.update(s=>{s.findings[0].checkedAt='2026-10-01T12:00:00Z';});
 const refresh=await monitor.startJob(config());await monitor.idle();assert.equal(calls,2);assert.equal(refresh.results.length,0);assert.equal(store.state.findings.length,1);
});
