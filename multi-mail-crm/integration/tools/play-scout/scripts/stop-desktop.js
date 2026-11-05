import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url));process.chdir(root);
try{process.loadEnvFile(resolve(root,'.env'));}catch(e){if(e.code!=='ENOENT')throw e;}
const port=Number(process.env.PORT||3000);
function running(){return new Promise(resolve=>{let connected=false;const request=http.get({hostname:'127.0.0.1',port,path:'/api/health'},res=>{res.resume();resolve(true);});request.on('socket',s=>s.once('connect',()=>connected=true));request.setTimeout(600,()=>request.destroy());request.on('error',()=>resolve(connected));});}
async function waitForStop(){const deadline=Date.now()+12000;while(await running()){if(Date.now()>deadline){console.error('Завершение ещё идёт. Используйте Control+C в окне программы и дождитесь сохранения.');process.exitCode=1;return;}await new Promise(r=>setTimeout(r,200));}console.log('Программа остановлена, очереди сохранены.');}
const req=http.request({hostname:'127.0.0.1',port,path:'/api/system/shutdown',method:'POST',headers:{'Content-Type':'application/json',Authorization:'Basic '+Buffer.from('admin:'+(process.env.APP_PASSWORD||'')).toString('base64')}},res=>{
 res.resume();res.on('end',()=>{if(res.statusCode===202)void waitForStop();else{console.error(res.statusCode===404?'Старая версия: остановите её через Control+C в окне программы.':'Не удалось остановить программу: проверьте пароль владельца в .env.');process.exitCode=1;}});
});req.setTimeout(15000,()=>req.destroy());req.on('error',error=>{if(error.code==='ECONNREFUSED')console.log('Программа уже остановлена.');else{console.error('Программа не отвечает. Остановите её через Control+C в её окне.');process.exitCode=1;}});req.end('{}');
