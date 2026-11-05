import test from 'node:test';
import assert from 'node:assert/strict';
import {memoryStore,openStore} from '../lib/store.js';
import {CRM_MAIN_VIEWS,matchesCRMView,reviewQuestion} from '../lib/crm-views.js';
import {providerAdmission} from '../lib/provider-admission.js';
import {inboxEntry,storeInbox,groupedCandidates} from '../lib/neural-inbox.js';
import {crmRows,editCRM,bulkCRM,excludeCRM,crmExport} from '../lib/crm.js';
import {createMonitor} from '../lib/monitor.js';
import {createApp,shutdownApp} from '../server.js';
import {cataloguePreset} from '../lib/discovery.js';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const now=new Date('2026-11-02T20:00:00Z');
const account='We offer business accounts. Our multicurrency corporate account supports EUR and SEPA payments.';
const tool='This IBAN checker validates existing IBAN numbers and checks the checksum. It does not open accounts.';
const raw=(i,text=tool,patch={})=>inboxEntry({appId:'co.intake.app'+i,title:text===tool?'IBAN Checker '+i:'Account Provider '+i,url:'https://play.google.com/store/apps/details?id=co.intake.app'+i,developerWebsite:'https://intake'+i+'.example.eu/',screeningText:text,...patch},'play',now);

test('four main views partition providers, preserve explicit approvals and use first-discovery only as a badge',()=>{
 assert.deepEqual(Object.keys(CRM_MAIN_VIEWS),['suitable','needs_review','known_work','archive']);
 const cases=[['approved','suitable'],['confirmed','suitable'],['selected','suitable'],['new','needs_review'],['review','needs_review'],['watch','needs_review'],['known','known_work'],['auto_excluded','archive'],['rejected','archive'],['reference','archive']];
 for(const [status,view]of cases){const row={status,isNew:true};assert.deepEqual(Object.keys(CRM_MAIN_VIEWS).filter(v=>matchesCRMView(row,v)),[view]);}
 assert.equal(matchesCRMView({status:'excluded',worked:true},'known_work'),true);
 assert.equal(matchesCRMView({status:'review',screening:{eligible:false}},'archive'),true);
 assert.equal(matchesCRMView({status:'review',screening:{eligible:false},manualStatusAt:now.toISOString()},'needs_review'),true);
 assert.match(reviewQuestion({status:'review',model:'fixture',facts:{business:{status:'yes'},account:{status:'yes'},euIban:{status:'unknown'}}}),/IBAN страны ЕС/);
});

test('all rejected intake descriptions remain visible outside candidate and model queues, without the old 20-example limit',()=>{
 const store=memoryStore(now);storeInbox(store.state,Array.from({length:65},(_,i)=>raw(i)));
 assert.equal(store.state.ai.inbox.length,0);assert.equal(groupedCandidates(store.state).length,0);assert.equal(Object.keys(store.state.crm.intakeArchive).length,65);
 const rows=crmRows(store.state);assert.equal(rows.length,65);assert.ok(rows.every(r=>r.intakeRecord&&r.documents.some(d=>d.text===tool)&&r.status==='auto_excluded'));assert.equal(crmExport(store.state,{status:'archive'}).length,65);assert.equal(crmExport(store.state,{status:'needs_review'}).length,0);
 storeInbox(store.state,[raw(0)]);assert.equal(Object.keys(store.state.crm.intakeArchive).length,65);assert.equal(store.state.ai.jobs.length,0);
});

test('client countries, currencies, remittance and optional expense tracking remain leads without brand exemptions',()=>{
 const texts=[
  'You can quickly set up an account if your company is registered in the UK, EU/EEA countries, Canada, Hong Kong, or Ukraine. We offer business accounts.',
  'Send money worldwide. Cash pickup is available. Money transfer services for families and companies.',
  'Our multicurrency corporate account supports EUR payments. Online KYB and expense tracking are included.',
  'We offer business accounts with EUR, USD, CNY, HKD and AED balances.',
  'Wise is a Money Service Business registered with FinCen, not an FDIC-insured bank. International accounts.',
  'Get your own US bank account. Plus EUR and GBP virtual IBANs. Cash Out Instantly, Convert to PKR via Raast.'
 ];
 for(const [i,text]of texts.entries())assert.equal(providerAdmission(raw(i,text)).admit,true,text);
 assert.equal(providerAdmission(raw(1,tool,{title:'Genome'})).admit,false);
 assert.equal(providerAdmission(raw(2,account+' Credit score monitoring and a loan calculator are optional.')).admit,true);
});

test('provider location is filtered but a Chinese publisher does not locate an otherwise unknown European account provider',()=>{
 const news={section:'social',source:'news',title:'New business account provider',url:'https://publisher.cn/2026/provider-launch',snippet:'New business accounts and EUR payment services are launching. Your company can be registered in Hong Kong.'};
 assert.equal(providerAdmission(news).admit,true);
 const provider=raw(9,account,{developerWebsite:'https://bank.cn/'});assert.equal(providerAdmission(provider).admit,false);
 const s=memoryStore(now);storeInbox(s.state,[provider]);assert.equal(s.state.ai.inbox.length,0);assert.equal(crmRows(s.state)[0].screening.kind,'excludedJurisdiction');
});

test('one-click return retains the reason and notes, bypasses repeated intake filtering and can protect the provider as worked',()=>{
 const s=memoryStore(now),entry=raw(1);storeInbox(s.state,[entry]);let row=crmRows(s.state)[0];editCRM(s.state,{id:row.id,notes:'Check this exception'},now);
 bulkCRM(s.state,{ids:[row.id],action:'status',status:'review'},now);row=crmRows(s.state).find(r=>r.id===row.id);
 assert.equal(row.status,'review');assert.equal(matchesCRMView(row,'needs_review'),true);assert.equal(row.notes,'Check this exception');assert.match(row.previousExclusionReason,/IBAN/);
 storeInbox(s.state,[entry]);assert.equal(s.state.ai.inbox.length,1);assert.equal(crmRows(s.state).filter(r=>r.id===row.id).length,1);
 excludeCRM(s.state,row.id,now,'worked');storeInbox(s.state,[entry]);row=crmRows(s.state).find(r=>r.id===row.id);assert.equal(row.worked,true);assert.equal(row.notes,'Check this exception');assert.equal(matchesCRMView(row,'known_work'),true);assert.equal(s.state.ai.jobs.length,0);
});

test('explicit return of a legacy crypto-only exclusion stays visible for human review instead of disappearing',()=>{
 const s=memoryStore(now),entry=raw(5,'A non-custodial Bitcoin wallet. Store private keys and send USDT. No fiat account is offered.');storeInbox(s.state,[entry]);const id=crmRows(s.state)[0].id;
 editCRM(s.state,{id,status:'review'},now);const row=crmRows(s.state).find(r=>r.id===id);assert.ok(row);assert.equal(row.status,'review');assert.equal(matchesCRMView(row,'needs_review'),true);
});

test('new source collection keeps utility rejection out of findings and inbox while retaining its full audit card',async()=>{
 const s=memoryStore(now),app={appId:'co.intake.checked',title:'IBAN Checker',description:tool,developerWebsite:'https://checker.example.eu/',genreId:'FINANCE',free:true,price:0,minInstalls:1000,released:'2026-10-01'};
 const m=createMonitor({store:s,clock:()=>now,delay:0,provider:{search:async()=>[app],app:async()=>app}});
 const j=await m.startJob({...cataloguePreset(['DE']),keywords:['business account'],related:false,developerExpansion:false,referenceDiscovery:false,seedApps:[],neuralCapture:true});await m.idle();
 assert.equal(j.status,'complete');assert.equal(s.state.findings.length,0);assert.equal(s.state.ai.inbox.length,0);assert.equal(j.ingestion.rejected,1);const row=crmRows(s.state)[0];assert.ok(row.intakeRecord);assert.match(row.documents[0].text,/checksum/);await m.stop();
});

test('triage API checks only the visible review queue and returned exceptions, with no model calls during ingestion or export',async t=>{
 const store=memoryStore(now);for(const section of[store.state,store.state.web,store.state.social,store.state.watch])section.schedule.enabled=false;
 storeInbox(store.state,[raw(1),raw(2),raw(3,account)]);let rows=crmRows(store.state);const returned=rows.find(r=>r.title==='IBAN Checker 1');editCRM(store.state,{id:returned.id,status:'review'},now);
 let models=0;const api={configured:()=>true,model:'fixture',assess:async()=>{models++;return{assessment:{},model:'fixture',usage:{inputTokens:1,outputTokens:1}};}};
 const server=createApp({store,manual:true,clock:()=>now,provider:{search:async()=>[],app:async()=>({title:'Current provider',description:account})},socialProvider:{configured:()=>false},aiProvider:api,aiPages:{page:async url=>({url,text:account,body:''})}});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>shutdownApp(server));
 const base='http://127.0.0.1:'+server.address().port,data=await(await fetch(base+'/api/crm')).json();assert.equal(data.reviewQueue.count,2);assert.equal(models,0);
 await store.update(d=>storeInbox(d,[raw(4)]));const refreshed=await(await fetch(base+'/api/crm')).json();assert.equal(refreshed.rows.filter(r=>r.intakeRecord).length,2);assert.equal(refreshed.reviewQueue.count,2);assert.ok(!JSON.stringify(refreshed.rows).includes('checksum'));const detail=await(await fetch(base+'/api/crm/item?'+new URLSearchParams({id:refreshed.rows.find(r=>r.intakeRecord).id}))).json();assert.ok(detail.documents.some(d=>d.text.includes('checksum')));
 const exported=await fetch(base+'/api/crm/chat.json?status=archive');assert.equal(exported.status,200);assert.equal((await exported.json()).records.length,2);assert.equal(models,0);
 const response=await fetch(base+'/api/crm/triage/start',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(response.status,202);assert.equal((await response.json()).total,2);await server.aiReview.idle();assert.equal(models,2);
});

test('intake audit, returned overrides, worked decisions and notes survive storage reopen without a new policy migration',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'scout-intake-preserve-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=join(dir,'state.json'),store=await openStore(file,now);
 await store.update(d=>{storeInbox(d,[raw(1),raw(2)]);});const id=crmRows(store.state).find(r=>r.intakeRecord).id;
 await store.update(d=>editCRM(d,{id,status:'review',notes:'Keep exception'},now));await store.flush();const before=await readFile(file),again=await openStore(file,now);await again.flush();assert.equal(crmRows(again.state).find(r=>r.id===id).notes,'Keep exception');assert.equal(again.state.crm.intakeArchive[id].state,'returned');assert.equal(crmRows(again.state).filter(r=>r.intakeRecord).length,1);assert.equal(again.state.ai.jobs.length,0);assert.ok(before.length>0);
});
