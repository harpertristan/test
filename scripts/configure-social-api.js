import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
import {saveEnvKey} from './configure-brave.js';
if(!process.stdin.isTTY){console.error('Запустите npm run configure:social-api в Терминале.');process.exitCode=1;}
else{
 const output=new Writable({write(_chunk,_encoding,done){done();}}),prompt=createInterface({input:process.stdin,output,terminal:true});
 try{console.log('Apify: https://console.apify.com/ . Создайте сохранённые задачи для публичного сбора без cookies и входа в соцсеть.');console.log('Явный лимит в задаче: Facebook до 500, LinkedIn до 20 результатов. Денежный предел задайте также в Apify; тарификация зависит от сборщика.');console.log('Ключ и ID задач сохраняются только в локальный .env. Пустое поле сохраняет прежнее значение. Эта команда ничего не запускает.');
  for(const [key,label]of [['APIFY_TOKEN','API token Apify'],['APIFY_FACEBOOK_TASK','ID задачи Facebook (или username~task-name)'],['APIFY_LINKEDIN_TASK','ID задачи LinkedIn (или username~task-name)']]){process.stdout.write(label+' (ввод скрыт): ');const value=(await prompt.question('')).trim();process.stdout.write('\n');if(value)await saveEnvKey(key,value);}
  console.log('Настройки сохранены. Перезапустите CRM и сначала нажмите «Проверить доступ» у выбранной задачи Apify. Платный сбор запускается отдельно.');
 }catch(error){console.error('Не удалось сохранить настройки. Проверьте значение и права на папку проекта.');process.exitCode=1;}finally{prompt.close();}
}
