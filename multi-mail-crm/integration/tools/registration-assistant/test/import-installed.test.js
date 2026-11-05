import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,readdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {openDatabase} from '../lib/database.js';
import {exportMigration} from '../scripts/export-migration.mjs';
for(const fail of [false,true]) test(`installed import ${fail?'restores old database after failed container readiness':'switches verified data and owner while preserving previous data'}`,async t=>{
 const dir=mkdtempSync(join(tmpdir(),'installed-import-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const source=join(dir,'source');mkdirSync(join(source,'data','uploads'),{recursive:true});
 writeFileSync(join(source,'package.json'),'{"version":"0.5.0"}');
 const db=openDatabase(join(source,'data'));db.prepare('INSERT INTO users VALUES(1,?,?)').run('operator','hash');db.close();
 writeFileSync(join(source,'data','uploads','original'),'original');
 const archive=join(dir,'transfer.tar.gz');await exportMigration({target:source,output:archive,stop:false});
 const root=join(dir,'workspace');mkdirSync(join(root,'assistant-data'),{recursive:true});mkdirSync(join(root,'backups'));mkdirSync(join(root,'assistant','deploy','play-scout'),{recursive:true});
 writeFileSync(join(root,'assistant-data','previous'),'previous');writeFileSync(join(root,'installed'),'yes');writeFileSync(join(root,'workspace.env'),'WORKSPACE_SHARED_SECRET=synthetic-secret\nWORKSPACE_USER=workspace\n');writeFileSync(join(root,'base-files.list'),'/synthetic/base.yaml\n');
 writeFileSync(join(root,'assistant','deploy','play-scout','import-migration.py'),readFileSync('deploy/play-scout/import-migration.py'));
 const bin=join(dir,'bin');mkdirSync(bin);
 const flag=join(dir,'fail');if(fail)writeFileSync(flag,'yes');
 writeFileSync(join(bin,'docker'),'#!/bin/bash\nprintf "%s\\n" "$*" >> "$HARNESS_LOG"\nif [[ "$*" == *--wait* && -f "$HARNESS_FAIL" ]]; then rm "$HARNESS_FAIL"; exit 1; fi\n',{mode:0o755});
 writeFileSync(join(bin,'chown'),'#!/bin/bash\nexit 0\n',{mode:0o755});
 // Run the exact switch/rollback logic against isolated paths and a simulated container failure.
 const script=readFileSync('deploy/play-scout/import-installed.sh','utf8').replace(/^\[\[ \$EUID.*$/m,':').replace('root=/srv/play-scout-workspace',`root='${root}'`);
 const file=join(dir,'import.sh');writeFileSync(file,script);
 const result=spawnSync('bash',[file,archive],{encoding:'utf8',env:{...process.env,PATH:bin+':'+process.env.PATH,HARNESS_LOG:join(dir,'docker.log'),HARNESS_FAIL:flag}});
 assert.equal(result.status,fail?1:0,result.stderr);
 const backup=join(root,'backups',readdirSync(join(root,'backups'))[0]);
 if(fail){assert.equal(readFileSync(join(root,'assistant-data','previous'),'utf8'),'previous');assert.match(readFileSync(join(root,'workspace.env'),'utf8'),/WORKSPACE_USER=workspace/);assert.ok(existsSync(join(backup,'failed-data','assistant.sqlite')));}
 else{assert.equal(readFileSync(join(root,'assistant-data','uploads','original'),'utf8'),'original');assert.match(readFileSync(join(root,'workspace.env'),'utf8'),/WORKSPACE_USER=operator/);assert.equal(readFileSync(join(backup,'previous-data','previous'),'utf8'),'previous');}
 assert.match(readFileSync(join(root,'workspace.env'),'utf8'),/WORKSPACE_SHARED_SECRET=synthetic-secret/);
 assert.doesNotMatch(readFileSync(join(dir,'docker.log'),'utf8'),/stop app|stop caddy|stop ollama/);
});
