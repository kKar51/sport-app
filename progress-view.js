/* Calendar-based charts. The view only renders; journal data stays with the caller. */
(function (root) {
  'use strict';

  const DAY = 86400000;
  const LABELS = {weights: 'Вес', waist: 'Талия', lower: 'Низ живота', steps: 'Шаги', sleep: 'Сон'};
  const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const coord = value => Number(value.toFixed(2));

  function day(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return null;
    const value = Date.parse(date + 'T00:00:00Z');
    return Number.isFinite(value) && new Date(value).toISOString().slice(0, 10) === date ? value : null;
  }

  function dateLabel(value) {
    const d = new Date(value);
    return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()];
  }

  function nextStep(value, integer) {
    if (!Number.isFinite(value) || value <= 0) return 1;
    const power = Math.pow(10, Math.floor(Math.log10(value)));
    const ratio = value / power;
    const n = [1, 2, 2.5, 5, 10].find(item => item >= ratio - 1e-9) || 10;
    return integer ? Math.max(1, n * power) : n * power;
  }

  function scaleBounds(values, bars, integer) {
    let low = bars ? 0 : Math.min(...values);
    let high = Math.max(...values);
    if (bars) high = Math.max(high, 1);
    else {
      const pad = Math.max((high - low) * 0.12, 1);
      low = Math.max(0, low - pad);
      high += pad;
    }
    let step = nextStep((high - low) / 3, integer);
    let start = bars ? 0 : Math.floor(low / step) * step;
    let end = Math.ceil(high / step) * step;
    // Rounding the bounds can add a tick. Grow the interval until four remain.
    while (Math.round((end - start) / step) > 3) {
      step = nextStep(step * 1.01, integer);
      start = bars ? 0 : Math.floor(low / step) * step;
      end = Math.ceil(high / step) * step;
    }
    if (end <= start) end = start + step;
    const ticks = [];
    for (let i = 0; i <= Math.round((end - start) / step); i++) ticks.push(start + step * i);
    let decimals = 0;
    while (decimals < 3 && Math.abs(step * Math.pow(10, decimals) - Math.round(step * Math.pow(10, decimals))) > 1e-8) decimals++;
    const formatter = new Intl.NumberFormat('ru-RU', {maximumFractionDigits: decimals});
    return {low: start, high: end, ticks, format: value => formatter.format(Math.abs(value) < 1e-10 ? 0 : value)};
  }

  function lineSegments(points, key, x, y, cls) {
    const segments = [];
    let current = [], previous = null;
    const flush = () => { if (current.length > 1) segments.push('<path class="' + cls + '" d="' + current.join(' ') + '"/>'); current = []; };
    for (const point of points) {
      if (!finite(point[key])) { flush(); previous = null; continue; }
      if (previous !== null && point.time - previous !== DAY) flush();
      current.push((current.length ? 'L' : 'M') + coord(x(point.time)) + ' ' + coord(y(point[key])));
      previous = point.time;
    }
    flush();
    return segments.join('');
  }

  function chart(input, options) {
    const model = input && typeof input === 'object' ? input : {};
    const settings = options || {};
    const width = finite(settings.width) ? Math.max(240, settings.width) : 320;
    const height = 250, left = 52, right = width - 12, top = 24, bottom = 210;
    const kind = Object.hasOwn(LABELS, model.kind) ? model.kind : 'weights';
    const title = typeof settings.title === 'string' && settings.title ? settings.title : LABELS[kind];
    const bars = kind === 'steps' || kind === 'sleep';
    const source = Array.isArray(model.points) ? model.points : [];
    const byDay = new Map();
    for (const point of source) {
      if (!point || typeof point !== 'object') continue;
      const time = day(point.date);
      if (time !== null) byDay.set(time, {date: point.date, time, value: finite(point.value) && point.value >= 0 ? point.value : null,
        average: finite(point.average) && point.average >= 0 ? point.average : null, partial: point.partial === true});
    }
    let points = Array.from(byDay.values()).sort((a, b) => a.time - b.time);
    let from = day(model.from), to = day(model.to);
    if (from === null) from = points.length ? points[0].time : 0;
    if (to === null) to = points.length ? points[points.length - 1].time : from;
    if (to < from) [from, to] = [to, from];
    points = points.filter(point => point.time >= from && point.time <= to);
    const known = points.filter(point => point.value !== null);
    const opening = '<svg id="progress-chart" class="progress-chart" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="' + escape(title + ': график по датам') + '" viewBox="0 0 ' + width + ' ' + height + '" width="' + width + '" height="' + height + '" data-plot-left="' + left + '" data-plot-right="' + right + '"';
    if (!known.length) return opening + ' data-empty="true"><title>' + escape(title) + '</title><text class="progress-empty" x="' + width / 2 + '" y="108" text-anchor="middle">Пока нет записей</text><text class="progress-empty-sub" x="' + width / 2 + '" y="133" text-anchor="middle">Добавь значение для графика</text></svg>';

    const values = known.map(point => point.value);
    if (kind === 'weights') for (const point of points) if (point.average !== null) values.push(point.average);
    let goal = null;
    if (kind === 'steps' && finite(settings.goal) && settings.goal > 0) { goal = settings.goal; values.push(goal); }
    if (kind === 'sleep' && Array.isArray(settings.goal) && settings.goal.length === 2 && settings.goal.every(finite) && settings.goal[0] >= 0 && settings.goal[1] > settings.goal[0]) {
      goal = settings.goal; values.push(...goal);
    }
    const bounds = scaleBounds(values, bars, kind === 'steps');
    const days = Math.round((to - from) / DAY) + 1;
    const span = Math.max(DAY, to - from);
    // Bar centers are inset by half a calendar cell so first/last bars stay visible.
    const cell = (right - left) / Math.max(1, days);
    const x = bars ? time => left + cell / 2 + ((time - from) / DAY) * cell :
      time => from === to ? (left + right) / 2 : left + ((time - from) / span) * (right - left);
    const y = value => bottom - ((value - bounds.low) / (bounds.high - bounds.low)) * (bottom - top);
    const parts = [opening + '><title>' + escape(title) + '</title><desc>' + escape('Записей: ' + known.length + '. Пропущенные даты не считаются нулём.') + '</desc>'];

    if (Array.isArray(goal)) parts.push('<rect class="progress-goal progress-goal-band" x="' + left + '" y="' + coord(y(goal[1])) + '" width="' + coord(right - left) + '" height="' + coord(y(goal[0]) - y(goal[1])) + '"/>');
    for (const tick of bounds.ticks) {
      const tickY = coord(y(tick));
      parts.push('<line class="progress-grid" x1="' + left + '" x2="' + right + '" y1="' + tickY + '" y2="' + tickY + '"/><text class="progress-y-label" x="' + (left - 8) + '" y="' + (tickY + 4) + '" text-anchor="end">' + escape(bounds.format(tick)) + '</text>');
    }
    if (finite(goal)) parts.push('<line class="progress-goal progress-goal-line" x1="' + left + '" x2="' + right + '" y1="' + coord(y(goal)) + '" y2="' + coord(y(goal)) + '"/>');

    const axisSpan = right - left - (bars ? cell : 0);
    const count = Math.min(4, days, Math.max(2, Math.floor(axisSpan / 60) + 1)), tickDays = [];
    for (let i = 0; i < count; i++) tickDays.push(from + (count === 1 ? 0 : Math.round((days - 1) * i / (count - 1))) * DAY);
    for (let i = 0; i < tickDays.length; i++) {
      const time = tickDays[i], anchor = tickDays.length === 1 ? 'middle' : i === 0 ? 'start' : i === tickDays.length - 1 ? 'end' : 'middle';
      parts.push('<text class="progress-x-label" x="' + coord(x(time)) + '" y="237" text-anchor="' + anchor + '">' + escape(dateLabel(time)) + '</text>');
    }

    const selected = day(settings.selectedDate);
    if (selected !== null && selected >= from && selected <= to) parts.push('<line class="progress-selected-guide" x1="' + coord(x(selected)) + '" x2="' + coord(x(selected)) + '" y1="' + top + '" y2="' + bottom + '"/>');
    if (bars) {
      const barWidth = Math.max(0.8, Math.min(20, cell * 0.7));
      for (const point of known) {
        const classes = 'progress-observed progress-bar' + (point.partial && kind === 'steps' ? ' progress-partial' : '') + (point.time === selected ? ' progress-selected' : '');
        if (point.value === 0) parts.push('<circle class="' + classes + '" cx="' + coord(x(point.time)) + '" cy="' + bottom + '" r="3"/>');
        else parts.push('<rect class="' + classes + '" x="' + coord(x(point.time) - barWidth / 2) + '" y="' + coord(y(point.value)) + '" width="' + coord(barWidth) + '" height="' + coord(bottom - y(point.value)) + '" rx="2"/>');
      }
    } else {
      if (kind === 'weights') parts.push(lineSegments(points, 'value', x, y, 'progress-observed progress-raw-line'));
      if (kind === 'weights') parts.push(lineSegments(points, 'average', x, y, 'progress-average'));
      for (const point of known) parts.push('<circle class="progress-observed progress-point' + (point.time === selected ? ' progress-selected' : '') + '" cx="' + coord(x(point.time)) + '" cy="' + coord(y(point.value)) + '" r="' + (point.time === selected ? 5.5 : 3.5) + '"/>');
      // A lone average is still visible, without drawing across gaps.
      if (kind === 'weights') for (const point of points) if (point.average !== null) parts.push('<circle class="progress-average-point" cx="' + coord(x(point.time)) + '" cy="' + coord(y(point.average)) + '" r="2"/>');
    }
    parts.push('</svg>');
    return parts.join('');
  }

  root.SportProgressView = Object.freeze({chart});
})(typeof globalThis === 'object' ? globalThis : window);
