import {SOCIAL_SOURCES} from './source-catalog.js';
import {createHash} from 'node:crypto';
import {publicURL} from './qualification.js';
import {manuallyExcluded} from './manual-exclusions.js';
import {referenceMatch} from './references.js';
const publishers=SOCIAL_SOURCES.filter(s=>['news','newsletter','community','directory','register','social','app'].includes(s.category)).flatMap(s=>s.domains);
const hash=s=>createHash('sha256').update(s).digest('hex');
export function inboxEntry(entry,section,now){
 const url=publicURL(entry.url);if(!url)return null;url.hash='';for(const key of [...url.searchParams.keys()])if(/^(utm_|fbclid$|gclid$)/i.test(key))url.searchParams.delete(key);
 return {id:'raw:'+hash(section+':'+(entry.appId??url.href)),section,source:entry.source??section,title:String(entry.title??'').slice(0,300),url:url.href,appId:entry.appId,developerWebsite:entry.developerWebsite??null,screeningText:String(entry.screeningText??entry.snippet??'').slice(0,18000),preliminaryReason:entry.preliminaryReason??null,signalType:entry.signalType??null,firstFoundAt:entry.firstFoundAt??now.toISOString(),checkedAt:now.toISOString(),reference:referenceMatch(entry)?.name??null};
}
export function storeInbox(draft,entries){
 draft.ai.inbox??=[];let overflow=0;
 for(const entry of entries){if(!entry||manuallyExcluded(entry,draft.manualExclusions))continue;const old=draft.ai.inbox.find(e=>e.id===entry.id);if(old){const first=old.firstFoundAt;Object.assign(old,entry,{firstFoundAt:first});}else if(draft.ai.inbox.length<2000)draft.ai.inbox.push(entry);else overflow++;}
 return overflow;
}
export function groupedCandidates(state){
 const accepted=[...state.findings,...state.reviewCandidates].map(e=>({...e,section:'play',targetId:e.appId}));
 accepted.push(...state.web.findings.map(e=>({...e,section:'web',targetId:e.id})),...state.social.findings.map(e=>({...e,section:'social',targetId:e.id})),...state.watch.findings.map(e=>({...e,section:'watch',targetId:e.id})),...(state.ai.inbox??[]).map(e=>({...e,targetId:e.id,section:'inbox',originSection:e.section})));
 const selected=state.ai.config.sources??['play','web','social','watch'],groups=new Map();
 for(const entry of accepted){
  const origin=entry.originSection??entry.section;if(!selected.includes(origin)||manuallyExcluded(entry,state.manualExclusions))continue;
  let host;try{host=new URL(entry.developerWebsite??(origin==='web'||entry.signalType==='page_snapshot'?entry.url:undefined)).hostname.replace(/^www\./,'');}catch{}
  if(host&&(publishers.some(d=>host===d||host.endsWith('.'+d))||!entry.developerWebsite&&/\/(?:blog|news|press|articles|insights|stories)\b/i.test(new URL(entry.url).pathname)))host=null;
  const key=host?'company:'+host:entry.appId?'app:'+entry.appId:'link:'+entry.url;
  if(!groups.has(key))groups.set(key,{...entry,id:key,originSection:origin,sources:[],targets:[],documents:[],reference:entry.reference??referenceMatch(entry)?.name??(entry.isReference?'Ваш образец':null)});
  const group=groups.get(key);group.earlySignal||=['registers','regulators'].includes(entry.source)||entry.preliminaryReason==='planned'||/waitlist|coming soon|join the wait|will launch/i.test(entry.screeningText??entry.snippet??'');if(!group.sources.includes(entry.source??origin))group.sources.push(entry.source??origin);
  if(!group.targets.some(t=>t.section===entry.section&&t.targetId===entry.targetId))group.targets.push({section:entry.section,targetId:entry.targetId,url:entry.url,title:entry.title,appId:entry.appId});
  const text=entry.screeningText??entry.snippet??'';
  if(text&&!group.documents.some(d=>d.url===entry.url&&d.text===text))group.documents.push({url:entry.url,text,kind:origin==='play'?'listing':origin==='web'?'listing':entry.signalType==='page_snapshot'?'official_page':'third_party'});
  if((entry.firstFoundAt??'')<(group.firstFoundAt??'9999'))group.firstFoundAt=entry.firstFoundAt;
  if(entry.section!=='inbox'&&group.section==='inbox')Object.assign(group,{section:entry.section,targetId:entry.targetId,url:entry.url,title:entry.title});
 }
 return [...groups.values()].map(g=>({...g,reference:g.reference??state.ai.results.find(r=>r.id===g.id)?.reference??null,inputHash:hash(JSON.stringify([g.title,g.documents.map(d=>[d.url,d.text]),g.updatedAt,g.developerWebsite]))}));
}
