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
export function licenceLead(entry){return regulatoryKind(entry)==='entity';}
function exactDate(date,text){if(!/^\d{4}-\d{2}-\d{2}$/.test(date??'')||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)return null;const [y,m,d]=date.split('-');const month=new Intl.DateTimeFormat('en',{month:'long',timeZone:'UTC'}).format(new Date(date));return [date,`${d}.${m}.${y}`,`${Number(d)} ${month} ${y}`,`${month} ${Number(d)}, ${y}`,`${month} ${Number(d)} ${y}`].some(v=>normal(text).toLowerCase().includes(v.toLowerCase()))?date:null;}
const permissionTypes={bank:/bank(?:ing)? licen[cs]|credit institution/i,emi:/electronic money|e-money|\bEMI\b/i,pi:/payment institution|\bPI\b/i,casp:/\bCASP\b|crypto.asset service provider|crypto.asset services/i,vasp:/\bVASP\b|virtual asset service provider/i,unknown:/.*/};
const dualPermission=quote=>/\b(?:two|both)\b.{0,80}(?:licen[cs]|authori)|licen[cs]e.{0,200}\band\b.{0,35}(?:an?|the)\s+(?:licen[cs]e|authori)/iu.test(quote);
function grantedTypes(quote,organisation){const context=quote.slice(Math.max(0,quote.toLowerCase().indexOf(organisation.toLowerCase())+organisation.length));const types=Object.entries(permissionTypes).filter(([k,p])=>k!=='unknown'&&k!=='vasp'&&p.test(context)&&!(k==='bank'&&/not (?:an? )?(?:licensed )?(?:bank|credit institution)/i.test(context))).sort((a,b)=>context.search(a[1])-context.search(b[1])).map(([k])=>k);return dualPermission(quote)?types:types.slice(0,1);}
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function recipientName(name){return Boolean(name&&name.length>=3&&!/^(?:NCA|NCAs|AMF|ESMA|EBA|ECB|CASP|MiCA|PI|EMI|competent authority|national competent authorit(?:y|ies)|Autorit[eé] des March[eé]s Financiers|Bank of Lithuania|Latvijas Banka|European (?:Banking Authority|Central Bank|Securities and Markets Authority))$/iu.test(normal(name).replace(/\s*\([^)]*\)/g,'')));}
function permissionStatus(quote,organisation){
 const q=normal(quote),n=escape(organisation);
 if(/wish(?:es)? to be|intend(?:s)? to|seeking|applied for|application (?:for|to)|not yet|will (?:be|issue|grant)|plans? to|revoked|withdrawn|refused|rejected|not authori[sz]ed|unauthori[sz]ed/iu.test(q))return'needs_review';
 const granted=new RegExp('(?:authori[sz]ed|approved|licen[cs]ed)\\s+'+n+'\\b|\\b'+n+'\\s+(?:(?:has been|was|is)\\s+)?(?:authori[sz]ed|approved|licen[cs]ed)\\s+(?:as|to operate|under|by)\\b|\\b'+n+'\\s+(?:has\\s+)?(?:received|obtained|secured)\\b|(?:grant(?:ed|s)?|issu(?:ed|es|ing)|decided to (?:issue|grant))(?:(?![.!?]).){0,100}\\b(?:to\\s+)?'+n+'\\b','iu');
 if(granted.test(q))return'authorised';
 if(new RegExp('\\b'+n+'\\s+(?:(?:has been|was|is)\\s+)?registered\\s+(?:as|with|by|under|on)\\b|register(?:ed|s)\\s+'+n+'\\b','iu').test(q)&&!/not registered|unregistered/i.test(q))return'registered';
 return'needs_review';
}
export function regulatoryKind(entry){
 if(!officialRegulator(entry.url))return null;
 const text=[entry.title,entry.snippet,entry.screeningText,...(entry.documents??[]).map(d=>d.text)].filter(Boolean).join('\n');
 const title=normal(entry.title),url=String(entry.url);
 const reference=/application forms?|licensing guide|application guide|consultation|work programme|annual report|guidance|guidelines|how to|requirements for|regulat(?:ion|ory) framework|explained|supervision of|licensing (?:of|the activity)|new (?:rules|regulation)|utility token/iu;
 if(reference.test(title)||/consultation|licensing[-_](?:application|guide)|application[-_]forms|work[-_]programme|annual[-_]report/i.test(url))return'reference';
 return extractLicenceEvents([{id:'s1',url:entry.url,text}]).some(l=>l.status==='authorised'||l.status==='registered')?'entity':'reference';
}
export function extractLicenceEvents(documents){
 const raw=[];
 for(const doc of documents){if(!officialRegulator(doc.url))continue;
  for(const quote of String(doc.text??'').split(/\n+|(?<=[.!?])\s+/u)){
   if(quote.length<20||quote.length>3000)continue;
   const patterns=[/(?:decided to (?:issue|grant)|grant(?:ed|s)?|issu(?:ed|es|ing))\s+(?:to\s+)?([A-Z][\p{L}0-9&'’.-]*(?:\s+[\p{L}0-9&'’.-]+){0,7}?)\s+(?:an?|the)\s+(?:licen[cs]e|authori[sz]ation)/u,/(?:authori[sz]ed|approved|licen[cs]ed)\s+([A-Z][\p{L}0-9&'’.-]*(?:\s+[\p{L}0-9&'’.-]+){0,6}?)\s+(?:as|to operate|under)/u,/^([A-Z][\p{L}0-9&'’.-]*(?:\s+[\p{L}0-9&'’.-]+){0,5}?)\s+(?:(?:has been|was|is|has)\s+)?(?:authori[sz]ed|licen[cs]ed|received|obtained|registered)\b/u];
   const name=patterns.map(p=>quote.match(p)?.[1]).find(Boolean);if(!recipientName(name))continue;
   const supported=grantedTypes(quote,name);const types=supported.length?supported:Object.entries(permissionTypes).filter(([k,p])=>k!=='unknown'&&p.test(quote)).map(([k])=>k).slice(0,1);
   const literal=quote.match(/\bon\s+(\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]+\s+\d{4}|[A-Za-z]+\s+\d{1,2},?\s+\d{4})/i)?.[1],parsed=literal?Date.parse(/^\d{4}-/.test(literal)?literal+'T00:00:00Z':literal+' UTC'):NaN;
   const decisionDate=Number.isFinite(parsed)?new Date(parsed).toISOString().slice(0,10):null;
   for(const type of types)raw.push({type,organisation:name,sourceId:doc.id,quote,decisionDate});
  }
 }
 return validateLicences({licences:raw},documents);
}
export function validateLicences(raw,documents){
 const result=[];
 for(const item of Array.isArray(raw?.licences)?raw.licences:[]){
  const doc=documents.find(d=>d.id===item.sourceId),quote=normal(item.quote),organisation=normal(item.organisation);
  if(!doc||!officialRegulator(doc.url)||quote.length<15||quote.length>3000||!normal(doc.text).includes(quote)||!recipientName(organisation)||!quote.toLowerCase().includes(organisation.toLowerCase()))continue;
  const type=Object.hasOwn(LICENCE_TYPES,item.type)?item.type:'unknown';if(!permissionTypes[type].test(quote))continue;
  const status=permissionStatus(quote,organisation),date=status==='authorised'||status==='registered'?exactDate(item.decisionDate,quote):null;
  const detected=grantedTypes(quote,organisation);if(status==='authorised'&&type!=='unknown'&&type!=='vasp'&&detected.length&&!detected.includes(type))continue;
  const types=status==='authorised'&&type!=='unknown'&&type!=='vasp'?(dualPermission(quote)?detected:[type]):[type];
  for(const found of types){const actual=found==='vasp'&&status==='authorised'?'needs_review':status;const value={type:found,organisation,authority:normal(quote).includes(normal(item.authority))?normal(item.authority).slice(0,200):'',status:actual,decisionDate:date,quote,url:doc.url,country:normal(quote).includes(normal(item.country))?normal(item.country).slice(0,100):'',notice:'Цитата официального источника; актуальность и объём разрешения проверьте в реестре. Лицензия не подтверждает бизнес-счёт или EU IBAN.'};if(!result.some(l=>l.organisation===organisation&&l.type===found&&l.url===doc.url))result.push(value);}
 }
 return result;
}
