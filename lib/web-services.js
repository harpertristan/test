import{createHash}from'node:crypto';
import{validateCriteria,assessBanking,publicURL,plainText,excluded}from'./qualification.js';
import{assessDiscovery,REFERENCE_SITES}from'./discovery.js';
import{socialError}from'./social-search.js';
export const WEB_QUERIES=[
 '("business account" OR "corporate account") (IBAN OR SEPA) ("web app" OR "online banking")',
 '("multicurrency account" OR "business IBAN") (dashboard OR browser OR "web platform")',
 '("business account" OR "corporate account") ("open account" OR "sign up") (EUR OR Europe)',
 '("business wallet" OR "business account") (EUR OR SEPA) ("web banking" OR "online account")',
];
export function validateWebConfig(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Некорректные параметры веб-поиска.');
 const queries=input.queries??WEB_QUERIES,referenceDomains=input.referenceDomains??REFERENCE_SITES;
 if(!Array.isArray(queries)||!queries.length||queries.length>12||queries.some(q=>typeof q!=='string'||!q.trim()||q.length>250||q.trim().split(/\s+/).length>50))throw new Error('От 1 до 12 веб-запросов, до 250 символов.');
 if(!Array.isArray(referenceDomains)||referenceDomains.length>20||referenceDomains.some(d=>typeof d!=='string'||d.length>150||!publicURL(`https://${d}`)||new URL(`https://${d}`).hostname!==d))throw new Error('До 20 доменов образцов без https и пути.');
 const requestBudget=input.requestBudget??8,limit=input.limit??20,requireWebAccess=input.requireWebAccess??false;
 if(!Number.isInteger(requestBudget)||requestBudget<1||requestBudget>20)throw new Error('Лимит веб-поиска: от 1 до 20 обращений Brave.');
 if(![10,20].includes(limit)||typeof requireWebAccess!=='boolean')throw new Error('Проверьте глубину и режим веб-поиска.');
 const euIbanMode=input.euIbanMode??'prefer';if(!['prefer','required'].includes(euIbanMode))throw new Error('Проверьте режим EU IBAN.');
 return {...validateCriteria({profile:'business',strictBanking:false,institutionType:'bank_or_emi',...input}),queries:[...new Set(queries.map(q=>q.trim()))],referenceDomains:[...new Set(referenceDomains)],requestBudget,limit,requireWebAccess,euIbanMode};
}
export const webFilters=validateWebConfig;
export function webPlan(config,knownApps=[],now=new Date()){
 const domains=[...new Set([...config.referenceDomains,...knownApps.map(a=>publicURL(a.developerWebsite)?.hostname.replace(/^www\./,'')).filter(Boolean)])].filter(domain=>!excluded({url:`https://${domain}`},config));
 const all=[...config.queries,...domains.map(domain=>`site:${domain} ("business account" OR "corporate account") (IBAN OR SEPA OR EUR)`)];
 const day=Math.floor((+now+7200000)/86400000),start=all.length?(day*config.requestBudget)%all.length:0;
 return {queries:Array.from({length:Math.min(config.requestBudget,all.length)},(_,i)=>all[(start+i)%all.length]),total:all.length,cycleDays:Math.ceil(all.length/config.requestBudget)};
}
const nonProductHost=/(?:^|\.)(?:play\.google\.com|apps\.apple\.com|linkedin\.com|facebook\.com|reddit\.com|finextra\.com|sifted\.eu|tech\.eu|eu-startups\.com|thepaypers\.com|fintechfutures\.com|ffnews\.com|fintechbaltic\.com|fintechnews\.ch|producthunt\.com|trustpilot\.com|wikipedia\.org|youtube\.com|medium\.com|substack\.com|offshorecorptalk\.com|ukbusinessforums\.co\.uk)$/i;
const articlePath=/\/(?:blog|blogs|news|newsroom|press|press-releases?|articles?|insights?|guides?|compare|comparison|reviews?|careers|jobs|forum|threads)(?:\/|$)/i;
const editorial=/\b(?:launches|launched|introduces|unveils|funding round)\b|^(?:how|why|what|top\s*\d|best|a guide|guide|opinion|analysis|the future|обзор|как|почему|рейтинг)\b|\b(?:best business accounts|account comparison|IBAN checker|IBAN validator|IBAN generator)\b/i;
const access=/\b(?:web[ -]?(?:app(?:lication)?|banking|dashboard|platform|portal)|online (?:banking|dashboard|portal)|browser[ -]based|(?:access|manage|banking).{0,45}(?:browser|desktop)|log[ -]?in to (?:your |the )?(?:business |banking )?(?:account|dashboard))\b|веб[ -]?(?:кабинет|верси|приложен)|интернет[ -]?банк|личн\w* кабинет/iu;
export function evaluateWebService(result,config,now=new Date()){
 const url=publicURL(result.url);if(!url||nonProductHost.test(url.hostname)||articlePath.test(url.pathname))return {reason:'notProduct'};
 const title=plainText(result.title),snippet=plainText([result.description,...(Array.isArray(result.extra_snippets)?result.extra_snippets:[])].filter(Boolean).join('. '));
 if(editorial.test(title))return {reason:'notProduct'};
 const text=`${title}. ${snippet}`;
 const blocked=excluded({text,url:url.href},config);if(blocked)return {reason:blocked};
 const docs=[{title,text,url:url.href,label:'Страница сервиса · фрагмент индекса Brave'}],qualification=assessBanking(docs,config),discovery=assessDiscovery(docs,config,qualification,url.hostname);
 if(discovery.status!=='service_match'||config.strictBanking&&qualification.status!=='text_matches')return {reason:'banking'};
 const mentions=text.split(/(?<=[.!?])\s+/u).filter(t=>access.test(t)&&!/\b(?:no|without|not available|coming soon|will offer)\b/iu.test(t));
 const webAccess={status:mentions.length?'mentioned':'unknown',evidence:mentions.slice(0,2)};
 if(config.requireWebAccess&&webAccess.status!=='mentioned')return {reason:'webAccess'};
 if(config.euIbanMode==='required'&&discovery.euIban!=='explicit_claim')return {reason:'euIban'};
 const domain=url.hostname.replace(/^www\./,'');url.hash='';
 for(const key of [...url.searchParams.keys()])if(/^(utm_|fbclid$|gclid$)/i.test(key))url.searchParams.delete(key);
 return {post:{id:`web:${createHash('sha256').update(domain).digest('hex')}`,source:'web_service',signalType:'web_service',title,snippet,url:url.href,domain,webAccess,discovery,qualification,mentionedRegions:[],dateReported:null,checkedAt:now.toISOString(),reason:webAccess.status==='mentioned'?'В тексте упомянут веб-доступ. Регистрация и доступность счёта требуют проверки.':'Найдена страница бизнес-счёта. Наличие веб-кабинета пока не подтверждено.',reviewStatus:'needs_review'}};
}
export function createWebJob(id,config,now=new Date()){
 return {id,config,status:'running',phase:'search',createdAt:now.toISOString(),finishedAt:null,current:'',searchDone:0,searchTotal:0,successfulSearches:0,requestsMade:0,scanned:0,results:[],existingResults:[],errors:[],sourceStatus:[],truncatedQueries:0,skipped:{notProduct:0,banking:0,webAccess:0,euIban:0,excludedTerm:0,excludedDomain:0,excludedId:0,previouslySeen:0,duplicate:0}};
}
export async function runWebSearch(job,provider,{knownApps=[],delay=1100,clock=()=>new Date(),onMatch=async x=>x}={}){
 const plan=webPlan(job.config,knownApps,clock()),seen=new Set();job.searchTotal=plan.queries.length;job.rotationTotal=plan.total;job.rotationDays=plan.cycleDays;
 try{for(const query of plan.queries){if(job.status!=='running')break;job.current=query;let results;
  try{job.requestsMade++;results=await provider.search({q:query,count:job.config.limit,search_lang:/[а-яё]/iu.test(query)?'ru':'en'});if(!Array.isArray(results))throw new Error('Malformed search response');job.successfulSearches++;job.sourceStatus.push({query,status:'ok',returned:results.length});}
  catch(error){const item=socialError(error);job.errors.push(item);job.sourceStatus.push({query,status:'error',code:item.code});job.searchDone++;if(['MISSING_KEY','AUTH_REQUIRED','ACCESS_DENIED','RATE_LIMIT'].includes(item.code)){job.status='failed';break;}continue;}
  if(results.length>=job.config.limit)job.truncatedQueries++;
  for(const result of results){if(job.status!=='running')break;job.scanned++;const {post,reason}=evaluateWebService(result,job.config,clock());if(!post){job.skipped[reason]++;continue;}if(seen.has(post.id)){job.skipped.duplicate++;continue;}seen.add(post.id);const saved=await onMatch({...post,query});if(saved)job.results.push(saved);else job.skipped.previouslySeen++;}
  job.searchDone++;if(job.status==='running'&&delay)await new Promise(r=>setTimeout(r,delay));
 }if(job.status==='running')job.status=!job.successfulSearches?'failed':job.errors.length?'partial':'complete';}
 catch(error){job.errors.push(socialError(error));job.status='failed';}
 job.finishedAt=clock().toISOString();job.current='';
}
export function webCSV(job){const cell=v=>'"'+String(v??'').replace(/^[\s]*[=+@-]/,"'$&").replaceAll('"','""')+'"';const rows=[['Сервис','Домен','Ссылка','Веб-кабинет','Доказательства веб-доступа','EU IBAN','Впервые найдено','Статус поиска'],...(job.results??[]).map(e=>[e.title,e.domain,e.url,e.webAccess?.status,e.webAccess?.evidence.join(' | '),e.discovery?.euIban,e.firstFoundAt,job.status])];return '\uFEFF'+rows.map(r=>r.map(cell).join(';')).join('\r\n');}
