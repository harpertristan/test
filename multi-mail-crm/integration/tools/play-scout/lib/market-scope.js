export const MARKET_SCOPE_VERSION=1;
export const DEFAULT_BLOCKED_JURISDICTIONS=['CN','HK','MO','AE','SA','QA','KW','BH','OM','EG','JO','LB','IQ','SY','YE','PS','DZ','MA','TN','LY','SD','SO','DJ','KM','MR','RU','BY','UA','KZ','KG','TJ','UZ','AM','AZ','MD','TM'];
const jurisdictions=[...[
 ['CN','Китай','cn','China|Chinese|中国|中华人民共和国'],['HK','Гонконг','hk','Hong Kong|Hongkong|香港'],['MO','Макао','mo','Macao|Macau|澳门|澳門'],
 ['AE','ОАЭ','ae','United Arab Emirates|UAE|Dubai|Abu Dhabi|الإمارات|دبي'],['SA','Саудовская Аравия','sa','Saudi Arabia|Saudi|السعودية'],['QA','Катар','qa','Qatar|قطر'],['KW','Кувейт','kw','Kuwait|الكويت'],['BH','Бахрейн','bh','Bahrain|البحرين'],['OM','Оман','om','Oman|عمان'],['EG','Египет','eg','Egypt|مصر'],['JO','Иордания','jo','Jordan|الأردن'],['LB','Ливан','lb','Lebanon|لبنان'],['IQ','Ирак','iq','Iraq|العراق'],['SY','Сирия','sy','Syria|سوريا'],['YE','Йемен','ye','Yemen|اليمن'],['PS','Палестина','ps','Palestin(?:e|ian)|فلسطين'],['DZ','Алжир','dz','Algeria|الجزائر'],['MA','Марокко','ma','Morocco|المغرب'],['TN','Тунис','tn','Tunisia|تونس'],['LY','Ливия','ly','Libya|ليبيا'],['SD','Судан','sd','Sudan|السودان'],['SO','Сомали','so','Somalia|الصومال'],['DJ','Джибути','dj','Djibouti|جيبوتي'],['KM','Коморы','km','Comoros'],['MR','Мавритания','mr','Mauritania'],['RO','Румыния','ro','Romania|Romanian|Румыни|România'],['SK','Словакия','sk','Slovakia|Slovak|Словаки|Slovensko'],['SI','Словения','si','Slovenia|Slovenian|Словени|Slovenija'],['RU','Россия','ru','Russia|Russian Federation|Росси[яию]'],['BY','Беларусь','by','Belarus|Беларусь|Беларуси|Белоруссия'],['UA','Украина','ua','Ukraine|Украин[аеуы]|Україн[аиі]'],['KZ','Казахстан','kz','Kazakhstan|Казахстан'],['KG','Кыргызстан','kg','Kyrgyzstan|Kyrgyz Republic|Кыргызстан|Киргизия'],['TJ','Таджикистан','tj','Tajikistan|Таджикистан'],['UZ','Узбекистан','uz','Uzbekistan|Узбекистан'],['AM','Армения','am','Armenia|Армени[яию]'],['AZ','Азербайджан','az','Azerbaijan|Азербайджан'],['MD','Молдова','md','Moldova|Moldovan|Молдов[аеуы]'],['TM','Туркменистан','tm','Turkmenistan|Туркменистан']
].map(([code,name,tld,names])=>({code,name,tld,identity:new RegExp(String.raw`(?<!\p{L})${code==='SD'?'(?<!South )(?<!Южный )(?<!جنوب )':''}(?:${names}|${name})(?!\p{L})`,'iu')}))];
export function validateMarketPolicy(input={}){
 const marketScope=input.marketScope??'eu_business',blocked=input.blockedJurisdictions??DEFAULT_BLOCKED_JURISDICTIONS;
 if(!['eu_business','worldwide'].includes(marketScope)||!Array.isArray(blocked)||blocked.some(code=>typeof code!=='string'||!jurisdictions.some(c=>c.code===code)))throw new Error('Проверьте рынок поиска и коды исключаемых юрисдикций.');
 return {marketScope,blockedJurisdictions:[...new Set(blocked)]};
}
export function marketPolicy(state){return validateMarketPolicy(state.crm?.settings?.marketPolicy??state.schedule?.filters??{});}
function providerLinks(entry,docs){
 const thirdParty=docs.some(d=>d.url===entry.url&&d.kind==='third_party'),article=/\/(?:blogs?|news|press|articles?|insights|reviews?|posts?|feed|forums?)(?:\/|$)/iu.test(String(entry.url));
 return [entry.developerWebsite,...(!thirdParty&&!article?[entry.url]:[])].flatMap(raw=>{try{const h=new URL(raw).hostname;return /(?:^|\.)(?:play.google.com|apps.apple.com)$/.test(h)?[]:[{url:raw,host:h}];}catch{return[];}});
}
export function providerJurisdictionClaim(line,identity){
 if(!identity.test(line))return false;
 // "Companies incorporated in Hong Kong" describes customers, not the
 // provider. Bind each location to its own role and grammatical subject.
 const roles=/(?<!\p{L})(?:headquarter\p{L}*|head office|registered office|incorporated|domicil\p{L}*|our company|our address|based in|built in|located in|established in|registered (?:in|under)|regulated by|licensed by|authori[sz]ed by|зарегистрирован\p{L}*|юридическ.{0,8}адрес|штаб.квартир)(?!\p{L})/giu;
 for(const match of line.matchAll(roles)){
  const after=line.slice(match.index,match.index+180),at=after.search(identity);if(at<0)continue;
  const before=line.slice(Math.max(0,match.index-100),match.index),relation=after.slice(0,at);
  if(/\b(?:customers?|clients?|companies|businesses|merchants?|applicants?|users?|your company|your business|their company)\b[^.!?;]{0,65}$/iu.test(before))continue;
  if(/\b(?:not|never)\b.{0,25}$/iu.test(before)||/\b(?:customers?|clients?|companies|businesses|eligible|residents|supports?|serves?|offers?|welcomes?|destinations?|banking partner|licensed partner|sponsor bank|provided by|powered by)\b/iu.test(relation))continue;
  if(/banking partner|licensed partner|sponsor bank|provided by|powered by|партн[её]р/iu.test(before))continue;
  return true;
 }
 return false;
}
function blockedJurisdiction(entry,text,docs,blocked){
 const rows=sentences(text),hosts=providerLinks(entry,docs);
 for(const c of jurisdictions.filter(c=>blocked.includes(c.code))){
  const domain=hosts.find(h=>h.host.endsWith('.'+c.tld));
  const address=String(entry.developerAddress??'');
  const statement=rows.find(line=>line.length<1600&&providerJurisdictionClaim(line,c.identity));
  if(domain||entry.developerCountry===c.code||c.identity.test(address)||statement)return{code:'excludedJurisdiction',country:c.code,market:c.name,basis:domain?'provider_domain':entry.developerCountry===c.code||c.identity.test(address)?'provider_country_or_address':'provider_identity_claim',text:domain?.url??statement??address,url:domain?.url??docs.find(d=>String(d.text).includes(statement))?.url??entry.url,reason:'Исключаемая юрисдикция провайдера: '+c.name+'. Европейский продукт не отменяет выбранное исключение.'};
 }
 return null;
}
const markets=[
 ...[
  ['KE','Кения','ke','Kenya|Kenyan','Central Bank of Kenya'],
  ['UG','Уганда','ug','Uganda|Ugandan','Bank of Uganda'],
  ['TZ','Танзания','tz','Tanzania|Tanzanian','Bank of Tanzania'],
  ['RW','Руанда','rw','Rwanda|Rwandan','National Bank of Rwanda'],
  ['SS','Южный Судан','ss','South Sudan|South Sudanese','Bank of South Sudan'],
  ['CD','ДР Конго','cd','Democratic Republic of (?:the )?Congo|DR Congo|DRC','Central Bank of (?:the )?Congo'],
  ['ZA','ЮАР','za','South Africa|South African','South African Reserve Bank']
 ].map(([code,name,tld,names,authority])=>({code,name,tld,identity:new RegExp(`(?<!\\p{L})(?:${names})(?!\\p{L})`,'iu'),claim:new RegExp(`${authority}|(?:${names}) (?:residents|domestic (?:banking|accounts?)|bank accounts?)`,'iu')})),
 {code:'MM',name:'Мьянма',tld:'mm',claim:/Central Bank of Myanmar|Myanmar (?:residents|bank accounts?)/iu},
 {code:'US',name:'США',tld:'us',claim:/US residents|U\.S\. residents|Social Security Number|(?<!\p{L})FDIC(?!\p{L})/iu},
 {code:'CN',name:'Китай',tld:'cn',claim:/People.s Bank of China|(?<!\p{L})PBOC(?!\p{L})|mainland China|Chinese residents|中国人民银行|境内居民/iu},
 {code:'HK',name:'Гонконг',tld:'hk',claim:/Hong Kong Monetary Authority|(?<!\p{L})HKMA(?!\p{L})|Hong Kong (?:residents|identity|bank accounts?)|(?<!\p{L})HKID(?!\p{L})|香港金融管理局|香港居民/iu},
 {code:'AE',name:'ОАЭ',tld:'ae',claim:/Central Bank of (?:the )?UAE|Central Bank of (?:the )?United Arab Emirates|Emirates ID|\b(?:UAE|Emirati) (?:residents|nationals|bank accounts?|IBAN)|مصرف الإمارات المركزي|الهوية الإماراتية/iu},
 {code:'SA',name:'Саудовская Аравия',tld:'sa',claim:/Saudi Central Bank|Saudi Arabian Monetary|(?<!\p{L})SAMA(?!\p{L})|Saudi (?:residents|nationals|bank accounts?|IBAN)|البنك المركزي السعودي/iu},
 {code:'QA',name:'Катар',tld:'qa',claim:/Qatar Central Bank|Qatari? (?:residents|bank accounts?|IBAN)|مصرف قطر المركزي/iu},
 {code:'KW',name:'Кувейт',tld:'kw',claim:/Central Bank of Kuwait|Kuwaiti? (?:residents|bank accounts?|IBAN)|بنك الكويت المركزي/iu},
 {code:'BH',name:'Бахрейн',tld:'bh',claim:/Central Bank of Bahrain|Bahraini? (?:residents|bank accounts?|IBAN)/iu},
 {code:'OM',name:'Оман',tld:'om',claim:/Central Bank of Oman|Omani (?:residents|bank accounts?|IBAN)/iu},
 {code:'EG',name:'Египет',tld:'eg',claim:/Central Bank of Egypt|Egyptian (?:residents|bank accounts?|IBAN)/iu},
 {code:'JO',name:'Иордания',tld:'jo',claim:/Central Bank of Jordan|Jordanian (?:residents|bank accounts?|IBAN)/iu},
 {code:'JP',name:'Япония',tld:'jp',claim:/Japanese residents|Japan(?:ese)? (?:domestic|bank accounts?)|全銀|円普通預金/iu},
 {code:'TW',name:'Тайвань',tld:'tw',claim:/Taiwan(?:ese)? (?:residents|bank accounts?)/iu},
 {code:'IN',name:'Индия',tld:'in',claim:/Reserve Bank of India|\b(?:UPI|IFSC|Aadhaar)\b|Indian (?:citizens|residents)/iu},
 {code:'PK',name:'Пакистан',tld:'pk',claim:/State Bank of Pakistan|\b(?:CNIC|Raast)\b|Pakistani (?:residents|bank accounts?)/iu},
 {code:'BD',name:'Бангладеш',tld:'bd',claim:/Bangladesh Bank|\b(?:bKash|Nagad)\b/iu},
 {code:'ID',name:'Индонезия',tld:'id',claim:/Bank Indonesia/iu},
 {code:'BR',name:'Бразилия',tld:'br',claim:/Banco Central do Brasil|\b(?:CPF|CNPJ)\b/iu},
];
const sentences=text=>String(text).replace(/&#x27;|&#39;/g,"'").split(/\n+|(?<=[.!?;])\s+/u).map(s=>s.trim()).filter(Boolean);
const account=/\b(?:business|corporate|payment|multi.?currency|global|EUR|euro) accounts?|(?<!\p{L})IBAN(?!\p{L})|business banking|banking.as.a.service|сч[её]т.{0,20}бизнес|企业.{0,15}(?:账户|戶口)|حساب.{0,20}(?:أعمال|شركات)/iu;
const eu=/\b(?:SEPA|EU|EEA|Europe(?:an)?|German|Lithuanian|French|Irish|Dutch|Spanish|Italian|Polish)\b|欧盟|欧元|европ|евро/iu;
const recipient=/\b(?:send|transfer|pay|remit).{0,65}\b(?:to|destinations?|beneficiar|recipients?)\b|\bcash out\b|\bconvert(?:ed|s|ing)? to\b|travel|holiday|spend abroad|supported destinations|send money to|payment destinations/iu;
export function europeanProductLead(text){
 const lines=sentences(text);
 const explanatory=line=>/\bIBAN (?:consists|stands for)|\b(?:countries|banks) use IBAN|\bIBAN (?:account )?formats?\b/iu.test(line);
 return lines.some((line,i)=>!explanatory(line)&&account.test(line)&&eu.test(line)&&!recipient.test(line)&&!/\b(?:no|without) (?:EU|European|EUR|euro) (?:IBAN|accounts?)/iu.test(line))||lines.some((line,i)=>!explanatory(line)&&!explanatory(lines[i+1]??'')&&account.test(line)&&/\b(?:open|offer|provide|receive|issue|our|your)\b/iu.test(line)&&eu.test(lines[i+1]??'')&&!recipient.test(lines[i+1]??''));
}
export function regulatedPaymentLead(text){return /\b(?:electronic.money institution|e.money institution|payment institution)\b/iu.test(text)&&/\b(?:authori[sz]ed|licensed|regulated|agent of|issuing|provision of payment|money transmission)\b/iu.test(text)&&!/\b(?:save|invest|rounding|round.up)\b.{0,45}\b(?:Bitcoin|BTC)\b/iu.test(text);}
export function nonTargetMarketEvidence(entry={},policy={}){
 const {marketScope:scope,blockedJurisdictions}=validateMarketPolicy(typeof policy==='string'?{marketScope:policy}:policy);
 const docs=entry.documents?.length?entry.documents:entry.sourceDocuments??[],text=[entry.title,entry.developerAddress,docs.length?docs.map(d=>d.text).join('\n'):entry.screeningText??entry.snippet??''].filter(Boolean).join('\n');
 const blocked=blockedJurisdiction(entry,text,docs,blockedJurisdictions);if(blocked)return blocked;if(scope==='worldwide')return null;
 // Product claims can retain an international provider as a lead. They do not
 // establish an EU IBAN: that still requires the separate quote validator.
 if(europeanProductLead(text))return null;
 const hosts=providerLinks(entry,docs);
 // A provider's own domain/address takes priority over another country
 // mentioned in a group-company disclosure or a regional service description.
 const ownIdentity=market=>hosts.some(h=>h.host.endsWith('.'+market.tld))||entry.developerCountry===market.code||market.identity?.test(String(entry.developerAddress??''));
 for(const market of [...markets.filter(ownIdentity),...markets.filter(m=>!ownIdentity(m))]){
  const identity=hosts.find(h=>h.host.endsWith('.'+market.tld));
  const address=market.identity?.test(String(entry.developerAddress??''));
  const statement=sentences(text).find(s=>{
   if(s.length>=1200||recipient.test(s)||/banking partner|licensed partner|sponsor bank|provided by|powered by/iu.test(s)||/\b(?:not|no|never)\b.{0,30}\bFDIC\b/iu.test(s))return false;
   const identityClaim=market.identity&&(providerJurisdictionClaim(s,market.identity)||market.identity.test(s)&&/banking (?:services )?(?:in|across)|bank (?:operates|operating) in/iu.test(s));
   return (market.claim.test(s)||identityClaim)&&!/(?:supported|available|currencies|destinations|countries).{0,120}(?:,|;)/iu.test(s)&&!/(?:Afghanistan.{0,50}Albania|Albania.{0,50}Algeria)/iu.test(s);
  });
  if(identity||entry.developerCountry===market.code||address||statement)return{code:'outsideTargetMarket',country:market.code,market:market.name,basis:identity?'provider_domain':entry.developerCountry===market.code||address?'provider_country_or_address':'local_product_claim',text:identity?.url??statement?.slice(0,500)??(address?entry.developerAddress:market.code),url:identity?.url??docs.find(d=>String(d.text).includes(statement))?.url??entry.url,reason:`Локальный продукт рынка «${market.name}»: предложение бизнес-счёта / IBAN для Европы не найдено в сохранённом описании.`};
 }
 return null;
}
