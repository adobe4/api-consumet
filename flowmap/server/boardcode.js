// Board code: the board written as simple HTML-like markup, so an AI can read it like a web page and edit it
// like code. Frames hold their contents (child coordinates are relative to the frame), text is the element's
// body, styles are attributes. The AI sends back the edited code and FlowMap applies only what changed.
//
//   <board name="Launch plan" floor="dots">
//     <frame id="i1" x="0" y="0" w="1100" h="620" title="Why it works" color="#2fb4a0" finish="tinted">
//       <text id="i2" x="70" y="60" w="640" h="130" size="46" bold>3 moves that doubled my views</text>
//       <note id="i3" x="700" y="250" w="320" h="280" paper="lined" pin="tape" rot="2" hand>Say the result first</note>
//     </frame>
//     <link from="i2" to="i3" kind="drawn" end="arrow"/>
//   </board>
import { applyLook, itemFromSpec } from './boards.js';
import { makeLink, sanitizeBoard } from '../shared/board.js';

// ---------- what each attribute means ----------
const STYLE_ATTRS = { finish: 'finish', shadow: 'shadow', radius: 'radius', size: 'size', align: 'align', 'text-color': 'textColor', font: 'family', stroke: 'strokeW', 'stroke-color': 'strokeC', 'stroke-dash': 'strokeD' };
const FLAG_STYLE = { bold: 'bold', muted: 'muted', hand: 'hand' };
const DATA_ATTRS = {
  shape: ['shape'], paper: ['note'], lift: ['note'], pin: ['note'], cover: ['hide'], metal: ['clip'], kind: ['clip'],
  head: ['arrow'], tail: ['arrow'], thickness: ['arrow'], url: ['image', 'link', 'media'],
  every: ['habit', 'checklist'], length: ['habit'], 'on-miss': ['habit'], view: ['progress', 'stat'], target: ['progress'], value: ['progress'], unit: ['progress'], period: ['progress', 'stat'],
};
const NUM = new Set(['x', 'y', 'w', 'h', 'rot', 'radius', 'size', 'stroke', 'thickness', 'length', 'target', 'value', 'delay']);
const READ_ONLY = new Set(['columns', 'rows', 'client', 'total', 'file', 'ticks']);
const r1 = (n) => Math.round(n * 10) / 10;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const escBody = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unesc = (s) => String(s).replace(/&#10;/g, '\n').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// the attributes of one item (everything the AI may see and change), as strings
function attrsOf(it, ox, oy, idOf) {
  const a = {};
  const s = it.style || {}, d = it.data || {}, an = it.anim || {};
  a.x = String(r1(it.x - ox)); a.y = String(r1(it.y - oy)); a.w = String(r1(it.w)); a.h = String(r1(it.h));
  if (it.rot) a.rot = String(r1(it.rot));
  if (it.title && it.type !== 'habit' && it.type !== 'progress' && it.type !== 'table' && it.type !== 'stat') a.title = it.title;
  if (it.color) a.color = it.color;
  if (it.locked) a.locked = '';
  for (const [k, sk] of Object.entries(STYLE_ATTRS)) if (s[sk] !== undefined && s[sk] !== '' && !(sk === 'strokeW' && !s[sk])) a[k] = String(s[sk]);
  if (s.font && !s.size) a.size = s.font; // older size names still show
  if (s.weight >= 700) a.bold = '';
  if (s.muted) a.muted = '';
  if (s.hand && s.family !== 'hand') a.hand = '';
  if (an.in && an.in !== 'pop' && an.in !== 'none') a.enter = an.in;
  if (an.in === 'none') a.enter = 'none';
  if (an.loop && an.loop !== 'none') a.loop = an.loop;
  if (an.delay) a.delay = String(an.delay);
  for (const [k, types] of Object.entries(DATA_ATTRS)) {
    if (!types.includes(it.type)) continue;
    const v = k === 'thickness' ? d.body : k === 'on-miss' ? d.onMiss : d[k];
    if (v !== undefined && v !== null && v !== '') a[k] = String(v);
  }
  if (it.type === 'frame' && it.text) a.notes = it.text;
  if (d.jump && idOf(d.jump)) a.jump = idOf(d.jump);
  if (d.jumpLabel) a['jump-label'] = d.jumpLabel;
  if (d.movable) a.movable = '';
  if (d.source && idOf(d.source)) a.source = idOf(d.source);
  // facts the AI can read but not change
  if (it.type === 'table') { a.columns = (d.cols || []).map((c) => c.name).join(', '); a.rows = String((d.rows || []).length); }
  if (it.type === 'invoice') { if (d.to?.name) a.client = d.to.name; }
  if (it.type === 'image' && d.fileId) a.file = 'uploaded';
  if (it.type === 'habit') a.ticks = String(Object.keys(d.log || {}).length);
  return a;
}
// the element's body: its text, or what the type keeps there
function bodyOf(it) {
  if (it.type === 'flip') return it.data?.back || '';
  if (it.type === 'frame' || it.type === 'checklist' || it.type === 'clip' || it.type === 'arrow' || it.type === 'image' || it.type === 'invoice') return '';
  if (it.type === 'habit' || it.type === 'progress' || it.type === 'table' || it.type === 'stat') return it.title || '';
  return it.text || '';
}
const fmtAttrs = (a) => Object.entries(a).map(([k, v]) => (v === '' ? ` ${k}` : ` ${k}="${esc(String(v).replace(/\n/g, '&#10;'))}"`).replace(/&amp;#10;/g, '&#10;')).join('');

// ---------- board → code ----------
const center = (i) => ({ x: i.x + i.w / 2, y: i.y + i.h / 2 });
const holds = (f, i) => { const c = center(i); return c.x >= f.x && c.x <= f.x + f.w && c.y >= f.y && c.y <= f.y + f.h; };
// opts.scope: item ids to show (with the frames around them as context); everything else stays out of the code
export function toCode(board, { name = '', scope = null } = {}) {
  const items = (board.items || []).filter((i) => i.type !== 'ink');
  const frames = items.filter((i) => i.type === 'frame');
  const short = new Map(), long = new Map();
  items.forEach((it, n) => { const s = `i${n + 1}`; short.set(it.id, s); long.set(s, it.id); });
  const idOf = (id) => short.get(id);
  const inScope = scope ? new Set(scope) : null;
  // the smallest frame around each item owns it
  const owner = new Map();
  for (const it of items) {
    if (it.type === 'frame') continue;
    const f = frames.filter((g) => holds(g, it)).sort((a, b) => a.w * a.h - b.w * b.h)[0];
    if (f) owner.set(it.id, f.id);
  }
  const lines = [];
  const el = (it, ox, oy, pad) => {
    const a = attrsOf(it, ox, oy, idOf);
    if (it.type === 'checklist') {
      const rows = (it.data?.items || []).map((x) => `${pad}  <li${x.done ? ' done' : ''}>${escBody(x.t)}</li>`);
      return `${pad}<checklist id="${idOf(it.id)}"${fmtAttrs(a)}>${it.title ? '' : ''}\n${rows.join('\n')}${rows.length ? '\n' : ''}${pad}</checklist>`;
    }
    const body = bodyOf(it);
    return body ? `${pad}<${it.type} id="${idOf(it.id)}"${fmtAttrs(a)}>${escBody(body)}</${it.type}>` : `${pad}<${it.type} id="${idOf(it.id)}"${fmtAttrs(a)}/>`;
  };
  const visible = (it) => !inScope || inScope.has(it.id);
  for (const f of frames) {
    const kids = items.filter((i) => owner.get(i.id) === f.id && visible(i));
    if (inScope && !inScope.has(f.id) && !kids.length) continue;
    const a = attrsOf(f, 0, 0, idOf);
    const ctx = inScope && !inScope.has(f.id) ? ' context' : '';
    lines.push(`  <frame id="${idOf(f.id)}"${fmtAttrs(a)}${ctx}>`);
    for (const k of kids) lines.push(el(k, f.x, f.y, '    '));
    lines.push('  </frame>');
  }
  for (const it of items) if (it.type !== 'frame' && !owner.has(it.id) && visible(it)) lines.push(el(it, 0, 0, '  '));
  const shown = new Set(items.filter(visible).map((i) => i.id));
  const linkKey = new Map();
  for (const l of board.links || []) {
    if (!l.from?.item || !l.to?.item || !short.has(l.from.item) || !short.has(l.to.item)) continue;
    if (inScope && !shown.has(l.from.item) && !shown.has(l.to.item)) continue;
    const s = l.style || {}, a = {};
    if (l.label) a.label = l.label;
    for (const k of ['kind', 'path', 'dash', 'start', 'end', 'color', 'width']) if (s[k] !== undefined && s[k] !== '' && !(k === 'kind' && s[k] === 'line') && !(k === 'path' && s[k] === 'curved') && !(k === 'dash' && s[k] === 'solid') && !(k === 'start' && s[k] === 'none') && !(k === 'end' && s[k] === 'arrow') && !(k === 'width' && s[k] === 3)) a[k] = String(s[k]);
    if (s.flow) a.flow = '';
    const from = idOf(l.from.item), to = idOf(l.to.item);
    linkKey.set(`${from}>${to}`, l.id);
    lines.push(`  <link from="${from}" to="${to}"${fmtAttrs(a)}/>`);
  }
  const slides = (board.order || []).map(idOf).filter(Boolean);
  const head = `<board${name ? ` name="${esc(name)}"` : ''} floor="${board.settings?.ground || 'dots'}"${slides.length ? ` slides="${slides.join(' ')}"` : ''}${scope ? ' scope' : ''}>`;
  return { code: `${head}\n${lines.join('\n')}\n</board>`, long, linkKey, count: items.length };
}

// ---------- a forgiving parser for the HTML-like code ----------
export function parseCode(text) {
  let src = String(text || '');
  const fence = src.match(/```(?:html|xml)?\s*([\s\S]*?)(```|$)/i);
  if (fence && /<board/i.test(fence[1])) src = fence[1];
  const start = src.search(/<board[\s>]/i);
  if (start < 0) throw new Error('no <board> in the answer');
  src = src.slice(start);
  const root = { tag: '#root', attrs: {}, kids: [], closed: true };
  const stack = [root];
  let complete = false;
  const re = /<!--[\s\S]*?-->|<\/\s*([a-z][\w-]*)\s*>|<([a-z][\w-]*)((?:\s+[\w-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>/]+))?)*)\s*(\/?)>|([^<]+)|(<)/gi;
  let m;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[0].startsWith('<!--')) continue;
    if (m[1]) { // a closing tag: close up to the matching element
      const tag = m[1].toLowerCase();
      const i = stack.map((e) => e.tag).lastIndexOf(tag);
      if (i > 0) { for (let k = stack.length - 1; k >= i; k--) stack[k].closed = true; stack.length = i; }
      if (tag === 'board') { complete = true; break; }
      continue;
    }
    if (m[2]) {
      const tag = m[2].toLowerCase(), attrs = {};
      const ar = /([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>/]+)))?/g;
      let a;
      while ((a = ar.exec(m[3] || ''))) attrs[a[1].toLowerCase()] = a[2] !== undefined ? unesc(a[2]) : a[3] !== undefined ? unesc(a[3]) : a[4] !== undefined ? unesc(a[4]) : '';
      const node = { tag, attrs, kids: [], text: '', closed: !!m[4] };
      top.kids.push(node);
      if (!m[4]) stack.push(node);
      continue;
    }
    if (m[5] !== undefined) { top.text += unesc(m[5]); continue; }
    if (m[6]) break; // a tag cut off at the end of the answer
  }
  const board = root.kids.find((k) => k.tag === 'board') || null;
  if (!board) throw new Error('no <board> in the answer');
  return { board, complete };
}

// ---------- code → changes on the board ----------
const TYPES = new Set(['note', 'card', 'text', 'shape', 'frame', 'flip', 'image', 'video', 'file', 'link', 'project', 'sticker', 'checklist', 'prompt', 'hide', 'clip', 'media', 'arrow', 'habit', 'progress', 'table', 'stat', 'invoice']);
const num = (v) => { const n = Number(String(v).replace(/px$/, '')); return Number.isFinite(n) ? n : undefined; };
const bodyText = (node) => node.text.replace(/^\s*\n/, '').replace(/\n\s*$/, '').replace(/^[ \t]+|[ \t]+$/g, '');
// turn changed attributes into the spec applyLook understands
function specOf(type, attrs, body, prev, resolve) {
  const o = {}, style = {}, anim = {};
  const has = (k) => k in attrs, gone = (k) => prev && k in prev && !(k in attrs);
  const changed = (k) => (has(k) && (!prev || prev[k] !== attrs[k])) || gone(k);
  for (const k of ['x', 'y', 'w', 'h', 'rot']) if (changed(k)) o[k] = has(k) ? num(attrs[k]) : k === 'rot' ? 0 : undefined;
  if (changed('title')) o.title = has('title') ? attrs.title : '';
  if (changed('color')) o.color = has('color') ? attrs.color : '';
  if (changed('locked')) o.locked = has('locked');
  for (const [k, sk] of Object.entries(STYLE_ATTRS)) {
    if (!changed(k)) continue;
    if (has(k)) style[sk] = NUM.has(k) && sk !== 'size' ? num(attrs[k]) : sk === 'size' ? (num(attrs[k]) ?? attrs[k]) : attrs[k];
    else style[sk] = sk === 'strokeW' ? 0 : sk === 'textColor' ? '' : null; // null: drop it
  }
  if (typeof style.size === 'string') { style.font = style.size; delete style.size; }
  for (const [k, sk] of Object.entries(FLAG_STYLE)) if (changed(k)) style[sk] = has(k) && attrs[k] !== 'false';
  if (changed('enter')) anim.in = has('enter') ? attrs.enter : 'pop';
  if (changed('loop')) anim.loop = has('loop') ? attrs.loop : 'none';
  if (changed('delay')) anim.delay = has('delay') ? num(attrs.delay) : 0;
  for (const k of Object.keys(DATA_ATTRS)) {
    if (!DATA_ATTRS[k].includes(type) || !changed(k)) continue;
    const key = k === 'kind' ? 'clip' : k === 'on-miss' ? 'onMiss' : k;
    if (has(k)) o[key] = NUM.has(k) ? num(attrs[k]) : attrs[k];
  }
  if (changed('jump')) o.jump = has('jump') ? resolve(attrs.jump) || '' : '';
  if (changed('jump-label')) o.jumpLabel = has('jump-label') ? attrs['jump-label'] : '';
  if (changed('movable')) o.movable = has('movable');
  if (type === 'frame' && changed('notes')) o.text = has('notes') ? attrs.notes : '';
  if (has('template')) o.template = attrs.template;
  if (has('currency')) o.currency = attrs.currency;
  if (Object.keys(style).length) o.style = style;
  if (Object.keys(anim).length) o.anim = anim;
  // the body
  if (body !== undefined) {
    if (type === 'flip') o.back = body;
    else if (type === 'sticker') { if (body) o.emoji = body; }
    else if (['habit', 'progress', 'table', 'stat'].includes(type)) o.title = body;
    else if (!['frame', 'checklist', 'clip', 'arrow', 'image', 'invoice'].includes(type)) o.text = body;
  }
  return o;
}
// the things applyLook cannot take away (a size, a finish...) are dropped by hand
function dropNulls(it, o) {
  if (!o.style) return;
  for (const [k, v] of Object.entries(o.style)) if (v === null) { delete it.style[k]; if (k === 'size') delete it.style.font; }
}

const DELETE_WORDS = /delete|remove|clear|erase|get rid|empty|start over|futa|ondoa/i;

// apply the AI's code to the board data. mode "full": the code is the whole (scoped) board, so attributes it
// leaves out are cleared and elements it leaves out are deleted; mode "patch": only what it wrote changes.
export function applyCode(board, reply, ctx, { mode = 'full', request = '', scope = null } = {}) {
  const { board: root, complete } = parseCode(reply);
  const d = structuredClone(board);
  const byId = new Map(d.items.map((i) => [i.id, i]));
  const before = toCode(board, { scope }); // the attributes as the AI saw them
  const prevAttrs = new Map(), prevParent = new Map();
  { // re-read what we showed, to know what the AI changed
    const { board: shown } = parseCode(before.code);
    const walk = (n, parent) => { for (const k of n.kids) { if (k.attrs.id) { prevAttrs.set(k.attrs.id, { attrs: k.attrs, body: k.tag === 'checklist' ? null : bodyText(k), lis: k.kids.filter((x) => x.tag === 'li').map((x) => `${'done' in x.attrs ? '[x] ' : ''}${bodyText(x)}`).join('\n') }); prevParent.set(k.attrs.id, parent); } walk(k, k.tag === 'frame' ? k.attrs.id : parent); } };
    walk(shown, null);
  }
  const full = mode === 'full' && complete;
  const refs = new Map(); // ids the AI invented for new things → real ids
  const replaced = new Map(), doomed = new Set();
  const resolve = (s) => { const id = ctx.long.get(s) || refs.get(s) || null; return (id && replaced?.get(id)) || id; };
  const seen = new Set(), stats = { changed: 0, added: 0, deleted: 0, links: 0, skipped: 0 };
  let z = Math.max(0, ...d.items.map((i) => i.z || 0)) + 1;
  const pendingJumps = [];
  const liText = (n) => n.kids.filter((x) => x.tag === 'li').map((x) => `${'done' in x.attrs && x.attrs.done !== 'false' ? '[x] ' : ''}${bodyText(x)}`);
  const create = (n, attrs, body, ox, oy) => {
    const o = specOf(n.tag, attrs, body, null, () => null);
    if (n.tag === 'checklist') o.items = liText(n);
    o.type = n.tag;
    delete o.jump;
    const fresh = itemFromSpec(o, { x: ox, y: oy });
    fresh.z = n.tag === 'frame' ? Math.min(0, ...d.items.map((i) => i.z || 0)) - 1 : z++;
    if (attrs.jump) pendingJumps.push([fresh, attrs.jump]);
    if (attrs.source) fresh.data.source = attrs.source;
    d.items.push(fresh); byId.set(fresh.id, fresh); stats.added++;
    if (n.attrs.id) refs.set(n.attrs.id, fresh.id);
    seen.add(fresh.id);
    return fresh;
  };
  const visit = (node, ox, oy, parentShort, parentIsContext, parentMoved) => {
    for (const n of node.kids) {
      if (n.tag === 'link' || n.tag === 'delete' || n.tag === 'summary' || n.tag === 'li') continue;
      if (!TYPES.has(n.tag)) { visit(n, ox, oy, parentShort, parentIsContext, parentMoved); continue; }
      if (!n.closed && n.tag !== 'frame') { stats.skipped++; continue; } // cut off: do not guess
      const realId = n.attrs.id ? ctx.long.get(n.attrs.id) : null;
      const it = realId ? byId.get(realId) : null;
      const prev = n.attrs.id ? prevAttrs.get(n.attrs.id) : null;
      const isContext = 'context' in n.attrs;
      for (const k of READ_ONLY) delete n.attrs[k];
      const body = n.tag === 'checklist' ? undefined : bodyText(n);
      // patch mode: attributes not written stay as they were
      const attrs = full || !prev ? n.attrs : { ...prev.attrs, ...n.attrs };
      if (it && it.type !== n.tag && !isContext) {
        // the AI turned it into another kind of item: a new one in its place, keeping its connections
        const fresh = create(n, attrs, body || prev?.body || '', ox, oy);
        replaced.set(it.id, fresh.id); doomed.add(it.id);
        if (n.tag === 'frame') visit(n, fresh.x, fresh.y, n.attrs.id, false, true);
        continue;
      }
      if (it) {
        seen.add(it.id);
        const ox0 = it.x, oy0 = it.y;
        if (!isContext) {
          const o = specOf(it.type, attrs, body !== undefined && (full || n.text.trim()) && body !== prev?.body ? body : undefined, prev?.attrs, resolve);
          if (n.tag === 'checklist') { const t = liText(n); if ((full || t.length) && t.join('\n') !== prev?.lis) o.items = t; }
          // its frame moved, or it went into another frame: its place comes from its own x/y again
          if (parentMoved || prevParent.get(n.attrs.id) !== parentShort) { o.x = num(attrs.x) ?? (it.x - ox); o.y = num(attrs.y) ?? (it.y - oy); }
          if (o.x !== undefined) o.x += ox; if (o.y !== undefined) o.y += oy;
          if ('source' in attrs && attrs.source !== prev?.attrs?.source) { const t = resolve(attrs.source); it.data = { ...it.data }; if (t) it.data.source = t; else delete it.data.source; stats.changed++; }
          if (Object.keys(o).length) { applyLook(it, o); dropNulls(it, o); stats.changed++; }
        }
        if (it.type === 'frame') visit(n, it.x, it.y, n.attrs.id, isContext, it.x !== ox0 || it.y !== oy0);
        continue;
      }
      if (isContext || (parentIsContext && n.tag === 'frame')) continue;
      const fresh = create(n, attrs, body, ox, oy);
      if (n.tag === 'frame') visit(n, fresh.x, fresh.y, n.attrs.id, false, true);
    }
  };
  visit(root, 0, 0, null, false, false);
  // connections of a replaced item move to its replacement
  for (const l of d.links) { if (replaced.has(l.from?.item)) l.from = { item: replaced.get(l.from.item) }; if (replaced.has(l.to?.item)) l.to = { item: replaced.get(l.to.item) }; }
  for (const [old, now] of replaced) d.order = d.order.map((x) => (x === old ? now : x));
  for (const [it, j] of pendingJumps) { const t = resolve(j); if (t) it.data = { ...it.data, jump: t }; }
  // sources of progress views and stats point at real ids
  for (const it of d.items) if (it.data?.source && !byId.has(it.data.source)) { const t = resolve(it.data.source); if (t) it.data = { ...it.data, source: t }; else delete it.data.source; }
  // explicit deletes, and in full mode everything that was shown but left out
  const walkDel = (n) => { for (const k of n.kids) { if (k.tag === 'delete' && k.attrs.id) { const t = ctx.long.get(k.attrs.id); if (t) doomed.add(t); } walkDel(k); } };
  walkDel(root);
  if (full) {
    const shownIds = new Set([...prevAttrs.keys()].map((s) => ctx.long.get(s)).filter(Boolean));
    const contextIds = new Set([...prevAttrs.entries()].filter(([, v]) => 'context' in v.attrs).map(([s]) => ctx.long.get(s)));
    for (const id of shownIds) if (!seen.has(id) && !contextIds.has(id)) doomed.add(id);
  }
  const total = scope ? scope.length : d.items.filter((i) => i.type !== 'ink').length;
  if (doomed.size - replaced.size > 3 && doomed.size - replaced.size > total * 0.4 && !DELETE_WORDS.test(request)) { stats.keptBack = doomed.size - replaced.size; for (const id of [...doomed]) if (!replaced.has(id)) doomed.delete(id); }
  if (doomed.size) {
    d.items = d.items.filter((i) => !doomed.has(i.id));
    d.links = d.links.filter((l) => !doomed.has(l.from?.item) && !doomed.has(l.to?.item));
    d.order = d.order.filter((x) => !doomed.has(x));
    stats.deleted = doomed.size - replaced.size;
  }
  // connections: matched by their two ends
  const linkSeen = new Set();
  const walkLinks = (n) => { for (const k of n.kids) { if (k.tag === 'link') handleLink(k); else walkLinks(k); } };
  const handleLink = (k) => {
    const from = resolve(k.attrs.from), to = resolve(k.attrs.to);
    if (!from || !to || from === to || doomed.has(from) || doomed.has(to)) return;
    const s = {};
    for (const key of ['kind', 'path', 'dash', 'start', 'end', 'color']) if (k.attrs[key]) s[key] = k.attrs[key];
    if (k.attrs.width) s.width = num(k.attrs.width);
    s.flow = 'flow' in k.attrs && k.attrs.flow !== 'false';
    const existing = ctx.linkKey.get(`${k.attrs.from}>${k.attrs.to}`);
    const l = existing ? d.links.find((x) => x.id === existing) : null;
    if (l) {
      linkSeen.add(l.id);
      const norm = (st) => ({ kind: 'line', path: 'curved', dash: 'solid', start: 'none', end: 'arrow', width: 3, color: '', flow: false, ...st });
      const next = norm(s), cur = norm(l.style), label = k.attrs.label || '';
      const keys = ['kind', 'path', 'dash', 'start', 'end', 'width', 'color', 'flow'];
      if (keys.some((x) => String(next[x]) !== String(cur[x])) || label !== (l.label || '')) { l.style = { ...l.style, ...Object.fromEntries(keys.map((x) => [x, next[x]])) }; l.label = label; stats.links++; }
    } else if (!d.links.some((x) => x.from?.item === from && x.to?.item === to)) {
      const nl = makeLink({ item: from }, { item: to }, { label: k.attrs.label || '', style: s });
      d.links.push(nl); linkSeen.add(nl.id); stats.links++;
    }
  };
  walkLinks(root);
  if (full) for (const [key, id] of ctx.linkKey) { if (!linkSeen.has(id)) { const [f, t] = key.split('>'); if (resolve(f) && resolve(t) && d.links.some((l) => l.id === id)) { d.links = d.links.filter((l) => l.id !== id); stats.links++; } } }
  // the board itself
  if (['dots', 'grid', 'plain'].includes(root.attrs.floor) && root.attrs.floor !== (board.settings?.ground || 'dots')) { d.settings = { ...d.settings, ground: root.attrs.floor }; stats.changed++; }
  if (typeof root.attrs.slides === 'string') {
    const order = root.attrs.slides.split(/[\s,]+/).map(resolve).filter((id) => id && d.items.some((i) => i.id === id && i.type === 'frame'));
    if (order.join() !== d.order.join() && (order.length || full)) { d.order = order; stats.changed++; }
  }
  const summary = (() => { const s = root.kids.find((k) => k.tag === 'summary'); return s ? bodyText(s).slice(0, 400) : ''; })();
  const touched = new Set([...d.items].filter((i) => { const b = board.items.find((x) => x.id === i.id); return !b || JSON.stringify(b) !== JSON.stringify(i); }).map((i) => i.id));
  return { data: sanitizeBoard(d), stats, summary, touched, complete, name: root.attrs.name };
}

// the language, for the AI
export const CODE_GUIDE = `BOARD CODE: the board is written like HTML. Every item is an element; a <frame> holds the items inside it, and their x/y are RELATIVE to the frame's top-left corner (move a frame and its contents move with it). Items outside frames use board coordinates. Units are px; x grows right, y grows down.
Elements: frame, text, card, note, shape, sticker, checklist (<li> rows, <li done> = ticked), flip (title = front, body = back), prompt, hide, clip, arrow, link (a web link card), image, habit, progress, table, stat, invoice, media.
The element body is its text (a sticker's body is its icon like i:rocket or an emoji). <link from="i2" to="i5"/> is a connection between two items.
Attributes:
 x y w h rot · title (frames, cards, flips) · color="#hex" (main colour) · locked
 finish="soft|tinted|solid|glass|flat|none" · shadow="sunk|flat|raised|float" · radius="0-60" · size="text px" · bold · muted · hand (handwriting) · align="left|center|right" · text-color="#hex" · font="sans|round|display|serif|hand|marker|mono" · stroke="px" stroke-color="#hex" stroke-dash="solid|dashed|dotted"
 enter="pop|fade|rise|zoom|draw|slide|none" loop="bounce|pulse|wiggle|float|spin|glow" delay="s" (presenting animations)
 shape="rect|round|pill|ellipse|diamond|triangle|hexagon|star|arrow|bubble" · paper="sticky|lined|spiral|grid|index|kraft|torn|aged" lift="flat|lifted|curled" pin="none|tape|pin|clip" (notes) · cover="blur|frost|solid|curtain" (hide) · kind="paperclip|binder|pin|tape" metal="silver|gold|copper|black|color" (clip) · head/tail="triangle|wide|thin|round|bar|none" thickness (arrow) · url
 jump="i7" (tapping glides to that item) jump-label · movable
 habit: every="day|week|hour|2h" length="182" on-miss="mark|restart" · progress: view="ring|bar|calendar|line|number" source="i4" target value unit · stat: source view="number|months|split" period · table: template="sales|expenses|debts|goals" currency
 frame: notes="speaker notes" · link: label kind="line|tunnel|raised|drawn" path="curved|straight|elbow" dash start/end="none|arrow|triangle|dot|diamond|bar" color width flow
 Read-only facts you will see (do not change them): columns, rows, client, file, ticks.
<board floor="dots|grid|plain" slides="i1 i9 i14"> (slides = frames in presenting order).`;
