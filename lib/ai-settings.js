import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {mkdirSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const modelPattern=/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,150}$/;
export function aiConfiguration(db,directory,userId,environment={}){
  const row=db.prepare('SELECT * FROM ai_settings WHERE user_id=?').get(userId);
  if(!row)return {...environment};
  const key=readFileSync(join(directory,'.secrets','ai-master.key')),payload=JSON.parse(row.encrypted_key),decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(payload.iv,'base64'));decipher.setAuthTag(Buffer.from(payload.tag,'base64'));
  const apiKey=Buffer.concat([decipher.update(Buffer.from(payload.body,'base64')),decipher.final()]).toString('utf8');
  return {...environment,AI_API_KEY:apiKey,AI_MODEL:row.model};
}
export function aiStatus(db,userId,environment={}){const row=db.prepare('SELECT model FROM ai_settings WHERE user_id=?').get(userId);return {configured:Boolean(row||environment.AI_API_KEY&&environment.AI_MODEL),source:row?'user':environment.AI_API_KEY?'environment':'none',model:row?.model||environment.AI_MODEL||'',provider:'OpenAI'};}
export function saveAISettings(db,directory,userId,{apiKey,model}){
  if(typeof model!=='string'||!modelPattern.test(model.trim()))throw Object.assign(new Error('Укажите точный идентификатор модели из вашего OpenAI API-аккаунта.'),{status:400});
  if(typeof apiKey!=='string'||apiKey.length<20||apiKey.length>1000||/\s/.test(apiKey))throw Object.assign(new Error('Проверьте API-ключ. Он не должен содержать пробелы.'),{status:400});
  const folder=join(directory,'.secrets'),path=join(folder,'ai-master.key');mkdirSync(folder,{recursive:true,mode:0o700});if(!existsSync(path))writeFileSync(path,randomBytes(32),{mode:0o600,flag:'wx'});
  const key=readFileSync(path),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv),body=Buffer.concat([cipher.update(apiKey,'utf8'),cipher.final()]);
  const encrypted=JSON.stringify({iv:iv.toString('base64'),body:body.toString('base64'),tag:cipher.getAuthTag().toString('base64')});
  db.prepare('INSERT INTO ai_settings VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET encrypted_key=excluded.encrypted_key,model=excluded.model').run(userId,encrypted,model.trim());
}
