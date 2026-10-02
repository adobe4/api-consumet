// The board editor: an infinite tactile canvas for planning, explaining and presenting.
// Items are DOM elements on the shared surface; connections and drawings are SVG in the same world space.
import { h, clear, debounce, setText, raw } from '../util.js';
import { icon as svgIcon } from '../icons.js';
import { api } from '../api.js';
import { S, projects, project, notify, saveSettings, updateAiKey, keyModels, nvidiaModels } from '../store.js';
import { openBrainSettings } from '../brain-ui.js';
import { snapshotBoard } from './snapshot.js';
import { createSurface, route, drawLink, drawLabel, svgEl, LINK_DEFAULT } from '../surface.js';
import { makeItem, makeLink, newId, bounds, inside, PALETTE, DEFAULT_SIZE, CLIP_SIZE, FONT_PX } from '/shared/board.js';
import { CLIP_DEFAULT, CLIP_LABEL, METAL_LABEL, clipSvg } from './clips.js';
import { buildItem, contentKey, SHAPE_LABEL, TYPE_LABEL } from './items.js';
import { uploadFile, saveVideo, pickFiles, fileText } from './files.js';
import { openPop, closePop, segRow, swatchRow, toggleRow, rangeRow } from '../pop.js';
import { linkStyleBody } from '../looks.js';
import { startPresenting } from './present.js';
import { openShareDialog } from './share.js';
import { openModal } from '../ui-common.js';

const COLORS = ['', ...PALETTE];
const ICON_STICKERS = ['arrow-right', 'arrow-left', 'arrow-up', 'arrow-down', 'arrow-up-right', 'mouse-pointer-click', 'pointer', 'check', 'x', 'circle-check', 'circle-x', 'star', 'flame', 'rocket', 'lightbulb', 'target', 'zap', 'trophy', 'crown', 'heart', 'thumbs-up', 'party-popper', 'sparkles', 'badge-check', 'circle-alert', 'circle-question-mark', 'info', 'trending-up', 'trending-down', 'banknote', 'clock', 'pin', 'flag', 'megaphone', 'bell', 'gift', 'eye', 'hand'].map((n) => `i:${n}`);
const STICKERS = ['👉', '👈', '👆', '👇', '➡️', '⬅️', '⬆️', '⬇️', '↗️', '✅', '❌', '⭐', '🔥', '🚀', '💡', '🎯', '💰', '📈', '📉', '❤️', '👏', '🎉', '😂', '🤯', '😮', '⚠️', '❓', '❗', '💯', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '🎬', '📌', '🧠', '⏰'];
const DEF_FINISH = { note: 'tinted', card: 'soft', shape: 'solid', frame: 'raised', flip: 'soft', image: 'soft', video: 'soft', file: 'soft', link: 'soft', project: 'soft', checklist: 'soft', prompt: 'soft', text: 'none', sticker: 'none', ink: 'none', hide: 'none', clip: 'none' };
const TOOLS = [
  ['select', '↖', 'Select & move (V)', 'v'], ['multi', 'i:square-dashed-mouse-pointer', 'Select several (M): tap items to add or remove them, drag a box around them', 'm'], ['hand', '✋', 'Move the board (H or hold Space)', 'h'],
  ['note', '🗒️', 'Sticky note (N)', 'n'], ['card', '▭', 'Card (C)', 'c'], ['text', 'i:type', 'Text (T)', 't'], ['shape', '◆', 'Shapes (S)', 's'],
  ['frame', '▦', 'Frame / slide (F)', 'f'], ['flip', '🂠', 'Flip card', ''], ['checklist', '☑', 'Checklist', ''], ['prompt', '✦', 'Prompt with copy button (P)', 'p'],
  ['hide', '🙈', 'Hide: a blur or cover you tap away to reveal (R)', 'r'],
  ['connector', '⤳', 'Connect (L)', 'l'], ['pen', '✏️', 'Draw (D)', 'd'], ['highlight', '🖍️', 'Highlighter', ''], ['eraser', '⌫', 'Eraser (E)', 'e'],
  ['sticker', '😀', 'Stickers & arrows', ''], ['clip', 'i:paperclip', 'Paper clips, pins & tape (U)', 'u'], ['image', '🖼️', 'Image: link or upload', 'i'], ['file', '📎', 'Attach a text file', ''], ['video', '🎬', 'Video from this device', ''],
  ['link', '🔗', 'Web link', ''], ['project', '📊', 'Live project from your tracker', ''], ['laser', 'i:spotlight', 'Laser pointer (X)', 'x'],
];

export function createEditor(host, { board, share = null, onBack, onRenamed }) {
  const readonly = !!share;
  let data = { v: 1, items: [], links: [], order: [], settings: {}, ...board.data };
  data.items ||= []; data.links ||= []; data.order ||= []; data.settings ||= {};
  let version = board.version, name = board.name, icon = board.icon || '';
  let tool = 'select', toolLock = false, sticker = 'i:arrow-right', shapeKind = 'round', penColor = '#ff7a2f';
  let clipKind = 'paperclip', clipMetal = 'silver', clipColor = '';
  let notePaper = 'sticky', noteLift = 'lifted', notePinKind = 'none';
  const sel = new Set();
  const els = new Map(), linkEls = new Map(), inkEls = new Map();
  let editing = null, undo = [], redo = [], destroyed = false, drag = null;
  // locked (stage) mode: for recording and explaining. Nothing is edited; covers tap away, movable things move,
  // and all of it snaps back with Reset. Presenting and shared links behave the same way.
  let locked = false, tapEl = null;
  const revealed = new Set(), stageBackup = new Map(), checkBackup = new Map();
  const staged = () => readonly || locked || root.classList.contains('presenting');

  // ---------- layout ----------
  const root = h('div', { class: `bd${readonly ? ' readonly' : ''}` });
  host.append(root);
  const surfaceHost = h('div', { class: 'bd-canvas' });
  root.append(surfaceHost);
  const sf = createSurface(surfaceHost, {
    minK: 0.05, maxK: 5, className: 'sf-board',
    onPointerDown: (e, w) => pointerDown(e, w),
    onContext: (e, w) => contextMenu(e, w),
    onDoubleClick: (e, w) => dblClick(e, w),
  });
  const floor = h('div', { class: 'sf-floor' });
  sf.world.insertBefore(floor, sf.under);
  const linkLayer = svgEl('g', {}, sf.under);
  const inkLayer = svgEl('g', { class: 'ink' }, sf.over);
  const ghost = svgEl('path', { class: 'bd-ghost', fill: 'none' }, sf.over);
  const selBox = h('div', { class: 'bsel', hidden: true },
    ...['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((d) => h('i', { class: `hd hd-${d}`, 'data-h': d })),
    h('i', { class: 'hd hd-rot', 'data-h': 'rot', title: 'Rotate' }), h('i', { class: 'hd hd-link', 'data-h': 'link', title: 'Drag to connect' }, '⤳'));
  sf.layer.append(selBox);
  const marquee = h('div', { class: 'bmarq', hidden: true });
  sf.overlay.append(marquee);
  const laserCanvas = h('canvas', { class: 'bd-laser' });
  sf.overlay.append(laserCanvas);
  const ctxBar = h('div', { class: 'bctx', hidden: true });
  sf.overlay.append(ctxBar);

  // top bar
  const nameEl = h('div', { class: 'bd-name', contenteditable: readonly ? 'false' : 'true', spellcheck: 'false', title: readonly ? '' : 'Rename' }, raw(name));
  const iconBtn = h('button', { class: 'bd-icon', type: 'button', title: readonly ? '' : 'Change icon', onclick: (e) => !readonly && pickIcon(e.currentTarget) }, icon || '🧩');
  const status = h('span', { class: 'bd-status' }, readonly ? 'View only' : 'Saved');
  const undoBtn = h('button', { class: 'btn icon bd-editonly', type: 'button', title: 'Undo (Ctrl+Z)', onclick: () => doUndo() }, '↶');
  const lockBtn = h('button', { class: 'btn bd-lock', type: 'button', title: 'Lock the board (K): nothing can be edited, covers tap away and only things you marked movable move. For recording and explaining.', onclick: () => setLocked(!locked) }, h('span', { class: 'lk-ic' }, '🔓'), h('span', { class: 'lbl-txt' }, 'Lock'));
  const redoBtn = h('button', { class: 'btn icon bd-editonly', type: 'button', title: 'Redo (Ctrl+Shift+Z)', onclick: () => doRedo() }, '↷');
  const top = h('div', { class: 'bd-top' },
    onBack ? h('button', { class: 'btn', type: 'button', onclick: () => onBack() }, '←', h('span', { class: 'lbl-txt' }, 'Boards')) : null,
    iconBtn, nameEl, status, h('span', { class: 'spacer' }),
    readonly ? null : undoBtn, readonly ? null : redoBtn,
    readonly ? null : lockBtn,
    readonly ? null : h('button', { class: 'btn bd-editonly bd-ai', type: 'button', title: 'Ask AI to change this board: restyle, tidy, add, rewrite', onclick: (e) => aiPop(e.currentTarget) }, '✨', h('span', { class: 'lbl-txt' }, 'AI')),
    h('button', { class: 'btn icon', type: 'button', title: 'Floor, grid and snapping', onclick: (e) => boardLook(e.currentTarget) }, '🎨'),
    readonly ? null : h('button', { class: 'btn bd-editonly', type: 'button', title: 'Share a link to this board', onclick: () => openShareDialog(board) }, '🔗', h('span', { class: 'lbl-txt' }, 'Share')),
    h('button', { class: 'btn bd-full', type: 'button', title: 'Full screen (F11)', onclick: () => toggleFull() }, '⛶'),
    h('button', { class: 'btn primary', type: 'button', title: 'Present: slides, laser, spotlight, pen', onclick: () => present() }, '▶', h('span', { class: 'lbl-txt' }, 'Present')));
  root.append(top);
  nameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); } });
  nameEl.addEventListener('blur', () => { const v = nameEl.textContent.trim().slice(0, 80) || 'Untitled board'; nameEl.textContent = v; if (v !== name) { name = v; onRenamed?.(name, icon); save(); } });

  // tools
  const toolbar = h('div', { class: 'bd-tools', role: 'toolbar', 'aria-label': 'Board tools' });
  if (!readonly) root.append(toolbar);
  // media tools live behind one "Insert" button so the bar fits any screen
  const INSERT = ['image', 'file', 'video', 'link', 'project'];
  for (const [id, ic, label] of TOOLS) {
    if (INSERT.includes(id) || id === 'highlight') continue;
    if (id === 'laser') toolbar.append(h('i', { class: 'tsep' }));
    const b = h('button', { type: 'button', class: 'tool', 'data-t': id, 'aria-label': label, title: label }, h('span', { class: 'ic' }, ic));
    b.addEventListener('click', () => setTool(id, { lock: false }));
    b.addEventListener('dblclick', () => setTool(id, { lock: true }));
    toolbar.append(b);
    if (id === 'sticker') {
      const ins = h('button', { type: 'button', class: 'tool', 'data-t': 'insert', 'aria-label': 'Insert image, file, video, link or project', title: 'Insert: image, file, video, link, live project' }, h('span', { class: 'ic' }, '＋'));
      ins.addEventListener('click', () => openPop({ anchor: ins, title: 'Insert', width: 280, body: h('div', { class: 'plist' }, TOOLS.filter((t) => INSERT.includes(t[0])).map(([tid, tic, tlabel]) => h('button', { type: 'button', class: 'mi', onclick: () => { closePop(); setTool(tid); } }, h('span', { class: 'mic' }, tic), tlabel.replace(/ \(\w\)$/, '')))) }));
      toolbar.append(ins);
    }
  }
  const toolBtn = (t) => toolbar.querySelector(`[data-t="${t}"]`) || toolbar.querySelector('[data-t="insert"]');
  const zoomBar = h('div', { class: 'bd-zoom' },
    h('button', { class: 'btn icon', type: 'button', title: 'Zoom out', onclick: () => sf.zoomBy(0.8) }, '－'),
    h('button', { class: 'btn bd-pct', type: 'button', title: 'Fit everything', onclick: () => fitAll() }, '100%'),
    h('button', { class: 'btn icon', type: 'button', title: 'Zoom in', onclick: () => sf.zoomBy(1.25) }, '＋'));
  root.append(zoomBar);
  const pct = zoomBar.querySelector('.bd-pct');
  sf.onCamera((c) => { pct.textContent = `${Math.round(c.k * 100)}%`; selBox.style.setProperty('--hk', String(1 / c.k)); placeCtxBar(); });

  function setTool(t, { lock = false } = {}) {
    if (readonly && !['select', 'hand', 'laser'].includes(t)) return;
    tool = t; toolLock = lock;
    toolbar.querySelectorAll('.tool').forEach((b) => { b.classList.toggle('on', b.dataset.t === t); b.classList.toggle('locked', b.dataset.t === t && lock); });
    root.dataset.tool = t;
    closePop();
    if (t === 'shape') shapePicker(toolbar.querySelector('[data-t="shape"]'));
    if (t === 'sticker') stickerPicker(toolbar.querySelector('[data-t="sticker"]'));
    if (t === 'clip') clipPicker(toolbar.querySelector('[data-t="clip"]'));
    if (t === 'note') paperPicker(toolbar.querySelector('[data-t="note"]'));
    if (t === 'pen' || t === 'highlight') penPicker(toolBtn(t));
    if (t === 'image') imagePicker(toolBtn('image'));
    if (t === 'file') { attachFiles(); setTool('select'); }
    if (t === 'video') { addVideo(); setTool('select'); }
    if (t === 'project') projectPicker(toolBtn('project'));
  }

  // ---------- data helpers ----------
  const byId = (id) => data.items.find((i) => i.id === id);
  const linkById = (id) => data.links.find((l) => l.id === id);
  const snapshot = () => JSON.stringify({ items: data.items, links: data.links, order: data.order });
  let before = null;
  function begin() { if (!before) before = snapshot(); }
  function commit() {
    const now = snapshot();
    if (before && before !== now) { undo.push(before); if (undo.length > 100) undo.shift(); redo = []; save(); }
    before = null;
    updateUndoBtns();
  }
  function change(fn) { begin(); fn(); render(); commit(); }
  function restore(snap) { const s = JSON.parse(snap); data.items = s.items; data.links = s.links; data.order = s.order; sel.clear(); render(); save(); }
  function doUndo() { if (!undo.length) return; redo.push(snapshot()); restore(undo.pop()); updateUndoBtns(); }
  function doRedo() { if (!redo.length) return; undo.push(snapshot()); restore(redo.pop()); updateUndoBtns(); }
  function updateUndoBtns() { undoBtn.disabled = !undo.length; redoBtn.disabled = !redo.length; }
  const maxZ = () => data.items.reduce((m, i) => Math.max(m, i.z || 0), 0);
  const minZ = () => data.items.reduce((m, i) => Math.min(m, i.z || 0), 0);

  // ---------- saving ----------
  let saving = false, pending = false;
  const save = debounce(async () => {
    if (readonly) return; // runs even after leaving the board, so the last change is never lost
    if (saving) { pending = true; return; }
    saving = true; status.textContent = 'Saving…'; status.dataset.s = 'saving';
    try {
      const out = stageBackup.size ? { ...data, items: data.items.map((i) => (stageBackup.has(i.id) ? { ...i, ...stageBackup.get(i.id) } : i)) } : data;
      const r = await api('PUT', `/api/boards/${board.id}`, { name, icon, data: out, version });
      version = r.version; board.version = r.version;
      status.textContent = 'Saved'; status.dataset.s = 'ok';
    } catch (e) {
      if (e.status === 409 && e.data?.latest) {
        data = e.data.latest.data; version = e.data.latest.version; sel.clear(); stageBackup.clear(); revealed.clear(); render();
        notify('This board was changed on another device. You now see the latest version.', 'error');
        status.textContent = 'Saved'; status.dataset.s = 'ok';
      } else { status.textContent = 'Not saved, retrying…'; status.dataset.s = 'err'; setTimeout(() => save(), 4000); }
    } finally { saving = false; if (pending) { pending = false; save(); } }
  }, 700);
  // save right now (before the AI reads the board on the server)
  async function flushSave() {
    for (let i = 0; i < 80 && saving; i++) await new Promise((r) => setTimeout(r, 100));
    const out = stageBackup.size ? { ...data, items: data.items.map((i) => (stageBackup.has(i.id) ? { ...i, ...stageBackup.get(i.id) } : i)) } : data;
    const r = await api('PUT', `/api/boards/${board.id}`, { name, icon, data: out, version });
    version = r.version; board.version = r.version;
  }

  // ---------- render ----------
  const finishOf = (it) => it.style?.finish || DEF_FINISH[it.type] || 'soft';
  function render() {
    if (destroyed) return;
    const seen = new Set();
    for (const it of [...data.items].sort((a, b) => (a.z || 0) - (b.z || 0))) {
      seen.add(it.id);
      if (it.type === 'ink') { renderInk(it); continue; }
      let el = els.get(it.id);
      if (!el) {
        el = h('div', { class: 'bi', 'data-id': it.id });
        els.set(it.id, el);
      }
      const parent = it.type === 'frame' ? floor : sf.layer;
      if (el.parentNode !== parent) parent.append(el); // stacking comes from z-index, so nothing is re-inserted
      const key = contentKey(it);
      if (el._key !== key) { el._key = key; clear(el).append(...buildItem(it, ctx)); }
      layout(el, it);
    }
    for (const [id, el] of [...els]) if (!seen.has(id)) { el.remove(); els.delete(id); }
    for (const [id, p] of [...inkEls]) if (!seen.has(id)) { p.remove(); inkEls.delete(id); }
    if (selBox.parentNode) sf.layer.append(selBox);
    renderLinks();
    renderSlideNumbers();
    updateSel();
  }
  function layout(el, it) {
    const s = it.style || {};
    el.className = `bi t-${it.type} fin-${finishOf(it)} sh-${s.shadow || 'raised'} f-${s.font || 'm'} al-${s.align || (it.type === 'text' || it.type === 'prompt' ? 'left' : 'center')}${s.weight >= 700 ? ' bold' : ''}${s.muted ? ' muted' : ''}${it.locked ? ' locked' : ''}${sel.has(it.id) ? ' sel' : ''}${it.anim?.loop && it.anim.loop !== 'none' ? ` lp-${it.anim.loop}` : ''}${it.type === 'shape' ? ` sh-${it.data?.shape || 'round'}` : ''}${it.type === 'flip' && it.data?.flipped ? ' flipped' : ''}${editing === it.id ? ' editing' : ''}${it.type === 'hide' ? ` cv-${it.data?.cover || 'blur'} tap-${it.data?.tap || 'reveal'}` : ''}${it.data?.movable ? ' movable' : ''}${revealed.has(it.id) ? ' revealed' : ''}${it.type === 'note' ? ` pp-${it.data?.paper || 'sticky'} lift-${it.data?.lift || 'lifted'}` : ''}${s.hand ? ' hand' : ''}`;
    el.style.left = `${it.x}px`; el.style.top = `${it.y}px`; el.style.width = `${it.w}px`; el.style.height = `${it.h}px`;
    el.style.transform = it.rot ? `rotate(${it.rot}deg)` : '';
    // clips sit on the paper they hold, covers sit over everything
    el.style.zIndex = String(Math.round(it.z || 0) + 10000 + (it.type === 'clip' ? 400000 : it.type === 'hide' ? 500000 : 0));
    el.style.setProperty('--c', it.color || (it.type === 'note' ? '#ffb020' : it.type === 'shape' ? '#ff8a5c' : 'var(--accent)'));
    if (s.textColor) el.style.setProperty('--tc', s.textColor); else el.style.removeProperty('--tc');
    if (typeof s.radius === 'number') el.style.setProperty('--r', `${s.radius}px`); else el.style.removeProperty('--r');
    el.style.fontSize = typeof s.size === 'number' ? `${s.size}px` : '';
  }
  function renderInk(it) {
    let p = inkEls.get(it.id);
    if (!p) { p = svgEl('path', { 'data-id': it.id, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'ink-path' }, inkLayer); inkEls.set(it.id, p); }
    const d = it.data || {}, pts = d.points || [], sx = it.w / (d.w0 || it.w || 1), sy = it.h / (d.h0 || it.h || 1);
    p.setAttribute('d', smoothPath(pts.map(([x, y]) => [it.x + x * sx, it.y + y * sy])));
    p.setAttribute('stroke', it.color || '#ff7a2f');
    p.setAttribute('stroke-width', String(d.width || 4));
    p.setAttribute('opacity', d.mode === 'highlight' ? '0.38' : '1');
    p.classList.toggle('sel', sel.has(it.id));
    p.classList.toggle('hl', d.mode === 'highlight');
  }
  function smoothPath(pts) {
    if (!pts.length) return '';
    if (pts.length < 3) return `M${pts[0][0]},${pts[0][1]} ${pts.map(([x, y]) => `L${x},${y}`).join(' ')}`;
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 1; i < pts.length - 1; i++) { const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2; d += ` Q${pts[i][0]},${pts[i][1]} ${mx},${my}`; }
    const l = pts[pts.length - 1];
    return `${d} L${l[0]},${l[1]}`;
  }
  const endBox = (end) => { if (end?.item) { const it = byId(end.item); return it ? { x: it.x, y: it.y, w: it.w, h: it.h } : null; } return end ? { x: end.x, y: end.y } : null; };
  function renderLinks() {
    const seen = new Set();
    for (const l of data.links) {
      const A = endBox(l.from), B = endBox(l.to);
      if (!A || !B) continue;
      seen.add(l.id);
      let g = linkEls.get(l.id);
      if (!g) { g = svgEl('g', {}, linkLayer); linkEls.set(l.id, g); }
      const st = { ...LINK_DEFAULT, ...l.style };
      const r = route(A, B, st.path, { gap: st.kind === 'line' ? 6 : 2 });
      drawLink(g, r, st, sf.id, { hot: sel.has(l.id), hitId: l.id, speed: 2.2 });
      g.style.setProperty('--link', st.color || 'var(--link-default)');
      drawLabel(g, r, l.label);
      g.dataset.id = l.id;
    }
    for (const [id, g] of [...linkEls]) if (!seen.has(id)) { g.remove(); linkEls.delete(id); }
  }
  function renderSlideNumbers() {
    for (const it of data.items) if (it.type === 'frame') {
      const n = data.order.indexOf(it.id);
      const tag = els.get(it.id)?.querySelector('.slide-no');
      if (tag) { tag.textContent = n >= 0 ? `Slide ${n + 1}` : ''; tag.hidden = n < 0; }
    }
  }

  // ---------- selection ----------
  function selBounds() {
    const its = [...sel].map(byId).filter(Boolean);
    return its.length ? bounds(its) : null;
  }
  function updateSel() {
    for (const [id, el] of els) el.classList.toggle('sel', sel.has(id));
    for (const [id, p] of inkEls) p.classList.toggle('sel', sel.has(id));
    for (const [id, g] of linkEls) g.classList.toggle('hot', sel.has(id));
    const its = [...sel].map(byId).filter(Boolean);
    if (!its.length || readonly) { selBox.hidden = true; ctxBar.hidden = true; if (sel.size && [...sel].some(linkById)) showCtxBar(); return; }
    const single = its.length === 1 ? its[0] : null;
    const b = single ? { x0: single.x, y0: single.y, w: single.w, h: single.h } : bounds(its);
    selBox.hidden = false;
    Object.assign(selBox.style, { left: `${b.x0}px`, top: `${b.y0}px`, width: `${b.w}px`, height: `${b.h}px`, transform: single?.rot ? `rotate(${single.rot}deg)` : '' });
    selBox.classList.toggle('multi', !single);
    selBox.classList.toggle('lock', its.some((i) => i.locked));
    showCtxBar();
  }
  function select(ids, { add = false } = {}) {
    if (!add) sel.clear();
    for (const id of ids) sel.add(id);
    updateSel();
  }
  function toggleSel(id) { if (sel.has(id)) sel.delete(id); else sel.add(id); updateSel(); }

  // ---------- context toolbar (above the selection) ----------
  function showCtxBar() {
    if (readonly || drag) { ctxBar.hidden = true; return; }
    const its = [...sel].map(byId).filter(Boolean), lks = [...sel].map(linkById).filter(Boolean);
    if (!its.length && !lks.length) { ctxBar.hidden = true; return; }
    const b = (fn, label, title) => h('button', { type: 'button', class: 'cb', title, onclick: (e) => { e.stopPropagation(); fn(e.currentTarget); } }, label);
    const first = its[0];
    const kids = [];
    if (its.length) {
      kids.push(h('button', { type: 'button', class: 'cb cdot', title: 'Colour', style: { '--c': first.color || 'var(--accent)' }, onclick: (e) => colorPop(e.currentTarget) }));
      if (its.some((i) => i.type === 'note')) kids.push(b(paperPop, '🗒️', 'Paper: kind, colour, how it sits'));
      if (its.some((i) => ['card', 'shape', 'frame', 'flip', 'image', 'video', 'file', 'link', 'project', 'checklist', 'prompt'].includes(i.type))) kids.push(b(stylePop, '◐', 'Finish & shadow'));
      if (its.some((i) => ['note', 'card', 'text', 'shape', 'flip', 'prompt', 'checklist', 'frame'].includes(i.type))) kids.push(b(textPop, 'Aa', 'Text size & alignment'));
      if (first.type === 'shape' && its.length === 1) kids.push(b(shapeSwap, '◆', 'Change shape'));
      kids.push(b(animPop, '✨', 'Animation'));
      if (its.length === 1 && first.type === 'flip') kids.push(b(() => flip(first), '🂠', 'Flip'));
      if (its.some((i) => i.type === 'hide')) kids.push(b(hidePop, '🙈', 'Cover style and what a tap does'));
      if (its.some((i) => i.type === 'clip')) kids.push(b(clipPop, '📎', 'Clip: kind, metal and colour'));
      if (its.length === 1 && first.type !== 'ink') kids.push(h('button', { type: 'button', class: `cb${first.data?.jump ? ' on' : ''}`, title: 'Jump link: tap it to glide to another place on the board', onclick: (e) => { e.stopPropagation(); jumpPop(e.currentTarget); } }, '⌖'));
      kids.push(h('button', { type: 'button', class: `cb${its.every((i) => i.data?.movable) ? ' on' : ''}`, title: 'Movable when the board is locked or presenting', onclick: (e) => { e.stopPropagation(); toggleMovable(its); } }, '✋'));
      if (its.length === 1 && first.type === 'frame') kids.push(b(() => toggleSlide(first), data.order.includes(first.id) ? '★' : '☆', data.order.includes(first.id) ? 'Remove from slides' : 'Add to slides'));
      kids.push(b(() => change(() => its.forEach((i) => { i.locked = !i.locked; })), its.every((i) => i.locked) ? '🔒' : '🔓', 'Lock / unlock'));
    }
    if (lks.length) kids.push(b((btn) => linkPop(lks, btn), '⤳', 'Connection style'), b(() => editLabel(lks[0]), '🏷', 'Label'));
    kids.push(b(() => duplicate(), '⧉', 'Duplicate (Ctrl+D)'), b(() => removeSel(), '🗑', 'Delete'), b((btn) => { const r = btn.getBoundingClientRect(); contextMenu({ clientX: r.left, clientY: r.bottom + 6, target: els.get(first?.id) || btn, preventDefault() {} }, null, true); }, '⋯', 'More'));
    clear(ctxBar).append(...kids);
    ctxBar.hidden = false;
    placeCtxBar();
  }
  function placeCtxBar() {
    if (ctxBar.hidden) return;
    const its = [...sel].map(byId).filter(Boolean);
    let x, y;
    if (its.length) { const bb = bounds(its); const a = sf.toScreen(bb.x0 + bb.w / 2, bb.y0); x = a.x; y = a.y - 16; }
    else { const l = [...sel].map(linkById).filter(Boolean)[0]; const A = endBox(l.from), B = endBox(l.to); const r = route(A, B, l.style?.path); const a = sf.toScreen(r.mid.x, r.mid.y); x = a.x; y = a.y - 24; }
    const { W } = sf.size, cw = ctxBar.offsetWidth || 300;
    ctxBar.style.left = `${Math.max(8, Math.min(W - cw - 8, x - cw / 2))}px`;
    ctxBar.style.top = `${Math.max(66, y - 48)}px`;
  }

  // ---------- pointer ----------
  function pointerDown(e, w) {
    if (e.target.closest('.bd-top, .bd-tools, .bctx, .bd-zoom, .bd-back, .pick-hint')) return 'handled';
    if (picking) { const id = hitItem(e); if (!id) return 'pan'; if (id !== picking && e.button === 0) finishPick(id); return 'handled'; }
    const jb = e.target.closest('[data-act="jump"]');
    if (jb && e.button === 0) { itemAction(jb, e); return 'handled'; }
    if (staged()) return stageDown(e, w);
    // copy buttons and flip cards answer a tap in every mode, including view-only links and the hand tool
    const copyBtn = e.target.closest('[data-act="copy"]');
    if (copyBtn && e.button === 0) { itemAction(copyBtn, e); return 'handled'; }
    if (tool === 'hand') {
      const fl = e.target.closest('.bi.t-flip');
      if (fl && e.button === 0) { flip(byId(fl.dataset.id), true); return 'handled'; }
      if (e.target.closest('video, a')) return 'handled';
    }
    if (tool === 'hand') return 'pan';
    if (tool === 'laser') { laserDown(e); return 'handled'; }
    const edit = e.target.closest('.ed[contenteditable="true"]');
    if (edit) return 'handled';
    const actBtn = e.target.closest('[data-act]:not([data-act="open-file"])'); // files open with a double-click, so they can still be dragged
    if (actBtn && e.button === 0) { itemAction(actBtn, e); return 'handled'; }
    if (e.target.closest('video, a')) return 'handled';
    const handle = e.target.closest('.hd');
    if (handle) { startHandle(e, handle.dataset.h, w); return 'handled'; }
    if (tool === 'pen' || tool === 'highlight') { startInk(e, w); return 'handled'; }
    if (tool === 'eraser') { startErase(e); return 'handled'; }
    if (tool === 'connector') { startConnect(e, w, hitItem(e)); return 'handled'; }
    if (['note', 'card', 'text', 'shape', 'frame', 'flip', 'checklist', 'prompt', 'sticker', 'link', 'hide', 'clip'].includes(tool)) { startCreate(e, w); return 'handled'; }
    const itId = hitItem(e);
    const lkId = e.target.closest?.('[data-link]')?.dataset.link;
    const multi = tool === 'multi';
    if (itId) {
      if (e.shiftKey || e.ctrlKey || e.metaKey) { toggleSel(itId); return 'handled'; }
      // select several: a tap adds or removes; dragging moves everything selected
      if (multi) { const had = sel.has(itId); if (!had) select([itId], { add: true }); startMove(e, w, had ? itId : null); return 'handled'; }
      if (!sel.has(itId)) select([itId]);
      startMove(e, w);
      return 'handled';
    }
    if (lkId) { select([lkId], { add: e.shiftKey || multi }); return 'handled'; }
    // on touch an empty-space drag moves the board, unless you are selecting several
    if (e.pointerType !== 'mouse' && !multi) { if (!e.shiftKey) select([]); return 'pan'; }
    startMarquee(e, w, multi);
    return 'handled';
  }
  const hitItem = (e) => { const el = hitAt(e).closest?.('.bi, .ink-path'); return el?.dataset.id || null; };
  // after a click the board holds the pointer, so the browser reports the board itself as the target:
  // look at what is really under the pointer
  function hitAt(e) {
    const t = e.target;
    if (t && t !== sf.root && t.closest?.('.bi, .ink-path, [data-link], .hd')) return t;
    return (Number.isFinite(e.clientX) && document.elementFromPoint(e.clientX, e.clientY)) || t || sf.root;
  }

  // ---------- locked / presenting / shared: tap, reveal, move what may move ----------
  function stageDown(e, w) {
    const t = e.target;
    tapEl = null;
    const act = t.closest('[data-act="copy"], [data-act="open-attach"], [data-act="open-file"], [data-act="check"]');
    if (act && e.button === 0) { itemAction(act, e); return 'handled'; }
    if (t.closest('video, a')) return 'handled';
    if (tool === 'laser' && !root.classList.contains('presenting')) { laserDown(e); return 'handled'; }
    const el = t.closest('.bi'), it = el && byId(el.dataset.id);
    if (!it || e.button !== 0) return 'pan';
    const tap = it.type === 'hide' ? it.data?.tap || 'reveal' : null;
    if (tap === 'reveal') { reveal(it, el); return 'handled'; }
    if (it.data?.jump && !it.data?.movable && it.type !== 'flip') { onTap(e, () => jumpFrom(it)); return 'handled'; }
    if (it.type === 'flip') { flip(it, true); return 'handled'; }
    if (tap === 'move' || it.data?.movable) { stageMove(e, w, it); return 'handled'; }
    if (it.type !== 'frame' && tap !== 'none') tapEl = el;
    return 'pan';
  }
  sf.root.addEventListener('sf-tap', () => { if (tapEl && staged()) tapFx(tapEl); tapEl = null; });
  function tapFx(el) {
    const fx = data.settings.tapFx || 'highlight';
    if (fx === 'none') return;
    el.classList.remove('fx-highlight', 'fx-shake', 'fx-pop');
    void el.offsetWidth;
    el.classList.add(`fx-${fx}`);
    clearTimeout(el._fx); el._fx = setTimeout(() => el.classList.remove(`fx-${fx}`), 1300);
  }
  function reveal(it, el) {
    revealed.add(it.id);
    el.classList.add('revealed');
    updateStageBar();
  }
  function stageMove(e, w, lead) {
    const carry = new Set([lead.id]);
    if (lead.type === 'frame') for (const it of data.items) if (inside(it, lead)) carry.add(it.id);
    const moving = [...carry].map(byId).filter(Boolean).map((i) => ({ it: i, x: i.x, y: i.y }));
    for (const m of moving) if (!stageBackup.has(m.it.id)) stageBackup.set(m.it.id, { x: m.it.x, y: m.it.y });
    const el = els.get(lead.id);
    el?.classList.add('lifted');
    drag = { kind: 'stage' };
    track(e, (ev) => {
      const p = wOf(ev), dx = p.x - w.x, dy = p.y - w.y;
      for (const m of moving) { m.it.x = m.x + dx; m.it.y = m.y + dy; const me = els.get(m.it.id); if (me) { me.style.left = `${m.it.x}px`; me.style.top = `${m.it.y}px`; } if (m.it.type === 'ink') renderInk(m.it); }
      renderLinks();
    }, () => { drag = null; el?.classList.remove('lifted'); updateStageBar(); });
  }
  function resetStage() {
    for (const [id, p] of stageBackup) { const it = byId(id); if (it) { it.x = p.x; it.y = p.y; } }
    for (const [id, items] of checkBackup) { const it = byId(id); if (it) it.data = { ...it.data, items: JSON.parse(items) }; }
    stageBackup.clear(); revealed.clear(); checkBackup.clear();
    render(); updateStageBar();
  }
  const stageBar = h('div', { class: 'stage-bar', hidden: true });
  root.append(stageBar);
  const FX = [['highlight', '✨ Glow'], ['shake', '〰 Shake'], ['pop', '⬆ Pop'], ['none', 'Nothing']];
  function updateStageBar() {
    const on = staged() && !root.classList.contains('presenting');
    const changed = stageBackup.size + revealed.size + checkBackup.size > 0;
    stageBar.hidden = !on || (readonly && !changed);
    if (stageBar.hidden) return;
    const fx = data.settings.tapFx || 'highlight';
    clear(stageBar).append(
      readonly ? null : h('span', { class: 'sb-lab' }, h('i', { class: 'sb-dot' }), 'Locked'),
      h('button', { type: 'button', class: 'btn sm', disabled: !changed, title: 'Put covers back and moved things where they were', onclick: () => resetStage() }, '↺ Reset'),
      readonly ? null : h('button', { type: 'button', class: 'btn sm', title: 'What happens when you tap something', onclick: (ev) => openPop({ anchor: ev.currentTarget, title: 'When I tap something', width: 330, body: h('div', { class: 'pgrid' },
        segRow('Effect', FX, fx, (v) => { data.settings.tapFx = v; save(); updateStageBar(); }),
        h('p', { class: 'phint' }, 'Covers (🙈 Hide) disappear when tapped. Things you marked ✋ movable can be dragged; everything else just reacts. Reset puts it all back.')) }) }, `Tap: ${FX.find((f) => f[0] === fx)[1]}`),
      readonly ? null : h('button', { type: 'button', class: 'btn sm primary', onclick: () => setLocked(false) }, '🔓 Unlock'));
  }
  function setLocked(v) {
    if (readonly) return;
    if (editing) document.activeElement?.blur?.();
    locked = v;
    root.classList.toggle('staged', v);
    nameEl.contentEditable = v ? 'false' : 'true';
    lockBtn.classList.toggle('on', v);
    setText(lockBtn.querySelector('.lk-ic'), v ? '🔒' : '🔓');
    lockBtn.querySelector('.lbl-txt').textContent = v ? 'Locked' : 'Lock';
    closePop(); closeMenu();
    if (v) { select([]); if (tool !== 'laser') setTool('select'); } else resetStage();
    updateStageBar();
  }
  function track(e, move, up) {
    const target = sf.root;
    target.setPointerCapture?.(e.pointerId);
    const mv = (ev) => { if (ev.pointerId === e.pointerId) move(ev); };
    const end = (ev) => { if (ev.pointerId !== e.pointerId) return; target.removeEventListener('pointermove', mv); target.removeEventListener('pointerup', end); target.removeEventListener('pointercancel', end); up(ev); };
    const cancel = () => { target.removeEventListener('pointermove', mv); target.removeEventListener('pointerup', end); target.removeEventListener('pointercancel', end); drag = null; before = null; };
    target.addEventListener('pointermove', mv); target.addEventListener('pointerup', end); target.addEventListener('pointercancel', end);
    sf.root.addEventListener('sf-cancel', cancel, { once: true });
    const origUp = up;
    up = (ev) => { sf.root.removeEventListener('sf-cancel', cancel); origUp(ev); };
  }
  const wOf = (ev) => { const p = sf.local(ev); return sf.toWorld(p.x, p.y); };
  const snapOn = () => data.settings.snap !== false;
  const snap = (v) => (snapOn() ? Math.round(v / 11) * 11 : v);

  function startMove(e, w, tapToDrop = null) {
    const ids = [...sel].map(byId).filter((i) => i && !i.locked);
    if (!ids.length) return;
    // frames carry what sits inside them
    const carry = new Set(ids.map((i) => i.id));
    for (const f of ids.filter((i) => i.type === 'frame')) for (const it of data.items) if (!carry.has(it.id) && inside(it, f)) carry.add(it.id);
    const moving = [...carry].map(byId).map((i) => ({ it: i, x: i.x, y: i.y, pts: null }));
    const lead = ids[0];
    drag = { kind: 'move', moved: false };
    begin();
    track(e, (ev) => {
      const p = wOf(ev);
      let dx = p.x - w.x, dy = p.y - w.y;
      if (!drag.moved && Math.hypot(dx, dy) * sf.cam.k < 4) return;
      drag.moved = true; ctxBar.hidden = true; root.classList.add('dragging');
      if (snapOn()) { const m = moving.find((m) => m.it === lead) || moving[0]; dx = snap(m.x + dx) - m.x; dy = snap(m.y + dy) - m.y; }
      for (const m of moving) { m.it.x = m.x + dx; m.it.y = m.y + dy; const el = els.get(m.it.id); if (el) { el.style.left = `${m.it.x}px`; el.style.top = `${m.it.y}px`; } if (m.it.type === 'ink') renderInk(m.it); }
      renderLinks(); updateSel();
    }, () => { root.classList.remove('dragging'); const moved = drag?.moved; drag = null; if (moved) commit(); else { before = null; if (tapToDrop) sel.delete(tapToDrop); } updateSel(); });
  }
  function startMarquee(e, w, add = false) {
    const start = sf.local(e);
    if (!e.shiftKey && !add) select([]);
    const base = new Set(sel);
    drag = { kind: 'marquee' };
    track(e, (ev) => {
      const p = sf.local(ev);
      const x = Math.min(start.x, p.x), y = Math.min(start.y, p.y), ww = Math.abs(p.x - start.x), hh = Math.abs(p.y - start.y);
      if (ww + hh < 6) return;
      Object.assign(marquee.style, { left: `${x}px`, top: `${y}px`, width: `${ww}px`, height: `${hh}px` }); marquee.hidden = false;
      const a = sf.toWorld(x, y), b = sf.toWorld(x + ww, y + hh);
      const box = { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
      sel.clear(); base.forEach((id) => sel.add(id));
      for (const it of data.items) if (it.type === 'frame' ? inside(it, box) : !(it.x > box.x + box.w || it.x + it.w < box.x || it.y > box.y + box.h || it.y + it.h < box.y)) sel.add(it.id);
      updateSel();
    }, () => { marquee.hidden = true; drag = null; updateSel(); });
  }
  function startHandle(e, hd, w) {
    const its = [...sel].map(byId).filter((i) => i && !i.locked);
    if (!its.length) return;
    if (hd === 'link') { startConnect(e, w, its[0].id); return; }
    const it = its[0], o = { x: it.x, y: it.y, w: it.w, h: it.h, rot: it.rot || 0 };
    drag = { kind: hd };
    begin();
    const keepRatio = ['sticker', 'image'].includes(it.type);
    track(e, (ev) => {
      const p = wOf(ev);
      if (hd === 'rot') {
        const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
        let a = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI + 90;
        if (ev.shiftKey || snapOn()) a = Math.round(a / 15) * 15;
        it.rot = ((a + 540) % 360) - 180;
      } else {
        let { x, y, w: ww, h: hh } = o;
        const dx = p.x - w.x, dy = p.y - w.y;
        if (hd.includes('e')) ww = o.w + dx;
        if (hd.includes('s')) hh = o.h + dy;
        if (hd.includes('w')) { ww = o.w - dx; x = o.x + dx; }
        if (hd.includes('n')) { hh = o.h - dy; y = o.y + dy; }
        if (keepRatio || ev.shiftKey) { const r = o.w / o.h; if (hd.length === 2 || hd === 'e' || hd === 'w') hh = ww / r; else ww = hh * r; if (hd.includes('n')) y = o.y + o.h - hh; if (hd.includes('w')) x = o.x + o.w - ww; }
        if (snapOn()) { const x2 = snap(x + ww), y2 = snap(y + hh); if (hd.includes('w')) x = snap(x); if (hd.includes('n')) y = snap(y); if (hd.includes('e')) ww = x2 - x; if (hd.includes('s')) hh = y2 - y; }
        it.x = x; it.y = y; it.w = Math.max(20, ww); it.h = Math.max(20, hh);
      }
      const el = els.get(it.id); if (el) layout(el, it); if (it.type === 'ink') renderInk(it);
      renderLinks(); updateSel();
    }, () => { drag = null; commit(); updateSel(); });
  }
  function startCreate(e, w) {
    const type = tool;
    const start = sf.local(e);
    let it = null;
    drag = { kind: 'create' };
    const make = () => {
      const [dw, dh] = DEFAULT_SIZE[type] || [200, 140];
      it = makeItem(type, { x: snap(w.x - dw / 2), y: snap(w.y - dh / 2), z: type === 'frame' ? minZ() - 1 : maxZ() + 1, anim: { in: 'pop' } });
      if (type === 'shape') it.data.shape = shapeKind;
      if (type === 'sticker') { it.text = sticker; it.anim = { in: 'pop', loop: sticker.startsWith('i:') ? 'none' : 'bounce' }; }
      if (type === 'note') { it.color = PALETTE[(data.items.length) % 6]; it.data = { paper: notePaper, lift: noteLift, ...(notePinKind !== 'none' ? { pin: notePinKind } : {}) }; it.rot = [-2, 1.5, -1, 2][data.items.length % 4]; }
      if (type === 'frame') { it.title = `Frame ${data.items.filter((i) => i.type === 'frame').length + 1}`; it.style = { shadow: 'raised' }; }
      if (type === 'checklist') { it.title = 'Checklist'; it.data.items = [{ t: 'First step', done: false }, { t: 'Second step', done: false }]; }
      if (type === 'flip') { it.title = 'FRONT'; it.data.back = 'Line one\nLine two\nLine three'; }
      if (type === 'prompt') { it.title = 'Prompt'; }
      if (type === 'hide') { it.title = 'Tap to reveal'; it.data = { cover: 'blur', tap: 'reveal' }; it.anim = {}; }
      if (type === 'link') { it.data.url = ''; }
      if (type === 'clip') { [it.w, it.h] = CLIP_SIZE[clipKind]; it.x = snap(w.x - it.w / 2); it.y = snap(w.y - it.h / 2); it.data = { kind: clipKind, metal: clipMetal }; it.color = clipColor; it.rot = clipKind === 'tape' ? -3 : -8; it.anim = {}; }
      if (type === 'text') it.style = { font: 'l' };
      begin();
      data.items.push(it);
      render();
    };
    track(e, (ev) => {
      if (!['frame', 'shape', 'note', 'card', 'text', 'hide'].includes(type)) return;
      const p = sf.local(ev);
      if (Math.hypot(p.x - start.x, p.y - start.y) < 8) return;
      if (!it) make();
      const a = sf.toWorld(Math.min(start.x, p.x), Math.min(start.y, p.y)), b = sf.toWorld(Math.max(start.x, p.x), Math.max(start.y, p.y));
      it.x = snap(a.x); it.y = snap(a.y); it.w = Math.max(40, snap(b.x) - it.x); it.h = Math.max(30, snap(b.y) - it.y);
      layout(els.get(it.id), it); renderLinks();
    }, () => {
      if (!it) make();
      drag = null;
      commit();
      select([it.id]);
      if (!toolLock) setTool('select');
      if (['note', 'card', 'text', 'prompt', 'frame'].includes(type)) startEdit(it.id);
      if (type === 'link') setTimeout(() => linkUrlPrompt(it), 60);
    });
  }
  function startConnect(e, w, fromId) {
    drag = { kind: 'connect' };
    const from = fromId ? { item: fromId } : { x: w.x, y: w.y };
    track(e, (ev) => {
      const p = wOf(ev), A = endBox(from);
      const r = route(A, p, 'straight');
      ghost.setAttribute('d', r.d);
    }, (ev) => {
      ghost.setAttribute('d', '');
      drag = null;
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('.bi');
      const toId = el?.dataset.id;
      const p = wOf(ev);
      if (Math.hypot(p.x - w.x, p.y - w.y) < 10 && !toId) return;
      if (toId && toId === fromId) return;
      const style = { ...LINK_DEFAULT, ...(data.settings.linkStyle || {}) };
      const l = makeLink(from, toId ? { item: toId } : { x: p.x, y: p.y }, { style });
      change(() => data.links.push(l));
      select([l.id]);
      if (!toolLock) setTool('select');
    });
  }
  function startInk(e, w) {
    const pts = [[w.x, w.y]];
    const width = tool === 'highlight' ? 18 : Number(data.settings.penWidth || 4);
    const live = svgEl('path', { fill: 'none', stroke: penColor, 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: tool === 'highlight' ? 0.38 : 1 }, inkLayer);
    const mode = tool;
    drag = { kind: 'ink' };
    track(e, (ev) => {
      const p = wOf(ev), l = pts[pts.length - 1];
      if (Math.hypot(p.x - l[0], p.y - l[1]) * sf.cam.k < 2) return;
      pts.push([p.x, p.y]);
      live.setAttribute('d', smoothPath(pts));
    }, () => {
      live.remove(); drag = null;
      if (pts.length < 2) pts.push([pts[0][0] + 0.5, pts[0][1] + 0.5]);
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const x0 = Math.min(...xs) - width, y0 = Math.min(...ys) - width, x1 = Math.max(...xs) + width, y1 = Math.max(...ys) + width;
      const it = makeItem('ink', { x: x0, y: y0, w: x1 - x0, h: y1 - y0, color: penColor, z: maxZ() + 1, data: { points: pts.map(([x, y]) => [Math.round((x - x0) * 10) / 10, Math.round((y - y0) * 10) / 10]), w0: x1 - x0, h0: y1 - y0, width, mode: mode === 'highlight' ? 'highlight' : 'pen' } });
      change(() => data.items.push(it));
    });
  }
  function startErase(e) {
    drag = { kind: 'erase' };
    const gone = new Set();
    begin();
    const hit = (ev) => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const id = el?.closest?.('.ink-path')?.dataset.id;
      if (id && !gone.has(id)) { gone.add(id); data.items = data.items.filter((i) => i.id !== id); render(); }
    };
    hit(e);
    track(e, hit, () => { drag = null; commit(); });
  }

  // ---------- laser pointer (also used while presenting) ----------
  const trail = [];
  let laserRaf = 0;
  function laserDown(e) {
    drag = { kind: 'laser' };
    const add = (ev) => { const p = sf.local(ev); trail.push({ x: p.x, y: p.y, t: performance.now() }); if (!laserRaf) laserRaf = requestAnimationFrame(drawLaser); };
    add(e);
    track(e, add, () => { drag = null; });
  }
  function drawLaser() {
    const { W, H } = sf.size, dpr = Math.min(2, devicePixelRatio || 1);
    if (laserCanvas.width !== Math.round(W * dpr)) { laserCanvas.width = Math.round(W * dpr); laserCanvas.height = Math.round(H * dpr); }
    const c = laserCanvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    const now = performance.now();
    while (trail.length && now - trail[0].t > 700) trail.shift();
    for (let i = 1; i < trail.length; i++) {
      const a = trail[i - 1], b = trail[i], life = 1 - (now - b.t) / 700;
      c.strokeStyle = `rgba(255,59,48,${life * 0.85})`; c.lineWidth = 3 + life * 5; c.lineCap = 'round';
      c.shadowColor = 'rgba(255,59,48,0.9)'; c.shadowBlur = 14;
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
    }
    const last = trail[trail.length - 1];
    if (last) { c.fillStyle = '#ff3b30'; c.shadowBlur = 18; c.beginPath(); c.arc(last.x, last.y, 6, 0, Math.PI * 2); c.fill(); }
    laserRaf = trail.length ? requestAnimationFrame(drawLaser) : 0;
  }

  // ---------- item buttons (copy, check, flip, open) ----------
  function itemAction(btn, e) {
    const el = btn.closest('.bi'), it = el && byId(el.dataset.id);
    const act = btn.dataset.act;
    const up = () => {
      sf.root.removeEventListener('pointerup', up);
      if (!it) return;
      if (act === 'copy') {
        const text = it.text || '';
        const done = () => { setText(btn, '✓ Copied'); setTimeout(() => { setText(btn, '⧉ Copy'); }, 1400); };
        navigator.clipboard?.writeText(text).then(done).catch(() => { const r = document.createRange(); const t = el.querySelector('.txt'); if (t) { r.selectNodeContents(t); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } });
      } else if (act === 'jump') {
        jumpFrom(it);
      } else if (act === 'check') {
        const i = Number(btn.dataset.i);
        if (!it.data.items?.[i]) return;
        // a shared link ticks only on this screen (Reset puts it back); the owner's ticks are saved, even when locked or presenting
        if (readonly) { if (!checkBackup.has(it.id)) checkBackup.set(it.id, JSON.stringify(it.data.items)); it.data.items[i].done = !it.data.items[i].done; it.data = { ...it.data }; render(); updateStageBar(); }
        else change(() => { it.data.items[i].done = !it.data.items[i].done; it.data = { ...it.data }; });
        if (it.data.items[i].done) { const r = btn.getBoundingClientRect(); burstAt(r.left + 9, r.top + 9); }
      } else if (act === 'check-add') {
        change(() => { it.data.items = [...(it.data.items || []), { t: 'New item', done: false }]; });
        setTimeout(() => editChecklist(it), 50);
      } else if (act === 'open-attach' || (it.type === 'file' && act === 'open-file')) openFile(Number(btn.dataset.file || it.data.fileId), it);
      else if (act === 'pick-video') replaceVideo(it);
    };
    sf.root.addEventListener('pointerup', up);
    e.stopPropagation();
  }
  function burstAt(x, y) {
    const b = h('div', { class: 'bd-burst', style: { left: `${x}px`, top: `${y}px` } }, ...Array.from({ length: 10 }, (_, i) => h('i', { style: { '--a': `${i * 36}deg` } })));
    document.body.append(b); setTimeout(() => b.remove(), 900);
  }
  function flip(it, local = false) {
    if (!it) return;
    if (readonly || local) { const el = els.get(it.id); el?.classList.toggle('flipped'); return; }
    change(() => { it.data = { ...it.data, flipped: !it.data.flipped }; });
  }
  function toggleSlide(f) { change(() => { data.order = data.order.includes(f.id) ? data.order.filter((x) => x !== f.id) : [...data.order, f.id]; }); showCtxBar(); }

  // ---------- text editing ----------
  function dblClick(e, w) {
    if (staged()) return;
    const t = hitAt(e);
    const el = t.closest?.('.bi'), id = el?.dataset.id;
    if (id && !(el.classList.contains('t-frame') && !t.closest('.ftab'))) { select([id]); startEdit(id, t); return; }
    if (t.closest?.('[data-link]')) { const l = linkById(t.closest('[data-link]').dataset.link); if (l) editLabel(l); return; }
    // double-click the floor: a sticky note
    startCreateAt(w);
  }
  function startCreateAt(w) {
    const it = makeItem('note', { x: snap(w.x - 110), y: snap(w.y - 90), z: maxZ() + 1, color: PALETTE[data.items.length % 6], anim: { in: 'pop' } });
    change(() => data.items.push(it));
    tool = 'select'; setTool('select');
    select([it.id]);
    startEdit(it.id);
  }
  function startEdit(id, target) {
    const it = byId(id), el = els.get(id);
    if (!it || !el || it.locked) return;
    if (it.type === 'checklist' && target?.closest?.('.cks')) return editChecklist(it);
    if (it.type === 'flip' && (it.data?.flipped || el.classList.contains('flipped'))) return editFlipBack(it);
    if (it.type === 'image') return imageCaption(it);
    if (it.type === 'link') return linkUrlPrompt(it);
    if (it.type === 'file') return openFile(Number(it.data?.fileId), it);
    const fields = [...el.querySelectorAll('.ed')];
    if (!fields.length) return;
    editing = id; el.classList.add('editing');
    ctxBar.hidden = true;
    begin();
    for (const f of fields) { f.contentEditable = 'true'; f.spellcheck = true; }
    const focusEl = target?.closest?.('.ed') || (it.type === 'card' && !it.title && !it.text ? fields.find((f) => f.dataset.field === 'title') : null) || fields.find((f) => f.dataset.field === 'text') || fields[0];
    focusEl.focus();
    const range = document.createRange(); range.selectNodeContents(focusEl); range.collapse(false);
    const s = getSelection(); s.removeAllRanges(); s.addRange(range);
    const finish = () => {
      if (editing !== id) return;
      editing = null;
      for (const f of fields) { f.contentEditable = 'false'; const v = f.innerText.replace(/\n{3,}/g, '\n\n').trim(); if (f.dataset.field === 'title') it.title = v; else it.text = v; }
      el._key = null;
      render(); commit();
      el.removeEventListener('focusout', out);
    };
    const out = (ev) => { if (!el.contains(ev.relatedTarget)) finish(); };
    const keys = (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); document.activeElement?.blur(); }
      else if (ev.key === 'Tab' && fields.length > 1) { // title ⇄ details
        ev.preventDefault();
        const n = fields[(fields.indexOf(document.activeElement) + (ev.shiftKey ? -1 : 1) + fields.length) % fields.length];
        n.focus(); const r = document.createRange(); r.selectNodeContents(n); r.collapse(false); const sl = getSelection(); sl.removeAllRanges(); sl.addRange(r);
      }
      ev.stopPropagation();
    };
    el.addEventListener('focusout', out);
    el.addEventListener('keydown', keys);
    const cleanup = () => el.removeEventListener('keydown', keys);
    el.addEventListener('focusout', cleanup, { once: true });
  }
  function textPrompt(title, value, onDone, { multiline = false, placeholder = '' } = {}) {
    const input = multiline ? h('textarea', { rows: 6, placeholder }, value || '') : h('input', { type: 'text', value: value || '', placeholder });
    const m = openModal({ title, body: h('div', null, input), actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', onClick: () => onDone(input.value) }] });
    setTimeout(() => input.focus(), 50);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !multiline) { e.preventDefault(); onDone(input.value); m.close(); } });
  }
  const editFlipBack = (it) => textPrompt('Back of the card (one line per row)', it.data.back, (v) => change(() => { it.data = { ...it.data, back: v }; }), { multiline: true });
  const editChecklist = (it) => textPrompt('Checklist (one item per line; start a line with [x] if done)', (it.data.items || []).map((x) => `${x.done ? '[x] ' : ''}${x.t}`).join('\n'), (v) => change(() => { it.data = { ...it.data, items: v.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 60).map((s) => ({ t: s.replace(/^\[x\]\s*/i, ''), done: /^\[x\]/i.test(s) })) }; }), { multiline: true });
  const imageCaption = (it) => textPrompt('Caption', it.text, (v) => change(() => { it.text = v; }));
  const editLabel = (l) => textPrompt('Label on the connection', l.label, (v) => change(() => { l.label = v.slice(0, 200); }));
  function linkUrlPrompt(it) {
    textPrompt('Web link', it.data.url, (v) => {
      let url = v.trim();
      if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
      change(() => { it.data = { ...it.data, url }; if (!it.title) try { it.title = new URL(url).hostname.replace(/^www\./, ''); } catch { /* keep */ } });
    }, { placeholder: 'https://…' });
  }

  // ---------- adding media ----------
  const viewCenter = () => { const { W, H } = sf.size; return sf.toWorld(W / 2, H / 2); };
  function place(it, at = viewCenter()) { it.x = snap(at.x - it.w / 2); it.y = snap(at.y - it.h / 2); it.z = maxZ() + 1; it.anim = { in: 'pop' }; change(() => data.items.push(it)); select([it.id]); return it; }
  async function addImageFile(file, at) {
    try {
      status.textContent = 'Uploading…';
      const f = await uploadFile(board.id, file);
      const bmp = await createImageBitmap(file).catch(() => null);
      const ratio = bmp ? bmp.height / bmp.width : 0.75;
      place(makeItem('image', { w: 360, h: Math.round(360 * ratio), data: { fileId: f.id, name: f.name } }), at);
      status.textContent = 'Saved';
    } catch (e) { notify(e.message, 'error'); status.textContent = 'Saved'; }
  }
  async function addTextFile(file, at) {
    try {
      const text = await file.text().catch(() => '');
      const f = await uploadFile(board.id, file);
      place(makeItem('file', { w: 300, h: text ? 200 : 90, data: { fileId: f.id, name: f.name, size: f.size, mime: f.mime, preview: text.slice(0, 600) } }), at);
    } catch (e) { notify(e.message, 'error'); }
  }
  async function addVideoFile(file, at) {
    const v = await saveVideo(file);
    place(makeItem('video', { w: 420, h: 280, data: { localId: v.localId, name: v.name, size: v.size } }), at);
    notify('Video added. It plays on this device only; other devices and shared links show its name.', 'info');
  }
  async function attachFiles() {
    const files = await pickFiles('.txt,.md,.csv,.json,.srt,text/*', true);
    const target = [...sel].map(byId).find((i) => i?.type === 'card');
    for (const f of files) {
      if (target) {
        try { const up = await uploadFile(board.id, f); change(() => { target.data = { ...target.data, attach: [...(target.data.attach || []), { fileId: up.id, name: up.name, size: up.size }] }; }); } catch (e) { notify(e.message, 'error'); }
      } else await addTextFile(f);
    }
  }
  async function addVideo() { const [f] = await pickFiles('video/*'); if (f) addVideoFile(f); }
  async function replaceVideo(it) { const [f] = await pickFiles('video/*'); if (!f) return; const v = await saveVideo(f); change(() => { it.data = { ...it.data, localId: v.localId, name: v.name }; }); }
  async function openFile(fileId, it) {
    try {
      const text = await fileText(fileId, share);
      openModal({ title: `📄 ${(it.data?.attach || []).find((a) => a.fileId === fileId)?.name || it.data?.name || 'File'}`, wide: true, body: h('pre', { class: 'fview selectable' }, text.slice(0, 200000)), actions: [{ label: 'Copy text', onClick: () => navigator.clipboard?.writeText(text) }, { label: 'Close', kind: 'primary' }] });
    } catch (e) { notify(e.message, 'error'); }
  }
  // drop files on the board
  sf.root.addEventListener('dragover', (e) => { if (!readonly && e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); root.classList.add('dropping'); } });
  sf.root.addEventListener('dragleave', () => root.classList.remove('dropping'));
  sf.root.addEventListener('drop', async (e) => {
    if (readonly) return;
    e.preventDefault(); root.classList.remove('dropping');
    const at = wOf(e);
    for (const f of [...(e.dataTransfer?.files || [])]) {
      if (f.type.startsWith('image/')) await addImageFile(f, at);
      else if (f.type.startsWith('video/')) await addVideoFile(f, at);
      else await addTextFile(f, at);
      at.x += 40; at.y += 40;
    }
  });
  // paste: our own copies, images, links or text
  const onPaste = async (e) => {
    if (readonly || destroyed || !root.isConnected || editing || e.target.closest?.('input, textarea, [contenteditable="true"]') || document.querySelector('.scrim')) return;
    const files = [...(e.clipboardData?.files || [])];
    const text = e.clipboardData?.getData('text/plain') || '';
    if (text.startsWith('{"flowmapBoard"')) { e.preventDefault(); pasteItems(JSON.parse(text)); return; }
    if (files.length) { e.preventDefault(); for (const f of files) f.type.startsWith('image/') ? await addImageFile(f) : await addTextFile(f); return; }
    if (!text) return;
    e.preventDefault();
    if (clip && text === clip.stamp) return pasteItems(clip.data);
    const t = text.trim();
    if (/^https?:\/\/\S+\.(png|jpe?g|gif|webp|svg)(\?\S*)?$/i.test(t)) place(makeItem('image', { w: 360, h: 260, data: { url: t } }));
    else if (/^https?:\/\/\S+$/i.test(t)) { let host = ''; try { host = new URL(t).hostname.replace(/^www\./, ''); } catch { /* */ } place(makeItem('link', { title: host, data: { url: t } })); }
    else place(makeItem(t.length > 300 ? 'prompt' : 'note', { text: t.slice(0, 20000), color: PALETTE[data.items.length % 6], ...(t.length > 300 ? { w: 420, h: 300, title: 'Pasted text' } : {}) }));
  };
  document.addEventListener('paste', onPaste);

  // ---------- clipboard, duplicate, delete, z-order ----------
  let clip = null;
  function copySel(cut = false) {
    const its = [...sel].map(byId).filter(Boolean);
    if (!its.length) return;
    const ids = new Set(its.map((i) => i.id));
    const payload = { flowmapBoard: 1, items: its, links: data.links.filter((l) => ids.has(l.from.item) && ids.has(l.to.item)) };
    const stamp = JSON.stringify(payload);
    clip = { data: payload, stamp };
    navigator.clipboard?.writeText(stamp).catch(() => {});
    if (cut) removeSel();
  }
  function pasteItems(payload, offset = 40) {
    const map = new Map();
    const items = (payload.items || []).map((i) => { const n = { ...JSON.parse(JSON.stringify(i)), id: newId(), x: i.x + offset, y: i.y + offset, z: maxZ() + 1 + (i.z || 0) }; map.set(i.id, n.id); return n; });
    for (const n of items) if (n.data?.jump && map.has(n.data.jump)) n.data.jump = map.get(n.data.jump);
    const links = (payload.links || []).map((l) => ({ ...JSON.parse(JSON.stringify(l)), id: newId('l'), from: l.from.item ? { item: map.get(l.from.item) } : l.from, to: l.to.item ? { item: map.get(l.to.item) } : l.to }));
    change(() => { data.items.push(...items); data.links.push(...links); });
    select(items.map((i) => i.id));
    if (clip) clip.data = { ...payload, items: payload.items.map((i) => ({ ...i, x: i.x + offset, y: i.y + offset })) };
  }
  function duplicate() { const its = [...sel].map(byId).filter(Boolean); if (!its.length) return; const ids = new Set(its.map((i) => i.id)); pasteItems({ items: its, links: data.links.filter((l) => ids.has(l.from.item) && ids.has(l.to.item)) }, 30); }
  function removeSel() {
    if (!sel.size) return;
    change(() => {
      const gone = new Set(sel);
      data.items = data.items.filter((i) => !gone.has(i.id) || i.locked);
      const alive = (e) => !e.item || !!byId(e.item);
      data.links = data.links.filter((l) => !gone.has(l.id) && alive(l.from) && alive(l.to));
      data.order = data.order.filter((id) => byId(id));
    });
    sel.clear(); updateSel();
  }
  function zorder(how) {
    const its = [...sel].map(byId).filter(Boolean);
    change(() => {
      if (how === 'front') its.forEach((i, n) => { i.z = maxZ() + 1 + n; });
      else if (how === 'back') its.forEach((i, n) => { i.z = minZ() - 1 - n; });
      else its.forEach((i) => { i.z = (i.z || 0) + (how === 'up' ? 1.5 : -1.5); });
    });
  }
  function align(how) {
    const its = [...sel].map(byId).filter((i) => i && !i.locked);
    if (its.length < 2) return;
    const b = bounds(its);
    change(() => {
      if (how === 'left') its.forEach((i) => { i.x = b.x0; });
      if (how === 'right') its.forEach((i) => { i.x = b.x1 - i.w; });
      if (how === 'hcenter') its.forEach((i) => { i.x = b.x0 + b.w / 2 - i.w / 2; });
      if (how === 'top') its.forEach((i) => { i.y = b.y0; });
      if (how === 'bottom') its.forEach((i) => { i.y = b.y1 - i.h; });
      if (how === 'vcenter') its.forEach((i) => { i.y = b.y0 + b.h / 2 - i.h / 2; });
      if (how === 'hspread') { const s = [...its].sort((a, c) => a.x - c.x), gap = (b.w - s.reduce((t, i) => t + i.w, 0)) / (s.length - 1); let x = b.x0; s.forEach((i) => { i.x = x; x += i.w + gap; }); }
      if (how === 'vspread') { const s = [...its].sort((a, c) => a.y - c.y), gap = (b.h - s.reduce((t, i) => t + i.h, 0)) / (s.length - 1); let y = b.y0; s.forEach((i) => { i.y = y; y += i.h + gap; }); }
    });
  }

  // ---------- menus & panels ----------
  let menuEl = null;
  function closeMenu() { menuEl?.remove(); menuEl = null; }
  function menu(title, items, x, y) {
    closeMenu();
    menuEl = h('div', { class: 'ctxmenu bd-menu', role: 'menu' }, title ? h('div', { class: 'mt' }, title) : null, ...items.filter(Boolean).map((it) => it === '-' ? h('div', { class: 'sep' }) : h('button', { type: 'button', class: `mi ${it[3] || ''}`, role: 'menuitem', onclick: () => { closeMenu(); it[2](); } }, h('span', { class: 'mic' }, it[0]), it[1], it[4] ? h('kbd', null, it[4]) : null)));
    document.body.append(menuEl);
    const r = { width: menuEl.offsetWidth, height: menuEl.offsetHeight };
    menuEl.style.left = `${Math.max(8, Math.min(innerWidth - r.width - 8, x))}px`;
    menuEl.style.top = `${Math.max(8, Math.min(innerHeight - r.height - 8, y))}px`;
    setTimeout(() => document.addEventListener('pointerdown', function away(ev) { if (!menuEl?.contains(ev.target)) { closeMenu(); document.removeEventListener('pointerdown', away, true); } }, true));
  }
  function contextMenu(e, w, fromBar = false) {
    e.preventDefault?.();
    if (staged()) return;
    const id = hitItem(e);
    const lk = hitAt(e).closest?.('[data-link]')?.dataset.link;
    const at = w || viewCenter();
    if (id && !sel.has(id) && !fromBar) select([id]);
    if (lk && !sel.has(lk)) select([lk]);
    const its = [...sel].map(byId).filter(Boolean);
    if (lk || (!its.length && [...sel].some(linkById))) {
      const l = linkById(lk || [...sel][0]);
      return menu('Connection', [
        ['⤳', 'Style: tunnel, tube, line, arrows', () => linkPop([l])],
        ['🏷', 'Label', () => editLabel(l)],
        ['⇄', 'Reverse direction', () => change(() => { const f = l.from; l.from = l.to; l.to = f; })],
        ['✨', l.style?.flow ? 'Stop the flowing light' : 'Flowing light', () => change(() => { l.style = { ...l.style, flow: !l.style?.flow }; })],
        ['★', 'Use this style for new connections', () => { data.settings.linkStyle = { ...l.style }; save(); notify('New connections will look like this', 'good'); }],
        '-', ['🗑', 'Delete', () => removeSel(), 'danger', 'Del'],
      ], e.clientX, e.clientY);
    }
    if (its.length) {
      const one = its.length === 1 ? its[0] : null;
      return menu(one ? TYPE_LABEL[one.type] : `${its.length} items`, [
        one && !['ink', 'sticker', 'image', 'video', 'project'].includes(one.type) ? ['✎', 'Edit text', () => startEdit(one.id), 'primary', 'Enter'] : null,
        ['🎨', 'Colour', () => colorPop()],
        its.some((i) => i.type !== 'ink' && i.type !== 'sticker' && i.type !== 'text') ? ['◐', 'Finish & shadow', () => stylePop()] : null,
        ['✨', 'Animation', () => animPop()],
        one?.type === 'flip' ? ['🂠', 'Flip', () => flip(one)] : null,
        one?.type === 'flip' ? ['✎', 'Edit the back', () => editFlipBack(one)] : null,
        one?.type === 'checklist' ? ['☑', 'Edit items', () => editChecklist(one)] : null,
        one?.type === 'frame' ? [data.order.includes(one.id) ? '★' : '☆', data.order.includes(one.id) ? 'Remove from slides' : 'Add to slides', () => toggleSlide(one)] : null,
        one?.type === 'frame' ? ['📝', 'Speaker notes', () => textPrompt('Speaker notes (only you see them while presenting)', one.data?.notes, (v) => change(() => { one.data = { ...one.data, notes: v }; }), { multiline: true })] : null,
        one?.type === 'frame' ? ['▶', 'Present from here', () => present(one.id)] : null,
        one?.type === 'card' ? ['📎', 'Attach a text file', () => attachFiles()] : null,
        one?.type === 'card' ? ['🖼️', one.data?.cover || one.data?.coverFile ? 'Change cover image' : 'Add cover image', () => coverImage(one)] : null,
        one?.type === 'image' ? ['🖼️', 'Replace image', () => replaceImage(one)] : null,
        one?.type === 'image' ? ['✎', 'Caption', () => imageCaption(one)] : null,
        one?.type === 'link' ? ['🔗', 'Change link', () => linkUrlPrompt(one)] : null,
        one?.type === 'link' && one.data?.url ? ['↗', 'Open link', () => window.open(one.data.url, '_blank', 'noopener')] : null,
        one?.type === 'video' ? ['🎬', 'Choose another video', () => replaceVideo(one)] : null,
        one?.type === 'hide' ? ['🙈', 'Cover: blur, frosted, solid', () => hidePop()] : null,
        ['✋', its.every((i) => i.data?.movable) ? 'Stop being movable when locked' : 'Movable when locked', () => toggleMovable(its)],
        one ? ['⤳', 'Connect to…', () => { setTool('connector'); notify('Drag from this item to another one', 'info'); }] : null,
        '-',
        ['⧉', 'Duplicate', () => duplicate(), '', 'Ctrl+D'], ['⎘', 'Copy', () => copySel(), '', 'Ctrl+C'], ['✂', 'Cut', () => copySel(true), '', 'Ctrl+X'],
        ['⬆', 'Bring to front', () => zorder('front'), '', ']'], ['⬇', 'Send to back', () => zorder('back'), '', '['],
        its.length > 1 ? ['⫷', 'Align left', () => align('left')] : null, its.length > 1 ? ['⫿', 'Align centres', () => align('hcenter')] : null, its.length > 1 ? ['⫠', 'Align tops', () => align('top')] : null,
        its.length > 2 ? ['↔', 'Space evenly across', () => align('hspread')] : null, its.length > 2 ? ['↕', 'Space evenly down', () => align('vspread')] : null,
        its.length > 1 ? ['▦', 'Put in a frame', () => wrapInFrame(its)] : null,
        its.length === 1 ? ['⌖', its[0].data?.jump ? 'Jump link…' : 'Add a jump link…', () => { select([its[0].id]); jumpPop(null, { x: e.clientX, y: e.clientY }); }] : null,
        [its.every((i) => i.locked) ? '🔓' : '🔒', its.every((i) => i.locked) ? 'Unlock' : 'Lock', () => change(() => { const v = !its.every((i) => i.locked); its.forEach((i) => { i.locked = v; }); })],
        '-', ['🗑', 'Delete', () => removeSel(), 'danger', 'Del'],
      ], e.clientX, e.clientY);
    }
    const put = (type, extra = {}) => () => { const it = makeItem(type, extra); it.x = snap(at.x - it.w / 2); it.y = snap(at.y - it.h / 2); if (type === 'note') it.color = PALETTE[data.items.length % 6]; if (type === 'frame') { it.z = minZ() - 1; it.title = 'Frame'; } place(it, at); if (['note', 'card', 'text', 'prompt', 'frame'].includes(type)) setTimeout(() => startEdit(it.id), 60); };
    menu('Board', [
      clip ? ['⎘', 'Paste here', () => { const b = bounds(clip.data.items); pasteItems({ ...clip.data, items: clip.data.items.map((i) => ({ ...i, x: i.x - b.x0 + at.x - 40, y: i.y - b.y0 + at.y - 40 })) }); }, 'primary', 'Ctrl+V'] : null,
      ['🗒️', 'Sticky note', put('note')], ['▭', 'Card', put('card')], ['T', 'Text', put('text', { style: { font: 'l' } })], ['◆', 'Shape', put('shape', { data: { shape: shapeKind } })],
      ['▦', 'Frame (slide)', put('frame', { style: { shadow: 'raised' } })], ['🙈', 'Hide (tap to reveal)', put('hide', { title: 'Tap to reveal', data: { cover: 'blur', tap: 'reveal' }, z: maxZ() + 1 })], ['✦', 'Prompt', put('prompt', { title: 'Prompt' })], ['☑', 'Checklist', put('checklist', { title: 'Checklist', data: { items: [{ t: 'First step', done: false }] } })],
      ['😀', 'Sticker', () => stickerPicker(null, { x: e.clientX, y: e.clientY }, at)], ['📎', 'Paperclip, pin or tape', () => clipPicker(null, { x: e.clientX, y: e.clientY }, at)], ['🖼️', 'Image', () => imagePicker(null, { x: e.clientX, y: e.clientY })],
      '-', ['▣', 'Select all', () => select(data.items.map((i) => i.id)), '', 'Ctrl+A'], ['⤢', 'Fit everything', () => fitAll(), '', 'Shift+1'],
      [data.settings.snap !== false ? '▦' : '▢', data.settings.snap !== false ? 'Turn off snap to grid' : 'Snap to grid', () => { data.settings.snap = data.settings.snap === false; save(); }],
      ['🔒', 'Lock the board', () => setLocked(true), '', 'K'],
      ['▶', 'Present', () => present()],
    ], e.clientX, e.clientY);
  }
  function wrapInFrame(its) {
    const b = bounds(its);
    const f = makeItem('frame', { x: snap(b.x0 - 44), y: snap(b.y0 - 88), w: snap(b.w + 88), h: snap(b.h + 132), title: 'Group', z: Math.min(...its.map((i) => i.z || 0)) - 1, style: { shadow: 'sunk' } });
    change(() => data.items.push(f));
    select([f.id]);
    setTimeout(() => startEdit(f.id), 60);
  }
  const anchorFor = (btn) => btn instanceof Element ? { anchor: btn } : (() => { const r = ctxBar.getBoundingClientRect(); return { x: r.left, y: r.bottom + 8 }; })();
  function colorPop(btn) {
    const its = [...sel].map(byId).filter(Boolean);
    const body = h('div', { class: 'pgrid' },
      swatchRow('Fill', COLORS, its[0]?.color || '', (c) => change(() => its.forEach((i) => { i.color = c; }))),
      its.some((i) => i.type !== 'ink') ? swatchRow('Text', ['', '#1c1916', '#ffffff', '#ff4d5e', '#ff8a3d', '#2fb457', '#8a7b6d'], its[0]?.style?.textColor || '', (c) => change(() => its.forEach((i) => { i.style = { ...i.style, textColor: c }; }))) : null);
    openPop({ ...anchorFor(btn), title: 'Colour', body, width: 360 });
  }
  function stylePop(btn) {
    const its = [...sel].map(byId).filter(Boolean), f = its[0];
    const body = h('div', { class: 'pgrid' },
      segRow('Finish', [['soft', 'Soft'], ['tinted', 'Tinted'], ['solid', 'Solid'], ['glass', 'Glass'], ['flat', 'Flat'], ['none', 'None']], finishOf(f), (v) => change(() => its.forEach((i) => { i.style = { ...i.style, finish: v }; }))),
      segRow('Depth', [['sunk', 'Sunk'], ['flat', 'Flat'], ['raised', 'Raised'], ['float', 'Floating']], f.style?.shadow || 'raised', (v) => change(() => its.forEach((i) => { i.style = { ...i.style, shadow: v }; }))),
      rangeRow('Corners', f.style?.radius ?? 18, 0, 60, 2, (v) => change(() => its.forEach((i) => { i.style = { ...i.style, radius: v }; els.get(i.id)?.style.setProperty('--r', `${v}px`); }))));
    openPop({ ...anchorFor(btn), title: 'Finish & shadow', body, width: 400 });
  }
  function textPop(btn) {
    const its = [...sel].map(byId).filter(Boolean), f = its[0];
    const set = (patch) => change(() => its.forEach((i) => { i.style = { ...i.style, ...patch }; }));
    openPop({ ...anchorFor(btn), title: 'Text', width: 380, body: h('div', { class: 'pgrid' },
      sizeRow(its),
      segRow('Align', [['left', '⇤'], ['center', '↔'], ['right', '⇥']], f.style?.align || 'center', (v) => set({ align: v })),
      toggleRow('Bold', (f.style?.weight || 0) >= 700, (v) => set({ weight: v ? 800 : 0 })),
      toggleRow('Soft colour', !!f.style?.muted, (v) => set({ muted: v })),
      toggleRow('Handwriting', !!f.style?.hand, (v) => set({ hand: v || undefined }))) });
  }
  // text size in px: drag the slider or type a number; one undo step per change
  const sizeOf = (i) => (typeof i.style?.size === 'number' ? i.style.size : FONT_PX[i.style?.font || (i.type === 'text' ? 'l' : 'm')] || 14.5);
  function sizeRow(its) {
    const cur = Math.round(sizeOf(its[0]) * 2) / 2;
    const num = h('input', { type: 'number', min: 6, max: 200, step: 1, value: cur, 'aria-label': 'Text size in pixels' });
    const rng = h('input', { type: 'range', min: 8, max: 120, step: 1, value: Math.min(120, cur), 'aria-label': 'Text size' });
    const live = (v) => {
      if (!Number.isFinite(v) || v < 6 || v > 200) return;
      begin();
      for (const i of its) { i.style = { ...i.style, size: v }; const el = els.get(i.id); if (el) layout(el, i); }
    };
    const done = () => { render(); commit(); };
    rng.addEventListener('input', () => { num.value = rng.value; live(Number(rng.value)); });
    rng.addEventListener('change', done);
    num.addEventListener('input', () => { const v = Number(num.value); if (v >= 8) rng.value = String(Math.min(120, v)); live(v); });
    num.addEventListener('change', done);
    num.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); done(); num.blur(); } });
    return h('div', { class: 'pr size-row' }, h('span', { class: 'pl' }, 'Size'), rng, num, h('small', null, 'px'));
  }

  // ---------- paper notes ----------
  const PAPER_LABEL = { sticky: 'Sticky', lined: 'Lined', spiral: 'Notebook', grid: 'Graph', index: 'Index card', kraft: 'Kraft', torn: 'Torn scrap', aged: 'Old paper' };
  const NOTE_COLORS = ['#ffd54a', '#ffb020', '#ff8a5c', '#ff6fae', '#b8e04a', '#7fd8b0', '#e8b86b', '#f5f1ea', '#e07a5f', '#c9a27e'];
  function paperBody(cur, set) {
    const tile = (k) => h('button', { type: 'button', class: `pp-tile${cur.paper === k ? ' on' : ''}`, onclick: () => set({ paper: k }) },
      h('div', { class: `bi t-note pp-${k} lift-${cur.lift}`, style: { '--c': cur.color || '#ffd54a' } }, h('div', { class: 'paper' })), PAPER_LABEL[k]);
    return h('div', { class: 'pgrid' },
      h('div', { class: 'pp-tiles' }, Object.keys(PAPER_LABEL).map(tile)),
      swatchRow('Colour', NOTE_COLORS, cur.color || '', (c) => set({ color: c })),
      segRow('Sits', [['flat', 'Flat'], ['lifted', 'Lifted'], ['curled', 'Corner folded']], cur.lift, (v) => set({ lift: v })),
      segRow('Held by', [['none', 'Nothing'], ['tape', 'Tape'], ['pin', 'Pin'], ['clip', 'Clip']], cur.pin || 'none', (v) => set({ pin: v })),
      h('p', { class: 'phint' }, 'Tilt it with the round handle. Text size, bold and ✍ handwriting are under Aa.'));
  }
  function paperPicker(btn) {
    const cur = { paper: notePaper, lift: noteLift, pin: notePinKind, color: '' };
    const holder = h('div');
    const paint = () => clear(holder).append(paperBody(cur, (patch) => { Object.assign(cur, patch); notePaper = cur.paper; noteLift = cur.lift; notePinKind = cur.pin; paint(); }));
    paint();
    openPop({ anchor: btn, title: 'Pick a paper, then tap the board', width: 420, body: holder });
  }
  function paperPop(btn) {
    const its = [...sel].map(byId).filter((i) => i?.type === 'note');
    if (!its.length) return;
    const f = its[0];
    const cur = { paper: f.data?.paper || 'sticky', lift: f.data?.lift || 'lifted', pin: f.data?.pin || 'none', color: f.color || '' };
    const holder = h('div');
    const paint = () => clear(holder).append(paperBody(cur, (patch) => {
      Object.assign(cur, patch);
      change(() => its.forEach((i) => {
        i.data = { ...i.data, paper: cur.paper, lift: cur.lift };
        if (cur.pin === 'none') delete i.data.pin; else i.data.pin = cur.pin;
        if ('color' in patch) i.color = patch.color;
      }));
      notePaper = cur.paper; noteLift = cur.lift; notePinKind = cur.pin;
      paint();
    }));
    paint();
    openPop({ ...anchorFor(btn), title: '🗒️ Paper', width: 420, body: holder });
  }

  function animPop(btn) {
    const its = [...sel].map(byId).filter(Boolean), f = its[0];
    const set = (patch) => change(() => its.forEach((i) => { i.anim = { ...i.anim, ...patch }; }));
    openPop({ ...anchorFor(btn), title: '✨ Animation', width: 420, body: h('div', { class: 'pgrid' },
      segRow('Appear', [['none', 'None'], ['pop', 'Pop'], ['fade', 'Fade'], ['rise', 'Rise'], ['zoom', 'Zoom'], ['slide', 'Slide']], f.anim?.in || 'none', (v) => { set({ in: v }); const el = els.get(f.id); if (el && v !== 'none') { el.classList.remove(`in-${v}`); void el.offsetWidth; el.classList.add(`in-${v}`); setTimeout(() => el.classList.remove(`in-${v}`), 900); } }),
      segRow('Loop', [['none', 'None'], ['bounce', 'Bounce'], ['pulse', 'Pulse'], ['wiggle', 'Wiggle'], ['float', 'Float'], ['spin', 'Spin'], ['glow', 'Glow']], f.anim?.loop || 'none', (v) => set({ loop: v })),
      rangeRow('Delay', f.anim?.delay || 0, 0, 3, 0.1, (v) => set({ delay: v })),
      h('p', { class: 'phint' }, 'Appear plays when a slide opens while presenting. Loops play all the time.')) });
  }
  function linkPop(lks, btn) {
    const f = lks[0];
    const st = { ...LINK_DEFAULT, ...f.style };
    openPop({ ...anchorFor(btn), title: '⤳ Connection', width: 430, body: linkStyleBody(st, (patch) => change(() => lks.forEach((l) => { l.style = { ...l.style, ...patch }; })), { fitWidth: true }) });
  }
  function toggleMovable(its) { const v = !its.every((i) => i.data?.movable); change(() => its.forEach((i) => { i.data = { ...i.data, movable: v }; })); notify(v ? '✋ Movable: when the board is locked or presenting, this can be dragged around' : 'No longer movable when locked', 'info'); }
  // ---------- clips ----------
  const CLIP_COLORS = ['', '#ff4d5e', '#ff8a5c', '#ffb020', '#e8b86b', '#b8e04a', '#2fb4a0', '#e07a5f', '#ff6fae', '#f3e3b3', '#f5f1ea', '#1c1916'];
  function clipBody(cur, set) {
    const metalRow = cur.kind === 'tape' ? null : segRow(cur.kind === 'pin' ? 'Head' : 'Metal', Object.entries(METAL_LABEL), cur.metal || CLIP_DEFAULT[cur.kind].metal, (v) => set({ metal: v }));
    const preview = h('div', { class: 'clip-prev' }, clipSvg({ id: `pv${cur.kind}`, color: cur.color, data: { kind: cur.kind, metal: cur.metal } }));
    return h('div', { class: 'pgrid' }, preview,
      segRow('Kind', Object.entries(CLIP_LABEL), cur.kind, (v) => set({ kind: v, metal: CLIP_DEFAULT[v].metal })),
      metalRow,
      cur.kind === 'tape' || cur.kind === 'pin' || cur.metal === 'color' ? swatchRow('Colour', CLIP_COLORS, cur.color || '', (c) => set({ color: c })) : null,
      h('p', { class: 'phint' }, 'Lay it across the top edge of a note, card or photo. Drag the round handle to tilt it; drag a corner to resize.'));
  }
  function clipPicker(btn, pt, at) {
    const cur = { kind: clipKind, metal: clipMetal, color: clipColor };
    const holder = h('div');
    const paint = () => clear(holder).append(clipBody(cur, (patch) => { Object.assign(cur, patch); clipKind = cur.kind; clipMetal = cur.metal; clipColor = cur.color; paint(); }));
    paint();
    openPop({ ...(btn ? { anchor: btn } : pt), title: at ? 'Add a clip' : 'Pick a clip, then tap the board', width: 400, body: h('div', null, holder,
      at ? h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:8px' }, h('button', { type: 'button', class: 'btn primary sm', onclick: () => { closePop(); const [cw, ch] = CLIP_SIZE[cur.kind]; place(makeItem('clip', { w: cw, h: ch, rot: cur.kind === 'tape' ? -3 : -8, color: cur.color, data: { kind: cur.kind, metal: cur.metal } }), at); } }, 'Add it')) : null) });
  }
  function clipPop(btn) {
    const its = [...sel].map(byId).filter((i) => i?.type === 'clip');
    if (!its.length) return;
    const f = its[0];
    const cur = { kind: f.data?.kind || 'paperclip', metal: f.data?.metal, color: f.color || '' };
    const holder = h('div');
    const paint = () => clear(holder).append(clipBody(cur, (patch) => {
      Object.assign(cur, patch);
      change(() => its.forEach((i) => {
        if (patch.kind && patch.kind !== i.data?.kind) { const [cw, ch] = CLIP_SIZE[patch.kind]; i.x += (i.w - cw) / 2; i.y += (i.h - ch) / 2; i.w = cw; i.h = ch; }
        i.data = { ...i.data, kind: cur.kind, metal: cur.metal };
        if ('color' in patch) i.color = patch.color;
      }));
      paint();
    }));
    paint();
    openPop({ ...anchorFor(btn), title: '📎 Clip', width: 400, body: holder });
  }

  // ---------- jump links: tap to glide to another place on the board ----------
  let picking = null;
  const backStack = [];
  const backBar = h('div', { class: 'bd-back', hidden: true },
    h('button', { type: 'button', class: 'btn primary', title: 'Glide back to where you were', onclick: () => jumpBack() }, 'i:undo-2', ' Back'));
  root.append(backBar);
  const itemName = (i) => {
    const n = data.order.indexOf(i.id);
    const t = String(i.title || i.text || TYPE_LABEL[i.type] || i.type).split('\n')[0].trim().slice(0, 42);
    return n >= 0 ? `Slide ${n + 1} · ${t.replace(/^\d+\.\s*/, '')}` : t;
  };
  // run fn on a tap (not a drag) that started at pointer event e
  function onTap(e, fn) {
    const x = e.clientX, y = e.clientY;
    const up = (ev) => { window.removeEventListener('pointerup', up, true); if (Math.hypot(ev.clientX - x, ev.clientY - y) < 8) fn(); };
    window.addEventListener('pointerup', up, true);
  }
  function viewOf(t) {
    const pad = t.type === 'frame' ? 36 : Math.max(90, Math.min(220, Math.max(t.w, t.h) * 0.6));
    return sf.frameFor({ x: t.x, y: t.y, w: t.w, h: t.h }, { pad, maxZoom: t.type === 'frame' ? 2 : 1.35, insets: { top: root.classList.contains('presenting') ? 0 : 64, left: staged() ? 0 : 64 } });
  }
  function glide(view) {
    const c = sf.cam, { W, H } = sf.size;
    const from = { x: (W / 2 - c.tx) / c.k, y: (H / 2 - c.ty) / c.k }, to = { x: (W / 2 - view.tx) / view.k, y: (H / 2 - view.ty) / view.k };
    const far = Math.hypot(to.x - from.x, to.y - from.y) * Math.min(c.k, view.k);
    sf.flyTo(view, Math.round(Math.min(1500, 620 + far * 0.35)), { arc: true });
    return Math.min(1500, 620 + far * 0.35);
  }
  function jumpFrom(it) {
    const t = byId(it?.data?.jump);
    if (!t) { notify('The place this links to was removed. Pick a new one with ⌖.', 'error'); return; }
    if (sel.size) select([]); // the selection's toolbar would be left floating where you came from
    backStack.push({ k: sf.cam.k, tx: sf.cam.tx, ty: sf.cam.ty }); if (backStack.length > 20) backStack.shift();
    backBar.hidden = false;
    const ms = glide(viewOf(t));
    const el = els.get(t.id);
    if (el) setTimeout(() => { el.classList.remove('jump-arrive'); void el.offsetWidth; el.classList.add('jump-arrive'); setTimeout(() => el.classList.remove('jump-arrive'), 1500); }, ms - 120);
  }
  function jumpBack() {
    const v = backStack.pop();
    if (v) glide(v);
    backBar.hidden = !backStack.length;
  }
  const pickHint = h('div', { class: 'pick-hint', hidden: true }, h('span', null, '⌖ Tap the place to jump to. Move around freely.'), h('button', { type: 'button', class: 'btn sm', onclick: () => endPick() }, 'Cancel'));
  root.append(pickHint);
  function startPick(src) { closePop(); picking = src.id; root.classList.add('picking'); pickHint.hidden = false; }
  function endPick() { picking = null; root.classList.remove('picking'); pickHint.hidden = true; }
  function setJump(src, id) { change(() => { src.data = { ...src.data, jump: id }; }); }
  function finishPick(id) {
    const src = byId(picking);
    endPick();
    if (!src) return;
    setJump(src, id);
    notify(`Linked to “${itemName(byId(id))}”. Tap ➜ to glide there.`, 'good');
    select([src.id]);
  }
  function jumpPop(btn, pt) {
    const src = [...sel].map(byId).filter(Boolean)[0];
    if (!src) return;
    const holder = h('div');
    const paint = () => {
      const target = byId(src.data?.jump);
      const search = h('input', { type: 'search', placeholder: 'Find a slide, frame or item…', oninput: () => fill() });
      const list = h('div', { class: 'jump-list' });
      const fill = () => {
        const q = search.value.trim().toLowerCase();
        const cands = data.items.filter((i) => i.id !== src.id && i.type !== 'ink' && i.type !== 'clip')
          .sort((a, b) => (a.type === 'frame' ? 0 : 1) - (b.type === 'frame' ? 0 : 1) || (data.order.indexOf(a.id) + 1 || 999) - (data.order.indexOf(b.id) + 1 || 999))
          .filter((i) => !q || itemName(i).toLowerCase().includes(q)).slice(0, 80);
        clear(list).append(...cands.map((i) => h('button', { type: 'button', class: i.id === target?.id ? 'on' : '', onclick: () => { setJump(src, i.id); paint(); } }, raw(itemName(i)), h('small', null, TYPE_LABEL[i.type] || i.type))));
        if (!cands.length) list.append(h('p', { class: 'phint' }, 'Nothing matches.'));
      };
      fill();
      const label = h('input', { type: 'text', maxLength: 40, value: src.data?.jumpLabel || '', placeholder: 'Button text (optional), e.g. See the plan',
        onchange: (e) => change(() => { const v = e.target.value.trim(); src.data = { ...src.data }; if (v) src.data.jumpLabel = v; else delete src.data.jumpLabel; }) });
      clear(holder).append(h('div', { class: 'pgrid' },
        h('div', { class: 'row', style: 'gap:8px;align-items:center;flex-wrap:wrap' },
          h('b', null, target ? `Goes to: ${itemName(target)}` : 'Not linked yet'),
          target ? h('button', { type: 'button', class: 'btn sm', onclick: () => { closePop(); jumpFrom(src); } }, '▶ Try it') : null),
        h('button', { type: 'button', class: 'btn primary', onclick: () => startPick(src) }, '⌖ Pick it on the board'),
        search, list,
        label,
        toggleRow('Show the jump button', !src.data?.jumpHide, (v) => change(() => { src.data = { ...src.data }; if (v) delete src.data.jumpHide; else src.data.jumpHide = true; })),
        h('p', { class: 'phint' }, 'Tap ➜ to glide there; ↩ Back brings you home. While locked, presenting or on a shared link, tapping the item itself also jumps.'),
        target ? h('button', { type: 'button', class: 'btn sm danger', onclick: () => { change(() => { src.data = { ...src.data }; delete src.data.jump; delete src.data.jumpLabel; delete src.data.jumpHide; }); closePop(); } }, 'Remove the link') : null));
    };
    paint();
    openPop({ ...(btn ? anchorFor(btn) : pt), title: '⌖ Jump link', width: 380, body: holder });
  }

  // ---------- AI designer: understands the board, asks, then designs section by section ----------
  const DESIGN_CHIPS = ['Redesign it properly: every slide its own layout, the whole toolkit', 'Fix overlaps, alignment and text sizes everywhere', 'Add more: tips on paper notes, stickers, a checklist and a menu with jump links', 'Make the text bigger and bolder'];
  let session = null;
  const regionOf = (id) => { const f = byId(id); if (f) return { x: f.x, y: f.y, w: f.w, h: f.h }; const its = data.items.filter((i) => i.type !== 'frame'); const b = bounds(its.length ? its : data.items); return b && { x: b.x0, y: b.y0, w: b.w, h: b.h }; };
  const picture = (id, maxW = 1280) => { try { const r = regionOf(id); return r ? snapshotBoard(data, r, { maxW }) : null; } catch { return null; } };
  function takeBoard(b) {
    data.items = b.data.items || []; data.links = b.data.links || []; data.order = b.data.order || [];
    data.settings = { ...data.settings, ...(b.data.settings || {}) };
    sf.setGround(data.settings.ground || 'dots');
    version = b.version; board.version = b.version;
    if (b.name && b.name !== name) { name = b.name; nameEl.textContent = name; onRenamed?.(name, icon); }
    sel.clear(); render();
  }
  // which saved key (and model) does the designing
  function keyRow(state) {
    const holder = h('div', { class: 'ai-keyrow' });
    const paint = async () => {
      const keys = S.user?.aiKeys || [];
      if (!keys.length) { clear(holder).append(h('span', { class: 'phint' }, 'No AI key yet.'), h('button', { type: 'button', class: 'btn sm primary', onclick: () => openBrainSettings({ onClose: paint }) }, '🧠 Add a key')); return; }
      if (!keys.some((k) => k.id === state.keyId)) state.keyId = keys.some((k) => k.id === S.user.settings?.aiActive) ? S.user.settings.aiActive : keys[0].id;
      const k = keys.find((x) => x.id === state.keyId);
      const keySel = h('select', { 'aria-label': 'AI key', onchange: (e) => { state.keyId = e.target.value; paint(); } }, keys.map((x) => h('option', { value: x.id, selected: x.id === state.keyId }, `${x.label}${x.test?.ok ? '' : x.test ? ' (failing)' : ''}`)));
      const modelSel = h('select', { 'aria-label': 'Model', onchange: async (e) => { try { await updateAiKey(k.id, { model: e.target.value }); notify(`Now using ${e.target.value}`, 'good'); } catch (err) { notify(err.message, 'error'); } } }, h('option', { value: k.model, selected: true }, k.model || 'default model'));
      clear(holder).append(h('span', { class: 'pl' }, 'AI'), keySel, modelSel, h('button', { type: 'button', class: 'btn sm', title: 'Keys, models and providers', onclick: () => openBrainSettings({ onClose: paint }) }, '🧠'));
      // fill the model list from the provider, without blocking the popup
      (async () => {
        try {
          const list = k.provider === 'nvidia' ? await nvidiaModels() : k.provider === 'compatible' ? null : await keyModels(k.id);
          const all = [...new Set([...(list?.recommended || []), ...(list?.all || [])])];
          if (all.length && modelSel.isConnected) modelSel.replaceChildren(...[...new Set([k.model, ...all].filter(Boolean))].map((m) => h('option', { value: m, selected: m === k.model }, m)));
        } catch { /* the current model stays selectable */ }
      })();
    };
    paint();
    return holder;
  }
  function aiPop(btn) {
    const st = { keyId: S.user?.settings?.aiActive, ask: S.user?.settings?.designAsk !== false };
    const box = h('textarea', { class: 'ai-in', rows: 4, placeholder: 'What should the AI design or change? “Redesign this into a beautiful tutorial deck”, “Add a slide about pricing”, “Make every title bigger and centred”…' });
    const chip = (t) => h('button', { type: 'button', class: 'chip', onclick: () => { box.value = t; box.focus(); } }, t);
    const prefs = Array.isArray(S.user?.settings?.designPrefs) ? S.user.settings.designPrefs : [];
    const go = h('button', { type: 'button', class: 'btn primary', onclick: () => { if (box.value.trim().length < 3) { notify('Say what to design first', 'error'); return; } closePop(); runDesign(box.value.trim(), st); } }, '✨ Start');
    openPop({ anchor: btn, title: '✨ AI designer', width: 460, body: h('div', { class: 'pgrid' },
      box,
      h('div', { class: 'chips' }, DESIGN_CHIPS.map(chip)),
      keyRow(st),
      toggleRow('Ask me questions first', st.ask, (v) => { st.ask = v; saveSettings({ designAsk: v }).catch(() => {}); }),
      prefs.length || S.user?.settings?.designDirection ? h('details', { class: 'ai-prefs' }, h('summary', null, `What it remembers about your taste (${prefs.length + (S.user.settings.designDirection ? 1 : 0)})`),
        h('ul', null, S.user.settings.designDirection ? h('li', null, `Style: ${S.user.settings.designDirection}`) : null, prefs.slice(-12).map((p) => h('li', null, raw(p)))),
        h('button', { type: 'button', class: 'btn sm', onclick: async () => { await saveSettings({ designPrefs: [], designDirection: null }); notify('Forgotten. It will ask again.', 'good'); closePop(); } }, 'Forget it')) : null,
      h('div', { class: 'row', style: 'justify-content:space-between;align-items:center' }, h('small', { class: 'phint' }, 'It studies the board, asks you, then designs one section at a time. One Undo puts it all back.'), go)) });
    setTimeout(() => box.focus(), 50);
  }
  // the questions: buttons for yes/no and choices, a box for text, all optional
  function askOwner(questions) {
    return new Promise((resolve) => {
      const answers = new Map();
      let remember = true, done = false;
      const finish = (v) => { if (done) return; done = true; resolve(v); };
      const body = h('div', { class: 'aiq' }, questions.map((q) => {
        const row = h('div', { class: 'aiq-opts' });
        const pick = (val, label, btnEl) => { answers.set(q.id, { q: q.q, a: label, id: val }); row.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btnEl)); };
        if (q.type === 'yesno') ['Yes', 'No'].forEach((l) => { const b = h('button', { type: 'button', class: 'aiq-btn', onclick: () => pick(l.toLowerCase(), l, b) }, l); row.append(b); });
        else if (q.type === 'text') row.append(h('input', { type: 'text', placeholder: 'Type your answer', oninput: (e) => { if (e.target.value.trim()) answers.set(q.id, { q: q.q, a: e.target.value.trim() }); else answers.delete(q.id); } }));
        else q.options.forEach((o, i) => { const b = h('button', { type: 'button', class: 'aiq-btn opt', onclick: () => pick(o.id, o.label, b) },
          h('b', null, `${String.fromCharCode(65 + i)}. ${o.label}`), o.colors ? h('span', { class: 'aiq-sw' }, o.colors.map((c) => h('i', { style: { background: c } }))) : null, o.hint ? h('small', null, o.hint) : null); row.append(b); });
        return h('div', { class: 'aiq-q' }, h('p', null, raw(q.q)), row);
      }), toggleRow('Remember my answers for next time', true, (v) => { remember = v; }));
      openModal({ title: '✨ A few questions first', body, onClose: () => finish(null), actions: [
        { label: 'Skip, decide yourself', onClick: () => { finish({ answers: [], direction: null, remember: false }); } },
        { label: 'Design it', kind: 'primary', onClick: () => { const list = [...answers.values()]; const dir = answers.get('direction')?.id; finish({ answers: list.filter((a) => a.q !== questions.find((x) => x.id === 'direction')?.q), direction: dir && dir !== 'auto' ? dir : null, remember }); } },
      ] });
    });
  }
  async function rememberTaste(res) {
    const prev = Array.isArray(S.user?.settings?.designPrefs) ? S.user.settings.designPrefs : [];
    const lines = res.answers.map((a) => `${a.q.replace(/\?$/, '')}: ${a.a}`.slice(0, 160));
    const next = [...prev.filter((p) => !lines.some((l) => l.split(':')[0] === p.split(':')[0])), ...lines].slice(-20);
    await saveSettings({ designPrefs: next, ...(res.direction ? { designDirection: res.direction } : {}) }).catch(() => {});
  }
  function sessionPanel() {
    const steps = h('ol', { class: 'ais-steps' });
    const head = h('div', { class: 'ais-head' }, h('b', null, '✨ AI designer'), h('small', null, ''));
    const about = h('p', { class: 'ais-about' }, 'Studying your board…');
    const stop = h('button', { type: 'button', class: 'btn sm', onclick: () => { if (session) { session.stop = true; setText(stop, 'Stopping after this step…'); stop.disabled = true; } } }, 'Stop');
    const close = h('button', { type: 'button', class: 'btn sm primary', hidden: true, onclick: () => el.remove() }, 'Done');
    const el = h('div', { class: 'ai-session' }, head, about, steps, h('div', { class: 'row', style: 'justify-content:flex-end;gap:8px' }, stop, close));
    root.append(el);
    const rows = [];
    return {
      el, about, setKey: (t) => setText(head.lastChild, t),
      setSteps: (list) => { clear(steps); rows.length = 0; list.forEach((s) => { const r = h('li', { class: 'wait' }, h('span', { class: 'st' }), h('div', null, h('b', null, raw(s.title)), h('small', null, ''))); rows.push(r); steps.append(r); }); },
      mark: (i, state, note) => { const r = rows[i]; if (!r) return; r.className = state; if (note !== undefined) setText(r.querySelector('small'), note); },
      end: () => { stop.hidden = true; close.hidden = false; },
    };
  }
  async function runDesign(request, opts = {}) {
    if (session) { notify('The AI is already designing', 'error'); return; }
    if (!(S.user?.aiKeys || []).length) { openBrainSettings(); notify('Add an AI key first', 'error'); return; }
    const panel = sessionPanel();
    session = { stop: false };
    const before0 = snapshot();
    const call = async (body) => {
      const r = await api('POST', `/api/boards/${board.id}/design`, { request, keyId: opts.keyId, ...body });
      takeBoard(r.board);
      if (r.usedKey) panel.setKey(r.usedKey);
      return r;
    };
    let changed = false;
    try {
      await flushSave();
      await Promise.all([document.fonts?.load('600 24px "Caveat"'), document.fonts?.load('800 24px Manrope')]).catch(() => {}); // so the pictures show the real lettering
      const plan = await call({ phase: 'plan', images: [picture(null, 1600)].filter(Boolean) });
      setText(panel.about, plan.understanding || plan.summary || 'Plan ready.');
      let answers = [], direction = plan.direction;
      if (opts.ask !== false && plan.questions?.length) {
        const res = await askOwner(plan.questions);
        if (!res) { setText(panel.about, 'Stopped before designing.'); return; }
        answers = res.answers; direction = res.direction || direction;
        if (res.remember && (res.answers.length || res.direction)) rememberTaste(res);
      }
      const steps = [...plan.steps, { focus: 'all', title: 'Final polish: the whole board together' }];
      panel.setSteps(steps);
      for (let i = 0; i < steps.length; i++) {
        if (session.stop) { for (let j = i; j < steps.length; j++) panel.mark(j, 'skip', 'skipped'); break; }
        const st = steps[i];
        panel.mark(i, 'work', 'designing…');
        try {
          if (st.focus === 'all') {
            const r = await call({ phase: 'polish', answers, direction, images: [picture(null, 1600)].filter(Boolean) });
            panel.mark(i, 'ok', r.summary); changed = true;
            continue;
          }
          if (byId(st.focus)) glide(viewOf(byId(st.focus)));
          let r = await call({ phase: 'section', focus: st.focus, step: st, answers, direction, images: [byId(st.focus) ? picture(st.focus) : null].filter(Boolean) });
          changed = true;
          const f = byId(r.focus);
          if (f) glide(viewOf(f));
          if (r.issues?.length && !session.stop) {
            panel.mark(i, 'work', `fixing ${r.issues.length} thing${r.issues.length === 1 ? '' : 's'}…`);
            r = await call({ phase: 'fix', focus: r.focus, step: st, issues: r.issues, answers, direction, images: [picture(r.focus)].filter(Boolean) });
          }
          panel.mark(i, 'ok', r.summary || 'done');
        } catch (e) {
          panel.mark(i, 'fail', e.message.slice(0, 140));
          if (e.status === 429 || e.status === 400) { for (let j = i + 1; j < steps.length; j++) panel.mark(j, 'skip', 'skipped'); break; }
        }
      }
      setText(panel.about, `${plan.summary || 'Done.'} Undo puts the board back as it was.`);
    } catch (e) {
      setText(panel.about, e.message);
      notify(e.message, 'error');
    } finally {
      if (changed && before0 !== snapshot()) { undo.push(before0); redo = []; updateUndoBtns(); }
      panel.end();
      session = null;
    }
  }

  function hidePop(btn) {
    const its = [...sel].map(byId).filter((i) => i?.type === 'hide');
    if (!its.length) return;
    const f = its[0];
    const set = (patch) => change(() => its.forEach((i) => { i.data = { ...i.data, ...patch }; }));
    openPop({ ...anchorFor(btn), title: '🙈 Hide', width: 400, body: h('div', { class: 'pgrid' },
      segRow('Cover', [['blur', 'Blur'], ['frost', 'Frosted'], ['solid', 'Solid'], ['curtain', 'Stripes']], f.data?.cover || 'blur', (v) => set({ cover: v })),
      segRow('Tap', [['reveal', 'Disappears'], ['move', 'Drag it away'], ['none', 'Stays']], f.data?.tap || 'reveal', (v) => set({ tap: v })),
      toggleRow('Show the label', !f.data?.nolabel, (v) => set({ nolabel: !v })),
      h('p', { class: 'phint' }, 'Lay it over an answer, a price or the next step. When the board is 🔒 locked, presenting or shared, a tap makes it vanish. Resize it freely; double-click to change the label.')) });
  }
  function shapeSwap(btn) {
    const it = [...sel].map(byId).find((i) => i?.type === 'shape');
    openPop({ ...anchorFor(btn), title: 'Shape', width: 330, body: h('div', { class: 'shape-grid' }, Object.entries(SHAPE_LABEL).map(([k, label]) => h('button', { type: 'button', class: `btn${it?.data?.shape === k ? ' on' : ''}`, onclick: () => { change(() => { it.data = { ...it.data, shape: k }; }); closePop(); } }, label))) });
  }
  function shapePicker(btn) {
    openPop({ anchor: btn, title: 'Pick a shape, then tap the board', width: 330, body: h('div', { class: 'shape-grid' }, Object.entries(SHAPE_LABEL).map(([k, label]) => h('button', { type: 'button', class: `btn${shapeKind === k ? ' on' : ''}`, onclick: () => { shapeKind = k; closePop(); } }, label))) });
  }
  function stickerPicker(btn, pt, at) {
    const pickOne = (v) => { sticker = v; closePop(); if (at) place(makeItem('sticker', { text: v, w: 84, h: 84, anim: { in: 'pop', loop: v.startsWith('i:') ? 'none' : 'bounce' } }), at); };
    const b = (v, face) => h('button', { type: 'button', class: `emo-b${sticker === v ? ' on' : ''}`, title: v.startsWith('i:') ? v.slice(2).replace(/-/g, ' ') : '', onclick: () => pickOne(v) }, face);
    openPop({ ...(btn ? { anchor: btn } : pt), title: at ? 'Add a sticker' : 'Pick a sticker, then tap the board', width: 380, body: h('div', { class: 'pgrid' },
      h('div', { class: 'psec' }, 'Icons · take the colour you give them'),
      h('div', { class: 'emo-grid ico-grid' }, ICON_STICKERS.map((v) => b(v, svgIcon(v.slice(2))))),
      h('div', { class: 'psec' }, 'Emoji'),
      h('div', { class: 'emo-grid' }, STICKERS.map((v) => b(v, raw(v))))) });
  }
  function penPicker(btn) {
    openPop({ anchor: btn, title: '✏️ Draw', width: 340, body: h('div', { class: 'pgrid' },
      segRow('Tool', [['pen', 'Pen'], ['highlight', 'Highlighter']], tool, (v) => { tool = v; root.dataset.tool = v; }),
      swatchRow('Colour', ['#ff7a2f', '#ff4d5e', '#ffc933', '#2fb457', '#1c1916', '#ffffff', '#ff5fa2'], penColor, (c) => { penColor = c; }),
      tool === 'pen' ? rangeRow('Width', data.settings.penWidth || 4, 1, 24, 1, (v) => { data.settings.penWidth = v; }) : null,
      h('p', { class: 'phint' }, 'Draw with your finger, pen or mouse. ⌫ Eraser removes whole strokes.')) });
  }
  function imagePicker(btn, pt) {
    const input = h('input', { type: 'url', placeholder: 'Paste an image link (https://…)' });
    const body = h('div', { class: 'pgrid' },
      h('button', { type: 'button', class: 'btn primary', onclick: async () => { closePop(); const files = await pickFiles('image/*', true); for (const f of files) await addImageFile(f); setTool('select'); } }, '⬆ Upload from this device'),
      h('div', { class: 'row' }, input, h('button', { type: 'button', class: 'btn', onclick: () => { const u = input.value.trim(); if (!u) return; place(makeItem('image', { w: 360, h: 260, data: { url: /^https?:/i.test(u) ? u : `https://${u}` } })); closePop(); setTool('select'); } }, 'Add')),
      h('p', { class: 'phint' }, 'You can also paste an image or drop files anywhere on the board.'));
    openPop({ ...(btn ? { anchor: btn } : pt), title: '🖼️ Image', body, width: 380 });
    setTimeout(() => input.focus(), 60);
  }
  async function replaceImage(it) { const [f] = await pickFiles('image/*'); if (!f) return; try { const up = await uploadFile(board.id, f); change(() => { it.data = { fileId: up.id, name: up.name }; }); } catch (e) { notify(e.message, 'error'); } }
  async function coverImage(it) { const [f] = await pickFiles('image/*'); if (!f) return; try { const up = await uploadFile(board.id, f); change(() => { it.data = { ...it.data, coverFile: up.id }; if (it.h < 260) it.h = 300; }); } catch (e) { notify(e.message, 'error'); } }
  function projectPicker(btn) {
    const list = projects();
    openPop({ anchor: btn, title: '📊 Live project', width: 340, body: h('div', { class: 'pgrid' }, list.length ? list.map((p) => h('button', { type: 'button', class: 'btn', style: 'justify-content:flex-start', onclick: () => { closePop(); place(makeItem('project', { w: 280, h: 150, data: { projectId: p.id } })); setTool('select'); } }, `${p.icon || '•'} ${p.name}`)) : h('p', { class: 'phint' }, 'Add projects in the tracker first.')) });
  }
  function pickIcon(btn) {
    const ICONS = ['🧩', '🎬', '🎓', '📈', '🧠', '🚀', '💡', '🗺️', '📋', '🎯', '💰', '📺', '🎵', '🛒', '⚽', '💬', '🏆', '🔥'];
    openPop({ anchor: btn, title: 'Board icon', width: 320, body: h('div', { class: 'emo-grid' }, ICONS.map((s) => h('button', { type: 'button', class: 'emo-b', onclick: () => { icon = s; setText(iconBtn, s); closePop(); onRenamed?.(name, icon); save(); } }, s))) });
  }
  function boardLook(btn) {
    const theme = window.flowmapTheme;
    openPop({ anchor: btn, title: '🎨 Board look', width: 400, body: h('div', { class: 'pgrid' },
      theme ? segRow('Theme', [['system', 'Device'], ['light', 'Light'], ['dark', 'Dark']], theme.pref || 'system', (v) => theme.set(v)) : null,
      segRow('Floor', [['dots', 'Dots'], ['grid', 'Grid'], ['plain', 'Plain']], data.settings.ground || 'dots', (v) => { data.settings.ground = v; sf.setGround(v); renderLinks(); save(); }),
      readonly ? null : toggleRow('Snap to grid', data.settings.snap !== false, (v) => { data.settings.snap = v; save(); }),
      readonly ? null : h('div', { class: 'psec' }, 'New connections'),
      readonly ? null : linkStyleBody({ ...LINK_DEFAULT, ...(data.settings.linkStyle || {}) }, (patch) => { data.settings.linkStyle = { ...LINK_DEFAULT, ...(data.settings.linkStyle || {}), ...patch }; save(); }, { fitWidth: true })) });
  }

  // ---------- keyboard ----------
  const onKey = (e) => {
    if (destroyed || !root.isConnected || root.closest('[hidden]') || e.target.closest?.('input, textarea, [contenteditable="true"]') || document.querySelector('.scrim, .pres')) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (k === 'escape' && picking) { endPick(); return; }
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
    if (mod && k === 'y') { e.preventDefault(); doRedo(); return; }
    if (readonly) { if (k === 'x') setTool(tool === 'laser' ? 'hand' : 'laser'); return; }
    if (locked) { if (k === 'k') setLocked(false); else if (k === 'x') setTool(tool === 'laser' ? 'select' : 'laser'); return; }
    if (k === 'k' && !mod) { setLocked(true); return; }
    if (mod && k === 'a') { e.preventDefault(); select(data.items.map((i) => i.id)); return; }
    if (mod && k === 'd') { e.preventDefault(); duplicate(); return; }
    if (mod && k === 'c') { copySel(); return; }
    if (mod && k === 'x') { copySel(true); return; }
    if (mod && k === 'l') { e.preventDefault(); const its = [...sel].map(byId).filter(Boolean); change(() => { const v = !its.every((i) => i.locked); its.forEach((i) => { i.locked = v; }); }); return; }
    if (mod) return;
    if (k === 'delete' || k === 'backspace') { e.preventDefault(); removeSel(); return; }
    if (k === 'escape') { if (sel.size) select([]); else setTool('select'); closeMenu(); return; }
    if (k === 'enter' && sel.size === 1) { e.preventDefault(); startEdit([...sel][0]); return; }
    if (k === ']') { zorder('front'); return; }
    if (k === '[') { zorder('back'); return; }
    if (e.key === '!' || (e.shiftKey && k === '1')) { fitAll(); return; }
    if (k.startsWith('arrow') && sel.size) {
      e.preventDefault();
      const d = e.shiftKey ? 22 : 2, dx = k === 'arrowleft' ? -d : k === 'arrowright' ? d : 0, dy = k === 'arrowup' ? -d : k === 'arrowdown' ? d : 0;
      change(() => [...sel].map(byId).filter((i) => i && !i.locked).forEach((i) => { i.x += dx; i.y += dy; }));
      return;
    }
    const t = TOOLS.find((x) => x[3] === k);
    if (t) setTool(t[0]);
  };
  window.addEventListener('keydown', onKey);

  // ---------- view ----------
  function fitAll(animate = true) {
    const its = data.items;
    if (!its.length) { sf.flyTo({ k: 1, tx: sf.size.W / 2, ty: sf.size.H / 2 }, animate ? 400 : 0); return; }
    const b = bounds(its);
    const { W, H } = sf.size;
    // a wide board on a phone would shrink to nothing: start readable at its top-left and let the person pan
    if (W < 700 && Math.min(W / b.w, H / b.h) < 0.28) { const k = 0.32; sf.flyTo({ k, tx: 16 - b.x0 * k, ty: 70 - b.y0 * k }, animate ? 500 : 0); return; }
    sf.fit({ x: b.x0, y: b.y0, w: b.w, h: b.h }, { pad: 60, maxZoom: 1, insets: { top: 64, left: readonly ? 0 : 64 }, animate });
  }
  function toggleFull() {
    const app = document.getElementById('app');
    const on = !app.classList.contains('immersive');
    app.classList.toggle('immersive', on);
    if (on) document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
    else if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    setTimeout(() => sf.resize(), 80);
  }
  const onFs = () => { if (!document.fullscreenElement) document.getElementById('app')?.classList.remove('immersive'); setTimeout(() => sf.resize(), 60); };
  document.addEventListener('fullscreenchange', onFs);

  let presenting = null;
  function present(startId) {
    closePop(); closeMenu(); select([]); if (editing) document.activeElement?.blur?.();
    presenting = startPresenting({ root, sf, getData: () => data, els, byId, startId, readonly, onEnd: () => { presenting = null; resetStage(); }, setToolLaser: () => setTool('laser') });
  }

  const ctx = { get share() { return share; }, readonly };
  sf.setGround(data.settings.ground || 'dots');
  render();
  requestAnimationFrame(() => fitAll(false));
  setTool(readonly ? 'hand' : 'select');
  updateUndoBtns();
  updateStageBar();
  const offTheme = () => renderLinks();
  window.addEventListener('flowmap-theme', offTheme);
  window.addEventListener('flowmap-motion', offTheme); // lights ⇄ still arrows

  return {
    root,
    destroy() {
      destroyed = true; save.flush?.();
      window.removeEventListener('keydown', onKey); document.removeEventListener('paste', onPaste); document.removeEventListener('fullscreenchange', onFs);
      window.removeEventListener('flowmap-theme', offTheme); window.removeEventListener('flowmap-motion', offTheme);
      presenting?.end?.(); closePop(); closeMenu();
      sf.destroy(); root.remove();
    },
    present,
    design: (request, opts) => runDesign(request, opts),
    lock: setLocked,
    fit: fitAll,
    resize: () => sf.resize(),
    get data() { return data; },
  };
}
