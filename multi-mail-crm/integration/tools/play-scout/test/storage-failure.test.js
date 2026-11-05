import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,chmod,utimes,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {openStore} from '../lib/store.js';
import {readStoredState,journalPath,persistenceError} from '../lib/state-journal.js';
import {createAIReview} from '../lib/ai-review.js';
import {reviewConfig} from '../lib/ai-config.js';
import {reviewRouter} from '../lib/ollama-provider.js';
import {groupedCandidates} from '../lib/neural-inbox.js';
import {createApp,shutdownApp} from '../server.js';

const text='We offer business accounts to companies with a dedicated German IBAN and SEPA transfers.';
const now=new Date('2026-11-02T20:00:00Z'),answer={assessment:{},model:'fixture',usage:{inputTokens:11,outputTokens:7}};
const noIndex={configured:()=>false},pages={page:async url=>({url,text,body:''})};
async function fixture(t,n=0){
 const dir=await mkdtemp(join(tmpdir(),'scout-storage-failure-')),file=join(dir,'state.json'),store=await openStore(file,now);
 t.after(()=>rm(dir,{recursive:true,force:true}));
 await store.update(d=>{
  d.ai.config=reviewConfig({...d.ai.config,engine:'hybrid',cloudConcurrency:3});
  for(let i=0;i<n;i++)d.findings.push({appId:'co.storage.app'+i,title:'Storage '+i,url:'https://play.google.com/store/apps/details?id=co.storage.app'+i,developerWebsite:'https://storage'+i+'.example.eu/',screeningText:text});
  d.crm.records.keep={notes:'Keep',exclusionReason:'worked'};
  d.manualExclusions.push({key:'worked',kind:'domain',value:'worked.example.eu',reason:'worked'});
 });await store.flush();return{dir,file,store};
}
const diskError=()=>persistenceError(Object.assign(new Error('/private/secret-key-file: simulated disk failure'),{code:'ENOSPC'}));

test('metadata-only snapshot and journal changes do not stop writes, while notes and usage recover',async t=>{
 const {file,store}=await fixture(t),snapshot=await readFile(file);
 await chmod(file,0o640);await store.update(d=>{d.braveUsage['2026-11']=1;});
 await utimes(file,new Date(),new Date('2027-01-01T00:00:00Z'));
 await utimes(journalPath(file),new Date(),new Date('2027-01-02T00:00:00Z'));
 await store.update(d=>{d.braveUsage['2026-11']++;});
 assert.deepEqual(await readFile(file),snapshot);assert.equal((await readStoredState(file)).braveUsage['2026-11'],2);
 assert.equal((await readStoredState(file)).crm.records.keep.notes,'Keep');await store.flush();
});

test('a real same-size external snapshot edit is rejected without overwriting the external file or journal',async t=>{
 const {file,store}=await fixture(t),before=await readFile(file,'utf8'),changed=before.replace('"Keep"','"Lose"');assert.notEqual(changed,before);assert.equal(changed.length,before.length);
 await writeFile(file,changed);await assert.rejects(store.update(d=>{d.braveUsage['2026-11']=1;}),{code:'PERSISTENCE_ERROR',reasonCode:'STORAGE_CONFLICT'});
 assert.equal(await readFile(file,'utf8'),changed);assert.equal(store.state.crm.records.keep.notes,'Keep');assert.equal(store.lastPersistenceError.code,'STORAGE_CONFLICT');
});

test('same-size journal corruption cannot be mistaken for a harmless timestamp change',async t=>{
 const {file,store}=await fixture(t);await store.update(d=>{d.braveUsage['2026-11']=1;});
 const journal=await readFile(journalPath(file),'utf8'),changed=journal.replace(/"hash":"./,'"hash":"z');assert.notEqual(changed,journal);assert.equal(changed.length,journal.length);await writeFile(journalPath(file),changed);
 await assert.rejects(store.update(d=>{d.braveUsage['2026-11']++;}),{code:'PERSISTENCE_ERROR',reasonCode:'STATE_JOURNAL_INVALID'});assert.equal(await readFile(journalPath(file),'utf8'),changed);
});

test('disk failure reports a safe actionable code, never publishes unsaved changes and clears only after a real commit',async t=>{
 const {file,store}=await fixture(t),append=store._append.bind(store),before=await readFile(file),state=store.state;
 store._append=async()=>{throw Object.assign(new Error('/private/secret-key-file'),{code:'ENOSPC'});};
 await assert.rejects(store.update(d=>{d.crm.records.keep.notes='Unsaved';}),{code:'PERSISTENCE_ERROR',reasonCode:'ENOSPC'});
 assert.equal(store.state,state);assert.deepEqual(await readFile(file),before);assert.equal(store.lastPersistenceError.code,'ENOSPC');assert.ok(!JSON.stringify(store.lastPersistenceError).includes('secret-key'));
 await store.update(()=>{});assert.equal(store.lastPersistenceError.code,'ENOSPC');
 store._append=append;await store.update(d=>{d.braveUsage['2026-11']=1;});assert.equal(store.lastPersistenceError,null);assert.equal((await readStoredState(file)).crm.records.keep.notes,'Keep');
});

test('a hybrid write failure aborts in-flight engines, releases live busy state and never resurrects the stale durable job',async t=>{
 const {file,store}=await fixture(t,10),append=store._append.bind(store);let failing=false,repaired=false,entered=0,aborted=0,release,first;
 const ready=new Promise(r=>release=r);store._append=async(...args)=>{if(failing)throw diskError();return append(...args);};
 const assess=async({title},{signal})=>{if(repaired)return answer;entered++;first??=title;if(entered>=4)release();await ready;if(title===first){failing=true;return answer;}await new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>{aborted++;reject(signal.reason);},{once:true});});};
 const make=engine=>({engine,model:engine==='ollama'?'ollama:fixture':'fixture',configured:()=>true,assess});
 const review=createAIReview({store,provider:reviewRouter({store,openai:make('openai'),ollama:make('ollama')}),pages,index:noIndex,clock:()=>now});
 const ids=groupedCandidates(store.state).map(e=>e.id),job=await review.startJob({ids,manualAll:true});
 await assert.rejects(review.idle(),{code:'PERSISTENCE_ERROR'});assert.equal(entered,4);assert.equal(aborted,3);assert.equal(review.active(),null);assert.equal(review.summary({counts:false}).busy,false);assert.equal(review.job(job.id).status,'failed');assert.equal(store.state.ai.jobs.at(-1).status,'running');assert.equal(store.state.ai.manualBatch.remainingIds.length,10);assert.equal(store.state.ai.results.length,0);assert.equal(store.lastPersistenceError.code,'ENOSPC');await review.cancel();
 failing=false;repaired=true;store._append=append;
 // The next successful job must not reveal the earlier stale running record.
 await review.startJob({ids:[ids[0]],manualAll:true,reuseSaved:true});await review.idle();assert.equal(review.summary({counts:false}).busy,false);await review.stop();await store.flush();
 const restored=await openStore(file,now);assert.equal(restored.state.crm.records.keep.notes,'Keep');assert.equal(restored.state.manualExclusions[0].reason,'worked');assert.ok(restored.state.ai.jobs.every(j=>j.status!=='running'));
});

test('stop-all still aborts AI when source cancellation cannot save; CRM and health retain the safe storage cause',async t=>{
 let server,restore=()=>{};t.after(async()=>{restore();if(server)await shutdownApp(server);});
 const {store}=await fixture(t,1);let entered,aborted=false;const ready=new Promise(r=>entered=r);
 const api={model:'fixture',configured:()=>true,assess:async(_, {signal})=>{entered();await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason);},{once:true}));}};
 await store.update(d=>{d.ai.config=reviewConfig({engine:'openai',cloudConcurrency:1});});
 server=createApp({store,manual:true,aiProvider:api,aiPages:pages,socialProvider:noIndex,clock:()=>now});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;await server.aiReview.startJob({ids:groupedCandidates(store.state).map(e=>e.id),manualAll:true,reuseSaved:true});await ready;
 const cancel=server.sourceWorkspace.cancelAll;server.sourceWorkspace.cancelAll=async()=>{throw diskError();};
 const append=store._append.bind(store);restore=()=>{store._append=append;server.sourceWorkspace.cancelAll=cancel;};store._append=async()=>{throw diskError();};
 const response=await fetch(base+'/api/crm/stop',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(response.status,500);assert.equal(aborted,true);assert.equal(server.aiReview.summary({counts:false}).busy,false);
 const data=await(await fetch(base+'/api/crm')).json(),health=await(await fetch(base+'/api/health')).json();assert.equal(data.ai.busy,false);assert.equal(data.storage.lastError.code,'ENOSPC');assert.equal(health.storageError.code,'ENOSPC');assert.ok(!JSON.stringify(data.storage).includes('secret-key'));
 store._append=append;server.sourceWorkspace.cancelAll=cancel;
});

test('storage doctor reads disk, snapshot and journal without mutating history or running providers',async t=>{
 const {dir,file,store}=await fixture(t);await store.update(d=>{d.braveUsage['2026-11']=3;});const snapshot=await readFile(file),journal=await readFile(journalPath(file));
 const {stdout}=await promisify(execFile)(process.execPath,['scripts/doctor.js','--storage'],{cwd:resolve('.'),env:{...process.env,DATA_DIR:dir}});
 assert.match(stdout,/только чтение/);assert.match(stdout,/Свободно на диске:/);assert.match(stdout,/Снимок и журнал: согласованы/);assert.deepEqual(await readFile(file),snapshot);assert.deepEqual(await readFile(journalPath(file)),journal);
});

test('85 hybrid cards survive metadata changes and a mid-run checkpoint with unique results and durable usage', {timeout:60000},async t=>{
 const {file,store}=await fixture(t,85);let calls=0,release;const ready=new Promise(r=>release=r),titles=new Set();
 const make=engine=>({engine,model:engine==='ollama'?'ollama:fixture':'fixture',configured:()=>true,assess:async({title})=>{
  assert.ok(!titles.has(title));titles.add(title);const n=++calls;if(n>=4)release();await ready;
  if(n===20)await utimes(file,new Date(),new Date('2027-02-01T00:00:00Z'));
  if(n===45)await store.flush();
  if(n===50)await utimes(journalPath(file),new Date(),new Date('2027-02-02T00:00:00Z'));
  return {...answer,model:engine==='ollama'?'ollama:fixture':'fixture'};
 }});
 const review=createAIReview({store,provider:reviewRouter({store,openai:make('openai'),ollama:make('ollama')}),pages,index:noIndex,clock:()=>now});
 const ids=groupedCandidates(store.state).map(e=>e.id),job=await review.startJob({ids,manualAll:true,reuseSaved:true});await review.idle();await review.stop();await store.flush();
 const saved=await readStoredState(file),final=review.job(job.id);assert.equal(final.status,'complete');assert.equal(final.done,85);assert.equal(calls,85);assert.equal(titles.size,85);assert.equal(saved.ai.results.length,85);assert.equal(new Set(saved.ai.results.map(r=>r.id)).size,85);assert.equal(saved.ai.manualBatch.remainingIds.length,0);assert.ok(saved.ai.results.some(r=>r.engine==='openai'));assert.ok(saved.ai.results.some(r=>r.engine==='ollama'));
 assert.equal(saved.ai.usage['2026-11'].attempts+saved.ai.localUsage['2026-11'].attempts,85);assert.equal(saved.ai.usage['2026-11'].inputTokens+saved.ai.localUsage['2026-11'].inputTokens,85*11);assert.equal(saved.crm.records.keep.notes,'Keep');assert.equal(saved.manualExclusions[0].reason,'worked');assert.equal(store.lastPersistenceError,null);assert.ok(store.persistenceStats.checkpoints>=3);
});

test('shutdown aborts live AI even when stopping the source workspace fails',async t=>{
 let server,restore=()=>{};t.after(async()=>{restore();if(server?.listening)await shutdownApp(server);});const {store}=await fixture(t,1);let entered,aborted=false;const ready=new Promise(r=>entered=r);
 await store.update(d=>{d.ai.config=reviewConfig({engine:'openai',cloudConcurrency:1});});
 const api={model:'fixture',configured:()=>true,assess:async(_, {signal})=>{entered();await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason);},{once:true}));}};
 server=createApp({store,manual:true,aiProvider:api,aiPages:pages,socialProvider:noIndex,clock:()=>now});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 await server.aiReview.startJob({ids:groupedCandidates(store.state).map(e=>e.id),manualAll:true,reuseSaved:true});await ready;
 const stop=server.sourceWorkspace.stop;restore=()=>{server.sourceWorkspace.stop=stop;};server.sourceWorkspace.stop=async()=>{throw diskError();};
 await assert.rejects(shutdownApp(server),{code:'PERSISTENCE_ERROR'});assert.equal(aborted,true);assert.equal(server.aiReview.active(),null);restore();
});
