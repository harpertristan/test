import {readFile,access,stat,statfs} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve} from 'node:path';
import {loadStoredState} from '../lib/state-journal.js';
const packageData=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
console.log(`Play Scout ${packageData.version}`);
console.log(`Node.js: ${process.versions.node}`);
console.log(`Рабочая папка: ${process.cwd()}`);
if(Number(process.versions.node.split('.')[0])<22){console.log('Нужен Node.js 22+');process.exitCode=1;}
try{process.loadEnvFile('.env');console.log('Файл .env: прочитан');}
catch(error){console.log(error.code==='ENOENT'?'Файл .env: отсутствует (Google Play может работать)':'Файл .env: ошибка чтения');}
console.log(`Ключ Brave: ${process.env.BRAVE_SEARCH_API_KEY?'задан, проверьте кнопкой в приложении':'не задан'}`);
console.log(`Ключ OpenAI: ${process.env.OPENAI_API_KEY?'задан, проверьте на вкладке «Нейронный поиск»':'не задан (необязателен)'}`);
console.log(`Ключ Gemini: ${process.env.GEMINI_API_KEY?'задан, проверьте выбранный облачный ИИ в CRM':'не задан (необязателен)'}`);
try{for(const name of ['proper-lockfile','fast-json-patch','json5','got','cheerio','ramda','tough-cookie','https-proxy-agent'])await access('node_modules/'+name);console.log('Зависимости: установлены. Google Play: разбор литералов без выполнения кода страницы.');}
catch{console.log('Зависимости: выполните npm ci --ignore-scripts');process.exitCode=1;}
try{
  const storage=await loadStoredState(`${process.env.DATA_DIR || './data'}/state.json`),state=storage.state;
  if(process.argv.includes('--storage')){
   console.log('Проверка хранилища: только чтение, без изменения истории и API.');
   const folder=resolve(process.env.DATA_DIR||'./data');
   try{const disk=await statfs(folder);console.log('Свободно на диске: '+(disk.bavail*disk.bsize/1024**3).toFixed(2)+' ГБ');}catch(e){console.log('Свободное место: не удалось прочитать ('+(e.code??'UNKNOWN')+').');}
   try{await access(folder,constants.W_OK);console.log('Права папки data: предварительная проверка записи пройдена; фактическая запись не выполнялась.');}catch(e){console.log('Права папки data: '+(e.code??'UNKNOWN'));}
   console.log('Снимок: '+storage.snapshotBytes+' байт; журнал: '+storage.rawBytes+' байт; подтверждённая транзакция: '+storage.seq+'.');
   console.log('Снимок и журнал: согласованы.'+(storage.rawBytes>storage.validBytes?' Последняя незавершённая строка не считается сохранённой транзакцией.':''));
   try{await stat(resolve(folder,'state.json.lock'));console.log('Блокировка записи: найдена; сама по себе не доказывает наличие второго экземпляра.');}catch(e){console.log(e.code==='ENOENT'?'Блокировка записи: сейчас отсутствует.':'Блокировка записи: '+(e.code??'UNKNOWN'));}
  }
  if(state?.version!==1 || !Array.isArray(state.findings) || !Array.isArray(state.jobs) || !state.schedule)throw new Error('Invalid history shape');
  console.log(`История: ${state.findings?.length ?? 0} приложений, ${state.reviewCandidates?.length ?? 0} кандидатов`);
  if(state.ai?.config?.engine==='llamacpp')console.log('GPU-серверы: '+state.ai.config.localEndpoints.join(', ')+'; alias: '+state.ai.config.localModel);
  console.log(`ИИ: ${state.ai?.config?.engine==='hybrid'?'GPT + Ollama (общая очередь)':state.ai?.config?.engine==='llamacpp'?'llama.cpp (GPU-пул)':state.ai?.config?.engine==='ollama'?'Ollama (локально)':state.ai?.config?.engine==='gemini'?'Gemini API':'OpenAI API'}; режим: ${state.ai?.config?.mode??'economy'}; модель Ollama: ${state.ai?.config?.ollamaModel??'qwen2.5:3b'}`);
  console.log(`Профиль: ${state.schedule?.filters?.profile ?? 'старая версия, требуется перезапуск'}`);
}catch(error){if(error.code==='ENOENT')console.log('История: появится при первом запуске');else{console.log('История: ошибка чтения. Сохраните файл и проверьте резервную копию; не удаляйте data.');process.exitCode=1;}}
if(process.argv.includes('--play')){
 console.log('Проверка Google Play: два обращения, без Brave и без изменения истории. Предел каждого — 30 секунд.');
 const [{liveProvider},{runProvider},{publicError}]=await Promise.all([import('../lib/provider.js'),import('../lib/run-context.js'),import('../lib/search.js')]);
 const provider=runProvider(liveProvider(),new AbortController().signal);
 for(const [label,operation]of[
  ['Поиск AT / business account',()=>provider.search({term:'business account',country:'at',lang:'en',num:50,price:'free'})],
  ['Карточка Wamo / AT',()=>provider.app({appId:'com.wamo.business',country:'at',lang:'en'})]
 ]){
  const start=Date.now();
  try{const result=await operation();console.log(`${label}: ответ получен за ${((Date.now()-start)/1000).toFixed(1)} с; ${Array.isArray(result)?`карточек: ${result.length}`:result.title?'карточка прочитана':'данные неполные'}.`);}
  catch(error){const safe=publicError(error);console.log(`${label}: ${safe.code} — ${safe.message} (${((Date.now()-start)/1000).toFixed(1)} с).`);process.exitCode=1;}
 }
 console.log('Brave этим тестом не проверяется. Ключ проверяйте кнопкой в приложении.');
}else console.log('Для проверки подключения Google Play: npm run doctor -- --play. Доступ Brave проверяется кнопкой в приложении.');
