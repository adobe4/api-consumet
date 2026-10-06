// How trackers look on a board: a habit you tick, and progress views (ring, bar, calendar, line, number)
// fed by a habit, a checklist, a table, or a number you count yourself.
import { h, raw, fmtNum } from '../util.js';
import { habitState, progressOf, tableProgress, periodKey, periodStart, nextStart, keyTime, EVERY_LABEL, fmtLeft } from './track.js';
import { statOf } from './biz.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs, ...kids) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v); kids.forEach((c) => c && el.append(c)); return el; };
const ed = (cls, text, field, placeholder) => h('div', { class: `ed ${cls}`, 'data-field': field, 'data-ph': placeholder || '' }, raw(text || ''));
const UNIT = { hour: 'hour', '2h': 'slot', day: 'day', week: 'week' };
const UNIT_CAP = { hour: 'Hour', '2h': 'Slot', day: 'Day', week: 'Week' };
const TODAY = { hour: 'this hour', '2h': 'in this 2-hour slot', day: 'today', week: 'this week' };
const LAST = { hour: 'last hour', '2h': 'the last slot', day: 'yesterday', week: 'last week' };
const NEXT = { hour: 'Next one in', '2h': 'Next one in', day: 'See you tomorrow', week: 'See you next week' };
const plural = (n, w) => `${fmtNum(n)} ${w}${n === 1 ? '' : 's'}`;
const fmtDay = (t) => new Date(t).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const fmtSlot = (t, every) => (every === 'hour' || every === '2h' ? `${fmtDay(t)}, ${String(new Date(t).getHours()).padStart(2, '0')}:00` : every === 'week' ? `Week of ${fmtDay(t)}` : fmtDay(t));
const TIP = { done: 'done', part: 'partly done', miss: 'missed', now: 'not ticked yet', todo: 'still to come', off: 'rest day', pre: 'before the start' };

// where a habit stands, in words and numbers
export function habitFacts(d, now = Date.now()) {
  const st = habitState(d, now);
  const len = Number(d?.length) || 0;
  const counted = st.run.filter((p) => p.s !== 'off');
  const index = Math.max(1, counted.length); // which day (week, hour) of the challenge this is
  const state = new Map(st.periods.map((p) => [p.k, p.s]));
  const cur = state.get(st.curKey) || 'now';
  const doneish = st.done + st.part;
  // on track when nothing before today was missed
  const behind = st.missed;
  const pace = st.status === 'finished' ? ['fin', '🏁 Finished'] : behind ? ['behind', `${behind} ${behind === 1 ? 'miss' : 'misses'} so far`] : doneish ? ['good', 'On track'] : ['new', 'Just started'];
  return { st, len, index, cur, state, doneish, pace, left: len ? Math.max(0, len - counted.length + (cur === 'now' ? 1 : 0)) : 0 };
}

function messageOf(f) {
  const { st } = f, e = st.every;
  if (st.status === 'soon') return ['soon', 'Not started yet', `Starts ${f.st.runStart ? fmtDay(f.st.runStart) : 'soon'}`];
  if (st.status === 'finished') return ['fin', 'Challenge finished!', `${f.doneish} of ${f.len} ${UNIT[e]}s done`];
  if (f.cur === 'done') return ['ok', `Done ${TODAY[e]}`, e === 'hour' || e === '2h' ? `${NEXT[e]} ${fmtLeft(st.dueIn)}` : NEXT[e]];
  if (f.cur === 'part') return ['part', `Partly done ${TODAY[e]}`, 'Tap ✓ when you finish it'];
  if (f.cur === 'off') return ['ok', 'Rest day', 'Nothing to do today'];
  if (st.status === 'late') return ['late', `Missed ${LAST[e]}`, `Do it ${TODAY[e]} to get back on track`];
  if (st.status === 'restarted') return ['late', 'Started again', `You missed ${LAST[e]}, so the count went back to 1`];
  return ['due', 'Tap when done', `${fmtLeft(st.dueIn)} left ${TODAY[e]}`];
}

// the strip under a habit: this week (daily), the last weeks (weekly) or the last slots (hourly)
function stripCells(f, d) {
  const { st } = f, e = st.every, now = Date.now(), start = keyTime(d.start || periodKey('day', now));
  let ts = [];
  if (e === 'day') { const mon = periodStart('week', now); for (let i = 0; i < 7; i++) ts.push(new Date(new Date(mon).setDate(new Date(mon).getDate() + i)).getTime()); }
  else { let t = periodStart(e, now); for (let i = 0; i < 6; i++) { ts.unshift(t); t = periodStart(e, t - 1); } ts.push(nextStart(e, now)); }
  return ts.map((t) => {
    const k = periodKey(e, t);
    const s = t < periodStart(e, start) ? 'pre' : f.state.get(k) || (t > now ? 'todo' : 'miss');
    const label = e === 'day' ? 'MTWTFSS'[(new Date(t).getDay() + 6) % 7] : e === 'week' ? String(new Date(t).getDate()) : String(new Date(t).getHours()).padStart(2, '0');
    return { k, t, s, label, cur: k === st.curKey };
  });
}

export function habitView(it, ctx) {
  const d = it.data || {};
  const f = habitFacts(d);
  const { st } = f, e = st.every;
  const [cls, msg, sub] = messageOf(f);
  const on = f.cur === 'done', half = f.cur === 'part';
  const chip = f.len ? `${UNIT_CAP[e]} ${Math.min(f.index, f.len)} / ${f.len}` : EVERY_LABEL[e];
  const editable = !ctx.readonly;
  return [
    h('div', { class: 'hb-head' }, ed('ttl', it.title, 'title', 'Name this habit'), h('span', { class: 'hb-chip', title: EVERY_LABEL[e] }, raw(chip))),
    h('div', { class: 'hb-body' },
      h('div', { class: 'hb-tickw' },
        h('button', { type: 'button', class: `hb-tick${on ? ' on' : ''}${half ? ' half' : ''}`, 'data-act': 'tick', title: on ? 'Done. Tap to undo' : `Mark it done ${TODAY[e]}`, 'aria-label': on ? 'Undo' : 'Mark done' }, raw(on ? '✓' : half ? '½' : '✓')),
        !on && f.cur !== 'off' && st.status !== 'finished' ? h('button', { type: 'button', class: `hb-half${half ? ' on' : ''}`, 'data-act': 'tick-part', title: half ? 'Undo partly done' : 'Only did part of it' }, raw('½')) : null),
      h('div', { class: 'hb-info' },
        h('b', { class: `hb-msg m-${cls}` }, raw(msg)),
        h('small', { class: 'hb-sub' }, raw(sub)),
        h('span', { class: 'hb-streak', title: `Best streak: ${plural(st.best, UNIT[e])}` }, raw(`🔥 ${st.streak}`), h('small', null, raw(` ${UNIT[e]} streak${st.best > st.streak ? ` · best ${st.best}` : ''}`))))),
    h('div', { class: 'hb-week' }, stripCells(f, d).map((c) => h('button', {
      type: 'button', class: `hb-day${c.cur ? ' cur' : ''}`, 'data-act': editable && ['done', 'part', 'miss', 'now'].includes(c.s) ? 'hb-cell' : null, 'data-k': c.k,
      title: `${fmtSlot(c.t, e)}: ${TIP[c.s]}${editable && ['done', 'part', 'miss', 'now'].includes(c.s) ? ' (tap to change)' : ''}`,
    }, h('i', { class: `c-${c.s}` }), h('small', null, raw(c.label))))),
  ];
}

// ---------- progress views ----------
function ringSvg(parts) {
  // parts: [{ frac, cls }], drawn from 12 o'clock
  const r = 42, c = 2 * Math.PI * r;
  return svg('svg', { viewBox: '0 0 100 100', class: 'pg-ringsvg' },
    svg('circle', { cx: 50, cy: 50, r, class: 'pg-track' }),
    ...parts.filter((p) => p.frac > 0.001).map((p) => svg('circle', { cx: 50, cy: 50, r, class: p.cls, 'stroke-dasharray': `${(c * Math.min(1, p.frac)).toFixed(2)} ${c.toFixed(2)}`, transform: 'rotate(-90 50 50)' })));
}
function lineChart(points, target) {
  const W = 300, H = 120, top = Math.max(1, target || 0, ...points.map((p) => p[1]));
  const pt = ([x, y]) => `${(x * W).toFixed(1)},${(H - (y / top) * H).toFixed(1)}`;
  const kids = [svg('line', { x1: 0, y1: H, x2: W, y2: H, class: 'pg-axis' })];
  if (target) kids.push(svg('line', { x1: 0, y1: 0, x2: W, y2: 0, class: 'pg-goal' }));
  if (points.length > 1) {
    kids.push(svg('path', { d: `M${pt([points[0][0], 0])} L${points.map(pt).join(' L')} L${pt([points[points.length - 1][0], 0])}Z`, class: 'pg-area' }));
    kids.push(svg('polyline', { points: points.map(pt).join(' '), class: 'pg-line' }));
  }
  if (points.length) { const [x, y] = pt(points[points.length - 1]).split(','); kids.push(svg('circle', { cx: x, cy: y, r: 4.5, class: 'pg-dot' })); }
  return svg('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', class: 'pg-line-svg' }, ...kids);
}
const stat = (n, label, cls = '') => h('span', { class: `pg-st ${cls}` }, h('b', null, raw(fmtNum(n))), h('small', null, raw(label)));

// a real calendar: one block per month (daily), weeks grouped by month (weekly), or one row per day (hourly)
function calendar(f, editable) {
  const { st } = f, e = st.every, now = Date.now();
  const cell = (p, label) => {
    const can = editable && ['done', 'part', 'miss', 'now'].includes(p.s);
    return h('i', { class: `c-${p.s}${p.k === st.curKey ? ' is-today' : ''}${can ? ' tap' : ''}`, 'data-act': can ? 'cell' : null, 'data-k': p.k, title: `${fmtSlot(p.t, e)}: ${TIP[p.s]}${can ? ' (tap to change)' : ''}` }, label != null ? raw(label) : null);
  };
  const wrap = h('div', { class: 'pg-calwrap sf-scroll' });
  let curBlock = null;
  if (e === 'day' || e === 'week') {
    // the months the challenge covers (or the last year, for a habit with no end)
    let per = st.periods;
    if (!f.len) per = per.filter((p) => p.t > now - 366 * 864e5);
    const months = new Map();
    for (const p of per) { const dd = new Date(p.t), k = `${dd.getFullYear()}-${dd.getMonth()}`; if (!months.has(k)) months.set(k, []); months.get(k).push(p); }
    for (const [, ps] of months) {
      const first = new Date(ps[0].t);
      const done = ps.filter((p) => p.s === 'done' || p.s === 'part').length, count = ps.filter((p) => p.s !== 'off').length;
      const isCur = ps.some((p) => p.k === st.curKey);
      const head = h('div', { class: 'pg-mh' }, h('b', null, raw(first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }))), h('small', null, raw(`${done}/${count}`)));
      let grid;
      if (e === 'day') {
        const lead = (first.getDay() + 6) % 7;
        grid = h('div', { class: 'pg-grid' }, ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x) => h('span', { class: 'pg-wd' }, x)), Array.from({ length: lead }, () => h('i', { class: 'c-pad' })), ps.map((p) => cell(p, String(new Date(p.t).getDate()))));
      } else grid = h('div', { class: 'pg-grid wk' }, ps.map((p) => cell(p, `${new Date(p.t).getDate()}`)));
      const block = h('div', { class: `pg-month${isCur ? ' cur' : ''}` }, head, grid);
      if (isCur) curBlock = block;
      wrap.append(block);
    }
  } else {
    // hourly: one row per day, the last two weeks
    const per = st.periods.filter((p) => p.t > now - 14 * 864e5 && p.t < now + 864e5);
    const days = new Map();
    for (const p of per) { const k = periodKey('day', p.t); if (!days.has(k)) days.set(k, []); days.get(k).push(p); }
    for (const [k, ps] of days) {
      const row = h('div', { class: `pg-hrow${k === periodKey('day', now) ? ' cur' : ''}` }, h('small', null, raw(fmtDay(ps[0].t))), h('div', { class: 'pg-hcells', style: { '--n': e === 'hour' ? 24 : 12 } }, ps.map((p) => cell(p))));
      if (k === periodKey('day', now)) curBlock = row;
      wrap.append(row);
    }
  }
  // open on this month
  if (curBlock) setTimeout(() => { if (wrap.isConnected && curBlock.offsetTop > wrap.clientHeight * 0.6) wrap.scrollTop = curBlock.offsetTop - 6; }, 0);
  return wrap;
}

export const PROGRESS_VIEWS = [['calendar', '▦ Calendar'], ['ring', '◯ Ring'], ['bar', '▬ Bar'], ['line', '📈 Line'], ['number', '# Number']];
const PERIOD_WORD = { month: 'this month', year: 'this year', '30d': 'last 30 days', all: 'all time' };

function chooser(ctx, it) {
  const cands = ctx.candidates?.(['habit', 'checklist', 'table']) || [];
  const icon = { habit: '🔁', checklist: '☑', table: '🧮' };
  return h('div', { class: 'pg-pick' },
    h('b', null, 'What should this show?'),
    cands.length ? h('div', { class: 'pg-picks sf-scroll' }, cands.map((c) => h('button', { type: 'button', class: 'pg-choice', 'data-act': 'pg-pick', 'data-id': c.id }, raw(`${icon[c.type]} ${c.title || { habit: 'Habit', checklist: 'Checklist', table: 'Table' }[c.type]}`)))) : h('small', null, 'Add a 🔁 habit, a checklist or a 🧮 table to the board, and it will show up here.'),
    h('button', { type: 'button', class: 'pg-choice alt', 'data-act': 'pg-manual' }, raw('＃ A number I count myself (sales, videos, savings…)')));
}

export function progressView(it, ctx) {
  const d = it.data || {};
  const src = ctx.source?.(it) || null;
  // nothing chosen yet: ask, right inside the item
  if (!src && !d.manual && !d.target && !d.value && !ctx.readonly) return [chooser(ctx, it)];
  const habit = src?.type === 'habit' ? habitFacts(src.data) : null;
  const p = src?.type === 'table' ? tableProgress(statOf(src.data, { col: d.col, period: d.period || 'month' }), d) : progressOf(src, d);
  const view = d.view || (habit ? 'calendar' : 'ring');
  const heading = it.title || src?.title || 'Progress';
  const unit = habit ? UNIT[habit.st.every] : p.kind === 'table' ? (src.data?.currency ?? 'TZS') : d.unit || '';
  const pill = habit ? h('span', { class: `pg-pill p-${habit.pace[0]}` }, raw(habit.pace[1])) : p.kind === 'table' ? h('span', { class: 'pg-pill' }, raw(PERIOD_WORD[d.period || 'month'])) : null;
  const kids = [h('div', { class: 'pg-head' }, ed('ttl', heading, 'title', 'Progress'), pill)];
  const foot = habit ? h('div', { class: 'pg-foot' }, stat(habit.doneish, 'done', 'k-done'), stat(habit.st.missed, 'missed', 'k-miss'), habit.len ? stat(habit.left, 'to go') : stat(habit.st.best, 'best streak'))
    : p.kind === 'checklist' ? h('div', { class: 'pg-foot' }, stat(p.value, 'done', 'k-done'), stat(p.target - p.value, 'left'))
      : h('div', { class: 'pg-foot' }, stat(p.value, unit || 'now', 'k-done'), p.target ? stat(Math.max(0, p.target - p.value), 'to goal') : null);
  // a habit's ring shows how far into the challenge you are (faint) and how much you did (solid)
  const timeFrac = habit && habit.len ? Math.min(1, habit.index / habit.len) : 0;
  const doneFrac = habit ? (habit.len ? habit.doneish / habit.len : habit.st.run.length ? habit.doneish / Math.max(1, habit.st.run.filter((q) => q.s !== 'off').length) : 0) : p.frac;
  const bigText = habit ? (habit.len ? `${UNIT_CAP[habit.st.every]} ${Math.min(habit.index, habit.len)}` : `🔥 ${habit.st.streak}`) : `${Math.round(p.frac * 100)}%`;
  const smallText = habit ? (habit.len ? `of ${habit.len}` : `${UNIT[habit.st.every]} streak`) : p.target ? `of ${fmtNum(p.target)}${unit ? ` ${unit}` : ''}` : '';
  if (view === 'ring') {
    kids.push(h('div', { class: 'pg-ring' }, ringSvg([{ frac: timeFrac, cls: 'pg-time' }, { frac: doneFrac, cls: 'pg-fill' }]), h('div', { class: 'pg-mid' }, h('b', null, raw(bigText)), smallText ? h('small', null, raw(smallText)) : null)), foot);
  } else if (view === 'bar') {
    kids.push(h('div', { class: 'pg-bar' },
      h('div', { class: 'pg-barl' }, h('b', null, raw(bigText)), h('small', null, raw(smallText))),
      h('div', { class: 'pg-track-bar' }, timeFrac ? h('i', { class: 'time', style: { width: `${timeFrac * 100}%` } }) : null, h('i', { style: { width: `${Math.min(1, doneFrac) * 100}%` } }))), foot);
  } else if (view === 'number') {
    kids.push(h('div', { class: 'pg-num' }, h('b', null, raw(habit ? `🔥 ${habit.st.streak}` : fmtNum(p.value))), h('small', null, raw(habit ? `${UNIT[habit.st.every]} streak · best ${habit.st.best}` : `${unit}${p.target ? ` · goal ${fmtNum(p.target)}` : ''}`))), habit ? foot : null);
  } else if (view === 'line') {
    let pts = [];
    if (habit) {
      const per = habit.st.periods, n = Math.max(1, per.length - 1);
      let acc = 0;
      per.forEach((q, i) => { if (q.s === 'todo') return; acc += q.s === 'done' ? 1 : q.s === 'part' ? 0.5 : 0; pts.push([i / n, acc]); });
      kids.push(lineChart(pts, habit.len || 0), foot);
    } else {
      const hist = (p.history || []).slice(-60);
      const t0 = hist.length ? hist[0][0] : 0, t1 = hist.length ? hist[hist.length - 1][0] : 1;
      pts = hist.map(([t, v]) => [t1 > t0 ? (t - t0) / (t1 - t0) : 1, v]);
      kids.push(pts.length > 1 ? lineChart(pts, p.target) : h('div', { class: 'pg-empty' }, 'Tap ＋ a few times and your line appears here.'), foot);
    }
  } else if (view === 'calendar') {
    if (habit) kids.push(calendar(habit, !ctx.readonly), h('div', { class: 'pg-legend' }, h('span', { class: 'k-done' }, 'done'), h('span', { class: 'k-part' }, 'partly'), h('span', { class: 'k-miss' }, 'missed'), h('span', { class: 'k-today' }, 'today')));
    else {
      // without a habit: one square per step towards the goal
      const total = Math.max(1, Math.min(200, Math.round(p.target || 10)));
      const filled = Math.round(p.frac * total);
      kids.push(h('div', { class: 'pg-calwrap sf-scroll' }, h('div', { class: 'pg-grid', style: { '--cols': Math.min(10, total) } }, Array.from({ length: total }, (_, i) => h('i', { class: i < filled ? 'c-done' : 'c-todo' })))), foot);
    }
  }
  if (p.kind === 'manual' && !ctx.readonly) {
    const step = Number(d.step) || 1;
    kids.push(h('div', { class: 'pg-steps' },
      h('button', { type: 'button', class: 'pg-stepb', 'data-act': 'prog-dec', title: `Take away ${fmtNum(step)}` }, raw(`− ${fmtNum(step)}`)),
      h('button', { type: 'button', class: 'pg-stepb add', 'data-act': 'prog-inc', title: `Add ${fmtNum(step)}` }, raw(`＋ ${fmtNum(step)}`))));
  }
  return kids;
}
