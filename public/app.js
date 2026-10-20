import {assessWebPresence,webPresenceLabel} from './web-presence.js';
import {apiJSON} from './api.js';
import{isBusyJob,requestStatus}from'./job-state.js';
import{mountExclusions,refreshExclusions,exclusionControl}from'./exclusions.js';
import { searchPlan, discoveryPreset, rollingDates } from './discovery.js';
import { readCriteria, applyCriteria, renderEvidence, filterRows, filterCandidates } from "./criteria.js";
const $ = (selector) => document.querySelector(selector);
let defaults;
let job;
let pollTimer;
let historyRows = [];
let candidateRows = [];
let view = "latest";
let monitorData;
let scheduleDirty = false;
let refreshing = false;
let cancellingId=null;
let sortKey = "released";
let sortDirection = -1;
const storageKey = "playscout-last-job";
const countries = () =>
  [...document.querySelectorAll("#country-list input:checked")].map(
    (el) => el.value,
  );
const format = (value) => new Intl.NumberFormat("ru-RU").format(value);
const formatDate = (value) => value ?
  new Intl.DateTimeFormat("ru-RU").format(new Date(`${value}T12:00:00Z`)) : "Не указана";
const formatInstant = (value) =>
  new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Kaliningrad",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
const readConfig = () => ({
  ...readCriteria(),
  referenceDiscovery:$('#reference-discovery').checked,
  releaseMonths:Number($('#release-months').value),
  plan:$('#search-plan').value,
  phoneCountry:$('#phone-country').value.trim().toUpperCase(),
  referenceDomains:$('#reference-domains').value.split('\n').map(d=>d.trim().toLowerCase()).filter(Boolean),
  seedApps:$('#seed-apps').value.split('\n').map(x=>x.trim()).filter(Boolean),
  hideEstablished:$('#hide-established').checked,
  related:$('#related-source').checked,
  developerExpansion:$('#developer-source').checked,
  useWebIndex:$('#use-web-index').checked,
  maxDetails:Number($('#max-details').value),
  keywords: $("#keywords")
    .value.split("\n")
    .map((k) => k.trim())
    .filter(Boolean),
  countries: countries(),
  ignoreReleaseDate: $("#ignore-release-date").checked,
  from: $("#from").value,
  to: $("#to").value,
  minInstalls: Number($("#installs").value),
  limit: Number($("#limit").value),
});

function applyConfig(config, rolling = false) {
  applyCriteria(config);
  $('#reference-discovery').checked=config.referenceDiscovery??false;
  $("#ignore-release-date").checked=config.ignoreReleaseDate ?? false;
  syncDateMode();
  $('#eu-iban-mode').value=config.euIbanMode ?? 'prefer';
  $('#release-months').value=config.releaseMonths ?? 1;
  $('#search-plan').value=config.plan ?? 'full';
  $('#phone-country').value=config.phoneCountry ?? '';
  $('#seed-apps').value=(config.seedApps ?? []).map(id=>config.seedCountries?.[id]?`https://play.google.com/store/apps/details?id=${id}&gl=${config.seedCountries[id]}`:id).join('\n');
  $('#reference-domains').value=(config.referenceDomains ?? []).join('\n');
  $('#hide-established').checked=config.hideEstablished ?? false;
  $('#related-source').checked=config.related ?? true;
  $('#developer-source').checked=config.developerExpansion ?? true;
  $('#use-web-index').checked=config.useWebIndex ?? false;
  $('#max-details').value=config.maxDetails ?? 10000;
  $("#keywords").value = config.keywords.join("\n");
  $("#installs").value = config.minInstalls;
  $("#limit").value = config.limit;
  const dates=rollingDates(defaults.to,config.releaseMonths ?? 1);
  $("#from").value=rolling ? dates.from : (config.from ?? dates.from);
  $("#to").value=rolling ? dates.to : (config.to ?? dates.to);
  document.querySelectorAll("#country-list input").forEach((input) => {
    input.checked = config.countries.includes(input.value);
  });
  updateCountries();
  renderPlan();
}

function updateCountries() {
  const count = countries().length;
  $("#country-count").textContent = count;
  $("#geo-count").replaceChildren(
    document.createTextNode(`${count} `),
    Object.assign(document.createElement("em"), { textContent: "стран" }),
  );
}

const api=apiJSON;

function cell(text, className) {
  const el = document.createElement("td");
  el.textContent = text;
  if (className) el.className = className;
  return el;
}

function newRows(){return filterRows(job?.results??[]).filter(e=>e.firstJobId===job.id&&!e.isReference);}
function currentRows() {
  if(view==='new')return newRows();
  return view === 'candidates' ? filterCandidates(candidateRows) : filterRows(view === 'history' ? historyRows : [...(job?.results ?? []),...(job?.existingResults ?? [])]);
}
function syncDateMode() {
  for (const id of ['#from','#to']) $(id).disabled=$('#ignore-release-date').checked;
}
function renderRows() {
  const rows = [
    ...currentRows(),
  ].sort((a, b) => {
    const av = a[sortKey] ?? "",
      bv = b[sortKey] ?? "";
    return (
      sortDirection *
      (typeof av === "number" ? av - bv : String(av).localeCompare(String(bv)))
    );
  });
  $("#results-body").replaceChildren(
    ...rows.map((app) => {
      const tr = document.createElement("tr");
      const name = cell("");
      const avatar = Object.assign(document.createElement("span"), {
        className: "app-avatar",
        textContent: app.title[0],
      });
      const title = Object.assign(document.createElement("strong"), {
        textContent: app.title,
      });
      const developer = Object.assign(document.createElement("small"), {
        textContent: app.developer,
      });
      const id = Object.assign(document.createElement("small"), {
        textContent: app.appId,
      });
      name.append(avatar, title, developer, id);
      const presence=assessWebPresence([{url:app.url,text:app.screeningText,kind:'listing'}],{productURL:app.developerWebsite});for(const [key,label]of [['service','Веб-сервис'],['cabinet','Веб-кабинет']])name.append(Object.assign(document.createElement('small'),{textContent:label+': '+webPresenceLabel(presence[key])}));
      if(app.isReference)name.append(Object.assign(document.createElement('small'),{textContent:'Ваш образец · прямая проверка'}));
      if(app.discoverySources?.includes('query'))name.append(Object.assign(document.createElement('small'),{textContent:'Найдено поиском Google Play'}));
      if(app.firstJobId===job?.id&&!app.fromHistory&&!app.isReference)name.append(Object.assign(document.createElement('small'),{textContent:'НОВОЕ · впервые найдено'}));
      if(app.fromHistory)name.append(Object.assign(document.createElement('small'),{textContent:'Из истории · повторно не добавлено; описание сохранено ранее'}));
      if(app.discoverySources?.includes('related'))name.append(Object.assign(document.createElement('small'),{textContent:`Рекомендации Google Play: ${(app.recommendationParents??[]).join(', ')}`}));
      if(app.discoverySources?.includes('developer'))name.append(Object.assign(document.createElement('small'),{textContent:'Другие приложения разработчика'}));
      if(app.developerWebsite){const site=Object.assign(document.createElement('a'),{href:app.developerWebsite,target:'_blank',rel:'noopener noreferrer',textContent:'Сайт сервиса ↗'});name.append(site);}
      name.append(renderEvidence(app));
      name.append(exclusionControl(app,'play'));
      const regions = cell("");
      const badge = Object.assign(document.createElement("span"), {
        className: "country-chip",
        textContent:
          (app.countries ?? []).length > 3
            ? `${app.countries.slice(0, 2).join(", ")} +${app.countries.length - 2}`
            : (app.countries?.length ? app.countries.join(', ') : `Карточка: ${app.detailCountry ?? '—'}`),
      });
      badge.title = (app.countries ?? [])
        .map(
          (code) =>
            defaults.countries.find((c) => c.code === code)?.name || code,
        )
        .join(", ");
      regions.append(badge);
      const linkCell = cell("");
      const link = Object.assign(document.createElement("a"), {
        href: app.url,
        target: "_blank",
        rel: "noopener noreferrer",
        className: "app-link",
        textContent: "↗",
      });
      link.setAttribute("aria-label", `Открыть ${app.title} в Google Play`);
      linkCell.append(link);
      tr.append(
        name,
        cell(formatDate(app.released)),
        cell(`${format(app.minInstalls)}+`),
        regions,
        cell(app.score === null ? "—" : `★ ${app.score.toFixed(1)}`),
        cell(app.firstFoundAt ? formatInstant(app.firstFoundAt) : "—"),
        linkCell,
      );
      return tr;
    }),
  );
}

function renderView() {
  const onlyNew=view==='new';
  $('#view-new').classList.toggle('selected',onlyNew);$('#view-new').setAttribute('aria-pressed',String(onlyNew));$('#new-tab-count').textContent=format(newRows().length);
  const history = view === "history";
  const review = view === "candidates";
  $("#view-latest").classList.toggle("selected", !history && !review && !onlyNew);
  $("#view-history").classList.toggle("selected", history);
  $("#view-latest").setAttribute("aria-pressed", String(!history && !review && !onlyNew));
  $("#view-history").setAttribute("aria-pressed", String(history));
  $("#view-candidates").classList.toggle("selected",review);
  $("#view-candidates").setAttribute("aria-pressed",String(review));
  $("#results-title").textContent = onlyNew?"Новые за последний поиск":review ? "Кандидаты: данных для подтверждения не хватает" : history
    ? "Все уникальные находки"
    : "Результаты поиска";
  const rows = currentRows();
  if (job) $("#result-count").textContent = format(newRows().length);
  $("#table-wrap").hidden = !rows.length;
  $("#export").disabled = (history || review)
    ? !rows.length
    : !rows.length || isBusyJob(job);
  $("#diagnostics").hidden = history || review || !job || isBusyJob(job);
  $("#empty-state").hidden =
    !!rows.length ||
    (!history && !review && (isBusyJob(job) || job?.status === "failed"));
  if(onlyNew){$('#results-caption').textContent=`Впервые найдены: ${rows.length}. Ранее известные и повторные совпадения здесь не показываются.`;$('#empty-state h3').textContent='Новых находок в этом поиске нет';$('#empty-state p').textContent='Ранее найденные сервисы доступны во вкладке «Все находки».';}
  else if (review) {
    $('#results-caption').textContent=`На проверку: ${rows.length}. Финансовые сервисы с неполными сведениями о бизнес-обслуживании или IBAN.`;
    $('#empty-state h3').textContent='Кандидатов для проверки пока нет';
    $('#empty-state p').textContent='Здесь сохраняются подходящие по теме кандидаты с неполными сведениями, прошедшие фильтры даты, категории и установок.';
  } else if (history) {
    $("#results-caption").textContent =
      `Сохранено приложений: ${format(historyRows.length)} · каждое добавлено один раз`;
    $("#empty-state h3").textContent = "История находок пока пуста";
    $("#empty-state p").textContent =
      "Новые подходящие приложения будут сохраняться здесь после ежедневного или ручного поиска.";
  } else if (job) {
    const names = {
      cancelling:"Останавливаем поиск…",
      running: "Проверяем Google Play",
      complete: "Поиск завершён",
      partial: "Поиск завершён с пропусками",
      failed: "Поиск не завершён",
      cancelled: "Поиск остановлен",
    };
    $("#results-caption").textContent =
      `${names[job.status]} · ${job.config.ignoreReleaseDate ? "за всё время" : `${formatDate(job.config.from)} — ${formatDate(job.config.to)}`}`;
    $("#empty-state h3").textContent =
      job.status === "complete"
        ? "Новых приложений пока нет"
        : "Пока нет новых подтверждённых совпадений";
    $("#empty-state p").textContent =
      "Подходящие сохранённые приложения показываются здесь с пометкой «Из истории». Счётчик новых учитывает только первые находки.";
  }
  if (job && !job.config.strictBanking && readCriteria().strictBanking) $("#results-caption").textContent += " · старый поиск, требуется перепроверка";
  renderExplanation();
  renderRows();
}
function renderExplanation() {
  const box=$('#search-explanation');
  box.hidden=!job || isBusyJob(job) || view!=='latest';
  if(box.hidden)return;
  const skipped=job.skipped;
  const lines=[`Проверено: ${job.detailDone}. Другая категория: ${skipped.category || 0}. Вне даты первого выпуска: ${skipped.date || 0}. Не совпали с профилем: ${skipped.banking || 0}.`];
  if(job.config.profile==='business')lines.push('Режим ваших примеров: совпадение с профилем не подтверждает EU IBAN, доступность открытия компании или лицензию.');
  if(skipped.date && !job.config.ignoreReleaseDate) lines.push('Расширение даты не обновляет старые приложения: здесь учитывается их самый первый выпуск. Для проверки поиска можно выбрать «За всё время».');
  if((monitorData?.totalCandidates || job.reviewCandidates?.length || 0)>0)lines.push('Кандидаты с неполными данными доступны во вкладке «На проверку».');
  if(!monitorData?.evidenceConnection?.configured)lines.push('Ключ Brave не подключён: сайт разработчика пока не проверяется. Настройка: npm run configure, затем npm start.');
  if(job.results.length===0 && job.config.keywords.every(q=>/[а-яё]/iu.test(q)))lines.push('Использованы только русские запросы. Нажмите «Добавить английские варианты» для поиска европейских приложений.');
  for(const warning of job.warnings??[])lines.push(warning);
  box.textContent=lines.join(' ');
}

function renderMonitor(data) {
  monitorData = data;
  const pending=data.pendingChecks??0;
  $("#continue-checks").hidden=!pending;
  $("#continue-checks").disabled=!!data.activeJobId;
  $("#pending-checks").textContent=pending?`Осталось непроверенных карточек: ${pending}. Очередь сохраняется после перезапуска.`:"";
  const schedule = data.schedule;
  if (!scheduleDirty) {
    $("#schedule-enabled").checked = schedule.enabled;
    $("#schedule-time").value = schedule.time;
  }
  $("#save-schedule").disabled = false;
  $("#schedule-badge").textContent = schedule.enabled ? "Включён" : "Выключен";
  const next =
    schedule.enabled && schedule.nextRunAt
      ? `Следующий запуск: ${formatInstant(schedule.nextRunAt)} · Калининград`
      : "Автоматический поиск выключен. Ручной поиск доступен.";
  $("#schedule-next").textContent =
    data.lastError ||
    (data.activeJobId
      ? data.stopping ? "Останавливаем поиск и сохраняем очередь карточек…" : "Поиск выполняется. Новые находки сохраняются автоматически."
      : next);
  if (
    !data.lastError &&
    !data.activeJobId &&
    ["failed", "partial", "cancelled"].includes(schedule.lastStatus)
  )
    $("#schedule-next").textContent +=
      schedule.lastStatus==='cancelled'?" Последний автопоиск остановлен. Уже найденные приложения сохранены.":" Последний автопоиск не завершён полностью; подробности в результатах.";
  $("#history-count").textContent = format(data.totalFindings);
  $('#candidate-count').textContent=format(data.totalCandidates ?? 0);
  $('#evidence-connection').textContent=data.evidenceConnection?.configured ? 'Ключ Brave задан. Для проверки доступа нажмите кнопку ниже; в поиске он дополняет карточки Google Play и сведения о сервисе.' : 'Ключ Brave не подключён. Проверяется только описание. Для сайтов выполните npm run configure и перезапустите программу.';
}

async function refreshMonitor() {
  if (refreshing) return;
  refreshing = true;
  try {
    const priorJobId=job?.id;
    await refreshExclusions();
    const data = await api("/api/monitor");
    if(job?.id!==priorJobId)return;
    renderMonitor(data);
    if (view === "history") historyRows = await api("/api/findings?all=1");
    if (view === "candidates") candidateRows = await api("/api/candidates");
    const id = data.activeJobId || data.latestJobId;
    if (id && (job?.id !== id || data.busy!==isBusyJob(job))) {
      clearTimeout(pollTimer);
      renderJob(await api(`/api/jobs/${id}`));
      try {
        localStorage.setItem(storageKey, id);
      } catch {}
      if (isBusyJob(job)) pollTimer = setTimeout(poll, 700);
    } else renderView();
  } catch {
    $("#schedule-next").textContent =
      "Нет связи с программой. Проверьте, что окно с npm start открыто.";
  } finally {
    refreshing = false;
  }
}

function renderJob(next) {
  if(cancellingId===next.id&&next.status!=='failed')next={...next,status:'cancelling'};
  job = next;
  const running = isBusyJob(job);
  const cancelling=job.status==='cancelling';
  $("#filters").disabled = running;
  $("#search-button").disabled = running;
  $("#search-button").textContent = running
    ? cancelling?"Останавливаем поиск…":"Поиск идёт…"
    : "⌕ Найти приложения";
  $("#cancel").hidden = !running;
  $("#cancel").disabled=cancelling;
  $("#cancel").textContent=cancelling?"Останавливаем поиск…":"Остановить поиск";
  $("#export").disabled = running || !job.results.length;
  $("#result-count").textContent = format(filterRows(job.results).length);
  $("#checked-count").textContent = running && job.phase!=="details" ? "—" : format(job.detailDone);
  $("#geo-count").replaceChildren(
    document.createTextNode(`${job.config.countries.length} `),
    Object.assign(document.createElement("em"), { textContent: "стран" }),
  );
  const statusText = {
    cancelling:"Останавливаем поиск…",
    running: "Проверяем Google Play",
    complete: "Поиск завершён",
    partial: "Поиск завершён с пропусками",
    failed: "Поиск не завершён",
    cancelled: "Поиск остановлен",
  };
  $("#results-caption").textContent =
    `${statusText[job.status]} · ${job.config.ignoreReleaseDate ? "за всё время" : `${formatDate(job.config.from)} — ${formatDate(job.config.to)}`}`;
  $("#progress-area").hidden = !running;
  const details = job.phase === "details";
  const done = details ? job.detailDone : job.searchDone;
  const total = details ? job.detailTotal : job.searchTotal;
  $("#progress-text").textContent = details
    ? "Проверяем карточки приложений"
    : "Собираем поисковую выдачу";
  $("#progress-count").textContent = `${done} / ${total}`;
  $("#progress").max = Math.max(total, 1);
  $("#progress").value = done;
  $("#current-task").textContent = requestStatus(job);
  const notices = [];
  if (job.status === "failed")
    notices.push(
      job.errors.at(-1)?.message || "Поиск прервался. Повторите попытку.",
    );
  if (job.status === "partial")
    notices.push(
      "Часть запросов или карточек не удалось проверить. Результаты неполные; подробности ниже.",
    );
  if (job.status === "cancelled")
    notices.push(
      "Поиск остановлен. Показаны только уже проверенные приложения; результаты неполные.",
    );
  if (job.truncatedQueries)
    notices.push(
      `В ${job.truncatedQueries} запросах достигнут лимит выдачи. Попробуйте увеличить глубину поиска.`,
    );
  $("#notice").hidden = !notices.length;
  $("#notice").className = `notice${job.status === "failed" ? " error" : ""}`;
  $("#notice").textContent = notices.join(" ");
  $("#empty-state").hidden =
    running || job.results.length > 0 || job.status === "failed";
  if (!$("#empty-state").hidden) {
    $("#empty-state h3").textContent =
      job.status === "complete"
        ? "Совпадений по этим фильтрам не найдено"
        : "Пока нет подтверждённых совпадений";
    $("#empty-state p").textContent =
      "Попробуйте расширить период, изменить ключевые слова или увеличить глубину выдачи.";
  }
  $("#table-wrap").hidden = !job.results.length;
  renderRows();
  $("#diagnostics").hidden = running;
  const reasons = {
    banking: "Не совпало с выбранным профилем сервиса / строгими признаками",
    excludedTerm: "Исключено по слову или фразе",
    excludedDomain: "Исключено по домену",
    excludedId: "Исключено по ID приложения",
    category: "Другая категория",
    paid: "Платная загрузка",
    date: "Вне периода выпуска",
    installs: "Порог установок не подтверждён",
    unknownRelease: "Нет даты выпуска",
    unknownInstalls: "Нет данных об установках",
    details: "Не удалось проверить карточку",
    previouslySeen: "Уже найдены раньше, не добавлены повторно",
  };
  const lines = [
    `Успешных поисковых запросов: ${job.successfulSearches}; выполнено ${job.searchDone} из ${job.searchTotal} этапов поиска. Остальные этапы могли не запускаться.`,
    `Карточек проверено: ${job.detailDone} из ${job.detailTotal}.`,
    `Списков рекомендаций: ${job.recommendationChecks??0}; разработчиков: ${job.developerChecks??0}; в очереди: ${job.pendingCount??0}.`,
  ];
  for (const [key, value] of Object.entries(job.skipped))
    if (value) lines.push(`${reasons[key]}: ${value}.`);
  const missingNames={business:'Счёт для бизнеса',euIban:'IBAN страны ЕС',licence:'Заявленная лицензия'};
  for(const [reason,count] of Object.entries(job.bankingMissing ?? {})) if(count) lines.push(`Не найдено: ${missingNames[reason]} — ${count}.`);
  for(const example of job.filterExamples ?? []) lines.push(`${example.title} · первый выпуск ${example.released || 'не указан'} · ${reasons[example.reason] || example.reason}${example.reason==='banking' ? ` · нет: ${example.missing.map(key=>missingNames[key]).join(', ')}` : ''}`);
  for (const error of job.errors)
    lines.push(
      `${[error.country, error.keyword, error.appId].filter(Boolean).join(" · ")}: ${error.message}`,
    );
  $("#diagnostics-content").replaceChildren(
    ...lines.map((text) =>
      Object.assign(document.createElement("div"), { textContent: text }),
    ),
  );
  renderView();
}

async function poll() {
  try {
    const id=job?.id;if(!id)return;const next=await api(`/api/jobs/${id}`);
    if(job?.id!==id)return;
    renderJob(next);
    if (isBusyJob(job)) pollTimer = setTimeout(poll, 1200);
    else void refreshMonitor();
  } catch (error) {
    $("#form-error").textContent =
      `${error.message} Обновите страницу, чтобы восстановить связь.`;
    if (isBusyJob(job)) pollTimer = setTimeout(poll, 5000);
  }
}

$("#search-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#form-error").textContent = "";
  if (!countries().length) {
    $("#form-error").textContent = "Выберите хотя бы одну страну ЕС.";
    return;
  }
  const config = readConfig();
  $("#search-button").disabled = true;
  try {
    clearTimeout(pollTimer);
    const next = await api("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    try {
      localStorage.setItem(storageKey, next.id);
    } catch {}
    view = "latest";
    renderJob(next);
    pollTimer = setTimeout(poll, 700);
  } catch (error) {
    if(error.status===409){try{const active=await api('/api/active');if(active){view='latest';renderJob(active);pollTimer=setTimeout(poll,700);return;}}catch{}}
    $("#form-error").textContent = error.message;
    $("#search-button").disabled = false;
  }
});

$("#cancel").addEventListener("click", async () => {
  const id=job?.id;if(!id||cancellingId)return;
  cancellingId=id;clearTimeout(pollTimer);$("#form-error").textContent='';renderJob({...job,status:'cancelling'});
  try {
    const stopped=await api(`/api/jobs/${id}/cancel`,{method:'POST'});
    cancellingId=null;if(job?.id===id)renderJob(stopped);
    await refreshMonitor();
  } catch(error){cancellingId=null;$("#form-error").textContent=error.message;pollTimer=setTimeout(poll,700);}
});
$("#export").addEventListener("click", () => {
  if (view === "candidates") window.location.assign("/api/candidates/export.csv");
  else if (view === "history") window.location.assign(`/api/findings/export.csv?all=${$("#show-archive").checked ? 1 : 0}`);
  else if (job) window.location.assign(`/api/jobs/${job.id}/export.csv?new=${view==='new'?1:0}&all=${$("#show-archive").checked ? 1 : 0}`);
});
$('#view-candidates').addEventListener('click',async()=>{
  try {candidateRows=await api('/api/candidates');view='candidates';renderView();}
  catch(error){$('#form-error').textContent=error.message;}
});
$('#ignore-release-date').addEventListener('change',syncDateMode);
$('#release-months').addEventListener('change',()=>{const dates=rollingDates(defaults.to,Number($('#release-months').value));$('#from').value=dates.from;$('#to').value=dates.to;});
$('#apply-preset').addEventListener('click',()=>{
  applyConfig({...defaults.preset,from:defaults.from,to:defaults.to});
  $('#schedule-feedback').textContent='Применён профиль ваших примеров: 12 месяцев, от 1 установки, без требования собственной банковской лицензии. Сохраните расписание.';
});
$('#profile').addEventListener('change',()=>{
  const business=$('#profile').value==='business';$('#strict-controls').hidden=business;$('#strict-banking').checked=!business;$('#institution-type').value=business?'bank_or_emi':'bank';renderPlan();
});
$('#test-brave').addEventListener('click',async()=>{
  $('#test-brave').disabled=true;
  try {const result=await api('/api/connections/brave/test',{method:'POST'});$('#brave-feedback').textContent=`Подключение работает. Проверено: ${formatInstant(result.verifiedAt)}.`;}
  catch(error){$('#brave-feedback').textContent=error.message;}
  finally{$('#test-brave').disabled=false;}
});
function renderPlan() {
  try{const config=readConfig();const calls=searchPlan(config).length+(config.referenceDiscovery?6:0);$('#plan-cost').textContent=`${calls} запросов к Google Play, до ${config.maxDetails} карточек. В сбалансированном плане все выбранные страны проверяются, но число запросов по странам различается.`;}catch{}
}
$('#search-form').addEventListener('input',renderPlan);
$("#view-latest").addEventListener("click", () => {
  view = "latest";
  renderView();
});
$("#view-history").addEventListener("click", async () => {
  try {
    historyRows = await api("/api/findings?all=1");
    view = "history";
    renderView();
  } catch (error) {
    $("#form-error").textContent = error.message;
  }
});
for (const id of ["#schedule-enabled", "#schedule-time"])
  $(id).addEventListener("input", () => {
    scheduleDirty = true;
    $("#schedule-feedback").textContent = "Изменения ещё не сохранены.";
  });
$("#save-schedule").addEventListener("click", async () => {
  if (!$("#schedule-time").reportValidity()) return;
  $("#save-schedule").disabled = true;
  try {
    const data = await api("/api/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: $("#schedule-enabled").checked,
        time: $("#schedule-time").value,
        filters: readConfig(),
      }),
    });
    scheduleDirty = false;
    renderMonitor(data);
    $("#schedule-feedback").textContent =
      "Расписание и фильтры сохранены. Повторы исключаются по ID приложения.";
    setTimeout(() => {
      void refreshMonitor();
    }, 500);
  } catch (error) {
    $("#schedule-feedback").textContent = error.message;
    $("#save-schedule").disabled = false;
  }
});
$("#toggle-countries").addEventListener("click", () => {
  $("#countries").hidden = !$("#countries").hidden;
});
$("#all-countries").addEventListener("click", () => {
  document.querySelectorAll("#country-list input").forEach((el) => {
    el.checked = true;
  });
  updateCountries();
});
$("#no-countries").addEventListener("click", () => {
  document.querySelectorAll("#country-list input").forEach((el) => {
    el.checked = false;
  });
  updateCountries();
});
$("#country-list").addEventListener("change", updateCountries);
$("#last-month").addEventListener("click", () => {
  if (defaults) {
    $("#from").value = defaults.from;
    $("#to").value = defaults.to;
  }
});
$("#english").addEventListener("click", () => {
  $("#keywords").value = [
    ...new Set([
      ...$("#keywords")
        .value.split("\n")
        .map((k) => k.trim())
        .filter(Boolean),
      "business account",
      "business bank",
      "business banking",
    ]),
  ].join("\n");
});
document.querySelectorAll(".sort-button").forEach((button) =>
  button.addEventListener("click", () => {
    sortDirection = sortKey === button.dataset.sort ? -sortDirection : -1;
    sortKey = button.dataset.sort;
    if (job) renderRows();
  }),
);

$('#show-archive').addEventListener('change',renderView);
$('#search-form').addEventListener('input',()=>{renderView();});
async function init() {
  $("#search-button").disabled = true;
  try {
    await mountExclusions(async()=>{renderView();await refreshMonitor();if(job)renderJob(await api(`/api/jobs/${job.id}`));});
    defaults = await api("/api/defaults");
    $("#app-version").textContent=`Версия ${defaults.version}`;
    $("#from").value = defaults.from;
    $("#to").value = defaults.to;
    $("#from").max = defaults.to;
    $("#to").max = defaults.to;
    for (const country of defaults.countries) {
      const label = document.createElement("label");
      const input = Object.assign(document.createElement("input"), {
        type: "checkbox",
        checked: true,
        value: country.code,
      });
      label.append(input, document.createTextNode(country.name));
      $("#country-list").append(label);
    }
    updateCountries();
    $("#search-button").disabled = false;
    const priorJobId=job?.id;
    await refreshExclusions();
    const data = await api("/api/monitor");
    if(job?.id!==priorJobId)return;
    renderMonitor(data);
    applyConfig(data.schedule.filters);
    let saved;
    try {
      saved = localStorage.getItem(storageKey);
    } catch {}
    const active = await api("/api/active");
    const recent =
      data.latestJobId || (saved && /^[a-f0-9-]+$/.test(saved) ? saved : null);
    if (active || recent) {
      try {
        const prior = active || (await api(`/api/jobs/${recent}`));
        try {
          localStorage.setItem(storageKey, prior.id);
        } catch {}
        if (prior.status === "running")
          applyConfig(prior.config, prior.source === "scheduled");
        updateCountries();
        renderJob(prior);
        if (isBusyJob(prior)) pollTimer = setTimeout(poll, 500);
      } catch {
        try {
          localStorage.removeItem(storageKey);
        } catch {}
      }
    }
    $('#early-preset').disabled=false;
    setInterval(() => {
      void refreshMonitor();
    }, 5000);
  } catch {
    $("#form-error").textContent =
      "Не удалось подключиться к серверу. Обновите страницу.";
  }
}
void init();

$('#catalogue-preset').addEventListener('click',()=>{const current=readConfig();applyConfig({...defaults.cataloguePreset,excludeTerms:current.excludeTerms,excludeDomains:current.excludeDomains,excludeAppIds:current.excludeAppIds,seedApps:[...new Set([...defaults.cataloguePreset.seedApps,...current.seedApps])],from:defaults.from,to:defaults.to});$('#schedule-feedback').textContent='Каталог за всё время: все запросы по выбранным странам, рекомендации и разработчики. Сохраните расписание, если хотите использовать этот режим ежедневно.';});
$('#continue-checks').addEventListener('click',async()=>{try{clearTimeout(pollTimer);view='latest';renderJob(await api('/api/backlog/continue',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}));pollTimer=setTimeout(poll,700);}catch(error){$('#form-error').textContent=error.message;}});

$('#early-preset').addEventListener('click',()=>{const old=readConfig();applyConfig({...defaults.earlyPreset,excludeTerms:old.excludeTerms,excludeDomains:old.excludeDomains,excludeAppIds:old.excludeAppIds});$('#schedule-feedback').textContent=`Раннее обнаружение: библиотека ${defaults.referenceCount} известных сервисов, без ограничения даты и порога установок, рекомендации. Известные примеры помечаются; сохраните расписание.`;});

$('#view-new').addEventListener('click',()=>{view='new';renderView();});
