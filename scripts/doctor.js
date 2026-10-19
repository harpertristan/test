import {readFile,access} from 'node:fs/promises';
const packageData=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
console.log(`Play Scout ${packageData.version}`);
console.log(`Node.js: ${process.versions.node}`);
console.log(`Рабочая папка: ${process.cwd()}`);
if(Number(process.versions.node.split('.')[0])<22){console.log('Нужен Node.js 22+');process.exitCode=1;}
try{process.loadEnvFile('.env');console.log('Файл .env: прочитан');}
catch(error){console.log(error.code==='ENOENT'?'Файл .env: отсутствует (Google Play может работать)':'Файл .env: ошибка чтения');}
console.log(`Ключ Brave: ${process.env.BRAVE_SEARCH_API_KEY?'задан, проверьте кнопкой в приложении':'не задан'}`);
try{await access('node_modules/google-play-scraper');console.log('Зависимости: установлены');}
catch{console.log('Зависимости: выполните npm ci');process.exitCode=1;}
try{
  const state=JSON.parse(await readFile(`${process.env.DATA_DIR || './data'}/state.json`,'utf8'));
  if(state?.version!==1 || !Array.isArray(state.findings) || !Array.isArray(state.jobs) || !state.schedule)throw new Error('Invalid history shape');
  console.log(`История: ${state.findings?.length ?? 0} приложений, ${state.reviewCandidates?.length ?? 0} кандидатов`);
  console.log(`Профиль: ${state.schedule?.filters?.profile ?? 'старая версия, требуется перезапуск'}`);
}catch(error){if(error.code==='ENOENT')console.log('История: появится при первом запуске');else{console.log('История: ошибка чтения. Сохраните файл и проверьте резервную копию; не удаляйте data.');process.exitCode=1;}}
console.log('Google Play и доступ Brave эта команда не проверяет. Первый поиск и кнопка проверки ключа проверят источники.');
