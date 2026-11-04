import {parsePhoneNumberFromString} from 'libphonenumber-js';
export const compact = value => String(value).normalize('NFKC').replace(/\s+/g,' ').trim();
export const folded = value => compact(value).toLowerCase();
const countries=new Map();
const english=new Intl.DisplayNames(['en'],{type:'region'});
for(const locale of ['en','ru']) {
  const names=new Intl.DisplayNames([locale],{type:'region'});
  for(let a=65;a<=90;a++)for(let b=65;b<=90;b++){
    const code=String.fromCharCode(a,b),name=names.of(code);
    if(name!==code){const canonical=code==='UK'?'GB':code;countries.set(folded(name),canonical);countries.set(folded(code),canonical);}
  }
}
for(const name of ['UK','Great Britain','Britain','England','Scotland','Wales','Northern Ireland','Великобритания','Англия'])countries.set(folded(name),'GB');
for(const name of ['USA','U.S.A.','United States of America','США'])countries.set(folded(name),'US');
export const countryCode = value => countries.get(folded(value));
export const countryName = value => {const code=countryCode(value);return code?english.of(code):undefined;};
export function isoDate(raw) {
  let match=compact(raw).match(/^(\d{4})-(\d{2})-(\d{2})$/),year,month,day;
  if(match)[,year,month,day]=match;
  else {
    match=compact(raw).match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if(match)[,day,month,year]=match;
    else {
      const months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
      match=compact(raw).match(/^(\d{1,2})\s+([A-Za-z]+)\s*,?\s*(\d{4})$/);
      if(match){[,day,,year]=match;const index=months.indexOf(match[2].slice(0,3).toLowerCase());if(index<0)return;month=String(index+1);}
      else {match=compact(raw).match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);if(!match)return;[, ,day,year]=match;const index=months.indexOf(match[1].slice(0,3).toLowerCase());if(index<0)return;month=String(index+1);}
    }
  }
  const date=new Date(Date.UTC(+year,+month-1,+day));
  if(date.getUTCFullYear()!==+year||date.getUTCMonth()!==+month-1||date.getUTCDate()!==+day)return;
  return `${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`;
}
export function phoneParts(raw) {
  if(!/^\+/.test(raw.trim()))return;
  const phone=parsePhoneNumberFromString(raw);
  if(!phone?.isValid())return;
  return {company_phone:phone.number,phone_dial_code:'+'+phone.countryCallingCode,phone_national:phone.nationalNumber,phone_country:phone.country};
}
export function valueGrounded(key,value,quote) {
  if(compact(quote).includes(compact(value)))return true;
  if(/(?:_on|_birth_date|_expiry)$/.test(key))return [...quote.matchAll(/\b(?:\d{1,2}\.\d{1,2}\.\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]+\s+\d{4}|[A-Za-z]+\s+\d{1,2},?\s+\d{4})\b/g)].some(match=>isoDate(match[0])===value);
  if(key==='country'||key==='director_nationality')return quote.split(/[:,;\n]/).some(part=>countryName(part.trim())===value);
  if(['company_phone','phone_dial_code','phone_national','phone_country'].includes(key))return [...quote.matchAll(/\+[\d ()-]{7,25}\d/g)].some(match=>phoneParts(match[0])?.[key]===value);
  return false;
}
export function comparableValue(key,value){
  const base=folded(value);
  if(key==='country')return countryCode(value)||base;
  if(key==='company_name')return base.replace(/\bltd\b/g,'limited').replace(/[^\p{L}\p{N}]/gu,'');
  if(/address|postal_code/.test(key))return base.replace(/[^\p{L}\p{N}]/gu,'');
  if(key==='website'){try{const url=new URL(value);return url.origin+url.pathname.replace(/\/$/,'')+url.search;}catch{return value;}}
  return base;
}
