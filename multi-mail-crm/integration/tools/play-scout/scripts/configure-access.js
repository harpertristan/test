import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
import {saveEnvKey} from './configure-brave.js';
if(!process.stdin.isTTY){console.error('Запустите npm run configure:access в окне терминала.');process.exitCode=1;}
else{
 try{process.loadEnvFile();}catch(e){if(e.code!=='ENOENT')throw e;}
 let hasOwner=Boolean(process.env.APP_PASSWORD);
 const output=new Writable({write(_c,_e,done){done();}}),prompt=createInterface({input:process.stdin,output,terminal:true});
 try{
  console.log('Логин владельца: admin. Логин для просмотра: viewer. Оставьте поле пустым, чтобы сохранить прежнее значение.');
  for(const [name,label]of [['APP_PASSWORD','Пароль владельца'],['VIEW_PASSWORD','Пароль для просмотра']]){process.stdout.write(label+' (не менее 12 символов, ввод скрыт): ');const value=await prompt.question('');process.stdout.write('\n');if(value){if(name==='VIEW_PASSWORD'&&!hasOwner)throw Error('Сначала задайте пароль владельца.');if(value.length<12)throw Error('Пароль должен содержать не менее 12 символов.');await saveEnvKey(name,value);if(name==='APP_PASSWORD')hasOwner=true;}}
  console.log('Настройки входа сохранены. Перезапустите программу.');
 }catch(e){console.error(e.message);process.exitCode=1;}finally{prompt.close();}
}
