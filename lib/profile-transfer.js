import {readFile,writeFile,readdir,lstat,realpath,mkdir,mkdtemp,rename,rm,chmod,copyFile} from 'node:fs/promises';
import {resolve,join,dirname,relative,sep} from 'node:path';
import {parseEnv,promisify} from 'node:util';
import {randomBytes,createCipheriv,createDecipheriv,scrypt,createHash} from 'node:crypto';
import {gzip,gunzip} from 'node:zlib';
import net from 'node:net';

const MAGIC=Buffer.from('PLAY-SCOUT-PROFILE-1\n'),derive=promisify(scrypt),compress=promisify(gzip),decompress=promisify(gunzip);
const exists=async path=>{try{return await lstat(path);}catch(e){if(e.code==='ENOENT')return null;throw e;}};
const inside=(child,parent)=>{const r=relative(parent,child);return !r||r!=='..'&&!r.startsWith('..'+sep)&&!r.startsWith(sep);};
const digest=body=>createHash('sha256').update(body).digest('hex');
function passwordCheck(password){if(typeof password!=='string'||[...password].length<12||password.length>1024)throw Error('Пароль переноса: не менее 12 символов.');}
function validPath(name){return typeof name==='string'&&name.startsWith('data/')&&name.split('/').every((part,i)=>i===0||part&&part!=='.'&&part!=='..'&&!/[\\<>:"|?*\x00-\x1f]/.test(part)&&!/[. ]$/.test(part)&&!/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part));}
function stateCheck(body){let state;try{state=JSON.parse(body);}catch{throw Error('История state.json повреждена; перенос отменён.');}if(state?.version!==1||!Array.isArray(state.findings)||!Array.isArray(state.jobs)||!state.schedule)throw Error('Это не полная история Play Scout. Выгрузка CRM JSON не заменяет data/state.json.');return state;}
function profileSummary(files){const state=stateCheck(files.find(f=>f.path==='data/state.json').body);return {apps:state.findings.length,analyses:state.ai?.results?.length??0,exclusions:state.manualExclusions?.length??0,engine:state.ai?.config?.engine??'openai',ollamaModel:state.ai?.config?.ollamaModel??'qwen2.5:3b'};}
async function project(root){const info=JSON.parse(await readFile(join(root,'package.json'),'utf8'));if(info.name!=='play-finance-finder'||!/^\d+\.\d+\.\d+$/.test(info.version))throw Error('Выберите папку Play Scout с package.json.');return info;}
async function envFile(root){return readFile(join(root,'.env'),'utf8').catch(e=>{if(e.code==='ENOENT')return '';throw e;});}
async function lockedProfile(root,work){root=await realpath(root);const lock=join(root,'.profile-transfer-lock');try{await mkdir(lock,{mode:0o700});}catch(e){if(e.code==='EEXIST')throw Error('Перенос уже выполняется. Не запускайте два переноса одновременно. После прерванного переноса удалите .profile-transfer-lock, убедившись, что прежняя команда завершена.');throw e;}try{return await work(root);}finally{await rm(lock,{recursive:true,force:true});}}
async function portBusy(port){return new Promise(accept=>{const socket=net.connect({host:'127.0.0.1',port});let settled=false;const finish=value=>{if(!settled){settled=true;socket.destroy();accept(value);}};socket.once('connect',()=>finish(true));socket.once('error',error=>finish(error.code!=='ECONNREFUSED'));socket.setTimeout(1500,()=>finish(true));});}
export async function requireStopped(env={}){
 const port=Number(env.PORT||3000);if(!Number.isInteger(port)||port<1||port>65535)throw Error('Проверьте PORT в .env.');
 if(await portBusy(port))throw Error('Порт '+port+' занят. Остановите Play Scout: npm run stop на Mac или 3-Stop.cmd на Windows, затем повторите перенос.');
}
export function portableEnv(text){const original=parseEnv(text),result=text+(text.endsWith('\n')?'':'\n')+'\n# Профиль перенесён: история находится рядом с программой.\nDATA_DIR=./data\n',parsed=parseEnv(result);if(parsed.DATA_DIR!=='./data'||Object.entries(original).some(([k,v])=>k!=='DATA_DIR'&&parsed[k]!==v))throw Error('Не удалось подготовить .env для Windows. Исходный файл не изменён.');return result;}
export async function sealProfile(payload,password){
 passwordCheck(password);const salt=randomBytes(16),iv=randomBytes(12),key=await derive(password,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});
 try{const cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(MAGIC);const zipped=await compress(Buffer.from(JSON.stringify(payload)));const encrypted=Buffer.concat([cipher.update(zipped),cipher.final()]);return Buffer.concat([MAGIC,salt,iv,cipher.getAuthTag(),encrypted]);}finally{key.fill(0);}
}
export async function unsealProfile(body,password){
 passwordCheck(password);if(body.length<MAGIC.length+45||!body.subarray(0,MAGIC.length).equals(MAGIC))throw Error('Выберите файл переноса .psbackup, созданный Play Scout.');
 let offset=MAGIC.length;const salt=body.subarray(offset,offset+=16),iv=body.subarray(offset,offset+=12),tag=body.subarray(offset,offset+=16),key=await derive(password,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});
 try{const cipher=createDecipheriv('aes-256-gcm',key,iv);cipher.setAAD(MAGIC);cipher.setAuthTag(tag);const zipped=Buffer.concat([cipher.update(body.subarray(offset)),cipher.final()]);return JSON.parse(await decompress(zipped));}catch{throw Error('Неверный пароль переноса или повреждённый файл. История и ключи на этом компьютере не изменены.');}finally{key.fill(0);}
}
function validatePayload(payload){
 if(payload?.format!=='play-scout-private-profile-v1'||typeof payload.env!=='string'||!Array.isArray(payload.files)||!/^\d+\.\d+\.\d+$/.test(payload.appVersion??''))throw Error('Некорректный формат переноса.');
 const seen=new Set(),files=[];
 for(const file of payload.files){
  if(!validPath(file.path)||seen.has(file.path.toLowerCase())||typeof file.body!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.body))throw Error('Небезопасные или повторяющиеся имена файлов в переносе.');
  seen.add(file.path.toLowerCase());const body=Buffer.from(file.body,'base64');if(file.sha256!==digest(body))throw Error('Не совпала контрольная сумма файла переноса.');files.push({path:file.path,body});
 }
 const state=files.find(f=>f.path==='data/state.json');if(!state)throw Error('В переносе отсутствует data/state.json.');stateCheck(state.body);parseEnv(payload.env);return files;
}
export const exportProfile=(root,output,password,options={})=>lockedProfile(root,path=>exportUnlocked(path,output,password,options));
async function exportUnlocked(root,output,password,{checkStopped=requireStopped}={}){
 root=await realpath(root);const info=await project(root),env=await envFile(root),settings=parseEnv(env),data=await realpath(resolve(root,process.env.DATA_DIR||settings.DATA_DIR||'./data'));
 if(inside(root,data))throw Error('DATA_DIR не должен включать всю папку программы.');
 output=resolve(output);if(inside(output,data)||output===join(root,'.env'))throw Error('Сохраните перенос вне папки data и файла .env.');
 await checkStopped({...settings,PORT:process.env.PORT||settings.PORT});const files=[];
 async function walk(folder,prefix){for(const item of await readdir(folder,{withFileTypes:true})){if(item.name==='.DS_Store'||item.name.endsWith('.tmp')||item.name.endsWith('.lock'))continue;const name=prefix+'/'+item.name,path=join(folder,item.name);if(!validPath(name))throw Error('Имя файла не поддерживается Windows: '+name);if(item.isSymbolicLink())throw Error('В data есть ссылка на другой файл. Перенос отменён: '+name);if(item.isDirectory())await walk(path,name);else if(item.isFile()){const body=await readFile(path);files.push({path:name,body:body.toString('base64'),sha256:digest(body)});}else throw Error('Нестандартный файл в data: '+name);}}
 await walk(data,'data');const payload={format:'play-scout-private-profile-v1',appVersion:info.version,createdAt:new Date().toISOString(),platform:process.platform,env,files:files.sort((a,b)=>a.path.localeCompare(b.path))};validatePayload(payload);
 const summary=profileSummary(validatePayload(payload)),body=await sealProfile(payload,password);await checkStopped({...settings,PORT:process.env.PORT||settings.PORT});
 await mkdir(dirname(output),{recursive:true});await writeFile(output,body,{flag:'wx',mode:0o600});
 return {output,version:info.version,files:files.length,bytes:body.length,hasEnv:Boolean(env),summary,keys:Object.fromEntries(['BRAVE_SEARCH_API_KEY','OPENAI_API_KEY','GEMINI_API_KEY'].map(k=>[k,Boolean(settings[k])]))};
}
export const importProfile=(root,input,password,options={})=>lockedProfile(root,path=>importUnlocked(path,input,password,options));
export const importKeys=(root,input,options={})=>lockedProfile(root,path=>importKeysUnlocked(path,input,options));
async function importKeysUnlocked(root,input,{checkStopped=requireStopped}={}){
 const info=await project(root);if(await exists(join(root,'data','state.json')))throw Error('В этой папке уже есть история. Для чистого запуска распакуйте программу в новую папку; существующая история не удалена.');
 const env=join(root,'.env'),old=await exists(env);if(old&&(old.isSymbolicLink()||!old.isFile()))throw Error('Нестандартный путь .env. Импорт ключей отменён.');
 const source=await readFile(input,'utf8'),values=parseEnv(source);if(!['BRAVE_SEARCH_API_KEY','OPENAI_API_KEY','GEMINI_API_KEY','APP_PASSWORD','VIEW_PASSWORD'].some(k=>values[k]))throw Error('В выбранном файле нет ключей или паролей Play Scout. Выберите .env с Mac, а не выгрузку CRM.');
 const previous=await envFile(root),next=portableEnv(source);await checkStopped(parseEnv(previous));await checkStopped(values);let backup;
 if(old){backup=await mkdtemp(join(dirname(root),'PlayScout-keys-before-import-'));await chmod(backup,0o700);await copyFile(env,join(backup,'.env'));await chmod(join(backup,'.env'),0o600);}
 const stage=await mkdtemp(join(root,'.profile-import-'));await chmod(stage,0o700);
 try{await writeFile(join(stage,'.env'),next,{flag:'wx',mode:0o600});await rename(join(stage,'.env'),env);}finally{await rm(stage,{recursive:true,force:true});}
 return {version:info.version,backup,keys:Object.fromEntries(['BRAVE_SEARCH_API_KEY','OPENAI_API_KEY','GEMINI_API_KEY'].map(k=>[k,Boolean(values[k])]))};
}
async function importUnlocked(root,input,password,{checkStopped=requireStopped,move=rename}={}){
 root=await realpath(root);const info=await project(root),payload=await unsealProfile(await readFile(input),password),files=validatePayload(payload);
 if(payload.appVersion.localeCompare(info.version,'en',{numeric:true})>0)throw Error('Профиль создан более новой версией. Сначала обновите программу на Windows.');
 const oldEnv=await envFile(root),settings=parseEnv(oldEnv),nextEnv=portableEnv(payload.env),data=join(root,'data'),env=join(root,'.env');
 for(const path of[data,env]){const stat=await exists(path);if(stat&&(stat.isSymbolicLink()||path===data&&!stat.isDirectory()||path===env&&!stat.isFile()))throw Error('Нестандартный путь '+path+'. Перенос отменён.');}
 await checkStopped({...settings,PORT:process.env.PORT||settings.PORT});if(parseEnv(nextEnv).PORT!==settings.PORT)await checkStopped(parseEnv(nextEnv));
 const stage=await mkdtemp(join(root,'.profile-import-'));await chmod(stage,0o700);let backup;
 try{
  await mkdir(join(stage,'data'),{mode:0o700});for(const file of files){const target=join(stage,...file.path.split('/'));await mkdir(dirname(target),{recursive:true,mode:0o700});await writeFile(target,file.body,{flag:'wx',mode:0o600});}await writeFile(join(stage,'.env'),nextEnv,{flag:'wx',mode:0o600});
  await checkStopped({...settings,PORT:process.env.PORT||settings.PORT});
  backup=await mkdtemp(join(dirname(root),'PlayScout-before-import-'));await chmod(backup,0o700);let oldData=false,oldKeys=false,newData=false,newKeys=false;
  try{
   if(await exists(data)){await move(data,join(backup,'data'));oldData=true;}if(await exists(env)){await move(env,join(backup,'.env'));oldKeys=true;}
   await move(join(stage,'data'),data);newData=true;await move(join(stage,'.env'),env);newKeys=true;
  }catch(error){
   try{if(newKeys)await rm(env,{force:true});if(newData)await rm(data,{recursive:true,force:true});if(oldData)await rename(join(backup,'data'),data);if(oldKeys)await rename(join(backup,'.env'),env);}catch{throw Error('Перенос не завершён. Не запускайте программу. Восстановите data и .env из '+backup+'.');}
   throw Error('Перенос не завершён; прежние данные восстановлены. Резервная папка: '+backup,{cause:error});
  }
  if(!oldData&&!oldKeys){await rm(backup,{recursive:true});backup=null;}
  return {version:info.version,sourceVersion:payload.appVersion,files:files.length,backup,summary:profileSummary(files),keys:Object.fromEntries(['BRAVE_SEARCH_API_KEY','OPENAI_API_KEY','GEMINI_API_KEY'].map(k=>[k,Boolean(parseEnv(nextEnv)[k])]))};
 }finally{await rm(stage,{recursive:true,force:true});}
}
