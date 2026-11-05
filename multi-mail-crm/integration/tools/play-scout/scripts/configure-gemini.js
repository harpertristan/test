import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
import {saveEnvKey} from './configure-brave.js';
if(!process.stdin.isTTY){console.error('Запустите npm run configure:gemini в окне терминала.');process.exitCode=1;}
else{
 console.log('Создайте ключ Gemini API: https://aistudio.google.com/apikey . Доступность моделей, бесплатные квоты и цены зависят от вашего аккаунта. Ключ хранится в .env.');
 const output=new Writable({write(_c,_e,done){done();}}),prompt=createInterface({input:process.stdin,output,terminal:true});
 try{process.stdout.write('Вставьте ключ Gemini и нажмите Enter (ввод скрыт): ');const key=(await prompt.question('')).trim();process.stdout.write('\n');if(key){await saveEnvKey('GEMINI_API_KEY',key);console.log('Ключ сохранён. Перезапустите программу и выберите Gemini в настройках CRM.');}else console.log('Ключ не изменён.');}catch{console.error('Не удалось сохранить ключ.');process.exitCode=1;}finally{prompt.close();}
}
