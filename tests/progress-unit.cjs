'use strict';
// Pure calendar/statistics tests: no browser, local storage, network, or real data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const P = require('../progress.js');
let checks = 0;
function equal(actual, expected, label) { assert.deepEqual(actual, expected, label); checks++; }
function ok(value, label) { assert.ok(value, label); checks++; }
function near(actual, expected, label) { assert.ok(typeof actual === 'number' && Math.abs(actual - expected) < 1e-9, `${label}: ${actual} != ${expected}`); checks++; }
const TODAY = '2026-10-15';
const options = extra => ({ today: TODAY, period: 7, ...extra });
const point = (result, date) => result.points.find(p => p.date === date);

// Real calendar boundaries, including leap-year and century rules.
equal(P.validDate('2028-02-29'), true, 'Leap day is accepted');
equal(P.validDate('2026-02-29'), false, 'Non-leap February is rejected');
equal(P.validDate('1900-02-29'), false, 'A non-400 century is not a leap year');
equal(P.validDate('2000-02-29'), true, 'A 400-year century is a leap year');
for (const date of ['2026-04-31', '2026-13-01', '2026-00-10', '2026-10-00', '2026-1-01', '2026-10-15T00:00:00Z', '0000-01-01', '__proto__', null]) {
  equal(P.validDate(date), false, `Malformed calendar value is rejected: ${date}`);
}
equal(P.addDays('2028-02-28', 1), '2028-02-29', 'Day arithmetic enters leap day');
equal(P.addDays('2028-02-29', 1), '2028-03-01', 'Day arithmetic leaves leap day');
equal(P.addDays('2026-12-31', 1), '2027-01-01', 'Day arithmetic crosses years');
equal(P.addDays('2026-03-29', 1), '2026-03-30', 'Day arithmetic is not affected by daylight-saving transitions');
equal(P.addDays('0001-01-01', -1), null, 'Calendar arithmetic respects the lower supported year');
equal(P.addDays('9999-12-31', 1), null, 'Calendar arithmetic respects the upper supported year');

// Gaps, an actual zero, duplicates, and invalid/future data stay distinguishable.
{
  const result = P.build('steps', [
    ['2028-02-26', 0, 'Apple Health'], ['2028-02-29', 12, 'manual'], ['2028-02-29', 25, 'Apple Health'],
    ['2028-02-29', NaN], ['2028-02-30', 500], ['2028-03-04', 900], ['2028-03-01', Infinity],
    ['2028-03-02', '100'], ['2028-03-03', -1], null
  ], { today: '2028-03-03', period: 7 });
  equal(result.from, '2028-02-26', 'Seven displayed days cross February correctly');
  equal(result.totalDays, 7, 'Every calendar date is represented once');
  equal(result.count, 2, 'Only real, valid observations count');
  equal(point(result, '2028-02-26').value, 0, 'An actual zero is retained');
  equal(point(result, '2028-02-27').value, null, 'An unmeasured day is missing, not zero');
  equal(point(result, '2028-02-27').source, null, 'A missing day has no invented source');
  equal(point(result, '2028-02-29').value, 25, 'The last valid duplicate wins');
  equal(point(result, '2028-02-29').source, 'Apple Health', 'The chosen value retains its source');
  equal(point(result, '2028-03-03').partial, true, 'Today is partial for steps even without a reading');
}

// Today's steps must not inflate the completed-week comparison or target count.
{
  const series = [];
  for (let d = 1; d <= 7; d++) series.push([`2026-10-0${d}`, 1000]);
  for (let d = 8; d <= 14; d++) series.push([`2026-10-${String(d).padStart(2, '0')}`, d === 10 ? 0 : 2000]);
  series.push([TODAY, 99999, 'Apple Health']);
  const result = P.build('steps', series, options({ stepsTarget: 1500 }));
  equal(result.summaryFrom, '2026-10-08', 'Steps summary starts seven completed days ago');
  equal(result.summaryTo, '2026-10-14', 'Steps summary ends yesterday');
  equal(result.summaryCount, 7, 'A true zero still counts as a completed observed day');
  near(result.mean, 12000 / 7, 'Current partial steps do not enter the weekly mean');
  equal(result.previousCount, 7, 'Previous completed week has its own observations');
  equal(result.previousMean, 1000, 'Previous week is calculated independently of chart width');
  near(result.delta, 12000 / 7 - 1000, 'Enough complete observations permit a comparison');
  equal(result.summaryGoalDays, 6, 'Summary goal count excludes only the known below-target day');
  equal(result.goalDays, 5, 'Chart goal count excludes the large partial-today observation');
  equal(point(result, TODAY).value, 99999, 'Today remains visible on the chart');
  equal(point(result, TODAY).partial, true, 'Visible today is clearly partial');
}

// Sparse weeks retain useful observed means but never claim a strong comparison.
{
  const series = [['2026-10-08', 5000], ['2026-10-09', 5000], ['2026-10-11', 5000], ['2026-10-14', 5000], ['2026-10-01', 2000]];
  const result = P.build('steps', series, options({ stepsTarget: 4000 }));
  equal(result.summaryCount, 4, 'Sparse summaries report the actual denominator');
  equal(result.mean, 5000, 'Missing dates do not dilute steps with invented zeros');
  equal(result.delta, null, 'A sparse week cannot produce a week-to-week delta');
  equal(result.summaryGoalDays, 4, 'Only measured target days count');
  const noTarget = P.build('steps', series, options());
  equal(noTarget.goalDays, null, 'An unspecified target is distinct from zero target days');
  equal(noTarget.summaryGoalDays, null, 'An unspecified summary target is distinct from failure');
}

// Weight smoothing and comparison require enough independent calendar readings.
{
  const series = [
    ['2026-10-02', 90], ['2026-10-04', 90], ['2026-10-06', 90], ['2026-10-08', 90],
    ['2026-10-10', 80], ['2026-10-12', 82], ['2026-10-14', 84], [TODAY, 86]
  ];
  const result = P.build('weights', series, options());
  equal(result.summaryCount, 4, 'Weight summary reports four observations');
  equal(result.mean, 83, 'Four observations enable a seven-day weight mean');
  equal(result.previousMean, 90, 'Earlier week includes values outside the chart');
  equal(result.delta, -7, 'Weight delta remains a neutral signed value');
  equal(point(result, '2026-10-11').value, null, 'Smoothing does not fabricate a raw measurement');
  equal(point(result, '2026-10-11').average, null, 'Fewer than four observations suppress a rolling average');
  equal(point(result, '2026-10-12').average, 85.5, 'Rolling smoothing respects its own seven-day window');
  equal(point(result, TODAY).average, 83, 'Today rolling average matches the latest complete window');
  const sparse = P.build('weights', series.filter(([date]) => date !== '2026-10-12'), options());
  equal(sparse.summaryCount, 3, 'Sparse weight readings remain counted');
  equal(sparse.mean, null, 'Three weight readings are insufficient for the summary mean');
  equal(sparse.delta, null, 'An insufficient current mean cannot produce a delta');
  equal(sparse.goalDays, null, 'Weight has no invented success target');
}

// Sleep includes the night ending today, preserves a known zero, and uses inclusive goals.
{
  const series = [];
  for (let d = 2; d <= 8; d++) series.push([`2026-10-0${d}`, 6]);
  series.push(['2026-10-09', 7], ['2026-10-10', 8], ['2026-10-12', 7.5], ['2026-10-14', 0], [TODAY, 9, 'Apple Health']);
  const result = P.build('sleep', series, options({ sleepTarget: [7, 8] }));
  equal(result.summaryTo, TODAY, 'Sleep summary includes the night ending today');
  equal(result.summaryCount, 5, 'Known zero sleep is an observation');
  near(result.mean, 6.3, 'Sleep mean excludes missing nights but includes a real zero');
  near(result.delta, 0.3, 'Five observations permit a sleep comparison');
  equal(result.summaryGoalDays, 3, 'Both target boundaries are included');
  equal(result.goalDays, 3, 'Today sleep is complete for target calculations');
  equal(point(result, TODAY).partial, false, 'Sleep ending today is not marked as partial steps');
  equal(P.build('sleep', series, options({ sleepTarget: [8, 7] })).goalDays, null, 'A reversed target is rejected');
  equal(P.build('sleep', series, options({ sleepTarget: [7, Infinity] })).goalDays, null, 'Nonfinite target bounds are rejected');
}

// Tape measurements use comparable dates rather than a convenient nearby entry.
for (const kind of ['waist', 'lower']) {
  const result = P.build(kind, [
    ['2026-09-01', 100], ['2026-09-16', 95], ['2026-09-18', 93], ['2026-09-24', 92], [TODAY, 90]
  ], options({ period: 30, cycleStart: '2026-09-15' }));
  equal(result.changeFrom, '2026-09-16', `${kind}: equal-distance four-week candidates choose a consistent date`);
  equal(result.change, -5, `${kind}: comparison uses the selected four-week baseline`);
  equal(result.sinceStart, -5, `${kind}: cycle change excludes measurements before the cycle`);
  equal(result.mean, null, `${kind}: no invented weekly tape-measurement average`);
  const sparse = P.build(kind, [['2026-10-01', 92], [TODAY, 90]], options({ cycleStart: '2026-10-01' }));
  equal(sparse.change, null, `${kind}: a two-week gap cannot be labelled a four-week change`);
  equal(sparse.changeFrom, null, `${kind}: missing comparison has no invented date`);
  equal(sparse.sinceStart, -2, `${kind}: a labelled cycle comparison remains available`);
}
{
  const stale = P.build('waist', [['2026-09-17', 93], [TODAY, 90]], { today: '2026-11-10', period: 7 });
  equal(stale.count, 0, 'An empty recent graph does not invent measurements');
  equal(stale.lastDate, TODAY, 'The actual last measurement date remains available for a stale-data label');
  equal(stale.changeFrom, '2026-09-17', 'Four-week comparison is relative to the last real measurement');
  equal(stale.change, -3, 'A comparison is not silently shifted to today');
}

// Cycle bounds cannot allocate an unbounded chart or expose future records.
{
  const result = P.build('weights', [['2020-01-01', 80], [TODAY, 81], ['2027-01-01', 82]], options({ period: 'cycle', cycleStart: '2020-01-01' }));
  equal(result.totalDays, 730, 'An old cycle is bounded to 730 displayed dates');
  equal(result.from, '2024-10-16', 'The bounded cycle keeps the latest 730 inclusive dates');
  equal(result.to, TODAY, 'The chart ends at today');
  equal(result.firstDate, '2020-01-01', 'Historical freshness metadata is independent of the display bound');
  equal(result.lastDate, TODAY, 'Future observations are ignored');
  equal(result.sinceStart, 1, 'Cycle baseline can precede the bounded display');
  equal(P.build('weights', [], options({ period: 'cycle', cycleStart: '2027-01-01' })).totalDays, 1, 'A future cycle still displays today without future points');
  equal(P.build('weights', [], options({ period: 'cycle', cycleStart: 'bad' })).totalDays, 30, 'An invalid cycle date falls back to a bounded calendar range');
  equal(P.build('weights', [], options({ period: 999999 })).totalDays, 30, 'An invalid period cannot request unlimited points');
}

// Empty results, invalid options, input immutability, and browser export contract.
{
  const empty = P.build('sleep', null, options({ sleepTarget: [7, 8] }));
  equal(empty.count, 0, 'Non-array input is treated as an empty series');
  equal(empty.summaryCount, 0, 'Empty summaries count no measured nights');
  equal(empty.mean, null, 'Empty summaries have no numerical mean');
  equal(empty.delta, null, 'Empty summaries have no numerical delta');
  equal(empty.firstDate, null, 'Empty series has no first observation');
  equal(empty.lastDate, null, 'Empty series has no last observation');
  ok(empty.points.every(p => p.value === null && p.average === null && p.source === null), 'Empty chart points contain no fabricated data');
  const frozen = Object.freeze([Object.freeze([TODAY, 0, ' Apple Health '])]);
  const frozenOptions = Object.freeze(options({ stepsTarget: 0 }));
  const result = P.build('steps', frozen, frozenOptions);
  equal(point(result, TODAY).source, 'Apple Health', 'Source metadata is trimmed without changing the input');
  equal(frozen[0][2], ' Apple Health ', 'Caller data is immutable');
  equal(P.build('weights', [[TODAY, 1e308], ['2026-10-14', 1e308], ['2026-10-13', 1e308], ['2026-10-12', 1e308]], options()).mean, 1e308, 'Finite observations do not overflow their average');
  assert.throws(() => P.build('other', [], options()), /Unsupported/); checks++;
  assert.throws(() => P.build('weights', [], { today: '2026-02-30' }), /YYYY-MM-DD/); checks++;
  const sandbox = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'progress.js'), 'utf8'), sandbox);
  equal(typeof sandbox.SportProgress.build, 'function', 'The same pure API is available as a browser global');
  equal(sandbox.SportProgress.build('steps', [], options()).totalDays, 7, 'Browser export requires no DOM or network');
}

console.log(`PASS: ${checks} progress checks; calendar boundaries, gaps, zero, partial days, sparse comparisons, goals, tape measurements, and immutable inputs.`);
