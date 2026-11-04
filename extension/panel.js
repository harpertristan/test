(()=>{
  if(globalThis.__registrationAssistant){globalThis.__registrationAssistant.toggle();return;}
  const host=document.createElement('div');
  host.setAttribute('data-registration-assistant','');
  host.style.cssText='all:initial!important;position:fixed!important;right:12px!important;top:12px!important;bottom:12px!important;width:400px!important;max-width:calc(100vw - 24px)!important;z-index:2147483647!important;display:block!important;';
  const shadow=host.attachShadow({mode:'closed'});
  const style=document.createElement('style');style.textContent=`:host{color-scheme:light}*{box-sizing:border-box}.panel{height:100%;display:flex;flex-direction:column;background:#f4f6f2;border:1px solid #b9cebe;border-radius:14px;box-shadow:0 8px 40px #0003;color:#17302e;font:13px/1.5 'Segoe UI',Arial,sans-serif;overflow:hidden}header{background:white;padding:16px;border-bottom:1px solid #dce4dc;display:flex;align-items:center;justify-content:space-between}h2{font-size:17px;margin:0}h3{font-size:14px;margin:8px 0}main{overflow:auto;padding:16px;flex:1}p{margin:8px 0}button{border:0;border-radius:7px;background:#22674c;color:white;padding:9px 12px;cursor:pointer;font:inherit;margin:4px 5px 4px 0}button:disabled{opacity:.5;cursor:wait}.quiet{color:#21523e;background:#e7eee7}input,select,textarea{width:100%;font:inherit;background:white;color:#17302e;border:1px solid #b8c9be;border-radius:7px;padding:9px;margin:7px 0}label{display:block;font-weight:600;margin:10px 0 4px}.card{background:white;border:1px solid #dce4dc;padding:13px;margin:12px 0;border-radius:10px;overflow-wrap:anywhere}.value{font-size:15px;font-weight:600;white-space:pre-wrap}.source{font-size:11px;color:#64756b}.note{background:#e7eee7;padding:10px;border-radius:8px}.status{font-size:12px;white-space:pre-wrap;color:#755221}.badge{font-size:11px;color:#48725b}.rules{color:#8a3425}details{margin-top:9px}summary{cursor:pointer}.bottom{padding:10px 16px;border-top:1px solid #dce4dc;font-size:11px;background:white}.selected{background:#f0f5ed;padding:8px;border-radius:7px}a{color:#22674c}`;
  shadow.append(style);
  function element(tag,text,className){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;}
  const panel=element('section',undefined,'panel'),header=element('header'),title=element('h2','Помощник регистраций'),close=element('button','×','quiet'),main=element('main'),status=element('p','','status'),companySelect=element('select'),cards=element('div'),manual=element('div');
  const fillButton=element('button','Заполнить найденные пустые поля'),autoLabel=element('label'),autoToggle=element('input'),roleSelect=element('select');
  autoToggle.type='checkbox';autoToggle.style.width='auto';autoLabel.append(autoToggle,document.createTextNode(' Автоматически заполнять новые пустые поля'));
  for(const [value,text] of [['contact','Контактное лицо из блокнота'],['director','Директор'],['beneficiary','Бенефициар']]){const option=element('option',text);option.value=value;roleSelect.append(option);}
  const roleLabel=element('label','Чьи сведения использовать');roleLabel.append(roleSelect);
  const settings=element('button','Подключение','quiet'),refresh=element('button','Обновить поля','quiet'),companyLabel=element('label','Рабочая компания'),intro=element('p','Сведения берутся из карточки компании. Заполните найденное одной кнопкой или включите автозаполнение пустых полей.','note');
  companyLabel.append(companySelect);header.append(title,close);main.append(intro,settings,refresh,companyLabel,roleLabel,fillButton,autoLabel,status,cards,manual);panel.append(header,main,element('div','Пароли, подтверждения, подписи и отправка анкеты — у вас.','bottom'));shadow.append(panel);document.documentElement.append(host);
  let visible=true,active=true,companyId='',facts=[],fieldTitles={},fieldMap=new Map(),version=0,timer,lastSignature='',pageKey=location.href,lastProposals=[],filling=false,lastReview=null,polling=false,ticks=0;
  const toggle=()=>{visible=!visible;host.style.setProperty('display',visible?'block':'none','important');if(visible)void scan(true);};
  globalThis.__registrationAssistant={toggle};close.addEventListener('click',toggle);
  settings.addEventListener('click',()=>chrome.runtime.sendMessage({type:'openSettings'}));
  const say=text=>{status.textContent=text;};
  async function api(path,body){const result=await chrome.runtime.sendMessage({type:'api',path,method:body?'POST':'GET',body});if(!result.ok)throw Error(result.error);return result.data;}
  function safe(fn){return async()=>{try{await fn();}catch(error){say(error.message);}};}
  function labelFor(el){let text=[...(el.labels||[])].map(label=>{const copy=label.cloneNode(true);copy.querySelectorAll('input,select,textarea,button').forEach(control=>control.remove());return copy.textContent;}).join(' ').trim();if(!text)text=el.getAttribute('aria-label')||'';if(!text){text=(el.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>document.getElementById(id)?.textContent||'').join(' ').trim();}if(!text)text=el.getAttribute('placeholder')||el.name||'';return text.replace(/\s+/g,' ').replace(/\s*\*\s*$/,'').trim().slice(0,300);}
  function isSensitive(el,label){return el.type==='password'||/password|passcode|one.?time|verification code|security code|cvv|cvc|\bpin\b|\botp\b|card number|парол|код подтверждения/i.test(label+' '+el.name+' '+el.id+' '+el.autocomplete);}
  function describe(el,id){const label=labelFor(el);return {id,label,name:(el.name||'').slice(0,100),type:el.tagName==='SELECT'?el.type:el.tagName==='TEXTAREA'?'textarea':el.type,autocomplete:(el.autocomplete||'').split(' ').at(-1),placeholder:el.getAttribute('placeholder')||'',splitPhone:/phone|telephone|mobile/i.test(label)&&[...(el.closest('form')||document).querySelectorAll('input,select')].some(control=>/^(?:dial(?:ling|ing)? code|calling code|country calling code|phone country code|country code)$/i.test(labelFor(control))),options:el.tagName==='SELECT'?[...el.options].slice(0,500).map(o=>({text:o.textContent.trim().slice(0,200),value:o.value.slice(0,200),disabled:o.disabled})):undefined};}
  function eligible(el){return !el.disabled&&!el.readOnly&&!['hidden','submit','button','reset','file','image'].includes(el.type)&&!isSensitive(el,labelFor(el))&&el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden';}
  function collect(){fieldMap=new Map();const list=[];for(const el of document.querySelectorAll('input,select,textarea')){if(list.length>=100)break;if(!eligible(el))continue;const id=String(list.length),field=describe(el,id);if(!field.label)continue;fieldMap.set(id,{el,field});list.push(field);}return list;}
  async function scan(force=false){
    if(!visible||!active)return;
    if(location.href!==pageKey){autoToggle.checked=false;lastProposals=[];pageKey=location.href;lastSignature='';version++;cards.replaceChildren();manual.replaceChildren();}
    const fields=collect(),signature=companyId+':'+roleSelect.value+':'+pageKey+':'+JSON.stringify(fields);
    if(!force&&signature===lastSignature)return;lastSignature=signature;
    const current=++version;cards.replaceChildren();manual.replaceChildren();
    if(!companyId){say('Выберите компанию.');return;}
    if(!fields.length){say('Доступных подписанных полей не найдено. Поля внутри iframe, закрытого Shadow DOM и нативных приложений эта версия не читает.');return;}
    say(`Сверяем ${fields.length} полей…`);
    try{const [result,verifiedFacts]=await Promise.all([api('/propose',{companyId,personRole:roleSelect.value,host:location.hostname,fields}),api(`/companies/${companyId}/facts`)]);if(current!==version||!visible||!active)return;facts=verifiedFacts;lastReview=result.review;fillButton.disabled=!lastReview.approved;autoToggle.disabled=!lastReview.approved;if(!lastReview.approved)autoToggle.checked=false;lastProposals=result.fields;render(result.fields,fields);say(`Компания: ${result.company.name}. Доступных полей: ${fields.length}. Изменения страницы отслеживаются, скриншоты не передаются.`);if(autoToggle.checked)await fillEmpty();}catch(error){if(current===version)say(error.message);}
  }
  function render(proposals,fields){
    for(const proposal of proposals){const card=element('article',undefined,'card');card.append(element('span',proposal.status==='suggested'?(proposal.automatic?'Найдено автоматически':'Подтверждённый источник'):'Нужна ваша проверка','badge'),element('h3',proposal.label),element('p',proposal.reason));
      if(proposal.status==='suggested'){
        card.append(element('p',proposal.value,'value'),element('p',`${proposal.source} · страница / блок ${proposal.page}`,'source'));
        const detail=element('details');detail.append(element('summary','Цитата из источника'),element('p',proposal.quote));card.append(detail);
        const insert=element('button','Вставить в это поле');
        insert.addEventListener('click',safe(async()=>{insert.disabled=true;try{await applyProposal(proposal,true);}finally{insert.disabled=false;}}));card.append(insert);
      }
      for(const correction of proposal.corrections||[])card.append(element('p',correction,'rules'));
      const explain=element('button','Объяснить по-русски','quiet');explain.addEventListener('click',safe(async()=>{explain.disabled=true;try{say('Получаем пояснение. Провайдеру передаётся только текст вопроса.');const result=await api('/explain',{label:proposal.label});card.append(element('p',result.explanation,'note'),element('p',result.notice,'source'));say('Пояснение получено.');}finally{explain.disabled=false;}}));card.append(explain);cards.append(card);
    }
    renderManualPicker(fields);
    const title=element('h3','Указать ошибку помощнику'),form=element('form'),select=element('select'),text=element('textarea'),button=element('button','Сохранить исправление');
    form.className='correction-form';
    for(const field of fields){const o=element('option',field.label);o.value=field.id;select.append(o);}text.rows=3;text.required=true;text.maxLength=2000;text.placeholder='Например: здесь запрашивается налоговое резидентство, а не страна регистрации. Не вводите пароли и коды.';
    form.append(element('p','Исправление запомнится для этой компании, домена и названия поля. На этом поле обычная подсказка остановится до удаления правила.','source'),select,text,button);
    form.addEventListener('submit',event=>{event.preventDefault();void safe(async()=>{const field=fields.find(f=>f.id===select.value);await api(`/companies/${companyId}/corrections`,{host:location.hostname,field:field.label,message:text.value});await scan(true);say('Исправление сохранено. Для изменения самого значения откройте карточку компании.');})();});manual.append(title,form);
  }
  async function applyProposal(proposal,overwrite=false){
    const selectedCompany=companyId,currentPage=pageKey,capturedVersion=version,personRole=roleSelect.value,entry=fieldMap.get(proposal.id);
    if(!entry||!entry.el.isConnected||!eligible(entry.el)||JSON.stringify(describe(entry.el,proposal.id))!==JSON.stringify(entry.field))throw Error('Поле изменилось. Обновите подсказки.');
    if(entry.el.value&&!overwrite)return false;
    const fresh=await api('/propose',{companyId:selectedCompany,personRole,host:location.hostname,fields:[entry.field]}),verified=fresh.fields[0];
    if(companyId!==selectedCompany||location.href!==currentPage||version!==capturedVersion||roleSelect.value!==personRole||!entry.el.isConnected||!eligible(entry.el)||JSON.stringify(describe(entry.el,proposal.id))!==JSON.stringify(entry.field))throw Error('Компания, роль или страница изменилась. Вставка остановлена.');
    if(verified.status!=='suggested'||verified.factId!==proposal.factId||verified.value!==proposal.value||verified.optionValue!==proposal.optionValue)throw Error('Источник или правило изменилось. Обновите панель.');
    const el=entry.el;
    if(['checkbox','radio','password','file'].includes(el.type))return false;
    if(el.value){if(!overwrite)return false;if(!confirm(`Заменить значение поля «${proposal.label}» на «${proposal.value}» для компании «${companySelect.selectedOptions[0]?.textContent}»?`))return false;}
    writeValue(el,proposal.optionValue??proposal.value);return true;
  }
  async function fillEmpty(){
    if(filling)return;filling=true;fillButton.disabled=true;let count=0;
    try{for(const proposal of lastProposals){if(proposal.status!=='suggested')continue;try{if(await applyProposal(proposal))count++;}catch(error){say(`Заполнено: ${count}. ${error.message}`);return;}}say(`Заполнено пустых полей: ${count}. Остальные требуют сведений или уточнения. Проверьте анкету перед отправкой.`);}
    finally{filling=false;fillButton.disabled=!lastReview?.approved;}
  }
  fillButton.addEventListener('click',safe(async()=>{await scan(true);await fillEmpty();}));
  autoToggle.addEventListener('change',safe(async()=>{if(autoToggle.checked){await scan(true);await fillEmpty();}}));
  roleSelect.addEventListener('change',()=>{autoToggle.checked=false;lastSignature='';void scan(true);});
  function writeValue(el,value){
    const probe=el.cloneNode(true);probe.value=value;
    if(probe.value!==value||(el.maxLength>0&&value.length>el.maxLength)||!probe.checkValidity())throw Error('Значение не соответствует ограничениям поля. Проверьте формат вручную.');
    const prototype=el.tagName==='SELECT'?HTMLSelectElement.prototype:el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype,'value').set.call(el,value);
    el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
    if(el.value!==value)throw Error('Сайт изменил значение. Проверьте его вручную.');
  }
  function renderManualPicker(fields){
    const allowed=fields.filter(field=>!['checkbox','radio','select-multiple'].includes(field.type));
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
  companySelect.addEventListener('change',()=>{companyId=companySelect.value;autoToggle.checked=false;lastProposals=[];lastSignature='';void scan(true);});refresh.addEventListener('click',safe(async()=>{await loadCompanies();await scan(true);}));
  async function loadCompanies(){const [companies,me]=await Promise.all([api('/companies'),api('/me')]),previous=companyId;fieldTitles=me.fields;companySelect.replaceChildren();const empty=element('option','Выберите компанию');empty.value='';companySelect.append(empty);for(const company of companies){const o=element('option',company.name);o.value=company.id;companySelect.append(o);}companySelect.value=companies.some(c=>c.id===previous)?previous:'';companyId=companySelect.value;}
  const observer=new MutationObserver(changes=>{if(!visible||!changes.some(c=>c.target!==host&&![...(c.addedNodes||[]),...(c.removedNodes||[])].includes(host)))return;clearTimeout(timer);timer=setTimeout(()=>void scan().catch(error=>say(error.message)),600);});observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['aria-label','aria-labelledby','disabled','readonly','hidden','type','placeholder']});
  const interval=setInterval(()=>{if(!host.isConnected){active=false;observer.disconnect();clearInterval(interval);clearTimeout(timer);delete globalThis.__registrationAssistant;return;}if(visible&&location.href!==pageKey)void scan(true);if(visible&&companyId&&!polling&&!filling&&++ticks%5===0){polling=true;const selected=companyId;void api(`/companies/${selected}/review`).then(state=>{if(companyId===selected&&(state.signature!==lastReview?.signature||state.approved!==lastReview?.approved))return scan(true);}).catch(error=>say(error.message)).finally(()=>{polling=false;});}},1000);
  void safe(async()=>{await loadCompanies();await scan(true);})();
})();
