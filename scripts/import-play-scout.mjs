import {parseEnv} from 'node:util';
import {readFileSync,existsSync,writeFileSync,realpathSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {installationSettings,inspectServer,stopServer,startServer} from './update.mjs';

export function playScoutSettings(text){
  const environment=parseEnv(text),key=environment.OPENAI_API_KEY;
  if(typeof key!=='string'||!/^[-A-Za-z0-9_.=+/]{20,1000}$/.test(key))throw Error('В .env Play Scout не найден корректный OPENAI_API_KEY. Проверьте выбранную папку.');
  const model=environment.OPENAI_MODEL||'gpt-5-mini';
  if(!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,150}$/.test(model))throw Error('В Play Scout указано некорректное название модели.');
  return {key,model};
}
export async function importPlayScout(source,target){
  target=realpathSync(resolve(target));source=realpathSync(resolve(source));
  const project=JSON.parse(readFileSync(join(target,'package.json'),'utf8'));
  if(project.name!=='registration-assistant')throw Error('Запустите команду из папки registration-assistant.');
  if(source===target)throw Error('Выберите папку Play Scout, а не помощника.');
  const {key,model}=playScoutSettings(readFileSync(join(source,'.env'),'utf8'));
  const path=join(target,'.env'),original=existsSync(path)?readFileSync(path,'utf8'):'';
  const content=original.replace(/^[ \t]*(?:export[ \t]+)?(?:AI_API_KEY|AI_MODEL|OPENAI_API_KEY|OPENAI_MODEL)[ \t]*=.*(?:\r?\n|$)/gm,'').trimEnd()+`\nAI_API_KEY=${key}\nAI_MODEL=${model}\n`;
  const settings=installationSettings(target),running=await inspectServer(target,settings);
  if(running)await stopServer(target,settings);
  writeFileSync(path,content,{mode:0o600});
  try{await startServer(target,installationSettings(target),project.version);}
  catch{throw Error('Настройки перенесены, но сервер не запустился. Откройте Start-Windows.cmd. Ключ не выводится.');}
  console.log(`Настройки Play Scout перенесены. Модель: ${model}. Помощник перезапущен. Ключ не отображается.`);
  console.log('Обновите http://127.0.0.1:3100 и нажмите «Проверить подключение». Сохранённый через интерфейс ключ имеет приоритет над настройкой сервера.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{if(!process.argv[2])throw Error('Укажите путь к папке Play Scout.');await importPlayScout(process.argv[2],process.cwd());}
  catch(error){console.error(error.code==='ENOENT'?'Не найдена выбранная папка или файл .env. Проверьте путь к установленному Play Scout.':error.message);process.exitCode=1;}
}
