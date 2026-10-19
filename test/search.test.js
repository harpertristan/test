import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarWindow, validateConfig, releaseDate, exclusion, createJob, runSearch, toCSV, COUNTRIES } from '../lib/search.js';
import { createApp } from '../server.js';

const now = new Date('2026-10-19T10:00:00Z');
const config = (patch = {}) => validateConfig({ keywords: ['бизнес банк', 'бизнес счет'], countries: ['DE', 'FR'], from: '2026-09-19', to: '2026-10-19', ...patch }, now);
const app = (patch = {}) => ({ appId: 'com.example.bank', title: 'Business Bank', developer: 'Example', genreId: 'FINANCE', free: true, price: 0, minInstalls: 500, installs: '500+', released: 'Oct 1, 2026', ...patch });

test('EU has 27 unique members, excludes UK and Switzerland', () => {
  assert.equal(new Set(COUNTRIES.map(c => c.code)).size, 27);
  assert.ok(!COUNTRIES.some(c => ['GB', 'CH'].includes(c.code)));
});
test('calendar month clamps month end and respects client timezone', () => {
  assert.deepEqual(calendarWindow(new Date('2026-03-31T12:00:00Z')), { from: '2026-02-28', to: '2026-03-31' });
  assert.deepEqual(calendarWindow(new Date('2026-10-18T23:30:00Z')), { from: '2026-09-19', to: '2026-10-19' });
  assert.deepEqual(calendarWindow(new Date('2026-01-10T12:00:00Z')), { from: '2025-12-10', to: '2026-01-10' });
});
test('validates countries, strict numeric threshold, dates and query bounds', () => {
  for (const patch of [{ countries: [] }, { countries: ['GB'] }, { keywords: [] }, { keywords: Array(13).fill('bank') }, { minInstalls: '100' }, { minInstalls: -1 }, { from: '2026-02-30' }, { to: '2027-01-01' }, { from: '2026-10-20' }, { limit: 1000 }]) {
    assert.throws(() => config(patch));
  }
  assert.deepEqual(config({ keywords: [' bank ', 'bank'] }).keywords, ['bank']);
});
test('release date is strict and rejects unknown or invalid dates', () => {
  assert.equal(releaseDate('Oct 1, 2026'), '2026-10-01');
  assert.equal(releaseDate('Feb 30, 2026'), null);
  assert.equal(releaseDate(undefined), null);
  assert.equal(releaseDate('2026-10-01'), '2026-10-01');
});
test('strict filters use release date, not update date; 100+ does not prove >100', () => {
  assert.equal(exclusion(app(), config()), null);
  for (const [patch, reason] of [
    [{ genreId: 'BUSINESS' }, 'category'], [{ free: false }, 'paid'], [{ price: 1 }, 'paid'],
    [{ minInstalls: 100 }, 'installs'], [{ minInstalls: undefined }, 'unknownInstalls'],
    [{ released: undefined, updated: +now }, 'unknownRelease'],
    [{ released: 'Jan 1, 2020', updated: +now }, 'date'], [{ released: 'Oct 20, 2026' }, 'date']
  ]) assert.equal(exclusion(app(patch), config()), reason);
  assert.equal(exclusion(app({ released: 'Sep 19, 2026' }), config()), null);
  assert.equal(exclusion(app({ released: 'Oct 19, 2026' }), config()), null);
});
test('deduplicates app IDs, merges country/keyword evidence, checks details once', async () => {
  let details = 0;
  const job = createJob('test', config());
  await runSearch(job, { search: async () => [app()], app: async () => { details++; return app(); } }, { delay: 0 });
  assert.equal(job.status, 'complete');
  assert.equal(job.successfulSearches, 4);
  assert.equal(details, 1);
  assert.equal(job.results.length, 1);
  assert.deepEqual(job.results[0].countries, ['DE', 'FR']);
  assert.equal(job.results[0].keywords.length, 2);
});
test('match in just one selected country is sufficient', async () => {
  const job = createJob('test', config());
  await runSearch(job, { search: async opts => opts.country === 'de' ? [app()] : [], app: async () => app() }, { delay: 0 });
  assert.deepEqual(job.results[0].countries, ['DE']);
});
test('blocked source fails fast; is never reported as zero matches', async () => {
  let attempts = 0;
  const job = createJob('test', config());
  await runSearch(job, { search: async () => { attempts++; throw Object.assign(new Error('denied'), { status: 403 }); } }, { delay: 0 });
  assert.equal(attempts, 1);
  assert.equal(job.status, 'failed');
  assert.equal(job.errors[0].code, 'ACCESS_DENIED');
  assert.equal(job.successfulSearches, 0);
});
test('partial errors retain valid results and are visibly incomplete', async () => {
  const job = createJob('test', config());
  await runSearch(job, {
    search: async opts => { if (opts.country === 'fr') throw new Error('timeout'); return [app()]; },
    app: async () => app()
  }, { delay: 0 });
  assert.equal(job.status, 'partial');
  assert.equal(job.results.length, 1);
  assert.equal(job.errors.length, 2);
});
test('missing release date is counted, not guessed from updated', async () => {
  const job = createJob('test', config());
  await runSearch(job, { search: async () => [app()], app: async () => app({ released: undefined, updated: +now }) }, { delay: 0 });
  assert.equal(job.results.length, 0);
  assert.equal(job.skipped.unknownRelease, 1);
});
test('cancellation stops before checking more details', async () => {
  const job = createJob('test', config());
  let calls = 0;
  await runSearch(job, { search: async () => { calls++; job.status = 'cancelled'; return []; } }, { delay: 0 });
  assert.equal(calls, 1);
  assert.equal(job.status, 'cancelled');
});
test('CSV handles Unicode, quotes, formula injection and incomplete status', () => {
  const job = createJob('test', config());
  job.status = 'partial';
  job.results = [{ ...app({ title: '=HYPERLINK("bad")', developer: 'Банк; ЕС' }), countries: ['DE'], keywords: ['бизнес счет'], checkedAt: now.toISOString() }];
  const csv = toCSV(job);
  assert.ok(csv.startsWith('\ufeff'));
  assert.ok(csv.includes('"\'=HYPERLINK(""bad"")"'));
  assert.ok(csv.includes('"Банк; ЕС"'));
  assert.ok(csv.includes('"partial"'));
});
test('HTTP workflow: defaults, validation, real job lifecycle, CSV and static files', async t => {
  const released = calendarWindow().to;
  const server = createApp({ provider: { search: async () => [app()], app: async () => app({ released }) }, delay: 0 });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const defaults = await (await fetch(`${base}/api/defaults`)).json();
  assert.equal(defaults.countries.length, 27);
  assert.match(await (await fetch(base)).text(), /Play Scout/);
  assert.equal((await fetch(`${base}/app.js`)).status, 200);
  assert.equal((await fetch(`${base}/api/search`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
  assert.equal((await fetch(`${base}/api/search`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' }, body: '{}' })).status, 403);
  const start = await fetch(`${base}/api/search`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ countries: ['DE'], keywords: ['банк'] }) });
  assert.equal(start.status, 202);
  let job = await start.json();
  for (let i = 0; i < 50 && job.status === 'running'; i++) {
    await new Promise(resolve => setTimeout(resolve, 5));
    job = await (await fetch(`${base}/api/jobs/${job.id}`)).json();
  }
  assert.equal(job.status, 'complete');
  assert.equal(job.results.length, 1);
  const csv = await fetch(`${base}/api/jobs/${job.id}/export.csv`);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(await csv.text(), /Business Bank/);
  assert.equal((await fetch(`${base}/api/jobs/not-found`)).status, 404);
});

test('active jobs can be recovered in a new browser, concurrent searches are rejected, cancel works', async t => {
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const server = createApp({ provider: { search: () => blocked }, delay: 0 });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { release([]); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const options = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ countries: ['DE'], keywords: ['банк'] }) };
  const job = await (await fetch(`${base}/api/search`, options)).json();
  assert.equal((await (await fetch(`${base}/api/active`)).json()).id, job.id);
  assert.equal((await fetch(`${base}/api/search`, options)).status, 409);
  const cancelled = await (await fetch(`${base}/api/jobs/${job.id}/cancel`, { method: 'POST' })).json();
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(await (await fetch(`${base}/api/active`)).json(), null);
});
