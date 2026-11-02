import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {screenCandidate} from '../lib/screening.js';
import {validateAssessment,dueReviews,reviewCacheKey} from '../lib/ai-review.js';
import {memoryStore,openStore} from '../lib/store.js';
import {groupedCandidates} from '../lib/neural-inbox.js';
import {crmRows,crmExport,editCRM,excludeCRM} from '../lib/crm.js';
import {matchesCRMView} from '../lib/crm-views.js';
import {VALIDATION_POLICY_VERSION} from '../lib/product-evidence.js';
import {revalidateStoredAnalyses} from '../lib/review-repair.js';
import {nonTargetMarketEvidence} from '../lib/market-scope.js';
const now=new Date('2026-11-02T17:00:00Z');
const unknown=()=>Object.fromEntries(['business','account','euIban','utility'].map(k=>[k,{status:'unknown',evidence:[]}]));
const unlimit=JSON.parse(await readFile(new URL('./fixtures/play-reference-updates.json',import.meta.url),'utf8')).apps.find(a=>a.appId==='com.unlimint.app');
function app(text,patch={}){return{appId:'co.precision.app',title:'Payment provider',url:'https://play.google.com/store/apps/details?id=co.precision.app',developerWebsite:'https://provider.example.eu/',screeningText:text,firstFoundAt:now.toISOString(),...patch};}
const docs=entry=>[{id:'s1',url:entry.url,kind:'listing',text:entry.screeningText}];
function result(store,entry,raw={}){
 const group=groupedCandidates(store.state,{includeExcluded:true,allSources:true}).find(g=>g.targets.some(t=>t.appId===entry.appId)),sourceDocuments=docs(entry);
 const saved={...validateAssessment({...unknown(),summaryRu:'Проверка условий.',...raw},sourceDocuments),id:group.id,title:entry.title,url:entry.url,developerWebsite:entry.developerWebsite,sourceDocuments,inputHash:group.inputHash,checkedAt:now.toISOString(),version:2,model:'fixture',engine:'openai',analysisMethod:'ai'};
 store.state.ai.results.push(saved);store.state.ai.newIds.push(group.id);return saved;
}

test('the actual Unlimit listing retains the corporate account and digital KYB lead despite expense tracking',()=>{
 const entry=app(unlimit.description,{...unlimit,screeningText:unlimit.description,url:'https://play.google.com/store/apps/details?id='+unlimit.appId}),screen=screenCandidate({...entry,documents:docs(entry)});
 assert.equal(screen.eligible,true);assert.notEqual(screen.kind,'accounting_tool');assert.match(entry.screeningText,/Our multicurrency corporate account/);assert.match(entry.screeningText,/Online KYB/);assert.match(entry.screeningText,/expense tracking/);
 const assessment=validateAssessment(unknown(),docs(entry));assert.equal(assessment.facts.euIban.status,'unknown');assert.notEqual(assessment.decision,'match');
 const store=memoryStore(now);store.state.findings.push(entry);assert.notEqual(crmRows(store.state)[0].status,'auto_excluded');
});

test('provider account descriptions remain eligible with budgeting and reports; tool names receive no brand exemption',()=>{
 for(const text of ['Our multicurrency corporate account supports EUR and SEPA. Use expense tracking and expense reports.','We offer business accounts. Budgeting is included.','Our corporate account includes dedicated IBAN accounts and online KYB. Expense tracking is available.'])assert.equal(screenCandidate(app(text)).eligible,true,text);
 for(const title of ['Unlimit','Xe Money Transfer & Currency','Ordinary Tracker']){
  const screen=screenCandidate(app('Expense tracking and budgeting app. Link your existing bank accounts to import transactions.',{title}));assert.equal(screen.eligible,false,title);assert.equal(screen.kind,'accounting_tool');
 }
});

test('cash pickup and migrant customers are leads, not proof that a money transfer provider lacks business accounts',()=>{
 for(const text of ['Send money around the globe. Instant Cash Pickup. Committed to support the emigrant communities.','Send international money transfers. Cash pickup is available.']){
  const entry=app(text),screen=screenCandidate(entry);assert.equal(screen.eligible,true);assert.equal(screen.kind,'remittance_lead');
  const validated=validateAssessment(unknown(),docs(entry));assert.equal(validated.facts.euIban.status,'unknown');assert.notEqual(validated.decision,'match');
  const store=memoryStore(now);store.state.findings.push(entry);const saved=result(store,entry);assert.equal(crmRows(store.state)[0].status,'review');assert.equal(saved.facts.business.status,'unknown');
 }
});

test('completed uncertain AI answers enter manual review while their first-discovery badge remains visible',()=>{
 const store=memoryStore(now),entry=app('Open your business account for companies. EUR and SEPA transfers are supported.');store.state.findings.push(entry);
 const pending=groupedCandidates(store.state)[0];store.state.ai.newIds.push(pending.id);assert.equal(crmRows(store.state)[0].status,'new');
 result(store,entry);const row=crmRows(store.state)[0];assert.equal(row.status,'review');assert.equal(row.isNew,true);assert.equal(matchesCRMView(row,'review'),true);assert.equal(matchesCRMView(row,'new'),true);assert.equal(row.reviewRouting.evaluated,true);assert.equal(dueReviews(store.state,'fixture',now).length,0);assert.equal(crmExport(store.state,{status:'review'}).length,1);
});

test('ordinary AI passes use the same conservative match, negative and conflict routing as manual passes',()=>{
 const bank='We offer business accounts. Open your business account with a German IBAN.';
 const store=memoryStore(now),entry=app(bank);store.state.findings.push(entry);const saved=result(store,entry);assert.equal(crmRows(store.state)[0].status,'confirmed');assert.equal(crmRows(store.state)[0].approval,null);
 saved.quality={...saved.quality,status:'needs_review',issues:['rejected_quotes']};assert.equal(crmRows(store.state)[0].status,'review');
 const negative=memoryStore(now),quote='We do not offer business accounts.',remit=app('Send money worldwide. Cash pickup is available. '+quote);negative.state.findings.push(remit);result(negative,remit,{business:{status:'no',evidence:[{sourceId:'s1',quote}]}});assert.equal(crmRows(negative.state)[0].status,'auto_excluded');
 const tool=memoryStore(now),toolEntry=app('This is an IBAN checker and validator. It checks existing IBAN numbers.');tool.state.findings.push(toolEntry);result(tool,toolEntry,{utility:{status:'yes',evidence:[{sourceId:'s1',quote:'This is an IBAN checker and validator.'}]}});assert.equal(crmRows(tool.state)[0].status,'auto_excluded');
});

test('manual decisions survive reclassification and no unsupported EU country is invented',()=>{
 for(const status of ['approved','selected','watch']){
  const store=memoryStore(now),entry=app('Money transfers with cash pickup.');store.state.findings.push(entry);const saved=result(store,entry);editCRM(store.state,{id:saved.id,status,notes:'My decision'},now);const row=crmRows(store.state)[0];assert.equal(row.status,status);assert.equal(row.notes,'My decision');assert.equal(row.facts.euIban.status,'unknown');
 }
 const store=memoryStore(now),entry=app(unlimit.description,{title:'Unlimit'});store.state.findings.push(entry);const saved=result(store,entry);excludeCRM(store.state,saved.id,now,'worked');revalidateStoredAnalyses(store.state,now);assert.equal(crmRows(store.state)[0].status,'excluded');assert.equal(crmRows(store.state)[0].worked,true);
});

test('domestic African banking products are screened on provider evidence, with EU products and neutral country menus preserved',()=>{
 for(const [country,host,authority]of [['KE','bank.co.ke','Central Bank of Kenya'],['UG','bank.ug','Bank of Uganda'],['TZ','bank.co.tz','Bank of Tanzania'],['RW','bank.rw','National Bank of Rwanda'],['SS','bank.ss','Bank of South Sudan'],['CD','bank.cd','Central Bank of the Congo']]){
  const entry=app('We provide business accounts for domestic companies. Regulated by '+authority+'. EUR balances are supported.',{developerWebsite:'https://'+host+'/',developerCountry:country});
  assert.equal(screenCandidate(entry).eligible,false,country);assert.equal(nonTargetMarketEvidence(entry).country,country);
  const international={...entry,screeningText:entry.screeningText+' Open your business account with a German IBAN.'};assert.equal(nonTargetMarketEvidence(international),null,country);assert.equal(screenCandidate(international).eligible,true,country);
  assert.equal(nonTargetMarketEvidence(entry,{marketScope:'worldwide'}),null,country);
 }
 const domestic=app('We provide corporate banking services. Our company is incorporated in Kenya.');assert.equal(nonTargetMarketEvidence(domestic).country,'KE');
 assert.equal(nonTargetMarketEvidence(app('Corporate banking for local businesses.',{developerAddress:'Nairobi, Kenya'})).country,'KE');
 for(const text of ['Country: Kenya Uganda Tanzania Rwanda South Sudan DRC. We offer business accounts.','Our banking partner is regulated by the Central Bank of Kenya. We offer business accounts.'])assert.equal(nonTargetMarketEvidence(app(text)),null,text);
 const store=memoryStore(now);store.state.findings.push(domestic);result(store,domestic);assert.equal(crmRows(store.state)[0].status,'auto_excluded');
});

test('a saved worked decision takes priority over an automatic jurisdiction rejection across app and domain aliases',()=>{
 const store=memoryStore(now),entry=app('We are headquartered in Hong Kong. We offer business accounts.',{title:'Prior provider money transfers and cards',developerWebsite:'https://prior.example.eu/'});store.state.findings.push(entry);
 store.state.manualExclusions.push({key:'old',kind:'app',value:entry.appId,title:'Prior provider',reason:'worked'});
 const row=crmRows(store.state).find(r=>r.targets.length);assert.equal(row.status,'excluded');assert.equal(row.worked,true);assert.equal(row.exclusionReason,'worked');assert.equal(crmExport(store.state,{status:'auto_excluded'}).length,0);
});

test('customer incorporation and rejected countries do not become provider jurisdiction',()=>{
 for(const text of [
  'The provider is an EMI licensed in Lithuania. We do not support companies incorporated in Hong Kong.',
  'The provider is an EMI licensed in Lithuania and serves businesses registered in Hong Kong.',
  'We offer business accounts to companies registered in Hong Kong.',
  'Your company must not be registered in Hong Kong.',
  'Our registered office is in Lithuania and our services are unavailable to companies incorporated in Hong Kong.',
  'Our licensed partner is regulated by the Hong Kong Monetary Authority.'
 ])assert.equal(nonTargetMarketEvidence(app(text)),null,text);
 for(const text of ['Our registered office is in Hong Kong.','The provider is incorporated in Hong Kong.','We are headquartered in Hong Kong.'])assert.equal(nonTargetMarketEvidence(app(text)).country,'HK',text);
 const store=memoryStore(now),entry=app('We offer business accounts to companies registered in Hong Kong. Our company is registered in Lithuania.');store.state.findings.push(entry);result(store,entry);assert.equal(crmRows(store.state)[0].status,'review');assert.equal(crmRows(store.state)[0].marketEvidence,null);
});

test('offline upgrade clears stale automatic flags and preserves 61 worked notes, 149 pending cards and model usage',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'precision-upgrade-'));t.after(()=>rm(dir,{recursive:true,force:true}));const baseline=await openStore(join(dir,'baseline.json'),now);await baseline.flush();const store={state:structuredClone(baseline.state)};
 const entry=app(unlimit.description,{title:'Account provider'});store.state.findings.push(entry);const saved=result(store,entry);Object.assign(saved,{autoExcluded:'accounting_tool',analysisMethod:'pre_ai_screen',policyVersion:5,repairRequired:false});store.state.ai.reviewCache??={};const key=reviewCacheKey(saved.id,saved.inputHash,saved.model);store.state.ai.reviewCache[key]=structuredClone(saved);store.state.ai.validationPolicyVersion=5;
 store.state.ai.usage['2026-11']={attempts:25,inputTokens:1000,outputTokens:100};Object.assign(store.state.ai.config,{engine:'hybrid',ollamaModel:'qwen2.5:7b'});store.state.crm.reviewEntries??=[];
 for(let i=0;i<61;i++){
  const host='worked'+i+'.example.eu',id='company:'+host;store.state.crm.reviewEntries.push({id,recheckId:id,title:'Worked '+i,url:'https://'+host+'/',developerWebsite:'https://'+host+'/',source:'worked_archive',screeningText:'Business accounts.',originSection:'web'});store.state.manualExclusions.push({key:'worked-'+i,kind:'domain',value:host,reason:'worked',title:'Worked '+i});store.state.crm.records[id]={notes:'Protected note '+i,exclusionReason:'worked'};
 }
 store.state.pendingChecks=Array.from({length:149},(_,i)=>({appId:'co.pending.app'+i,country:'DE'}));store.state.pendingCheckConfig=structuredClone(store.state.schedule.filters);const keep=structuredClone({records:store.state.crm.records,rules:store.state.manualExclusions,usage:store.state.ai.usage,config:store.state.ai.config,pending:store.state.pendingChecks,pendingConfig:store.state.pendingCheckConfig,known:store.state.knownProjects,filters:store.state.schedule.filters});
 const file=join(dir,'state.json');await writeFile(file,JSON.stringify(store.state));const reopened=await openStore(file,now),after=reopened.state;
 assert.equal(after.ai.validationPolicyVersion,VALIDATION_POLICY_VERSION);assert.equal(after.ai.lastRepair.apiCalls,0);assert.equal(after.ai.results[0].autoExcluded,null);assert.equal(after.ai.reviewCache[key].autoExcluded,null);assert.equal(after.ai.results[0].facts.euIban.status,'unknown');assert.notEqual(crmRows(after).find(r=>r.id===saved.id).status,'auto_excluded');assert.equal(crmRows(after).filter(r=>r.worked).length,61);
 assert.deepEqual({records:after.crm.records,rules:after.manualExclusions,usage:after.ai.usage,config:after.ai.config,pending:after.pendingChecks,pendingConfig:after.pendingCheckConfig,known:after.knownProjects,filters:after.schedule.filters},keep);
 await reopened.flush();const again=await openStore(file,new Date(now.getTime()+1000));assert.equal(again.state.ai.lastRepair.at,after.ai.lastRepair.at);assert.equal(again.state.ai.results[0].autoExcluded,null);assert.deepEqual(again.state.ai.usage,keep.usage);
});
