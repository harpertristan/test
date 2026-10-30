import test from 'node:test';import assert from 'node:assert/strict';
import {memoryStore} from '../lib/store.js';import {reviewConfig} from '../lib/ai-config.js';import {createAIReview} from '../lib/ai-review.js';import {reviewRouter} from '../lib/ollama-provider.js';import {resetForReview} from '../lib/review-cycle.js';import {createApp,shutdownApp} from '../server.js';
const now=new Date('2026-10-30T10:00:00Z'),text='We offer business accounts to companies with a dedicated German IBAN and SEPA transfers.';
const noIndex={configured:()=>false},pages={page:async url=>({url,text,body:'<a href="/business">Business</a>'})};
const empty={status:'unknown',evidence:[]};
const answer=model=>({assessment:{business:empty,account:empty,euIban:empty,utility:empty,availability:{status:'unknown',evidence:[]},service:{name:'',evidence:[]},summaryRu:'Нужна проверка условий.',translations:[],licences:[]},model,usage:{inputTokens:11,outputTokens:7}});
function fixture(n=8){const store=memoryStore(now);for(const section of[store.state,store.state.web,store.state.social,store.state.watch])section.schedule.enabled=false;for(let i=0;i<n;i++)store.state.findings.push({appId:'co.hybrid.app'+i,title:'Hybrid '+i,url:'https://play.google.com/store/apps/details?id=co.hybrid.app'+i,developerWebsite:'https://hybrid'+i+'.eu/',screeningText:text,firstFoundAt:'2026-10-01T00:00:00Z'});return store;}
function provider(engine,assess){return{engine,model:engine==='ollama'?'ollama:qa':'gpt-qa',configured:()=>true,assess};}

test('hybrid workers share one queue, each successful card uses exactly one engine and its own usage/cache',async()=>{
 const store=fixture(12);store.state.ai.config=reviewConfig({engine:'hybrid',cloudConcurrency:2});let open=0,local=0,maxOpen=0,maxLocal=0;const titles=new Set();
 let gptEntered,ollamaEntered;const gptReady=new Promise(r=>gptEntered=r),localReady=new Promise(r=>ollamaEntered=r);
 const make=engine=>provider(engine,async({title})=>{assert.ok(!titles.has(title));titles.add(title);if(engine==='ollama'){local++;maxLocal=Math.max(maxLocal,local);ollamaEntered();await gptReady;}else{open++;maxOpen=Math.max(maxOpen,open);gptEntered();await localReady;}await new Promise(r=>setTimeout(r,engine==='ollama'?25:2));if(engine==='ollama')local--;else open--;return answer(engine==='ollama'?'ollama:qa':'gpt-qa');});
 const router=reviewRouter({store,openai:make('openai'),ollama:make('ollama')}),review=createAIReview({store,provider:router,pages,index:noIndex,clock:()=>now});
 const job=await review.startJob();await review.idle();assert.equal(job.engine,'hybrid');assert.equal(store.state.ai.results.length,12);assert.equal(titles.size,12);assert.equal(maxLocal,1);assert.equal(maxOpen,2);assert.ok(store.state.ai.results.some(r=>r.engine==='ollama'));assert.ok(store.state.ai.results.some(r=>r.engine==='openai'));
 const cloud=store.state.ai.usage['2026-10'],localUsage=store.state.ai.localUsage['2026-10'];assert.equal(cloud.attempts+localUsage.attempts,12);assert.equal(cloud.inputTokens,cloud.attempts*11);assert.equal(localUsage.inputTokens,localUsage.attempts*11);assert.equal(review.summary().due,0);await assert.rejects(review.startJob(),{status:409});await review.stop();
});

test('a failed Ollama lane does not halt GPT and leaves the failed card available',async()=>{
 const store=fixture();store.state.ai.config=reviewConfig({engine:'hybrid',cloudConcurrency:1});let cloud=0,local=0;
 const router=reviewRouter({store,openai:provider('openai',async()=>{cloud++;return answer('gpt-qa');}),ollama:provider('ollama',async()=>{local++;throw Object.assign(new Error('local private error'),{code:'LOCAL_TIMEOUT'});})});
 const review=createAIReview({store,provider:router,pages,index:noIndex,clock:()=>now});await review.startJob();await review.idle();const job=store.state.ai.jobs.at(-1);assert.equal(local,1);assert.equal(cloud,7);assert.equal(job.status,'partial');assert.equal(job.remainingIds.length,1);assert.ok(!JSON.stringify(job).includes('private error'));assert.ok(job.workers.some(w=>w.engine==='ollama'&&w.status==='failed'));await review.stop();
});

test('full manual API handles more than one screen, preserves decisions and resumes only unfinished eligible cards',async t=>{
 const store=fixture(63);store.state.manualExclusions.push({key:'worked',kind:'domain',value:'hybrid0.eu',reason:'worked'});resetForReview(store.state,{now});
 store.state.manualExclusions.push({key:'manual',kind:'domain',value:'hybrid1.eu',reason:'not_provider'});store.state.crm.records['company:hybrid2.eu'].status='approved';store.state.crm.records['company:hybrid2.eu'].needsManualReview=false;store.state.ai.config=reviewConfig({engine:'openai',cloudConcurrency:1});
 let attempts=0,stall=true;const completed=[],fetched=[];
 const api=provider('openai',async({title},{signal})=>{attempts++;if(stall&&attempts===3)await new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});completed.push(title);return answer('gpt-qa');});
 const server=createApp({store,clock:()=>now,provider:{search:async()=>[],app:async()=>({title:'Fresh listing',description:text})},aiProvider:api,aiPages:{page:async url=>{fetched.push(url);return{url,text,body:''};}},socialProvider:noIndex});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>shutdownApp(server));const base='http://127.0.0.1:'+server.address().port,post=body=>fetch(base+'/api/crm/manual/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const first=await post({});assert.equal(first.status,202);const started=await first.json();assert.equal(started.total,60);assert.equal(started.scope,'manual');
 for(let i=0;i<500&&attempts<3;i++)await new Promise(r=>setTimeout(r,5));assert.equal(attempts,3);await server.aiReview.cancel();const checkpoint=store.state.ai.manualBatch;assert.equal(checkpoint.remainingIds.length,58);assert.equal(completed.length,2);assert.ok(fetched.length>=3);assert.equal(store.state.crm.records['company:hybrid2.eu'].status,'approved');
 const excluded=checkpoint.remainingIds[0];await store.update(d=>d.manualExclusions.push({key:'late',kind:'domain',value:excluded.slice(8),reason:'not_provider'}));stall=false;
 const resumed=await post({resume:true});assert.equal(resumed.status,202);assert.equal((await resumed.json()).total,57);await server.aiReview.idle();assert.equal(new Set(completed).size,59);assert.equal(completed.length,59);assert.equal(store.state.ai.manualBatch.remainingIds.length,0);assert.ok(!completed.includes('Hybrid 0'));assert.ok(!completed.includes('Hybrid 1'));assert.ok(!completed.includes('Hybrid 2'));assert.ok(!completed.includes('Hybrid '+excluded.match(/hybrid(\d+)/)[1]));assert.ok(store.state.manualExclusions.some(r=>r.reason==='worked'));assert.equal((await post({resume:true})).status,409);
});

test('manual batch start is protected by owner access and cross-site guards',async t=>{
 const store=fixture(1);resetForReview(store.state,{now});const server=createApp({store,password:'owner',viewerPassword:'reader',socialProvider:noIndex});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>shutdownApp(server));const url='http://127.0.0.1:'+server.address().port+'/api/crm/manual/start';
 const send=(user,extra={})=>fetch(url,{method:'POST',headers:{Authorization:'Basic '+Buffer.from(user).toString('base64'),'Content-Type':'application/json',...extra},body:'{}'});assert.equal((await send('viewer:reader')).status,403);assert.equal((await send('admin:owner',{'Sec-Fetch-Site':'cross-site'})).status,403);assert.equal(store.state.ai.jobs.length,0);
});

test('manual site checks continue after Play card refresh fails, without refreshing thousands of failing listings',async()=>{
 const store=fixture(7);resetForReview(store.state,{now});store.state.ai.config=reviewConfig({cloudConcurrency:1});let listingCalls=0,models=0,sites=0;
 const review=createAIReview({store,provider:provider('openai',async()=>{models++;return answer('gpt-qa');}),pages:{page:async url=>{sites++;return{url,text,body:''};}},index:noIndex,clock:()=>now,playSource:{app:async()=>{listingCalls++;throw Object.assign(new Error('source timeout'),{code:'API_TIMEOUT'});}}});
 const ids=Object.keys(store.state.crm.records);await review.startJob({ids,manualAll:true});await review.idle();assert.equal(listingCalls,3);assert.equal(models,7);assert.equal(sites,7);assert.equal(store.state.ai.results.length,7);assert.ok(store.state.ai.results.every(r=>r.sourceErrors.some(e=>e.includes('Google Play недоступна'))));await review.stop();
});

test('a name-only manual record resolves a matching provider site without analysing unrelated articles',async()=>{
 const store=fixture(0);store.state.crm.reviewEntries=[{id:'registry:omex',recheckId:'registry:omex',title:'Omexpay Business',originSection:'web',registryOnly:true,documents:[],targets:[]}];store.state.crm.records['registry:omex']={status:'review',needsManualReview:true};let paid=0;const visited=[];
 const index={configured:()=>true,search:async()=>[{title:'Omexpay article',url:'https://news.example.com/omexpay'},{title:'Omexpay Business',url:'https://omexpay.eu/business'}]};
 const review=createAIReview({store,provider:provider('openai',async()=>{paid++;return answer('gpt-qa');}),pages:{page:async url=>{visited.push(url);return{url,text:'Omexpay offers business accounts with a German IBAN.',body:'<a href="/login">Web login</a>'};}},index,clock:()=>now});
 await review.startJob({ids:['registry:omex'],manualAll:true});await review.idle();assert.equal(paid,1);assert.ok(visited.every(url=>url.startsWith('https://omexpay.eu/')));assert.equal(store.state.ai.results[0].developerWebsite,'https://omexpay.eu/business');assert.ok(store.state.ai.results[0].webPresence.cabinet.links.includes('https://omexpay.eu/login'));await review.stop();
});
