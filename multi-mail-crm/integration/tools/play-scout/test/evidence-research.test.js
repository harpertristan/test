import test from 'node:test';
import assert from 'node:assert/strict';
import {collectEvidence,validateAssessment} from '../lib/ai-review.js';
import {reviewedDisposition} from '../lib/review-routing.js';
import {createAIReview} from '../lib/ai-review.js';
import {memoryStore} from '../lib/store.js';
import {crmRows} from '../lib/crm.js';
const entry={id:'company:qa-bank.eu',title:'QA Bank Business',url:'https://play.google.com/store/apps/details?id=co.qa.bank',appId:'co.qa.bank',developerWebsite:'https://qa-bank.eu/',section:'play',screeningText:'A business payment service.'};
const empty=()=>Object.fromEntries(['business','account','euIban','utility'].map(k=>[k,{status:'unknown',evidence:[]}]));
const proof='Open our business account for companies with your own German IBAN.';
test('research follows actual product and help links to depth two, without treating a retail IBAN as sufficient',async()=>{
 const seen=[],pages={page:async url=>{seen.push(url);if(url==='https://qa-bank.eu/')return{url,text:'Our personal accounts have a German IBAN.',body:'<a href="/account/business">Business accounts</a><a href="/login">Business login</a><a href="https://other.eu/business">Other</a>'};if(url.endsWith('/account/business'))return{url,text:'We offer business accounts for companies.',body:'<a href="https://support.qa-bank.eu/iban">IBAN account details</a>'};if(url==='https://support.qa-bank.eu/iban')return{url,text:proof,body:''};throw Error('unexpected');}};
 let indexCalls=0;const result=await collectEvidence(entry,{pages,index:{configured:()=>true,search:async()=>{indexCalls++;return[];}},signal:new AbortController().signal});assert.deepEqual(seen,['https://qa-bank.eu/','https://qa-bank.eu/account/business','https://support.qa-bank.eu/iban']);assert.equal(indexCalls,0);assert.equal(result.research.pages.length,3);const answer=validateAssessment(empty(),result.originalDocuments);assert.equal(answer.facts.euIban.status,'yes');assert.equal(answer.facts.business.status,'yes');
});
test('a targeted index result is fetched as an actual page after a blocked homepage and can supply valid direct evidence',async()=>{
 const seen=[];let searches=0;const result=await collectEvidence(entry,{signal:new AbortController().signal,pages:{page:async url=>{seen.push(url);if(url==='https://qa-bank.eu/')throw Error('blocked');return{url,text:proof,body:''};}},index:{configured:()=>true,search:async()=>{searches++;return[{url:'https://qa-bank.eu/business/iban',title:'Business accounts',description:'Account details'},{url:'https://qa-bank.eu.evil.test/business',description:proof}];}}});
 assert.equal(searches,1);assert.deepEqual(seen,['https://qa-bank.eu/','https://qa-bank.eu/business/iban']);const doc=result.originalDocuments.find(d=>d.url.endsWith('/business/iban'));assert.equal(doc.kind,'official_page');const answer={...validateAssessment(empty(),result.originalDocuments),version:2,analysisMethod:'ai',sourceDocuments:result.originalDocuments,sourceErrors:result.errors,checkedAt:'2026-11-03T10:00:00Z'};assert.equal(reviewedDisposition(entry,answer).status,'confirmed');
});
test('unreadable indexed pages never turn a search snippet into direct EU IBAN proof',async()=>{
 const result=await collectEvidence(entry,{signal:new AbortController().signal,pages:{page:async()=>{throw Error('blocked');}},index:{configured:()=>true,search:async()=>[{url:'https://qa-bank.eu/business/iban',description:proof}]}});const answer=validateAssessment(empty(),result.originalDocuments);assert.equal(answer.facts.euIban.status,'unknown');assert.ok(result.originalDocuments.some(d=>d.kind==='official_index'));assert.ok(result.research.pages.every(p=>p.status==='unavailable'));
});
test('an explicit business account offer recovers two independent facts without guessing the EU country',()=>{
 const docs=[{id:'s1',url:'https://qa-bank.eu/business',kind:'official_page',text:'We offer business accounts for companies. SEPA transfers and EUR balances are available.'}];const answer=validateAssessment(empty(),docs);assert.equal(answer.facts.business.status,'yes');assert.equal(answer.facts.account.status,'yes');assert.equal(answer.facts.euIban.status,'unknown');assert.notEqual(answer.decision,'match');
 for(const text of ['We do not offer business accounts.','We will offer business accounts.','Connect your existing business accounts.']){const value=validateAssessment(empty(),[{...docs[0],text}]);assert.equal(value.facts.account.status,'unknown',text);}
});
test('evidence requests have a hard page budget, never follow login or foreign redirects, and stop on cancellation',async()=>{
 const seen=[],control=new AbortController();const result=await collectEvidence(entry,{signal:control.signal,pages:{page:async url=>{seen.push(url);return{url,text:'We offer business accounts.',body:Array.from({length:20},(_,i)=>`<a href="/business/${i}">Business FAQ</a>`).join('')+'<a href="/login">Account login</a>'};}},index:{configured:()=>true,search:async()=>[{url:'https://qa-bank.eu/iban-found',description:'Details'}]}});assert.equal(seen.length,5);assert.equal(result.research.indexQueries,1);assert.ok(seen.includes('https://qa-bank.eu/iban-found'));assert.ok(!seen.some(u=>u.includes('/login')));
 const calls=[];await assert.rejects(collectEvidence(entry,{signal:control.signal,pages:{page:async url=>{calls.push(url);control.abort();return{url,text:proof,body:''};}}}),error=>error.name==='AbortError');assert.equal(calls.length,1);
});
test('a redirect to a different provider never supplies that other provider business IBAN as proof',async()=>{
 const result=await collectEvidence(entry,{signal:new AbortController().signal,pages:{page:async()=>({url:'https://other-provider.eu/business',text:proof,body:'<a href="/iban">IBAN</a>'})}});assert.equal(result.research.pages[0].status,'unavailable');assert.ok(!result.originalDocuments.some(d=>d.kind==='official_page'));assert.equal(validateAssessment(empty(),result.originalDocuments).facts.euIban.status,'unknown');
});
test('an explicit Kuwait provider claim found on its own website is filtered before AI and counted as filtered',async()=>{
 const store=memoryStore();store.state.findings.push({appId:'co.qa.warba',title:'Warba Bank',url:'https://play.google.com/store/apps/details?id=co.qa.warba',developerWebsite:'https://warbabank.com/',screeningText:'Mobile banking and account services.'});let calls=0;const review=createAIReview({store,pages:{page:async url=>({url,text:'Warba Bank is incorporated in Kuwait and regulated by the Central Bank of Kuwait. We offer business accounts for companies.',body:''})},provider:{configured:()=>true,model:'fixture',assess:async()=>{calls++;return{assessment:{},usage:{inputTokens:0,outputTokens:0},model:'fixture'};}}});const job=await review.startJob();await review.idle();assert.equal(calls,0);assert.equal(crmRows(store.state).find(r=>r.id==='company:warbabank.com').status,'auto_excluded');assert.equal(review.job(job.id).outcomes.filtered,1);await review.stop();
});
