// Field definitions, validation and (de)serialisation for every stored resource.
import { KIND_KEYS, RESOURCE_KEYS, TASK_TYPES, CHANNELS } from '../shared/engine.js';
import { normalizeSources } from '../shared/sources.js';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (field, msg) => new HttpError(400, `${field}: ${msg}`);

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

const T = {
  str: (max = 200) => (v, f) => { if (typeof v !== 'string') throw bad(f, 'must be text'); return v.trim().slice(0, max); },
  num: (min = -1e12, max = 1e12) => (v, f) => { if (!finite(v)) throw bad(f, 'must be a number'); return Math.min(max, Math.max(min, v)); },
  nnum: (min = -1e12, max = 1e12) => (v, f) => (v === null ? null : T.num(min, max)(v, f)),
  int: (min = -1e9, max = 1e9) => (v, f) => { if (!finite(v)) throw bad(f, 'must be a number'); return Math.min(max, Math.max(min, Math.round(v))); },
  nint: (min, max) => (v, f) => (v === null ? null : T.int(min, max)(v, f)),
  day: (v, f) => { if (typeof v !== 'string' || !DAY.test(v)) throw bad(f, 'must be YYYY-MM-DD'); return v; },
  nday: (v, f) => (v === null ? null : T.day(v, f)),
  enum: (list) => (v, f) => { if (!list.includes(v)) throw bad(f, `must be one of ${list.join(', ')}`); return v; },
  bool: (v) => (v ? 1 : 0),
  color: (v, f) => { if (typeof v !== 'string' || !/^(#[0-9a-fA-F]{3,8})?$/.test(v)) throw bad(f, 'must be a hex color'); return v; },
  obj: (v, f) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw bad(f, 'must be an object');
    const s = JSON.stringify(v);
    if (s.length > 4000) throw bad(f, 'too large');
    return s;
  },
  ids: (v, f) => {
    if (!Array.isArray(v) || v.length > 50 || !v.every((x) => Number.isInteger(x))) throw bad(f, 'must be a list of ids');
    return JSON.stringify(v);
  },
  sources: (v, f) => {
    if (!Array.isArray(v) || v.length > 10) throw bad(f, 'must be a list of at most 10 links');
    try { return JSON.stringify(normalizeSources(v)); } catch (e) { throw bad(f, e.message); }
  },
};

// api name -> [column, validator, required-on-create, default]
export const RES = {
  projects: {
    table: 'projects',
    fields: {
      name: ['name', T.str(80), true],
      kind: ['kind', T.enum(KIND_KEYS), false, 'custom'],
      icon: ['icon', T.str(8), false, ''],
      color: ['color', T.color, false, ''],
      x: ['x', T.num(-1e5, 1e5), false, 0],
      y: ['y', T.num(-1e5, 1e5), false, 0],
      monthlyCost: ['monthly_cost', T.num(0, 1e10), false, 0],
      cfg: ['cfg', T.obj, false, {}],
      sources: ['sources', T.sources, false, []],
      note: ['note', T.str(600), false, ''],
      createdOn: ['created_on', T.day, true],
      archived: ['archived', T.bool, false, 0],
    },
  },
  links: {
    table: 'links',
    fields: {
      from: ['from_id', T.int(), true],
      to: ['to_id', T.int(), true],
      resource: ['resource', T.enum(RESOURCE_KEYS), true],
      share: ['share', T.num(0, 1), false, 0.1],
      cost: ['cost', T.num(0, 1e10), false, 0],
      delay: ['delay', T.int(0, 90), false, 0],
      note: ['note', T.str(200), false, ''],
      look: ['look', T.obj, false, {}],
    },
  },
  tasks: {
    table: 'tasks',
    fields: {
      projectId: ['project_id', T.int(), true],
      title: ['title', T.str(140), true],
      type: ['type', T.enum(Object.keys(TASK_TYPES)), false, 'other'],
      status: ['status', T.enum(['todo', 'done']), false, 'todo'],
      due: ['due', T.nday, false, null],
      doneOn: ['done_on', T.nday, false, null],
      quality: ['quality', T.nint(1, 5), false, null],
      channel: ['channel', T.enum(Object.keys(CHANNELS)), false, 'in_video'],
      targets: ['targets', T.ids, false, []],
      hours: ['hours', T.num(0, 1000), false, 0],
      cost: ['cost', T.num(0, 1e10), false, 0],
      reward: ['reward', T.num(0, 1e10), false, 0],
      note: ['note', T.str(400), false, ''],
      source: ['source', T.str(60), false, ''],
      sample: ['sample', T.bool, false, 0],
    },
  },
  logs: {
    table: 'logs',
    fields: {
      projectId: ['project_id', T.int(), true],
      day: ['day', T.day, true],
      money: ['money', T.nnum(-1e10, 1e10), false, null],
      attention: ['attention', T.nnum(0, 1e12), false, null],
      customers: ['customers', T.nnum(0, 1e9), false, null],
      posts: ['posts', T.int(0, 1000), false, 0],
      feel: ['feel', T.nint(1, 5), false, null],
      note: ['note', T.str(400), false, ''],
      sample: ['sample', T.bool, false, 0],
    },
  },
};

const JSON_COLS = new Set(['cfg', 'targets', 'sources', 'look']);
const BOOL_COLS = new Set(['archived', 'sample']);

export function fromRow(res, row) {
  const out = { id: row.id };
  for (const [api, [col]] of Object.entries(RES[res].fields)) {
    let v = row[col];
    if (JSON_COLS.has(col)) { try { v = JSON.parse(v ?? ''); } catch { v = col === 'cfg' || col === 'look' ? {} : []; } }
    else if (BOOL_COLS.has(col)) v = !!v;
    out[api] = v;
  }
  return out;
}

// Validate only what the caller sent (partial) or everything (create).
export function toCols(res, body, { create }) {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'JSON body required');
  const cols = {};
  for (const [api, [col, validate, required, dflt]] of Object.entries(RES[res].fields)) {
    if (body[api] === undefined) {
      if (create) {
        if (required) throw bad(api, 'is required');
        cols[col] = JSON_COLS.has(col) ? JSON.stringify(dflt) : dflt;
      }
      continue;
    }
    cols[col] = validate(body[api], api);
  }
  return cols;
}

export async function ownedProjectIds(q, uid) {
  return new Set((await q.all('SELECT id FROM projects WHERE user_id = ?', uid)).map((r) => r.id));
}

export const insertSql = (table, names, verb = 'INSERT') => `${verb} INTO ${table} (user_id, ${names.join(', ')}) VALUES (?, ${names.map(() => '?').join(', ')})`;

// Foreign keys are not reliable over Turso's HTTP connections, so dependants are removed explicitly.
export async function deleteProjects(q, uid, ids) {
  if (!ids.length) return;
  const list = ids.map(() => '?').join(', ');
  await q.run(`DELETE FROM links WHERE user_id = ? AND (from_id IN (${list}) OR to_id IN (${list}))`, uid, ...ids, ...ids);
  for (const t of ['tasks', 'logs', 'scans', 'notes']) await q.run(`DELETE FROM ${t} WHERE user_id = ? AND project_id IN (${list})`, uid, ...ids);
  await q.run(`DELETE FROM projects WHERE user_id = ? AND id IN (${list})`, uid, ...ids);
}
export async function deleteUser(q, uid) {
  for (const t of ['links', 'tasks', 'logs', 'scans', 'notes', 'agent_keys', 'board_viewers', 'board_files', 'boards', 'projects']) await q.run(`DELETE FROM ${t} WHERE user_id = ?`, uid);
  await q.run('DELETE FROM users WHERE id = ?', uid);
}

export const noteOut = (r) => ({ id: r.id, projectId: r.project_id ?? null, at: r.at, source: r.source, kind: r.kind, text: r.text });
export const scanOut = (r) => {
  let data = {};
  try { data = JSON.parse(r.data); } catch { /* keep {} */ }
  return { id: r.id, projectId: r.project_id, url: r.url, platform: r.platform, at: r.at, ok: !!r.ok, data, error: r.error };
};

export async function readWorld(q, uid, { logDays = 400 } = {}) {
  const list = async (res, sql, ...args) => (await q.all(sql, uid, ...args)).map((r) => fromRow(res, r));
  const since = new Date(Date.now() - logDays * 86400000).toISOString().slice(0, 10);
  const noteSince = new Date(Date.now() - 60 * 86400000).toISOString();
  // latest scan per project + link
  const scans = await q.all(`SELECT s.* FROM scans s JOIN (SELECT project_id, url, MAX(id) AS id FROM scans WHERE user_id = ? GROUP BY project_id, url) m ON m.id = s.id`, uid);
  const u = await q.get('SELECT settings FROM users WHERE id = ?', uid);
  let checkin = 'daily';
  try { const st = JSON.parse(u?.settings || '{}'); if (['daily', 'weekly', 'monthly', 'off'].includes(st.checkin)) checkin = st.checkin; } catch { /* keep the default */ }
  return {
    checkin, // how often numbers are logged: overdue check-ins slow the system down
    projects: await list('projects', 'SELECT * FROM projects WHERE user_id = ? ORDER BY id'),
    links: await list('links', 'SELECT * FROM links WHERE user_id = ? ORDER BY id'),
    tasks: await list('tasks', 'SELECT * FROM tasks WHERE user_id = ? ORDER BY id'),
    logs: await list('logs', 'SELECT * FROM logs WHERE user_id = ? AND day >= ? ORDER BY day', since),
    notes: (await q.all('SELECT * FROM notes WHERE user_id = ? AND at >= ? ORDER BY id DESC LIMIT 200', uid, noteSince)).map(noteOut),
    scans: scans.map(scanOut),
  };
}

const LIMITS = { projects: 200, links: 2000, tasks: 6000, logs: 40000 };

// Replace (or add to) a user's world with data whose ids are arbitrary keys.
export async function loadWorld(db, uid, data, { replace }) {
  for (const k of Object.keys(LIMITS)) {
    if (data[k] !== undefined && (!Array.isArray(data[k]) || data[k].length > LIMITS[k])) throw new HttpError(400, `${k}: expected a list of at most ${LIMITS[k]}`);
  }
  // validate everything before touching the database
  const projects = (data.projects || []).map((p) => [p.id, toCols('projects', { ...p, id: undefined }, { create: true })]);
  const known = new Set(projects.map(([k]) => k));
  const check = (k) => { if (!known.has(k)) throw new HttpError(400, `unknown project reference ${JSON.stringify(k)}`); return k; };
  const links = (data.links || []).map((l) => [check(l.from), check(l.to), l]);
  const tasks = (data.tasks || []).map((t) => [check(t.projectId), t]);
  const logs = (data.logs || []).map((l) => [check(l.projectId), l]);

  return db.tx(async (q) => {
    if (replace) await deleteProjects(q, uid, [...(await ownedProjectIds(q, uid))]);
    const map = new Map();
    for (const [key, cols] of projects) {
      const names = Object.keys(cols);
      map.set(key, (await q.run(insertSql('projects', names), uid, ...names.map((n) => cols[n]))).lastInsertRowid);
    }
    const put = (res, cols, verb) => { const names = Object.keys(cols); return q.run(insertSql(RES[res].table, names, verb), uid, ...names.map((n) => cols[n])); };
    for (const [from, to, l] of links) await put('links', toCols('links', { ...l, from: map.get(from), to: map.get(to) }, { create: true }));
    for (const [pid, t] of tasks) {
      const targets = (t.targets || []).filter((x) => map.has(x)).map((x) => map.get(x));
      await put('tasks', toCols('tasks', { ...t, projectId: map.get(pid), targets }, { create: true }));
    }
    for (const [pid, l] of logs) await put('logs', toCols('logs', { ...l, projectId: map.get(pid) }, { create: true }), 'INSERT OR REPLACE');
    return { projects: map.size };
  });
}
