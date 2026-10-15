// Run with Node.js and Playwright available in NODE_PATH. Uses isolated, synthetic data.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const artifacts = process.env.TEST_ARTIFACT_DIR;
const key = 'sport-journal.v1';
const exercise = { id: 'sample', name: 'Тестовое упражнение', sets: 3, reps: '8-12', rest: '60 с' };
const program = {
  title: 'Тестовая программа', start: '2026-10-05', weeks: 8,
  phases: [
    { from: 1, to: 2, key: 'intro', name: 'Вход', hint: '' },
    { from: 3, to: 7, key: 'main', name: 'Основная', hint: '' },
    { from: 8, to: 8, key: 'deload', name: 'Разгрузка', hint: '' }
  ],
  schedule: { 1: 'A', 2: 'A', 3: 'run', 4: 'A', 5: 'A', 6: 'A', 7: 'rest' },
  sessions: { A: { title: 'Верх A', items: [exercise] }, L: { title: 'Ноги', items: [] }, B: { title: 'Верх B', items: [] } },
  nutrition: {
    targets: { kcal: 2000, protein: 100, fat: '60 г', carbs: '250 г', water: '2 л' },
    meals: [{ id: 'breakfast', title: 'Завтрак', options: [{ id: 'plan', text: 'Тестовый завтрак', kcal: 400, p: 20 }] }],
    sweets: { plan: 150, over: 450 }, supplements: []
  }
};
const seed = { cfg: { token: '' }, files: { 'program.json': { sha: 'test', data: program } }, pending: {}, lastSync: 0 };
let checks = 0;
function equal(actual, expected, message) { assert.deepEqual(actual, expected, message); checks++; }
function ok(value, message) { assert.ok(value, message); checks++; }

const server = http.createServer((req, res) => {
  const filename = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  if (filename !== root && !filename.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  const file = filename === root ? path.join(root, 'index.html') : filename;
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
  fs.readFile(file, (error, body) => {
    if (error) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(body);
  });
});

async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  const errors = [];
  let apiRequests = 0;
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: 'Europe/Moscow', serviceWorkers: 'block' });
    await context.route('**/*', route => {
      if (route.request().url().startsWith(url)) return route.continue();
      if (route.request().url().startsWith('https://api.github.com')) apiRequests++;
      return route.abort();
    });
    await context.addInitScript(({ key, seed }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(seed));
    }, { key, seed });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.install({ time: new Date('2026-10-15T12:00:00+03:00') });
    await page.goto(url);
    ok((await page.locator('#view').innerText()).includes('Твои результаты'), 'Overview opens first');
    async function tab(name) {
      if (['overview', 'today', 'food'].includes(name)) await page.locator(`#tabs [data-tab="${name}"]`).tap();
      else { await page.locator('#tabs [data-tab="overview"]').tap(); await page.locator(`.overview-more [data-tab="${name}"]`).tap(); }
    }
    await tab('today');
    const act = action => page.locator(`[data-act="${action}"]`);
    const toggle = act('calendar-toggle');
    const selected = () => toggle.getAttribute('aria-label');
    const store = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
    const focusDate = () => page.evaluate(() => document.activeElement.dataset.date);
    async function open() {
      if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.tap();
    }
    async function choose(d) {
      await open();
      const current = await page.locator('.calendar-day').first().getAttribute('data-date');
      const a = current.split('-').map(Number), b = d.split('-').map(Number);
      const months = (b[0] - a[0]) * 12 + b[1] - a[1];
      for (let i = 0; i < Math.abs(months); i++) await act(months < 0 ? 'calendar-prev' : 'calendar-next').tap();
      await page.locator(`[data-date="${d}"]`).tap();
      equal(await toggle.getAttribute('aria-expanded'), 'false', 'Selecting a date closes the calendar');
    }
    async function layout(label) {
      const result = await page.evaluate(() => ({
        width: document.documentElement.clientWidth, document: document.documentElement.scrollWidth,
        view: document.getElementById('view').getBoundingClientRect().right,
        scale: visualViewport.scale,
        smallInputs: [...document.querySelectorAll('input,textarea,select')].filter(el => el.getClientRects().length && parseFloat(getComputedStyle(el).fontSize) < 16).map(el => el.id),
        touch: getComputedStyle(document.documentElement).touchAction,
        narrowDays: [...document.querySelectorAll('.calendar-day')].filter(el => el.getBoundingClientRect().height < 44).length
      }));
      ok(result.document <= result.width + 1 && result.view <= result.width + 1, `${label}: no page overflow: ${JSON.stringify(result)}`);
      equal(result.smallInputs, [], `${label}: input font sizes prevent focus zoom`);
      equal(result.scale, 1, `${label}: viewport scale`);
      equal(result.touch, 'manipulation', `${label}: touch policy`);
      equal(result.narrowDays, 0, `${label}: calendar button height`);
    }

    await open();
    equal(await page.locator('.calendar-day').count(), 31, 'October has 31 days');
    equal(await page.locator('.calendar-days > span').count(), 3, 'Weeks start on Monday');
    equal(await page.locator('[aria-current="date"]').getAttribute('data-date'), '2026-10-15', 'Today is marked');
    equal(await focusDate(), '2026-10-15', 'Opening focuses the selected day');
    await page.keyboard.press('Escape');
    equal(await toggle.getAttribute('aria-expanded'), 'false', 'Escape closes the calendar');
    equal(await page.evaluate(() => document.activeElement.dataset.act), 'calendar-toggle', 'Focus returns to the date');
    await act('next').tap();
    ok((await selected()).includes('16 октября 2026'), 'Next-day arrow');
    await act('prev').tap();
    ok((await selected()).includes('15 октября 2026'), 'Previous-day arrow');
    const beforeBrowse = await store();
    await open();
    await act('calendar-next').tap();
    await act('calendar-close').tap();
    ok((await selected()).includes('15 октября 2026'), 'Browsing a month does not select a day');
    equal((await store()).files, beforeBrowse.files, 'Browsing leaves records unchanged');
    equal((await store()).pending, beforeBrowse.pending, 'Browsing creates no pending writes');
    await open();
    await toggle.tap();
    equal(await toggle.getAttribute('aria-expanded'), 'false', 'Tapping date again closes the calendar');

    await choose('2026-10-31');
    await page.locator('#in-weight').fill('80,5');
    await page.locator('#in-note').fill('Запись за октябрь');
    await choose('2026-11-01');
    equal(await page.locator('#in-weight').inputValue(), '', 'New day has its own body record');
    equal(await page.locator('#in-note').inputValue(), '', 'New day has its own workout record');
    await page.locator('#in-weight').fill('80,1');
    await page.locator('#in-note').fill('Запись за ноябрь');
    await choose('2026-10-31');
    equal(await page.locator('#in-weight').inputValue(), '80,5', 'Body input survives date changes');
    equal(await page.locator('#in-note').inputValue(), 'Запись за октябрь', 'Workout input survives date changes');
    const saved = await store();
    equal(saved.files['body/2026-10.json'].data.weights['2026-10-31'], 80.5, 'October body file');
    equal(saved.files['body/2026-11.json'].data.weights['2026-11-01'], 80.1, 'November body file');
    equal(saved.files['workouts/2026-11-01.json'].data.note, 'Запись за ноябрь', 'November workout file');
    equal(saved.files['program.json'], seed.files['program.json'], 'Program remains unchanged');
    equal(Object.keys(saved.pending).sort(), ['body/2026-10.json', 'body/2026-11.json', 'workouts/2026-10-31.json', 'workouts/2026-11-01.json'], 'Only edited records are pending');

    await choose('2026-12-31');
    await act('next').tap();
    ok((await selected()).includes('1 января 2027'), 'Arrow crosses the year boundary');
    await act('prev').tap();
    ok((await selected()).includes('31 декабря 2026'), 'Arrow returns across the year boundary');
    await choose('2027-01-31');
    await open();
    await page.keyboard.press('PageDown');
    equal(await focusDate(), '2027-02-28', 'PageDown clamps to the final day of February');
    await page.keyboard.press('Enter');
    await open();
    equal(await page.locator('.calendar-day').count(), 28, 'Non-leap February has 28 days');
    await choose('2028-01-31');
    await open();
    await page.keyboard.press('PageDown');
    equal(await focusDate(), '2028-02-29', 'Leap year keeps February 29');
    equal(await page.locator('.calendar-day').count(), 29, 'Leap February has 29 days');
    await page.keyboard.press('ArrowRight');
    equal(await focusDate(), '2028-03-01', 'Keyboard crosses the month boundary');
    await page.keyboard.press('ArrowLeft');
    equal(await focusDate(), '2028-02-29', 'Keyboard returns to February 29');
    await page.keyboard.press('ArrowUp');
    equal(await focusDate(), '2028-02-22', 'Keyboard previous week');
    await page.keyboard.press('ArrowDown');
    equal(await focusDate(), '2028-02-29', 'Keyboard next week');
    await page.keyboard.press('Home');
    equal(await focusDate(), '2028-02-28', 'Home starts the week on Monday');
    await page.keyboard.press('End');
    equal(await focusDate(), '2028-03-05', 'End selects Sunday');
    await act('calendar-today').tap();
    ok((await selected()).includes('15 октября 2026'), 'Today returns to current date');

    await tab('food');
    await choose('2026-10-09');
    await page.locator('[data-act="meal"][data-opt="other"]').tap();
    await page.locator('#fo-t-breakfast').fill('Тестовая запись еды');
    await choose('2026-10-10');
    equal(await page.locator('#fo-t-breakfast').count(), 0, 'Food selection changes the actual day');
    await choose('2026-10-09');
    equal(await page.locator('#fo-t-breakfast').inputValue(), 'Тестовая запись еды', 'Food entry survives date changes');
    await open();
    await tab('body');
    await tab('today');
    equal(await toggle.getAttribute('aria-expanded'), 'false', 'Switching tabs closes the calendar');
    ok((await selected()).includes('15 октября 2026'), 'Opening measurements from overview starts today, avoiding accidental edits to the previously browsed day');
    await open();
    await act('calendar-today').tap();

    const sizes = [[320, 568], [360, 800], [375, 667], [390, 844], [430, 932], [568, 320], [844, 390], [1280, 800]];
    for (const colorScheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme });
      for (const [width, height] of sizes) {
        await page.setViewportSize({ width, height });
        for (const name of ['overview', 'today', 'food', 'body', 'history', 'program']) {
          await tab(name);
          await layout(`${colorScheme} ${width}x${height} ${name}`);
          if (name === 'today' || name === 'food') {
            await open();
            await layout(`${colorScheme} ${width}x${height} ${name} calendar`);
            await act('calendar-close').tap();
          }
        }
        await page.locator('#gear').tap();
        await layout(`${colorScheme} ${width}x${height} settings`);
        await page.locator('#gear').tap();
        await tab('today');
        await page.locator('#in-weight').focus();
        equal(await page.evaluate(() => visualViewport.scale), 1, 'Input focus keeps scale');
        await page.locator('#in-weight').blur();
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: 'light' });
    for (const selector of ['.cycle-title', '.panel', '#in-weight']) {
      const target = page.locator(selector).first();
      await target.evaluate(el => el.scrollIntoView({ block: 'center' }));
      const box = await target.boundingBox();
      ok(await target.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), `Double tap target is visible: ${selector}`);
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      equal(await page.evaluate(() => visualViewport.scale), 1, `Double tap keeps scale: ${selector}`);
    }
    await page.locator('#in-weight').blur();
    if (artifacts) {
      fs.mkdirSync(artifacts, { recursive: true });
      await open();
      await page.locator('.calendar').screenshot({ path: path.join(artifacts, 'calendar-detail.png') });
      await page.screenshot({ path: path.join(artifacts, 'calendar-light.png'), fullPage: true });
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.screenshot({ path: path.join(artifacts, 'calendar-dark.png'), fullPage: true });
      await page.setViewportSize({ width: 320, height: 568 });
      await page.screenshot({ path: path.join(artifacts, 'calendar-320.png'), fullPage: true });
    }
    await context.close();

    // A separate browser profile exercises the actual service worker and offline shell.
    const offlineContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await offlineContext.route(/^https:\/\//, route => route.abort());
    await offlineContext.addInitScript(({ key, seed }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(seed));
    }, { key, seed });
    const offlinePage = await offlineContext.newPage();
    offlinePage.on('pageerror', error => errors.push(error.message));
    await offlinePage.goto(url);
    await offlinePage.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    });
    ok((await offlinePage.evaluate(() => caches.keys())).includes('sport-journal-v7'), 'Updated offline cache is installed');
    await offlineContext.setOffline(true);
    await offlinePage.reload({ waitUntil: 'domcontentloaded' });
    await offlinePage.locator('#tabs [data-tab="today"]').tap();
    await offlinePage.locator('[data-act="calendar-toggle"]').tap();
    ok(await offlinePage.locator('.calendar-day').count() >= 28, 'Calendar works after an offline reload');
    await offlinePage.locator('.calendar-day').first().tap();
    equal(await offlinePage.locator('[data-act="calendar-toggle"]').getAttribute('aria-expanded'), 'false', 'Offline date selection works');
    await offlineContext.close();
    equal(apiRequests, 0, 'No calls to private GitHub data');
    equal(errors, [], 'No JavaScript runtime errors');
    console.log(`PASS: ${checks} checks; date selection, record isolation, leap years, keyboard, 8 viewports, both themes, touch and offline shell.`);
    console.log('NOT_RUN: physical iPhone Safari/PWA gestures and native keyboard. Chromium emulation does not prove iOS behavior.');
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
