import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { testAi, withFallback, aiChain, aiKeyList } from '../server/brain.js';

// a stand-in for an OpenAI-compatible AI server (like NVIDIA's): key "good" works and calls tools,
// key "notools" works but only chats, anything else is rejected
let mock, mockUrl;
before(async () => {
  mock = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const key = String(req.headers.authorization || '').replace('Bearer ', '');
      const j = JSON.parse(body || '{}');
      res.setHeader('content-type', 'application/json');
      if (key === 'limited') { res.statusCode = 429; return res.end(JSON.stringify({ error: { message: 'Rate limit reached' } })); }
      if (key !== 'good' && key !== 'notools') { res.statusCode = 401; return res.end(JSON.stringify({ error: { message: 'Invalid API key' } })); }
      const msg = key === 'good' && j.tools?.length
        ? { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: j.tools[0].function.name, arguments: '{"ok":true}' } }] }
        : { role: 'assistant', content: 'OK' };
      res.end(JSON.stringify({ choices: [{ message: msg }] }));
    });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  mockUrl = `http://127.0.0.1:${mock.address().port}/v1`;
});
after(() => mock.close());

test('testAi tells a working key, a key whose model cannot use tools, and a bad key apart', async () => {
  const cfg = (apiKey) => ({ provider: 'nvidia', model: 'moonshotai/kimi-k2.6', baseUrl: mockUrl, apiKey });
  const good = await testAi(cfg('good'));
  assert.equal(good.ok, true); assert.equal(good.tools, true);
  const chat = await testAi(cfg('notools'));
  assert.equal(chat.ok, true); assert.equal(chat.tools, false); assert.match(chat.note, /another model/);
  const bad = await testAi(cfg('nope'));
  assert.equal(bad.ok, false); assert.match(bad.note, /rejected/);
  const lim = await testAi(cfg('limited'));
  assert.equal(lim.ok, false); assert.match(lim.note, /limit/);
});

test('when the key in use fails or hits its limit, the next saved key takes over', async () => {
  const secrets = { aiKeys: [
    { id: 'a', label: 'NVIDIA 1', provider: 'nvidia', model: 'm', baseUrl: mockUrl, key: 'limited' },
    { id: 'b', label: 'NVIDIA 2', provider: 'nvidia', model: 'm', baseUrl: mockUrl, key: 'nope' },
    { id: 'c', label: 'NVIDIA 3', provider: 'nvidia', model: 'm', baseUrl: mockUrl, key: 'good' },
  ] };
  // the chosen key goes first
  assert.deepEqual(aiChain({ aiActive: 'b' }, secrets).map((k) => k.id), ['b', 'a', 'c']);
  const used = [];
  const out = await withFallback(aiChain({ aiActive: 'a' }, secrets), async (cfg) => {
    used.push(cfg.id);
    const t = await testAi(cfg);
    if (!t.ok) throw new Error(t.note);
    return { ok: true };
  });
  assert.deepEqual(used, ['a', 'b', 'c']);
  assert.equal(out.usedKey, 'NVIDIA 3');
  // all failing: one clear message naming each key
  await assert.rejects(withFallback(aiChain({}, { aiKeys: secrets.aiKeys.slice(0, 2) }), async (cfg) => { const t = await testAi(cfg); if (!t.ok) throw new Error(t.note); }), /All 2 AI keys failed/);
  // the older single key still counts as a saved key
  assert.equal(aiKeyList({ aiProvider: 'anthropic' }, { aiKey: 'sk-old' })[0].id, 'main');
});

// the API: add several keys at once, keys never come back, change a model, test, remove
const PORT = 19000 + Math.floor(Math.random() * 800);
const BASE = `http://127.0.0.1:${PORT}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowmap-keys-'));
let proc;
const call = async (method, url, body, token) => {
  const r = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
before(async () => {
  proc = spawn('node', ['--disable-warning=ExperimentalWarning', 'server/index.js'], { env: { ...process.env, PORT: String(PORT), DATA_DIR: dir }, stdio: 'pipe' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/api/health')).ok) return; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('server did not start');
});
after(() => { proc.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

test('saved AI keys over the API: bulk add, write-only, edit, test, remove', async () => {
  const t = (await call('POST', '/api/auth/register', { email: 'k@example.com', password: 'supersecret1', name: 'K' })).body.token;
  const keys = ['nvapi-AAAA1111', 'nvapi-BBBB2222', 'nvapi-CCCC3333'];
  const r = await call('POST', '/api/me/ai-keys', { provider: 'nvidia', model: 'moonshotai/kimi-k2.6', label: 'NVIDIA', keys: [...keys, keys[0]] }, t);
  assert.equal(r.status, 200);
  assert.equal(r.body.added.length, 3, 'duplicates are dropped');
  const me = await call('GET', '/api/me', null, t);
  const list = me.body.user.aiKeys;
  assert.deepEqual(list.map((k) => k.tail), ['1111', '2222', '3333']);
  assert.deepEqual(list.map((k) => k.label), ['NVIDIA 1', 'NVIDIA 2', 'NVIDIA 3']);
  assert.ok(!JSON.stringify(me.body).includes('nvapi-'), 'keys are never sent back');
  assert.equal((await call('POST', '/api/me/ai-keys', { provider: 'nvidia', keys: [keys[1]] }, t)).status, 400, 'already saved');
  assert.equal((await call('POST', '/api/me/ai-keys', { provider: 'compatible', baseUrl: 'http://evil.local', keys: ['x1'] }, t)).status, 400, 'https only');
  const ed = await call('PATCH', `/api/me/ai-keys/${list[1].id}`, { model: 'z-ai/glm-5.3' }, t);
  assert.equal(ed.body.user.aiKeys[1].model, 'z-ai/glm-5.3');
  // a real call to NVIDIA with a made-up key: it must come back as a clear failure, never as "works"
  const tr = await call('POST', `/api/me/ai-keys/${list[0].id}/test`, {}, t);
  assert.equal(tr.status, 200);
  assert.equal(tr.body.result.ok, false);
  assert.equal(tr.body.user.aiKeys[0].test.ok, false);
  const del = await call('DELETE', `/api/me/ai-keys/${list[2].id}`, null, t);
  assert.equal(del.body.user.aiKeys.length, 2);
  const models = await call('GET', '/api/ai-models/nvidia');
  assert.ok(models.body.recommended.includes('moonshotai/kimi-k2.6'));
});

test('the board AI reads the open board and restyles it', async () => {
  const { runBoardEdit } = await import('../server/brain.js');
  const { openDb } = await import('../server/db.js');
  const { createBoard, getBoard } = await import('../server/boards.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowmap-edit-'));
  const db = await openDb({ dataDir: dir });
  const uid = (await db.run('INSERT INTO users (email, name, pass, settings) VALUES (?, ?, ?, ?)', 'd@example.com', 'D', 'x', '{}')).lastInsertRowid;
  const b = await createBoard(db, uid, { name: 'Plain', data: { v: 1, items: [{ id: 'n1', type: 'note', x: 0, y: 0, w: 200, h: 120, text: 'Hi' }], links: [], order: [], settings: {} } });
  // a designer model that reads the board as code from the message and answers with the edited code, with some
  // chatter and thinking around it (as many models do); the first answer is broken, so it gets one retry
  const seen = [];
  const designer = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const j = JSON.parse(body);
      seen.push(j);
      const user = j.messages.find((m) => m.role === 'user').content;
      const code = user.slice(user.indexOf('<board'), user.indexOf('</board>') + 8);
      const edited = code
        .replace('<board ', '<board floor="grid" ').replace(/ floor="dots"/, '')
        .replace(/<note id="(i\d+)"([^>]*)>Hi<\/note>/, '<summary>Made the note teal, lined and lifted it.</summary>\n  <note id="$1"$2 color="#2fb4a0" rot="-2" paper="lined" pin="tape" size="26" hand>Hi there</note>\n  <clip id="n1" x="80" y="-10" w="54" h="62" kind="pin"/>');
      const content = seen.length === 1 ? 'Sure! Here is the plan: {"changes": [' : `<think>The owner wants it nicer.</think>Here you go:\n\`\`\`html\n${edited}\n\`\`\``;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
    });
  });
  await new Promise((r) => designer.listen(0, '127.0.0.1', r));
  const ai = { id: 'k', provider: 'nvidia', model: 'm', baseUrl: `http://127.0.0.1:${designer.address().port}/v1`, apiKey: 'good' };
  try {
    const out = await runBoardEdit({ db, uid }, [ai], { id: b.id, name: b.name }, 'Make it look better');
    assert.equal(out.summary, 'Made the note teal, lined and lifted it.');
    assert.equal(seen.length, 2, 'one retry after an unreadable answer');
    assert.ok(!seen[0].tools, 'no tool schemas: works with any chat model');
    assert.match(seen[0].messages.find((m) => m.role === 'user').content, /<note id="i1" x="0" y="0" w="200" h="120"[^>]*>Hi<\/note>/, 'the board arrives as code');
    const d = JSON.parse((await getBoard(db, uid, b.id)).data);
    const note = d.items.find((i) => i.id === 'n1');
    assert.deepEqual([note.text, note.color, note.rot, note.data.paper, note.data.pin, note.style.size, note.style.hand, d.settings.ground], ['Hi there', '#2fb4a0', -2, 'lined', 'tape', 26, true, 'grid']);
    assert.ok(d.items.some((i) => i.type === 'clip' && i.data.kind === 'pin'));
  } finally { designer.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Gemini: errors in Google\'s shape read clearly, models come from the key, the best one is picked', async () => {
  const { listModels, bestModel, AI_PROVIDERS: P } = await import('../server/brain.js');
  assert.equal(P.gemini.baseUrl, 'https://generativelanguage.googleapis.com/v1beta/openai');
  const g = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.headers.authorization !== 'Bearer AIzaGood') { res.statusCode = 400; return res.end(JSON.stringify([{ error: { code: 400, message: 'Please pass a valid API key', status: 'INVALID_ARGUMENT' } }])); }
    if (req.url.endsWith('/models')) return res.end(JSON.stringify({ object: 'list', data: ['models/gemini-2.0-flash', 'models/gemini-3-flash', 'models/gemini-3-pro', 'models/gemini-3-flash-lite', 'models/text-embedding-004', 'models/imagen-4', 'models/gemini-2.5-flash-preview-tts'].map((id) => ({ id, object: 'model' })) }));
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', () => res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: 'c', type: 'function', function: { name: JSON.parse(body).tools[0].function.name, arguments: '{"ok":true}' } }] } }] })));
  });
  await new Promise((r) => g.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${g.address().port}/v1beta/openai`;
  try {
    const bad = await testAi({ provider: 'gemini', model: 'gemini-3-flash', baseUrl: base, apiKey: 'AIzaWrong' });
    assert.equal(bad.ok, false); assert.match(bad.note, /rejected/);
    const m = await listModels({ provider: 'gemini', baseUrl: base, apiKey: 'AIzaGood' });
    assert.deepEqual(m.all, ['gemini-2.0-flash', 'gemini-3-flash', 'gemini-3-flash-lite', 'gemini-3-pro']);
    assert.equal(bestModel(m.all, 'gemini'), 'gemini-3-flash');
    const ok = await testAi({ provider: 'gemini', model: 'gemini-3-flash', baseUrl: base, apiKey: 'AIzaGood' });
    assert.equal(ok.ok, true); assert.equal(ok.tools, true);
  } finally { g.close(); }
});

test('board design: the AI places every item, FlowMap checks it, the AI fixes what the check found', async () => {
  const { runBoardAI } = await import('../server/brain.js');
  const { openDb } = await import('../server/db.js');
  const { getBoard } = await import('../server/boards.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowmap-design-'));
  const db = await openDb({ dataDir: dir });
  const uid = (await db.run('INSERT INTO users (email, name, pass, settings) VALUES (?, ?, ?, ?)', 'e@example.com', 'E', 'x', '{}')).lastInsertRowid;
  const asks = [];
  const designer = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const j = JSON.parse(body);
      asks.push(j.messages.at(-1).content);
      let plan;
      if (asks.length === 1) plan = { name: 'Growth talk', icon: '🚀', floor: 'grid', summary: 'Two slides.', slides: ['s1', 's2'], items: [
        { ref: 's1', type: 'frame', x: 0, y: 0, w: 1100, h: 620, title: 'Hook', color: '#2fb4a0', style: { finish: 'tinted' } },
        { ref: 't1', type: 'text', x: 70, y: 60, w: 300, h: 40, text: 'A very long title that cannot possibly fit in this tiny box at this size', style: { size: 48, bold: true } },
        { ref: 'n1', type: 'note', paper: 'lined', pin: 'tape', x: 600, y: 200, w: 300, h: 240, text: 'Tip' },
        { ref: 'c1', type: 'card', x: 650, y: 260, w: 300, h: 200, title: 'Overlaps the note' },
        { ref: 's2', type: 'frame', x: 1280, y: 0, w: 1100, h: 620, title: 'Steps', color: '#ff8a5c', style: { finish: 'tinted' } },
        { type: 'sticker', emoji: 'i:rocket', x: 2200, y: 60, w: 90, h: 90, jump: 's1' },
      ] };
      else {
        // the fix round: it must have been told about the overlap and the text, with real ids
        const ids = [...asks[1].matchAll(/^\{"id":"([^"]+)","type":"(\w+)"/gm)].map((m) => ({ id: m[1], type: m[2] }));
        const text = ids.find((i) => i.type === 'text').id, card = ids.find((i) => i.type === 'card').id;
        plan = { summary: 'Fixed.', changes: [{ id: text, w: 900, h: 140 }, { id: card, x: 70, y: 260 }] };
      }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(plan) } }] }));
    });
  });
  await new Promise((r) => designer.listen(0, '127.0.0.1', r));
  const ai = { id: 'k', provider: 'nvidia', model: 'm', baseUrl: `http://127.0.0.1:${designer.address().port}/v1`, apiKey: 'good' };
  try {
    const out = await runBoardAI({ db, uid }, [ai], 'Slides for a talk about growth');
    assert.equal(asks.length, 2, 'one design, one fix round');
    assert.match(asks[1], /overlap/); assert.match(asks[1], /text does not fit/);
    assert.match(out.summary, /Checked and tidied/);
    const d = JSON.parse((await getBoard(db, uid, out.board.id)).data);
    assert.equal(d.settings.ground, 'grid');
    assert.equal(d.order.length, 2);
    const t = d.items.find((i) => i.type === 'text'), c = d.items.find((i) => i.type === 'card'), n = d.items.find((i) => i.type === 'note');
    assert.equal(t.w, 900); assert.equal(c.x, 70);
    assert.deepEqual([n.data.paper, n.data.pin], ['lined', 'tape']);
    assert.equal(d.items.find((i) => i.type === 'sticker').data.jump, d.order[0], 'jump refs become real ids');
    assert.ok(d.items.find((i) => i.type === 'frame').z < t.z, 'frames stay underneath');
  } finally { designer.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('design session: plan with questions, sections in local coordinates, fix, polish, pictures', async () => {
  const { designStep } = await import('../server/design.js');
  const { openDb } = await import('../server/db.js');
  const { createBoard, getBoard } = await import('../server/boards.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowmap-session-'));
  const db = await openDb({ dataDir: dir });
  const uid = (await db.run('INSERT INTO users (email, name, pass, settings) VALUES (?, ?, ?, ?)', 's@example.com', 'S', 'x', '{}')).lastInsertRowid;
  const b = await createBoard(db, uid, { name: 'Talk', data: { v: 1, items: [
    { id: 'f1', type: 'frame', x: 2000, y: 1000, w: 1100, h: 620, title: 'Intro', color: '#2fb4a0' },
    { id: 't1', type: 'text', x: 2070, y: 1060, w: 500, h: 60, text: 'Hello' },
  ], links: [], order: ['f1'], settings: {} } });
  const seen = [];
  let refusedImage = false;
  const ai = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const j = JSON.parse(body);
      const sys = j.messages[0].content, last = j.messages.at(-1).content;
      const hasImage = Array.isArray(last) && last.some((p) => p.type === 'image_url');
      seen.push({ sys: sys.slice(0, 60), hasImage });
      res.setHeader('content-type', 'application/json');
      // the first picture is refused, as a text-only model would: FlowMap must retry without it
      if (hasImage && !refusedImage) { refusedImage = true; res.statusCode = 400; return res.end(JSON.stringify({ error: { message: 'image input is not supported by this model' } })); }
      const text = Array.isArray(last) ? last.find((p) => p.type === 'text').text : last;
      let plan;
      if (/Before designing, study/.test(sys)) plan = { understanding: 'A short talk.', summary: 'Redesign the intro, add a steps slide.', questions: [{ id: 'big', q: 'Do you want big text?', type: 'yesno' }], steps: [{ focus: 'f1', title: 'Intro', what: 'Hero layout' }, { focus: 'new', title: 'Steps', what: 'Numbered steps' }] };
      else if (/FlowMap checked this section/.test(text)) plan = { summary: 'Fixed the overlap.', changes: [{ id: [...text.matchAll(/"id":"([^"]+)","type":"card"/g)].at(-1)[1], x: 600 }] };
      else if (/YOUR SECTION/.test(text)) {
        assert.match(text, /LOCAL to this frame/);
        plan = { summary: 'Designed.', frame: { color: '#ff8a5c' }, changes: /"id":"t1"/.test(text) ? [{ id: 't1', x: 70, y: 56, w: 800, h: 90, text: 'Hello, big', style: { size: 52, bold: true } }] : [],
          add: [{ type: 'card', x: 70, y: 240, w: 400, h: 200, title: 'Step one' }, { type: 'card', x: 300, y: 300, w: 400, h: 200, title: 'Overlapping' }] };
      } else plan = { summary: 'Unified title sizes.', floor: 'grid', restyle: [{ types: ['text'], style: { align: 'left' } }] };
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(plan) } }] }));
    });
  });
  await new Promise((r) => ai.listen(0, '127.0.0.1', r));
  const cfg = { id: 'k', provider: 'gemini', model: 'm', baseUrl: `http://127.0.0.1:${ai.address().port}/v1`, apiKey: 'good' };
  const ctx = { db, uid, source: 'ai' };
  const dl = () => Date.now() + 60000;
  const img = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
  try {
    const plan = await designStep(ctx, cfg, b.id, { phase: 'plan', request: 'Redesign this talk', images: [img] }, {}, dl());
    assert.equal(seen[0].hasImage, true); assert.equal(seen[1].hasImage, false, 'retried without the picture');
    assert.equal(plan.questions[0].id, 'direction', 'the style question comes first');
    assert.ok(plan.questions[0].options.some((o) => o.id === 'bold') && plan.questions[0].options.some((o) => o.id === 'auto'));
    assert.equal(plan.questions[1].q, 'Do you want big text?');
    assert.deepEqual(plan.steps.map((s) => s.focus), ['f1', 'new']);
    assert.ok(plan.steps[1].slot.x > 2000, 'new slides go after the existing ones');
    // section on the existing frame: local coordinates come back as board coordinates
    const s1 = await designStep(ctx, cfg, b.id, { phase: 'section', focus: 'f1', step: plan.steps[0], answers: [{ q: 'Do you want big text?', a: 'Yes' }], direction: 'bold', images: [img] }, {}, dl());
    assert.equal(seen.at(-1).hasImage, true, 'a model that can see gets the section picture');
    let d = JSON.parse((await getBoard(db, uid, b.id)).data);
    const t1 = d.items.find((i) => i.id === 't1');
    assert.deepEqual([t1.x, t1.y, t1.style.size], [2070, 1056, 52]);
    assert.equal(d.items.find((i) => i.id === 'f1').color, '#ff8a5c');
    assert.ok(s1.issues.some((x) => /overlap/.test(x)), 'the design check found the overlap');
    const fixed = await designStep(ctx, cfg, b.id, { phase: 'fix', focus: 'f1', issues: s1.issues, step: plan.steps[0] }, {}, dl());
    assert.equal(fixed.issues.filter((x) => /overlap/.test(x)).length, 0);
    // a new slide: its frame is made at the planned slot and added to the slides
    const s2 = await designStep(ctx, cfg, b.id, { phase: 'section', focus: 'new', step: plan.steps[1] }, {}, dl());
    d = JSON.parse((await getBoard(db, uid, b.id)).data);
    const f2 = d.items.find((i) => i.id === s2.focus);
    assert.deepEqual([f2.type, f2.x, f2.y, d.order.length], ['frame', plan.steps[1].slot.x, plan.steps[1].slot.y, 2]);
    assert.ok(d.items.some((i) => i.title === 'Step one' && i.x === f2.x + 70));
    const p = await designStep(ctx, cfg, b.id, { phase: 'polish' }, {}, dl());
    assert.equal(p.summary, 'Unified title sizes.');
    assert.equal(JSON.parse((await getBoard(db, uid, b.id)).data).settings.ground, 'grid');
    // once a style is remembered it is not asked again
    const again = await designStep(ctx, cfg, b.id, { phase: 'plan', request: 'Redesign this talk' }, { designDirection: 'desk' }, dl());
    assert.ok(!again.questions.some((q) => q.id === 'direction')); assert.equal(again.direction, 'desk');
  } finally { ai.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
