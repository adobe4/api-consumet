// Studio: a calm, flat picture of the system, in the spirit of a phone's health and activity apps.
// Every project is a disc with its icon, wrapped in a health ring (fills and changes colour as it grows or
// fades) and, when it has one, a thin gold goal ring. Its open tasks orbit it as small dots: grey for
// planned, amber when late, green once done today. Flows are soft ribbons in the resource's colour with
// light gliding from giver to receiver; the thicker the ribbon, the more flows. Areas are quiet rounded
// panels. Text is HTML so it stays sharp; everything else is Canvas 2D.
import { S, project, projects, on, liveSnap, snap } from './store.js';
import { RESOURCES, KINDS, TASK_TYPES } from '/shared/engine.js';
import { clamp, lerp, fmtNum } from './util.js';
import { goalProgress, groupOf, GOAL_METRICS } from '/shared/goals.js';

const statusOf = (h) => (h >= 75 ? 'thriving' : h >= 50 ? 'steady' : h >= 30 ? 'thirsty' : 'dying');
const STATUS_WORD = { thriving: 'Thriving', steady: 'Steady', thirsty: 'Needs attention', dying: 'Needs you now' };
const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));
const TAU = Math.PI * 2;

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

// Warm neutrals only. Status colours follow the familiar green / yellow / orange / red.
const PAL = {
  light: { bg: '#f6f3ee', bgEdge: '#eee9e1', dot: 'rgba(70,50,30,0.09)', card: '#ffffff', edge: 'rgba(60,40,25,0.07)', track: 'rgba(60,40,25,0.08)',
    shadow: 'rgba(60,40,25,0.13)', text: '#1d1b19', muted: '#8a837b', group: 'rgba(60,40,25,0.028)', groupEdge: 'rgba(60,40,25,0.07)',
    thriving: '#2fb457', steady: '#e2a800', thirsty: '#f08a00', dying: '#f0392b', gold: '#d99a00', ribbon: 0.2, ribbonHot: 0.45, tone: 0.82 },
  dark: { bg: '#0f0f0e', bgEdge: '#0a0a09', dot: 'rgba(255,240,220,0.06)', card: '#1d1c1a', edge: 'rgba(255,240,220,0.08)', track: 'rgba(255,240,220,0.09)',
    shadow: 'rgba(0,0,0,0.55)', text: '#f5f2ed', muted: '#9a948c', group: 'rgba(255,240,220,0.03)', groupEdge: 'rgba(255,240,220,0.07)',
    thriving: '#30d158', steady: '#ffd60a', thirsty: '#ff9f0a', dying: '#ff453a', gold: '#f2c14e', ribbon: 0.3, ribbonHot: 0.6, tone: 1 },
};

export function createRenderer(canvas, hooks) {
  const stage = canvas.parentElement;
  const ctx = canvas.getContext('2d');
  const cam = { x: 0, y: 0, k: 1 };
  const goal = { x: 0, y: 0, k: 1, active: false };
  let W = 1, H = 1, dpr = 1, time = 0, last = performance.now(), raf = 0;
  let pal = PAL.light, theme = 'light';
  let live = null, hover = null, linkFrom = null, pointerWorld = null;
  let zonesOn = true;
  const nodes = new Map();
  const ribbons = new Map();
  const sparks = []; // light travelling along ribbons
  const fx = []; // ripples and floating text

  const overlay = document.createElement('div');
  overlay.className = 'studio-labels';
  stage.appendChild(overlay);
  const pipeLabel = document.createElement('div');
  pipeLabel.className = 'st-pipe';
  pipeLabel.hidden = true;
  overlay.appendChild(pipeLabel);

  function applyTheme(t) { theme = t === 'dark' ? 'dark' : 'light'; pal = PAL[theme]; }
  const onTheme = (e) => applyTheme(e.detail);
  window.addEventListener('flowmap-theme', onTheme);
  applyTheme(document.documentElement.getAttribute('data-theme'));
  const tone = (hex) => (pal.tone === 1 ? hex : mix(hex, '#000000', 1 - pal.tone));

  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  const toScreen = (x, y) => ({ x: (x - cam.x) * cam.k + W / 2, y: (y - cam.y) * cam.k + H / 2 });
  const toWorld = (sx, sy) => ({ x: (sx - W / 2) / cam.k + cam.x, y: (sy - H / 2) / cam.k + cam.y });
  const localPt = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  // ---------- per-project state ----------
  const outputSize = (s) => clamp(Math.log10(1 + (s?.money || 0) + (s?.attention || 0) * 0.02) / 5, 0, 1);
  const radiusOf = (v) => 30 + 12 * v.size; // world units
  // like pins on a map, projects keep a readable size when you zoom far out
  const nodeScale = () => Math.max(cam.k, W < 760 ? 0.6 : 0.45);
  function nodeOf(p) {
    let v = nodes.get(p.id);
    if (!v) {
      v = { id: p.id, health: 0, size: 0.5, lift: 0, pulse: 0, ping: Math.random() * 3, spin: Math.random() * TAU, label: makeLabel(p), text: '', tf: '', r: '', goal: null, goalKey: '' };
      nodes.set(p.id, v);
    }
    return v;
  }
  function makeLabel(p) {
    const el = document.createElement('div');
    el.className = 'st-node';
    el.innerHTML = '<div class="under"><div class="nm"></div><div class="sub"><span class="pct"></span><span class="num"></span></div><button class="need" type="button" data-act="water"></button></div>'
      + '<div class="pop"><div class="ph"><span class="ic"></span><div class="pt"><div class="pn"></div><div class="ps"></div></div></div><div class="pnums"></div><div class="pgoal"></div><div class="acts"></div></div>';
    const act = (name, text, title) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.title = title; b.dataset.act = name; return b; };
    el.querySelector('.acts').append(act('water', 'Log work', 'I did something for this project'), act('task', 'Plan', 'Plan a task'), act('connect', 'Connect', 'Draw a flow from this project'), act('edit', 'Edit', 'Edit project'));
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('click', (e) => {
      const a = e.target.closest('[data-act]')?.dataset.act;
      if (a) { e.stopPropagation(); hooks.onTankAction?.(a, p.id); } else hooks.onSelect?.({ type: 'project', id: p.id });
    });
    overlay.appendChild(el);
    return el;
  }

  // ---------- geometry for ribbons ----------
  const quad = (g, t) => { const u = 1 - t; return { x: u * u * g.a.x + 2 * u * t * g.c.x + t * t * g.b.x, y: u * u * g.a.y + 2 * u * t * g.c.y + t * t * g.b.y }; };
  function computeRibbons() {
    const list = S.world.links.filter((l) => project(l.from) && project(l.to) && l.from !== l.to);
    const groups = new Map();
    for (const l of list) { const k = l.from < l.to ? `${l.from}-${l.to}` : `${l.to}-${l.from}`; (groups.get(k) || groups.set(k, []).get(k)).push(l); }
    for (const g of groups.values()) {
      g.sort((a, b) => a.id - b.id);
      g.forEach((l, i) => {
        const a = project(l.from), b = project(l.to);
        const canon = l.from < l.to ? [a, b] : [b, a];
        const dx = canon[1].x - canon[0].x, dy = canon[1].y - canon[0].y, len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len, ny = dx / len;
        const off = g.length > 1 ? (i - (g.length - 1) / 2) * 44 : len * 0.08;
        let v = ribbons.get(l.id);
        if (!v) { v = { id: l.id, norm: 0, speed: 0.3, flash: 0, acc: 0, geom: null }; ribbons.set(l.id, v); }
        const grow = nodeScale() / cam.k, ra = (radiusOf(nodes.get(a.id) || { size: 0.5 }) + 16) * grow, rb = (radiusOf(nodes.get(b.id) || { size: 0.5 }) + 16) * grow;
        v.geom = { a: { x: a.x, y: a.y }, c: { x: (a.x + b.x) / 2 + nx * off, y: (a.y + b.y) / 2 + ny * off }, b: { x: b.x, y: b.y }, len: Math.max(60, len), t0: clamp(ra / len, 0, 0.45), t1: clamp(1 - rb / len, 0.55, 1) };
      });
    }
    for (const [id] of [...ribbons]) if (!list.some((l) => l.id === id)) ribbons.delete(id);
  }

  // ---------- background ----------
  function drawBackground() {
    const g = ctx.createRadialGradient(W / 2, H * 0.42, 0, W / 2, H * 0.42, Math.max(W, H) * 0.75);
    g.addColorStop(0, pal.bg); g.addColorStop(1, pal.bgEdge);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // a dot grid that pans and zooms with the map, thinned out when zoomed far out
    let step = 32 * cam.k;
    while (step < 18) step *= 2;
    const ox = ((W / 2 - cam.x * cam.k) % step + step) % step, oy = ((H / 2 - cam.y * cam.k) % step + step) % step;
    const d = Math.max(1, Math.min(1.6, cam.k * 1.4));
    ctx.fillStyle = pal.dot;
    for (let x = ox; x < W; x += step) for (let y = oy; y < H; y += step) ctx.fillRect(x - d / 2, y - d / 2, d, d);
  }

  // ---------- areas ----------
  function hull(pts) {
    pts.sort((a, b) => a.x - b.x || a.y - b.y);
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lo = [], up = [];
    for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }
  function drawGroups(list) {
    if (!zonesOn) return;
    const byGroup = new Map();
    for (const p of list) { const g = groupOf(p); (byGroup.get(g) || byGroup.set(g, []).get(g)).push(p); }
    if (byGroup.size < 2) return;
    const ns = nodeScale();
    const pad = 58 * ns; // screen px of padding around each project (rounded by a thick round-joined stroke)
    const fill = theme === 'dark' ? mix(pal.bg, '#fff0dc', 0.045) : mix(pal.bg, '#8a6a4a', 0.07);
    const edge = theme === 'dark' ? mix(pal.bg, '#fff0dc', 0.09) : mix(pal.bg, '#8a6a4a', 0.14);
    for (const [name, members] of byGroup) {
      const pts = [];
      for (const p of members) {
        const c = toScreen(p.x, p.y), r = radiusOf(nodeOf(p)) * ns;
        for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; pts.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r + (Math.sin(a) > 0 ? 34 : 0) }); }
      }
      const hp = hull(pts);
      if (hp.length < 3) continue;
      const path = () => { ctx.beginPath(); hp.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath(); };
      ctx.lineJoin = 'round';
      path(); ctx.strokeStyle = edge; ctx.lineWidth = pad * 2 + 2; ctx.stroke();
      ctx.strokeStyle = fill; ctx.lineWidth = pad * 2; ctx.stroke();
      ctx.fillStyle = fill; ctx.fill();
      let top = hp[0];
      for (const q of hp) if (q.y < top.y) top = q;
      const fs = clamp(11 * ns * 1.2, 10, 12);
      ctx.font = `600 ${fs}px ${FONT}`; ctx.fillStyle = pal.muted; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0.1em';
      ctx.fillText(name.toUpperCase(), top.x, top.y - pad + 17);
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    }
  }

  // ---------- ribbons & light ----------
  function ribbonState(l) {
    const hot = (hover?.type === 'link' && hover.id === l.id) || (S.selection?.type === 'link' && S.selection.id === l.id);
    const related = (hover?.type === 'node' && (hover.id === l.from || hover.id === l.to)) || (S.selection?.type === 'project' && (S.selection.id === l.from || S.selection.id === l.to));
    const focus = !!(S.selection || (hover && hover.type));
    return { hot, related, dim: focus && !hot && !related };
  }
  function strokeCurve(g, t0, t1) {
    // draw the part of the curve between t0 and t1 as a polyline (smooth enough at 24 steps)
    ctx.beginPath();
    for (let i = 0; i <= 24; i++) { const q = quad(g, t0 + ((t1 - t0) * i) / 24); const s = toScreen(q.x, q.y); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); }
    ctx.stroke();
  }
  function drawRibbons() {
    for (const l of S.world.links) {
      const v = ribbons.get(l.id);
      if (!v?.geom) continue;
      const g = v.geom, st = ribbonState(l);
      const col = tone(RESOURCES[l.resource].color);
      const w = Math.max(1.5, (2 + 9 * v.norm) * nodeScale());
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = alpha(col, (st.hot || st.related ? pal.ribbonHot : pal.ribbon) * (st.dim ? 0.35 : 1) * (1 + v.flash));
      ctx.lineWidth = w;
      strokeCurve(g, g.t0, g.t1);
    }
  }
  function drawSpark(sp) {
    const g = sp.rib.geom;
    if (!g) return;
    const t = g.t0 + (g.t1 - g.t0) * sp.t;
    const q = quad(g, t), s = toScreen(q.x, q.y);
    const fade = Math.min(1, sp.t * 6, (1 - sp.t) * 6);
    const l = S.world.links.find((x) => x.id === sp.rib.id);
    const dim = l && ribbonState(l).dim ? 0.3 : 1;
    const col = tone(RESOURCES[sp.res].color);
    const r = Math.max(2, (2.2 + 2 * sp.rib.norm) * Math.sqrt(nodeScale())) * sp.big;
    ctx.globalAlpha = fade * dim;
    ctx.fillStyle = alpha(col, 0.2); ctx.beginPath(); ctx.arc(s.x, s.y, r * 3, 0, TAU); ctx.fill();
    ctx.fillStyle = theme === 'dark' ? mix(col, '#ffffff', 0.35) : col; ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // ---------- nodes ----------
  function ring(sx, sy, rr, lw, frac, col, trackCol) {
    ctx.lineCap = 'round';
    ctx.lineWidth = lw; ctx.strokeStyle = trackCol;
    ctx.beginPath(); ctx.arc(sx, sy, rr, 0, TAU); ctx.stroke();
    if (frac <= 0.004) return;
    const a0 = -Math.PI / 2, a1 = a0 + TAU * Math.min(frac, 0.9999);
    if (ctx.createConicGradient) {
      const g = ctx.createConicGradient(a0, sx, sy);
      g.addColorStop(0, mix(col, '#000000', 0.12)); g.addColorStop(Math.min(1, frac), mix(col, '#ffffff', 0.18)); g.addColorStop(1, mix(col, '#ffffff', 0.18));
      ctx.strokeStyle = g;
    } else ctx.strokeStyle = col;
    ctx.beginPath(); ctx.arc(sx, sy, rr, a0, a1); ctx.stroke();
  }
  const tasksOf = (id) => S.world.tasks.filter((t) => t.projectId === id && (t.status !== 'done' || t.doneOn === S.today));

  function drawNode(p, v, s, sx, sy, info) {
    const { sel, hov, status, dim } = info;
    const k = nodeScale() * (1 + v.lift * 0.05 + v.pulse * 0.06);
    const r = radiusOf(v) * k;
    const col = pal[status];
    const color = p.color || KINDS[p.kind]?.color || '#ff8a5c';
    ctx.globalAlpha = dim ? 0.38 : 1;
    // "needs you" ping, like a location beacon
    if (status === 'dying' && !dim) {
      const ph = (v.ping % 2.6) / 2.6;
      ctx.strokeStyle = alpha(col, 0.5 * (1 - ph)); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sx, sy, r + 12 * k + ph * 46 * k, 0, TAU); ctx.stroke();
    }
    // boosted: a soft warm halo
    if ((s.boost || 0) > 0.3) {
      const g = ctx.createRadialGradient(sx, sy, r, sx, sy, r + 40 * k);
      g.addColorStop(0, alpha(color, 0.18 * Math.min(1, s.boost))); g.addColorStop(1, alpha(color, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, r + 40 * k, 0, TAU); ctx.fill();
    }
    // disc with a soft shadow
    ctx.save();
    ctx.shadowColor = pal.shadow; ctx.shadowBlur = (14 + 10 * v.lift) * Math.min(1.4, k); ctx.shadowOffsetY = (4 + 4 * v.lift) * Math.min(1.4, k);
    ctx.fillStyle = pal.card; ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.fill();
    ctx.restore();
    const tint = ctx.createRadialGradient(sx, sy - r * 0.4, r * 0.1, sx, sy, r);
    tint.addColorStop(0, alpha(color, theme === 'dark' ? 0.06 : 0.04)); tint.addColorStop(1, alpha(color, theme === 'dark' ? 0.2 : 0.14));
    ctx.fillStyle = tint; ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.fill();
    ctx.strokeStyle = sel ? alpha(pal.text, 0.35) : pal.edge; ctx.lineWidth = sel ? 2 : 1;
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.stroke();
    // icon
    ctx.font = `${Math.round(r * 0.9)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(p.icon || KINDS[p.kind]?.icon || '•', sx, sy + r * 0.05);
    // health ring, and the goal ring outside it
    const lw = Math.max(3, 7 * k);
    const rr = r + lw / 2 + 4 * k;
    ring(sx, sy, rr, lw, v.health / 100, col, pal.track);
    let outer = rr + lw / 2;
    if (v.goal) {
      const glw = Math.max(2, 3 * k), gr = outer + glw / 2 + 4 * k;
      ring(sx, sy, gr, glw, v.goal.frac, pal.gold, alpha(pal.gold, 0.14));
      outer = gr + glw / 2;
    }
    // open tasks orbit slowly; late ones are amber, the ones done today green
    const ts = tasksOf(p.id).slice(0, 12);
    if (ts.length) {
      const orb = outer + 7 * k, dotR = Math.max(1.8, 3 * k);
      ts.forEach((t, i) => {
        const a = v.spin + i * (TAU / Math.max(10, ts.length));
        const c = t.status === 'done' ? pal.thriving : t.due && t.due < S.today ? pal.thirsty : pal.muted;
        ctx.fillStyle = c; ctx.beginPath(); ctx.arc(sx + Math.cos(a) * orb, sy + Math.sin(a) * orb, dotR, 0, TAU); ctx.fill();
      });
    }
    ctx.globalAlpha = 1;
    return outer;
  }

  // ---------- labels ----------
  function money(s) {
    if (s.money > 0.5) return { v: `TZS ${fmtNum(s.money)}`, u: '/day' };
    if (s.attention > 0.5) return { v: fmtNum(s.attention), u: ' views/day' };
    if (s.customers >= 0.05) return { v: fmtNum(s.customers), u: ' customers/day' };
    return null;
  }
  function updateLabel(p, v, info, sx, sy, outer) {
    const { sel, hov, dim } = info;
    const s = snap()?.projects[p.id] || info.s;
    const status = statusOf(s.health);
    const pct = Math.round(s.health);
    const m = money(s);
    const since = s.lastAction ? (s.daysSince === 0 ? 'Worked on today' : `Last work ${s.daysSince} day${s.daysSince === 1 ? '' : 's'} ago`) : 'No work logged yet';
    const need = status === 'dying' ? 'Needs you now' : '';
    const g = v.goal;
    const goalText = !g ? '' : g.reached ? 'Goal reached' : g.current === null ? `Goal: ${fmtNum(g.target)} ${GOAL_METRICS[g.metric].short}` : `Goal ${Math.round(g.frac * 100)}% · ${fmtNum(g.current)} of ${fmtNum(g.target)} ${GOAL_METRICS[g.metric].short}`;
    const open = S.world.tasks.filter((t) => t.projectId === p.id && t.status !== 'done');
    const late = open.filter((t) => t.due && t.due < S.today).length;
    const text = [p.icon, p.name, pct, status, m?.v, m?.u, since, need, goalText, s.money, s.attention, s.customers, open.length, late, theme].join('|');
    const q = (c) => v.label.querySelector(c);
    if (text !== v.text) {
      v.text = text;
      q('.nm').textContent = p.name;
      q('.pct').textContent = `${pct}%`; q('.pct').style.color = pal[status];
      q('.num').textContent = m ? `${m.v}${m.u}` : '';
      q('.need').textContent = need; q('.need').hidden = !need;
      q('.ic').textContent = p.icon || KINDS[p.kind]?.icon || '';
      q('.pn').textContent = p.name;
      q('.ps').textContent = `${STATUS_WORD[status]} · ${since}`;
      q('.ps').style.setProperty('--st', pal[status]);
      const cell = (val, lab, c) => `<div><b style="color:${c}">${val}</b><small>${lab}</small></div>`;
      q('.pnums').innerHTML = cell(`${pct}%`, 'health', pal[status])
        + (s.money > 0.5 ? cell(fmtNum(s.money), 'TZS / day', tone(RESOURCES.money.color)) : '')
        + (s.attention > 0.5 ? cell(fmtNum(s.attention), 'views / day', tone(RESOURCES.attention.color)) : '')
        + (s.customers >= 0.05 ? cell(fmtNum(s.customers), 'customers', tone(RESOURCES.customers.color)) : '')
        + cell(open.length, late ? `tasks · ${late} late` : 'open tasks', late ? pal.thirsty : pal.text);
      q('.pgoal').textContent = goalText; q('.pgoal').hidden = !goalText;
    }
    const gap = Math.round(outer);
    if (v.r !== gap) { v.r = gap; v.label.style.setProperty('--r', `${gap}px`); }
    const tf = `translate3d(${Math.round(sx)}px, ${Math.round(sy)}px, 0)`;
    if (v.tf !== tf) { v.tf = tf; v.label.style.transform = tf; }
    v.label.style.zIndex = sel ? '6' : hov ? '5' : status === 'dying' ? '3' : '1';
    v.label.classList.toggle('sel', sel);
    v.label.classList.toggle('hov', hov);
    v.label.classList.toggle('dim', dim);
    v.label.classList.toggle('compact', cam.k < 0.6 && W < 760);
    v.label.hidden = sx < -260 || sx > W + 260 || sy < -260 || sy > H + 260;
  }

  // ---------- light through the day (kept subtle) ----------
  let hourNow = 12, hourAt = 0;
  function updateHour() { if (performance.now() - hourAt < 20000) return; hourAt = performance.now(); const d = new Date(); hourNow = d.getHours() + d.getMinutes() / 60; }
  const dayName = (h) => (h < 5 || h >= 21 ? 'night' : h < 8 ? 'dawn' : h < 17 ? 'day' : 'evening');
  function drawDaylight() {
    const n = dayName(hourNow);
    const tint = n === 'night' ? ['#1a120a', theme === 'dark' ? 0.12 : 0.05] : n === 'dawn' || n === 'evening' ? ['#ff9a4a', 0.035] : null;
    if (tint) { ctx.fillStyle = alpha(tint[0], tint[1]); ctx.fillRect(0, 0, W, H); }
  }

  // ---------- frame ----------
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!S.sim || W < 2) return;
    time += dt;
    live = liveSnap();
    updateHour();
    if (goal.active) {
      cam.x = damp(cam.x, goal.x, 6, dt); cam.y = damp(cam.y, goal.y, 6, dt); cam.k = damp(cam.k, goal.k, 6, dt);
      if (Math.abs(cam.x - goal.x) + Math.abs(cam.y - goal.y) < 0.4 && Math.abs(cam.k - goal.k) < 0.002) goal.active = false;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBackground();
    const list = projects();
    for (const p of list) {
      const v = nodeOf(p), s = live?.projects[p.id] || { health: 60 };
      v.health = damp(v.health, s.health, 1.6, dt);
      v.size = damp(v.size, outputSize(s), 3, dt);
    }
    drawGroups(list);
    computeRibbons();
    for (const l of S.world.links) {
      const v = ribbons.get(l.id), o = live?.links[l.id];
      if (!v?.geom || !o) continue;
      v.norm = damp(v.norm, o.norm, 2, dt); v.speed = damp(v.speed, o.speed, 2, dt); v.flash = Math.max(0, v.flash - dt * 0.5);
      const rate = v.norm > 0.015 ? 0.15 + 1.1 * v.norm : 0;
      v.acc += rate * dt;
      while (v.acc >= 1) { v.acc -= 1; if (sparks.length < 260) sparks.push({ rib: v, res: l.resource, t: 0, vel: (40 + 70 * v.speed) * RESOURCES[l.resource].speed, big: 1 }); }
    }
    drawRibbons();
    for (let i = sparks.length - 1; i >= 0; i--) {
      const sp = sparks[i];
      if (!ribbons.has(sp.rib.id) || !sp.rib.geom) { sparks.splice(i, 1); continue; }
      const len = sp.rib.geom.len * (sp.rib.geom.t1 - sp.rib.geom.t0);
      sp.t += (sp.vel * dt * (1 + sp.rib.flash * 1.5)) / Math.max(40, len);
      if (sp.t >= 1) { sparks.splice(i, 1); continue; }
      if (sp.t >= 0) drawSpark(sp);
    }
    // nodes, back to front
    const seen = new Set();
    const focusId = S.selection?.type === 'project' ? S.selection.id : hover?.type === 'node' ? hover.id : null;
    const linked = new Set();
    if (focusId) for (const l of S.world.links) { if (l.from === focusId) linked.add(l.to); if (l.to === focusId) linked.add(l.from); }
    if (S.selection?.type === 'link') { const l = S.world.links.find((x) => x.id === S.selection.id); if (l) { linked.add(l.from); linked.add(l.to); } }
    const anyFocus = !!(focusId || S.selection?.type === 'link');
    for (const p of [...list].sort((a, b) => a.y - b.y)) {
      seen.add(p.id);
      const v = nodeOf(p), s = live?.projects[p.id] || { health: 60 };
      const sel = S.selection?.type === 'project' && S.selection.id === p.id;
      const hov = hover?.type === 'node' && hover.id === p.id;
      v.lift = damp(v.lift, sel || hov ? 1 : 0, 9, dt);
      v.pulse = Math.max(0, v.pulse - dt * 1.4);
      v.ping += dt;
      v.spin += dt * 0.12;
      const gk = `${S.version}:${p.cfg?.goal ? JSON.stringify(p.cfg.goal) : ''}`;
      if (gk !== v.goalKey) { v.goalKey = gk; v.goal = goalProgress(p, { logs: S.world.logs, scans: S.world.scans || [], day: snap(0)?.projects[p.id], today: S.today }); }
      const status = statusOf(s.health);
      const dim = anyFocus && p.id !== focusId && !linked.has(p.id);
      const sp = toScreen(p.x, p.y);
      const info = { s, sel, hov, status, dim };
      let outer = radiusOf(v) * nodeScale() + 14;
      if (sp.x > -200 && sp.x < W + 200 && sp.y > -200 && sp.y < H + 200) outer = drawNode(p, v, s, sp.x, sp.y, info);
      updateLabel(p, v, info, sp.x, sp.y, outer);
    }
    for (const [id, v] of [...nodes]) if (!seen.has(id)) { v.label.remove(); nodes.delete(id); }
    // ripples and floating numbers
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i];
      f.life -= dt / f.dur;
      if (f.life <= 0) { fx.splice(i, 1); continue; }
      const p = project(f.id);
      if (!p) { fx.splice(i, 1); continue; }
      const s = toScreen(p.x, p.y), v = nodes.get(p.id);
      const r = (v ? radiusOf(v) : 36) * nodeScale();
      const e = 1 - f.life;
      if (f.kind === 'ripple') {
        ctx.strokeStyle = alpha(f.color, 0.6 * f.life); ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(s.x, s.y, r + 10 + e * 70 * nodeScale(), 0, TAU); ctx.stroke();
      } else {
        ctx.globalAlpha = Math.min(1, f.life * 2.5);
        ctx.font = `700 ${f.size}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = f.color;
        ctx.fillText(f.text, s.x, s.y - r - 34 - f.row * 22 - e * 26);
        ctx.globalAlpha = 1;
      }
    }
    // link tool preview
    if (S.tool === 'link' && linkFrom && pointerWorld) {
      const a = project(linkFrom);
      if (a) {
        const A = toScreen(a.x, a.y), B = toScreen(pointerWorld.x, pointerWorld.y);
        ctx.setLineDash([6, 7]); ctx.lineDashOffset = -time * 20; ctx.strokeStyle = alpha(pal.text, 0.6); ctx.lineWidth = 2; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    drawDaylight();
    // readout for the flow you point at
    const lk = hover?.type === 'link' ? hover.id : S.selection?.type === 'link' ? S.selection.id : null;
    const l = lk && S.world.links.find((x) => x.id === lk);
    const rv = l && ribbons.get(l.id), o = l && live?.links[l.id];
    if (rv?.geom && o) {
      const q = quad(rv.geom, 0.5), m = toScreen(q.x, q.y);
      const R = RESOURCES[l.resource];
      pipeLabel.hidden = false;
      pipeLabel.textContent = l.resource === 'money' ? `TZS ${fmtNum(o.amount)} / day` : l.resource === 'attention' ? `${fmtNum(o.amount)} views / day` : l.resource === 'customers' ? `${fmtNum(o.amount)} customers / day` : `+${Math.round(o.amount * 100)}% energy`;
      pipeLabel.style.setProperty('--c', tone(R.color));
      pipeLabel.style.transform = `translate3d(${Math.round(m.x)}px, ${Math.round(m.y - 22)}px, 0) translate(-50%, -50%)`;
    } else pipeLabel.hidden = true;
  }
  raf = requestAnimationFrame(frame);

  // ---------- picking ----------
  function hitNode(sx, sy) {
    let best = null, bestD = Infinity;
    for (const p of projects()) {
      const v = nodes.get(p.id);
      if (!v) continue;
      const s = toScreen(p.x, p.y), d = Math.hypot(s.x - sx, s.y - sy);
      if (d < radiusOf(v) * nodeScale() + 16 && d < bestD) { best = p; bestD = d; }
    }
    return best;
  }
  function hitRibbon(sx, sy) {
    let best = null, bestD = Infinity;
    for (const l of S.world.links) {
      const v = ribbons.get(l.id);
      if (!v?.geom) continue;
      const g = v.geom;
      for (let i = 0; i <= 24; i++) { const q = quad(g, g.t0 + ((g.t1 - g.t0) * i) / 24), s = toScreen(q.x, q.y); const d = Math.hypot(s.x - sx, s.y - sy); if (d < bestD) { bestD = d; best = l; } }
    }
    return best && bestD < Math.max(10, 8 * cam.k) ? best : null;
  }
  const pick = (sx, sy) => { const p = hitNode(sx, sy); if (p) return { type: 'node', id: p.id }; const l = hitRibbon(sx, sy); return l ? { type: 'link', id: l.id } : null; };

  // ---------- input: one or two fingers pan, pinch zooms, long-press / right-click for the menu ----------
  const pointers = new Map();
  let mode = null, press = null, drag = null, pan = null, multi = null, longTimer = 0, lastTap = { t: 0, x: 0, y: 0 };
  const K = [0.2, 2.6];
  function openContext(hit, cx, cy, sx, sy) {
    if (hit) return hooks.onContext?.(hit, cx, cy);
    const w = toWorld(sx, sy);
    hooks.onContext?.({ type: 'ground', x: Math.round(w.x), y: Math.round(w.y) }, cx, cy);
  }
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const pt = localPt(e);
    pointers.set(e.pointerId, pt);
    goal.active = false;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      mode = 'multi'; drag = null; pan = null; clearTimeout(longTimer);
      multi = { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
      if (press) press.moved = true;
      return;
    }
    if (pointers.size > 2) return;
    const hit = pick(pt.x, pt.y);
    press = { x: pt.x, y: pt.y, cx: e.clientX, cy: e.clientY, moved: false, button: e.button, hit };
    if (e.pointerType !== 'mouse' && S.tool !== 'link') {
      const pr = press;
      clearTimeout(longTimer);
      longTimer = setTimeout(() => { if (press === pr && !pr.moved && pointers.size === 1) { pr.long = true; mode = null; drag = null; pan = null; openContext(pr.hit, pr.cx, pr.cy, pr.x, pr.y); } }, 520);
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
    if (hit?.type === 'node') {
      const p = project(hit.id), w = toWorld(pt.x, pt.y);
      drag = { id: hit.id, dx: p.x - w.x, dy: p.y - w.y }; mode = 'node'; canvas.style.cursor = 'grabbing';
      return;
    }
    mode = 'pan'; pan = { x: cam.x, y: cam.y, sx: pt.x, sy: pt.y }; canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointermove', (e) => {
    const pt = localPt(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, pt);
    pointerWorld = toWorld(pt.x, pt.y);
    if (press && !press.moved && Math.hypot(pt.x - press.x, pt.y - press.y) > (e.pointerType === 'touch' ? 8 : 4)) press.moved = true;
    if (mode === 'multi' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const anchor = toWorld(multi.cx, multi.cy);
      cam.k = clamp(cam.k * (d / multi.d), ...K);
      cam.x = anchor.x - (cx - W / 2) / cam.k; cam.y = anchor.y - (cy - H / 2) / cam.k;
      multi = { cx, cy, d };
      return;
    }
    if (mode === 'pan' && pan && press?.moved) { cam.x = pan.x - (pt.x - pan.sx) / cam.k; cam.y = pan.y - (pt.y - pan.sy) / cam.k; return; }
    if (mode === 'node' && drag && press?.moved) { hooks.onMoved?.(drag.id, Math.round(pointerWorld.x + drag.dx), Math.round(pointerWorld.y + drag.dy)); return; }
    if (e.pointerType === 'mouse' && !mode) {
      const next = pick(pt.x, pt.y);
      if (next?.id !== hover?.id || next?.type !== hover?.type) hover = next;
      hooks.onHover?.(hover, e.clientX, e.clientY);
      canvas.style.cursor = S.tool === 'link' ? 'crosshair' : hover ? 'pointer' : 'grab';
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
    if (click && mode === 'right') openContext(press.hit, e.clientX, e.clientY, press.x, press.y);
    else if (click && mode === 'node') hooks.onSelect?.({ type: 'project', id: drag.id });
    else if (click && mode === 'pan') {
      if (press.hit?.type === 'link') hooks.onSelect?.({ type: 'link', id: press.hit.id });
      else {
        hooks.onSelect?.(null);
        const now = performance.now();
        if (e.pointerType !== 'mouse' && now - lastTap.t < 320 && Math.hypot(press.x - lastTap.x, press.y - lastTap.y) < 24) { const w = toWorld(press.x, press.y); hooks.onAddAt?.(Math.round(w.x), Math.round(w.y)); lastTap.t = 0; }
        else lastTap = { t: now, x: press.x, y: press.y };
      }
    }
    mode = null; press = null; drag = null; pan = null;
    canvas.style.cursor = S.tool === 'link' ? 'crosshair' : 'grab';
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && hover) { hover = null; hooks.onHover?.(null); } });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    goal.active = false;
    const pt = localPt(e);
    const mouseWheel = e.deltaMode !== 0 || (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50);
    if (e.ctrlKey || mouseWheel) {
      const before = toWorld(pt.x, pt.y);
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      cam.k = clamp(cam.k * Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0012)), ...K);
      cam.x = before.x - (pt.x - W / 2) / cam.k; cam.y = before.y - (pt.y - H / 2) / cam.k;
    } else { cam.x += e.deltaX / cam.k; cam.y += e.deltaY / cam.k; }
  }, { passive: false });
  canvas.addEventListener('dblclick', (e) => {
    const pt = localPt(e);
    if (pick(pt.x, pt.y)) return;
    const w = toWorld(pt.x, pt.y);
    hooks.onAddAt?.(Math.round(w.x), Math.round(w.y));
  });
  const offTool = on('tool', () => { linkFrom = null; canvas.style.cursor = S.tool === 'link' ? 'crosshair' : 'grab'; });

  // ---------- public api ----------
  function bounds() {
    const list = projects();
    if (!list.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of list) { x0 = Math.min(x0, p.x - 110); x1 = Math.max(x1, p.x + 110); y0 = Math.min(y0, p.y - 90); y1 = Math.max(y1, p.y + 110); }
    return { x0, y0, x1, y1 };
  }
  function fit({ animate = true } = {}) {
    const b = bounds();
    const padTop = W < 760 ? 130 : 60, padBot = W < 760 ? 60 : 30;
    const room = Math.max(120, H - padTop - padBot);
    const k = b ? clamp(Math.min((W - 24) / (b.x1 - b.x0), room / (b.y1 - b.y0)), 0.22, 1.3) : 1;
    const t = b ? { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 - (padTop - padBot) / 2 / k, k } : { x: 0, y: 0, k: 1 };
    if (animate) Object.assign(goal, t, { active: true }); else Object.assign(cam, t);
  }
  function intro() {
    fit({ animate: false });
    const endCam = { ...cam };
    cam.k = endCam.k * 0.92;
    Object.assign(goal, endCam, { active: true });
    for (const v of nodes.values()) v.health = 0; // rings fill up on arrival
  }
  function focus(id) { const p = project(id); if (p) Object.assign(goal, { x: p.x, y: p.y - (W < 760 ? 60 : 30), k: Math.max(cam.k, W < 760 ? 0.8 : 1), active: true }); }
  const zoomBy = (f) => Object.assign(goal, { x: cam.x, y: cam.y, k: clamp(cam.k * f, ...K), active: true });
  function startLink(id) { linkFrom = id; hooks.onToolHint?.('Now tap the project it feeds'); }
  function burst(task) {
    const p = project(task.projectId), v = p && nodes.get(p.id);
    if (!p || !v) return;
    v.pulse = 1;
    fx.push({ kind: 'ripple', id: p.id, life: 1, dur: 1.1, color: pal.thriving });
    const q = clamp(task.quality || 3, 1, 5) / 3;
    const aimed = task.targets || [];
    for (const l of S.world.links.filter((x) => x.from === p.id)) {
      const rv = ribbons.get(l.id);
      if (!rv?.geom) continue;
      if (l.resource === 'money' && !task.reward) continue;
      if (aimed.length && !aimed.includes(l.to)) continue;
      rv.flash = 1;
      const n = Math.round((aimed.length ? 10 : 5) * q);
      for (let i = 0; i < n; i++) sparks.push({ rib: rv, res: l.resource, t: -i * 0.06, vel: (60 + 80 * rv.speed) * 1.6, big: 1.5 });
    }
    const type = TASK_TYPES[task.type] || TASK_TYPES.other;
    fx.push({ kind: 'text', id: p.id, life: 1, dur: 1.8, text: `${type.icon} Done`, color: pal.thriving, size: 15, row: 0 });
    if (task.reward > 0) fx.push({ kind: 'text', id: p.id, life: 1, dur: 2.1, text: `+TZS ${fmtNum(task.reward)}`, color: tone(RESOURCES.money.color), size: 18, row: 1 });
  }
  function replay(fromHealth, highlight = []) {
    for (const [id, h] of Object.entries(fromHealth)) { const v = nodes.get(Number(id)); if (v) v.health = h; }
    highlight.forEach((id, i) => setTimeout(() => { if (nodes.get(id)) { nodes.get(id).pulse = 1; fx.push({ kind: 'ripple', id, life: 1, dur: 1.1, color: pal.thriving }); } }, 600 + i * 450));
  }
  function floatText(id, text, color) { if (project(id)) fx.push({ kind: 'text', id, life: 1, dur: 1.6, text, color, size: 14, row: 0 }); }
  function screenPos(id) { const p = project(id); if (!p) return null; const r = canvas.getBoundingClientRect(); const s = toScreen(p.x, p.y); return { x: r.left + s.x, y: r.top + s.y }; }
  function destroy() { cancelAnimationFrame(raf); ro.disconnect(); offTool(); window.removeEventListener('flowmap-theme', onTheme); overlay.remove(); }
  const timeOfDay = () => { hourAt = 0; updateHour(); return dayName(hourNow); };

  return {
    kind: 'studio', fit, intro, replay, setZones: (v) => { zonesOn = !!v; }, timeOfDay, startLink, focus, zoomBy, burst, floatText, screenPos, destroy, resize,
    get camera() { return { ...cam }; },
  };
}
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, "Segoe UI", Roboto, system-ui, sans-serif';
