import test from 'node:test';import assert from 'node:assert/strict';import {runSearch,createJob,validateConfig} from '../lib/search.js';import {cataloguePreset} from '../lib/discovery.js';import {runProvider} from '../lib/run-context.js';
const card={appId:'co.streaming.bank',title:'Stream Business',genreId:'FINANCE',price:0,free:true,minInstalls:1000,released:'Oct 1, 2026',description:'We offer business accounts with a dedicated German IBAN and SEPA transfers.',developerWebsite:'https://streaming.eu/'};
const config=extra=>validateConfig({...cataloguePreset(['DE']),keywords:['business account'],seedApps:[],related:false,developerExpansion:false,useWebIndex:false,ignoreReleaseDate:true,...extra},new Date('2026-10-30'));

test('first search batch is checked while later Play pages are still pending',{timeout:3000},async()=>{
 let release;const pagination=new Promise(r=>release=r);let complete=false,checkedBeforePagination=false;
 const provider={search:async options=>{options.onBatch([card]);await pagination;complete=true;return[card];},app:async()=>card};const job=createJob('stream',config());
 await runSearch(job,runProvider(provider,new AbortController().signal,{timeoutMs:1000}),{delay:0,onMatch:async entry=>{checkedBeforePagination=!complete;release();return entry;}});assert.equal(checkedBeforePagination,true);assert.equal(job.results.length,1);assert.equal(job.status,'complete');
});

test('slow seed recommendations cannot hold the detail queue behind them',{timeout:3000},async()=>{
 let release;const recommendations=new Promise(r=>release=r);let finished=false,early=false;
 const job=createJob('seed',config({seedApps:[card.appId],related:true}));const provider={search:async()=>[],app:async()=>card,related:async()=>{await recommendations;finished=true;return[];}};
 await runSearch(job,runProvider(provider,new AbortController().signal,{timeoutMs:1000}),{delay:0,onMatch:async entry=>{early=!finished;release();return entry;}});assert.equal(early,true);assert.equal(job.results.length,1);
});

test('three search timeouts stop new queries but retain and process their received card batches',{timeout:3000},async()=>{
 let searches=0;const job=createJob('partial',config({keywords:['business account','corporate account','SEPA account','banking']}));
 await runSearch(job,{search:async options=>{searches++;options.onBatch([card]);throw Object.assign(new Error('timeout'),{code:'API_TIMEOUT'});},app:async()=>card},{delay:0});assert.equal(searches,3);assert.equal(job.results.length,1);assert.equal(job.detailDone,1);assert.equal(job.status,'partial');assert.ok(job.errors.some(e=>e.code==='SOURCE_UNAVAILABLE'));
});


test('a batch arriving during a backlog checkpoint is not marked queued before entering the detail queue',{timeout:3000},async()=>{
 const second={...card,appId:'co.streaming.second',title:'Second Business'};let publish,first=true,streamed=false;
 const job=createJob('checkpoint',config());
 await runSearch(job,{search:options=>{if(streamed)return Promise.resolve([second]);streamed=true;return new Promise(resolve=>{publish=()=>{options.onBatch([second]);resolve([second]);};});},app:async({appId})=>appId===second.appId?second:card},{delay:0,pendingCandidates:[{appId:card.appId,detailCountries:['DE']}],onBacklog:async()=>{if(first){first=false;publish();}}});
 assert.equal(job.results.length,2);assert.equal(job.detailDone,2);assert.equal(job.pendingCount,0);
});
