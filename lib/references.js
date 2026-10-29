const OBSERVED_APPS={
 'PaySaxas':{appId:'com.paysaxas.akitamob',website:'https://paysaxas.com'},
 'Breinrock':{appId:'com.breinrock.ebankingmobile',website:'https://breinrock.com'},
 'Luminary':{appId:'com.luminary.mobile',website:'https://www.luminaryinc.com'},
 'Unlimit':{appId:'com.unlimint.app',website:'https://www.accounts.unlimit.com/'},
};
// User-supplied examples, 20 and 29 October 2026. A reference is not verified IBAN evidence.
// No guessed URLs or Android package IDs are added for name-only examples.
const previousExamples = [
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
 ];
// Only public names / URLs supplied as examples. Personal testing notes are
// deliberately omitted. A reference is neither a verified account nor a bypass
// of manual, jurisdiction or standalone-wallet exclusions.
export const CURRENT_REFERENCE_EXAMPLES=[
 ['Kartiera','https://kartiera.eu/',[],['Colibrix One']],
 ['Kunga','https://kunga.eu/open-business-account'],['TantumPay'],['Moneybase'],
 ['Monetoria','https://www.monetoria.io/registration'],['mytu','https://mytu.co/business'],
 ['eMoney','https://emoney.mt/'],['Axilpay','https://axilpay.io/'],
 ['fgconboarding.com · название уточнить','https://fgconboarding.com/identity/account/register'],
 ['Rampy','https://www.rampy.money/'],['Stable.com','https://stable.com',['com.stablecom.app']],
 ['LurraPay','https://lurrapay.com/'],['Kleos business',null,['com.kleos.baas']],
 ['PhotonPay','https://www.photonpay.com/uk'],['BankPro','https://www.bankpro.com/en/business'],
 ['Igson Capital'],['Moss','https://www.getmoss.com/'],['Nebeus','https://nebeus.com/'],
 ['Moneff','https://moneff.com/eu/en/business'],['Fintrust','https://fintrust.ag/business/'],
 ['Onboard','https://onboard.xyz/'],['NeoOne','https://myneoone.com/'],
 ['Cartera','https://usecartera.com/business-account'],['MoneyBeat','https://moneybeat.eu/en'],
 ['CurrencyFair','https://www.currencyfair.com/business'],['Trumia','https://www.trumia.com/business'],
 ['Cenoa','https://www.cenoa.com/'],['Atlantico','https://www.atlantico.eu/empresas'],
 ['MiFinity','https://mifinity.com/business/'],['Avvio','https://avvio.xyz/business/'],
 ['Vaultus','https://signup.vaultus.co.uk/'],['Oropay','https://oropay.com/'],
 ['xpate','https://xpate.com/'],['Payout One','https://payout.one/en/about/'],
 ['MoneyBlink','https://moneyblink.app/'],['Hapic','https://www.hapic.com/'],['Railor','https://railor.eu/'],
 ['BORDERPAY Business'],['Omexpay Business'],
];
const seenReferences=new Set(),primaryNames=new Set(CURRENT_REFERENCE_EXAMPLES.map(e=>e[0])),previousNames=new Set(previousExamples.map(e=>e[0]));
export const REFERENCE_LIBRARY=[...CURRENT_REFERENCE_EXAMPLES,...previousExamples].filter(([name])=>{if(seenReferences.has(name))return false;seenReferences.add(name);return true;}).map(([name,url=null,appIds=[],aliases=[]])=>({name,url,aliases,priority:primaryNames.has(name)?'primary':'additional',observedWebsite:OBSERVED_APPS[name]?.website??null,domain:url?new URL(url).hostname.replace(/^www\./,''):OBSERVED_APPS[name]?new URL(OBSERVED_APPS[name].website).hostname.replace(/^www\./,''):null,appIds:[...appIds,...(OBSERVED_APPS[name]?[OBSERVED_APPS[name].appId]:[])],knownSince:previousNames.has(name)?'2026-10-20':'2026-10-29',evidenceStatus:'user_reference'}));
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
const normalizeReferenceName=s=>String(s??'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
const referenceNameIndex=new Map();for(const e of REFERENCE_LIBRARY)for(const name of[e.name,e.name.replace(/\s+(?:business|treasury)$/i,''),...e.aliases]){const k=normalizeReferenceName(name);if(k&&!referenceNameIndex.has(k))referenceNameIndex.set(k,e);}
export function referenceByName(name){return referenceNameIndex.get(normalizeReferenceName(name))??null;}
