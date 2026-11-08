// Bounds both the connection and reading the response body. A timeout does not
// mean a write failed, so mutations are never automatically repeated here.
export async function apiJSON(path,options={}, {timeoutMs=40000,request=globalThis.fetch}={}){
 const controller=new AbortController();let timedOut=false;
 const external=options?.signal,abort=()=>controller.abort(external.reason);
 if(external?.aborted)abort();else external?.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
 try{
  const response=await request(path,{...options,signal:controller.signal});
  let result;try{result=await response.json();}catch(error){if(controller.signal.aborted)throw error;throw new Error('Программа вернула нечитаемый ответ. Обновите страницу и проверьте окно Терминала.');}
  if(!response.ok)throw Object.assign(new Error(result.error||'Не удалось выполнить запрос.'),{status:response.status,activeJobId:result.activeJobId});
  return result;
 }catch(error){
  if(timedOut){const write=!['GET','HEAD'].includes((options?.method??'GET').toUpperCase());throw Object.assign(new Error(write?`Программа не ответила за ${Math.ceil(timeoutMs/1000)} с. Проверьте окно Терминала и обновите страницу: операция могла сохраниться.`:`Не удалось обновить данные за ${Math.ceil(timeoutMs/1000)} с. Поиск может продолжаться. Обновите страницу и проверьте окно программы.`,{cause:error}),{code:'UI_TIMEOUT',requestPath:path,writeMayHaveSucceeded:write});}
  throw error;
 }finally{clearTimeout(timer);external?.removeEventListener('abort',abort);}
}
