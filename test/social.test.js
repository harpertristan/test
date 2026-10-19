import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  canonicalPost,
  validateSocialConfig,
  evaluatePost,
  runSocialSearch,
  createSocialJob,
  socialCSV,
} from "../lib/social-search.js";
import { braveProvider } from "../lib/brave-provider.js";
import { memoryStore, openStore, initialState } from "../lib/store.js";
import { createMonitor } from "../lib/monitor.js";
import { createApp } from "../server.js";

const now = new Date("2026-10-19T12:00:00Z");
const filters = {
  sources: ["linkedin", "facebook"],
  queries: ["business neobank launch Europe"],
  limit: 10,
  lookbackDays: 30,
};
const config = validateSocialConfig(filters, now);
const post = (patch = {}) => ({
  title: "Acme neobank launches business accounts in Germany",
  description: "Open a business account with a German IBAN. We are a licensed bank in Europe.",
  url: "https://www.linkedin.com/posts/acme_launch-activity-1234567890123456789-abcd?utm_source=test",
  page_age: "2026-10-17T08:00:00Z",
  ...patch,
});
const facebook = () =>
  post({
    url: "https://m.facebook.com/acme/posts/98765432100000001?ref=share",
  });
const fixtureProvider = (results) => ({
  configured: () => true,
  search: async (opts) =>
    results || [opts.q.includes("site:facebook.com") ? facebook() : post()],
});
const monitor = (store, options = {}) =>
  createMonitor({
    store,
    provider: fixtureProvider(),
    kind: "social",
    delay: 0,
    clock: () => now,
    ...options,
  });
async function file(t) {
  const dir = await mkdtemp(join(tmpdir(), "social-scout-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, "state.json");
}

test("LinkedIn post aliases, activity URNs and tracking URLs have the same identity", () => {
  const a = canonicalPost(post().url);
  const b = canonicalPost(
    "https://de.linkedin.com/feed/update/urn:li:activity:1234567890123456789/?utm_campaign=x",
  );
  const c = canonicalPost(
    "https://www.linkedin.com/feed/update/urn%3Ali%3Aactivity%3A1234567890123456789",
  );
  assert.equal(a.key, b.key);
  assert.equal(b.key, c.key);
  assert.ok(!a.url.includes("utm_"));
});

test("Facebook mobile, permalink, story and composite ID aliases are deduplicated", () => {
  const a = canonicalPost(facebook().url);
  const b = canonicalPost(
    "https://www.facebook.com/permalink.php?story_fbid=98765432100000001&id=12345&ref=test",
  );
  const c = canonicalPost(
    "https://facebook.com/story.php?story_fbid=98765432100000001&id=12345",
  );
  const d = canonicalPost(
    "https://facebook.com/acme/posts/12345_98765432100000001",
  );
  assert.equal(a.key, b.key);
  assert.equal(b.key, c.key);
  assert.equal(c.key, d.key);
  assert.equal(new URL(b.url).searchParams.get("id"), "12345");
});

test("non-post pages, spoofed hosts and unsafe URLs are excluded", () => {
  for (const url of [
    "https://linkedin.com/company/acme",
    "https://facebook.com/acme",
    "https://linkedin.com.attacker.test/posts/x",
    "https://facebook.com.attacker.test/x/posts/123",
    "javascript:alert(1)",
    "https://user:pass@facebook.com/x/posts/123",
    "https://facebook.com:444/x/posts/123",
    "not a URL",
  ])
    assert.equal(canonicalPost(url), null);
});

test("query validation respects source restrictions and API limits; quota is bounded", () => {
  const defaults = validateSocialConfig({}, now);
  assert.equal(defaults.requestBudget, 8);
  assert.ok(defaults.sources.includes("forums"));
  for (const bad of [
    { sources: [] },
    { sources: ["instagram"] },
    { queries: [] },
    { queries: ["x".repeat(251)] },
    { queries: ["a ".repeat(49)] },
    { limit: 250 },
    { lookbackDays: 365 },
  ])
    assert.throws(() => validateSocialConfig(bad, now));
});

test("relevance requires business banking, launch and European evidence; never certifies a new bank", () => {
  const evaluated = evaluatePost(post(), "linkedin", config, now);
  assert.equal(evaluated.post.reviewStatus, "needs_review");
  assert.ok(evaluated.post.mentionedRegions.includes("Германия"));
  assert.equal(evaluated.post.dateReported, "2026-10-17T08:00:00.000Z");
  assert.equal(
    evaluatePost(
      post({
        title: "A new digital bank for personal savings in Germany",
        description: "",
      }),
      "linkedin",
      config,
      now,
    ).reason,
    "topic",
  );
  assert.equal(
    evaluatePost(
      post({
        title: "Business neobank launches in India",
        description: "New SME business bank launches.",
      }),
      "linkedin",
      config,
      now,
    ).reason,
    "excludedTerm",
  );
  assert.equal(
    evaluatePost(post({ page_age: "2025-01-01" }), "linkedin", config, now)
      .reason,
    "date",
  );
  assert.equal(evaluatePost(post(), "facebook", config, now).reason, "notPost");
  const ru = evaluatePost(
    post({ title: "Новый необанк запустил бизнес счет с EU IBAN в ЕС", description: "Есть банковская лицензия." }),
    "linkedin",
    config,
    now,
  );
  assert.ok(ru.post.mentionedRegions.includes("Европа"));
});

test("unknown or relative dates remain unknown; found time is not presented as publication time", () => {
  for (const date of [undefined, "2 days ago"]) {
    const evaluated = evaluatePost(
      post({ page_age: date }),
      "linkedin",
      config,
      now,
    ).post;
    assert.equal(evaluated.dateReported, null);
    assert.match(evaluated.dateLabel, /не указана/);
  }
});

test("search filters candidates, merges repeated appearances and preserves unseen new posts", async () => {
  const job = createSocialJob("job", config);
  await runSocialSearch(
    job,
    fixtureProvider([
      post(),
      post({
        url: "https://linkedin.com/feed/update/urn:li:activity:1234567890123456789",
      }),
      post({ url: "https://linkedin.com/company/acme" }),
    ]),
    { delay: 0, clock: () => now },
  );
  assert.equal(job.status, "complete");
  assert.equal(job.results.length, 1);
  assert.equal(job.skipped.duplicate, 1);
  assert.equal(job.searchTotal, 2);
});

test("real provider keeps API token in a header, not URLs; validates empty and malformed responses", async () => {
  let captured;
  const key = "test-only-api-key";
  const provider = braveProvider({ minInterval: 0,
    key,
    request: async (url, headers) => {
      captured = { url, headers };
      return { type: "search", web: { results: [post()] } };
    },
  });
  const result = await provider.search({
    q: "site:linkedin.com/posts/ neobank",
    count: 10,
    freshness: "pm",
    search_lang: "en",
  });
  assert.equal(result.length, 1);
  assert.equal(captured.url.hostname, "api.search.brave.com");
  assert.ok(!captured.url.href.includes(key));
  assert.equal(captured.headers["X-Subscription-Token"], key);
  assert.equal(captured.url.searchParams.get("freshness"), "pm");
  const empty = braveProvider({ minInterval: 0,
    key,
    request: async () => ({ type: "search" }),
  });
  assert.deepEqual(
    await empty.search({
      q: "test",
      count: 10,
      freshness: "pm",
      search_lang: "en",
    }),
    [],
  );
  const malformed = braveProvider({ minInterval: 0,
    key,
    request: async () => ({ web: { results: "invalid" } }),
  });
  await assert.rejects(
    malformed.search({ q: "test" }),
    /Invalid source results/,
  );
});

test("missing key never consumes quota or records an empty completed run", async () => {
  let requests = 0;
  const provider = braveProvider({ minInterval: 0,
    key: "",
    request: async () => {
      requests++;
    },
  });
  const live = monitor(memoryStore(now), { provider, autoSchedule: true });
  await live.tick();
  await assert.rejects(
    live.startJob(filters),
    (error) => error.code === "MISSING_KEY" && error.status === 503,
  );
  assert.equal(requests, 0);
  assert.equal(live.jobs.size, 0);
  assert.equal(live.summary().connection.configured, false);
});

test("API auth failures and quota limits fail fast and never leak source error text", async () => {
  for (const status of [401, 403, 429]) {
    let calls = 0;
    const job = createSocialJob("job", config);
    await runSocialSearch(
      job,
      {
        search: async () => {
          calls++;
          throw Object.assign(new Error("SECRET_KEY_SHOULD_NOT_APPEAR"), {
            status,
          });
        },
      },
      { delay: 0, clock: () => now },
    );
    assert.equal(job.status, "failed");
    assert.equal(calls, 1);
    assert.ok(!JSON.stringify(job).includes("SECRET_KEY_SHOULD_NOT_APPEAR"));
  }
});

test("partial network failures retain matches with a partial status", async () => {
  const job = createSocialJob("job", config);
  await runSocialSearch(
    job,
    {
      search: async (opts) => {
        if (opts.q.includes("facebook"))
          throw Object.assign(new Error("timeout"), { code: "API_TIMEOUT" });
        return [post()];
      },
    },
    { delay: 0, clock: () => now },
  );
  assert.equal(job.status, "partial");
  assert.equal(job.results.length, 1);
});

test("history persists across restarts; Play and social records do not interfere", async (t) => {
  const path = await file(t),
    store = await openStore(path, now);
  await store.update((draft) =>
    draft.findings.push({ appId: "com.original.bank", title: "Original" }),
  );
  const first = monitor(store),
    run = await first.startJob(filters);
  await first.idle();
  assert.equal(run.results.length, 2);
  const loaded = await openStore(path, now),
    second = monitor(loaded);
  const repeat = await second.startJob(filters);
  await second.idle();
  assert.equal(repeat.results.length, 0);
  assert.equal(repeat.skipped.previouslySeen, 2);
  assert.equal(loaded.state.social.findings.length, 2);
  assert.deepEqual(loaded.state.findings, [
    { appId: "com.original.bank", title: "Original" },
  ]);
  assert.equal(second.summary().connection.verifiedAt, now.toISOString());
});

test("legacy data migration is additive and preserves Play settings, runs and history", async (t) => {
  const path = await file(t),
    old = initialState(now);
  delete old.social;
  old.findings = [{ appId: "com.original", title: "Keep me" }];
  old.schedule.time = "11:30";
  old.schedule.enabled = false;
  await writeFile(path, JSON.stringify(old));
  const loaded = await openStore(path, now);
  assert.deepEqual(loaded.state.findings, old.findings);
  assert.deepEqual(loaded.state.schedule, old.schedule);
  assert.equal(loaded.state.social.schedule.time, "09:15");
  assert.equal(loaded.state.social.findings.length, 0);
  assert.equal(JSON.parse(await readFile(path, "utf8")).version, 1);
});

test("independent daily social schedule runs once and remembers posts on the next day", async () => {
  let time = new Date("2026-10-19T07:14:00Z");
  const store = memoryStore(time),
    live = monitor(store, { autoSchedule: true, clock: () => time });
  await live.saveSchedule({ enabled: true, time: "09:15", filters });
  await live.tick();
  assert.equal(live.jobs.size, 0);
  time = new Date("2026-10-19T07:15:00Z");
  await Promise.all([live.tick(), live.tick()]);
  await live.idle();
  assert.equal(live.jobs.size, 1);
  assert.equal(live.findings().length, 2);
  time = new Date("2026-10-20T07:15:00Z");
  await live.tick();
  await live.idle();
  assert.equal([...live.jobs.values()].at(-1).results.length, 0);
  assert.equal(store.state.jobs.length, 0);
  assert.equal(live.summary().schedule.nextRunAt, "2026-10-21T07:15:00.000Z");
});

test('parallel Play and social runs preserve both histories in the same file', async t => {
  const store = await openStore(await file(t), now);
  const social = monitor(store);
  const bank = { appId: 'com.parallel.bank', title: 'Bank', description: 'Open a business account with a German IBAN. We are a licensed bank.', genreId: 'FINANCE', price: 0, free: true, minInstalls: 500, released: 'Oct 1, 2026' };
  const play = createMonitor({ store, clock: () => now, delay: 0, provider: { search: async () => [bank], app: async () => bank } });
  await Promise.all([social.startJob(filters), play.startJob({ countries: ['DE'], keywords: ['bank'] })]);
  await Promise.all([social.idle(), play.idle()]);
  assert.equal(store.state.findings.length, 1);
  assert.equal(store.state.social.findings.length, 2);
  assert.equal(store.state.jobs.length, 1);
  assert.equal(store.state.social.jobs.length, 1);
});

test("CSV labels date evidence, manual review and incomplete status and escapes formulas", () => {
  const evaluated = evaluatePost(post(), "linkedin", config, now).post;
  const csv = socialCSV({
    status: "partial",
    results: [
      { ...evaluated, title: "=bad()", firstFoundAt: now.toISOString() },
    ],
  });
  assert.ok(csv.startsWith("\ufeff"));
  assert.match(csv, /Впервые найдено/);
  assert.match(csv, /Требует проверки/);
  assert.match(csv, /'\=bad/);
  assert.match(csv, /partial/);
});

test("HTTP social flow supports settings, new-only runs, persistent history and CSV behind auth", async (t) => {
  const store = await openStore(await file(t), now);
  const server = createApp({
    store,
    socialProvider: fixtureProvider(),
    socialDelay: 0,
    clock: () => now,
    password: "test-social-password",
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = {
    Authorization:
      "Basic " + Buffer.from("admin:test-social-password").toString("base64"),
  };
  const get = (path) => fetch(base + path, { headers });
  const send = (path, body) =>
    fetch(base + path, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  assert.equal((await fetch(base + "/social")).status, 401);
  assert.equal((await fetch(base + "/api/social/findings")).status, 401);
  assert.match(await (await get("/social")).text(), /EU IBAN/);
  assert.equal((await get("/social.js")).status, 200);
  assert.equal(
    (
      await send("/api/social/schedule", {
        enabled: false,
        time: "10:15",
        filters,
      })
    ).status,
    200,
  );
  assert.equal((await send("/api/social/search", filters)).status, 202);
  await server.socialMonitor.idle();
  const second = await (await send("/api/social/search", filters)).json();
  await server.socialMonitor.idle();
  assert.equal(
    (await (await get("/api/social/jobs/" + second.id)).json()).results.length,
    0,
  );
  assert.equal((await (await get("/api/social/findings")).json()).length, 2);
  assert.equal((await (await get("/api/findings")).json()).length, 0);
  const csv = await (await get("/api/social/findings/export.csv")).text();
  assert.equal(csv.split("\r\n").filter(Boolean).length, 3);
  assert.equal(
    (await (await get("/api/social/monitor")).json()).schedule.time,
    "10:15",
  );
});
