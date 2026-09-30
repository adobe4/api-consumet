import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateBoard, sanitizeBoard } from '../shared/board.js';

const PORT = 19000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowmap-boards-'));
let proc, A, B;

const call = async (method, url, body, token) => {
  const r = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};

before(async () => {
  proc = spawn('node', ['--disable-warning=ExperimentalWarning', 'server/index.js'], { env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, TURSO_DATABASE_URL: '' }, stdio: 'pipe' });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(BASE + '/api/health')).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  A = (await call('POST', '/api/auth/register', { email: 'owner@example.com', password: 'supersecret1', template: 'blank' })).body.token;
  B = (await call('POST', '/api/auth/register', { email: 'other@example.com', password: 'supersecret2', template: 'blank' })).body.token;
});
after(() => { proc.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

test('generator lays out slides, workflows and mind maps', () => {
  const s = generateBoard({ layout: 'slides', slides: [{ title: 'Hook', points: ['Why: people lose money', 'What: a plan'], emoji: '🔥', note: 'say hi' }, { title: 'Steps', points: ['a', 'b', 'c', 'd'] }] });
  assert.equal(s.order.length, 2);
  assert.equal(s.items.filter((i) => i.type === 'frame').length, 2);
  assert.ok(s.items.some((i) => i.type === 'sticker'));
  assert.equal(s.links.length, 1);
  const w = generateBoard({ layout: 'workflow', nodes: [{ id: 'a', title: 'Idea' }, { id: 'b', title: 'Script' }, { id: 'c', title: 'Post' }], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' }] });
  const xs = ['Idea', 'Script', 'Post'].map((t) => w.items.find((i) => i.title === t).x);
  assert.ok(xs[0] < xs[1] && xs[1] < xs[2], 'left to right even with a loop');
  const m = generateBoard({ layout: 'mindmap', center: 'Brand', branches: [{ title: 'YouTube', children: ['a', 'b'] }] });
  assert.equal(m.items.length, 4);
  // generated boards pass validation unchanged
  assert.equal(sanitizeBoard({ ...s, v: 1 }).items.length, s.items.length);
});

test('validation drops junk and refuses oversized boards', () => {
  const b = sanitizeBoard({ items: [{ id: 'ok1', type: 'note', x: 5, y: 'bad' }, { id: 'bad id!', type: 'note' }, { id: 'x', type: 'virus' }], links: [{ id: 'l1', from: { item: 'ok1' }, to: { x: 1, y: 2 }, style: { kind: 'laser', end: 'dot' } }] });
  assert.equal(b.items.length, 1);
  assert.equal(b.items[0].y, 0);
  assert.equal(b.links[0].style.kind, 'line');
  assert.equal(b.links[0].style.end, 'dot');
  assert.throws(() => sanitizeBoard({ items: [{ id: 'big', type: 'note', text: 'x', data: { blob: 'y'.repeat(300000) } }] }));
});

test('boards: create, save with versions, list, isolate, duplicate, delete', async () => {
  const c = await call('POST', '/api/boards', { name: 'Course plan', icon: '🎓', spec: { layout: 'kanban', columns: [{ title: 'To do', cards: ['Record intro'] }] } }, A);
  assert.equal(c.status, 200);
  assert.ok(c.body.data.items.length >= 2);
  const id = c.body.id;
  const s1 = await call('PUT', `/api/boards/${id}`, { data: { ...c.body.data, items: [...c.body.data.items, { id: 'n1', type: 'prompt', x: 0, y: 0, w: 300, h: 200, text: 'Write a hook for...' }] }, version: c.body.version }, A);
  assert.equal(s1.status, 200);
  assert.equal(s1.body.version, c.body.version + 1);
  // saving from a stale copy is refused and hands back the latest version
  const stale = await call('PUT', `/api/boards/${id}`, { data: c.body.data, version: c.body.version }, A);
  assert.equal(stale.status, 409);
  assert.equal(stale.body.latest.version, s1.body.version);
  assert.equal((await call('GET', `/api/boards/${id}`, null, B)).status, 404);
  const list = (await call('GET', '/api/boards', null, A)).body;
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'Course plan');
  const f = await call('POST', `/api/boards/${id}/files`, { name: 'notes.txt', mime: 'text/plain', data: Buffer.from('hello').toString('base64') }, A);
  assert.equal(f.status, 200);
  assert.equal((await call('POST', `/api/boards/${id}/files`, { name: 'x.exe', mime: 'application/x-msdownload', data: 'AAAA' }, A)).status, 400);
  assert.equal(Buffer.from((await call('GET', `/api/board-files/${f.body.id}`, null, A)).body.data, 'base64').toString(), 'hello');
  assert.equal((await call('GET', `/api/board-files/${f.body.id}`, null, B)).status, 404);
  const d = await call('POST', `/api/boards/${id}/duplicate`, null, A);
  assert.equal(d.status, 200);
  assert.equal(d.body.data.items.length, s1.body.items);
  assert.equal((await call('DELETE', `/api/boards/${d.body.id}`, null, A)).status, 200);
  assert.equal((await call('GET', '/api/boards', null, A)).body.length, 1);
});

test('agents build boards over MCP', async () => {
  const key = (await call('POST', '/api/agent-keys', { name: 'bot' }, A)).body.key;
  const mcp = async (name, args) => (await fetch(`${BASE}/api/mcp/${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) })).json();
  const tools = await (await fetch(`${BASE}/api/mcp/${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })).json();
  assert.ok(tools.result.tools.some((t) => t.name === 'create_board'));
  const made = JSON.parse((await mcp('create_board', { name: 'How to grow on TikTok', icon: '🎬', spec: { layout: 'slides', slides: [{ title: 'Intro', points: ['One', 'Two'] }] } })).result.content[0].text);
  assert.equal(made.created.slides, 1);
  const more = JSON.parse((await mcp('add_to_board', { board: 'grow on tiktok', items: [{ type: 'sticker', emoji: '🚀', ref: 'r' }, { type: 'card', title: 'Next', ref: 'n' }], connections: [{ from: 'r', to: 'n', kind: 'tunnel', flow: true }] })).result.content[0].text);
  assert.equal(more.added, 2);
  const got = JSON.parse((await mcp('get_board', { board: made.created.id })).result.content[0].text);
  assert.ok(got.connections.length >= 1);
  assert.ok(got.items.some((i) => i.type === 'sticker'));
});

test('sharing: public, password, seat limits, revoking and resetting', async () => {
  const id = (await call('GET', '/api/boards', null, A)).body.find((b) => b.name === 'Course plan').id;
  assert.equal((await call('PUT', `/api/boards/${id}/share`, { mode: 'password' }, A)).status, 400, 'password mode needs a password');
  const sh = (await call('PUT', `/api/boards/${id}/share`, { mode: 'password', password: 'open-sesame', seats: 2 }, A)).body;
  assert.ok(sh.token);
  assert.equal((await call('PUT', `/api/boards/${id}/share`, { mode: 'public' }, B)).status, 404);
  const meta = (await call('GET', `/api/share/${sh.token}`)).body;
  assert.equal(meta.needsPassword, true);
  assert.equal(meta.name, 'Course plan');
  assert.equal((await call('POST', `/api/share/${sh.token}/open`, { password: 'wrong' })).status, 403);
  const v1 = (await call('POST', `/api/share/${sh.token}/open`, { password: 'open-sesame', label: 'Student 1' })).body;
  assert.ok(v1.viewer);
  assert.ok(v1.board.data.items.length);
  // the same browser comes back without the password and without taking another place
  assert.equal((await call('POST', `/api/share/${sh.token}/open`, { viewer: v1.viewer })).status, 200);
  const v2 = await call('POST', `/api/share/${sh.token}/open`, { password: 'open-sesame' });
  assert.equal(v2.status, 200);
  const v3 = await call('POST', `/api/share/${sh.token}/open`, { password: 'open-sesame' });
  assert.equal(v3.status, 403, 'third person refused when limited to two');
  assert.equal((await call('GET', `/api/share/${sh.token}`)).body.full, true);
  // files come through the link only for admitted viewers
  const fid = (await call('POST', `/api/boards/${id}/files`, { name: 'a.txt', mime: 'text/plain', data: 'aGk=' }, A)).body.id;
  assert.equal((await call('GET', `/api/share/${sh.token}/files/${fid}?viewer=${v1.viewer}`)).status, 200);
  assert.equal((await call('GET', `/api/share/${sh.token}/files/${fid}?viewer=nope`)).status, 403);
  // freeing a place lets a new person in
  const info = (await call('GET', `/api/boards/${id}/share`, null, A)).body;
  assert.equal(info.viewers.length, 2);
  assert.equal(info.viewers[0].label, 'Student 1');
  await call('DELETE', `/api/boards/${id}/share/viewers/${info.viewers[1].id}`, null, A);
  assert.equal((await call('POST', `/api/share/${sh.token}/open`, { password: 'open-sesame' })).status, 200);
  // a new link kills the old one
  const reset = (await call('POST', `/api/boards/${id}/share/reset`, null, A)).body;
  assert.notEqual(reset.token, sh.token);
  assert.equal((await call('GET', `/api/share/${sh.token}`)).status, 404);
  await call('PUT', `/api/boards/${id}/share`, { mode: 'off' }, A);
  assert.equal((await call('GET', `/api/share/${reset.token}`)).status, 404);
});

test('connection styles are saved on project pipes', async () => {
  const p1 = (await call('POST', '/api/projects', { name: 'One', createdOn: '2026-09-01' }, A)).body;
  const p2 = (await call('POST', '/api/projects', { name: 'Two', createdOn: '2026-09-01' }, A)).body;
  const l = (await call('POST', '/api/links', { from: p1.id, to: p2.id, resource: 'attention', look: { kind: 'line', end: 'arrow', dash: 'dashed' } }, A)).body;
  assert.deepEqual(l.look, { kind: 'line', end: 'arrow', dash: 'dashed' });
  const w = (await call('GET', '/api/world', null, A)).body;
  assert.equal(w.links.find((x) => x.id === l.id).look.dash, 'dashed');
});
