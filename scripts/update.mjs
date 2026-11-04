// Standalone updater: Node.js built-ins only, so it can upgrade older installs.
import {createHash,randomUUID} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
import {existsSync,readFileSync,writeFileSync,mkdirSync,mkdtempSync,readdirSync,lstatSync,realpathSync,cpSync,renameSync,rmSync,openSync,closeSync,chmodSync} from 'node:fs';
import {resolve,dirname,join,relative,basename,isAbsolute} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parseEnv} from 'node:util';
import {request as httpRequest,Agent} from 'node:http';

export const MANIFEST_URL='https://raw.githubusercontent.com/harpertristan/test/registration-assistant/updates/latest.json';
const REPOSITORY='https://github.com/harpertristan/test/raw/refs/heads/registration-assistant/';
const MAX_ZIP=32*1024*1024,MAX_UNPACKED=128*1024*1024;
const protectedNames=new Set(['data','.env','.git','.runtime','node_modules','backups','test-results','.update-state.json']);
const allowedHosts=new Set(['github.com','raw.githubusercontent.com','codeload.github.com','objects.githubusercontent.com','release-assets.githubusercontent.com']);
const delay=milliseconds=>new Promise(done=>setTimeout(done,milliseconds));
const loopbackAgent=new Agent({keepAlive:false});
function localRequest(settings,path,{method='GET',headers={},timeout=3000}={}){
  // Local control never leaves this machine, including on systems with an HTTP
  // proxy configured for GitHub downloads. No arbitrary host is accepted here.
  const address=new URL(settings.base);if(!['127.0.0.1','[::1]'].includes(address.hostname))throw Error('Ожидался локальный адрес приложения.');
  return new Promise((done,reject)=>{const request=httpRequest(address.origin+path,{method,headers,agent:loopbackAgent},response=>{const chunks=[];let size=0;response.on('data',chunk=>{size+=chunk.length;if(size>2*1024*1024)request.destroy(Error('Слишком большой локальный ответ.'));else chunks.push(chunk);});response.once('end',()=>{const body=Buffer.concat(chunks).toString('utf8');done({ok:response.statusCode>=200&&response.statusCode<300,status:response.statusCode,text:async()=>body,json:async()=>JSON.parse(body)});});});request.setTimeout(timeout,()=>request.destroy(Object.assign(Error('Локальный сервер не отвечает.'),{name:'TimeoutError'})));request.once('error',reject);request.end();});
}
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export function compareVersions(a,b){const left=a.split('.').map(Number),right=b.split('.').map(Number);for(let i=0;i<3;i++)if(left[i]!==right[i])return left[i]>right[i]?1:-1;return 0;}
export function validateRelease(value){
  if(value?.project!=='registration-assistant'||!/^\d+\.\d+\.\d+$/.test(value.version||'')||!/^\d+$/.test(String(value.minimum_node))||!/^([a-f0-9]{64})$/.test(value.sha256||'')||!Number.isInteger(value.bytes)||value.bytes<100||value.bytes>MAX_ZIP||value.archive!==REPOSITORY+`registration-assistant-${value.version}.zip`)throw Error('Некорректные сведения об обновлении. Установка отменена.');
  if(Number(process.versions.node.split('.')[0])<value.minimum_node)throw Error(`Для обновления нужен Node.js ${value.minimum_node} или новее.`);
  return value;
}
export async function download(url,maxBytes,fetcher=fetch){
  for(let redirects=0;redirects<6;redirects++){
    const parsed=new URL(url);if(parsed.protocol!=='https:'||!allowedHosts.has(parsed.hostname)||parsed.username||parsed.password)throw Error('Недопустимый адрес загрузки обновления.');
    const response=await fetcher(parsed.href,{redirect:'manual',signal:AbortSignal.timeout(60000)});
    if([301,302,303,307,308].includes(response.status)){const location=response.headers.get('location');if(!location)throw Error('Некорректное перенаправление GitHub.');url=new URL(location,parsed).href;continue;}
    if(!response.ok)throw Error(`GitHub вернул HTTP ${response.status}. Файлы приложения не изменены.`);
    const chunks=[];let length=0;
    for await(const chunk of response.body){length+=chunk.length;if(length>maxBytes)throw Error('Обновление превышает допустимый размер.');chunks.push(Buffer.from(chunk));}
    return Buffer.concat(chunks);
  }
  throw Error('Слишком много перенаправлений при загрузке.');
}
const crcTable=Array.from({length:256},(_,index)=>{let value=index;for(let bit=0;bit<8;bit++)value=(value>>>1)^((value&1)?0xedb88320:0);return value>>>0;});
export function crc32(bytes){let value=0xffffffff;for(const byte of bytes)value=(value>>>8)^crcTable[(value^byte)&255];return (value^0xffffffff)>>>0;}
function safeRelative(name){
  const parts=name.split('/');
  if(!name||name.includes('\\')||parts.some(part=>!part||part==='.'||part==='..'||/[\x00-\x1f:]/.test(part)||/[. ]$/.test(part)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))throw Error('Небезопасный путь в архиве.');
  if(parts.some(part=>protectedNames.has(part.toLowerCase()))||name==='updates/latest.json')throw Error('Архив пытается заменить пользовательские данные или настройки.');
  return name;
}
function underRoot(root,name){const path=resolve(root,name),local=relative(root,path);if(!local||local.startsWith('..')||isAbsolute(local))throw Error('Путь выходит за пределы установки.');return path;}
function assertNoLinks(root,name){let current=root;for(const part of name.split('/')){current=join(current,part);if(existsSync(current)&&lstatSync(current).isSymbolicLink())throw Error('Обновление не заменяет файлы через символические ссылки.');}}
function assertTreeNoLinks(path){if(!existsSync(path))return;if(lstatSync(path).isSymbolicLink())throw Error('Для резервного копирования нужны обычные папки, без символических ссылок.');if(lstatSync(path).isDirectory())for(const name of readdirSync(path))assertTreeNoLinks(join(path,name));}
export function unpackArchive(bytes,destination){
  let eocd=-1;for(let position=bytes.length-22;position>=Math.max(0,bytes.length-65557);position--)if(bytes.readUInt32LE(position)===0x06054b50&&position+22+bytes.readUInt16LE(position+20)===bytes.length){eocd=position;break;}
  if(eocd<0||bytes.readUInt16LE(eocd+4)||bytes.readUInt16LE(eocd+6))throw Error('Повреждённый или неподдерживаемый ZIP.');
  const count=bytes.readUInt16LE(eocd+10),central=bytes.readUInt32LE(eocd+16),centralSize=bytes.readUInt32LE(eocd+12);
  if(count>2000||count===65535||central+centralSize>eocd)throw Error('Некорректный каталог ZIP.');
  let cursor=central,total=0;const entries=[],names=new Set();
  for(let index=0;index<count;index++){
    if(cursor+46>eocd||bytes.readUInt32LE(cursor)!==0x02014b50)throw Error('Повреждён каталог ZIP.');
    const flags=bytes.readUInt16LE(cursor+8),method=bytes.readUInt16LE(cursor+10),crc=bytes.readUInt32LE(cursor+16),compressed=bytes.readUInt32LE(cursor+20),size=bytes.readUInt32LE(cursor+24),nameLength=bytes.readUInt16LE(cursor+28),extra=bytes.readUInt16LE(cursor+30),comment=bytes.readUInt16LE(cursor+32),attributes=bytes.readUInt32LE(cursor+38),offset=bytes.readUInt32LE(cursor+42);
    if(cursor+46+nameLength+extra+comment>central+centralSize||flags&1||![0,8].includes(method)||bytes.readUInt16LE(cursor+34))throw Error('Неподдерживаемый ZIP-объект.');
    const original=bytes.subarray(cursor+46,cursor+46+nameLength).toString('utf8');cursor+=46+nameLength+extra+comment;
    if(!original.startsWith('registration-assistant/'))throw Error('В архиве отсутствует папка registration-assistant.');
    if(original==='registration-assistant/')continue;
    const directory=original.endsWith('/'),name=safeRelative(original.slice('registration-assistant/'.length).replace(/\/$/,'')),type=(attributes>>>16)&0xf000;
    if(type&&type!==0x8000&&type!==0x4000)throw Error('Ссылки и специальные файлы в ZIP запрещены.');
    if(directory)continue;
    if(names.has(name.toLowerCase()))throw Error('В архиве повторяются имена файлов.');names.add(name.toLowerCase());
    total+=size;if(total>MAX_UNPACKED||size>MAX_UNPACKED)throw Error('Распакованный архив слишком большой.');
    if(offset+30>central||bytes.readUInt32LE(offset)!==0x04034b50||bytes.readUInt16LE(offset+6)!==flags||bytes.readUInt16LE(offset+8)!==method)throw Error('Повреждён заголовок ZIP-файла.');
    const localNameLength=bytes.readUInt16LE(offset+26),localExtra=bytes.readUInt16LE(offset+28),start=offset+30+localNameLength+localExtra;
    if(start+compressed>central||bytes.subarray(offset+30,offset+30+localNameLength).toString('utf8')!==original)throw Error('Повреждён путь или размер ZIP-файла.');
    const payload=bytes.subarray(start,start+compressed),content=method===0?payload:inflateRawSync(payload,{maxOutputLength:MAX_UNPACKED});
    if(content.length!==size||crc32(content)!==crc)throw Error('Контрольная сумма файла ZIP не совпала.');
    entries.push({name,content});
  }
  if(cursor!==central+centralSize)throw Error('Некорректная длина каталога ZIP.');
  // Validate every entry before writing any of the extracted files.
  for(const {name,content} of entries){const path=underRoot(destination,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,content,{mode:0o600,flag:'wx'});}
  return entries.map(entry=>entry.name);
}
function run(command,args,cwd){return new Promise((done,reject)=>{const child=spawn(command,args,{cwd,stdio:'inherit',shell:false,windowsHide:true});child.once('error',reject);child.once('exit',code=>code===0?done():reject(Error(`Команда ${basename(command)} завершилась с кодом ${code}.`)));});}
export async function installDependencies(stage){
  if(process.platform==='win32'){
    const npm=join(dirname(process.execPath),'node_modules','npm','bin','npm-cli.js');if(!existsSync(npm))throw Error('npm не найден рядом с Node.js. Переустановите Node.js 24 LTS.');
    await run(process.execPath,[npm,'ci','--ignore-scripts','--omit=dev','--no-fund','--no-audit'],stage);
  }else await run('npm',['ci','--ignore-scripts','--omit=dev','--no-fund','--no-audit'],stage);
}
export async function verifyStage(stage){await run(process.execPath,['--check',join(stage,'server.js')],stage);await run(process.execPath,['--disable-warning=ExperimentalWarning',join(stage,'scripts','verify-container.js')],stage);}
function readJson(path){return JSON.parse(readFileSync(path,'utf8'));}
export function installationSettings(target){
  const env=existsSync(join(target,'.env'))?parseEnv(readFileSync(join(target,'.env'),'utf8')):{};
  if((process.env.RUNTIME_DIR||env.RUNTIME_DIR)&&resolve(target,process.env.RUNTIME_DIR||env.RUNTIME_DIR)!==join(target,'.runtime'))throw Error('Этот обновлятор предназначен для запуска через Node.js. Установку Docker обновляйте на хосте по серверной инструкции.');
  const runtimePath=join(target,'.runtime','instance.json');let instance;
  if(existsSync(runtimePath))instance=readJson(runtimePath);
  if(instance&&instance.root!==target)throw Error('Служебный файл принадлежит другой установке.');
  const port=Number(instance?.port||process.env.PORT||env.PORT||3100),host=instance?.host||process.env.HOST||env.HOST||'127.0.0.1';
  if(!Number.isInteger(port)||port<1||port>65535||!['127.0.0.1','localhost','0.0.0.0','::','::1'].includes(host))throw Error('Для этой настройки адреса остановите приложение вручную; автоматический перезапуск поддерживает localhost / 0.0.0.0.');
  return {port,host,dataDir:resolve(target,instance?.dataDir||process.env.DATA_DIR||env.DATA_DIR||'data'),instance,base:`http://${host==='::1'||host==='::'?'[::1]':'127.0.0.1'}:${port}`};
}
async function localHealth(settings){try{const response=await localRequest(settings,'/api/health',{timeout:1500});if(!response.ok)return {occupied:true};try{return await response.json();}catch{return {occupied:true};}}catch(error){if(error.code==='ECONNREFUSED')return null;throw Error('Не удалось проверить локальный сервер. Остановите его окно и повторите обновление.');}}
export async function inspectServer(target,settings){
  const health=await localHealth(settings);
  if(!health)return false;
  const instance=settings.instance;
  if(!instance||health.instanceId!==instance.instanceId||instance.root!==target||!instance.updateToken)throw Error('Перед первым обновлением остановите старое окно Start-Windows.cmd сочетанием Ctrl+C. Другие процессы обновлятор не завершает.');
  return true;
}
export async function stopServer(target,settings){
  if(!await inspectServer(target,settings))return;
  const response=await localRequest(settings,'/internal/update-stop',{method:'POST',headers:{'X-Assistant-Update':settings.instance.updateToken},timeout:5000});
  if(!response.ok)throw Error('Приложение не подтвердило безопасную остановку.');
  const deadline=Date.now()+30000;
  while(Date.now()<deadline){if(!existsSync(join(target,'.runtime','instance.json'))&&!await localHealth(settings))return;await delay(200);}
  throw Error('Приложение не завершило работу. Обновление не установлено.');
}
export async function startServer(target,settings,expectedVersion){
  const folder=join(target,'.runtime');mkdirSync(folder,{recursive:true,mode:0o700});const log=openSync(join(folder,'server.log'),'a',0o600);
  const child=spawn(process.execPath,['--disable-warning=ExperimentalWarning',join(target,'server.js')],{cwd:target,env:{...process.env,PORT:String(settings.port),HOST:settings.host,DATA_DIR:settings.dataDir},detached:true,stdio:['ignore',log,log],windowsHide:true});closeSync(log);child.unref();
  let launchError;child.once('error',error=>{launchError=error;});
  const deadline=Date.now()+25000;
  while(Date.now()<deadline){
    if(launchError)throw launchError;
    const health=await localHealth(settings);
    if(health?.version===expectedVersion&&health.project==='registration-assistant'){
      const metadata=readJson(join(folder,'instance.json'));if(metadata.root!==target||metadata.instanceId!==health.instanceId)throw Error('Ответил другой экземпляр приложения.');
      const page=await localRequest(settings,'/');if(page.ok&&(await page.text()).includes('Помощник регистраций'))return metadata;
    }
    if(child.exitCode!==null)throw Error('Новая версия не запустилась. Подробности — в .runtime/server.log.');
    await delay(250);
  }
  throw Error('Новая версия не прошла проверку запуска.');
}
function copyPrivate(source,target){if(!existsSync(source))return;assertTreeNoLinks(source);mkdirSync(dirname(target),{recursive:true,mode:0o700});cpSync(source,target,{recursive:true,errorOnExist:true,force:false});}
function saveCodeBackup(target,backup,names){
  const existing=[];
  for(const name of names){safeRelative(name);assertNoLinks(target,name);const source=underRoot(target,name);if(existsSync(source)){if(!lstatSync(source).isFile())throw Error('Вместо файла программы обнаружена папка.');const destination=underRoot(join(backup,'code'),name);mkdirSync(dirname(destination),{recursive:true,mode:0o700});cpSync(source,destination);existing.push(name);}}
  return existing;
}
function restore(target,backup,names,existing,settings,hadModules){
  const saved=new Set(existing);
  for(const name of names){const destination=underRoot(target,name);if(saved.has(name)){mkdirSync(dirname(destination),{recursive:true});cpSync(underRoot(join(backup,'code'),name),destination);}else rmSync(destination,{force:true});}
  if(existsSync(join(backup,'node_modules'))){rmSync(join(target,'node_modules'),{recursive:true,force:true});renameSync(join(backup,'node_modules'),join(target,'node_modules'));}
  else if(!hadModules)rmSync(join(target,'node_modules'),{recursive:true,force:true});
  if(existsSync(join(backup,'data'))){rmSync(settings.dataDir,{recursive:true,force:true});cpSync(join(backup,'data'),settings.dataDir,{recursive:true});}
  if(existsSync(join(backup,'previous-state.json')))cpSync(join(backup,'previous-state.json'),join(target,'.update-state.json'));else rmSync(join(target,'.update-state.json'),{force:true});
}
export async function updateInstallation({target,start=false,noStart=false,fetcher=fetch,install=installDependencies,verify=verifyStage,log=console.log,server={inspect:inspectServer,stop:stopServer,start:startServer},onApplied}={}){
  target=realpathSync(resolve(target));const packageFile=join(target,'package.json'),current=readJson(packageFile);
  if(current.name!=='registration-assistant'||!/^\d+\.\d+\.\d+$/.test(current.version))throw Error('Выберите папку помощника с package.json и Start-Windows.cmd.');
  const runtime=join(target,'.runtime');mkdirSync(runtime,{recursive:true,mode:0o700});
  const lock=join(runtime,'update.lock');let lockDescriptor;
  try{lockDescriptor=openSync(lock,'wx',0o600);writeFileSync(lockDescriptor,String(process.pid));}catch{throw Error('Обновление уже выполняется. Если оно было прервано, сначала проверьте .runtime/update-journal.json и резервную копию.');}
  let stage,backup,stopped=false,applied=false,wasRunning=false,settings,names=[],existing=[],hadModules=false;
  try{
    if(existsSync(join(runtime,'update-journal.json')))throw Error('Осталось незавершённое обновление. Сначала восстановите копию, указанную в .runtime/update-journal.json.');
    settings=installationSettings(target);if(settings.dataDir===target||target.startsWith(settings.dataDir+'/')||target.startsWith(settings.dataDir+'\\'))throw Error('Папка данных должна быть отдельной от корня программы.');
    wasRunning=await server.inspect(target,settings);
    log('Проверяем обновление на GitHub…');const release=validateRelease(JSON.parse((await download(MANIFEST_URL,65536,fetcher)).toString('utf8')));
    if(compareVersions(release.version,current.version)<=0){if(start&&!noStart&&!wasRunning)await server.start(target,settings,current.version);log(`Уже установлена актуальная версия ${current.version}.`);return {updated:false,version:current.version};}
    const archive=await download(release.archive,MAX_ZIP,fetcher);if(archive.length!==release.bytes||sha256(archive)!==release.sha256)throw Error('SHA-256 архива не совпала. Обновление отменено, файлы не изменены.');
    stage=mkdtempSync(join(dirname(target),'.registration-assistant-stage-'));const nextNames=unpackArchive(archive,stage),next=readJson(join(stage,'package.json'));
    if(next.name!==current.name||next.version!==release.version||!nextNames.includes('server.js')||!nextNames.includes('package-lock.json'))throw Error('Архив не соответствует заявленной версии приложения.');
    const previous=existsSync(join(target,'.update-state.json'))?readJson(join(target,'.update-state.json')).files:[];
    if(!Array.isArray(previous))throw Error('Некорректный список файлов предыдущей установки.');
    names=[...new Set([...nextNames,...previous])];for(const name of names){safeRelative(name);assertNoLinks(target,name);const path=underRoot(target,name);if(path===settings.dataDir||path.startsWith(settings.dataDir+'/')||path.startsWith(settings.dataDir+'\\'))throw Error('Архив затрагивает настроенную папку данных.');}
    log('Готовим зависимости во временной папке…');await install(stage);await verify(stage);
    if(wasRunning){log('Безопасно останавливаем приложение…');await server.stop(target,settings);stopped=true;}
    else if(await server.inspect(target,installationSettings(target)))throw Error('Приложение запущено во время подготовки. Повторите обновление.');
    const backupRoot=join(dirname(target),basename(target)+'-backups');mkdirSync(backupRoot,{recursive:true,mode:0o700});
    backup=join(backupRoot,new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8));mkdirSync(backup,{mode:0o700});
    if(backup.startsWith(settings.dataDir+'/')||backup.startsWith(settings.dataDir+'\\'))throw Error('Резервная копия должна находиться вне папки данных.');
    log('Сохраняем резервную копию…');existing=saveCodeBackup(target,backup,names);copyPrivate(settings.dataDir,join(backup,'data'));copyPrivate(join(target,'.env'),join(backup,'config','.env'));copyPrivate(join(target,'deploy','.env'),join(backup,'config','deploy.env'));copyPrivate(join(target,'.update-state.json'),join(backup,'previous-state.json'));
    writeFileSync(join(backup,'backup.json'),JSON.stringify({target,from:current.version,to:release.version,files:names,existing,dataDir:settings.dataDir},null,2),{mode:0o600});
    writeFileSync(join(runtime,'update-journal.json'),JSON.stringify({backup,from:current.version,to:release.version}),{mode:0o600});writeFileSync(join(runtime,'update-in-progress'),'1',{mode:0o600});
    applied=true;hadModules=existsSync(join(target,'node_modules'));if(hadModules)renameSync(join(target,'node_modules'),join(backup,'node_modules'));
    for(const name of nextNames){const destination=underRoot(target,name),source=underRoot(stage,name);if(existsSync(destination)&&sha256(readFileSync(destination))===sha256(readFileSync(source)))continue;mkdirSync(dirname(destination),{recursive:true});const temporary=destination+'.update-'+randomUUID();cpSync(source,temporary);renameSync(temporary,destination);}
    for(const name of previous.filter(name=>!nextNames.includes(name)))rmSync(underRoot(target,name),{force:true});
    if(existsSync(join(stage,'node_modules')))renameSync(join(stage,'node_modules'),join(target,'node_modules'));
    await onApplied?.(target);
    if(!noStart&&(start||wasRunning))await server.start(target,settings,release.version);
    writeFileSync(join(target,'.update-state.json'),JSON.stringify({version:release.version,sha256:release.sha256,files:nextNames},null,2),{mode:0o600});
    rmSync(join(runtime,'update-journal.json'));rmSync(join(runtime,'update-in-progress'));
    log(`Обновлено до ${release.version}. Резервная копия: ${backup}`);log('В Dolphin перезагрузите расширение в chrome://extensions. Страницу анкеты обновляйте после сохранения черновика.');
    return {updated:true,version:release.version,backup};
  }catch(error){
    if(applied){
      log('Проверка обновления не прошла. Возвращаем предыдущую версию…');
      try{const state=installationSettings(target);if(await server.inspect(target,state))await server.stop(target,state);restore(target,backup,names,existing,settings,hadModules);rmSync(join(runtime,'update-in-progress'),{force:true});rmSync(join(runtime,'update-journal.json'),{force:true});if(wasRunning&&!noStart)await server.start(target,settings,current.version);log('Предыдущая версия и данные восстановлены.');}
      catch(rollback){throw Error(`Обновление не завершено, автоматический откат требует проверки. Копия: ${backup}. ${rollback.message}`,{cause:error});}
    }else if(stopped&&wasRunning&&!noStart){try{await server.start(target,settings,current.version);}catch{/* preserve the original diagnosis and backup */}}
    throw error;
  }finally{if(stage)rmSync(stage,{recursive:true,force:true});if(lockDescriptor!==undefined)closeSync(lockDescriptor);rmSync(lock,{force:true});}
}
function chooseTarget(){
  try{if(readJson(join(process.cwd(),'package.json')).name==='registration-assistant')return process.cwd();}catch{}
  if(process.platform==='win32'){
    const result=spawnSync('powershell.exe',['-NoProfile','-STA','-Command',"[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); Add-Type -AssemblyName System.Windows.Forms; $dialog=New-Object System.Windows.Forms.FolderBrowserDialog; $dialog.Description='Выберите установленную папку помощника с файлом Start-Windows.cmd'; if($dialog.ShowDialog() -eq 'OK'){[Console]::Write($dialog.SelectedPath)}"],{encoding:'utf8',windowsHide:false});
    if(result.status!==0||!result.stdout.trim())throw Error('Папка не выбрана. Обновление отменено.');return result.stdout.trim();
  }
  throw Error('Перейдите в папку помощника или укажите --target /путь/к/папке.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(Number(process.versions.node.split('.')[0])<24)throw Error('Установите Node.js 24 LTS.');
    const args=process.argv.slice(2),position=args.indexOf('--target'),target=position>=0?args[position+1]:chooseTarget();
    if(!target||args.some((arg,index)=>!['--start','--no-start','--target'].includes(arg)&&!(position>=0&&index===position+1)))throw Error('Допустимые параметры: --target PATH, --start, --no-start.');
    await updateInstallation({target,start:args.includes('--start'),noStart:args.includes('--no-start')});
  }catch(error){console.error(error.message);process.exitCode=1;}
}
