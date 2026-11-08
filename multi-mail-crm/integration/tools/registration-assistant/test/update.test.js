import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,existsSync,rmSync,cpSync,symlinkSync,lstatSync,renameSync,readlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import {createServer as createHttpServer} from 'node:http';
import {once} from 'node:events';
import {updateInstallation,unpackArchive,sha256,MANIFEST_URL,startServer,stopServer,installationSettings,inspectServer,synchronizeDirectory} from '../scripts/update.mjs';
import {openDatabase} from '../lib/database.js';
import {hashPassword} from '../lib/security.js';

function setup(t){
  const temp=mkdtempSync(join(tmpdir(),'assistant-update-')),target=join(temp,'помощник с пробелами');mkdirSync(target);
  writeFileSync(join(target,'package.json'),JSON.stringify({name:'registration-assistant',version:'0.2.0'}));writeFileSync(join(target,'server.js'),'old code');
  writeFileSync(join(target,'.env'),'DATA_DIR=records\nAI_API_KEY=synthetic-local-test-value\n');mkdirSync(join(target,'records'));writeFileSync(join(target,'records','state.sqlite'),'old database');
  mkdirSync(join(target,'node_modules'));writeFileSync(join(target,'node_modules','marker'),'old dependencies');writeFileSync(join(target,'personal-note.txt'),'operator local file');
  t.after(()=>rmSync(temp,{recursive:true,force:true}));return {temp,target};
}
async function release(files={}){
  const zip=new JSZip(),folder=zip.folder('registration-assistant');
  for(const [name,value] of Object.entries({'package.json':JSON.stringify({name:'registration-assistant',version:'0.2.1'}),'package-lock.json':'{}','server.js':'new code','public/new.js':'new page',...files}))folder.file(name,value);
  const archive=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}),manifest={project:'registration-assistant',version:'0.2.1',minimum_node:24,archive:'https://github.com/harpertristan/test/raw/refs/heads/registration-assistant/registration-assistant-0.2.1.zip',bytes:archive.length,sha256:sha256(archive)};
  const fetcher=async url=>new Response(url===MANIFEST_URL?JSON.stringify(manifest):archive,{status:200});return {archive,manifest,fetcher};
}
const install=async stage=>{mkdirSync(join(stage,'node_modules'));writeFileSync(join(stage,'node_modules','marker'),'new dependencies');};
const stoppedServer={inspect:async()=>false,stop:async()=>{},start:async()=>{}};
test('checked update preserves private data, settings and unknown files and retains a rollback backup',async t=>{
  const {target}=setup(t),source=await release();let verified=false;
  const result=await updateInstallation({target,fetcher:source.fetcher,install,verify:async()=>{assert.equal(readFileSync(join(target,'server.js'),'utf8'),'old code');verified=true;},server:stoppedServer,log:()=>{}});
  assert.equal(verified,true);assert.equal(result.version,'0.2.1');assert.equal(readFileSync(join(target,'server.js'),'utf8'),'new code');assert.equal(readFileSync(join(target,'node_modules','marker'),'utf8'),'new dependencies');
  assert.equal(readFileSync(join(target,'records','state.sqlite'),'utf8'),'old database');assert.match(readFileSync(join(target,'.env'),'utf8'),/synthetic-local-test-value/);assert.equal(readFileSync(join(target,'personal-note.txt'),'utf8'),'operator local file');
  assert.equal(readFileSync(join(result.backup,'data','state.sqlite'),'utf8'),'old database');assert.equal(readFileSync(join(result.backup,'node_modules','marker'),'utf8'),'old dependencies');
  assert.equal(existsSync(join(target,'.runtime','update-in-progress')),false);assert.equal(existsSync(join(target,'.runtime','update.lock')),false);
});
test('OneDrive-style dependency directory locks do not require any directory rename',async t=>{
  const {target}=setup(t),source=await release(),inode=lstatSync(join(target,'node_modules')).ino;let calls=0;
  const result=await updateInstallation({target,fetcher:source.fetcher,install,verify:async()=>{},server:stoppedServer,log:()=>{},renameFile:(from,to)=>{calls++;if(lstatSync(from).isDirectory())throw Object.assign(Error('OneDrive directory is locked'),{code:'EPERM'});renameSync(from,to);}});
  assert.equal(result.updated,true);assert.ok(calls>0);assert.equal(lstatSync(join(target,'node_modules')).ino,inode);assert.equal(readFileSync(join(target,'node_modules','marker'),'utf8'),'new dependencies');assert.equal(readFileSync(join(result.backup,'node_modules','marker'),'utf8'),'old dependencies');
});
test('dependency synchronization removes obsolete packages and preserves relative bin links',async t=>{
  const {temp}=setup(t),source=join(temp,'source'),destination=join(temp,'destination');mkdirSync(join(source,'.bin'),{recursive:true});mkdirSync(join(source,'package'));writeFileSync(join(source,'package','cli.js'),'new CLI');symlinkSync('../package/cli.js',join(source,'.bin','tool'));
  mkdirSync(join(destination,'obsolete'),{recursive:true});writeFileSync(join(destination,'obsolete','old.js'),'stale');
  await synchronizeDirectory(source,destination);assert.equal(existsSync(join(destination,'obsolete','old.js')),false);assert.equal(readlinkSync(join(destination,'.bin','tool')),'../package/cli.js');assert.equal(readFileSync(join(destination,'.bin','tool'),'utf8'),'new CLI');
});
test('a locked staging folder after success does not turn success into failure or leave the updater locked',async t=>{
  const {target}=setup(t),source=await release();
  const result=await updateInstallation({target,fetcher:source.fetcher,install,verify:async()=>{},server:stoppedServer,log:()=>{},cleanupStage:()=>{throw Object.assign(Error('OneDrive scan'),{code:'EPERM'});}});
  assert.equal(result.updated,true);assert.equal(existsSync(join(target,'.runtime','update.lock')),false);assert.equal(readFileSync(join(target,'node_modules','marker'),'utf8'),'new dependencies');
});
test('checksum failure and dependency failure leave old code and running service untouched',async t=>{
  const {target}=setup(t),source=await release();let stops=0;
  const server={inspect:async()=>true,stop:async()=>{stops++;},start:async()=>{}};
  source.manifest.sha256='0'.repeat(64);
  await assert.rejects(updateInstallation({target,fetcher:source.fetcher,install,verify:async()=>{},server,log:()=>{}}),/SHA-256/);
  source.manifest.sha256=sha256(source.archive);
  await assert.rejects(updateInstallation({target,fetcher:source.fetcher,install:async()=>{throw Error('npm failed');},verify:async()=>{},server,log:()=>{}}),/npm failed/);
  assert.equal(stops,0);assert.equal(readFileSync(join(target,'server.js'),'utf8'),'old code');assert.equal(readFileSync(join(target,'records','state.sqlite'),'utf8'),'old database');
});
test('failed application startup rolls back code, dependencies and database and restarts the old version',async t=>{
  const {target}=setup(t),source=await release();let running=true,stops=0;const starts=[];
  const server={inspect:async()=>running,stop:async()=>{running=false;stops++;},start:async(_target,_settings,version)=>{starts.push(version);if(version==='0.2.1'){writeFileSync(join(target,'records','state.sqlite'),'changed by migration');throw Error('new server failed');}running=true;}};
  await assert.rejects(updateInstallation({target,start:true,fetcher:source.fetcher,install,verify:async()=>{},server,log:()=>{}}),/new server failed/);
  assert.equal(stops,1);assert.deepEqual(starts,['0.2.1','0.2.0']);assert.equal(running,true);assert.equal(readFileSync(join(target,'server.js'),'utf8'),'old code');assert.equal(readFileSync(join(target,'node_modules','marker'),'utf8'),'old dependencies');assert.equal(readFileSync(join(target,'records','state.sqlite'),'utf8'),'old database');assert.equal(existsSync(join(target,'public','new.js')),false);
});
test('ZIP path traversal, settings replacement, symlinks, case collisions and corrupt CRC are rejected before extraction',async t=>{
  const temp=mkdtempSync(join(tmpdir(),'assistant-zip-'));t.after(()=>rmSync(temp,{recursive:true,force:true}));
  for(const bad of ['registration-assistant/../escape.txt','registration-assistant/.env','registration-assistant/data/state.sqlite','registration-assistant/file.txt:stream']){
    const zip=new JSZip();zip.file('registration-assistant/good.txt','good');zip.file(bad,'bad');const bytes=await zip.generateAsync({type:'nodebuffer'}),output=join(temp,String(readdirSync(temp).length));mkdirSync(output);assert.throws(()=>unpackArchive(bytes,output));assert.deepEqual(readdirSync(output),[]);
  }
  const links=new JSZip();links.file('registration-assistant/link','outside',{unixPermissions:0o120777});const linkBytes=await links.generateAsync({type:'nodebuffer',platform:'UNIX'});assert.throws(()=>unpackArchive(linkBytes,join(temp,'links')));
  const duplicate=new JSZip();duplicate.file('registration-assistant/Readme','a');duplicate.file('registration-assistant/README','b');
  const duplicateBytes=await duplicate.generateAsync({type:'nodebuffer'});assert.throws(()=>unpackArchive(duplicateBytes,join(temp,'duplicates')));
  const {archive}=await release(),broken=Buffer.from(archive);let central=broken.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));
  while(broken.subarray(central+46,central+46+broken.readUInt16LE(central+28)).toString().endsWith('/'))central+=46+broken.readUInt16LE(central+28)+broken.readUInt16LE(central+30)+broken.readUInt16LE(central+32);
  broken[central+16]^=1;assert.throws(()=>unpackArchive(broken,join(temp,'crc')));
});
test('custom data directories cannot be overwritten by release files and symlinked managed paths are refused',async t=>{
  const {target}=setup(t),source=await release({'records/injected':'bad'});
  await assert.rejects(updateInstallation({target,fetcher:source.fetcher,install,verify:async()=>{},server:stoppedServer,log:()=>{}}),/папку данных/);
  const outside=join(target,'outside');writeFileSync(outside,'original');symlinkSync(outside,join(target,'public'),'file');const safe=await release();
  await assert.rejects(updateInstallation({target,fetcher:safe.fetcher,install,verify:async()=>{},server:stoppedServer,log:()=>{}}),/ссылки/);assert.equal(readFileSync(outside,'utf8'),'original');
});
test('a legacy app or unrelated service on the port is never stopped or mistaken for a stopped app',async t=>{
  const {target}=setup(t);const service=createHttpServer((_req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('some other application');});service.listen(0,'127.0.0.1');await once(service,'listening');t.after(()=>new Promise(done=>service.close(done)));
  const port=service.address().port;writeFileSync(join(target,'.env'),`PORT=${port}\nDATA_DIR=records\n`);
  await assert.rejects(inspectServer(target,installationSettings(target)),/Ctrl\+C/);assert.equal((await fetch(`http://127.0.0.1:${port}/api/health`)).status,200);
});
test('real server can be identified and stopped gracefully with a private local control token', {timeout:30000},async t=>{
  const {target}=setup(t);rmSync(join(target,'node_modules'),{recursive:true});symlinkSync(resolve('node_modules'),join(target,'node_modules'),process.platform==='win32'?'junction':'dir');
  for(const name of ['server.js','lib','public'])cpSync(resolve(name),join(target,name),{recursive:true,force:true});const version=JSON.parse(readFileSync(resolve('package.json'),'utf8')).version;writeFileSync(join(target,'package.json'),JSON.stringify({name:'registration-assistant',type:'module',version}));
  rmSync(join(target,'records','state.sqlite'));const db=openDatabase(join(target,'records'));db.prepare('INSERT INTO users(username,password) VALUES(?,?)').run('test-user',hashPassword('synthetic-password-for-test'));db.close();
  const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(done=>reservation.close(done));
  writeFileSync(join(target,'.env'),`DATA_DIR=records\nPORT=${port}\nPUBLIC_ORIGIN=http://127.0.0.1:${port}\n`);
  const settings=installationSettings(target);let started=false;
  t.after(async()=>{if(started)try{await stopServer(target,installationSettings(target));}catch{}});
  await startServer(target,settings,version);started=true;const current=installationSettings(target);assert.equal(await inspectServer(target,current),true);
  const health=await (await fetch(current.base+'/api/health')).json();assert.equal(health.project,'registration-assistant');assert.equal(health.updateToken,undefined);
  const unauthorized=await fetch(current.base+'/internal/update-stop',{method:'POST',headers:{'X-Assistant-Update':'wrong'}});assert.equal(unauthorized.status,403);
  await stopServer(target,current);started=false;assert.equal(existsSync(join(target,'.runtime','instance.json')),false);
});
