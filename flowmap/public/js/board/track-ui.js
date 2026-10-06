// How trackers look on a board: a habit you tick, and progress views (ring, bar, calendar, line, number)
// fed by a habit, a checklist, or a number you count yourself.
import { h, raw, fmtNum } from '../util.js';
import { habitState, progressOf, tableProgress, EVERY_LABEL, UNIT, fmtLeft } from './track.js';
import { statOf } from './biz.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs, ...kids) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v); kids.forEach((c) => c && el.append(c)); return el; };
const ed = (cls, text, field, placeholder) => h('div', { class: `ed ${cls}`, 'data-field': field, 'data-ph': placeholder || '' }, raw(text || ''));
const THIS = { hour: 'this hour', '2h': 'in these 2 hours', day: 'today', week: 'this week' };
const LAST = { hour: 'the last hour', '2h': 'the last 2 hours', day: 'yesterday', week: 'last week' };
const plural = (n, w) => `${fmtNum(n)} ${w}${n === 1 ? '' : 's'}`;
const unitOf = (every) => (every === '2h' ? 'slot' : UNIT[every] || 'day');
const shortDate = (t, every) => { const d = new Date(t); return every === 'hour' || every === '2h' ? `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${String(d.getHours()).padStart(2, '0')}:00` : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); };
const CELL_TIP = { done: 'Done', part: 'Partly done', miss: 'Missed', now: 'Now: not ticked yet', todo: 'Still to come', off: 'Rest day' };

export function statusLine(st, d) {
  const u = unitOf(st.every);
  if (st.status === 'soon') return ['soon', `Starts ${d.start || 'soon'}`];
  if (st.status === 'finished') return ['fin', `🏁 Finished: ${st.done + st.part}/${st.total} ${u}s done`];
  if (st.status === 'ok') return ['ok', `✓ Done ${THIS[st.every]}`];
  if (st.status === 'late') return ['late', `⚠ Missed ${LAST[st.every]}`];
  if (st.status === 'restarted') return ['late', `↺ Missed ${LAST[st.every]}, so it started again`];
  return ['due', `Due ${THIS[st.every]} · ${fmtLeft(st.dueIn)} left`];
}

export function habitView(it, ctx) {
  const d = it.data || {};
  const st = habitState(d);
  const cur = st.periods.find((p) => p.k === st.curKey) || { s: 'now' };
  const on = cur.s === 'done', half = cur.s === 'part';
  const [cls, line] = statusLine(st, d);
  const u = unitOf(st.every);
  const len = Number(d.length) || 0;
  const n = st.done + st.part + (st.periods.some((p) => p.k === st.curKey && p.s === 'now') ? 1 : 0);
  const sub = len ? `${EVERY_LABEL[st.every]} · ${u} ${Math.min(len, Math.max(1, n))} of ${len}` : EVERY_LABEL[st.every];
  // the last periods as a strip of dots, newest on the right
  const strip = st.periods.filter((p) => p.s !== 'todo').slice(-14);
  return [
    h('div', { class: 'hb-top' }, ed('ttl', it.title, 'title', 'Habit or task'), h('small', null, raw(sub))),
    h('div', { class: 'hb-mid' },
      h('button', { type: 'button', class: `hb-tick${on ? ' on' : ''}${half ? ' half' : ''}`, 'data-act': 'tick', title: on ? 'Tap to untick' : `Tick it: done ${THIS[st.every]}`, 'aria-label': on ? 'Untick' : 'Tick' }, half ? '½' : '✓'),
      h('div', { class: 'hb-stats' },
        h('b', { class: 'hb-streak', title: `Best streak: ${plural(st.best, u)}` }, raw(`🔥 ${st.streak}`), h('small', null, ` ${u} streak`)),
        h('span', { class: `hb-st st-${cls}` }, raw(line)),
        cur.s === 'now' || half ? h('button', { type: 'button', class: 'hb-part', 'data-act': 'tick-part', title: 'Partly done' }, half ? 'Undo ½' : '½ Partly') : null)),
    h('div', { class: 'hb-strip' }, strip.map((p) => h('i', { class: `c-${p.s}`, title: `${shortDate(p.t, st.every)}: ${CELL_TIP[p.s]}` }))),
  ];
}

const pctText = (f) => `${Math.round(f * 100)}%`;
function ring(frac, big, small) {
  const r = 42, c = 2 * Math.PI * r;
  return h('div', { class: 'pg-ring' },
    svg('svg', { viewBox: '0 0 100 100' },
      svg('circle', { cx: 50, cy: 50, r, class: 'pg-track' }),
      svg('circle', { cx: 50, cy: 50, r, class: 'pg-fill', 'stroke-dasharray': `${(c * frac).toFixed(1)} ${c.toFixed(1)}`, transform: 'rotate(-90 50 50)' })),
    h('div', { class: 'pg-mid' }, h('b', null, raw(big)), small ? h('small', null, raw(small)) : null));
}
function lineChart(points, target) {
  // points: [[x 0..1, y value]], drawn against the target (or the highest value)
  const W = 300, H = 120, top = Math.max(1, target || 0, ...points.map((p) => p[1]));
  const pt = ([x, y]) => `${(x * W).toFixed(1)},${(H - (y / top) * H).toFixed(1)}`;
  const kids = [svg('line', { x1: 0, y1: H, x2: W, y2: H, class: 'pg-axis' })];
  if (target) kids.push(svg('line', { x1: 0, y1: H - (target / top) * H, x2: W, y2: H - (target / top) * H, class: 'pg-goal' }));
  if (points.length > 1) {
    kids.push(svg('path', { d: `M${pt([points[0][0], 0])} L${points.map(pt).join(' L')} L${pt([points[points.length - 1][0], 0])}Z`, class: 'pg-area' }));
    kids.push(svg('polyline', { points: points.map(pt).join(' '), class: 'pg-line' }));
  }
  if (points.length) { const [x, y] = pt(points[points.length - 1]).split(','); kids.push(svg('circle', { cx: x, cy: y, r: 4.5, class: 'pg-dot' })); }
  return svg('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', class: 'pg-line-svg' }, ...kids);
}

export const PROGRESS_VIEWS = [['ring', '◯ Ring'], ['bar', '▬ Bar'], ['calendar', '▦ Calendar'], ['line', '📈 Line'], ['number', '# Number']];

export function progressView(it, ctx) {
  const d = it.data || {};
  const src = ctx.source?.(it) || null;
  const p = src?.type === 'table' ? tableProgress(statOf(src.data, { col: d.col, period: d.period || 'month' }), d) : progressOf(src, d);
  const view = d.view || (p.kind === 'habit' ? 'calendar' : 'ring');
  const title = ed('ttl', it.title, 'title', src ? src.title || 'Progress' : 'Progress');
  const kids = [h('div', { class: 'pg-top' }, title, src ? h('small', { class: 'pg-src', title: 'Fed by a connected item' }, raw(`↳ ${src.title || ({ habit: 'Habit', checklist: 'Checklist', table: 'Table' })[src.type]}${p.kind === 'table' ? ` · ${{ month: 'this month', year: 'this year', '30d': 'last 30 days', all: 'all time' }[d.period || 'month']}` : ''}`)) : null)];
  const unit = p.kind === 'habit' ? unitOf(p.st.every) : p.kind === 'table' ? (src.data?.currency ?? 'TZS') : d.unit || '';
  const label = p.kind === 'habit' ? `${fmtNum(p.value)} / ${plural(p.target, unit)}` : p.kind === 'checklist' ? `${p.value} / ${p.target} done` : `${fmtNum(p.value)}${p.target ? ` / ${fmtNum(p.target)}` : ''}${unit ? ` ${unit}` : ''}`;
  if (view === 'ring') kids.push(ring(p.frac, pctText(p.frac), label));
  else if (view === 'bar') kids.push(h('div', { class: 'pg-bar' }, h('div', { class: 'pg-barl' }, h('b', null, raw(pctText(p.frac))), h('small', null, raw(label))), h('div', { class: 'pg-track-bar' }, h('i', { style: { width: `${p.frac * 100}%` } }))));
  else if (view === 'number') {
    const big = p.kind === 'habit' ? `🔥 ${p.st.streak}` : fmtNum(p.value);
    const small = p.kind === 'habit' ? `${unit} streak · best ${p.st.best}` : label;
    kids.push(h('div', { class: 'pg-num' }, h('b', null, raw(big)), h('small', null, raw(small))));
  } else if (view === 'line') {
    let pts = [];
    if (p.kind === 'habit') {
      // cumulative ticks over the challenge, against the pace you need
      const per = p.st.periods, n = Math.max(1, per.length - 1);
      let acc = 0;
      per.forEach((q, i) => { if (q.s === 'todo') return; acc += q.s === 'done' ? 1 : q.s === 'part' ? 0.5 : 0; pts.push([i / n, acc]); });
      kids.push(lineChart(pts, p.target), h('small', { class: 'pg-cap' }, raw(label)));
    } else {
      const hist = (p.history || []).slice(-60);
      const t0 = hist.length ? hist[0][0] : 0, t1 = hist.length ? hist[hist.length - 1][0] : 1;
      pts = hist.map(([t, v]) => [t1 > t0 ? (t - t0) / (t1 - t0) : 1, v]);
      kids.push(lineChart(pts, p.target), h('small', { class: 'pg-cap' }, raw(label)));
    }
  } else if (view === 'calendar') {
    if (p.kind === 'habit') {
      const st = p.st, per = st.periods.slice(-371);
      const daily = st.every === 'day';
      // daily habits line up under the weekdays (Monday first)
      const lead = daily && per.length ? (new Date(per[0].t).getDay() + 6) % 7 : 0;
      const cols = daily ? 7 : Math.min(12, Math.max(4, Math.ceil(Math.sqrt(per.length * 1.6))));
      const editable = !ctx.readonly;
      kids.push(h('div', { class: 'pg-cal', style: { '--cols': cols } },
        daily ? ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x) => h('span', { class: 'pg-wd' }, x)) : null,
        Array.from({ length: lead }, () => h('i', { class: 'c-pad' })),
        per.map((q) => h('i', { class: `c-${q.s}${editable && q.s !== 'todo' && q.s !== 'off' ? ' tap' : ''}`, 'data-act': editable && q.s !== 'todo' && q.s !== 'off' ? 'cell' : null, 'data-k': q.k, title: `${shortDate(q.t, st.every)}: ${CELL_TIP[q.s]}${editable && q.s !== 'todo' ? ' (tap to change)' : ''}` }, daily ? raw(String(new Date(q.t).getDate())) : null))));
      kids.push(h('div', { class: 'pg-legend' }, h('span', { class: 'k-done' }, raw(`${st.done} done`)), st.part ? h('span', { class: 'k-part' }, raw(`${st.part} partly`)) : null, h('span', { class: 'k-miss' }, raw(`${st.missed} missed`)), st.restarts ? h('span', null, raw(`↺ ${st.restarts}`)) : null));
    } else {
      // without a habit, a calendar shows each counted step as a filled cell
      const total = Math.max(1, Math.min(400, Math.round(p.target || p.value || 10)));
      const filled = Math.round(p.frac * total);
      kids.push(h('div', { class: 'pg-cal', style: { '--cols': Math.min(10, total) } }, Array.from({ length: total }, (_, i) => h('i', { class: i < filled ? 'c-done' : 'c-todo' }))), h('small', { class: 'pg-cap' }, raw(label)));
    }
  }
  if (p.kind === 'manual') {
    const step = Number(d.step) || 1;
    kids.push(h('div', { class: 'pg-steps' },
      h('button', { type: 'button', class: 'btn sm', 'data-act': 'prog-dec', title: `Take away ${step}` }, `− ${fmtNum(step)}`),
      h('button', { type: 'button', class: 'btn sm primary', 'data-act': 'prog-inc', title: `Add ${step}` }, `＋ ${fmtNum(step)}`)));
    if (!d.target && !d.value && !ctx.readonly) kids.push(h('small', { class: 'pg-hint' }, 'Connect a habit or checklist into this, or set a goal number in its settings.'));
  }
  return kids;
}
