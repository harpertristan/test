// Text evidence is a screening aid, never a regulator or account-opening guarantee.
export const CRITERIA_VERSION = 2;
export const DEFAULT_EXCLUDE_TERMS = ["UPI", "IFSC", "India", "Pakistan", "Belarus", "Indonesia", "Индия", "Пакистан", "Беларусь", "Индонезия"];
export const EU_IBAN_CODES = ["AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE"];
const EU_NAMES = 'EU|European Union|евросоюз[а-я]*|ЕС|Austria[n]*|Belgian?|Belgium|Bulgaria[n]*|Croatia[n]*|Cypriot|Cyprus|Czech|Danish|Denmark|Estonia[n]*|Finnish|Finland|French|France|German[y]?|Greek|Greece|Hungar(?:y|ian)|Irish|Ireland|Italian?|Italy|Latvia[n]*|Lithuania[n]*|Luxembourg|Maltese|Malta|Dutch|Netherlands|Polish|Poland|Portuguese|Portugal|Romania[n]*|Slovak(?:ia)?|Slovenia[n]*|Spanish|Spain|Swedish|Sweden|немецк[а-я]*|герман[а-я]*|француз[а-я]*|литов[а-я]*|ирланд[а-я]*';
const country = `(?:${EU_NAMES}|${EU_IBAN_CODES.join('|')})`;
const ibanPattern = new RegExp(`(?:\\b${country}\\s+(?:(?:business|bank|account|personal|dedicated|local)\\s+){0,2}IBAN\\b|\\bIBAN(?:s)?\\s+(?:(?:in|from|for|with|of|issued in|начинается с|страны|в)\\s+)?${country}\\b|\\b(?:${EU_IBAN_CODES.join('|')})\\d{2}[A-Z0-9]{8,30}\\b)`, 'iu');
const businessPattern = /\b(?:business|corporate|SME|company|freelancer)\s+(?:(?:bank|current|payment|banking|multi.currency)\s+){0,2}accounts?\b|\baccounts?\s+for\s+(?:business|companies|SMEs|freelancers)\b|бизнес[ -]сч[её]т|сч[её]т\w*\s+для\s+(?:бизнес|компани|ИП)|Geschäftskonto|compte professionnel|compte entreprise|conto aziendale|cuenta de empresa/iu;
const licencePattern = /\b(?:licensed|licenced|authori[sz]ed|regulated)\s+(?:as\s+(?:a\s+)?)?(?:(?:European|EU|fully|credit|commercial|digital)\s+){0,2}bank\b|\b(?:holds?|has|with|under|granted|received|obtained)\s+(?:a\s+|an\s+)?(?:(?:full|European|EU|German|Lithuanian|Irish|banking)\s+){0,2}banking\s+licen[cs]e\b|банковск[а-я]*\s+лицензи[а-я]*|лицензированн[а-я]*\s+банк/iu;
const emiPattern = /\b(?:electronic money institution|e.money institution|payment institution|EMI)\b|плат[её]жн[а-я]*\s+организаци/iu;
const denyPattern = /\b(?:no|not|without|cannot|can't|doesn't|don't|unavailable|unsupported|not yet|coming soon|plan to|planning|will offer|will provide)\b|не\s+(?:банк|предостав|открыва|выда[её]|име[ею]|поддерж)|без\s+(?:IBAN|лиценз)|планиру|скоро/iu;
const transferPattern = /\b(?:send|transfer|pay|remit|withdraw)\w*\s+(?:money|funds|to|into)\b|\b(?:recipient|beneficiar|receive from|accept payments from|supported countries|supported IBAN)\w*|перевод|получател/iu;
export function plainText(value) { return String(value ?? '').slice(0,100000).replace(/<[^>]*>/g,' ').replace(/&(?:amp|nbsp);/g,' ').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/\s+/g,' ').trim(); }
export function publicURL(value) {
  try { const u = new URL(value); if (u.protocol !== 'https:' || u.username || u.password || u.port || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(u.hostname) || /^(?:localhost|.*\.local|.*\.internal)$/i.test(u.hostname)) return null; u.hash=''; return u; } catch { return null; }
}
export function validateCriteria(input = {}) {
  const list = (key, fallback=[]) => { const values=input[key] ?? fallback; if(!Array.isArray(values)||values.length>80||values.some(x=>typeof x!=='string'||!x.trim()||x.length>150)) throw new Error('Исключения: до 80 строк, до 150 символов каждая.'); return [...new Set(values.map(x=>x.trim()))]; };
  const strictBanking=input.strictBanking ?? true, institutionType=input.institutionType ?? 'bank';
  if(typeof strictBanking!=='boolean'||!['bank','bank_or_emi'].includes(institutionType)) throw new Error('Проверьте режим проверки банков.');
  const excludeDomains=list('excludeDomains').map(x=>x.toLowerCase().replace(/^www\./,''));
  if(excludeDomains.some(x=>!publicURL(`https://${x}`)||new URL(`https://${x}`).hostname!==x)) throw new Error('Домены исключений укажите без https и пути.');
  return {strictBanking,institutionType,excludeTerms:list('excludeTerms',DEFAULT_EXCLUDE_TERMS),excludeAppIds:list('excludeAppIds'),excludeDomains};
}
export function excluded({text='', appId='', url='', domains=[]}, config) {
  if((config.excludeAppIds??[]).includes(appId)) return 'excludedId';
  const hosts=[...domains,url].map(x=>publicURL(x)?.hostname.replace(/^www\./,'')).filter(Boolean);
  if((config.excludeDomains??[]).some(x=>hosts.some(h=>h===x||h.endsWith(`.${x}`)))) return 'excludedDomain';
  const normalized=plainText(text).normalize('NFKC').toLowerCase();
  if((config.excludeTerms??[]).some(x=>normalized.includes(x.normalize('NFKC').toLowerCase()))) return 'excludedTerm';
  return null;
}
export function assessBanking(documents, config) {
  const evidence={business:[],euIban:[],licence:[]};
  for(const doc of documents) {
    const text=plainText(doc.text);
    // Each positive IBAN claim must occur in a clause about the offered business account.
    const clauses=text.split(/(?<=[.!?;\n])\s+/u).filter(Boolean);
    for(const raw of clauses) {
      const clause=raw.slice(0,900);
      if(denyPattern.test(clause)) continue;
      const item={text:clause.slice(0,500),url:doc.url,label:doc.label};
      if(businessPattern.test(clause)) evidence.business.push(item);
      if(businessPattern.test(clause)&&ibanPattern.test(clause)&&!transferPattern.test(clause)&&!/\b(?:personal|retail|consumer|individual)\s+(?:bank\s+)?account/iu.test(clause)) evidence.euIban.push(item);
      // A partner bank's licence is not the provider's own licence.
      if((licencePattern.test(clause)||(config.institutionType==='bank_or_emi'&&emiPattern.test(clause)))&&!/\bpartner|provided by|powered by|banking.as.a.service|through\s+(?:a|our)\s+bank|партн[её]р/iu.test(clause)) evidence.licence.push(item);
    }
  }
  for(const key of Object.keys(evidence)) evidence[key]=evidence[key].slice(0,3);
  const missing=Object.entries(evidence).filter(([,v])=>!v.length).map(([k])=>k);
  return {version:CRITERIA_VERSION,status:missing.length?'insufficient_evidence':'text_matches',institutionType:config.institutionType,missing,evidence,checkedAt:new Date().toISOString(),notice:'Заявления источника. Лицензию, тип IBAN, владельца счёта и доступность открытия нужно проверить.'};
}
export function eligibleFinding(entry, config) {
  if(excluded({text:`${entry.title??''} ${entry.developer??''} ${entry.summary??''} ${entry.snippet??''} ${entry.screeningText??''} ${Object.values(entry.qualification?.evidence??{}).flat().map(e=>e.text).join(' ')}`,appId:entry.appId,url:entry.url,domains:entry.developerWebsite?[entry.developerWebsite]:[]},config)) return false;
  return !config.strictBanking || (entry.qualification?.version===CRITERIA_VERSION&&entry.qualification.status==='text_matches'&&entry.qualification.institutionType===config.institutionType);
}
