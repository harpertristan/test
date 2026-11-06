async function framesFor(tabId){return (await chrome.webNavigation.getAllFrames({tabId})||[]).filter(frame=>/^https?:/.test(frame.url));}
async function openFrame(tabId,frameId){
 const frames=await framesFor(tabId);if(!frames.some(frame=>frame.frameId===frameId))throw Error('Вложенная форма изменилась. Нажмите значок помощника заново.');
 const frameIds=frames.map(frame=>frame.frameId);
 try{await chrome.scripting.executeScript({target:{tabId,frameIds},func:()=>globalThis.__registrationAssistant?.hide?.()});}catch{}
 await chrome.scripting.executeScript({target:{tabId,frameIds:[frameId]},files:['dom.js','panel.js']});
}
chrome.action.onClicked.addListener(async tab=>{
 if(!tab.id||!/^https?:/.test(tab.url||''))return chrome.runtime.openOptionsPage();
 try{
  const frames=await framesFor(tab.id),origins=[...new Set(frames.map(frame=>new URL(frame.url)).filter(url=>url.protocol==='https:'||['localhost','127.0.0.1'].includes(url.hostname)).map(url=>url.origin+'/*'))];
  if(origins.length)await chrome.permissions.request({origins});
  const results=await chrome.scripting.executeScript({target:{tabId:tab.id,allFrames:true},files:['dom.js']});
  const scores=await chrome.scripting.executeScript({target:{tabId:tab.id,frameIds:results.map(row=>row.frameId)},func:()=>({fields:globalThis.RegistrationDOM?.entries().length||0,focused:document.hasFocus()})});
  const best=scores.filter(row=>row.result?.fields>0).sort((a,b)=>Number(b.frameId>0&&b.result.focused)-Number(a.frameId>0&&a.result.focused)||Number(b.frameId>0)-Number(a.frameId>0)||b.result.fields-a.result.fields||a.frameId-b.frameId)[0];
  await openFrame(tab.id,best?.frameId||0);
 }catch{try{await chrome.scripting.executeScript({target:{tabId:tab.id},files:['dom.js','panel.js']});}catch{await chrome.runtime.openOptionsPage();}}
});

chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  (async()=>{
    if(sender.id!==chrome.runtime.id)throw Error('Недопустимый отправитель.');
    const settingsPage=sender.url===chrome.runtime.getURL('options.html');
    if(message.type==='selection'){
      if(!sender.tab)throw Error('Откройте анкету.');
      const key='selection:'+sender.tab.id;
      if(message.companyId!==undefined){if(typeof message.companyId!=='string'||message.companyId.length>100||!['contact','director','beneficiary'].includes(message.personRole))throw Error('Некорректный выбор компании.');await chrome.storage.session.set({[key]:{companyId:message.companyId,personRole:message.personRole}});}
      return {selection:(await chrome.storage.session.get(key))[key]||{}};
    }
    if(message.type==='frame-list'){
      if(!sender.tab)throw Error('Откройте анкету.');
      return {frames:(await framesFor(sender.tab.id)).map(frame=>({id:frame.frameId,label:frame.frameId===0?'Основная страница':new URL(frame.url).hostname})),current:sender.frameId||0};
    }
    if(message.type==='open-frame'){
      if(!sender.tab||!Number.isInteger(message.frameId))throw Error('Некорректная вложенная форма.');
      await openFrame(sender.tab.id,message.frameId);return {ok:true};
    }

    if(message.type==='settings') {
      if(!settingsPage)throw Error('Откройте настройки расширения.');
      if(message.disconnect){await chrome.storage.session.clear();return {ok:true};}
      const url=new URL(message.origin);
      if(url.username||url.password||!['/','/assistant','/assistant/'].includes(url.pathname)||url.search||url.hash||!(url.protocol==='https:'||(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname))))throw Error('Нужен HTTPS-адрес сервера; HTTP допускается только для localhost.');
      if(!/^[A-Za-z0-9_-]{40,100}$/.test(message.token||''))throw Error('Проверьте токен подключения.');
      if(!await chrome.permissions.contains({origins:[url.protocol+'//'+url.hostname+'/*']}))throw Error('Доступ к серверу не предоставлен.');
      await chrome.storage.session.set({origin:url.origin+url.pathname.replace(/\/$/,''),token:message.token});
      return {ok:true};
    }
    if(message.type==='appearance'){if(message.theme!==undefined){if(!['classic','violet'].includes(message.theme))throw Error('Неизвестное оформление.');await chrome.storage.local.set({appearance:message.theme});}return {theme:(await chrome.storage.local.get('appearance')).appearance||'classic'};}
    if(message.type==='openSettings'){await chrome.runtime.openOptionsPage();return {ok:true};}
    if(message.type==='openDashboard'){const {origin}=await chrome.storage.session.get('origin');if(!origin)throw Error('Сначала подключите сервер.');await chrome.tabs.create({url:origin+'/#ai-settings'});return {ok:true};}
    if(message.type!=='api')throw Error('Неизвестный запрос.');
    if(!sender.tab && !settingsPage)throw Error('Откройте панель на странице анкеты.');
    const {origin,token}=await chrome.storage.session.get(['origin','token']);
    if(!origin||!token)throw Error('Подключите сервер в настройках расширения. После закрытия браузера токен нужно ввести заново.');
    const method=message.method||'GET',path=message.path;
    if(!((method==='GET'&&(['/me','/companies'].includes(path)||/^\/companies\/[a-f0-9-]{36}\/(facts|review)$/.test(path)))||(method==='POST'&&['/propose','/explain','/analyze-form','/form-mapping-confirm'].includes(path))||(method==='POST'&&/^\/companies\/[a-f0-9-]{36}\/corrections$/.test(path))))throw Error('Запрос запрещён расширением.');
    if(!settingsPage && method==='POST'&&['/propose','/analyze-form','/form-mapping-confirm'].includes(path)) {
      const current=await chrome.tabs.get(sender.tab.id);
      const frame=sender.frameId?await chrome.webNavigation.getFrame({tabId:sender.tab.id,frameId:sender.frameId}):null;
      const currentURL=frame?.url||current.url;
      if(sender.frameId&&(!frame||new URL(currentURL).origin!==new URL(sender.url).origin))throw Error('Вложенная форма изменилась. Обновите панель.');
      if(message.body?.host!==new URL(currentURL).hostname)throw Error('Страница изменилась. Обновите панель.');
    }
    const response=await fetch(origin+'/api'+path,{method,credentials:'omit',headers:{Authorization:'Bearer '+token,...(message.body?{'Content-Type':'application/json'}:{})},body:message.body?JSON.stringify(message.body):undefined,signal:AbortSignal.timeout(path==='/analyze-form'?60000:path==='/explain'?40000:25000)});
    const data=await response.json().catch(()=>({error:'Сервер вернул непонятный ответ.'}));
    if(!response.ok)throw Error(data.error||'Ошибка подключения.');
    return {data};
  })().then(result=>respond({ok:true,...result})).catch(error=>respond({ok:false,error:error.message}));
  return true;
});
