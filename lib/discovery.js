import {REFERENCE_DOMAINS,REFERENCE_LIBRARY} from './references.js';
// Discovery of business-account services. Evidence flags are not licence verification.
export const DISCOVERY_VERSION = 2;
export const LEGACY_DISCOVERY_KEYWORDS = ['business account', 'IBAN account', 'multicurrency account', 'corporate account', 'business wallet', 'SEPA account', 'euro account', 'stablecoin business account'];
export const DISCOVERY_KEYWORDS = [...LEGACY_DISCOVERY_KEYWORDS, 'business banking', 'business bank', 'online business account', 'corporate banking', 'business IBAN', 'euro business account', 'international business account', 'neobank business'];
export const REFERENCE_APPS = [...new Set(['com.stablecom.app','com.kleos.baas','co.tide.tideplatform.eu','com.bankera.wallet','it.hype.business','com.wamo.business',...REFERENCE_LIBRARY.flatMap(e=>e.appIds)])];
export const REFERENCE_COUNTRIES = {'co.tide.tideplatform.eu':'DE','com.bankera.wallet':'AT','it.hype.business':'IT','com.wamo.business':'AT'};
export const REFERENCE_SITES = REFERENCE_DOMAINS;
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
  const referenceDiscovery=input.referenceDiscovery??false;
  if(typeof referenceDiscovery!=='boolean')throw new Error('Проверьте поиск по библиотеке образцов.');
  const profile=input.profile ?? 'strict';
  if (!['strict','business'].includes(profile)) throw new Error('Выберите профиль поиска.');
  const releaseMonths=input.releaseMonths ?? (profile==='business'?12:1);
  if (![1,3,6,12,24].includes(releaseMonths)) throw new Error('Период: 1, 3, 6, 12 или 24 месяца.');
  const referenceDomains=input.referenceDomains ?? (profile==='business'?REFERENCE_SITES:[]);
  if(!Array.isArray(referenceDomains)||referenceDomains.length>60||referenceDomains.some(d=>typeof d!=='string'||d.length>100||!/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(d)))throw new Error('Образцы сайтов: до 60 доменов без https и пути.');
  const seedApps=input.seedApps ?? (profile==='business'?REFERENCE_APPS:[]);
  if(!Array.isArray(seedApps)||seedApps.length>30||seedApps.some(s=>!parsePlayId(s))) throw new Error('До 30 ID приложений или ссылок Google Play, по одному на строку.');
  if(input.seedCountries!=null&&(typeof input.seedCountries!=='object'||Array.isArray(input.seedCountries)))throw new Error('Проверьте страны карточек образцов.');
  const seedCountries={...REFERENCE_COUNTRIES,...(input.seedCountries??{})};
  if(!seedCountries||typeof seedCountries!=='object'||Array.isArray(seedCountries)||Object.entries(seedCountries).some(([id,country])=>!validAppId(id)||typeof country!=='string'||! /^[A-Z]{2}$/.test(country)))throw new Error('Проверьте страны карточек образцов.');
  for(const raw of seedApps){try{const url=new URL(raw);const country=url.searchParams.get('gl')?.toUpperCase();if(country&&/^[A-Z]{2}$/.test(country))seedCountries[parsePlayId(raw)]=country;}catch{}}
  const euIbanMode=input.euIbanMode ?? 'prefer';
  if(!['prefer','required'].includes(euIbanMode))throw new Error('Проверьте режим EU IBAN.');
  const plan=input.plan ?? (profile==='business'?'balanced':'full');
  if(!['balanced','full'].includes(plan))throw new Error('План поиска: сбалансированный или полный.');
  const hideEstablished=input.hideEstablished ?? (profile==='business');
  const related=input.related ?? (profile==='business');
  const useWebIndex=input.useWebIndex ?? (profile==='business');
  if([hideEstablished,related,useWebIndex].some(x=>typeof x!=='boolean'))throw new Error('Проверьте дополнительные источники Google Play.');
  const maxDetails=input.maxDetails ?? (profile==='business'?1000:10000);
  if(!Number.isInteger(maxDetails)||maxDetails<1||maxDetails>10000)throw new Error('Лимит карточек: от 1 до 10000.');
  const developerExpansion=input.developerExpansion??(profile==='business');
  if(typeof developerExpansion!=='boolean')throw new Error('Проверьте поиск приложений разработчика.');
  return {referenceDiscovery,developerExpansion,seedCountries,profile,phoneCountry,releaseMonths,euIbanMode,referenceDomains:[...new Set(referenceDomains.map(d=>d.toLowerCase()))],seedApps:[...new Set(seedApps.map(parsePlayId))],plan,hideEstablished,related,useWebIndex,maxDetails};
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
// A mention of an account number is not an offer of an account.
const accountNoun=/\b(?:(?:multi.?currency|global|virtual|corporate|business|payment|euro|EUR|international|current|bank|IBAN)\s+){1,3}accounts?\b|\b(?:euro|dedicated|named|personal|business|corporate)\s+IBANs?\b|бизнес.сч[её]т|сч[её]т\w*\s+для\s+бизнес|geschäftskonto/iu;
const provision=/\b(?:open|apply for|create|get|receive|offer|provide|issue|hold|launch|introduce|unveil|sign up for)\w*\b.{0,80}\b(?:(?:your|our|own|an?|individual|personal|business|corporate|multi.?currency|euro|EUR|bank|payment|global|international|dedicated|named|virtual)\s+){0,5}(?:accounts?|IBANs?)\b|\b(?:our|your)\s+(?:(?:multi.?currency|corporate|business|Euro|EUR|dedicated|named|personal)\s+){1,3}(?:accounts?|IBANs?)\b|\baccounts?\s+(?:are\s+)?(?:available|provided|offered|issued)\b|откр\w*\s+(?:бизнес.)?сч[её]т|(?:votre|notre)\s+compte professionnel/iu;
const businessService=/\b(?:business|corporate|SME|company|commercial)\s+(?:(?:bank|banking|payment|euro|EUR|IBAN|multi.?currency|current|global)\s+){0,3}(?:accounts?|banking|bank|wallets?|payments?|IBANs?)\b|\b(?:for|serving|tailored for|designed for|built for)\b.{0,100}\b(?:business(?:es)?|companies|enterprises?|SMEs?|startups?)\b|\bKYB\b|бизнес.сч[её]т|сч[её]т\w*\s+для\s+(?:бизнес|компани)|geschäftskonto|compte professionnel|conto aziendale|cuenta de empresa|zakelijke rekening|konto firmowe/iu;
const utilityPattern=/\b(?:IBAN|BIC|SWIFT)\b.{0,40}\b(?:checker?|check.?digits?|checksum|checking|validator|validation|verifier|calculator|generator|lookup|finder)\b|\b(?:check(?:er)?|validat(?:e|or)|verif(?:y|ier)|calculat(?:e|or)|generat(?:e|or)|lookup|finder)\b.{0,40}\b(?:IBAN|BIC|SWIFT)\b|провер\w*\s+IBAN|IBAN.{0,20}провер/iu;
export function assessDiscovery(documents, config, banking, appId) {
  const lines=documents.flatMap(doc=>String(doc.text??'').replace(/<[^>]*>/g,' ').split(/\n+|(?<=[.!?])\s+/).map(text=>({text:text.trim(),url:doc.url,label:doc.label}))).filter(x=>x.text);
  const text=lines.map(x=>x.text).join(' ');
  const title=documents.find(d=>d.title)?.title??'';
  const positive=lines.filter(x=>!/\b(?:do not|does not|don't|doesn't|cannot|can't|without|no)\b.{0,30}\b(?:offer|provide|issue|business accounts?|bank accounts?)\b|не\s+(?:предостав|открыва)/iu.test(x.text));
  const live=positive.filter(x=>!/\b(?:will|plan to|planning to|coming soon|not yet|to be launched)\b/iu.test(x.text));
  const hasBusiness=live.some(x=>businessService.test(x.text)||/\baccount\s+for\s+(?:self.employed|sole propriet|freelanc|entrepreneur|professionals)/iu.test(x.text));
  const hasPayment=payments.test(text),hasEuro=euro.test(text);
  const hasIban=/\bIBAN\b/iu.test(text),hasSepa=/\bSEPA\b/iu.test(text);
  const declaredAccount=live.some(x=>/\bis\s+(?:the|an?|your)\s+(?:go.to\s+)?account\s+for\s+(?:self.employed|sole propriet|freelanc|business|companies|professionals)/iu.test(x.text));
  const ownsAccount=declaredAccount || live.some(x=>provision.test(x.text)) && (accountNoun.test(text)||hasIban);
  const fiatWallet=/\b(?:fiat|EUR|euro)\b/iu.test(text)&&/\bwallet\b/iu.test(text)&&/\b(?:payout|transfer|cards?|balances?|funds)\b/iu.test(text);
  const hasAccount=ownsAccount || accountNoun.test(text) || fiatWallet;
  const accountUtility=utilityPattern.test(title)||(utilityPattern.test(text.slice(0,500))&&!ownsAccount);
  const localRails=localOnly.test(text)&&!hasIban&&!hasSepa;
  const negativeText=lines.filter(x=>!/does not provide|do not offer|not provide|не предостав/iu.test(x.text)).map(x=>x.text).join(' ');
  const cryptoOnly=/\b(?:crypto|bitcoin|ethereum|web3|DEX)\b/iu.test(text)&&!/\b(?:IBAN|SEPA|SWIFT|fiat)\b/iu.test(text);
  const linkedOnly=/\b(?:connect|link|sync|import)\w*\s+(?:your\s+|existing\s+)?(?:bank\s+)?accounts?/iu.test(text)&&!ownsAccount&&!/\bKYB\b/iu.test(text);
  const budgetOnly=/expense tracker|budget(?: planner|ing)|net worth tracker|invoice (?:maker|generator)|bookkeeping app|update balances manually|record income and expenses|organizes accounts, expenses/iu.test(`${title} ${text}`)&&!ownsAccount;
  const rejection=accountUtility?'iban_utility':budgetOnly?'accounting_tool':unrelated.test(negativeText)?'unrelated_product':localRails?'local_payments':cryptoOnly?'crypto_only':linkedOnly?'linked_accounts':config.hideEstablished&&ESTABLISHED_APPS.includes(appId)?'established_app':null;
  const qualified=!rejection&&hasBusiness&&hasEuro&&(ownsAccount||(fiatWallet&&hasIban))&&(config.euIbanMode!=='required'||banking.evidence.euIban.length>0);
  const broadAccount=business.test(text)&&/\baccount(?:s| experience)?\b/iu.test(text)&&/multi.?currency|cross.border|international|fiat/iu.test(text);
  const candidate=!rejection&&!qualified&&hasPayment&&(hasAccount||broadAccount)&&(hasEuro||hasBusiness||broadAccount);
  const snippets={};
  for(const [key,pattern]of Object.entries({business:businessService,account:provision,iban:/\bIBAN\b/iu,sepa:/\bSEPA\b/iu,payments}))snippets[key]=lines.filter(x=>pattern.test(x.text)).slice(0,2).map(x=>({...x,text:x.text.slice(0,800)}));
  return {version:DISCOVERY_VERSION,status:qualified?'service_match':candidate?'needs_review':'not_relevant',isCandidate:candidate,rejection,accountProvision:ownsAccount?'mentioned':'unknown',
    business:hasBusiness?'mentioned':'unknown',iban:hasIban?'mentioned':'unknown',euIban:banking.evidence.euIban.length?'explicit_claim':'unknown',sepa:hasSepa?'mentioned':'unknown',
    licence:banking.evidence.licence.some(item=>/licensed|licenced|authori[sz]ed|regulated|licen[cs]e|лиценз/iu.test(item.text))?'claim_found':'unknown',businessAccountVerified:false,
    reason:accountUtility?'Утилита проверки, расчёта или поиска IBAN/BIC; не сервис открытия счёта':rejection?'Исключён по типу продукта или списку приложений':qualified?'Есть текстовое предложение счёта для бизнеса; условия и EU IBAN проверить':'Платёжный сервис или счёт; обслуживание бизнеса или выдачу счёта нужно уточнить',
    missing:[...(!hasBusiness?['business']:[]),...(!ownsAccount?['accountProvision']:[]),...(!banking.evidence.euIban.length?['euIban']:[]),...(!banking.evidence.licence.length?['licence']:[])],evidence:snippets};
}
export function discoveryPreset(countries) {
  return {profile:'business',keywords:DISCOVERY_KEYWORDS,countries,minInstalls:0,limit:250,releaseMonths:12,ignoreReleaseDate:false,strictBanking:false,institutionType:'bank_or_emi',excludeTerms:DISCOVERY_EXCLUSIONS,excludeAppIds:[],excludeDomains:[],...validateDiscovery({profile:'business'})};
}

export function cataloguePreset(countries){return {...discoveryPreset(countries),plan:'full',ignoreReleaseDate:true,maxDetails:1000,limit:250};}

export function rollingDates(today,months) {
  const [year,month,day]=today.split('-').map(Number);const start=new Date(Date.UTC(year,month-1-months,1));
  const last=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,0)).getUTCDate();start.setUTCDate(Math.min(day,last));
  return {from:start.toISOString().slice(0,10),to:today};
}

export function earlyPreset(countries){return {...cataloguePreset(countries),plan:'balanced',referenceDiscovery:true,minInstalls:0,ignoreReleaseDate:true};}
