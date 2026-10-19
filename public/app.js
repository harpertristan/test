const $ = (selector) => document.querySelector(selector);
let defaults;
let job;
let pollTimer;
let historyRows = [];
let view = "latest";
let monitorData;
let scheduleDirty = false;
let refreshing = false;
let sortKey = "released";
let sortDirection = -1;
const storageKey = "playscout-last-job";
const countries = () =>
  [...document.querySelectorAll("#country-list input:checked")].map(
    (el) => el.value,
  );
const format = (value) => new Intl.NumberFormat("ru-RU").format(value);
const formatDate = (value) =>
  new Intl.DateTimeFormat("ru-RU").format(new Date(`${value}T12:00:00Z`));
const formatInstant = (value) =>
  new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Kaliningrad",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
const readConfig = () => ({
  keywords: $("#keywords")
    .value.split("\n")
    .map((k) => k.trim())
    .filter(Boolean),
  countries: countries(),
  from: $("#from").value,
  to: $("#to").value,
  minInstalls: Number($("#installs").value),
  limit: Number($("#limit").value),
});

function applyConfig(config, rolling = false) {
  $("#keywords").value = config.keywords.join("\n");
  $("#installs").value = config.minInstalls;
  $("#limit").value = config.limit;
  if (config.from) $("#from").value = rolling ? defaults.from : config.from;
  if (config.to) $("#to").value = rolling ? defaults.to : config.to;
  document.querySelectorAll("#country-list input").forEach((input) => {
    input.checked = config.countries.includes(input.value);
  });
  updateCountries();
}

function updateCountries() {
  const count = countries().length;
  $("#country-count").textContent = count;
  $("#geo-count").replaceChildren(
    document.createTextNode(`${count} `),
    Object.assign(document.createElement("em"), { textContent: "стран" }),
  );
}

async function api(path, options) {
  const response = await fetch(path, options);
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "Не удалось выполнить запрос.");
  return result;
}

function cell(text, className) {
  const el = document.createElement("td");
  el.textContent = text;
  if (className) el.className = className;
  return el;
}

function renderRows() {
  const rows = [
    ...(view === "history" ? historyRows : (job?.results ?? [])),
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
      const regions = cell("");
      const badge = Object.assign(document.createElement("span"), {
        className: "country-chip",
        textContent:
          app.countries.length > 3
            ? `${app.countries.slice(0, 2).join(", ")} +${app.countries.length - 2}`
            : app.countries.join(", "),
      });
      badge.title = app.countries
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
  const history = view === "history";
  $("#view-latest").classList.toggle("selected", !history);
  $("#view-history").classList.toggle("selected", history);
  $("#view-latest").setAttribute("aria-pressed", String(!history));
  $("#view-history").setAttribute("aria-pressed", String(history));
  $("#results-title").textContent = history
    ? "Все уникальные находки"
    : "Новые приложения";
  const rows = history ? historyRows : (job?.results ?? []);
  $("#table-wrap").hidden = !rows.length;
  $("#export").disabled = history
    ? !rows.length
    : !rows.length || job?.status === "running";
  $("#diagnostics").hidden = history || !job || job.status === "running";
  $("#empty-state").hidden =
    !!rows.length ||
    (!history && (job?.status === "running" || job?.status === "failed"));
  if (history) {
    $("#results-caption").textContent =
      `Сохранено приложений: ${format(historyRows.length)} · каждое добавлено один раз`;
    $("#empty-state h3").textContent = "История находок пока пуста";
    $("#empty-state p").textContent =
      "Новые подходящие приложения будут сохраняться здесь после ежедневного или ручного поиска.";
  } else if (job) {
    const names = {
      running: "Проверяем Google Play",
      complete: "Поиск завершён",
      partial: "Поиск завершён с пропусками",
      failed: "Поиск не завершён",
      cancelled: "Поиск остановлен",
    };
    $("#results-caption").textContent =
      `${names[job.status]} · ${formatDate(job.config.from)} — ${formatDate(job.config.to)}`;
    $("#empty-state h3").textContent =
      job.status === "complete"
        ? "Новых приложений пока нет"
        : "Пока нет новых подтверждённых совпадений";
    $("#empty-state p").textContent =
      "Ранее найденные приложения исключены. Сохранённый список доступен во вкладке «Все находки».";
  }
  renderRows();
}

function renderMonitor(data) {
  monitorData = data;
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
      ? "Поиск выполняется. Новые находки сохраняются автоматически."
      : next);
  if (
    !data.lastError &&
    !data.activeJobId &&
    ["failed", "partial", "cancelled"].includes(schedule.lastStatus)
  )
    $("#schedule-next").textContent +=
      " Последний автопоиск не завершён полностью; подробности в результатах.";
  $("#history-count").textContent = format(data.totalFindings);
}

async function refreshMonitor() {
  if (refreshing) return;
  refreshing = true;
  try {
    const data = await api("/api/monitor");
    renderMonitor(data);
    if (view === "history") historyRows = await api("/api/findings");
    const id = data.activeJobId || data.latestJobId;
    if (id && job?.id !== id) {
      clearTimeout(pollTimer);
      renderJob(await api(`/api/jobs/${id}`));
      try {
        localStorage.setItem(storageKey, id);
      } catch {}
      if (job.status === "running") pollTimer = setTimeout(poll, 700);
    } else renderView();
  } catch {
    $("#schedule-next").textContent =
      "Нет связи с программой. Проверьте, что окно с npm start открыто.";
  } finally {
    refreshing = false;
  }
}

function renderJob(next) {
  job = next;
  const running = job.status === "running";
  $("#filters").disabled = running;
  $("#search-button").disabled = running;
  $("#search-button").textContent = running
    ? "Поиск идёт…"
    : "⌕ Найти приложения";
  $("#cancel").hidden = !running;
  $("#export").disabled = running || !job.results.length;
  $("#result-count").textContent = format(job.results.length);
  $("#checked-count").textContent = format(job.detailDone);
  $("#geo-count").replaceChildren(
    document.createTextNode(`${job.config.countries.length} `),
    Object.assign(document.createElement("em"), { textContent: "стран" }),
  );
  const statusText = {
    running: "Проверяем Google Play",
    complete: "Поиск завершён",
    partial: "Поиск завершён с пропусками",
    failed: "Поиск не завершён",
    cancelled: "Поиск остановлен",
  };
  $("#results-caption").textContent =
    `${statusText[job.status]} · ${formatDate(job.config.from)} — ${formatDate(job.config.to)}`;
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
  $("#current-task").textContent = job.current;
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
    `Успешных поисковых запросов: ${job.successfulSearches} из ${job.searchTotal}.`,
    `Карточек проверено: ${job.detailDone} из ${job.detailTotal}.`,
  ];
  for (const [key, value] of Object.entries(job.skipped))
    if (value) lines.push(`${reasons[key]}: ${value}.`);
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
    renderJob(await api(`/api/jobs/${job.id}`));
    if (job.status === "running") pollTimer = setTimeout(poll, 1200);
    else void refreshMonitor();
  } catch (error) {
    $("#form-error").textContent =
      `${error.message} Обновите страницу, чтобы восстановить связь.`;
    if (job?.status === "running") pollTimer = setTimeout(poll, 5000);
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
    $("#form-error").textContent = error.message;
    $("#search-button").disabled = false;
  }
});

$("#cancel").addEventListener("click", async () => {
  try {
    clearTimeout(pollTimer);
    renderJob(await api(`/api/jobs/${job.id}/cancel`, { method: "POST" }));
  } catch (error) {
    $("#form-error").textContent = error.message;
    pollTimer = setTimeout(poll, 1200);
  }
});
$("#export").addEventListener("click", () => {
  if (view === "history") window.location.assign("/api/findings/export.csv");
  else if (job) window.location.assign(`/api/jobs/${job.id}/export.csv`);
});
$("#view-latest").addEventListener("click", () => {
  view = "latest";
  renderView();
});
$("#view-history").addEventListener("click", async () => {
  try {
    historyRows = await api("/api/findings");
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

async function init() {
  $("#search-button").disabled = true;
  try {
    defaults = await api("/api/defaults");
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
    const data = await api("/api/monitor");
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
        if (prior.status === "running") pollTimer = setTimeout(poll, 500);
      } catch {
        try {
          localStorage.removeItem(storageKey);
        } catch {}
      }
    }
    setInterval(() => {
      void refreshMonitor();
    }, 5000);
  } catch {
    $("#form-error").textContent =
      "Не удалось подключиться к серверу. Обновите страницу.";
  }
}
void init();
