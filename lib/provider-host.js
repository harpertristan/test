import psl from 'psl';
// Merge only service subdomains. Arbitrary product brands and hosted tenants
// retain their identities even when they share an infrastructure domain.
const servicePrefix=/^(?:www\d*|support|help|helpdesk|faq|docs|m)\./i;
const hosted=/^(?:zendesk\.com|freshdesk\.com|intercom\.help|github\.io|notion\.site|webflow\.io|wordpress\.com|helpjuice\.com)$/i;
export function providerHost(raw){
 try{let host=new URL(raw.includes('://')?raw:'https://'+raw).hostname.toLowerCase().replace(/\.$/,'');
  while(servicePrefix.test(host)){const parent=host.slice(host.indexOf('.')+1);if(!psl.get(parent)||hosted.test(parent))break;host=parent;}
  return host;
 }catch{return '';}
}
export const canonicalProviderId=id=>typeof id==='string'&&id.startsWith('company:')?'company:'+(providerHost(id.slice(8))||id.slice(8)):id;
export const sameProviderHost=(a,b)=>Boolean(providerHost(a)&&providerHost(a)===providerHost(b));
