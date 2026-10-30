import {pureCryptoWallet} from './crypto-scope.js';
import {referenceQueries} from './references.js';
import{pause,abortable,settleWorkers}from'./run-context.js';
import { validateDiscovery, searchPlan, assessDiscovery, DISCOVERY_KEYWORDS, parsePlayId, rollingDates } from './discovery.js';
import { validateCriteria, excluded, assessBanking, publicURL, developerURL, plainText } from "./qualification.js";
export const COUNTRIES = [
  ["AT", "Австрия"],
  ["BE", "Бельгия"],
  ["BG", "Болгария"],
  ["HR", "Хорватия"],
  ["CY", "Кипр"],
  ["CZ", "Чехия"],
  ["DK", "Дания"],
  ["EE", "Эстония"],
  ["FI", "Финляндия"],
  ["FR", "Франция"],
  ["DE", "Германия"],
  ["GR", "Греция"],
  ["HU", "Венгрия"],
  ["IE", "Ирландия"],
  ["IT", "Италия"],
  ["LV", "Латвия"],
  ["LT", "Литва"],
  ["LU", "Люксембург"],
  ["MT", "Мальта"],
  ["NL", "Нидерланды"],
  ["PL", "Польша"],
  ["PT", "Португалия"],
  ["RO", "Румыния"],
  ["SK", "Словакия"],
  ["SI", "Словения"],
  ["ES", "Испания"],
  ["SE", "Швеция"],
].map(([code, name]) => ({ code, name }));

export const PLAY_CATEGORIES=[{id:'FINANCE',name:'Финансы'},{id:'BUSINESS',name:'Бизнес'},{id:'PRODUCTIVITY',name:'Продуктивность'},{id:'TOOLS',name:'Инструменты'}];

export const DEFAULT_KEYWORDS = [
  "бизнес аккаунт",
  "бизнес банк",
  "бизнес счет",
];

export function calendarWindow(now = new Date(), months = 1) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kaliningrad",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return rollingDates(today,months);
}

function isoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value;
}

export function validateConfig(input = {}, now = new Date()) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Некорректные параметры поиска.");
  const discovery = validateDiscovery(input);
  const keywords = input.keywords ?? (discovery.profile==='business'?DISCOVERY_KEYWORDS:DEFAULT_KEYWORDS);
  if (
    !Array.isArray(keywords) ||
    !keywords.length ||
    keywords.some((k) => typeof k !== "string" || !k.trim() || k.length > 100)
  ) {
    throw new Error(
      "Укажите поисковые фразы, каждая не длиннее 100 символов.",
    );
  }
  const countries = input.countries ?? COUNTRIES.map((c) => c.code);
  if (
    !Array.isArray(countries) ||
    !countries.length ||
    countries.some((c) => !COUNTRIES.some((x) => x.code === c))
  ) {
    throw new Error("Выберите хотя бы одну страну ЕС.");
  }
  const window = calendarWindow(now,discovery.releaseMonths);
  const ignoreReleaseDate = input.ignoreReleaseDate ?? false;
  if (typeof ignoreReleaseDate !== 'boolean') throw new Error('Проверьте режим даты выпуска.');
  const from = ignoreReleaseDate ? window.from : (input.from ?? window.from);
  const to = ignoreReleaseDate ? window.to : (input.to ?? window.to);
  if (!isoDate(from) || !isoDate(to) || from > to || to > window.to)
    throw new Error("Проверьте период выпуска: конец не может быть в будущем.");
  const minInstalls = input.minInstalls ?? (discovery.profile==='business'?0:100);
  if (
    !Number.isSafeInteger(minInstalls) ||
    minInstalls < 0 ||
    minInstalls > 1e10
  )
    throw new Error(
      "Порог установок должен быть целым неотрицательным числом.",
    );
  const limit = input.limit ?? 100;
  if (![50, 100, 250].includes(limit))
    throw new Error("Глубина поиска: 50, 100 или 250 результатов.");
  const continuePending=input.continuePending??false;
  if(typeof continuePending!=='boolean')throw new Error('Проверьте продолжение проверки.');
  const categories=input.categories??(discovery.profile==='business'?PLAY_CATEGORIES.map(c=>c.id):['FINANCE']);
  if(!Array.isArray(categories)||!categories.length||categories.some(id=>!PLAY_CATEGORIES.some(c=>c.id===id)))throw new Error('Выберите категории Google Play.');
  return {
    categories:[...new Set(categories)],
    continuePending,
    keywords: [...new Set(keywords.map((k) => k.trim()))],
    countries: [...new Set(countries)],
    from,
    to,
    minInstalls,
    ignoreReleaseDate,
    limit,
    ...validateCriteria(input),
    ...discovery,
    category: "FINANCE",
    free: true,
  };
}

export function playFilters(config) {
  const {from,to,category,free,continuePending,...filters}=config;
  return filters;
}

export function releaseDate(value) {
  if (isoDate(value)) return value;
  if (typeof value !== "string") return null;
  const match = value.match(/^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/);
  if (!match) return null;
  const month =
    [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ].indexOf(match[1]) + 1;
  const result = `${match[3]}-${String(month).padStart(2, "0")}-${match[2].padStart(2, "0")}`;
  return isoDate(result) ? result : null;
}

export function exclusion(app, config) {
  if(pureCryptoWallet({...app,screeningText:app.description??app.summary??app.screeningText}))return 'cryptoWallet';
  if (!(config.categories??["FINANCE"]).includes(app.genreId)) return "category";
  if (app.free !== true || app.price !== 0) return "paid";
  const released = releaseDate(app.released);
  if (!config.ignoreReleaseDate) {
    if (!released) return "unknownRelease";
    if (released < config.from || released > config.to) return "date";
  }
  if (!Number.isFinite(app.minInstalls)) return "unknownInstalls";
  if (app.minInstalls <= config.minInstalls && !(config.referenceDiscovery && config.minInstalls===0 && app.minInstalls===0)) return "installs";
  return null;
}

export function publicError(error) {
  if (error.code === "PERSISTENCE_ERROR")
    return {
      code: "PERSISTENCE_ERROR",
      message:
        "Не удалось сохранить историю. Поиск остановлен; проверьте свободное место и права на папку data.",
    };
  const status = error.status ?? error.response?.statusCode;
  if(status===404)return {code:'APP_NOT_FOUND',message:'Карточка недоступна в этой стране или удалена из Google Play.'};
  if (status === 403 || /403|CONNECT tunnel failed/i.test(error.message)) {
    return {
      code: "ACCESS_DENIED",
      message:
        "Доступ к Google Play отклонён (403). Разрешите play.google.com в сетевых настройках среды и повторите поиск.",
    };
  }
  if (status === 429 || status === 503)
    return {
      code: "RATE_LIMIT",
      message:
        "Google Play временно ограничил запросы. Подождите и повторите поиск.",
    };
  if (/timeout|timed out|ETIMEDOUT/i.test(error.message))
    return { code: "TIMEOUT", message: "Google Play не ответил вовремя." };
  if(/ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|socket hang up|certificate|CERT_|TLS/i.test(error.message))
    return {code:'NETWORK_ERROR',message:'Не удалось установить соединение с Google Play. Проверьте сеть, прокси и сертификаты Node.js.'};
  return {
    code: "SOURCE_ERROR",
    message: "Не удалось получить или разобрать данные Google Play.",
  };
}

export function createJob(id, config) {
  return {
    id,
    config,
    status: "running",
    phase: "search",
    createdAt: new Date().toISOString(),
    finishedAt: null,
    current: "",
    searchDone: 0,
    searchTotal: config.continuePending?0:searchPlan(config).length + referenceQueries(config).length + (config.profile==='business' && config.related ? config.seedApps.length : 0),
    detailDone: 0,
    detailTotal: 0,
    successfulSearches: 0,
    results: [],
    reviewCandidates: [],
    existingResults:[],
    pendingCount:0,
    recommendationChecks:0,
    developerChecks:0,
    filterExamples: [],
    bankingMissing: {business:0, euIban:0, licence:0},
    errors: [],
    warnings: [],
    braveRequests: 0,
    braveSuccessfulRequests: 0,
    sourceCounts: {queries:0, seeds:0, related:0, webIndex:0,developers:0,pageSections:0},
    skipped: {
      banking: 0,excludedJurisdiction:0,outsideTargetMarket:0,cryptoWallet:0,
      excludedNigeria:0,
      excludedTerm: 0,
      excludedId: 0,
      excludedDomain: 0,
      category: 0,
      paid: 0,
      date: 0,
      installs: 0,
      unknownRelease: 0,
      unknownInstalls: 0,
      details: 0,
      previouslySeen: 0,
    },
    enrichmentRequests: 0,
    truncatedQueries: 0,
  };
}

// Sequential requests and the provider's HTTP start gate keep load modest.
export async function runSearch(
  job,
  provider,
  { signal,isExcluded=()=>false,delay = 500, isSeen = () => false, onMatch = async (app) => app, onCandidate = async (app) => app, pendingCandidates=[],onBacklog=async()=>{},onRawCandidate=async()=>{},knownFindings=[] } = {},
) {
  const candidates = new Map();
  let queueState=null,overflow=[],retry=[];const processedIds=new Set();
  let sourceFailures={search:0,detail:0},searchComplete=false,searchPromise=Promise.resolve(),wakeSearch,haltAll=false,recommendationFailures=0;
  const changed=()=>{wakeSearch?.();wakeSearch=null;};
  const waitForSearch=()=>{const waiting=new Promise(resolve=>{wakeSearch=resolve;});return abortable(()=>waiting,signal);};
  const expandedRecommendations=new Set(),expandedDevelopers=new Set();
  const serialize=items=>items.map(c=>({...c,countries:[...c.countries],keywords:[...c.keywords],sources:[...c.sources],detailCountries:[...c.detailCountries],parents:[...(c.parents??[])]}));
  const wait = () => pause(delay,signal);
  const active = () => job.status === "running";
  const errorEntry = (error, context) => ({
    ...publicError(error),
    ...context,
  });
  const finish = (status) => {
    if (active()) job.status = status;
    job.finishedAt = new Date().toISOString();
    job.current = "";
  };
  const sourceFailure=(error,context)=>{
    const entry=errorEntry(error,context);job.errors.push(entry);const kind=context.keyword?'search':'detail';
    if(['ACCESS_DENIED','RATE_LIMIT'].includes(entry.code)){haltAll=true;return true;}
    if(entry.code==='APP_NOT_FOUND'){sourceFailures[kind]=0;return false;}
    if(!['TIMEOUT','NETWORK_ERROR'].includes(entry.code)&&!context.keyword){sourceFailures[kind]=0;return false;}
    if(++sourceFailures[kind]<3)return false;
    job.errors.push({code:'SOURCE_UNAVAILABLE',message:kind==='search'?'Три поисковых запроса Google Play подряд не удались. Новые запросы приостановлены; уже собранные карточки продолжают проверяться.':'Три запроса карточек Google Play подряд не удались. Очередь сохранена: нажмите «Продолжить карточки Google Play» после восстановления доступа.'});
    return true;
  };
  try {
    const add = (app, country, keyword, source='query', parent=null,depth=0) => {
      if (!app.appId || typeof app.appId !== 'string'||isExcluded(app)) return;
      if (!candidates.has(app.appId)) candidates.set(app.appId,{appId:app.appId,countries:new Set(),keywords:new Set(),sources:new Set(),detailCountries:new Set(),parents:new Set(),depth,pending:false,hint:`${app.title??''} ${app.summary??''}`});
      const item=candidates.get(app.appId);item.sources.add(source);if(keyword)item.keywords.add(keyword);if(parent)item.parents.add(parent);item.depth=Math.min(item.depth,depth);
      if(app.pageSection){item.sources.add('page_section');job.sourceCounts.pageSections++;}
      if(country){item.detailCountries.add(country);if(source==='query')item.countries.add(country);}
      changed();
    };
    for(const saved of pendingCandidates){if(isExcluded(saved))continue;add({appId:saved.appId},null,'','pending');const item=candidates.get(saved.appId);Object.assign(item,{countries:new Set(saved.countries??[]),keywords:new Set(saved.keywords??[]),sources:new Set(saved.sources??[]),detailCountries:new Set(saved.detailCountries??[]),parents:new Set(saved.parents??[]),depth:saved.depth??0,hint:saved.hint??'',pending:true});}
    const recommend=async(appId,country,depth)=>{
      if(recommendationFailures>=3||haltAll||isExcluded({appId})||!job.config.related||!provider.related||expandedRecommendations.has(appId)||(job.config.recommendationBudget&&expandedRecommendations.size>=job.config.recommendationBudget)||!active())return;
      expandedRecommendations.add(appId);job.recommendationChecks++;
      try{const found=await provider.related({appId,country:country.toLowerCase()});if(!Array.isArray(found))throw new Error('Invalid recommendations');recommendationFailures=0;for(const app of found){add(app,country,`Рекомендации ${appId}`,'related',appId,depth+1);}job.sourceCounts.related+=found.length;if(!found.length)job.warnings.push(`Google Play не раскрыл рекомендации для ${appId} (${country}).`);}
      catch(error){if(signal?.aborted)throw error;const safe=publicError(error);if(['RATE_LIMIT','ACCESS_DENIED'].includes(safe.code)){haltAll=true;job.errors.push({...safe,appId,country});}else if(safe.code!=='APP_NOT_FOUND')recommendationFailures++;job.warnings.push(`Рекомендации ${appId} (${country}) недоступны; другие источники продолжаются.`);}
    };
    const fullPlan=job.config.continuePending?[]:[...searchPlan(job.config),...referenceQueries(job.config,new Date(job.createdAt))];
    const budget=job.config.googleRequestBudget||fullPlan.length;
    const start=fullPlan.length?Math.floor((Date.parse(job.createdAt)+7200000)/86400000)*budget%fullPlan.length:0;
    const plan=fullPlan.length>budget?Array.from({length:budget},(_,i)=>fullPlan[(start+i)%fullPlan.length]):fullPlan;
    job.rotationTotal=fullPlan.length;job.rotationDays=Math.ceil(fullPlan.length/Math.max(1,budget));
    job.searchTotal=plan.length+(job.config.continuePending?0:job.config.related?job.config.seedApps.length:0);
    let cursor=0,halt=false;
    const queryPromise=settleWorkers(Array.from({length:Math.min(job.config.searchConcurrency??1,plan.length)},async()=>{
      while(active()&&!halt&&!haltAll){
        const item=plan[cursor++];if(!item)break;const {country,keyword,lang}=item;
        job.current=`${country} · ${keyword}`;
        try{
          const found=await provider.search({term:keyword,country:country.toLowerCase(),lang,num:job.config.limit,price:'free',onBatch:batch=>{if(active()&&!haltAll&&Array.isArray(batch))for(const app of batch)add(app,country,keyword);}});
          if(!Array.isArray(found))throw new Error('Invalid source response');
          if(!active())break;sourceFailures.search=0;job.successfulSearches++;job.sourceCounts.queries++;
          if(found.partialError)job.errors.push({code:'PARTIAL_QUERY',country,keyword,message:'Получена часть выдачи Google Play. Карточки сохранены для проверки.'});
          if(found.length>=job.config.limit)job.truncatedQueries++;
          for(const app of found)add(app,country,keyword);
        }catch(error){if(signal?.aborted)throw error;if(sourceFailure(error,{country,keyword}))halt=true;}
        job.searchDone++;if(active()&&!halt)await wait();
      }
    })).catch(error=>{if(!signal?.aborted)job.errors.push(errorEntry(error,{}));});
    job.collecting=true;
    // Seed IDs enter the detail queue immediately; slow recommendations/index run alongside it.
    const extraPromise=(async()=>{
    if(job.config.profile==='business'&&!job.config.continuePending) {
      const country=job.config.phoneCountry || (job.config.countries.includes('DE')?'DE':job.config.countries[0]);
      for(const appId of job.config.seedApps) {
        const seedCountry=job.config.seedCountries?.[appId]??country;
        add({appId},seedCountry,'Ваш образец / прямая ссылка','seed');job.sourceCounts.seeds++;

      }
      for(const appId of job.config.seedApps){if(!active()||haltAll)break;const seedCountry=job.config.seedCountries?.[appId]??country;if(job.config.related){await recommend(appId,seedCountry,0);job.searchDone++;await wait();}}
      if(job.config.useWebIndex && provider.research?.configured()) {
        const batch=job.config.referenceDiscovery?job.config.referenceDomains:[];
        for(const query of ['site:play.google.com/store/apps/details ("business account" OR "corporate account") (IBAN OR SEPA)','site:play.google.com/store/apps/details ("multicurrency account" OR "Euro IBAN")',...batch.map(domain=>`site:play.google.com/store/apps/details ("${domain}" OR "${domain.split('.')[0]}")`)]) {
          if(job.config.evidenceBudget&&job.braveRequests>=job.config.evidenceBudget)break;if(!active()||haltAll)return;job.current='Дополнительные карточки Google Play · Brave';job.braveRequests++;
          try {
            const found=await provider.research.search({q:query,count:20,search_lang:'en'});
            if(!Array.isArray(found))throw new Error('Invalid index response');job.braveSuccessfulRequests++;
            for(const result of found){const appId=parsePlayId(result.url);if(appId){add({appId,title:result.title,summary:result.description},null,query,'webIndex');job.sourceCounts.webIndex++;}}
          } catch(error) {if(signal?.aborted)throw error;job.enrichmentStopped=true;job.errors.push({code:'INDEX_SOURCE',message:'Не удалось проверить индекс Google Play в Brave. Сам Google Play продолжает работать; проверьте ключ и лимиты.'});break;}
          await pause(Math.max(delay,1100),signal);
        }
      }
    }
    })().catch(error=>{if(!signal?.aborted)job.errors.push(errorEntry(error,{}));});
    searchPromise=Promise.allSettled([queryPromise,extraPromise]).finally(()=>{searchComplete=true;job.collecting=false;changed();});
    while(!candidates.size&&!searchComplete&&active())await waitForSearch();
    if (!job.successfulSearches && !candidates.size) return finish("failed");
    // Retain related matches in repeated-run output without another network read.
    if(job.config.related||job.config.developerExpansion)for(let depth=0;depth<2;depth++)for(const known of knownFindings){const parent=(known.recommendationParents??[]).find(id=>candidates.has(id));if(parent&&!candidates.has(known.appId)&&isSeen(known.appId))add(known,known.detailCountry,'Сохранённая связь рекомендаций / разработчика','history_link',parent,depth+1);}
    job.phase = "details";
    let unseen = [...candidates.values()].filter((candidate) => {
      if (!isSeen(candidate.appId)) return true;
      const known=knownFindings.find(a=>a.appId===candidate.appId);
      if(known&&!(known.minInstalls<=job.config.minInstalls)&& (job.config.ignoreReleaseDate||known.released>=job.config.from&&known.released<=job.config.to))job.existingResults.push({...known,fromHistory:true});
      job.skipped.previouslySeen++;
      return false;
    });
    if(job.config.profile==='business')unseen.sort((a,b)=>Number(b.sources.has('seed'))-Number(a.sources.has('seed')) || Number(b.pending)-Number(a.pending) || Number(/IBAN|account|SEPA|business|сч[её]т/iu.test(b.hint))-Number(/IBAN|account|SEPA|business|сч[её]т/iu.test(a.hint)));
    if(job.config.maxDetails&&unseen.length>job.config.maxDetails){job.errors.push({code:'DETAIL_BUDGET',message:`Найдено ${unseen.length} уникальных карточек. Проверяются первые ${job.config.maxDetails}; увеличьте лимит карточек для расширения проверки.`});overflow=unseen.slice(job.config.maxDetails);unseen=unseen.slice(0,job.config.maxDetails);}
    job.detailTotal = unseen.length;
    const queuedIds=new Set(candidates.keys());
    queueState=[...unseen,...overflow];await onBacklog(serialize(queueState),job.config);
    const enqueueNew=()=>{for(const added of candidates.values()){if(queuedIds.has(added.appId))continue;queuedIds.add(added.appId);if(isSeen(added.appId)){const known=knownFindings.find(a=>a.appId===added.appId);if(known&&!job.existingResults.some(a=>a.appId===known.appId))job.existingResults.push({...known,fromHistory:true});job.skipped.previouslySeen++;continue;}if(!job.config.maxDetails||unseen.length<job.config.maxDetails)unseen.push(added);else overflow.push(added);}};
    for (let detailIndex=0;(enqueueNew(),detailIndex<unseen.length||!searchComplete);detailIndex++) {
      if(detailIndex>=unseen.length){await waitForSearch();enqueueNew();detailIndex--;continue;}

      if(haltAll)return finish(job.results.length||job.reviewCandidates.length?'partial':'failed');
      const candidate=unseen[detailIndex];
      if (!active()) return finish("cancelled");
      job.current = candidate.appId;
      let detail;
      for (const country of new Set([...candidate.detailCountries,...job.config.countries])) {
        try {
          const response = await provider.app({
            appId: candidate.appId,
            country: country.toLowerCase(),
            lang: "en",
          });
          if (!response?.title || !response.genreId)
            throw new Error("Invalid app data");
          detail = { ...response, country };
          sourceFailures.detail=0;
          break;
        } catch (error) {
          if(signal?.aborted)throw error;
          if(sourceFailure(error,{appId:candidate.appId,country}))return finish(job.results.length||job.reviewCandidates.length?'partial':'failed');
        }
        await wait();
      }
      if (!active()) return finish("cancelled");
      if (!detail){job.skipped.details++;retry.push(candidate);}
      else {
        let reason = exclusion(detail, job.config) || excluded({
          text: `${detail.title} ${detail.developer} ${detail.summary} ${plainText(detail.description)}`,
          appId: candidate.appId, url: detail.developerWebsite,developerAddress:detail.developerAddress,developerCountry:detail.developerCountry,
        }, job.config);
        const appURL = `https://play.google.com/store/apps/details?id=${encodeURIComponent(candidate.appId)}&gl=${detail.country}`;
        const documents = [{ title:detail.title, text: `${detail.title}. ${plainText(detail.description || detail.summary)}`, url: appURL, label: "Описание Google Play" }];
        let qualification = assessBanking(documents, job.config);
        let discovery = assessDiscovery(documents,job.config,qualification,candidate.appId);
        let siteIndexCheckedAt = null;
        const site = developerURL(detail.developerWebsite);
        if (job.source!=='neural' && !reason && (job.config.strictBanking ? qualification.status !== "text_matches" : job.config.profile==='business' && (discovery.status!=='not_relevant') && discovery.euIban==='unknown') && site && !job.enrichmentStopped && provider.research?.configured()) {
          if (job.config.evidenceBudget&&(job.config.profile==='business'?job.braveRequests:job.enrichmentRequests) >= job.config.evidenceBudget) {
            if (!job.errors.some(e => e.code === 'EVIDENCE_LIMIT')) job.errors.push({code:'EVIDENCE_LIMIT',message:`Достигнут лимит ${job.config.evidenceBudget} обращений Brave за запуск. Остальные карточки проверяются по описанию; лимит можно увеличить в CRM.`});
          } else {
            job.enrichmentRequests++;job.braveRequests++;
            try {
              const results = await provider.research.search({q:`site:${site.hostname.replace(/^www\./, "")} ("business account" OR "corporate account") (IBAN OR "banking licence" OR "licensed bank")`,count:5,search_lang:'en'});
              if (!Array.isArray(results)) throw new Error('Invalid research response');
              job.braveSuccessfulRequests++;siteIndexCheckedAt=new Date().toISOString();
              for (const result of results) {
                const u = publicURL(result.url);
                if (!u || !(u.hostname.replace(/^www\./, "") === site.hostname.replace(/^www\./, "") || u.hostname.endsWith(`.${site.hostname.replace(/^www\./, "")}`))) continue;
                if (excluded({text:`${result.title} ${result.description}`,url:u.href},job.config)) continue;
                documents.push({text:`${plainText(result.title)}. ${plainText(result.description)}. ${(Array.isArray(result.extra_snippets)?result.extra_snippets:[]).slice(0,5).map(plainText).join('. ')}`,url:u.href,label:'Сайт разработчика · фрагмент поискового индекса'});
              }
              qualification = assessBanking(documents, job.config);
              discovery = assessDiscovery(documents,job.config,qualification,candidate.appId);
            } catch(error) {
              if(signal?.aborted)throw error;
              job.errors.push({code:'EVIDENCE_SOURCE',appId:candidate.appId,message:'Не удалось проверить сайт через Brave. Проверка ограничена описанием приложения; проверьте ключ и лимиты API.'});
              // Avoid repeated paid failures during this run.
              job.enrichmentStopped = true;
            }
            await pause(Math.max(delay,1100),signal);
          }
        }
        if (!active()) return finish('cancelled');
        if(!reason && job.config.profile==='business' && discovery.status!=='service_match') reason='banking';
        if (!reason && job.config.strictBanking && qualification.status !== 'text_matches') {
          reason = 'banking';
          for (const missing of qualification.missing) job.bankingMissing[missing]++;
        }
        const entry = {
            appId: candidate.appId,
            title: detail.title,
            developer: detail.developer ?? "",
            developerAddress:detail.developerAddress??null,developerCountry:detail.developerCountry??null,
            developerId:detail.developerId??null,
            genreId:detail.genreId,genre:detail.genre,
            recommendationParents:[...candidate.parents],
            summary: detail.summary ?? "",
            developerWebsite: site?.href ?? null,
            siteIndexCheckedAt,
            updatedAt: Number.isFinite(detail.updated) ? new Date(detail.updated).toISOString() : null,
            qualification,
            ...(job.config.profile==='business'?{discovery}:{}),
            discoverySources:[...candidate.sources],
            isReference:candidate.sources.has('seed'),
            screeningText: plainText(detail.description || detail.summary).slice(0,30000),
            installs: detail.installs ?? `${detail.minInstalls}+`,
            minInstalls: detail.minInstalls,
            released: releaseDate(detail.released),
            score: Number.isFinite(detail.score) ? detail.score : null,
            countries: [...candidate.countries].sort(),
            keywords: [...candidate.keywords],
            detailCountry: detail.country,
            url: `https://play.google.com/store/apps/details?id=${encodeURIComponent(candidate.appId)}&gl=${detail.country}`,
            checkedAt: new Date().toISOString(),
        };
        if(!['excludedTerm','excludedId','excludedDomain'].includes(reason))await onRawCandidate({...entry,preliminaryReason:reason});
        if(!reason || reason==='banking'&&discovery.isCandidate){
          await recommend(candidate.appId,detail.country,candidate.depth);
          const devId=detail.developerId??detail.developer;
          if(!haltAll&&job.config.developerExpansion&&provider.developer&&devId&&!expandedDevelopers.has(devId)&&(!job.config.developerBudget||expandedDevelopers.size<job.config.developerBudget)){
            expandedDevelopers.add(devId);job.developerChecks++;
            try{const rows=await provider.developer({devId,country:detail.country.toLowerCase(),lang:'en',num:100});if(!Array.isArray(rows))throw new Error('Invalid developer list');for(const row of rows)add(row,detail.country,`Разработчик ${detail.developer}`,'developer',candidate.appId,1);job.sourceCounts.developers+=rows.length;}
            catch(error){if(signal?.aborted)throw error;job.warnings.push(`Список приложений разработчика ${detail.developer} недоступен.`);}
          }
        }
        if (reason) {
          job.skipped[reason]++;
          if (job.filterExamples.length < 30) job.filterExamples.push({appId:entry.appId,title:entry.title,released:entry.released,reason,missing:qualification.missing,url:entry.url});
          if (reason === 'banking' && (job.config.profile==='business'?discovery.isCandidate:qualification.isCandidate)) {
            const candidate = await onCandidate(entry);
            if (candidate) job.reviewCandidates.push(candidate);
          }
        } else {
          const match = await onMatch(entry);
          if (match) job.results.push(match);
          else job.skipped.previouslySeen++;
        }
      }
      enqueueNew();
      processedIds.add(candidate.appId);job.detailDone++;job.detailTotal=unseen.length;
      queueState=[...unseen.slice(detailIndex+1),...overflow,...retry];job.pendingCount=queueState.length;
      await wait();
    }
    if(overflow.length&&!job.errors.some(e=>e.code==='DETAIL_BUDGET'))job.errors.push({code:'DETAIL_BUDGET',message:`Осталось ${overflow.length} карточек. Они сохранены для продолжения проверки.`});
    for(const entry of [...job.results,...job.reviewCandidates]){const found=candidates.get(entry.appId);if(found){entry.countries=[...found.countries].sort();entry.keywords=[...found.keywords];}}
    job.results.sort(
      (a, b) =>
        (b.released ?? "").localeCompare(a.released ?? "") || b.minInstalls - a.minInstalls,
    );
    finish(halt&&!job.results.length&&!job.reviewCandidates.length?"failed":job.errors.length ? "partial" : "complete");
  } catch (error) {
    if(signal?.aborted){finish('cancelled');return;}
    job.errors.push(errorEntry(error, {}));
    finish('failed');
  } finally {
    await searchPromise;
    if(queueState===null&&candidates.size)queueState=[...candidates.values()].filter(c=>!isSeen(c.appId));
    if(queueState!==null){const ids=new Set(queueState.map(c=>c.appId));for(const c of candidates.values())if(!processedIds.has(c.appId)&&!isSeen(c.appId)&&!ids.has(c.appId)){queueState.push(c);ids.add(c.appId);}}
    if(queueState!==null){job.pendingCount=queueState.length;try{await onBacklog(serialize(queueState),job.config);}catch(error){job.errors.push(errorEntry(error,{}));finish('failed');job.status='failed';}}
  }
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function toCSV(job) {
  const rows = [
    [
      "Приложение",
      "Разработчик",
      "ID",
      "Дата выпуска",
      "Установки (мир)",
      "Рейтинг",
      "Страны в выдаче",
      "Запросы",
      "Ссылка",
      "Проверено",
      "Впервые найдено",
      "Статус поиска",
      "Отбор бизнес-счёта / EU IBAN / лицензии",
      "Доказательства из источника",
      "Совпадение с профилем сервиса",
      "Бизнес в описании",
      "IBAN в описании",
      "EU IBAN",
      "Источники обнаружения",
    ],
  ];
  for (const app of job.results)
    rows.push([
      app.title,
      app.developer,
      app.appId,
      app.released,
      app.installs,
      app.score,
      app.countries.join(", "),
      app.keywords.join(", "),
      app.url,
      app.checkedAt,
      app.firstFoundAt,
      job.status,
      app.qualification?.status ?? "Не перепроверено",
      Object.values(app.qualification?.evidence ?? {}).flat().map(e => `${e.label}: ${e.text} (${e.url})`).join(" | "),
      app.discovery?.status,app.discovery?.business,app.discovery?.iban,app.discovery?.euIban,(app.discoverySources??[]).join(", "),
    ]);
  return (
    "\ufeff" +
    rows.map((row) => row.map(csvCell).join(";")).join("\r\n") +
    "\r\n"
  );
}
