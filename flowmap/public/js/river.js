// River: the business as one flow, read from left to right. Nothing is placed by hand.
// Projects line up in stages: where attention starts (e.g. TikTok) on the left, the projects it feeds in
// the middle, and on the far right a single "You earn" bar that collects every project's money. Each
// connection is a band whose width is how much really flows per day, so the widest bands are what
// carries the business. Bars take the colour of their health. Loops (a project feeding one earlier in the
// chain) curve underneath. Moving the timeline reshapes the whole river: that is the forecast.
// On a tall phone screen the river runs top to bottom instead.
import { S, project, projects, on, liveSnap, snap } from './store.js';
import { RESOURCES, KINDS, TASK_TYPES } from '/shared/engine.js';
import { clamp, lerp, fmtNum } from './util.js';
import { goalProgress, GOAL_METRICS } from '/shared/goals.js';

const statusOf = (h) => (h >= 75 ? 'thriving' : h >= 50 ? 'steady' : h >= 30 ? 'thirsty' : 'dying');
const STATUS_WORD = { thriving: 'Thriving', steady: 'Steady', thirsty: 'Needs attention', dying: 'Needs you now' };
const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));
const ease = (t) => t * t * (3 - 2 * t);
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, "Segoe UI", Roboto, system-ui, sans-serif';
const SINK = 'sink';

const rgbCache = new Map();
function rgb(hex) {
  let v = rgbCache.get(hex);
  if (!v) {
    let s = String(hex || '#888888').replace('#', '');
    if (s.length === 3) s = s.split('').map((c) => c + c).join('');
    const n = parseInt(s.slice(0, 6), 16);
    v = Number.isNaN(n) ? [136, 136, 136] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    rgbCache.set(hex, v);
  }
  return v;
}
const mix = (a, b, t) => { const A = rgb(a), B = rgb(b); t = clamp(t, 0, 1); return `#${A.map((x, i) => Math.round(x + (B[i] - x) * t).toString(16).padStart(2, '0')).join('')}`; };
const alpha = (hex, a) => { const [r, g, b] = rgb(hex); return `rgba(${r},${g},${b},${clamp(a, 0, 1)})`; };

const PAL = {
  light: { bg: '#f6f3ee', text: '#1d1b19', muted: '#8a837b', rule: 'rgba(60,40,25,0.07)', thriving: '#2fb457', steady: '#e2a800', thirsty: '#f08a00', dying: '#f0392b',
    band: 0.3, bandHot: 0.6, bandDim: 0.1, tone: 0.85, sink: '#d99a00' },
  dark: { bg: '#0f0f0e', text: '#f5f2ed', muted: '#9a948c', rule: 'rgba(255,240,220,0.07)', thriving: '#30d158', steady: '#ffd60a', thirsty: '#ff9f0a', dying: '#ff453a',
    band: 0.42, bandHot: 0.75, bandDim: 0.1, tone: 1, sink: '#f2c14e' },
};

export function createRenderer(canvas, hooks) {
  const stage = canvas.parentElement;
  const ctx = canvas.getContext('2d');
  const cam = { x: 0, y: 0, k: 1 };
  const goal = { x: 0, y: 0, k: 1, active: false };
  let W = 1, H = 1, dpr = 1, time = 0, last = performance.now(), raf = 0;
  let pal = PAL.light, theme = 'light';
  let live = null, hover = null, linkFrom = null;
  let vertical = false;
  let pointerAt = null;
  let todayUnit = null;
  const nodes = new Map(); // project id or SINK -> visual state
  const bands = new Map(); // key -> visual state
  const sparks = [];
  const fx = [];
  let topo = null, topoKey = '';
  let geo = null; // this frame's layout

  const overlay = document.createElement('div');
  overlay.className = 'river-labels';
  stage.appendChild(overlay);
  const tip = document.createElement('div');
  tip.className = 'rv-tip';
  tip.hidden = true;
  overlay.appendChild(tip);
  const card = makeCard();
  const captions = [];

  function applyTheme(t) { theme = t === 'dark' ? 'dark' : 'light'; pal = PAL[theme]; for (const v of nodes.values()) v.text = ''; }
  const onTheme = (e) => applyTheme(e.detail);
  window.addEventListener('flowmap-theme', onTheme);
  applyTheme(document.documentElement.getAttribute('data-theme'));
  const tone = (hex) => (pal.tone === 1 ? hex : mix(hex, '#000000', 1 - pal.tone));

  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    vertical = H > W * 1.15;
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  // layout coordinates: u runs along the flow, v across it. World = (u, v) left-to-right, or (v, u) top-to-bottom.
  const toWorld2 = (u, v) => (vertical ? { x: v, y: u } : { x: u, y: v });
  const toScreen = (x, y) => ({ x: (x - cam.x) * cam.k + W / 2, y: (y - cam.y) * cam.k + H / 2 });
  const S2 = (u, v) => { const w = toWorld2(u, v); return toScreen(w.x, w.y); };
  const fromScreen = (sx, sy) => { const x = (sx - W / 2) / cam.k + cam.x, y = (sy - H / 2) / cam.k + cam.y; return vertical ? { u: y, v: x } : { u: x, v: y }; };
  const localPt = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  // ---------- labels ----------
  function nodeOf(id) {
    let v = nodes.get(id);
    if (!v) {
      v = { id, health: 0, val: 0, flash: 0, label: makeLabel(id), text: '', tf: '', goal: null, goalKey: '' };
      nodes.set(id, v);
    }
    return v;
  }
  function makeLabel(id) {
    const el = document.createElement('div');
    el.className = `rv-label${id === SINK ? ' sink' : ''}`;
    el.innerHTML = '<div class="nm"></div><div class="sub"></div><div class="late"></div><button class="need" type="button" data-act="water">Needs you now</button>';
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('click', (e) => {
      if (id === SINK) return;
      const a = e.target.closest('[data-act]')?.dataset.act;
      if (a) { e.stopPropagation(); hooks.onTankAction?.(a, id); } else hooks.onSelect?.({ type: 'project', id });
    });
    overlay.appendChild(el);
    return el;
  }
  function makeCard() {
    const el = document.createElement('div');
    el.className = 'rv-card';
    el.hidden = true;
    el.innerHTML = '<div class="ph"><span class="ic"></span><div><div class="pn"></div><div class="ps"></div></div></div><div class="pnums"></div><div class="pgoal"></div><div class="acts"></div>';
    const act = (name, text, title) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.title = title; b.dataset.act = name; return b; };
    el.querySelector('.acts').append(act('water', 'Log work', 'I did something for this project'), act('task', 'Plan', 'Plan a task'), act('connect', 'Connect', 'Add a flow from this project'), act('edit', 'Edit', 'Edit project'));
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('click', (e) => { const a = e.target.closest('[data-act]')?.dataset.act; if (a && el.dataset.id) { e.stopPropagation(); hooks.onTankAction?.(a, Number(el.dataset.id)); } });
    overlay.appendChild(el);
    return el;
  }

  // ---------- stages: audience -> products -> you earn ----------
  const AUDIENCE = new Set(['youtube', 'tiktok']);
  function roleOf(p) {
    if (AUDIENCE.has(p.kind)) return 0;
    if (p.kind !== 'custom') return 1;
    const outA = S.world.links.some((l) => l.from === p.id && l.resource === 'attention');
    const inA = S.world.links.some((l) => l.to === p.id && l.resource === 'attention');
    return outA && !inA ? 0 : 1;
  }

  // Every link, plus each project's money into "You earn". Links that run forward (an audience into a
  // product) are bands of the river; the rest (a product speeding up a channel, cash put back in,
  // channels promoting each other) are thin arcs above it, so they never tangle the river.
  function collectBands(list) {
    const out = [];
    // widths are linear against today's biggest flow of the same kind, so the future view narrows or swells honestly
    const today = snap(0);
    const refs = {};
    for (const l of S.world.links) refs[l.resource] = Math.max(refs[l.resource] || 0, today?.links[l.id]?.amount || 0);
    const widthOf = (l, o) => {
      if (!o) return 0.02;
      if (l.resource === 'progress') return o.norm > 0.004 ? 0.04 + o.norm * 0.6 : 0.02;
      return o.amount > 0 ? 0.04 + 0.9 * Math.min(2.5, o.amount / Math.max(1e-9, refs[l.resource] || o.amount)) : 0.02;
    };
    for (const l of S.world.links) {
      const a = project(l.from), b = project(l.to);
      if (!a || !b || l.from === l.to) continue;
      const o = live?.links[l.id];
      out.push({ key: `l${l.id}`, link: l, from: l.from, to: l.to, res: l.resource, arc: roleOf(b) <= roleOf(a),
        want: widthOf(l, o), amount: o?.amount || 0, speed: o?.speed || 0.3 });
    }
    // money into "You earn" is scaled against today's best earner in the same way
    let ref = 0;
    for (const p of list) ref = Math.max(ref, today?.projects[p.id]?.money || 0, 1);
    if (list.some((p) => (live?.projects[p.id]?.money || 0) > 0.5)) {
      for (const p of list) {
        const m = live?.projects[p.id]?.money || 0;
        if (m > 0.5) out.push({ key: `s${p.id}`, from: p.id, to: SINK, res: 'money', arc: false, want: 0.03 + 0.95 * Math.min(2.5, m / ref), amount: m, speed: 0.5 });
      }
    }
    return out;
  }

  const isWay = (id) => typeof id === 'string' && id.startsWith('w:');
  function buildTopo(list, bl) {
    const roles = new Map(list.map((p) => [p.id, roleOf(p)]));
    const used = [...new Set(roles.values())].sort();
    const colOf = new Map(list.map((p) => [p.id, used.indexOf(roles.get(p.id))]));
    const hasSink = bl.some((b) => b.to === SINK);
    const nCols = used.length + (hasSink ? 1 : 0);
    const cols = Array.from({ length: nCols }, () => []);
    for (const p of list) cols[colOf.get(p.id)].push(p.id);
    if (hasSink) { colOf.set(SINK, nCols - 1); cols[nCols - 1].push(SINK); }
    // a band that skips a stage passes it on an invisible waypoint, so it runs between the bars, not behind them
    const chains = new Map();
    for (const b of bl) {
      if (b.arc) continue;
      const c0 = colOf.get(b.from), c1 = colOf.get(b.to);
      const chain = [b.from];
      for (let c = c0 + 1; c < c1; c++) { const w = `w:${b.key}:${c}`; cols[c].push(w); colOf.set(w, c); chain.push(w); }
      chain.push(b.to);
      chains.set(b.key, chain);
    }
    // start from the order on the other map, then a few barycentre sweeps so bands cross as little as possible
    const y0 = (id) => (typeof id === 'number' ? project(id).y : 0);
    for (const c of cols) c.sort((a, b) => y0(a) - y0(b));
    const segs = [];
    for (const ch of chains.values()) for (let i = 0; i + 1 < ch.length; i++) segs.push([ch[i], ch[i + 1]]);
    const pos = new Map();
    const index = () => cols.forEach((c) => c.forEach((id, i) => pos.set(id, (i + 0.5) / c.length)));
    index();
    for (let sweep = 0; sweep < 8; sweep++) {
      const fwd = sweep % 2 === 0;
      for (const c of fwd ? cols : [...cols].reverse()) {
        const bc = new Map(c.map((id) => {
          const n = segs.filter((s) => (fwd ? s[1] === id : s[0] === id)).map((s) => pos.get(fwd ? s[0] : s[1]));
          return [id, n.length ? n.reduce((a, x) => a + x, 0) / n.length : pos.get(id)];
        }));
        c.sort((a, b) => bc.get(a) - bc.get(b));
        index();
      }
    }
    return { cols, colOf, chains, hasSink, roles: used };
  }

  // ---------- geometry for this frame ----------
  const NW = 14;
  const push = (m, k, v) => (m.get(k) || m.set(k, []).get(k)).push(v);
  function layoutFrame(list, bl) {
    const key = `${vertical}|${list.map((p) => `${p.id}:${p.kind}`).join(',')}|${bl.map((b) => `${b.key}${b.arc ? 'a' : ''}`).join(',')}`;
    if (key !== topoKey) { topoKey = key; topo = buildTopo(list, bl); }
    const { cols, chains } = topo;
    const pad = vertical ? { u0: 176, u1: 70, v0: 14, v1: 70 } : { u0: 190, u1: 200, v0: 150, v1: W < 1100 ? 150 : 60 };
    const L = vertical ? H : W, Bw = vertical ? W : H;
    const U0 = pad.u0, Ulen = Math.max(100, L - pad.u0 - pad.u1), V0 = pad.v0, B = Math.max(100, Bw - pad.v0 - pad.v1);
    const GAP = vertical ? 16 : 28, WGAP = 6, MIN = vertical ? 10 : 16;
    const wOf = (k) => bands.get(k)?.w || 0;
    const sumIn = new Map(), sumOut = new Map();
    for (const b of bl) if (!b.arc) { sumOut.set(b.from, (sumOut.get(b.from) || 0) + wOf(b.key)); sumIn.set(b.to, (sumIn.get(b.to) || 0) + wOf(b.key)); }
    const value = (id) => (isWay(id) ? wOf(id.split(':')[1]) : Math.max(sumIn.get(id) || 0, sumOut.get(id) || 0));
    const gapOf = (id) => (isWay(id) ? WGAP : GAP);
    // every project gets at least enough room for its label, however thin its bar
    let SLOT = vertical ? 44 : 56;
    for (const c of cols) { const n = c.filter((id) => !isWay(id)).length; if (n) SLOT = Math.min(SLOT, (B - c.reduce((s, id, i) => s + (i ? gapOf(id) : 0), 0)) / n - 1); }
    SLOT = Math.max(MIN, SLOT);
    const barH = (id, u) => (isWay(id) ? value(id) * u : Math.max(MIN, value(id) * u));
    const slotH = (id, u) => (isWay(id) ? barH(id, u) : Math.max(SLOT, barH(id, u)));
    const colTotal = (c, u) => c.reduce((s, id, i) => s + slotH(id, u) + (i ? gapOf(id) : 0), 0);
    let unit = 420;
    for (const c of cols) { const tot = c.reduce((s, id) => s + value(id), 0); if (tot > 0) unit = Math.min(unit, (B - c.reduce((s, id, i) => s + (i ? gapOf(id) : 0), 0)) / tot); }
    let lo = 1, hi = Math.max(1, unit);
    if (cols.some((c) => colTotal(c, hi) > B)) { for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (cols.some((c) => colTotal(c, m) > B)) hi = m; else lo = m; } unit = lo; }
    unit = Math.max(1, unit);
    // looking ahead keeps today's scale: a drying river should look thinner, not get stretched to fill the screen
    if (!S.offset) todayUnit = unit / B;
    else if (todayUnit) unit = Math.min(unit, todayUnit * B);
    const pos = new Map();
    cols.forEach((c, ci) => {
      const u = U0 + (cols.length > 1 ? (ci * (Ulen - NW)) / (cols.length - 1) : (Ulen - NW) / 2);
      const total = colTotal(c, unit);
      let v = V0 + Math.max(0, (B - total) / 2);
      c.forEach((id, i) => {
        if (i) v += gapOf(id);
        const h = barH(id, unit), slot = slotH(id, unit), top = v + (slot - h) / 2;
        pos.set(id, { u, v0: top, v1: top + h, col: ci, way: isWay(id) });
        v += slot;
      });
    });
    const mid = (id) => { const p = pos.get(id); return p ? (p.v0 + p.v1) / 2 : 0; };
    // attach each segment, stacked at both ends in the order of the far end so bands never twist
    const outsOf = new Map(), insOf = new Map(), segGeo = new Map();
    for (const [bk, ch] of chains) for (let i = 0; i + 1 < ch.length; i++) {
      const s = { bk, i, from: ch[i], to: ch[i + 1], g: {} };
      segGeo.set(`${bk}#${i}`, s.g);
      push(outsOf, s.from, s); push(insOf, s.to, s);
    }
    for (const [id, arr] of outsOf) {
      const p = pos.get(id);
      if (!p) continue;
      arr.sort((a, b) => mid(a.to) - mid(b.to));
      const tot = arr.reduce((s, x) => s + wOf(x.bk) * unit, 0);
      let v = p.v0 + Math.max(0, (p.v1 - p.v0 - tot) / 2);
      for (const s of arr) { const w = wOf(s.bk) * unit; Object.assign(s.g, { u0: p.way ? p.u + NW / 2 : p.u + NW, a0: v, a1: v + w }); v += w; }
    }
    for (const [id, arr] of insOf) {
      const p = pos.get(id);
      if (!p) continue;
      arr.sort((a, b) => mid(a.from) - mid(b.from));
      const tot = arr.reduce((s, x) => s + wOf(x.bk) * unit, 0);
      let v = p.v0 + Math.max(0, (p.v1 - p.v0 - tot) / 2);
      for (const s of arr) { const w = wOf(s.bk) * unit; Object.assign(s.g, { u1: p.way ? p.u + NW / 2 : p.u, b0: v, b1: v + w }); v += w; }
    }
    const bandSegs = new Map();
    for (const [bk, ch] of chains) bandSegs.set(bk, ch.slice(1).map((_, i) => segGeo.get(`${bk}#${i}`)).filter((g) => g.u1 !== undefined && g.u0 !== undefined));
    // support arcs: over the top between stages, out to the side within a stage
    const arcs = new Map();
    for (const b of bl) {
      if (!b.arc) continue;
      const A = pos.get(b.from), Bp = pos.get(b.to);
      if (!A || !Bp) continue;
      if (A.col === Bp.col) {
        const p0 = { u: A.u, v: mid(b.from) }, p2 = { u: Bp.u, v: mid(b.to) };
        arcs.set(b.key, { p0, p2, c: { u: A.u - 36 - Math.abs(p2.v - p0.v) * 0.3, v: (p0.v + p2.v) / 2 } });
      } else {
        const p0 = { u: A.u + NW / 2, v: A.v0 }, p2 = { u: Bp.u + NW / 2, v: Bp.v0 };
        arcs.set(b.key, { p0, p2, c: { u: (p0.u + p2.u) / 2, v: Math.min(p0.v, p2.v) - 30 - Math.abs(p2.u - p0.u) * 0.22 } });
      }
    }
    return { pos, bandSegs, arcs, cols, unit, U0, Ulen, V0, B };
  }

  // a point along a band (all its segments) or an arc, t in 0..1
  function segPoint(g, t) { const e = ease(t); return { u: g.u0 + (g.u1 - g.u0) * t, v: (g.a0 + g.a1) / 2 + ((g.b0 + g.b1) / 2 - (g.a0 + g.a1) / 2) * e }; }
  function arcPoint(a, t) { const m = 1 - t; return { u: m * m * a.p0.u + 2 * m * t * a.c.u + t * t * a.p2.u, v: m * m * a.p0.v + 2 * m * t * a.c.v + t * t * a.p2.v }; }
  function bandPoint(key, t) {
    const a = geo.arcs.get(key);
    if (a) return { ...arcPoint(a, t), w: 0 };
    const segs = geo.bandSegs.get(key);
    if (!segs?.length) return null;
    const n = segs.length, i = Math.min(n - 1, Math.floor(t * n)), lt = t * n - i, g = segs[i];
    return { ...segPoint(g, lt), w: lerp(g.a1 - g.a0, g.b1 - g.b0, ease(lt)) };
  }
  function bandPath(g) {
    ctx.beginPath();
    const N = 28;
    for (let i = 0; i <= N; i++) { const t = i / N, e = ease(t), s = S2(g.u0 + (g.u1 - g.u0) * t, g.a0 + (g.b0 - g.a0) * e); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); }
    for (let i = N; i >= 0; i--) { const t = i / N, e = ease(t), s = S2(g.u0 + (g.u1 - g.u0) * t, g.a1 + (g.b1 - g.a1) * e); ctx.lineTo(s.x, s.y); }
    ctx.closePath();
  }

  // ---------- focus / dimming ----------
  function focusSet() {
    const sel = S.selection;
    const fid = sel?.type === 'project' ? sel.id : hover?.type === 'node' ? hover.id : null;
    const lid = sel?.type === 'link' ? sel.id : hover?.type === 'link' ? hover.id : null;
    const bkey = hover?.type === 'band' ? hover.key : null;
    if (!fid && !lid && !bkey) return null;
    return { fid, lid, bkey };
  }
  const bandActive = (b, f) => !f || (f.fid != null && (b.from === f.fid || b.to === f.fid)) || (f.lid != null && b.link?.id === f.lid) || (f.bkey && b.key === f.bkey);
  function nodeActive(id, f, bl) {
    if (!f) return true;
    if (f.fid === id) return true;
    return bl.some((b) => bandActive(b, f) && (b.from === id || b.to === id));
  }

  // ---------- frame ----------
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!S.sim || W < 2) return;
    time += dt;
    live = liveSnap();
    if (goal.active) {
      cam.x = damp(cam.x, goal.x, 6, dt); cam.y = damp(cam.y, goal.y, 6, dt); cam.k = damp(cam.k, goal.k, 6, dt);
      if (Math.abs(cam.x - goal.x) + Math.abs(cam.y - goal.y) < 0.4 && Math.abs(cam.k - goal.k) < 0.002) goal.active = false;
    }
    const list = projects();
    const bl = collectBands(list);
    const byKey = new Map(bl.map((b) => [b.key, b]));
    for (const b of bl) {
      let v = bands.get(b.key);
      if (!v) { v = { w: 0, flash: 0, acc: 0 }; bands.set(b.key, v); }
      v.w = damp(v.w, b.want, 1.8, dt); v.flash = Math.max(0, v.flash - dt * 0.6);
    }
    for (const k of [...bands.keys()]) if (!byKey.has(k)) bands.delete(k);
    geo = layoutFrame(list, bl);
    const f = focusSet();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = pal.bg; ctx.fillRect(0, 0, W, H);
    drawStages();

    // support arcs, behind the river
    for (const b of bl) {
      const a = geo.arcs.get(b.key);
      if (!a) continue;
      const v = bands.get(b.key), act = bandActive(b, f);
      const col = tone(RESOURCES[b.res].color);
      ctx.strokeStyle = alpha(col, (f ? (act ? 0.85 : 0.07) : 0.32) * (1 + v.flash));
      ctx.lineWidth = Math.max(1.2, (1 + 3 * v.w) * cam.k); ctx.lineCap = 'round';
      ctx.setLineDash(f && act ? [] : [1, 5 * Math.max(0.6, cam.k)]);
      ctx.beginPath();
      for (let i = 0; i <= 32; i++) { const q = arcPoint(a, i / 32), s = S2(q.u, q.v); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); }
      ctx.stroke(); ctx.setLineDash([]);
    }
    // the river
    for (const b of bl) {
      const segs = geo.bandSegs.get(b.key);
      if (!segs) continue;
      const v = bands.get(b.key), act = bandActive(b, f);
      const col = tone(RESOURCES[b.res].color);
      const a = (f ? (act ? pal.bandHot : pal.bandDim) : pal.band) * (1 + v.flash * 0.8);
      segs.forEach((g, i) => {
        const A = S2(g.u0, 0), Bp = S2(g.u1, 0);
        const grad = ctx.createLinearGradient(A.x, A.y, Bp.x, Bp.y);
        const last = i === segs.length - 1;
        grad.addColorStop(0, alpha(col, a)); grad.addColorStop(1, alpha(b.to === SINK && last ? tone(pal.sink) : col, a));
        ctx.fillStyle = grad; bandPath(g); ctx.fill();
      });
    }
    // light travelling downstream (and along arcs)
    for (const b of bl) {
      const v = bands.get(b.key);
      const rate = b.arc ? (v.w > 0.06 ? 0.2 + 0.6 * v.w : 0) : v.w > 0.03 ? 0.25 + 1.6 * Math.min(1.2, v.w) : 0;
      v.acc += rate * dt;
      while (v.acc >= 1) { v.acc -= 1; if (sparks.length < 320) sparks.push({ key: b.key, res: b.res, t: 0, off: Math.random() - 0.5, vel: (b.arc ? 0.1 : 0.12) + 0.16 * b.speed, big: 1 }); }
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const sp = sparks[i], b = byKey.get(sp.key);
      if (!b) { sparks.splice(i, 1); continue; }
      sp.t += sp.vel * dt * (1 + (bands.get(sp.key)?.flash || 0) * 2);
      if (sp.t >= 1) { sparks.splice(i, 1); continue; }
      if (sp.t < 0) continue;
      const q = bandPoint(sp.key, sp.t);
      if (!q) continue;
      const s = S2(q.u, q.v + sp.off * q.w * 0.7);
      const act = bandActive(b, f);
      const col = tone(RESOURCES[sp.res].color);
      ctx.globalAlpha = Math.min(1, sp.t * 8, (1 - sp.t) * 8) * (act ? (b.arc && !f ? 0.6 : 1) : 0.2);
      ctx.fillStyle = theme === 'dark' ? mix(col, '#ffffff', 0.4) : mix(col, '#ffffff', 0.2);
      ctx.beginPath(); ctx.arc(s.x, s.y, (b.arc ? 1.5 : 1.9) * sp.big * Math.sqrt(cam.k), 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }

    // bars
    const daySnap = snap();
    const seenN = new Set();
    for (const [id, p] of geo.pos) {
      if (p.way) continue;
      seenN.add(id);
      const v = nodeOf(id);
      const isSink = id === SINK;
      const s = isSink ? null : daySnap?.projects[id] || live?.projects[id]; // colour matches the % in the label
      if (!isSink && s) v.health = damp(v.health, s.health, 3, dt);
      v.flash = Math.max(0, v.flash - dt * 1.2);
      const status = isSink ? 'thriving' : statusOf(v.health);
      const col = isSink ? pal.sink : pal[status];
      const act = nodeActive(id, f, bl);
      const a = S2(p.u, p.v0), b = S2(p.u + NW, p.v1);
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
      let op = act ? 1 : 0.3;
      if (status === 'dying' && act) op *= 0.65 + 0.35 * Math.sin(time * 3.2) ** 2;
      ctx.globalAlpha = op;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.roundRect(x, y, w, h, Math.min(5, w / 2, h / 2)); ctx.fill();
      if (v.flash > 0) { const g = (1 - v.flash) * 10; ctx.strokeStyle = alpha(col, v.flash * 0.7); ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(x - 4 - g, y - 4 - g, w + 8 + g * 2, h + 8 + g * 2, 8); ctx.stroke(); }
      const sel = S.selection?.type === 'project' && S.selection.id === id;
      if (sel) { ctx.strokeStyle = alpha(pal.text, 0.5); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.roundRect(x - 3, y - 3, w + 6, h + 6, 7); ctx.stroke(); }
      ctx.globalAlpha = 1;
      placeLabel(id, v, p, { x, y, w, h }, act, sel, status);
    }
    for (const [id, v] of [...nodes]) if (!seenN.has(id)) { v.label.remove(); nodes.delete(id); }

    // floating text
    for (let i = fx.length - 1; i >= 0; i--) {
      const t = fx[i];
      t.life -= dt / t.dur;
      const p = geo.pos.get(t.id);
      if (t.life <= 0 || !p) { fx.splice(i, 1); continue; }
      const s = S2(p.u + NW / 2, p.v0);
      const y = s.y - 10 - t.row * 22 - (1 - t.life) * 24;
      ctx.globalAlpha = Math.min(1, t.life * 2.5);
      ctx.font = `700 ${t.size}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.lineWidth = 4; ctx.strokeStyle = pal.bg; ctx.strokeText(t.text, s.x, y);
      ctx.fillStyle = t.color; ctx.fillText(t.text, s.x, y);
      ctx.globalAlpha = 1;
    }
    // link tool hint line
    if (S.tool === 'link' && linkFrom && geo.pos.get(linkFrom) && pointerAt) {
      const p = geo.pos.get(linkFrom), s = S2(p.u + NW, (p.v0 + p.v1) / 2);
      ctx.setLineDash([6, 7]); ctx.lineDashOffset = -time * 20; ctx.strokeStyle = alpha(pal.text, 0.6); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(pointerAt.x, pointerAt.y); ctx.stroke(); ctx.setLineDash([]);
    }
    updateCard(bl);
    updateTip(byKey);
  }
  raf = requestAnimationFrame(frame);

  // stage names along the top (or the side when vertical) and faint guides
  function drawStages() {
    const n = geo.cols.length;
    const hasSink = geo.cols[n - 1]?.[0] === SINK;
    const names = geo.cols.map((c, i) => (c[0] === SINK ? 'YOU EARN' : topo.roles[i] === 0 ? 'AUDIENCE' : 'PRODUCTS'));
    while (captions.length < n) { const el = document.createElement('div'); el.className = 'rv-stage'; overlay.prepend(el); captions.push(el); }
    captions.forEach((el, i) => {
      if (i >= n || vertical) { el.hidden = true; return; }
      const c = geo.cols[i], p = geo.pos.get(c[0]);
      if (!p) { el.hidden = true; return; }
      el.hidden = false;
      if (el.textContent !== names[i]) el.textContent = names[i];
      const s = vertical ? S2(p.u, 0) : S2(p.u + NW / 2, geo.V0 - 40);
      const tf = vertical ? `translate3d(${Math.round(W - 14)}px, ${Math.round(s.y)}px, 0) translate(-100%, -150%)` : `translate3d(${Math.round(s.x)}px, ${Math.round(s.y)}px, 0) translate(-50%, -50%)`;
      if (el.tf !== tf) { el.tf = tf; el.style.transform = tf; }
    });
  }

  function placeLabel(id, v, p, r, act, sel, status) {
    const el = v.label;
    const isSink = id === SINK;
    let text;
    if (isSink) {
      const sn = snap();
      const total = sn?.totals?.money ?? projects().reduce((t, q) => t + (sn?.projects[q.id]?.money || 0), 0);
      text = `sink|${fmtNum(total)}|${theme}`;
      if (text !== v.text) {
        v.text = text;
        el.querySelector('.nm').textContent = 'You earn';
        el.querySelector('.sub').innerHTML = `<b style="color:${tone(pal.sink)}">TZS ${fmtNum(total)}</b> a day`;
        el.querySelector('.need').hidden = true; el.querySelector('.late').hidden = true;
      }
    } else {
      const pr = project(id), s = snap()?.projects[id] || live?.projects[id] || { health: 0 };
      const st = statusOf(s.health);
      const main = s.money > 0.5 ? `TZS ${fmtNum(s.money)}/day` : s.attention > 0.5 ? `${fmtNum(s.attention)} views/day` : s.customers >= 0.05 ? `${fmtNum(s.customers)} customers/day` : '';
      const late = S.world.tasks.filter((t) => t.projectId === id && t.status !== 'done' && t.due && t.due < S.today).length;
      text = [pr.icon, pr.name, Math.round(s.health), st, main, late, theme].join('|');
      if (text !== v.text) {
        v.text = text;
        el.querySelector('.nm').textContent = `${pr.icon || KINDS[pr.kind]?.icon || ''} ${pr.name}`;
        el.querySelector('.sub').innerHTML = `<b style="color:${pal[st]}">${Math.round(s.health)}%</b>${main ? `<span class="amt"> · ${main}</span>` : ''}`;
        el.querySelector('.late').textContent = late ? `${late} late task${late > 1 ? 's' : ''}` : ''; el.querySelector('.late').hidden = !late;
        el.querySelector('.need').hidden = st !== 'dying';
      }
    }
    // beside the bar when the river runs sideways, above it when it runs down
    const left = !vertical && p.col === 0 && geo.cols.length > 1;
    const tf = vertical
      ? `translate3d(${Math.round(r.x + r.w / 2)}px, ${Math.round(r.y - 6)}px, 0) translate(-50%, -100%)`
      : left ? `translate3d(${Math.round(r.x - 10)}px, ${Math.round(r.y + r.h / 2)}px, 0) translate(-100%, -50%)`
        : `translate3d(${Math.round(r.x + r.w + 10)}px, ${Math.round(r.y + r.h / 2)}px, 0) translate(0, -50%)`;
    if (v.tf !== tf) { v.tf = tf; el.style.transform = tf; }
    el.classList.toggle('dim', !act);
    el.classList.toggle('sel', sel);
    el.classList.toggle('vert', vertical);
    el.classList.toggle('left', left);
    if (vertical) { const mw = `${Math.max(56, Math.round(r.w + 14))}px`; if (el.mw !== mw) { el.mw = mw; el.style.setProperty('--mw', mw); } }
    el.style.zIndex = sel ? '6' : status === 'dying' ? '3' : '1';
  }

  function updateCard() {
    const sel = S.selection?.type === 'project' ? S.selection.id : null;
    const p = sel && project(sel), g = sel && geo.pos.get(sel);
    if (!p || !g) { card.hidden = true; card.dataset.id = ''; return; }
    const v = nodes.get(sel);
    const s = snap()?.projects[sel] || live?.projects[sel] || { health: 0 };
    const st = statusOf(s.health);
    const open = S.world.tasks.filter((t) => t.projectId === sel && t.status !== 'done');
    const late = open.filter((t) => t.due && t.due < S.today).length;
    const gk = `${S.version}:${p.cfg?.goal ? JSON.stringify(p.cfg.goal) : ''}`;
    if (v && gk !== v.goalKey) { v.goalKey = gk; v.goal = goalProgress(p, { logs: S.world.logs, scans: S.world.scans || [], day: snap(0)?.projects[p.id], today: S.today }); }
    const gl = v?.goal;
    const goalText = !gl ? '' : gl.reached ? 'Goal reached' : gl.current === null ? `Goal: ${fmtNum(gl.target)} ${GOAL_METRICS[gl.metric].short}` : `Goal ${Math.round(gl.frac * 100)}% · ${fmtNum(gl.current)} of ${fmtNum(gl.target)} ${GOAL_METRICS[gl.metric].short}`;
    const since = s.lastAction ? (s.daysSince === 0 ? 'worked on today' : `last work ${s.daysSince} day${s.daysSince === 1 ? '' : 's'} ago`) : 'no work logged yet';
    const key = [sel, Math.round(s.health), st, fmtNum(s.money), fmtNum(s.attention), fmtNum(s.customers), open.length, late, goalText, since, theme].join('|');
    if (card.dataset.key !== key) {
      card.dataset.key = key; card.dataset.id = String(sel);
      card.querySelector('.ic').textContent = p.icon || KINDS[p.kind]?.icon || '';
      card.querySelector('.pn').textContent = p.name;
      card.querySelector('.ps').textContent = `${STATUS_WORD[st]} · ${since}`;
      card.querySelector('.ps').style.setProperty('--st', pal[st]);
      const cell = (val, lab, c) => `<div><b style="color:${c}">${val}</b><small>${lab}</small></div>`;
      card.querySelector('.pnums').innerHTML = cell(`${Math.round(s.health)}%`, 'health', pal[st])
        + (s.money > 0.5 ? cell(fmtNum(s.money), 'TZS / day', tone(RESOURCES.money.color)) : '')
        + (s.attention > 0.5 ? cell(fmtNum(s.attention), 'views / day', tone(RESOURCES.attention.color)) : '')
        + (s.customers >= 0.05 ? cell(fmtNum(s.customers), 'customers', tone(RESOURCES.customers.color)) : '')
        + cell(open.length, late ? `tasks · ${late} late` : 'open tasks', late ? pal.thirsty : pal.text);
      card.querySelector('.pgoal').textContent = goalText; card.querySelector('.pgoal').hidden = !goalText;
    }
    card.hidden = false;
    const a = S2(g.u, g.v0), b = S2(g.u + NW, g.v1);
    const cw = card.offsetWidth || 280, ch = card.offsetHeight || 200;
    let x, y;
    if (vertical) { x = clamp((a.x + b.x) / 2 - cw / 2, 8, W - cw - 8); y = Math.max(a.y, b.y) + 12; if (y + ch > H - 8) y = Math.min(a.y, b.y) - ch - 40; }
    else { const right = Math.max(a.x, b.x) + 16; x = right + cw < W - 8 ? right : Math.min(a.x, b.x) - cw - 16; y = clamp((a.y + b.y) / 2 - ch / 2, 8, H - ch - 8); }
    card.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
  }

  function updateTip(byKey) {
    const key = hover?.type === 'band' ? hover.key : hover?.type === 'link' ? `l${hover.id}` : S.selection?.type === 'link' ? `l${S.selection.id}` : null;
    const b = key && byKey.get(key), q = b && bandPoint(b.key, 0.5);
    if (!b || !q) { tip.hidden = true; return; }
    const s = S2(q.u, q.v);
    const from = project(b.from)?.name || '', to = b.to === SINK ? 'your income' : project(b.to)?.name || '';
    const amt = b.res === 'money' ? `TZS ${fmtNum(b.amount)} / day` : b.res === 'attention' ? `${fmtNum(b.amount)} views / day` : b.res === 'customers' ? `${fmtNum(b.amount)} customers / day` : `+${Math.round(b.amount * 100)}% energy`;
    const txt = `${from} → ${to}|${amt}`;
    if (tip.dataset.t !== txt) { tip.dataset.t = txt; tip.innerHTML = ''; const a = document.createElement('b'); a.textContent = amt; const c = document.createElement('span'); c.textContent = `${from} → ${to}`; tip.append(a, c); }
    tip.style.setProperty('--c', tone(RESOURCES[b.res].color));
    tip.hidden = false;
    tip.style.transform = `translate3d(${Math.round(s.x)}px, ${Math.round(s.y)}px, 0) translate(-50%, -130%)`;
  }

  // ---------- picking ----------
  function hitNode(sx, sy) {
    if (!geo) return null;
    for (const [id, p] of geo.pos) {
      const a = S2(p.u, p.v0), b = S2(p.u + NW, p.v1);
      if (sx > Math.min(a.x, b.x) - 8 && sx < Math.max(a.x, b.x) + 8 && sy > Math.min(a.y, b.y) - 6 && sy < Math.max(a.y, b.y) + 6) return id;
    }
    return null;
  }
  function hitBand(sx, sy) {
    if (!geo) return null;
    const { u, v } = fromScreen(sx, sy);
    let best = null, bestW = Infinity;
    for (const [key, segs] of geo.bandSegs) for (const g of segs) {
      if (u < g.u0 || u > g.u1) continue;
      const e = ease((u - g.u0) / (g.u1 - g.u0));
      const top = g.a0 + (g.b0 - g.a0) * e, bot = g.a1 + (g.b1 - g.a1) * e;
      if (v > top - 3 && v < bot + 3 && bot - top < bestW) { best = key; bestW = bot - top; }
    }
    if (best) return best;
    let bestD = Math.max(7, 7 / cam.k);
    for (const [key, a] of geo.arcs) for (let i = 0; i <= 32; i++) { const q = arcPoint(a, i / 32), d = Math.hypot(q.u - u, q.v - v); if (d < bestD) { bestD = d; best = key; } }
    return best;
  }
  function pick(sx, sy) {
    const id = hitNode(sx, sy);
    if (id !== null) return id === SINK ? null : { type: 'node', id };
    const key = hitBand(sx, sy);
    if (!key) return null;
    return key[0] === 'l' ? { type: 'link', id: Number(key.slice(1)), key } : { type: 'band', key, id: Number(key.slice(1)) };
  }
  // new projects still need a spot on the other map styles: put them beside the rest
  function freeSpot() {
    const list = projects();
    if (!list.length) return { x: 0, y: 0 };
    let x1 = -Infinity, ys = 0;
    for (const p of list) { x1 = Math.max(x1, p.x); ys += p.y; }
    return { x: Math.round(x1 + 240), y: Math.round(ys / list.length) };
  }

  // ---------- input ----------
  const pointers = new Map();
  let mode = null, press = null, pan = null, multi = null, longTimer = 0;
  const K = [0.5, 3];
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  function openContext(hit, cx, cy) {
    if (hit?.type === 'node' || hit?.type === 'link') return hooks.onContext?.(hit, cx, cy);
    if (hit?.type === 'band') return hooks.onContext?.({ type: 'node', id: hit.id }, cx, cy);
    hooks.onContext?.({ type: 'ground', ...freeSpot() }, cx, cy);
  }
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const pt = localPt(e);
    pointers.set(e.pointerId, pt);
    goal.active = false;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      mode = 'multi'; pan = null; clearTimeout(longTimer);
      multi = { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
      if (press) press.moved = true;
      return;
    }
    if (pointers.size > 2) return;
    const hit = pick(pt.x, pt.y);
    press = { x: pt.x, y: pt.y, cx: e.clientX, cy: e.clientY, moved: false, hit };
    if (e.pointerType !== 'mouse' && S.tool !== 'link') {
      const pr = press;
      clearTimeout(longTimer);
      longTimer = setTimeout(() => { if (press === pr && !pr.moved && pointers.size === 1) { pr.long = true; mode = null; pan = null; openContext(pr.hit, pr.cx, pr.cy); } }, 520);
    }
    if (S.tool === 'link') {
      mode = 'link';
      if (hit?.type === 'node') {
        if (!linkFrom) { linkFrom = hit.id; hooks.onToolHint?.('Now tap the project it feeds'); }
        else if (hit.id !== linkFrom) { const from = linkFrom; linkFrom = null; hooks.onLinkPicked?.(from, hit.id); }
      } else linkFrom = null;
      return;
    }
    if (e.button === 2) { mode = 'right'; return; }
    mode = 'pan'; pan = { x: cam.x, y: cam.y, sx: pt.x, sy: pt.y };
  });
  canvas.addEventListener('pointermove', (e) => {
    const pt = localPt(e);
    pointerAt = pt;
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, pt);
    if (press && !press.moved && Math.hypot(pt.x - press.x, pt.y - press.y) > (e.pointerType === 'touch' ? 8 : 4)) press.moved = true;
    if (mode === 'multi' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const ax = (multi.cx - W / 2) / cam.k + cam.x, ay = (multi.cy - H / 2) / cam.k + cam.y;
      cam.k = clamp(cam.k * (d / multi.d), ...K);
      cam.x = ax - (cx - W / 2) / cam.k; cam.y = ay - (cy - H / 2) / cam.k;
      multi = { cx, cy, d };
      return;
    }
    if (mode === 'pan' && pan && press?.moved) { cam.x = pan.x - (pt.x - pan.sx) / cam.k; cam.y = pan.y - (pt.y - pan.sy) / cam.k; canvas.style.cursor = 'grabbing'; return; }
    if (e.pointerType === 'mouse' && !mode) {
      hover = pick(pt.x, pt.y);
      hooks.onHover?.(null);
      canvas.style.cursor = S.tool === 'link' ? 'crosshair' : hover ? 'pointer' : 'default';
    }
  });
  const end = (e) => {
    pointers.delete(e.pointerId);
    if (mode === 'multi') {
      if (pointers.size === 1) { const [pt] = [...pointers.values()]; mode = 'pan'; pan = { x: cam.x, y: cam.y, sx: pt.x, sy: pt.y }; press = { x: pt.x, y: pt.y, moved: true }; }
      else if (!pointers.size) mode = null;
      return;
    }
    if (pointers.size) return;
    clearTimeout(longTimer);
    if (press?.long) { mode = null; press = null; return; }
    const click = press && !press.moved;
    if (click && mode === 'right') openContext(press.hit, e.clientX, e.clientY);
    else if (click && mode === 'pan') {
      const h = press.hit;
      if (h?.type === 'node') hooks.onSelect?.({ type: 'project', id: h.id });
      else if (h?.type === 'link') hooks.onSelect?.({ type: 'link', id: h.id });
      else if (h?.type === 'band') hooks.onSelect?.({ type: 'project', id: h.id });
      else hooks.onSelect?.(null);
    }
    mode = null; press = null; pan = null;
    canvas.style.cursor = S.tool === 'link' ? 'crosshair' : 'default';
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { hover = null; pointerAt = null; } });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    goal.active = false;
    const pt = localPt(e);
    const mouseWheel = e.deltaMode !== 0 || (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50);
    if (e.ctrlKey || mouseWheel) {
      const bx = (pt.x - W / 2) / cam.k + cam.x, by = (pt.y - H / 2) / cam.k + cam.y;
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      cam.k = clamp(cam.k * Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0012)), ...K);
      cam.x = bx - (pt.x - W / 2) / cam.k; cam.y = by - (pt.y - H / 2) / cam.k;
    } else { cam.x += e.deltaX / cam.k; cam.y += e.deltaY / cam.k; }
  }, { passive: false });
  canvas.addEventListener('dblclick', (e) => { const pt = localPt(e); if (!pick(pt.x, pt.y)) { const f = freeSpot(); hooks.onAddAt?.(f.x, f.y); } });
  const offTool = on('tool', () => { linkFrom = null; canvas.style.cursor = S.tool === 'link' ? 'crosshair' : 'default'; });

  // ---------- public api ----------
  // The river is laid out to the screen, so "fit" just means the whole river, unzoomed.
  function fit({ animate = true } = {}) { const t = { x: W / 2, y: H / 2, k: 1 }; if (animate) Object.assign(goal, t, { active: true }); else Object.assign(cam, t); }
  function intro() {
    fit({ animate: false });
    for (const v of bands.values()) v.w = 0; // the river fills up on arrival
    for (const v of nodes.values()) v.health = 0;
  }
  function focus(id) {
    const p = geo?.pos.get(id);
    if (!p || cam.k <= 1.01) return; // everything is already on screen
    const w = toWorld2(p.u + NW / 2, (p.v0 + p.v1) / 2);
    Object.assign(goal, { x: w.x, y: w.y, k: cam.k, active: true });
  }
  const zoomBy = (f) => Object.assign(goal, { x: cam.x, y: cam.y, k: clamp(cam.k * f, ...K), active: true });
  function startLink(id) { linkFrom = id; hooks.onToolHint?.('Now tap the project it feeds'); }
  function burst(task) {
    const p = project(task.projectId);
    if (!p) return;
    nodeOf(p.id).flash = 1;
    const aimed = task.targets || [];
    for (const [key, v] of bands) {
      const lid = key[0] === 'l' ? Number(key.slice(1)) : null;
      const l = lid && S.world.links.find((x) => x.id === lid);
      const own = l ? l.from === p.id && (!aimed.length || aimed.includes(l.to)) && (l.resource !== 'money' || task.reward) : key === `s${p.id}` && task.reward > 0;
      if (!own) continue;
      v.flash = 1;
      for (let i = 0; i < 8; i++) sparks.push({ key, res: l ? l.resource : 'money', t: -i * 0.05, off: Math.random() - 0.5, vel: 0.35, big: 1.6 });
    }
    const type = TASK_TYPES[task.type] || TASK_TYPES.other;
    fx.push({ id: p.id, life: 1, dur: 1.8, text: `${type.icon} Done`, color: pal.thriving, size: 14, row: 0 });
    if (task.reward > 0) fx.push({ id: p.id, life: 1, dur: 2.1, text: `+TZS ${fmtNum(task.reward)}`, color: tone(RESOURCES.money.color), size: 17, row: 1 });
  }
  function replay(fromHealth, highlight = []) {
    for (const [id, h] of Object.entries(fromHealth)) { const v = nodes.get(Number(id)); if (v) v.health = h; }
    highlight.forEach((id, i) => setTimeout(() => { const v = nodes.get(id); if (v) v.flash = 1; }, 600 + i * 450));
  }
  function floatText(id, text, color) { if (project(id)) fx.push({ id, life: 1, dur: 1.6, text, color, size: 14, row: 0 }); }
  function screenPos(id) { const p = geo?.pos.get(id); if (!p) return null; const r = canvas.getBoundingClientRect(); const s = S2(p.u + NW / 2, (p.v0 + p.v1) / 2); return { x: r.left + s.x, y: r.top + s.y }; }
  function destroy() { cancelAnimationFrame(raf); ro.disconnect(); offTool(); window.removeEventListener('flowmap-theme', onTheme); overlay.remove(); }
  const timeOfDay = () => { const h = new Date().getHours(); return h < 5 || h >= 21 ? 'night' : h < 8 ? 'dawn' : h < 17 ? 'day' : 'evening'; };

  return {
    kind: 'river', autoLayout: true, fit, intro, replay, setZones: () => {}, timeOfDay, startLink, focus, zoomBy, burst, floatText, screenPos, destroy, resize,
    get camera() { return { ...cam }; },
  };
}
