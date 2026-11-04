chrome.action.onClicked.addListener(async tab=>{
  if(!tab.id || !/^https?:/.test(tab.url||''))return chrome.runtime.openOptionsPage();
  try {await chrome.scripting.executeScript({target:{tabId:tab.id},files:['dom.js','panel.js']});}
  catch {await chrome.runtime.openOptionsPage();}
});

chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  (async()=>{
    if(sender.id!==chrome.runtime.id)throw Error('Недопустимый отправитель.');
    const settingsPage=sender.url===chrome.runtime.getURL('options.html');
    if(message.type==='settings') {
      if(!settingsPage)throw Error('Откройте настройки расширения.');
      if(message.disconnect){await chrome.storage.session.clear();return {ok:true};}
      const url=new URL(message.origin);
      if(url.username||url.password||url.pathname!=='/'||url.search||url.hash||!(url.protocol==='https:'||(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname))))throw Error('Нужен HTTPS-адрес сервера; HTTP допускается только для localhost.');
      if(!/^[A-Za-z0-9_-]{40,100}$/.test(message.token||''))throw Error('Проверьте токен подключения.');
      if(!await chrome.permissions.contains({origins:[url.protocol+'//'+url.hostname+'/*']}))throw Error('Доступ к серверу не предоставлен.');
      await chrome.storage.session.set({origin:url.origin,token:message.token});
      return {ok:true};
    }
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
      if(message.body?.host!==new URL(current.url).hostname)throw Error('Страница изменилась. Обновите панель.');
    }
    const response=await fetch(origin+'/api'+path,{method,credentials:'omit',headers:{Authorization:'Bearer '+token,...(message.body?{'Content-Type':'application/json'}:{})},body:message.body?JSON.stringify(message.body):undefined,signal:AbortSignal.timeout(path==='/analyze-form'?60000:path==='/explain'?40000:25000)});
    const data=await response.json().catch(()=>({error:'Сервер вернул непонятный ответ.'}));
    if(!response.ok)throw Error(data.error||'Ошибка подключения.');
    return {data};
  })().then(result=>respond({ok:true,...result})).catch(error=>respond({ok:false,error:error.message}));
  return true;
});
