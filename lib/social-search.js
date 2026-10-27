import{pause}from'./run-context.js';
import {assessLaunch} from './launches.js';
import { assessDiscovery } from './discovery.js';
import { validateCriteria, excluded, assessBanking, publicURL } from "./qualification.js";
import { createHash } from "node:crypto";

import { SOCIAL_SOURCES, DEFAULT_SOCIAL_SOURCES, SOCIAL_QUERIES, BUSINESS_SOCIAL_QUERIES, sourceRestriction, socialPlan,activeSocialSources } from './source-catalog.js';
export { SOCIAL_SOURCES, DEFAULT_SOCIAL_SOURCES, SOCIAL_QUERIES, BUSINESS_SOCIAL_QUERIES, sourceRestriction } from './source-catalog.js';

function canonicalResult(raw, source, config) {
  if (['linkedin','facebook'].includes(source)) return canonicalPost(raw);
  const u = publicURL(raw), definition = SOCIAL_SOURCES.find(s => s.id === source);
  if (!u || !definition) return null;
  const allowed = source === 'custom' ? config.watchDomains : definition.domains;
  if (allowed.length && !allowed.some(d => u.hostname === d || u.hostname.endsWith(`.${d}`))) return null;

  if(source==='reddit'){const m=u.pathname.match(/^\/r\/(fintech|smallbusiness|digitalnomad|eupersonalfinance)\/comments\/([a-z0-9]+)(?:\/|$)/i);if(!m)return null;u.hostname='www.reddit.com';u.pathname=`/r/${m[1].toLowerCase()}/comments/${m[2]}`;u.search='';}
  if(source==='forums'){const m=u.pathname.match(/^(\/(?:forums\/)?threads\/[^/]+)/i);if(!m)return null;u.pathname=m[1];u.search='';}
  if (source === 'web' && /(?:^|\.)(?:linkedin\.com|facebook\.com|play\.google\.com|apps\.apple\.com)$/.test(u.hostname)) return null;
  for (const key of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$)/i.test(key)) u.searchParams.delete(key);
  // App Store country prefixes and product slugs point to the same app identity.
  const app = source === 'appstore' ? u.pathname.match(/\/id(\d+)/) : null;
  if (source === 'appstore' && !app) return null;
  u.pathname=u.pathname.replace(/\/$/,'') || '/'; u.searchParams.sort();
  return {source,url:u.href,key:app?`appstore:${app[1]}`:`web:${u.href}`};
}

export function validateSocialConfig(input = {}, now = new Date()) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Некорректные параметры поиска публикаций.");
  const sources = input.sources ?? DEFAULT_SOCIAL_SOURCES;
  const watchDomains = input.watchDomains ?? [];
  if (!Array.isArray(watchDomains) || watchDomains.length > 10 || watchDomains.some(d => typeof d !== 'string' || !publicURL(`https://${d}`) || new URL(`https://${d}`).hostname !== d || d.length > 100)) throw new Error('Мои сайты: до 10 доменов без https и пути, например example.com.');
  if (Array.isArray(sources) && sources.includes('custom') && !watchDomains.length) throw new Error('Добавьте домены для источника «Мои сайты».');
  const eventMode=input.eventMode??'signals';
  if(!['launches','signals'].includes(eventMode))throw new Error('Выберите конкретные релизы или все сигналы.');
  const requestBudget=0;

  const queries = input.queries ?? (input.profile==='business' ? BUSINESS_SOCIAL_QUERIES : SOCIAL_QUERIES);
  const limit = input.limit ?? 20;
  const lookbackDays = input.lookbackDays ?? 30;
  if (
    !Array.isArray(sources) ||
    !sources.length ||
    sources.some((s) => !SOCIAL_SOURCES.some((x) => x.id === s))
  )
    throw new Error("Выберите хотя бы один источник.");
  if (
    !Array.isArray(queries) ||
    !queries.length ||
    queries.length > 24 ||
    queries.some((q) => typeof q !== "string" || !q.trim() || q.length > 250)
  )
    throw new Error("Укажите от 1 до 24 запросов, до 250 символов каждый.");
  if (![10, 20].includes(limit))
    throw new Error("Глубина поиска публикаций: 10 или 20.");
  if (![7, 30].includes(lookbackDays))
    throw new Error("Период свежести: 7 или 30 дней.");
  for (const query of queries)
    for (const source of activeSocialSources({sources,eventMode})) {
      const q = `${sourceRestriction(source, {watchDomains})} ${query.trim()}`;
      if (q.length > 400 || q.split(/\s+/).length > 50)
        throw new Error(
          "Сократите запрос: вместе с ограничением соцсети допустимо 400 символов и 50 слов.",
        );
    }
  if(!activeSocialSources({sources,eventMode}).length&&!sources.every(s=>s==='appstore'))throw new Error('Для релизов выберите новости, объявления, соцсети или веб-поиск; обсуждения доступны в режиме всех сигналов.');
  return {
    eventMode,
    ...validateCriteria(input),
    requestBudget,
    watchDomains: [...new Set(watchDomains)],
    sources: [...new Set(sources)],
    queries: [...new Set(queries.map((q) => q.trim()))],
    limit,
    lookbackDays,
    since: new Date(+now - lookbackDays * 86400000).toISOString(),
    until: now.toISOString(),
  };
}

export function socialFilters(config) {
  const { sources, queries, limit, lookbackDays } = config;
  return { eventMode:config.eventMode,sources, queries, limit, lookbackDays, requestBudget:config.requestBudget, watchDomains: config.watchDomains, ...validateCriteria(config) };
}

export function canonicalPost(raw) {
  if (typeof raw !== "string" || raw.length > 4096) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port
  )
    return null;
  const host = url.hostname.toLowerCase();
  if (host === "linkedin.com" || host.endsWith(".linkedin.com")) {
    let path;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      return null;
    }
    const activity = path.match(/(?:activity-|urn:li:activity:)(\d{10,})/);
    if (activity)
      return {
        source: "linkedin",
        url: `https://www.linkedin.com/feed/update/urn:li:activity:${activity[1]}`,
        key: `linkedin:activity:${activity[1]}`,
      };
    if (
      !/^\/(?:posts\/[^/]+|feed\/update\/urn:li:(?:share|ugcPost):[^/]+)\/?$/.test(
        path,
      )
    )
      return null;
    path = path.replace(/\/$/, "");
    return {
      source: "linkedin",
      url: `https://www.linkedin.com${path}`,
      key: `linkedin:${path}`,
    };
  }
  if (host !== "facebook.com" && !host.endsWith(".facebook.com")) return null;
  let post = url.pathname.match(/^\/[^/]+\/posts\/([^/]+)\/?$/);
  if (post)
    return {
      source: "facebook",
      url: `https://www.facebook.com${url.pathname.replace(/\/$/, "")}`,
      key: `facebook:post:${post[1].replace(/^\d+_(\d+)$/, "$1")}`,
    };
  if (["/permalink.php", "/story.php"].includes(url.pathname)) {
    const id = url.searchParams.get("story_fbid"),
      owner = url.searchParams.get("id");
    if (!id || !owner || !/^[a-zA-Z0-9]+$/.test(id) || !/^\d+$/.test(owner))
      return null;
    return {
      source: "facebook",
      url: `https://www.facebook.com/permalink.php?story_fbid=${encodeURIComponent(id)}&id=${owner}`,
      key: `facebook:post:${id}`,
    };
  }
  const group = url.pathname.match(
    /^\/groups\/([^/]+)\/(?:posts|permalink)\/([^/]+)\/?$/,
  );
  if (group)
    return {
      source: "facebook",
      url: `https://www.facebook.com/groups/${group[1]}/posts/${group[2]}`,
      key: `facebook:post:${group[2]}`,
    };
  return null;
}

const REGIONS = [
  [
    "Европа",
    /\beurop(?:e|ean|éen|a)\b|\beu\b|\beea\b|европ|евросоюз|(?<!\p{L})ес(?!\p{L})/iu,
  ],
  [
    "Великобритания",
    /\buk\b|united kingdom|britain|british|london|великобрит|британ|лондон/iu,
  ],
  ["Германия", /germany|german\b|deutschland|berlin|герман|берлин/iu],
  ["Франция", /france|french|paris|франци|париж/iu],
  ["Испания", /spain|spanish|españa|madrid|испан/iu],
  ["Италия", /italy|italian|italia|milan|итал/iu],
  ["Нидерланды", /netherlands|dutch|amsterdam|нидерланд/iu],
  ["Польша", /poland|polish|polska|warsaw|польш|польск/iu],
  ["Ирландия", /ireland|irish|dublin|ирланд/iu],
  ["Швейцария", /switzerland|swiss|schweiz|zurich|швейцар/iu],
  ["Норвегия", /norway|norwegian|oslo|норвег/iu],
  ["Швеция", /sweden|swedish|stockholm|швец|швед/iu],
  ["Дания", /denmark|danish|copenhagen|дани[яию]|датск/iu],
  ["Финляндия", /finland|finnish|helsinki|финлянд/iu],
  ["Австрия", /austria|vienna|австри/iu],
  ["Бельгия", /belgium|belgian|brussels|бельги/iu],
  ["Португалия", /portugal|portuguese|lisbon|португал/iu],
  ["Эстония", /estonia|tallinn|эстони/iu],
  ["Латвия", /latvia|riga\b|латви/iu],
  ["Литва", /lithuania|vilnius|литв/iu],
  ["Люксембург", /luxembourg|люксембург/iu],
  ["Мальта", /malta|мальт/iu],
  ["Кипр", /cyprus|кипр/iu],
  ["Чехия", /czech|czechia|prague|чехи/iu],
  ["Словакия", /slovakia|bratislava|словаки/iu],
  ["Словения", /slovenia|ljubljana|словени/iu],
  ["Хорватия", /croatia|zagreb|хорват/iu],
  ["Греция", /greece|greek|athens|греци/iu],
  ["Румыния", /romania|bucharest|румын/iu],
  ["Болгария", /bulgaria|болгар/iu],
  ["Венгрия", /hungary|hungarian|budapest|венгр/iu],
  ["Исландия", /iceland|исланд/iu],
  ["Лихтенштейн", /liechtenstein|лихтенштейн/iu],
  ["Сербия", /serbia|belgrade|серби/iu],
  ["Черногория", /montenegro|черногор/iu],
  ["Босния и Герцеговина", /bosnia|herzegovina|босни/iu],
  ["Албания", /albania|албани/iu],
  ["Северная Македония", /north macedonia|северн.{0,4}македон/iu],
  ["Украина", /ukraine|kyiv|украин/iu],
  ["Молдова", /moldova|молдов/iu],
  ["Андорра", /andorra|андорр/iu],
  ["Монако", /monaco|монако/iu],
  ["Сан-Марино", /san marino|сан.марино/iu],
  ["Беларусь", /belarus|беларус/iu],
  ["Турция", /turkey|türkiye|istanbul|турци/iu],
  ["Грузия", /georgia|tbilisi|грузи/iu],
];

function plain(value) {
  return String(value ?? "")
    .slice(0, 5000)
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function evaluatePost(result, source, config, now = new Date()) {
  const canonical = canonicalResult(result.url, source, config);
  if (!canonical || canonical.source !== source) return { reason: "notPost" };
  const title = plain(result.title),
    snippet = plain([result.description, ...(Array.isArray(result.extra_snippets) ? result.extra_snippets.slice(0,5) : [])].filter(x => typeof x === 'string').join('. '));
  const text = `${title} ${snippet}`;
  const blocked = excluded({text,url:canonical.url},config);
  if (blocked) return {reason:blocked};
  const launch=assessLaunch({title,snippet});
  if(config.eventMode==='launches'&&launch.kind!=='live_launch')return {reason:launch.kind==='commentary'?'commentary':launch.kind==='planned_launch'?'planned':'notLaunch'};
  const documents=[{title,text:`${title}. ${snippet}`,url:canonical.url,label:'Фрагмент поискового индекса'}];
  const qualification = assessBanking(documents, config);
  const discovery=assessDiscovery(documents,config,qualification,canonical.url);
  const business =
    /\bbusiness\b|\bsme\b|\bcorporate\b|\bentrepreneur|\bfreelanc|бизнес|предприним|компани|geschäft|unternehmen|professionnel/iu.test(
      text,
    );
  const bank =
    /neobank|neo.bank|digital bank|challenger bank|\bbank(?:ing)?\b|необанк|банк|business account|бизнес.сч[её]т/iu.test(
      text,
    );
  const launchWord =
    /launch|introduc|now available|unveil|debut|roll.?out|new (?:bank|neobank|business account)|запуск|запуст|нов(?:ый|ого|ая|ые|ых)|открыли|вышел|startet|lancement|lanzamiento/iu.test(
      text,
    );
  const definition=SOCIAL_SOURCES.find(s=>s.id===source);
  const registerLead=config.profile==='business' && definition.category==='register' && /licen[cs]|authori[sz]|regist|payment institution|electronic money|банк|лиценз/iu.test(text);
  const directoryLead=config.profile==='business' && definition.category==='directory' && discovery.status==='needs_review';
  if (!registerLead && !directoryLead && ((config.profile==='business' ? discovery.status!=='service_match' : !business || !bank) || (SOCIAL_SOURCES.find(s => s.id === source).launch && !launchWord))) return { reason: "topic" };
  const regions = REGIONS.filter(([, pattern]) => pattern.test(text)).map(
    ([name]) => name,
  );
  if (!regions.length && !qualification.evidence.euIban.length && !(config.profile==='business' && discovery.status==='service_match') && !registerLead && !directoryLead) return { reason: "geography" };
  if (!regions.length) regions.push(qualification.evidence.euIban.length ? "Заявлен IBAN страны ЕС" : "Регион обслуживания не подтверждён");
  if (config.strictBanking && qualification.status !== 'text_matches') return {reason:'banking'};
  let dateReported = null;
  const candidateDate = definition.noFreshness ? null : result.page_age;
  if (
    typeof candidateDate === "string" &&
    /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(candidateDate)
  ) {
    const timestamp = Date.parse(candidateDate);
    if (Number.isFinite(timestamp))
      dateReported = new Date(timestamp).toISOString();
  }
  if (
    dateReported &&
    (dateReported.slice(0, 10) < config.since.slice(0, 10) ||
      dateReported > new Date(+now + 86400000).toISOString())
  )
    return { reason: "date" };
  return {
    post: {
      qualification,
      launch,
      sourceCategory:definition.category,
      signalType:registerLead?'register_lead':directoryLead?'directory_lead':definition.category==='community'?'community_report':'publication',
      trust:definition.category==='community'?'user_report':definition.category==='register'?'register_reference':'source_claim',
      ...(config.profile==='business'?{discovery}:{}),
      id: `${["linkedin","facebook"].includes(source) ? source : "discovery"}:${createHash("sha256").update(canonical.key).digest("hex")}`,
      source,
      canonicalKey: canonical.key,
      title,
      snippet,
      url: canonical.url,
      mentionedRegions: regions,
      dateReported,
      dateLabel: dateReported
        ? "Дата по данным поисковика"
        : "Дата публикации не указана",
      reviewStatus: "needs_review",
      reason:
        registerLead ? 'Ссылка из реестра: требуется установить организацию, действующее разрешение и продукт. Это не сообщение о новом банке.' : directoryLead ? 'Молодая компания или предварительный анонс: работающие бизнес-счета нужно проверить.' : definition.category==='community' ? 'Сообщение пользователя форума. Условия счёта и выдачу EU IBAN подтвердите у самого сервиса.' : 'Источник упоминает финансовый сервис; запуск и доступность бизнес-счёта требуют проверки.',
      checkedAt: now.toISOString(),
    },
  };
}

export function socialError(error) {
  if(error.code==='BRAVE_BUDGET')return {code:'RATE_LIMIT',message:'Достигнут общий месячный лимит Brave в программе. Он действует на все источники. Проверьте BRAVE_MONTHLY_REQUEST_LIMIT и квоту API.'};
  if (error.code === "PERSISTENCE_ERROR")
    return {
      code: error.code,
      message:
        "Не удалось сохранить историю публикаций. Проверьте папку data и свободное место.",
    };
  if (error.code === "MISSING_KEY")
    return {
      code: error.code,
      message:
        "Добавьте BRAVE_SEARCH_API_KEY в защищённые настройки хостинга. Пароль соцсети не нужен.",
    };
  if (error.status === 401)
    return {
      code: "AUTH_REQUIRED",
      message:
        "Поисковый API отклонил ключ. Проверьте BRAVE_SEARCH_API_KEY в настройках хостинга.",
    };
  if (error.status === 403)
    return {
      code: "ACCESS_DENIED",
      message:
        "Доступ к поисковому API отклонён. Проверьте ключ, тариф и доступ к api.search.brave.com.",
    };
  if (error.status === 429)
    return {
      code: "RATE_LIMIT",
      message:
        "Исчерпан лимит или превышена частота запросов Brave Search API. Проверьте тариф перед повторным запуском.",
    };
  if (error.code === "API_TIMEOUT")
    return { code: "TIMEOUT", message: "Поисковый API не ответил вовремя." };
  return {
    code: "SOURCE_ERROR",
    message:
      "Не удалось получить или разобрать ответ поискового API. Результаты могут быть неполными.",
  };
}

export function createSocialJob(id, config, now=new Date()) {
  const plan=socialPlan(config,now);
  return {
    id,
    config,
    status: "running",
    phase: "search",
    createdAt: new Date().toISOString(),
    finishedAt: null,
    current: "",
    searchDone: 0,
    searchTotal: plan.requests.length,
    plannedRequests:plan.requests,
    rotationTotal:plan.total,
    rotationDays:plan.cycleDays,
    requestsMade:0,
    sourceStatus:[],
    successfulSearches: 0,
    scanned: 0,
    truncatedQueries: 0,
    results: [],
    errors: [],
    skipped: {
      commentary:0,planned:0,notLaunch:0,
      banking: 0,
      excludedNigeria:0, excludedTerm: 0,
      excludedDomain: 0,
      excludedId: 0,
      notPost: 0,
      topic: 0,
      geography: 0,
      date: 0,
      previouslySeen: 0,
      duplicate: 0,
    },
  };
}

export async function runSocialSearch(
  job,
  provider,
  {
    signal,
    delay = 1100,
    isSeen = () => false,
    onMatch = async (post) => post,
    onRawCandidate = async()=>{},
    clock = () => new Date(),
  } = {},
) {
  const runSeen = new Set();
  const active = () => job.status === "running";
  try {
    for (const {source,query} of job.plannedRequests ?? socialPlan(job.config,clock()).requests) {
        if (!active()) break;
        job.current = `${SOCIAL_SOURCES.find((s) => s.id === source).name} · ${query}`;
        const q = `${sourceRestriction(source, job.config)} ${query}`;
        let results;
        try {
          job.requestsMade++;
          const response = await provider.search({
            q,allPages:true,onPage:offset=>{if(offset)job.requestsMade++;},
            count: job.config.limit,
            freshness: SOCIAL_SOURCES.find(s=>s.id===source).noFreshness ? undefined : job.config.lookbackDays === 7 ? "pw" : "pm",
            search_lang: /[а-яё]/iu.test(query) ? "ru" : "en",
          });
          if (!Array.isArray(response))
            throw new Error("Malformed source response");
          results = response;if(response.partialError)job.errors.push({code:'PARTIAL_QUERY',source,query,message:'Следующая страница выдачи недоступна; полученная часть сохранена.'});
          job.successfulSearches++;
          job.sourceStatus.push({source,query,status:'ok',returned:results.length});
        } catch (error) {
          if(signal?.aborted)throw error;
          const entry = { ...socialError(error), source, query };
          job.errors.push(entry);
          job.sourceStatus.push({source,query,status:'error',code:entry.code});
          job.searchDone++;
          if (
            [
              "MISSING_KEY",
              "AUTH_REQUIRED",
              "ACCESS_DENIED",
              "RATE_LIMIT",
            ].includes(entry.code)
          ) {
            if (active()) job.status = "failed";
            break;
          }
          if (active())
            await pause(delay,signal);
          continue;
        }
        if (results.length >= job.config.limit) job.truncatedQueries++;
        for (const result of results) {
          if (!active()) break;
          job.scanned++;
          const { post, reason } = evaluatePost(
            result,
            source,
            job.config,
            clock(),
          );
          const raw=canonicalResult(result.url,source,job.config);
          if(raw&&[null,'excludedNigeria'].includes(excluded({text:`${result.title} ${result.description}`,url:raw.url},job.config)))await onRawCandidate(post??{title:plain(result.title),url:raw.url,snippet:plain([result.description,...(Array.isArray(result.extra_snippets)?result.extra_snippets:[])].join('. ')),source,preliminaryReason:reason});
          if (!post) {
            job.skipped[reason]++;
            continue;
          }
          if (runSeen.has(post.id)) {
            job.skipped.duplicate++;
            continue;
          }
          runSeen.add(post.id);
          if (isSeen(post.id)) {
            job.skipped.previouslySeen++;
            continue;
          }
          const saved = await onMatch({ ...post, query });
          if (saved) job.results.push(saved);
          else job.skipped.previouslySeen++;
        }
        job.searchDone++;
        if (active())
          await pause(delay,signal);
      }
    if (active())
      job.status = !job.successfulSearches
        ? "failed"
        : job.errors.length
          ? "partial"
          : "complete";
  } catch (error) {
    if(!signal?.aborted)job.errors.push(socialError(error));
    if (active()) job.status = "failed";
  }
  job.finishedAt = clock().toISOString();
  job.current = "";
}

export function socialCSV(job) {
  const cell = (value) => {
    let text = String(value ?? "");
    if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const rows = [
    [
      "Источник",
      "Заголовок",
      "Фрагмент",
      "Ссылка",
      "Регионы в тексте",
      "Дата по данным поисковика",
      "Впервые найдено",
      "Проверка",
      "Статус поиска",
      "Отбор EU IBAN / бизнес / лицензия",
      "Доказательства",
      "Тип сигнала",
      "Доверие к источнику",
    ],
  ];
  for (const post of job.results)
    rows.push([
      post.source,
      post.title,
      post.snippet,
      post.url,
      post.mentionedRegions.join(", "),
      post.dateReported,
      post.firstFoundAt,
      "Требует проверки новизны банка",
      job.status,
      post.qualification?.status ?? "Не перепроверено",
      Object.values(post.qualification?.evidence ?? {}).flat().map(e => `${e.text} (${e.url})`).join(" | "),
      post.signalType,post.trust,
    ]);
  return (
    "\ufeff" + rows.map((row) => row.map(cell).join(";")).join("\r\n") + "\r\n"
  );
}
