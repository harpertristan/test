import {screenCandidate} from './screening.js';
import {nigeriaEvidence} from './geography.js';
import {candidateIdentity} from './candidate-identity.js';
const clearNonProviders=new Set(['game','tax_tool','details_vault','iban_utility','accounting_tool','non_financial_tool','non_account_tool','linked_accounts','crypto_wallet','crypto_only','editorial','regulatory_reference']);
// This gate applies to new ingestion only. It never deletes historical cards
// or changes a saved user decision. Unknown business/IBAN facts remain leads.
export function providerAdmission(entry={},policy={}){
 const section=entry.section??entry.originSection??entry.source;
 const thirdParty=section==='social'||section==='rss'||!['play','apple','web','watch'].includes(section)&&Boolean(entry.source)&&!entry.developerWebsite&&!entry.appId;
 const text=entry.screeningText??entry.snippet??entry.description??'';
 const docs=entry.documents?.length?entry.documents:[{url:entry.url,text,kind:thirdParty?'third_party':entry.appId?'listing':'official_page'},...entry.evidenceDocuments??[]];
 const evaluated={...entry,...policy,documents:docs},screen=screenCandidate(evaluated);
 if(clearNonProviders.has(screen.kind))return{admit:false,code:screen.kind,reason:screen.reason};
 // A publisher's country and an unverified article statement do not locate
 // the provider. Product-source or explicit provider metadata is required.
 const providerSource=!thirdParty||entry.developerWebsite||entry.developerCountry||entry.developerAddress;
 const geo=providerSource?nigeriaEvidence(evaluated):null;
 if(geo)return{admit:false,code:'excludedNigeria',reason:'Нигерийская юрисдикция провайдера: '+geo.text};
 if(screen.marketEvidence&&providerSource)return{admit:false,code:screen.marketEvidence.code,reason:screen.reason};
 const fullListing=Boolean(entry.appId)&&String(text).length>=60;
 if(fullListing&&!screen.eligible&&['off_topic','unrelated_product','local_payments'].includes(screen.kind))return{admit:false,code:'not_account_provider',reason:'Описание приложения не содержит предложения финансового счёта / IBAN.'};
 return{admit:true,code:screen.kind,reason:screen.reason};
}
export function admissionFor(state,entry,policy={}){
 if(state.crm?.intakeArchive?.[candidateIdentity(entry)]?.state==='returned')return{admit:true,code:'user_review',reason:'Возвращено вами для проверки.'};
 return providerAdmission(entry,policy);
}
export function retainAdmissionRejection(state,entry,decision,now=new Date()){
 const id=candidateIdentity(entry);state.crm.intakeArchive??={};const old=state.crm.intakeArchive[id];
 const clean=Object.fromEntries(['title','url','appId','developerWebsite','developer','developerCountry','developerAddress','screeningText','snippet','section','source','sourceKey','keywords','query','firstFoundAt','released','signalType','evidenceDocuments'].filter(k=>entry[k]!==undefined).map(k=>[k,entry[k]]));
 const key=entry.appId??entry.url,entries=old?.entries??[];const index=entries.findIndex(e=>(e.appId??e.url)===key);if(index<0)entries.push(clean);else entries[index]=clean;
 state.crm.intakeArchive[id]={id,title:entry.title,code:decision.code,reason:decision.reason,state:'filtered',entries,firstFoundAt:old?.firstFoundAt??entry.firstFoundAt??now.toISOString(),lastSeenAt:now.toISOString()};
}
