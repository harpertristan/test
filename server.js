import { discoveryPreset, DISCOVERY_KEYWORDS, REFERENCE_APPS } from './lib/discovery.js';
import { DEFAULT_EXCLUDE_TERMS, eligibleFinding } from "./lib/qualification.js";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createHash, timingSafeEqual } from "node:crypto";
import {
  COUNTRIES,
  DEFAULT_KEYWORDS,
  calendarWindow,
  toCSV,
} from "./lib/search.js";
import { liveProvider } from "./lib/provider.js";
import { openStore, memoryStore } from "./lib/store.js";
import { createMonitor } from "./lib/monitor.js";
import { braveProvider } from "./lib/brave-provider.js";
import {
  SOCIAL_SOURCES,
  SOCIAL_QUERIES,
  socialCSV,
} from "./lib/social-search.js";

const APP_VERSION=JSON.parse(await readFile(new URL('./package.json',import.meta.url),'utf8')).version;

export function createApp({
  provider = liveProvider(),
  socialProvider = braveProvider(),
  socialDelay = 1100,
  delay = 500,
  store = memoryStore(),
  autoSchedule = false,
  clock,
  tickInterval,
  password = process.env.APP_PASSWORD || "",
} = {}) {
  const monitor = createMonitor({
    provider: { ...provider, research: socialProvider },
    store,
    delay,
    autoSchedule,
    clock,
    tickInterval,
  });
  const socialMonitor = createMonitor({
    provider: socialProvider,
    kind: "social",
    store,
    delay: socialDelay,
    autoSchedule,
    clock,
    tickInterval,
  });
  const files = {
    "/": ["index.html", "text/html"],
    "/criteria.js": ["criteria.js", "text/javascript"],
    "/discovery.js": ["../lib/discovery.js", "text/javascript"],
    "/qualification.js": ["../lib/qualification.js", "text/javascript"],
    "/app.js": ["app.js", "text/javascript"],
    "/style.css": ["style.css", "text/css"],
    "/social": ["social.html", "text/html"],
    "/help": ["help.html", "text/html"],
    "/social/": ["social.html", "text/html"],
    "/social.js": ["social.js", "text/javascript"],
  };
  const server = http.createServer(async (req, res) => {
    const send = (
      status,
      body,
      type = "application/json; charset=utf-8",
      extra = {},
    ) => {
      res.writeHead(status, {
        "Content-Type": type,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
        ...extra,
      });
      res.end(
        typeof body === "object" && !Buffer.isBuffer(body)
          ? JSON.stringify(body)
          : body,
      );
    };
    try {
      const url = new URL(req.url, "http://localhost");
      const social = url.pathname.startsWith("/api/social/");
      const apiPath = social
        ? url.pathname.replace("/api/social/", "/api/")
        : url.pathname;
      const control = social ? socialMonitor : monitor;
      const exportCSV = social ? socialCSV : toCSV;
      if (password && url.pathname !== "/api/health") {
        const header = req.headers.authorization || "";
        const supplied = /^Basic /i.test(header)
          ? Buffer.from(header.slice(6), "base64").toString("utf8")
          : "";
        const digest = (text) => createHash("sha256").update(text).digest();
        if (!timingSafeEqual(digest(supplied), digest(`admin:${password}`))) {
          return send(
            401,
            "Введите логин admin и пароль приложения.",
            "text/plain; charset=utf-8",
            { "WWW-Authenticate": 'Basic realm="Play Scout", charset="UTF-8"' },
          );
        }
      }
      if (req.method === "GET" && files[url.pathname]) {
        const [file, type] = files[url.pathname];
        return send(
          200,
          await readFile(new URL(`./public/${file}`, import.meta.url)),
          `${type}; charset=utf-8`,
        );
      }
      if (req.method === "GET" && url.pathname === "/api/health")
        return send(200, {
          status: "ok",
          version: APP_VERSION,
          source: "Google Play",
          sourceCheck: "not-performed-by-health-endpoint",
        });
      if (req.method === "GET" && social && apiPath === "/api/defaults")
        return send(200, {
          sources: SOCIAL_SOURCES.map(({ id, name }) => ({ id, name })),
          queries: SOCIAL_QUERIES,
          lookbackDays: 30,
          limit: 20,
        });
      if (req.method === "GET" && apiPath === "/api/defaults")
        return send(200, {
          countries: COUNTRIES,
          keywords: DISCOVERY_KEYWORDS,
          version:APP_VERSION,
          preset:discoveryPreset(COUNTRIES.map(c=>c.code)),
          excludeTerms: DEFAULT_EXCLUDE_TERMS,
          ...calendarWindow(new Date(),12),
        });
      if (req.method === "GET" && apiPath === "/api/active")
        return send(200, control.active());
      if (req.method === "GET" && apiPath === "/api/monitor")
        return send(200, control.summary());
      if (req.method === "GET" && apiPath === "/api/candidates") return send(200,control.candidates());
      if (req.method === "GET" && apiPath === "/api/candidates/export.csv") return send(200,exportCSV({results:control.candidates(),status:'needs_review'}),"text/csv; charset=utf-8",{"Content-Disposition":'attachment; filename="candidates.csv"'});
      if (req.method === "GET" && apiPath === "/api/findings")
        return send(200, control.findings({ all: url.searchParams.get("all") === "1" }));
      if (req.method === "GET" && apiPath === "/api/findings/export.csv") {
        return send(
          200,
          exportCSV({ results: control.findings({all:url.searchParams.get("all") === "1"}), status: "history" }),
          "text/csv; charset=utf-8",
          {
            "Content-Disposition": `attachment; filename="${social ? "social-signals" : "play-finance"}-history.csv"`,
          },
        );
      }
      if (
        req.method === "POST" &&
        req.headers["sec-fetch-site"] === "cross-site"
      )
        return send(403, { error: "Запрос с другого сайта запрещён." });
      if(req.method==='POST' && url.pathname==='/api/connections/brave/test') {
        if(!socialProvider.configured())return send(503,{error:'Ключ не задан. Выполните npm run configure и перезапустите программу.'});
        try {
          await socialProvider.search({q:'site:play.google.com/store/apps/details Stable.com',count:1,search_lang:'en'});
          const verifiedAt=new Date().toISOString();
          await store.update(draft=>{draft.connections??={};draft.connections.brave={verifiedAt};});
          return send(200,{ok:true,verifiedAt,requests:1});
        } catch {return send(502,{error:'Brave не ответил успешно. Проверьте ключ, активацию Search API и квоту. Значение ключа не отображается.'});}
      }
      if (
        req.method === "POST" &&
        ["/api/search", "/api/schedule"].includes(apiPath)
      ) {
        if (!req.headers["content-type"]?.startsWith("application/json"))
          return send(415, { error: "Ожидается JSON." });
        let raw = "";
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > 16000)
            return send(413, { error: "Слишком большой запрос." });
        }
        try {
          const input = JSON.parse(raw);
          if (apiPath === "/api/schedule") {
            send(200, await control.saveSchedule(input));
            void control.tick();
          } else send(202, await control.startJob(input));
        } catch (error) {
          send(
            error.status ?? (error.code === "PERSISTENCE_ERROR" ? 500 : 400),
            {
              error:
                error instanceof SyntaxError
                  ? "Некорректный JSON."
                  : error.message,
            },
          );
        }
        return;
      }
      const match = apiPath.match(
        /^\/api\/jobs\/([a-f0-9-]+)(\/export.csv|\/cancel)?$/,
      );
      if (match) {
        const job = control.jobs.get(match[1]);
        if (!job)
          return send(404, {
            error: "Поиск не найден. Возможно, сервер был перезапущен.",
          });
        if (req.method === "POST" && match[2] === "/cancel") {
          return send(200, await control.cancel(job.id));
        }
        if (req.method === "GET" && match[2] === "/export.csv") {
          if (job.status === "running")
            return send(409, { error: "Дождитесь завершения поиска." });
          return send(200, exportCSV({...job, results: url.searchParams.get("all") === "1" ? job.results : job.results.filter(entry => eligibleFinding(entry,Date.parse(control.summary().schedule.savedAt ?? '') > Date.parse(job.createdAt) ? control.summary().schedule.filters : job.config))}), "text/csv; charset=utf-8", {
            "Content-Disposition": `attachment; filename="${social ? "social-signals" : "play-finance"}.csv"`,
          });
        }
        if (req.method === "GET" && !match[2]) return send(200, job);
      }
      send(404, { error: "Страница не найдена." });
    } catch {
      if (!res.headersSent) send(500, { error: "Внутренняя ошибка сервера." });
      else res.end();
    }
  });
  server.monitor = monitor;
  server.socialMonitor = socialMonitor;
  server.on("listening", () => {
    monitor.start();
    socialMonitor.start();
  });
  server.on("close", () => {
    void monitor.stop();
    void socialMonitor.stop();
  });
  return server;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try { process.loadEnvFile(resolve('.env')); }
  catch (error) { if (error.code !== 'ENOENT') { console.error('Не удалось прочитать .env. Проверьте формат файла.'); process.exit(1); } }
  if (process.env.RENDER && !process.env.APP_PASSWORD) {
    console.error(
      "Для облачного запуска задайте APP_PASSWORD в настройках хостинга.",
    );
    process.exit(1);
  }
  const port = Number(process.env.PORT || 3000);
  const dataFile = resolve(process.env.DATA_DIR || "./data", "state.json");
  let store;
  try {
    store = await openStore(dataFile);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  const server = createApp({ store, autoSchedule: true });
  server.listen(port, process.env.HOST || "0.0.0.0", () =>
    console.log(`Play Finance Finder: port ${port}`),
  );
  const stop = async () => {
    await Promise.all([server.monitor.stop(), server.socialMonitor.stop()]);
    server.close(() => process.exit(0));
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
