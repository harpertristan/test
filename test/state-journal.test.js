import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,appendFile,stat,mkdir,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {StateStore,readStoredState,loadStoredState,journalPath,projectionIdentity} from '../lib/state-journal.js';
import {openStore} from '../lib/store.js';
import {exportProfile,importProfile,unsealProfile} from '../lib/profile-transfer.js';

async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'scout-journal-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=join(dir,'state.json'),store=await openStore(file);return{dir,file,store};}
const unsigned=r=>JSON.stringify({format:r.format,id:r.id,seq:r.seq,prev:r.prev,patches:r.patches});
const rehash=r=>({...r,hash:createHash('sha256').update(unsigned(r)).digest('hex')});
async function records(file){return (await readFile(journalPath(file),'utf8')).trim().split('\n').map(JSON.parse);}
const decisions=d=>{d.crm.records.keep={notes:'Сохранить комментарий',status:'selected'};d.manualExclusions.push({key:'worked',kind:'domain',value:'worked.eu',reason:'worked'});d.ai.results.push({id:'company:ready.eu',facts:{businessAccount:'yes'}});d.ai.manualBatch={id:'batch',candidateIds:['company:ready.eu','company:next.eu'],remainingIds:['company:next.eu']};d.braveUsage['2026-11']=9;};

test('acknowledged journal transactions recover results, notes, worked exclusions, usage and remaining queue without a checkpoint',async t=>{
 const {file,store}=await fixture(t);const before=await readFile(file);await store.update(decisions);
 assert.deepEqual(await readFile(file),before);assert.equal(store.persistenceStats.transactions,1);assert.deepEqual(await readStoredState(file),store.state);
 const again=await openStore(file);assert.deepEqual(again.state.crm.records.keep,store.state.crm.records.keep);assert.deepEqual(again.state.ai.manualBatch.remainingIds,['company:next.eu']);assert.equal(again.state.braveUsage['2026-11'],9);
 assert.equal((await stat(file)).mode&0o777,0o600);assert.equal((await stat(journalPath(file))).mode&0o777,0o600);
});

test('parallel updates remain FIFO; no-op commits do not write or copy unchanged histories',async t=>{
 const {file,store}=await fixture(t);await store.update(d=>{d.payload={text:'x'.repeat(4*1024*1024)};d.braveUsage['2026-11']=0;});await store.flush();
 const retained=store.state.payload,identity=projectionIdentity(store.state),bytes=store.persistenceStats.bytesWritten;
 await Promise.all(Array.from({length:25},()=>store.update(d=>{d.braveUsage['2026-11']++;})));
 assert.equal(store.state.braveUsage['2026-11'],25);assert.equal(store.state.payload,retained);assert.equal(projectionIdentity(store.state),identity);
 const stable=store.persistenceStats.bytesWritten,root=store.state;await store.update(()=>{});assert.equal(store.persistenceStats.bytesWritten,stable);assert.equal(store.state,root);
 await store.flush();assert.ok(store.persistenceStats.bytesWritten-bytes<4*1024*1024*1.1);assert.equal((await readStoredState(file)).braveUsage['2026-11'],25);assert.equal((await stat(journalPath(file))).size,0);
});

test('an unfinished final record is ignored, then truncated before the next durable append',async t=>{
 const {file,store}=await fixture(t);await store.update(d=>{d.braveUsage['2026-11']=1;});const good=await readFile(journalPath(file));await appendFile(journalPath(file),'{"format":"unfinished');
 assert.equal((await readStoredState(file)).braveUsage['2026-11'],1);const restored=await openStore(file);await restored.update(d=>{d.braveUsage['2026-11']++;});assert.equal((await readStoredState(file)).braveUsage['2026-11'],2);assert.ok((await readFile(journalPath(file))).subarray(0,good.length).equals(good));
});

test('complete corrupt records, missing transactions, wrong generation and prototype patches reject without resetting files',async t=>{
 const {file,store}=await fixture(t);await store.update(d=>{d.braveUsage['2026-11']=1;});await store.update(d=>{d.braveUsage['2026-11']=2;});const snapshot=await readFile(file),saved=await readFile(journalPath(file)),original=await records(file);
 for(const change of [r=>{r[0].hash='0'.repeat(64);},r=>{r.shift();},r=>{r[0]=rehash({...r[0],id:'other'});},r=>{r[0]=rehash({...r[0],patches:[{op:'add',path:'/__proto__/polluted',value:true}]});r.length=1;}]){
  const rs=structuredClone(original);change(rs);const bad=rs.map(r=>JSON.stringify(r)+'\n').join('');await writeFile(journalPath(file),bad);await assert.rejects(openStore(file),{code:'STATE_JOURNAL_INVALID'});assert.deepEqual(await readFile(file),snapshot);assert.equal(await readFile(journalPath(file),'utf8'),bad);assert.equal({}.polluted,undefined);
 }
 await writeFile(journalPath(file),saved);
 await rm(file);await assert.rejects(openStore(file),{code:'STATE_JOURNAL_INVALID'});assert.deepEqual(await readFile(journalPath(file)),saved);
});

test('a checkpoint left alongside its old journal prefix does not replay the prefix twice',async t=>{
 const {file,store}=await fixture(t);await store.update(decisions);const prefix=await readFile(journalPath(file));await store.flush();await writeFile(journalPath(file),prefix);
 const recovered=await openStore(file);assert.equal(recovered.state.manualExclusions.length,1);assert.equal(recovered.state.ai.results.length,1);await recovered.update(d=>{d.braveUsage['2026-11']++;});assert.equal((await readStoredState(file)).braveUsage['2026-11'],10);await recovered.flush();assert.equal((await stat(journalPath(file))).size,0);
});

test('callback and append failures never publish an unsaved state and later transactions remain usable',async t=>{
 const {file,store}=await fixture(t),before=store.state;
 await assert.rejects(store.update(d=>{d.braveUsage['2026-11']=1;throw Error('callback failed');}),/callback failed/);assert.equal(store.state,before);
 await mkdir(journalPath(file));await assert.rejects(store.update(d=>{d.braveUsage['2026-11']=2;}),{code:'PERSISTENCE_ERROR'});assert.equal(store.state,before);await rm(journalPath(file),{recursive:true});await store.update(d=>{d.braveUsage['2026-11']=3;});assert.equal((await readStoredState(file)).braveUsage['2026-11'],3);
});

test('checkpoint failure after an acknowledged append keeps its queue and can be retried',async t=>{
 const {file,store}=await fixture(t);store.lastCheckpointAt=0;const save=store._atomicSnapshot.bind(store);store._atomicSnapshot=async()=>{throw Error('disk full');};
 await store.update(d=>{decisions(d);d.payload='x'.repeat(4*1024*1024);});assert.match(store.persistenceStats.lastCheckpointError,/журнале/);assert.equal((await readStoredState(file)).ai.manualBatch.remainingIds[0],'company:next.eu');
 await assert.rejects(store.flush(),{code:'PERSISTENCE_ERROR'});assert.equal((await readStoredState(file)).crm.records.keep.notes,'Сохранить комментарий');store._atomicSnapshot=save;await store.flush();assert.equal(store.persistenceStats.lastCheckpointError,null);assert.equal((await stat(journalPath(file))).size,0);
});

test('JSON optional values, dates and escaped paths replay with the same representation as the snapshot',async t=>{
 const {file,store}=await fixture(t);await store.update(d=>{d.fixture={optional:undefined,date:new Date('2026-11-02T00:00:00Z'),number:NaN,array:[undefined,,Infinity],nested:{'a/b~c':1}};});await store.update(d=>{d.fixture.nested['a/b~c']=2;d.fixture.optional='set';});
 assert.deepEqual(await readStoredState(file),store.state);assert.deepEqual(store.state.fixture.array,[null,null,null]);assert.equal(store.state.fixture.date,'2026-11-02T00:00:00.000Z');assert.equal(store.state.fixture.number,null);
 const old=store.state;await assert.rejects(store.update(d=>{d.fixture.self=d.fixture;}),/Circular/);assert.equal(store.state,old);
});

test('transaction backup materializes the journal and remains a private standalone snapshot',async t=>{
 const {dir,file,store}=await fixture(t);await store.update(decisions);let name;await store.update((d,context)=>{name=context.backupFile;d.crm.records.keep.notes='new note';},{backup:'before-change'});const backup=join(dir,name),saved=JSON.parse(await readFile(backup,'utf8'));
 assert.equal(saved.crm.records.keep.notes,'Сохранить комментарий');assert.equal(saved.__playScoutStorage,undefined);assert.equal((await stat(backup)).mode&0o777,0o600);assert.equal((await readStoredState(file)).crm.records.keep.notes,'new note');
});

test('two writers cannot overwrite a newer committed snapshot or journal, including simultaneous creation',async t=>{
 const {file,store}=await fixture(t),other=await openStore(file);const values=await Promise.allSettled([store.update(d=>{d.braveUsage['2026-11']=1;}),other.update(d=>{d.braveUsage['2026-11']=2;})]);assert.equal(values.filter(v=>v.status==='fulfilled').length,1);assert.equal(values.filter(v=>v.reason?.code==='PERSISTENCE_ERROR').length,1);assert.ok([1,2].includes((await readStoredState(file)).braveUsage['2026-11']));
 const empty=join(await mkdtemp(join(tmpdir(),'scout-new-writers-')),'state.json');t.after(()=>rm(join(empty,'..'),{recursive:true,force:true}));const a=new StateStore(empty,{count:0}),b=new StateStore(empty,{count:0});const created=await Promise.allSettled([a.update(d=>{d.count=1;}),b.update(d=>{d.count=2;})]);assert.equal(created.filter(r=>r.status==='fulfilled').length,1);assert.ok([1,2].includes((await readStoredState(empty)).count));
});

test('SIGKILL after an acknowledged commit recovers results and the remaining queue',async t=>{
 const {file}=await fixture(t),moduleURL=new URL('../lib/store.js',import.meta.url).href;
 const script=`import {openStore} from ${JSON.stringify(moduleURL)}; const store=await openStore(process.argv[1]); await store.update(${decisions.toString()}); process.send('durable'); setInterval(()=>{},1000);`;
 const child=spawn(process.execPath,['--disallow-code-generation-from-strings','--input-type=module','-e',script,file],{stdio:['ignore','pipe','pipe','ipc']});t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});let stderr='';child.stderr.on('data',b=>stderr+=b);const outcome=await Promise.race([once(child,'message').then(([m])=>m),once(child,'exit').then(()=>{throw Error(stderr);})]);assert.equal(outcome,'durable');const exited=once(child,'exit');child.kill('SIGKILL');await exited;
 const data=await readStoredState(file);assert.equal(data.crm.records.keep.notes,'Сохранить комментарий');assert.deepEqual(data.ai.manualBatch.remainingIds,['company:next.eu']);assert.equal(data.ai.results.length,1);assert.equal(data.braveUsage['2026-11'],9);
});

test('encrypted export includes uncheckpointed changes without changing the donor, and restores without a sidecar',async t=>{
 const {dir,file,store}=await fixture(t),source=join(dir,'Source'),target=join(dir,'Target');await mkdir(source);await mkdir(target);await mkdir(join(source,'data'));for(const root of[source,target])await writeFile(join(root,'package.json'),JSON.stringify({name:'play-finance-finder',version:'4.6.2'}));
 await store.update(decisions);await writeFile(join(source,'data/state.json'),await readFile(file));await writeFile(join(source,'data/state.json.journal'),await readFile(journalPath(file)));const before=await readFile(join(source,'data/state.json.journal')),bundle=join(dir,'private.psbackup'),password='test password 123456';
 await exportProfile(source,bundle,password,{checkStopped:async()=>{}});const payload=await unsealProfile(await readFile(bundle),password);assert.ok(!payload.files.some(f=>f.path.endsWith('.journal')));await importProfile(target,bundle,password,{checkStopped:async()=>{}});const restored=await openStore(join(target,'data/state.json'));assert.equal(restored.state.crm.records.keep.notes,'Сохранить комментарий');assert.deepEqual(restored.state.ai.manualBatch.remainingIds,['company:next.eu']);assert.deepEqual(await readFile(join(source,'data/state.json.journal')),before);
});

test('doctor and diagnostic open read journal changes without writing or recovering jobs on disk',async t=>{
 const {dir,file,store}=await fixture(t);await store.update(d=>{decisions(d);d.jobs.push({id:'interrupted-job',status:'running',config:d.schedule.filters,results:[],errors:[]});});const snapshot=await readFile(file),journal=await readFile(journalPath(file));
 const readOnly=await openStore(file,new Date(),{readOnly:true});await readOnly.update(d=>{d.crm.records.keep.notes='memory only';});await readOnly.flush();assert.deepEqual(await readFile(file),snapshot);assert.deepEqual(await readFile(journalPath(file)),journal);
 const child=spawn(process.execPath,['scripts/doctor.js'],{cwd:resolve('.'),env:{...process.env,DATA_DIR:dir},stdio:['ignore','pipe','pipe']});let out='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>out+=b);const [code]=await once(child,'exit');assert.equal(code,0,out);assert.match(out,/Play Scout 4.6.2/);assert.deepEqual(await readFile(file),snapshot);assert.deepEqual(await readFile(journalPath(file)),journal);assert.equal((await readStoredState(file)).jobs[0].status,'running');
});
