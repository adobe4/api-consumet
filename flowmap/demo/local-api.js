// In-browser stand-in for the FlowMap server, used by the static demo build (demo/build.mjs).
// Same endpoints and response shapes as server/index.js; the data lives in this browser's localStorage.
import { store_ls } from './util.js';
import { HttpError, fromRow, toCols } from './models.js';
import { localToday } from '../shared/engine.js';
import { buildTemplate, TEMPLATES } from '../shared/templates.js';

const DB_KEY = 'flowmap.demo.db';
const TOKEN_KEY = 'flowmap.token';
const TOKEN = 'local-demo';
const LIMITS = { projects: 200, links: 2000, tasks: 6000, logs: 40000 };

// ---------- auth (same interface as js/api.js) ----------
let memToken = null; // fallback when storage is blocked
export const auth = {
  get token() { return store_ls.get(TOKEN_KEY, null) ?? memToken; },
  set token(v) { memToken = v || null; v ? store_ls.set(TOKEN_KEY, v) : store_ls.del(TOKEN_KEY); },
};
let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

// ---------- storage ----------
let db = (() => { const d = store_ls.get(DB_KEY, null); return d && d.tables ? d : null; })();
const save = () => store_ls.set(DB_KEY, db);
const rows = (res) => db.tables[res];
const fresh = (email, name) => ({ seq: 0, user: { id: 1, email, name, settings: {} }, tables: { projects: [], links: [], tasks: [], logs: [] } });

function seed(email = 'demo@flowmap.local', name = 'You', template = 'creator', today = localToday()) {
  db = fresh(email, name);
  loadWorld(buildTemplate(template, today), { replace: true });
  save();
}
const insert = (res, cols) => { const row = { id: ++db.seq, ...cols }; rows(res).push(row); return row; };
const ownedIds = () => new Set(rows('projects').map((r) => r.id));

function checkRefs(res, cols) {
  const own = ownedIds();
  const need = { links: ['from_id', 'to_id'], tasks: ['project_id'], logs: ['project_id'] }[res] || [];
  for (const c of need) if (cols[c] !== undefined && !own.has(cols[c])) throw new HttpError(400, 'Unknown project');
  if (res === 'links' && cols.from_id !== undefined && cols.from_id === cols.to_id) throw new HttpError(400, 'A project cannot feed itself');
  if (res === 'tasks' && cols.targets !== undefined) cols.targets = JSON.stringify(JSON.parse(cols.targets).filter((id) => own.has(id)));
}

function upsertLog(projectId, day, patch) {
  const row = rows('logs').find((r) => r.project_id === projectId && r.day === day);
  if (row) { if (Object.keys(patch).length) Object.assign(row, patch, { sample: 0 }); return row; }
  return insert('logs', { ...toCols('logs', { projectId, day }, { create: true }), ...patch });
}

function readWorld({ logDays = 400 } = {}) {
  const since = new Date(Date.now() - logDays * 86400000).toISOString().slice(0, 10);
  const list = (res, rs) => rs.map((r) => fromRow(res, r));
  return {
    projects: list('projects', rows('projects')),
    links: list('links', rows('links')),
    tasks: list('tasks', rows('tasks')),
    logs: list('logs', rows('logs').filter((r) => r.day >= since).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))),
  };
}

function loadWorld(data, { replace }) {
  for (const k of Object.keys(LIMITS)) {
    if (data[k] !== undefined && (!Array.isArray(data[k]) || data[k].length > LIMITS[k])) throw new HttpError(400, `${k}: expected a list of at most ${LIMITS[k]}`);
  }
  if (replace) for (const t of Object.values(db.tables)) t.length = 0;
  const map = new Map();
  for (const p of data.projects || []) map.set(p.id, insert('projects', toCols('projects', { ...p, id: undefined }, { create: true })).id);
  const mapId = (k) => { if (!map.has(k)) throw new HttpError(400, `unknown project reference ${JSON.stringify(k)}`); return map.get(k); };
  for (const l of data.links || []) insert('links', toCols('links', { ...l, from: mapId(l.from), to: mapId(l.to) }, { create: true }));
  for (const t of data.tasks || []) {
    const targets = (t.targets || []).filter((x) => map.has(x)).map((x) => map.get(x));
    insert('tasks', toCols('tasks', { ...t, projectId: mapId(t.projectId), targets }, { create: true }));
  }
  for (const l of data.logs || []) {
    const cols = toCols('logs', { ...l, projectId: mapId(l.projectId) }, { create: true });
    db.tables.logs = rows('logs').filter((r) => !(r.project_id === cols.project_id && r.day === cols.day));
    insert('logs', cols);
  }
}

function withReward(before, row) {
  const out = fromRow('tasks', row);
  if ((!before || before.status !== 'done') && row.status === 'done' && row.reward > 0 && row.done_on) {
    const prev = rows('logs').find((r) => r.project_id === row.project_id && r.day === row.done_on);
    const log = upsertLog(row.project_id, row.done_on, { money: (prev?.money || 0) + row.reward });
    return { ...out, log: fromRow('logs', log) };
  }
  return out;
}

// ---------- routes ----------
const today = (q) => (/^\d{4}-\d{2}-\d{2}$/.test(q || '') ? q : localToday());
const publicUser = () => ({ ...db.user });

function parseCreds(body) {
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email');
  if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  return { email };
}

const routes = [];
const route = (method, pattern, handler, { open = false } = {}) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, handler, open });
};

route('GET', '/api/health', () => ({ ok: true, time: new Date().toISOString() }), { open: true });
route('GET', '/api/templates', () => TEMPLATES, { open: true });
route('POST', '/api/auth/register', ({ body }) => {
  const { email } = parseCreds(body);
  const name = String(body.name || '').trim().slice(0, 60) || email.split('@')[0];
  seed(email, name, TEMPLATES[body.template] ? body.template : 'creator', today(body.today));
  return { token: TOKEN, user: publicUser() };
}, { open: true });
// The demo has one local account per browser, so any valid-looking sign-in opens it.
route('POST', '/api/auth/login', ({ body }) => {
  const { email } = parseCreds(body);
  if (!db) seed(email, email.split('@')[0]);
  return { token: TOKEN, user: publicUser() };
}, { open: true });

route('GET', '/api/me', () => ({ user: publicUser() }));
route('PATCH', '/api/me', ({ body }) => {
  if (body.name !== undefined) db.user.name = String(body.name).trim().slice(0, 60);
  if (body.settings && typeof body.settings === 'object') db.user.settings = { ...db.user.settings, ...body.settings };
  return { user: publicUser() };
});
route('POST', '/api/me/password', () => ({ ok: true }));
route('DELETE', '/api/me', () => { db = null; store_ls.del(DB_KEY); return { ok: true }; });

route('GET', '/api/world', () => ({ ...readWorld(), user: publicUser() }));
route('GET', '/api/world/export', () => ({ app: 'flowmap', version: 1, exportedAt: new Date().toISOString(), ...readWorld({ logDays: 5000 }) }));
route('POST', '/api/world/import', ({ body }) => {
  const w = body.world || body;
  const ids = (w.projects || []).map((p) => p && p.id);
  if (ids.some((i) => i === undefined || i === null) || new Set(ids).size !== ids.length) throw new HttpError(400, 'Every project needs a unique id');
  loadWorld(w, { replace: body.replace !== false });
  return readWorld();
});
route('POST', '/api/world/reset', ({ body }) => {
  loadWorld(buildTemplate(TEMPLATES[body.template] ? body.template : 'blank', today(body.today)), { replace: true });
  return readWorld();
});
route('POST', '/api/world/clear-sample', () => {
  db.tables.tasks = rows('tasks').filter((r) => !r.sample);
  db.tables.logs = rows('logs').filter((r) => !r.sample);
  return readWorld();
});

route('POST', '/api/logs/spread', ({ body }) => {
  const month = String(body.month || '');
  if (!/^\d{4}-\d{2}$/.test(month)) throw new HttpError(400, 'month must be YYYY-MM');
  const projectId = Number(body.projectId);
  if (!ownedIds().has(projectId)) throw new HttpError(400, 'Unknown project');
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const t = today(body.today);
  const lastDay = t.startsWith(month) ? Number(t.slice(8)) : daysInMonth;
  const patch = {};
  for (const k of ['money', 'attention', 'customers']) {
    if (typeof body[k] === 'number' && Number.isFinite(body[k]) && body[k] >= 0) patch[k] = Math.round((body[k] / lastDay) * 100) / 100;
  }
  if (!Object.keys(patch).length) throw new HttpError(400, 'Give at least one of money, attention, customers');
  const logs = [];
  for (let d = 1; d <= lastDay; d++) logs.push(fromRow('logs', upsertLog(projectId, `${month}-${String(d).padStart(2, '0')}`, patch)));
  return { logs };
});

for (const res of ['projects', 'links', 'tasks', 'logs']) {
  route('GET', `/api/${res}`, () => rows(res).map((r) => fromRow(res, r)));
  route('POST', `/api/${res}`, ({ body }) => {
    if (res === 'logs') {
      const cols = toCols('logs', body, { create: false });
      if (cols.project_id === undefined || cols.day === undefined) throw new HttpError(400, 'projectId and day are required');
      checkRefs('logs', cols);
      const { project_id, day, ...patch } = cols;
      return fromRow('logs', upsertLog(project_id, day, patch));
    }
    const cols = toCols(res, body, { create: true });
    checkRefs(res, cols);
    const row = insert(res, cols);
    return res === 'tasks' ? withReward(null, row) : fromRow(res, row);
  });
  route('PATCH', `/api/${res}/:id`, ({ body, params }) => {
    const row = rows(res).find((r) => r.id === Number(params.id));
    if (!row) throw new HttpError(404, 'Not found');
    const before = { ...row };
    const cols = toCols(res, body, { create: false });
    checkRefs(res, cols);
    Object.assign(row, cols);
    return res === 'tasks' ? withReward(before, row) : fromRow(res, row);
  });
  route('DELETE', `/api/${res}/:id`, ({ params }) => {
    const id = Number(params.id);
    if (!rows(res).some((r) => r.id === id)) throw new HttpError(404, 'Not found');
    db.tables[res] = rows(res).filter((r) => r.id !== id);
    if (res === 'projects') { // same cascade as the SQLite foreign keys
      db.tables.links = rows('links').filter((l) => l.from_id !== id && l.to_id !== id);
      db.tables.tasks = rows('tasks').filter((t) => t.project_id !== id);
      db.tables.logs = rows('logs').filter((l) => l.project_id !== id);
    }
    return { ok: true };
  });
}

function handle(method, url, body) {
  const u = new URL(url, 'http://local');
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.re.exec(u.pathname);
    if (!m) continue;
    if (!r.open && (!db || !auth.token)) throw new HttpError(401, 'Please sign in');
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    if (method === 'GET') return r.handler({ params, query: u.searchParams, body: {} });
    // writes are all-or-nothing, like the server's transactions
    const snapshot = db && JSON.stringify(db);
    try {
      const out = r.handler({ params, query: u.searchParams, body: body ?? {} });
      if (db) save();
      return out;
    } catch (e) {
      db = snapshot ? JSON.parse(snapshot) : null;
      throw e;
    }
  }
  throw new HttpError(404, 'No such endpoint');
}

export async function api(method, url, body) {
  try {
    return JSON.parse(JSON.stringify(handle(method, url, body)));
  } catch (e) {
    if (e instanceof HttpError && e.status === 401 && auth.token) { auth.token = null; onUnauthorized(); }
    throw new Error(e instanceof HttpError ? e.message : 'Something went wrong in the demo');
  }
}
export const get = (u) => api('GET', u);
export const post = (u, b = {}) => api('POST', u, b);
export const patch = (u, b) => api('PATCH', u, b);
export const del = (u) => api('DELETE', u);

// First visit: open straight into the preloaded creator world.
if (!db) { seed(); auth.token = TOKEN; }
