import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,mkdtemp,copyFile,rm,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url)),run=promisify(execFile);
test('every distributed Windows launcher has literal CRLF, ASCII commands and no BOM',async()=>{
 const launchers=(await readdir(root)).filter(name=>name.endsWith('.cmd'));assert.equal(launchers.length,10);
 for(const name of launchers){const body=await readFile(join(root,name));assert.ok(body.length>0,name);assert.ok(body.every(byte=>byte<128),name+' must not depend on a CMD code page to parse');assert.equal(body[0],64,name+' must start with @echo, not a BOM');assert.ok(!/(?<!\r)\n|\r(?!\n)/.test(body.toString('ascii')),name+' must retain CRLF in the downloaded ZIP');assert.ok(body.toString('ascii').endsWith('\r\n'),name);}
});
test('Windows ZIP and Git blobs retain CRLF even with core.autocrlf enabled',async t=>{
 const repo=await mkdtemp(join(tmpdir(),'scout-cmd-archive-'));t.after(()=>rm(repo,{recursive:true,force:true}));
 await run('git',['init','-q',repo]);await mkdir(join(repo,'scripts'));for(const name of['.gitattributes',...(await readdir(root)).filter(name=>name.endsWith('.cmd'))])await copyFile(join(root,name),join(repo,name));
 await run('git',['-c','core.autocrlf=true','add','.'],{cwd:repo});const {stdout:tree}=await run('git',['write-tree'],{cwd:repo});await run('git',['archive','--format=tar','-o',join(repo,'release.tar'),tree.trim()],{cwd:repo});const unpack=join(repo,'unpack');await mkdir(unpack);await run('tar',['-xf',join(repo,'release.tar'),'-C',unpack]);
 for(const name of(await readdir(root)).filter(name=>name.endsWith('.cmd'))){const source=await readFile(join(root,name)),blob=(await run('git',['show',':'+name],{cwd:repo,encoding:'buffer'})).stdout;assert.deepEqual(blob,source,name+' in Git');assert.deepEqual(await readFile(join(unpack,name)),source,name+' in the downloadable archive');}
});
test('key import and startup launch the Node entry points and preserve failure codes across pause',async()=>{
 for(const[name,entry]of[['9-Import-keys-only.cmd','scripts\\import-keys.js'],['7-Import-from-Mac.cmd','scripts\\transfer-profile.js import'],['2-Start.cmd','scripts\\start-desktop.js']]){const body=await readFile(join(root,name),'utf8');assert.ok(body.includes('node '+entry+'\r\n'),name);assert.ok(body.includes('setlocal EnableExtensions DisableDelayedExpansion'),name);assert.match(body,/node .*\r\nset "PLAY_SCOUT_EXIT=%ERRORLEVEL%"\r\n/);assert.ok(body.includes('exit /b %PLAY_SCOUT_EXIT%'),name);}
});
