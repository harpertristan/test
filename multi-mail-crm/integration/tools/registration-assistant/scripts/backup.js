// Run only while the application is stopped; originals must not change mid-copy.
import {backup} from 'node:sqlite';
import {mkdirSync,cpSync,chmodSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {openDatabase} from '../lib/database.js';
try{process.loadEnvFile();}catch(error){if(error.code!=='ENOENT')throw error;}
if(!process.argv.includes('--server-stopped'))throw Error('Остановите приложение и добавьте --server-stopped.');
const parent=resolve(process.argv[2]||'./backups');
const destination=join(parent,new Date().toISOString().replace(/[:.]/g,'-'));
const source=resolve(process.env.DATA_DIR||'./data');
if(!existsSync(join(source,'assistant.sqlite'))||!existsSync(join(source,'uploads')))throw Error('Действующая база и папка uploads не найдены. Пустая копия не создаётся.');
if(destination===source||destination.startsWith(source+'/')||destination.startsWith(source+'\\'))throw Error('Копия должна быть вне папки данных.');
mkdirSync(destination,{recursive:true,mode:0o700});
const db=openDatabase(source);
try{
  await backup(db,join(destination,'assistant.sqlite'));
  chmodSync(join(destination,'assistant.sqlite'),0o600);
  cpSync(join(source,'uploads'),join(destination,'uploads'),{recursive:true,force:false});
  console.log('Копия базы и оригиналов создана: '+destination);
  console.log('Храните её в закрытом, зашифрованном хранилище. .env копируется отдельно.');
}finally{db.close();}
