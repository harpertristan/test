// Full upgrade rehearsal: real old ZIP, real npm install, real new server.
// Only synthetic user records and documents are created.
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {openDatabase} from '../lib/database.js';
import {hashPassword} from '../lib/security.js';
import {unpackArchive,updateInstallation,MANIFEST_URL,sha256,stopServer,installationSettings,verifyStage} from './update.mjs';
import JSZip from 'jszip';

const directory=mkdtempSync(join(tmpdir(),'assistant-upgrade-e2e-')),target=join(directory,'assistant with spaces');mkdirSync(target);
const source=readFileSync(resolve('registration-assistant-0.2.0.zip')),archive=readFileSync(resolve('registration-assistant-0.2.1.zip'));unpackArchive(source,target);
const version=JSON.parse(readFileSync(resolve('package.json'),'utf8')).version;
const listener=createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const port=listener.address().port;await new Promise(done=>listener.close(done));
const env=`PORT=${port}\nDATA_DIR=records\nPUBLIC_ORIGIN=http://127.0.0.1:${port}\nAI_API_KEY=synthetic-test-value\n`;
writeFileSync(join(target,'.env'),env,{mode:0o600});mkdirSync(join(target,'node_modules'));writeFileSync(join(target,'node_modules','old-marker'),'previous dependencies');writeFileSync(join(target,'operator-note.txt'),'keep this local file');
const db=openDatabase(join(target,'records'));db.prepare('INSERT INTO users VALUES(1,?,?)').run('upgrade-test',hashPassword('synthetic-upgrade-password'));db.prepare('INSERT INTO companies VALUES(?,?,?)').run('example-company',1,'Example Limited');
db.prepare('INSERT INTO documents VALUES(?,?,?,?,?)').run('example-document','example-company','operator note',JSON.stringify([{page:1,text:'Company name: Example Limited'}]),'note');db.close();
mkdirSync(join(target,'records','uploads'));writeFileSync(join(target,'records','uploads','original.txt'),'original user evidence');
const manifest={project:'registration-assistant',version,minimum_node:24,archive:`https://github.com/harpertristan/test/raw/refs/heads/registration-assistant/registration-assistant-${version}.zip`,bytes:archive.length,sha256:sha256(archive)};
let started=false;
try{
  const result=await updateInstallation({target,start:true,fetcher:async url=>new Response(url===MANIFEST_URL?JSON.stringify(manifest):archive)});started=true;
  assert.equal(result.updated,true);assert.equal(JSON.parse(readFileSync(join(target,'package.json'),'utf8')).version,version);assert.equal(readFileSync(join(target,'.env'),'utf8'),env);assert.equal(readFileSync(join(target,'operator-note.txt'),'utf8'),'keep this local file');assert.equal(readFileSync(join(target,'records','uploads','original.txt'),'utf8'),'original user evidence');
  const login=await fetch(`http://127.0.0.1:${port}/api/login`,{method:'POST',headers:{Origin:`http://127.0.0.1:${port}`,'X-Assistant-Request':'1','Content-Type':'application/json'},body:JSON.stringify({username:'upgrade-test',password:'synthetic-upgrade-password'})});assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0];const companies=await (await fetch(`http://127.0.0.1:${port}/api/companies`,{headers:{Cookie:cookie}})).json();assert.equal(companies[0].name,'Example Limited');
  assert.ok(existsSync(join(result.backup,'data','assistant.sqlite')));assert.equal(readFileSync(join(result.backup,'node_modules','old-marker'),'utf8'),'previous dependencies');
  const instance=installationSettings(target).instance.instanceId;
  const repeated=await updateInstallation({target,start:true,fetcher:async url=>new Response(url===MANIFEST_URL?JSON.stringify(manifest):archive)});assert.equal(repeated.updated,false);assert.equal(installationSettings(target).instance.instanceId,instance);
  // Rehearse the next update too: this time a real managed server is running.
  const future=await JSZip.loadAsync(archive),futureVersion='0.2.2';
  const nextPackage=JSON.parse(await future.file('registration-assistant/package.json').async('string'));nextPackage.version=futureVersion;future.file('registration-assistant/package.json',JSON.stringify(nextPackage));
  const nextLock=JSON.parse(await future.file('registration-assistant/package-lock.json').async('string'));nextLock.version=futureVersion;nextLock.packages[''].version=futureVersion;future.file('registration-assistant/package-lock.json',JSON.stringify(nextLock));
  const futureArchive=await future.generateAsync({type:'nodebuffer',compression:'DEFLATE'}),futureManifest={...manifest,version:futureVersion,archive:`https://github.com/harpertristan/test/raw/refs/heads/registration-assistant/registration-assistant-${futureVersion}.zip`,bytes:futureArchive.length,sha256:sha256(futureArchive)};
  const next=await updateInstallation({target,start:true,fetcher:async url=>new Response(url===MANIFEST_URL?JSON.stringify(futureManifest):futureArchive),verify:async stage=>{
    await verifyStage(stage);
    const health=await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();assert.equal(health.version,version);
    const saved=await fetch(`http://127.0.0.1:${port}/api/companies/example-company/notes`,{method:'POST',headers:{Cookie:cookie,Origin:`http://127.0.0.1:${port}`,'X-Assistant-Request':'1','Content-Type':'application/json'},body:JSON.stringify({title:'During preparation',text:'Operator data saved while dependencies were prepared.'})});assert.equal(saved.status,201);
  }});
  assert.equal(next.version,futureVersion);assert.notEqual(installationSettings(target).instance.instanceId,instance);
  const documents=await (await fetch(`http://127.0.0.1:${port}/api/companies/example-company/documents`,{headers:{Cookie:cookie}})).json();assert.ok(documents.some(doc=>doc.filename==='During preparation'));
  console.log('PASS: real 0.2.0 → '+version+' upgrade, production dependencies, readiness, old account login, documents, settings and backup.');
  console.log('PASS: running '+version+' → simulated '+futureVersion+', graceful stop/restart, data saved during preparation and session preserved.');
}finally{
  if(started)await stopServer(target,installationSettings(target));
  rmSync(directory,{recursive:true,force:true});
}
