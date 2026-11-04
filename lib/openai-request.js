// Only predefined diagnostic messages may cross the API boundary; never relay provider text.
export function publicAIError(message,status=502,code='AI_REQUEST_FAILED'){
  return Object.assign(new Error(message),{status,publicMessage:message,code});
}
export function openAIBody(model,body){
  return {model,...body,...(/^gpt-5(?:[.-]|$)/.test(model)?{reasoning_effort:'low'}:{})};
}
export async function requestOpenAI(fetcher,config,body,timeout=45000){
  let response;
  try{response=await fetcher('https://api.openai.com/v1/chat/completions',{method:'POST',signal:AbortSignal.timeout(timeout),headers:{Authorization:'Bearer '+config.AI_API_KEY,'Content-Type':'application/json'},body:JSON.stringify(openAIBody(config.AI_MODEL,body))});}
  catch(error){throw publicAIError(error?.name==='TimeoutError'||error?.name==='AbortError'?'OpenAI не ответил вовремя. Повторите запрос.':'Не удалось соединиться с OpenAI. Проверьте интернет, VPN и доступ к api.openai.com. Ключ и документы не выводятся.');}
  if(!response.ok){
    let code='';try{code=(await response.json())?.error?.code||'';}catch{}
    if(response.status===401)throw publicAIError('OpenAI отклонил API-ключ (HTTP 401). Проверьте или замените ключ.');
    if(response.status===403)throw publicAIError('OpenAI запретил доступ (HTTP 403). Проверьте регион и разрешения API-проекта.');
    if(response.status===404||code==='model_not_found')throw publicAIError('Модель OpenAI не найдена или недоступна этому API-проекту. Проверьте название модели.');
    if(response.status===429)throw publicAIError(code==='insufficient_quota'?'На API-счёте OpenAI недостаточно средств или достигнут лимит бюджета. Подписка ChatGPT не оплачивает API.':'OpenAI ограничил частоту запросов (HTTP 429). Подождите и повторите.');
    if(response.status===400)throw publicAIError('OpenAI отклонил параметры запроса (HTTP 400). Проверьте совместимость выбранной модели с Chat Completions и JSON-ответами.');
    throw publicAIError(`OpenAI временно недоступен (HTTP ${response.status}). Повторите запрос позже.`);
  }
  try{return await response.json();}catch{throw publicAIError('OpenAI вернул нечитаемый ответ. Повторите запрос.');}
}
