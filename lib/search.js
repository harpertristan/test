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

export const DEFAULT_KEYWORDS = [
  "бизнес аккаунт",
  "бизнес банк",
  "бизнес счет",
];

export function calendarWindow(now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kaliningrad",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [year, month, day] = today.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 2, 1));
  const lastDay = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  first.setUTCDate(Math.min(day, lastDay));
  return { from: first.toISOString().slice(0, 10), to: today };
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
  const keywords = input.keywords ?? DEFAULT_KEYWORDS;
  if (
    !Array.isArray(keywords) ||
    !keywords.length ||
    keywords.length > 12 ||
    keywords.some((k) => typeof k !== "string" || !k.trim() || k.length > 100)
  ) {
    throw new Error(
      "Укажите от 1 до 12 запросов, каждый не длиннее 100 символов.",
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
  const window = calendarWindow(now);
  const from = input.from ?? window.from;
  const to = input.to ?? window.to;
  if (!isoDate(from) || !isoDate(to) || from > to || to > window.to)
    throw new Error("Проверьте период выпуска: конец не может быть в будущем.");
  const minInstalls = input.minInstalls ?? 100;
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
  return {
    keywords: [...new Set(keywords.map((k) => k.trim()))],
    countries: [...new Set(countries)],
    from,
    to,
    minInstalls,
    limit,
    category: "FINANCE",
    free: true,
  };
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
  if (app.genreId !== "FINANCE") return "category";
  if (app.free !== true || app.price !== 0) return "paid";
  const released = releaseDate(app.released);
  if (!released) return "unknownRelease";
  if (released < config.from || released > config.to) return "date";
  if (!Number.isFinite(app.minInstalls)) return "unknownInstalls";
  if (app.minInstalls <= config.minInstalls) return "installs";
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
    searchTotal: config.keywords.length * config.countries.length,
    detailDone: 0,
    detailTotal: 0,
    successfulSearches: 0,
    results: [],
    errors: [],
    skipped: {
      category: 0,
      paid: 0,
      date: 0,
      installs: 0,
      unknownRelease: 0,
      unknownInstalls: 0,
      details: 0,
      previouslySeen: 0,
    },
    truncatedQueries: 0,
  };
}

// Sequential requests keep load modest. Pagination also uses the provider's throttle.
export async function runSearch(
  job,
  provider,
  { delay = 500, isSeen = () => false, onMatch = async (app) => app } = {},
) {
  const candidates = new Map();
  const wait = () => new Promise((resolve) => setTimeout(resolve, delay));
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
  try {
    for (const country of job.config.countries) {
      for (const keyword of job.config.keywords) {
        if (!active()) return finish("cancelled");
        job.current = `${country} · ${keyword}`;
        try {
          const found = await provider.search({
            term: keyword,
            country: country.toLowerCase(),
            lang: "ru",
            num: job.config.limit,
            price: "free",
          });
          if (!Array.isArray(found)) throw new Error("Invalid source response");
          job.successfulSearches++;
          if (found.length >= job.config.limit) job.truncatedQueries++;
          for (const app of found) {
            if (!app.appId || typeof app.appId !== "string") continue;
            if (!candidates.has(app.appId))
              candidates.set(app.appId, {
                appId: app.appId,
                countries: new Set(),
                keywords: new Set(),
              });
            const candidate = candidates.get(app.appId);
            candidate.countries.add(country);
            candidate.keywords.add(keyword);
          }
        } catch (error) {
          const entry = errorEntry(error, { country, keyword });
          job.errors.push(entry);
          // These errors apply to the source, not to a particular app. Stop instead of repeating 81 failures.
          if (["ACCESS_DENIED", "RATE_LIMIT"].includes(entry.code))
            return finish("failed");
        }
        job.searchDone++;
        await wait();
      }
    }
    if (!job.successfulSearches) return finish("failed");
    job.phase = "details";
    const unseen = [...candidates.values()].filter((candidate) => {
      if (!isSeen(candidate.appId)) return true;
      job.skipped.previouslySeen++;
      return false;
    });
    job.detailTotal = unseen.length;
    for (const candidate of unseen) {
      if (!active()) return finish("cancelled");
      job.current = candidate.appId;
      let detail;
      for (const country of candidate.countries) {
        try {
          const response = await provider.app({
            appId: candidate.appId,
            country: country.toLowerCase(),
            lang: "en",
          });
          if (!response.title || !response.genreId)
            throw new Error("Invalid app data");
          detail = { ...response, country };
          break;
        } catch (error) {
          const entry = errorEntry(error, { appId: candidate.appId, country });
          job.errors.push(entry);
          if (["ACCESS_DENIED", "RATE_LIMIT"].includes(entry.code))
            return finish("failed");
        }
        await wait();
      }
      if (!active()) return finish("cancelled");
      if (!detail) job.skipped.details++;
      else {
        const reason = exclusion(detail, job.config);
        if (reason) job.skipped[reason]++;
        else {
          const match = await onMatch({
            appId: candidate.appId,
            title: detail.title,
            developer: detail.developer ?? "",
            summary: detail.summary ?? "",
            installs: detail.installs ?? `${detail.minInstalls}+`,
            minInstalls: detail.minInstalls,
            released: releaseDate(detail.released),
            score: Number.isFinite(detail.score) ? detail.score : null,
            countries: [...candidate.countries].sort(),
            keywords: [...candidate.keywords],
            detailCountry: detail.country,
            url: `https://play.google.com/store/apps/details?id=${encodeURIComponent(candidate.appId)}&gl=${detail.country}`,
            checkedAt: new Date().toISOString(),
          });
          if (match) job.results.push(match);
          else job.skipped.previouslySeen++;
        }
      }
      job.detailDone++;
      await wait();
    }
    job.results.sort(
      (a, b) =>
        b.released.localeCompare(a.released) || b.minInstalls - a.minInstalls,
    );
    finish(job.errors.length ? "partial" : "complete");
  } catch (error) {
    job.errors.push(errorEntry(error, {}));
    finish("failed");
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
    ]);
  return (
    "\ufeff" +
    rows.map((row) => row.map(csvCell).join(";")).join("\r\n") +
    "\r\n"
  );
}
