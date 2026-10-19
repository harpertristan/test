// Discovery of business-account services. Evidence flags are not licence verification.
export const DISCOVERY_VERSION = 1;
export const DISCOVERY_KEYWORDS = ['business account', 'IBAN account', 'multicurrency account', 'corporate account', 'business wallet', 'SEPA account', 'euro account', 'stablecoin business account'];
export const REFERENCE_APPS = ['com.stablecom.app', 'com.kleos.baas'];
export const REFERENCE_SITES = ['lurrapay.com', 'rampy.money', 'stable.com', 'photonpay.com'];
export const DISCOVERY_EXCLUSIONS = ['credit score checker', 'loan calculator', 'insurance quotes', 'sports betting', 'казино', 'кредитный калькулятор'];
export const ESTABLISHED_APPS = ['com.revolut.revolut','com.revolut.business','com.transferwise.android','com.paypal.android.p2pmobile','com.payoneer.android','com.bunq.android','de.number26.android','co.uk.getmondo','com.starlingbank.android','com.myklarnamobile'];
const PRIMARY_COUNTRIES = ['DE','LT','IE','NL','FR','ES'];
export const NATIVE_QUERIES = { DE:['Geschäftskonto','de'], FR:['compte professionnel','fr'], ES:['cuenta de empresa','es'], NL:['zakelijke rekening','nl'], IT:['conto aziendale','it'], PL:['konto firmowe','pl'] };
export function validAppId(value) { return typeof value === 'string' && value.length <= 150 && /^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)+$/.test(value); }
export function parsePlayId(value) {
  if (validAppId(value)) return value;
  try { const u = new URL(value); const id=u.searchParams.get('id'); return u.protocol==='https:' && u.hostname==='play.google.com' && u.pathname==='/store/apps/details' && !u.username && !u.password && validAppId(id) ? id : null; } catch { return null; }
}
export function validateDiscovery(input = {}) {
  if(input.phoneCountry!=null && typeof input.phoneCountry!=='string')throw new Error('Страна аккаунта: код из двух букв.');
  const phoneCountry=(input.phoneCountry ?? '').toUpperCase();
  if(phoneCountry && !/^[A-Z]{2}$/.test(phoneCountry))throw new Error('Страна аккаунта Google Play: код из двух латинских букв, например RU, DE или GB.');
  const profile=input.profile ?? 'strict';
  if (!['strict','business'].includes(profile)) throw new Error('Выберите профиль поиска.');
  const releaseMonths=input.releaseMonths ?? (profile==='business'?12:1);
  if (![1,3,6,12,24].includes(releaseMonths)) throw new Error('Период: 1, 3, 6, 12 или 24 месяца.');
  const referenceDomains=input.referenceDomains ?? (profile==='business'?REFERENCE_SITES:[]);
  if(!Array.isArray(referenceDomains)||referenceDomains.length>10||referenceDomains.some(d=>typeof d!=='string'||d.length>100||!/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(d)))throw new Error('Образцы сайтов: до 10 доменов без https и пути.');
  const seedApps=input.seedApps ?? (profile==='business'?REFERENCE_APPS:[]);
  if(!Array.isArray(seedApps)||seedApps.length>12||seedApps.some(s=>!parsePlayId(s))) throw new Error('До 12 ID приложений или ссылок Google Play, по одному на строку.');
  const euIbanMode=input.euIbanMode ?? 'prefer';
  if(!['prefer','required'].includes(euIbanMode))throw new Error('Проверьте режим EU IBAN.');
  const plan=input.plan ?? (profile==='business'?'balanced':'full');
  if(!['balanced','full'].includes(plan))throw new Error('План поиска: сбалансированный или полный.');
  const hideEstablished=input.hideEstablished ?? (profile==='business');
  const related=input.related ?? false;
  const useWebIndex=input.useWebIndex ?? (profile==='business');
  if([hideEstablished,related,useWebIndex].some(x=>typeof x!=='boolean'))throw new Error('Проверьте дополнительные источники Google Play.');
  const maxDetails=input.maxDetails ?? (profile==='business'?300:10000);
  if(!Number.isInteger(maxDetails)||maxDetails<1||maxDetails>10000)throw new Error('Лимит карточек: от 1 до 10000.');
  return {profile,phoneCountry,releaseMonths,euIbanMode,referenceDomains:[...new Set(referenceDomains.map(d=>d.toLowerCase()))],seedApps:[...new Set(seedApps.map(parsePlayId))],plan,hideEstablished,related,useWebIndex,maxDetails};
}
export function queryLanguage(term) {
  if (/[а-яё]/iu.test(term))return 'ru';
  if(/geschäft|geschäftskonto/iu.test(term))return 'de';
  if(/compte|entreprise|professionnel/iu.test(term))return 'fr';
  if(/cuenta|empresa/iu.test(term))return 'es';
  if(/zakelijk|rekening/iu.test(term))return 'nl';
  if(/conto|aziendale/iu.test(term))return 'it';
  if(/konto|firmowe/iu.test(term))return 'pl';
  return 'en';
}
export function searchPlan(config) {
  const queries=[];
  for (const country of config.countries) {
    const words=config.profile==='business' && config.plan==='balanced' && !PRIMARY_COUNTRIES.includes(country) ? config.keywords.slice(0,2) : config.keywords;
    for(const keyword of words) queries.push({country,keyword,lang:queryLanguage(keyword)});
    if(config.profile==='business' && NATIVE_QUERIES[country]) {const [keyword,lang]=NATIVE_QUERIES[country];queries.push({country,keyword,lang});}
  }
  if(config.profile==='business' && config.phoneCountry && !config.countries.includes(config.phoneCountry)) {for(const keyword of config.keywords)queries.push({country:config.phoneCountry,keyword,lang:queryLanguage(keyword)});if(config.phoneCountry==='RU')queries.push({country:'RU',keyword:'бизнес счет',lang:'ru'});}
  return queries;
}
export function relatedIds(html, ownId) {
  const text=String(html).replace(/\\u003d/gi,'=').replace(/&amp;/g,'&');
  const ids=[...text.matchAll(/\/store\/apps\/details\?id=([a-zA-Z0-9._]+)/g)].map(match=>match[1]);
  return [...new Set(ids.filter(id=>id!==ownId&&validAppId(id)))].slice(0,30).map(appId=>({appId}));
}
const business=/\b(?:business(?:es)?|corporate|enterprises?|startups?|SMEs?|KYB)\b|(?:accounts? for|designed for|built for|serving) (?:companies|company|freelancers)|бизнес|компани|предприним|geschäft|professionnel|aziendale|firmowe/iu;
const account=/\b(?:(?:multi.?currency|global|virtual|corporate|business|payment|euro|EUR|international|current|bank|IBAN)\s+accounts?|accounts?\s+(?:for|designed|built))\b|IBAN|SEPA|бизнес.сч[её]т|мультивалют|евро.?сч[её]т/iu;
const payments=/\b(?:cards?|payouts?|payments?|transfers?|FX|wallet|on.?ramp|off.?ramp)\b|плат[её]ж|перевод|карт[аыу]|кошел[её]к/iu;
const euro=/\b(?:EUR|EU|Europe|European|SEPA|Euro|IBAN|Germany|Lithuania|Ireland|France|Netherlands|Spain)\b|европ|евро|IBAN/iu;
const localOnly=/\b(?:UPI|IFSC|easypaisa|JazzCash|bKash|Nagad)\b/iu;
const unrelated=/\b(?:payday loans?|credit score|loan calculator|insurance quotes|betting|casino)\b|кредитный калькулятор|казино/iu;
export function assessDiscovery(documents, config, banking, appId) {
  const lines=documents.flatMap(doc=>String(doc.text??'').replace(/<[^>]*>/g,' ').split(/\n+|(?<=[.!?])\s+/).map(text=>({text:text.trim(),url:doc.url,label:doc.label}))).filter(x=>x.text);
  const text=lines.map(x=>x.text).join(' ');
  const hasBusiness=business.test(text);
  const hasAccount=account.test(text) || (hasBusiness && /\bfiat\b/iu.test(text) && /\bwallet\b/iu.test(text));
  const hasPayment=payments.test(text);
  const hasEuro=euro.test(text);
  const hasIban=/\bIBAN\b/iu.test(text),hasSepa=/\bSEPA\b/iu.test(text);
  const localRails=localOnly.test(text) && !(/\bIBAN\b|\bSEPA\b/iu.test(text));
  const negativeText=lines.filter(x=>!/does not provide|do not offer|not provide|не предостав/iu.test(x.text)).map(x=>x.text).join(' ');
  const cryptoOnly=/\b(?:crypto|bitcoin|ethereum|web3|DEX)\b/iu.test(text)&&!/\b(?:IBAN|SEPA|SWIFT|fiat)\b/iu.test(text);
  const linkedOnly=/\b(?:connect|link|sync|import)\w*\s+(?:your\s+|existing\s+)?(?:bank\s+)?accounts?/iu.test(text)&&!/\b(?:open|get|create|issue)\w*\s+(?:your\s+|an?\s+)?(?:business\s+|corporate\s+|bank\s+)?accounts?|\bKYB\b/iu.test(text);
  const budgetOnly=/expense tracker|track your (?:net worth|money)|update balances manually|record income and expenses|organizes accounts, expenses/iu.test(text)&&!/\bIBAN\b|\bSEPA\b|\bKYB\b/iu.test(text);
  const rejected=budgetOnly||unrelated.test(negativeText)||localRails||cryptoOnly||linkedOnly||(config.hideEstablished&&ESTABLISHED_APPS.includes(appId));
  const qualified=!rejected&&hasBusiness&&hasAccount&&hasEuro&&(config.euIbanMode!=='required'||banking.evidence.euIban.length>0);
  const candidate=!rejected&&!qualified&&hasAccount&&(hasPayment||hasBusiness)&&(hasEuro||hasBusiness);
  const snippets={};
  for(const [key,pattern] of Object.entries({business,account,iban:/\bIBAN\b/iu,sepa:/\bSEPA\b/iu,payments}))snippets[key]=lines.filter(x=>pattern.test(x.text)).slice(0,2).map(x=>({...x,text:x.text.slice(0,800)}));
  return {version:DISCOVERY_VERSION,status:qualified?'service_match':candidate?'needs_review':'not_relevant',isCandidate:candidate,
    business:hasBusiness?'mentioned':'unknown',iban:hasIban?'mentioned':'unknown',euIban:banking.evidence.euIban.length?'explicit_claim':'unknown',sepa:hasSepa?'mentioned':'unknown',
    licence:banking.evidence.licence.some(item=>/licensed|licenced|authori[sz]ed|regulated|licen[cs]e|лиценз/iu.test(item.text))?'claim_found':'unknown',businessAccountVerified:false,
    reason:rejected?'Исключён по типу сервиса или списку известных приложений':qualified?'Бизнес-счета / финансовые операции для компаний':'Финансовый сервис с IBAN/EUR; бизнес-обслуживание нужно проверить',
    missing:[...(!hasBusiness?['business']:[]),...(!banking.evidence.euIban.length?['euIban']:[]),...(!banking.evidence.licence.length?['licence']:[])],evidence:snippets};
}
export function discoveryPreset(countries) {
  return {profile:'business',keywords:DISCOVERY_KEYWORDS,countries,minInstalls:0,limit:100,releaseMonths:12,ignoreReleaseDate:false,strictBanking:false,institutionType:'bank_or_emi',excludeTerms:DISCOVERY_EXCLUSIONS,excludeAppIds:[],excludeDomains:[],...validateDiscovery({profile:'business'})};
}

export function rollingDates(today,months) {
  const [year,month,day]=today.split('-').map(Number);const start=new Date(Date.UTC(year,month-1-months,1));
  const last=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,0)).getUTCDate();start.setUTCDate(Math.min(day,last));
  return {from:start.toISOString().slice(0,10),to:today};
}
