import {canonicalName} from './identity-names.js';
import {SOCIAL_SOURCES} from './source-catalog.js';
import {providerHost,canonicalProviderId} from './provider-host.js';
const publishers=SOCIAL_SOURCES.filter(s=>['news','newsletter','community','directory','register','social','app'].includes(s.category)).flatMap(s=>s.domains);
export function candidateIdentity(entry){
 const origin=entry.originSection??entry.section??entry.source;let host;
 try{host=new URL(entry.developerWebsite??(origin==='web'||entry.signalType==='page_snapshot'?entry.url:undefined)).hostname.replace(/^www\./,'');}catch{}
 if(host&&(publishers.some(d=>host===d||host.endsWith('.'+d))||!entry.developerWebsite&&/\/(?:blog|news|press|articles|insights|stories)\b/i.test(new URL(entry.url).pathname)))host=null;
 return canonicalProviderId(entry.recheckId??(host?'company:'+providerHost(host):entry.appId?'app:'+entry.appId:'link:'+entry.url));
}

// Apify post URLs identify evidence, not a separate provider for every post.
// Match explicit advertiser names only, within the same social connector.
export function socialIdentityAliases(entries){
 const groups=new Map(),aliases=new Map(),domainsByName=new Map();
 const nameKey=value=>typeof value==='string'&&canonicalName(value)?value.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,''):null;
 // An independently collected website can anchor the same advertiser's posts.
 // Full names match exactly after spacing/case normalization, never by mentions.
 for(const entry of entries){
  const id=candidateIdentity(entry);if(!id.startsWith('company:'))continue;
  for(const value of [entry.advertiserName,entry.serviceName,entry.title]){
   const name=nameKey(value);if(!name)continue;
   if(!domainsByName.has(name))domainsByName.set(name,new Set());domainsByName.get(name).add(id);
  }
 }
 for(const entry of entries){
  if(entry.sourceTransport!=='apify'||!['facebook','linkedin'].includes(entry.source)||!canonicalName(entry.advertiserName))continue;
  const name=nameKey(entry.advertiserName);
  const key='social:'+entry.source+':'+name;
  if(!groups.has(key))groups.set(key,[]);groups.get(key).push(entry);
 }
 for(const [key,items]of groups){
  const companies=[...(domainsByName.get(nameKey(items[0].advertiserName))??[])];
  // Conflicting product domains require separate identities, not a name guess.
  const target=companies.length===1?companies[0]:key;
  if(target!==key)aliases.set(key,target);
  for(const entry of items){const id=candidateIdentity(entry);if(id.startsWith('link:')&&id!==target)aliases.set(id,target);}
 }
 return aliases;
}
