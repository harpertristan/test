import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {realpath} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
import {exportProfile,importProfile} from '../lib/profile-transfer.js';

export async function transferCLI(args=process.argv.slice(2)){
 if(!process.stdin.isTTY)throw Error('Откройте Терминал и выполните npm run transfer:export или npm.cmd run transfer:import. Пароль вводится скрыто.');
 const mode=args[0];if(!['export','import'].includes(mode))throw Error('Режим переноса: export или import.');
 const root=resolve(fileURLToPath(new URL('..',import.meta.url))),flag=args.indexOf('--file');if(flag>=0&&!args[flag+1])throw Error('После --file укажите путь.');
 const prompt=createInterface({input:process.stdin,output:process.stdout});let file=flag>=0?args[flag+1]:undefined;
 try{if(!file)file=mode==='export'?join(homedir(),'Desktop','play-scout-transfer-'+new Date().toISOString().replace(/[:.]/g,'-')+'.psbackup'):(await prompt.question('Перетащите сюда файл .psbackup или вставьте полный путь и нажмите Enter: ')).trim().replace(/^(["'])(.*)\1$/,'$2');}finally{prompt.close();}
 if(!file)throw Error('Файл переноса не выбран.');
 const muted=new Writable({write(_chunk,_encoding,done){done();}}),hidden=createInterface({input:process.stdin,output:muted,terminal:true});let password;
 try{console.log(mode==='export'?'Будет создан зашифрованный перенос: история, заметки, исключения, настройки и ключи .env.':'История и ключи из переноса заменят текущий профиль. Для прежнего data / .env создаётся резервная папка.');process.stdout.write(mode==='export'?'Придумайте пароль переноса (от 12 символов, ввод скрыт): ':'Пароль переноса (ввод скрыт): ');password=await hidden.question('');process.stdout.write('\n');if(mode==='export'){process.stdout.write('Повторите пароль переноса: ');const second=await hidden.question('');process.stdout.write('\n');if(password!==second)throw Error('Пароли не совпали. Файл не создан.');}}finally{hidden.close();}
 const result=mode==='export'?await exportProfile(root,resolve(file),password):await importProfile(root,resolve(file),password);password='';
 console.log(mode==='export'?'Готово. Файл переноса: '+result.output:'Готово. Профиль перенесён в '+root);console.log('Версия: '+result.version+'. Файлов истории: '+result.files+'.');for(const [name,present]of Object.entries(result.keys))console.log(name+': '+(present?'перенесён':'не был задан в .env'));
 console.log('Приложений: '+result.summary.apps+'. Разборов: '+result.summary.analyses+'. Исключений: '+result.summary.exclusions+'. Выбранный ИИ: '+result.summary.engine+'.');
 if(result.summary.engine==='ollama'&&/^[a-zA-Z0-9_.:/-]{1,100}$/.test(result.summary.ollamaModel))console.log('Модель для установки на Windows: ollama pull '+result.summary.ollamaModel);
 if(result.backup)console.log('Резервная папка прежнего профиля: '+result.backup);
 if(mode==='export')console.log('Передайте .psbackup на Windows личным способом. Запомните пароль; без него файл не восстановить. Ключи не выведены и никуда не отправлены.');else console.log('Запустите 1-Install.cmd, затем 2-Start.cmd. Выбранная модель и расписания сохранены. Модель Ollama установите отдельно.');
}
if(process.argv[1]&&await realpath(process.argv[1]).catch(()=>null)===await realpath(fileURLToPath(import.meta.url)))transferCLI().catch(e=>{console.error(e.message);process.exitCode=1;});
