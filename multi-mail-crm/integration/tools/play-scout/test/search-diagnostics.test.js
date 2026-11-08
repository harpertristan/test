import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {assessBanking,validateCriteria,developerURL,excluded} from '../lib/qualification.js';
import {validateConfig,createJob,runSearch,exclusion} from '../lib/search.js';
import {createMonitor} from '../lib/monitor.js';
import {openStore,memoryStore} from '../lib/store.js';
import {createApp} from '../server.js';
const now=new Date('2026-10-19T12:00:00Z');
const filters={keywords:['business account'],countries:['DE'],from:'2026-06-01',to:'2026-10-19'};
const config=patch=>validateConfig({...filters,...patch},now);
const account='Open a business account with a German IBAN. We are a licensed bank.';
const app=patch=>({appId:'com.test.business',title:'Business Bank',description:account,genreId:'FINANCE',free:true,price:0,minInstalls:500,released:'2026-08-01',...patch});
const assessment=text=>assessBanking([{text,url:'https://example.eu',label:'Fixture'}],validateCriteria());

test('no monthly fees or minimum balance do not negate an offered EU business account',()=>{
 for(const modifier of ['with no monthly fees','with no minimum balance','without paperwork']) {
  assert.equal(assessment(`Open a business account with a German IBAN ${modifier}. We are a licensed bank.`).status,'text_matches',modifier);
 }
 assert.equal(assessment('We do not offer business accounts with German IBAN. We are a licensed bank.').status,'insufficient_evidence');
});
test('adjacent statements about the same business account provide IBAN evidence; a personal account does not',()=>{
 assert.equal(assessment('Open a business account. Your German IBAN is included. We are a licensed bank.').status,'text_matches');
 assert.equal(assessment('Open a business account. Your personal account has a German IBAN. We are a licensed bank.').status,'insufficient_evidence');
 assert.equal(assessment('Open a business account. You can transfer money to a German IBAN. We are a licensed bank.').status,'insufficient_evidence');
});
test('business-account wording can describe an account designed for business instead of using a fixed phrase',()=>{
 const q=assessment('The all-in-one bank account helps you manage your business finances in Europe.');
 assert.equal(q.isCandidate,true);assert.equal(q.status,'insufficient_evidence');
});
test('review candidates require business and European evidence and exclude declared non-banks',()=>{
 assert.equal(assessment('Open a business account in Germany.').isCandidate,true);
 for(const text of ['Business budgeting tools in Germany.','Open a business account in India.','Open a personal account in Europe.','Open a business account with a GB IBAN in Europe.','Open a business account in Germany. We are not a bank.','Open a business account in Germany. We are an electronic money institution.']) assert.equal(assessment(text).isCandidate,false,text);
});
test('release filtering concerns first launch, optional all-time mode admits old or unknown releases',async()=>{
 assert.equal(exclusion(app({released:'2018-12-19',updated:+now}),config()),'date');
 const all=config({ignoreReleaseDate:true});
 assert.equal(exclusion(app({released:'2018-12-19'}),all),null);assert.equal(exclusion(app({released:undefined}),all),null);
 assert.throws(()=>config({ignoreReleaseDate:'true'}));
 const list=[app({appId:'old',released:'2018-12-19'}),app({appId:'unknown',released:undefined})];
 const job=createJob('any',all);await runSearch(job,{search:async()=>list,app:async({appId})=>list.find(a=>a.appId===appId)},{delay:0});
 assert.equal(job.status,'complete');assert.equal(job.results.length,2);assert.equal(job.results.find(a=>a.appId==='unknown').released,null);
});
test('date exclusions include examples and counts instead of silently showing an empty success',async()=>{
 const job=createJob('dates',config());
 await runSearch(job,{search:async()=>[app()],app:async()=>app({released:'2018-12-19'})},{delay:0});
 assert.equal(job.results.length,0);assert.equal(job.skipped.date,1);assert.equal(job.filterExamples[0].reason,'date');assert.equal(job.filterExamples[0].released,'2018-12-19');
});
test('English queries use English storefront language; Russian queries keep Russian',async()=>{
 const opts=[];const job=createJob('languages',config({keywords:['business account','бизнес счет']}));
 await runSearch(job,{search:async o=>{opts.push(o);return [];}},{delay:0});assert.deepEqual(opts.map(o=>o.lang),['en','ru']);
});
test('HTTP developer website links remain usable for indexed evidence and domain exclusions',()=>{
 assert.equal(developerURL('http://www.bunq.com').href,'https://www.bunq.com/');
 assert.equal(excluded({url:'http://www.bunq.com'},validateCriteria({excludeDomains:['bunq.com']})),'excludedDomain');
 assert.equal(developerURL('javascript:alert(1)'),null);
});
test('pending candidates persist, recheck without duplicate rows, and move to matches with their original first-found date',async t=>{
 const folder=await mkdtemp(join(tmpdir(),'search-review-'));t.after(()=>rm(folder,{recursive:true,force:true}));const file=join(folder,'state.json');
 let description='Open a business account in Germany.';let clock=now;
 const provider={search:async()=>[app()],app:async()=>app({description})};
 const store=await openStore(file,now);const monitor=createMonitor({store,provider,delay:0,clock:()=>clock});
 const first=await monitor.startJob(filters);await monitor.idle();assert.equal(first.results.length,0);assert.equal(first.reviewCandidates.length,1);assert.equal(monitor.candidates().length,1);assert.equal(monitor.findings().length,0);
 const reloaded=await openStore(file,now);const next=createMonitor({store:reloaded,provider,delay:0,clock:()=>clock});
 const repeat=await next.startJob(filters);await next.idle();assert.equal(repeat.reviewCandidates.length,0);assert.equal(next.candidates().length,1);
 clock=new Date(+now+86400000);description=account;
 const promoted=await next.startJob(filters);await next.idle();assert.equal(promoted.results.length,1);assert.equal(next.candidates().length,0);assert.equal(next.findings()[0].firstFoundAt,now.toISOString());
 const again=await next.startJob(filters);await next.idle();assert.equal(again.results.length,0);
});
test('manual review never bypasses dates or user exclusions, and missing evidence is counted',async()=>{
 const job=createJob('review',config());const list=[app({appId:'partial',description:'Open a business account in Germany.'}),app({appId:'excluded',description:'Open a business account in Germany. UPI is supported.'}),app({appId:'old',description:'Open a business account in Germany.',released:'2018-12-19'})];
 await runSearch(job,{search:async()=>list,app:async({appId})=>list.find(a=>a.appId===appId)},{delay:0});
 assert.deepEqual(job.reviewCandidates.map(a=>a.appId),['partial']);assert.equal(job.bankingMissing.euIban,1);assert.equal(job.bankingMissing.licence,1);assert.equal(job.skipped.excludedTerm,1);assert.equal(job.skipped.date,1);
});
test('candidate API and CSV remain separate from matches, and all-time schedule survives saves',async t=>{
 const server=createApp({store:memoryStore(now),delay:0,clock:()=>now,provider:{search:async()=>[app()],app:async()=>app({description:'Open a business account in Germany.'})}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const base=`http://127.0.0.1:${server.address().port}`;
 const post=(path,body)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 await post('/api/search',filters);await server.monitor.idle();
 assert.equal((await (await fetch(base+'/api/findings')).json()).length,0);assert.equal((await (await fetch(base+'/api/candidates')).json()).length,1);
 const csv=await(await fetch(base+'/api/candidates/export.csv')).text();assert.match(csv,/needs_review/);assert.match(csv,/insufficient_evidence/);
 const summary=await (await post('/api/schedule',{enabled:false,time:'10:00',filters:{...filters,ignoreReleaseDate:true}})).json();assert.equal(summary.schedule.filters.ignoreReleaseDate,true);assert.equal(summary.totalCandidates,1);assert.equal(summary.evidenceConnection.configured,false);
});

test('legacy findings with incomplete evidence become visible for review without duplicate records or new-find notifications',async()=>{
 const store=memoryStore(now);const first='2025-01-01T12:00:00Z';
 store.state.findings.push({appId:'com.test.business',title:'Old finding',firstFoundAt:first});
 let description='Open a business account in Germany.';
 const monitor=createMonitor({store,delay:0,clock:()=>now,provider:{search:async()=>[app()],app:async()=>app({description})}});
 let job=await monitor.startJob(filters);await monitor.idle();
 assert.equal(job.results.length,0);assert.equal(monitor.candidates().length,1);assert.equal(store.state.findings.length,1);assert.equal(store.state.reviewCandidates.length,0);
 description=account;job=await monitor.startJob(filters);await monitor.idle();
 assert.equal(job.results.length,0);assert.equal(monitor.candidates().length,0);assert.equal(monitor.findings().length,1);assert.equal(monitor.findings()[0].firstFoundAt,first);
});
