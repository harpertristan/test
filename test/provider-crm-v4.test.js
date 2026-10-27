import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {memoryStore,openStore} from '../lib/store.js';
import {canonicalName} from '../lib/identity-names.js';
import {manuallyExcluded,effectiveExclusions,exclusionMatch} from '../lib/manual-exclusions.js';
import {crmRows,bulkCRM,crmExport,crmCSV,chatPacket} from '../lib/crm.js';
import {sortFindings} from '../lib/finding-order.js';
import {publicationDate} from '../lib/page-provider.js';
import {verifiedDecision} from '../lib/verification-policy.js';
import {geminiProvider} from '../lib/gemini-provider.js';
import {createAIReview} from '../lib/ai-review.js';
import {researchLicenceSites} from '../lib/licence-research.js';
import {createApp,shutdownApp} from '../server.js';
import {saveEnvKey} from '../scripts/configure-brave.js';
import {groupedCandidates} from '../lib/neural-inbox.js';
import {RECOMMENDED_SOURCES,socialPlan,socialPreset} from '../lib/source-catalog.js';
import {validateSocialConfig} from '../lib/social-search.js';

const now=new Date('2026-10-27T10:00:00Z');
const text='Acme offers business accounts for companies. Open a business account with a German IBAN. Accounts are provided through Partner EMI. We are not a bank.';
const bank=(i,patch={})=>({appId:'co.provider.app'+i,title:'Provider '+i,developerWebsite:`https://provider${i}.example.eu`,url:'https://play.google.com/store/apps/details?id=co.provider.app'+i,screeningText:text,released:'2026-10-01',firstFoundAt:now.toISOString(),...patch});
function fixture(count=1){const s=memoryStore(now);for(let i=0;i<count;i++)s.state.findings.push(bank(i));return s;}
const fact=(status,quote,id='s1')=>({status,evidence:quote?[{sourceId:id,quote}]:[]});
function answer(documents){const d=documents.find(d=>d.text.includes('German IBAN'))??documents[0];return{business:fact('yes','Acme offers business accounts for companies.',d.id),account:fact('yes','Open a business account with a German IBAN.',d.id),euIban:fact('yes','Open a business account with a German IBAN.',d.id),utility:fact('unknown'),summaryRu:'Небанковский провайдер предоставляет бизнес-счёт с немецким IBAN через партнёра.',translations:[],licences:[]};}
async function temporary(t){const dir=await mkdtemp(join(tmpdir(),'provider-v4-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}

test('names match brand, case, accents, legal suffixes and business variants without matching arbitrary article mentions',()=>{
 assert.equal(canonicalName('Bänkéra — Business Accounts UAB'),canonicalName('BANKERA'));
 assert.equal(canonicalName('Business Bank EU IBAN'),null);assert.equal(canonicalName('OFX Business'),'ofx');assert.equal(canonicalName('Stable.com'),canonicalName('Stable'));assert.equal(canonicalName('KleosBusiness'),canonicalName('Kleos'));
 const s=fixture();Object.assign(s.state.findings[0],{title:'Bankera Business',developerWebsite:'https://bankera.example.eu'});s.state.manualExclusions.push({key:'old',kind:'app',value:s.state.findings[0].appId,title:'Bankera Business'});
 const rules=effectiveExclusions(s.state);assert.ok(manuallyExcluded({title:'BANKERA Corporate Accounts',url:'https://new-bankera.example.eu'},rules));assert.equal(exclusionMatch({title:'Bankera',url:'https://new.example.eu'},rules).kind,'name');
 assert.ok(!manuallyExcluded({title:'Acme partners with Bankera',url:'https://acme.example.eu'},rules));assert.ok(!manuallyExcluded({title:'Bankerate',url:'https://different.example.eu'},rules));
});

test('old app exclusion extends to a new web service by name and keeps different brands separate',()=>{
 const s=fixture();s.state.findings[0].title='ExamplePay Business';s.state.manualExclusions.push({key:'legacy',kind:'app',value:s.state.findings[0].appId,title:'ExamplePay'});
 s.state.web.findings.push({id:'web:new',title:'ExamplePay — corporate accounts',url:'https://new.examplepay.eu',snippet:text});
 assert.equal(groupedCandidates(s.state).length,0);assert.equal(crmExport(s.state).length,0);assert.ok(crmRows(s.state).every(r=>r.status==='excluded'));
});

test('bulk exclusions use one derived snapshot and persist reasons, aliases, notes and restoration',async()=>{
 const s=fixture(60);s.state.manualExclusions.push({key:'existing',kind:'domain',value:'unrelated.example.eu',title:'Unrelated'});const rows=crmRows(s.state),ids=rows.slice(0,50).map(r=>r.id);s.state.crm.records[ids[0]]={notes:'Работали раньше',status:'selected'};
 let walks=0;const jobs=s.state.jobs;Object.defineProperty(s.state,'jobs',{configurable:true,enumerable:true,get(){walks++;return jobs;}});
 const result=bulkCRM(s.state,{ids,action:'exclude',reason:'worked'},now);assert.equal(result.updated,50);assert.equal(walks,1);
 const excluded=crmExport(s.state,{status:'excluded',reason:'worked'});assert.equal(excluded.length,50);assert.ok(excluded.every(r=>r.exclusionReason==='worked'));assert.equal(crmExport(s.state).length,10);assert.match(crmCSV(excluded),/Уже в работе/);assert.equal(chatPacket(excluded).records[0].exclusionReason,'Уже в работе / был в работе');
 bulkCRM(s.state,{ids:[ids[0]],action:'restore'});const restored=crmRows(s.state).find(r=>r.id===ids[0]);assert.equal(restored.notes,'Работали раньше');assert.equal(restored.status,'selected');
 await s.update(d=>bulkCRM(d,{ids:[ids[1]],action:'exclude',reason:'location'},now));assert.equal(crmExport(s.state,{status:'excluded',reason:'location'}).length,1);
});

test('invalid bulk requests make no partial change',()=>{
 const s=fixture(),id=crmRows(s.state)[0].id;
 assert.throws(()=>bulkCRM(s.state,{ids:[id,'missing'],reason:'worked'}));assert.equal(s.state.manualExclusions.length,0);
 assert.throws(()=>bulkCRM(s.state,{ids:[id],reason:'unknown'}));assert.equal(s.state.manualExclusions.length,0);
});

test('sorting uses real release/publication/decision dates and always puts missing dates last',()=>{
 const rows=[{id:'unknown',title:'A',firstFoundAt:'2026-10-27'},{id:'old',title:'B',released:'2025-06-01',publishedAt:'2026-10-20'},{id:'new',title:'C',released:'2026-10-25'},{id:'post',title:'D',publishedAt:'2026-10-26'},{id:'licence',title:'E',licences:[{decisionDate:'2026-10-24'}]}];
 assert.deepEqual(sortFindings(rows,'event_desc').map(r=>r.id),['post','new','licence','old','unknown']);assert.equal(sortFindings(rows,'event_asc').at(-1).id,'unknown');assert.equal(sortFindings(rows,'release_desc')[0].id,'new');assert.equal(sortFindings(rows,'publication_desc')[0].id,'post');assert.equal(sortFindings(rows,'licence_desc')[0].id,'licence');
});

test('publication metadata uses published dates and never mistakes modification dates for publication',()=>{
 assert.equal(publicationDate('<meta content="2026-10-23T09:00:00Z" property="article:published_time">'),'2026-10-23T09:00:00.000Z');assert.equal(publicationDate('<meta property="article:modified_time" content="2026-10-27">'),null);
 assert.equal(publicationDate('<script type="application/ld+json">{"@graph":[{"datePublished":"2026-10-25"}]}</script>'),'2026-10-25T00:00:00.000Z');
});

test('third-party claims and pooled deposit details stay on review; non-bank partner providers can qualify',()=>{
 const result={facts:Object.fromEntries(['business','account','euIban'].map(k=>[k,{status:'yes',evidence:[{url:'https://provider.example.eu',kind:'official_page',quote:text}]}]))};
 assert.equal(verifiedDecision(result),'match');const third=structuredClone(result);for(const f of Object.values(third.facts))f.evidence[0].kind='third_party';assert.equal(verifiedDecision(third),'review');
 const pooled=structuredClone(result);pooled.facts.euIban.evidence[0].quote='Use our shared IBAN for deposit-only payments.';assert.equal(verifiedDecision(pooled),'review');result.availability={status:'waitlist'};assert.equal(verifiedDecision(result),'review');
});

test('retired Apple entries survive migration but neither native nor indexed Apple is scheduled',async t=>{
 const dir=await temporary(t),s=fixture();s.state.ai.config.sources=['play','apple'];s.state.apple.schedule.enabled=true;s.state.social.schedule.filters.sources=['appstore','finextra'];s.state.apple.findings.push({id:'apple:123',appId:'apple:123',title:'Old iOS',url:'https://apps.apple.com/app/id123',screeningText:text});
 await writeFile(join(dir,'state.json'),JSON.stringify(s.state));const reopened=await openStore(join(dir,'state.json'),now);assert.equal(reopened.state.apple.findings.length,1);assert.equal(reopened.state.apple.schedule.enabled,false);assert.ok(!reopened.state.ai.config.sources.includes('apple'));assert.ok(!reopened.state.social.schedule.filters.sources.includes('appstore'));assert.equal(crmRows(reopened.state).find(r=>r.title==='Old iOS').status,'source_archive');
 assert.ok(!RECOMMENDED_SOURCES.includes('appstore'));assert.ok(!socialPlan(validateSocialConfig({...socialPreset(),eventMode:'signals'}),now).requests.some(r=>r.source==='appstore'));
});

test('Gemini uses a separate key, schema, model and usage counter without touching OpenAI',async()=>{
 let calls=0;const provider=geminiProvider({key:'gemini-test-key',request:async(body,options)=>{calls++;assert.equal(options.key,'gemini-test-key');assert.ok(!JSON.stringify(body).includes('gemini-test-key'));assert.equal(body.generationConfig.responseMimeType,'application/json');const input=JSON.parse(body.contents[0].parts[0].text),documents=input.documents.map(d=>({...d,id:d.sourceId}));return{candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(answer(documents))}]}}],usageMetadata:{promptTokenCount:100,candidatesTokenCount:50}};}});
 const s=fixture();s.state.ai.config.engine='gemini';const review=createAIReview({store:s,provider,pages:{page:async()=>{throw Error('offline');}},clock:()=>now});await review.startJob();await review.idle();assert.equal(calls,1);assert.equal(s.state.ai.geminiUsage['2026-10'].attempts,1);assert.equal(s.state.ai.usage['2026-10']?.attempts??0,0);assert.equal(review.results()[0].decision,'match');
});

test('key configuration accepts Gemini and quoted passwords without changing API keys or interpreting replacement dollars',async t=>{
 const dir=await temporary(t);await saveEnvKey('OPENAI_API_KEY','original-openai-key',dir);await saveEnvKey('GEMINI_API_KEY','original-gemini-key',dir);const password='Owner $& # password 123';await saveEnvKey('APP_PASSWORD',password,dir);await saveEnvKey('APP_PASSWORD',password+'x',dir);
 const env=await readFile(join(dir,'.env'),'utf8');assert.match(env,/OPENAI_API_KEY=original-openai-key/);assert.match(env,/GEMINI_API_KEY=original-gemini-key/);assert.ok(env.includes("APP_PASSWORD='"+password+"x'"));assert.equal((env.match(/^APP_PASSWORD=/gm)??[]).length,1);
});

test('viewer is read-only across the API while owner bulk edits and local shutdown require authorization',async t=>{
 const s=fixture(),server=createApp({store:s,password:'owner-pass',viewerPassword:'viewer-pass'});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>shutdownApp(server));const base='http://127.0.0.1:'+server.address().port,headers=who=>({Authorization:'Basic '+Buffer.from(who).toString('base64'),'Content-Type':'application/json'});
 assert.equal((await fetch(base+'/api/crm')).status,401);const view=await (await fetch(base+'/api/crm',{headers:headers('viewer:viewer-pass')})).json();assert.equal(view.access.canEdit,false);assert.equal((await fetch(base+'/api/crm/export.csv',{headers:headers('viewer:viewer-pass')})).status,200);
 for(const path of ['/api/crm/bulk','/api/ai/start','/api/system/shutdown','/api/crm/licences/start'])assert.equal((await fetch(base+path,{method:'POST',headers:headers('viewer:viewer-pass'),body:'{}'})).status,403,path);
 const id=crmRows(s.state)[0].id;assert.equal((await fetch(base+'/api/crm/bulk',{method:'POST',headers:headers('admin:owner-pass'),body:JSON.stringify({ids:[id],reason:'not_provider'})})).status,200);assert.equal(crmRows(s.state)[0].exclusionReason,'not_provider');
 assert.equal((await fetch(base+'/api/apple/search',{method:'POST',headers:headers('admin:owner-pass'),body:'{}'})).status,410);
});

test('licence research permits infrastructure providers and three-letter brands from regulator links',async()=>{
 const licences=[{organisation:'Swan SAS',url:'https://www.lb.lt/en/swan',quote:'Authorised Swan SAS.'},{organisation:'OFX Business',url:'https://www.lb.lt/en/ofx',quote:'Authorised OFX Business.'}];
 const pages={page:async url=>url.includes('lb.lt')?{url,body:url.endsWith('swan')?'<a href="https://swan.io/">Swan SAS</a>':'<a href="https://ofx.com/">OFX Business</a>'}:{url,text:'Provider business accounts and IBANs.'}};
 const result=await researchLicenceSites(licences,{pages,signal:new AbortController().signal});assert.deepEqual(result.websites.map(s=>s.organisation),['Swan SAS','OFX Business']);assert.ok(result.websites.every(s=>s.association==='official_link'));
});

test('licence research prefers a regulator link and does not fetch an already excluded provider',async()=>{
 const licence={organisation:'Acme UAB',url:'https://www.lb.lt/en/news/acme',quote:'Bank of Lithuania authorised Acme UAB as an electronic money institution.'};let reads=0;
 const pages={page:async url=>{reads++;return url===licence.url?{url,body:'<a href="https://acme.example.eu/">Acme UAB</a>',text:licence.quote}:{url,body:'',text};}};
 const r=await researchLicenceSites([licence],{pages,signal:new AbortController().signal});assert.equal(r.websites[0].association,'official_link');assert.equal(r.websites[0].url,'https://acme.example.eu/');reads=0;
 const blocked=await researchLicenceSites([licence],{pages,signal:new AbortController().signal,isExcluded:e=>e.title==='Acme UAB'});assert.equal(blocked.websites.length,0);assert.equal(reads,0);
});

test('a registry analysis promotes a provider website and analyses it next in the same job',async()=>{
 const s=memoryStore(now),url='https://www.lb.lt/en/news/acme',quote='On 24 October 2026, Bank of Lithuania authorised Acme UAB as an electronic money institution in Lithuania.';
 s.state.social.findings.push({id:'reg:acme',source:'registers',title:'Acme UAB authorised as an electronic money institution',url,snippet:quote,firstFoundAt:now.toISOString()});let calls=0;
 const provider={configured:()=>true,model:'fixture',assess:async({documents})=>{calls++;if(documents.some(d=>d.text.includes('German IBAN')))return{assessment:answer(documents),model:'fixture',usage:{inputTokens:1,outputTokens:1}};const d=documents.find(d=>d.text.includes('On 24 October'));return{assessment:{business:fact('unknown'),account:fact('unknown'),euIban:fact('unknown'),utility:fact('unknown'),summaryRu:'Новое разрешение EMI.',licences:[{type:'emi',organisation:'Acme UAB',authority:'Bank of Lithuania',country:'Lithuania',decisionDate:'2026-10-24',sourceId:d.id,quote}]},model:'fixture',usage:{inputTokens:1,outputTokens:1}};}};
 const review=createAIReview({store:s,provider,clock:()=>now,pages:{page:async target=>target===url?{url,body:'<a href="https://acme.example.eu/">Acme UAB</a>',text:quote}:{url:target,body:'',text}}});await review.startJob();await review.idle();assert.equal(calls,1);assert.equal(s.state.ai.usage['2026-10'].attempts,1);assert.ok(review.results().some(r=>r.id==='company:acme.example.eu'&&r.decision==='match'));assert.ok(s.state.ai.inbox.some(r=>r.regulatoryLead));assert.equal(s.state.ai.jobs[0].total,2);
});
