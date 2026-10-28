import test from 'node:test';
import assert from 'node:assert/strict';
import{memoryStore}from'../lib/store.js';
import{screenCandidate}from'../lib/screening.js';
import{groupedCandidates}from'../lib/neural-inbox.js';
import{createAIReview,dueReviews}from'../lib/ai-review.js';
import{excludeCRM,restoreCRM}from'../lib/crm.js';
import{apiJSON}from'../public/api.js';
const text='Open business accounts with your German IBAN. Receive EUR and SEPA payments.',now=new Date('2026-10-28T12:00:00Z');
function fixture(){const s=memoryStore(now);s.state.ai.inbox.push({id:'raw:413',section:'web',source:'web_service',title:'Acme',url:'https://speed413.example.eu/',developerWebsite:'https://speed413.example.eu/',screeningText:text,firstFoundAt:now.toISOString()});return s;}
test('text screening cache notices source, title and URL changes and cannot be changed by its caller',()=>{
 const e={title:'Acme new provider',url:'https://acme413.eu',documents:[{kind:'listing',url:'https://acme413.eu',text}]};assert.equal(screenCandidate(e).eligible,true);screenCandidate(e).eligible=false;assert.equal(screenCandidate(e).eligible,true);
 e.documents[0].text='An encrypted private vault. Card and IBAN details stay on your own device.';assert.equal(screenCandidate(e).eligible,false);e.documents[0].text=text;assert.equal(screenCandidate(e).eligible,true);
 const form={title:'Licensing application forms',url:'https://www.amf-france.org/en/forms',documents:[{kind:'official_page',url:'https://www.amf-france.org/en/forms',text:'Wish to be licensed as an electronic money institution.'}]};assert.equal(screenCandidate(form).kind,'regulatory_reference');form.url='https://acme413.eu';form.title='Acme business account';form.documents[0].text=text;assert.equal(screenCandidate(form).eligible,true);
});
test('cached screening never caches manual exclusions, selected sources or the model review queue',async()=>{
 const s=fixture(),id=groupedCandidates(s.state)[0].id,ai=createAIReview({store:s,provider:{configured:()=>true,model:'offline'},pages:{}});assert.equal(ai.summary().due,1);excludeCRM(s.state,id,now,'worked');assert.equal(ai.summary().due,0);restoreCRM(s.state,id);assert.equal(ai.summary().due,1);s.state.ai.config.sources=['play'];assert.equal(ai.summary().due,0);s.state.ai.config.sources=['web'];assert.equal(ai.summary().due,1);await ai.stop();
});
test('cheap AI status does not enumerate candidates and full counters share one candidate snapshot',async()=>{
 const s=fixture(),inbox=s.state.ai.inbox;let reads=0;Object.defineProperty(s.state.ai,'inbox',{enumerable:true,get(){reads++;return inbox;}});const ai=createAIReview({store:s,provider:{configured:()=>true,model:'offline'},pages:{}});
 const quick=ai.summary({counts:false});assert.equal(quick.configured,true);assert.equal(quick.busy,false);assert.equal(quick.due,null);assert.equal(reads,0);const full=ai.summary();assert.equal(full.due,1);assert.equal(full.repairDue,0);assert.equal(reads,1);await ai.stop();
});
test('candidate priority and the cached-model rules are retained when a candidate snapshot is supplied',()=>{
 const s=fixture();s.state.findings.push({appId:'co.priority413',title:'New provider',url:'https://play.google.com/store/apps/details?id=co.priority413',screeningText:text});const candidates=groupedCandidates(s.state),fresh=dueReviews(s.state,'offline',now),shared=dueReviews(s.state,'offline',now,{candidates});assert.deepEqual(shared.map(e=>e.id),fresh.map(e=>e.id));assert.equal(shared[0].appId,'co.priority413');
});
test('read timeouts do not imply a write and failed writes are still never retried',async()=>{
 for(const method of['GET','POST']){let calls=0;await assert.rejects(apiJSON('/api/crm',{method},{timeoutMs:8,request:(_,{signal})=>{calls++;return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}}),error=>{assert.equal(error.code,'UI_TIMEOUT');assert.equal(error.writeMayHaveSucceeded,method==='POST');assert.match(error.message,method==='POST'?/операция могла сохраниться/:/Поиск может продолжаться/);return true;});assert.equal(calls,1);}
});
