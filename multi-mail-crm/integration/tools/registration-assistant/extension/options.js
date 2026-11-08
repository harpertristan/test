const status=document.getElementById('status');
document.getElementById('settings').addEventListener('submit',async event=>{
  event.preventDefault();
  try {
    const url=new URL(document.getElementById('origin').value),origin=url.origin+url.pathname.replace(/\/$/,'');
    const allowed=await chrome.permissions.request({origins:[url.protocol+'//'+url.hostname+'/*']});
    if(!allowed)throw Error('Разрешите расширению обращаться к вашему серверу.');
    const result=await chrome.runtime.sendMessage({type:'settings',origin,token:document.getElementById('token').value.trim()});
    if(!result.ok)throw Error(result.error);
    const check=await chrome.runtime.sendMessage({type:'api',path:'/me'});
    if(!check.ok){await chrome.runtime.sendMessage({type:'settings',disconnect:true});throw Error(check.error);}
    document.getElementById('token').value='';status.textContent=`Подключено: ${check.data.username}. Откройте анкету и нажмите значок помощника.`;
  }catch(error){status.textContent=error.message;}
});
document.getElementById('disconnect').addEventListener('click',async()=>{await chrome.runtime.sendMessage({type:'settings',disconnect:true});document.getElementById('token').value='';status.textContent='Устройство отключено. Для полного отзыва токена используйте веб-интерфейс.';});
