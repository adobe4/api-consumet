import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowmap-'));
let proc;

const call = async (method, url, body, token) => {
  const r = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};

before(async () => {
  proc = spawn('node', ['--disable-warning=ExperimentalWarning', 'server/index.js'], { env: { ...process.env, PORT: String(PORT), DATA_DIR: dir }, stdio: 'pipe' });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(BASE + '/api/health')).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
});
after(() => { proc.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

test('auth: register, login, wrong password, unauthenticated access', async () => {
  const reg = await call('POST', '/api/auth/register', { email: 'A@Example.com', password: 'supersecret1', name: 'Ada', today: '2026-09-29' });
  assert.equal(reg.status, 200);
  assert.ok(reg.body.token);
  assert.equal((await call('POST', '/api/auth/register', { email: 'a@example.com', password: 'supersecret1' })).status, 409);
  assert.equal((await call('POST', '/api/auth/register', { email: 'x@example.com', password: 'short' })).status, 400);
  assert.equal((await call('POST', '/api/auth/login', { email: 'a@example.com', password: 'nope-nope-nope' })).status, 401);
  const login = await call('POST', '/api/auth/login', { email: 'a@example.com', password: 'supersecret1' });
  assert.equal(login.status, 200);
  assert.equal((await call('GET', '/api/world')).status, 401);
  assert.equal((await call('GET', '/api/world', null, 'garbage.token')).status, 401);
  const me = await call('GET', '/api/me', null, login.body.token);
  assert.equal(me.body.user.name, 'Ada');
});

test('new accounts get the preloaded creator template', async () => {
  const { body: { token } } = await call('POST', '/api/auth/login', { email: 'a@example.com', password: 'supersecret1' });
  const w = (await call('GET', '/api/world', null, token)).body;
  assert.equal(w.projects.length, 8);
  assert.ok(w.links.length > 10);
  assert.ok(w.projects.find((p) => p.name === 'Vinei TV'));
  const v = w.projects.find((p) => p.name === 'Vinei TV');
  assert.equal(typeof v.cfg.viewsPerDay, 'number');
  // task targets were remapped to real ids
  const withTargets = w.tasks.find((t) => t.targets.length);
  assert.ok(withTargets.targets.every((id) => w.projects.some((p) => p.id === id)));
});

test('CRUD, validation and per-user isolation', async () => {
  const a = (await call('POST', '/api/auth/login', { email: 'a@example.com', password: 'supersecret1' })).body.token;
  const b = (await call('POST', '/api/auth/register', { email: 'b@example.com', password: 'anothersecret', template: 'blank' })).body.token;
  assert.equal((await call('GET', '/api/world', null, b)).body.projects.length, 0);

  const p = await call('POST', '/api/projects', { name: 'Sponsors', kind: 'custom', createdOn: '2026-09-29', cfg: { baseMoneyPerDay: 1000 } }, a);
  assert.equal(p.status, 200);
  assert.equal((await call('POST', '/api/projects', { name: '', kind: 'nope', createdOn: 'x' }, a)).status, 400);
  const w = (await call('GET', '/api/world', null, a)).body;
  const other = w.projects[0];

  const link = await call('POST', '/api/links', { from: p.body.id, to: other.id, resource: 'money', share: 0.3 }, a);
  assert.equal(link.status, 200);
  assert.equal((await call('POST', '/api/links', { from: p.body.id, to: p.body.id, resource: 'money' }, a)).status, 400);
  assert.equal((await call('POST', '/api/links', { from: p.body.id, to: other.id, resource: 'gold' }, a)).status, 400);

  // user B can neither see nor touch A's rows, nor link to them
  assert.equal((await call('PATCH', `/api/projects/${p.body.id}`, { name: 'hacked' }, b)).status, 404);
  assert.equal((await call('DELETE', `/api/projects/${p.body.id}`, null, b)).status, 404);
  assert.equal((await call('POST', '/api/tasks', { projectId: p.body.id, title: 'x' }, b)).status, 400);

  const patched = await call('PATCH', `/api/projects/${p.body.id}`, { x: 12.5, monthlyCost: 5000 }, a);
  assert.equal(patched.body.x, 12.5);
  assert.equal(patched.body.name, 'Sponsors');

  // deleting a project cascades to its links
  assert.equal((await call('DELETE', `/api/projects/${p.body.id}`, null, a)).status, 200);
  const after = (await call('GET', '/api/world', null, a)).body;
  assert.ok(!after.links.some((l) => l.id === link.body.id));
});

test('tasks with rewards pay into the daily log; logs upsert; month spread', async () => {
  const a = (await call('POST', '/api/auth/login', { email: 'a@example.com', password: 'supersecret1' })).body.token;
  const w = (await call('GET', '/api/world', null, a)).body;
  const vinei = w.projects.find((p) => p.name === 'Vinei TV');
  const t = await call('POST', '/api/tasks', { projectId: vinei.id, title: 'Sponsor', type: 'sponsored', due: '2026-10-01', reward: 250000 }, a);
  const done = await call('PATCH', `/api/tasks/${t.body.id}`, { status: 'done', doneOn: '2026-10-01', quality: 5 }, a);
  assert.equal(done.status, 200);
  assert.equal(done.body.log.money, 250000);

  const l1 = await call('POST', '/api/logs', { projectId: vinei.id, day: '2026-10-02', money: 5000, feel: 4 }, a);
  const l2 = await call('POST', '/api/logs', { projectId: vinei.id, day: '2026-10-02', attention: 1200 }, a);
  assert.equal(l1.body.id, l2.body.id);
  assert.equal(l2.body.money, 5000);
  assert.equal(l2.body.attention, 1200);

  const sp = await call('POST', '/api/logs/spread', { projectId: vinei.id, month: '2026-08', money: 310000, today: '2026-09-29' }, a);
  assert.equal(sp.body.logs.length, 31);
  assert.equal(sp.body.logs[0].money, 10000);

  const cleared = await call('POST', '/api/world/clear-sample', {}, a);
  assert.ok(cleared.body.tasks.every((x) => !x.sample));
});

test('export -> import round trip and server-side report', async () => {
  const a = (await call('POST', '/api/auth/login', { email: 'a@example.com', password: 'supersecret1' })).body.token;
  const b = (await call('POST', '/api/auth/login', { email: 'b@example.com', password: 'anothersecret' })).body.token;
  const exp = (await call('GET', '/api/world/export', null, a)).body;
  const imp = await call('POST', '/api/world/import', { world: exp }, b);
  assert.equal(imp.status, 200);
  assert.equal(imp.body.projects.length, exp.projects.length);
  assert.equal(imp.body.links.length, exp.links.length);
  assert.equal((await call('POST', '/api/world/import', { world: { projects: [{ name: 'x' }] } }, b)).status, 400);

  const rep = await call('GET', '/api/report?today=2026-09-29&horizon=10', null, b);
  assert.equal(rep.status, 200);
  assert.equal(rep.body.forecast.length, 11);
  assert.ok(rep.body.projects.length === exp.projects.length);
});

test('static files, traversal guard and security headers', async () => {
  const r = await fetch(BASE + '/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal((await fetch(BASE + '/shared/engine.js')).status, 200);
  const trav = await fetch(BASE + '/..%2f..%2fserver%2fauth.js');
  assert.notEqual(trav.status, 200);
  assert.equal((await fetch(BASE + '/server/auth.js')).status, 404); // server code is never served
});
