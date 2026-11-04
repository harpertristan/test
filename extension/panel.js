(()=>{
  if(globalThis.__registrationAssistant){globalThis.__registrationAssistant.toggle();return;}
  const host=document.createElement('div');
  host.setAttribute('data-registration-assistant','');
  host.style.cssText='all:initial!important;position:fixed!important;right:12px!important;top:12px!important;bottom:12px!important;width:400px!important;max-width:calc(100vw - 24px)!important;z-index:2147483647!important;display:block!important;';
  const shadow=host.attachShadow({mode:'closed'});
  const style=document.createElement('style');style.textContent=`:host{color-scheme:light}[hidden]{display:none!important}.dock{padding:12px;background:white;border:1px solid #b9cebe;border-radius:12px;box-shadow:0 4px 24px #0002;color:#17302e;font:13px Segoe UI,Arial}.dock-head{display:flex;justify-content:space-between;align-items:center}.dock select{margin:6px 0}.dock button{margin:0;padding:7px 10px}.dock-status{font-size:12px;color:#64756b;margin:4px 0}.detail-mode>:not(.field-detail){display:none!important}.field-detail h3{font-size:19px;margin:10px 0}.field-detail h4{font-size:13px;margin:18px 0 6px}.detail-nav{display:flex;gap:8px}.full-explanation{white-space:pre-wrap}.detail-label{font-size:12px;color:#64756b}.detail-value{background:#e7eee7;padding:12px;border-radius:8px;white-space:pre-wrap;font-weight:600}.detail-source{border-left:3px solid #b9cebe;padding:8px 12px;white-space:pre-wrap}*{box-sizing:border-box}.panel{height:100%;display:flex;flex-direction:column;background:#f4f6f2;border:1px solid #b9cebe;border-radius:14px;box-shadow:0 8px 40px #0003;color:#17302e;font:13px/1.5 'Segoe UI',Arial,sans-serif;overflow:hidden}header{background:white;padding:16px;border-bottom:1px solid #dce4dc;display:flex;align-items:center;justify-content:space-between}h2{font-size:17px;margin:0}h3{font-size:14px;margin:8px 0}main{overflow:auto;padding:16px;flex:1}p{margin:8px 0}button{border:0;border-radius:7px;background:#22674c;color:white;padding:9px 12px;cursor:pointer;font:inherit;margin:4px 5px 4px 0}button:disabled{opacity:.5;cursor:wait}.quiet{color:#21523e;background:#e7eee7}input,select,textarea{width:100%;font:inherit;background:white;color:#17302e;border:1px solid #b8c9be;border-radius:7px;padding:9px;margin:7px 0}label{display:block;font-weight:600;margin:10px 0 4px}.card{background:white;border:1px solid #dce4dc;padding:13px;margin:12px 0;border-radius:10px;overflow-wrap:anywhere}.value{font-size:15px;font-weight:600;white-space:pre-wrap}.source{font-size:11px;color:#64756b}.note{background:#e7eee7;padding:10px;border-radius:8px}.status{font-size:12px;white-space:pre-wrap;color:#755221}.badge{font-size:11px;color:#48725b}.rules{color:#8a3425}details{margin-top:9px}summary{cursor:pointer}.bottom{padding:10px 16px;border-top:1px solid #dce4dc;font-size:11px;background:white}.selected{background:#f0f5ed;padding:8px;border-radius:7px}a{color:#22674c}`;
  shadow.append(style);
  function element(tag,text,className){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;}
  const dock=element('section',undefined,'dock'),dockHead=element('div',undefined,'dock-head'),dockSelect=element('select'),dockOpen=element('button','Открыть','quiet'),dockStatus=element('p','Выберите компанию','dock-status'),fieldDetail=element('section',undefined,'field-detail'),allFields=element('button','Все поля','quiet');dockSelect.setAttribute('aria-label','Компания для подсказок');dockHead.append(element('strong','Помощник'),dockOpen);dock.append(dockHead,dockSelect,dockStatus);
  const panel=element('section',undefined,'panel'),header=element('header'),title=element('h2','Помощник регистраций'),close=element('button','×','quiet'),main=element('main'),status=element('p','','status'),companySelect=element('select'),cards=element('div'),manual=element('div');
  const appearanceLabel=element('label','Оформление'),appearanceSelect=element('select');for(const [value,text] of [['classic','Обычное'],['violet','Тёмное фиолетовое']]){const option=element('option',text);option.value=value;appearanceSelect.append(option);}appearanceLabel.append(appearanceSelect);
  const agentButton=element('button','Агент: разобрать анкету','quiet'),aiSettings=element('button','Настроить OpenAI','quiet'),overlayLabel=element('label'),overlayToggle=element('input'),assessment=element('p','','note');overlayToggle.type='checkbox';overlayToggle.checked=true;overlayToggle.style.width='auto';overlayLabel.append(overlayToggle,document.createTextNode(' Подсказки прямо у полей'));
  const aiAutoLabel=element('label'),aiAutoToggle=element('input'),aiState=element('p','','note'),pageAdvice=element('p','','note'),coverage=element('p','','status');aiAutoToggle.type='checkbox';aiAutoToggle.checked=true;aiAutoToggle.style.width='auto';aiAutoLabel.append(aiAutoToggle,document.createTextNode(' ИИ читает и объясняет каждое поле'));aiState.textContent='OpenAI получает вопросы, варианты, отмеченные ответы и подходящие подтверждённые сведения с цитатами из кабинета компании. Текст, введённый на этом сайте, не передаётся.';
  const fillButton=element('button','Заполнить найденные пустые поля'),autoLabel=element('label'),autoToggle=element('input'),roleSelect=element('select');
  autoToggle.type='checkbox';autoToggle.style.width='auto';autoLabel.append(autoToggle,document.createTextNode(' Автоматически заполнять новые пустые поля'));
  for(const [value,text] of [['contact','Контактное лицо из блокнота'],['director','Директор'],['beneficiary','Бенефициар']]){const option=element('option',text);option.value=value;roleSelect.append(option);}
  const roleLabel=element('label','Чьи сведения использовать');roleLabel.append(roleSelect);
  const settings=element('button','Подключение','quiet'),refresh=element('button','Обновить поля','quiet'),companyLabel=element('label','Рабочая компания'),intro=element('p','ИИ объясняет вопросы и варианты ответа. Подтверждённые реквизиты можно вставить в обычные поля; выбор ответов и отправка остаются у вас.','note');
  companyLabel.append(companySelect);header.append(title,allFields,close);main.append(fieldDetail,intro,settings,refresh,companyLabel,roleLabel,appearanceLabel,aiAutoLabel,agentButton,aiSettings,aiState,pageAdvice,coverage,overlayLabel,assessment,fillButton,autoLabel,status,cards,manual);panel.append(header,main,element('div','Пароли, подтверждения, подписи и отправка анкеты — у вас.','bottom'));shadow.append(panel,dock);document.documentElement.append(host);
  let expanded=false,detailTarget=null;
  panel.hidden=true;host.style.setProperty('top','auto','important');host.style.setProperty('width','320px','important');
  let visible=true,active=true,companyId='',facts=[],fieldTitles={},fieldMap=new Map(),version=0,timer,lastSignature='',pageKey=location.href,lastProposals=[],filling=false,lastReview=null,polling=false,ticks=0,agentEnabled=false,pendingScan=false;const agentAdvice=new Map();let agentBusy=false,lastAIRequest='',agentTimer;
  const toggle=()=>{visible=!visible;host.style.setProperty('display',visible?'block':'none','important');if(visible)void scan(true);else clearOverlay();};
  globalThis.__registrationAssistant={toggle};close.textContent='Свернуть';close.addEventListener('click',()=>setExpanded(false));dockOpen.addEventListener('click',()=>{if(activeOverlay){const proposal=lastProposals.find(p=>fieldMap.get(p.id)?.el===activeOverlay);if(proposal){openDetail(proposal,activeOverlay);return;}}showAllFields();});allFields.addEventListener('click',showAllFields);dockSelect.addEventListener('change',()=>{companySelect.value=dockSelect.value;companySelect.dispatchEvent(new Event('change'));});
  settings.addEventListener('click',safe(()=>chrome.runtime.sendMessage({type:'openSettings'})));aiSettings.addEventListener('click',safe(()=>chrome.runtime.sendMessage({type:'openDashboard'})));
  const say=text=>{status.textContent=text;dockStatus.textContent=!companyId?'Выберите компанию':agentBusy?'ИИ разбирает анкету…':lastProposals.length?`Вопросов: ${lastProposals.length}. Выберите поле на странице.`:text;};
  async function api(path,body){let result;try{result=await chrome.runtime.sendMessage({type:'api',path,method:body?'POST':'GET',body});}catch(error){if(/context invalidated/i.test(error.message))throw Error('Расширение перезагружено. Сохраните анкету и обновите вкладку.');throw error;}if(!result.ok)throw Error(result.error);return result.data;}
  function safe(fn){return async()=>{try{await fn();}catch(error){say(error.message);}};}
  const DOM=globalThis.RegistrationDOM;
  if(!DOM){say('Обновите расширение и страницу: модуль чтения полей не загружен.');return;}
  const labelFor=DOM.label,describe=DOM.describe;
  function isSensitive(el,label){return el.type==='password'||/password|passcode|one.?time|verification code|security code|cvv|cvc|\bpin\b|\botp\b|card number|парол|код подтверждения/i.test(label+' '+el.name+' '+el.id+' '+el.autocomplete);}
  const eligible=el=>DOM.eligible(el)&&!isSensitive(el,labelFor(el));
  function collect(){fieldMap=new Map();const list=[];for(const {el,field} of DOM.entries()){if(isSensitive(el,field.label))continue;fieldMap.set(field.id,{el,field});list.push(field);}return list;}
  async function scan(force=false){
    if(!visible||!active)return;
    if(location.href!==pageKey){autoToggle.checked=false;detailTarget=null;fieldDetail.replaceChildren();lastProposals=[];pageKey=location.href;lastSignature='';version++;cards.replaceChildren();manual.replaceChildren();}
    const fields=collect(),pageInfo=DOM.pageContext();coverage.textContent=pageInfo.unreadEmbeddedFrames||pageInfo.openShadowRoots?`Непрочитанные блоки: iframe — ${pageInfo.unreadEmbeddedFrames}, открытые Shadow DOM — ${pageInfo.openShadowRoots}. Подсказки относятся только к доступным вопросам. Закрытые компоненты могут быть недоступны.`:'';const signature=companyId+':'+roleSelect.value+':'+pageKey+':'+JSON.stringify(fields);
    if(!force&&signature===lastSignature)return;lastSignature=signature;
    const current=++version;cards.replaceChildren();manual.replaceChildren();
    if(!companyId){say('Выберите компанию.');return;}
    if(!fields.length){say('Доступных подписанных полей не найдено. Поля внутри iframe, закрытого Shadow DOM и нативных приложений эта версия не читает.');return;}
    say(`Сверяем ${fields.length} полей…`);
    try{const [result,verifiedFacts]=await Promise.all([api('/propose',{companyId,personRole:roleSelect.value,host:location.hostname,fields}),api(`/companies/${companyId}/facts`)]);if(current!==version||!visible||!active)return;facts=verifiedFacts;lastReview=result.review;fillButton.disabled=!lastReview.approved;autoToggle.disabled=!lastReview.approved;if(!lastReview.approved)autoToggle.checked=false;lastProposals=result.fields;render(result.fields,fields);queueAgent();say(`Компания: ${result.company.name}. Доступных полей: ${fields.length}. Изменения страницы отслеживаются, скриншоты не передаются.`);if(autoToggle.checked)await fillEmpty();}catch(error){if(current===version)say(error.message);}
  }
  function render(proposals,fields){
    for(const proposal of proposals){const card=element('article',undefined,'card');card.dataset.fieldId=proposal.id;card.append(element('span',proposal.status==='suggested'?(proposal.automatic?'Найдено автоматически':'Подтверждённый источник'):'Нужна ваша проверка','badge'),element('h3',proposal.label),element('p',proposal.guidance||''),element('p',proposal.reason));if(adviceFor(proposal)||agentEnabled&&aiAutoToggle.checked)card.append(element('p',adviceFor(proposal)||'ИИ готовит пояснение этого поля…','note ai-note'));if(proposal.mappingStatus==='suggested'){const approve=element('button','Подтвердить назначение поля','quiet');approve.addEventListener('click',safe(async()=>{await api('/form-mapping-confirm',{companyId,host:location.hostname,mappingId:proposal.mappingId,field:fieldMap.get(proposal.id).field});await scan(true);}));card.append(approve);}
      if(proposal.status==='suggested'){
        card.append(element('p',proposal.value,'value'),element('p',`${proposal.source} · страница / блок ${proposal.page}`,'source'));
        const detail=element('details');detail.append(element('summary','Цитата из источника'),element('p',proposal.quote));card.append(detail);
        const insert=element('button','Вставить в это поле');
        insert.addEventListener('click',safe(async()=>{insert.disabled=true;try{await applyProposal(proposal,true);}finally{insert.disabled=false;}}));card.append(insert);
      }
      for(const correction of proposal.corrections||[])card.append(element('p',correction,'rules'));
      const explain=element('button','Объяснить по-русски','quiet');explain.addEventListener('click',safe(async()=>{explain.disabled=true;try{say('Получаем пояснение. Провайдеру передаётся только текст вопроса.');const key=adviceKey(fieldMap.get(proposal.id)?.field);const result=await api('/explain',{label:proposal.label});if(key!==adviceKey(fieldMap.get(proposal.id)?.field))return;agentAdvice.set(key,result.explanation);updateAdvice();say('Пояснение появилось в панели и у поля.');}finally{explain.disabled=false;}}));card.append(explain);const aiNote=card.querySelector('.ai-note');if(aiNote)card.querySelector('h3').after(aiNote);cards.append(card);
    }
    const ready=proposals.filter(p=>p.status==='suggested').length;assessment.textContent=`Сопоставлено с реквизитами карточки: ${proposals.filter(p=>p.key).length} из ${proposals.length}. Готовы данные для ${ready} полей. ${lastReview?.approved?'Недостающие сведения указаны в карточках ниже.':'Подтвердите итоговые данные в окне документов, чтобы разрешить вставку.'} Save / Next помощник не нажимает.`;renderOverlay(proposals);
    renderManualPicker(fields);refreshDetail();
    const title=element('h3','Указать ошибку помощнику'),form=element('form'),select=element('select'),text=element('textarea'),button=element('button','Сохранить исправление');
    form.className='correction-form';
    for(const field of fields){const o=element('option',field.label);o.value=field.id;select.append(o);}text.rows=3;text.required=true;text.maxLength=2000;text.placeholder='Например: здесь запрашивается налоговое резидентство, а не страна регистрации. Не вводите пароли и коды.';
    form.append(element('p','Исправление запомнится для этой компании, домена и названия поля. На этом поле обычная подсказка остановится до удаления правила.','source'),select,text,button);
    form.addEventListener('submit',event=>{event.preventDefault();void safe(async()=>{const field=fields.find(f=>f.id===select.value);await api(`/companies/${companyId}/corrections`,{host:location.hostname,field:field.label,message:text.value});await scan(true);say('Исправление сохранено. Для изменения самого значения откройте карточку компании.');})();});manual.append(title,form);
  }
  async function applyProposal(proposal,overwrite=false){
    const selectedCompany=companyId,currentPage=pageKey,capturedVersion=version,personRole=roleSelect.value,entry=fieldMap.get(proposal.id);
    if(!entry||!entry.el.isConnected||!eligible(entry.el)||!sameField(describe(entry.el,proposal.id),entry.field))throw Error('Поле изменилось. Обновите подсказки.');
    if(!blank(entry.el)&&!overwrite)return false;
    const fresh=await api('/propose',{companyId:selectedCompany,personRole,host:location.hostname,fields:[describe(entry.el,proposal.id)]}),verified=fresh.fields[0];
    if(companyId!==selectedCompany||location.href!==currentPage||version!==capturedVersion||roleSelect.value!==personRole||!entry.el.isConnected||!eligible(entry.el)||!sameField(describe(entry.el,proposal.id),entry.field))throw Error('Компания, роль или страница изменилась. Вставка остановлена.');
    if(verified.status!=='suggested'||verified.factId!==proposal.factId||verified.value!==proposal.value||verified.optionValue!==proposal.optionValue)throw Error('Источник или правило изменилось. Обновите панель.');
    const el=entry.el;
    if(['checkbox','radio','password','file','choice-group','custom-select'].includes(el.type))return false;
    if(!blank(el)){if(!overwrite)return false;if(!confirm(`Заменить значение поля «${proposal.label}» на «${proposal.value}» для компании «${companySelect.selectedOptions[0]?.textContent}»?`))return false;}
    writeValue(el,proposal.optionValue??proposal.value);return true;
  }
  async function fillEmpty(){
    if(filling)return;filling=true;fillButton.disabled=true;let count=0;
    try{for(const proposal of lastProposals){if(proposal.status!=='suggested')continue;try{if(await applyProposal(proposal))count++;}catch(error){say(`Заполнено: ${count}. ${error.message}`);return;}}say(`Заполнено пустых полей: ${count}. Остальные требуют сведений или уточнения. Проверьте анкету перед отправкой.`);}
    finally{filling=false;fillButton.disabled=!lastReview?.approved;if(pendingScan){pendingScan=false;queueMicrotask(()=>void scan(true));}}
  }
  fillButton.addEventListener('click',safe(async()=>{await scan(true);await fillEmpty();}));
  autoToggle.addEventListener('change',safe(async()=>{if(autoToggle.checked){await scan(true);await fillEmpty();}}));
  roleSelect.addEventListener('change',()=>{autoToggle.checked=false;lastSignature='';void scan(true);});
  function blank(el){return !el.value?.trim()||(el.tagName==='SELECT'&&/^(?:please select|please choose|select(?: a| an)?|choose|code$|--)/i.test(el.selectedOptions[0]?.textContent.trim()||''));}
  function sameField(a,b){const clean=value=>{const result={...value};delete result.taxCountry;if(result.options)result.options=result.options.map(({selected,...option})=>option);return result;};return JSON.stringify(clean(a))===JSON.stringify(clean(b));}
  function adviceKey(field){if(!field)return '';const copy={...field};delete copy.id;return companyId+':'+roleSelect.value+':'+pageKey+':'+JSON.stringify(copy);}
  function adviceFor(proposal){return agentAdvice.get(adviceKey(fieldMap.get(proposal.id)?.field))||proposal.agentComment||'';}
  function updateAdvice(){
    for(const card of cards.querySelectorAll('.card')){const proposal=lastProposals.find(p=>p.id===card.dataset.fieldId),value=proposal&&adviceFor(proposal);if(!value)continue;let note=card.querySelector('.ai-note');if(!note){note=element('p','','note ai-note');card.querySelector('h3').after(note);}note.textContent=value;}
    if(tip){const proposal=lastProposals.find(p=>p.id===tip.dataset.fieldId),value=proposal&&adviceFor(proposal);if(value){let note=tip.querySelector('.ai-note');if(!note){note=element('p','','ai-note');tip.querySelector('strong').after(note);}note.textContent=shortAdvice(value);}}if(tip)placeTip();refreshDetail();
  }
  function agentSignature(fields){return fields.map(field=>adviceKey(field)).join('|')+':'+(lastReview?.signature||'')+':'+lastReview?.approved+':'+JSON.stringify(DOM.pageContext());}
  function queueAgent(){if(!aiAutoToggle.checked||!agentEnabled||!companyId||!visible||agentBusy||filling)return;clearTimeout(agentTimer);agentTimer=setTimeout(()=>void safe(()=>runAgent(false))(),350);}
  async function runAgent(force=false){
    if(agentBusy)return;
    if(!companyId)throw Error('Выберите компанию.');
    if(!agentEnabled)agentEnabled=(await api('/me')).aiEnabled;
    if(!agentEnabled){aiState.textContent='Для автоматических подсказок подключите OpenAI в настройках.';return;}
    const fields=collect(),signature=agentSignature(fields),selectedCompany=companyId,selectedPage=pageKey,selectedRole=roleSelect.value;
    if(!fields.length||(!force&&signature===lastAIRequest))return;
    lastAIRequest=signature;agentBusy=true;agentButton.disabled=true;dockStatus.textContent='ИИ разбирает анкету…';aiState.textContent=`ИИ читает ${fields.length} полей. Пояснения появятся автоматически…`;
    try{
      const result=await api('/analyze-form',{companyId,host:location.hostname,fields,page:DOM.pageContext(),consent:true});
      if(companyId!==selectedCompany||pageKey!==selectedPage||roleSelect.value!==selectedRole||agentSignature(collect())!==signature)return;
      for(const field of fields){const item=result.advice.find(item=>item.id===field.id);agentAdvice.set(adviceKey(field),item?.reason||'ИИ не вернул пояснение этого поля. Нажмите «Объяснить по-русски» или повторите разбор анкеты.');}
      updateAdvice();pageAdvice.textContent=result.pageExplanation||'';aiState.textContent=`ИИ разобрал ${result.advice.length} из ${fields.length} полей. Нажмите значок у поля или переведите в него курсор, чтобы прочитать пояснение.`;
      if(filling)pendingScan=true;else await scan(true);
    }catch(error){aiState.textContent='ИИ-подсказки: '+error.message;}
    finally{agentBusy=false;agentButton.disabled=false;dockStatus.textContent=`Вопросов: ${lastProposals.length}. Нажмите поле для подсказки.`;if(aiAutoToggle.checked&&agentSignature(collect())!==lastAIRequest)queueAgent();}
  }
  aiAutoToggle.addEventListener('change',()=>{if(aiAutoToggle.checked){lastAIRequest='';queueAgent();}else{clearTimeout(agentTimer);aiState.textContent='Автоматические ИИ-подсказки выключены.';}});
  agentButton.addEventListener('click',safe(()=>runAgent(true)));
  const overlayHost=document.createElement('div');overlayHost.setAttribute('data-registration-assistant-overlay','');overlayHost.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:2147483646;';
  const overlayRoot=overlayHost.attachShadow({mode:'closed'}),overlayStyle=document.createElement('style');overlayStyle.textContent='*{box-sizing:border-box}.pin{position:fixed;pointer-events:auto;border:0;border-radius:12px;padding:2px 7px;font:12px Segoe UI,Arial;color:white;background:#22674c;cursor:pointer}.warn{background:#946300}.tip{position:fixed;pointer-events:auto;width:300px;max-width:calc(100vw - 24px);max-height:240px;overflow:auto;background:white;color:#17302e;border:1px solid #aac3b3;border-radius:12px;padding:14px;box-shadow:0 8px 30px #0003;font:13px/1.5 Segoe UI,Arial;overflow-wrap:anywhere}.tip p{margin:8px 0}.tip .ai-note{background:#edf4ec;border-radius:8px;padding:10px}.tip button{border:0;border-radius:6px;padding:7px 10px;margin:4px;background:#e7eee7;color:#21523e;cursor:pointer}.tip strong{display:block;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.tip .compact-value{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tip .tip-close{float:right;padding:2px 7px;margin:0 0 4px 6px}.tip .tip-status{font-size:11px;color:#755221}';overlayRoot.append(overlayStyle);document.documentElement.append(overlayHost);
  const violetStyle=document.createElement('style');violetStyle.textContent=':host([data-theme=violet]) .panel,:host([data-theme=violet]) .dock{background:#15111d;color:#eee9f6;border-color:#58356d}:host([data-theme=violet]) header,:host([data-theme=violet]) .card{background:#1b1424;border-color:#42304f}:host([data-theme=violet]) input,:host([data-theme=violet]) select,:host([data-theme=violet]) textarea{background:#100d16;color:#f5edff;border-color:#604475}:host([data-theme=violet]) button{background:#813bc0;color:white}:host([data-theme=violet]) .quiet,:host([data-theme=violet]) .note,:host([data-theme=violet]) .detail-value{background:#30203f;color:#ead1ff}:host([data-theme=violet]) .badge,:host([data-theme=violet]) .source,:host([data-theme=violet]) .detail-label,:host([data-theme=violet]) .dock-status{color:#c7b0dc}:host([data-theme=violet]) .status{color:#edcb8e}:host([data-theme=violet]) .bottom{background:#100d16;border-color:#42304f}:host([data-theme=violet]) .detail-source{border-color:#8656a9}';shadow.append(violetStyle);
  const violetOverlay=document.createElement('style');violetOverlay.textContent=':host([data-theme=violet]) .tip{background:#17101f;color:#eee5fb;border-color:#684282}:host([data-theme=violet]) .tip .ai-note{background:#30203f}:host([data-theme=violet]) .tip button,:host([data-theme=violet]) .pin{background:#813bc0;color:white}:host([data-theme=violet]) .tip .tip-status{color:#edcb8e}';overlayRoot.append(violetOverlay);
  function applyAppearance(theme){appearanceSelect.value=theme==='violet'?'violet':'classic';host.dataset.theme=appearanceSelect.value;overlayHost.dataset.theme=appearanceSelect.value;}appearanceSelect.addEventListener('change',safe(async()=>{applyAppearance(appearanceSelect.value);await chrome.runtime.sendMessage({type:'appearance',theme:appearanceSelect.value});}));void chrome.runtime.sendMessage({type:'appearance'}).then(result=>applyAppearance(result?.theme||'classic')).catch(()=>{});
  let badges=[],tip=null,marks=[],activeOverlay=null;
  function clearOverlay(){for(const badge of badges)badge.node.remove();badges=[];tip?.remove();tip=null;for(const mark of marks){if(mark.el.style.outline===mark.ours){mark.el.style.outline=mark.outline;mark.el.style.outlineOffset=mark.offset;}}marks=[];}
  function clippedRect(el){
    const rect=el.getBoundingClientRect();let left=Math.max(0,rect.left),top=Math.max(0,rect.top),right=Math.min(innerWidth,rect.right),bottom=Math.min(innerHeight,rect.bottom);
    for(let parent=el.parentElement;parent&&parent!==document.documentElement;parent=parent.parentElement){const style=getComputedStyle(parent),bounds=parent.getBoundingClientRect();if(/auto|scroll|hidden|clip/.test(style.overflowY)){top=Math.max(top,bounds.top);bottom=Math.min(bottom,bounds.bottom);}if(/auto|scroll|hidden|clip/.test(style.overflowX)){left=Math.max(left,bounds.left);right=Math.min(right,bounds.right);}}
    return {left,top,right,bottom,visible:right>left&&bottom>top};
  }
  function positionOverlays(){
    for(const badge of badges){const rect=clippedRect(badge.el),show=visible&&overlayToggle.checked&&rect.visible&&badge.el===activeOverlay;badge.node.hidden=!show;if(!show)continue;const panelLeft=host.getBoundingClientRect().left,top=Math.max(2,Math.min(innerHeight-24,rect.top));const positions=[rect.right+6,rect.left-28].filter(left=>left>=2&&left+24<Math.min(innerWidth-2,panelLeft-2));const left=positions.find(left=>[[left+1,top+1],[left+23,top+1],[left+1,top+19],[left+23,top+19]].every(([x,y])=>{const node=document.elementFromPoint(x,y);return !node||node===overlayHost||node===document.body||node===document.documentElement||node.contains(badge.el);}));if(left===undefined){badge.node.hidden=true;continue;}badge.node.style.left=left+'px';badge.node.style.top=top+'px';}
    if(tip?.__target&&!clippedRect(tip.__target).visible){tip.remove();tip=null;}else if(tip)placeTip();
  }
  function shortAdvice(value){const text=String(value||'').replace(/\s+/g,' ').trim();if(text.length<=140)return text;const first=text.match(/^.{30,140}?[.!?](?:\s|$)/)?.[0];return first?.trim()||text.slice(0,137).replace(/\s+\S*$/,'')+'…';}
  function statusFor(proposal){return proposal.status==='suggested'?'Есть подтверждённый источник':proposal.status==='needs_confirmation'?'Нужно общее подтверждение данных':'Нужны сведения или проверка';}
  function setExpanded(value){expanded=value;panel.hidden=!value;dock.hidden=value;host.style.setProperty('top',value?'12px':'auto','important');host.style.setProperty('width',value?'400px':'320px','important');if(!value){main.classList.remove('detail-mode');detailTarget=null;}positionOverlays();}
  function showAllFields(){detailTarget=null;main.classList.remove('detail-mode');title.textContent='Помощник регистраций';allFields.hidden=true;setExpanded(true);}
  function openDetail(proposal,el){detailTarget=el;setExpanded(true);main.classList.add('detail-mode');title.textContent='Полное описание';allFields.hidden=false;tip?.remove();tip=null;renderDetail(proposal,el);main.scrollTop=0;}
  function refreshDetail(){if(!expanded||!detailTarget||!main.classList.contains('detail-mode'))return;const proposal=lastProposals.find(p=>fieldMap.get(p.id)?.el===detailTarget);if(proposal)renderDetail(proposal,detailTarget);else{fieldDetail.replaceChildren(element('p','Поле изменилось или исчезло. Выберите другой вопрос на странице.'));}}
  function renderDetail(proposal,el){
    fieldDetail.replaceChildren(element('p',companySelect.selectedOptions[0]?.textContent||'','detail-label'),element('h3',fieldTitles[proposal.key]||proposal.label),element('p',proposal.label,'detail-label'),element('p',statusFor(proposal),'badge'));
    fieldDetail.append(element('h4','Назначение поля'),element('p',proposal.guidance||''),element('h4','Что спрашивают и как заполнить'),element('p',adviceFor(proposal)||(agentBusy?'ИИ готовит полное пояснение…':proposal.guidance),'note full-explanation'));
    const field=fieldMap.get(proposal.id)?.field;if(field?.options?.length){const choices=element('details'),list=element('div');choices.append(element('summary','Варианты ответа'));for(const option of field.options)list.append(element('p',(option.selected===true?'✓ ':'')+option.text+(option.disabled?' — недоступно':'')));choices.append(list);fieldDetail.append(choices);}
    if(proposal.status==='suggested'){
      fieldDetail.append(element('h4','Данные для этого поля'),element('p',proposal.value,'detail-value'),element('h4','Источник'),element('p',`${proposal.source} · страница / блок ${proposal.page}`,'source'),element('p',proposal.quote,'detail-source'));
      if(proposal.documentSources?.length){const proof=element('details');proof.append(element('summary','Подтверждающие документы'));for(const source of proposal.documentSources)proof.append(element('p',`${source.filename} · стр. ${source.page}`,'source'),element('p',source.quote,'detail-source'));fieldDetail.append(proof);}
      const insert=element('button','Вставить после проверки');insert.addEventListener('click',safe(async()=>{await applyProposal(proposal,true);await scan(true);}));fieldDetail.append(insert);
    }
    fieldDetail.append(element('h4','Что проверить'),element('p',proposal.reason));for(const correction of proposal.corrections||[])fieldDetail.append(element('p',correction,'rules'));
    if(proposal.mappingStatus==='suggested'){const approve=element('button','Подтвердить назначение поля','quiet');approve.addEventListener('click',safe(async()=>{await api('/form-mapping-confirm',{companyId,host:location.hostname,mappingId:proposal.mappingId,field:fieldMap.get(proposal.id).field});await scan(true);}));fieldDetail.append(approve);}
    const actions=element('div',undefined,'detail-nav'),back=element('button','Предыдущий','quiet'),next=element('button','Следующий','quiet'),index=lastProposals.findIndex(p=>p.id===proposal.id);back.disabled=index<=0;next.disabled=index>=lastProposals.length-1;
    for(const [button,offset] of [[back,-1],[next,1]])button.addEventListener('click',()=>{const p=lastProposals[index+offset],entry=p&&fieldMap.get(p.id);if(entry){entry.el.scrollIntoView({block:'center',behavior:'smooth'});openDetail(p,entry.el);}});actions.append(back,next);fieldDetail.append(actions);
  }
  function placeTip(){if(!tip?.__target)return;const rect=tip.__target.getBoundingClientRect(),width=300,height=tip.offsetHeight||220,limit=expanded?host.getBoundingClientRect().left-12:innerWidth-12;let left,top;if(limit-rect.right>=width+12){left=rect.right+12;top=rect.top;}else if(rect.left>=width+20){left=rect.left-width-12;top=rect.top;}else{left=Math.min(innerWidth-width-8,Math.max(8,rect.left));top=rect.bottom+8;if(top+height>innerHeight-8&&rect.top>height+8)top=rect.top-height-8;}tip.style.left=Math.max(8,left)+'px';tip.style.top=Math.max(8,Math.min(innerHeight-height-8,top))+'px';}
  function showTip(proposal,el){
    if(expanded&&main.classList.contains('detail-mode')){detailTarget=el;renderDetail(proposal,el);return;}
    activeOverlay=el;positionOverlays();tip?.remove();tip=element('aside',undefined,'tip');tip.dataset.fieldId=proposal.id;tip.__target=el;
    const close=element('button','×','tip-close');close.setAttribute('aria-label','Закрыть подсказку');close.addEventListener('click',()=>{tip?.remove();tip=null;});tip.append(close,element('strong',fieldTitles[proposal.key]||proposal.label),element('p',shortAdvice(adviceFor(proposal)||(agentBusy?'ИИ готовит пояснение…':proposal.guidance)),'ai-note'),element('p',statusFor(proposal),'tip-status'));
    if(proposal.status==='suggested')tip.append(element('p',proposal.value,'compact-value'));
    const more=element('button','Подробнее');more.addEventListener('click',()=>openDetail(proposal,el));tip.append(more);overlayRoot.append(tip);placeTip();
  }
  function renderOverlay(proposals){const previousTarget=tip?.__target;clearOverlay();if(!overlayToggle.checked||!visible)return;
    for(const proposal of proposals){const entry=fieldMap.get(proposal.id);if(!entry)continue;const badge=element('button','?', 'pin');badge.hidden=true;badge.title='Пояснение ИИ для этого вопроса';badge.setAttribute('aria-label','Пояснение ИИ: '+proposal.label);badge.addEventListener('click',()=>showTip(proposal,entry.el));overlayRoot.append(badge);badges.push({node:badge,el:entry.el});}positionOverlays();
    if(previousTarget){const id=[...fieldMap].find(([,entry])=>entry.el===previousTarget)?.[0],proposal=proposals.find(p=>p.id===id);if(proposal)showTip(proposal,previousTarget);}
  }
  overlayToggle.addEventListener('change',()=>renderOverlay(lastProposals));
  window.addEventListener('scroll',positionOverlays,{passive:true,capture:true});window.addEventListener('resize',positionOverlays,{passive:true});
  document.addEventListener('pointerover',event=>{if(!visible||!overlayToggle.checked||event.composedPath().includes(overlayHost)||event.composedPath().includes(host))return;const entry=[...fieldMap.values()].find(item=>item.el===event.target||['choice-group','custom-select'].includes(item.field.type)&&item.el.contains(event.target));activeOverlay=entry?.el||null;positionOverlays();});
  document.addEventListener('focusin',event=>{if(!overlayToggle.checked||!visible)return;const entry=[...fieldMap.entries()].find(([,item])=>item.el===event.target||['choice-group','custom-select'].includes(item.field.type)&&item.el.contains(event.target));if(entry){const proposal=lastProposals.find(item=>item.id===entry[0]);if(proposal)showTip(proposal,entry[1].el);}});
  document.addEventListener('click',event=>{if(!visible||!overlayToggle.checked)return;const entry=[...fieldMap.entries()].find(([,item])=>['choice-group','custom-select'].includes(item.field.type)&&item.el.contains(event.target));if(entry){const proposal=lastProposals.find(p=>p.id===entry[0]);if(proposal)showTip(proposal,entry[1].el);clearTimeout(timer);timer=setTimeout(()=>void scan(),350);}});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){tip?.remove();tip=null;activeOverlay=null;if(expanded&&main.classList.contains('detail-mode'))setExpanded(false);positionOverlays();}});
  function writeValue(el,value){
    const probe=el.cloneNode(true);probe.value=value;
    if(probe.value!==value||(el.maxLength>0&&value.length>el.maxLength)||!probe.checkValidity())throw Error('Значение не соответствует ограничениям поля. Проверьте формат вручную.');
    const prototype=el.tagName==='SELECT'?HTMLSelectElement.prototype:el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype,'value').set.call(el,value);
    el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
    if(el.value!==value)throw Error('Сайт изменил значение. Проверьте его вручную.');
  }
  function renderManualPicker(fields){
    const allowed=fields.filter(field=>!['checkbox','radio','select-multiple','choice-group','custom-select','file'].includes(field.type)&&!field.disabled&&!field.readOnly);
    if(!lastReview?.approved||!facts.length||!allowed.length)return;
    const detail=element('details'),summary=element('summary','Выбрать поле и данные вручную'),form=element('form'),target=element('select'),source=element('select'),preview=element('div'),ackLabel=element('label'),ack=element('input'),submit=element('button','Вставить выбранные данные');
    for(const field of allowed){const option=element('option',field.label);option.value=field.id;target.append(option);}
    for(const fact of facts){const option=element('option',fieldTitles[fact.key]||fact.key);option.value=fact.id;source.append(option);}
    ack.type='checkbox';ack.required=true;ack.style.width='auto';ackLabel.append(ack,document.createTextNode(' Я проверил(а), что значение подходит вопросу и выбранной компании.'));
    const update=()=>{ack.checked=false;const fact=facts.find(f=>f.id===source.value);preview.replaceChildren(element('p',fact.value,'value'),element('p',`${fact.filename} · страница / блок ${fact.page}`,'source'),element('p',fact.quote));};
    source.addEventListener('change',update);target.addEventListener('change',()=>{ack.checked=false;});update();
    form.append(element('label','Поле анкеты'),target,element('label','Подтверждённые сведения'),source,preview,ackLabel,submit);detail.append(summary,element('p','Для незнакомых форм можно самостоятельно сопоставить поле с подтверждёнными сведениями. Юридические подтверждения и секретные поля исключены.','source'),form);manual.append(detail);
    form.addEventListener('submit',event=>{event.preventDefault();void safe(async()=>{
      if(!ack.checked)throw Error('Сначала подтвердите проверку.');
      const currentCompany=companyId,currentPage=pageKey,currentVersion=version,entry=fieldMap.get(target.value),fact=facts.find(f=>f.id===source.value);
      if(!entry||!fact||!entry.el.isConnected||!eligible(entry.el)||JSON.stringify(describe(entry.el,entry.field.id))!==JSON.stringify(entry.field))throw Error('Поле изменилось. Обновите панель.');
      submit.disabled=true;
      try{
        const approved=await api(`/companies/${currentCompany}/review`);if(!approved.approved)throw Error('Итоговые данные изменились. Подтвердите их заново в веб-интерфейсе.');const fresh=(await api(`/companies/${currentCompany}/facts`)).find(f=>f.id===fact.id);
        if(companyId!==currentCompany||location.href!==currentPage||version!==currentVersion||!entry.el.isConnected||!eligible(entry.el)||JSON.stringify(describe(entry.el,entry.field.id))!==JSON.stringify(entry.field))throw Error('Страница или компания изменилась. Ничего не вставлено.');
        if(!fresh||fresh.value!==fact.value||fresh.quote!==fact.quote)throw Error('Источник изменился. Обновите панель.');
        let value=fact.value;
        if(entry.el.tagName==='SELECT'){
          const matches=[...entry.el.options].filter(o=>!o.disabled&&o.textContent.trim()===value);
          if(matches.length!==1)throw Error('Нет точного варианта списка. Выберите его на странице вручную.');
          value=matches[0].value;
        }
        if(entry.el.value&&!confirm(`Заменить существующее значение в поле «${entry.field.label}» на «${fact.value}»?`))return;
        writeValue(entry.el,value);ack.checked=false;entry.el.scrollIntoView({block:'center',behavior:'smooth'});say('Выбранные вами данные вставлены. Проверьте поле перед отправкой анкеты.');
      }finally{submit.disabled=false;}
    })();});
  }
  companySelect.addEventListener('change',()=>{companyId=companySelect.value;dockSelect.value=companyId;detailTarget=null;fieldDetail.replaceChildren();clearOverlay();autoToggle.checked=false;lastProposals=[];lastSignature='';void scan(true);});refresh.addEventListener('click',safe(async()=>{await loadCompanies();await scan(true);}));
  async function loadCompanies(){const [companies,me]=await Promise.all([api('/companies'),api('/me')]),previous=companyId;fieldTitles=me.fields;agentEnabled=me.aiEnabled;agentButton.textContent=agentEnabled?'Агент: разобрать анкету':'Агент: подключите OpenAI';companySelect.replaceChildren();const empty=element('option','Выберите компанию');empty.value='';companySelect.append(empty);for(const company of companies){const o=element('option',company.name);o.value=company.id;companySelect.append(o);}companySelect.value=companies.some(c=>c.id===previous)?previous:'';companyId=companySelect.value;dockSelect.replaceChildren(...[...companySelect.options].map(option=>option.cloneNode(true)));dockSelect.value=companyId;}
  const observer=new MutationObserver(changes=>{if(filling){pendingScan=true;return;}if(!visible||!changes.some(c=>c.target!==host&&![...(c.addedNodes||[]),...(c.removedNodes||[])].includes(host)))return;clearTimeout(timer);timer=setTimeout(()=>void scan().catch(error=>say(error.message)),600);});observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['aria-describedby','aria-label','aria-labelledby','disabled','readonly','hidden','type','placeholder','required','maxlength','pattern','role','aria-checked','aria-pressed','aria-selected','aria-expanded','aria-disabled','aria-multiselectable','data-state','class','aria-invalid','aria-required','accept','aria-controls','aria-owns']});
  document.addEventListener('change',event=>{if(visible&&event.target.matches('select,input[type=radio],input[type=checkbox]')){if(filling){pendingScan=true;return;}clearTimeout(timer);timer=setTimeout(()=>void scan(true),350);}});
  const interval=setInterval(()=>{if(!host.isConnected){active=false;clearOverlay();overlayHost.remove();observer.disconnect();clearInterval(interval);clearTimeout(timer);clearTimeout(agentTimer);delete globalThis.__registrationAssistant;return;}if(visible&&location.href!==pageKey)void scan(true);if(visible&&companyId&&!polling&&!filling&&++ticks%5===0){polling=true;const selected=companyId;void api(`/companies/${selected}/review`).then(state=>{if(companyId===selected&&(state.signature!==lastReview?.signature||state.approved!==lastReview?.approved))return scan(true);}).catch(error=>say(error.message)).finally(()=>{polling=false;});}},1000);
  void safe(async()=>{await loadCompanies();await scan(true);})();
})();
