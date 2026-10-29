export const MARKET_SCOPE_VERSION=1;
export const DEFAULT_BLOCKED_JURISDICTIONS=['CN','HK','MO','AE','SA','QA','KW','BH','OM','EG','JO','LB','IQ','SY','YE','PS','DZ','MA','TN','LY','SD','SO','DJ','KM','MR','RU','BY','UA','KZ','KG','TJ','UZ','AM','AZ','MD','TM'];
const jurisdictions=[...[
 ['CN','Китай','cn','China|Chinese|中国|中华人民共和国'],['HK','Гонконг','hk','Hong Kong|Hongkong|香港'],['MO','Макао','mo','Macao|Macau|澳门|澳門'],
 ['AE','ОАЭ','ae','United Arab Emirates|UAE|Dubai|Abu Dhabi|الإمارات|دبي'],['SA','Саудовская Аравия','sa','Saudi Arabia|Saudi|السعودية'],['QA','Катар','qa','Qatar|قطر'],['KW','Кувейт','kw','Kuwait|الكويت'],['BH','Бахрейн','bh','Bahrain|البحرين'],['OM','Оман','om','Oman|عمان'],['EG','Египет','eg','Egypt|مصر'],['JO','Иордания','jo','Jordan|الأردن'],['LB','Ливан','lb','Lebanon|لبنان'],['IQ','Ирак','iq','Iraq|العراق'],['SY','Сирия','sy','Syria|سوريا'],['YE','Йемен','ye','Yemen|اليمن'],['PS','Палестина','ps','Palestin(?:e|ian)|فلسطين'],['DZ','Алжир','dz','Algeria|الجزائر'],['MA','Марокко','ma','Morocco|المغرب'],['TN','Тунис','tn','Tunisia|تونس'],['LY','Ливия','ly','Libya|ليبيا'],['SD','Судан','sd','Sudan|السودان'],['SO','Сомали','so','Somalia|الصومال'],['DJ','Джибути','dj','Djibouti|جيبوتي'],['KM','Коморы','km','Comoros'],['MR','Мавритания','mr','Mauritania'],['RO','Румыния','ro','Romania|Romanian|Румыни|România'],['SK','Словакия','sk','Slovakia|Slovak|Словаки|Slovensko'],['SI','Словения','si','Slovenia|Slovenian|Словени|Slovenija'],['RU','Россия','ru','Russia|Russian Federation|Росси[яию]'],['BY','Беларусь','by','Belarus|Беларусь|Беларуси|Белоруссия'],['UA','Украина','ua','Ukraine|Украин[аеуы]|Україн[аиі]'],['KZ','Казахстан','kz','Kazakhstan|Казахстан'],['KG','Кыргызстан','kg','Kyrgyzstan|Kyrgyz Republic|Кыргызстан|Киргизия'],['TJ','Таджикистан','tj','Tajikistan|Таджикистан'],['UZ','Узбекистан','uz','Uzbekistan|Узбекистан'],['AM','Армения','am','Armenia|Армени[яию]'],['AZ','Азербайджан','az','Azerbaijan|Азербайджан'],['MD','Молдова','md','Moldova|Moldovan|Молдов[аеуы]'],['TM','Туркменистан','tm','Turkmenistan|Туркменистан']
].map(([code,name,tld,names])=>({code,name,tld,identity:new RegExp(String.raw`(?<!\p{L})(?:${names}|${name})(?!\p{L})`,'iu')}))];
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
function blockedJurisdiction(entry,text,docs,blocked){
 const rows=sentences(text),hosts=providerLinks(entry,docs);
 for(const c of jurisdictions.filter(c=>blocked.includes(c.code))){
  const domain=hosts.find(h=>h.host.endsWith('.'+c.tld));
  const address=String(entry.developerAddress??'');
  const statement=rows.find(line=>line.length<1600&&c.identity.test(line)&&(/(?:headquarter|head office|registered office|incorporated|domicil|our company|our address|based in|established in|registered (?:in|under)|regulated by|licensed by|authori[sz]ed by|зарегистрирован|юридическ.{0,8}адрес|штаб.квартир)/iu.test(line))&&!/(?:customers?|clients?|for (?:companies|businesses)|eligible|residents|supported|destinations|send money to|travel to|banking partner|licensed partner|sponsor bank|provided by|powered by|для компан|клиент|не зарегистрирован|not (?:based|registered|incorporated))/iu.test(line));
  if(domain||entry.developerCountry===c.code||c.identity.test(address)||statement)return{code:'excludedJurisdiction',country:c.code,market:c.name,basis:domain?'provider_domain':entry.developerCountry===c.code||c.identity.test(address)?'provider_country_or_address':'provider_identity_claim',text:domain?.url??statement??address,url:domain?.url??docs.find(d=>String(d.text).includes(statement))?.url??entry.url,reason:'Исключаемая юрисдикция провайдера: '+c.name+'. Европейский продукт не отменяет выбранное исключение.'};
 }
 return null;
}
const markets=[
 {code:'MM',name:'Мьянма',tld:'mm',claim:/Central Bank of Myanmar|Myanmar (?:residents|bank accounts?)|(?<!\p{L})MMK(?!\p{L})/iu},
 {code:'US',name:'США',tld:'us',claim:/US residents|U\.S\. residents|Social Security Number|(?<!\p{L})FDIC(?!\p{L})/iu},
 {code:'CN',name:'Китай',tld:'cn',claim:/People.s Bank of China|(?<!\p{L})PBOC(?!\p{L})|mainland China|Chinese residents|(?<!\p{L})CNY(?!\p{L})|(?<!\p{L})RMB(?!\p{L})|中国人民银行|人民币|境内居民/iu},
 {code:'HK',name:'Гонконг',tld:'hk',claim:/Hong Kong Monetary Authority|(?<!\p{L})HKMA(?!\p{L})|Hong Kong (?:residents|identity|bank accounts?)|(?<!\p{L})HKID(?!\p{L})|(?<!\p{L})HKD(?!\p{L})|香港金融管理局|香港居民/iu},
 {code:'AE',name:'ОАЭ',tld:'ae',claim:/Central Bank of (?:the )?UAE|Central Bank of (?:the )?United Arab Emirates|Emirates ID|\b(?:UAE|Emirati) (?:residents|nationals|bank accounts?|IBAN)|(?<!\p{L})AED(?!\p{L})|مصرف الإمارات المركزي|الهوية الإماراتية/iu},
 {code:'SA',name:'Саудовская Аравия',tld:'sa',claim:/Saudi Central Bank|Saudi Arabian Monetary|(?<!\p{L})SAMA(?!\p{L})|Saudi (?:residents|nationals|bank accounts?|IBAN)|(?<!\p{L})SAR(?!\p{L})|البنك المركزي السعودي/iu},
 {code:'QA',name:'Катар',tld:'qa',claim:/Qatar Central Bank|Qatari? (?:residents|bank accounts?|IBAN)|(?<!\p{L})QAR(?!\p{L})|مصرف قطر المركزي/iu},
 {code:'KW',name:'Кувейт',tld:'kw',claim:/Central Bank of Kuwait|Kuwaiti? (?:residents|bank accounts?|IBAN)|(?<!\p{L})KWD(?!\p{L})|بنك الكويت المركزي/iu},
 {code:'BH',name:'Бахрейн',tld:'bh',claim:/Central Bank of Bahrain|Bahraini? (?:residents|bank accounts?|IBAN)|(?<!\p{L})BHD(?!\p{L})/iu},
 {code:'OM',name:'Оман',tld:'om',claim:/Central Bank of Oman|Omani (?:residents|bank accounts?|IBAN)|(?<!\p{L})OMR(?!\p{L})/iu},
 {code:'EG',name:'Египет',tld:'eg',claim:/Central Bank of Egypt|Egyptian (?:residents|bank accounts?|IBAN)|(?<!\p{L})EGP(?!\p{L})/iu},
 {code:'JO',name:'Иордания',tld:'jo',claim:/Central Bank of Jordan|Jordanian (?:residents|bank accounts?|IBAN)|(?<!\p{L})JOD(?!\p{L})/iu},
 {code:'JP',name:'Япония',tld:'jp',claim:/Japanese residents|Japan(?:ese)? (?:domestic|bank accounts?)|(?<!\p{L})JPY(?!\p{L})|全銀|円普通預金/iu},
 {code:'TW',name:'Тайвань',tld:'tw',claim:/Taiwan(?:ese)? (?:residents|bank accounts?)|(?<!\p{L})TWD(?!\p{L})|新臺幣/iu},
 {code:'IN',name:'Индия',tld:'in',claim:/Reserve Bank of India|\b(?:UPI|IFSC|Aadhaar|INR)\b|Indian (?:citizens|residents)/iu},
 {code:'PK',name:'Пакистан',tld:'pk',claim:/State Bank of Pakistan|\b(?:CNIC|PKR|Raast)\b|Pakistani (?:residents|bank accounts?)/iu},
 {code:'BD',name:'Бангладеш',tld:'bd',claim:/Bangladesh Bank|\b(?:bKash|Nagad|BDT)\b/iu},
 {code:'ID',name:'Индонезия',tld:'id',claim:/Bank Indonesia|\b(?:IDR|rupiah)\b/iu},
 {code:'BR',name:'Бразилия',tld:'br',claim:/Banco Central do Brasil|\b(?:BRL|CPF|CNPJ)\b/iu},
];
const sentences=text=>String(text).replace(/&#x27;|&#39;/g,"'").split(/\n+|(?<=[.!?;])\s+/u).map(s=>s.trim()).filter(Boolean);
const account=/\b(?:business|corporate|payment|multi.?currency|global|EUR|euro) accounts?|(?<!\p{L})IBAN(?!\p{L})|business banking|banking.as.a.service|сч[её]т.{0,20}бизнес|企业.{0,15}(?:账户|戶口)|حساب.{0,20}(?:أعمال|شركات)/iu;
const eu=/\b(?:SEPA|EU|EEA|Europe(?:an)?|German|Lithuanian|French|Irish|Dutch|Spanish|Italian|Polish)\b|欧盟|欧元|европ|евро/iu;
const recipient=/\b(?:send|transfer|pay|remit).{0,65}\b(?:to|destinations?|beneficiar|recipients?)\b|travel|holiday|spend abroad|supported destinations|send money to|payment destinations/iu;
export function europeanProductLead(text){
 const lines=sentences(text);
 return lines.some((line,i)=>account.test(line)&&eu.test(line)&&!recipient.test(line)&&!/\b(?:no|without) (?:EU|European|EUR|euro) (?:IBAN|accounts?)/iu.test(line))||lines.some((line,i)=>account.test(line)&&/\b(?:open|offer|provide|receive|issue|our|your)\b/iu.test(line)&&eu.test(lines[i+1]??'')&&!recipient.test(lines[i+1]??''));
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
 for(const market of markets){
  const identity=hosts.find(h=>h.host.endsWith('.'+market.tld));
  const statement=sentences(text).find(s=>s.length<1200&&market.claim.test(s)&&!/(?:supported|available|currencies|destinations|countries).{0,120}(?:,|;)/iu.test(s)&&!/(?:Afghanistan.{0,50}Albania|Albania.{0,50}Algeria)/iu.test(s));
  if(identity||entry.developerCountry===market.code||statement)return{code:'outsideTargetMarket',country:market.code,market:market.name,basis:identity?'provider_domain':entry.developerCountry===market.code?'provider_country':'local_product_claim',text:identity?.url??statement?.slice(0,500)??market.code,url:identity?.url??docs.find(d=>String(d.text).includes(statement))?.url??entry.url,reason:`Локальный продукт рынка «${market.name}»: предложение бизнес-счёта / IBAN для Европы не найдено в сохранённом описании.`};
 }
 return null;
}
