const OBSERVED_APPS={
 'PaySaxas':{appId:'com.paysaxas.akitamob',website:'https://paysaxas.com'},
 'Breinrock':{appId:'com.breinrock.ebankingmobile',website:'https://breinrock.com'},
 'Luminary':{appId:'com.luminary.mobile',website:'https://www.luminaryinc.com'},
 'Unlimit':{appId:'com.unlimint.app',website:'https://www.accounts.unlimit.com/'},
};
// User-supplied examples, 20 October 2026. A reference is not verified IBAN evidence.
// No guessed URLs or Android package IDs are added for name-only examples.
export const REFERENCE_LIBRARY = [
 ['Unlimit'],['OFX Business'],['Ebury','https://ebury.com/en-gb'],['Paynovate'],
 ['Breinrock','https://breinrock.com'],['Luminary'],['iSX Financial','https://www.isx.financial/'],
 ['payabl','https://payabl.com/contact'],['XlentPay'],['Limited','https://www.limitedapp.com/en'],
 ['Wirex'],['Mistertango'],['Xoala'],['ether.fi','https://ether.fi/'],['Jetonbank','https://jetonbank.com/'],
 ['Payswix'],['Keytom'],['Satchel'],['Andaria business'],['amnis treasury'],['PaySaxas'],
 ['Bankera',null,['com.bankera.wallet']],['Sokin'],['Genome'],['PayDo'],
 ['Kunga','https://kunga.eu/open-business-account'],['Monetoria','https://www.monetoria.io/registration'],
 ['mytu','https://mytu.co/business'],['eMoney','https://emoney.mt/'],['Axilpay','https://axilpay.io/'],
 ['fgconboarding.com · название уточнить','https://fgconboarding.com/identity/account/register'],
 ['Igson Capital'],['LurraPay','https://lurrapay.com/'],['Rampy','https://www.rampy.money/'],
 ['Stable.com','https://stable.com',['com.stablecom.app']],['Kleos business',null,['com.kleos.baas']],
 ['PhotonPay','https://www.photonpay.com/uk'],
].map(([name,url=null,appIds=[]])=>({name,url,observedWebsite:OBSERVED_APPS[name]?.website??null,domain:url?new URL(url).hostname.replace(/^www\./,''):OBSERVED_APPS[name]?new URL(OBSERVED_APPS[name].website).hostname.replace(/^www\./,''):null,appIds:[...appIds,...(OBSERVED_APPS[name]?[OBSERVED_APPS[name].appId]:[])],knownSince:'2026-10-20',evidenceStatus:'user_reference'}));
export const REFERENCE_DOMAINS=REFERENCE_LIBRARY.map(e=>e.domain).filter(Boolean);
export const REFERENCE_NAMES=REFERENCE_LIBRARY.filter(e=>!e.name.includes('название уточнить')).map(e=>e.name);
export function referenceMatch(entry){
 let host;try{host=new URL(entry.developerWebsite??entry.url).hostname.replace(/^www\./,'');}catch{}
 return REFERENCE_LIBRARY.find(e=>e.appIds.includes(entry.appId)||e.domain&&(host===e.domain||host?.endsWith('.'+e.domain)))??null;
}
export function referenceQueries(config,now=new Date()){
 if(!config.referenceDiscovery)return[];
 const country=config.phoneCountry||(config.countries.includes('DE')?'DE':config.countries[0]);
 return REFERENCE_NAMES.map(keyword=>({country,keyword,lang:'en',referenceQuery:true}));
}
export function referenceByName(name){
 const normal=s=>String(s??'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
 const value=normal(name);if(!value)return null;
 return REFERENCE_LIBRARY.find(e=>[e.name,e.name.replace(/\s+(?:business|treasury)$/i,'')].some(n=>normal(n)===value))??null;
}
