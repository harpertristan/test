const $ = (selector) => document.querySelector(selector);
let monitor,
  job,
  history = [],
  view = "latest",
  dirty = false,
  refreshing = false;
const stamp = (value) =>
  new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Kaliningrad",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
const labels = {
  running: "Идёт поиск",
  complete: "Поиск завершён",
  partial: "Поиск завершён с пропусками",
  cancelled: "Поиск остановлен",
  failed: "Поиск не завершён",
};
const reasons = {
  notPost: "Не ссылка на публикацию",
  topic: "Нет признаков запуска бизнес-банкинга",
  geography: "В заголовке и фрагменте не найден европейский регион",
  date: "Дата поисковика вне периода",
  previouslySeen: "Уже найдены раньше",
  duplicate: "Повтор в этом поиске",
};

async function api(path, body) {
  const response = await fetch(
    `/api/social/${path}`,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "Не удалось выполнить запрос.");
  return data;
}

function config() {
  return {
    sources: ["linkedin", "facebook"].filter(
      (id) => $(`#source-${id}`).checked,
    ),
    queries: $("#social-queries")
      .value.split("\n")
      .map((q) => q.trim())
      .filter(Boolean),
    limit: Number($("#social-limit").value),
    lookbackDays: Number($("#social-freshness").value),
  };
}

function applyFilters(filters) {
  $("#social-queries").value = filters.queries.join("\n");
  $("#social-limit").value = filters.limit;
  $("#social-freshness").value = filters.lookbackDays;
  for (const id of ["linkedin", "facebook"])
    $(`#source-${id}`).checked = filters.sources.includes(id);
  updateCost();
}

function updateCost() {
  const filters = config(),
    requests = filters.sources.length * filters.queries.length;
  $("#social-cost").textContent =
    `${requests} обращений к поисковому API за запуск, до ${requests * filters.limit} результатов до фильтрации. Дополнительных страниц нет. Ручной поиск тоже расходует лимит; тариф проверяется в Brave.`;
}

function node(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function renderPosts(rows) {
  $("#social-posts").replaceChildren(
    ...[...rows]
      .sort((a, b) =>
        (b.firstFoundAt || "").localeCompare(a.firstFoundAt || ""),
      )
      .map((post) => {
        const article = node("article", "", "social-post");
        const badges = node("div", "", "social-post-top");
        badges.append(
          node(
            "span",
            post.source === "linkedin" ? "LinkedIn" : "Facebook",
            "country-chip",
          ),
          node("span", "Требует проверки", "review-badge"),
        );
        const heading = node("h3", "");
        const link = node("a", post.title || "Открыть публикацию");
        link.href = post.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        heading.append(link);
        article.append(
          badges,
          heading,
          node("p", post.snippet),
          node(
            "small",
            `Упомянуты регионы: ${post.mentionedRegions.join(", ")}`,
          ),
        );
        article.append(
          node(
            "small",
            post.dateReported
              ? `Дата по данным поисковика: ${stamp(post.dateReported)}`
              : "Дата публикации не указана поисковиком",
          ),
        );
        article.append(
          node("small", `Впервые найдено: ${stamp(post.firstFoundAt)}`),
          node("small", post.reason),
        );
        return article;
      }),
  );
}

function render() {
  if (!monitor) return;
  const ready = monitor.connection.configured,
    running = job?.status === "running";
  const schedule = monitor.schedule;
  if (!dirty) {
    $("#social-enabled").checked = schedule.enabled;
    $("#social-time").value = schedule.time;
  }
  $("#social-save").disabled = false;
  $("#social-search").disabled = !ready || running;
  $("#social-search").textContent = running
    ? "Поиск выполняется…"
    : "Найти новые публикации";
  $("#social-filters").disabled = running;
  $("#social-cancel").hidden = !running;
  $("#social-schedule-badge").textContent = !ready
    ? "Нужен ключ API"
    : schedule.enabled
      ? "Включён"
      : "Выключен";
  $("#social-connection").replaceChildren();
  if (!ready) {
    $("#social-connection").append(
      node("strong", "Поиск публикаций ожидает подключения. "),
      document.createTextNode(
        "Добавьте BRAVE_SEARCH_API_KEY в защищённые настройки хостинга. В Render: Environment → Add Environment Variable → сохранение и перезапуск сервиса. Сам ключ в приложении не вводится. ",
      ),
    );
    const link = node("a", "Получить ключ Brave Search API");
    link.href = "https://brave.com/search/api/";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    $("#social-connection").append(
      link,
      document.createTextNode(
        ". Проверьте тариф и лимиты сервиса до подключения.",
      ),
    );
  } else
    $("#social-connection").textContent = monitor.connection.verifiedAt
      ? `Ключ задан. Последний успешный запрос: ${stamp(monitor.connection.verifiedAt)}. Источник — поисковый индекс Brave.`
      : "Ключ задан; доступ ещё не проверен. Первый поиск проверит подключение. Ключи LinkedIn и Facebook не требуются.";
  $("#social-next").textContent = !ready
    ? "Расписание сохранено, но запросы не выполняются без ключа."
    : monitor.lastError ||
      (running
        ? "Идёт поиск; находки сохраняются автоматически."
        : schedule.enabled && schedule.nextRunAt
          ? `Следующий запуск: ${stamp(schedule.nextRunAt)} · Калининград`
          : "Автоматический поиск выключен.");
  if (
    ready &&
    !running &&
    ["failed", "partial", "cancelled"].includes(schedule.lastStatus)
  )
    $("#social-next").textContent +=
      " Последний автопоиск завершён не полностью; смотрите подробности.";
  $("#social-new-count").textContent = job ? job.results.length : "—";
  $("#social-scanned").textContent = job ? job.scanned : "—";
  $("#social-total").textContent = monitor.totalFindings;
  $("#social-latest").classList.toggle("selected", view === "latest");
  $("#social-history").classList.toggle("selected", view === "history");
  $("#social-latest").setAttribute("aria-pressed", String(view === "latest"));
  $("#social-history").setAttribute("aria-pressed", String(view === "history"));
  const rows = view === "history" ? history : job?.results || [];
  $("#social-export").disabled =
    !rows.length || (view !== "history" && running);
  $("#social-caption").textContent =
    view === "history"
      ? `Всего уникальных публикаций: ${history.length}`
      : job
        ? `${labels[job.status]} · успешных запросов ${job.successfulSearches}/${job.searchTotal}`
        : "Первый поиск ещё не выполнялся";
  $("#social-progress").hidden = !running;
  if (running) {
    $("#social-progress-text").textContent =
      `Запросы: ${job.searchDone}/${job.searchTotal} · найдено новых сигналов: ${job.results.length}`;
    $("#social-progress-bar").max = job.searchTotal;
    $("#social-progress-bar").value = job.searchDone;
    $("#social-current").textContent = job.current;
  }
  const messages = [];
  if (job?.status === "failed")
    messages.push(job.errors.at(-1)?.message || "Поиск прервался.");
  if (job?.status === "partial")
    messages.push("Часть запросов не выполнена. Результаты неполные.");
  if (job?.status === "cancelled")
    messages.push(
      "Поиск остановлен. Уже сохранённые сигналы доступны в истории.",
    );
  if (job?.truncatedQueries)
    messages.push(
      `В ${job.truncatedQueries} запросах достигнут лимит первой страницы. Полный охват не гарантируется.`,
    );
  $("#social-notice").hidden = !messages.length;
  $("#social-notice").textContent = messages.join(" ");
  $("#social-empty").hidden =
    !!rows.length ||
    (view === "latest" && (running || job?.status === "failed"));
  $("#social-empty h3").textContent =
    !ready && !job
      ? "Подключите поисковый API"
      : job && view === "latest"
        ? "Новых сигналов по условиям не найдено"
        : "История публикаций пока пуста";
  $("#social-empty p").textContent =
    !ready && !job
      ? "Инструкция подключения находится в блоке выше. Существующий поиск Google Play продолжает работать."
      : "Повторы исключены. Отбираем признаки запуска бизнес-банкинга и упоминание европейского региона.";
  renderPosts(rows);
  $("#social-diagnostics").hidden = !job || running || view === "history";
  if (job) {
    const lines = Object.entries(job.skipped)
      .filter(([, count]) => count)
      .map(([reason, count]) => `${reasons[reason] || reason}: ${count}`);
    for (const error of job.errors)
      lines.push(`${error.source || ""}: ${error.message}`);
    $("#social-diagnostics-content").replaceChildren(
      ...lines.map((text) => node("div", text)),
    );
  }
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    monitor = await api("monitor");
    const id = monitor.activeJobId || monitor.latestJobId;
    if (id) job = await api(`jobs/${id}`);
    if (view === "history") history = await api("findings");
    render();
  } catch {
    $("#social-error").textContent =
      "Нет связи с сервером. Проверьте, что программа работает.";
  } finally {
    refreshing = false;
  }
}

$("#social-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#social-error").textContent = "";
  $("#social-search").disabled = true;
  try {
    job = await api("search", config());
    view = "latest";
    render();
    await refresh();
  } catch (error) {
    $("#social-error").textContent = error.message;
    render();
  }
});
$("#social-cancel").addEventListener("click", async () => {
  try {
    job = await api(`jobs/${job.id}/cancel`, {});
    render();
  } catch (error) {
    $("#social-error").textContent = error.message;
  }
});
$("#social-save").addEventListener("click", async () => {
  if (!$("#social-time").reportValidity()) return;
  $("#social-save").disabled = true;
  try {
    monitor = await api("schedule", {
      enabled: $("#social-enabled").checked,
      time: $("#social-time").value,
      filters: config(),
    });
    dirty = false;
    render();
    $("#social-saved").textContent = monitor.connection.configured
      ? "Расписание и фильтры публикаций сохранены."
      : "Настройки сохранены. Для запуска добавьте ключ API в хостинге.";
    setTimeout(refresh, 700);
  } catch (error) {
    $("#social-saved").textContent = error.message;
    $("#social-save").disabled = false;
  }
});
for (const selector of ["#social-enabled", "#social-time"])
  $(selector).addEventListener("input", () => {
    dirty = true;
    $("#social-saved").textContent = "Изменения ещё не сохранены.";
  });
$("#social-form").addEventListener("input", updateCost);
$("#social-latest").addEventListener("click", () => {
  view = "latest";
  render();
});
$("#social-history").addEventListener("click", async () => {
  view = "history";
  await refresh();
});
$("#social-export").addEventListener("click", () => {
  window.location.assign(
    view === "history"
      ? "/api/social/findings/export.csv"
      : `/api/social/jobs/${job.id}/export.csv`,
  );
});

async function init() {
  try {
    monitor = await api("monitor");
    applyFilters(monitor.schedule.filters);
    await refresh();
    setInterval(refresh, 2000);
  } catch {
    $("#social-error").textContent =
      "Не удалось загрузить настройки. Обновите страницу.";
  }
}
void init();
