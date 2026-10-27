import test from 'node:test';import assert from 'node:assert/strict';
import {memoryStore} from '../lib/store.js';import {createApp,shutdownApp} from '../server.js';
import {groupedCandidates,inboxEntry,storeInbox} from '../lib/neural-inbox.js';
import {validateAssessment} from '../lib/ai-review.js';import {earlyPreset} from '../lib/discovery.js';
import {validateWebConfig} from '../lib/web-services.js';import {validateSocialConfig} from '../lib/social-search.js';import {validateWatchConfig} from '../lib/watch.js';
const now=new Date('2026-10-20T10:00:00Z'),text='AcmePay offers business accounts for companies. Open your business account with a German IBAN.';
const utility='Acme Utility is an IBAN checker and validator. Check any IBAN number.';
const bank={appId:'com.acme.business',title:'AcmePay',developerWebsite:'https://acme.example.eu/',description:text,genreId:'FINANCE',free:true,price:0,minInstalls:1,released:'2026-10-01'};
const tool={...bank,appId:'com.acme.checker',title:'IBAN Checker',developerWebsite:'https://checker.example.eu/',description:utility};
const fact=(status,quote,id)=>({status,evidence:quote?[{sourceId:id,quote}]:[]});
function setup(patch={}){
 const store=memoryStore(now);for(const s of[store.state,store.state.web,store.state.social,store.state.watch])s.schedule.enabled=false;
 store.state.schedule.filters={...earlyPreset(['AT']),keywords:['business account'],seedApps:[],referenceDomains:[],related:false,developerExpansion:false,useWebIndex:false};
 store.state.web.schedule.filters=validateWebConfig({queries:['webfixture'],referenceDomains:[],requestBudget:1});
 store.state.social.schedule.filters=validateSocialConfig({profile:'business',strictBanking:false,eventMode:'signals',queries:['publicationfixture'],sources:['finextra'],requestBudget:20},now);
 store.state.watch.schedule.filters=validateWatchConfig({watchUrls:['https://acme.example.eu/'],watchApps:[],autoWatchFindings:false,autoWatchSites:false});
 let aiCalls=0;
 const server=createApp({store,clock:()=>now,delay:0,socialDelay:0,watchDelay:0,
  appStoreProvider:{search:async()=>[]},
  provider:{search:async()=>[bank,tool],app:async({appId})=>[bank,tool].find(e=>e.appId===appId)},
  socialProvider:{configured:()=>true,search:async({q})=>q==='webfixture'?[{title:'AcmePay business account',url:'https://acme.example.eu/',description:text}]:q.includes('finextra.com')?[{title:'The future of AcmePay business accounts',url:'https://finextra.com/blogposting/123/acme',description:'An opinion article discusses AcmePay and possible business accounts in Europe.'}]:[]},
  watchProvider:{page:async url=>({url,title:'AcmePay',text,body:text})},aiPages:{page:async url=>({url,text:url.includes('checker')?utility:text,body:''})},
  aiProvider:{configured:()=>true,model:'fixture',assess:async({documents})=>{
   aiCalls++;const d=documents.find(d=>d.text.includes('checker and validator'))??documents.find(d=>d.text.includes('Open your business account'))??documents[0];
   const checked=d.text.includes('checker and validator'),hasAccount=d.text.includes('Open your business account');
   return{model:'fixture',usage:{inputTokens:100,outputTokens:50},assessment:{business:fact(hasAccount?'yes':'unknown',hasAccount?'AcmePay offers business accounts for companies.':null,d.id),account:fact(hasAccount?'yes':'unknown',hasAccount?'Open your business account with a German IBAN.':null,d.id),euIban:fact(hasAccount?'yes':'unknown',hasAccount?'Open your business account with a German IBAN.':null,d.id),utility:fact(checked?'yes':'unknown',checked?'Acme Utility is an IBAN checker and validator.':null,d.id),summaryRu:checked?'Утилита проверки IBAN':hasAccount?'Есть предложение бизнес-счёта':'Обсуждение; условия не подтверждены'}};
  }},...patch});return {store,server,aiCalls:()=>aiCalls};
}

test('all-source neural run archives rejected leads without paid AI, merges product domains and marks only new relevant groups',{timeout:5000},async t=>{
 const f=setup();t.after(()=>f.server.neural.stop());await f.server.neural.start();await f.server.neural.idle();
 const job=f.server.neural.summary();assert.equal(job.sources.length,4);assert.ok(job.sources.every(s=>s.status==='complete'));assert.ok(f.store.state.ai.inbox.some(e=>e.source==='finextra'),'commentary reaches AI even if the deterministic feed rejects it');assert.ok(f.store.state.ai.inbox.some(e=>e.appId===tool.appId),'checker reaches the AI reject category');
 const groups=groupedCandidates(f.store.state);const product=groups.find(e=>e.id==='company:acme.example.eu');assert.ok(product.sources.includes('play'));assert.ok(product.sources.includes('web'));assert.ok(product.sources.includes('watch'));assert.ok(product.targets.length>=3);assert.equal(f.server.aiReview.results().length,1);assert.ok(!f.server.aiReview.results().some(e=>e.title.includes('Utility')));assert.equal(job.newIds.length,1);const calls=f.aiCalls();
 await f.server.neural.start();await f.server.neural.idle();assert.deepEqual(f.server.neural.summary().newIds,[]);assert.equal(f.aiCalls(),calls,'unchanged data does not consume another AI call');
});
test('two articles from one publisher are never merged as one bank',()=>{
 const state=memoryStore(now).state;state.ai.inbox=[inboxEntry({title:'Alpha bank',url:'https://finextra.com/blog/alpha',snippet:'Alpha offers business accounts'},'web',now),inboxEntry({title:'Beta bank',url:'https://finextra.com/blog/beta',snippet:'Beta offers business accounts'},'web',now)];assert.equal(groupedCandidates(state).length,2);
});
test('missing Brave or OpenAI yields explicit partial collection and retains Play and page candidates',{timeout:4000},async()=>{
 const f=setup({socialProvider:{configured:()=>false},aiProvider:{configured:()=>false,model:'fixture'}});await f.server.neural.start();await f.server.neural.idle();const job=f.server.neural.summary();assert.equal(job.status,'partial');assert.equal(job.sources.filter(e=>e.status==='unavailable').length,2);assert.ok(f.store.state.ai.inbox.length>0);assert.equal(f.store.state.ai.jobs.length,0);assert.ok(job.errors.some(e=>e.includes('OpenAI')));
});
test('cancelling collection cancels only owned workers and frees all slots',{timeout:3000},async()=>{
 let entered;const ready=new Promise(r=>entered=r),f=setup({provider:{search:()=>{entered();return new Promise(()=>{});}},socialProvider:{configured:()=>false}});
 await f.server.neural.start();await ready;await f.server.neural.cancel();assert.equal(f.server.neural.summary().status,'cancelled');assert.equal(f.server.monitor.summary().busy,false);assert.equal(f.server.watchMonitor.summary().busy,false);assert.equal(f.server.neural.summary().busy,false);
});
test('source deadlines bound an all-source run when every network source stops answering',{timeout:4000},async()=>{
 const never=()=>new Promise(()=>{}),f=setup({appStoreProvider:{search:never},provider:{search:never},socialProvider:{configured:()=>true,search:never},watchProvider:{page:never},requestTimeoutMs:15});const started=Date.now();await f.server.neural.start();await f.server.neural.idle();assert.ok(Date.now()-started<2500);assert.equal(f.server.neural.summary().status,'partial');assert.ok(f.server.neural.summary().sources.every(s=>['failed','partial'].includes(s.status)));assert.equal(f.server.monitor.summary().busy,false);
});
test('raw inbox retains new leads beyond the former count ceiling without evicting history',()=>{
 const s=memoryStore(now).state;for(let i=0;i<2000;i++)s.ai.inbox.push(inboxEntry({title:'Old '+i,url:`https://example.eu/item/${i}`,snippet:'business'},'social',now));const added=inboxEntry({title:'New',url:'https://example.eu/new',snippet:'business'},'social',now);assert.equal(storeInbox(s,[added]),0);assert.equal(s.ai.inbox.length,2001);assert.equal(s.ai.inbox[0].title,'Old 0');
});
test('quoted waitlists remain early leads and never become live-account matches',()=>{
 const quote='AcmePay is opening its business account waitlist for a German IBAN.';const raw={business:fact('yes',quote,'s1'),account:fact('yes',quote,'s1'),euIban:fact('yes',quote,'s1'),utility:fact('unknown'),availability:{status:'waitlist',evidence:[{sourceId:'s1',quote}]},service:{name:'AcmePay',evidence:[{sourceId:'s1',quote}]},summaryRu:'Лист ожидания'};const result=validateAssessment(raw,[{id:'s1',url:'https://acme.example.eu/',text:quote,kind:'official_page'}]);assert.equal(result.decision,'review');assert.equal(result.availability.status,'waitlist');assert.equal(result.serviceName,'AcmePay');
 raw.service.name='Invented Bank';assert.equal(validateAssessment(raw,[{id:'s1',url:'https://acme.example.eu/',text:quote,kind:'official_page'}]).serviceName,null);
});
test('neural APIs, new-only CSV and inbox exclusions preserve authentication and history',{timeout:6000},async t=>{
 const f=setup({password:'neural-pass'});await new Promise(r=>f.server.listen(0,'127.0.0.1',r));t.after(()=>shutdownApp(f.server));const base=`http://127.0.0.1:${f.server.address().port}`,headers={Authorization:'Basic '+Buffer.from('admin:neural-pass').toString('base64'),'Content-Type':'application/json'},post=(path,body={})=>fetch(base+path,{method:'POST',headers,body:JSON.stringify(body)});
 assert.equal((await fetch(base+'/api/neural/monitor')).status,401);assert.equal((await fetch(base+'/api/neural/start',{method:'POST',headers:{...headers,'Sec-Fetch-Site':'cross-site'}})).status,403);assert.equal((await post('/api/neural/start')).status,202);await f.server.neural.idle();const inbox=await(await fetch(base+'/api/ai/inbox',{headers})).json();assert.ok(inbox.some(e=>e.isNew));const target=inbox.find(e=>e.id==='company:acme.example.eu').targets.find(t=>t.section==='inbox');assert.equal((await post('/api/exclusions',{section:'inbox',id:target.targetId})).status,200);assert.ok(f.store.state.ai.inbox.some(e=>e.id===target.targetId));assert.equal(f.store.state.manualExclusions.length,1);
 const job=[...f.server.monitor.jobs.values()].at(-1),response=await fetch(`${base}/api/jobs/${job.id}/export.csv?new=1`,{headers});assert.equal(response.status,200);assert.ok(!(await response.text()).includes('AcmePay'));
});

test('daily neural collection runs once and can gather even before OpenAI is connected',{timeout:5000},async()=>{
 const f=setup({autoSchedule:true,aiProvider:{configured:()=>false,model:'fixture'}});await f.server.aiReview.saveConfig({...f.server.aiReview.summary().config,enabled:true,collectSources:true});await f.server.aiReview.tick();await f.server.neural.idle();const count=f.store.state.ai.gatherJobs.length;assert.equal(count,1);assert.ok(f.store.state.ai.inbox.length>0);await f.server.aiReview.tick();assert.equal(f.store.state.ai.gatherJobs.length,count);await f.server.aiReview.stop();
});
test('daily AI waits for publication and watch workers before analyzing the shared inbox',{timeout:4000},async()=>{
 for(const name of ['social','watch']){
  const never=()=>new Promise(()=>{}),f=setup({autoSchedule:true,...(name==='social'?{socialProvider:{configured:()=>true,search:never}}:{watchProvider:{page:never}})});
  await f.server.aiReview.saveConfig({...f.server.aiReview.summary().config,enabled:true});
  storeInbox(f.store.state,[inboxEntry({...bank,url:'https://play.google.com/store/apps/details?id='+bank.appId,screeningText:text},'play',now)]);
  const control=name==='social'?f.server.socialMonitor:f.server.watchMonitor;
  const job=await control.startJob(control.summary().schedule.filters);
  await f.server.aiReview.tick();assert.equal(f.store.state.ai.jobs.length,0,'analysis must wait for '+name);
  await control.cancel(job.id);await control.idle();await f.server.aiReview.tick();await f.server.aiReview.idle();
  assert.equal(f.store.state.ai.jobs.length,1);await f.server.aiReview.stop();await control.stop();
 }
});
test('an invented reference name without a matching citation cannot hide a new lead',{timeout:5000},async()=>{
 const f=setup({aiProvider:{configured:()=>true,model:'fixture',assess:async({documents})=>{
  const d=documents.find(d=>d.text.includes('AcmePay'))??documents[0];const quote=d.text;return{model:'fixture',usage:{inputTokens:1,outputTokens:1},assessment:{business:fact('unknown'),account:fact('unknown'),euIban:fact('unknown'),utility:fact('unknown'),service:{name:'Bankera',evidence:[{sourceId:d.id,quote}]},summaryRu:'Неизвестно'}};
 }}});
 // A provider name without a matching quote must NOT mark an unrelated lead known.
 await f.server.neural.start();await f.server.neural.idle();assert.ok(f.server.neural.summary().newIds.length>0);assert.ok(f.server.aiReview.results().every(r=>r.reference===null));
});

test('Brave records all consumers without enforcing the obsolete monthly environment quota',{timeout:3000},async t=>{
 const {braveProvider}=await import('../lib/brave-provider.js');const previous=process.env.BRAVE_MONTHLY_REQUEST_LIMIT;process.env.BRAVE_MONTHLY_REQUEST_LIMIT='1';t.after(()=>{if(previous===undefined)delete process.env.BRAVE_MONTHLY_REQUEST_LIMIT;else process.env.BRAVE_MONTHLY_REQUEST_LIMIT=previous;});let calls=0;
 const p=braveProvider({key:'fixture-budget-key',minInterval:0,request:async()=>{calls++;return{web:{results:[]}};}}),store=memoryStore(now);createApp({store,clock:()=>now,socialProvider:p});await p.search({q:'web source'});await p.search({q:'another source'});assert.equal(calls,2);assert.equal(store.state.braveUsage['2026-10'],2);
});
