// Isolated daily-entry/progress regression checks. Synthetic records only.
// NODE_PATH=<directory containing playwright> node tests/daily-progress.cjs
// Optional: TEST_ARTIFACT_DIR=<output directory>, PLAYWRIGHT_CHANNEL=chrome.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const STORE_KEY = 'sport-journal.v1';
const TODAY = '2026-10-16';
const BODY = 'body/2026-10.json';
const HEALTH = 'health/2026-10-15.json';
const clone = value => JSON.parse(JSON.stringify(value));
let checks = 0;
function equal(actual, expected, label) { assert.deepEqual(actual, expected, label); checks++; }
function ok(value, label) { assert.ok(value, label); checks++; }
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  const exercise = { id: 'sample', name: 'Синтетическое упражнение', sets: 3, reps: '8-12', rest: '60 с', alts: [] };
  const program = {
    title: 'Синтетический дневник', start: '2026-10-05', weeks: 8,
    phases: [{ from: 1, to: 8, key: 'main', name: 'Основной этап', hint: '' }],
    schedule: { 1: 'A', 2: 'A', 3: 'run', 4: 'A', 5: 'A', 6: 'A', 7: 'rest' },
    sessions: { A: { title: 'Тест A', items: [exercise] }, L: { title: 'Ноги', items: [] }, B: { title: 'Тест B', items: [] } },
    nutrition: {
      targets: { kcal: 2000, protein: 100, fat: '60 г', carbs: '250 г', water: '2 л' },
      meals: [{ id: 'breakfast', title: 'Завтрак', options: [{ id: 'plan', text: 'Тестовый завтрак', kcal: 400, p: 20 }] }],
      sweets: { plan: 150, over: 450 }, supplements: []
    },
    unknownProgram: { keep: true }
  };
  return {
    cfg: { owner: 'synthetic-owner', repo: 'synthetic-sport', branch: 'main', token: '', unknownCfg: 'keep' },
    files: {
      'program.json': { sha: 'program-synthetic', data: program },
      [BODY]: {
        sha: 'body-synthetic', unknownEnvelope: 'keep',
        data: {
          weights: { '2026-10-05': 81.4, '2026-10-10': 80.8, '2026-10-12': 80.4, '2026-10-14': 80.2, [TODAY]: 80.1 },
          waist: { '2026-10-05': 91.1, '2026-10-12': 90.5, [TODAY]: 90 },
          lower: { '2026-10-12': 94.4, [TODAY]: 94 },
          sleep: { '2026-10-15': 6.5, [TODAY]: 7.25 },
          steps: { '2026-10-12': 7800, '2026-10-15': 8100, [TODAY]: 0 },
          unknownBody: { keep: ['all', 'values'], nested: { marker: 42 } },
          customMetric: { '2026-10-14': 123 }
        }
      },
      'food/2026-10.json': { sha: 'food-synthetic', data: { days: {}, unknownFood: { keep: true } } },
      'workouts/2026-10-12.json': {
        sha: 'workout-older', data: { date: '2026-10-12', type: 'A', sets: { sample: [{ w: 38, r: 8, unknownSet: 'keep' }] }, swaps: {}, run: {}, note: 'Synthetic older record' }
      },
      'workouts/2026-10-14.json': {
        sha: 'workout-missing-weight', data: { date: '2026-10-14', type: 'A', sets: { sample: [{ w: null, r: 9, unknownSet: 'keep' }] }, swaps: {}, run: {}, note: 'Synthetic missing weight' }
      },
      'workouts/2026-10-15.json': {
        sha: 'workout-pending', unknownEnvelope: 'keep', data: { date: '2026-10-15', type: 'A', sets: { sample: [{ w: 40, r: 8, unknownSet: 'keep' }] }, swaps: {}, run: {}, note: 'Synthetic pending record', unknownWorkout: { keep: true } }
      },
      [HEALTH]: {
        sha: 'health-synthetic', data: { format: 'sport-health.day.v1', date: '2026-10-15', source: 'Apple Health', steps: 8500, sleepHours: 8.25, sleepIntervals: [], receivedAt: '2026-10-16T08:00:00+03:00', unknownImport: 'keep' }
      },
      'health/2026-10-13.json': {
        sha: 'health-only', data: { format: 'sport-health.day.v1', date: '2026-10-13', source: 'Apple Health', steps: 9200, sleepHours: 8.5, sleepIntervals: [], receivedAt: '2026-10-14T08:00:00+03:00', unknownImport: { keep: true } }
      }
    },
    pending: { 'food/2026-10.json': 1, 'workouts/2026-10-15.json': 1 },
    lastSync: 1234567890
  };
}

const contentTypes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  let filename;
  try { filename = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname)); }
  catch { res.writeHead(400).end(); return; }
  if (filename !== root && !filename.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  if (filename === root) filename = path.join(root, 'index.html');
  fs.readFile(filename, (error, raw) => {
    if (error) { res.writeHead(404).end(); return; }
    const body = path.extname(filename) === '.html'
      ? Buffer.from(raw.toString('utf8').replace(/<link\b[^>]*(?:fonts\.googleapis\.com|fonts\.gstatic\.com)[^>]*>/gi, ''))
      : raw;
    res.writeHead(200, { 'Content-Type': contentTypes[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(body);
  });
});

async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  const errors = [], contexts = [];
  let apiRequests = 0;
  const act = (page, name) => page.locator(`[data-act="${name}"]`);
  const stored = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORE_KEY);
  async function settle(page) { await page.clock.runFor(350); }
  async function open({ serviceWorkers = 'block', seed: suppliedSeed, apiMock } = {}) {
    const seed = suppliedSeed ? clone(suppliedSeed) : fixture();
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: 'Europe/Moscow', serviceWorkers });
    contexts.push(context);
    await context.route('**/*', route => {
      if (route.request().url().startsWith(baseUrl)) return route.continue();
      if (route.request().url().startsWith('https://api.github.com/')) {
        if (apiMock) return apiMock(route);
        apiRequests++;
      }
      return route.abort();
    });
    await context.addInitScript(({ key, seed }) => { if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(seed)); }, { key: STORE_KEY, seed });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.install({ time: new Date('2026-10-16T12:00:00+03:00') });
    await page.goto(baseUrl);
    await page.locator('#daily-save').waitFor();
    return { context, page, seed };
  }
  async function overview(page) {
    await page.locator('#tabs [data-tab="overview"]').tap();
    await page.locator('#daily-save').waitFor();
  }
  async function choose(page, date) {
    const toggle = act(page, 'calendar-toggle').first();
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.tap();
    const current = await page.locator('.calendar-day').first().getAttribute('data-date');
    const a = current.split('-').map(Number), b = date.split('-').map(Number);
    const months = (b[0] - a[0]) * 12 + b[1] - a[1];
    for (let i = 0; i < Math.abs(months); i++) await act(page, months < 0 ? 'calendar-prev' : 'calendar-next').tap();
    await page.locator(`.calendar-day[data-date="${date}"]`).tap();
    await page.locator('#daily-save').waitFor();
  }
  async function input(page, id, value) { await page.locator(id).fill(value); await settle(page); }
  async function save(page) { await page.locator('#daily-save').tap(); await settle(page); }
  async function graph(page, metric) {
    await page.locator(`[data-act="metric-open"][data-metric="${metric}"]`).first().tap();
    await page.locator('#progress-chart').waitFor();
  }
  async function point(page, date) {
    const button = date ? page.locator(`[data-act="progress-point"][data-date="${date}"]`) : act(page, 'progress-point').first();
    if (!await button.isVisible()) await page.locator('.progress-records > summary').tap();
    await button.tap();
  }
  async function unchanged(page, seed, label) {
    await settle(page);
    const saved = await stored(page);
    equal(saved.files, seed.files, `${label}: all committed records/envelopes are unchanged`);
    equal(saved.pending, seed.pending, `${label}: existing pending flags are unchanged`);
    equal(saved.cfg, seed.cfg, `${label}: settings/unknown configuration survive`);
  }
  async function layout(page, label) {
    const geometry = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
      smallInputs: [...document.querySelectorAll('input,textarea,select')].filter(el => el.getClientRects().length && parseFloat(getComputedStyle(el).fontSize) < 16).map(el => el.id),
      chart: (() => { const el = document.querySelector('#progress-chart'); const r = el?.getBoundingClientRect(); return r ? { left: r.left, right: r.right, width: r.width } : null; })(),
      scale: visualViewport.scale
    }));
    ok(geometry.scroll <= geometry.width + 1, `${label}: no horizontal document overflow`);
    equal(geometry.smallInputs, [], `${label}: visible input text remains at least 16px`);
    equal(geometry.scale, 1, `${label}: viewport remains at scale 1`);
    if (geometry.chart) ok(geometry.chart.left >= -1 && geometry.chart.right <= geometry.width + 1 && geometry.chart.width > 0, `${label}: responsive chart stays inside viewport`);
  }

  try {
    // Drafts are durable local input, never saved body data or an implicit dirty file.
    {
      const { page, seed, context } = await open();
      equal(await page.locator('#tabs [data-tab="overview"]').getAttribute('aria-selected'), 'true', 'Overview opens first');
      equal(await page.locator('#in-weight').inputValue(), '80,1', 'Existing weight is visible');
      equal(await page.locator('#in-sleep-hours').inputValue(), '7', 'Sleep uses whole hours');
      equal(await page.locator('#in-sleep-minutes').inputValue(), '15', 'Fractional sleep is shown as minutes');
      equal(await page.locator('#in-steps').inputValue(), '0', 'Actual manual zero remains visible');
      await input(page, '#in-weight', '80,');
      await input(page, '#in-steps', '10000');
      await input(page, '#in-sleep-minutes', '30');
      await unchanged(page, seed, 'Typing a daily draft');
      ok((await stored(page)).dailyDrafts?.[TODAY], 'A draft persists separately under dailyDrafts');
      await graph(page, 'weights');
      await unchanged(page, seed, 'Opening a metric label');
      await page.locator('[data-act="progress-period"][data-period="30"]').tap();
      await act(page, 'progress-back').tap();
      equal(await page.locator('#in-weight').inputValue(), '80,', 'Graph back preserves unfinished decimal input');
      equal(await page.locator('#in-steps').inputValue(), '10000', 'Graph back preserves step draft');
      await choose(page, '2026-10-14');
      await input(page, '#in-sleep-hours', '8');
      await page.locator('#tabs [data-tab="today"]').tap();
      await page.locator('#tabs [data-tab="food"]').tap();
      await overview(page);
      await choose(page, TODAY);
      equal(await page.locator('#in-weight').inputValue(), '80,', 'Draft survives tab/date changes');
      equal(await page.locator('#in-sleep-minutes').inputValue(), '30', 'Draft minutes survive tab/date changes');
      await page.reload();
      await page.locator('#daily-save').waitFor();
      equal(await page.locator('#in-weight').inputValue(), '80,', 'Draft survives reload');
      equal(await page.locator('#in-steps').inputValue(), '10000', 'Draft steps survive reload');
      await choose(page, '2026-10-14');
      equal(await page.locator('#in-sleep-hours').inputValue(), '8', 'A second date keeps its independent draft after reload');
      await unchanged(page, seed, 'Draft navigation/reload');
      await context.close();
    }

    // Save validates the entire changed draft first, then writes only changed metrics.
    {
      const { page, seed, context } = await open();
      await input(page, '#in-weight', '80,3');
      await input(page, '#in-sleep-minutes', '75');
      await save(page);
      ok((await page.locator('#daily-status').innerText()).trim().length > 0, 'Invalid sleep minutes explain the failed save');
      await unchanged(page, seed, 'Atomic validation failure');
      equal(await page.locator('#in-weight').inputValue(), '80,3', 'Failed save keeps all typed fields');
      await input(page, '#in-sleep-hours', '7');
      await input(page, '#in-sleep-minutes', '30');
      await save(page);
      let saved = await stored(page);
      const expected = clone(seed.files[BODY]);
      expected.data.weights[TODAY] = 80.3;
      expected.data.sleep[TODAY] = 7.5;
      delete saved.files[BODY].data.updatedAt;
      equal(saved.files[BODY], expected, 'Save writes weight and converted sleep only, preserving the complete body envelope');
      for (const p of Object.keys(seed.files).filter(p => p !== BODY)) equal(saved.files[p], seed.files[p], `Save preserves unrelated data: ${p}`);
      equal(saved.pending, { ...seed.pending, [BODY]: 1 }, 'Save adds only the monthly body pending flag');
      ok(!saved.dailyDrafts?.[TODAY], 'Successful save clears only its date draft');
      equal(saved.files[BODY].data.steps[TODAY], 0, 'Untouched manual zero is not lost');
      await context.close();
    }

    // Imported displays are never silently copied into manual fields; explicit clears
    // delete manual data only and reveal the existing imported fallback.
    {
      const { page, seed, context } = await open();
      await choose(page, '2026-10-13');
      equal(await page.locator('#in-steps').inputValue(), '9200', 'Import-only steps display without creating a manual record');
      equal(await page.locator('#in-sleep-hours').inputValue(), '8', 'Import-only sleep hours display');
      equal(await page.locator('#in-sleep-minutes').inputValue(), '30', 'Import-only sleep minutes display');
      await input(page, '#in-weight', '80,55');
      await save(page);
      let saved = await stored(page);
      equal(saved.files[BODY].data.weights['2026-10-13'], 80.55, 'An independent metric can be saved on an imported day');
      equal(saved.files[BODY].data.steps['2026-10-13'], undefined, 'Untouched imported steps never become manual');
      equal(saved.files[BODY].data.sleep['2026-10-13'], undefined, 'Untouched imported sleep never becomes manual');
      equal(saved.files['health/2026-10-13.json'], seed.files['health/2026-10-13.json'], 'Saving a daily field leaves its Health file untouched');
      await choose(page, '2026-10-15');
      await input(page, '#in-sleep-hours', '');
      await input(page, '#in-sleep-minutes', '');
      await input(page, '#in-steps', '');
      const beforeClear = await stored(page);
      equal(beforeClear.files[BODY].data.sleep['2026-10-15'], 6.5, 'Clearing remains a draft until Save');
      equal(beforeClear.files[BODY].data.steps['2026-10-15'], 8100, 'Step clear remains a draft until Save');
      await save(page);
      saved = await stored(page);
      equal(saved.files[BODY].data.sleep['2026-10-15'], undefined, 'Explicit clear deletes manual sleep');
      equal(saved.files[BODY].data.steps['2026-10-15'], undefined, 'Explicit clear deletes manual steps');
      equal(saved.files[HEALTH], seed.files[HEALTH], 'Explicit clears preserve the separate Health record');
      equal(await page.locator('#in-sleep-hours').inputValue(), '8', 'Clearing manual sleep reveals imported hours');
      equal(await page.locator('#in-sleep-minutes').inputValue(), '15', 'Clearing manual sleep reveals imported minutes');
      equal(await page.locator('#in-steps').inputValue(), '8500', 'Clearing manual steps reveals imported steps');
      equal(saved.files[BODY].data.unknownBody, seed.files[BODY].data.unknownBody, 'Explicit clears preserve unknown body fields');
      await context.close();
    }

    // Empty fields stay missing. A partial sleep entry is deliberate input, not a
    // request to save every displayed/default metric.
    {
      const { page, seed, context } = await open();
      await choose(page, '2026-09-30');
      await input(page, '#in-weight', '81');
      await input(page, '#in-weight', '');
      await save(page);
      await unchanged(page, seed, 'Typing then clearing an absent value');
      equal((await stored(page)).files['body/2026-09.json'], undefined, 'Clearing a new field creates no empty monthly file');
      await choose(page, '2026-10-11');
      for (const id of ['#in-weight', '#in-sleep-hours', '#in-sleep-minutes', '#in-steps']) equal(await page.locator(id).inputValue(), '', `${id}: missing day starts blank`);
      ok(await page.locator('#daily-save').isDisabled(), 'An untouched blank day cannot queue a save');
      await input(page, '#in-sleep-minutes', '30');
      await save(page);
      let saved = await stored(page);
      equal(saved.files[BODY].data.sleep['2026-10-11'], 0.5, 'Minutes-only entry saves a deliberate half hour');
      equal(saved.files[BODY].data.weights['2026-10-11'], undefined, 'Blank weight never becomes zero');
      equal(saved.files[BODY].data.steps['2026-10-11'], undefined, 'Blank steps never become zero');
      await choose(page, '2026-10-09');
      await input(page, '#in-sleep-hours', '7');
      await save(page);
      saved = await stored(page);
      equal(saved.files[BODY].data.sleep['2026-10-09'], 7, 'Hours-only entry saves full hours');
      await act(page, 'show-measure').first().tap();
      await input(page, '#in-waist', '89,5');
      await input(page, '#in-lower', 'bad');
      const beforeInvalid = await stored(page);
      await save(page);
      const afterInvalid = await stored(page);
      equal(afterInvalid.files, beforeInvalid.files, 'Invalid measurement prevents the otherwise valid waist update');
      equal(afterInvalid.pending, beforeInvalid.pending, 'Invalid measurement preserves the exact pending set');
      await input(page, '#in-lower', '93');
      await save(page);
      saved = await stored(page);
      equal(saved.files[BODY].data.waist['2026-10-09'], 89.5, 'Valid waist draft saves');
      equal(saved.files[BODY].data.lower['2026-10-09'], 93, 'Valid lower measurement saves');
      equal(saved.files[BODY].data.unknownBody, seed.files[BODY].data.unknownBody, 'Partial sleep/measure saves preserve unknown data');
      await context.close();
    }

    // Metric graphs contain known observations only, retaining true zero values.
    {
      const { page, seed, context } = await open();
      await input(page, '#in-weight', '80,7');
      const expectedDates = {
        weights: ['2026-10-10', '2026-10-12', '2026-10-14', TODAY],
        steps: ['2026-10-12', '2026-10-13', '2026-10-15', TODAY],
        sleep: ['2026-10-13', '2026-10-15', TODAY],
        waist: ['2026-10-12', TODAY], lower: ['2026-10-12', TODAY]
      };
      for (const metric of Object.keys(expectedDates)) {
        if ((metric === 'waist' || metric === 'lower') && !(await page.locator(`[data-act="metric-open"][data-metric="${metric}"]`).count())) await act(page, 'show-measure').first().tap();
        await graph(page, metric);
        await page.locator('[data-act="progress-period"][data-period="7"]').tap();
        const dates = await act(page, 'progress-point').evaluateAll(nodes => nodes.map(node => node.dataset.date).sort());
        equal(dates, expectedDates[metric], `${metric}: week graph has actual observations only`);
        if (metric === 'steps') equal(await page.locator(`[data-act="progress-point"][data-date="${TODAY}"]`).getAttribute('data-value'), '0', 'A real zero step value is a selectable graph point');
        for (const period of ['30', 'cycle', '7']) {
          await page.locator(`[data-act="progress-period"][data-period="${period}"]`).tap();
          ok(await page.locator('#progress-chart').isVisible(), `${metric}: ${period} graph renders`);
        }
        await point(page);
        ok(await page.locator('#progress-detail').isVisible(), `${metric}: selected graph point has a detail`);
        await act(page, 'progress-back').tap();
      }
      equal(await page.locator('#in-weight').inputValue(), '80,7', 'Exploring every graph leaves the unsaved weight draft intact');
      await graph(page, 'steps');
      await page.locator('[data-act="progress-period"][data-period="7"]').tap();
      const touchPosition = await page.locator('#progress-chart').evaluate(svg => {
        const box = svg.getBoundingClientRect(), viewWidth = svg.viewBox.baseVal.width;
        const left = Number(svg.dataset.plotLeft), right = Number(svg.dataset.plotRight);
        // The last daily bar is today's real zero, still selectable by touch.
        return { x: (right - (right - left) / 14) * box.width / viewWidth, y: box.height / 2 };
      });
      await page.locator('#progress-chart').tap({ position: touchPosition });
      ok((await page.locator('#progress-detail').innerText()).includes('16 октября'), 'A touch on the SVG selects the corresponding real-zero date');
      await point(page, '2026-10-13');
      await act(page, 'progress-edit').tap();
      equal(await page.locator('#in-steps').inputValue(), '9200', 'Edit point opens the exact selected date');
      await choose(page, TODAY);
      equal(await page.locator('#in-weight').inputValue(), '80,7', 'Editing a historical point does not discard another date draft');
      await page.locator('[data-act="exercise-history"][data-ex="sample"]').first().tap();
      equal(await page.locator('#ex-select').inputValue(), 'sample', 'Exercise result opens its own history');
      ok(await page.locator('#view svg').count() > 0, 'Recorded exercise history renders its graph');
      await page.locator('[data-act="progress-period"][data-period="7"]').tap();
      equal(await act(page, 'progress-point').evaluateAll(nodes => nodes.map(node => node.dataset.date).sort()), ['2026-10-12', '2026-10-15'], 'Weight history omits a missing weight instead of turning it into zero');
      await page.locator('[data-act="strength-mode"][data-mode="reps"]').tap();
      equal(await act(page, 'progress-point').evaluateAll(nodes => nodes.map(node => node.dataset.date).sort()), ['2026-10-12', '2026-10-14', '2026-10-15'], 'Rep history retains the valid rep-only observation');
      await unchanged(page, seed, 'Metric and exercise history browsing');
      await context.close();
    }

    // A focused draft remains tied to its original date across midnight.
    {
      const { page, seed, context } = await open();
      await input(page, '#in-weight', '80,6');
      await page.clock.fastForward(12 * 60 * 60 * 1000 + 60000);
      await input(page, '#in-steps', '1001');
      await unchanged(page, seed, 'Midnight retains the unsaved original-date draft');
      await save(page);
      const saved = await stored(page);
      equal(saved.files[BODY].data.weights[TODAY], 80.6, 'Midnight Save writes the date originally shown by the form');
      equal(saved.files[BODY].data.steps[TODAY], 1001, 'Post-midnight input stays on the original form date');
      equal(saved.files[BODY].data.weights['2026-10-17'], undefined, 'Midnight never copies yesterday weight into a new date');
      equal(saved.files[BODY].data.steps['2026-10-17'], undefined, 'Midnight never copies yesterday steps into a new date');
      await context.close();
    }

    // A completed remote pull can refresh the data model while soft rendering
    // protects a focused field. Saving that stale form must not overwrite it.
    {
      const seed = fixture();
      seed.cfg.token = 'synthetic-test-token-not-a-real-credential';
      seed.pending = {};
      const remoteBody = clone(seed.files[BODY].data);
      remoteBody.sleep[TODAY] = 8.25;
      const blobSeen = deferred(), releaseBlob = deferred();
      let mockWrites = 0;
      const apiHeaders = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,PUT,OPTIONS', 'access-control-allow-headers': '*' };
      const apiMock = async route => {
        const request = route.request(), url = new URL(request.url());
        if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, body: '', headers: apiHeaders });
        if (request.method() === 'GET' && url.pathname.includes('/git/trees/')) {
          return route.fulfill({ headers: apiHeaders, json: { tree: Object.entries(seed.files).map(([p, f]) => ({ path: p, type: 'blob', sha: p === BODY ? 'body-remote-changed' : f.sha })) } });
        }
        if (request.method() === 'GET' && url.pathname.endsWith('/git/blobs/body-remote-changed')) {
          blobSeen.resolve();
          await releaseBlob.promise;
          return route.fulfill({ headers: apiHeaders, json: { encoding: 'base64', content: Buffer.from(JSON.stringify(remoteBody)).toString('base64') } });
        }
        if (request.method() !== 'GET') mockWrites++;
        return route.fulfill({ status: 500, headers: apiHeaders, json: { message: 'Unexpected synthetic API request' } });
      };
      let context;
      try {
        const opened = await open({ seed, apiMock });
        context = opened.context;
        const page = opened.page;
        await Promise.race([blobSeen.promise, new Promise((_, reject) => setTimeout(() => reject(new Error('Synthetic delayed body pull did not start')), 10000))]);
        await page.locator('#in-sleep-minutes').tap();
        equal(await page.locator('#in-sleep-hours').inputValue(), '7', 'The initial rendered sleep hours are visible before the remote update');
        releaseBlob.resolve();
        await page.waitForFunction(({ key, body, date }) => JSON.parse(localStorage.getItem(key)).files[body].data.sleep[date] === 8.25, { key: STORE_KEY, body: BODY, date: TODAY });
        equal(await page.locator('#in-sleep-hours').inputValue(), '7', 'A focused field keeps its displayed companion while pull completes');
        await input(page, '#in-sleep-minutes', '30');
        const draftStore = await stored(page);
        equal(draftStore.dailyDrafts[TODAY].fields.sleepHours, '7', 'Sleep draft captures the visible hours, not a newer unseen value');
        equal(draftStore.dailyDrafts[TODAY].fields.sleepMinutes, '30', 'Sleep draft captures the edited visible minutes');
        await save(page);
        const after = await stored(page);
        equal(after.files, draftStore.files, 'Stale sleep form save never overwrites the pulled records');
        equal(after.pending, {}, 'Stale form save never queues a write');
        equal(after.files[BODY].data.sleep[TODAY], 8.25, 'Remote sleep remains authoritative after rejected stale save');
        ok((await page.locator('#daily-status').innerText()).includes('изменилось'), 'Stale form rejection explains the changed saved value');
        equal(mockWrites, 0, 'The delayed-pull regression sends no mock writes');
      } finally {
        releaseBlob.resolve();
        if (context) await context.close();
      }
    }

    // Browser emulation checks touch, narrow/landscape geometry, and an installed
    // offline shell. They do not prove physical iPhone keyboard/viewport behavior.
    {
      const { page, seed, context } = await open({ serviceWorkers: 'allow' });
      await page.evaluate(async () => {
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
      });
      for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
        await page.setViewportSize(viewport);
        await layout(page, `Overview ${viewport.width}x${viewport.height}`);
        await page.locator('#in-weight').tap();
        equal(await page.evaluate(() => document.activeElement.id), 'in-weight', 'Touch focuses the daily field');
        await graph(page, 'steps');
        await layout(page, `Steps graph ${viewport.width}x${viewport.height}`);
        await point(page);
        await layout(page, `Point details ${viewport.width}x${viewport.height}`);
        await act(page, 'progress-back').tap();
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await context.setOffline(true);
      await input(page, '#in-weight', '80,9');
      await page.reload();
      await page.locator('#daily-save').waitFor();
      equal(await page.locator('#in-weight').inputValue(), '80,9', 'Offline installed shell restores the local draft');
      await unchanged(page, seed, 'Offline draft reload');
      await save(page);
      equal((await stored(page)).files[BODY].data.weights[TODAY], 80.9, 'Offline explicit Save updates local body data');
      await page.reload();
      await page.locator('#daily-save').waitFor();
      equal(await page.locator('#in-weight').inputValue(), '80,9', 'Offline saved value survives another reload');
      await graph(page, 'weights');
      await layout(page, 'Offline graph');
      if (process.env.TEST_ARTIFACT_DIR) {
        fs.mkdirSync(process.env.TEST_ARTIFACT_DIR, { recursive: true });
        await page.screenshot({ path: path.join(process.env.TEST_ARTIFACT_DIR, 'daily-progress-offline.png'), fullPage: true });
        await act(page, 'progress-back').tap();
        await page.screenshot({ path: path.join(process.env.TEST_ARTIFACT_DIR, 'daily-entry.png'), fullPage: true });
      }
      await context.close();
    }
    equal(apiRequests, 0, 'Synthetic tests never contact GitHub');
    equal(errors, [], 'No JavaScript page errors');
    console.log(`PASS: ${checks} daily/progress checks: explicit atomic save, durable drafts, missing/zero values, unknown-field preservation, manual/import separation, graph dates/periods/details, responsive touch and offline reload.`);
    console.log('NOT_RUN: physical Safari/iPhone keyboard, safe-area and double-tap behavior.');
  } finally {
    for (const context of contexts) await context.close().catch(() => {});
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; server.close(); });
