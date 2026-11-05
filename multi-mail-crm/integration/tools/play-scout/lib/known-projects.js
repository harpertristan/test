import {REFERENCE_LIBRARY} from './references.js';
const key=name=>String(name).toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
export function seedKnownProjects(state,now=new Date()){
 if(state.knownProjectsSeed==='2026-10-29')return false;
 state.knownProjects??=[];
 for(const r of REFERENCE_LIBRARY.filter(r=>r.priority==='primary')){
  const id='known:'+key(r.name);if(state.knownProjects.some(p=>p.id===id))continue;
  state.knownProjects.push({id,name:r.name,names:[...new Set([r.name,r.name.replace(/\s+(?:business|treasury)$/i,''),...r.aliases])],domains:r.domain?[r.domain]:[],urls:r.url?[r.url]:[],appIds:[...r.appIds],enabled:true,createdAt:now.toISOString()});
 }
 state.knownProjectsSeed='2026-10-29';return true;
}
export function knownProjectRules(state){return (state.knownProjects??[]).filter(p=>p.enabled!==false).map(p=>({key:p.id,kind:'known',value:p.name,title:p.name,names:p.names??[p.name],domains:p.domains??[],urls:p.urls??[],appIds:p.appIds??[],matchNames:true,reason:'known',knownProjectId:p.id,createdAt:p.createdAt}));}
export function restoreKnownProjects(state,ids){for(const p of state.knownProjects??[])if(ids.includes(p.id))p.enabled=false;}
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function knownSubjectPatterns(rule){return [...new Set([rule.title,...rule.names??[],...rule.domains??[]])].filter(Boolean).map(s=>new RegExp('(?<![\\p{L}\\p{N}])'+escape(s).replace(/\s+/g,'\\s+')+'(?![\\p{L}\\p{N}])','iu'));}
export function knownArticleSubject(entry,patterns){
 // A known infrastructure partner in a new provider's article is not the
 // subject of that article. Grounded provider names take precedence.
 if(entry.serviceName||entry.providerName)return false;
 const title=String(entry.title??''),action=title.search(/\b(?:launch\w*|introduc\w*|announc\w*|offer\w*|partner\w*|unveil\w*|receiv\w*|secur\w*)\b|запуска|объявля|представля|получил/iu);
 const subject=action>=0?title.slice(0,action):title;
 if(patterns.some(p=>p.test(subject)))return true;
 if(action>=0)return false;
 const lead=String(entry.screeningText??entry.snippet??entry.documents?.[0]?.text??'').split(/\n+|(?<=[.!?])\s+/u).find(s=>s.trim())??'';
 return lead.length<500&&!/\b(?:partner|powered by|provided by|sponsor)\b/iu.test(lead)&&patterns.some(p=>p.test(lead));
}
