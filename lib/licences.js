import {SOCIAL_SOURCES} from './source-catalog.js';
export const LICENCE_TYPES={bank:'Банковская лицензия',emi:'EMI · электронные деньги',pi:'PI · платёжная организация',casp:'CASP · криптоуслуги по MiCA',vasp:'VASP / национальная регистрация',unknown:'Тип не подтверждён'};
export const LICENCE_REGISTERS=[
 {name:'EBA · банки / EMI / PI',url:'https://euclid.eba.europa.eu/register/',types:['bank','emi','pi'],region:'ЕС'},
 {name:'ECB · поднадзорные банки',url:'https://www.bankingsupervision.europa.eu/banking/list/html/index.en.html',types:['bank'],region:'Банковский надзор ЕС'},
 {name:'ESMA · MiCA / CASP',url:'https://www.esma.europa.eu/publications-and-data/databases-and-registers/interim-mica-register',types:['casp'],region:'ЕС'},
 {name:'Банк Литвы · участники рынка',url:'https://www.lb.lt/en/financial-market-participants',types:['bank','emi','pi','casp'],region:'Литва'},
 {name:'DNB · публичные реестры',url:'https://www.dnb.nl/en/public-register/',types:['bank','emi','pi'],region:'Нидерланды'},
 {name:'REGAFI · финансовые организации',url:'https://www.regafi.fr/',types:['bank','emi','pi'],region:'Франция'},
 {name:'Центральный банк Ирландии · реестры',url:'https://registers.centralbank.ie/',types:['bank','emi','pi','casp'],region:'Ирландия'},
 {name:'BaFin',url:'https://www.bafin.de/',types:['bank','emi','pi','casp'],region:'Германия'},
 {name:'AMF · криптоуслуги',url:'https://www.amf-france.org/',types:['casp','vasp'],region:'Франция'},
 {name:'MFSA',url:'https://www.mfsa.mt/',types:['bank','emi','pi','casp'],region:'Мальта'},
 {name:'CSSF',url:'https://www.cssf.lu/',types:['bank','emi','pi','casp'],region:'Люксембург'},
];
export {LICENCE_QUERIES} from './licence-queries.js';
const normal=v=>String(v??'').normalize('NFKC').replace(/\s+/g,' ').trim();
export function officialRegulator(raw){try{const host=new URL(raw).hostname.replace(/^www\./,'');return SOCIAL_SOURCES.filter(s=>s.category==='register').some(s=>s.domains.some(d=>host===d||host.endsWith('.'+d)));}catch{return false;}}
export function licenceLead(entry){const text=[entry.title,entry.snippet,entry.screeningText,...(entry.documents??[]).map(d=>d.text)].join(' ');return officialRegulator(entry.url)&&/\b(?:EMI|MiCA|CASP|electronic money|e-money|crypto.asset service provider)\b|электронн\w* деньг/iu.test(text);}
function exactDate(date,text){if(!/^\d{4}-\d{2}-\d{2}$/.test(date??'')||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)return null;const [y,m,d]=date.split('-');const month=new Intl.DateTimeFormat('en',{month:'long',timeZone:'UTC'}).format(new Date(date));return [date,`${d}.${m}.${y}`,`${Number(d)} ${month} ${y}`,`${month} ${Number(d)}, ${y}`,`${month} ${Number(d)} ${y}`].some(v=>normal(text).toLowerCase().includes(v.toLowerCase()))?date:null;}
export function validateLicences(raw,documents){return (Array.isArray(raw?.licences)?raw.licences:[]).flatMap(item=>{
 const doc=documents.find(d=>d.id===item.sourceId),quote=normal(item.quote),organisation=normal(item.organisation);
 if(!doc||!officialRegulator(doc.url)||quote.length<15||quote.length>3000||!normal(doc.text).includes(quote)||!organisation||!quote.toLowerCase().includes(organisation.toLowerCase()))return[];
 const type=Object.hasOwn(LICENCE_TYPES,item.type)?item.type:'unknown';
 const types={bank:/bank(?:ing)? licen[cs]|credit institution/i,emi:/electronic money|e-money|\bEMI\b/i,pi:/payment institution|\bPI\b/i,casp:/\bCASP\b|crypto.asset service provider/i,vasp:/\bVASP\b|virtual asset service provider/i,unknown:/.*/};
 if(!types[type].test(quote))return[];
 const granted=/\b(?:grant(?:ed|s)?|authori[sz](?:ed|ation)|licen[cs]ed|approved)\b|выдал|получил|лицензирован/iu.test(quote)&&!/\b(?:applied|application|seeking|not yet|will|plans?|revoked|withdrawn|refused|rejected|not authorised|not authorized|unauthori[sz]ed)\b/i.test(quote);
 const registration=/\bregister(?:ed|s|ation)?\b/i.test(quote)&&!/revoked|withdrawn|refused|rejected|not registered|unregistered/i.test(quote);
 const status=granted&&type!=='vasp'?'authorised':registration?'registered':'needs_review';
 return [{type,organisation,authority:normal(quote).includes(normal(item.authority))?normal(item.authority).slice(0,200):'',status,decisionDate:status==='authorised'||status==='registered'?exactDate(item.decisionDate,quote):null,quote,url:doc.url,country:normal(quote).includes(normal(item.country))?normal(item.country).slice(0,100):'',notice:'Цитата официального источника; статус, объём разрешения и актуальность проверьте в реестре. Лицензия не подтверждает открытие бизнес-счёта или EU IBAN.'}];
 });}
