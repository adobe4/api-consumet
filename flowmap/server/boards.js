// Boards: stored per user as one JSON document each (items, connections, slide order), plus uploaded files
// (images, text attachments) in their own table so a board stays small. Videos never leave the device.
import crypto from 'node:crypto';
import { HttpError } from './models.js';
import { hashPassword, verifyPassword } from './auth.js';
import { TABLE_TEMPLATES, invoiceDefaults } from '../public/js/board/biz.js';
import { sanitizeBoard, generateBoard, BoardError, emptyBoard, bounds, makeItem, makeLink, newId, ITEM_TYPES, SHAPES, LINK_KINDS, LINK_PATHS, LINK_DASH, LINK_ENDS, FINISHES, SHADOWS, ANIM_IN, ANIM_LOOP, FONT_SIZES, ALIGNS, GROUNDS, CLIP_KINDS, CLIP_METALS, CLIP_SIZE, PAPERS, LIFTS, NOTE_PINS, FONT_PX } from '../shared/board.js';

const HIDE_COVERS = ['blur', 'frost', 'solid', 'curtain'];

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
// Everything an AI may set on an item, when adding it or changing it later. Positions are absolute on
// edit_board_items and relative to the new block on add_to_board.
const HEX = { type: 'string', description: 'Hex colour like #e8b86b' };
const STYLE_SCHEMA = {
  type: 'object', description: 'How the item looks. Only the keys you give change.',
  properties: {
    finish: { type: 'string', enum: [...FINISHES, 'none'], description: 'soft = raised paper, tinted = colour wash, solid = full colour, glass = frosted, flat = no depth, none = no background (text only)' },
    shadow: { type: 'string', enum: SHADOWS, description: 'sunk = pressed in (good for frames and trays), flat, raised, float = lifted high' },
    radius: { type: 'number', description: 'Corner roundness in px, 0 to 60' },
    size: { type: 'number', description: 'Text size in px, 8 to 200 (14 normal, 20 large, 32 heading, 52 huge)' },
    font: { type: 'string', enum: FONT_SIZES, description: 'Older size names; prefer size' }, align: { type: 'string', enum: ALIGNS },
    hand: { type: 'boolean', description: 'Handwritten lettering' },
    family: { type: 'string', enum: ['sans', 'round', 'display', 'serif', 'hand', 'marker', 'mono'], description: 'Font: sans (clean), round (friendly), display (tall poster capitals), serif (elegant), hand (handwritten), marker (bold marker pen), mono (typewriter)' },
    strokeW: { type: 'number', description: 'A line around the item, px (0 = none)' }, strokeC: HEX, strokeD: { type: 'string', enum: ['solid', 'dashed', 'dotted'] },
    bold: { type: 'boolean' }, muted: { type: 'boolean', description: 'Softer, quieter text' }, textColor: HEX,
  },
};
const ANIM_SCHEMA = { type: 'object', description: 'Animation when presenting', properties: { in: { type: 'string', enum: ANIM_IN }, loop: { type: 'string', enum: ANIM_LOOP }, delay: { type: 'number', description: 'Seconds' } } };
const LOOK_PROPS = {
  title: { type: 'string' }, text: { type: 'string' }, color: { ...HEX, description: 'Main colour of the item (note paper, card accent, shape fill, clip colour when metal=color)' },
  x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' }, rot: { type: 'number', description: 'Rotation in degrees. A few degrees (-4..4) makes notes and clips look hand-placed.' },
  z: { type: 'number', description: 'Stacking: higher is on top' },
  style: STYLE_SCHEMA, anim: ANIM_SCHEMA,
  shape: { type: 'string', enum: SHAPES, description: 'For type=shape' },
  emoji: { type: 'string', description: 'For type=sticker. Prefer a line icon: i:arrow-right, i:arrow-left, i:arrow-up, i:arrow-down, i:check, i:x, i:star, i:flame, i:rocket, i:lightbulb, i:target, i:zap, i:trophy, i:heart, i:thumbs-up, i:circle-alert, i:sparkles, i:banknote, i:clock, i:pin, i:flag, i:megaphone (an emoji also works)' },
  url: { type: 'string', description: 'For type=image or type=link' }, back: { type: 'string', description: 'For type=flip: text on the back, one line per row' },
  items: { type: 'array', items: { type: 'string' }, description: 'For type=checklist: the rows (start a row with [x] to tick it)' },
  every: { type: 'string', enum: ['hour', '2h', 'day', 'week'], description: 'For type=habit (how often it is ticked) or type=checklist (ticks reset each period and it warns when a whole period is missed)' },
  length: { type: 'number', description: 'For type=habit: a challenge length in periods (e.g. 30 days, 180 for six months); 0 = forever' },
  onMiss: { type: 'string', enum: ['mark', 'restart'], description: 'For type=habit: a missed period is marked red, or the challenge starts again' },
  view: { type: 'string', enum: ['ring', 'bar', 'calendar', 'line', 'number'], description: 'For type=progress: how it looks. Connect a habit or checklist into it (connections) to feed it, or give value/target to count something yourself' },
  template: { type: 'string', enum: Object.keys(TABLE_TEMPLATES), description: 'For type=table: sales (date, customer, item, qty, price, total formula, paid), expenses (date, category, note, amount), debts (who, owed, paid, left, due), goals, blank. Connect a table into a type=stat (totals by month/year/category) or a type=progress (goal: target)' },
  currency: { type: 'string', description: 'For type=table or type=invoice, e.g. TZS' },
  value: { type: 'number', description: 'For type=progress without a habit: the current number' }, target: { type: 'number', description: 'For type=progress: the goal number' }, unit: { type: 'string', description: 'For type=progress: e.g. TZS, videos, km' },
  cover: { type: 'string', enum: HIDE_COVERS, description: 'For type=hide: a cover laid over other items that the viewer taps to reveal what is underneath. Good for quiz answers, prices, the next step.' },
  clip: { type: 'string', enum: CLIP_KINDS, description: 'For type=clip: a realistic paperclip, binder clip, push pin or tape strip that sits on top of a note, card or photo. Put it over the top edge of the thing it holds, rotate it a little.' },
  metal: { type: 'string', enum: CLIP_METALS, description: 'For type=clip: silver, gold, copper, black, or color (uses the item colour)' },
  paper: { type: 'string', enum: PAPERS, description: 'For type=note: the kind of paper. sticky = classic sticky note, lined = notebook page, spiral = page torn from a spiral notebook, grid = graph paper, index = index card, kraft = brown paper, torn = ripped scrap, aged = old yellowed paper' },
  lift: { type: 'string', enum: LIFTS, description: 'For type=note: how the paper sits. flat, lifted (soft shadow), curled (corner peels up)' },
  pin: { type: 'string', enum: NOTE_PINS, description: 'For type=note: what holds it: none, tape, pin or clip' },
  head: { type: 'string', enum: ['triangle', 'wide', 'thin', 'round', 'bar', 'none'], description: 'For type=arrow: the arrow head' }, tail: { type: 'string', enum: ['triangle', 'wide', 'thin', 'round', 'bar', 'none'], description: 'For type=arrow: the start' },
  thickness: { type: 'number', description: 'For type=arrow: body thickness px (6-80)' }, bend: { type: 'number', description: 'For type=arrow: -0.5..0.5, how much it curves (0 straight)' },
  jump: { type: 'string', description: 'Make this a jump link: the id (or ref) of another item. Tapping it glides the board there. Great for a menu slide, "see the details" buttons, or going back to the start. Empty string removes it.' },
  jumpLabel: { type: 'string', description: 'Optional text on the jump button (otherwise just an arrow)' },
  movable: { type: 'boolean', description: 'Can be dragged while the board is locked or presented' },
  locked: { type: 'boolean' },
};
const ITEM_SCHEMA = {
  type: 'object',
  properties: { type: { type: 'string', enum: ITEM_TYPES.filter((t) => t !== 'ink') }, ...LOOK_PROPS, ref: { type: 'string', description: 'Your own name for this item so connections can point at it' } },
};
const LINK_STYLE_PROPS = {
  kind: { type: 'string', enum: LINK_KINDS, description: 'line, tunnel = a thick pipe, raised = embossed, drawn = hand-drawn' },
  path: { type: 'string', enum: LINK_PATHS }, dash: { type: 'string', enum: LINK_DASH }, start: { type: 'string', enum: LINK_ENDS }, end: { type: 'string', enum: LINK_ENDS },
  color: HEX, width: { type: 'number' }, flow: { type: 'boolean', description: 'Dots flowing along it' },
};
const HIDE_COVERS_LIST = HIDE_COVERS;
const hex = (v) => (typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v.trim()) ? v.trim() : null);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

// apply what the AI asked for to one item; unknown or invalid values are ignored
export function applyLook(it, o, { dx = 0, dy = 0 } = {}) {
  if (finite(o.x)) it.x = o.x + dx;
  if (finite(o.y)) it.y = o.y + dy;
  if (finite(o.w) && o.w > 4) it.w = Math.min(20000, o.w);
  if (finite(o.h) && o.h > 4) it.h = Math.min(20000, o.h);
  if (finite(o.rot)) it.rot = Math.max(-360, Math.min(360, o.rot));
  if (finite(o.z)) it.z = o.z;
  if (typeof o.title === 'string') it.title = o.title.slice(0, 300);
  if (typeof o.text === 'string' && it.type !== 'sticker') it.text = o.text.slice(0, 5000);
  if (typeof o.color === 'string') it.color = o.color === '' ? '' : hex(o.color) || it.color;
  if (typeof o.locked === 'boolean') it.locked = o.locked;
  const st = o.style && typeof o.style === 'object' ? o.style : null;
  if (st) {
    const s = { ...it.style };
    if ([...FINISHES, 'none'].includes(st.finish)) s.finish = st.finish;
    if (SHADOWS.includes(st.shadow)) s.shadow = st.shadow;
    if (finite(st.radius)) s.radius = Math.max(0, Math.min(60, st.radius));
    if (FONT_SIZES.includes(st.font)) { s.font = st.font; delete s.size; }
    if (finite(st.size)) s.size = Math.round(Math.max(8, Math.min(200, st.size)) * 2) / 2;
    if (typeof st.hand === 'boolean') { if (st.hand) s.hand = true; else delete s.hand; }
    if (['sans', 'round', 'display', 'serif', 'hand', 'marker', 'mono'].includes(st.family)) { s.family = st.family; if (st.family === 'hand') s.hand = true; else delete s.hand; }
    if (finite(st.strokeW)) s.strokeW = Math.max(0, Math.min(24, st.strokeW));
    if (hex(st.strokeC)) s.strokeC = hex(st.strokeC);
    if (['solid', 'dashed', 'dotted'].includes(st.strokeD)) s.strokeD = st.strokeD;
    if (ALIGNS.includes(st.align)) s.align = st.align;
    if (typeof st.bold === 'boolean') s.weight = st.bold ? 800 : 0;
    if (typeof st.muted === 'boolean') s.muted = st.muted;
    if (typeof st.textColor === 'string') { if (hex(st.textColor)) s.textColor = hex(st.textColor); else if (st.textColor === '') delete s.textColor; }
    it.style = s;
  }
  const an = o.anim && typeof o.anim === 'object' ? o.anim : null;
  if (an) {
    const a = { ...it.anim };
    if (ANIM_IN.includes(an.in)) a.in = an.in;
    if (ANIM_LOOP.includes(an.loop)) a.loop = an.loop;
    if (finite(an.delay)) a.delay = Math.max(0, Math.min(10, an.delay));
    it.anim = a;
  }
  const d = { ...it.data };
  if (it.type === 'shape' && SHAPES.includes(o.shape)) d.shape = o.shape;
  if (it.type === 'sticker' && typeof (o.emoji ?? o.text) === 'string' && (o.emoji ?? o.text)) it.text = String(o.emoji ?? o.text).slice(0, 40);
  if ((it.type === 'image' || it.type === 'link') && typeof o.url === 'string') d.url = o.url.slice(0, 2000);
  if (it.type === 'flip' && typeof o.back === 'string') d.back = o.back.slice(0, 4000);
  if (it.type === 'checklist' && Array.isArray(o.items)) d.items = o.items.slice(0, 40).map((t) => { const v = String(t?.t ?? t); const done = /^\s*\[x\]/i.test(v) || t?.done === true; return { t: v.replace(/^\s*\[[x ]?\]\s*/i, '').slice(0, 200), done }; });
  if (it.type === 'hide' && HIDE_COVERS_LIST.includes(o.cover)) d.cover = o.cover;
  if ((it.type === 'habit' || it.type === 'checklist') && ['hour', '2h', 'day', 'week'].includes(o.every)) { d.every = o.every; if (it.type === 'checklist') d.since = Date.now(); }
  if (it.type === 'habit') {
    if (!d.start) { const t = new Date(); d.start = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; }
    d.every ||= 'day'; d.log ||= {};
    if (finite(o.length)) d.length = Math.max(0, Math.min(3650, Math.round(o.length)));
    if (o.onMiss === 'mark' || o.onMiss === 'restart') d.onMiss = o.onMiss;
  }
  if (it.type === 'table' && !d.cols) {
    const tp = (TABLE_TEMPLATES[o.template] || TABLE_TEMPLATES.sales)();
    d.cols = tp.cols; d.rows = []; d.currency = typeof o.currency === 'string' ? o.currency.slice(0, 6) : 'TZS';
    if (!it.title) it.title = tp.title;
  }
  if (it.type === 'stat' && !d.view) d.view = 'months';
  if (it.type === 'invoice' && !d.lines) Object.assign(d, invoiceDefaults(), typeof o.currency === 'string' ? { currency: o.currency.slice(0, 6) } : {});
  if (it.type === 'progress') {
    if (['ring', 'bar', 'calendar', 'line', 'number'].includes(o.view)) d.view = o.view;
    for (const k of ['value', 'target']) if (finite(o[k])) d[k] = o[k];
    if (typeof o.unit === 'string') d.unit = o.unit.slice(0, 20);
  }
  if (it.type === 'note') {
    if (PAPERS.includes(o.paper)) d.paper = o.paper;
    if (LIFTS.includes(o.lift)) d.lift = o.lift;
    if (NOTE_PINS.includes(o.pin)) d.pin = o.pin;
  }
  if (it.type === 'clip') {
    if (CLIP_KINDS.includes(o.clip) && o.clip !== d.kind) {
      d.kind = o.clip;
      if (!finite(o.w) && !finite(o.h)) [it.w, it.h] = CLIP_SIZE[o.clip];
    }
    if (CLIP_METALS.includes(o.metal)) d.metal = o.metal;
  }
  if (it.type === 'arrow') {
    if (['triangle', 'wide', 'thin', 'round', 'bar', 'none'].includes(o.head)) d.head = o.head;
    if (['triangle', 'wide', 'thin', 'round', 'bar', 'none'].includes(o.tail)) d.tail = o.tail;
    if (finite(o.thickness)) d.body = Math.max(3, Math.min(120, o.thickness));
    // a fresh straight arrow across the box, bent if asked
    if (!d.pts || finite(o.bend) || finite(o.w) || finite(o.h)) {
      const b = finite(o.bend) ? Math.max(-0.6, Math.min(0.6, o.bend)) : 0;
      d.pts = [[12, it.h / 2], [it.w / 2, it.h / 2 - b * it.w], [it.w - 12, it.h / 2]]; d.w0 = it.w; d.h0 = it.h;
    }
  }
  if (it.type === 'media' && typeof o.url === 'string') d.url = o.url.slice(0, 2000);
  if (typeof o.movable === 'boolean') { if (o.movable) d.movable = true; else delete d.movable; }
  if (typeof o.jump === 'string') { if (/^[A-Za-z0-9_-]{1,48}$/.test(o.jump)) d.jump = o.jump; else if (!o.jump) { delete d.jump; delete d.jumpLabel; } }
  if (typeof o.jumpLabel === 'string') { if (o.jumpLabel.trim()) d.jumpLabel = o.jumpLabel.trim().slice(0, 40); else delete d.jumpLabel; }
  it.data = d;
  return it;
}
export function itemFromSpec(a, origin) {
  const o = a && typeof a === 'object' ? a : {};
  const type = ITEM_TYPES.includes(o.type) && o.type !== 'ink' ? o.type : 'card';
  const it = makeItem(type, { x: origin.x, y: origin.y });
  if (type === 'shape') it.data.shape = 'round';
  if (type === 'sticker') it.text = 'i:star';
  if (type === 'frame') it.style.shadow = 'raised';
  if (type === 'hide') { it.data = { cover: 'blur', tap: 'reveal' }; it.title = 'Tap to reveal'; it.z = 1000; }
  if (type === 'clip') { it.data = { kind: 'paperclip', metal: 'silver' }; it.z = 2000; it.rot = -6; }
  applyLook(it, o, { dx: origin.x, dy: origin.y });
  if (!it.anim.in) it.anim.in = type === 'clip' ? 'none' : 'pop';
  return it;
}
// what an AI sees of an item: everything that shapes how it looks, nothing bulky
const DATA_KEYS = ['jump', 'jumpLabel', 'paper', 'lift', 'pin', 'shape', 'cover', 'tap', 'back', 'items', 'url', 'movable', 'kind', 'metal', 'notes', 'num', 'flipped', 'projectId', 'name', 'every', 'start', 'length', 'onMiss', 'days', 'view', 'source', 'value', 'target', 'unit', 'step', 'period', 'currency', 'status', 'no'];
function itemView(i) {
  const data = {};
  for (const k of DATA_KEYS) if (i.data?.[k] !== undefined) data[k] = k === 'notes' || k === 'back' ? String(i.data[k]).slice(0, 600) : i.data[k];
  const r = (n) => Math.round(n);
  return { id: i.id, type: i.type, x: r(i.x), y: r(i.y), w: r(i.w), h: r(i.h), ...(i.rot ? { rot: i.rot } : {}), z: i.z || 0,
    ...(i.title ? { title: i.title } : {}), ...(i.text ? { text: i.text.slice(0, 6000) } : {}), ...(i.color ? { color: i.color } : {}),
    ...(Object.keys(i.style || {}).length ? { style: i.style } : {}), ...(Object.keys(i.anim || {}).length ? { anim: i.anim } : {}),
    ...(Object.keys(data).length ? { data } : {}), ...(i.locked ? { locked: true } : {}) };
}
function applyLinkStyle(l, c) {
  const s = { ...l.style };
  if (LINK_KINDS.includes(c.kind)) s.kind = c.kind;
  if (LINK_PATHS.includes(c.path)) s.path = c.path;
  if (LINK_DASH.includes(c.dash)) s.dash = c.dash;
  if (LINK_ENDS.includes(c.start)) s.start = c.start;
  if (LINK_ENDS.includes(c.end)) s.end = c.end;
  if (typeof c.color === 'string') { if (hex(c.color)) s.color = hex(c.color); else if (c.color === '') delete s.color; }
  if (finite(c.width)) s.width = Math.max(1, Math.min(60, c.width));
  if (typeof c.flow === 'boolean') s.flow = c.flow;
  l.style = s;
  if (typeof c.label === 'string') l.label = c.label.slice(0, 200);
}
const DESIGN_TIPS = 'Design every item yourself instead of relying on preset layouts; get_board returns a designCheck list of overlaps, items sticking out of frames and text that does not fit, so fix those. Design like a polished, tactile canvas, not a table: give each block breathing room (40px+ gaps), group related things inside a frame (style.shadow "sunk"), use shapes (pill or round) as soft labelled buttons, one accent colour per group from warm earthy tones (#e8b86b, #ff8a5c, #e07a5f, #c9a27e, #b8e04a, #2fb4a0, #ffb020; never blue or purple), big bold titles (style.font "xl", bold), quieter details (style.muted), a few stickers or clips, slight rotation on notes, and curved connections.';

const CONN_SCHEMA = { type: 'object', properties: { from: { type: 'string', description: 'Item id or ref' }, to: { type: 'string' }, label: { type: 'string' }, ...LINK_STYLE_PROPS } };
const SLIDES_SCHEMA = { type: 'array', items: { type: 'string' }, description: 'Ids or refs of frames to add to the slide order, in order' };
// put a design onto a board: a preset block (spec) and/or freely placed items, connections and slides
function addInto(d, a, origin) {
  const refs = new Map(d.items.map((i) => [i.id, i]));
  const ids = [], named = {};
  if (a.spec) {
    const g = generateBoard(a.spec, { origin });
    d.items.push(...g.items); d.links.push(...g.links); d.order.push(...g.order); ids.push(...g.items.map((i) => i.id));
  }
  const top = d.items.reduce((m, i) => Math.max(m, i.z || 0), 0);
  for (const spec of Array.isArray(a.items) ? a.items.slice(0, 300) : []) {
    const it = itemFromSpec(spec, a.spec ? { x: origin.x, y: origin.y + 900 } : origin);
    // drawing order: later items sit on top; frames stay underneath
    if (!finite(spec?.z)) it.z = it.type === 'frame' ? -1000 + ids.length : top + ids.length + 1;
    d.items.push(it); refs.set(it.id, it); ids.push(it.id);
    if (spec?.ref) { refs.set(String(spec.ref), it); named[String(spec.ref)] = it.id; }
  }
  for (const id of ids) { const it = refs.get(id); const j = it?.data?.jump; if (j && refs.has(j)) it.data.jump = refs.get(j).id; }
  let connections = 0;
  for (const c of Array.isArray(a.connections) ? a.connections.slice(0, 300) : []) {
    const f = refs.get(String(c?.from)), t = refs.get(String(c?.to));
    if (!f || !t || f === t) continue;
    const l = makeLink({ item: f.id }, { item: t.id }, { style: { kind: 'line', path: 'curved', dash: 'solid', start: 'none', end: 'arrow', width: 3, flow: false } });
    applyLinkStyle(l, c); d.links.push(l); connections++;
  }
  for (const ref of Array.isArray(a.slides) ? a.slides : []) { const f = refs.get(String(ref)); if (f?.type === 'frame' && !d.order.includes(f.id)) d.order.push(f.id); }
  return { ids, refs: named, connections };
}

// ---------- design check: what a careful designer would fix before showing it ----------
const rectOverlap = (a, b) => { const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y); return w > 0 && h > 0 ? w * h : 0; };
const holds = (big, small, slack = 4) => small.x >= big.x - slack && small.y >= big.y - slack && small.x + small.w <= big.x + big.w + slack && small.y + small.h <= big.y + big.h + slack;
export function lintBoard(d, focus = null) {
  const items = (d.items || []).filter((i) => i.type !== 'ink');
  const mine = (i) => !focus || focus.has(i.id);
  const frames = items.filter((i) => i.type === 'frame');
  const solid = items.filter((i) => !['frame', 'clip', 'sticker', 'hide'].includes(i.type));
  const issues = [];
  for (let x = 0; x < solid.length; x++) for (let y = x + 1; y < solid.length; y++) {
    const A = solid[x], B = solid[y];
    if (!mine(A) && !mine(B)) continue;
    const ov = rectOverlap(A, B);
    if (!ov) continue;
    const [small, big] = A.w * A.h <= B.w * B.h ? [A, B] : [B, A];
    // text or a number chip laid on a shape, card or note is on purpose
    if ((small.type === 'text' || (small.type === 'shape' && small.w <= 80)) && holds(big, small)) continue;
    if (ov / (small.w * small.h) > 0.1) issues.push(`${A.id} (${A.type}) and ${B.id} (${B.type}) overlap`);
  }
  for (const i of items) {
    if (i.type === 'frame' || !mine(i) || i.type === 'clip') continue;
    for (const f of frames) { const ov = rectOverlap(i, f); if (ov && !holds(f, i, 2) && ov > i.w * i.h * 0.05) issues.push(`${i.id} (${i.type}) sticks out of frame ${f.id}: move it inside (frame is x ${Math.round(f.x)}..${Math.round(f.x + f.w)}, y ${Math.round(f.y)}..${Math.round(f.y + f.h)}) or resize`); }
  }
  for (const i of items) {
    if (!mine(i) || !['text', 'note', 'card', 'shape', 'flip'].includes(i.type)) continue;
    const t = [i.title, i.text].filter(Boolean).join('\n').trim();
    if (!t) continue;
    const px = typeof i.style?.size === 'number' ? i.style.size : FONT_PX[i.style?.font || (i.type === 'text' ? 'l' : 'm')] || 14.5;
    const pad = i.type === 'text' ? 12 : Math.min(40, Math.min(i.w, i.h) * 0.3);
    const perLine = Math.max(1, Math.floor(Math.max(20, i.w - pad) / (px * 0.56)));
    const lines = t.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0);
    const need = lines * px * 1.38 + pad;
    if (need > i.h * 1.12) issues.push(`${i.id} (${i.type}): text does not fit; it needs about ${Math.round(need)}px of height at ${px}px but the box is ${Math.round(i.h)}px. Make the box taller/wider, the text smaller, or the words fewer`);
  }
  return issues.slice(0, 30);
}

export const BOARD_TOOLS = [
  { name: 'list_boards', description: 'List the owner\'s boards (free canvases for plans, workflows, courses and presentations).',
    input_schema: { type: 'object', properties: {} },
    run: async ({ db, uid }) => ({ boards: await listBoards(db, uid) }) },
  { name: 'get_board', description: 'Read a board in full: every item with its position, size, rotation, colour, style (finish, shadow, corners, font, alignment), animation and type details; every connection with its style; the slide order and the floor (dots, grid or plain). Read it before changing a board.',
    input_schema: { type: 'object', properties: { board: BOARD_ARG }, required: ['board'] },
    run: async ({ db, uid }, a) => {
      const r = await findBoard(db, uid, a.board), d = parse(r.data);
      return { id: r.id, name: r.name, icon: r.icon, floor: d.settings?.ground || 'dots', slides: d.order,
        items: d.items.filter((i) => i.type !== 'ink').map(itemView),
        drawings: d.items.filter((i) => i.type === 'ink').length,
        designCheck: lintBoard(d),
        connections: d.links.map((l) => ({ id: l.id, from: l.from.item || { x: l.from.x, y: l.from.y }, to: l.to.item || { x: l.to.x, y: l.to.y }, ...(l.label ? { label: l.label } : {}), style: l.style })) };
    } },
  { name: 'create_board', description: `Create a new board. Design it yourself: pass items (every type, absolute x/y, full styling), connections and the slide order, so each board fits its content. A spec (preset layout: slides, workflow, mindmap, kanban, timeline, notes) is optional and only a quick start. The owner can present frames as slides full screen. ${DESIGN_TIPS}`,
    input_schema: { type: 'object', properties: { name: { type: 'string' }, icon: { type: 'string', description: 'One emoji' }, floor: { type: 'string', enum: GROUNDS }, items: { type: 'array', items: ITEM_SCHEMA, description: 'Your own design, in drawing order (later items on top); x/y are absolute' }, connections: { type: 'array', items: CONN_SCHEMA }, slides: SLIDES_SCHEMA, spec: SPEC_SCHEMA }, required: ['name'] },
    run: async ({ db, uid }, a) => {
      const d = { v: 1, items: [], links: [], order: [], settings: GROUNDS.includes(a.floor) ? { ground: a.floor } : {} };
      const out = addInto(d, a, { x: 0, y: 0 });
      const b = await createBoard(db, uid, { name: a.name, icon: a.icon || '', data: d });
      return { created: { id: b.id, name: b.name, items: b.items, slides: b.slides }, ids: out.ids, refs: out.refs, connections: out.connections };
    } },
  { name: 'add_to_board', description: `Add to an existing board: your own items (any type, full styling) and connections, placed at "at" (absolute; default: to the right of what is there) with item x/y relative to it, plus frames to append to the slide order. A spec (preset layout block) is optional. ${DESIGN_TIPS}`,
    input_schema: { type: 'object', properties: { board: BOARD_ARG, spec: SPEC_SCHEMA, at: { type: 'object', description: 'Board position of the top-left of what you add. Use {"x":0,"y":0} to give items absolute positions.', properties: { x: { type: 'number' }, y: { type: 'number' } } }, items: { type: 'array', items: ITEM_SCHEMA }, connections: { type: 'array', items: CONN_SCHEMA }, slides: SLIDES_SCHEMA }, required: ['board'] },
    run: async ({ db, uid }, a) => {
      const r = await findBoard(db, uid, a.board), d = parse(r.data);
      const b = bounds(d.items);
      const origin = a.at && finite(a.at.x) && finite(a.at.y) ? { x: a.at.x, y: a.at.y } : { x: b ? b.x1 + 300 : 0, y: b ? b.y0 : 0 };
      const out = addInto(d, a, origin);
      await saveBoard(db, uid, r.id, { data: d });
      return { board: r.id, added: out.ids.length, ids: out.ids.slice(0, 300), refs: out.refs, connections: out.connections };
    } },
  { name: 'get_board_code', description: 'Read a board as BOARD CODE: simple HTML-like markup where frames hold their contents (child x/y relative to the frame), text is the element body and styles are attributes. The easiest way to understand a board and to redesign it: read the code, edit it like a web page, send it back with edit_board_code. Pass items (ids) to read only some of it.',
    input_schema: { type: 'object', properties: { board: BOARD_ARG, items: { type: 'array', items: { type: 'string' }, description: 'Optional: only these item ids (real ids from get_board)' } }, required: ['board'] },
    run: async ({ db, uid }, a) => {
      const { toCode, CODE_GUIDE } = await import('./boardcode.js');
      const r = await findBoard(db, uid, a.board), d = parse(r.data);
      const scope = Array.isArray(a.items) && a.items.length ? a.items.map(String) : null;
      const c = toCode(d, { name: r.name, scope });
      return { board: r.id, version: r.version, mode: c.count > 120 && !scope ? 'patch' : 'full', code: c.code, guide: CODE_GUIDE,
        howToEdit: 'Send the edited code to edit_board_code with the same version. mode "full": send the complete code; anything left out is deleted, attributes left out are cleared. mode "patch": send <board> with only the elements you change (id + changed attributes, inside their <frame id> wrapper), new elements in full, and <delete id="..."/>. Give new elements ids like n1, n2. Put <summary>one sentence</summary> first.' };
    } },
  { name: 'edit_board_code', description: `Apply edited BOARD CODE (from get_board_code) to the board. FlowMap works out what changed and applies only that: moved, restyled, rewritten, added and deleted items and connections. ${DESIGN_TIPS}`,
    input_schema: { type: 'object', properties: { board: BOARD_ARG, version: { type: 'number', description: 'The version get_board_code returned' }, code: { type: 'string', description: 'The edited board code, <board> ... </board>' }, mode: { type: 'string', enum: ['full', 'patch'] }, items: { type: 'array', items: { type: 'string' }, description: 'The same items you passed to get_board_code, if any' }, request: { type: 'string', description: 'What the owner asked for (so big deletions are only made when asked)' } }, required: ['board', 'version', 'code'] },
    run: async ({ db, uid }, a) => {
      const { toCode, applyCode } = await import('./boardcode.js');
      const r = await findBoard(db, uid, a.board), d = parse(r.data);
      if (Number(a.version) !== r.version) throw new HttpError(409, 'The board changed since you read it. Read it again with get_board_code.');
      const scope = Array.isArray(a.items) && a.items.length ? a.items.map(String) : null;
      const ctx = toCode(d, { name: r.name, scope });
      const out = applyCode(d, String(a.code || ''), ctx, { mode: a.mode === 'patch' ? 'patch' : 'full', request: String(a.request || 'edit'), scope });
      await saveBoard(db, uid, r.id, { data: out.data, version: r.version });
      return { board: r.id, ...out.stats, summary: out.summary, complete: out.complete, designCheck: lintBoard(out.data, out.touched) };
    } },
  { name: 'edit_board_items', description: `Change anything on a board: move, resize, rotate, restack, recolour, rewrite, restyle (finish, shadow, corners, font size, alignment, bold, text colour), animate, change a shape, sticker, checklist, flip back, cover or clip, or delete items. Also restyle or delete connections, restyle many items at once (restyle), and change the floor or board name. Read the board with get_board first so you use real ids. ${DESIGN_TIPS}`,
    input_schema: { type: 'object', properties: {
      board: BOARD_ARG,
      changes: { type: 'array', description: 'One entry per item', items: { type: 'object', properties: { id: { type: 'string' }, delete: { type: 'boolean' }, ...LOOK_PROPS }, required: ['id'] } },
      restyle: { type: 'array', description: 'Apply the same look to many items at once: pick them by ids and/or types (no ids and no types = every item)', items: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } }, types: { type: 'array', items: { type: 'string', enum: ITEM_TYPES } }, color: HEX, style: STYLE_SCHEMA, anim: ANIM_SCHEMA, rot: { type: 'number' } } } },
      connections: { type: 'array', description: 'Change or delete connections', items: { type: 'object', properties: { id: { type: 'string' }, delete: { type: 'boolean' }, label: { type: 'string' }, ...LINK_STYLE_PROPS }, required: ['id'] } },
      floor: { type: 'string', enum: GROUNDS, description: 'The board background' },
      name: { type: 'string' }, icon: { type: 'string', description: 'One emoji' },
    }, required: ['board'] },
    run: async ({ db, uid }, a) => {
      const r = await findBoard(db, uid, a.board), d = parse(r.data);
      let changed = 0, removed = 0, links = 0;
      const missing = [];
      for (const c of Array.isArray(a.changes) ? a.changes.slice(0, 500) : []) {
        const i = d.items.findIndex((x) => x.id === c?.id);
        if (i < 0) { if (c?.id) missing.push(c.id); continue; }
        if (c.delete) { const id = d.items[i].id; d.items.splice(i, 1); d.links = d.links.filter((l) => l.from.item !== id && l.to.item !== id); d.order = d.order.filter((x) => x !== id); removed++; continue; }
        applyLook(d.items[i], c); changed++;
      }
      for (const g of Array.isArray(a.restyle) ? a.restyle.slice(0, 20) : []) {
        const ids = Array.isArray(g?.ids) && g.ids.length ? new Set(g.ids.map(String)) : null, types = Array.isArray(g?.types) && g.types.length ? new Set(g.types) : null;
        for (const it of d.items) {
          if (it.type === 'ink' || (ids && !ids.has(it.id)) || (types && !types.has(it.type))) continue;
          applyLook(it, { color: g.color, style: g.style, anim: g.anim, rot: g.rot }); changed++;
        }
      }
      for (const c of Array.isArray(a.connections) ? a.connections.slice(0, 500) : []) {
        const i = d.links.findIndex((l) => l.id === c?.id);
        if (i < 0) { if (c?.id) missing.push(c.id); continue; }
        if (c.delete) d.links.splice(i, 1); else applyLinkStyle(d.links[i], c);
        links++;
      }
      if (GROUNDS.includes(a.floor)) d.settings = { ...d.settings, ground: a.floor };
      const meta = {};
      if (typeof a.name === 'string' && a.name.trim()) meta.name = a.name;
      if (typeof a.icon === 'string') meta.icon = a.icon;
      await saveBoard(db, uid, r.id, { data: d, ...meta });
      return { board: r.id, changed, deleted: removed, connections: links, ...(missing.length ? { notFound: missing.slice(0, 50) } : {}) };
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
