import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
import {saveEnvKey} from './configure-brave.js';
if(!process.stdin.isTTY){console.error('Запустите npm run configure:ai в Терминале.');process.exitCode=1;}
else{
 console.log('Создайте отдельный API-ключ на https://platform.openai.com/api-keys .\nПополните баланс API: подписка ChatGPT его не включает.\nКлюч сохраняется только в .env. Не присылайте его в чат.');
 const output=new Writable({write(_chunk,_encoding,done){done();}}),prompt=createInterface({input:process.stdin,output,terminal:true});
 try{process.stdout.write('Вставьте ключ OpenAI и нажмите Enter (ввод скрыт): ');const key=(await prompt.question('')).trim();process.stdout.write('\n');if(key){await saveEnvKey('OPENAI_API_KEY',key);console.log('Ключ сохранён, Brave не изменён. Перезапустите программу и откройте «Нейронный поиск».');}else console.log('Ключ не изменён.');}
 catch{console.error('Не удалось сохранить ключ. Проверьте ввод и права на папку программы.');process.exitCode=1;}
 finally{prompt.close();}
}
