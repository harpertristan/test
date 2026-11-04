import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
import {openDatabase} from '../lib/database.js';
import {hashPassword} from '../lib/security.js';
import {resolve} from 'node:path';
try{process.loadEnvFile();}catch(error){if(error.code!=='ENOENT')throw error;}
let muted=false;
const output=new Writable({write(chunk,_encoding,callback){if(!muted)process.stdout.write(chunk);callback();}});
const rl=createInterface({input:process.stdin,output,terminal:process.stdin.isTTY});
let db;
try {
  const username=(await rl.question('Логин нового пользователя (латиница): ')).trim();
  if(!/^[a-zA-Z0-9_.-]{3,50}$/.test(username))throw Error('Логин: 3–50 символов, латинские буквы, цифры, точка, дефис.');
  process.stdout.write('Пароль (от 14 символов; ввод скрыт): ');muted=true;const password=await rl.question('');muted=false;process.stdout.write('\n');
  process.stdout.write('Повторите пароль: ');muted=true;const confirmation=await rl.question('');muted=false;process.stdout.write('\n');
  if(password.length<14||password.length>200||password!==confirmation)throw Error('Пароли должны совпадать и содержать от 14 до 200 символов.');
  db=openDatabase(resolve(process.env.DATA_DIR||'./data'));
  if(db.prepare('SELECT COUNT(*) AS n FROM users').get().n>=3)throw Error('Эта версия рассчитана на трёх пользователей.');
  if(db.prepare('SELECT id FROM users WHERE username=?').get(username))throw Error('Такой логин уже существует.');
  db.prepare('INSERT INTO users(username,password) VALUES(?,?)').run(username,hashPassword(password));
  console.log('Пользователь создан. Теперь запустите сервер.');
} catch(error){muted=false;console.error(error.message);process.exitCode=1;}finally{rl.close();db?.close();}
