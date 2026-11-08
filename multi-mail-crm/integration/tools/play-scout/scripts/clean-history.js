import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {realpath} from 'node:fs/promises';
import {cleanHistoryFile} from '../lib/history-cleanup.js';
import {requireStopped} from '../lib/profile-transfer.js';

export async function cleanHistoryCLI(args=process.argv.slice(2)){
 if(args.some(a=>!['--apply','--json'].includes(a)))throw Error('Используйте npm run history:clean для просмотра или npm run history:clean -- --apply для очистки.');
 const root=fileURLToPath(new URL('..',import.meta.url));process.chdir(root);
 try{process.loadEnvFile(resolve(root,'.env'));}catch(e){if(e.code!=='ENOENT')throw e;}
 const file=resolve(process.env.DATA_DIR||'./data','state.json');
 const result=await cleanHistoryFile(file,{apply:args.includes('--apply'),checkStopped:()=>requireStopped({PORT:process.env.PORT})});
 if(args.includes('--json')){console.log(JSON.stringify(result));return result;}
 console.log(result.applied?'Очистка завершена.':'Предварительный просмотр. Файлы не изменены.');
 console.log('В работе / были в работе сохранены: '+result.protectedProjects+'. Правил защиты от повторного появления: '+result.protectedRules+'.');
 console.log('Старых записей источников удал'+(result.applied?'ено: ':'ится: ')+result.removedSourceEntries+'. Старых разборов ИИ: '+result.removedAnalyses+'.');
 console.log('Очередь Google Play: '+result.removedPending+'. Старых карточек архива: '+result.removedReviewEntries+'.');
 console.log('Остальные ручные исключения удал'+(result.applied?'ены: ':'ятся: ')+result.removedManualRules+'. Реестр ориентиров сохранён: '+result.knownProjectsPreserved+'.');
 console.log('Ключи, текущие фильтры, модель, расписания и учёт расхода API сохранены. Поиск и ИИ не запускались.');
 if(result.applied){console.log('Проверено после очистки: ручная очередь — '+result.manualRemaining+'; автоисключения — '+result.autoExcludedRemaining+'.');console.log('Резервная копия полной истории: '+resolve(dirname(file),result.backupFile));console.log('Старые находки не перенесены в новый чёрный список: новый поиск проверит их по текущим критериям.');console.log('Проверить сохранённую CRM без поиска и ИИ: npm run start:diagnostic');}
 else console.log('Для очистки с резервной копией: npm run history:clean -- --apply');
 return result;
}
if(process.argv[1]&&await realpath(process.argv[1]).catch(()=>null)===await realpath(fileURLToPath(import.meta.url)))cleanHistoryCLI().catch(e=>{console.error(e.message);process.exitCode=1;});
