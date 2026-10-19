import { createHash } from "node:crypto";

export const SOCIAL_SOURCES = [
  {
    id: "linkedin",
    name: "LinkedIn",
    restriction: "(site:linkedin.com/posts/ OR site:linkedin.com/feed/update/)",
  },
  { id: "facebook", name: "Facebook", restriction: "site:facebook.com" },
];

export const SOCIAL_QUERIES = [
  '(neobank OR "digital bank") (business OR SME) (launch OR launched) (Europe OR European OR EU OR UK)',
  '("business account" OR "business banking") (launch OR introducing) (Germany OR France OR Spain OR Italy OR Netherlands OR Poland)',
  '(neobank OR "business bank") (launch OR new) (Switzerland OR Norway OR Sweden OR Denmark OR Finland OR Ireland)',
  '(необанк OR "бизнес счет") (запуск OR новый) (Европа OR ЕС OR Великобритания)',
];

export function validateSocialConfig(input = {}, now = new Date()) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Некорректные параметры поиска публикаций.");
  const sources = input.sources ?? SOCIAL_SOURCES.map((s) => s.id);
  const queries = input.queries ?? SOCIAL_QUERIES;
  const limit = input.limit ?? 20;
  const lookbackDays = input.lookbackDays ?? 30;
  if (
    !Array.isArray(sources) ||
    !sources.length ||
    sources.some((s) => !SOCIAL_SOURCES.some((x) => x.id === s))
  )
    throw new Error("Выберите LinkedIn или Facebook.");
  if (
    !Array.isArray(queries) ||
    !queries.length ||
    queries.length > 8 ||
    queries.some((q) => typeof q !== "string" || !q.trim() || q.length > 250)
  )
    throw new Error("Укажите от 1 до 8 запросов, до 250 символов каждый.");
  if (![10, 20].includes(limit))
    throw new Error("Глубина поиска публикаций: 10 или 20.");
  if (![7, 30].includes(lookbackDays))
    throw new Error("Период свежести: 7 или 30 дней.");
  for (const query of queries)
    for (const source of sources) {
      const q = `${SOCIAL_SOURCES.find((s) => s.id === source).restriction} ${query.trim()}`;
      if (q.length > 400 || q.split(/\s+/).length > 50)
        throw new Error(
          "Сократите запрос: вместе с ограничением соцсети допустимо 400 символов и 50 слов.",
        );
    }
  return {
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
  return { sources, queries, limit, lookbackDays };
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
  const canonical = canonicalPost(result.url);
  if (!canonical || canonical.source !== source) return { reason: "notPost" };
  const title = plain(result.title),
    snippet = plain(result.description);
  const text = `${title} ${snippet}`;
  const business =
    /\bbusiness\b|\bsme\b|\bcorporate\b|\bentrepreneur|\bfreelanc|бизнес|предприним|компани|geschäft|unternehmen|professionnel/iu.test(
      text,
    );
  const bank =
    /neobank|neo.bank|digital bank|challenger bank|\bbank(?:ing)?\b|необанк|банк|business account|бизнес.сч[её]т/iu.test(
      text,
    );
  const launch =
    /launch|introduc|now available|unveil|debut|roll.?out|new (?:bank|neobank|business account)|запуск|запуст|нов(?:ый|ого|ая|ые|ых)|открыли|вышел|startet|lancement|lanzamiento/iu.test(
      text,
    );
  if (!business || !bank || !launch) return { reason: "topic" };
  const regions = REGIONS.filter(([, pattern]) => pattern.test(text)).map(
    ([name]) => name,
  );
  if (!regions.length) return { reason: "geography" };
  let dateReported = null;
  const candidateDate = result.page_age;
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
      id: `${source}:${createHash("sha256").update(canonical.key).digest("hex")}`,
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
        "В тексте есть признаки запуска бизнес-банкинга и упоминание Европы. Новизна банка и доступность услуг требуют проверки.",
      checkedAt: now.toISOString(),
    },
  };
}

export function socialError(error) {
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

export function createSocialJob(id, config) {
  return {
    id,
    config,
    status: "running",
    phase: "search",
    createdAt: new Date().toISOString(),
    finishedAt: null,
    current: "",
    searchDone: 0,
    searchTotal: config.sources.length * config.queries.length,
    successfulSearches: 0,
    scanned: 0,
    truncatedQueries: 0,
    results: [],
    errors: [],
    skipped: {
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
    delay = 1100,
    isSeen = () => false,
    onMatch = async (post) => post,
    clock = () => new Date(),
  } = {},
) {
  const runSeen = new Set();
  const active = () => job.status === "running";
  try {
    for (const source of job.config.sources)
      for (const query of job.config.queries) {
        if (!active()) break;
        job.current = `${SOCIAL_SOURCES.find((s) => s.id === source).name} · ${query}`;
        const q = `${SOCIAL_SOURCES.find((s) => s.id === source).restriction} ${query}`;
        let results;
        try {
          const response = await provider.search({
            q,
            count: job.config.limit,
            freshness: job.config.lookbackDays === 7 ? "pw" : "pm",
            search_lang: /[а-яё]/iu.test(query) ? "ru" : "en",
          });
          if (!Array.isArray(response))
            throw new Error("Malformed source response");
          results = response;
          job.successfulSearches++;
        } catch (error) {
          const entry = { ...socialError(error), source, query };
          job.errors.push(entry);
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
            await new Promise((resolve) => setTimeout(resolve, delay));
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
          await new Promise((resolve) => setTimeout(resolve, delay));
      }
    if (active())
      job.status = !job.successfulSearches
        ? "failed"
        : job.errors.length
          ? "partial"
          : "complete";
  } catch (error) {
    job.errors.push(socialError(error));
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
    ]);
  return (
    "\ufeff" + rows.map((row) => row.map(cell).join(";")).join("\r\n") + "\r\n"
  );
}
