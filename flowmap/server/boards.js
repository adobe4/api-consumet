// Boards: stored per user as one JSON document each (items, connections, slide order), plus uploaded files
// (images, text attachments) in their own table so a board stays small. Videos never leave the device.
import crypto from 'node:crypto';
import { HttpError } from './models.js';
import { hashPassword, verifyPassword } from './auth.js';
import { sanitizeBoard, generateBoard, BoardError, emptyBoard, bounds, makeItem, makeLink, newId, ITEM_TYPES, SHAPES, LINK_KINDS, LINK_PATHS, LINK_DASH, LINK_ENDS } from '../shared/board.js';

const MAX_BOARDS = 200;
const MAX_FILE = 1_600_000; // decoded bytes
const FILE_MIMES = /^(image\/(png|jpe?g|gif|webp|svg\+xml)|text\/[a-z.+-]+|application\/(json|pdf|x-subrip|markdown))$/;

const parse = (s) => { try { return JSON.parse(s); } catch { return emptyBoard(); } };
const summary = (r) => {
  const d = parse(r.data);
  return { id: r.id, name: r.name, icon: r.icon, version: r.version, createdAt: r.created_at, updatedAt: r.updated_at, items: (d.items || []).length, slides: (d.order || []).length };
};
export const boardOut = (r) => ({ ...summary(r), data: parse(r.data) });

const clean = (data) => { try { return sanitizeBoard(data); } catch (e) { if (e instanceof BoardError) throw new HttpError(400, e.message); throw e; } };
const nameOf = (v, d = 'Untitled board') => String(v ?? '').trim().slice(0, 80) || d;

export async function listBoards(q, uid) {
  return (await q.all('SELECT * FROM boards WHERE user_id = ? ORDER BY updated_at DESC, id DESC', uid)).map(summary);
}
export async function getBoard(q, uid, id) {
  const r = await q.get('SELECT * FROM boards WHERE id = ? AND user_id = ?', Number(id), uid);
  if (!r) throw new HttpError(404, 'No such board');
  return r;
}
export async function createBoard(q, uid, { name, icon = '', data } = {}) {
  if ((await q.get('SELECT COUNT(*) AS n FROM boards WHERE user_id = ?', uid)).n >= MAX_BOARDS) throw new HttpError(400, `You can keep up to ${MAX_BOARDS} boards`);
  const d = clean(data || emptyBoard());
  const now = new Date().toISOString();
  const id = (await q.run('INSERT INTO boards (user_id, name, icon, data, version, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)', uid, nameOf(name), String(icon || '').slice(0, 8), JSON.stringify(d), now, now)).lastInsertRowid;
  return boardOut(await getBoard(q, uid, id));
}
// Boards that come with a starter template: each is built from one or more layout specs placed side by side.
// A board the owner already has (same name) is left alone, so loading the template again adds no copies.
export async function seedBoards(q, uid, boards = []) {
  const have = new Set((await q.all('SELECT name FROM boards WHERE user_id = ?', uid)).map((r) => r.name));
  for (const b of boards) {
    if (have.has(b.name)) continue;
    const d = { v: 1, items: [], links: [], order: [], settings: {} };
    for (const spec of b.specs) {
      const bb = bounds(d.items);
      const g = generateBoard(spec, bb ? { origin: { x: bb.x1 + 300, y: bb.y0 } } : undefined);
      d.items.push(...g.items); d.links.push(...g.links); d.order.push(...g.order);
    }
    await createBoard(q, uid, { name: b.name, icon: b.icon, data: d });
  }
}
// version: the version the client last saw. A different one means someone else saved in between.
export async function saveBoard(q, uid, id, { name, icon, data, version } = {}) {
  const r = await getBoard(q, uid, id);
  if (version !== undefined && version !== null && Number(version) !== r.version && data !== undefined) {
    throw Object.assign(new HttpError(409, 'This board changed somewhere else. Your view was refreshed.'), { latest: boardOut(r) });
  }
  const d = data === undefined ? r.data : JSON.stringify(clean(data));
  const now = new Date().toISOString();
  await q.run('UPDATE boards SET name = ?, icon = ?, data = ?, version = version + 1, updated_at = ? WHERE id = ? AND user_id = ?',
    name === undefined ? r.name : nameOf(name), icon === undefined ? r.icon : String(icon || '').slice(0, 8), d, now, r.id, uid);
  return summary(await getBoard(q, uid, id));
}
export async function deleteBoard(q, uid, id) {
  const r = await getBoard(q, uid, id);
  await q.run('DELETE FROM board_files WHERE board_id = ? AND user_id = ?', r.id, uid);
  await q.run('DELETE FROM board_viewers WHERE board_id = ? AND user_id = ?', r.id, uid);
  await q.run('DELETE FROM boards WHERE id = ? AND user_id = ?', r.id, uid);
  return { ok: true };
}
export async function duplicateBoard(q, uid, id) {
  const r = await getBoard(q, uid, id);
  const copy = await createBoard(q, uid, { name: `${r.name} (copy)`, icon: r.icon, data: parse(r.data) });
  // files are shared by id, so the copy keeps pointing at the same uploads; give it its own copies
  const files = await q.all('SELECT * FROM board_files WHERE board_id = ? AND user_id = ?', r.id, uid);
  if (files.length) {
    const map = new Map();
    for (const f of files) {
      const nid = (await q.run('INSERT INTO board_files (user_id, board_id, name, mime, size, data) VALUES (?, ?, ?, ?, ?, ?)', uid, copy.id, f.name, f.mime, f.size, f.data)).lastInsertRowid;
      map.set(f.id, nid);
    }
    let text = JSON.stringify(copy.data);
    text = text.replace(/"fileId":(\d+)/g, (m, n) => (map.has(Number(n)) ? `"fileId":${map.get(Number(n))}` : m));
    await q.run('UPDATE boards SET data = ? WHERE id = ?', text, copy.id);
  }
  return boardOut(await getBoard(q, uid, copy.id));
}

export async function addFile(q, uid, { boardId, name, mime, data }) {
  const b = await getBoard(q, uid, boardId);
  mime = String(mime || '').toLowerCase();
  if (!FILE_MIMES.test(mime)) throw new HttpError(400, 'That kind of file cannot be attached. Images and text files work; videos stay on your device.');
  const b64 = String(data || '').replace(/^data:[^,]*,/, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) throw new HttpError(400, 'File data must be base64');
  const size = Math.floor((b64.length * 3) / 4);
  if (size > MAX_FILE) throw new HttpError(413, 'That file is larger than 1.5 MB. Use a smaller image, or a link.');
  const id = (await q.run('INSERT INTO board_files (user_id, board_id, name, mime, size, data) VALUES (?, ?, ?, ?, ?, ?)', uid, b.id, String(name || 'file').slice(0, 120), mime, size, b64)).lastInsertRowid;
  return { id, name: String(name || 'file').slice(0, 120), mime, size };
}
export async function getFile(q, uid, id) {
  const f = await q.get('SELECT id, name, mime, size, data FROM board_files WHERE id = ? AND user_id = ?', Number(id), uid);
  if (!f) throw new HttpError(404, 'No such file');
  return f;
}

// ---------- tools for AI agents (MCP) and the built-in AI ----------
const BOARD_ARG = { type: 'string', description: 'Board id or name' };
async function findBoard(q, uid, ref) {
  const rows = await q.all('SELECT * FROM boards WHERE user_id = ?', uid);
  const n = Number(ref);
  const s = String(ref ?? '').trim().toLowerCase();
  const r = (Number.isInteger(n) && rows.find((x) => x.id === n)) || rows.find((x) => x.name.toLowerCase() === s) || rows.find((x) => s && x.name.toLowerCase().includes(s));
  if (!r) throw new HttpError(400, `No board matches "${ref}". Boards: ${rows.map((x) => `${x.id} ${x.name}`).join(', ') || 'none yet'}`);
  return r;
}
const SPEC_SCHEMA = {
  type: 'object',
  description: 'What to draw. Pick one layout and fill its fields.',
  properties: {
    layout: { type: 'string', enum: ['slides', 'workflow', 'mindmap', 'kanban', 'timeline', 'notes'], description: 'slides = a presentation (one 16:9 frame per slide, great for tutorial or strategy videos); workflow = boxes and arrows left to right; mindmap = centre with branches; kanban = columns of sticky notes; timeline = milestones on a line; notes = a wall of sticky notes' },
    title: { type: 'string' },
    slides: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, subtitle: { type: 'string' }, points: { type: 'array', items: { type: 'string' }, description: 'Up to 6. "Heading: detail" shows the heading bold.' }, note: { type: 'string', description: 'Speaker notes, shown only to the presenter' }, emoji: { type: 'string', description: 'A sticker for the slide. Prefer a line icon: i:flame, i:target, i:lightbulb, i:zap, i:rocket, i:trophy, i:star, i:circle-check, i:trending-up, i:banknote, i:megaphone, i:heart, i:clock, i:flag, i:gift, i:crown, i:sparkles' }, color: { type: 'string' } } } },
    nodes: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, text: { type: 'string' }, color: { type: 'string' }, group: { type: 'string' }, kind: { type: 'string', enum: ['card', 'note', 'shape'] } } } },
    edges: { type: 'array', items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string' }, flow: { type: 'boolean' } } } },
    center: { type: 'string' },
    branches: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, text: { type: 'string' }, color: { type: 'string' }, children: { type: 'array', items: { type: 'string' } } } } },
    columns: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, color: { type: 'string' }, cards: { type: 'array', items: { type: 'string' } } } } },
    milestones: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, date: { type: 'string' }, text: { type: 'string' }, color: { type: 'string' } } } },
    notes: { type: 'array', items: { type: 'string' } },
  },
};
const ITEM_SCHEMA = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ITEM_TYPES }, x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' },
    title: { type: 'string' }, text: { type: 'string' }, color: { type: 'string', description: 'Hex colour' },
    shape: { type: 'string', enum: SHAPES, description: 'For type=shape' }, emoji: { type: 'string', description: 'For type=sticker. Prefer a line icon: i:arrow-right, i:arrow-left, i:arrow-up, i:arrow-down, i:check, i:x, i:star, i:flame, i:rocket, i:lightbulb, i:target, i:zap, i:trophy, i:heart, i:thumbs-up, i:circle-alert, i:sparkles, i:banknote, i:clock, i:pin, i:flag, i:megaphone (an emoji also works)' },
    url: { type: 'string', description: 'For type=image or type=link' }, back: { type: 'string', description: 'For type=flip: text on the back, one line per row' },
    items: { type: 'array', items: { type: 'string' }, description: 'For type=checklist' },
    cover: { type: 'string', enum: ['blur', 'frost', 'solid', 'curtain'], description: 'For type=hide: a cover laid over other items (put it after them) that the viewer taps to reveal what is underneath. Good for quiz answers, prices, the next step.' },
    ref: { type: 'string', description: 'Your own name for this item so connections can point at it' },
  },
};
function itemFromSpec(a, origin) {
  const o = a && typeof a === 'object' ? a : {};
  const type = ITEM_TYPES.includes(o.type) && o.type !== 'ink' ? o.type : 'card';
  const it = makeItem(type, { x: origin.x + (Number(o.x) || 0), y: origin.y + (Number(o.y) || 0), title: String(o.title || '').slice(0, 300), text: String(o.text || '').slice(0, 5000), color: typeof o.color === 'string' ? o.color.slice(0, 20) : '' });
  if (Number(o.w) > 0) it.w = Number(o.w);
  if (Number(o.h) > 0) it.h = Number(o.h);
  if (type === 'shape') it.data.shape = SHAPES.includes(o.shape) ? o.shape : 'round';
  if (type === 'sticker') it.text = String(o.emoji || o.text || 'i:star').slice(0, 40);
  if (type === 'image' || type === 'link') it.data.url = String(o.url || '').slice(0, 2000);
  if (type === 'flip') it.data.back = String(o.back || '').slice(0, 4000);
  if (type === 'checklist') it.data.items = (Array.isArray(o.items) ? o.items : []).slice(0, 40).map((t) => ({ t: String(t).slice(0, 200), done: false }));
  if (type === 'frame') it.style.shadow = 'raised';
  if (type === 'hide') { it.data = { cover: ['blur', 'frost', 'solid', 'curtain'].includes(o.cover) ? o.cover : 'blur', tap: 'reveal' }; if (!it.title) it.title = 'Tap to reveal'; it.z = 1000; }
  it.anim = { in: 'pop' };
  return it;
}

export const BOARD_TOOLS = [
  { name: 'list_boards', description: 'List the owner\'s boards (free canvases for plans, workflows, courses and presentations).',
    input_schema: { type: 'object', properties: {} },
    run: async ({ db, uid }) => ({ boards: await listBoards(db, uid) }) },
  { name: 'get_board', description: 'Read a board: its items (with ids, positions, text) and connections, and the slide order.',
    input_schema: { type: 'object', properties: { board: BOARD_ARG }, required: ['board'] },
    run: async ({ db, uid }, a) => {
      const r = await findBoard(db, uid, a.board), d = parse(r.data);
      return { id: r.id, name: r.name, slides: d.order, items: d.items.filter((i) => i.type !== 'ink').map((i) => ({ id: i.id, type: i.type, x: Math.round(i.x), y: Math.round(i.y), w: Math.round(i.w), h: Math.round(i.h), title: i.title || undefined, text: i.text ? i.text.slice(0, 400) : undefined })), connections: d.links.map((l) => ({ id: l.id, from: l.from.item, to: l.to.item, label: l.label || undefined })) };
    } },
  { name: 'create_board', description: 'Create a new board, laid out automatically from a plain description: a slide deck for a tutorial or strategy video, a workflow, a mind map, a kanban, a timeline or a wall of notes. The owner can present slides full screen and screen-record them.',
    input_schema: { type: 'object', properties: { name: { type: 'string' }, icon: { type: 'string', description: 'One emoji' }, spec: SPEC_SCHEMA }, required: ['name', 'spec'] },
    run: async ({ db, uid }, a) => {
      const g = generateBoard(a.spec);
      const b = await createBoard(db, uid, { name: a.name, icon: a.icon || '', data: { v: 1, items: g.items, links: g.links, order: g.order, settings: {} } });
      return { created: { id: b.id, name: b.name, items: b.items, slides: b.slides } };
    } },
  { name: 'add_to_board', description: 'Add more to an existing board: either a laid-out block (spec, same as create_board) placed beside what is there, or individual items and connections between them.',
    input_schema: { type: 'object', properties: { board: BOARD_ARG, spec: SPEC_SCHEMA, items: { type: 'array', items: ITEM_SCHEMA }, connections: { type: 'array', items: { type: 'object', properties: { from: { type: 'string', description: 'Item id or ref' }, to: { type: 'string' }, label: { type: 'string' }, kind: { type: 'string', enum: LINK_KINDS }, path: { type: 'string', enum: LINK_PATHS }, dash: { type: 'string', enum: LINK_DASH }, end: { type: 'string', enum: LINK_ENDS }, flow: { type: 'boolean' } } } } }, required: ['board'] },
    run: async ({ db, uid }, a) => {
      const r = await findBoard(db, uid, a.board), d = parse(r.data);
      const b = bounds(d.items);
      const origin = { x: b ? b.x1 + 300 : 0, y: b ? b.y0 : 0 };
      const refs = new Map(d.items.map((i) => [i.id, i]));
      let added = 0;
      if (a.spec) {
        const g = generateBoard(a.spec, { origin });
        d.items.push(...g.items); d.links.push(...g.links); d.order.push(...g.order); added += g.items.length;
      }
      for (const spec of Array.isArray(a.items) ? a.items.slice(0, 200) : []) {
        const it = itemFromSpec(spec, a.spec ? { x: origin.x, y: origin.y + 900 } : origin);
        it.z = d.items.length + 1;
        d.items.push(it); refs.set(it.id, it); if (spec?.ref) refs.set(String(spec.ref), it); added++;
      }
      for (const c of Array.isArray(a.connections) ? a.connections.slice(0, 300) : []) {
        const f = refs.get(String(c?.from)), t = refs.get(String(c?.to));
        if (!f || !t) continue;
        d.links.push(makeLink({ item: f.id }, { item: t.id }, { label: String(c.label || '').slice(0, 200), style: { kind: LINK_KINDS.includes(c.kind) ? c.kind : 'line', path: LINK_PATHS.includes(c.path) ? c.path : 'curved', dash: LINK_DASH.includes(c.dash) ? c.dash : 'solid', start: 'none', end: LINK_ENDS.includes(c.end) ? c.end : 'arrow', width: 3, flow: !!c.flow } }));
      }
      await saveBoard(db, uid, r.id, { data: d });
      return { board: r.id, added };
    } },
  { name: 'edit_board_items', description: 'Change or delete items on a board (move, resize, recolour, rewrite text).',
    input_schema: { type: 'object', properties: { board: BOARD_ARG, changes: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, delete: { type: 'boolean' }, x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' }, title: { type: 'string' }, text: { type: 'string' }, color: { type: 'string' } }, required: ['id'] } } }, required: ['board', 'changes'] },
    run: async ({ db, uid }, a) => {
      const r = await findBoard(db, uid, a.board), d = parse(r.data);
      let n = 0;
      for (const c of Array.isArray(a.changes) ? a.changes : []) {
        const i = d.items.findIndex((x) => x.id === c?.id);
        if (i < 0) continue;
        if (c.delete) { const id = d.items[i].id; d.items.splice(i, 1); d.links = d.links.filter((l) => l.from.item !== id && l.to.item !== id); d.order = d.order.filter((x) => x !== id); n++; continue; }
        for (const k of ['x', 'y', 'w', 'h']) if (typeof c[k] === 'number') d.items[i][k] = c[k];
        for (const k of ['title', 'text', 'color']) if (typeof c[k] === 'string') d.items[i][k] = c[k];
        n++;
      }
      await saveBoard(db, uid, r.id, { data: d });
      return { board: r.id, changed: n };
    } },
];

export { newId };

// ---------- sharing: a link anyone (or a password holder) can open, optionally limited to N people ----------
// Each person is one browser: the first time they open the link they get a private viewer key that takes a
// seat. When all seats are taken, new browsers are refused until the owner frees one or raises the limit.

const token = () => crypto.randomBytes(12).toString('base64url');
const hashKey = (k) => crypto.createHash('sha256').update(String(k)).digest('hex');
const SHARE_MODES = ['off', 'public', 'password'];

async function viewersOf(q, uid, boardId) {
  return (await q.all('SELECT id, label, first_seen, last_seen FROM board_viewers WHERE board_id = ? AND user_id = ? ORDER BY first_seen', boardId, uid))
    .map((v) => ({ id: v.id, label: v.label, firstSeen: v.first_seen, lastSeen: v.last_seen }));
}
export async function shareInfo(q, uid, id) {
  const r = await getBoard(q, uid, id);
  return { mode: r.share_mode || 'off', token: r.share_token || null, seats: r.share_seats || 0, hasPassword: !!r.share_pass, viewers: await viewersOf(q, uid, r.id) };
}
export async function setShare(q, uid, id, { mode, password, seats } = {}) {
  const r = await getBoard(q, uid, id);
  const m = SHARE_MODES.includes(mode) ? mode : r.share_mode || 'off';
  let pass = r.share_pass || '';
  if (typeof password === 'string' && password.length) {
    if (password.length < 4 || password.length > 100) throw new HttpError(400, 'The link password must be 4 to 100 characters');
    pass = hashPassword(password);
  }
  if (m === 'password' && !pass) throw new HttpError(400, 'Set a password for this link');
  const n = seats === undefined ? r.share_seats || 0 : Math.max(0, Math.min(100000, Math.round(Number(seats) || 0)));
  await q.run('UPDATE boards SET share_mode = ?, share_pass = ?, share_seats = ?, share_token = COALESCE(share_token, ?) WHERE id = ? AND user_id = ?', m, pass, n, token(), r.id, uid);
  return shareInfo(q, uid, r.id);
}
export async function resetShare(q, uid, id) {
  const r = await getBoard(q, uid, id);
  await q.run('DELETE FROM board_viewers WHERE board_id = ? AND user_id = ?', r.id, uid);
  await q.run('UPDATE boards SET share_token = ? WHERE id = ? AND user_id = ?', token(), r.id, uid);
  return shareInfo(q, uid, r.id);
}
export async function removeViewer(q, uid, id, viewerId) {
  const r = await getBoard(q, uid, id);
  await q.run('DELETE FROM board_viewers WHERE id = ? AND board_id = ? AND user_id = ?', Number(viewerId), r.id, uid);
  return shareInfo(q, uid, r.id);
}

async function sharedBoard(q, tok) {
  if (typeof tok !== 'string' || !/^[A-Za-z0-9_-]{8,40}$/.test(tok)) throw new HttpError(404, 'This link does not exist');
  const r = await q.get('SELECT * FROM boards WHERE share_token = ?', tok);
  if (!r || !r.share_mode || r.share_mode === 'off') throw new HttpError(404, 'This link is switched off or does not exist');
  return r;
}
export async function shareMeta(q, tok) {
  const r = await sharedBoard(q, tok);
  const used = (await q.get('SELECT COUNT(*) AS n FROM board_viewers WHERE board_id = ?', r.id)).n;
  return { name: r.name, icon: r.icon, needsPassword: r.share_mode === 'password', limited: r.share_seats > 0, full: r.share_seats > 0 && used >= r.share_seats };
}
export async function openShare(q, tok, { password, viewer, label } = {}, { tryPassword } = {}) {
  const r = await sharedBoard(q, tok);
  const known = viewer ? await q.get('SELECT * FROM board_viewers WHERE hash = ? AND board_id = ?', hashKey(viewer), r.id) : null;
  if (r.share_mode === 'password' && !known) {
    if (tryPassword && !tryPassword()) throw new HttpError(429, 'Too many tries. Wait a few minutes.');
    if (!verifyPassword(String(password || ''), r.share_pass)) throw new HttpError(403, 'Wrong password');
  }
  let key = viewer;
  if (known) await q.run("UPDATE board_viewers SET last_seen = datetime('now') WHERE id = ?", known.id);
  else {
    const used = (await q.get('SELECT COUNT(*) AS n FROM board_viewers WHERE board_id = ?', r.id)).n;
    if (r.share_seats > 0 && used >= r.share_seats) throw new HttpError(403, `This link is limited to ${r.share_seats} ${r.share_seats === 1 ? 'person' : 'people'}, and every place is taken. Ask the owner for access.`);
    key = crypto.randomBytes(18).toString('base64url');
    await q.run('INSERT INTO board_viewers (user_id, board_id, hash, label) VALUES (?, ?, ?, ?)', r.user_id, r.id, hashKey(key), String(label || '').slice(0, 60));
  }
  return { viewer: key, board: { id: r.id, name: r.name, icon: r.icon, data: parse(r.data) } };
}
export async function sharedFile(q, tok, viewer, fileId) {
  const r = await sharedBoard(q, tok);
  const v = viewer ? await q.get('SELECT id FROM board_viewers WHERE hash = ? AND board_id = ?', hashKey(viewer), r.id) : null;
  if (!v) throw new HttpError(403, 'Open the link again to see this file');
  const f = await q.get('SELECT id, name, mime, size, data FROM board_files WHERE id = ? AND board_id = ?', Number(fileId), r.id);
  if (!f) throw new HttpError(404, 'No such file');
  return f;
}
