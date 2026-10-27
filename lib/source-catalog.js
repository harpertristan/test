import {LICENCE_QUERIES} from './licence-queries.js';
// Browser-safe catalogue. Inclusion is a search target, not proof of source availability.
export const SOURCE_CATALOG_VERSION = 4;
export const SOCIAL_SOURCES = [
  {id:'linkedin',name:'LinkedIn',restriction:'(site:linkedin.com/posts/ OR site:linkedin.com/feed/update/)',domains:['linkedin.com'],category:'social',launch:true},
  {id:'facebook',name:'Facebook',restriction:'site:facebook.com',domains:['facebook.com'],category:'social',launch:true},
  {id:'finextra',name:'Finextra',restriction:'site:finextra.com',domains:['finextra.com'],category:'news',launch:true},
  {id:'sifted',name:'Sifted',restriction:'site:sifted.eu',domains:['sifted.eu'],category:'news',launch:true},
  {id:'tech',name:'Tech.eu / EU-Startups',restriction:'(site:tech.eu OR site:eu-startups.com)',domains:['tech.eu','eu-startups.com'],category:'news',launch:true},
  {id:'payments',name:'The Paypers / FinTech Futures / FF News',domains:['thepaypers.com','fintechfutures.com','ffnews.com'],category:'news',launch:true},
  {id:'presswires',name:'Пресс-релизы: Business Wire / GlobeNewswire / PR Newswire',domains:['businesswire.com','globenewswire.com','prnewswire.com'],category:'news',launch:true},
  {id:'regional',name:'Fintech Baltic / Fintech News Switzerland',domains:['fintechbaltic.com','fintechnews.ch'],category:'news',launch:true},
  {id:'partners',name:'Партнёры: Banking Circle / OpenPayd / Swan',domains:['bankingcircle.com','openpayd.com','swan.io'],category:'partner',launch:true},
  {id:'infrastructure',name:'Партнёры: ClearBank / Modulr / Treezor / Solaris',domains:['clear.bank','modulrfinance.com','treezor.com','solarisgroup.com'],category:'partner',launch:true},
  {id:'newsletters',name:'This Week in Fintech / Fintech Brainfood',domains:['thisweekinfintech.com','fintechbrainfood.com'],category:'newsletter',launch:true},
  {id:'reddit',name:'Reddit: fintech / smallbusiness / digitalnomad / eupersonalfinance',restriction:'(site:reddit.com/r/fintech/ OR site:reddit.com/r/smallbusiness/ OR site:reddit.com/r/digitalnomad/ OR site:reddit.com/r/eupersonalfinance/)',domains:['reddit.com'],category:'community'},
  {id:'forums',name:'Форумы: UK Business Forums / OffshoreCorpTalk',domains:['ukbusinessforums.co.uk','offshorecorptalk.com'],category:'community'},
  {id:'directories',name:'Product Hunt / YC / Seedcamp / Antler / Techstars',domains:['producthunt.com','ycombinator.com','seedcamp.com','antler.co','techstars.com'],category:'directory'},
  {id:'registers',name:'Реестры: EBA / Банк Литвы / REGAFI',domains:['eba.europa.eu','lb.lt','regafi.fr'],category:'register',noFreshness:true},
  {id:'regulators',name:'Реестры: BaFin / Центральный банк Ирландии',domains:['bafin.de','registers.centralbank.ie'],category:'register',noFreshness:true},
  {id:'trustpilot',name:'Trustpilot · отзывы и новые названия',domains:['trustpilot.com'],category:'community',noFreshness:true},
  {id:'trustfinance',name:'TrustFinance · финансовые сервисы',domains:['trustfinance.com'],category:'community',noFreshness:true},
  {id:'eu-registers-west',name:'Реестры: DNB / NBB / CSSF',domains:['dnb.nl','nbb.be','cssf.lu'],category:'register',noFreshness:true},
  {id:'eu-registers-south',name:'Реестры: Banco de España / Banca d’Italia / Banco de Portugal',domains:['bde.es','bancaditalia.it','bportugal.pt'],category:'register',noFreshness:true},
  {id:'eu-registers-islands',name:'Реестры: MFSA / Центральный банк Кипра',domains:['mfsa.mt','centralbank.cy'],category:'register',noFreshness:true},
  {id:'eu-registers-baltic',name:'Реестры: Finantsinspektsioon / Latvijas Banka',domains:['fi.ee','bank.lv'],category:'register',noFreshness:true},
  {id:'eu-mica',name:'ESMA · MiCA / CASP и предупреждения',domains:['esma.europa.eu'],category:'register',noFreshness:true},
  {id:'web-early',name:'Ранние веб-запуски: BetaList / F6S / Wellfound / Dealroom',domains:['betalist.com','f6s.com','wellfound.com','dealroom.co'],category:'directory'},
  {id:'crypto-payments',name:'Криптобанки: Circle / Bridge / BVNK / Zero Hash',domains:['circle.com','bridge.xyz','bvnk.com','zerohash.com'],category:'partner',launch:true},
  {id:'eu-registers-nordic',name:'Реестры: Швеция / Дания / Финляндия',domains:['fi.se','finanstilsynet.dk','finanssivalvonta.fi'],category:'register',noFreshness:true},
  {id:'eu-registers-central',name:'Реестры: Австрия / Польша / Чехия',domains:['fma.gv.at','knf.gov.pl','cnb.cz'],category:'register',noFreshness:true},
  {id:'eu-crypto-regulators',name:'Криптоавторизации: AMF / AFM / CNMV',domains:['amf-france.org','afm.nl','cnmv.es'],category:'register',noFreshness:true},
  {id:'eu-registers-east',name:'Реестры: Болгария / Румыния / Венгрия',domains:['bnb.bg','bnr.ro','mnb.hu'],category:'register',noFreshness:true},
  {id:'eu-registers-southeast',name:'Реестры: Хорватия / Греция / Словения / Словакия',domains:['hnb.hr','bankofgreece.gr','bsi.si','nbs.sk'],category:'register',noFreshness:true},
  {id:'ecb',name:'ECB · банки под надзором',domains:['bankingsupervision.europa.eu'],category:'register',noFreshness:true},
  {id:'appstore',retired:true,name:'Apple App Store · архив',restriction:'site:apps.apple.com',domains:['apps.apple.com'],category:'app'},
  {id:'youtube',name:'YouTube · официальные видео и рекламные публикации',restriction:'(site:youtube.com/watch OR site:youtu.be)',domains:['youtube.com','youtu.be'],category:'advertising',launch:true},
  {id:'meta-ads',name:'Meta Ads Library · публичный индекс рекламы',restriction:'site:facebook.com/ads/library',domains:['facebook.com'],category:'advertising'},
  {id:'linkedin-ads',name:'LinkedIn Ad Library · публичный индекс рекламы',restriction:'site:linkedin.com/ad-library',domains:['linkedin.com'],category:'advertising'},
  {id:'google-ads',name:'Google Ads Transparency Center · публичный индекс',domains:['adstransparency.google.com'],category:'advertising'},
  {id:'tiktok-ads',name:'TikTok · реклама и официальные публикации',restriction:'(site:tiktok.com OR site:ads.tiktok.com/business/creativecenter)',domains:['tiktok.com','ads.tiktok.com'],category:'advertising'},
  {id:'web',name:'Сайты бизнес-сервисов · веб-поиск',restriction:'-site:linkedin.com -site:facebook.com -site:play.google.com -site:apps.apple.com',domains:[],category:'web'},
  {id:'custom',name:'Мои сайты',domains:[],category:'web'},
].map(source=>({...source,restriction:source.restriction ?? `(${source.domains.map(d=>`site:${d}`).join(' OR ')})`}));
export const RECOMMENDED_SOURCES = SOCIAL_SOURCES.filter(s=>s.id!=='custom'&&!s.retired).map(s=>s.id);
export const DEFAULT_SOCIAL_SOURCES = RECOMMENDED_SOURCES;
export const SOCIAL_QUERIES = [
  '("business account" OR "corporate account") ("EU IBAN" OR "German IBAN" OR "Lithuanian IBAN")',
  '("business account" OR "business banking") ("French IBAN" OR "Irish IBAN" OR "EU IBAN")',
];
export const LAUNCH_QUERIES = [
  '(\"business account\" OR \"business banking\") (launches OR launched OR introduces OR \"now available\") (IBAN OR SEPA OR EUR)',
  '(\"corporate account\" OR \"multicurrency account\" OR neobank) (launches OR launched OR unveils) (Europe OR IBAN OR EUR)',
];
export const BUSINESS_SOCIAL_QUERIES = [
  '("business account" OR "corporate account") (IBAN OR SEPA OR EUR)',
  '("multicurrency account" OR "named IBAN" OR "dedicated IBAN")',
];
export function sourceRestriction(source, config) {
  return source==='custom' ? `(${config.watchDomains.map(d=>`site:${d}`).join(' OR ')})` : SOCIAL_SOURCES.find(s=>s.id===source).restriction;
}
export function activeSocialSources(config){return config.sources.filter(id=>!SOCIAL_SOURCES.find(s=>s.id===id)?.retired).filter(id=>config.eventMode!=='launches'||['news','partner','newsletter','social','web','advertising'].includes(SOCIAL_SOURCES.find(s=>s.id===id)?.category));}
export function socialPlan(config, now=new Date()) {
  const registerQueries=LICENCE_QUERIES;
  const all=activeSocialSources(config).flatMap(source=>(config.profile==='business' && SOCIAL_SOURCES.find(s=>s.id===source).category==='register'?registerQueries:SOCIAL_SOURCES.find(s=>s.id===source).category==='advertising'?AD_QUERIES:config.queries).map(query=>({source,query})));
  const budget=all.length;
  if(all.length<=budget)return {requests:all,total:all.length,cycleDays:1};
  const day=Math.floor((+now+2*3600000)/86400000);
  const start=(day*budget)%all.length;
  return {requests:Array.from({length:budget},(_,i)=>all[(start+i)%all.length]),total:all.length,cycleDays:Math.ceil(all.length/budget)};
}
export function socialPreset() {
  return {eventMode:'launches',profile:'business',strictBanking:false,institutionType:'bank_or_emi',sources:[...RECOMMENDED_SOURCES],queries:[...LAUNCH_QUERIES],limit:20,lookbackDays:30,requestBudget:0,watchDomains:[]};
}

export const AD_QUERIES=['(\"business account\" OR \"IBAN account\" OR \"crypto account\") (EUR OR SEPA OR Europe)', '(\"IBAN provider\" OR \"virtual IBAN\" OR \"business banking\") (launch OR open OR new)'];
