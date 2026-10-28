import {createInterface} from 'node:readline/promises';
import {realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {importKeys} from '../lib/profile-transfer.js';
async function main(){
 if(!process.stdin.isTTY)throw Error('Запустите 9-Import-keys-only.cmd или npm.cmd run transfer:keys в Терминале.');
 const flag=process.argv.indexOf('--file');let input=flag>=0?process.argv[flag+1]:null;if(flag>=0&&!input)throw Error('После --file укажите путь к PlayScout-keys.env.');
 if(!input){const prompt=createInterface({input:process.stdin,output:process.stdout});try{input=(await prompt.question('Вставьте путь к PlayScout-keys.env с Mac и нажмите Enter: ')).trim().replace(/^(["'])(.*)\1$/,'$2');}finally{prompt.close();}}
 if(!input)throw Error('Файл ключей не выбран.');const root=fileURLToPath(new URL('..',import.meta.url)),result=await importKeys(root,resolve(input));
 console.log('Готово. Ключи перенесены. Версия '+result.version+'. История с Mac не переносилась.');for(const[k,present]of Object.entries(result.keys))console.log(k+': '+(present?'перенесён':'не был задан'));
 if(result.backup)console.log('Резервная копия прежних ключей: '+result.backup);console.log('Запустите 1-Install.cmd, затем 2-Start.cmd. В CRM выберите нужный ИИ до первого разбора.');
}
if(process.argv[1]&&await realpath(process.argv[1]).catch(()=>null)===await realpath(fileURLToPath(import.meta.url)))main().catch(error=>{console.error(error.message);process.exitCode=1;});
