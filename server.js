import {buildReport,reportHTML,reportDOCX,reportCSV,updateShortlist,REPORT_CSP} from './lib/report.js';
import {createNeuralSearch} from './lib/neural-search.js';
import {groupedCandidates} from './lib/neural-inbox.js';
import {createAIReview} from './lib/ai-review.js';
import {openaiProvider} from './lib/openai-provider.js';
import {REFERENCE_LIBRARY} from './lib/references.js';
import{manuallyExcluded,canonicalFindingURL}from'./lib/manual-exclusions.js';
import{webFilters,webCSV}from'./lib/web-services.js';
import {pageProvider} from './lib/page-provider.js';
import {watchCSV,DEFAULT_WATCH_URLS} from './lib/watch.js';
import {companyGroups} from './lib/companies.js';
import {socialPreset,SOURCE_CATALOG_VERSION,RECOMMENDED_SOURCES} from './lib/source-catalog.js';
import { discoveryPreset, cataloguePreset,earlyPreset,DISCOVERY_KEYWORDS, REFERENCE_APPS } from './lib/discovery.js';
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
import { openStore, memoryStore, dailySlot, nextDailyRun } from "./lib/store.js";
import { createMonitor } from "./lib/monitor.js";
import { braveProvider } from "./lib/brave-provider.js";
import {
  SOCIAL_SOURCES,
  SOCIAL_QUERIES,
  validateSocialConfig,socialFilters,
  socialCSV,
} from "./lib/social-search.js";

const APP_VERSION=JSON.parse(await readFile(new URL('./package.json',import.meta.url),'utf8')).version;

export function createApp({
  provider = liveProvider(),
  socialProvider = braveProvider(),
  aiProvider = openaiProvider(),
  aiPages = pageProvider(),
  socialDelay = 1100,
  watchProvider = {...pageProvider(),app:provider.app},
  watchDelay = 1000,
  delay = 500,
  store = memoryStore(),
  autoSchedule = false,
  clock,
  tickInterval,
  requestTimeoutMs,
  password = process.env.APP_PASSWORD || "",
} = {}) {
  const configuredBraveLimit=Number(process.env.BRAVE_MONTHLY_REQUEST_LIMIT??1000);
  const braveLimit=Number.isInteger(configuredBraveLimit)&&configuredBraveLimit>0?configuredBraveLimit:1000;
  const budgetMonth=()=>calendarWindow(clock?clock():new Date()).to.slice(0,7);
  const braveBudget=()=>({limit:braveLimit,used:store.state.braveUsage?.[budgetMonth()]??0});
  socialProvider.setBeforeRequest?.(async()=>store.update(d=>{d.braveUsage??={};const month=budgetMonth(),used=d.braveUsage[month]??0;if(used>=braveLimit)throw Object.assign(new Error('Monthly Brave request limit reached'),{code:'BRAVE_BUDGET',status:429});d.braveUsage[month]=used+1;}));
  const monitor = createMonitor({
    provider: { ...provider, research: socialProvider },
    store,
    delay,
    autoSchedule,
    clock,
    tickInterval,
    requestTimeoutMs,
  });
  const socialMonitor = createMonitor({
    provider: socialProvider,
    kind: "social",
    store,
    delay: socialDelay,
    autoSchedule,
    clock,
    tickInterval,
    requestTimeoutMs,
  });
  const watchMonitor=createMonitor({provider:watchProvider,kind:"watch",store,delay:watchDelay,autoSchedule,clock,tickInterval,requestTimeoutMs});
  const webMonitor=createMonitor({provider:socialProvider,kind:'web',store,delay:socialDelay,autoSchedule,clock,tickInterval,requestTimeoutMs});
  const aiReview=createAIReview({store,provider:aiProvider,pages:aiPages,index:socialProvider,clock,autoSchedule,isDiscoveryBusy:()=>[monitor,webMonitor,socialMonitor,watchMonitor].some(source=>source.summary().busy),tickInterval});
  const neural=createNeuralSearch({store,review:aiReview,monitors:{play:monitor,web:webMonitor,social:socialMonitor,watch:watchMonitor},clock});
  aiReview.setCollector(options=>neural.start(options));
  const files = {
    "/review":["review.html","text/html"],
    "/review.js":["review.js","text/javascript"],
    '/web':['web.html','text/html'],
    '/web/':['web.html','text/html'],
    '/web.js':['web.js','text/javascript'],
    '/references.js':['../lib/references.js','text/javascript'],
    '/web-presence.js':['../lib/web-presence.js','text/javascript'],
    '/api.js':['api.js','text/javascript'],
    '/exclusions.js':['exclusions.js','text/javascript'],
    '/manual-exclusions.js':['../lib/manual-exclusions.js','text/javascript'],
    "/": ["index.html", "text/html"],
    "/watch": ["watch.html", "text/html"],
    "/watch.js": ["watch.js", "text/javascript"],
    "/launches.js": ["../lib/launches.js", "text/javascript"],
    "/source-catalog.js": ["../lib/source-catalog.js", "text/javascript"],
    "/criteria.js": ["criteria.js", "text/javascript"],
    "/discovery.js": ["../lib/discovery.js", "text/javascript"],
    "/qualification.js": ["../lib/qualification.js", "text/javascript"],
    "/job-state.js":["job-state.js","text/javascript"],
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
      const web=url.pathname.startsWith('/api/web/');
      const social = url.pathname.startsWith("/api/social/");
      const watch = url.pathname.startsWith("/api/watch/");
      const apiPath = web?url.pathname.replace('/api/web/','/api/'):watch ? url.pathname.replace("/api/watch/", "/api/") : social
        ? url.pathname.replace("/api/social/", "/api/")
        : url.pathname;
      const control = web?webMonitor:watch ? watchMonitor : social ? socialMonitor : monitor;
      const exportCSV = web?webCSV:watch ? watchCSV : social ? socialCSV : toCSV;
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
      if(req.method==='GET'&&url.pathname==='/api/references')return send(200,REFERENCE_LIBRARY);
      if(req.method==='GET'&&url.pathname==='/api/ai/inbox')return send(200,groupedCandidates(store.state).map(e=>({...e,documents:undefined,screeningText:undefined,snippet:undefined,isNew:store.state.ai.newIds.includes(e.id)})));
      if(req.method==='GET'&&url.pathname==='/api/neural/monitor')return send(200,neural.summary());
      if(req.method==='GET'&&url.pathname==='/api/ai/monitor')return send(200,{...aiReview.summary(),braveBudget:braveBudget(),shortlistIds:store.state.ai.shortlist??[]});
      if(req.method==='GET'&&['/api/ai/report.html','/api/ai/export.docx','/api/ai/export.csv'].includes(url.pathname)){
        let report;try{report=buildReport(store.state,{scope:url.searchParams.get('scope')??'remaining',filter:url.searchParams.get('filter')??'all'},clock?clock():new Date());}catch(error){if(error.status===400)return send(400,{error:error.message});throw error;}
        const day=calendarWindow(clock?clock():new Date()).to;
        if(url.pathname.endsWith('report.html'))return send(200,reportHTML(report),'text/html; charset=utf-8',{'Content-Security-Policy':REPORT_CSP});
        const word=url.pathname.endsWith('.docx');return send(200,word?reportDOCX(report):reportCSV(report),word?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'text/csv; charset=utf-8',{'Content-Disposition':`attachment; filename="play-scout-${report.options.scope}-${day}.${word?'docx':'csv'}"`});
      }
      if(req.method==='GET'&&url.pathname==='/api/ai/results')return send(200,aiReview.results());
      if(req.method==='GET'&&url.pathname.startsWith('/api/ai/jobs/')){const job=aiReview.job(url.pathname.split('/').at(-1));return send(job?200:404,job??{error:'Проверка не найдена.'});}
      if(req.method==='GET'&&url.pathname==='/api/exclusions')return send(200,store.state.manualExclusions??[]);
      if(req.method==='GET'&&web&&apiPath==='/api/defaults')return send(200,{preset:webFilters(),version:APP_VERSION});
      if(req.method==="GET" && url.pathname==="/api/companies")return send(200,companyGroups(store.state));
      if(req.method==="GET" && watch && apiPath==="/api/defaults")return send(200,{watchUrls:DEFAULT_WATCH_URLS});
      if (req.method === "GET" && social && apiPath === "/api/defaults")
        return send(200, {
          sources: SOCIAL_SOURCES.map(({ id, name,category,domains }) => ({ id, name,category,domains })),
          preset:socialPreset(),
          sourceCatalogVersion:SOURCE_CATALOG_VERSION,
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
          cataloguePreset:cataloguePreset(COUNTRIES.map(c=>c.code)),
          earlyPreset:earlyPreset(COUNTRIES.map(c=>c.code)),
          referenceCount:REFERENCE_LIBRARY.length,
          excludeTerms: DEFAULT_EXCLUDE_TERMS,
          ...calendarWindow(new Date(),12),
        });
      if (req.method === "GET" && apiPath === "/api/active")
        return send(200, control.visibleJob(control.active()));
      if (req.method === "GET" && apiPath === "/api/monitor")
        return send(200, {...control.summary(),braveBudget:braveBudget()});
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
            "Content-Disposition": `attachment; filename="${web?"web-services":watch?"changes":social ? "social-signals" : "play-finance"}-history.csv"`,
          },
        );
      }
      if (
        req.method === "POST" &&
        req.headers["sec-fetch-site"] === "cross-site"
      )
        return send(403, { error: "Запрос с другого сайта запрещён." });
      if(req.method==='POST'&&['/api/neural/start','/api/neural/cancel'].includes(url.pathname)){if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'Ожидается JSON.'});try{return send(202,url.pathname.endsWith('/cancel')?await neural.cancel():await neural.start());}catch(error){return send(error.status??400,{error:error.message});}}
      if(req.method==='POST'&&url.pathname==='/api/ai/shortlist'){
        if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'Ожидается JSON.'});
        let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>1024*1024)return send(413,{error:'Слишком большой список.'});}
        try{const input=JSON.parse(raw);return send(200,await store.update(d=>updateShortlist(d,input)));}catch(error){return send(error.code==='PERSISTENCE_ERROR'?500:400,{error:error instanceof SyntaxError?'Некорректный JSON.':error.message});}
      }
      if(req.method==='POST'&&['/api/ai/start','/api/ai/cancel','/api/ai/config'].includes(url.pathname)){
        if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'Ожидается JSON.'});
        let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>4096)return send(413,{error:'Слишком большой запрос.'});}
        try{const body=JSON.parse(raw||'{}');if(url.pathname.endsWith('/config'))return send(200,await aiReview.saveConfig(body));if(url.pathname.endsWith('/cancel'))return send(200,await aiReview.cancel());return send(202,await aiReview.startJob());}catch(error){return send(error.code==='PERSISTENCE_ERROR'?500:error.status??400,{error:error instanceof SyntaxError?'Некорректный JSON.':error.message});}
      }
      if(req.method==='POST'&&['/api/exclusions','/api/exclusions/remove'].includes(url.pathname)){
        if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'Ожидается JSON.'});
        let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>4096)return send(413,{error:'Слишком большой запрос.'});}
        try{
          const input=JSON.parse(raw);if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Некорректное исключение.');
          if(url.pathname.endsWith('/remove')){if(typeof input.key!=='string')throw new Error('Укажите исключение.');await store.update(d=>{d.manualExclusions=d.manualExclusions.filter(e=>e.key!==input.key);});return send(200,{exclusions:store.state.manualExclusions});}
          const sections={company:{findings:groupedCandidates(store.state).filter(e=>e.id.startsWith('company:')),jobs:[]},inbox:{findings:store.state.ai.inbox,jobs:[]},play:store.state,social:store.state.social,web:store.state.web,watch:store.state.watch};const section=Object.hasOwn(sections,input.section)?sections[input.section]:null;
          if(!section||typeof input.id!=='string')throw new Error('Выберите запись из результатов.');
          const entries=[...section.findings,...(section.reviewCandidates??[]),...section.jobs.flatMap(j=>[...(j.results??[]),...(j.existingResults??[]),...(j.reviewCandidates??[])])];
          const entry=entries.find(e=>(e.id??e.appId)===input.id);if(!entry)return send(404,{error:'Находка не найдена. Обновите список.'});
          const kind=input.section==='company'?'domain':entry.appId?'app':input.section==='web'?'domain':'url',value=input.section==='company'?entry.id.slice('company:'.length):kind==='app'?entry.appId:kind==='domain'?new URL(entry.url).hostname.replace(/^www\./,''):canonicalFindingURL(entry.url);
          if(!value)throw new Error('Не удалось определить запись для исключения.');
          const key=createHash('sha256').update(`${kind}:${value}`).digest('hex'),rule={key,kind,value,title:entry.title,url:entry.url,createdAt:(clock?clock():new Date()).toISOString()};
          await store.update(d=>{d.manualExclusions??=[];if(!d.manualExclusions.some(e=>e.key===key)){if(d.manualExclusions.length>=2000)throw new Error('Список исключений заполнен. Восстановите ненужные записи.');d.manualExclusions.push(rule);}d.pendingChecks=d.pendingChecks.filter(e=>!manuallyExcluded(e,d.manualExclusions));});
          return send(200,{rule,exclusions:store.state.manualExclusions});
        }catch(error){return send(error.code==='PERSISTENCE_ERROR'?500:400,{error:error instanceof SyntaxError?'Некорректный JSON.':error.message});}
      }
      if(req.method==='POST' && url.pathname==='/api/backlog/continue'){
        if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'Ожидается JSON.'});
        try{return send(202,await monitor.startJob({...store.state.pendingCheckConfig,continuePending:true}));}
        catch(error){return send(error.status??400,{error:error.message});}
      }
      if(req.method==='POST' && url.pathname==='/api/monitoring/enable'){
        if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'Ожидается JSON.'});
        const now=clock?clock():new Date();
        await store.update(draft=>{
          const social=draft.social.schedule.filters;
          draft.social.schedule.filters=socialFilters(validateSocialConfig({...social,sources:[...new Set([...social.sources,...RECOMMENDED_SOURCES])],requestBudget:social.requestBudget??8},now));
          draft.social.sourceCatalogVersion=SOURCE_CATALOG_VERSION;
          for(const section of [draft,draft.social,draft.web,draft.watch]){
            const schedule=section.schedule;
            const sameDay=schedule.lastRunAt&&calendarWindow(new Date(schedule.lastRunAt)).to===calendarWindow(now).to;
            Object.assign(schedule,{enabled:true,savedAt:now.toISOString(),nextRunAt:sameDay?nextDailyRun(now,schedule.time):dailySlot(now,schedule.time).toISOString()});
          }
        });
        void monitor.tick();void socialMonitor.tick();void webMonitor.tick();void watchMonitor.tick();
        return send(200,{play:monitor.summary(),social:socialMonitor.summary(),web:webMonitor.summary(),watch:watchMonitor.summary()});
      }
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
          } else send(202, control.visibleJob(await control.startJob(input)));
        } catch (error) {
          send(
            error.status ?? (error.code === "PERSISTENCE_ERROR" ? 500 : 400),
            {
              error:
                error instanceof SyntaxError
                  ? "Некорректный JSON."
                  : error.message,
              activeJobId:error.status===409?control.active()?.id:undefined,
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
          return send(200, control.visibleJob(await control.cancel(job.id)));
        }
        if (req.method === "GET" && match[2] === "/export.csv") {
          if (["running","cancelling"].includes(job.status))
            return send(409, { error: "Дождитесь завершения поиска." });
          return send(200, exportCSV({...job, results: url.searchParams.get("all") === "1" ? (url.searchParams.get('new')==='1'?job.results.filter(e=>e.firstJobId===job.id&&!e.isReference):[...job.results,...(job.existingResults??[])]).filter(e=>!manuallyExcluded(e,store.state.manualExclusions)) : (url.searchParams.get('new')==='1'?job.results.filter(e=>e.firstJobId===job.id&&!e.isReference):[...job.results,...(job.existingResults??[])]).filter(e=>!manuallyExcluded(e,store.state.manualExclusions)).filter(entry => eligibleFinding(entry,Date.parse(control.summary().schedule.savedAt ?? '') > Date.parse(job.createdAt) ? control.summary().schedule.filters : job.config))}), "text/csv; charset=utf-8", {
            "Content-Disposition": `attachment; filename="${web?"web-services":watch?"changes":social ? "social-signals" : "play-finance"}.csv"`,
          });
        }
        if (req.method === "GET" && !match[2]) return send(200, control.visibleJob(job));
      }
      send(404, { error: "Страница не найдена." });
    } catch {
      if (!res.headersSent) send(500, { error: "Внутренняя ошибка сервера." });
      else res.end();
    }
  });
  server.monitor = monitor;
  server.socialMonitor = socialMonitor;
  server.watchMonitor=watchMonitor;
  server.webMonitor=webMonitor;
  server.aiReview=aiReview;
  server.neural=neural;
  server.on("listening", () => {
    monitor.start();
    socialMonitor.start();
    watchMonitor.start();
    webMonitor.start();
    aiReview.start();
  });
  server.on("close", () => {
    void neural.stop();
    void aiReview.stop();
    void monitor.stop();
    void socialMonitor.stop();
    void watchMonitor.stop();
    void webMonitor.stop();
  });
  return server;
}

export async function shutdownApp(server){
  // Stop accepting connections first. Finish worker checkpoints before closing
  // browser connections, including clients that never finished a POST body.
  await server.neural.stop();
  const closed=new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  await Promise.all([server.monitor.stop(),server.socialMonitor.stop(),server.watchMonitor.stop(),server.webMonitor.stop(),server.aiReview.stop()]);
  server.closeAllConnections();
  await closed;
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
  let stopping;
  const stop=()=>stopping??=(async()=>{
    try{await shutdownApp(server);process.exit(0);}
    catch{console.error('Не удалось корректно завершить программу. Сохраните папку data и проверьте историю перед следующим запуском.');process.exit(1);}
  })();
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
