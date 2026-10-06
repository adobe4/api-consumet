// Trackers inside a board: habits you tick every hour, day or week, challenges that run for a set time,
// progress views fed by them, and the warnings that spread along connections when something is missed.
// Pure logic (no DOM) so it runs the same in the browser and in tests. Times are the viewer's local time.

export const EVERY = ['hour', '2h', 'day', 'week'];
export const EVERY_LABEL = { hour: 'Every hour', '2h': 'Every 2 hours', day: 'Every day', week: 'Every week' };
export const UNIT = { hour: 'hour', '2h': '2 hours', day: 'day', week: 'week' };
const HOUR = 3600e3, DAY = 24 * HOUR;

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// the start of the period that holds this moment
export function periodStart(every, t) {
  const d = new Date(t);
  if (every === 'hour') { d.setMinutes(0, 0, 0); return d.getTime(); }
  if (every === '2h') { d.setMinutes(0, 0, 0); d.setHours(d.getHours() - (d.getHours() % 2)); return d.getTime(); }
  d.setHours(0, 0, 0, 0);
  if (every === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // weeks start on Monday
  return d.getTime();
}
export function nextStart(every, t) {
  const d = new Date(periodStart(every, t));
  if (every === 'hour') d.setHours(d.getHours() + 1);
  else if (every === '2h') d.setHours(d.getHours() + 2);
  else if (every === 'week') d.setDate(d.getDate() + 7);
  else d.setDate(d.getDate() + 1);
  return d.getTime();
}
// a short stable name for a period: 2026-10-06 for days and weeks (the Monday), 2026-10-06T14 for hours
export function periodKey(every, t) {
  const d = new Date(periodStart(every, t));
  return every === 'hour' || every === '2h' ? `${ymd(d)}T${pad(d.getHours())}` : ymd(d);
}
export function keyTime(key) {
  const [date, hh] = key.split('T');
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, hh ? Number(hh) : 0).getTime();
}
export const todayKey = (now = Date.now()) => ymd(new Date(now));

// every period from start up to and including the one holding `end`, capped so a huge range stays cheap
export function periodsBetween(every, start, end, cap = 4000) {
  const out = [];
  for (let t = periodStart(every, start); t <= end && out.length < cap; t = nextStart(every, t)) out.push(t);
  return out;
}
const countsOn = (h, t) => h.every !== 'day' || !Array.isArray(h.days) || !h.days.length || h.days.includes(new Date(t).getDay());

export function habitDefaults(now = Date.now()) {
  return { every: 'day', start: todayKey(now), length: 0, onMiss: 'mark', log: {} };
}

// Everything a habit shows: each period's state, streaks, how the challenge is going, and whether to warn.
// state per period: done | part | miss | now (the current one, not ticked yet) | todo (ahead, inside the challenge) | off (a rest day)
export function habitState(data, now = Date.now()) {
  const h = { ...habitDefaults(now), ...(data || {}) };
  const every = EVERY.includes(h.every) ? h.every : 'day';
  const log = h.log || {};
  const start = h.start ? keyTime(h.start) : now;
  const length = Math.max(0, Math.round(Number(h.length) || 0));
  const curStart = periodStart(every, now);
  const raw = periodsBetween(every, start, now).map((t) => {
    const k = periodKey(every, t);
    if (!countsOn({ ...h, every }, t)) return { k, t, s: 'off' };
    const v = log[k];
    if (v === 'done' || v === 'part') return { k, t, s: v };
    return { k, t, s: t >= curStart ? 'now' : 'miss' };
  });
  // walk forward: with "restart when missed" the run begins again right after a miss; a challenge stops at its length
  let runFrom = 0, restarts = 0, n = 0, end = raw.length;
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i].s;
    if (s === 'off') continue;
    if (s === 'miss' && h.onMiss === 'restart') { runFrom = i + 1; if (n) restarts++; n = 0; continue; }
    n++;
    if (length && n >= length) { end = i + 1; break; }
  }
  const seen = raw.slice(0, end), run = seen.slice(runFrom);
  const counted = run.filter((p) => p.s !== 'off');
  const done = counted.filter((p) => p.s === 'done').length, part = counted.filter((p) => p.s === 'part').length, missed = counted.filter((p) => p.s === 'miss').length;
  // streak: unbroken done/partial periods up to now (the current period may still be open)
  let streak = 0;
  for (let i = seen.length - 1; i >= 0; i--) { const s = seen[i].s; if (s === 'off' || (s === 'now' && i === seen.length - 1)) continue; if (s === 'done' || s === 'part') streak++; else break; }
  let best = 0, cur = 0;
  for (const p of seen) { if (p.s === 'done' || p.s === 'part') { cur++; best = Math.max(best, cur); } else if (p.s === 'miss') cur = 0; }
  // the periods still ahead inside the challenge
  const future = [];
  if (length && end === raw.length) {
    let left = length - counted.length;
    for (let t = nextStart(every, now); left > 0 && future.length < 4000; t = nextStart(every, t)) { const on = countsOn({ ...h, every }, t); future.push({ k: periodKey(every, t), t, s: on ? 'todo' : 'off' }); if (on) left--; }
  }
  const periods = [...run, ...future];
  const total = length || counted.length;
  const last = [...seen].reverse().find((p) => p.s !== 'off' && p.t < curStart);
  const now0 = raw[raw.length - 1];
  const finished = length > 0 && counted.length >= length && !(end === raw.length && now0?.s === 'now');
  let status = 'due';
  if (!raw.length) status = 'soon';
  else if (finished) status = 'finished';
  else if (now0?.s === 'done' || now0?.s === 'part') status = 'ok';
  else if (last?.s === 'miss') status = h.onMiss === 'restart' ? 'restarted' : 'late';
  else if (now0?.s === 'off') status = 'ok';
  const runStart = run.length ? run[0].t : curStart;
  const dueIn = nextStart(every, now) - now;
  return { every, periods, run, done, part, missed, total, streak, best, restarts, status, finished, runStart, curKey: periodKey(every, now), dueIn, score: total ? (done + part * 0.5) / total : 0 };
}
// tap the tick: empty -> done, done -> empty; partial is its own button
export function tick(data, key, value = 'done') {
  const log = { ...(data?.log || {}) };
  if (log[key] === value) delete log[key]; else log[key] = value;
  return { ...data, log };
}
// in the calendar: a cell goes empty -> done -> partial -> empty
export function cycleCell(data, key) {
  const log = { ...(data?.log || {}) };
  const v = log[key];
  if (!v) log[key] = 'done'; else if (v === 'done') log[key] = 'part'; else delete log[key];
  return { ...data, log };
}

// Checklists can reset every hour/day/week: a tick only counts inside the period it was made in
export function checklistState(data, now = Date.now()) {
  const d = data || {}, items = d.items || [];
  const every = EVERY.includes(d.every) ? d.every : null;
  const key = every ? periodKey(every, now) : null;
  const on = items.map((x) => !!x.done && (!every || (x.at && periodKey(every, x.at) === key)));
  const done = on.filter(Boolean).length;
  let status = 'ok';
  if (every && items.length) {
    const prev = periodKey(every, periodStart(every, now) - 1);
    const since = d.since ? periodKey(every, d.since) : prev;
    const full = d.full || [];
    if (done === items.length) status = 'ok';
    else if (since <= prev && !full.includes(prev)) status = 'late';
    else status = 'due';
  }
  return { every, on, done, total: items.length, status, key };
}
// after a tick: remember the periods when everything got done (the last 60 of them)
export function markChecklist(data, now = Date.now()) {
  const st = checklistState(data, now);
  if (!st.every || !st.total || st.done < st.total) return data;
  const full = (data.full || []).filter((k) => k !== st.key);
  full.push(st.key);
  return { ...data, full: full.slice(-60) };
}

// What a progress item shows: from a habit, a checklist, a number you count, or another progress item
export function progressOf(src, data, now = Date.now()) {
  const d = data || {};
  if (src?.type === 'habit') {
    const st = habitState(src.data, now);
    return { kind: 'habit', st, value: st.done + st.part * 0.5, target: st.total || 1, frac: st.total ? Math.min(1, (st.done + st.part * 0.5) / st.total) : 0 };
  }
  if (src?.type === 'checklist') {
    const st = checklistState(src.data, now);
    return { kind: 'checklist', st, value: st.done, target: st.total || 1, frac: st.total ? st.done / st.total : 0 };
  }
  const value = Number(d.value) || 0, target = Number(d.target) || 0;
  return { kind: 'manual', value, target, frac: target ? Math.max(0, Math.min(1, value / target)) : 0, history: d.history || [] };
}

// Board awareness: which items are late, and which items they feed (following connections forward)
export function boardStatus(board, now = Date.now()) {
  const state = new Map(), late = [];
  for (const it of board.items || []) {
    let s = null;
    if (it.type === 'habit') s = habitState(it.data, now).status;
    else if (it.type === 'checklist' && it.data?.every) s = checklistState(it.data, now).status;
    if (s) state.set(it.id, s);
    if (s === 'late' || s === 'restarted') late.push(it.id);
  }
  const hurt = new Map();
  // progress views just show the habit that feeds them, so they pass a warning on without being marked
  const isView = new Set((board.items || []).filter((i) => i.type === 'progress').map((i) => i.id));
  const out = new Map();
  for (const l of board.links || []) if (l.from?.item && l.to?.item) { if (!out.has(l.from.item)) out.set(l.from.item, []); out.get(l.from.item).push(l.to.item); }
  for (const id of late) {
    const seen = new Set([id]);
    let wave = [id];
    for (let depth = 1; depth <= 4 && wave.length; depth++) {
      const next = [];
      for (const a of wave) for (const b of out.get(a) || []) if (!seen.has(b)) { seen.add(b); next.push(b); if (!late.includes(b) && !isView.has(b) && (!hurt.has(b) || hurt.get(b).depth > depth)) hurt.set(b, { by: id, depth }); }
      wave = next;
    }
  }
  return { state, late, hurt };
}

export function fmtLeft(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m} min`;
  const hrs = Math.floor(m / 60);
  if (hrs < 48) return `${hrs} h${m % 60 && hrs < 6 ? ` ${m % 60} min` : ''}`;
  return `${Math.round(hrs / 24)} days`;
}
