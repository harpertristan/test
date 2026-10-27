import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,cp,writeFile,readFile,mkdir,symlink,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import http from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {initialState} from '../lib/store.js';
const source=fileURLToPath(new URL('..',import.meta.url));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function freePort(){const s=http.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
function run(root,script,env){const child=spawn(process.execPath,[join(root,'scripts',script)],{cwd:tmpdir(),env,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);const done=once(child,'exit').then(([code,signal])=>({code,signal,output}));return {child,done,get output(){return output;}};}
async function health(port){try{const r=await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(800)});return await r.json();}catch{return null;}}
test('desktop launcher handles Unicode/spaces, repeat launch, authenticated graceful stop and saved state', {timeout:30000}, async t=>{
 const root=await mkdtemp(join(tmpdir(),'Play Scout Юзер ')),children=[];
 t.after(async()=>{for(const p of children)if(p.exitCode===null)p.kill('SIGKILL');await rm(root,{recursive:true,force:true});});
 for(const name of ['lib','public','scripts','server.js','package.json'])await cp(join(source,name),join(root,name),{recursive:true});
 await symlink(join(source,'node_modules'),join(root,'node_modules'),process.platform==='win32'?'junction':'dir');
 const state=initialState();for(const part of [state,state.web,state.social,state.watch,state.apple])part.schedule.enabled=false;state.ai.config.enabled=false;
 state.findings.push({appId:'co.migration.demo',title:'Migration Test',released:'2026-10-26',firstFoundAt:'2026-10-27T10:00:00Z'});state.manualExclusions.push({key:'migration',kind:'domain',value:'old.example.eu',title:'Old Provider'});state.crm.records.demo={notes:'Переносим заметку без потерь.'};
 await mkdir(join(root,'data'));await writeFile(join(root,'data','state.json'),JSON.stringify(state));await writeFile(join(root,'.env'),"APP_PASSWORD='test desktop secret'\n");
 const port=await freePort(),env={...process.env,PORT:String(port),HOST:'127.0.0.1',DATA_DIR:join(root,'data'),PLAY_SCOUT_NO_BROWSER:'1',APP_PASSWORD:'test desktop secret',VIEW_PASSWORD:'',RENDER:'',BRAVE_SEARCH_API_KEY:'',OPENAI_API_KEY:'',GEMINI_API_KEY:''};
 const start=run(root,'start-desktop.js',env);children.push(start.child);
 let current;for(let n=0;n<80;n++){current=await health(port);if(current)break;assert.equal(start.child.exitCode,null,start.output);await pause(100);}
 assert.equal(current?.version,'4.0.0',start.output);assert.equal(current.status,'ok');
 const repeat=run(root,'start-desktop.js',env);children.push(repeat.child);assert.equal((await repeat.done).code,0);assert.match(repeat.output,/уже работает/);
 const denied=run(root,'stop-desktop.js',{...env,APP_PASSWORD:'wrong-password'});children.push(denied.child);assert.equal((await denied.done).code,1);assert.ok(await health(port));
 const stop=run(root,'stop-desktop.js',env);children.push(stop.child);const result=await stop.done;assert.equal(result.code,0,result.output);assert.match(result.output,/очереди сохранены/);assert.equal((await start.done).code,0,start.output);assert.equal(await health(port),null);
 const saved=JSON.parse(await readFile(join(root,'data','state.json'),'utf8'));assert.equal(saved.findings[0].appId,'co.migration.demo');assert.equal(saved.manualExclusions[0].value,'old.example.eu');assert.equal(saved.crm.records.demo.notes,state.crm.records.demo.notes);assert.equal(await readFile(join(root,'.env'),'utf8'),"APP_PASSWORD='test desktop secret'\n");
 const again=run(root,'stop-desktop.js',env);children.push(again.child);assert.equal((await again.done).code,0);assert.match(again.output,/уже остановлена/);
 const second=run(root,'start-desktop.js',env);children.push(second.child);for(let n=0;n<80&&!(await health(port));n++)await pause(100);assert.ok(await health(port));second.child.kill('SIGTERM');assert.equal((await second.done).code,0,second.output);
});
test('desktop launcher refuses old versions and occupied non-Scout ports', {timeout:10000},async t=>{
 for(const data of [{status:'ok',source:'Google Play',version:'3.1.0'},{other:true}]){
  const server=http.createServer((req,res)=>res.end(JSON.stringify(data)));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const child=run(source,'start-desktop.js',{...process.env,PORT:String(server.address().port),PLAY_SCOUT_NO_BROWSER:'1'});const result=await child.done;assert.equal(result.code,1,result.output);assert.match(result.output,data.version?/Работает версия 3\.1\.0/:/порт занят/);
 }
});
