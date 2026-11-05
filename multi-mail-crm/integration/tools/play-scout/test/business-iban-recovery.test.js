import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {explicitEUIbanClaim} from '../lib/qualification.js';
import {validateAssessment,createAIReview,reviewCacheKey} from '../lib/ai-review.js';
import {repairStoredResult,revalidateStoredAnalyses} from '../lib/review-repair.js';
import {VALIDATION_POLICY_VERSION} from '../lib/product-evidence.js';
import {memoryStore,openStore} from '../lib/store.js';
import {groupedCandidates} from '../lib/neural-inbox.js';
import {crmRows} from '../lib/crm.js';

const now=new Date('2026-11-02T16:20:00Z');
const unknown=()=>Object.fromEntries(['business','account','euIban','utility'].map(k=>[k,{status:'unknown',evidence:[]}]));
const fact=(sourceId,quote,status='yes')=>({status,evidence:[{sourceId,quote}]});
const document=(text,patch={})=>({id:'s1',url:'https://provider.example.eu/business',kind:'official_page',text,...patch});

test('EU IBAN claims recognise plurals and German inflections while rejecting negative and non-EU claims',()=>{
 for(const text of ['Local EU IBANs for your company','Business Account with EU IBAN','deutsche IBAN','deutscher IBAN','deutschen IBAN','deutschem IBAN','deutsches IBAN'])assert.equal(explicitEUIbanClaim(text),true,text);
 for(const text of ['No EU IBANs','We do not provide EU IBANs','It does not issue German IBANs','keine deutsche IBAN','ohne deutschen IBAN','Business accounts with GB IBANs','Business accounts with EUR and SEPA'])assert.equal(explicitEUIbanClaim(text),false,text);
});

test('compact business IBAN offer labels recover exact evidence without requiring an English verb',()=>{
 for(const quote of ['Local EU IBANs for your company','Business Account with EU IBAN']){
  const docs=[document('A digital business account for companies.\n'+quote)],result=validateAssessment(unknown(),docs);
  assert.equal(result.decision,'match');assert.equal(result.quality.status,'checked');assert.ok(result.quality.recoveredFacts.includes('euIban'));
  for(const key of ['business','account','euIban'])assert.ok(result.facts[key].evidence.every(e=>docs.find(d=>d.id===e.sourceId).text.includes(e.quote)));
 }
});

test('German account-opening text survives abbreviations and offline repair recovers facts from saved original evidence',()=>{
 const docs=[document('Das smarte Geschäftskonto wächst mit Ihrem Business.',{id:'s1'}),document('Kostenloses Geschäftskonto eröffnen\nEinfache Kontoeröffnung inkl. deutscher IBAN, ohne SCHUFA-Abfrage',{id:'s2',url:'https://provider.example.eu/business-current-account/'})];
 const raw={...unknown(),business:fact('s1',docs[0].text),account:fact('s2','Invented quotation about opening a business account.'),euIban:fact('s2','deutscher IBAN'),summaryRu:'Счёт не подтверждён.'};
 const result=validateAssessment(raw,docs);
 assert.equal(result.decision,'review');assert.equal(result.quality.status,'needs_review');assert.equal(result.rejectedQuotes,1);assert.equal(result.facts.account.status,'unknown');
 const entry={id:'company:provider.example.eu',title:'Provider',url:docs[0].url,developerWebsite:docs[0].url,documents:docs};
 const repaired=repairStoredResult({...result,id:entry.id,sourceDocuments:docs},entry),again=repairStoredResult(repaired,entry);
 assert.equal(repaired.decision,'match');assert.equal(repaired.quality.status,'checked');assert.deepEqual(repaired.quality.recoveredFacts,['account','euIban']);assert.equal(repaired.factReasons.account,undefined);assert.equal(repaired.factReasons.euIban,undefined);
 assert.match(repaired.facts.euIban.evidence[0].quote,/Kontoeröffnung inkl\. deutscher IBAN/);assert.ok(repaired.facts.business.evidence.some(e=>e.sourceId==='s2'));assert.match(repaired.summary,/EU IBAN: есть подтверждающая цитата/);
 assert.equal(repaired.repairRequired,false);assert.equal(again.decision,'match');assert.equal(again.repairRequired,false);
});

test('recovery leaves unsupported model quotes flagged when the source has no replacement',()=>{
 const result=validateAssessment({...unknown(),account:fact('s1','Invented offer of a business account.')},[document('Provider company information.')]);
 assert.equal(result.facts.account.status,'unknown');assert.equal(result.quality.status,'needs_review');assert.equal(result.rejectedQuotes,1);assert.ok(result.quality.issues.includes('rejected_quotes'));
});

test('normal unknown and explicit negative business IBAN assessments remain distinct',()=>{
 const docs=[document('Our business accounts are available to companies.\nBusiness Account with EU IBAN')];
 const result=validateAssessment({...unknown(),euIban:fact('s1','Business Account with EU IBAN','no')},docs);
 assert.equal(result.facts.euIban.status,'no');assert.notEqual(result.decision,'match');
 const italian=validateAssessment(unknown(),[document('Il conto aziendale online per liberi professionisti.\nSEPA payments and EUR accounts.',{url:'https://provider.example.it/business'})]);
 assert.equal(italian.facts.euIban.status,'unknown');assert.notEqual(italian.decision,'match');
});

test('labels cannot promote personal IBANs, destinations, shared deposits, future offers, definitions or third-party claims',()=>{
 const claims=['Personal accounts receive German IBANs.','Send payments to German IBANs.','Use our shared EU IBAN for deposits.','We will offer business accounts with EU IBANs.','Business Account with EU IBAN coming soon.','A German IBAN contains 22 characters.','We do not issue EU IBANs.','Business accounts with Swiss IBANs.'];
 for(const claim of claims){
  const docs=[document('We offer business accounts.\n'+claim)],result=validateAssessment(unknown(),docs);
  assert.equal(result.facts.euIban.status,'unknown',claim);assert.notEqual(result.decision,'match',claim);
 }
 for(const patch of [{kind:'third_party',url:'https://publisher.example/news/provider'},{kind:'official_index'},{url:'https://www.lb.lt/en/provider'}]){
  const result=validateAssessment(unknown(),[document('Business Account with EU IBAN',patch)]);assert.notEqual(result.decision,'match');
 }
});

test('live review validates against full original source even when the model omits the IBAN in its compact packet',async()=>{
 const store=memoryStore(now);store.state.web.findings.push({id:'web:provider',url:'https://provider.example.eu/',developerWebsite:'https://provider.example.eu/',title:'Provider business account',snippet:'We offer business accounts.'});
 const full='We offer business accounts.\n'+Array.from({length:60},(_,i)=>'Corporate business account SEPA terms and licence disclosure number '+i+'.').join('\n')+'\nBusiness Account with EU IBAN';
 let calls=0;
 const review=createAIReview({store,clock:()=>now,pages:{page:async url=>({url,text:full,body:''})},provider:{configured:()=>true,model:'fixture',assess:async({documents})=>{calls++;assert.ok(documents.every(d=>!d.text.includes('Business Account with EU IBAN')));return{assessment:unknown(),model:'fixture',usage:{inputTokens:1,outputTokens:1}};}}});
 await review.startJob();await review.idle();assert.equal(calls,1);assert.equal(store.state.ai.results[0].decision,'match');assert.equal(store.state.ai.results[0].repairRequired,false);assert.ok(store.state.ai.results[0].sourceDocuments.some(d=>d.text.includes('Business Account with EU IBAN')));
});

test('policy upgrade repairs saved answers and cache locally while preserving 39 worked records, settings, notes and usage',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'iban-policy-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const baseline=await openStore(join(dir,'baseline.json'),now);await baseline.flush();const store={state:structuredClone(baseline.state)},text='A digital business account for companies.\nLocal EU IBANs for your company';
 store.state.findings.push({appId:'co.provider.business',title:'Provider Business',url:'https://play.google.com/store/apps/details?id=co.provider.business',developerWebsite:'https://provider.example.eu/',screeningText:text,firstFoundAt:now.toISOString()});
 const entry=groupedCandidates(store.state)[0],docs=[document(text,{url:entry.url,kind:'listing'})],saved={id:entry.id,title:entry.title,url:entry.url,developerWebsite:entry.developerWebsite,inputHash:entry.inputHash,model:'gpt-5-mini',engine:'openai',version:2,policyVersion:4,mode:'economy',facts:unknown(),sourceDocuments:docs,checkedAt:now.toISOString(),summary:'Сведения об IBAN не подтверждены.'};
 store.state.ai.results.push(saved);const cacheKey=reviewCacheKey(entry.id,entry.inputHash,saved.model);store.state.ai.reviewCache??={};store.state.ai.reviewCache[cacheKey]=structuredClone(saved);store.state.ai.validationPolicyVersion=4;
 store.state.ai.config.engine='hybrid';store.state.ai.config.ollamaModel='qwen2.5:7b';store.state.ai.usage['2026-11']={attempts:3,inputTokens:100,outputTokens:20};store.state.crm.records[entry.id]={notes:'Keep this note'};
 store.state.crm.reviewEntries??=[];
 for(let i=0;i<39;i++){
  const id='company:worked'+i+'.example.eu';store.state.crm.reviewEntries.push({id,title:'Worked '+i,source:'worked_archive',url:'https://worked'+i+'.example.eu/',developerWebsite:'https://worked'+i+'.example.eu/',screeningText:'Business accounts with EUR and SEPA.'});store.state.crm.records[id]={notes:'Worked note '+i,exclusionReason:'worked'};store.state.manualExclusions.push({key:'worked-'+i,kind:'domain',value:'worked'+i+'.example.eu',title:'Worked '+i,reason:'worked'});
 }
 const keep=structuredClone({rules:store.state.manualExclusions,records:store.state.crm.records,config:store.state.ai.config,usage:store.state.ai.usage,settings:store.state.crm.settings,filters:store.state.schedule.filters});
 const file=join(dir,'state.json');await writeFile(file,JSON.stringify(store.state));const opened=await openStore(file,now);
 assert.equal(opened.state.ai.validationPolicyVersion,VALIDATION_POLICY_VERSION);assert.equal(opened.state.ai.lastRepair.apiCalls,0);assert.equal(opened.state.ai.results[0].decision,'match');assert.equal(opened.state.ai.results[0].repairRequired,false);assert.equal(opened.state.ai.reviewCache[cacheKey].decision,'match');
 assert.deepEqual({rules:opened.state.manualExclusions,records:opened.state.crm.records,config:opened.state.ai.config,usage:opened.state.ai.usage,settings:opened.state.crm.settings,filters:opened.state.schedule.filters},keep);
 assert.equal(crmRows(opened.state).filter(r=>r.worked).length,39);const at=opened.state.ai.lastRepair.at;await opened.flush();const reopened=await openStore(file,new Date(now.getTime()+1000));assert.equal(reopened.state.ai.lastRepair.at,at);assert.equal(reopened.state.ai.results[0].decision,'match');
 const before=structuredClone(reopened.state.ai.usage);revalidateStoredAnalyses(reopened.state,now);assert.deepEqual(reopened.state.ai.usage,before);assert.equal(reopened.state.ai.results[0].decision,'match');
});
