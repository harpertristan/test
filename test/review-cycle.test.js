import {manuallyExcluded,effectiveExclusions} from '../lib/manual-exclusions.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {memoryStore,openStore} from '../lib/store.js';
import {resetForReview,freshFinding} from '../lib/review-cycle.js';
import {seedKnownProjects} from '../lib/known-projects.js';
import {crmRows,crmExport,editCRM,bulkCRM} from '../lib/crm.js';
import {groupedCandidates,storeInbox,inboxEntry} from '../lib/neural-inbox.js';
import {createAIReview,dueReviews,collectEvidence} from '../lib/ai-review.js';
import {createApp,shutdownApp} from '../server.js';
const now=new Date('2026-10-29T12:00:00Z'),old='2026-10-01T12:00:00Z';
const description='Acme offers business accounts for companies. We provide business accounts with a German IBAN and SEPA transfers.';
const app=(name,host,text=description)=>({appId:'co.'+name.toLowerCase()+'.app',title:name,url:'https://play.google.com/store/apps/details?id=co.'+name.toLowerCase()+'.app',developerWebsite:'https://'+host+'/',screeningText:text,firstFoundAt:old});
function fixture(){
 const store=memoryStore(now);seedKnownProjects(store.state,now);store.state.findings.push(app('Approved','approved.eu'),app('Rejected','rejected.eu'),app('Worked','worked.eu'),app('China','bank.cn'),app('Wallet','wallet.example','A non-custodial Bitcoin wallet. Store private keys and send USDT.'));
 store.state.crm.records={'company:approved.eu':{status:'approved',notes:'Keep approval notes',approval:{by:'user',at:old}},'company:worked.eu':{status:'selected',notes:'Protected notes'},'company:orphan.eu':{status:'rejected',notes:'Orphan notes'}};
 store.state.manualExclusions=[{key:'worked',kind:'domain',value:'worked.eu',reason:'worked',title:'Worked',createdAt:old},{key:'not-provider',kind:'domain',value:'rejected.eu',reason:'not_provider',title:'Rejected'},{key:'only-rule',kind:'app',value:'co.only.rule',title:'Rule Only',reason:'location'}];
 store.state.ai.shortlist=['company:worked.eu','company:approved.eu'];store.state.ai.newIds=['company:approved.eu'];
 store.state.ai.results=[{id:'company:approved.eu',title:'Approved',url:'https://approved.eu/',developerWebsite:'https://approved.eu/',checkedAt:old,facts:{},summary:'Old analysis',sourceDocuments:[{url:'https://approved.eu/',text:description,kind:'official_page'}]}];store.state.ai.reviewCache={untouched:{facts:{},marker:'keep'}};
 store.state.jobs=[{id:'abcd-1234',status:'complete',config:structuredClone(store.state.schedule.filters),results:[app('History','history.eu')],reviewCandidates:[],filterExamples:[{appId:'co.filtered.app',title:'Filtered',reason:'category'}]}];
 return store;
}
test('the complete saved inventory returns to manual review, including wallets, jurisdictions, known projects, orphan rules and history; worked entries remain unchanged',()=>{
 const s=fixture(),worked=structuredClone(s.state.crm.records['company:worked.eu']),rules=structuredClone(s.state.manualExclusions.filter(r=>r.reason==='worked')),ai=structuredClone(s.state.ai.results),cache=structuredClone(s.state.ai.reviewCache),settings=structuredClone(s.state.schedule),findings=structuredClone(s.state.findings);
 const result=resetForReview(s.state,{now});assert.ok(result.restored>=40);assert.ok(result.protectedCount>=1);assert.equal(result.apiCalls,0);
 const rows=crmRows(s.state);for(const title of ['Approved','Rejected','China','Wallet','History','Filtered','Rule Only','BankPro','BORDERPAY Business','Omexpay Business']){const r=rows.find(r=>r.title===title);assert.ok(r,title);assert.equal(r.status,'review',title);assert.equal(r.isNew,false,title);assert.equal(r.needsManualReview,true,title);}
 assert.equal(rows.find(r=>r.title==='Worked').status,'excluded');assert.deepEqual(s.state.crm.records['company:worked.eu'],worked);assert.deepEqual(s.state.manualExclusions,rules);assert.deepEqual(s.state.ai.results,ai);assert.deepEqual(s.state.ai.reviewCache,cache);assert.deepEqual(s.state.schedule,settings);assert.deepEqual(s.state.findings,findings);assert.deepEqual(s.state.ai.shortlist,['company:worked.eu']);assert.equal(crmExport(s.state,{status:'new'}).length,0);assert.equal(crmExport(s.state,{status:'approved'}).length,0);assert.equal(crmExport(s.state,{status:'worked'}).length,1);assert.match(rows.find(r=>r.id==='company:approved.eu').notes,/Keep approval notes/);
});
test('recovered records are not new; genuinely unseen projects are new across normal source ingestion without AI',()=>{
 const s=fixture();resetForReview(s.state,{now});const later=new Date(+now+10000),entry=app('Fresh','fresh.eu');entry.firstFoundAt=later.toISOString();storeInbox(s.state,[inboxEntry(entry,'web',later)]);
 const fresh=crmRows(s.state).find(r=>r.title==='Fresh');assert.equal(fresh.isNew,true);assert.ok(crmExport(s.state,{status:'new'}).some(r=>r.id===fresh.id));
 const article={id:'link:https://finextra.com/news/kunga',title:'Kunga raises a funding round',firstFoundAt:later.toISOString()};assert.equal(freshFinding(s.state,article),false);assert.equal(freshFinding(s.state,{id:'new:ofx',title:'OFX Business',firstFoundAt:later.toISOString()}),false);assert.equal(crmRows(s.state).find(r=>r.title==='Wallet').isNew,false);
 storeInbox(s.state,[inboxEntry({...article,url:'https://finextra.com/news/kunga',screeningText:description,source:'finextra'},'social',later)]);assert.ok(!dueReviews(s.state,'offline').some(r=>r.title===article.title));
});
test('worked metadata and known-app aliases remain protected without changing their stored records',()=>{
 const s=fixture(),p=s.state.knownProjects.find(p=>p.name==='Stable.com'),before=structuredClone(p);s.state.manualExclusions.push({key:'worked-stable',kind:'app',value:'com.stablecom.app',reason:'worked',title:'Protected Stable'});
 s.state.crm.records['company:metadata.eu']={status:'selected',exclusionReason:'worked',notes:'Protect this exact record'};const metadata=structuredClone(s.state.crm.records['company:metadata.eu']);
 resetForReview(s.state,{now});assert.deepEqual(s.state.knownProjects.find(p=>p.name==='Stable.com'),before);assert.deepEqual(s.state.crm.records['company:metadata.eu'],metadata);assert.ok(crmExport(s.state,{status:'worked'}).some(r=>r.id==='company:metadata.eu'));assert.ok(crmExport(s.state,{status:'worked'}).some(r=>r.title==='Protected Stable'));assert.ok(!crmRows(s.state).some(r=>r.status==='known'&&r.title==='Stable.com'));
});
test('only a manual decision creates approval; former automatic rejections remain visible for that review cycle',()=>{
 const s=fixture();resetForReview(s.state,{now});const id='company:bank.cn';assert.equal(crmRows(s.state).find(r=>r.id===id).status,'review');editCRM(s.state,{id,status:'approved'},now);const row=crmRows(s.state).find(r=>r.id===id);assert.equal(row.status,'approved');assert.equal(row.approval.by,'user');assert.equal(row.isNew,false);assert.equal(row.needsManualReview,false);assert.equal(crmExport(s.state,{status:'approved'}).length,1);assert.equal(dueReviews(s.state,'offline').length,0);
});
test('a legacy database is backed up before the one-time reset; restart preserves subsequent manual choices',async t=>{
 const s=fixture();delete s.state.reviewResetVersion;const dir=await mkdtemp(join(tmpdir(),'review-reset-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=join(dir,'state.json'),original=JSON.stringify(s.state);await writeFile(file,original);
 const opened=await openStore(file,now),cycle=opened.state.crm.reviewCycle;assert.ok(cycle.backupFile);const backup=JSON.parse(await readFile(join(dir,cycle.backupFile),'utf8'));assert.deepEqual(backup,JSON.parse(original));assert.equal((await stat(join(dir,cycle.backupFile))).mode&0o777,0o600);
 await opened.update(d=>editCRM(d,{id:'company:approved.eu',status:'approved'},now));const again=await openStore(file,new Date(+now+1000));assert.equal(again.state.crm.reviewCycle.id,cycle.id);assert.equal(crmRows(again.state).find(r=>r.id==='company:approved.eu').status,'approved');assert.equal((await readdir(dir)).filter(n=>n.includes('before-review-reset')).length,1);
});
test('failed backup leaves the in-memory database unchanged',async t=>{
 const s=fixture(),dir=await mkdtemp(join(tmpdir(),'review-backup-fail-'));t.after(()=>rm(dir,{recursive:true,force:true}));await writeFile(join(dir,'not-directory'),'x');s.file=join(dir,'not-directory','state.json');const before=JSON.stringify(s.state);await assert.rejects(s.update((d,{backupFile})=>resetForReview(d,{now,backupFile}),{backup:'before-review-reset'}),{code:'PERSISTENCE_ERROR'});assert.equal(JSON.stringify(s.state),before);
});
test('reset endpoint rejects viewers and cross-site writes and never calls a model',async t=>{
 const s=fixture();let calls=0;const server=createApp({store:s,password:'owner',viewerPassword:'reader',aiProvider:{configured:()=>true,model:'offline',assess:async()=>{calls++;throw Error('must not run');}}});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>shutdownApp(server));const base='http://127.0.0.1:'+server.address().port,post=(user,extra={})=>fetch(base+'/api/crm/reset-review',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(user).toString('base64'),'Content-Type':'application/json',...extra},body:'{}'});
 assert.equal((await post('viewer:reader')).status,403);assert.equal((await post('admin:owner',{'Sec-Fetch-Site':'cross-site'})).status,403);const response=await post('admin:owner');assert.equal(response.status,200);assert.equal((await response.json()).apiCalls,0);assert.equal(calls,0);const data=await(await fetch(base+'/api/crm',{headers:{Authorization:'Basic '+Buffer.from('admin:owner').toString('base64')}})).json();assert.ok(data.reviewCycle.restored>=40);assert.equal(data.counts.approved??0,0);
});
test('manual-review queue never launches a paid batch automatically; an explicitly selected old record can use saved evidence',async()=>{
 const s=fixture();resetForReview(s.state,{now});let calls=0;const review=createAIReview({store:s,clock:()=>now,pages:{page:async()=>{throw Error('saved sources should be used');}},provider:{configured:()=>true,model:'offline',assess:async()=>{calls++;return{assessment:{summaryRu:'Новый разбор'},usage:{inputTokens:5,outputTokens:5},model:'offline'};}}});
 assert.equal(dueReviews(s.state,'offline').length,0);await assert.rejects(review.startJob(),{status:409});await review.startJob({ids:['company:bank.cn'],manualRecheck:true,reuseSaved:true});await review.idle();assert.equal(calls,1);assert.equal(crmRows(s.state).find(r=>r.id==='company:bank.cn').status,'auto_excluded');assert.equal(dueReviews(s.state,'offline').length,0);await assert.rejects(review.startJob({ids:['company:worked.eu'],manualRecheck:true,reuseSaved:true}));await review.stop();
});
test('independent evidence pages load concurrently and retain deterministic source numbering',async()=>{
 let started=0,release;const ready=new Promise(r=>release=r),seen=[];const entry={title:'Acme',section:'web',url:'https://acme.eu/',developerWebsite:'https://acme.eu/',documents:[]};
 const pages={page:async url=>{if(url==='https://acme.eu/')return{url,text:'Acme offers business accounts.',body:'<a href="/business">Business</a><a href="/about">About</a>'};started++;seen.push(url);if(started===2)release();await ready;return{url,text:description,body:''};}};
 const evidence=await collectEvidence(entry,{pages,signal:AbortSignal.timeout(1500)});assert.equal(started,2);assert.deepEqual(evidence.originalDocuments.map(d=>d.url),['https://acme.eu/','https://acme.eu/business','https://acme.eu/about']);assert.deepEqual(evidence.originalDocuments.map(d=>d.id),['s1','s2','s3']);
});
test('simultaneous card analyses share an in-flight canonical page fetch',async()=>{
 const s=memoryStore(now);s.state.findings.push(app('First','first.eu'),app('Second','second.eu'));const calls=new Map();let release;const gate=new Promise(r=>release=r);
 const review=createAIReview({store:s,clock:()=>now,pages:{page:async url=>{calls.set(url,(calls.get(url)??0)+1);if(url==='https://first.eu/'||url==='https://second.eu/')return{url:'https://shared.eu/',text:'Business accounts.',body:'<a href="/business">Business</a><a href="/about">About</a>'};await gate;return{url,text:description,body:''};}},provider:{configured:()=>true,model:'offline',assess:async()=>({assessment:{},model:'offline',usage:{inputTokens:0,outputTokens:0}})}});
 try{await review.startJob({mode:'full'});for(let i=0;i<200&&!calls.has('https://shared.eu/about');i++)await new Promise(r=>setImmediate(r));assert.equal(calls.get('https://first.eu/'),1);assert.equal(calls.get('https://second.eu/'),1);assert.equal(calls.get('https://shared.eu/business'),1);assert.equal(calls.get('https://shared.eu/about'),1);}finally{release();await review.idle();await review.stop();}
 assert.equal(s.state.ai.results.length,2);
});

test('a restored name-only project can be excluded globally and stays excluded in the manual batch',()=>{
 const s=memoryStore(now);s.state.crm.reviewEntries=[{id:'registry:name-origin',recheckId:'registry:name-origin',title:'Name only provider',originSection:'web',registryOnly:true,documents:[],targets:[]}];resetForReview(s.state,{now});
 const row=crmRows(s.state).find(r=>r.title==='Name only provider');assert.ok(row);bulkCRM(s.state,{ids:[row.id],action:'exclude',reason:'not_provider'},now);assert.equal(crmRows(s.state).find(r=>r.id===row.id).status,'excluded');assert.ok(manuallyExcluded({title:'Name only provider'},effectiveExclusions(s.state)));
});
