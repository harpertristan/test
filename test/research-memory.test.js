import test from 'node:test';
import assert from 'node:assert/strict';
import {memoryStore} from '../lib/store.js';
import {crmRows,editCRM,excludeCRM,restoreCRM,bulkCRM} from '../lib/crm.js';
import {storeInbox,inboxEntry} from '../lib/neural-inbox.js';
import {researchMemory,learningSummary,feedbackContext,prioritiseQueries} from '../lib/research-memory.js';
import {openaiProvider} from '../lib/openai-provider.js';
import {ollamaProvider} from '../lib/ollama-provider.js';
import {validateAssessment} from '../lib/ai-review.js';
const now=new Date('2026-11-02T20:00:00Z'),text='We offer business accounts with EUR and SEPA payments. Dedicated account details are available.';
function fixture(){const store=memoryStore(now);for(let i=0;i<3;i++)store.state.findings.push({appId:'co.memory.app'+i,title:'Memory Provider '+i,url:'https://play.google.com/store/apps/details?id=co.memory.app'+i,developerWebsite:'https://memory'+i+'.example.eu/',screeningText:text,keywords:[i===0?'useful query':i===1?'poor query':'known query']});return store;}
const id=i=>'company:memory'+i+'.example.eu';

test('positive, negative and known decisions are distinct; known providers do not become negative examples',()=>{
 const s=fixture();editCRM(s.state,{id:id(0),status:'approved',notes:'PRIVATE_CONTACT_001'},now);excludeCRM(s.state,id(1),now,'location');excludeCRM(s.state,id(2),now,'worked');const memory=researchMemory(s.state);
 assert.equal(memory.positive,1);assert.equal(memory.negative,1);assert.equal(memory.known,1);assert.equal(memory.examples.find(e=>e.kind==='not_suitable').reason,'location');assert.ok(!JSON.stringify(s.state.crm.feedback).includes('PRIVATE_CONTACT_001'));
 const before=s.state.crm.feedback.length;editCRM(s.state,{id:id(0),notes:'Only a private note'},now);assert.equal(s.state.crm.feedback.length,before);
});

test('marking a previously approved provider as worked preserves the positive example without marking other known providers positive',()=>{
 const s=fixture();editCRM(s.state,{id:id(0),status:'approved'},now);excludeCRM(s.state,id(0),now,'worked');excludeCRM(s.state,id(1),now,'worked');const profile=learningSummary(s.state);assert.equal(profile.positive,1);assert.equal(profile.negative,0);assert.equal(profile.known,2);
});

test('returning a manual refusal withdraws the negative example until a new explicit decision',()=>{
 const s=fixture();excludeCRM(s.state,id(0),now,'not_provider');assert.equal(researchMemory(s.state).negative,1);restoreCRM(s.state,id(0));assert.equal(researchMemory(s.state).negative,0);editCRM(s.state,{id:id(0),status:'approved'},now);assert.equal(researchMemory(s.state).positive,1);
});

test('confirmed correction retains the original automatic rule and never labels a mere return as a confirmed filter error',()=>{
 const s=memoryStore(now);storeInbox(s.state,[inboxEntry({title:'IBAN Checker',appId:'co.memory.checker',developerWebsite:'https://checker.example.eu/',url:'https://play.google.com/store/apps/details?id=co.memory.checker',screeningText:'This IBAN checker validates existing IBAN numbers. It does not open accounts.'},'play',now)]);const row=crmRows(s.state)[0];
 bulkCRM(s.state,{ids:[row.id],action:'status',status:'review'},now);assert.equal(learningSummary(s.state).correctedRejections,0);bulkCRM(s.state,{ids:[row.id],action:'status',status:'approved'},now);assert.equal(learningSummary(s.state).correctedRejections,1);assert.equal(s.state.crm.feedback.at(-1).autoRule,'iban_utility');assert.equal(crmRows(s.state).find(r=>r.id===row.id).approval.by,'user');
});

test('feedback changes query order without changing coverage, countries, filters or making any API request',()=>{
 const s=fixture();editCRM(s.state,{id:id(0),status:'approved'},now);excludeCRM(s.state,id(1),now,'not_provider');const config={keywords:['poor query','neutral query','useful query'],countries:['RO','SK','SI'],blockedJurisdictions:['HK']},before=structuredClone(config),result=prioritiseQueries(s.state,config);
 assert.deepEqual(result.keywords,['useful query','neutral query','poor query']);assert.deepEqual(new Set(result.keywords),new Set(config.keywords));assert.deepEqual(result.countries,before.countries);assert.deepEqual(result.blockedJurisdictions,before.blockedJurisdictions);assert.deepEqual(config,before);assert.equal(s.state.ai.jobs.length,0);
});

test('researcher examples remain separate from current evidence and cannot substantiate unsupported EU IBAN facts',()=>{
 const s=fixture();editCRM(s.state,{id:id(0),status:'approved'},now);excludeCRM(s.state,id(1),now,'not_provider');const context=feedbackContext(s.state,{title:'New payment service',documents:[{text}]});assert.equal(context.examples.length,2);assert.match(context.notice,/not evidence/);assert.ok(!context.examples.some(e=>e.projectId===id(2)));assert.ok(JSON.stringify(context).length<1600);
 const documents=[{id:'s1',url:'https://new.example.eu/',kind:'official_page',text:'A payment service with EUR balances.'}],result=validateAssessment({euIban:{status:'yes',evidence:[{sourceId:'memory0',quote:'A German IBAN is available.'}]}},documents);assert.equal(result.facts.euIban.status,'unknown');assert.notEqual(result.decision,'match');
});

test('OpenAI and Ollama receive the same bounded memory as data without extra requests',async()=>{
 const s=fixture();editCRM(s.state,{id:id(0),status:'approved'},now);const memory=feedbackContext(s.state,{title:'New account',documents:[]}),documents=[{id:'s1',url:'https://new.example.eu/',kind:'official_page',text}],bodies=[];
 const openai=openaiProvider({key:'synthetic',request:async body=>{bodies.push(JSON.parse(body.input[1].content));return{status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{}'}]}]};}});
 const local=ollamaProvider({request:async(path,body)=>{bodies.push(JSON.parse(body.messages[1].content));return{message:{content:'{}'},done_reason:'stop'};}});
 await openai.assess({title:'New account',documents,researchMemory:memory});await local.assess({title:'New account',documents,researchMemory:memory});assert.equal(bodies.length,2);assert.deepEqual(bodies[0].researchMemory,memory);assert.deepEqual(bodies[1].researchMemory,memory);assert.equal(bodies[0].documents[0].sourceId,'s1');assert.ok(!Object.hasOwn(bodies[0],'notes'));
});
