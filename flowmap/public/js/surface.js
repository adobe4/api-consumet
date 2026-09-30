// The flat ground everything rests on: an infinite canvas with a dotted, gridded or plain floor that pans and
// zooms with its contents. Used by the card tracker and by boards. Items are real DOM elements (sharp text,
// real buttons); connections are SVG in the same world space, so the floor's dots line up inside tunnels.
const NS = 'http://www.w3.org/2000/svg';
export const svgEl = (tag, attrs = {}, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) n.setAttribute(k, v);
  if (parent) parent.append(n);
  return n;
};
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ease = (t) => 1 - Math.pow(1 - t, 3);
export const GRID = 22; // floor pattern pitch in world units

let uid = 0;
export function createSurface(host, { minK = 0.1, maxK = 4, onPointerDown, onContext, onDoubleClick, className = '' } = {}) {
  const id = `sf${++uid}`;
  const root = document.createElement('div');
  root.className = `sf ${className}`;
  root.dataset.ground = 'dots';
  const world = document.createElement('div');
  world.className = 'sf-world';
  const under = svgEl('svg', { class: 'sf-svg sf-under', width: 1, height: 1 });
  const layer = document.createElement('div');
  layer.className = 'sf-layer';
  const over = svgEl('svg', { class: 'sf-svg sf-over', width: 1, height: 1 });
  world.append(under, layer, over);
  const overlay = document.createElement('div');
  overlay.className = 'sf-overlay';
  root.append(world, overlay);
  host.append(root);
  const defs = svgEl('defs', {}, under);

  const cam = { tx: 0, ty: 0, k: 1 };
  let W = 1, H = 1, anim = null, lod = 1;
  const listeners = new Set();
  function apply() {
    world.style.transform = `translate(${cam.tx}px, ${cam.ty}px) scale(${cam.k})`;
    // like paper that never gets noisy: when zoomed far out the floor pattern doubles its pitch
    let m = 1;
    while (GRID * cam.k * m < 13 && m < 64) m *= 2;
    const g = GRID * cam.k * m;
    root.style.setProperty('--gs', `${g}px`);
    if (m !== lod) { lod = m; defs.querySelector('pattern')?.setAttribute('patternTransform', `translate(2.5 3.5) scale(${m})`); }
    root.style.backgroundPosition = `${cam.tx}px ${cam.ty}px`;
    root.style.setProperty('--gk', cam.k);
    for (const fn of listeners) fn(cam);
  }
  const toWorld = (sx, sy) => ({ x: (sx - cam.tx) / cam.k, y: (sy - cam.ty) / cam.k });
  const toScreen = (x, y) => ({ x: x * cam.k + cam.tx, y: y * cam.k + cam.ty });
  const local = (e) => { const r = root.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  function zoomAt(sx, sy, k) {
    const w = toWorld(sx, sy);
    cam.k = clamp(k, minK, maxK);
    cam.tx = sx - w.x * cam.k; cam.ty = sy - w.y * cam.k;
    apply();
  }
  // smooth camera moves (focus, fit, presenting)
  function flyTo(target, ms = 650) {
    cancelAnimationFrame(anim);
    const from = { ...cam }, t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / ms), e = ease(t);
      cam.k = from.k + (target.k - from.k) * e;
      cam.tx = from.tx + (target.tx - from.tx) * e;
      cam.ty = from.ty + (target.ty - from.ty) * e;
      apply();
      if (t < 1) anim = requestAnimationFrame(step);
    };
    if (ms <= 0) { Object.assign(cam, target); apply(); return; }
    anim = requestAnimationFrame(step);
  }
  // show a world rectangle, centred, with padding in screen pixels
  function frameFor(b, { pad = 60, maxZoom = 1.4, insets = {} } = {}) {
    const it = { top: 0, right: 0, bottom: 0, left: 0, ...insets };
    const aw = Math.max(50, W - it.left - it.right - pad * 2), ah = Math.max(50, H - it.top - it.bottom - pad * 2);
    const k = clamp(Math.min(aw / Math.max(1, b.w), ah / Math.max(1, b.h), maxZoom), minK, maxK);
    const cx = it.left + (W - it.left - it.right) / 2, cy = it.top + (H - it.top - it.bottom) / 2;
    return { k, tx: cx - (b.x + b.w / 2) * k, ty: cy - (b.y + b.h / 2) * k };
  }
  const fit = (b, opts = {}) => flyTo(frameFor(b, opts), opts.animate === false ? 0 : opts.ms ?? 600);
  const centerOn = (x, y, k = cam.k, ms = 500) => flyTo({ k, tx: W / 2 - x * k, ty: H / 2 - y * k }, ms);

  function resize() {
    const r = root.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    apply();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(root);
  resize();

  // ---------- floor pattern for tunnels (world space, so it lines up with the CSS floor) ----------
  function buildDefs() {
    defs.innerHTML = '';
    const g = root.dataset.ground;
    const p = svgEl('pattern', { id: `${id}-deep`, width: GRID, height: GRID, patternUnits: 'userSpaceOnUse', patternTransform: `translate(2.5 3.5) scale(${lod})` }, defs);
    if (g === 'grid') { svgEl('rect', { x: 0, y: 0, width: GRID, height: 1, class: 'sf-deep' }, p); svgEl('rect', { x: 0, y: 0, width: 1, height: GRID, class: 'sf-deep' }, p); }
    else if (g === 'dots') svgEl('circle', { cx: GRID / 2, cy: GRID / 2, r: 1.35, class: 'sf-deep' }, p);
    const f = svgEl('filter', { id: `${id}-inset`, x: '-20%', y: '-20%', width: '140%', height: '140%' }, defs);
    svgEl('feOffset', { in: 'SourceAlpha', dx: 0, dy: 3, result: 'off' }, f);
    svgEl('feGaussianBlur', { in: 'off', stdDeviation: 2.4, result: 'blur' }, f);
    svgEl('feComposite', { in: 'SourceAlpha', in2: 'blur', operator: 'out', result: 'inv' }, f);
    svgEl('feFlood', { class: 'sf-inset-flood', result: 'col' }, f);
    svgEl('feComposite', { in: 'col', in2: 'inv', operator: 'in', result: 'shadow' }, f);
    svgEl('feComposite', { in: 'shadow', in2: 'SourceGraphic', operator: 'atop' }, f);
    const gl = svgEl('filter', { id: `${id}-glow`, x: '-50%', y: '-50%', width: '200%', height: '200%' }, defs);
    svgEl('feGaussianBlur', { stdDeviation: 2.2, result: 'b' }, gl);
    svgEl('feComposite', { in: 'SourceGraphic', in2: 'b', operator: 'over' }, gl);
    const sh = svgEl('filter', { id: `${id}-drop`, x: '-30%', y: '-30%', width: '160%', height: '160%' }, defs);
    svgEl('feDropShadow', { dx: 3, dy: 6, stdDeviation: 4, 'flood-color': '#000', 'flood-opacity': 0.28 }, sh);
  }
  function setGround(kind) {
    root.dataset.ground = ['dots', 'grid', 'plain'].includes(kind) ? kind : 'dots';
    buildDefs();
  }
  buildDefs();

  // ---------- input: pan, pinch, wheel ----------
  const pointers = new Map();
  let pan = null, pinch = null, spaceDown = false;
  const onKey = (e) => { if (e.code === 'Space' && !e.target.closest?.('input, textarea, [contenteditable="true"]')) { spaceDown = e.type === 'keydown'; root.classList.toggle('grab', spaceDown); } };
  window.addEventListener('keydown', onKey); window.addEventListener('keyup', onKey);
  root.addEventListener('pointerdown', (e) => {
    const pt = local(e);
    pointers.set(e.pointerId, pt);
    cancelAnimationFrame(anim);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pan = null;
      pinch = { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
      root.dispatchEvent(new CustomEvent('sf-cancel'));
      return;
    }
    if (pointers.size > 2) return;
    const wantPan = e.button === 1 || spaceDown || !onPointerDown || onPointerDown(e, toWorld(pt.x, pt.y), pt) === 'pan';
    if (wantPan && (e.button === 0 || e.button === 1)) {
      root.setPointerCapture(e.pointerId);
      pan = { sx: pt.x, sy: pt.y, tx: cam.tx, ty: cam.ty, moved: false };
      root.classList.add('panning');
    }
  });
  root.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const pt = local(e);
    pointers.set(e.pointerId, pt);
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const w = toWorld(pinch.cx, pinch.cy);
      cam.k = clamp(cam.k * (d / pinch.d), minK, maxK);
      // the point under the fingers stays under them: two fingers moving together pan
      cam.tx = cx - w.x * cam.k; cam.ty = cy - w.y * cam.k;
      pinch = { cx, cy, d };
      apply();
      return;
    }
    if (pan) {
      if (!pan.moved && Math.hypot(pt.x - pan.sx, pt.y - pan.sy) > 3) pan.moved = true;
      cam.tx = pan.tx + pt.x - pan.sx; cam.ty = pan.ty + pt.y - pan.sy;
      apply();
    }
  });
  const end = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!pointers.size) {
      if (pan && !pan.moved) root.dispatchEvent(new CustomEvent('sf-tap', { detail: { e, world: toWorld(pan.sx, pan.sy) } }));
      pan = null; root.classList.remove('panning');
    }
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
  root.addEventListener('wheel', (e) => {
    if (e.target.closest?.('.sf-scroll')) return; // let long notes scroll
    e.preventDefault();
    cancelAnimationFrame(anim);
    const pt = local(e);
    const mouseWheel = e.deltaMode !== 0 || (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50);
    if (e.ctrlKey || e.metaKey || mouseWheel) {
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      zoomAt(pt.x, pt.y, cam.k * Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)));
    } else { cam.tx -= e.deltaX; cam.ty -= e.deltaY; apply(); }
  }, { passive: false });
  root.addEventListener('contextmenu', (e) => { e.preventDefault(); const pt = local(e); onContext?.(e, toWorld(pt.x, pt.y)); });
  root.addEventListener('dblclick', (e) => { const pt = local(e); onDoubleClick?.(e, toWorld(pt.x, pt.y)); });
  // long press on touch = context menu
  let lp = null;
  root.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    clearTimeout(lp?.t);
    const start = { x: e.clientX, y: e.clientY };
    lp = { start, t: setTimeout(() => { if (pointers.size === 1 && !(pan?.moved)) { const pt = local(e); pan = null; root.classList.remove('panning'); onContext?.(e, toWorld(pt.x, pt.y)); } }, 550) };
  });
  root.addEventListener('pointermove', (e) => { if (lp && Math.hypot(e.clientX - lp.start.x, e.clientY - lp.start.y) > 8) clearTimeout(lp.t); });
  root.addEventListener('pointerup', () => clearTimeout(lp?.t));

  function destroy() {
    cancelAnimationFrame(anim); ro.disconnect();
    window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey);
    root.remove();
  }
  return {
    root, world, layer, under, over, overlay, defs, id, cam,
    get size() { return { W, H }; },
    toWorld, toScreen, local, zoomAt, flyTo, fit, frameFor, centerOn, setGround, resize, destroy,
    zoomBy: (f) => { const k = clamp(cam.k * f, minK, maxK); flyTo({ k, tx: W / 2 - ((W / 2 - cam.tx) / cam.k) * k, ty: H / 2 - ((H / 2 - cam.ty) / cam.k) * k }, 260); },
    onCamera: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    isPanning: () => !!pan?.moved || !!pinch,
  };
}

// ---------- connections: pipes, tubes, painted lines and plain arrows ----------
// style: { kind: 'line'|'tunnel'|'raised'|'drawn', path: 'curved'|'straight'|'elbow', dash: 'solid'|'dashed'|'dotted',
//          start/end: 'none'|'arrow'|'triangle'|'dot'|'diamond'|'bar', color, width, flow, speed }
export const LINK_DEFAULT = { kind: 'line', path: 'curved', dash: 'solid', start: 'none', end: 'arrow', color: '', width: 3, flow: false };

// where a line from a box's centre towards a point leaves the box
function edgePoint(b, tx, ty) {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2, dx = tx - cx, dy = ty - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const sx = dx ? (b.w / 2) / Math.abs(dx) : Infinity, sy = dy ? (b.h / 2) / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}
const side = (b, s) => ({ l: { x: b.x, y: b.y + b.h / 2, nx: -1, ny: 0 }, r: { x: b.x + b.w, y: b.y + b.h / 2, nx: 1, ny: 0 }, t: { x: b.x + b.w / 2, y: b.y, nx: 0, ny: -1 }, b: { x: b.x + b.w / 2, y: b.y + b.h, nx: 0, ny: 1 } }[s]);

// a: box {x,y,w,h} or point {x,y}; b likewise. Returns { d, a:{x,y,ang}, b:{x,y,ang}, mid:{x,y} }
export function route(A, B, path = 'curved', { gap = 0, center = false } = {}) {
  const isBox = (o) => o && o.w !== undefined;
  const ca = isBox(A) ? { x: A.x + A.w / 2, y: A.y + A.h / 2 } : A, cb = isBox(B) ? { x: B.x + B.w / 2, y: B.y + B.h / 2 } : B;
  const dx = cb.x - ca.x, dy = cb.y - ca.y, horiz = Math.abs(dx) >= Math.abs(dy);
  if (path === 'straight' || center) {
    const p = center || !isBox(A) ? ca : edgePoint(A, cb.x, cb.y), q = center || !isBox(B) ? cb : edgePoint(B, ca.x, ca.y);
    const ang = Math.atan2(q.y - p.y, q.x - p.x);
    const p2 = { x: p.x + Math.cos(ang) * gap, y: p.y + Math.sin(ang) * gap }, q2 = { x: q.x - Math.cos(ang) * gap, y: q.y - Math.sin(ang) * gap };
    if (center && path === 'curved') {
      const k = 0.5;
      const d = horiz ? `M${p.x},${p.y} C${p.x + dx * k},${p.y} ${q.x - dx * k},${q.y} ${q.x},${q.y}` : `M${p.x},${p.y} C${p.x},${p.y + dy * k} ${q.x},${q.y - dy * k} ${q.x},${q.y}`;
      return { d, a: { ...p, ang: horiz ? (dx > 0 ? Math.PI : 0) : (dy > 0 ? -Math.PI / 2 : Math.PI / 2) }, b: { ...q, ang: horiz ? (dx > 0 ? 0 : Math.PI) : (dy > 0 ? Math.PI / 2 : -Math.PI / 2) }, mid: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 } };
    }
    return { d: `M${p2.x},${p2.y} L${q2.x},${q2.y}`, a: { ...p2, ang: ang + Math.PI }, b: { ...q2, ang }, mid: { x: (p2.x + q2.x) / 2, y: (p2.y + q2.y) / 2 } };
  }
  const sa = isBox(A) ? side(A, horiz ? (dx > 0 ? 'r' : 'l') : (dy > 0 ? 'b' : 't')) : { ...A, nx: horiz ? Math.sign(dx) || 1 : 0, ny: horiz ? 0 : Math.sign(dy) || 1 };
  const sb = isBox(B) ? side(B, horiz ? (dx > 0 ? 'l' : 'r') : (dy > 0 ? 't' : 'b')) : { ...B, nx: horiz ? -(Math.sign(dx) || 1) : 0, ny: horiz ? 0 : -(Math.sign(dy) || 1) };
  const p = { x: sa.x + sa.nx * gap, y: sa.y + sa.ny * gap }, q = { x: sb.x + sb.nx * gap, y: sb.y + sb.ny * gap };
  if (path === 'elbow') {
    const r = 14;
    let pts;
    if (horiz) { const mx = (p.x + q.x) / 2; pts = [p, { x: mx, y: p.y }, { x: mx, y: q.y }, q]; }
    else { const my = (p.y + q.y) / 2; pts = [p, { x: p.x, y: my }, { x: q.x, y: my }, q]; }
    let d = `M${pts[0].x},${pts[0].y}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1], c = pts[i], n = pts[i + 1];
      const r1 = Math.min(r, Math.hypot(c.x - a.x, c.y - a.y) / 2, Math.hypot(n.x - c.x, n.y - c.y) / 2);
      const u1 = { x: c.x - Math.sign(c.x - a.x) * r1, y: c.y - Math.sign(c.y - a.y) * r1 }, u2 = { x: c.x + Math.sign(n.x - c.x) * r1, y: c.y + Math.sign(n.y - c.y) * r1 };
      d += ` L${u1.x},${u1.y} Q${c.x},${c.y} ${u2.x},${u2.y}`;
    }
    d += ` L${q.x},${q.y}`;
    return { d, a: { ...p, ang: Math.atan2(-sa.ny, -sa.nx) }, b: { ...q, ang: Math.atan2(-sb.ny, -sb.nx) }, mid: { x: (pts[1].x + pts[2].x) / 2, y: (pts[1].y + pts[2].y) / 2 } };
  }
  const dist = Math.hypot(q.x - p.x, q.y - p.y), off = Math.max(40, dist * 0.42);
  const c1 = { x: p.x + sa.nx * off, y: p.y + sa.ny * off }, c2 = { x: q.x + sb.nx * off, y: q.y + sb.ny * off };
  const mid = { x: 0.125 * p.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * q.x, y: 0.125 * p.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * q.y };
  return { d: `M${p.x},${p.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${q.x},${q.y}`, a: { ...p, ang: Math.atan2(-sa.ny, -sa.nx) }, b: { ...q, ang: Math.atan2(-sb.ny, -sb.nx) }, mid };
}

function marker(g, kind, at, size, color, cls = '') {
  if (!kind || kind === 'none') return;
  const { x, y, ang } = at;
  const t = `translate(${x} ${y}) rotate(${(ang * 180) / Math.PI})`;
  const s = size;
  const base = { transform: t, class: `sf-mark ${cls}` };
  if (kind === 'arrow') svgEl('path', { ...base, d: `M${-s},${-s * 0.7} L0,0 L${-s},${s * 0.7}`, fill: 'none', stroke: color, 'stroke-width': Math.max(2, s / 3.2), 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
  else if (kind === 'triangle') svgEl('path', { ...base, d: `M${-s * 1.1},${-s * 0.65} L${s * 0.15},0 L${-s * 1.1},${s * 0.65} Z`, fill: color }, g);
  else if (kind === 'dot') svgEl('circle', { ...base, cx: 0, cy: 0, r: s * 0.5, fill: color }, g);
  else if (kind === 'diamond') svgEl('path', { ...base, d: `M0,0 L${-s * 0.75},${-s * 0.5} L${-s * 1.5},0 L${-s * 0.75},${s * 0.5} Z`, fill: color }, g);
  else if (kind === 'bar') svgEl('path', { ...base, d: `M0,${-s * 0.7} L0,${s * 0.7}`, stroke: color, 'stroke-width': Math.max(2, s / 3), 'stroke-linecap': 'round' }, g);
}

// Draw one connection into group g (cleared first). r = route(); style as above; sid = surface id (for defs).
export function drawLink(g, r, style, sid, { hot = false, dim = false, speed = 2.4, hitId } = {}) {
  g.textContent = '';
  const st = { ...LINK_DEFAULT, ...style };
  const col = st.color || 'var(--link, #ff8a3d)';
  const w = Math.max(1, st.width);
  g.setAttribute('class', `sf-link k-${st.kind}${hot ? ' hot' : ''}${dim ? ' dim' : ''}`);
  const P = (attrs, parent = g) => svgEl('path', { d: r.d, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', ...attrs }, parent);
  const dash = st.dash === 'dashed' ? `${w * 3.2} ${w * 2.4}` : st.dash === 'dotted' ? `0.1 ${Math.max(6, w * 2.2)}` : null;
  const flowDur = `${Math.max(0.6, speed)}s`;
  if (st.kind === 'tunnel') {
    const tw = Math.max(8, w);
    P({ stroke: 'var(--sh-l)', 'stroke-width': tw + 3, transform: 'translate(0 1.6)' });
    P({ stroke: 'var(--sh-d)', 'stroke-width': tw + 3, transform: 'translate(0 -1)', opacity: 0.55 });
    const floor = svgEl('g', { filter: `url(#${sid}-inset)` }, g);
    P({ stroke: 'var(--floor)', 'stroke-width': tw }, floor);
    P({ stroke: `url(#${sid}-deep)`, 'stroke-width': tw }, floor);
    if (st.flow) P({ stroke: col, 'stroke-width': Math.max(3, tw * 0.34), 'stroke-dasharray': '2 18', class: 'sf-flow', style: `animation-duration:${flowDur}`, filter: `url(#${sid}-glow)` });
    else P({ stroke: col, 'stroke-width': Math.max(2, tw * 0.18), opacity: 0.55 });
    marker(g, st.start, r.a, Math.max(9, tw * 0.9), col); marker(g, st.end, r.b, Math.max(9, tw * 0.9), col);
  } else if (st.kind === 'raised') {
    const tw = Math.max(8, w);
    P({ stroke: '#000', 'stroke-width': tw, opacity: 0.22, transform: 'translate(3 6)', filter: `url(#${sid}-drop)` });
    P({ stroke: 'var(--raise)', 'stroke-width': tw });
    P({ stroke: col, 'stroke-width': tw * 0.42, opacity: 0.92, 'stroke-dasharray': dash });
    P({ stroke: 'rgba(255,255,255,0.5)', 'stroke-width': Math.max(1.5, tw * 0.14), transform: `translate(0 ${-tw * 0.2})` });
    if (st.flow) P({ stroke: '#fff', 'stroke-width': Math.max(2.5, tw * 0.26), 'stroke-dasharray': '2 18', class: 'sf-flow', style: `animation-duration:${flowDur}`, opacity: 0.9 });
    marker(g, st.start, r.a, Math.max(10, tw), col); marker(g, st.end, r.b, Math.max(10, tw), col);
  } else if (st.kind === 'drawn') {
    const tw = Math.max(3, w * 0.6);
    P({ stroke: col, 'stroke-width': tw, opacity: 0.35 });
    P({ stroke: col, 'stroke-width': tw, 'stroke-dasharray': st.flow ? '10 10' : dash, class: st.flow ? 'sf-flow' : '', style: st.flow ? `animation-duration:${flowDur}` : '', opacity: 0.95 });
    marker(g, st.start, r.a, Math.max(9, tw * 2.6), col); marker(g, st.end, r.b, Math.max(9, tw * 2.6), col);
  } else {
    P({ stroke: col, 'stroke-width': w, 'stroke-dasharray': dash, class: 'sf-line' });
    if (st.flow) P({ stroke: 'var(--flow-bead, #fff)', 'stroke-width': Math.max(1.5, w * 0.7), 'stroke-dasharray': `1 ${Math.max(12, w * 5)}`, class: 'sf-flow', style: `animation-duration:${flowDur}`, opacity: 0.9 });
    marker(g, st.start, r.a, Math.max(9, w * 3), col); marker(g, st.end, r.b, Math.max(9, w * 3), col);
  }
  // wide invisible stroke so thin lines are easy to hover and tap
  P({ stroke: 'transparent', 'stroke-width': Math.max(18, w + 14), class: 'sf-hit', 'data-link': hitId ?? '' });
}

export function drawLabel(g, r, text) {
  if (!text) return;
  const t = svgEl('text', { x: r.mid.x, y: r.mid.y, class: 'sf-label', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, g);
  t.textContent = text;
}
