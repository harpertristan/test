import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,copyFile,access,rm,symlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
import net from 'node:net';
import {updateInPlace,stopOwnedServer} from '../scripts/update-in-place.js';
const execute=promisify(execFile),read=path=>readFile(path,'utf8'),silent=()=>{};
async function setup(t){
 const root=await mkdtemp(join(tmpdir(),'Scout Mac Кириллица '));t.after(()=>rm(root,{recursive:true,force:true}));const source=join(root,'Новая версия'),target=join(root,'Рабочая папка');
 for(const dir of [source,target])await mkdir(dir);
 const file=async(dir,path,text)=>{await mkdir(join(dir,path,'..'),{recursive:true});await writeFile(join(dir,path),text);};
 for(const [path,text]of Object.entries({'package.json':JSON.stringify({name:'play-finance-finder',version:'4.0.1'}),'package-lock.json':'{}','server.js':'new server','lib/store.js':'new store','public/crm.html':'new UI','scripts/start-desktop.js':'new launcher','scripts/doctor.js':"console.log('doctor fixture OK')",'4-Обновить.command':'#!/bin/bash\nexit 0\n','.env':'DO_NOT_COPY=release-secret','data/state.json':'do not copy archive data'}))await file(source,path,text);
 for(const [path,text]of Object.entries({'package.json':JSON.stringify({name:'play-finance-finder',version:'3.1.2'}),'package-lock.json':'old lock','server.js':'old server','lib/store.js':'old store','.env':'BRAVE_SEARCH_API_KEY=private-key\nOPENAI_API_KEY=private-ai\n','data/state.json':'{"notes":"История и ручные исключения","cache":"сохранить"}','data/extra.json':'other data','.git/local':'git metadata','custom.txt':'local export'}))await file(target,path,text);
 return {root,source,target,file};
}
test('Mac update replaces code in place, backs up secrets/history and preserves unrelated local files',async t=>{
 const {source,target}=await setup(t),state=await read(join(target,'data/state.json')),env=await read(join(target,'.env'));let installs=0;
 const result=await updateInPlace(source,target,{stop:async()=>{},install:async dir=>{installs++;assert.equal(dir,target);assert.equal(JSON.parse(await read(join(dir,'package.json'))).version,'4.0.1');},diagnose:async()=>{},log:silent});
 assert.equal(installs,1);assert.equal(result.target,target);assert.equal(await read(join(target,'server.js')),'new server');assert.equal(await read(join(target,'data/state.json')),state);assert.equal(await read(join(target,'.env')),env);assert.equal(await read(join(target,'data/extra.json')),'other data');assert.equal(await read(join(target,'.git/local')),'git metadata');assert.equal(await read(join(target,'custom.txt')),'local export');
 assert.equal(await read(join(result.backup,'data/state.json')),state);assert.equal(await read(join(result.backup,'.env')),env);assert.equal(await read(join(result.backup,'code/server.js')),'old server');assert.match(await read(join(target,'.cache/install-lock')),/^[a-f0-9]{64}$/);await assert.rejects(access(join(target,'.cache/update.lock')));
});
test('failed dependency installation restores old code and leaves personal data byte-for-byte intact',async t=>{
 const {source,target,file}=await setup(t),state=await read(join(target,'data/state.json')),env=await read(join(target,'.env'));await file(target,'.cache/install-lock','old install marker');
 await assert.rejects(updateInPlace(source,target,{stop:async()=>{},install:async()=>{throw Error('npm unavailable');},diagnose:async()=>{throw Error('must not run');},log:silent}),/прежний код восстановлен/);
 assert.equal(await read(join(target,'server.js')),'old server');assert.equal(await read(join(target,'package-lock.json')),'old lock');await assert.rejects(access(join(target,'.cache/install-lock')));assert.equal(JSON.parse(await read(join(target,'package.json'))).version,'3.1.2');assert.equal(await read(join(target,'data/state.json')),state);assert.equal(await read(join(target,'.env')),env);await assert.rejects(access(join(target,'4-Обновить.command')));await assert.rejects(access(join(target,'.cache/update.lock')));
});
test('updater rejects downgrades and symlinked code paths before stopping or overwriting the target',async t=>{
 const {source,target,file,root}=await setup(t);let stopped=0;const options={stop:async()=>{stopped++;},install:async()=>{},diagnose:async()=>{},log:silent};
 await file(source,'package.json',JSON.stringify({name:'play-finance-finder',version:'3.0.0'}));await assert.rejects(updateInPlace(source,target,options),/старее/);assert.equal(stopped,0);
 await file(source,'package.json',JSON.stringify({name:'play-finance-finder',version:'4.0.1'}));await rm(join(target,'lib'),{recursive:true});await mkdir(join(root,'External'));await symlink(join(root,'External'),join(target,'lib'),'dir');await assert.rejects(updateInPlace(source,target,options),/Нестандартный путь/);assert.equal(stopped,0);assert.equal(await read(join(target,'server.js')),'old server');
});
test('updater backs up an explicit DATA_DIR and blocks simultaneous updates',async t=>{
 const {source,target,file}=await setup(t);await file(target,'.env','DATA_DIR=./vault\n');await file(target,'vault/state.json','custom data');let unblock,started;const gate=new Promise(r=>unblock=r),ready=new Promise(r=>started=r);
 const first=updateInPlace(source,target,{stop:async()=>{},install:async()=>{started();await gate;},diagnose:async()=>{},log:silent});await ready;
 await assert.rejects(updateInPlace(source,target,{stop:async()=>{},install:async()=>{},diagnose:async()=>{},log:silent}),/Обновление уже/);unblock();const result=await first;assert.equal(await read(join(result.backup,'data/state.json')),'custom data');assert.equal(await read(join(target,'vault/state.json')),'custom data');
});
test('updater stops only the Node server from its own folder and waits for its checkpoint', {timeout:15000},async t=>{
 const {target,file}=await setup(t);await file(target,'server.js',`const http=require('http'),fs=require('fs');const s=http.createServer((q,r)=>r.end('ok'));s.listen(0,'127.0.0.1',()=>console.log(s.address().port));process.on('SIGTERM',()=>{fs.writeFileSync('saved.txt','checkpoint');s.close(()=>process.exit(0));});`);
 const child=spawn(process.execPath,['server.js'],{cwd:target,stdio:['ignore','pipe','pipe']});t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});let output='';const port=await new Promise((accept,reject)=>{child.stdout.on('data',b=>{output+=b;if(output.includes('\n'))accept(Number(output.trim()));});child.once('error',reject);child.once('exit',code=>reject(Error('Early server exit '+code)));});const done=once(child,'exit');
 await stopOwnedServer(await import('node:fs/promises').then(fs=>fs.realpath(target)),port,{log:silent});assert.equal((await done)[0],0);assert.equal(await read(join(target,'saved.txt')),'checkpoint');
 const other=net.createServer();await new Promise(r=>other.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>other.close(r)));await assert.rejects(stopOwnedServer(target,other.address().port,{log:silent}),/другой экземпляр/);assert.ok(other.listening);
});
test('Mac bootstrap shell updates a folder with spaces without network, relocation or secret changes',async t=>{
 const {root,source,target}=await setup(t),bin=join(root,'bin');await mkdir(bin);await writeFile(join(bin,'npm'),'#!/bin/bash\nprintf installed > install-fixture.txt\n',{mode:0o755});await copyFile(resolve('scripts/update-in-place.js'),join(source,'scripts/update-in-place.js'));
 const state=await read(join(target,'data/state.json')),env=await read(join(target,'.env'));
 const result=await execute('bash',[resolve('scripts/update-mac.sh'),target,'--source',source],{env:{...process.env,PATH:bin+':'+process.env.PATH},timeout:15000});assert.match(result.stdout,/Play Scout 4\.0\.1/);assert.equal(await read(join(target,'install-fixture.txt')),'installed');assert.equal(await read(join(target,'data/state.json')),state);assert.equal(await read(join(target,'.env')),env);
});
