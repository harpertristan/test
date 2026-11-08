import {SOCIAL_SOURCES} from './source-catalog.js';
import {canonicalName} from './identity-names.js';
import {publicURL} from './qualification.js';
import {htmlText} from './page-provider.js';
const excludedDomains=SOCIAL_SOURCES.filter(s=>s.category!=='partner').flatMap(s=>s.domains).concat(['google.com','apple.com']);
function productURL(raw){const u=publicURL(raw);if(!u||excludedDomains.some(d=>u.hostname===d||u.hostname.endsWith('.'+d)))return null;if(/\/(?:login|signup|register|account|dashboard)(?:\/|$)/i.test(u.pathname))return u.origin+'/';return u.href;}
function hasName(text,name){const n=canonicalName(name);return Boolean(n&&n.length>=3&&String(text).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'').includes(n));}
export async function researchLicenceSites(licences,{pages,index,signal,isExcluded=()=>false,onStage=()=>{}}){
 const websites=[],errors=[];
 for(const licence of licences){
  signal.throwIfAborted();const organisation=licence.organisation;
  if(isExcluded({title:organisation,serviceName:organisation}))continue;
  onStage('Лицензия: ищем официальный сайт '+organisation);
  const candidates=[];
  try{const page=await pages.page(licence.url);for(const [,href,label]of String(page.body??'').matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
   let url;try{url=productURL(new URL(href.replaceAll('&amp;','&'),page.url).href);}catch{}if(url&&hasName(htmlText(label),organisation))candidates.push({url,association:'official_link'});
  }}catch(error){if(signal.aborted)throw error;}
  if(!candidates.length&&index?.configured())try{
   const results=await index.search({q:`"${organisation.replaceAll('"','')}" ("official" OR "business account" OR "IBAN")`,count:5,search_lang:'en'});
   for(const result of results){const url=productURL(result.url);if(url&&hasName([result.title,result.description].join(' '),organisation))candidates.push({url,association:'search_name_match'});}
  }catch(error){if(signal.aborted)throw error;errors.push('Поиск сайта '+organisation+' не завершён.');}
  for(const candidate of [...new Map(candidates.map(c=>[c.url,c])).values()].slice(0,2)){
   if(isExcluded({title:organisation,url:candidate.url,developerWebsite:candidate.url}))continue;
   onStage('Лицензия: читаем сайт '+organisation);
   try{const page=await pages.page(candidate.url);signal.throwIfAborted();if(candidate.association!=='official_link'&&!hasName(page.text,organisation))continue;
    if(isExcluded({title:organisation,url:page.url,developerWebsite:page.url}))continue;
    websites.push({organisation,url:page.url,association:candidate.association,text:page.text,publishedAt:page.publishedAt??null,licence});break;
   }catch(error){if(signal.aborted)throw error;errors.push('Сайт кандидата '+organisation+' недоступен.');}
  }
 }
 return {websites,errors};
}
