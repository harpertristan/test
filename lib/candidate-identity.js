import {SOCIAL_SOURCES} from './source-catalog.js';
import {providerHost,canonicalProviderId} from './provider-host.js';
const publishers=SOCIAL_SOURCES.filter(s=>['news','newsletter','community','directory','register','social','app'].includes(s.category)).flatMap(s=>s.domains);
export function candidateIdentity(entry){
 const origin=entry.originSection??entry.section??entry.source;let host;
 try{host=new URL(entry.developerWebsite??(origin==='web'||entry.signalType==='page_snapshot'?entry.url:undefined)).hostname.replace(/^www\./,'');}catch{}
 if(host&&(publishers.some(d=>host===d||host.endsWith('.'+d))||!entry.developerWebsite&&/\/(?:blog|news|press|articles|insights|stories)\b/i.test(new URL(entry.url).pathname)))host=null;
 return canonicalProviderId(entry.recheckId??(host?'company:'+providerHost(host):entry.appId?'app:'+entry.appId:'link:'+entry.url));
}
