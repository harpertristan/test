import {screenCandidate} from './screening.js';
import {nigeriaEvidence} from './geography.js';
import {SOCIAL_SOURCES} from './source-catalog.js';
import {createHash} from 'node:crypto';
import {publicURL} from './qualification.js';
import {manuallyExcluded,effectiveExclusions} from './manual-exclusions.js';
import {referenceMatch} from './references.js';
import {assessWebPresence} from './web-presence.js';
const publishers=SOCIAL_SOURCES.filter(s=>['news','newsletter','community','directory','register','social','app'].includes(s.category)).flatMap(s=>s.domains);
const hash=s=>createHash('sha256').update(s).digest('hex');
export function inboxEntry(entry,section,now){
 const url=publicURL(entry.url);if(!url)return null;url.hash='';for(const key of [...url.searchParams.keys()])if(/^(utm_|fbclid$|gclid$)/i.test(key))url.searchParams.delete(key);
 return {id:'raw:'+hash(section+':'+(entry.appId??url.href)),section,source:entry.source??section,title:String(entry.title??'').slice(0,300),url:url.href,appId:entry.appId,developerWebsite:entry.developerWebsite??null,developer:entry.developer,publishedAt:entry.publishedAt??entry.dateReported??null,dateReported:entry.dateReported??null,genreId:entry.genreId,released:entry.released,screeningText:String(entry.screeningText??entry.snippet??'').slice(0,18000),regulatoryLead:Boolean(entry.regulatoryLead),evidenceDocuments:entry.evidenceDocuments??[],preliminaryReason:entry.preliminaryReason??null,signalType:entry.signalType??null,firstFoundAt:entry.firstFoundAt??now.toISOString(),checkedAt:now.toISOString(),reference:referenceMatch(entry)?.name??null};
}
export function storeInbox(draft,entries){
 draft.ai.inbox??=[];let overflow=0;const rules=effectiveExclusions(draft);const indexed=new Map(draft.ai.inbox.map(e=>[e.id,e]));
 for(const entry of entries){if(!entry||manuallyExcluded(entry,rules))continue;const old=indexed.get(entry.id);if(old){const first=old.firstFoundAt;Object.assign(old,entry,{firstFoundAt:first});}else{draft.ai.inbox.push(entry);indexed.set(entry.id,entry);}}
 return overflow;
}
export function groupedCandidates(state,{includeExcluded=false,allSources=false,rules=effectiveExclusions(state)}={}){
 const analyses=new Map(state.ai.results.map(r=>[r.id,r]));
 const accepted=[...state.findings,...state.reviewCandidates].map(e=>({...e,section:'play',targetId:e.appId}));
 accepted.push(...(state.apple?.findings??[]).map(e=>({...e,section:'apple',targetId:e.id})),...state.web.findings.map(e=>({...e,section:'web',targetId:e.id})),...state.social.findings.map(e=>({...e,section:'social',targetId:e.id})),...state.watch.findings.map(e=>({...e,section:'watch',targetId:e.id})),...(state.ai.inbox??[]).map(e=>({...e,targetId:e.id,section:'inbox',originSection:e.section})));
 const selected=state.ai.config.sources??['play','web','social','watch'],groups=new Map();
 for(const entry of accepted){
  const origin=entry.originSection??entry.section;if(!includeExcluded&&analyses.get(entry.id)?.autoExcluded)continue;if(!allSources&&!selected.includes(origin)||!includeExcluded&&(manuallyExcluded(entry,rules)||nigeriaEvidence(entry)))continue;
  let host;try{host=new URL(entry.developerWebsite??(origin==='web'||entry.signalType==='page_snapshot'?entry.url:undefined)).hostname.replace(/^www\./,'');}catch{}
  if(host&&(publishers.some(d=>host===d||host.endsWith('.'+d))||!entry.developerWebsite&&/\/(?:blog|news|press|articles|insights|stories)\b/i.test(new URL(entry.url).pathname)))host=null;
  const key=host?'company:'+host:entry.appId?'app:'+entry.appId:'link:'+entry.url;
  if(!groups.has(key))groups.set(key,{...entry,id:key,originSection:origin,sources:[],targets:[],documents:[],reference:entry.reference??referenceMatch(entry)?.name??(entry.isReference?'Ваш образец':null)});
  const group=groups.get(key);group.regulatoryLead||=entry.regulatoryLead;group.earlySignal||=['registers','regulators'].includes(entry.source)||entry.preliminaryReason==='planned'||/waitlist|coming soon|join the wait|will launch/i.test(entry.screeningText??entry.snippet??'');if(!group.sources.includes(entry.source??origin))group.sources.push(entry.source??origin);
  if(!group.targets.some(t=>t.section===entry.section&&t.targetId===entry.targetId))group.targets.push({section:entry.section,targetId:entry.targetId,url:entry.url,title:entry.title,appId:entry.appId});
  const text=entry.screeningText??entry.snippet??'';
  if(text&&!group.documents.some(d=>d.url===entry.url&&d.text===text))group.documents.push({url:entry.url,text,kind:['play','apple','web'].includes(origin)?'listing':['page_snapshot','licensed_provider'].includes(entry.signalType)?'official_page':'third_party'});
  for(const doc of entry.evidenceDocuments??[])if(!group.documents.some(d=>d.url===doc.url&&d.text===doc.text))group.documents.push(doc);
  if((entry.firstFoundAt??'')<(group.firstFoundAt??'9999'))group.firstFoundAt=entry.firstFoundAt;
  if(!group.publishedAt&&(entry.publishedAt??entry.dateReported))group.publishedAt=entry.publishedAt??entry.dateReported;
  if(!group.released&&entry.released)group.released=entry.released;
  if(entry.section!=='inbox'&&group.section==='inbox')Object.assign(group,{section:entry.section,targetId:entry.targetId,url:entry.url,title:entry.title});
 }
 return [...groups.values()].map(g=>({...g,serviceName:analyses.get(g.id)?.serviceName??g.serviceName})).filter(g=>includeExcluded||!manuallyExcluded(g,rules)).filter(g=>includeExcluded||!analyses.get(g.id)?.autoExcluded&&screenCandidate(g).eligible&&state.crm?.records?.[g.id]?.status!=='rejected').map(g=>({...g,webPresence:assessWebPresence(g.documents,{productURL:g.developerWebsite??(g.id.startsWith('company:')?'https://'+g.id.slice(8):null)}),reference:g.reference??analyses.get(g.id)?.reference??null,inputHash:hash(JSON.stringify([g.title,g.documents.map(d=>[d.url,String(d.text).replace(/\s+/g,' ').trim()]).sort((a,b)=>a[0].localeCompare(b[0])||a[1].localeCompare(b[1])),g.developerWebsite]))}));
}
