// Presenting a board: frames become slides and the camera glides between them. Built for screen recording:
// the controls hide themselves, and a laser pointer, a spotlight and a pen draw on top of everything.
import { h, raw } from '../util.js';
import { inside } from '/shared/board.js';

export function startPresenting({ root, sf, getData, els, byId, startId, onEnd, saveSettings }) {
  const data = getData();
  let slides = data.order.map(byId).filter((f) => f && f.type === 'frame');
  if (!slides.length) slides = data.items.filter((i) => i.type === 'frame').sort((a, b) => (Math.abs(a.y - b.y) > 200 ? a.y - b.y : a.x - b.x));
  let idx = Math.max(0, startId ? slides.findIndex((s) => s.id === startId) : 0);
  let mode = 'pointer', t0 = Date.now(), hideTimer = 0, penColor = '#ff3b30';

  const app = document.getElementById('app');
  const wasImmersive = app.classList.contains('immersive');
  app.classList.add('immersive');
  root.classList.add('presenting');
  document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});

  const canvas = h('canvas', { class: 'pres-draw' });
  const spot = h('div', { class: 'pres-spot', hidden: true });
  const notes = h('div', { class: 'pres-notes', hidden: true });
  const count = h('b', { class: 'pres-count' });
  const clock = h('span', { class: 'pres-clock' }, '0:00');
  const tb = (m, ic, title) => h('button', { type: 'button', class: 'pb', 'data-m': m, title, onclick: () => setMode(m) }, ic);
  const bar = h('div', { class: 'pres-bar' },
    h('button', { type: 'button', class: 'pb', title: 'Previous (←)', onclick: () => go(idx - 1) }, '◀'), count, h('button', { type: 'button', class: 'pb', title: 'Next (→ or Space)', onclick: () => go(idx + 1) }, '▶'),
    h('i', { class: 'pdiv' }),
    tb('pointer', '🖐', 'Move and click (M)'), tb('laser', '🔴', 'Laser pointer (L)'), tb('spot', '🔦', 'Spotlight (S)'), tb('pen', '✏️', 'Draw on screen (P)'),
    h('button', { type: 'button', class: 'pb', title: 'Clear drawings (C)', onclick: () => clearInk() }, '🧽'),
    h('button', { type: 'button', class: 'pb', title: 'Your pointer: hold Q to show it, hold W to show it flipped', onclick: () => togglePick() }, raw('👉')),
    h('i', { class: 'pdiv' }),
    h('button', { type: 'button', class: 'pb', title: 'Speaker notes (N)', onclick: () => toggleNotes() }, '📝'), clock,
    h('button', { type: 'button', class: 'pb', title: 'Hide these controls (H); move the mouse to bring them back', onclick: () => hideBar(true) }, '🙈'),
    h('button', { type: 'button', class: 'pb ex', title: 'Stop presenting (Esc)', onclick: () => end() }, '✕'));
  // a big pointer (an emoji or your own PNG) that follows the mouse while Q is held; W shows it flipped
  const PTR_EMOJI = ['👉', '👈', '👆', '👇', '☝️', '🫵', '✋', '👀', '🔍', '➡️', '⬅️', '🎯', '📍', '⭐', '🔥', '🪄', '✏️', '💡'];
  const TIP = { '👉': 'right', '👈': 'left', '👆': 'up', '☝️': 'up', '👇': 'down', '🫵': 'center', '➡️': 'right', '⬅️': 'left', '✏️': 'left', '🪄': 'left' };
  let ptr = { emoji: '👉', img: '', tip: '', size: 72, ...(data.settings?.pointer || {}) };
  const ptrEl = h('div', { class: 'pres-ptr', hidden: true });
  let held = new Set(), stick = false, pick = null;
  const wrap = h('div', { class: 'pres' }, canvas, spot, notes, ptrEl, bar);
  root.append(wrap);
  const tipOf = () => ptr.tip || (ptr.img ? 'right' : TIP[ptr.emoji] || 'center');
  function drawPtr() {
    ptrEl.style.setProperty('--ps', `${ptr.size}px`);
    ptrEl.replaceChildren(ptr.img ? h('img', { src: ptr.img, alt: '' }) : h('span', {}, raw(ptr.emoji)));
  }
  function placePtr() {
    const on = held.size > 0 || stick;
    ptrEl.hidden = !on;
    if (!on) return;
    const flip = held.has('w') && !held.has('q');
    ptrEl.classList.toggle('flip', flip);
    const r = wrap.getBoundingClientRect(), p = pointer || { x: r.width / 2, y: r.height / 2 }, s = ptr.size;
    // put the tip of the pointer on the mouse
    let tip = tipOf();
    if (flip && tip === 'right') tip = 'left'; else if (flip && tip === 'left') tip = 'right';
    const ox = tip === 'right' ? s * 0.92 : tip === 'left' ? s * 0.08 : s / 2, oy = tip === 'down' ? s * 0.92 : tip === 'up' ? s * 0.08 : s / 2;
    ptrEl.style.transform = `translate(${p.x - ox}px, ${p.y - oy}px)`;
  }
  drawPtr();
  function keepPtr(patch) { ptr = { ...ptr, ...patch }; drawPtr(); placePtr(); saveSettings?.({ pointer: ptr }); }
  async function shrinkImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
      const k = Math.min(1, 256 / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL('image/png');
    } finally { URL.revokeObjectURL(url); }
  }
  function togglePick() {
    if (pick) { pick.remove(); pick = null; return; }
    const file = h('input', { type: 'file', accept: 'image/png,image/webp,image/gif,image/jpeg', hidden: true, onchange: async () => { const f = file.files[0]; if (f) { keepPtr({ img: await shrinkImage(f), tip: ptr.tip || 'right' }); render(); } } });
    const body = h('div', { class: 'pres-ptr-pick', onpointerdown: (e) => e.stopPropagation() });
    const render = () => {
      const tips = [['', 'Auto'], ['right', '→'], ['left', '←'], ['up', '↑'], ['down', '↓'], ['center', '•']];
      body.replaceChildren(
        h('b', {}, 'Pointer'),
        h('small', {}, 'Hold Q to show it and move the mouse. Hold W to show it flipped.'),
        h('div', { class: 'emo-grid' }, ...PTR_EMOJI.map((em) => h('button', { type: 'button', class: !ptr.img && ptr.emoji === em ? 'on' : '', onclick: () => { keepPtr({ emoji: em, img: '', tip: '' }); render(); } }, raw(em))),
          h('button', { type: 'button', class: ptr.img ? 'on' : '', title: 'Use your own picture (PNG with a see-through background works best)', onclick: () => file.click() }, ptr.img ? h('img', { src: ptr.img, alt: '', style: 'width:30px;height:30px;object-fit:contain' }) : raw('🖼️'))),
        h('label', { class: 'row' }, h('small', {}, 'Size '), h('input', { type: 'range', min: 28, max: 220, value: ptr.size, oninput: (e) => { keepPtr({ size: +e.target.value }); stick = true; placePtr(); } })),
        h('div', { class: 'row' }, h('small', {}, 'It points '), ...tips.map(([v, l]) => h('button', { type: 'button', class: `btn sm${(ptr.tip || '') === v ? ' primary' : ''}`, onclick: () => { keepPtr({ tip: v }); render(); } }, l))),
        h('div', { class: 'row' },
          h('button', { type: 'button', class: `btn sm${stick ? ' primary' : ''}`, title: 'Show it all the time, without holding a key (handy on a touchscreen)', onclick: () => { stick = !stick; placePtr(); render(); } }, stick ? 'Always on' : 'Only while holding Q / W'),
          h('button', { type: 'button', class: 'btn sm', onclick: () => togglePick() }, 'Done')),
        file);
    };
    render();
    pick = body;
    wrap.append(pick);
  }

  // ---------- slides ----------
  function go(n) {
    if (!slides.length) return;
    idx = Math.max(0, Math.min(slides.length - 1, n));
    const f = slides[idx];
    count.textContent = `${idx + 1} / ${slides.length}`;
    clearInk();
    const inFrame = data.items.filter((it) => it !== f && it.anim?.in && it.anim.in !== 'none' && inside(it, f));
    for (const it of inFrame) { const el = els.get(it.id); if (el) { el.classList.remove(...[...el.classList].filter((c) => c.startsWith('in-'))); el.classList.add('pre-in'); } }
    sf.fit({ x: f.x, y: f.y, w: f.w, h: f.h }, { pad: 24, maxZoom: 4, ms: 750 });
    setTimeout(() => {
      for (const it of inFrame) {
        const el = els.get(it.id);
        if (!el) continue;
        el.style.animationDelay = `${it.anim.delay || 0}s`;
        el.classList.remove('pre-in'); el.classList.add(`in-${it.anim.in}`);
        setTimeout(() => { el.classList.remove(`in-${it.anim.in}`); el.style.animationDelay = ''; }, 1200 + (it.anim.delay || 0) * 1000);
      }
    }, 700);
    notes.textContent = f.data?.notes || 'No speaker notes for this slide. Add them with right-click → Speaker notes.';
  }

  // ---------- tools ----------
  function setMode(m) {
    mode = mode === m && m !== 'pointer' ? 'pointer' : m;
    bar.querySelectorAll('[data-m]').forEach((b) => b.classList.toggle('on', b.dataset.m === mode));
    canvas.classList.toggle('active', mode === 'laser' || mode === 'pen');
    spot.hidden = mode !== 'spot';
    wrap.dataset.mode = mode;
  }
  setMode('pointer');
  const strokes = [];
  const trail = [];
  let raf = 0, drawing = null;
  const size = () => { const r = wrap.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1); if (canvas.width !== Math.round(r.width * dpr)) { canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr); } return { r, dpr }; };
  function paint() {
    const { r, dpr } = size();
    const c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, r.width, r.height);
    c.lineCap = 'round'; c.lineJoin = 'round';
    for (const s of strokes) {
      c.strokeStyle = s.color; c.lineWidth = 5; c.shadowColor = 'rgba(0,0,0,0.25)'; c.shadowBlur = 4;
      c.beginPath(); s.pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.stroke();
    }
    const now = performance.now();
    while (trail.length && now - trail[0].t > 650) trail.shift();
    for (let i = 1; i < trail.length; i++) {
      const a = trail[i - 1], b = trail[i], life = 1 - (now - b.t) / 650;
      c.strokeStyle = `rgba(255,59,48,${life * 0.85})`; c.lineWidth = 3 + life * 6; c.shadowColor = 'rgba(255,59,48,0.9)'; c.shadowBlur = 16;
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
    }
    if (mode === 'laser' && pointer) { c.fillStyle = '#ff3b30'; c.shadowColor = '#ff3b30'; c.shadowBlur = 20; c.beginPath(); c.arc(pointer.x, pointer.y, 7, 0, Math.PI * 2); c.fill(); }
    raf = trail.length || mode === 'laser' ? requestAnimationFrame(paint) : 0;
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(paint); };
  let pointer = null;
  const local = (e) => { const r = wrap.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const p = local(e);
    if (mode === 'pen') { drawing = { color: penColor, pts: [[p.x, p.y]] }; strokes.push(drawing); kick(); }
  });
  // listen on the whole board: in pointer and spotlight mode the overlay lets the mouse through
  const onMove = (e) => {
    const p = local(e);
    pointer = p;
    if (!ptrEl.hidden) placePtr();
    showBarSoon(e);
    if (mode === 'laser') { trail.push({ ...p, t: performance.now() }); kick(); }
    if (mode === 'spot') { spot.style.setProperty('--x', `${p.x}px`); spot.style.setProperty('--y', `${p.y}px`); }
    if (mode === 'pen' && drawing) { drawing.pts.push([p.x, p.y]); kick(); }
  };
  root.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', () => { drawing = null; });
  function clearInk() { strokes.length = 0; kick(); }
  function toggleNotes() { notes.hidden = !notes.hidden; }
  // controls hide themselves while recording and come back with the mouse
  function hideBar(now) { clearTimeout(hideTimer); if (now) bar.classList.add('away'); else hideTimer = setTimeout(() => bar.classList.add('away'), 2600); }
  function showBarSoon(e) { const r = wrap.getBoundingClientRect(); if (e.clientY > r.bottom - 140 || !bar.classList.contains('away')) { bar.classList.remove('away'); hideBar(false); } }
  hideBar(false);
  // first slide (after the ink layer exists: go() clears it)
  if (slides.length) go(idx);
  else {
    count.textContent = 'Free';
    const b = data.items.length ? data.items.reduce((a, i) => ({ x0: Math.min(a.x0, i.x), y0: Math.min(a.y0, i.y), x1: Math.max(a.x1, i.x + i.w), y1: Math.max(a.y1, i.y + i.h) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }) : null;
    if (b) sf.fit({ x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 }, { pad: 40, maxZoom: 1.5 });
  }
  const tick = setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); clock.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }, 1000);

  const onKey = (e) => {
    const k = e.key.toLowerCase();
    if (e.target.closest?.('input, textarea, [contenteditable="true"]')) return;
    if (k === 'q' || k === 'w') { e.preventDefault(); e.stopPropagation(); if (!e.repeat) { held.add(k); placePtr(); } return; }
    if (['arrowright', 'pagedown', ' ', 'enter'].includes(k)) { e.preventDefault(); go(idx + 1); }
    else if (['arrowleft', 'pageup', 'backspace'].includes(k)) { e.preventDefault(); go(idx - 1); }
    else if (k === 'home') go(0);
    else if (k === 'end') go(slides.length - 1);
    else if (k === 'escape') end();
    else if (k === 'l') setMode('laser');
    else if (k === 's') setMode('spot');
    else if (k === 'p') setMode('pen');
    else if (k === 'm') setMode('pointer');
    else if (k === 'c') clearInk();
    else if (k === 'n') toggleNotes();
    else if (k === 'h') hideBar(true);
    else return;
    e.stopPropagation();
  };
  window.addEventListener('keydown', onKey, true);
  const onKeyUp = (e) => { const k = e.key.toLowerCase(); if (held.delete(k)) { e.stopPropagation(); placePtr(); } };
  const onBlur = () => { held.clear(); placePtr(); };
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('blur', onBlur);
  const onFs = () => { if (!document.fullscreenElement) end(); };
  setTimeout(() => document.addEventListener('fullscreenchange', onFs), 600);

  let ended = false;
  function end() {
    if (ended) return;
    ended = true;
    cancelAnimationFrame(raf); clearInterval(tick); clearTimeout(hideTimer);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('keyup', onKeyUp, true);
    window.removeEventListener('blur', onBlur);
    root.removeEventListener('pointermove', onMove);
    document.removeEventListener('fullscreenchange', onFs);
    wrap.remove();
    root.classList.remove('presenting');
    if (!wasImmersive) app.classList.remove('immersive');
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    for (const el of els.values()) { el.classList.remove('pre-in'); el.style.animationDelay = ''; }
    setTimeout(() => sf.resize(), 80);
    onEnd?.();
  }
  return { end, next: () => go(idx + 1), prev: () => go(idx - 1) };
}
