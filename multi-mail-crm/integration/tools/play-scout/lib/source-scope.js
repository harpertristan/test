import {marketPolicy,nonTargetMarketEvidence} from './market-scope.js';
import {pureCryptoWallet} from './crypto-scope.js';
import {scopedDocuments} from './product-evidence.js';
const host=url=>{try{return new URL(url).hostname.replace(/^www\./,'');}catch{return null;}};
// Source tabs must respect evidence learned later by the shared review. Build
// the index once per response, including aliases for other apps of a provider.
export function sourceScopeFilter(state){
 const index=new Map(),policy=marketPolicy(state);
 for(const r of state.ai.results){
  const domain=host(r.developerWebsite)??(r.id.startsWith('company:')?r.id.slice(8):null);if(domain)index.set('host:'+domain,r);
  if(r.appId)index.set('app:'+r.appId,r);
  for(const t of r.targets??[]){if(t.appId)index.set('app:'+t.appId,r);if(t.url)index.set('url:'+t.url,r);}
 }
 return entry=>{
  const analysis=index.get('app:'+entry.appId)??index.get('host:'+host(entry.developerWebsite??entry.url))??index.get('url:'+entry.url);
  const base=entry.documents?.length?entry.documents:[{url:entry.url,text:entry.screeningText??entry.snippet??'',kind:entry.appId?'listing':'official_page'}];
  const documents=scopedDocuments(entry,[...base,...entry.evidenceDocuments??[],...analysis?.sourceDocuments??[]]);
  const evaluated={...entry,documents};return !pureCryptoWallet(evaluated)&&!nonTargetMarketEvidence(evaluated,policy);
 };
}
