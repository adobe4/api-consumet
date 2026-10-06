import test from 'node:test';
import assert from 'node:assert/strict';
import { toCode, applyCode, parseCode } from '../server/boardcode.js';
import { sanitizeBoard } from '../shared/board.js';

const make = () => sanitizeBoard({ items: [
  { id: 'F', type: 'frame', x: 100, y: 100, w: 1100, h: 620, title: 'Why it works', color: '#2fb4a0', style: { finish: 'tinted', shadow: 'raised' }, text: 'Say this slowly' },
  { id: 'T', type: 'text', x: 170, y: 160, w: 640, h: 130, text: '3 moves that doubled my views', style: { size: 46, weight: 800, align: 'left' }, anim: { in: 'pop' } },
  { id: 'N', type: 'note', x: 800, y: 350, w: 320, h: 280, rot: 2, text: 'Tip: result first', style: { size: 24, hand: true }, data: { paper: 'lined', pin: 'tape' } },
  { id: 'C', type: 'checklist', x: 0, y: 900, w: 280, h: 220, title: 'Today', data: { items: [{ t: 'Script', done: true }, { t: 'Voice', done: false }] } },
  { id: 'H', type: 'habit', x: 400, y: 900, w: 320, h: 190, title: 'Post 1 TikTok', color: '#ff8a5c', data: { every: 'day', start: '2026-10-06', length: 182, onMiss: 'mark', log: { '2026-10-06': 'done' } } },
  { id: 'S', type: 'sticker', x: 1100, y: 120, w: 90, h: 90, text: 'i:rocket', color: '#2fb4a0' },
], links: [{ id: 'L1', from: { item: 'H' }, to: { item: 'C' }, style: { kind: 'drawn' } }], order: ['F'] });
const edit = (board, fn, opts = {}) => { const ctx = toCode(board, opts); return applyCode(board, fn(ctx.code), ctx, opts); };
const item = (r, id) => r.data.items.find((i) => i.id === id);

test('nothing changes when the code comes back the same', () => {
  const b = make();
  const r = edit(b, (c) => c);
  assert.deepEqual(r.stats, { changed: 0, added: 0, deleted: 0, links: 0, skipped: 0 });
  assert.equal(JSON.stringify(r.data.items), JSON.stringify(b.items));
});

test('edits text, styles and data the way an HTML edit would', () => {
  const r = edit(make(), (c) => c
    .replace('size="46" align="left" bold>3 moves that doubled my views', 'size="60" align="center" font="display">Three moves')
    .replace('paper="lined" pin="tape"', 'paper="kraft" pin="pin" enter="rise"')
    .replace('>i:rocket<', '>i:trophy<')
    .replace('<li>Voice</li>', '<li done>Voice</li>')
    .replace('length="182"', 'length="90"'));
  const t = item(r, 'T');
  assert.equal(t.text, 'Three moves');
  assert.equal(t.style.size, 60);
  assert.equal(t.style.align, 'center');
  assert.equal(t.style.family, 'display');
  assert.ok(!(t.style.weight >= 700), 'bold removed when the attribute is gone');
  assert.equal(item(r, 'N').data.paper, 'kraft');
  assert.equal(item(r, 'N').anim.in, 'rise');
  assert.equal(item(r, 'S').text, 'i:trophy');
  assert.deepEqual(item(r, 'C').data.items.map((x) => x.done), [true, true]);
  assert.equal(item(r, 'H').data.length, 90);
  assert.deepEqual(item(r, 'H').data.log, { '2026-10-06': 'done' }, 'ticks are kept');
});

test('moving a frame carries its contents; new items inside use frame coordinates', () => {
  const r = edit(make(), (c) => c.replace('<frame id="i1" x="100" y="100"', '<frame id="i1" x="300" y="500"').replace('</frame>', '    <card id="new1" x="40" y="400" w="300" h="120" title="Proof" finish="tinted">Views went from 2K to 40K</card>\n  </frame>'));
  assert.equal(item(r, 'F').x, 300);
  assert.equal(item(r, 'T').x, 370); assert.equal(item(r, 'T').y, 560);
  const card = r.data.items.find((i) => i.type === 'card');
  assert.equal(card.x, 340); assert.equal(card.y, 900);
  assert.equal(card.title, 'Proof');
  assert.equal(card.text, 'Views went from 2K to 40K');
  assert.equal(r.stats.added, 1);
});

test('leaving something out deletes it, and connections can be added or removed', () => {
  const r = edit(make(), (c) => c.replace(/\s*<note[^\n]*<\/note>/, '').replace('<link from="i5" to="i4" kind="drawn"/>', '<link from="i2" to="i6" label="see"/>'));
  assert.equal(item(r, 'N'), undefined);
  assert.equal(r.stats.deleted, 1);
  assert.equal(r.data.links.length, 1);
  assert.equal(r.data.links[0].from.item, 'T');
  assert.equal(r.data.links[0].label, 'see');
});

test('a cut-off answer never deletes, and a mass delete needs to be asked for', () => {
  const b = make();
  const ctx = toCode(b);
  const cut = ctx.code.slice(0, ctx.code.indexOf('<checklist'));
  const r = applyCode(b, cut.replace('3 moves that doubled my views', 'Cut short'), ctx);
  assert.equal(r.complete, false);
  assert.equal(r.stats.deleted, 0);
  assert.equal(item(r, 'T').text, 'Cut short');
  const empty = '<board floor="dots">\n</board>';
  assert.equal(applyCode(b, empty, ctx, { request: 'make it nicer' }).stats.deleted, 0);
  assert.ok(applyCode(b, empty, ctx, { request: 'delete everything' }).stats.deleted >= 6);
});

test('patch mode changes only what is written', () => {
  const b = make();
  const ctx = toCode(b);
  const r = applyCode(b, '<board>\n<summary>Bigger title</summary>\n<frame id="i1"><text id="i2" size="72"/></frame>\n<delete id="i6"/>\n</board>', ctx, { mode: 'patch' });
  assert.equal(item(r, 'T').style.size, 72);
  assert.equal(item(r, 'T').text, '3 moves that doubled my views');
  assert.equal(item(r, 'T').x, 170);
  assert.equal(item(r, 'S'), undefined);
  assert.ok(item(r, 'N'));
  assert.equal(r.summary, 'Bigger title');
});

test('turning a card into a note keeps its connections; scope shows only the selection', () => {
  const b = make();
  const r = edit(b, (c) => c.replace(/<habit id="i5"[^>]*>Post 1 TikTok<\/habit>/, '<note id="i5" x="400" y="900" w="320" h="190" paper="sticky">Post 1 TikTok</note>'));
  const note = r.data.items.find((i) => i.type === 'note' && i.text === 'Post 1 TikTok');
  assert.ok(note);
  assert.equal(r.data.links[0].from.item, note.id);
  const sc = toCode(b, { scope: ['N'] });
  assert.match(sc.code, /<note id="i3"/);
  assert.doesNotMatch(sc.code, /<habit/);
  assert.match(sc.code, /<frame id="i1"[^>]* context>/);
  const rs = applyCode(b, sc.code.replace(/\s*<note[^\n]*<\/note>/, ''), sc, { scope: ['N'] });
  assert.equal(rs.stats.deleted, 1);
  assert.ok(item(rs, 'F') && item(rs, 'T'), 'things outside the selection stay');
});

test('the parser copes with code fences, bare attributes and chatter', () => {
  const { board, complete } = parseCode('Sure! Here it is:\n```html\n<board floor=grid>\n<card id=x1 x=0 y=0 w=100 h=80 bold>Hi &amp; bye</card>\n</board>\n```\nDone.');
  assert.ok(complete);
  assert.equal(board.attrs.floor, 'grid');
  assert.equal(board.kids[0].attrs.bold, '');
  assert.equal(board.kids[0].text, 'Hi & bye');
});

test('agents can read and edit a board as code over MCP', async () => {
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const { openDb } = await import('../server/db.js');
  const { createBoard, BOARD_TOOLS } = await import('../server/boards.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowmap-code-'));
  const db = await openDb({ dataDir: dir });
  try {
    const uid = (await db.run('INSERT INTO users (email, name, pass, settings) VALUES (?, ?, ?, ?)', 'c@example.com', 'C', 'x', '{}')).lastInsertRowid;
    const b = await createBoard(db, uid, { name: 'Code', data: make() });
    const tool = (n) => BOARD_TOOLS.find((t) => t.name === n);
    const read = await tool('get_board_code').run({ db, uid }, { board: b.id });
    assert.match(read.code, /<frame id="i1"/);
    const out = await tool('edit_board_code').run({ db, uid }, { board: b.id, version: read.version, code: read.code.replace('>Tip: result first<', '>Tip: say the result first<') });
    assert.equal(out.changed, 1);
    await assert.rejects(tool('edit_board_code').run({ db, uid }, { board: b.id, version: read.version, code: read.code }), /changed since you read it/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
