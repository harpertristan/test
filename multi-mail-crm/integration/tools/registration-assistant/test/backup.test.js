import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {openDatabase} from '../lib/database.js';

test('backup retains real database and originals and refuses a missing source',t=>{
  const temp=mkdtempSync(join(tmpdir(),'assistant-backup-'));t.after(()=>rmSync(temp,{recursive:true,force:true}));
  const source=join(temp,'source'),target=join(temp,'copies');const db=openDatabase(source);db.prepare('INSERT INTO users(username,password) VALUES(?,?)').run('backup-test','test-hash');db.close();mkdirSync(join(source,'uploads'));writeFileSync(join(source,'uploads','document'),'original evidence');
  const result=spawnSync(process.execPath,[resolve('scripts/backup.js'),target,'--server-stopped'],{env:{...process.env,DATA_DIR:source},encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  const folder=join(target,readdirSync(target)[0]);const copy=openDatabase(folder);assert.equal(copy.prepare('SELECT username FROM users').get().username,'backup-test');copy.close();assert.equal(readFileSync(join(folder,'uploads','document'),'utf8'),'original evidence');
  const missing=spawnSync(process.execPath,[resolve('scripts/backup.js'),join(temp,'missing-copy'),'--server-stopped'],{env:{...process.env,DATA_DIR:join(temp,'missing')},encoding:'utf8'});assert.notEqual(missing.status,0);
});
