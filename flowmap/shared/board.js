// Boards: free canvases for planning, explaining and presenting. Shared by the browser (editor, templates)
// and the server (validation, and the AI tools that build boards from a plain description).
//
// A board's data:
//   { v: 1, items: [Item], links: [Link], order: [frameId], settings: { ground, snap } }
// Item:  { id, type, x, y, w, h, rot, z, locked, title, text, color, style: {}, data: {}, anim: {} }
// Link:  { id, from: { item } | { x, y }, to: { item } | { x, y }, label, style: { kind, path, dash, start, end, color, width, flow } }

export const ITEM_TYPES = ['note', 'card', 'text', 'shape', 'frame', 'flip', 'image', 'video', 'file', 'link', 'project', 'sticker', 'ink', 'checklist', 'prompt', 'hide'];
export const SHAPES = ['rect', 'round', 'pill', 'ellipse', 'diamond', 'triangle', 'hexagon', 'star', 'arrow', 'bubble'];
export const LINK_KINDS = ['line', 'tunnel', 'raised', 'drawn'];
export const LINK_PATHS = ['curved', 'straight', 'elbow'];
export const LINK_DASH = ['solid', 'dashed', 'dotted'];
export const LINK_ENDS = ['none', 'arrow', 'triangle', 'dot', 'diamond', 'bar'];
export const FINISHES = ['soft', 'tinted', 'solid', 'flat', 'glass'];
export const SHADOWS = ['flat', 'raised', 'float', 'sunk'];
export const ANIM_IN = ['none', 'pop', 'fade', 'rise', 'zoom', 'draw', 'slide'];
export const ANIM_LOOP = ['none', 'bounce', 'pulse', 'wiggle', 'float', 'spin', 'glow'];
export const PALETTE = ['#ff4d5e', '#ff8a5c', '#ffb020', '#e8b86b', '#b8e04a', '#4be38a', '#2fb4a0', '#e07a5f', '#ff6fae', '#c9a27e', '#8a7b6d', '#f5f1ea'];

export const DEFAULT_SIZE = {
  note: [220, 180], card: [280, 170], text: [320, 60], shape: [200, 140], frame: [1100, 620], flip: [240, 240], image: [320, 240],
  video: [360, 240], file: [260, 90], link: [300, 110], project: [280, 150], sticker: [72, 72], ink: [10, 10], checklist: [280, 220], prompt: [360, 220], hide: [320, 200],
};

let seq = 0;
export const newId = (p = 'i') => `${p}${Date.now().toString(36)}${(seq++ % 1296).toString(36).padStart(2, '0')}${Math.random().toString(36).slice(2, 5)}`;

export function makeItem(type, props = {}) {
  const [w, h] = DEFAULT_SIZE[type] || [200, 120];
  return { id: newId(), type, x: 0, y: 0, w, h, rot: 0, z: 0, locked: false, title: '', text: '', color: '', style: {}, data: {}, anim: {}, ...props };
}
export function makeLink(from, to, props = {}) {
  return { id: newId('l'), from, to, label: '', style: {}, ...props };
}
export const emptyBoard = () => ({ v: 1, items: [], links: [], order: [], settings: {} });

// ---------- validation (server side, also used before saving) ----------
const LIMITS = { items: 4000, links: 3000, text: 20000, title: 300, data: 250000, total: 2_600_000 };
const num = (v, d = 0, lo = -1e6, hi = 1e6) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const pick = (v, list, d) => (list.includes(v) ? v : d);
const idOk = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,48}$/.test(v);

export class BoardError extends Error {}

export function sanitizeBoard(input) {
  const b = obj(input);
  const items = Array.isArray(b.items) ? b.items : [];
  const links = Array.isArray(b.links) ? b.links : [];
  if (items.length > LIMITS.items) throw new BoardError(`A board can hold at most ${LIMITS.items} items`);
  if (links.length > LIMITS.links) throw new BoardError(`A board can hold at most ${LIMITS.links} connections`);
  const seen = new Set();
  const outItems = [];
  for (const raw of items) {
    const it = obj(raw);
    if (!idOk(it.id) || seen.has(it.id) || !ITEM_TYPES.includes(it.type)) continue;
    seen.add(it.id);
    const data = obj(it.data);
    if (JSON.stringify(data).length > LIMITS.data) throw new BoardError(`Item "${str(it.title || it.text, 40)}" holds too much data`);
    outItems.push({
      id: it.id, type: it.type,
      x: num(it.x), y: num(it.y), w: num(it.w, 100, 4, 20000), h: num(it.h, 100, 4, 20000), rot: num(it.rot, 0, -360, 360), z: num(it.z, 0, -1e6, 1e6),
      locked: !!it.locked, title: str(it.title, LIMITS.title), text: str(it.text, LIMITS.text), color: str(it.color, 30),
      style: obj(it.style), data, anim: obj(it.anim),
      ...(idOk(it.parent) ? { parent: it.parent } : {}),
    });
  }
  const end = (e) => { const o = obj(e); return idOk(o.item) ? { item: o.item, ...(typeof o.side === 'string' ? { side: str(o.side, 8) } : {}) } : { x: num(o.x), y: num(o.y) }; };
  const outLinks = [];
  for (const raw of links) {
    const l = obj(raw);
    if (!idOk(l.id) || seen.has(l.id)) continue;
    seen.add(l.id);
    const s = obj(l.style);
    outLinks.push({
      id: l.id, from: end(l.from), to: end(l.to), label: str(l.label, 200),
      style: {
        kind: pick(s.kind, LINK_KINDS, 'line'), path: pick(s.path, LINK_PATHS, 'curved'), dash: pick(s.dash, LINK_DASH, 'solid'),
        start: pick(s.start, LINK_ENDS, 'none'), end: pick(s.end, LINK_ENDS, 'arrow'), color: str(s.color, 30), width: num(s.width, 3, 1, 60), flow: !!s.flow,
      },
    });
  }
  const order = (Array.isArray(b.order) ? b.order : []).filter((id) => idOk(id) && outItems.some((i) => i.id === id && i.type === 'frame'));
  const out = { v: 1, items: outItems, links: outLinks, order, settings: obj(b.settings) };
  if (JSON.stringify(out).length > LIMITS.total) throw new BoardError('This board is too large to save (over 2.5 MB). Move big images to links, or split the board.');
  return out;
}

// ---------- geometry helpers ----------
export function bounds(items) {
  if (!items.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const i of items) { x0 = Math.min(x0, i.x); y0 = Math.min(y0, i.y); x1 = Math.max(x1, i.x + i.w); y1 = Math.max(y1, i.y + i.h); }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}
export const inside = (a, f) => a.x >= f.x && a.y >= f.y && a.x + a.w <= f.x + f.w && a.y + a.h <= f.y + f.h;

// ---------- generator: turn a plain description into a laid-out board ----------
// spec.layout: 'slides' | 'workflow' | 'mindmap' | 'kanban' | 'timeline' | 'notes'
//  slides:    [{ title, points: [string], note, emoji }]          -> 16:9 frames, one per slide, in order
//  nodes/edges: [{ id, title, text, color, group }], [{ from, to, label }] -> a left-to-right flow
//  center + branches: [{ title, children: [string] }]              -> a mind map
//  columns:   [{ title, cards: [string] }]                          -> a kanban
//  milestones:[{ title, date, text }]                               -> a timeline
export function generateBoard(spec, { origin = { x: 0, y: 0 }, style = {} } = {}) {
  const s = obj(spec);
  const layout = pick(s.layout, ['slides', 'workflow', 'mindmap', 'kanban', 'timeline', 'notes'], s.slides ? 'slides' : s.nodes ? 'workflow' : s.branches ? 'mindmap' : s.columns ? 'kanban' : s.milestones ? 'timeline' : 'notes');
  const out = { items: [], links: [], order: [] };
  const add = (type, props) => { const it = makeItem(type, props); out.items.push(it); return it; };
  const connect = (a, b, props = {}) => { const l = makeLink({ item: a.id }, { item: b.id }, { ...props, style: { kind: 'line', path: 'curved', dash: 'solid', start: 'none', end: 'arrow', width: 3, ...style.link, ...props.style } }); out.links.push(l); return l; };
  const color = (i, c) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : PALETTE[i % 9]);
  const { x: ox, y: oy } = origin;
  const text = (v, n) => str(typeof v === 'string' ? v : v == null ? '' : String(v), n);

  if (layout === 'slides') {
    const slides = (Array.isArray(s.slides) ? s.slides : []).slice(0, 60);
    const FW = 1100, FH = 620, GX = 180, GY = 200, PER_ROW = 4;
    let prev = null;
    slides.forEach((sl, n) => {
      const o = obj(sl);
      const fx = ox + (n % PER_ROW) * (FW + GX), fy = oy + Math.floor(n / PER_ROW) * (FH + GY);
      const frame = add('frame', { x: fx, y: fy, w: FW, h: FH, title: `${n + 1}. ${text(o.title, 120) || 'Slide'}`, color: color(n, o.color), style: { shadow: 'raised' }, data: { notes: text(o.note, 4000) } });
      out.order.push(frame.id);
      add('text', { x: fx + 70, y: fy + 70, w: FW - 240, h: 90, text: text(o.title, 160) || `Slide ${n + 1}`, style: { font: 'xl', weight: 800 }, anim: { in: 'rise' } });
      if (o.subtitle) add('text', { x: fx + 70, y: fy + 160, w: FW - 240, h: 50, text: text(o.subtitle, 300), style: { font: 'm', muted: true }, anim: { in: 'fade', delay: 0.15 } });
      const pts = (Array.isArray(o.points) ? o.points : []).slice(0, 6).map((p) => text(p, 400)).filter(Boolean);
      const cols = pts.length <= 3 ? Math.max(1, pts.length) : 3;
      const rows = Math.ceil(pts.length / cols) || 1;
      const cw = (FW - 140 - (cols - 1) * 30) / cols, ch = rows > 1 ? 160 : 230;
      pts.forEach((p, i) => {
        const [head, ...rest] = p.split(/:\s+/);
        add('card', { x: fx + 70 + (i % cols) * (cw + 30), y: fy + 240 + Math.floor(i / cols) * (ch + 26), w: cw, h: ch, title: rest.length ? head : '', text: rest.length ? rest.join(': ') : p, color: color(n + i, null), style: { finish: 'soft', font: 'l' }, data: { num: i + 1 }, anim: { in: 'pop', delay: 0.25 + i * 0.12 } });
      });
      if (o.emoji) add('sticker', { x: fx + FW - 150, y: fy + 50, w: 84, h: 84, text: text(o.emoji, 40), anim: { in: 'pop', loop: 'bounce', delay: 0.6 } });
      if (prev && n % PER_ROW) connect(prev, frame, { style: { dash: 'dashed', width: 3, flow: true } });
      prev = frame;
    });
  } else if (layout === 'workflow') {
    const nodes = (Array.isArray(s.nodes) ? s.nodes : []).slice(0, 120).map((n, i) => ({ ...obj(n), key: text(obj(n).id, 60) || `n${i}` }));
    const edges = (Array.isArray(s.edges) ? s.edges : []).slice(0, 300).map(obj).filter((e) => nodes.some((n) => n.key === text(e.from, 60)) && nodes.some((n) => n.key === text(e.to, 60)));
    // edges that close a loop are drawn but ignored for the left-to-right order
    const outs = new Map(nodes.map((n) => [n.key, []]));
    for (const e of edges) outs.get(text(e.from, 60)).push(text(e.to, 60));
    const state = new Map(), back = new Set();
    const dfs = (u) => { state.set(u, 1); for (const v of outs.get(u)) { if (state.get(v) === 1) back.add(`${u}>${v}`); else if (!state.get(v)) dfs(v); } state.set(u, 2); };
    nodes.forEach((n) => { if (!state.get(n.key)) dfs(n.key); });
    const fwd = edges.map((e) => [text(e.from, 60), text(e.to, 60)]).filter(([a, b]) => a !== b && !back.has(`${a}>${b}`));
    const layer = new Map(nodes.map((n) => [n.key, 0]));
    for (let k = 0; k < nodes.length; k++) for (const [a, b] of fwd) if (layer.get(b) <= layer.get(a)) layer.set(b, layer.get(a) + 1);
    const cols = new Map();
    nodes.forEach((n) => { const l = layer.get(n.key); (cols.get(l) || cols.set(l, []).get(l)).push(n); });
    const CW = 280, CH = 140, GX = 150, GY = 60;
    const byKey = new Map();
    [...cols.keys()].sort((a, b) => a - b).forEach((l) => {
      const list = cols.get(l);
      const total = list.length * CH + (list.length - 1) * GY;
      list.forEach((n, i) => {
        const it = add(n.kind === 'note' ? 'note' : n.kind === 'shape' ? 'shape' : 'card', { x: ox + l * (CW + GX), y: oy - total / 2 + i * (CH + GY), w: CW, h: CH, title: text(n.title, 200), text: text(n.text, 1200), color: color(l + i, n.color), data: n.kind === 'shape' ? { shape: 'round' } : {}, anim: { in: 'pop', delay: l * 0.2 + i * 0.08 } });
        byKey.set(n.key, it);
      });
    });
    for (const e of edges) connect(byKey.get(text(e.from, 60)), byKey.get(text(e.to, 60)), { label: text(e.label, 120), style: { flow: !!e.flow || !!style.flow } });
    // groups become frames drawn around their members
    const groups = new Map();
    nodes.forEach((n) => { if (n.group) (groups.get(n.group) || groups.set(n.group, []).get(n.group)).push(byKey.get(n.key)); });
    [...groups].forEach(([g, members], i) => {
      const b = bounds(members);
      const f = add('frame', { x: b.x0 - 50, y: b.y0 - 90, w: b.w + 100, h: b.h + 140, title: text(g, 120), color: color(i, null), style: { shadow: 'sunk' } });
      f.z = -10;
    });
  } else if (layout === 'mindmap') {
    const center = add('shape', { x: ox - 150, y: oy - 80, w: 300, h: 160, text: text(s.center || s.title, 200) || 'Main idea', color: '#ffb020', data: { shape: 'ellipse' }, style: { finish: 'solid', font: 'l' }, anim: { in: 'zoom' } });
    const branches = (Array.isArray(s.branches) ? s.branches : []).slice(0, 12).map(obj);
    branches.forEach((br, i) => {
      const a = (i / Math.max(1, branches.length)) * Math.PI * 2 - Math.PI / 2;
      const c = color(i, br.color);
      const bx = ox + Math.cos(a) * 560, by = oy + Math.sin(a) * 380;
      const node = add('card', { x: bx - 130, y: by - 60, w: 260, h: 120, title: text(br.title, 200), text: text(br.text, 600), color: c, style: { finish: 'tinted' }, anim: { in: 'pop', delay: 0.2 + i * 0.1 } });
      connect(center, node, { style: { end: 'none', width: 5, color: c } });
      const kids = (Array.isArray(br.children) ? br.children : []).slice(0, 8);
      kids.forEach((k, j) => {
        const spread = (j - (kids.length - 1) / 2) * 0.22;
        const ka = a + spread, kx = ox + Math.cos(ka) * 980, ky = oy + Math.sin(ka) * 700;
        const kid = add('note', { x: kx - 100, y: ky - 50, w: 200, h: 100, text: text(k, 400), color: c, anim: { in: 'pop', delay: 0.5 + j * 0.06 } });
        connect(node, kid, { style: { end: 'none', width: 3, color: c } });
      });
    });
  } else if (layout === 'kanban') {
    const cols = (Array.isArray(s.columns) ? s.columns : []).slice(0, 10).map(obj);
    cols.forEach((c, i) => {
      const cards = (Array.isArray(c.cards) ? c.cards : []).slice(0, 30);
      const h = Math.max(420, 120 + cards.length * 130);
      add('frame', { x: ox + i * 400, y: oy, w: 360, h, title: text(c.title, 120) || `Column ${i + 1}`, color: color(i, c.color), style: { shadow: 'sunk' } });
      cards.forEach((t, j) => add('note', { x: ox + i * 400 + 30, y: oy + 80 + j * 130, w: 300, h: 110, text: text(t, 600), color: color(i, c.color) }));
    });
  } else if (layout === 'timeline') {
    const ms = (Array.isArray(s.milestones) ? s.milestones : []).slice(0, 40).map(obj);
    const start = add('shape', { x: ox - 30, y: oy - 30, w: 60, h: 60, data: { shape: 'ellipse' }, color: '#ffb020', style: { finish: 'solid' } });
    let last = start;
    ms.forEach((m, i) => {
      const x = ox + (i + 1) * 340;
      const dot = add('shape', { x: x - 22, y: oy - 22, w: 44, h: 44, data: { shape: 'ellipse' }, color: color(i, m.color), style: { finish: 'solid' }, anim: { in: 'pop', delay: i * 0.15 } });
      connect(last, dot, { style: { kind: 'tunnel', end: 'none', width: 14, flow: true, color: '#ff8a3d' } });
      const up = i % 2 === 0;
      const card = add('card', { x: x - 130, y: up ? oy - 250 : oy + 70, w: 260, h: 170, title: text(m.title, 200), text: [text(m.date, 40), text(m.text, 600)].filter(Boolean).join(' · '), color: color(i, m.color), anim: { in: 'rise', delay: 0.2 + i * 0.15 } });
      connect(dot, card, { style: { end: 'dot', dash: 'dotted', width: 2, color: color(i, m.color) } });
      last = dot;
    });
  } else {
    const notes = (Array.isArray(s.notes) ? s.notes : []).slice(0, 60);
    notes.forEach((t, i) => add('note', { x: ox + (i % 5) * 250, y: oy + Math.floor(i / 5) * 220, text: text(t, 800), color: color(i, null) }));
  }
  if (s.title && layout !== 'slides' && layout !== 'mindmap') {
    const b = bounds(out.items) || { x0: ox, y0: oy, w: 600 };
    add('text', { x: b.x0, y: b.y0 - 150, w: Math.max(600, b.w), h: 90, text: text(s.title, 200), style: { font: 'xl', weight: 800 } });
  }
  out.items.forEach((it, i) => { if (!it.z) it.z = i + 1; });
  return out;
}
