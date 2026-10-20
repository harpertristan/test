// Browser-safe catalogue. Inclusion is a search target, not proof of source availability.
export const SOURCE_CATALOG_VERSION = 1;
export const SOCIAL_SOURCES = [
  {id:'linkedin',name:'LinkedIn',restriction:'(site:linkedin.com/posts/ OR site:linkedin.com/feed/update/)',domains:['linkedin.com'],category:'social',launch:true},
  {id:'facebook',name:'Facebook',restriction:'site:facebook.com',domains:['facebook.com'],category:'social',launch:true},
  {id:'finextra',name:'Finextra',restriction:'site:finextra.com',domains:['finextra.com'],category:'news',launch:true},
  {id:'sifted',name:'Sifted',restriction:'site:sifted.eu',domains:['sifted.eu'],category:'news',launch:true},
  {id:'tech',name:'Tech.eu / EU-Startups',restriction:'(site:tech.eu OR site:eu-startups.com)',domains:['tech.eu','eu-startups.com'],category:'news',launch:true},
  {id:'payments',name:'The Paypers / FinTech Futures / FF News',domains:['thepaypers.com','fintechfutures.com','ffnews.com'],category:'news',launch:true},
  {id:'regional',name:'Fintech Baltic / Fintech News Switzerland',domains:['fintechbaltic.com','fintechnews.ch'],category:'news',launch:true},
  {id:'partners',name:'Партнёры: Banking Circle / OpenPayd / Swan',domains:['bankingcircle.com','openpayd.com','swan.io'],category:'partner',launch:true},
  {id:'infrastructure',name:'Партнёры: ClearBank / Modulr / Treezor / Solaris',domains:['clear.bank','modulrfinance.com','treezor.com','solarisgroup.com'],category:'partner',launch:true},
  {id:'newsletters',name:'This Week in Fintech / Fintech Brainfood',domains:['thisweekinfintech.com','fintechbrainfood.com'],category:'newsletter',launch:true},
  {id:'reddit',name:'Reddit: fintech / smallbusiness / digitalnomad / eupersonalfinance',restriction:'(site:reddit.com/r/fintech/ OR site:reddit.com/r/smallbusiness/ OR site:reddit.com/r/digitalnomad/ OR site:reddit.com/r/eupersonalfinance/)',domains:['reddit.com'],category:'community'},
  {id:'forums',name:'Форумы: UK Business Forums / OffshoreCorpTalk',domains:['ukbusinessforums.co.uk','offshorecorptalk.com'],category:'community'},
  {id:'directories',name:'Product Hunt / YC / Seedcamp / Antler / Techstars',domains:['producthunt.com','ycombinator.com','seedcamp.com','antler.co','techstars.com'],category:'directory'},
  {id:'registers',name:'Реестры: EBA / Банк Литвы / REGAFI',domains:['eba.europa.eu','lb.lt','regafi.fr'],category:'register',noFreshness:true},
  {id:'regulators',name:'Реестры: BaFin / Центральный банк Ирландии',domains:['bafin.de','registers.centralbank.ie'],category:'register',noFreshness:true},
  {id:'appstore',name:'Apple App Store',restriction:'site:apps.apple.com',domains:['apps.apple.com'],category:'app'},
  {id:'web',name:'Сайты бизнес-сервисов · веб-поиск',restriction:'-site:linkedin.com -site:facebook.com -site:play.google.com -site:apps.apple.com',domains:[],category:'web'},
  {id:'custom',name:'Мои сайты',domains:[],category:'web'},
].map(source=>({...source,restriction:source.restriction ?? `(${source.domains.map(d=>`site:${d}`).join(' OR ')})`}));
export const RECOMMENDED_SOURCES = SOCIAL_SOURCES.filter(s=>s.id!=='custom').map(s=>s.id);
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
export function activeSocialSources(config){return config.sources.filter(id=>config.eventMode!=='launches'||['news','partner','newsletter','social','web'].includes(SOCIAL_SOURCES.find(s=>s.id===id)?.category));}
export function socialPlan(config, now=new Date()) {
  const registerQueries=['(\"payment institution\" OR \"electronic money institution\") (authorised OR registered)','(bank OR EMI) (licence OR authorization)'];
  const all=activeSocialSources(config).flatMap(source=>(config.profile==='business' && SOCIAL_SOURCES.find(s=>s.id===source).category==='register'?registerQueries:config.queries).map(query=>({source,query})));
  const budget=config.requestBudget ?? all.length;
  if(all.length<=budget)return {requests:all,total:all.length,cycleDays:1};
  const day=Math.floor((+now+2*3600000)/86400000);
  const start=(day*budget)%all.length;
  return {requests:Array.from({length:budget},(_,i)=>all[(start+i)%all.length]),total:all.length,cycleDays:Math.ceil(all.length/budget)};
}
export function socialPreset() {
  return {eventMode:'launches',profile:'business',strictBanking:false,institutionType:'bank_or_emi',sources:[...RECOMMENDED_SOURCES],queries:[...LAUNCH_QUERIES],limit:20,lookbackDays:30,requestBudget:8,watchDomains:[]};
}
