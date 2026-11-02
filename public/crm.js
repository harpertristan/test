import {CRM_VIEW_LABELS,CRM_MAIN_VIEWS,matchesCRMView,reviewQuestion} from './crm-views.js';
import {SEARCH_CHANNELS,channelMatches} from './source-workspace-catalog.js';
import {HARDWARE_PROFILES} from './ai-config.js';
import {apiJSON} from './api.js';
import {webPresenceLabel} from './web-presence.js';
import {EXCLUSION_REASONS} from './identity-names.js';
import {SORT_OPTIONS,sortFindings,findingDates} from './finding-order.js';
const $=s=>document.querySelector(s),el=(tag,text)=>Object.assign(document.createElement(tag),{textContent:text??''});
const labels=CRM_VIEW_LABELS;
const sources={worked_archive:'Сохранено из работы',review_archive:'Прежние записи',manual:'Прежние исключения',known:'Ваши ориентиры',play:'Google Play',apple:'Архив App Store',web:'Веб-сервисы',social:'Публикации / реестры',watch:'Изменения / RSS',registers:'Реестры',regulators:'Регуляторы',youtube:'YouTube',gemini:'Gemini'};
const facts={business:'Счёт для бизнеса',account:'Сервис предоставляет счёт / IBAN',euIban:'IBAN страны ЕС',utility:'Утилита или неподходящий продукт'},factLabels={yes:'Есть цитата',no:'Отрицательная цитата',unknown:'Не подтверждено'};
let rejectionIds=[];
let initialViewChosen=false;
let data,mode='suitable',reasonFilter='',limit=50,selectedId,dirty=false,busy=false,settingsReady=false,detailRow,poll,actionBusy=false,loading=null,writeActive=false,flushTimer,lastRefreshError=null;
const channelCards=new Map();
const selected=new Set(),pending=new Map(),queued=new Map(),settledMutations=new Set(),noteDrafts=new Map();
const lines=id=>$(id).value.split('\n').map(x=>x.trim()).filter(Boolean),checked=selector=>[...document.querySelectorAll(selector+':checked')].map(e=>e.value);
const time=v=>v&&Number.isFinite(Date.parse(v))?new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Kaliningrad',dateStyle:'short',timeStyle:'short'}).format(new Date(v)):'не указано';
const day=v=>v&&Number.isFinite(Date.parse(v))?new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Kaliningrad',dateStyle:'short'}).format(new Date(v)):'не указана';
const canEdit=()=>data?.access?.canEdit!==false,engineName=()=>({hybrid:'GPT + Ollama',llamacpp:'llama.cpp / GPU-агент',ollama:'Ollama локально',gemini:'Gemini',openai:'OpenAI'}[data?.ai.engine]??'ИИ');
const globalReason=()=>$('#exclude-reason').value;
function link(url,text){const a=el('a',text??url);try{const u=new URL(url);if(u.protocol!=='https:')return el('span',text??url);a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';}catch{return el('span',text??url);}return a;}
function reasonSelect(value=''){const s=el('select');s.append(Object.assign(el('option','Выберите причину'),{value:''}));for(const [key,label]of Object.entries(EXCLUSION_REASONS))s.append(Object.assign(el('option',label),{value:key}));s.value=value;return s;}
function rowsWithPending(){return data.rows.map(r=>pending.has(r.id)?{...r,status:'excluded',statusLabel:'Исключены вручную',manualExcluded:true,exclusionReason:pending.get(r.id),exclusionReasonLabel:EXCLUSION_REASONS[pending.get(r.id)]}:r);}
const visibleIn=matchesCRMView;
function filtered(){const q=$('#query').value.toLowerCase(),type=$('#licence-type').value;return sortFindings(rowsWithPending().filter(r=>channelMatches(r,$('#database-source').value)&&visibleIn(r,mode)&&(!reasonFilter||mode!=='excluded'||r.exclusionReason===reasonFilter)&&(mode!=='licences'||type==='both'||r.licenceTypes?.includes(type))&&[r.title,r.serviceName,r.url,r.developerWebsite,r.notes,r.summary].join(' ').toLowerCase().includes(q)),$('#sort-order').value);}
function tabButton(key,label,count,click){const b=el('button');b.append(el('span',label),Object.assign(el('strong',String(count)),{className:'tab-count'}));b.setAttribute('aria-label',`${label} ${count}`);b.type='button';b.className=key===mode?'selected':'';b.setAttribute('aria-pressed',String(key===mode));b.onclick=click;return b;}
function render(){
 if(!data)return;
 const all=rowsWithPending().filter(r=>channelMatches(r,$('#database-source').value)),mutable=canEdit();
 if(!initialViewChosen){const saved=localStorage.getItem('crmMainView');mode=Object.hasOwn(CRM_MAIN_VIEWS,saved)?saved:all.some(r=>visibleIn(r,'suitable'))?'suitable':'needs_review';initialViewChosen=true;}
 busy=Boolean(data.sourceWorkspace?.busy||data.neural?.busy||data.ai.busy||Object.values(data.monitors).some(m=>m.busy));
 document.documentElement.dataset.access=mutable?'admin':'viewer';
 $('#access-status').textContent=data.runtime?.diagnostic?'Диагностический просмотр':!mutable?'Режим просмотра':data.runtime?.manual?'Ручной запуск · расписания на паузе':'Расписания включаются в настройках';
 const queue=data.reviewQueue??data.manualReview,remaining=queue?.remaining??0;
 $('#manual-analyse').textContent='Проверить очередь · '+(queue?.count??0);
 $('#manual-analyse').disabled=!mutable||actionBusy||busy||!data.ai.configured||!queue?.count;
 $('#manual-analyse').hidden=Boolean(remaining)&&!data.ai.busy;
 $('#manual-resume').textContent='Продолжить проверку · '+remaining;$('#manual-resume').hidden=!remaining||data.ai.busy;$('#manual-resume').disabled=!mutable||actionBusy||busy||!data.ai.configured;
 $('#choose-sources').disabled=!mutable||actionBusy;$('#stop-all').hidden=!busy;$('#stop-all').disabled=!mutable||actionBusy;
 for(const id of['collect','licence-run','analyse','enable-daily','repair-local','repair-ai','reset-review'])$('#'+id).disabled=!mutable||actionBusy||busy;
 $('#play-resume').hidden=!data.monitors.play.pendingChecks;$('#play-resume').textContent='Продолжить Google Play · '+(data.monitors.play.pendingChecks??0);$('#play-resume').disabled=!mutable||actionBusy||data.monitors.play.busy;
 $('#repair-ai').textContent='Повторить проблемные · '+(data.ai.repairDue??0);
 $('#connection').textContent=`${engineName()} · ${data.ai.model}. Brave: ${data.monitors.web.connection?.configured?'подключён':'нужен ключ'} · учтено запросов: ${data.brave.used}.`;
 const a=data.ai.job;
 $('#work-status').textContent=data.ai.busy?`Проверяем провайдеров: ${a?.done??0} из ${a?.total??0}${a?.current?' · '+a.current:''}`:data.sourceWorkspace?.busy?'Идёт поиск в выбранных источниках. Находки сохраняются по мере поступления.':data.neural?.busy?'Собираем находки из источников.':busy?'Источники работают.':'Готов к поиску';
 if(pending.size&&!busy)$('#work-status').textContent='Сохраняем ваши отметки…';
 const progress=$('#analysis-progress');progress.hidden=!data.ai.busy;progress.max=Math.max(a?.total??1,1);progress.value=a?.done??0;
 $('#work-status').title=a?.workers?.map(w=>(w.engine==='openai'?'GPT':w.engine==='ollama'?'Ollama':w.engine)+': '+w.done+' готово · '+w.status).join('\n')??'';
 $('#source-status').replaceChildren(...Object.entries(data.monitors).map(([name,m])=>el('p',`${sources[name]??name} · ${m.busy?'в работе':'ожидание'}${m.lastJob?.ingestion?.rejected?' · отсеяно до ИИ: '+m.lastJob.ingestion.rejected:''}${m.lastJob?.errors?.length?' · '+m.lastJob.errors[0].message:''}`)));
 const memory=data.learning;$('#learning-status').textContent=memory?`Новых решений: ${memory.events}. Подходят: ${memory.positive} · отказов с примерами: ${memory.negative} · знакомых сервисов: ${memory.known}. Исправлено автоматических отказов: ${memory.correctedRejections??0}.`:'Новые ручные решения будут сохраняться локально.';
 $('#repair-info').textContent=data.ai.lastRepair?'Локальный пересчёт: '+data.ai.lastRepair.repaired+' разборов, без API.':'';
 $('#reset-review-info').textContent=data.reviewCycle?'Последний возврат на проверку: '+time(data.reviewCycle.startedAt)+'. Ручные отметки сохранены.':'';
 const messages=[data.storage?.lastError?.message,data.storage?.checkpointWarning,data.sourceWorkspace?.analysisPaused,...(data.neural?.errors??[]),...(a?.errors??[]).map(e=>e.message)].filter(Boolean);
 $('#run-errors').textContent=[...new Set(messages)].join(' ');
 renderChannels();
 $('#tabs').replaceChildren(...Object.entries(CRM_MAIN_VIEWS).map(([key,label])=>{const button=tabButton(key,label,all.filter(r=>visibleIn(r,key)).length,()=>{mode=key;localStorage.setItem('crmMainView',mode);reasonFilter='';selected.clear();selectedId=null;limit=50;$('#detail').innerHTML='<div class="detail-placeholder"><span aria-hidden="true">i</span><h2>Выберите провайдера</h2><p>Условия, источники и ваши заметки.</p></div>';render();});button.dataset.view=key;return button;}));
 $('#view-description').textContent=({suitable:'Провайдеры с подтверждёнными критериями или вашей отметкой. Происхождение решения указано в карточке.',needs_review:'Перспективные провайдеры. В каждой карточке указано, что именно осталось подтвердить.',known_work:'Известные вам сервисы. Они пропускаются при новом сборе и ИИ-разборе.',archive:'Отсев программы и ваши отказы. Проверьте причину и исходный текст; любую ошибку можно вернуть на проверку.'})[mode]??'';
 $('#auto-audit-export').hidden=mode!=='archive';$('#exclusion-funnel').hidden=true;
 const rows=filtered();$('#counts').textContent=rows.length?`${rows.length} ${rows.length===1?'запись':'записей'}${rows.length>limit?' · показаны первые '+limit:''}`:'В этом разделе пока нет записей';
 $('.bulk-toolbar').hidden=!mutable||!selected.size;$('#selection-count').textContent='Выбрано: '+selected.size;$('#mutation-status').textContent=pending.size?'Сохраняем решение…':'';
 for(const id of['select-visible','select-matching','clear-selection'])$('#'+id).disabled=!mutable;
 const picked=data.rows.filter(r=>selected.has(r.id));
 $('#bulk-approve').disabled=!mutable||!selected.size||picked.some(r=>r.manualExcluded||r.worked);
 $('#bulk-worked').disabled=!mutable||!selected.size;$('#bulk-exclude').disabled=!mutable||!selected.size;
 $('#bulk-restore').hidden=!['archive','known_work'].includes(mode);$('#bulk-restore').disabled=!mutable||!selected.size;
 const params=new URLSearchParams({status:mode,q:$('#query').value,licenceType:$('#licence-type').value,sort:$('#sort-order').value,source:$('#database-source').value});
 for(const [id,file]of[['export-word','export.docx'],['export-csv','export.csv'],['export-chat','chat.json']])$('#'+id).href='/api/crm/'+file+'?'+params;
 $('#list').replaceChildren(...rows.slice(0,limit).map(r=>{
  const row=el('article');row.className='crm-row'+(selectedId===r.id?' selected':'');row.dataset.view=Object.keys(CRM_MAIN_VIEWS).find(view=>visibleIn(r,view))??'archive';
  const checkbox=el('input');checkbox.type='checkbox';checkbox.checked=selected.has(r.id);checkbox.disabled=!mutable||pending.has(r.id);checkbox.setAttribute('aria-label','Выбрать: '+(r.serviceName??r.title));checkbox.onchange=()=>{checkbox.checked?selected.add(r.id):selected.delete(r.id);render();};
  const open=el('button');open.type='button';open.className='crm-open';open.append(el('strong',r.serviceName??r.title));
  const badges=el('div');badges.className='card-badges';if(r.isNew){const fresh=el('span','Найден впервые');fresh.className='badge badge-new';badges.append(fresh);}
  const badge=el('span',r.approval?'Подтверждено вами':visibleIn(r,'known_work')?'Исключён из повторов':visibleIn(r,'suitable')?(r.status==='selected'?'В вашем списке':['business','account','euIban'].every(k=>r.facts?.[k]?.status==='yes')?'Критерии подтверждены':'Сохранено как подходящий'):visibleIn(r,'archive')?(r.manualExcluded?'Ваше решение':'Решение программы'):'Требует уточнения');badge.className='badge';badges.append(badge);open.append(badges);
  let host;try{host=new URL(r.developerWebsite??r.url).hostname.replace(/^www\./,'');}catch{}
  open.append(el('small',[host,r.sources?.map(s=>sources[s]??s).slice(0,2).join(', ')].filter(Boolean).join(' · ')),el('p',reviewQuestion(r)));
  const dates=findingDates(r);if(dates.released)open.append(el('small','Выпуск приложения: '+day(dates.released)));else if(r.firstFoundAt)open.append(el('small','Найден: '+day(r.firstFoundAt)));
  open.onclick=()=>openDetail(r.id);
  const actions=el('div');actions.className='crm-row-actions';
  const quick=el('button',visibleIn(r,'known_work')||visibleIn(r,'archive')?'Вернуть':'Уже знаю');quick.type='button';quick.className='outline-button compact-action';quick.disabled=!mutable||pending.has(r.id);quick.title=visibleIn(r,'known_work')?'Вернуть провайдера для проверки':visibleIn(r,'archive')?'Отменить отсев и проверить провайдера':'Уже в работе / был в работе';
  quick.onclick=()=>r.manualExcluded?mutate('restore',[r.id]):visibleIn(r,'archive')?returnToReview([r.id]):queueExclusions([r.id],'worked');actions.append(quick);row.append(checkbox,open,actions);return row;
 }));
 if(!rows.length){const empty=el('div');empty.className='list-empty';empty.append(el('span',mode==='archive'?'✓':'⌕'),el('h2',mode==='archive'?'Отсеянных записей нет':'Здесь пока нет провайдеров'),el('p',mode==='needs_review'?'Новый поиск добавит сюда перспективные находки.':mode==='suitable'?'Подтверждённые провайдеры появятся здесь после проверки.':mode==='known_work'?'Отмечайте знакомые сервисы кнопкой «Уже в работе».':'Отсев будущих запусков будет доступен здесь вместе с причинами.'));$('#list').append(empty);}
 $('#more').hidden=rows.length<=limit;
 if(settingsReady&&!dirty){$('#market-scope').value=data.marketPolicy.marketScope;$('#blocked-jurisdictions').value=data.marketPolicy.blockedJurisdictions.join(', ');const c=data.monitors.play.schedule.filters,w=data.monitors.watch.schedule.filters;$('#keywords').value=c.keywords.join('\n');$('#countries').value=c.countries.join(', ');$('#reference-discovery').checked=c.referenceDiscovery;$('#related').checked=c.related;$('#developers').checked=c.developerExpansion;$('#register-watch').checked=w.watchRegisters;$('#watch-urls').value=w.watchUrls.join('\n');$('#feed-urls').value=w.feedUrls.join('\n');for(const box of document.querySelectorAll('.play-category'))box.checked=(c.categories??['FINANCE']).includes(box.value);$('#web-queries').value=data.monitors.web.schedule.filters.queries.join('\n');for(const box of document.querySelectorAll('.publication-source'))box.checked=data.monitors.social.schedule.filters.sources.includes(box.value);const a=data.ai.config;$('#translate').checked=a.translateRu;$('#known').checked=a.includeKnown;$('#known').disabled=Boolean(data.reviewCycle);$('#ai-engine').value=a.engine;$('#ai-mode').value=a.mode;$('#ollama-model').value=a.ollamaModel;$('#local-endpoints').value=a.localEndpoints.join('\n');$('#local-model').value=a.localModel;$('#hardware-profile').value=a.hardwareProfile;$('#gemini-model').value=a.geminiModel;$('#cloud-concurrency').value=a.cloudConcurrency??3;$('#daily-time').value=a.time;}
 for(const selector of['#test-brave','#test-local','#test-cloud','#apply-hardware','#settings-form button[type=submit]'])$(selector).disabled=!mutable||actionBusy||data.ai.busy;
 if(!mutable)for(const c of $('#settings-form').querySelectorAll('input,select,textarea,button'))c.disabled=true;
}
function renderChannels(){
 const workspace=data.sourceWorkspace;if(!workspace)return;
 const legacy=workspace.legacyCombined||workspace.legacySchedules.length;
 $('#legacy-source-status').textContent=data.runtime?.manual?'Расписания сохранены, но в ручном запуске не выполняются. Обычный запуск снова использует включённые расписания.':data.runtime?.diagnostic?'В диагностическом запуске расписания не выполняются; сохранённые настройки не меняются.':legacy?'Из прежней версии ещё действуют общие расписания: '+workspace.legacySchedules.join(', ')+(workspace.legacyCombined?' + общий сбор ИИ':'')+'. Можно отключить их и настроить расписание каждого источника ниже.':'Каждый источник запускается и настраивается отдельно. Общая база не запускает поиск сама.';
 $('#independent-schedules').hidden=!legacy;$('#independent-schedules').disabled=!canEdit()||actionBusy;
 const query=$('#channel-query').value.trim().toLowerCase();
 for(const c of workspace.channels){let ui=channelCards.get(c.id);
  if(!ui){const card=el('article');card.className='channel-card';card.append(el('h3',c.name));const status=el('p');status.setAttribute('role','status');const start=el('button','Искать только здесь');start.type='button';start.className='outline-button';const stop=el('button','Остановить этот источник');stop.type='button';stop.className='cancel-button';const view=el('button','Находки в общей базе');view.type='button';view.className='outline-button';view.onclick=()=>{$('#database-source').value=c.id;mode='needs_review';selected.clear();limit=50;render();$('#list').scrollIntoView({behavior:'smooth'});};
   const enabled=el('input');enabled.type='checkbox';const daily=el('label','Ежедневно');daily.prepend(enabled);const at=el('input');at.type='time';at.setAttribute('aria-label','Время · '+c.name);const analyse=el('input');analyse.type='checkbox';const after=el('label','ИИ после сбора');after.prepend(analyse);const save=el('button','Сохранить расписание');save.type='button';save.className='outline-button';const config=el('a','Настройки поиска');config.href=c.settingsURL;const actions=el('div');actions.className='crm-actions';actions.append(start,stop,view);const options=el('details');options.className='channel-options';options.append(el('summary','Расписание и разбор'),daily,at,after,save,config);card.append(status,actions,options);$('#channel-list').append(card);
   ui={card,status,start,stop,enabled,at,analyse,save,dirty:false};channelCards.set(c.id,ui);for(const input of[enabled,at,analyse])input.oninput=()=>ui.dirty=true;
   const saveChannel=async()=>{await post('/api/sources/settings',{id:c.id,enabled:enabled.checked,time:at.value,analyse:analyse.checked});ui.dirty=false;};save.onclick=()=>action(saveChannel);start.onclick=()=>action(async()=>{if(dirty)await saveSettings();if(ui.dirty)await saveChannel();await post('/api/sources/start',{id:c.id,analyse:analyse.checked});});stop.onclick=()=>action(()=>post('/api/sources/cancel',{id:c.id}));
  }
  const last=c.last,isLive=last&&['queued','running','cancelling'].includes(last.status);ui.card.hidden=Boolean(query&&!c.name.toLowerCase().includes(query)&&!c.id.toLowerCase().includes(query));
  ui.status.textContent=last?({queued:'В очереди источника',running:'Ищет',cancelling:'Останавливается',complete:'Завершён',partial:'Частично завершён',failed:'Ошибка',cancelled:'Остановлен',interrupted:'Прерван перезапуском'}[last.status]??last.status)+' · получено ссылок '+(last.found??0)+(last.total?' · '+(last.done??0)+'/'+last.total:'')+(last.current?' · '+last.current:'')+(last.error?' · '+last.error:'')+(last.errors?.[0]?' · '+last.errors[0].message:''):'Ещё не запускался';
  if(!ui.dirty){ui.enabled.checked=c.settings.enabled;ui.at.value=c.settings.time;ui.analyse.checked=c.settings.analyse;}
  ui.start.disabled=!canEdit()||actionBusy||isLive;ui.stop.hidden=!isLive;ui.stop.disabled=!canEdit()||actionBusy;for(const input of[ui.enabled,ui.at,ui.analyse,ui.save])input.disabled=!canEdit()||actionBusy;
 }
}
function rejectRows(ids){if(!canEdit()||!ids.length)return;rejectionIds=[...ids];$('#reject-dialog').showModal();}
for(const button of document.querySelectorAll('[data-reject-reason]'))button.onclick=()=>{const ids=[...rejectionIds];$('#reject-dialog').close();rejectionIds=[];queueExclusions(ids,button.dataset.rejectReason);};
$('#close-reject-dialog').onclick=()=>{$('#reject-dialog').close();rejectionIds=[];};
async function post(path,body={}){return apiJSON(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});}
async function refresh(force=false){
 if(loading){if(!force)return loading;await loading;return refresh();}
 const current=(async()=>{try{data=await apiJSON('/api/crm');if(lastRefreshError&&$('#error').textContent===lastRefreshError.message)$('#error').textContent='';lastRefreshError=null;for(const id of settledMutations)pending.delete(id);settledMutations.clear();render();return true;}catch(e){lastRefreshError=e;$('#error').textContent=e.message;return false;}finally{if(loading===current)loading=null;clearTimeout(poll);poll=setTimeout(()=>refresh(),busy?1800:7000);}})();loading=current;return current;
}
async function action(fn){if(actionBusy||!canEdit())return;actionBusy=true;render();$('#error').textContent='';try{await fn();await refresh(true);}catch(e){$('#error').textContent=e.message;}finally{actionBusy=false;render();}}
function queueExclusions(ids,reason){if(!canEdit())return;if(!Object.hasOwn(EXCLUSION_REASONS,reason)){$('#error').textContent='Выберите причину исключения в панели списка или карточке.';return;}for(const id of ids){if(pending.has(id))continue;pending.set(id,reason);queued.set(id,reason);selected.delete(id);}render();clearTimeout(flushTimer);flushTimer=setTimeout(flushExclusions,100);}
async function flushExclusions(){if(writeActive||!queued.size)return;writeActive=true;const reason=queued.values().next().value,ids=[...queued].filter(([,r])=>r===reason).map(([id])=>id);for(const id of ids)queued.delete(id);
 try{await post('/api/crm/bulk',{ids,action:'exclude',reason});}catch(e){$('#error').textContent=e.message;}finally{for(const id of ids)settledMutations.add(id);await refresh(true);writeActive=false;render();if(selectedId&&ids.includes(selectedId))void openDetail(selectedId);if(queued.size)void flushExclusions();}
}
async function returnToReview(ids){await action(async()=>{await post('/api/crm/bulk',{ids,action:'status',status:'review'});mode='needs_review';for(const id of ids)selected.delete(id);if(selectedId&&ids.includes(selectedId))await openDetail(selectedId);});}
async function approveRows(ids){await action(async()=>{await post('/api/crm/bulk',{ids,action:'status',status:'approved'});for(const id of ids)selected.delete(id);if(selectedId&&ids.includes(selectedId))await openDetail(selectedId);});}
async function mutate(actionName,ids){await action(async()=>{await post('/api/crm/bulk',{action:actionName,ids});if(actionName==='restore')mode='needs_review';for(const id of ids)selected.delete(id);if(selectedId&&ids.includes(selectedId)){if(selectedId.startsWith('known:')){selectedId=null;$('#detail').replaceChildren();}else await openDetail(selectedId);}});}
async function openDetail(id){selectedId=id;render();try{const row=await apiJSON('/api/crm/item?'+new URLSearchParams({id}));if(selectedId!==id)return;detailRow=row;renderDetail(row);if(window.matchMedia('(max-width:760px)').matches)$('#detail').scrollIntoView({behavior:'smooth',block:'start'});}catch(e){$('#error').textContent=e.message;}}
function renderDetail(r){
 const box=$('#detail');box.replaceChildren();
 const heading=el('div');heading.className='detail-heading';heading.append(el('p',visibleIn(r,'known_work')?'УЖЕ В РАБОТЕ':visibleIn(r,'archive')?'ОТСЕВ':visibleIn(r,'suitable')?'ПОДХОДИТ':'НА ПРОВЕРКУ'),el('h2',r.serviceName??r.title));box.append(heading);
 const summary=el('p',reviewQuestion(r));summary.className=visibleIn(r,'archive')?'rejection-note':'detail-summary';box.append(summary);
 for(const url of [...new Set([r.developerWebsite,r.url].filter(Boolean))])box.append(link(url));
 const controls=el('div');controls.className='crm-actions detail-actions';
 const button=(label,fn,style='outline-button')=>{const b=el('button',label);b.type='button';b.className=style;b.disabled=!canEdit();b.onclick=fn;return b;};
 if(r.manualExcluded)controls.append(button('Вернуть на проверку',()=>mutate('restore',[r.id])));
 else if(visibleIn(r,'archive'))controls.append(button('Вернуть на проверку',()=>returnToReview([r.id]),'primary-button'),button('Уже в работе',()=>queueExclusions([r.id],'worked')));
 else controls.append(button(r.approval?'Подтверждено вами':'Подходит',()=>approveRows([r.id]),'primary-button'),button('Уже в работе',()=>queueExclusions([r.id],'worked')),button('Не подходит',()=>rejectRows([r.id])));
 box.append(controls);
 if(!r.manualExcluded&&!visibleIn(r,'archive')){
  const check=button('Проверить сведения',()=>action(()=>post('/api/ai/start',{ids:[r.id],...((r.reviewCycleId||r.manualStatusAt)?{manualRecheck:true,reuseSaved:false}:{})})));
  check.disabled=!canEdit()||data.ai.busy||!data.ai.configured;box.append(check);const hint=el('p','Чтение сайта и выбранный ИИ · облачный API может быть платным.');hint.className='hint';box.append(hint);
 }
 if(r.intakeRecord){const info=el('p','Отсеяно правилом сбора до обращения к ИИ. Исходное описание сохранено ниже.');info.className='hint';box.append(info);}
 if(r.approval){const approved=el('p','Подтверждено вами: '+time(r.approval.at));approved.className='approval-note';box.append(approved);}
 if(r.analysisStale)box.append(el('p','Источники обновились после последней проверки. Сведения требуют уточнения.'));
 const grid=el('div');grid.className='fact-grid';
 for(const key of['business','account','euIban']){const fact=r.facts?.[key],card=el('div');card.className='fact-card';card.dataset.status=fact?.status??'unknown';card.append(el('small',facts[key]),el('strong',({yes:'Подтверждено',no:'Есть отрицательная цитата',unknown:'Не подтверждено'})[fact?.status??'unknown']));grid.append(card);}box.append(grid);
 const notesLabel=el('label','Мои заметки'),notes=el('textarea',noteDrafts.get(r.id)??r.notes??'');notesLabel.htmlFor='record-notes';notes.id='record-notes';notes.rows=3;notes.placeholder='Условия, контакт или результат вашей проверки';notes.disabled=!canEdit();notes.oninput=()=>noteDrafts.set(r.id,notes.value);
 box.append(notesLabel,notes,button('Сохранить заметку',()=>action(async()=>{await post('/api/crm/update',{id:r.id,notes:notes.value});noteDrafts.delete(r.id);await openDetail(r.id);})));
 const proofs=el('details');proofs.className='source-proofs';proofs.append(el('summary','Цитаты и результат проверки'));
 const noModel=['pre_ai_screen','registry_event'].includes(r.analysisMethod)||r.intakeRecord;
 proofs.append(el('p',noModel?'Автопроверка · без вызова ИИ':r.model?'Проверка: '+r.model+' · '+time(r.checkedAt??r.analysedAt):'ИИ ещё не проверял эти сведения.'));
 if(r.summary)proofs.append(el('p',r.summary));
 for(const evidence of r.reviewRouting?.evidence??[])proofs.append(el('blockquote',evidence.quote),link(evidence.url,'Источник решения'));
 for(const [key,fact]of Object.entries(r.facts??{}))for(const evidence of fact.evidence??[]){proofs.append(el('h4',facts[key]??key),el('blockquote',evidence.quote),link(evidence.url,'Источник цитаты'));}
 if(r.summaryOriginal&&r.summaryOriginal!==r.summary){const original=el('details');original.append(el('summary',noModel?'Исходный результат правила':'Ответ модели до проверки цитат'),el('p',r.summaryOriginal));proofs.append(original);}box.append(proofs);
 const documents=new Map((r.documents??[]).map(d=>[d.url,d]));for(const t of r.translations??[])documents.set(t.url,{url:t.url,text:documents.get(t.url)?.text??t.original,translation:t.translationRu});
 const sourcesHeading=el('h3','Исходные материалы');sourcesHeading.className='detail-section-title';box.append(sourcesHeading);
 for(const doc of documents.values()){const d=el('details');d.className='source-document';let host;try{host=new URL(doc.url).hostname;}catch{host='Источник';}d.append(el('summary',host+(doc.translation?' · есть перевод':'')),link(doc.url,'Открыть источник'));if(doc.translation)d.append(el('h4','Перевод'),el('p',doc.translation));d.append(el('h4','Оригинал'),el('p',doc.text));box.append(d);}
 if(!documents.size)box.append(el('p','В прежней истории не сохранился полный исходный текст.'));
 const history=el('details');history.className='detail-history';history.append(el('summary','История и дополнительные сведения'),el('p','Впервые найден: '+time(r.firstFoundAt)+'. Выпуск приложения: '+day(r.released)+'.'));
 if(r.feedbackExampleIds?.length)history.append(el('p','В разбор передано ваших примеров: '+r.feedbackExampleIds.length+'. Факты проверены по источникам этого провайдера.'));
 if(r.intakeHistory)history.append(el('p','Причина сохранённого отсева: '+r.intakeHistory.reason));
 if(r.previousExclusionReason)history.append(el('p','Прежняя причина: '+r.previousExclusionReason));
 if(r.webPresence){history.append(el('p','Веб-кабинет: '+webPresenceLabel(r.webPresence.cabinet)));for(const url of r.webPresence.cabinet?.links??[])history.append(link(url,'Открыть адрес кабинета · вход не проверен'));}
 for(const error of r.sourceErrors??[])history.append(el('p',error));
 for(const licence of r.licences??[])history.append(el('p',[licence.organisation,licence.type,licence.status].filter(Boolean).join(' · ')),el('blockquote',licence.quote),link(licence.url,'Источник регистрации'));
 box.append(history);
}
function aiSettings(){return {...data.ai.config,time:$('#daily-time').value,translateRu:$('#translate').checked,includeKnown:$('#known').checked,engine:$('#ai-engine').value,mode:$('#ai-mode').value,ollamaModel:$('#ollama-model').value.trim(),localModel:$('#local-model').value.trim(),localEndpoints:lines('#local-endpoints'),hardwareProfile:$('#hardware-profile').value,geminiModel:$('#gemini-model').value.trim(),cloudConcurrency:Number($('#cloud-concurrency').value),sources:['play','web','social','watch']};}
async function saveSettings(){const countries=$('#countries').value.split(',').map(s=>s.trim().toUpperCase()).filter(Boolean),changes=[{source:'watch',filters:{watchRegisters:$('#register-watch').checked,watchUrls:lines('#watch-urls'),feedUrls:lines('#feed-urls')}},{source:'play',filters:{keywords:lines('#keywords'),countries,categories:checked('.play-category'),referenceDiscovery:$('#reference-discovery').checked,related:$('#related').checked,developerExpansion:$('#developers').checked}},{source:'web',filters:{queries:lines('#web-queries')}},{source:'social',filters:{sources:[...new Set([...checked('.publication-source'),...(data.monitors.social.schedule.filters.sources.includes('custom')?['custom']:[])])],eventMode:'signals'}}];await post('/api/crm/market-policy',{marketScope:$('#market-scope').value,blockedJurisdictions:$('#blocked-jurisdictions').value.split(',').map(s=>s.trim().toUpperCase()).filter(Boolean)});for(const change of changes)await post('/api/crm/settings',change);await post('/api/ai/config',aiSettings());dirty=false;$('#settings-feedback').textContent='Настройки сохранены. Количественные лимиты отключены.';}
$('#settings-form').addEventListener('input',()=>dirty=true);$('#settings-form').onsubmit=e=>{e.preventDefault();void action(saveSettings);};
$('#apply-hardware').onclick=()=>action(async()=>{const profile=HARDWARE_PROFILES[$('#hardware-profile').value];if(!profile)throw Error('Выберите профиль компьютера.');await post('/api/ai/config',{...aiSettings(),...profile});dirty=false;$('#local-status').textContent='Профиль сохранён. Запустите GPU-сервер по инструкции и проверьте подключение. Скачивание модели и платные API не запускались.';});
$('#test-brave').onclick=()=>action(async()=>{$('#brave-status').textContent='';const s=await post('/api/connections/brave/test');$('#brave-status').textContent=s.ok?'Brave отвечает. Выполнен один проверочный запрос; сайты и ИИ не запускались.':'';});
$('#test-local').onclick=()=>action(async()=>{await post('/api/ai/config',aiSettings());const s=await post('/api/ai/local/test');$('#local-status').textContent=s.workers?s.workers.map((w,i)=>'GPU '+(i+1)+': '+(w.ok&&w.installed?'готов':'недоступен / не совпадает alias')+' · '+w.endpoint).join('; '):s.installed?'Ollama отвечает, выбранная модель установлена.':'Модель Ollama не найдена: '+s.models.join(', ');});
$('#test-cloud').onclick=()=>action(async()=>{await post('/api/ai/config',aiSettings());const s=await post('/api/ai/cloud/test');$('#local-status').textContent='Получен ответ от '+s.model+'. Тест учтён в использовании API.';});
$('#collect').onclick=()=>action(async()=>{if(dirty)await saveSettings();await post('/api/neural/start');});$('#licence-run').onclick=()=>action(async()=>{if(dirty)await saveSettings();await post('/api/crm/licences/start');mode='licences';reasonFilter='';});$('#analyse').onclick=()=>action(async()=>{if(dirty)await saveSettings();await post('/api/ai/start');});$('#stop-all').onclick=()=>action(()=>post('/api/crm/stop'));$('#enable-daily').onclick=()=>action(async()=>{if(dirty)await saveSettings();await post('/api/crm/daily',{time:$('#daily-time').value});$('#settings-feedback').textContent='Ежедневный сбор и ИИ включены. Компьютер должен работать, сон выключен.';});
$('#manual-analyse').onclick=()=>action(async()=>{if(dirty)await saveSettings();await post('/api/crm/triage/start');mode='needs_review';reasonFilter='';});
$('#manual-resume').onclick=()=>action(async()=>{if(dirty)await saveSettings();await post('/api/crm/triage/start',{resume:true});mode='needs_review';});
$('#play-resume').onclick=()=>action(async()=>{await post('/api/backlog/continue');});
$('#reset-review').onclick=()=>action(async()=>{const result=await post('/api/crm/reset-review',{});mode='needs_review';reasonFilter='';selected.clear();selectedId=null;$('#detail').replaceChildren();$('#reset-review-info').textContent='Возвращено на проверку: '+result.restored+'. Записи в работе сохранены: '+result.protectedCount;});
$('#repair-local').onclick=()=>action(async()=>{const result=await post('/api/crm/repair');const memory=data.learning;$('#learning-status').textContent=memory?`Новых решений: ${memory.events}. Подходят: ${memory.positive} · отказов с примерами: ${memory.negative} · знакомых сервисов: ${memory.known}. Исправлено автоматических отказов: ${memory.correctedRejections??0}.`:'Новые ручные решения будут сохраняться локально.';
 $('#repair-info').textContent='Перепроверено без API: '+result.repaired;});$('#repair-ai').onclick=()=>action(async()=>{if(dirty)await saveSettings();await post('/api/ai/start',{repairOnly:true,reuseSaved:true});});
$('#database-source').onchange=()=>{selected.clear();limit=50;render();};
$('#open-settings').onclick=()=>{$('#settings').open=true;$('#settings').scrollIntoView({behavior:'smooth'});};
$('#choose-sources').onclick=()=>{$('#search-channels').open=true;$('#search-channels').scrollIntoView({behavior:'smooth'});};
$('#channel-query').oninput=renderChannels;$('#independent-schedules').onclick=()=>action(()=>post('/api/sources/independent'));
$('#query').oninput=()=>{selected.clear();limit=50;render();};$('#licence-type').onchange=()=>{selected.clear();limit=50;render();};$('#sort-order').onchange=()=>{localStorage.setItem('crmSort',$('#sort-order').value);render();};$('#more').onclick=()=>{limit+=50;render();};
$('#select-visible').onclick=()=>{for(const r of filtered().slice(0,limit))if(!pending.has(r.id))selected.add(r.id);render();};$('#select-matching').onclick=()=>{for(const r of filtered())if(!pending.has(r.id))selected.add(r.id);render();};$('#clear-selection').onclick=()=>{selected.clear();render();};$('#bulk-approve').onclick=()=>approveRows([...selected]);$('#bulk-worked').onclick=()=>queueExclusions([...selected],'worked');$('#bulk-exclude').onclick=()=>rejectRows([...selected]);$('#bulk-restore').onclick=()=>{const rows=data.rows.filter(r=>selected.has(r.id));if(rows.every(r=>!r.manualExcluded))returnToReview([...selected]);else mutate('restore',[...selected]);};$('#exclude-reason').onchange=()=>{localStorage.setItem('crmExcludeReason',globalReason());render();};
async function init(){for(const c of SEARCH_CHANNELS)$('#database-source').append(Object.assign(el('option',c.name),{value:c.id}));const [publication,licences]=await Promise.all([apiJSON('/api/social/defaults'),apiJSON('/api/licences')]);for(const r of licences.registers)$('#licence-registers').append(link(r.url,r.name+' · '+r.region));for(const [value,label]of Object.entries(SORT_OPTIONS))$('#sort-order').append(Object.assign(el('option',label),{value}));$('#sort-order').value=localStorage.getItem('crmSort')??'event_desc';for(const [value,label]of Object.entries(EXCLUSION_REASONS))$('#exclude-reason').append(Object.assign(el('option',label),{value}));$('#exclude-reason').value=localStorage.getItem('crmExcludeReason')??'';
 const categories=[{id:'FINANCE',name:'Финансы'},{id:'BUSINESS',name:'Бизнес'},{id:'PRODUCTIVITY',name:'Продуктивность'},{id:'TOOLS',name:'Инструменты'}];for(const [selector,items,className]of [['#play-categories',categories,'play-category'],['#publication-sources',publication.sources,'publication-source']])for(const item of items){if(item.id==='custom'||item.retired)continue;const label=el('label',item.name),input=el('input');input.type='checkbox';input.value=item.id;input.className=className;label.prepend(input);$(selector).append(label);}
 for(const [name,url]of [['Meta Ads Library','https://www.facebook.com/ads/library/'],['LinkedIn Ad Library','https://www.linkedin.com/ad-library/home'],['Google Ads Transparency','https://adstransparency.google.com/'],['TikTok Creative Center','https://ads.tiktok.com/business/creativecenter/']])$('#advertising-links').append(link(url,name));settingsReady=true;await refresh();}
init().catch(e=>$('#error').textContent=e.message);
