// FlowMap server: static files + JSON API + SQLite, no runtime dependencies (Node >= 22.5).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, tx } from './db.js';
import { hashPassword, verifyPassword, signToken, verifyToken, loadSecret, makeLimiter } from './auth.js';
import { RES, HttpError, fromRow, toCols, readWorld, loadWorld, ownedProjectIds } from './models.js';
import { simulate, alerts, suggestions, localToday } from '../shared/engine.js';
import { buildTemplate, TEMPLATES } from '../shared/templates.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const SHARED = path.join(ROOT, 'shared');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const PORT = Number(process.env.PORT || 8787);
const OPEN_SIGNUP = process.env.ALLOW_REGISTRATION !== 'false';

const db = openDb(DATA_DIR);
const secret = loadSecret(DATA_DIR);
const authLimit = makeLimiter(12, 10 * 60 * 1000);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SEC_HEADERS, ...headers });
  res.end(body);
}
const sendJson = (res, status, obj) => send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });

async function readBody(req, limit = 3_000_000) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, 'Request too large');
    chunks.push(c);
  }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON'); }
}

function serveStatic(req, res, pathname) {
  let base = PUBLIC;
  let rel = pathname;
  if (pathname.startsWith('/shared/')) { base = SHARED; rel = pathname.slice('/shared'.length); }
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(base, rel));
  if (!file.startsWith(base + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    if (path.extname(pathname)) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
    return send(res, 200, fs.readFileSync(path.join(PUBLIC, 'index.html')), { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
  }
  const type = MIME[path.extname(file)] || 'application/octet-stream';
  send(res, 200, fs.readFileSync(file), { 'Content-Type': type, 'Cache-Control': 'no-cache' });
}

// ---------- helpers ----------
const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, settings: safeJson(u.settings) });
const safeJson = (s) => { try { return JSON.parse(s); } catch { return {}; } };
const today = (q) => (/^\d{4}-\d{2}-\d{2}$/.test(q || '') ? q : localToday());

function requireUser(req) {
  const h = req.headers.authorization || '';
  const uid = verifyToken(secret, h.startsWith('Bearer ') ? h.slice(7) : '');
  const user = uid && db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
  if (!user) throw new HttpError(401, 'Please sign in');
  return user;
}

function parseCreds(body) {
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) throw new HttpError(400, 'Enter a valid email');
  if (password.length < 8 || password.length > 200) throw new HttpError(400, 'Password must be at least 8 characters');
  return { email, password };
}

function checkRefs(uid, res, cols) {
  const own = ownedProjectIds(db, uid);
  const need = { links: ['from_id', 'to_id'], tasks: ['project_id'], logs: ['project_id'] }[res] || [];
  for (const c of need) if (cols[c] !== undefined && !own.has(cols[c])) throw new HttpError(400, 'Unknown project');
  if (res === 'links' && cols.from_id !== undefined && cols.from_id === cols.to_id) throw new HttpError(400, 'A project cannot feed itself');
  if (res === 'tasks' && cols.targets !== undefined) {
    cols.targets = JSON.stringify(JSON.parse(cols.targets).filter((id) => own.has(id)));
  }
}

function upsertLog(uid, projectId, day, patch) {
  const row = db.prepare('SELECT * FROM logs WHERE project_id = ? AND day = ? AND user_id = ?').get(projectId, day, uid);
  if (row) {
    const names = Object.keys(patch);
    if (names.length) db.prepare(`UPDATE logs SET ${names.map((n) => `${n} = ?`).join(', ')}, sample = 0 WHERE id = ?`).run(...names.map((n) => patch[n]), row.id);
    return db.prepare('SELECT * FROM logs WHERE id = ?').get(row.id);
  }
  const cols = { project_id: projectId, day, ...patch };
  const names = Object.keys(cols);
  const id = Number(db.prepare(`INSERT INTO logs (user_id, ${names.join(', ')}) VALUES (?, ${names.map(() => '?').join(', ')})`).run(uid, ...names.map((n) => cols[n])).lastInsertRowid);
  return db.prepare('SELECT * FROM logs WHERE id = ?').get(id);
}

// ---------- routes ----------
const routes = [];
const route = (method, pattern, handler, { auth = true } = {}) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, handler, auth });
};

route('GET', '/api/health', () => ({ ok: true, time: new Date().toISOString() }), { auth: false });
route('GET', '/api/templates', () => TEMPLATES, { auth: false });

route('POST', '/api/auth/register', async ({ body, req }) => {
  if (!OPEN_SIGNUP) throw new HttpError(403, 'Registration is closed');
  const { email, password } = parseCreds(body);
  if (!authLimit(`reg:${req.socket.remoteAddress}`)) throw new HttpError(429, 'Too many attempts, wait a few minutes');
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'That email already has an account');
  const name = String(body.name || '').trim().slice(0, 60) || email.split('@')[0];
  const template = TEMPLATES[body.template] ? body.template : 'creator';
  const uid = tx(db, () => {
    const id = Number(db.prepare('INSERT INTO users (email, name, pass) VALUES (?, ?, ?)').run(email, name, hashPassword(password)).lastInsertRowid);
    loadWorld(db, id, buildTemplate(template, /^\d{4}-\d{2}-\d{2}$/.test(body.today || '') ? body.today : localToday()), { replace: true });
    return id;
  });
  return { token: signToken(secret, uid), user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(uid)) };
}, { auth: false });

route('POST', '/api/auth/login', ({ body, req }) => {
  const { email, password } = parseCreds(body);
  if (!authLimit(`login:${req.socket.remoteAddress}:${email}`)) throw new HttpError(429, 'Too many attempts, wait a few minutes');
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  // verify against a dummy hash when the user is unknown so timing does not reveal accounts
  const ok = u ? verifyPassword(password, u.pass) : (verifyPassword(password, 's1$AAAAAAAAAAAAAAAAAAAAAA$' + 'A'.repeat(86)), false);
  if (!ok) throw new HttpError(401, 'Wrong email or password');
  return { token: signToken(secret, u.id), user: publicUser(u) };
}, { auth: false });

route('GET', '/api/me', ({ user }) => ({ user: publicUser(user) }));
route('PATCH', '/api/me', ({ user, body }) => {
  const name = body.name === undefined ? user.name : String(body.name).trim().slice(0, 60);
  let settings = safeJson(user.settings);
  if (body.settings && typeof body.settings === 'object') {
    settings = { ...settings, ...body.settings };
    if (JSON.stringify(settings).length > 4000) throw new HttpError(400, 'settings too large');
  }
  db.prepare('UPDATE users SET name = ?, settings = ? WHERE id = ?').run(name, JSON.stringify(settings), user.id);
  return { user: publicUser({ ...user, name, settings: JSON.stringify(settings) }) };
});
route('POST', '/api/me/password', ({ user, body }) => {
  if (!verifyPassword(String(body.current || ''), user.pass)) throw new HttpError(403, 'Current password is wrong');
  const next = String(body.next || '');
  if (next.length < 8 || next.length > 200) throw new HttpError(400, 'New password must be at least 8 characters');
  db.prepare('UPDATE users SET pass = ? WHERE id = ?').run(hashPassword(next), user.id);
  return { ok: true };
});
route('DELETE', '/api/me', ({ user, body }) => {
  if (!verifyPassword(String(body.password || ''), user.pass)) throw new HttpError(403, 'Password is wrong');
  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  return { ok: true };
});

route('GET', '/api/world', ({ user }) => ({ ...readWorld(db, user.id), user: publicUser(user) }));
route('GET', '/api/world/export', ({ user }) => ({ app: 'flowmap', version: 1, exportedAt: new Date().toISOString(), ...readWorld(db, user.id, { logDays: 5000 }) }));
route('POST', '/api/world/import', ({ user, body }) => {
  const w = body.world || body;
  const ids = (w.projects || []).map((p) => p && p.id);
  if (ids.some((i) => i === undefined || i === null) || new Set(ids).size !== ids.length) throw new HttpError(400, 'Every project needs a unique id');
  loadWorld(db, user.id, w, { replace: body.replace !== false });
  return readWorld(db, user.id);
});
route('POST', '/api/world/reset', ({ user, body }) => {
  const template = TEMPLATES[body.template] ? body.template : 'blank';
  loadWorld(db, user.id, buildTemplate(template, today(body.today)), { replace: true });
  return readWorld(db, user.id);
});
route('POST', '/api/world/clear-sample', ({ user }) => {
  db.prepare('DELETE FROM tasks WHERE user_id = ? AND sample = 1').run(user.id);
  db.prepare('DELETE FROM logs WHERE user_id = ? AND sample = 1').run(user.id);
  return readWorld(db, user.id);
});

// Same engine as the browser, so other tools (or a big company's dashboards) can read the simulation.
route('GET', '/api/report', ({ user, query }) => {
  const world = readWorld(db, user.id);
  const t = today(query.get('today'));
  const horizon = Math.min(365, Math.max(0, Number(query.get('horizon')) || 30));
  const scenario = ['planned', 'keep', 'stop'].includes(query.get('scenario')) ? query.get('scenario') : 'planned';
  const sim = simulate(world, { today: t, horizon, scenario });
  const now = sim.days[0];
  const named = (map) => world.projects.filter((p) => map[p.id]).map((p) => ({ id: p.id, name: p.name, kind: p.kind, ...map[p.id] }));
  return {
    today: t, scenario, totals: now.totals,
    projects: named(now.projects),
    alerts: alerts(world, sim.ctx, now),
    suggestions: suggestions(sim.ctx, now, 5),
    forecast: sim.days.map((d) => ({ day: d.day, ...d.totals })),
  };
});

// generic CRUD
for (const res of Object.keys(RES)) {
  const table = RES[res].table;
  route('GET', `/api/${res}`, ({ user }) => db.prepare(`SELECT * FROM ${table} WHERE user_id = ?`).all(user.id).map((r) => fromRow(res, r)));
  route('POST', `/api/${res}`, ({ user, body }) => {
    if (res === 'logs') return saveLog(user, body);
    const cols = toCols(res, body, { create: true });
    checkRefs(user.id, res, cols);
    const names = Object.keys(cols);
    const id = Number(db.prepare(`INSERT INTO ${table} (user_id, ${names.join(', ')}) VALUES (?, ${names.map(() => '?').join(', ')})`).run(user.id, ...names.map((n) => cols[n])).lastInsertRowid);
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
    if (res === 'tasks') return withReward(user.id, null, row);
    return fromRow(res, row);
  });
  route('PATCH', `/api/${res}/:id`, ({ user, body, params }) => {
    const id = Number(params.id);
    const before = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND user_id = ?`).get(id, user.id);
    if (!before) throw new HttpError(404, 'Not found');
    const cols = toCols(res, body, { create: false });
    checkRefs(user.id, res, cols);
    const names = Object.keys(cols);
    if (names.length) db.prepare(`UPDATE ${table} SET ${names.map((n) => `${n} = ?`).join(', ')} WHERE id = ? AND user_id = ?`).run(...names.map((n) => cols[n]), id, user.id);
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
    return res === 'tasks' ? withReward(user.id, before, row) : fromRow(res, row);
  });
  route('DELETE', `/api/${res}/:id`, ({ user, params }) => {
    const r = db.prepare(`DELETE FROM ${table} WHERE id = ? AND user_id = ?`).run(Number(params.id), user.id);
    if (!r.changes) throw new HttpError(404, 'Not found');
    return { ok: true };
  });
}

// Finishing a task that carries a reward (e.g. a sponsored deal) pays into that day's log.
function withReward(uid, before, row) {
  const out = fromRow('tasks', row);
  if ((!before || before.status !== 'done') && row.status === 'done' && row.reward > 0 && row.done_on) {
    const prev = db.prepare('SELECT money FROM logs WHERE project_id = ? AND day = ?').get(row.project_id, row.done_on);
    const log = upsertLog(uid, row.project_id, row.done_on, { money: (prev?.money || 0) + row.reward });
    return { ...out, log: fromRow('logs', log) };
  }
  return out;
}

function saveLog(user, body) {
  const cols = toCols('logs', body, { create: false });
  if (cols.project_id === undefined || cols.day === undefined) throw new HttpError(400, 'projectId and day are required');
  checkRefs(user.id, 'logs', cols);
  const { project_id, day, ...patch } = cols;
  return fromRow('logs', upsertLog(user.id, project_id, day, patch));
}

// Spread a monthly total over the days of that month ("the channel made 240,000 in September").
route('POST', '/api/logs/spread', ({ user, body }) => {
  const month = String(body.month || '');
  if (!/^\d{4}-\d{2}$/.test(month)) throw new HttpError(400, 'month must be YYYY-MM');
  const projectId = Number(body.projectId);
  if (!ownedProjectIds(db, user.id).has(projectId)) throw new HttpError(400, 'Unknown project');
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const t = today(body.today);
  const lastDay = t.startsWith(month) ? Number(t.slice(8)) : daysInMonth; // only spread up to today for the current month
  const patch = {};
  for (const k of ['money', 'attention', 'customers']) {
    if (typeof body[k] === 'number' && Number.isFinite(body[k]) && body[k] >= 0) patch[k] = Math.round((body[k] / lastDay) * 100) / 100;
  }
  if (!Object.keys(patch).length) throw new HttpError(400, 'Give at least one of money, attention, customers');
  const out = tx(db, () => {
    const rows = [];
    for (let d = 1; d <= lastDay; d++) rows.push(fromRow('logs', upsertLog(user.id, projectId, `${month}-${String(d).padStart(2, '0')}`, patch)));
    return rows;
  });
  return { logs: out };
});

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
      return serveStatic(req, res, decodeURIComponent(url.pathname));
    }
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.re.exec(url.pathname);
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const ctx = { req, params, query: url.searchParams, user: null, body: {} };
      if (r.auth) ctx.user = requireUser(req);
      if (req.method !== 'GET' && req.method !== 'DELETE') ctx.body = await readBody(req);
      else if (req.method === 'DELETE') ctx.body = await readBody(req, 10_000).catch(() => ({}));
      return sendJson(res, 200, await r.handler(ctx));
    }
    throw new HttpError(404, 'No such endpoint');
  } catch (e) {
    if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message });
    if (String(e?.message || '').includes('UNIQUE')) return sendJson(res, 409, { error: 'Already exists' });
    console.error(e);
    return sendJson(res, 500, { error: 'Server error' });
  }
});

server.listen(PORT, () => console.log(`FlowMap running on http://localhost:${PORT}  (data: ${DATA_DIR})`));

process.on('SIGTERM', () => server.close(() => { db.close(); process.exit(0); }));
