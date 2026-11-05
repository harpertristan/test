import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm,cp,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import http from 'node:http';
import {memoryStore,openStore} from '../lib/store.js';
import {readStoredState} from '../lib/state-journal.js';
import {braveProvider} from '../lib/brave-provider.js';
import {SEARCH_CHANNELS} from '../lib/source-workspace-catalog.js';
import {createApp,shutdownApp} from '../server.js';
const root=fileURLToPath(new URL('..',import.meta.url)),version=JSON.parse(await readFile(join(root,'package.json'),'utf8')).version;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function due(state){
 for(const s of[state,state.web,state.social,state.watch]){s.schedule.enabled=true;s.schedule.nextRunAt='2000-01-01T00:00:00Z';}
 Object.assign(state.ai.config,{enabled:true,collectSources:true,time:'00:00',engine:'hybrid',ollamaModel:'qwen2.5:7b'});state.sourceWorkspace={settings:Object.fromEntries(SEARCH_CHANNELS.map(c=>[c.id,{enabled:true,time:'00:00',analyse:true}])),runs:[]};
}
const settings=s=>({schedule:[s,s.web,s.social,s.watch].map(x=>structuredClone(x.schedule)),ai:structuredClone(s.ai.config),channels:structuredClone(s.sourceWorkspace.settings)});
function launch(folder,args,env){const child=spawn(process.execPath,[join(folder,'scripts/start-desktop.js'),...args],{cwd:tmpdir(),env,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);return{child,done:once(child,'exit').then(([code,signal])=>({code,signal,output})),get output(){return output;}};}

test('manual mode suppresses all due schedules while explicit Brave check works once; viewers and CSRF remain blocked',async t=>{
 const store=memoryStore(),calls={play:0,page:0,cloud:0,local:0,brave:0};due(store.state);store.state.braveUsage['2026-11']=4;const before=settings(store.state);
 const fail=key=>async()=>{calls[key]++;throw Error('Unexpected automatic request');};
 const brave=braveProvider({key:'synthetic-test-key',minInterval:0,request:async()=>{calls.brave++;return{type:'search',web:{results:[]}};}});
 const server=createApp({store,manual:true,autoSchedule:true,tickInterval:10,clock:()=>new Date('2026-11-02T12:00:00Z'),password:'owner',viewerPassword:'reader',socialProvider:brave,provider:{search:fail('play'),app:fail('play')},aiPages:{page:fail('page')},aiProvider:{configured:()=>true,model:'gpt-test',assess:fail('cloud')},localAIProvider:{configured:()=>true,model:'ollama:test',assess:fail('local')}});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await shutdownApp(server);});const base='http://127.0.0.1:'+server.address().port,headers=user=>({Authorization:'Basic '+Buffer.from(user).toString('base64'),'Content-Type':'application/json'});
 await pause(100);assert.deepEqual(calls,{play:0,page:0,cloud:0,local:0,brave:0});assert.deepEqual(settings(store.state),before);
 const health=await(await fetch(base+'/api/health')).json();assert.equal(health.manual,true);assert.equal(health.diagnostic,false);const crm=await(await fetch(base+'/api/crm',{headers:headers('admin:owner')})).json();assert.deepEqual(crm.runtime,{diagnostic:false,manual:true});assert.equal(crm.access.canEdit,true);
 assert.equal((await fetch(base+'/api/connections/brave/test',{method:'POST',headers:headers('viewer:reader')})).status,403);assert.equal((await fetch(base+'/api/connections/brave/test',{method:'POST',headers:{...headers('admin:owner'),'sec-fetch-site':'cross-site'}})).status,403);assert.equal(calls.brave,0);
 const response=await fetch(base+'/api/connections/brave/test',{method:'POST',headers:headers('admin:owner')});assert.equal(response.status,200);assert.equal((await response.json()).requests,1);assert.deepEqual(calls,{play:0,page:0,cloud:0,local:0,brave:1});assert.equal(store.state.braveUsage['2026-11'],5);assert.ok(store.state.connections.brave.verifiedAt);assert.deepEqual(settings(store.state),before);
});

test('desktop manual CLI starts locally without running saved due schedules, preserves worked data and supports graceful stop',{timeout:25000},async t=>{
 const dir=await mkdtemp(join(tmpdir(),'Scout manual Юзер ')),children=[];t.after(async()=>{for(const p of children)if(p.exitCode===null&&p.signalCode===null){const ended=once(p,'exit');p.kill('SIGTERM');await Promise.race([ended,pause(3000)]);if(p.exitCode===null&&p.signalCode===null)p.kill('SIGKILL');}await rm(dir,{recursive:true,force:true});});for(const name of['lib','public','scripts','server.js','package.json'])await cp(join(root,name),join(dir,name),{recursive:true});await symlink(join(root,'node_modules'),join(dir,'node_modules'),process.platform==='win32'?'junction':'dir');
 const file=join(dir,'data/state.json'),store=await openStore(file);await store.update(d=>{due(d);d.crm.records['company:worked.example.eu']={notes:'Keep worked note',status:'selected',exclusionReason:'worked',title:'Worked example'};d.manualExclusions.push({key:'worked',kind:'domain',value:'worked.example.eu',reason:'worked'});d.braveUsage['2026-11']=4;});const before=settings(store.state);
 const probe=http.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));const env={...process.env,PORT:String(port),DATA_DIR:join(dir,'data'),HOST:'0.0.0.0',PLAY_SCOUT_NO_BROWSER:'1',APP_PASSWORD:'',VIEW_PASSWORD:'',RENDER:'',BRAVE_SEARCH_API_KEY:'',OPENAI_API_KEY:'',GEMINI_API_KEY:''},start=launch(dir,['--manual'],env);children.push(start.child);let health;
 for(let i=0;i<80;i++){try{health=await(await fetch('http://127.0.0.1:'+port+'/api/health')).json();break;}catch{}assert.equal(start.child.exitCode,null,start.output);await pause(100);}assert.equal(health?.version,version,start.output);assert.equal(health.manual,true);assert.equal(health.diagnostic,false);const base='http://127.0.0.1:'+port;
 const crm=await(await fetch(base+'/api/crm')).json();assert.equal(crm.runtime.manual,true);assert.equal(crm.access.canEdit,true);assert.ok(crm.rows.some(r=>r.worked||r.exclusionReason==='worked'));const repeat=launch(dir,['--manual'],env);children.push(repeat.child);assert.equal((await repeat.done).code,0);for(const args of[[],['--diagnostic']]){const denied=launch(dir,args,env);children.push(denied.child);const result=await denied.done;assert.equal(result.code,1,result.output);assert.match(result.output,/другой режим/);}
 start.child.kill('SIGTERM');assert.equal((await start.done).code,0,start.output);const saved=await readStoredState(file);assert.deepEqual(settings(saved),before);for(const s of[saved,saved.web,saved.social,saved.watch])assert.equal(s.jobs.length,0);assert.equal(saved.ai.jobs.length,0);assert.equal(saved.sourceWorkspace.runs.length,0);assert.equal(saved.crm.records['company:worked.example.eu'].notes,'Keep worked note');assert.equal(saved.braveUsage['2026-11'],4);
});

test('launcher refuses conflicting modes before startup and cannot silently reuse an automatic instance',{timeout:10000},async t=>{
 const env={...process.env,PLAY_SCOUT_NO_BROWSER:'1'};const both=launch(root,['--manual','--diagnostic'],env);const result=await both.done;assert.equal(result.code,1);assert.match(result.output,/один режим/);
 const server=http.createServer((q,r)=>r.end(JSON.stringify({status:'ok',source:'Google Play',version,diagnostic:false})));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const manual=launch(root,['--manual'],{...env,PORT:String(server.address().port)});const denied=await manual.done;assert.equal(denied.code,1,denied.output);assert.match(denied.output,/другой режим/);
});

test('manual Brave check distinguishes key/access/quota/timeout errors without returning provider secrets',async t=>{
 let failure={status:401};const store=memoryStore(),provider={configured:()=>true,search:async()=>{throw Object.assign(new Error('secret-token-private-provider-body'),failure);}};const server=createApp({store,manual:true,autoSchedule:true,socialProvider:provider});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>shutdownApp(server));const url='http://127.0.0.1:'+server.address().port+'/api/connections/brave/test';
 for(const [error,code]of[[{status:401},'AUTH_REQUIRED'],[{status:403},'ACCESS_DENIED'],[{status:429},'RATE_LIMIT'],[{code:'API_TIMEOUT'},'TIMEOUT']]){failure=error;const response=await fetch(url,{method:'POST'});assert.equal(response.status,502);const body=await response.json();assert.equal(body.code,code);assert.ok(!JSON.stringify(body).includes('secret-token'));if(error.status){assert.equal(body.providerStatus,error.status);assert.ok(body.error.includes('HTTP '+error.status));}}
 assert.equal(store.state.connections?.brave,undefined);
});
