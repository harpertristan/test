import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assessBanking, validateCriteria, excluded, eligibleFinding, EU_IBAN_CODES } from '../lib/qualification.js';
import { validateConfig, createJob, runSearch } from '../lib/search.js';
import { evaluatePost, validateSocialConfig, createSocialJob, runSocialSearch } from '../lib/social-search.js';
import { memoryStore, openStore, initialState } from '../lib/store.js';
import { createMonitor } from '../lib/monitor.js';
import { braveProvider } from '../lib/brave-provider.js';
import { saveKey } from '../scripts/configure-brave.js';
const now=new Date('2026-10-19T12:00:00Z');
const text='Open a business account with a German IBAN. We are a licensed bank.';
const criteria=validateCriteria();
const assess=(value,config=criteria)=>assessBanking([{text:value,url:'https://example.eu/business',label:'Test source'}],config);
const config=validateConfig({countries:['DE'],keywords:['business account'],from:'2026-09-19',to:'2026-10-19'},now);
const app=(patch={})=>({appId:'com.eu.bank',title:'New Bank',description:text,genreId:'FINANCE',price:0,free:true,minInstalls:500,released:'2026-10-01',...patch});
const socialConfig=(patch={})=>validateSocialConfig({sources:['web'],queries:['business account IBAN'],...patch},now);

test('defaults require a bank, business account and EU IBAN; retain evidence and never certify a licence',()=>{
 assert.equal(criteria.strictBanking,true);assert.equal(criteria.institutionType,'bank');assert.equal(EU_IBAN_CODES.length,27);
 const result=assess(text);assert.equal(result.status,'text_matches');assert.equal(result.evidence.euIban[0].url,'https://example.eu/business');assert.match(result.notice,/проверить/);
 for(const missing of ['We are a bank in Europe.','Business loan and insurance comparison in Germany.','Business account with UPI and IFSC. We are a licensed bank.','Personal account with a German IBAN. We are a licensed bank.','Open a business account with a German IBAN.']) assert.equal(assess(missing).status,'insufficient_evidence',missing);
});
test('SEPA, European presence and non-EU GB/CH/NO IBANs are insufficient',()=>{
 for(const iban of ['SEPA payments','European IBAN','GB IBAN','Swiss IBAN','Norwegian IBAN']) assert.equal(assess(`Open a business account with ${iban}. We are a licensed bank.`).status,'insufficient_evidence',iban);
 for(const iban of ['EU IBAN','French IBAN','Lithuanian IBAN','IE IBAN']) assert.equal(assess(`Open a business account with ${iban}. We are a licensed bank.`).status,'text_matches',iban);
});
test('negative, future, transfer-destination, personal-product and partner licence claims do not pass',()=>{
 for(const value of [
  'We do not offer business accounts with German IBAN. We are a licensed bank.',
  'We will offer business accounts with German IBAN. We are a licensed bank.',
  'Open a business account to send money to a German IBAN. We are a licensed bank.',
  'Our business accounts have a GB IBAN and our personal accounts have a German IBAN. We are a licensed bank.',
  'Open a business account with a German IBAN. Our partner is a licensed bank.',
  'Open a business account with a German IBAN. We are not a licensed bank.',
 ]) assert.equal(assess(value).status,'insufficient_evidence',value);
});
test('EMIs require an explicit choice and are excluded in bank-only mode',()=>{
 const value='Open a business account with a French IBAN. We are an electronic money institution.';
 assert.equal(assess(value).status,'insufficient_evidence');
 assert.equal(assess(value,validateCriteria({institutionType:'bank_or_emi'})).status,'text_matches');
});
test('literal exclusions cover country names, exact IDs and domain boundaries',()=>{
 assert.equal(excluded({text:'SeaBank Indonesia'},criteria),'excludedTerm');
 assert.equal(excluded({text:'Business UPI payments'},criteria),'excludedTerm');
 const c=validateCriteria({excludeTerms:['[x]'],excludeAppIds:['com.bank'],excludeDomains:['example.eu']});
 assert.equal(excluded({text:'Product [X]'},c),'excludedTerm');
 assert.equal(excluded({appId:'com.bank'},c),'excludedId');
 assert.equal(excluded({url:'https://sub.example.eu/path'},c),'excludedDomain');
 assert.equal(excluded({url:'https://example.eu.attacker.test/path'},c),null);
 for(const bad of [{strictBanking:'true'},{institutionType:'anything'},{excludeTerms:['']},{excludeDomains:['example.eu/path']},{excludeTerms:Array(81).fill('x')}]) assert.throws(()=>validateCriteria(bad));
});
test('Google Play EU storefront alone cannot qualify an unrelated financial app',async()=>{
 const job=createJob('strict',config);
 const list=[app(),app({appId:'com.india',title:'India Bank',description:'UPI loan app'}),app({appId:'com.wallet',description:'Business budgeting and invoices in Germany.'})];
 await runSearch(job,{search:async()=>list,app:async({appId})=>list.find(a=>a.appId===appId)},{delay:0});
 assert.equal(job.results.length,1);assert.equal(job.skipped.excludedTerm,1);assert.equal(job.skipped.banking,1);assert.equal(job.results[0].qualification.status,'text_matches');
});
test('official website evidence search is domain-restricted, ignores spoof URLs and never invents missing evidence',async()=>{
 const job=createJob('enrich',config);const queries=[];
 await runSearch(job,{search:async()=>[app()],app:async()=>app({description:'Open a business account.',developerWebsite:'https://www.example.eu'}),research:{configured:()=>true,search:async opts=>{queries.push(opts);return [
  {url:'https://example.eu/business',title:'Business',description:text},
  {url:'https://example.eu.attacker.test',title:'Spoof',description:text},
 ];}}},{delay:0});
 assert.equal(job.results.length,1);assert.match(queries[0].q,/^site:example.eu /);assert.equal(queries[0].freshness,undefined);assert.equal(job.enrichmentRequests,1);
 assert.ok(job.results[0].qualification.evidence.euIban.every(e=>new URL(e.url).hostname==='example.eu'));
});
test('news, custom sites, web and App Store results respect source domains and own country-independent identity',()=>{
 for(const [source,url] of [['finextra','https://finextra.com/newsarticle/123/new-bank'],['sifted','https://sifted.eu/articles/new-bank'],['tech','https://tech.eu/2026/new-bank'],['appstore','https://apps.apple.com/de/app/new-bank/id123456789'],['custom','https://example.eu/business'],['web','https://example.eu/business']]) {
  const c=socialConfig({sources:[source],watchDomains:source==='custom'?['example.eu']:[]});
  const result=evaluatePost({url,title:'New bank launches business accounts in Germany',description:text},source,c,now);
  assert.equal(result.post.qualification.status,'text_matches',source);
  if(source!=='web') assert.equal(evaluatePost({url:'https://attacker.test/x',title:'Launch',description:text},source,c,now).reason,'notPost');
 }
 const a=evaluatePost({url:'https://apps.apple.com/de/app/a/id123456789',title:'Business account',description:text},'appstore',socialConfig(),now).post;
 const b=evaluatePost({url:'https://apps.apple.com/fr/app/b/id123456789?utm_campaign=test',title:'Business account',description:text},'appstore',socialConfig(),now).post;
 assert.equal(a.id,b.id);
});
test('custom domains and source restrictions are validated within API query limits',()=>{
 for(const patch of [{sources:['custom']},{sources:['custom'],watchDomains:['https://example.eu']},{watchDomains:['localhost']},{watchDomains:['example.eu/x']},{watchDomains:Array(11).fill('example.eu')},{sources:{}}]) assert.throws(()=>socialConfig(patch));
 assert.equal(socialConfig({sources:['custom'],watchDomains:['example.eu']}).watchDomains[0],'example.eu');
});
test('one URL discovered in news and web is not added twice, and exclusions persist in schedules',async()=>{
 const store=memoryStore(now);const url='https://finextra.com/newsarticle/123/new-bank';
 const monitor=createMonitor({kind:'social',store,delay:0,clock:()=>now,provider:{configured:()=>true,search:async()=>[{url,title:'Bank launches business accounts in Germany',description:text}]}});
 const filters={sources:['finextra','web'],queries:['business account'],excludeTerms:[],excludeDomains:['blocked.eu']};
 await monitor.saveSchedule({enabled:true,time:'11:00',filters});
 const job=await monitor.startJob(filters);await monitor.idle();assert.equal(job.results.length,1);assert.equal(job.skipped.duplicate,1);
 assert.deepEqual(store.state.social.schedule.filters.excludeDomains,['blocked.eu']);
 const repeat=await monitor.startJob(filters);await monitor.idle();assert.equal(repeat.results.length,0);
});
test('old unqualified history is retained in archive, rechecked without duplicates and upgraded without changing first-found date',async()=>{
 const store=memoryStore(now);const first='2026-10-01T12:00:00Z';
 await store.update(s=>s.findings.push({appId:'com.eu.bank',title:'Old',firstFoundAt:first}));
 const monitor=createMonitor({store,delay:0,clock:()=>now,provider:{search:async()=>[app()],app:async()=>app()}});
 assert.equal(monitor.findings().length,0);assert.equal(monitor.findings({all:true}).length,1);
 const job=await monitor.startJob(config);await monitor.idle();assert.equal(job.results.length,0);assert.equal(monitor.findings().length,1);assert.equal(monitor.findings()[0].firstFoundAt,first);
 await monitor.saveSchedule({enabled:false,time:'11:00',filters:{...config,excludeAppIds:['com.eu.bank']}});
 assert.equal(monitor.findings().length,0);assert.equal(monitor.findings({all:true}).length,1);
});
test('migration restores profile defaults while preserving history and persisted exclusions after reload',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'bank-criteria-'));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'state.json');
 const state=initialState(now);delete state.schedule.filters.strictBanking;delete state.schedule.filters.excludeTerms;state.findings=[{appId:'legacy.app',title:'Legacy'}];
 await writeFile(path,JSON.stringify(state));let store=await openStore(path,now);assert.equal(store.state.schedule.filters.strictBanking,false);assert.equal(store.state.schedule.filters.profile,'business');assert.equal(store.state.findings.length,1);
 const monitor=createMonitor({store,clock:()=>now,provider:{search:async()=>[]}});await monitor.saveSchedule({enabled:false,time:'12:30',filters:{...config,excludeTerms:['India','Wallet'],excludeAppIds:['com.no'],excludeDomains:['bad.eu']}});
 store=await openStore(path,now);assert.deepEqual(store.state.schedule.filters.excludeTerms,['India','Wallet']);assert.deepEqual(store.state.schedule.filters.excludeAppIds,['com.no']);assert.equal(store.state.findings.length,1);
});
test('local key configuration preserves other settings, hides values and writes a private .env',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'bank-key-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await writeFile(join(dir,'.env'),'APP_PASSWORD=existing-test-password\nBRAVE_SEARCH_API_KEY=old-test-key\n');
 await saveKey('new-fixture-only-key',dir);const content=await readFile(join(dir,'.env'),'utf8');
 assert.match(content,/APP_PASSWORD=existing-test-password/);assert.match(content,/BRAVE_SEARCH_API_KEY=new-fixture-only-key/);assert.ok(!content.includes('old-test-key'));assert.equal((await stat(join(dir,'.env'))).mode&0o777,0o600);
 await assert.rejects(saveKey('unsafe\nOTHER=value',dir));assert.equal(await readFile(join(dir,'.env'),'utf8'),content);
});

test('shared Brave connection serializes simultaneous site and discovery requests within rate limits',async()=>{
 const starts=[];let inFlight=0;
 const provider=braveProvider({key:'fixture-only-key',minInterval:25,request:async()=>{assert.equal(inFlight++,0);starts.push(Date.now());await new Promise(r=>setTimeout(r,5));inFlight--;return {type:'search'};}});
 await Promise.all([provider.search({q:'one',count:5}),provider.search({q:'two',count:5}),provider.search({q:'three',count:5})]);
 assert.equal(starts.length,3);assert.ok(starts[1]-starts[0]>=20);assert.ok(starts[2]-starts[1]>=20);
});

test('an evidence API failure stops further paid lookups and reports actual usage and incomplete status',async()=>{
 let calls=0;
 const list=[app({appId:'one',description:'Business account',developerWebsite:'https://example.eu'}),app({appId:'two',description:'Business account',developerWebsite:'https://example.eu'})];
 const job=createJob('evidence-failure',config);
 await runSearch(job,{search:async()=>list,app:async({appId})=>list.find(a=>a.appId===appId),research:{configured:()=>true,search:async()=>{calls++;throw new Error('fixture failure');}}},{delay:0});
 assert.equal(calls,1);assert.equal(job.enrichmentRequests,1);assert.equal(job.status,'partial');assert.equal(job.results.length,0);assert.equal(job.errors[0].code,'EVIDENCE_SOURCE');
});
