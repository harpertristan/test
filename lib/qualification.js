import {assessLaunch} from './launches.js';
import { DISCOVERY_VERSION, ESTABLISHED_APPS, DISCOVERY_EXCLUSIONS } from './discovery.js';
// Text evidence is a screening aid, never a regulator or account-opening guarantee.
export const CRITERIA_VERSION = 3;
export const DEFAULT_EXCLUDE_TERMS = ["UPI", "IFSC", "India", "Pakistan", "Belarus", "Indonesia", "Индия", "Пакистан", "Беларусь", "Индонезия"];
export const EU_IBAN_CODES = ["AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE"];
const EU_NAMES = 'EU|European Union|евросоюз[а-я]*|ЕС|Austria[n]*|Belgian?|Belgium|Bulgaria[n]*|Croatia[n]*|Cypriot|Cyprus|Czech|Danish|Denmark|Estonia[n]*|Finnish|Finland|French|France|German[y]?|Greek|Greece|Hungar(?:y|ian)|Irish|Ireland|Italian?|Italy|Latvia[n]*|Lithuania[n]*|Luxembourg|Maltese|Malta|Dutch|Netherlands|Polish|Poland|Portuguese|Portugal|Romania[n]*|Slovak(?:ia)?|Slovenia[n]*|Spanish|Spain|Swedish|Sweden|немецк[а-я]*|герман[а-я]*|француз[а-я]*|литов[а-я]*|ирланд[а-я]*';
const country = `(?:${EU_NAMES}|${EU_IBAN_CODES.join('|')})`;
const ibanPattern = new RegExp(`(?:\\b${country}\\s+(?:(?:business|bank|account|personal|dedicated|local)\\s+){0,2}IBAN\\b|\\bIBAN(?:s)?\\s+(?:(?:in|from|for|with|of|issued in|начинается с|страны|в)\\s+)?${country}\\b|\\b(?:${EU_IBAN_CODES.join('|')})\\d{2}[A-Z0-9]{8,30}\\b)`, 'iu');
const businessPattern = /\b(?:business|corporate|SME|company|freelancer)\s+(?:(?:bank|current|payment|banking|multi.currency)\s+){0,2}accounts?\b|\baccounts?\s+for\s+(?:business|companies|SMEs|freelancers)\b|бизнес[ -]сч[её]т|сч[её]т\w*\s+для\s+(?:бизнес|компани|ИП)|Geschäftskonto|compte professionnel|compte entreprise|conto aziendale|cuenta de empresa|\bbank accounts?\b(?=[^.!?]{0,100}\b(?:business|company|corporate)\b)|\baccount\b[^.!?]{0,80}\b(?:built|designed)\b[^.!?]{0,60}\bbusiness\b/iu;
const licencePattern = /\b(?:licensed|licenced|authori[sz]ed|regulated)\s+(?:as\s+(?:a\s+)?)?(?:(?:European|EU|fully|credit|commercial|digital)\s+){0,2}bank\b|\b(?:holds?|has|with|under|granted|received|obtained)\s+(?:a\s+|an\s+)?(?:(?:full|European|EU|German|Lithuanian|Irish|banking)\s+){0,2}banking\s+licen[cs]e\b|банковск[а-я]*\s+лицензи[а-я]*|лицензированн[а-я]*\s+банк/iu;
const emiPattern = /\b(?:electronic money institution|e.money institution|payment institution|EMI)\b|плат[её]жн[а-я]*\s+организаци/iu;
const futurePattern = /\b(?:(?:will|plan to|planning to|intend to)\s+(?:soon\s+)?(?:offer|open|provide|launch|introduce|issue)|coming soon|not yet available)\b|планиру|скоро появ/iu;
const negativeBusiness = /\b(?:do not|don't|does not|doesn't|cannot|can't)\s+(?:currently\s+)?(?:offer|open|provide|support)\b|\b(?:no|without)\s+(?:a\s+)?business\s+(?:bank\s+)?accounts?\b|не\s+(?:предостав|открыва|поддерж)/iu;
const negativeIban = /\b(?:no|without)\s+(?:an?\s+)?(?:(?:EU|European|German|French|Lithuanian|Irish)\s+)?IBAN\b|\b(?:do not|don't|cannot|can't)\s+(?:issue|provide|offer)\b|не\s+(?:выда[её]|предостав)|без\s+IBAN/iu;
const notBank = /\b(?:we(?:'re| are)|is|are)\s+not\s+(?:a\s+|an\s+)?(?:licensed\s+|regulated\s+)?bank\b|мы\s+не\s+(?:являемся\s+)?банк/iu;
const negativeLicence = /\b(?:no|without)\s+(?:a\s+)?banking\s+licen[cs]e\b|\bnot\s+(?:a\s+)?(?:licensed|licenced|regulated)\s+(?:as\s+a\s+)?bank\b|нет\s+банковск/iu;
const europePattern = new RegExp(`(?<!\\p{L})(?:${EU_NAMES}|Europe|European|SEPA|EUR|европ[а-я]*|евро)(?!\\p{L})`, 'iu');
const nonEuIban = /\b(?:GB|UK|British|Swiss|CH|Norwegian|NO)\s+IBAN\b/iu;
const transferPattern = /\b(?:send|transfer|pay|remit|withdraw)\w*\s+(?:money|funds|to|into)\b|\b(?:recipient|beneficiar|receive from|accept payments from|supported countries|supported IBAN)\w*|перевод|получател/iu;
export function plainText(value) { return String(value ?? '').slice(0,100000).replace(/<[^>]*>/g,' ').replace(/&(?:amp|nbsp);/g,' ').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/\s+/g,' ').trim(); }
export function publicURL(value) {
  try { const u = new URL(value); if (u.protocol !== 'https:' || u.username || u.password || u.port || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(u.hostname) || /^(?:localhost|.*\.local|.*\.internal)$/i.test(u.hostname)) return null; u.hash=''; return u; } catch { return null; }
}
export function developerURL(value) {
  try { const url = new URL(value); if (url.protocol === 'http:') url.protocol = 'https:'; return publicURL(url.href); }
  catch { return null; }
}
export function validateCriteria(input = {}) {
  const list = (key, fallback=[]) => { const values=input[key] ?? fallback; if(!Array.isArray(values)||values.length>80||values.some(x=>typeof x!=='string'||!x.trim()||x.length>150)) throw new Error('Исключения: до 80 строк, до 150 символов каждая.'); return [...new Set(values.map(x=>x.trim()))]; };
  const profile=input.profile ?? 'strict';
  if(!['strict','business'].includes(profile))throw new Error('Выберите профиль поиска.');
  const strictBanking=input.strictBanking ?? (profile!=='business'), institutionType=input.institutionType ?? (profile==='business'?'bank_or_emi':'bank');
  if(typeof strictBanking!=='boolean'||!['bank','bank_or_emi'].includes(institutionType)) throw new Error('Проверьте режим проверки банков.');
  const excludeDomains=list('excludeDomains').map(x=>x.toLowerCase().replace(/^www\./,''));
  if(excludeDomains.some(x=>!publicURL(`https://${x}`)||new URL(`https://${x}`).hostname!==x)) throw new Error('Домены исключений укажите без https и пути.');
  return {profile,strictBanking,institutionType,excludeTerms:list('excludeTerms',profile==='business'?DISCOVERY_EXCLUSIONS:DEFAULT_EXCLUDE_TERMS),excludeAppIds:list('excludeAppIds'),excludeDomains};
}
export function excluded({text='', appId='', url='', domains=[]}, config) {
  if((config.excludeAppIds??[]).includes(appId)) return 'excludedId';
  const hosts=[...domains,url].map(x=>developerURL(x)?.hostname.replace(/^www\./,'')).filter(Boolean);
  if((config.excludeDomains??[]).some(x=>hosts.some(h=>h===x||h.endsWith(`.${x}`)))) return 'excludedDomain';
  const normalized=plainText(text).normalize('NFKC').toLowerCase();
  if((config.excludeTerms??[]).some(x=>normalized.includes(x.normalize('NFKC').toLowerCase()))) return 'excludedTerm';
  return null;
}
export function assessBanking(documents, config) {
  const evidence = { business: [], euIban: [], licence: [] };
  let europeanContext = false, explicitNonBank = false, declaresEmi = false, nonEuAccount = false;
  for (const doc of documents) {
    const text = plainText(doc.text);
    europeanContext ||= europePattern.test(text);
    explicitNonBank ||= notBank.test(text);
    declaresEmi ||= emiPattern.test(text);
    nonEuAccount ||= nonEuIban.test(text);
    const clauses = text.split(/(?<=[.!?;])\s+/u).filter(Boolean);
    for (let i = 0; i < clauses.length; i++) {
      const clause = clauses[i].slice(0, 1200);
      const previous = (clauses[i - 1] ?? '').slice(0, 900);
      const future = futurePattern.test(clause);
      const business = businessPattern.test(clause) && !negativeBusiness.test(clause) && !future;
      const item = { text: clause.slice(0, 700), url: doc.url, label: doc.label };
      if (business) evidence.business.push(item);
      const previousBusiness = businessPattern.test(previous) && !negativeBusiness.test(previous) && !futurePattern.test(previous);
      const linkedAccount = /^(?:your|our|each|every|the account|business|dedicated|local|you get|we provide|with a|ваш|наш|получ)/iu.test(clause);
      const context = business ? clause : `${previous} ${clause}`;
      if (ibanPattern.test(clause) && (business || (previousBusiness && linkedAccount)) &&
          !future && !negativeIban.test(clause) && !transferPattern.test(context) &&
          !/\b(?:personal|retail|consumer|individual)\s+(?:bank\s+)?accounts?/iu.test(context)) {
        evidence.euIban.push({ ...item, text: context.slice(0, 1000) });
      }
      if (!future && !negativeLicence.test(clause) &&
          (licencePattern.test(clause) || (config.institutionType === 'bank_or_emi' && emiPattern.test(clause))) &&
          !/\bpartner|provided by|powered by|banking.as.a.service|through\s+(?:a|our)\s+bank|партн[её]р/iu.test(clause)) {
        evidence.licence.push(item);
      }
    }
  }
  for (const key of Object.keys(evidence)) evidence[key] = evidence[key].slice(0, 3);
  const missing = Object.entries(evidence).filter(([, value]) => !value.length).map(([key]) => key);
  const disqualified = config.institutionType === 'bank' && (explicitNonBank || (declaresEmi && !evidence.licence.length));
  const status = !missing.length && !disqualified ? 'text_matches' : 'insufficient_evidence';
  const isCandidate = status !== 'text_matches' && !disqualified && evidence.business.length > 0 &&
    (evidence.euIban.length > 0 || (europeanContext && !nonEuAccount));
  return {
    version: CRITERIA_VERSION, status, institutionType: config.institutionType,
    missing, isCandidate: Boolean(isCandidate), disqualified, evidence,
    checkedAt: new Date().toISOString(),
    notice: 'Заявления источника. Лицензию, тип IBAN, владельца счёта и доступность открытия нужно проверить.',
  };
}
export function reviewCandidate(entry, config) {
  if(config.profile==='business' && !entry.discovery) return !excluded({text:entry.screeningText,appId:entry.appId,url:entry.developerWebsite},config) && entry.qualification?.version===CRITERIA_VERSION && entry.qualification.isCandidate;
  if(config.profile === 'business' && entry.discovery) return !excluded({text:entry.screeningText ?? entry.snippet,appId:entry.appId,url:entry.developerWebsite ?? entry.url},config) && entry.discovery.version===DISCOVERY_VERSION && (entry.discovery.status==='needs_review'||(config.euIbanMode==='required'&&entry.discovery.status==='service_match'&&entry.discovery.euIban!=='explicit_claim'));
  return !excluded({ text: `${entry.title ?? ''} ${entry.developer ?? ''} ${entry.screeningText ?? ''}`, appId: entry.appId, url: entry.developerWebsite }, config) &&
    entry.qualification?.version === CRITERIA_VERSION && entry.qualification.isCandidate &&
    entry.qualification.institutionType === config.institutionType;
}
export function eligibleFinding(entry, config) {
  if(excluded({text:`${entry.title??''} ${entry.developer??''} ${entry.summary??''} ${entry.snippet??''} ${entry.screeningText??''} ${Object.values(entry.qualification?.evidence??{}).flat().map(e=>e.text).join(' ')}`,appId:entry.appId,url:entry.url,domains:entry.developerWebsite?[entry.developerWebsite]:[]},config)) return false;
  if(entry.signalType==='web_service'&&config.requireWebAccess&&entry.webAccess?.status!=='mentioned')return false;
  if(entry.signalType==='web_service'&&config.euIbanMode==='required'&&entry.discovery?.euIban!=='explicit_claim')return false;
  if(config.eventMode==='launches' && assessLaunch(entry).kind!=='live_launch')return false;
  if(config.profile==='business' && ['register_lead','directory_lead','app_change','page_change'].includes(entry.signalType))return true;
  if(config.profile==='business' && config.hideEstablished && ESTABLISHED_APPS.includes(entry.appId))return false;
  if(config.profile==='business') return entry.discovery ? entry.discovery.version===DISCOVERY_VERSION && entry.discovery.status==='service_match' && (config.euIbanMode!=='required'||entry.discovery.euIban==='explicit_claim') : entry.qualification?.version===CRITERIA_VERSION && entry.qualification.status==='text_matches';
  return !config.strictBanking || (entry.qualification?.version===CRITERIA_VERSION&&entry.qualification.status==='text_matches'&&entry.qualification.institutionType===config.institutionType);
}

// A quoted EU-IBAN claim must itself name the EU issuer/country, not borrow it
// from an unrelated statement elsewhere in a model response.
export function explicitEUIbanClaim(text){return ibanPattern.test(text)&&!negativeIban.test(text)&&!nonEuIban.test(text)&&!/\b(?:personal|retail|consumer|individual)\s+(?:bank\s+)?accounts?/iu.test(text);}
