import {ISO3} from './iso-country-codes.js';
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
for(const name of ['UK','Great Britain','Britain','England','Scotland','Wales','Northern Ireland','Великобритания','Англия','England and Wales'])countries.set(folded(name),'GB');
for(const name of ['USA','U.S.A.','United States of America','США'])countries.set(folded(name),'US');
countries.set(folded('Latvija'),'LV');countries.set(folded('D<<'),'DE');countries.set(folded('Deutsch'),'DE');
for(const [three,two] of Object.entries(ISO3))countries.set(folded(three),two);
for(const [name,code] of Object.entries({Latvian:'LV',British:'GB',Irish:'IE',German:'DE',French:'FR',Spanish:'ES',Italian:'IT',Portuguese:'PT',Dutch:'NL',Belgian:'BE',Polish:'PL',Lithuanian:'LT',Estonian:'EE',Finnish:'FI',Swedish:'SE',Norwegian:'NO',Danish:'DK',Swiss:'CH',Austrian:'AT',Ukrainian:'UA',Russian:'RU',Belarusian:'BY',American:'US',Canadian:'CA',Australian:'AU',Indian:'IN',Chinese:'CN',Japanese:'JP',Turkish:'TR',Greek:'GR',Cypriot:'CY',Maltese:'MT',Romanian:'RO',Bulgarian:'BG',Czech:'CZ',Slovak:'SK',Hungarian:'HU'}))countries.set(folded(name),code);
export const countryCode = value => countries.get(folded(value));
export const countryName = value => {const code=countryCode(value);return code?english.of(code):undefined;};
export function isoDate(raw) {
  let match=compact(raw).match(/^(\d{4})-(\d{2})-(\d{2})$/),year,month,day;
  if(match)[,year,month,day]=match;
  else {
    match=compact(raw).match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);
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
  const enums={operating_address_mode:{same:/\b(?:same|yes|same as registered(?: address)?)\s*$/i,different:/\b(?:different|no|different operating address)\s*$/i},tax_status:{issued:/\b(?:issued|tax number issued)\s*$/i,not_issued:/\bnot[ _]issued(?: yet)?\s*$/i},vat_status:{registered:/^(?![\s\S]*\bnot\b)[\s\S]*\bregistered\s*$/i,not_registered:/\bnot[ _](?:VAT )?registered\s*$/i}};
  if(enums[key]?.[value]&&!({operating_address_mode:/registered|operating|address|адрес/i,tax_status:/tax|TIN|UTR|налог/i,vat_status:/VAT|НДС/i}[key]).test(quote))return false;
  if(enums[key]?.[value])return enums[key][value].test(quote)&&!(value==='issued'&&/\bnot[ _]issued\b/i.test(quote));
  if(key==='applicant_role')return ['contact','director','beneficiary'].includes(value)&&new RegExp('\\b'+value+'\\b','i').test(quote);
  if(key==='legal_form'&&/^Private company limited by (?:shares|guarantee)$/i.test(value))return /\bprivate\s+company\b/i.test(quote)&&new RegExp('\\blimited\\s+by\\s+'+(value.endsWith('shares')?'shares':'guarantee')+'\\b','i').test(quote);
  if(compact(quote).includes(compact(value)))return true;
  if(/_residential_address$/.test(key)&&compact(quote).replace(/[,]/g,'').includes(compact(value).replace(/[,]/g,'')))return true;
  if(/^(?:registered|operating)_address/.test(key)&&compact(quote.replace(/(?:proposed\s+registered(?:\s+office)?(?:\s+address)?|registered\s+office(?:\s+address)?|office\s+address)\s*:?/gi,' ')).includes(compact(value)))return true;
  if(/_(?:passport|id)_expiry$/.test(key)&&quote.split(/\r?\n/).some(line=>mrzExpiryDate(line.trim())===value))return true;
  if(/_(?:first|last)_name$/.test(key)&&quote.split(/\r?\n/).some(line=>/^[PACI][A-Z<][A-Z<]{3}[A-Z<]+$/.test(line)&&line.replace(/</g,' ').replace(/\s+/g,' ').includes(value)))return true;
  if(/_(?:first|last)_name$/.test(key)){const lines=quote.split(/\r?\n/);for(let i=0;i<lines.length-2;i++)if(/^[ACI][A-Z<][A-Z<]{3}[A-Z0-9<]{25}$/.test(lines[i])&&/^[A-Z<]{30}$/.test(lines[i+2])&&lines[i+2].replace(/</g,' ').replace(/\s+/g,' ').includes(value))return true;}
  if(key.endsWith('_nationality')||key==='contact_issuing_country'){
    const lines=quote.split(/\r?\n/);for(let i=0;i<lines.length-1;i++){const first=lines[i],second=lines[i+1];if(!/^[PACI][A-Z<][A-Z<]{3}[A-Z0-9<]+$/.test(first)||![30,36,44].includes(first.length)||second.length!==first.length)continue;const raw=key.endsWith('_nationality')?(first.length===30?second.slice(15,18):second.slice(10,13)):first.slice(2,5);if(countryCode(raw)&&countryCode(raw)===countryCode(value))return true;}
  }
  if(key.endsWith('_gender'))return [...quote.matchAll(/(?:sex|gender|dzimums|пол)\s*[:：.-]?\s*(male|female|M|F|X|vīrietis|sieviete|мужской|женский)(?=\s|$|[.,])/giu)].some(m=>({male:'M',female:'F',m:'M',f:'F',x:'X','vīrietis':'M',sieviete:'F','мужской':'M','женский':'F'})[m[1].toLowerCase()]===value)||quote.split(/\r?\n/).some(line=>/^[A-Z0-9<]+$/.test(line)&&[30,36,44].includes(line.length)&&line[line.length===30?7:20]===value);
  if(/_birth_date$/.test(key)&&quote.split(/\r?\n/).some(line=>mrzBirthDate(line.trim())===value))return true;
  if(/(?:_on|_birth_date|_expiry)$/.test(key))return [...quote.replace(/\b(\d{1,2})(?:st|nd|rd|th)\b/gi,'$1').matchAll(/\b(?:\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]+\s+\d{4}|[A-Za-z]+\s+\d{1,2},?\s+\d{4})\b/g)].some(match=>isoDate(match[0])===value);
  if(key==='country'||key.endsWith('_country')&&key!=='phone_country'||key.endsWith('_nationality'))return quote.split(/[:,;\n]/).some(part=>countryName(part.trim())===value||countryName(part.replace(/\b(?:GIR\s*0AA|[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}|LV[- ]?\d{4})\b/gi,'').trim())===value);
  if(/postal_code$/.test(key))return [...quote.matchAll(/\b(?:GIR\s*0AA|[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}|LV[- ]?\d{4}|[A-Z]{3}\s*\d{4})\b/gi)].some(match=>match[0].toUpperCase().replace(/[\s-]/g,'')===value.toUpperCase().replace(/[\s-]/g,''));
  if(/_(?:passport|id|document)_number$/.test(key))return compact(quote).toUpperCase().replace(/\s+/g,'').includes(compact(value).toUpperCase().replace(/\s+/g,''));
  if(['tax_number','vat_number','company_number','lei_code'].includes(key))return compact(quote).replace(/\s+/g,'').includes(compact(value).replace(/\s+/g,''));
  if(['company_phone','phone_dial_code','phone_national','phone_country'].includes(key))return [...quote.matchAll(/\+[\d ()-]{7,25}\d/g)].some(match=>phoneParts(match[0])?.[key]===value);
  return false;
}
export function comparableValue(key,value){
  const base=folded(value);
  if(/(?:_on|_birth_date|_expiry)$/.test(key))return isoDate(value)||base;
  if(key==='country'||key.endsWith('_country')||key.endsWith('_nationality'))return countryCode(value)||base;
  if(/_(?:passport|id|document)_number$/.test(key))return compact(value).toUpperCase().replace(/\s+/g,'');
  if(['tax_number','vat_number','company_number','lei_code'].includes(key))return base.replace(/\s+/g,'');
  if(key==='company_phone')return phoneParts(value)?.company_phone||base;
  if(key==='company_name')return base.replace(/\bltd\b/g,'limited').replace(/[^\p{L}\p{N}]/gu,'');
  if(/address|postal_code/.test(key))return base.replace(/[^\p{L}\p{N}]/gu,'');
  if(key==='website'){try{const url=new URL(value);return url.origin+url.pathname.replace(/\/$/,'')+url.search;}catch{return value;}}
  return base;
}

// ICAO TD1 / TD2 / TD3 birth-date positions and check digit.
export function mrzBirthDate(line){
 if(!/^[A-Z0-9<]+$/.test(line)||![30,36,44].includes(line.length))return;
 const start=line.length===30?0:13,raw=line.slice(start,start+6),digit=line[start+6];
 if(!/^\d{6}$/.test(raw)||!/^\d$/.test(digit)||[...raw].reduce((n,c,i)=>n+Number(c)*[7,3,1][i%3],0)%10!==Number(digit))return;
 const now=new Date(),yy=Number(raw.slice(0,2)),year=(yy<=now.getUTCFullYear()%100?2000:1900)+yy;
 const value=isoDate(`${year}-${raw.slice(2,4)}-${raw.slice(4,6)}`);
 if(value&&value<=now.toISOString().slice(0,10))return value;
}

export function mrzExpiryDate(line){
 if(!/^[A-Z0-9<]+$/.test(line)||![30,36,44].includes(line.length))return;
 const start=line.length===30?8:21,raw=line.slice(start,start+6),digit=line[start+6];if(!/^\d{6}$/.test(raw)||!/^\d$/.test(digit)||[...raw].reduce((sum,c,i)=>sum+Number(c)*[7,3,1][i%3],0)%10!==Number(digit))return;
 let year=2000+Number(raw.slice(0,2)),now=new Date().getUTCFullYear();if(year<now-50)year+=100;if(year>now+50)year-=100;return isoDate(`${year}-${raw.slice(2,4)}-${raw.slice(4,6)}`);
}
