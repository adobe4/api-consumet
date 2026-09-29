// Application state, the simulation cache and every mutation (optimistic, then synced to the server).
import { simulate, alerts, suggestions, localToday, addDays } from '/shared/engine.js';
import { api, get, post, patch, del } from './api.js';
import { debounce } from './util.js';

const HORIZON = 120;
const handlers = new Map();
export const on = (ev, fn) => { (handlers.get(ev) || handlers.set(ev, new Set()).get(ev)).add(fn); return () => handlers.get(ev).delete(fn); };
export const emit = (ev, data) => { for (const fn of handlers.get(ev) || []) fn(data); };
export const notify = (message, kind = 'info') => emit('toast', { message, kind });

export const S = {
  user: null,
  world: { projects: [], links: [], tasks: [], logs: [] },
  today: localToday(),
  scenario: 'planned',
  offset: 0,
  sim: null,
  selection: null, // { type: 'project' | 'link', id }
  tool: null, // null | 'link'
  version: 0,
};

let memo = {};

export function recompute() {
  S.version++;
  memo = {};
  S.sim = simulate(S.world, { today: S.today, horizon: HORIZON, scenario: S.scenario });
  emit('sim');
}

export const snap = (offset = S.offset) => S.sim.days[Math.min(Math.max(0, offset), HORIZON)];

// How far through today we are (0 at midnight, 1 at the next midnight), in the viewer's own clock.
export function dayFraction(now = new Date()) {
  const m = new Date(now);
  m.setHours(0, 0, 0, 0);
  return Math.min(1, Math.max(0, (now - m) / 86400000));
}
// The map runs on the real clock: through the day, today's state slides toward tomorrow's, so a project you
// leave alone visibly drains a little by evening. In the future view, days are shown as simulated.
let liveCache = { key: '', at: 0, value: null };
export function liveSnap() {
  if (S.offset > 0) return snap();
  const now = Date.now();
  const key = `${S.version}:${S.scenario}`;
  if (liveCache.key === key && now - liveCache.at < 2000) return liveCache.value;
  // drift toward "nothing else happens today", never toward tasks that are only planned
  memo.idle ||= simulate(S.world, { today: S.today, horizon: 1, scenario: 'stop' });
  const a = S.sim.days[0], b = memo.idle.days[1] || a, f = dayFraction();
  const mix = (x, y, keys) => { const o = { ...x }; for (const k of keys) if (typeof x[k] === 'number' && typeof y?.[k] === 'number') o[k] = x[k] + (y[k] - x[k]) * f; return o; };
  const PK = ['health', 'money', 'attention', 'customers', 'flow', 'boost', 'cost', 'profit'];
  const value = {
    ...a,
    projects: Object.fromEntries(Object.entries(a.projects).map(([id, p]) => [id, mix(p, b.projects[id], PK)])),
    links: Object.fromEntries(Object.entries(a.links).map(([id, l]) => [id, mix(l, b.links[id], ['amount', 'boost', 'norm', 'speed'])])),
    totals: mix(a.totals, b.totals, ['money', 'cost', 'attention', 'customers', 'health', 'profit']),
  };
  liveCache = { key, at: now, value };
  return value;
}
export const HORIZON_DAYS = HORIZON;
export const project = (id) => S.world.projects.find((p) => p.id === id);
export const nameOf = (id) => project(id)?.name || 'Unknown';
export const projects = () => S.world.projects.filter((p) => !p.archived);

export function currentAlerts() {
  return (memo.alerts ||= alerts(S.world, S.sim.ctx, S.sim.days[0]));
}
export function currentSuggestions(n = 4) {
  return (memo['sug' + n] ||= suggestions(S.sim.ctx, S.sim.days[0], n));
}
// All three scenarios, for the forecast chart. Cached until the world changes.
export function scenarios() {
  return (memo.scen ||= Object.fromEntries(['planned', 'keep', 'stop'].map((sc) =>
    [sc, sc === S.scenario ? S.sim : simulate(S.world, { today: S.today, horizon: HORIZON, scenario: sc })])));
}

const pickWorld = (w) => ({ projects: w.projects, links: w.links, tasks: w.tasks, logs: w.logs, notes: w.notes || [], scans: w.scans || [] });

export async function loadAll() {
  const w = await get('/api/world');
  S.user = w.user;
  S.world = pickWorld(w);
  // keep the server's idea of "today" (used by scans and the daily AI) in the owner's time zone
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (tz && S.user.settings?.tz !== tz) patch('/api/me', { settings: { tz } }).then((r) => { S.user = r.user; }).catch(() => {});
  S.today = localToday();
  S.selection = null;
  S.offset = 0;
  recompute();
  emit('world');
}
export function resetLocal() {
  S.user = null;
  S.world = { projects: [], links: [], tasks: [], logs: [], notes: [], scans: [] };
  S.sim = null;
  S.selection = null;
}

export function refreshToday() {
  const t = localToday();
  if (t !== S.today) { S.today = t; recompute(); emit('world'); }
}

// ---------- view state ----------
export function select(sel) { S.selection = sel; emit('selection'); }
export function setTool(t) { S.tool = t; emit('tool'); }
export function setOffset(n) { S.offset = Math.max(0, Math.min(HORIZON, Math.round(n))); emit('offset'); }
export function setScenario(sc) { S.scenario = sc; recompute(); emit('offset'); }

// ---------- mutations ----------
async function guard(fn) {
  try { return await fn(); } catch (e) { notify(e.message, 'error'); await loadAll().catch(() => {}); return null; }
}
const changed = () => { recompute(); emit('world'); };
const upsertLocal = (list, item) => { const i = list.findIndex((x) => x.id === item.id); if (i >= 0) list[i] = item; else list.push(item); };

export const addProject = (data) => guard(async () => {
  const p = await post('/api/projects', { createdOn: S.today, ...data });
  S.world.projects.push(p);
  changed();
  select({ type: 'project', id: p.id });
  return p;
});
export const updateProject = (id, patchData) => guard(async () => {
  const p = project(id);
  Object.assign(p, patchData);
  changed();
  await patch(`/api/projects/${id}`, patchData);
});
const persistPos = debounce((id, x, y) => patch(`/api/projects/${id}`, { x, y }).catch(() => {}), 400);
export function moveProject(id, x, y) {
  const p = project(id);
  if (!p) return;
  p.x = x; p.y = y;
  persistPos(id, x, y);
}
// several projects at once (tidy layout, undo); positions are already set locally by the caller
export const savePositions = (list) => guard(async () => {
  await Promise.all(list.map(({ id, x, y }) => patch(`/api/projects/${id}`, { x, y })));
});
export const deleteProject = (id) => guard(async () => {
  await del(`/api/projects/${id}`);
  const w = S.world;
  w.projects = w.projects.filter((p) => p.id !== id);
  w.links = w.links.filter((l) => l.from !== id && l.to !== id);
  w.tasks = w.tasks.filter((t) => t.projectId !== id);
  w.logs = w.logs.filter((l) => l.projectId !== id);
  if (S.selection?.id === id) S.selection = null;
  changed();
  emit('selection');
});

export const addLink = (data) => guard(async () => {
  const l = await post('/api/links', data);
  S.world.links.push(l);
  changed();
  select({ type: 'link', id: l.id });
  return l;
});
export const updateLink = (id, patchData) => guard(async () => {
  Object.assign(S.world.links.find((l) => l.id === id), patchData);
  changed();
  await patch(`/api/links/${id}`, patchData);
});
export const deleteLink = (id) => guard(async () => {
  await del(`/api/links/${id}`);
  S.world.links = S.world.links.filter((l) => l.id !== id);
  if (S.selection?.id === id && S.selection.type === 'link') S.selection = null;
  changed();
  emit('selection');
});

function absorbTask(t) {
  const { log, ...task } = t;
  upsertLocal(S.world.tasks, task);
  if (log) upsertLocal(S.world.logs, log);
  return task;
}
export const addTask = (data) => guard(async () => {
  const t = absorbTask(await post('/api/tasks', { due: S.today, ...data }));
  changed();
  if (t.status === 'done') emit('pulse', { task: t });
  return t;
});
export const updateTask = (id, patchData) => guard(async () => {
  const t = absorbTask(await patch(`/api/tasks/${id}`, patchData));
  changed();
  return t;
});
export const deleteTask = (id) => guard(async () => {
  await del(`/api/tasks/${id}`);
  S.world.tasks = S.world.tasks.filter((t) => t.id !== id);
  changed();
});
// The heart of the game: finishing a task pours water into the system.
export const completeTask = (id, extra = {}) => guard(async () => {
  const t = absorbTask(await patch(`/api/tasks/${id}`, { status: 'done', doneOn: S.today, ...extra }));
  changed();
  emit('pulse', { task: t });
  return t;
});
export const reopenTask = (id) => updateTask(id, { status: 'todo', doneOn: null, due: S.today });

export const saveLogs = (entries) => guard(async () => {
  for (const e of entries) upsertLocal(S.world.logs, await post('/api/logs', e));
  changed();
  emit('logsaved', entries);
});
export const spreadMonth = (body) => guard(async () => {
  const r = await post('/api/logs/spread', { today: S.today, ...body });
  for (const l of r.logs) upsertLocal(S.world.logs, l);
  changed();
  return r.logs.length;
});

export const clearSample = () => guard(async () => {
  const w = await post('/api/world/clear-sample');
  S.world = pickWorld(w);
  changed();
});
export const resetWorld = (template) => guard(async () => {
  const w = await post('/api/world/reset', { template, today: S.today });
  S.world = pickWorld(w);
  S.selection = null;
  changed();
  emit('selection');
  emit('fit');
});
export const importWorld = (world) => guard(async () => {
  const w = await post('/api/world/import', { world, replace: true });
  S.world = pickWorld(w);
  S.selection = null;
  changed();
  emit('selection');
  emit('fit');
  return true;
});
export const exportWorld = () => get('/api/world/export');

// ---------- channels, AI brain, agents ----------
const absorbWorld = (w) => { S.world = { ...pickWorld(w) }; changed(); };
export const scanProject = (id) => guard(async () => {
  const r = await post(`/api/projects/${id}/scan`);
  absorbWorld(r.world);
  return r.results;
});
export const scanAllChannels = () => guard(async () => {
  const r = await post('/api/scan');
  absorbWorld(r.world);
  return r.results;
});
// no guard: the caller shows the provider's error next to the button
export async function runBrain() {
  const r = await post('/api/brain/run');
  absorbWorld(r.world);
  return r;
}
export const dismissNote = (id) => guard(async () => {
  S.world.notes = S.world.notes.filter((n) => n.id !== id);
  emit('world');
  await del(`/api/notes/${id}`);
});
export async function saveSettings(settings) {
  const r = await patch('/api/me', { settings });
  S.user = r.user;
  return r.user;
}
export async function saveSecrets(secrets) {
  const r = await api('PUT', '/api/me/secrets', secrets);
  S.user = r.user;
  return r.user;
}
export const listAgentKeys = () => get('/api/agent-keys');
export const createAgentKey = (name) => post('/api/agent-keys', { name });
export const deleteAgentKey = (id) => del(`/api/agent-keys/${id}`);

export const hasSample = () => S.world.tasks.some((t) => t.sample) || S.world.logs.some((l) => l.sample);
export const logFor = (projectId, day) => S.world.logs.find((l) => l.projectId === projectId && l.day === day);
export { addDays };
