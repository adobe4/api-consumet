// Boards: free canvases for planning, explaining and presenting. Shared by the browser (editor, templates)
// and the server (validation, and the AI tools that build boards from a plain description).
//
// A board's data:
//   { v: 1, items: [Item], links: [Link], order: [frameId], settings: { ground, snap } }
// Item:  { id, type, x, y, w, h, rot, z, locked, title, text, color, style: {}, data: {}, anim: {} }
// Link:  { id, from: { item } | { x, y }, to: { item } | { x, y }, label, style: { kind, path, dash, start, end, color, width, flow } }

export const ITEM_TYPES = ['note', 'card', 'text', 'shape', 'frame', 'flip', 'image', 'video', 'file', 'link', 'project', 'sticker', 'ink', 'checklist', 'prompt', 'hide', 'clip', 'media', 'arrow'];
export const SHAPES = ['rect', 'round', 'pill', 'ellipse', 'diamond', 'triangle', 'hexagon', 'star', 'arrow', 'bubble'];
export const LINK_KINDS = ['line', 'tunnel', 'raised', 'drawn'];
export const LINK_PATHS = ['curved', 'straight', 'elbow'];
export const LINK_DASH = ['solid', 'dashed', 'dotted'];
export const LINK_ENDS = ['none', 'arrow', 'triangle', 'dot', 'diamond', 'bar'];
export const FINISHES = ['soft', 'tinted', 'solid', 'flat', 'glass'];
export const SHADOWS = ['flat', 'raised', 'float', 'sunk'];
export const ANIM_IN = ['none', 'pop', 'fade', 'rise', 'zoom', 'draw', 'slide'];
export const ANIM_LOOP = ['none', 'bounce', 'pulse', 'wiggle', 'float', 'spin', 'glow'];
export const FONT_SIZES = ['s', 'm', 'l', 'xl', 'xxl'];
// the old size names, in px; style.size (a number) wins when set
export const FONT_PX = { s: 12, m: 14.5, l: 20, xl: 32, xxl: 52 };
// sticky notes as real paper
export const PAPERS = ['sticky', 'lined', 'spiral', 'grid', 'index', 'kraft', 'torn', 'aged'];
export const LIFTS = ['flat', 'lifted', 'curled'];
export const NOTE_PINS = ['none', 'tape', 'pin', 'clip'];
export const ALIGNS = ['left', 'center', 'right'];
export const GROUNDS = ['dots', 'grid', 'plain'];
// clips: things that hold paper down. A wire paperclip, a binder clip, a push pin or a strip of tape.
export const CLIP_KINDS = ['paperclip', 'binder', 'pin', 'tape'];
export const CLIP_METALS = ['silver', 'gold', 'copper', 'black', 'color'];
export const CLIP_SIZE = { paperclip: [46, 128], binder: [96, 86], pin: [54, 62], tape: [168, 46] };
export const PALETTE = ['#ff4d5e', '#ff8a5c', '#ffb020', '#e8b86b', '#b8e04a', '#4be38a', '#2fb4a0', '#e07a5f', '#ff6fae', '#c9a27e', '#8a7b6d', '#f5f1ea'];

export const DEFAULT_SIZE = {
  note: [220, 180], card: [280, 170], text: [320, 60], shape: [200, 140], frame: [1100, 620], flip: [240, 240], image: [320, 240],
  video: [360, 240], file: [260, 90], link: [300, 110], project: [280, 150], sticker: [72, 72], ink: [10, 10], checklist: [280, 220], prompt: [360, 220], hide: [320, 200], clip: [46, 128], media: [320, 300], arrow: [320, 120],
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
// The look: a bold, tactile canvas. Dark label bars with big white text, stacked with even gaps inside a
// tinted frame; soft pressed-in cards in one warm accent per group; thick tunnel connectors; slight tilts
// and the odd clip on paper. Never a table of identical boxes.
// spec.layout: 'slides' | 'workflow' | 'mindmap' | 'kanban' | 'timeline' | 'notes'
//  slides:    [{ title, points: [string], note, emoji }]          -> 16:9 frames, one per slide, in order
//  nodes/edges: [{ id, title, text, color, group }], [{ from, to, label }] -> a left-to-right flow
//  center + branches: [{ title, children: [string] }]              -> a mind map
//  columns:   [{ title, cards: [string] }]                          -> a kanban
//  milestones:[{ title, date, text }]                               -> a timeline
export const INK = '#1c1916';
export const ACCENTS = ['#2fb4a0', '#e8b86b', '#ff8a5c', '#e07a5f', '#b8e04a', '#ffb020', '#ff6fae', '#c9a27e'];
const SOFT_TEXT = '#e9dfd2';
export function generateBoard(spec, { origin = { x: 0, y: 0 }, style = {} } = {}) {
  const s = obj(spec);
  const layout = pick(s.layout, ['slides', 'workflow', 'mindmap', 'kanban', 'timeline', 'notes'], s.slides ? 'slides' : s.nodes ? 'workflow' : s.branches ? 'mindmap' : s.columns ? 'kanban' : s.milestones ? 'timeline' : 'notes');
  const out = { items: [], links: [], order: [] };
  const add = (type, props) => { const it = makeItem(type, props); out.items.push(it); return it; };
  const connect = (a, b, props = {}) => { const l = makeLink({ item: a.id }, { item: b.id }, { ...props, style: { kind: 'line', path: 'curved', dash: 'solid', start: 'none', end: 'arrow', width: 3, ...style.link, ...props.style } }); out.links.push(l); return l; };
  const color = (i, c) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : ACCENTS[i % ACCENTS.length]);
  const { x: ox, y: oy } = origin;
  const text = (v, n) => str(typeof v === 'string' ? v : v == null ? '' : String(v), n);
  // gentle, repeatable tilt so notes look hand-placed
  const tilt = (i) => [-2.2, 1.6, -1.1, 2.4, -1.8, 0.9][i % 6];
  const clip = (x, y, kind, i, props = {}) => add('clip', { x, y, w: CLIP_SIZE[kind][0], h: CLIP_SIZE[kind][1], rot: kind === 'tape' ? tilt(i) * 1.5 : -8 + tilt(i) * 2, data: { kind, metal: kind === 'binder' ? 'black' : kind === 'paperclip' ? 'silver' : 'color' }, color: kind === 'pin' ? color(i + 2, null) : kind === 'tape' ? '#f3e3b3' : '', ...props });
  // a dark label bar: shape underneath, white heading, softer detail beside it, an optional number chip
  const headW = (head, big) => 40 + head.length * (big === 'l' ? 11.5 : 8.6);
  const bar = (x, y, w, h, { head, detail = '', num = 0, accent, delay = 0, headWidth = 0 }) => {
    add('shape', { x, y, w, h, color: INK, data: { shape: 'rect' }, style: { finish: 'solid', shadow: 'raised', radius: 12 }, anim: { in: 'rise', delay } });
    let tx = x + 24;
    if (num) {
      const d = Math.min(38, h - 16);
      add('shape', { x: x + 14, y: y + (h - d) / 2, w: d, h: d, color: accent, text: String(num), data: { shape: 'ellipse' }, style: { finish: 'solid', shadow: 'flat', font: 'm', weight: 800, textColor: INK }, anim: { in: 'pop', delay: delay + 0.05 } });
      tx = x + 14 + d + 16;
    }
    const big = h >= 60 ? 'l' : 'm';
    const hw = detail ? Math.max(150, Math.min((w - (tx - x)) * 0.42, headWidth || headW(head, big))) : w - (tx - x) - 20;
    add('text', { x: tx, y, w: hw, h, text: head, style: { font: big, weight: 800, textColor: '#ffffff', align: 'left' }, anim: { in: 'fade', delay: delay + 0.08 } });
    if (detail) add('text', { x: tx + hw + 14, y, w: x + w - (tx + hw + 14) - 20, h, text: detail, style: { font: 'm', textColor: SOFT_TEXT, align: 'left' }, anim: { in: 'fade', delay: delay + 0.12 } });
  };

  if (layout === 'slides') {
    const slides = (Array.isArray(s.slides) ? s.slides : []).slice(0, 60);
    const FW = 1100, FH = 620, GX = 180, GY = 200, PER_ROW = 4;
    let prev = null;
    slides.forEach((sl, n) => {
      const o = obj(sl);
      const c = color(n, o.color);
      const fx = ox + (n % PER_ROW) * (FW + GX), fy = oy + Math.floor(n / PER_ROW) * (FH + GY);
      const frame = add('frame', { x: fx, y: fy, w: FW, h: FH, title: `${n + 1}. ${text(o.title, 120) || 'Slide'}`, color: c, style: { shadow: 'raised', finish: 'tinted' }, data: { notes: text(o.note, 4000) } });
      out.order.push(frame.id);
      add('text', { x: fx + 70, y: fy + 56, w: FW - 260, h: 90, text: text(o.title, 160) || `Slide ${n + 1}`, style: { font: 'xl', weight: 800 }, anim: { in: 'rise' } });
      if (o.subtitle) add('text', { x: fx + 70, y: fy + 142, w: FW - 260, h: 46, text: text(o.subtitle, 300), style: { font: 'm', muted: true }, anim: { in: 'fade', delay: 0.15 } });
      const pts = (Array.isArray(o.points) ? o.points : []).slice(0, 6).map((p) => text(p, 400)).filter(Boolean);
      // up to 4 points: one column of wide bars; 5 or 6: two columns
      const two = pts.length > 4, perCol = two ? Math.ceil(pts.length / 2) : pts.length || 1;
      const top = fy + (o.subtitle ? 214 : 196), room = fy + FH - 56 - top, gap = 16;
      const bh = Math.min(two ? 96 : 84, (room - (perCol - 1) * gap) / perCol), bw = two ? (FW - 140 - 24) / 2 : FW - 140;
      const parts = pts.map((p) => { const [head, ...rest] = p.split(/:\s+/); return rest.length ? [head, rest.join(': ')] : [p, '']; });
      // one heading width per slide, so every detail starts on the same line
      const headWidth = Math.max(0, ...parts.filter(([, d]) => d).map(([hd]) => headW(hd, bh >= 60 ? 'l' : 'm')));
      parts.forEach(([head, detail], i) => {
        const col = two ? Math.floor(i / perCol) : 0, row = two ? i % perCol : i;
        bar(fx + 70 + col * (bw + 24), top + row * (bh + gap), bw, bh, { head, detail, num: i + 1, accent: c, delay: 0.25 + i * 0.12, headWidth });
      });
      if (o.emoji) add('sticker', { x: fx + FW - 160, y: fy + 46, w: 92, h: 92, text: text(o.emoji, 40), color: c, anim: { in: 'pop', loop: 'bounce', delay: 0.6 } });
      if (prev && n % PER_ROW) connect(prev, frame, { style: { kind: 'tunnel', width: 8, end: 'none', color: c, flow: true } });
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
    const CW = 300, CH = 150, GX = 170, GY = 70;
    const byKey = new Map();
    [...cols.keys()].sort((a, b) => a - b).forEach((l) => {
      const list = cols.get(l);
      const total = list.length * CH + (list.length - 1) * GY;
      list.forEach((n, i) => {
        const c = color(l + i, n.color), x = ox + l * (CW + GX), y = oy - total / 2 + i * (CH + GY);
        const props = { x, y, w: CW, h: CH, title: text(n.title, 200), text: text(n.text, 1200), color: c, anim: { in: 'pop', delay: l * 0.2 + i * 0.08 } };
        // a note stays a note; a node with only a title becomes a dark label; the rest are soft pressed cards
        const it = n.kind === 'note' ? add('note', { ...props, rot: tilt(l + i) })
          : n.kind === 'shape' || !n.text ? add('shape', { ...props, h: 74, y: y + (CH - 74) / 2, text: props.title || props.text, color: n.kind === 'shape' ? c : INK, data: { shape: n.kind === 'shape' ? 'pill' : 'rect' }, style: { finish: 'solid', shadow: 'raised', radius: 14, font: 'l', weight: 800, ...(n.kind === 'shape' ? {} : { textColor: '#ffffff' }) } })
          : add('card', { ...props, style: { finish: 'tinted', shadow: 'raised', radius: 18, font: 'l' } });
        byKey.set(n.key, it);
      });
    });
    for (const e of edges) { const from = byKey.get(text(e.from, 60)); connect(from, byKey.get(text(e.to, 60)), { label: text(e.label, 120), style: { kind: 'tunnel', width: 8, color: from.color === INK ? '#ff8a5c' : from.color, flow: !!e.flow || !!style.flow } }); }
    // groups become tinted frames drawn around their members
    const groups = new Map();
    nodes.forEach((n) => { if (n.group) (groups.get(n.group) || groups.set(n.group, []).get(n.group)).push(byKey.get(n.key)); });
    [...groups].forEach(([g, members], i) => {
      const b = bounds(members);
      const f = add('frame', { x: b.x0 - 50, y: b.y0 - 90, w: b.w + 100, h: b.h + 140, title: text(g, 120), color: color(i, null), style: { shadow: 'raised', finish: 'tinted' } });
      f.z = -10;
    });
  } else if (layout === 'mindmap') {
    const center = add('shape', { x: ox - 160, y: oy - 85, w: 320, h: 170, text: text(s.center || s.title, 200) || 'Main idea', color: INK, data: { shape: 'ellipse' }, style: { finish: 'solid', font: 'xl', weight: 800, textColor: '#ffffff', shadow: 'float' }, anim: { in: 'zoom' } });
    const branches = (Array.isArray(s.branches) ? s.branches : []).slice(0, 12).map(obj);
    branches.forEach((br, i) => {
      const a = (i / Math.max(1, branches.length)) * Math.PI * 2 - Math.PI / 2;
      const c = color(i, br.color);
      const bx = ox + Math.cos(a) * 580, by = oy + Math.sin(a) * 400;
      const node = add('card', { x: bx - 140, y: by - 62, w: 280, h: 124, title: text(br.title, 200), text: text(br.text, 600), color: c, style: { finish: 'tinted', shadow: 'raised', radius: 18, font: 'l' }, anim: { in: 'pop', delay: 0.2 + i * 0.1 } });
      connect(center, node, { style: { kind: 'tunnel', end: 'none', width: 10, color: c } });
      const kids = (Array.isArray(br.children) ? br.children : []).slice(0, 8);
      kids.forEach((k, j) => {
        const spread = (j - (kids.length - 1) / 2) * 0.22;
        const ka = a + spread, kx = ox + Math.cos(ka) * 1000, ky = oy + Math.sin(ka) * 720;
        const kid = add('note', { x: kx - 105, y: ky - 55, w: 210, h: 110, text: text(k, 400), color: c, rot: tilt(i + j), anim: { in: 'pop', delay: 0.5 + j * 0.06 } });
        connect(node, kid, { style: { end: 'none', width: 3, color: c, kind: 'drawn' } });
      });
    });
  } else if (layout === 'kanban') {
    const cols = (Array.isArray(s.columns) ? s.columns : []).slice(0, 10).map(obj);
    cols.forEach((c, i) => {
      const cards = (Array.isArray(c.cards) ? c.cards : []).slice(0, 30);
      const h = Math.max(440, 130 + cards.length * 136);
      const accent = color(i, c.color), x = ox + i * 420;
      add('frame', { x, y: oy, w: 370, h, title: text(c.title, 120) || `Column ${i + 1}`, color: accent, style: { shadow: 'raised', finish: 'tinted' } });
      bar(x + 24, oy + 40, 322, 58, { head: text(c.title, 60) || `Column ${i + 1}`, detail: '', num: cards.length, accent, delay: i * 0.1 });
      cards.forEach((t, j) => add('note', { x: x + 34, y: oy + 124 + j * 136, w: 302, h: 112, text: text(t, 600), color: accent, rot: tilt(i + j) * 0.6, anim: { in: 'pop', delay: 0.2 + j * 0.06 } }));
      if (cards.length) clip(x + 260, oy + 108, 'paperclip', i);
    });
  } else if (layout === 'timeline') {
    const ms = (Array.isArray(s.milestones) ? s.milestones : []).slice(0, 40).map(obj);
    const start = add('shape', { x: ox - 32, y: oy - 32, w: 64, h: 64, data: { shape: 'ellipse' }, color: INK, style: { finish: 'solid', shadow: 'raised' } });
    let last = start;
    ms.forEach((m, i) => {
      const x = ox + (i + 1) * 360, c = color(i, m.color);
      const dot = add('shape', { x: x - 24, y: oy - 24, w: 48, h: 48, data: { shape: 'ellipse' }, color: c, style: { finish: 'solid', shadow: 'raised' }, anim: { in: 'pop', delay: i * 0.15 } });
      connect(last, dot, { style: { kind: 'tunnel', end: 'none', width: 12, flow: true, color: c } });
      const up = i % 2 === 0;
      const card = add('card', { x: x - 140, y: up ? oy - 270 : oy + 80, w: 280, h: 180, title: text(m.title, 200), text: [text(m.date, 40), text(m.text, 600)].filter(Boolean).join(' · '), color: c, style: { finish: 'tinted', shadow: 'raised', radius: 18, font: 'l' }, anim: { in: 'rise', delay: 0.2 + i * 0.15 } });
      if (m.date) bar(x - 90, up ? oy - 330 : oy + 274, 180, 46, { head: text(m.date, 30), accent: c, delay: 0.3 + i * 0.15 });
      connect(dot, card, { style: { end: 'dot', dash: 'dotted', width: 2, color: c } });
      last = dot;
    });
  } else {
    const notes = (Array.isArray(s.notes) ? s.notes : []).slice(0, 60);
    notes.forEach((t, i) => {
      const x = ox + (i % 5) * 270, y = oy + Math.floor(i / 5) * 250;
      add('note', { x, y, w: 220, h: 180, text: text(t, 800), color: color(i, null), rot: tilt(i), data: { paper: ['sticky', 'lined', 'sticky', 'index', 'kraft'][i % 5], pin: ['pin', 'tape', 'none', 'tape', 'pin'][i % 5] }, anim: { in: 'pop', delay: i * 0.05 } });
    });
  }
  if (s.title && layout !== 'slides' && layout !== 'mindmap') {
    const b = bounds(out.items) || { x0: ox, y0: oy, w: 600 };
    add('text', { x: b.x0, y: b.y0 - 150, w: Math.max(600, b.w), h: 90, text: text(s.title, 200), style: { font: 'xl', weight: 800 } });
  }
  out.items.forEach((it, i) => { if (!it.z) it.z = it.type === 'frame' ? -100 + i : i + 1; });
  return out;
}
