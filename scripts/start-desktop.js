import {fork,spawn} from 'node:child_process';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
const root=fileURLToPath(new URL('..',import.meta.url));process.chdir(root);
try{process.loadEnvFile(resolve(root,'.env'));}catch(e){if(e.code!=='ENOENT')throw e;}
const port=Number(process.env.PORT||3000);if(!Number.isInteger(port)||port<1||port>65535)throw Error('Проверьте PORT в .env.');
const url=`http://127.0.0.1:${port}/crm`;
const version=JSON.parse(await readFile(resolve(root,'package.json'),'utf8')).version;
function health(){return new Promise(r=>{let connected=false;const q=http.get(`http://127.0.0.1:${port}/api/health`,s=>{let body='';s.on('data',b=>body+=b);s.on('end',()=>{try{r({...JSON.parse(body),busy:true});}catch{r({busy:true});}});});q.on('socket',s=>s.once('connect',()=>connected=true));q.setTimeout(800,()=>q.destroy());q.on('error',()=>r(connected?{busy:true}:null));});}
function open(){if(process.env.PLAY_SCOUT_NO_BROWSER==='1')return;const [command,args]=process.platform==='win32'?['cmd.exe',['/d','/c','start','',url]]:process.platform==='darwin'?['open',[url]]:['xdg-open',[url]];const p=spawn(command,args,{stdio:'ignore',detached:true});p.on('error',()=>console.log('Откройте браузер: '+url));p.unref();}
const old=await health();
if(old?.status==='ok'&&old.source==='Google Play'){
 if(old.version!==version){console.error(`Работает версия ${old.version}. Остановите её через Control+C перед запуском ${version}.`);process.exitCode=1;}
 else{console.log('Play Scout '+version+' уже работает. '+url);open();}
}
else if(old?.busy){console.error('Локальный порт занят или программа не отвечает. Остановите прежний экземпляр перед запуском.');process.exitCode=1;}
else{
 const child=fork(resolve(root,'server.js'),[],{cwd:root,stdio:['inherit','inherit','inherit','ipc'],env:{...process.env,HOST:process.env.HOST||(process.env.APP_PASSWORD?'0.0.0.0':'127.0.0.1')}});
 let timer,stopping=false,opened=false;const started=Date.now();
 const stop=()=>{if(stopping)return;stopping=true;clearInterval(timer);if(child.connected)child.send({type:'shutdown'});const deadline=setTimeout(()=>child.kill(),10000);deadline.unref();};
 process.on('SIGINT',stop);process.on('SIGTERM',stop);
 timer=setInterval(async()=>{if(opened||stopping)return;const result=await health();if(result?.status==='ok'&&result.source==='Google Play'){opened=true;clearInterval(timer);open();console.log('Браузер открыт. Для завершения используйте Control+C или файл 3-Stop.cmd.');}else if(Date.now()-started>30000){clearInterval(timer);console.log('Запуск занимает больше времени. Проверьте сообщения выше. Адрес: '+url);}},300);
 child.on('exit',code=>{clearInterval(timer);process.exitCode=code??0;});
}
