import {mergeWebPresence,webPresenceLabel} from './web-presence.js';
import {createHash} from 'node:crypto';
import {groupedCandidates} from './neural-inbox.js';
import {manuallyExcluded,effectiveExclusions} from './manual-exclusions.js';
import {publicURL} from './qualification.js';
import {SOCIAL_SOURCES} from './source-catalog.js';
import {docxDocument} from './word-document.js';

const sources={play:'Google Play',web:'Веб-сервисы',web_service:'Веб-сервисы',social:'Публикации',watch:'Наблюдение',...Object.fromEntries(SOCIAL_SOURCES.map(s=>[s.id,s.name]))};
const facts={business:'Счёт для бизнеса',account:'Предложение счёта / IBAN',euIban:'IBAN страны ЕС',utility:'Утилита или неподходящий продукт'};
const statuses={yes:'Есть свидетельство',no:'Есть отрицательное свидетельство',unknown:'Не подтверждено'};
const decisions={match:'Есть цитаты по критериям',review:'На проверку',irrelevant:'Похоже на неподходящий продукт',pending:'Ещё не разобрано ИИ'};
const availability={live:'В источнике заявлено, что работает',waitlist:'Лист ожидания',planned:'Планируется',unknown:'Не подтверждена'};
const filters={all:'Все находки',new:'Новые',early:'Ранние сигналы',pending:'Ещё не разобраны ИИ',match:decisions.match,review:decisions.review,irrelevant:decisions.irrelevant};
const time=value=>{const d=new Date(value);return value&&Number.isFinite(+d)?new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Kaliningrad',dateStyle:'short',timeStyle:'short'}).format(d):'Не указано';};
export const safeReportURL=value=>publicURL(value)?.href??null;
const excludedURL=(url,rules)=>{let appId;try{const u=new URL(url);if(u.hostname==='play.google.com')appId=u.searchParams.get('id');}catch{}return manuallyExcluded({url,appId},rules);};
export function reportOptions(input={}){
 const scope=input.scope??'remaining',filter=input.filter??'all';
 if(!['remaining','selected'].includes(scope)||!Object.hasOwn(filters,filter))throw Object.assign(new Error('Проверьте состав и фильтр отчёта.'),{status:400});
 return {scope,filter};
}
export function reportRows(state,input={}){
 const {scope,filter}=reportOptions(input),selected=new Set(state.ai.shortlist??[]),rules=effectiveExclusions(state);
 const analyses=new Map(state.ai.results.filter(r=>!manuallyExcluded(r,rules)).map(r=>[r.id,r]));
 return groupedCandidates(state).filter(e=>scope!=='selected'||selected.has(e.id)).map(e=>{
  const analysis=analyses.get(e.id),row={...e,...analysis,isNew:state.ai.newIds.includes(e.id),decision:analysis?.decision??'pending'};
  // Use the current source list, not links from a previously analyzed snapshot.
  row.targets=e.targets.filter(t=>!excludedURL(t.url,rules));row.sources=e.sources;row.facts=analysis?.facts?structuredClone(analysis.facts):null;
  let removed=false;
  for(const fact of Object.values(row.facts??{})){const before=fact.evidence?.length??0;fact.evidence=(fact.evidence??[]).filter(p=>safeReportURL(p.url)&&!excludedURL(p.url,rules));if(fact.evidence.length<before){removed=true;if(!fact.evidence.length)fact.status='unknown';}}
  row.availability=analysis?.availability?structuredClone(analysis.availability):{status:'unknown',evidence:[]};
  const proofs=row.availability.evidence??[];row.availability.evidence=proofs.filter(p=>safeReportURL(p.url)&&!excludedURL(p.url,rules));
  if(row.availability.evidence.length<proofs.length){removed=true;if(!row.availability.evidence.length)row.availability.status='unknown';}
  const presence=mergeWebPresence(e.webPresence,analysis?.webPresence);for(const part of Object.values(presence)){part.evidence=part.evidence.filter(p=>!excludedURL(p.url,rules));if(part.links)part.links=part.links.filter(url=>!excludedURL(url,rules));}row.webPresence=mergeWebPresence(presence);
  row.warnings=[...(analysis?.sourceErrors??[]),...(removed?['Часть источников исключена вручную. Соответствующие цитаты удалены; сохранённый разбор следует обновить.']:[])];
  if(removed){row.decision='review';row.summary='Сохранённый комментарий ИИ требует обновления после исключения источников.';}
  row.links=[...new Set([e.developerWebsite,...row.targets.map(t=>t.url),e.url].filter(url=>safeReportURL(url)&&!excludedURL(url,rules)))];
  return row;
 }).filter(r=>filter==='all'||filter==='new'&&r.isNew||filter==='early'&&r.earlySignal||filter===r.decision);
}
export function updateShortlist(draft,input){
 if(!input||!['add','remove','clear'].includes(input.action))throw new Error('Выберите действие для итогового списка.');
 const ids=input.ids??[];
 if(!Array.isArray(ids)||ids.length>10000||ids.some(id=>typeof id!=='string'||!id.length||id.length>512))throw new Error('Некорректный список находок.');
 const current=new Set(draft.ai.shortlist??[]);
 if(input.action==='clear')current.clear();
 else if(input.action==='remove')for(const id of ids)current.delete(id);
 else{const available=new Set(groupedCandidates(draft).map(e=>e.id));for(const id of ids){if(!available.has(id))throw new Error('Находка уже исключена или недоступна. Обновите список.');current.add(id);}}
 draft.ai.shortlist=[...current];return {ids:draft.ai.shortlist};
}
export function buildReport(state,input={},now=new Date()){
 const options=reportOptions(input),rows=reportRows(state,options);
 const blocks=[{type:'title',text:'Бизнес-счета и платёжные сервисы'},{type:'paragraph',text:`${options.scope==='selected'?'Мой итоговый список':'Все оставшиеся после ручных исключений'} · ${filters[options.filter]}`},{type:'paragraph',text:`Сформировано: ${time(now)} · Калининград (UTC+2). Записей: ${rows.length}.`},{type:'paragraph',text:'Разбор использует сохранённые сведения, новые запросы к ИИ не выполняются. Неподтверждённые условия отмечены отдельно. Дата обнаружения не является датой запуска компании.'}];
 if(!rows.length)blocks.push({type:'paragraph',text:'В выбранном списке нет записей. Добавьте нужные находки в итоговый список или измените фильтр.'});
 else blocks.push({type:'table',rows:[['Сервис','Оценка','EU IBAN'],...rows.map((r,i)=>[`${i+1}. ${r.serviceName??r.title}`,decisions[r.decision],statuses[r.facts?.euIban?.status]??statuses.unknown])]});
 rows.forEach((r,i)=>{
  blocks.push({type:'heading',text:`${i+1}. ${r.serviceName??r.title}`},{type:'paragraph',text:`${decisions[r.decision]}${r.isNew?' · НОВОЕ':''}${r.earlySignal?' · Ранний сигнал':''}`});
  if(r.reference)blocks.push({type:'paragraph',text:`Ваш известный образец: ${r.reference}`});
  blocks.push({type:'paragraph',text:`Впервые найдено: ${time(r.firstFoundAt)}. Источники: ${r.sources.map(s=>sources[s]??s).join(', ')}.`});
  for(const url of r.links)blocks.push({type:'link',text:url,url});
  blocks.push({type:'paragraph',text:`Комментарий ИИ: ${r.facts?r.summary??'Комментарий не сохранён.':'Анализ ещё не выполнен; сведения о критериях не подтверждены.'}`});
  blocks.push({type:'table',rows:[['Критерий','Оценка'],...Object.entries(facts).map(([name,label])=>[label,statuses[r.facts?.[name]?.status]??statuses.unknown]),['Веб-сервис',webPresenceLabel(r.webPresence.service)],['Веб-кабинет',webPresenceLabel(r.webPresence.cabinet)],['Доступность',availability[r.availability.status]??availability.unknown]]});
  for(const [name,fact]of Object.entries(r.facts??{}))for(const proof of fact.evidence??[])blocks.push({type:'paragraph',text:`${facts[name]??name}: «${proof.quote}»`},{type:'link',text:'Источник цитаты: '+proof.url,url:proof.url});
  for(const proof of r.availability.evidence)blocks.push({type:'paragraph',text:`Доступность: «${proof.quote}»`},{type:'link',text:'Источник: '+proof.url,url:proof.url});
  for(const [key,label]of [['service','Веб-сервис'],['cabinet','Веб-кабинет']]){for(const p of r.webPresence[key].evidence)blocks.push({type:'paragraph',text:`${label}: «${p.text}»`},{type:'link',text:'Источник: '+p.url,url:p.url});}for(const url of r.webPresence.cabinet.links)blocks.push({type:'link',text:'Ссылка на вход (вход не проверен): '+url,url});
  for(const message of r.warnings)blocks.push({type:'paragraph',text:'Примечание: '+message});
  if(r.facts)blocks.push({type:'paragraph',text:`Разбор: ${time(r.checkedAt)} · ${r.model??'Модель не указана'}. Вывод по цитатам не гарантирует открытие счёта вашей компании и не является проверкой лицензии.`});
 });
 return {rows,blocks,options,createdAt:now.toISOString()};
}
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const css='body{font:15px/1.55 system-ui,sans-serif;color:#203b32;max-width:900px;margin:40px auto;padding:0 22px}h1{font-size:28px}h2{margin-top:38px;border-top:1px solid #ddd;padding-top:20px;break-after:avoid}p{white-space:pre-wrap;overflow-wrap:anywhere}a{color:#165b49;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;margin:18px 0}td,th{border:1px solid #ccd6d1;padding:9px;text-align:left}tr:first-child{font-weight:bold;background:#edf3ef}tr{break-inside:avoid}.print-note{padding:14px;background:#edf3ef}@page{size:A4;margin:18mm}@media print{body{margin:0;padding:0;max-width:none;font-size:11pt}.print-note{display:none}a{color:inherit}}';
export const REPORT_CSP=`default-src 'none'; style-src 'sha256-${createHash('sha256').update(css).digest('base64')}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
export function reportHTML(report){
 const body=report.blocks.map(b=>b.type==='table'?`<table>${b.rows.map(row=>'<tr>'+row.map(c=>`<td>${escape(c)}</td>`).join('')+'</tr>').join('')}</table>`:b.type==='link'?`<p><a href="${escape(safeReportURL(b.url))}" rel="noreferrer noopener">${escape(b.text)}</a></p>`:`<${b.type==='title'?'h1':b.type==='heading'?'h2':'p'}>${escape(b.text)}</${b.type==='title'?'h1':b.type==='heading'?'h2':'p'}>`).join('\n');
 return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${escape(REPORT_CSP)}"><title>Play Scout — итоговый список</title><style>${css}</style></head><body><p class="print-note">Сохранить в PDF: Command + P на Mac или Ctrl + P → «Сохранить как PDF».</p>${body}</body></html>`;
}
export const reportDOCX=report=>docxDocument(report.blocks);
export function reportCSV(report){
 const quote=value=>{let s=String(value??'');if(/^[\s\uFEFF]*[=+@-]/u.test(s)||/^[\t\r\n]/u.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
 const header=['Сервис','Оценка','Новый','Ранний сигнал','Комментарий ИИ',...Object.values(facts),'Веб-сервис','Веб-кабинет','Доступность','Ссылки','Цитаты и источники','Примечания','Впервые найдено · Калининград','Разбор · Калининград','Модель'];
 const rows=report.rows.map(r=>[r.serviceName??r.title,decisions[r.decision],r.isNew?'Да':'Нет',r.earlySignal?'Да':'Нет',r.facts?r.summary:'Анализ ещё не выполнен',...Object.keys(facts).map(name=>statuses[r.facts?.[name]?.status]??statuses.unknown),webPresenceLabel(r.webPresence.service),webPresenceLabel(r.webPresence.cabinet),availability[r.availability.status],[...r.links,...r.webPresence.cabinet.links].join('\n'),[...Object.entries(r.facts??{}).flatMap(([name,f])=>(f.evidence??[]).map(p=>`${facts[name]}: ${p.quote}\n${p.url}`)),...r.availability.evidence.map(p=>`Доступность: ${p.quote}\n${p.url}`),...['service','cabinet'].flatMap(key=>r.webPresence[key].evidence.map(p=>`${key==='service'?'Веб-сервис':'Веб-кабинет'}: ${p.text}\n${p.url}`))].join('\n\n'),r.warnings.join('\n'),time(r.firstFoundAt),r.facts?time(r.checkedAt):'',r.model??'']);
 return '\uFEFF'+[header,...rows].map(row=>row.map(quote).join(',')).join('\r\n')+'\r\n';
}
