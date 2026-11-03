import {CRM_VIEW_LABELS,CRM_MAIN_VIEWS,matchesCRMView,reviewQuestion} from './crm-views.js';
import {SEARCH_CHANNELS,SOURCE_GROUPS,channelMatches} from './source-workspace-catalog.js';
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
let detailSequence=0,detailLoading=null,detailError='',detailUI=null;
const channelCards=new Map(),sourceGroupCards=new Map(),sourceSelected=new Set();
let sourceSelectionReady=false,sourceSelectionTimer,sourceSelectionWrites=Promise.resolve();
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
 busy=Boolean(data.sourceWorkspace?.busy||data.sourceDiagnostics?.busy||data.neural?.busy||data.ai.busy||Object.values(data.monitors).some(m=>m.busy));
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
 if(data.sourceDiagnostics?.busy&&!data.ai.busy)$('#work-status').textContent='Проверяем доступ к источникам: '+(data.sourceDiagnostics.job?.done??0)+' из '+(data.sourceDiagnostics.job?.total??0);
 if(!busy&&a?.outcomes)$('#work-status').textContent='Последняя проверка: подходят '+a.outcomes.suitable+' · отсеяно '+a.outcomes.filtered+' · требуют уточнения '+a.outcomes.needsReview+(a.outcomes.sourceUnavailable?' · сайтов недоступно '+a.outcomes.sourceUnavailable:'');
 if(pending.size&&!busy)$('#work-status').textContent='Сохраняем ваши отметки…';
 const progress=$('#analysis-progress');progress.hidden=!data.ai.busy;progress.max=Math.max(a?.total??1,1);progress.value=a?.done??0;
 $('#work-status').title=a?.workers?.map(w=>(w.engine==='openai'?'GPT':w.engine==='ollama'?'Ollama':w.engine)+': '+w.done+' готово · '+w.status).join('\n')??'';
 $('#source-status').replaceChildren(...Object.entries(data.monitors).map(([name,m])=>el('p',`${sources[name]??name} · ${m.busy?'в работе':'ожидание'}${m.lastJob?.ingestion?.rejected?' · отсеяно до ИИ: '+m.lastJob.ingestion.rejected:''}${m.lastJob?.errors?.length?' · '+m.lastJob.errors[0].message:''}`)));
 const socialApi=data.socialApi;if($('#social-api-status'))$('#social-api-status').textContent=socialApi?`Apify: Facebook ${socialApi.facebook?'задача и ключ заданы':'не настроен'} · LinkedIn ${socialApi.linkedin?'задача и ключ заданы':'не настроен'}. Сбор: Facebook до ${socialApi.maxItemsByConnector?.facebook??500}, LinkedIn до ${socialApi.maxItemsByConnector?.linkedin??20} результатов, 120 секунд. Денежный лимит дополнительно задайте в Apify.`:'';
 const memory=data.learning;$('#learning-status').textContent=memory?`Новых решений: ${memory.events}. Подходят: ${memory.positive} · отказов с примерами: ${memory.negative} · знакомых сервисов: ${memory.known}. Исправлено автоматических отказов: ${memory.correctedRejections??0}.`:'Новые ручные решения будут сохраняться локально.';
 $('#repair-info').textContent=data.ai.lastRepair?'Локальный пересчёт: '+data.ai.lastRepair.repaired+' разборов, без API.':'';
 $('#reset-review-info').textContent=data.reviewCycle?'Последний возврат на проверку: '+time(data.reviewCycle.startedAt)+'. Ручные отметки сохранены.':'';
 const messages=[data.storage?.lastError?.message,data.storage?.checkpointWarning,data.sourceWorkspace?.analysisPaused,...(data.neural?.errors??[]),...(a?.errors??[]).map(e=>e.message)].filter(Boolean);
 $('#run-errors').textContent=[...new Set(messages)].join(' ');
 renderChannels();
 $('#tabs').replaceChildren(...Object.entries(CRM_MAIN_VIEWS).map(([key,label])=>{const button=tabButton(key,label,all.filter(r=>visibleIn(r,key)).length,()=>{mode=key;localStorage.setItem('crmMainView',mode);reasonFilter='';selected.clear();clearDetail();limit=50;render();});button.dataset.view=key;return button;}));
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
 renderDetailState();
}
function saveSourceSelection(){const ids=[...sourceSelected];sourceSelectionWrites=sourceSelectionWrites.catch(()=>{}).then(()=>post('/api/sources/selection',{ids}));return sourceSelectionWrites;}
function sourceSelectionChanged(){clearTimeout(sourceSelectionTimer);sourceSelectionTimer=setTimeout(()=>saveSourceSelection().catch(error=>$('#error').textContent=error.message),200);renderChannels();}
function sourceMatchesQuery(c){const q=$('#channel-query').value.trim().toLowerCase();return !q||[c.name,c.id,SOURCE_GROUPS.find(g=>g.id===c.group)?.name].join(' ').toLowerCase().includes(q);}
function renderChannels(){
 const workspace=data.sourceWorkspace;if(!workspace)return;
 if(!sourceSelectionReady){for(const id of workspace.selectedIds??[])sourceSelected.add(id);sourceSelectionReady=true;}
 const query=$('#channel-query').value.trim().toLowerCase(),matches=sourceMatchesQuery,mutable=canEdit();
 const visible=workspace.channels.filter(matches),chosen=workspace.channels.filter(c=>sourceSelected.has(c.id)),probe=data.sourceDiagnostics;
 $('#source-selection-count').textContent=chosen.length?'· выбрано '+chosen.length:'';
 $('#source-start').textContent='Запустить выбранные · '+chosen.length+(chosen.some(c=>c.kind==='apify')?' · платный Apify':'');$('#source-start').disabled=!mutable||actionBusy||!chosen.length;
 $('#source-test').textContent='Проверить доступ · '+chosen.length;$('#source-test').disabled=!mutable||actionBusy||!chosen.length||probe?.busy;
 $('#source-batch-analyse').disabled=!mutable||actionBusy;
 $('#source-test-cost').textContent='Проверка доступа: до '+chosen.filter(c=>c.connection?.mode==='brave_index').length+' запросов Brave и чтение открытых страниц. Проверка Apify читает настройки задачи без запуска сбора. ИИ не вызывается.';
 const diagnosticJob=probe?.job;$('#source-probe-status').textContent=diagnosticJob?(probe.busy?'Проверяем доступ: ':'Последняя проверка: ')+diagnosticJob.done+' из '+diagnosticJob.total+(diagnosticJob.current?' · '+(workspace.channels.find(c=>c.id===diagnosticJob.current)?.name??diagnosticJob.current):'')+(diagnosticJob.status==='cancelled'?' · остановлена':''):'';
 const all=$('#source-select-visible');all.checked=Boolean(visible.length)&&visible.every(c=>sourceSelected.has(c.id));all.indeterminate=visible.some(c=>sourceSelected.has(c.id))&&!all.checked;all.disabled=!mutable||!visible.length;
 for(const definition of SOURCE_GROUPS){let group=sourceGroupCards.get(definition.id);const channels=workspace.channels.filter(c=>c.group===definition.id),shown=channels.filter(matches);if(!channels.length)continue;
  if(!group){const box=el('details');box.className='source-group';box.dataset.group=definition.id;box.open=channels.some(c=>sourceSelected.has(c.id));const summary=el('summary'),label=el('label'),checkbox=el('input');checkbox.type='checkbox';checkbox.setAttribute('aria-label','Выбрать категорию: '+definition.name);checkbox.onclick=e=>e.stopPropagation();label.append(checkbox,el('strong',definition.name));const count=el('span');count.className='source-group-count';summary.append(label,count);const list=el('div');list.className='source-group-items';box.append(summary,list);$('#channel-list').append(box);group={box,checkbox,count,list};sourceGroupCards.set(definition.id,group);checkbox.onchange=()=>{for(const c of workspace.channels.filter(c=>c.group===definition.id&&matches(c)))checkbox.checked?sourceSelected.add(c.id):sourceSelected.delete(c.id);sourceSelectionChanged();};}
  group.box.hidden=!shown.length;group.checkbox.checked=Boolean(shown.length)&&shown.every(c=>sourceSelected.has(c.id));group.checkbox.indeterminate=shown.some(c=>sourceSelected.has(c.id))&&!group.checkbox.checked;group.checkbox.disabled=!mutable;group.count.textContent=channels.filter(c=>sourceSelected.has(c.id)).length+' / '+channels.length;
  if(query&&shown.length)group.box.open=true;
  for(const c of channels){let ui=channelCards.get(c.id);
   if(!ui){const card=el('article');card.className='source-choice-row';card.dataset.source=c.id;const head=el('div');head.className='source-choice-head';const choice=el('input');choice.type='checkbox';choice.className='source-choice';choice.setAttribute('aria-label','Источник: '+c.name);const label=el('label');label.append(choice,el('strong',c.name));choice.onchange=()=>{choice.checked?sourceSelected.add(c.id):sourceSelected.delete(c.id);sourceSelectionChanged();};const status=el('p'),connection=el('small',c.connection?.label),diagnostic=el('p');diagnostic.className='source-diagnostic';diagnostic.setAttribute('role','status');head.append(label);card.append(head,connection,status,diagnostic);
    const start=el('button','Только этот источник');start.type='button';start.className='outline-button';const stop=el('button','Остановить');stop.type='button';stop.className='cancel-button';const view=el('button','Показать находки');view.type='button';view.className='text-button';view.onclick=()=>{$('#database-source').value=c.id;mode='needs_review';selected.clear();clearDetail();limit=50;render();$('#list').scrollIntoView({behavior:'smooth'});};
    const enabled=el('input');enabled.type='checkbox';const daily=el('label','Ежедневно');daily.prepend(enabled);const at=el('input');at.type='time';at.setAttribute('aria-label','Время · '+c.name);const analyse=el('input');analyse.type='checkbox';const after=el('label','ИИ после отдельного запуска');after.prepend(analyse);const save=el('button','Сохранить расписание');save.type='button';save.className='outline-button';const config=el('a','Настройки поиска');config.href=c.settingsURL;if(c.kind==='apify')config.onclick=event=>{event.preventDefault();$('#settings').open=true;$('#social-api-settings').scrollIntoView({behavior:'smooth'});};const options=el('details');options.className='channel-options';const actions=el('div');actions.className='crm-actions';actions.append(start,stop,view);options.append(el('summary','Отдельный запуск и расписание'),actions,daily,at,after,save,config);
    if(c.connection?.manualURL)options.append(link(c.connection.manualURL,c.source?.includes('ads')?'Открыть библиотеку рекламы':'Открыть сайт'),link(c.connection.helpURL,'Как подключается этот источник'));
    card.append(options);group.list.append(card);ui={card,choice,status,diagnostic,start,stop,enabled,at,analyse,save,dirty:false};channelCards.set(c.id,ui);for(const input of[enabled,at,analyse])input.oninput=()=>ui.dirty=true;
    const saveChannel=async()=>{await post('/api/sources/settings',{id:c.id,enabled:enabled.checked,time:at.value,analyse:analyse.checked});ui.dirty=false;};save.onclick=()=>action(saveChannel);start.onclick=()=>action(async()=>{if(dirty)await saveSettings();if(ui.dirty)await saveChannel();await post('/api/sources/start',{id:c.id,analyse:analyse.checked,allowPaid:c.kind==='apify'});});stop.onclick=()=>action(()=>post('/api/sources/cancel',{id:c.id}));
   }
   ui.card.hidden=!matches(c);ui.choice.checked=sourceSelected.has(c.id);ui.choice.disabled=!mutable;
   const last=c.last,isLive=last&&['queued','running','cancelling'].includes(last.status);ui.status.textContent=last?({queued:'Ожидает запуска',running:'Ищет',cancelling:'Останавливается',complete:'Завершён',partial:'Частично завершён',failed:'Ошибка',cancelled:'Остановлен',interrupted:'Прерван'}[last.status]??last.status)+' · ссылок '+(last.found??0)+(last.total?' · '+(last.done??0)+'/'+last.total:'')+(last.current?' · '+last.current:'')+(last.error?' · '+last.error:'')+(last.errors?.[0]?' · '+last.errors[0].message:''):'Поиск ещё не запускался';
   if(c.kind==='apify'&&last?.runURL)ui.status.append(document.createTextNode(typeof last.spentUsd==='number'?' · учтено Apify $'+last.spentUsd.toFixed(3)+' · ':' · '),link(last.runURL,'Запуск и расход Apify'));
   const check=probe?.results?.[c.id];ui.diagnostic.dataset.status=check?.status??'unknown';ui.diagnostic.textContent=check?({ok:'Доступ проверен',limited:'Доступ ограничен',no_results:'Нет контрольных результатов',not_configured:'Нужно подключение',failed:'Ошибка доступа'}[check.status]??check.status)+' · '+check.message:'Доступ ещё не проверен';
   if(!ui.dirty){ui.enabled.checked=c.settings.enabled;ui.at.value=c.settings.time;ui.analyse.checked=c.settings.analyse;}ui.start.disabled=!mutable||actionBusy||isLive;ui.stop.hidden=!isLive;ui.stop.disabled=!mutable||actionBusy;for(const input of[ui.enabled,ui.at,ui.analyse,ui.save])input.disabled=!mutable||actionBusy;if(c.kind==='apify'){ui.enabled.disabled=true;ui.at.disabled=true;}
  }
 }
 const legacy=workspace.legacyCombined||workspace.legacySchedules.length;$('#legacy-source-status').textContent=data.runtime?.manual?'Расписания сохранены. В ручном запуске ежедневные задания приостановлены.':legacy?'Включены прежние общие расписания. Их можно отключить и использовать расписания отдельных источников.':'Прежние общие расписания выключены.';$('#independent-schedules').hidden=!legacy;$('#independent-schedules').disabled=!mutable||actionBusy;
}
function rejectRows(ids){if(!canEdit()||!ids.length)return;rejectionIds=[...ids];$('#reject-dialog').showModal();}
for(const button of document.querySelectorAll('[data-reject-reason]'))button.onclick=()=>{const ids=[...rejectionIds];$('#reject-dialog').close();rejectionIds=[];queueExclusions(ids,button.dataset.rejectReason);};
$('#close-reject-dialog').onclick=()=>{$('#reject-dialog').close();rejectionIds=[];};
async function post(path,body={}){return apiJSON(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});}
async function refresh(force=false){
 if(loading){if(!force)return loading;await loading;return refresh();}
 const current=(async()=>{try{data=await apiJSON('/api/crm');if(lastRefreshError&&$('#error').textContent===lastRefreshError.message)$('#error').textContent='';lastRefreshError=null;for(const id of settledMutations)pending.delete(id);settledMutations.clear();render();const latest=data.rows.find(r=>r.id===selectedId);if(latest&&(!detailRow||latest.detailRevision!==detailRow.detailRevision))void loadDetail(selectedId);return true;}catch(e){lastRefreshError=e;$('#error').textContent=e.message;return false;}finally{if(loading===current)loading=null;clearTimeout(poll);poll=setTimeout(()=>refresh(),busy?1800:7000);}})();loading=current;return current;
}
async function action(fn){if(actionBusy||!canEdit())return;actionBusy=true;render();$('#error').textContent='';try{await fn();await refresh(true);}catch(e){$('#error').textContent=e.message;}finally{actionBusy=false;render();}}
function queueExclusions(ids,reason){if(!canEdit())return;if(!Object.hasOwn(EXCLUSION_REASONS,reason)){$('#error').textContent='Выберите причину исключения в панели списка или карточке.';return;}for(const id of ids){if(pending.has(id))continue;pending.set(id,reason);queued.set(id,reason);selected.delete(id);}render();clearTimeout(flushTimer);flushTimer=setTimeout(flushExclusions,100);}
async function flushExclusions(){if(writeActive||!queued.size)return;writeActive=true;const reason=queued.values().next().value,ids=[...queued].filter(([,r])=>r===reason).map(([id])=>id);for(const id of ids)queued.delete(id);
 try{await post('/api/crm/bulk',{ids,action:'exclude',reason});}catch(e){$('#error').textContent=e.message;}finally{for(const id of ids)settledMutations.add(id);await refresh(true);writeActive=false;render();if(selectedId&&ids.includes(selectedId))void openDetail(selectedId);if(queued.size)void flushExclusions();}
}
async function returnToReview(ids){await action(async()=>{await post('/api/crm/bulk',{ids,action:'status',status:'review'});mode='needs_review';for(const id of ids)selected.delete(id);if(selectedId&&ids.includes(selectedId))await openDetail(selectedId);});}
async function approveRows(ids){await action(async()=>{await post('/api/crm/bulk',{ids,action:'status',status:'approved'});for(const id of ids)selected.delete(id);if(selectedId&&ids.includes(selectedId))await openDetail(selectedId);});}
async function mutate(actionName,ids){await action(async()=>{await post('/api/crm/bulk',{action:actionName,ids});if(actionName==='restore')mode='needs_review';for(const id of ids)selected.delete(id);if(selectedId&&ids.includes(selectedId)){if(selectedId.startsWith('known:')){clearDetail();}else await openDetail(selectedId);}});}
function clearDetail(){selectedId=null;detailRow=null;detailUI=null;detailLoading=null;detailError='';detailSequence++;$('#detail').innerHTML='<div class="detail-placeholder"><span aria-hidden="true">i</span><h2>Выберите провайдера</h2><p>Условия, источники и ваши заметки.</p></div>';}
async function openDetail(id){if(selectedId!==id){clearDetail();selectedId=id;$('#detail').replaceChildren(el('p','Загружаем карточку…'));}render();await loadDetail(id,{force:true,scroll:true});}
async function loadDetail(id,{force=false,scroll=false}={}){
 if(!id||selectedId!==id)return;
 if(!force&&detailLoading?.id===id)return detailLoading.promise;
 const sequence=++detailSequence;
 const promise=(async()=>{try{
  const row=await apiJSON('/api/crm/item?'+new URLSearchParams({id}));if(selectedId!==id||sequence!==detailSequence)return;
  detailError='';if(!detailRow||row.detailRevision!==detailRow.detailRevision){detailRow=row;renderDetail(row);}renderDetailState();
  if(scroll&&window.matchMedia('(max-width:760px)').matches)$('#detail').scrollIntoView({behavior:'smooth',block:'start'});
 }catch(e){if(selectedId!==id||sequence!==detailSequence)return;detailError='Не удалось обновить карточку: '+e.message;if(!detailUI){const status=el('p');status.className='detail-check-status';status.setAttribute('role','status');const retry=el('button','Обновить карточку');retry.type='button';retry.onclick=()=>loadDetail(id,{force:true});$('#detail').replaceChildren(status,retry);detailUI={status,retry};}renderDetailState();}
 finally{if(sequence===detailSequence){detailLoading=null;renderDetailState();}}})();detailLoading={id,promise};return promise;
}
function renderDetailState(){
 if(!detailUI||!selectedId)return;
 const {status,check,retry}=detailUI,r=detailRow,job=data?.ai.job,inJob=job?.candidateIds?.includes(selectedId),complete=job?.results?.includes(selectedId),error=job?.errors?.find(e=>e.id===selectedId),checking=data?.ai.busy&&inJob&&!complete&&!error;
 if(check){check.disabled=!canEdit()||actionBusy||busy||!data.ai.configured;check.textContent=checking?'Проверка идёт…':'Проверить сведения';}
 for(const b of $('#detail .detail-actions')?.querySelectorAll('button')??[])b.disabled=!canEdit()||actionBusy;
 let message='',failed=false;
 if(detailError){message=detailError;failed=true;}
 else if(error){message='Проверка не завершена: '+error.message;failed=true;}
 else if(checking){const worker=job.workers?.find(w=>w.currentId===selectedId);message=worker?'Проверяем сведения'+(worker.stage?' · '+worker.stage:'')+'. Результат появится здесь автоматически.':'Карточка в очереди проверки. Результат появится здесь автоматически.';}
 else if(inJob&&!complete&&['cancelled','interrupted','failed','partial'].includes(job.status)){message=job.status==='cancelled'?'Проверка остановлена.':'Проверка этой карточки не завершена.';const generalError=job.errors?.find(e=>!e.id&&!e.title);if(generalError?.message)message+=' '+generalError.message;failed=true;}
 else if(r?.analysedAt||r?.model&&r?.checkedAt){message='Последняя проверка: '+time(r.analysedAt??r.checkedAt)+(r.model?' · '+r.model:'')+'.';if(['business','account','euIban'].every(k=>!r.facts?.[k]||r.facts[k].status==='unknown'))message+=' Подтверждающих цитат не найдено.';}
 if(!detailError&&!checking&&r?.sourceErrors?.length){message+=' '+[...new Set(r.sourceErrors)].join(' ');failed=true;}
 status.textContent=message;status.hidden=!message;status.dataset.status=failed?'warning':checking?'running':'complete';if(retry){retry.hidden=!detailError;retry.disabled=Boolean(detailLoading);}
}
function renderDetail(r){
 const box=$('#detail'),same=detailUI?.id===r.id,opened=new Set(same?[...box.querySelectorAll('details[open][data-detail-key]')].map(d=>d.dataset.detailKey):[]),oldNotes=same?$('#record-notes'):null,focused=oldNotes&&document.activeElement===oldNotes,caret=focused?[oldNotes.selectionStart,oldNotes.selectionEnd]:null,scrollTop=box.scrollTop,pageScroll=window.scrollY;box.replaceChildren();
 const status=el('p');status.className='detail-check-status';status.setAttribute('role','status');const retry=el('button','Обновить карточку');retry.type='button';retry.className='outline-button';retry.hidden=true;retry.onclick=()=>loadDetail(r.id,{force:true});detailUI={id:r.id,status,retry};
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
  detailUI.check=check;box.append(check);const hint=el('p','Чтение сайта и выбранный ИИ · облачный API может быть платным.');hint.className='hint';box.append(hint);
 }
 box.append(status,retry);
 if(r.intakeRecord){const info=el('p','Отсеяно правилом сбора до обращения к ИИ. Исходное описание сохранено ниже.');info.className='hint';box.append(info);}
 if(r.approval){const approved=el('p','Подтверждено вами: '+time(r.approval.at));approved.className='approval-note';box.append(approved);}
 if(r.analysisStale)box.append(el('p','Источники обновились после последней проверки. Сведения требуют уточнения.'));
 const grid=el('div');grid.className='fact-grid';
 for(const key of['business','account','euIban']){const fact=r.facts?.[key],card=el('div');card.className='fact-card';card.dataset.status=fact?.status??'unknown';card.append(el('small',facts[key]),el('strong',({yes:'Подтверждено',no:'Есть отрицательная цитата',unknown:'Не подтверждено'})[fact?.status??'unknown']));grid.append(card);}box.append(grid);
 if(r.research){const read=r.research.pages.filter(p=>p.status==='read').length,failed=r.research.pages.filter(p=>p.status!=='read').length;box.append(Object.assign(el('p',`Прочитано страниц сайта: ${read}${failed?' · недоступно: '+failed:''}. Поисков уточнения: ${r.research.indexQueries}.`),{className:'hint'}));}
 const notesLabel=el('label','Мои заметки'),notes=el('textarea',noteDrafts.get(r.id)??r.notes??'');notesLabel.htmlFor='record-notes';notes.id='record-notes';notes.rows=3;notes.placeholder='Условия, контакт или результат вашей проверки';notes.disabled=!canEdit();notes.oninput=()=>noteDrafts.set(r.id,notes.value);
 box.append(notesLabel,notes,button('Сохранить заметку',()=>action(async()=>{const saved=notes.value;await post('/api/crm/update',{id:r.id,notes:saved});if(noteDrafts.get(r.id)===saved)noteDrafts.delete(r.id);if(selectedId===r.id)await loadDetail(r.id,{force:true});})));
 const proofs=el('details');proofs.dataset.detailKey='proofs';proofs.className='source-proofs';proofs.append(el('summary','Цитаты и результат проверки'));
 const noModel=['pre_ai_screen','registry_event'].includes(r.analysisMethod)||r.intakeRecord;
 proofs.append(el('p',noModel?'Автопроверка · без вызова ИИ':r.model?'Проверка: '+r.model+' · '+time(r.checkedAt??r.analysedAt):'ИИ ещё не проверял эти сведения.'));
 if(r.summary)proofs.append(el('p',r.summary));
 for(const evidence of r.reviewRouting?.evidence??[])proofs.append(el('blockquote',evidence.quote),link(evidence.url,'Источник решения'));
 for(const [key,fact]of Object.entries(r.facts??{}))for(const evidence of fact.evidence??[]){proofs.append(el('h4',facts[key]??key),el('blockquote',evidence.quote),link(evidence.url,'Источник цитаты'));}
 if(r.summaryOriginal&&r.summaryOriginal!==r.summary){const original=el('details');original.dataset.detailKey='original';original.append(el('summary',noModel?'Исходный результат правила':'Ответ модели до проверки цитат'),el('p',r.summaryOriginal));proofs.append(original);}box.append(proofs);
 const documents=new Map((r.documents??[]).map(d=>[d.url,d]));for(const t of r.translations??[])documents.set(t.url,{url:t.url,text:documents.get(t.url)?.text??t.original,translation:t.translationRu});
 const sourcesHeading=el('h3','Исходные материалы');sourcesHeading.className='detail-section-title';box.append(sourcesHeading);
 for(const doc of documents.values()){const d=el('details');d.dataset.detailKey='doc:'+doc.url;d.className='source-document';let host;try{host=new URL(doc.url).hostname;}catch{host='Источник';}d.append(el('summary',host+(doc.translation?' · есть перевод':'')),link(doc.url,'Открыть источник'));if(doc.translation)d.append(el('h4','Перевод'),el('p',doc.translation));d.append(el('h4','Оригинал'),el('p',doc.text));box.append(d);}
 if(!documents.size)box.append(el('p','В прежней истории не сохранился полный исходный текст.'));
 const history=el('details');history.dataset.detailKey='history';history.className='detail-history';history.append(el('summary','История и дополнительные сведения'),el('p','Впервые найден: '+time(r.firstFoundAt)+'. Выпуск приложения: '+day(r.released)+'.'));
 if(r.feedbackExampleIds?.length)history.append(el('p','В разбор передано ваших примеров: '+r.feedbackExampleIds.length+'. Факты проверены по источникам этого провайдера.'));
 if(r.intakeHistory)history.append(el('p','Причина сохранённого отсева: '+r.intakeHistory.reason));
 if(r.previousExclusionReason)history.append(el('p','Прежняя причина: '+r.previousExclusionReason));
 if(r.webPresence){history.append(el('p','Веб-кабинет: '+webPresenceLabel(r.webPresence.cabinet)));for(const url of r.webPresence.cabinet?.links??[])history.append(link(url,'Открыть адрес кабинета · вход не проверен'));}
 for(const error of r.sourceErrors??[])history.append(el('p',error));
 for(const licence of r.licences??[])history.append(el('p',[licence.organisation,licence.type,licence.status].filter(Boolean).join(' · ')),el('blockquote',licence.quote),link(licence.url,'Источник регистрации'));
 box.append(history);
 for(const d of box.querySelectorAll('details[data-detail-key]'))d.open=opened.has(d.dataset.detailKey);
 if(focused){notes.focus({preventScroll:true});notes.setSelectionRange(...caret);}if(same){box.scrollTop=scrollTop;window.scrollTo({top:pageScroll,behavior:'instant'});}renderDetailState();
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
$('#reset-review').onclick=()=>action(async()=>{const result=await post('/api/crm/reset-review',{});mode='needs_review';reasonFilter='';selected.clear();clearDetail();$('#reset-review-info').textContent='Возвращено на проверку: '+result.restored+'. Записи в работе сохранены: '+result.protectedCount;});
$('#repair-local').onclick=()=>action(async()=>{const result=await post('/api/crm/repair');const memory=data.learning;$('#learning-status').textContent=memory?`Новых решений: ${memory.events}. Подходят: ${memory.positive} · отказов с примерами: ${memory.negative} · знакомых сервисов: ${memory.known}. Исправлено автоматических отказов: ${memory.correctedRejections??0}.`:'Новые ручные решения будут сохраняться локально.';
 $('#repair-info').textContent='Перепроверено без API: '+result.repaired;});$('#repair-ai').onclick=()=>action(async()=>{if(dirty)await saveSettings();await post('/api/ai/start',{repairOnly:true,reuseSaved:true});});
$('#database-source').onchange=()=>{selected.clear();clearDetail();limit=50;render();};
$('#open-settings').onclick=()=>{$('#settings').open=true;$('#settings').scrollIntoView({behavior:'smooth'});};
$('#choose-sources').onclick=()=>{$('#search-channels').open=true;$('#search-channels').scrollIntoView({behavior:'smooth'});};
$('#source-select-visible').onchange=event=>{const query=$('#channel-query').value.trim().toLowerCase();for(const c of data.sourceWorkspace.channels)if(!query||[c.name,c.id,SOURCE_GROUPS.find(g=>g.id===c.group)?.name].join(' ').toLowerCase().includes(query))event.target.checked?sourceSelected.add(c.id):sourceSelected.delete(c.id);sourceSelectionChanged();};
$('#source-start').onclick=()=>action(async()=>{clearTimeout(sourceSelectionTimer);await saveSourceSelection();if(dirty)await saveSettings();const result=await post('/api/sources/start-many',{ids:[...sourceSelected],analyse:$('#source-batch-analyse').checked,requestId:crypto.randomUUID(),allowPaid:[...sourceSelected].some(id=>id.startsWith('apify:'))});$('#source-batch-status').textContent='Запущено: '+result.runs.length+(result.skipped.length?' · уже работают: '+result.skipped.length:'');});
$('#source-test').onclick=()=>action(async()=>{clearTimeout(sourceSelectionTimer);await saveSourceSelection();await post('/api/sources/test',{ids:[...sourceSelected]});});
$('#channel-query').oninput=renderChannels;$('#independent-schedules').onclick=()=>action(()=>post('/api/sources/independent'));
$('#query').oninput=()=>{selected.clear();clearDetail();limit=50;render();};$('#licence-type').onchange=()=>{selected.clear();clearDetail();limit=50;render();};$('#sort-order').onchange=()=>{localStorage.setItem('crmSort',$('#sort-order').value);render();};$('#more').onclick=()=>{limit+=50;render();};
$('#select-visible').onclick=()=>{for(const r of filtered().slice(0,limit))if(!pending.has(r.id))selected.add(r.id);render();};$('#select-matching').onclick=()=>{for(const r of filtered())if(!pending.has(r.id))selected.add(r.id);render();};$('#clear-selection').onclick=()=>{selected.clear();render();};$('#bulk-approve').onclick=()=>approveRows([...selected]);$('#bulk-worked').onclick=()=>queueExclusions([...selected],'worked');$('#bulk-exclude').onclick=()=>rejectRows([...selected]);$('#bulk-restore').onclick=()=>{const rows=data.rows.filter(r=>selected.has(r.id));if(rows.every(r=>!r.manualExcluded))returnToReview([...selected]);else mutate('restore',[...selected]);};$('#exclude-reason').onchange=()=>{localStorage.setItem('crmExcludeReason',globalReason());render();};
async function init(){for(const c of SEARCH_CHANNELS)$('#database-source').append(Object.assign(el('option',c.name),{value:c.id}));const [publication,licences]=await Promise.all([apiJSON('/api/social/defaults'),apiJSON('/api/licences')]);for(const r of licences.registers)$('#licence-registers').append(link(r.url,r.name+' · '+r.region));for(const [value,label]of Object.entries(SORT_OPTIONS))$('#sort-order').append(Object.assign(el('option',label),{value}));$('#sort-order').value=localStorage.getItem('crmSort')??'event_desc';for(const [value,label]of Object.entries(EXCLUSION_REASONS))$('#exclude-reason').append(Object.assign(el('option',label),{value}));$('#exclude-reason').value=localStorage.getItem('crmExcludeReason')??'';
 const categories=[{id:'FINANCE',name:'Финансы'},{id:'BUSINESS',name:'Бизнес'},{id:'PRODUCTIVITY',name:'Продуктивность'},{id:'TOOLS',name:'Инструменты'}];for(const [selector,items,className]of [['#play-categories',categories,'play-category'],['#publication-sources',publication.sources,'publication-source']])for(const item of items){if(item.id==='custom'||item.retired)continue;const label=el('label',item.name),input=el('input');input.type='checkbox';input.value=item.id;input.className=className;label.prepend(input);$(selector).append(label);}
 for(const [name,url]of [['Meta Ads Library','https://www.facebook.com/ads/library/'],['LinkedIn Ad Library','https://www.linkedin.com/ad-library/home'],['Google Ads Transparency','https://adstransparency.google.com/'],['TikTok Creative Center','https://ads.tiktok.com/business/creativecenter/']])$('#advertising-links').append(link(url,name));settingsReady=true;await refresh();}
init().catch(e=>$('#error').textContent=e.message);
