import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

export async function saveKey(key, directory = process.cwd()) {return saveEnvKey('BRAVE_SEARCH_API_KEY',key,directory);}
export async function saveEnvKey(variable,key,directory=process.cwd()) {
  if(!['BRAVE_SEARCH_API_KEY','OPENAI_API_KEY','GEMINI_API_KEY','APP_PASSWORD','VIEW_PASSWORD'].includes(variable))throw new Error('Unknown key setting');
  const password=['APP_PASSWORD','VIEW_PASSWORD'].includes(variable);
  if(password?(typeof key!=='string'||key.length<12||key.length>256||/[\r\n\x00']/.test(key)):!/^[a-zA-Z0-9_.=+\/-]{10,512}$/.test(key))throw new Error(password?'Пароль: от 12 до 256 символов, без апострофа и перевода строки.':'Проверьте ключ: вставьте только значение API-ключа.');
  const file = resolve(directory,'.env');
  let existing = '';
  try { existing = await readFile(file,'utf8'); } catch(error) { if(error.code !== 'ENOENT') throw error; }
  const line = `${variable}=${password?"'"+key+"'":key}`;
  const setting=new RegExp(`^\\s*(?:export\\s+)?${variable}\\s*=`,'m');
  const assignments=new RegExp(`^\\s*(?:export\\s+)?${variable}\\s*=.*$`,'gm');
  const content = setting.test(existing)
    ? existing.replace(assignments,()=>line)
    : `${existing}${existing && !existing.endsWith('\n') ? '\n' : ''}${line}\n`;
  const temp = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temp,content,{mode:0o600,flag:'wx'}); await rename(temp,file); }
  catch(error) { await unlink(temp).catch(()=>{}); throw error; }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if(!process.stdin.isTTY) { console.error('Запустите npm run configure в Терминале.'); process.exitCode=1; }
  else {
    console.log('Получите ключ на https://brave.com/search/api/ . Проверьте тариф и лимиты.\nКлюч будет сохранён локально в .env. Не отправляйте этот файл другим.');
    const output=new Writable({write(_chunk,_encoding,done){done();}});
    const prompt=createInterface({input:process.stdin,output,terminal:true});
    try {
      process.stdout.write('Вставьте ключ Brave и нажмите Enter (ввод скрыт): ');
      const key=(await prompt.question('')).trim(); process.stdout.write('\n');
      if(!key) console.log('Ключ не изменён.');
      else { await saveKey(key); console.log('Ключ сохранён. Запустите npm start. Доступ к API проверится при первом поиске.'); }
    } catch { console.error('Не удалось сохранить ключ. Проверьте ввод и права на папку проекта.'); process.exitCode=1; }
    finally {prompt.close();}
  }
}
