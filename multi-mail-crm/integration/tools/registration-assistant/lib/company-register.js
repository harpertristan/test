import {createHash} from 'node:crypto';
import {isoDate,compact,valueGrounded} from './normalization.js';
import {splitAddress} from './addresses.js';

export const REGISTER_HOST='find-and-update.company-information.service.gov.uk';
export function registryURL(raw){
 let url;try{url=new URL(raw);}catch{throw Object.assign(Error('Вставьте полную ссылку на запись компании в Companies House.'),{status:400});}
 const match=url.pathname.match(/^\/company\/([A-Z0-9]{8})(?:\/)?$/i);
 if(url.protocol!=='https:'||url.hostname!==REGISTER_HOST||url.port||url.username||url.password||!match||url.search||url.hash)throw Object.assign(Error('Поддерживается ссылка https://find-and-update.company-information.service.gov.uk/company/NUMBER. Ссылки на другие сайты не загружаются.'),{status:400});
 return `https://${REGISTER_HOST}/company/${match[1].toUpperCase()}`;
}
const decode=text=>text.replace(/&#(?:x([0-9a-f]+)|(\d+));/gi,(_,hex,decimal)=>{const code=parseInt(hex||decimal,hex?16:10);return code>0&&code<=0x10ffff?String.fromCodePoint(code):'';}).replace(/&(amp|quot|apos|lt|gt|nbsp);/g,(_,entity)=>({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '}[entity]));
function plain(html){return decode(html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<br\s*\/?\s*>|<\/(?:p|div|dd|dt|li|h[1-6])>/gi,'\n').replace(/<[^>]*>/g,' ')).split(/\n/).map(compact).filter(Boolean).join('\n');}
function element(html,id){return html.match(new RegExp(`<([a-z][a-z0-9]*)\\b[^>]*\\bid=["']${id}["'][^>]*>([\\s\\S]*?)<\\/\\1>`,'i'))?.[2];}
function definition(html,label){for(const match of html.matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi))if(plain(match[1]).toLowerCase()===label.toLowerCase())return plain(match[2]);}
export function parseRegister(html,url){
 url=registryURL(url);const number=url.split('/').at(-1),text=plain(html);
 if(!new RegExp(`\\bCompany number\\s+${number}\\b`,'i').test(text))throw Object.assign(Error('Страница не подтвердила регистрационный номер. Данные не импортированы.'),{status:422});
 const name=element(html,'company-name')||html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
 const companyName=name&&plain(name),date=definition(html,'Incorporated on'),legal=definition(html,'Company type'),address=element(html,'registered-office-address')||definition(html,'Registered office address');
 if(!companyName||companyName.length>200||!date||!isoDate(date)||!legal||!address)throw Object.assign(Error('Не удалось прочитать обязательные реквизиты страницы реестра. Возможна проверка доступа или изменение формата сайта.'),{status:422});
 if(!/^(?:private|public|limited liability partnership|limited partnership|scottish|registered society|charitable|royal charter)/i.test(legal))throw Object.assign(Error('Этот тип записи реестра пока не поддерживается. Страна регистрации не будет определяться по адресу сайта; используйте документы компании.'),{status:422});
 const full=plain(address),explicitParts=splitAddress(full),addressQuote=explicitParts.country?full:full+'\nUnited Kingdom',parts=explicitParts.country?explicitParts:splitAddress(addressQuote),fields=[];
 const add=(key,value,quote)=>{if(value&&valueGrounded(key,value,quote))fields.push({key,value,quote});};
 add('company_name',companyName,companyName);add('company_number',number,text.match(new RegExp(`Company number\\s+${number}`,'i'))[0]);add('incorporated_on',isoDate(date),date);add('legal_form',legal,legal);
 add('registered_address',compact(full),addressQuote);
 for(const [part,key] of Object.entries({line1:'registered_address_line1',line2:'registered_address_line2',city:'city',postcode:'postal_code',country:'registered_country'}))add(key,parts[part],addressQuote);
 const sic=html.match(/<li\b[^>]*>\s*(\d{5})\s*[-–]\s*([\s\S]*?)<\/li>/i);
 if(sic){const quote=plain(sic[0]);add('sic_code',sic[1],quote);add('industry',plain(sic[2]),quote);add('business_description',plain(sic[2]),quote);}
 // The registry jurisdiction establishes incorporation country, not tax residence.
 fields.push({key:'country',value:'United Kingdom',quote:'Companies House · United Kingdom'});
 return {url,number,companyName,fields,pages:[{page:1,text:'Companies House · United Kingdom\nRegistered office address (registry jurisdiction included):\n'+addressQuote+'\n'+text}],fetchedAt:new Date().toISOString()};
}
export async function previewRegister(url,fetcher=fetch){
 url=registryURL(url);let response;try{response=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(15000),headers:{Accept:'text/html'}});}catch{throw Object.assign(Error('Не удалось соединиться с Companies House. Проверьте доступ к реестру; документы не изменены.'),{status:502});}
 if(!response.ok||!/text\/html/i.test(response.headers.get('content-type')||''))throw Object.assign(Error('Реестр не вернул страницу компании. Попробуйте позже или загрузите выписку файлом.'),{status:502});
 if(Number(response.headers.get('content-length'))>2_000_000)throw Object.assign(Error('Страница реестра слишком велика.'),{status:502});
 const reader=response.body.getReader(),chunks=[];let length=0;try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>2_000_000)throw Object.assign(Error('Страница реестра слишком велика.'),{status:502});chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
 const result=parseRegister(Buffer.concat(chunks).toString('utf8'),url);
 return {...result,digest:createHash('sha256').update(JSON.stringify(result.fields)).digest('hex')};
}
