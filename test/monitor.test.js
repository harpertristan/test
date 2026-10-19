import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMonitor } from "../lib/monitor.js";
import { openStore, memoryStore, nextDailyRun } from "../lib/store.js";
import { createApp } from "../server.js";

const now = new Date("2026-10-19T10:00:00Z");
const filters = {
  keywords: ["business bank"],
  countries: ["DE"],
  minInstalls: 100,
  limit: 50,
};
const config = { ...filters, from: "2026-09-19", to: "2026-10-19" };
const bank = (id = "com.example.bank", patch = {}) => ({
  appId: id,
  title: "Business Bank",
  developer: "Test",
  description: "Open a business account with a German IBAN. We are a licensed bank.",
  genreId: "FINANCE",
  free: true,
  price: 0,
  minInstalls: 500,
  installs: "500+",
  released: "Oct 1, 2026",
  ...patch,
});
const provider = (list = [bank()]) => ({
  search: async () => list,
  app: async (opts) => list.find((app) => app.appId === opts.appId),
});
async function dataFile(t) {
  const dir = await mkdtemp(join(tmpdir(), "play-scout-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, "state.json");
}
function monitor(store, options = {}) {
  return createMonitor({
    store,
    provider: provider(),
    clock: () => now,
    delay: 0,
    ...options,
  });
}

test("new matches persist; reappearing app is excluded after a full reload", async (t) => {
  const file = await dataFile(t);
  const first = monitor(await openStore(file, now));
  const day1 = await first.startJob(config);
  await first.idle();
  assert.equal(day1.results.length, 1);
  assert.equal(first.findings()[0].firstFoundAt, now.toISOString());
  const second = monitor(await openStore(file, now));
  const day2 = await second.startJob(config);
  await second.idle();
  assert.equal(day2.status, "complete");
  assert.equal(day2.results.length, 0);
  assert.equal(day2.skipped.previouslySeen, 1);
  assert.equal(day2.detailTotal, 0);
  assert.equal(second.findings().length, 1);
  assert.equal(second.jobs.get(day1.id).results.length, 1);
});

test("second run adds only newly discovered IDs, not new names or countries for old IDs", async () => {
  const store = memoryStore(now);
  let list = [bank()];
  const live = monitor(store, {
    provider: {
      search: async () => list,
      app: async (opts) => list.find((app) => app.appId === opts.appId),
    },
  });
  await live.startJob(config);
  await live.idle();
  list = [
    bank("com.example.bank", { title: "Renamed bank" }),
    bank("com.example.second"),
  ];
  const second = await live.startJob({ ...config, countries: ["FR", "DE"] });
  await live.idle();
  assert.deepEqual(
    second.results.map((app) => app.appId),
    ["com.example.second"],
  );
  assert.equal(live.findings().length, 2);
});

test("an excluded app can qualify later; merely seeing a search candidate does not blacklist it", async () => {
  const store = memoryStore(now);
  let installs = 100;
  const live = monitor(store, {
    provider: {
      search: async () => [bank()],
      app: async () => bank(undefined, { minInstalls: installs }),
    },
  });
  await live.startJob(config);
  await live.idle();
  assert.equal(live.findings().length, 0);
  installs = 500;
  const next = await live.startJob(config);
  await live.idle();
  assert.equal(next.results.length, 1);
});

test("daily scheduler runs once, rolls release dates and reserves next day before executing", async () => {
  let clock = new Date("2026-10-19T06:59:00Z"); // 08:59 Kaliningrad
  const store = memoryStore(clock);
  const queries = [];
  const live = monitor(store, {
    autoSchedule: true,
    clock: () => clock,
    provider: {
      search: async (opts) => {
        queries.push(opts);
        return [];
      },
    },
  });
  await live.saveSchedule({ enabled: true, time: "09:00", filters });
  await live.tick();
  assert.equal(live.jobs.size, 0);
  clock = new Date("2026-10-19T07:00:00Z");
  await Promise.all([live.tick(), live.tick()]);
  await live.idle();
  assert.equal(live.jobs.size, 1);
  assert.equal(live.summary().schedule.nextRunAt, "2026-10-20T07:00:00.000Z");
  await live.tick();
  assert.equal(live.jobs.size, 1);
  clock = new Date("2026-10-20T07:00:00Z");
  await live.tick();
  await live.idle();
  assert.equal(live.jobs.size, 2);
  assert.equal([...live.jobs.values()][1].config.from, "2026-09-20");
  assert.equal([...live.jobs.values()][1].config.to, "2026-10-20");
  assert.equal(queries.length, 2);
});

test("overdue schedule catches up once after days offline; busy manual job prevents overlap", async () => {
  const store = memoryStore(now);
  let release;
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  const live = monitor(store, {
    autoSchedule: true,
    provider: { search: () => waiting },
  });
  await live.startJob(config);
  await live.tick();
  assert.equal(live.jobs.size, 1);
  release([]);
  await live.idle();
  const later = monitor(store, {
    autoSchedule: true,
    clock: () => new Date("2026-10-23T10:00:00Z"),
    provider: { search: async () => [] },
  });
  await later.tick();
  await later.idle();
  await later.tick();
  assert.equal(later.jobs.size, 2);
  assert.equal(later.summary().schedule.nextRunAt, "2026-10-24T07:00:00.000Z");
});

test("disabled schedule and edited time/filters survive restart; saving again does not duplicate today", async (t) => {
  const file = await dataFile(t);
  const live = monitor(await openStore(file, now), {
    autoSchedule: true,
    provider: { search: async () => [] },
  });
  await live.saveSchedule({ enabled: true, time: "09:00", filters });
  await live.tick();
  await live.idle();
  await live.saveSchedule({ enabled: true, time: "09:00", filters });
  await live.tick();
  assert.equal(live.jobs.size, 1);
  await live.saveSchedule({
    enabled: false,
    time: "15:30",
    filters: { ...filters, keywords: ["business account"] },
  });
  const reloaded = monitor(await openStore(file, now), { autoSchedule: true });
  await reloaded.tick();
  assert.equal(reloaded.jobs.size, 1);
  assert.equal(reloaded.summary().schedule.enabled, false);
  assert.equal(reloaded.summary().schedule.time, "15:30");
  assert.deepEqual(reloaded.summary().schedule.filters.keywords, [
    "business account",
  ]);
});

test("crash recovery retains a checkpointed finding and retries the interrupted daily run", async (t) => {
  const file = await dataFile(t);
  const live = monitor(await openStore(file, now));
  const completed = await live.startJob(config);
  await live.idle();
  const state = JSON.parse(await readFile(file, "utf8"));
  state.jobs[0].status = "running";
  state.jobs[0].source = "scheduled";
  state.schedule.nextRunAt = "2026-10-20T07:00:00.000Z";
  await writeFile(file, JSON.stringify(state));
  const recovered = monitor(await openStore(file, now), { autoSchedule: true });
  assert.equal(recovered.jobs.get(completed.id).status, "cancelled");
  assert.equal(recovered.findings().length, 1);
  assert.equal(recovered.summary().schedule.nextRunAt, now.toISOString());
  await recovered.tick();
  await recovered.idle();
  const retry = [...recovered.jobs.values()].at(-1);
  assert.equal(retry.results.length, 0);
  assert.equal(retry.skipped.previouslySeen, 1);
});

test("corrupt history is never silently reset or overwritten", async (t) => {
  const file = await dataFile(t);
  const corrupt = "{ broken json";
  await writeFile(file, corrupt);
  await assert.rejects(openStore(file, now), /История не сброшена/);
  assert.equal(await readFile(file, "utf8"), corrupt);
});

test("a failed history write never marks a match as seen; it can be recovered on next run", async () => {
  const store = memoryStore(now);
  const update = store.update.bind(store);
  let writes = 0;
  store.update = async (change) => {
    if (++writes === 2)
      throw Object.assign(new Error("disk full"), {
        code: "PERSISTENCE_ERROR",
      });
    return update(change);
  };
  const live = monitor(store);
  const failed = await live.startJob(config);
  await live.idle();
  assert.equal(failed.status, "failed");
  assert.equal(failed.errors[0].code, "PERSISTENCE_ERROR");
  assert.equal(live.findings().length, 0);
  const retry = await live.startJob(config);
  await live.idle();
  assert.equal(retry.results.length, 1);
});

test("source failures are not seen matches and do not erase existing history", async () => {
  const store = memoryStore(now);
  const first = monitor(store);
  await first.startJob(config);
  await first.idle();
  const second = monitor(store, {
    provider: {
      search: async () => {
        throw Object.assign(new Error("403"), { status: 403 });
      },
    },
  });
  const failed = await second.startJob(config);
  await second.idle();
  assert.equal(failed.status, "failed");
  assert.equal(second.findings().length, 1);
});

test("next run uses Kaliningrad time independent of machine timezone, including year rollover", () => {
  assert.equal(
    nextDailyRun(new Date("2026-12-31T08:00:00Z"), "09:00"),
    "2027-01-01T07:00:00.000Z",
  );
  assert.equal(
    nextDailyRun(new Date("2026-10-19T06:59:00Z"), "09:00"),
    "2026-10-19T07:00:00.000Z",
  );
});

test("graceful shutdown retries an unfinished daily run after restart, but user cancellation does not", async (t) => {
  for (const reason of ["shutdown", "user"]) {
    const file = await dataFile(t);
    let release;
    const waiting = new Promise((resolve) => {
      release = resolve;
    });
    const live = monitor(await openStore(file, now), {
      autoSchedule: true,
      provider: { search: () => waiting },
    });
    await live.saveSchedule({ enabled: true, time: "09:00", filters });
    await live.tick();
    const id = live.active().id;
    const stopping = reason === "shutdown" ? live.stop() : live.cancel(id);
    release([]);
    await stopping;
    await live.idle();
    const restarted = monitor(await openStore(file, now), {
      autoSchedule: true,
      provider: { search: async () => [] },
    });
    await restarted.tick();
    await restarted.idle();
    assert.equal(restarted.jobs.size, reason === "shutdown" ? 2 : 1);
  }
});

test("password protects the website, history and scheduler; health remains public for hosting", async (t) => {
  const server = createApp({ password: "test-only-password" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
  for (const path of [
    "/",
    "/api/monitor",
    "/api/findings",
    "/api/findings/export.csv",
  ]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 401);
    assert.match(response.headers.get("www-authenticate"), /Basic/);
  }
  const header = (value) => ({
    Authorization: `Basic ${Buffer.from(value).toString("base64")}`,
  });
  assert.equal(
    (await fetch(base, { headers: header("admin:wrong") })).status,
    401,
  );
  assert.equal(
    (await fetch(base, { headers: header("admin:test-only-password") })).status,
    200,
  );
  assert.equal(
    (
      await fetch(`${base}/api/monitor`, {
        headers: header("admin:test-only-password"),
      })
    ).status,
    200,
  );
});

test("HTTP: schedules persist and history export contains every app only once across runs", async (t) => {
  const file = await dataFile(t);
  const server = createApp({
    store: await openStore(file, now),
    provider: provider(),
    clock: () => now,
    delay: 0,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) =>
    fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  assert.equal(
    (await post("/api/schedule", { enabled: true, time: "30:00", filters }))
      .status,
    400,
  );
  assert.equal(
    (await post("/api/schedule", { enabled: false, time: "10:30", filters }))
      .status,
    200,
  );
  await post("/api/search", config);
  await server.monitor.idle();
  const next = await (await post("/api/search", config)).json();
  await server.monitor.idle();
  const details = await (await fetch(`${base}/api/jobs/${next.id}`)).json();
  assert.equal(details.results.length, 0);
  const findings = await (await fetch(`${base}/api/findings`)).json();
  assert.equal(findings.length, 1);
  const exported = await (
    await fetch(`${base}/api/findings/export.csv`)
  ).text();
  assert.equal(exported.trim().split(/\r?\n/).length, 2); // one header and exactly one data row, including evidence URLs
  const status = await (await fetch(`${base}/api/monitor`)).json();
  assert.equal(status.totalFindings, 1);
  assert.equal(status.schedule.enabled, false);
  const reloaded = await openStore(file, now);
  assert.equal(reloaded.state.findings.length, 1);
  assert.equal(reloaded.state.jobs.length, 2);
});
