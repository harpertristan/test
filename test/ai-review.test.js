import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,stat} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {memoryStore,openStore} from '../lib/store.js';
import {createAIReview,collectEvidence,validateAssessment,evidenceLinks,dueReviews} from '../lib/ai-review.js';
import {openaiProvider} from '../lib/openai-provider.js';
import {reviewConfig} from '../lib/ai-config.js';
import {REFERENCE_LIBRARY,referenceQueries} from '../lib/references.js';
import {earlyPreset} from '../lib/discovery.js';
import {validateConfig,exclusion} from '../lib/search.js';
import {createMonitor} from '../lib/monitor.js';
import {createApp,shutdownApp} from '../server.js';
import {saveEnvKey} from '../scripts/configure-brave.js';
const now=new Date('2026-10-20T10:00:00Z');
const text='We offer business accounts for companies. Open your business account with a German IBAN. Our service issues your business IBAN via a regulated partner.';
const fact=(status,quote,sourceId='s2')=>({status,evidence:quote?[{sourceId,quote}]:[]});
const answer=(id='s2')=>({business:fact('yes','We offer business accounts for companies.',id),account:fact('yes','Open your business account with a German IBAN.',id),euIban:fact('yes','Open your business account with a German IBAN.',id),utility:fact('unknown'),summaryRu:'В тексте предложен счёт компании с German IBAN. Условия требуют проверки.'});
const listing={appId:'com.ai.business',title:'New Business Bank',url:'https://play.google.com/store/apps/details?id=com.ai.business',developerWebsite:'https://newbank.example.eu/',screeningText:'A new account service for companies in Europe.',firstFoundAt:now.toISOString()};
const page={page:async url=>({url,title:'Business',text,body:'<p>'+text+'</p>'})};
function fixture(patch={}){const store=patch.store??memoryStore(now);store.state.findings.push({...listing});let calls=0;const provider={configured:()=>true,model:'fixture-model',assess:async({documents})=>{calls++;return {assessment:answer(documents.find(d=>d.kind==='official_page')?.id??'s1'),model:'fixture-model',usage:{inputTokens:100,outputTokens:50}};},...patch.provider};return {store,provider,monitor:createAIReview({store,provider,pages:patch.pages??page,clock:patch.clock??(()=>now),...patch.options}),calls:()=>calls};}

test('37 user examples retain supplied links and never invent URLs for name-only references',()=>{
 assert.equal(REFERENCE_LIBRARY.length,37);assert.equal(REFERENCE_LIBRARY.find(r=>r.name==='Unlimit').url,null);assert.equal(REFERENCE_LIBRARY.find(r=>r.name==='PhotonPay').domain,'photonpay.com');assert.ok(REFERENCE_LIBRARY.every(r=>r.evidenceStatus==='user_reference'));
 const config=validateConfig(earlyPreset(['AT']),now);assert.equal(exclusion({genreId:'FINANCE',free:true,price:0,minInstalls:0},config),null);
 const first=referenceQueries(config,now),next=referenceQueries(config,new Date(+now+86400000));assert.equal(first.length,6);assert.notDeepEqual(first,next);
});
test('early mode stores a known example without claiming it as a new independent discovery',async()=>{
 const store=memoryStore(now),bank={...listing,appId:'com.stablecom.app',title:'Stable.com',developerWebsite:'https://stable.com',description:text,genreId:'FINANCE',price:0,free:true,minInstalls:0};
 const monitor=createMonitor({store,clock:()=>now,delay:0,provider:{search:async()=>[bank],app:async()=>bank}});const job=await monitor.startJob({...earlyPreset(['AT']),keywords:['business account'],seedApps:[],related:false,developerExpansion:false,useWebIndex:false});await monitor.idle();assert.equal(job.results.length,0);assert.equal(job.existingResults.length,1);assert.equal(store.state.findings.length,1);assert.equal(store.state.findings[0].reference,'Stable.com');
});
test('site collection follows only real same-domain product links and avoids sign-in pages',async()=>{
 const urls=evidenceLinks('<a href="/faq">IBAN FAQ</a><a href="/registration">Business account</a><a href="https://evil.example/iban">IBAN</a><a href="/business">Business</a>','https://newbank.example.eu/');assert.deepEqual(urls,['https://newbank.example.eu/faq','https://newbank.example.eu/business']);
 const seen=[],controller=new AbortController();let indexCalls=0;
 const result=await collectEvidence({...listing,section:'play',developerWebsite:'https://newbank.example.eu/identity/register'},{signal:controller.signal,pages:{page:async url=>{seen.push(url);return{url,text,body:'<a href="/faq">FAQ</a>'};}},index:{configured:()=>true,search:async()=>{indexCalls++;return[];}}});assert.equal(seen[0],'https://newbank.example.eu/');assert.equal(indexCalls,0);assert.equal(result.documents.length,3);
});
test('missing reviews or an unavailable website preserve listing evidence and use at most one indexed lookup',async()=>{
 let calls=0;const result=await collectEvidence({...listing,section:'play'},{signal:new AbortController().signal,pages:{page:async()=>{throw new Error('blocked');}},index:{configured:()=>true,search:async()=>{calls++;return[{url:'https://newbank.example.eu/business',description:text},{url:'https://newbank.example.eu.evil.test/',description:text}];}}});assert.equal(calls,1);assert.equal(result.documents.length,2);assert.equal(result.documents[1].kind,'official_index');assert.equal(result.errors.length,1);
});
test('AI quotes must occur in supplied sources; invented source IDs cannot produce a match',()=>{
 const documents=[{id:'s2',url:listing.developerWebsite,text,kind:'official_page'}];assert.equal(validateAssessment(answer(),documents).decision,'match');
 const hallucinated=answer('invented');const rejected=validateAssessment(hallucinated,documents);assert.equal(rejected.decision,'review');assert.equal(rejected.rejectedQuotes,3);assert.ok(Object.values(rejected.facts).every(f=>f.status==='unknown'));
 const altered=answer();altered.euIban.evidence[0].quote='Open your account with a Lithuanian IBAN.';assert.equal(validateAssessment(altered,documents).facts.euIban.status,'unknown');
});
test('EUR/SEPA and personal or GB IBAN quotes never establish EU business issuance',()=>{
 for(const claim of['We offer SEPA transfers and EUR balances.','Open your personal account with a German IBAN.','Open your business account with a GB IBAN.']){
  const raw=answer();raw.euIban=fact('yes',claim);const result=validateAssessment(raw,[{id:'s2',url:listing.developerWebsite,text:text+' '+claim,kind:'official_page'}]);assert.equal(result.facts.euIban.status,'unknown',claim);assert.equal(result.decision,'review');
 }
});
test('a quoted utility signal is a suggestion and does not erase findings or auto-create exclusions',async()=>{
 const f=fixture({provider:{assess:async()=>({assessment:{...answer(),utility:fact('yes','An IBAN checker and validator.')},model:'fixture-model',usage:{inputTokens:10,outputTokens:10}})},pages:{page:async url=>({url,text:text+' An IBAN checker and validator.',body:''})}});await f.monitor.startJob();await f.monitor.idle();assert.equal(f.monitor.results()[0].decision,'irrelevant');assert.equal(f.store.state.findings.length,1);assert.deepEqual(f.store.state.manualExclusions,[]);
});
test('OpenAI adapter sends bounded structured data without storing responses or exposing keys in input',async()=>{
 let requestBody;const p=openaiProvider({key:'fixture-key-secret',model:'gpt-5-mini',request:async(body,options)=>{requestBody=body;assert.equal(options.key,'fixture-key-secret');return{status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(answer())}]}],usage:{input_tokens:120,output_tokens:80}};}});
 const result=await p.assess({title:'Example',documents:[{id:'s2',url:listing.developerWebsite,text,kind:'official_page'}]});assert.equal(requestBody.store,false);assert.equal(requestBody.text.format.type,'json_schema');assert.ok(!JSON.stringify(requestBody).includes('fixture-key-secret'));assert.equal(requestBody.tools,undefined);assert.equal(result.usage.inputTokens,120);
 const incomplete=openaiProvider({key:'fixture',request:async()=>({status:'incomplete'})});await assert.rejects(incomplete.assess({title:'X',documents:[]}),{code:'INCOMPLETE_RESPONSE'});
});
test('review results cache exact card inputs, refresh when changed and prioritize unknown services',async()=>{
 const f=fixture();await f.monitor.startJob();await f.monitor.idle();assert.equal(f.monitor.results()[0].decision,'match');assert.equal(f.calls(),1);assert.equal(f.store.state.ai.usage['2026-10'].attempts,1);await assert.rejects(f.monitor.startJob(),/Новых находок/);assert.equal(f.calls(),1);
 f.store.state.findings[0].screeningText+=' New feature.';assert.equal(dueReviews(f.store.state,f.provider.model,now).length,1);await f.monitor.startJob();await f.monitor.idle();assert.equal(f.calls(),2);assert.equal(f.monitor.results().length,1);
});
test('monthly limit is reserved before errors and prevents subsequent paid attempts',async()=>{
 const f=fixture({provider:{assess:async()=>{throw Object.assign(new Error('fixture-secret upstream error'),{status:429});}}});await f.monitor.saveConfig({...reviewConfig(),monthlyLimit:1});await f.monitor.startJob();await f.monitor.idle();assert.equal(f.store.state.ai.usage['2026-10'].attempts,1);assert.equal(f.store.state.ai.jobs[0].status,'failed');assert.ok(!JSON.stringify(f.store.state.ai).includes('fixture-secret'));await assert.rejects(f.monitor.startJob(),/месячный лимит/);assert.equal(f.store.state.findings.length,1);
});
test('cancelling a never-settling AI call releases the slot, retains usage and allows retry',{timeout:3000},async()=>{
 let entered;const ready=new Promise(r=>entered=r);const f=fixture({provider:{assess:()=>{entered();return new Promise(()=>{});}}});await f.monitor.startJob();await ready;await f.monitor.cancel();assert.equal(f.monitor.summary().busy,false);assert.equal(f.store.state.ai.jobs[0].status,'cancelled');assert.equal(f.store.state.ai.usage['2026-10'].attempts,1);assert.equal(f.store.state.findings.length,1);
});
test('daily AI waits for discovery to finish and runs once in Kaliningrad day',async()=>{
 let discovering=true;const f=fixture({options:{autoSchedule:true,isDiscoveryBusy:()=>discovering}});await f.monitor.saveConfig({...reviewConfig(),enabled:true});await f.monitor.tick();assert.equal(f.calls(),0);discovering=false;await f.monitor.tick();await f.monitor.idle();assert.equal(f.calls(),1);f.store.state.findings[0].screeningText+=' Updated';await f.monitor.tick();assert.equal(f.calls(),1);
});
test('OpenAI key setup preserves Brave and other settings, replaces duplicates and writes private permissions',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'ai-env-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=join(dir,'.env');await writeFile(file,'BRAVE_SEARCH_API_KEY=fixture-brave\nAPP_PASSWORD=fixture-password\nexport OPENAI_API_KEY=old-value-key\n OPENAI_API_KEY=duplicate-old\n');await saveEnvKey('OPENAI_API_KEY','fixture-new-openai-key',dir);const content=await readFile(file,'utf8');assert.match(content,/BRAVE_SEARCH_API_KEY=fixture-brave/);assert.match(content,/APP_PASSWORD=fixture-password/);assert.equal((content.match(/fixture-new-openai-key/g)||[]).length,2);assert.ok(!content.includes('old-value'));assert.equal((await stat(file)).mode&0o777,0o600);
});
test('upgrade and interrupted review recovery preserve history, quotas and disabled schedules',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'ai-state-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=join(dir,'state.json'),s=memoryStore(now).state;for(const section of[s,s.social,s.web,s.watch])section.schedule.enabled=false;s.findings=[listing];delete s.ai;await writeFile(file,JSON.stringify(s));let store=await openStore(file,now);assert.equal(store.state.ai.config.enabled,false);store.state.ai.jobs=[{id:'interrupted',status:'running',errors:[]}];store.state.ai.usage['2026-10']={attempts:3,inputTokens:0,outputTokens:0};await writeFile(file,JSON.stringify(store.state));store=await openStore(file,now);assert.equal(store.state.ai.jobs[0].status,'cancelled');assert.equal(store.state.ai.usage['2026-10'].attempts,3);assert.equal(store.state.findings.length,1);assert.equal(store.state.schedule.enabled,false);
});
test('AI and example APIs use existing authentication, cross-site and JSON guards',async t=>{
 const f=fixture();const server=createApp({store:f.store,aiProvider:f.provider,aiPages:page,password:'test-private'});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>shutdownApp(server));const base=`http://127.0.0.1:${server.address().port}`,headers={Authorization:'Basic '+Buffer.from('admin:test-private').toString('base64'),'Content-Type':'application/json'};
 assert.equal((await fetch(base+'/api/ai/results')).status,401);assert.equal((await fetch(base+'/review')).status,401);assert.equal((await(await fetch(base+'/api/references',{headers})).json()).length,37);
 assert.equal((await fetch(base+'/api/ai/start',{method:'POST',headers:{...headers,'Sec-Fetch-Site':'cross-site'},body:'{}'})).status,403);assert.equal((await fetch(base+'/api/ai/config',{method:'POST',headers,body:'{"monthlyLimit":0}'})).status,400);
 const response=await fetch(base+'/api/ai/start',{method:'POST',headers,body:'{}'});assert.equal(response.status,202);await server.aiReview.idle();assert.equal((await(await fetch(base+'/api/ai/results',{headers})).json())[0].decision,'match');
});

test('cancellation during the initial save waits until the worker is fully released',{timeout:3000},async()=>{
 const f=fixture(),original=f.store.update.bind(f.store);let release,entered;const ready=new Promise(r=>entered=r),checkpoint=new Promise(r=>release=r);let first=true;
 f.store.update=async change=>{if(first){first=false;entered();await checkpoint;}return original(change);};
 const starting=f.monitor.startJob();await ready;const cancelling=f.monitor.cancel();release();await starting;await cancelling;assert.equal(f.monitor.summary().busy,false);assert.equal(f.calls(),0);assert.equal(f.store.state.ai.jobs[0].status,'cancelled');
});
test('web root content replaces its weaker indexed snippet and remains a readable official source',async()=>{
 const evidence=await collectEvidence({...listing,url:listing.developerWebsite,developerWebsite:null,snippet:'Short snippet',section:'web'},{pages:page,signal:new AbortController().signal});assert.equal(evidence.documents.length,1);assert.equal(evidence.documents[0].kind,'official_page');assert.match(evidence.documents[0].text,/German IBAN/);
});

test('a reference name grounded in the listing is marked known and removed from the new category',async()=>{
 const f=fixture({provider:{assess:async({documents})=>({model:'fixture-model',usage:{inputTokens:10,outputTokens:10},assessment:{business:fact('unknown'),account:fact('unknown'),euIban:fact('unknown'),utility:fact('unknown'),service:{name:'Bankera',evidence:[{sourceId:documents[0].id,quote:'Bankera offers corporate accounts.'}]},summaryRu:'Известный образец'}})}});
 f.store.state.findings[0].screeningText='Bankera offers corporate accounts.';f.store.state.ai.newIds=['company:newbank.example.eu'];await f.monitor.startJob();await f.monitor.idle();assert.equal(f.monitor.results()[0].reference,'Bankera');assert.deepEqual(f.store.state.ai.newIds,[]);assert.equal(dueReviews(f.store.state,f.provider.model,now).length,0);
});

test('four freshly observed user examples keep their real Play identities; Breinrock is retained without inventing missing IBAN proof',async()=>{
 const {assessDiscovery}=await import('../lib/discovery.js');const {assessBanking}=await import('../lib/qualification.js');const rows=JSON.parse(await readFile(new URL('./fixtures/play-reference-updates.json',import.meta.url),'utf8')).apps;
 for(const app of rows){const c=earlyPreset(['DE']),docs=[{title:app.title,text:app.description,url:`https://play.google.com/store/apps/details?id=${app.appId}`}],assessment=assessDiscovery(docs,c,assessBanking(docs,c),app.appId);assert.equal(assessment.status,app.title==='Breinrock'?'needs_review':'service_match',app.title);assert.equal(assessment.euIban,'unknown');assert.ok(REFERENCE_LIBRARY.some(e=>e.appIds.includes(app.appId)));}
});
