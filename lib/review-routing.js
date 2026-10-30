import {AI_REVIEW_VERSION} from './ai-config.js';
import {VALIDATION_POLICY_VERSION,scopedDocuments,businessIbanSupported,directFactSuggestions} from './product-evidence.js';
import {officialRegulator} from './licences.js';
import {verifiedDecision} from './verification-policy.js';
import {utilityQuoteSupported} from './utility-evidence.js';
import {screenCandidate} from './screening.js';
import {nigeriaEvidence} from './geography.js';
import {createHash} from 'node:crypto';
const verdicts=new Map();
const normal=value=>String(value??'').normalize('NFKC').replace(/\s+/g,' ').trim();
const direct=doc=>doc.kind==='official_page'&&!officialRegulator(doc.url)||doc.kind==='listing'&&/^https:\/\/(?:play\.google\.com|apps\.apple\.com)\//.test(doc.url??'');
const heldStatuses=new Set(['approved','watch','selected','rejected','confirmed','new']);
const future=/\b(?:will (?:offer|provide|issue|launch|introduce|support|enable|be available)|plan(?:s)? to|intend to|aim to|coming soon|join (?:our|the) waitlist|not yet available)\b|скоро|планируем|лист ожидания/iu;
const hardTools=new Set(['game','tax_tool','details_vault','iban_utility','accounting_tool','non_financial_tool','non_account_tool','linked_accounts']);
const conditional=/\b(?:for|to|in)\b|(?:для|кроме)\s/iu;
const negatives={
 business:/\b(?:we (?:do not|don't)|does not|cannot|can't) (?:currently )?(?:offer|provide|open|support) (?:any )?(?:business|corporate|company) (?:bank |payment )?accounts?\b|\b(?:business|corporate|company) (?:bank |payment )?accounts? (?:are |is )?(?:not (?:offered|available|supported|provided)|unavailable)\b|не (?:открываем|предоставляем|обслуживаем).{0,30}(?:бизнес.?сч[её]т|сч[её]т.{0,15}компани)|keine Gesch[aä]ftskonten|ne proposons pas de comptes professionnels|non offriamo conti aziendali/iu,
 account:/\b(?:we (?:do not|don't)|does not|cannot|can't) (?:offer|provide|open|issue) (?:any |customer |bank |payment )?(?:accounts?|IBANs?)\b|\bonly (?:connect|link|aggregate) (?:your )?(?:existing|external|bank) accounts\b|не (?:открываем|предоставляем|выда[её]м).{0,25}(?:счета|IBAN)/iu,
 euIban:/\b(?:we (?:do not|don't)|does not|cannot|can't) (?:offer|provide|issue) (?:any )?(?:EU|European Union) IBANs?\b|\b(?:EU|European Union) IBANs? (?:are )?(?:not (?:available|provided|issued|offered)|unavailable)\b|\bonly (?:GB|UK|British|CH|Swiss|NO|Norwegian) IBANs?\b|\b(?:IBANs? (?:are )?(?:issued|provided) (?:only )?in (?:the )?(?:UK|United Kingdom|Switzerland|Norway) only)\b|(?:только (?:британск|швейцарск|норвежск).{0,12}IBAN|не выда[её]м.{0,12}IBAN.{0,15}ЕС)/iu
};
function verifiedFacts(result,documents){
 return Object.fromEntries(['business','account','euIban','utility'].map(key=>{const fact=result.facts?.[key],evidence=[];
  for(const item of fact?.evidence??[]){const quote=normal(item.quote),doc=documents.find(d=>d.url===item.url&&normal(d.text).includes(quote));if(!doc||!quote||quote.length<8||quote.length>1600)continue;evidence.push({...item,quote,kind:doc.kind,sourceId:doc.id});}
  return[key,{status:evidence.length&&['yes','no'].includes(fact?.status)?fact.status:'unknown',evidence}];
 }));
}
// A model label or a missing keyword alone is never enough for this routing.
export function reviewedDisposition(entry,analysis,record={},cycle=null,policy={},analysisStale=false){
 const response=(status,reason,evidence=[],evaluated=true)=>({status,reason,evidence:evidence.slice(0,3),evaluated,checkedAt:analysis?.checkedAt??null,version:1});
 if(heldStatuses.has(record.status)||record.exclusionReason==='worked')return null;
 const checked=Date.parse(analysis?.checkedAt),start=Date.parse(cycle?.startedAt);
 if(!analysis||analysisStale||!Number.isFinite(checked)||analysis.version!==AI_REVIEW_VERSION||analysis.policyVersion!==VALIDATION_POLICY_VERSION||analysis.analysisMethod!=='ai')return response('review','Нет завершённого актуального разбора с проверенными источниками.',[],false);
 if(cycle&&record.reviewCycleId===cycle.id&&checked<start)return response('review','Сохранённый разбор выполнен до текущего прохода проверки.',[],false);
 const held=Date.parse(record.manualStatusAt??(record.status==='review'&&record.updatedAt!==cycle?.startedAt?record.updatedAt:null));
 if(record.status==='review'&&Number.isFinite(held)&&held>=checked)return response('review','Вы вернули запись на ручную проверку после этого разбора.');
 const key=createHash('sha256').update(JSON.stringify([entry.id,entry.title,entry.url,entry.appId,entry.developerWebsite,entry.developerAddress,entry.developerCountry,entry.regulatoryLead,entry.signalType,analysis.developerWebsite,analysis.checkedAt,analysis.facts,analysis.quality,analysis.availability,analysis.sourceDocuments,analysis.sourceErrors,policy])).digest('hex');
 const cached=verdicts.get(key);if(cached){verdicts.delete(key);verdicts.set(key,cached);return cached;}
 const verdict=(()=>{
 const owner={...entry,developerWebsite:entry.developerWebsite??analysis.developerWebsite};
 const errors=(analysis.sourceErrors??[]).join(' '),listingUnavailable=/карточка Google Play недоступна/iu.test(errors),siteUnavailable=/Публичный сайт не прочитан/iu.test(errors);
 const documents=scopedDocuments(owner,analysis.sourceDocuments??[]).filter(d=>direct(d)&&!(listingUnavailable&&d.kind==='listing')&&!(siteUnavailable&&d.kind==='official_page')&&normal(d.text).length>=8).map((d,i)=>({...d,id:d.id??'review'+i}));
 if(!documents.length)return response('review','Нет доступного описания приложения или страницы самого провайдера.');
 const facts=verifiedFacts(analysis,documents),evaluated={...owner,...policy,documents,screeningText:'',snippet:'',summary:''};
 const screen=screenCandidate(evaluated),country=screen.marketEvidence;
 if(country?.code==='excludedJurisdiction')return response('auto_excluded',country.reason,[{quote:country.text,url:country.url??owner.developerWebsite??entry.url,kind:'policy'}]);
 const nigeria=nigeriaEvidence(evaluated);
 if(nigeria&&(nigeria.basis==='provider_domain_or_country'||nigeria.basis==='provider_identity'&&/Nigeria|Нигери/iu.test(entry.developerAddress??'')||nigeria.basis==='provider_or_local_account_claim'&&/registered|incorporated|headquarter|based|licensed|regulated|Central Bank of Nigeria/iu.test(nigeria.text)&&!/partner|powered by|provided by|beneficiar|send money to/iu.test(nigeria.text)))return response('auto_excluded','Исключена нигерийская юрисдикция провайдера.',[{quote:nigeria.text,url:documents.find(d=>normal(d.text).includes(normal(nigeria.text)))?.url??entry.url??owner.developerWebsite,kind:'policy'}]);
 const provision=documents.some(d=>String(d.text).split(/\n+|(?<=[.!?;])\s+/u).some(line=>!/\b(?:do not|does not|cannot|can't|no|without)\b.{0,45}(?:offer|provide|open|issue|accounts?|IBAN)/iu.test(line)&&/\b(?:open|create|offer|provide|issue|get|receive|opening|offering|providing)\w*\b.{0,65}(?:(?:business|corporate|company|bank|payment|fiat|EUR|euro|multi.currency)\s+){1,3}accounts?\b|\b(?:your|our|named|dedicated)\s+(?:business |corporate |EUR |euro )?IBANs?\b/iu.test(line)));
 const positiveAccount=facts.account.status==='yes'||facts.business.status==='yes'||provision||Boolean(directFactSuggestions(documents).account);
 const waiting=['waitlist','planned'].includes(analysis.availability?.status)||documents.some(d=>String(d.text).split(/\n+|(?<=[.!?;])\s+/u).some(line=>future.test(line)&&/IBAN|business accounts?|corporate accounts?/iu.test(line)));
 if(!waiting&&!positiveAccount){
  const utility=facts.utility.status==='yes'?facts.utility.evidence.filter(e=>utilityQuoteSupported(e.quote)):[];
  if(utility.length)return response('auto_excluded','По прямой цитате это инструмент, а не провайдер счёта.',utility);
  if(hardTools.has(screen.kind)||['crypto_wallet','crypto_only'].includes(screen.kind)){
   const doc=documents.find(d=>screenCandidate({...evaluated,documents:[d]}).kind===screen.kind);
   if(doc)return response('auto_excluded',screen.reason,[{quote:normal(doc.text).slice(0,1000),url:doc.url,kind:doc.kind}]);
  }
 }
 for(const [key,pattern]of Object.entries(negatives))if(facts[key].status==='no'&&!waiting&&!(key==='account'&&positiveAccount)){
  const evidence=facts[key].evidence.filter(e=>pattern.test(e.quote)&&!conditional.test(e.quote)&&!future.test(e.quote)&&!/directly|ourselves|through a partner|via a partner|сами|через партн/iu.test(e.quote));
  const suggestions=directFactSuggestions(documents);
  if(evidence.length&&!suggestions[key]&&!facts[key].evidence.some(e=>evidence.includes(e)&&/not a bank|не являемся банком/iu.test(e.quote)))return response('auto_excluded',({business:'Провайдер прямо не предлагает бизнес-счета.',account:'Сервис прямо не открывает и не предоставляет клиентские счета / IBAN.',euIban:'По прямой цитате IBAN страны ЕС не предоставляется.'})[key],evidence);
 }
 const supportedIBAN=facts.euIban.status==='yes'&&facts.euIban.evidence.some(e=>businessIbanSupported(e,facts.business.evidence,facts.account.evidence,documents));
 const disputed=facts.utility.status==='yes'||hardTools.has(screen.kind)||['crypto_wallet','crypto_only'].includes(screen.kind)||Object.values(facts).some(f=>f.evidence.some(e=>future.test(e.quote)));
 if(!waiting&&supportedIBAN&&!disputed&&analysis.quality?.status!=='needs_review'&&verifiedDecision({...analysis,facts})==='match')return response('confirmed','Прямыми цитатами подтверждены бизнес-счёт, предоставление счёта и IBAN страны ЕС.',facts.euIban.evidence);
 return response('review',waiting?'Ранний проект / лист ожидания: действующее предложение счёта требует проверки.':disputed?'Источники или выводы противоречат друг другу; нужно ваше решение.':'Часть критериев не подтверждена. Отсутствие сведений не является отказом.',Object.values(facts).flatMap(f=>f.evidence));
 })();
 const frozen=Object.freeze({...verdict,evidence:Object.freeze(verdict.evidence.map(e=>Object.freeze({...e})))});verdicts.set(key,frozen);if(verdicts.size>10000)verdicts.delete(verdicts.keys().next().value);return frozen;
}
