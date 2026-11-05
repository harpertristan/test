import {backup} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {existsSync,mkdtempSync,mkdirSync,readdirSync,lstatSync,cpSync,readFileSync,writeFileSync,chmodSync,rmSync} from 'node:fs';
import {resolve,join,dirname,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {parseEnv} from 'node:util';
import {openDatabase} from '../lib/database.js';
import {installationSettings,stopServer} from './update.mjs';
import {environmentAI} from '../lib/ai-settings.js';

function files(folder){return readdirSync(folder,{withFileTypes:true}).flatMap(entry=>{const path=join(folder,entry.name);if(lstatSync(path).isSymbolicLink())throw Error('Символические ссылки в данных не переносятся: '+entry.name);return entry.isDirectory()?files(path):[path];});}
export async function exportMigration({target=resolve(dirname(fileURLToPath(import.meta.url)),'..'),output,stop=true}={}){
 target=resolve(target);if(!output)throw Error('Укажите --output с путём к архиву .tar.gz.');output=resolve(output);if(existsSync(output))throw Error('Архив уже существует. Выберите другое имя.');
 const settings=installationSettings(target),source=settings.dataDir;
 if(!existsSync(join(source,'assistant.sqlite'))||!existsSync(join(source,'uploads')))throw Error('База и оригиналы документов не найдены. Пустой перенос не создаётся.');
 if(output===source||output.startsWith(source+'/')||output.startsWith(source+'\\'))throw Error('Сохраните архив вне папки данных.');
 execFileSync('tar',['--version'],{stdio:'ignore'});
 if(stop)await stopServer(target,settings);
 const temp=mkdtempSync(join(tmpdir(),'assistant-transfer-'));let db;
 try{
  const data=join(temp,'data');mkdirSync(data,{mode:0o700});db=openDatabase(source);
  const encrypted=db.prepare('SELECT count(*) n FROM ai_settings').get().n;
  if(encrypted&&!existsSync(join(source,'.secrets','ai-master.key')))throw Error('Не найден ключ расшифровки сохранённого OpenAI. Перенос остановлен.');
  await backup(db,join(data,'assistant.sqlite'));db.close();db=undefined;
  for(const entry of readdirSync(source)){if(['assistant.sqlite','assistant.sqlite-wal','assistant.sqlite-shm','.runtime'].includes(entry))continue;const path=join(source,entry);if(lstatSync(path).isDirectory())files(path);else if(lstatSync(path).isSymbolicLink())throw Error('Ссылки в данных не поддерживаются.');cpSync(path,join(data,entry),{recursive:true,dereference:false});}
  const envPath=join(target,'.env');if(existsSync(envPath)){const ai=environmentAI(parseEnv(readFileSync(envPath,'utf8')));if(ai.AI_API_KEY){if(/\s/.test(ai.AI_API_KEY)||!/^[-A-Za-z0-9._:/]+$/.test(ai.AI_MODEL))throw Error('Проверьте AI-настройки в .env.');mkdirSync(join(data,'.secrets'),{recursive:true,mode:0o700});writeFileSync(join(data,'.secrets','imported-ai.env'),`AI_API_KEY=${ai.AI_API_KEY}\nAI_MODEL=${ai.AI_MODEL}\n`,{mode:0o600});}}
  const entries=files(data).map(path=>{const bytes=readFileSync(path);return {path:relative(temp,path).replaceAll('\\','/'),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};});
  writeFileSync(join(temp,'transfer.json'),JSON.stringify({format:'registration-assistant-transfer-v1',version:JSON.parse(readFileSync(join(target,'package.json'),'utf8')).version,entries},null,2),{mode:0o600});
  mkdirSync(dirname(output),{recursive:true});execFileSync('tar',['-czf',output,'-C',temp,'transfer.json','data'],{stdio:'pipe'});chmodSync(output,0o600);
  return {output,files:entries.length,sha256:createHash('sha256').update(readFileSync(output)).digest('hex')};
 }catch(error){if(existsSync(output))rmSync(output,{force:true});throw error;}finally{db?.close();rmSync(temp,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),value=flag=>args[args.indexOf(flag)+1];
 try{const result=await exportMigration({target:args.includes('--target')?value('--target'):undefined,output:args.includes('--output')?value('--output'):undefined});console.log('Архив создан: '+result.output);console.log('SHA256: '+result.sha256);console.log('Локальный помощник остановлен. Исходные документы сохранены на компьютере.');}catch(error){console.error(error.message);process.exitCode=1;}
}
