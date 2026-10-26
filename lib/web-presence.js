import {publicURL} from './qualification.js';
const web=/\b(?:web[ -]?(?:app(?:lication)?|banking|platform|portal|version)|online banking|internet banking|browser[ -]based|(?:manage|access|banking).{0,45}(?:browser|desktop))\b|веб[ -]?(?:сервис|верси|приложен|платформ|кабинет)|интернет[ -]?банк/iu;
const cabinet=/\b(?:(?:web|online)[ -]?(?:dashboard|portal)|(?:business|customer|client|banking)[ -]?portal|online banking|internet banking|web app(?:lication)?.{0,45}(?:dashboard|portal))\b|личн\w* кабинет|веб[ -]?кабинет|интернет[ -]?банк/iu;
const futureOrNegative=/\b(?:no|without|do not|does not|cannot|not available|coming soon|will offer|plan to|will launch)\b.{0,50}(?:web|online|dashboard|portal|browser)|(?:web|online|dashboard|portal).{0,30}(?:not available|not supported|not offered|not provided|coming soon)|кабинет.{0,30}(?:недоступен|отсутствует|планируется|скоро)|нет.{0,20}(?:веб|кабинет)/iu;
export function dashboardLinks(body,base){
 const site=publicURL(base);if(!site)return[];const host=site.hostname.replace(/^www\./,'');
 return [...new Set([...String(body??'').matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].flatMap(([,href,label])=>{
  try{const url=publicURL(new URL(href.replaceAll('&amp;','&'),base).href);return url&&(url.hostname===host||url.hostname.endsWith('.'+host))&&(/\/(?:login|log-in|signin|sign-in|dashboard|internet-banking)(?:\/|$)/i.test(url.pathname)||/\b(?:log[ -]?in|sign[ -]?in|client portal|web banking)\b|войти|вход в кабинет/i.test(label))?[url.href]:[];}catch{return[];}
 }))].slice(0,5);
}
export function assessWebPresence(documents=[],{productURL}={}){
 const site=publicURL(productURL),host=site?.hostname.replace(/^www\./,'');
 const service={status:'unknown',evidence:[]},account={status:'unknown',evidence:[],links:[]};
 for(const d of documents){
  const url=publicURL(d.url);if(!url)continue;
  const ownSite=host&&(url.hostname===host||url.hostname.endsWith('.'+host));
  const listing=d.kind==='listing'&&['play.google.com','apps.apple.com'].includes(url.hostname);
  if(!ownSite&&!listing)continue;
  for(const text of String(d.text??'').split(/\n+|(?<=[.!?])\s+/u)){
   if(futureOrNegative.test(text))continue;
   if(web.test(text))service.evidence.push({text:text.slice(0,800),url:url.href});
   if(cabinet.test(text))account.evidence.push({text:text.slice(0,800),url:url.href});
  }
  if(ownSite&&d.kind==='official_page')for(const link of d.dashboardLinks??[]){const u=publicURL(link);if(u&&(u.hostname===host||u.hostname.endsWith('.'+host)))account.links.push(u.href);}
 }
 for(const proof of account.evidence)if(!service.evidence.some(p=>p.url===proof.url&&p.text===proof.text))service.evidence.push(proof);
 if(account.links.length){service.evidence.push({text:'На публичной странице найдена ссылка на вход в веб-кабинет. Вход не выполнялся.',url:site.href});}
 return mergeWebPresence({service,cabinet:account});
}
export function mergeWebPresence(...items){
 const result={service:{status:'unknown',evidence:[]},cabinet:{status:'unknown',evidence:[],links:[]}};
 for(const item of items)for(const key of ['service','cabinet']){
  const part=item?.[key];if(!part)continue;
  for(const e of part.evidence??[])if(publicURL(e.url)&&e.text&&!result[key].evidence.some(p=>p.url===e.url&&p.text===e.text))result[key].evidence.push(e);
  if(key==='cabinet')result.cabinet.links.push(...(part.links??[]).filter(url=>publicURL(url)));
 }
 for(const key of ['service','cabinet']){result[key].evidence=result[key].evidence.slice(0,3);if(result[key].evidence.length)result[key].status='mentioned';}
 result.cabinet.links=[...new Set(result.cabinet.links)].slice(0,5);if(result.cabinet.links.length)result.cabinet.status='link_found';
 return result;
}
export const webPresenceLabel=part=>part?.status==='link_found'?'Найдена ссылка на вход · вход не проверен':part?.status==='mentioned'?'Есть упоминание в источнике':'Не подтверждён';
