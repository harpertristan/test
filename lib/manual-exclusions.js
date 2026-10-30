import {canonicalName,projectNames} from './identity-names.js';
import {knownProjectRules,knownSubjectPatterns,knownArticleSubject} from './known-projects.js';
import {SOCIAL_SOURCES} from './source-catalog.js';
const publishers=SOCIAL_SOURCES.flatMap(s=>s.domains).concat(['play.google.com','apps.apple.com','itunes.apple.com']);
export function appIdentity(raw){try{const u=new URL(raw);if(!['http:','https:'].includes(u.protocol))return null;if(u.hostname==='play.google.com'&&u.pathname==='/store/apps/details')return u.searchParams.get('id');if(u.hostname==='apps.apple.com'){const id=u.pathname.match(/\/id(\d+)(?:\/|$)/)?.[1];return id?'apple:'+id:null;}}catch{}return null;}
export function canonicalFindingURL(raw) {
 try {const u=new URL(raw);if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.port)return null;u.protocol='https:';u.hash='';u.hostname=u.hostname.replace(/^www\./,'');const id=appIdentity(u.href);if(id)return id.startsWith('apple:')?'https://apps.apple.com/app/id'+id.slice(6):'https://play.google.com/store/apps/details?id='+encodeURIComponent(id);for(const k of [...u.searchParams.keys()])if(/^(utm_|fbclid$|gclid$)/i.test(k))u.searchParams.delete(k);u.searchParams.sort();u.pathname=u.pathname.replace(/\/$/,'')||'/';return u.href;}catch{return null;}
}
export function productDomain(entry){try{const raw=entry.developerWebsite??entry.providerWebsite??((entry.section==='web'||entry.source==='web_service'||['web_service','page_snapshot','page_change'].includes(entry.signalType))?entry.url:null);if(!raw)return null;const u=new URL(raw),host=u.hostname.replace(/^www\./,'');if(publishers.some(d=>host===d||host.endsWith('.'+d))||/\/(?:blog|news|articles?|reviews?|threads|posts|press)\b/i.test(u.pathname))return null;return host;}catch{return null;}}
function identities(entry){const urls=[entry.url,entry.developerWebsite,entry.providerWebsite,...(entry.targets??[]).map(t=>t.url)].map(canonicalFindingURL).filter(Boolean);const apps=[entry.appId,...urls.map(appIdentity),...(entry.targets??[]).map(t=>t.appId)].filter(Boolean);return{urls,apps};}
const compiledRules=new WeakMap();
export function exclusionMatch(entry,rules=[]) {
 if(!rules.length)return null;
 const signature=Object.isFrozen(rules)?null:JSON.stringify(rules);
 let cached=compiledRules.get(rules);
 if(!cached||cached.signature!==signature){
  const apps=new Map(),domains=new Map(),urls=new Map(),names=new Map(),mentions=[],add=(map,key,rule)=>{if(key&&!map.has(key))map.set(key,rule);};
  for(const rule of rules){
   for(const app of [...rule.appIds??[],...(rule.kind==='app'?[rule.value]:[]),appIdentity(rule.url),appIdentity(rule.value)])add(apps,app,rule);
   for(const domain of [...rule.domains??[],...(rule.kind==='domain'?[rule.value]:[])])if(domain)add(domains,domain.toLowerCase().replace(/^www\./,''),rule);
   for(const raw of [...rule.urls??[],...(rule.kind==='url'?[rule.value]:[])])add(urls,canonicalFindingURL(raw),rule);
   const project=rule.matchNames??(rule.kind==='app'||rule.kind==='domain'||Boolean(productDomain({section:'web',url:rule.value})));
   if(project)for(const name of [...rule.names??[],rule.title])add(names,canonicalName(name),rule);
   if(rule.knownProjectId)mentions.push({rule,patterns:knownSubjectPatterns(rule)});
  }
  cached={signature,apps,domains,urls,names,mentions};compiledRules.set(rules,cached);
 }
 const hit=(map,value,kind)=>map.has(value)?{rule:map.get(value),kind,value}:null;
 const values=identities(entry);
 for(const app of values.apps){const found=hit(cached.apps,app,'app');if(found)return found;}
 for(const raw of values.urls){const found=hit(cached.urls,raw,'url');if(found)return found;let host=new URL(raw).hostname;while(host.includes('.')){const domain=hit(cached.domains,host,'domain');if(domain)return domain;host=host.slice(host.indexOf('.')+1);}}
 for(const name of projectNames(entry)){const found=hit(cached.names,canonicalName(name),'name');if(found)return found;}
 for(const {rule,patterns}of cached.mentions)if(knownArticleSubject(entry,patterns))return{rule,kind:'known_subject',value:rule.title};
 return null;
}
export const manuallyExcluded=(entry,rules=[])=>Boolean(exclusionMatch(entry,rules));
export function effectiveExclusions(state){
 const manualDecisions=Object.entries(state.crm?.records??{}).filter(([,r])=>r.status==='rejected').flatMap(([id,r])=>{const kind=id.startsWith('company:')?'domain':id.startsWith('app:')?'app':id.startsWith('link:')?'url':r.title?'name':null;return kind?[{key:'crm:'+id,kind,value:kind==='name'?r.title:id.slice(id.indexOf(':')+1),title:r.title??'Отсеяно вручную',names:r.names??[],reason:r.exclusionReason??'other',createdAt:r.updatedAt}]:[];});
 const originals=[...(state.manualExclusions??[]),...manualDecisions],known=knownProjectRules(state);
 if(!originals.length)return Object.freeze(known);
 const entries=[...(state.findings??[]),...(state.reviewCandidates??[]),...(state.ai?.inbox??[]),...(state.ai?.results??[])];
 for(const section of [state,state.web,state.social,state.apple,state.watch]){if(!section)continue;if(section!==state)entries.push(...section.findings??[]);for(const job of section.jobs??[])entries.push(...job.results??[],...job.existingResults??[],...job.reviewCandidates??[]);}
 const parent=new Map(),find=x=>{if(!parent.has(x))parent.set(x,x);let root=x;while(parent.get(root)!==root)root=parent.get(root);while(parent.get(x)!==root){const next=parent.get(x);parent.set(x,root);x=next;}return root;};
 const union=nodes=>{if(!nodes.length)return;const root=find(nodes[0]);for(const node of nodes)parent.set(find(node),root);};
 for(const entry of entries){const {apps,urls}=identities(entry),own=productDomain(entry);union([...apps.map(x=>'app:'+x),...urls.map(x=>'url:'+x),...(own?['domain:'+own]:[]),...projectNames(entry).map(canonicalName).filter(Boolean).map(x=>'name:'+x)]);}
 const components=new Map();for(const node of parent.keys()){const root=find(node);if(!components.has(root))components.set(root,[]);components.get(root).push(node);}
 return Object.freeze([...originals.map(original=>{
  const rule={...original,appIds:[...original.appIds??[]],domains:[...original.domains??[]],urls:[...original.urls??[]],names:[...original.names??[]]};if(rule.providerWebsite){const h=productDomain({developerWebsite:rule.providerWebsite});if(h)rule.domains.push(h);}
  const app=appIdentity(rule.url??rule.value);if(app&&!rule.appIds.includes(app))rule.appIds.push(app);
  if(rule.kind==='app')rule.appIds.push(rule.value);if(rule.kind==='domain')rule.domains.push(rule.value);
  if(rule.kind==='url'){const url=canonicalFindingURL(rule.value);if(url)rule.urls.push(url);if(!app){const host=productDomain({section:'web',url:rule.value});if(host)rule.domains.push(host);}}
  // Excluding a publisher article must not blacklist the publisher or every bank it mentions.
  const project=rule.kind!=='url'||app||rule.domains.length;rule.matchNames=rule.matchNames??Boolean(project);if(rule.matchNames&&rule.title)rule.names.push(rule.title);
  if(project){const seeds=[...rule.appIds.map(x=>'app:'+x),...rule.domains.map(x=>'domain:'+x),...rule.urls.map(x=>'url:'+canonicalFindingURL(x)),...rule.names.map(canonicalName).filter(Boolean).map(x=>'name:'+x)];for(const node of parent.keys())if(node.startsWith('domain:')&&rule.domains.some(d=>node.slice(7)===d||node.slice(7).endsWith('.'+d)))seeds.push(node);
   const roots=new Set(seeds.map(find));for(const root of roots)for(const node of components.get(root)??[]){if(node.startsWith('app:'))rule.appIds.push(node.slice(4));else if(node.startsWith('domain:'))rule.domains.push(node.slice(7));else if(node.startsWith('name:'))rule.names.push(node.slice(5));else rule.urls.push(node.slice(4));}}
  rule.names=[...new Set(rule.names)];Object.freeze(rule.names);rule.appIds=[...new Set(rule.appIds)];rule.domains=[...new Set(rule.domains)];rule.urls=[...new Set(rule.urls)];Object.freeze(rule.appIds);Object.freeze(rule.domains);Object.freeze(rule.urls);return Object.freeze(rule);
 }),...known]);
}
export function visibleJob(job,rules=[]) {if(!job)return job;return {...job,...Object.fromEntries(['results','existingResults','reviewCandidates'].filter(k=>Array.isArray(job[k])).map(k=>[k,job[k].filter(e=>!manuallyExcluded(e,rules))]))};}
