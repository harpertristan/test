export const isBusyJob=job=>['running','cancelling'].includes(job?.status);
export function requestStatus(job){
 const request=job?.request;if(!request)return job?.current??'';
 const label={search:'Поисковый запрос',app:'Карточка приложения',related:'Рекомендации Google Play',developer:'Приложения разработчика',page:'Публичная страница',website_evidence:'Сведения сайта через Brave'}[request.kind]??'Запрос к источнику';
 const elapsed=Math.max(0,Math.floor((Date.now()-Date.parse(request.startedAt))/1000));
 return `${job.current??''} · ${label}: ожидаем ответ ${elapsed} с, предел ${Math.ceil(request.timeoutMs/1000)} с`;
}
