import {Worker} from 'node:worker_threads';
let queue=Promise.resolve(),pending=0;
export async function extractDocument(buffer,filename) {
  if(pending>=4)throw new Error('Очередь распознавания заполнена. Повторите загрузку позже.');
  pending++;
  let release;const previous=queue;queue=new Promise(resolve=>{release=resolve;});
  await previous;
  try{return await runExtraction(buffer,filename);}finally{pending--;release();}
}
function runExtraction(buffer,filename) {
  return new Promise((resolve,reject) => {
    const worker = new Worker(new URL('./extract-worker.js',import.meta.url),{workerData:{buffer,filename},resourceLimits:{maxOldGenerationSizeMb:512}});
    const timer = setTimeout(() => {void worker.terminate();reject(new Error('Обработка заняла больше 180 секунд. Разделите документ.'));},180000);
    worker.once('message',result => {clearTimeout(timer);void worker.terminate();result.error ? reject(new Error(result.error)) : resolve(result.pages);});
    worker.once('error',error => {clearTimeout(timer);reject(error);});
    worker.once('exit',code => {clearTimeout(timer);if(code)reject(new Error('Не удалось обработать документ в доступной памяти.'));});
  });
}
