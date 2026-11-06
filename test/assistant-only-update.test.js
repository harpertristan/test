import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawnSync} from 'node:child_process';
for(const fail of [false,true])test(`assistant-only updater ${fail?'restores helper image on readiness failure':'preserves current mail overlay and targets only helper'}`,t=>{
 const dir=mkdtempSync(join(tmpdir(),'assistant-only-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const root=join(dir,'workspace'),bin=join(dir,'bin');mkdirSync(join(root,'assistant','.git'),{recursive:true});mkdirSync(join(root,'backups'));mkdirSync(bin);writeFileSync(join(root,'workspace.env'),'synthetic=yes');writeFileSync(join(root,'current-with-mail.yaml'),'synthetic deployment');const flag=join(dir,'fail');if(fail)writeFileSync(flag,'yes');
 writeFileSync(join(bin,'git'),'#!/bin/bash\ncase "$*" in *status*) ;; *rev-parse*) echo old-source;; esac\n',{mode:0o755});
 writeFileSync(join(bin,'docker'),`#!/bin/bash
printf '%s\\n' "$*" >> "$HARNESS_LOG"
case "$*" in
 *'config --format json'*) echo '{"services":{"registration-assistant":{"image":"registration-assistant:workspace"}}}';;
 *' ps -q '*) echo helper-container;;
 *environment_file*) echo "$HARNESS_ROOT/workspace.env";;
 *config_files*) echo "$HARNESS_ROOT/current-with-mail.yaml";;
 *'com.docker.compose.project"'*) echo current-suite;;
 *'.Config.Image'*) echo registration-assistant:workspace;;
 *'.Image'*) echo sha256:previous-helper;;
 *' up '*--wait*) if [[ -f "$HARNESS_FLAG" ]];then rm "$HARNESS_FLAG";exit 1;fi;;
esac
`,{mode:0o755});
 const script=readFileSync('deploy/play-scout/update-assistant.sh','utf8').replace(/^\[\[ \$EUID.*$/m,':').replace('root=/srv/play-scout-workspace',`root='${root}'`);const path=join(dir,'update.sh');writeFileSync(path,script);
 const r=spawnSync('bash',[path],{encoding:'utf8',env:{...process.env,PATH:bin+':'+process.env.PATH,HARNESS_ROOT:root,HARNESS_LOG:join(dir,'commands'),HARNESS_FLAG:flag}});assert.equal(r.status,fail?1:0,r.stderr);
 const log=readFileSync(join(dir,'commands'),'utf8');assert.match(log,/current-with-mail.yaml/);assert.match(log,/--no-deps --wait registration-assistant/);assert.doesNotMatch(log,/stop|restart| down| up .*\bapp\b| up .*\bcaddy\b| up .*\bmail\b/);assert.equal(readFileSync(join(root,'current-with-mail.yaml'),'utf8'),'synthetic deployment');if(fail)assert.match(log,/tag sha256:previous-helper registration-assistant:workspace/);
});
