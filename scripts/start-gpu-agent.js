import {spawn} from 'node:child_process';
import {access,realpath} from 'node:fs/promises';
import {basename,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export function workerPlan({server,model,gpus,port=8081,threads,alias,platform=process.platform}={}){
 if(typeof server!=='string'||!server||typeof model!=='string'||!model.toLowerCase().endsWith('.gguf'))throw Error('Укажите --server (llama-server) и --model (файл .gguf).');
 const devices=gpus===undefined?[platform==='darwin'?null:'0']:String(gpus).split(',');
 if(!devices.length||devices.some(g=>g!==null&&!/^\d+$/.test(g))||new Set(devices).size!==devices.length)throw Error('GPU: номера через запятую без повторов, например 0,1,2,3,4,5.');
 if(platform==='darwin'&&gpus!==undefined)throw Error('Для Mac используйте один Metal-обработчик без --gpus.');
 if(!Number.isInteger(port)||port<1024||port+devices.length-1>65535)throw Error('Проверьте начальный порт.');
 threads=threads??(devices.length>1?2:6);if(!Number.isInteger(threads)||threads<1||threads>128)throw Error('Проверьте --threads.');
 alias=alias??basename(model).replace(/\.gguf$/i,'').toLowerCase();if(!/^[a-zA-Z0-9_.:/-]{1,100}$/.test(alias))throw Error('Укажите короткое имя модели через --alias.');
 return devices.map((gpu,i)=>({gpu,port:port+i,alias,command:resolve(server),args:['--model',resolve(model),'--alias',alias,'--host','127.0.0.1','--port',String(port+i),'--n-gpu-layers','99','--split-mode','none','--ctx-size','4096','--parallel','1','--threads',String(threads),'--flash-attn','auto'],env:{...process.env,...(gpu===null?{}:{CUDA_VISIBLE_DEVICES:gpu})}}));
}
export async function startWorkers(options){
 const plan=workerPlan(options);await access(plan[0].command);await access(resolve(options.model));
 const children=new Set();let stopping=false,failed=false;
 const stop=()=>{if(stopping)return;stopping=true;for(const child of children)child.kill('SIGTERM');};
 process.on('SIGINT',stop);process.on('SIGTERM',stop);
 const completions=[];
 try{for(const worker of plan){if(stopping)break;const completion=new Promise((accept,reject)=>{
  console.log(`GPU ${worker.gpu??'Metal'} · http://127.0.0.1:${worker.port} · ${worker.alias}`);
  const child=spawn(worker.command,worker.args,{env:worker.env,stdio:'inherit',windowsHide:false});children.add(child);
  child.once('error',error=>{children.delete(child);failed=true;stop();reject(error);});
  child.once('exit',code=>{children.delete(child);if(!stopping){failed=true;stop();reject(Error('GPU-обработчик завершился: '+code+'. Проверьте драйвер, путь GGUF и свободную VRAM.'));}else accept();});
 });completions.push(completion);void completion.catch(()=>{});
 // Loading six models at once can spike host RAM. Wait for each GPU before
 // starting the next; inference runs concurrently once the pool is ready.
 const deadline=Date.now()+180000;let ready=false;
 while(!stopping&&Date.now()<deadline){try{const r=await fetch('http://127.0.0.1:'+worker.port+'/health',{signal:AbortSignal.timeout(1000),redirect:'error'});await r.body?.cancel();if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}
 if(!ready&&!stopping){failed=true;stop();throw Error('GPU '+(worker.gpu??'Metal')+' не готов за 180 секунд. Проверьте загрузку модели и свободную память.');}
 if(ready)console.log('Обработчик готов: '+worker.port);
 }await Promise.all(completions);}finally{stop();await Promise.allSettled(completions);process.off('SIGINT',stop);process.off('SIGTERM',stop);}
 if(failed)throw Error('GPU-пул остановлен после ошибки. Автоматического обращения к облачному ИИ нет.');
}
if(process.argv[1]&&await realpath(process.argv[1]).catch(()=>null)===await realpath(fileURLToPath(import.meta.url))){
 try{const args=process.argv.slice(2),options={};while(args.length){const key=args.shift();if(!['--server','--model','--gpus','--port','--threads','--alias'].includes(key)||!args.length)throw Error('Используйте --server ПУТЬ --model ПУТЬ [--gpus 0,1,2,3,4,5] [--port 8081] [--alias ИМЯ].');const value=args.shift();options[key.slice(2)]=['--port','--threads'].includes(key)?Number(value):value;}await startWorkers(options);}catch(e){console.error(e.message);process.exitCode=1;}
}
