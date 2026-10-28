import {readFile,writeFile,readdir,lstat,realpath,mkdir,copyFile,cp,chmod,rm} from 'node:fs/promises';
import {resolve,dirname,join,relative,sep,parse} from 'node:path';
import {parseEnv,promisify} from 'node:util';
import {execFile,spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import net from 'node:net';
import {randomUUID,createHash} from 'node:crypto';

const execute=promisify(execFile),pause=ms=>new Promise(r=>setTimeout(r,ms));
const codeDirs=new Set(['lib','public','scripts','test']);
const rootFile=name=>/\.(?:md|command|cmd)$/.test(name)||['package.json','package-lock.json','server.js','Dockerfile','render.yaml','.gitignore','.dockerignore','.gitattributes'].includes(name);
const exists=async path=>{try{return await lstat(path);}catch(e){if(e.code==='ENOENT')return null;throw e;}};
const within=(child,parent)=>{const r=relative(parent,child);return !r||r!=='..'&&!r.startsWith('..'+sep)&&!r.startsWith(sep);};
const portOpen=port=>new Promise(r=>{const s=net.connect({host:'127.0.0.1',port});let done=false;const finish=v=>{if(done)return;done=true;s.destroy();r(v);};s.once('connect',()=>finish(true));s.once('error',()=>finish(false));s.setTimeout(1000,()=>finish(true));});
async function manifest(root){
 const files=[];
 async function walk(path){for(const entry of await readdir(join(root,path),{withFileTypes:true})){const name=join(path,entry.name);if(entry.isSymbolicLink())throw Error('В архиве кода обнаружена символическая ссылка. Обновление отменено.');if(entry.isDirectory())await walk(name);else if(entry.isFile())files.push(name);else throw Error('Некорректный файл в архиве.');}}
 for(const entry of await readdir(root,{withFileTypes:true}))if(codeDirs.has(entry.name)||rootFile(entry.name)){if(entry.isSymbolicLink())throw Error('Некорректный архив.');if(entry.isDirectory()&&codeDirs.has(entry.name))await walk(entry.name);else if(entry.isFile()&&rootFile(entry.name))files.push(entry.name);}
 for(const required of ['package.json','package-lock.json','server.js','lib/store.js','public/crm.html','scripts/start-desktop.js'])if(!files.includes(required))throw Error('В архиве нет обязательного файла '+required+'.');
 return files;
}
async function targetPathsSafe(target,files){
 for(const file of files){let cursor=target;const parts=file.split(sep);for(let i=0;i<parts.length;i++){cursor=join(cursor,parts[i]);const info=await exists(cursor);if(info?.isSymbolicLink()||info&&(i<parts.length-1?!info.isDirectory():!info.isFile()))throw Error('Нестандартный путь кода: '+file+'. Исходная папка не изменена.');}}
}
export async function stopOwnedServer(target,port,{log=console.log,timeout=20000}={}){
 if(!(await portOpen(port)))return;
 let ids;
 try{ids=[...new Set((await execute('lsof',['-nP',`-iTCP:${port}`,'-sTCP:LISTEN','-t'],{timeout:5000})).stdout.trim().split(/\s+/).filter(Boolean))];}catch{throw Error('Порт занят. Остановите Play Scout через Control+C в его окне и повторите обновление.');}
 if(!ids.length)throw Error('Не удалось определить программу на порту '+port+'. Обновление отменено.');
 for(const id of ids){
  const pid=Number(id);if(!Number.isInteger(pid)||pid<2)throw Error('Не удалось определить процесс программы.');
  const [cwd,command]=await Promise.all([execute('lsof',['-a','-p',id,'-d','cwd','-Fn'],{timeout:5000}),execute('ps',['-p',id,'-o','command='],{timeout:5000})]);
  const folder=cwd.stdout.split('\n').find(line=>line.startsWith('n'))?.slice(1);
  if(!folder||await realpath(folder)!==target||!/(?:^|[ /])node(?:\s|$)/.test(command.stdout)||!/(?:^|[ /])server\.js(?:\s|$)/.test(command.stdout))throw Error('На порту '+port+' работает другой экземпляр или другая программа. Она не остановлена. Сначала завершите её самостоятельно.');
 }
 log('Останавливаем Play Scout из этой папки и ждём сохранения очереди…');
 for(const id of ids)try{process.kill(Number(id),'SIGTERM');}catch(e){if(e.code!=='ESRCH')throw e;}
 const deadline=Date.now()+timeout;while(await portOpen(port)){if(Date.now()>deadline)throw Error('Программа не завершилась. Код ещё не менялся. Завершите её в прежнем Терминале или «Мониторинге системы», затем повторите обновление.');await pause(200);}
}
function run(command,args,cwd){return new Promise((accept,reject)=>{const p=spawn(command,args,{cwd,stdio:'inherit'});p.once('error',reject);p.once('exit',code=>code===0?accept():reject(Error(command+' завершился с ошибкой.')));});}
export async function updateInPlace(source,target,{install=dir=>run(process.platform==='win32'?'npm.cmd':'npm',['ci'],dir),diagnose=dir=>run(process.execPath,['scripts/doctor.js'],dir),stop=stopOwnedServer,log=console.log}={}){
 source=await realpath(source);target=await realpath(target);
 if(within(source,target)||within(target,source))throw Error('Архив и рабочая папка должны находиться раздельно.');
 const [next,old]=await Promise.all([readFile(join(source,'package.json'),'utf8').then(JSON.parse),readFile(join(target,'package.json'),'utf8').then(JSON.parse)]);
 if(old.name!=='play-finance-finder'||next.name!==old.name||!/^\d+\.\d+\.\d+$/.test(next.version)||!/^\d+\.\d+\.\d+$/.test(old.version))throw Error('Выбрана не папка Play Scout или некорректная версия.');
 if(next.version.localeCompare(old.version,'en',{numeric:true})<0||next.version.localeCompare('4.0.1','en',{numeric:true})<0)throw Error('Скачанная версия старее необходимой. Рабочая папка не изменена.');
 const files=await manifest(source);await targetPathsSafe(target,files);
 const envText=await readFile(join(target,'.env'),'utf8').catch(e=>{if(e.code==='ENOENT')return '';throw e;}),env=parseEnv(envText);
 const port=Number(process.env.PORT||env.PORT||3000);if(!Number.isInteger(port)||port<1||port>65535)throw Error('Проверьте PORT в .env.');
 const data=resolve(target,process.env.DATA_DIR||env.DATA_DIR||'./data');
 if(data===parse(data).root||within(target,data))throw Error('Нестандартный DATA_DIR. Он не должен включать всю рабочую папку или диск.');
 const cache=join(target,'.cache'),cacheInfo=await exists(cache);if(cacheInfo&&(!cacheInfo.isDirectory()||cacheInfo.isSymbolicLink()))throw Error('Нестандартная папка .cache. Обновление отменено.');
 await mkdir(cache,{recursive:true});const lock=join(cache,'update.lock');
 try{await mkdir(lock);}catch(e){if(e.code==='EEXIST')throw Error('Обновление уже выполняется или прежнее было прервано. Не запускайте два обновления одновременно.');throw e;}
 try {
 await writeFile(join(lock,'pid'),String(process.pid));
 await stop(target,port,{log});
 const backup=join(dirname(target),`${target.split(sep).at(-1)}-backup-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,6)}`);
 await mkdir(join(backup,'code'),{recursive:true,mode:0o700});await chmod(backup,0o700);
 if(await exists(data))await cp(data,join(backup,'data'),{recursive:true,dereference:true,preserveTimestamps:true});
 if(await exists(join(target,'.env'))){await copyFile(join(target,'.env'),join(backup,'.env'));await chmod(join(backup,'.env'),0o600);}
 const existing=[];for(const file of files)if(await exists(join(target,file))){await mkdir(dirname(join(backup,'code',file)),{recursive:true});await copyFile(join(target,file),join(backup,'code',file));existing.push(file);}
 await writeFile(join(backup,'update.json'),JSON.stringify({from:old.version,to:next.version,target,dataDirectory:data,existing,files},null,2)+'\n',{mode:0o600});
 log('Резервная копия: '+backup);
 const written=[];
 try{
  for(const file of files){await mkdir(dirname(join(target,file)),{recursive:true});written.push(file);await copyFile(join(source,file),join(target,file));if(file.endsWith('.command')||file.endsWith('.sh'))await chmod(join(target,file),0o755);}
  log('Код обновлён. Устанавливаем зависимости…');await install(target);await diagnose(target);
 }catch(error){
  try{for(const file of written){if(existing.includes(file))await copyFile(join(backup,'code',file),join(target,file));else await rm(join(target,file),{force:true});}await rm(join(cache,'install-lock'),{force:true});}
  catch{throw Error('Обновление не завершено. История и ключи не менялись. Резервная копия: '+backup+'. Восстановите код из её папки code.');}
  throw Error('Обновление не завершено, прежний код восстановлен. История и ключи сохранены. Перед запуском выполните npm ci в рабочей папке. Резервная копия: '+backup,{cause:error});
 }
 await writeFile(join(cache,'install-lock'),createHash('sha256').update(await readFile(join(target,'package-lock.json'))).digest('hex'));
 log(`Готово: Play Scout ${next.version}. Рабочая папка осталась прежней: ${target}`);
 return {version:next.version,backup,target};
 }finally{await rm(lock,{recursive:true,force:true});}
}
if(process.argv[1]&&await realpath(process.argv[1]).catch(()=>null)===await realpath(fileURLToPath(import.meta.url))){
 try{const result=await updateInPlace(process.argv[2],process.argv[3]);if(process.argv.includes('--start'))await run('bash',['2-Запустить.command'],result.target);}
 catch(error){console.error(error.message);process.exitCode=1;}
}
