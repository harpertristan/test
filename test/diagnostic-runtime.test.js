import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,cp,symlink,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import http from 'node:http';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {memoryStore,openStore} from '../lib/store.js';
import {createApp,shutdownApp} from '../server.js';
import {SEARCH_CHANNELS} from '../lib/source-workspace-catalog.js';
const root=fileURLToPath(new URL('..',import.meta.url)),pause=ms=>new Promise(r=>setTimeout(r,ms));
const version=JSON.parse(await readFile(join(root,'package.json'),'utf8')).version;
const post=(base,path)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});

test('diagnostic mode ignores due schedules, blocks all mutations and external checks, while allowing saved lists and exports',async t=>{
 const now=new Date('2026-11-02T12:00:00Z'),store=memoryStore(now);let calls=0;
 const external=async()=>{calls++;throw Error('External requests must be disabled');},provider={model:'test',configured:()=>true,search:external,app:external,page:external,feed:external,analyze:external,status:external};
 for(const section of[store.state,store.state.web,store.state.social,store.state.watch]){section.schedule.enabled=true;section.schedule.nextRunAt='2026-11-01T00:00:00Z';}
 store.state.ai.config.enabled=true;store.state.ai.config.collectSources=true;store.state.ai.config.time='00:00';store.state.sourceWorkspace={settings:Object.fromEntries(SEARCH_CHANNELS.map(c=>[c.id,{enabled:true,time:'00:00',analyzeAfter:true}])),runs:[]};const before=structuredClone(store.state);
 const server=createApp({store,diagnostic:true,autoSchedule:true,clock:()=>now,tickInterval:10,provider,socialProvider:provider,aiProvider:provider,localAIProvider:provider,cloudGeminiProvider:provider,watchProvider:provider,aiPages:provider});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.listening?shutdownApp(server):undefined);const base='http://127.0.0.1:'+server.address().port;
 await pause(80);assert.equal(calls,0);assert.equal((await(await fetch(base+'/api/health')).json()).diagnostic,true);assert.equal((await(await fetch(base+'/api/access')).json()).canEdit,false);
 const crm=await(await fetch(base+'/api/crm')).json();assert.deepEqual(crm.runtime,{diagnostic:true});assert.equal(crm.access.canEdit,false);assert.equal((await fetch(base+'/api/crm/chat.json')).status,200);assert.equal((await fetch(base+'/crm')).status,200);
 for(const path of['/api/search','/api/sources/start','/api/crm/manual/start','/api/crm/update','/api/crm/reset-review','/api/ai/config','/api/ai/cloud/test','/api/ai/local/test','/api/connections/brave/test','/api/monitoring/enable']){const r=await post(base,path);assert.equal(r.status,503,path);assert.match((await r.json()).error,/Диагностический режим/);}
 assert.equal(calls,0);assert.deepEqual(store.state,before);const requested=once(server,'shutdown-requested');assert.equal((await post(base,'/api/system/shutdown')).status,202);await requested;
});

test('shutdown rejects new work and keeps its port open until the final snapshot is durable',async t=>{
 const store=memoryStore();let release,started;const flushStarted=new Promise(r=>started=r),flushed=new Promise(r=>release=r);store.flush=async()=>{started();await flushed;};
 const server=createApp({store,socialProvider:{configured:()=>false}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;const partial=net.connect(server.address().port,'127.0.0.1');partial.on('error',()=>{});await once(partial,'connect');partial.write('POST /api/crm/update HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 999\r\n\r\n{');await pause(10);const disconnected=new Promise(resolve=>partial.once('close',resolve));let done=false;const stopped=shutdownApp(server).then(()=>{done=true;});t.after(async()=>{release();await stopped;});await flushStarted;await disconnected;
 assert.equal(server.listening,true);assert.equal(done,false);assert.equal((await fetch(base+'/api/health')).status,200);assert.equal((await post(base,'/api/search')).status,503);release();await stopped;assert.equal(server.listening,false);
});

test('desktop diagnostic CLI preserves snapshot and journal bytes and refuses to silently switch into normal mode',{timeout:25000},async t=>{
 const dir=await mkdtemp(join(tmpdir(),'Scout diagnostic Юзер '));const children=[];t.after(async()=>{for(const child of children)if(child.exitCode===null)child.kill('SIGKILL');await rm(dir,{recursive:true,force:true});});for(const name of['lib','public','scripts','server.js','package.json'])await cp(join(root,name),join(dir,name),{recursive:true});await symlink(join(root,'node_modules'),join(dir,'node_modules'),process.platform==='win32'?'junction':'dir');
 const file=join(dir,'data/state.json'),store=await openStore(file);await store.update(d=>{d.crm.records.demo={notes:'Keep on disk'};for(const section of[d,d.web,d.social,d.watch]){section.schedule.enabled=true;section.schedule.nextRunAt='2026-11-01T00:00:00Z';}d.ai.config.enabled=true;d.ai.config.time='00:00';d.braveUsage['2026-11']=3;});const snapshot=await readFile(file),journal=await readFile(file+'.journal');
 const probe=http.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));const env={...process.env,PORT:String(port),DATA_DIR:join(dir,'data'),HOST:'0.0.0.0',PLAY_SCOUT_NO_BROWSER:'1',APP_PASSWORD:'',VIEW_PASSWORD:'',RENDER:''};
 const launch=(args=[])=>{const child=spawn(process.execPath,[join(dir,'scripts/start-desktop.js'),...args],{cwd:dir,env,stdio:['ignore','pipe','pipe']});children.push(child);let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);return{child,done:once(child,'exit').then(([code])=>({code,output})),get output(){return output;}};};
 const diagnostic=launch(['--diagnostic']);let health;for(let i=0;i<80;i++){try{health=await(await fetch('http://127.0.0.1:'+port+'/api/health')).json();break;}catch{}assert.equal(diagnostic.child.exitCode,null,diagnostic.output);await pause(100);}assert.equal(health?.version,version,diagnostic.output);assert.equal(health.diagnostic,true);
 const normal=launch();const denied=await normal.done;assert.equal(denied.code,1,denied.output);assert.match(denied.output,/другой режим/);assert.equal((await post('http://127.0.0.1:'+port,'/api/crm/manual/start')).status,503);diagnostic.child.kill('SIGTERM');assert.equal((await diagnostic.done).code,0,diagnostic.output);assert.deepEqual(await readFile(file),snapshot);assert.deepEqual(await readFile(file+'.journal'),journal);
});
