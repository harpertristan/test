import {SOCIAL_SOURCES} from './source-catalog.js';
import {officialRegulator} from './licences.js';
import {explicitEUIbanClaim,publicURL} from './qualification.js';
import {canonicalName} from './identity-names.js';
export const VALIDATION_POLICY_VERSION=4;
const norm=s=>String(s??'').normalize('NFKC').replace(/\s+/g,' ').trim();
const scheduling=/^(?:www\.)?(?:calendly\.com|cal\.com|hubspot\.com|meetings\.hubspot\.com|typeform\.com|notion\.so|intercom\.(?:io|com)|doubleclick\.net)$/i;
const publishers=SOCIAL_SOURCES.filter(s=>s.category!=='partner').flatMap(s=>s.domains);
const host=raw=>{try{return new URL(raw).hostname.replace(/^www\./,'');}catch{return '';}};
const brand=raw=>{const h=host(raw).split('.');return h.length>2&&['co','com'].includes(h.at(-2))?h.at(-3):h.at(-2)??'';};
const names=s=>norm(s).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export function productHost(raw){const u=publicURL(raw);return Boolean(u&&!scheduling.test(u.hostname)&&!publishers.some(d=>u.hostname===d||u.hostname.endsWith('.'+d)));}
export function namedProductLinks(body,base,{title='',text=''}={}){
 const results=[],source=norm(title+' '+text),normalSource=names(source);
 for(const [,href,labelRaw]of String(body??'').matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
  let u;try{u=new URL(href.replaceAll('&amp;','&'),base);}catch{continue;}
  if(host(u.href)===host(base)||!productHost(u.href))continue;
  const label=norm(labelRaw.replace(/<[^>]*>/g,' ')),b=brand(u.href),labelName=names(label),brandName=names(b);
  if(brandName.length<3||!normalSource.includes(brandName))continue;
  if(!/business|corporate|account|IBAN|bank|payment|official|website|visit|launch|platform|neobank|stablecoin/i.test(label+' '+u.pathname))continue;
  const at=source.toLowerCase().indexOf(b.toLowerCase()),context=source.slice(Math.max(0,at-120),at+220);
  if(!labelName.includes(brandName)&&!names(title).includes(brandName)&&!/business|corporate|IBAN|bank|payment|launch|account/i.test(context))continue;
  results.push({url:u.href,score:(names(title).includes(brandName)?5:0)+(labelName.includes(brandName)?3:0)+(/business|corporate|account|IBAN/i.test(label)?2:0)});
 }
 return [...new Map(results.sort((a,b)=>b.score-a.score).map(r=>[r.url,r])).values()];
}
export function scopedDocuments(entry,documents){
 const owner=host(entry.developerWebsite??(entry.id?.startsWith('company:')?'https://'+entry.id.slice(8):null)),primary=documents.filter(d=>d.url===entry.url||d.kind==='listing'),text=primary.map(d=>d.text).join(' ');
 return documents.filter(d=>{
  if(!['official_page','official_index'].includes(d.kind)||officialRegulator(d.url))return true;
  if(!productHost(d.url))return false;
  const h=host(d.url);if(owner)return h===owner||h.endsWith('.'+owner);
  const b=names(brand(d.url));return b.length>=3&&(names(entry.title).includes(b)||names(text).includes(b));
 });
}
export function supportedServiceName(name,entry,documents){
 if(!name)return null;const n=canonicalName(name);if(!n)return null;
 if(n===canonicalName(entry.title)&&documents.some(d=>(d.url===entry.url||d.kind==='listing')&&names(d.text).includes(names(name))))return name;
 const owner=entry.developerWebsite??(entry.id?.startsWith('company:')?'https://'+entry.id.slice(8):null);
 if(owner&&n===canonicalName(brand(owner)))return name;
 return documents.some(d=>d.url===entry.url&&names(d.text).includes(names(name))&&/business|bank|IBAN|corporate|payment/i.test(d.text))?name:null;
}
export const businessClaim=/\b(?:business|corporate|company|SME|freelancer)\s+(?:(?:bank|current|payment|multi.currency)\s+){0,2}accounts?\b|accounts? for (?:companies|business|SMEs|freelancers)|бизнес.?сч[её]т|сч[её]т.{0,20}для компани|Geschäftskonto|compte professionnel|conto aziendale/iu;
const negative=/\b(?:do not|does not|cannot|can't|no)\b.{0,40}(?:offer|provide|open|business accounts?)|не предостав/iu;
const personal=/\b(?:personal|retail|consumer|individual)\b.{0,50}(?:account|IBAN)|IBAN.{0,50}(?:personal|retail|consumer)/iu;
const destination=/(?:send|transfer|pay|withdraw|deposit)\b.{0,50}\bto\b.{0,30}IBAN|shared IBAN|pooled account|deposit.only|top.up only/iu;
const proofDoc=d=>d.kind==='official_page'&&!officialRegulator(d.url)||d.kind==='listing'&&/^https:\/\/(?:play\.google\.com|apps\.apple\.com)\//.test(d.url??'');
export function businessIbanSupported(iban,business,accounts,documents){
 if(!explicitEUIbanClaim(iban.quote)||personal.test(iban.quote)||destination.test(iban.quote))return false;
 if(businessClaim.test(iban.quote)&&!negative.test(iban.quote))return true;
 const b=business.filter(e=>e.sourceId===iban.sourceId&&businessClaim.test(e.quote)&&!negative.test(e.quote));
 const a=accounts.filter(e=>e.sourceId===iban.sourceId&&!negative.test(e.quote));
 if(!b.length||!a.length)return false;
 const doc=documents.find(d=>d.id===iban.sourceId);if(!doc||!proofDoc(doc))return false;
 const at=norm(doc.text).indexOf(norm(iban.quote)),near=norm(doc.text).slice(Math.max(0,at-120),at+iban.quote.length+80);
 // Explicit personal sections cannot borrow a business statement elsewhere on the page.
 if(personal.test(near)&&!businessClaim.test(iban.quote))return false;
 return /\b(?:your|our|obtain|provide|issue|issued|receive|get|open|use)\b/iu.test(iban.quote);
}
export function directFactSuggestions(documents){
 const facts={};
 for(const doc of documents.filter(proofDoc)){
  const pieces=String(doc.text??'').split(/\n+|(?<=[.!?;])\s+/u).map(s=>s.trim()).filter(s=>s.length>=8&&s.length<=1200);
  const b=pieces.find(s=>businessClaim.test(s)&&!negative.test(s)&&!/\b(?:will|plans? to|coming soon)\b/iu.test(s));if(!b)continue;
  const iban=pieces.find(s=>explicitEUIbanClaim(s)&&!personal.test(s)&&!destination.test(s)&&/\b(?:your|our|obtain|provide|issue|issued|receive|get|open|use)\b/iu.test(s));if(!iban)continue;
  const evidence=quote=>({sourceId:doc.id,quote});
  if(!businessIbanSupported(evidence(iban),[evidence(b)],[evidence(iban)],documents))continue;
  facts.business={status:'yes',evidence:[evidence(b)]};facts.account={status:'yes',evidence:[evidence(iban)]};facts.euIban={status:'yes',evidence:[evidence(iban)]};break;
 }
 return facts;
}
export function documentScore(doc){
 const text=String(doc.text??''),business=businessClaim.test(text),iban=/IBAN/i.test(text),official=proofDoc(doc);
 let score=(official?4:0)+(business?10:0)+(iban?7:0)+(business&&iban?6:0)+(/business|corporate|company|professional/i.test(doc.url??'')?5:0);
 if(/\/(?:personal|investor-relations|privacy|cookies|careers)\b/i.test(doc.url??''))score-=12;
 if(/iban[-_/]?(?:calculator|generator|checker)|iban-hesaplama/i.test(doc.url??''))score-=15;
 return score;
}
export function assessmentQuality({facts,rejectedQuotes=0,summary='',reasons={}}){
 const issues=[];if(Object.values(facts).every(f=>f.status==='unknown'))issues.push('no_supported_facts');
 if(rejectedQuotes)issues.push('rejected_quotes');if(/[\u3400-\u9fff]/u.test(summary))issues.push('russian_text_invalid');
 if(reasons.euIban)issues.push('iban_evidence_not_linked');
 return {version:VALIDATION_POLICY_VERSION,status:issues.length?'needs_review':'checked',issues,rejectedQuotes};
}
export function russianSummary(facts,summary,quality){
 if(quality.issues.length===0&&/[А-Яа-яЁё]/u.test(summary))return summary;
 if(facts.utility?.status==='yes')return'По исходным цитатам это инструмент, а не подтверждённый провайдер счёта.';
 const label=f=>f?.status==='yes'?'есть подтверждающая цитата':f?.status==='no'?'есть отрицательная цитата':'не подтверждено';
 return `Бизнес-счёт: ${label(facts.business)}. Предоставление счёта: ${label(facts.account)}. EU IBAN: ${label(facts.euIban)}. Неизвестные сведения требуют проверки.`;
}
