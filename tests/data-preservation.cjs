// Isolated compatibility and sync tests. No real GitHub requests or user data.
// NODE_PATH=<directory containing playwright> node tests/data-preservation.cjs
// Optional: PREVIOUS_APP_REF=<published commit> (defaults to current Git HEAD).
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const STORE_KEY = 'sport-journal.v1';
const BACKUP_KEY = 'sport-journal.backup.before-night-v1';
const TEST_TOKEN = 'synthetic-test-token-not-a-real-credential';
const DATE = '2026-10-15';
const WORKOUT = `workouts/${DATE}.json`;
const clone = value => JSON.parse(JSON.stringify(value));
const serialize = value => JSON.stringify(value, null, 2) + '\n';
const base64 = text => Buffer.from(text, 'utf8').toString('base64');
let checks = 0;
function equal(actual, expected, label) { assert.deepEqual(actual, expected, label); checks++; }
function ok(value, label) { assert.ok(value, label); checks++; }
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function legacyStore({ token = TEST_TOKEN, pending = true } = {}) {
  const exercise = { id: 'sample', name: 'Тестовое упражнение', sets: 3, reps: '8-12', rest: '60 с', alts: [] };
  const program = {
    title: 'Синтетическая старая программа', start: '2026-10-05', weeks: 8,
    phases: [{ from: 1, to: 8, key: 'main', name: 'Основной этап', hint: '' }],
    schedule: { 1: 'A', 2: 'A', 3: 'run', 4: 'A', 5: 'A', 6: 'A', 7: 'rest' },
    sessions: { A: { title: 'Верх A', items: [exercise] }, L: { title: 'Ноги', items: [] }, B: { title: 'Верх B', items: [] } },
    nutrition: {
      targets: { kcal: 2000, protein: 100, fat: '60 г', carbs: '250 г', water: '2 л' },
      meals: [{ id: 'breakfast', title: 'Завтрак', options: [{ id: 'plan', text: 'Тестовый завтрак', kcal: 400, p: 20 }] }],
      sweets: { plan: 150, over: 450 }, supplements: []
    },
    legacyProgramField: { preserve: true }
  };
  const files = {
    'program.json': { sha: 'program-original', data: program },
    [WORKOUT]: {
      sha: 'workout-original', legacyEnvelope: 'keep',
      data: {
        date: DATE, type: 'A', sets: { sample: [{ w: 40, r: 8, legacySetField: 'keep' }] },
        swaps: {}, run: {}, note: 'Старая локальная запись', legacyWorkoutField: { preserve: true }
      }
    },
    'workouts/2026-10-14.json': {
      sha: 'previous-workout', data: { date: '2026-10-14', type: 'A', sets: { sample: [{ w: 38, r: 8 }] }, run: {}, note: 'Предыдущий день' }
    },
    'body/2026-10.json': {
      sha: 'body-original', data: {
        weights: { '2026-10-14': 80.2, [DATE]: 80.1 }, waist: { [DATE]: 90 },
        lower: { [DATE]: 94 }, sleep: { [DATE]: 7.5 }, steps: { [DATE]: 8200 },
        legacyBodyField: { preserve: true }
      }
    },
    'food/2026-10.json': {
      sha: 'food-original', data: {
        days: {
          [DATE]: {
            meals: { breakfast: { opt: 'other', text: 'Еда без расчёта', k: null, p: null, legacyMealField: 'keep' } },
            extra: [{ text: 'Старый перекус', k: 123, p: 4, legacyExtraField: 'keep' }],
            sweets: 'over', supp: { syntheticSupplement: true }, legacyDayField: 'keep'
          }
        },
        legacyFoodField: { preserve: true }
      }
    }
  };
  return {
    cfg: { owner: 'synthetic-owner', repo: 'synthetic-sport', branch: 'main', token, legacyCfgField: 'keep' },
    files, pending: pending ? { [WORKOUT]: 1, 'food/2026-10.json': 1 } : {}, lastSync: 1234567890
  };
}

let servePrevious = false;
const previous = new Map();
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  let filename;
  try { filename = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname)); }
  catch { res.writeHead(400).end(); return; }
  if (filename !== root && !filename.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  if (filename === root) filename = path.join(root, 'index.html');
  const rel = path.relative(root, filename).split(path.sep).join('/');
  const deliver = body => {
    // The test has no reason to fetch remote fonts, including from a service worker.
    if (path.extname(filename) === '.html') body = Buffer.from(body.toString('utf8').replace(/<link\b[^>]*(?:fonts\.googleapis\.com|fonts\.gstatic\.com)[^>]*>/gi, ''), 'utf8');
    res.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(body);
  };
  if (servePrevious && previous.has(rel)) { deliver(previous.get(rel)); return; }
  fs.readFile(filename, (error, body) => {
    if (error) { res.writeHead(404).end(); return; }
    deliver(body);
  });
});

function apiMock(seed, mode) {
  const remote = clone(seed.files);
  const requests = [];
  const blobSeen = deferred(), releaseBlob = deferred();
  if (mode === 'race' || mode === 'conflict') {
    remote[WORKOUT].sha = 'workout-remote-new';
    remote[WORKOUT].data.note = 'Более новая запись в mock remote';
  }
  const reply = (route, status, data) => route.fulfill({ status, contentType: 'application/json', body: status === 204 ? '' : JSON.stringify(data), headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,PUT,OPTIONS', 'access-control-allow-headers': '*' } });
  return {
    remote, requests, blobSeen, releaseBlob,
    async handle(route) {
      const request = route.request(), url = new URL(request.url()), method = request.method();
      if (method === 'OPTIONS') return reply(route, 204, {});
      requests.push({ method, path: url.pathname, body: method === 'PUT' ? request.postDataJSON() : null });
      if (mode === 'offline') return reply(route, 503, { message: 'Synthetic offline endpoint' });
      if (method === 'GET' && url.pathname.includes('/git/trees/')) {
        return reply(route, 200, { tree: Object.entries(remote).map(([p, f]) => ({ path: p, type: 'blob', sha: f.sha })) });
      }
      if (method === 'GET' && url.pathname.includes('/git/blobs/')) {
        const sha = decodeURIComponent(url.pathname.split('/').pop());
        const file = Object.values(remote).find(f => f.sha === sha);
        if (!file) throw new Error('Unexpected mock blob');
        if (mode === 'race' && sha === remote[WORKOUT].sha) {
          blobSeen.resolve();
          await releaseBlob.promise;
        }
        return reply(route, 200, { encoding: 'base64', content: base64(serialize(file.data)) });
      }
      if (url.pathname.includes('/contents/')) {
        const p = decodeURIComponent(url.pathname.split('/contents/')[1]);
        if (method === 'GET') {
          const file = remote[p];
          if (!file) return reply(route, 404, { message: 'Not found' });
          return reply(route, 200, { sha: file.sha, encoding: 'base64', content: base64(serialize(file.data)) });
        }
        if (method === 'PUT') {
          if (mode === 'race') return reply(route, 503, { message: 'Keep synthetic edit pending' });
          const puts = requests.filter(r => r.method === 'PUT');
          if (puts.length === 1) return reply(route, 409, { message: 'Synthetic SHA conflict' });
          // Simulate the old unsafe retry: tests must detect any remote overwrite.
          remote[p] = { sha: 'unsafe-overwrite', data: JSON.parse(Buffer.from(request.postDataJSON().content, 'base64').toString('utf8')) };
          return reply(route, 200, { content: { sha: remote[p].sha } });
        }
      }
      throw new Error(`Unexpected mock API method/path: ${method} ${url.pathname}`);
    }
  };
}

async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  const errors = [];
  const contexts = [];
  async function open(seed, mock, { serviceWorkers = 'block' } = {}) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: 'Europe/Moscow', serviceWorkers, acceptDownloads: true });
    contexts.push(context);
    await context.route('**/*', async route => {
      if (route.request().url().startsWith(url)) return route.continue();
      if (route.request().url().startsWith('https://api.github.com/')) {
        try { return await mock.handle(route); }
        catch (error) { errors.push(error.message); return route.abort(); }
      }
      return route.abort();
    });
    const raw = JSON.stringify(seed, null, 2);
    await context.addInitScript(({ key, raw }) => { if (localStorage.getItem(key) === null) localStorage.setItem(key, raw); }, { key: STORE_KEY, raw });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.install({ time: new Date('2026-10-15T12:00:00+03:00') });
    await page.goto(url);
    return { context, page, raw };
  }
  const store = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORE_KEY);
  const backupRaw = page => page.evaluate(key => localStorage.getItem(key), BACKUP_KEY);
  async function navigate(page, tab) {
    const bottom = page.locator(`#tabs [data-tab="${tab}"]`);
    if (await bottom.count()) return bottom.first().click();
    if (tab !== 'overview') await navigate(page, 'overview');
    await page.locator(`[data-act="navigate"][data-tab="${tab}"]`).first().click();
  }
  async function noteInput(page) {
    const input = page.locator('#in-note');
    await input.waitFor({ state: 'attached' });
    if (!await input.isVisible()) {
      const details = input.locator('xpath=ancestor::details[1]');
      await details.locator('summary').click();
    }
    return input;
  }
  async function downloadJSON(page, action) {
    const promise = page.waitForEvent('download');
    await page.locator(`[data-act="${action}"]`).click();
    const download = await promise;
    const raw = fs.readFileSync(await download.path(), 'utf8');
    ok(!raw.includes(TEST_TOKEN), `${action}: synthetic token is not included`);
    ok(!/"token"\s*:/.test(raw), `${action}: credential field is not exported`);
    return JSON.parse(raw);
  }
  function exportedData(backup, p) {
    if (backup.files?.[p]) return backup.files[p].data;
    if (p === 'program.json') return backup.program;
    if (p.startsWith('workouts/')) return backup.workouts?.[p.slice(9, -5)];
    if (p.startsWith('body/')) return backup.body?.[p.slice(5, -5)];
    if (p.startsWith('food/')) return backup.food?.[p.slice(5, -5)];
  }
  try {
    // 1. Existing records and the original raw snapshot survive read-only browsing.
    {
      const seed = legacyStore(), mock = apiMock(seed, 'offline');
      const { context, page, raw } = await open(seed, mock);
      await page.waitForFunction(() => document.querySelector('#status')?.classList.contains('err'));
      equal(await backupRaw(page), raw, 'Upgrade backup preserves the exact pre-restore raw value');
      for (const tab of ['today', 'food', 'body', 'history', 'program', 'overview']) await navigate(page, tab);
      let saved = await store(page);
      equal(saved.files, seed.files, 'Browsing all sections preserves legacy and unknown fields');
      equal(saved.pending, seed.pending, 'Browsing preserves all dirty flags');
      equal(saved.cfg, seed.cfg, 'Browsing preserves repository settings and credential');
      await page.reload();
      equal(await backupRaw(page), raw, 'Reload does not reset the original upgrade snapshot');
      await page.locator('#gear').click();
      const download = await downloadJSON(page, 'download-backup');
      for (const p of Object.keys(seed.files)) equal(exportedData(download, p), seed.files[p].data, `Download includes complete legacy payload: ${p}`);
      const upgradeDownload = await downloadJSON(page, 'download-upgrade-backup');
      for (const p of Object.keys(seed.files)) equal(exportedData(upgradeDownload, p), seed.files[p].data, `Pre-upgrade download includes original payload: ${p}`);
      await navigate(page, 'today');
      const input = await noteInput(page);
      await input.fill('Правка после создания резервной копии');
      await input.blur();
      await page.reload();
      equal(await backupRaw(page), raw, 'A later edit/reload never replaces the original upgrade snapshot');
      saved = await store(page);
      equal(saved.files[WORKOUT].data.note, 'Правка после создания резервной копии', 'Edited note survives reload');
      equal(saved.files[WORKOUT].data.sets, seed.files[WORKOUT].data.sets, 'Editing a note preserves unknown set fields');
      equal(saved.files['food/2026-10.json'], seed.files['food/2026-10.json'], 'Editing workout preserves all old food data');
      equal(mock.requests.filter(r => r.method === 'PUT').length, 0, 'Read-only navigation/download never writes to the mock remote');
      await context.close();
    }

    // 2. A user edit made while a blob GET is in flight cannot be replaced by it.
    {
      const seed = legacyStore({ pending: false }), mock = apiMock(seed, 'race');
      const { context, page } = await open(seed, mock);
      await Promise.race([mock.blobSeen.promise, new Promise((_, reject) => setTimeout(() => reject(new Error('Delayed blob request did not start')), 10000))]);
      await navigate(page, 'today');
      const input = await noteInput(page);
      await input.fill('Локальная правка во время GET');
      await input.blur();
      const response = page.waitForResponse(r => r.url().startsWith('https://api.github.com/') && r.request().method() === 'PUT');
      mock.releaseBlob.resolve();
      await response;
      await page.waitForFunction(() => document.querySelector('#status')?.classList.contains('err'));
      const saved = await store(page);
      equal(saved.files[WORKOUT].data.note, 'Локальная правка во время GET', 'A delayed pull cannot overwrite a newly dirty file');
      equal(saved.pending[WORKOUT], 1, 'The unsent edit remains pending after a failed mock push');
      const put = mock.requests.find(r => r.method === 'PUT');
      equal(JSON.parse(Buffer.from(put.body.content, 'base64').toString('utf8')).note, 'Локальная правка во время GET', 'Push serializes the local edit, not the delayed remote snapshot');
      equal(mock.remote[WORKOUT].data.note, 'Более новая запись в mock remote', 'The failed mock push leaves remote data unchanged');
      await context.close();
    }

    // 3. A real content conflict stops instead of retrying with the new remote SHA.
    {
      const seed = legacyStore();
      seed.pending = { [WORKOUT]: 1 };
      const mock = apiMock(seed, 'conflict'), remoteBefore = clone(mock.remote);
      const { context, page } = await open(seed, mock);
      await page.waitForFunction(() => document.querySelector('#status')?.classList.contains('err'));
      const saved = await store(page);
      equal(mock.requests.filter(r => r.method === 'PUT').length, 1, 'Conflicting content never triggers a second PUT');
      equal(mock.remote, remoteBefore, 'Conflicting remote records are not overwritten');
      equal(saved.files, seed.files, 'Conflict preserves the entire local file set');
      equal(saved.pending, seed.pending, 'Conflict preserves pending changes');
      ok(mock.requests.some(r => r.method === 'GET' && r.path.includes('/contents/')), 'Conflict checks current remote content');
      await context.close();
    }

    // 4. An already accepted identical payload is acknowledged without another PUT.
    {
      const seed = legacyStore();
      seed.pending = { [WORKOUT]: 1 };
      const mock = apiMock(seed, 'same-content');
      mock.remote[WORKOUT].sha = 'already-written-sha';
      const { context, page } = await open(seed, mock);
      await page.waitForFunction(({ key, p }) => !JSON.parse(localStorage.getItem(key)).pending[p], { key: STORE_KEY, p: WORKOUT });
      const saved = await store(page);
      equal(mock.requests.filter(r => r.method === 'PUT').length, 1, 'Identical remote payload is acknowledged without a second PUT');
      equal(saved.files[WORKOUT].sha, 'already-written-sha', 'Identical remote payload updates the acknowledged SHA');
      equal(saved.files[WORKOUT].data, seed.files[WORKOUT].data, 'Acknowledging an identical payload preserves all fields');
      equal(saved.pending, {}, 'Only acknowledged unchanged data clears its dirty flag');
      await context.close();
    }

    // 5. Update the actually installed old worker, then reopen the new shell offline.
    const ref = process.env.PREVIOUS_APP_REF || 'HEAD';
    let oldSw;
    try {
      for (const p of ['index.html', 'app.js', 'app.css', 'sw.js', 'manifest.webmanifest']) previous.set(p, execFileSync('git', ['show', `${ref}:${p}`], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }));
      oldSw = previous.get('sw.js').toString('utf8');
    } catch { console.log('NOT_RUN: SW upgrade baseline unavailable; set PREVIOUS_APP_REF to the prior published commit.'); }
    if (oldSw) {
      const oldCache = oldSw.match(/var\s+CACHE\s*=\s*['"]([^'"]+)/)?.[1];
      const newCache = fs.readFileSync(path.join(root, 'sw.js'), 'utf8').match(/var\s+CACHE\s*=\s*['"]([^'"]+)/)?.[1];
      if (!oldCache || oldCache === newCache) {
        console.log('NOT_RUN: SW baseline has the current cache version; set PREVIOUS_APP_REF to the prior published commit.');
      } else {
        servePrevious = true;
        const seed = legacyStore({ token: '' }), mock = apiMock(seed, 'offline');
        const { context, page } = await open(seed, mock, { serviceWorkers: 'allow' });
        await page.evaluate(async () => {
          await navigator.serviceWorker.ready;
          if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
        });
        ok((await page.evaluate(() => caches.keys())).includes(oldCache), `Published worker ${oldCache} is installed before update`);
        // The old page flushes on pagehide. Flush it through ordinary navigation
        // first so the expected raw snapshot has the exact persisted formatting.
        await page.locator('#gear').click();
        await page.locator('#gear').click();
        const beforeRaw = await page.evaluate(key => localStorage.getItem(key), STORE_KEY);
        const beforeBackup = await backupRaw(page) || beforeRaw;
        servePrevious = false;
        await page.evaluate(async () => {
          const changed = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('New service worker did not claim the old page')), 15000);
            navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(timeout); resolve(); }, { once: true });
          });
          await (await navigator.serviceWorker.getRegistration()).update();
          await changed;
        });
        ok((await page.evaluate(() => caches.keys())).includes(newCache), `New worker ${newCache} replaced the previous worker`);
        await page.reload();
        equal(await backupRaw(page), beforeBackup, 'SW upgrade preserves an existing backup or backs up the old dirty store');
        let saved = await store(page);
        equal(saved.files, seed.files, 'SW update preserves every legacy field');
        equal(saved.pending, seed.pending, 'SW update preserves unsent records');
        await context.setOffline(true);
        await page.reload({ waitUntil: 'domcontentloaded' });
        equal(await page.evaluate(() => typeof window.SportHealth.parse), 'function', 'Health parser is available after an offline upgrade');
        await navigate(page, 'food');
        saved = await store(page);
        equal(saved.files, seed.files, 'Offline reopening after SW update preserves every legacy field');
        equal(saved.pending, seed.pending, 'Offline reopening after SW update preserves dirty flags');
        equal(await backupRaw(page), beforeBackup, 'Offline reopening leaves the upgrade snapshot unchanged');
        equal(mock.requests.filter(r => r.method === 'PUT').length, 0, 'SW test sends no data to any remote API');
        await context.close();
      }
    }
    equal(errors, [], 'No page errors or unexpected mock API routes');
    console.log(`PASS: ${checks} data-preservation checks; legacy snapshots, token-free downloads, dirty pull race, content conflicts, and compatible SW upgrade when a prior version is available.`);
  } finally {
    servePrevious = false;
    for (const context of contexts) await context.close().catch(() => {});
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
