// The Garden: a second way to see the living system. Every project is a potted plant whose species comes
// from its kind (YouTube = blossom tree, TikTok = sunflower, app = cactus, website = flowering bush, sales =
// fruit shrub, custom = tulips). Health shows as posture, leaf colour, blooms and soil moisture; money grows as
// gold fruit. Flows between projects are pollinators on garden paths: bees carry attention, golden seeds carry
// money, butterflies carry customers and fireflies carry progress. Finishing a task waters the plant.
// The sky reflects the whole system (clear when healthy, clouds when thirsty) and follows the real clock.
// Same interface as the other renderers, drawn with Canvas 2D so it stays light on phones.
import { S, project, projects, on, liveSnap, snap } from './store.js';
import { RESOURCES, KINDS, TASK_TYPES } from '/shared/engine.js';
import { clamp, lerp, fmtNum } from './util.js';
import { goalProgress, groupOf, GOAL_METRICS } from '/shared/goals.js';

const STATUS_COLOR = { thriving: '#46e58a', steady: '#f2d15c', thirsty: '#ffb84d', dying: '#ff4d5e' };
const statusOf = (h) => (h >= 75 ? 'thriving' : h >= 50 ? 'steady' : h >= 30 ? 'thirsty' : 'dying');
const SPECIES = { youtube: 'tree', tiktok: 'sunflower', app: 'cactus', website: 'bush', service: 'fruit', custom: 'tulips' };
const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));
function seeded(seed) { let s = (seed * 9301 + 49297) % 233280; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }

// ---------- colour helpers ----------
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
const mix = (a, b, t) => { const A = rgb(a), B = rgb(b); t = clamp(t, 0, 1); return `rgb(${Math.round(A[0] + (B[0] - A[0]) * t)},${Math.round(A[1] + (B[1] - A[1]) * t)},${Math.round(A[2] + (B[2] - A[2]) * t)})`; };
const alpha = (hex, a) => { const [r, g, b] = rgb(hex); return `rgba(${r},${g},${b},${clamp(a, 0, 1)})`; };

// Two palettes: a sunny pastel meadow (light) and a moonlit warm-dark meadow (dark). Greens and earth only.
const PAL = {
  light: { ground: '#dfe8bd', ground2: '#d3e1ab', tuft: 'rgba(92,130,48,0.16)', speck: 'rgba(120,96,60,0.10)', path: '#c9a878', pathEdge: 'rgba(120,90,55,0.25)',
    soilWet: '#5e3f2a', soilDry: '#caa874', pot: '#cf7f4f', potShade: '#a9603a', rim: '#e39a6a', trunk: '#86573a', leaf: '#62b24f', leafShade: '#3f8b3a',
    dry: '#d2ad5c', dead: '#9c7b54', cactus: '#6fb56a', petal: '#f7c948', shadow: 'rgba(60,70,30,0.2)', bed: '#c6d995', bedEdge: 'rgba(110,86,55,0.35)', sign: '#b98553', signText: '#fff7e8', track: 'rgba(90,70,45,0.18)' },
  dark: { ground: '#1a2119', ground2: '#1e271b', tuft: 'rgba(170,210,120,0.07)', speck: 'rgba(240,210,160,0.05)', path: '#5b4a35', pathEdge: 'rgba(240,210,160,0.12)',
    soilWet: '#2f2117', soilDry: '#6b573d', pot: '#9b5a37', potShade: '#743f24', rim: '#b8744a', trunk: '#6a462f', leaf: '#4f9c46', leafShade: '#346f31',
    dry: '#a68845', dead: '#6c5842', cactus: '#4f9a52', petal: '#e6b53c', shadow: 'rgba(0,0,0,0.4)', bed: '#243221', bedEdge: 'rgba(240,210,160,0.16)', sign: '#7a5534', signText: '#ffe9c8', track: 'rgba(240,210,160,0.12)' },
};

// light through the day: [hour, tint colour, tint strength, night-ness 0..1]
const DAYLIGHT = [[0, '#2a1c14', 0.34, 1], [5, '#3a2418', 0.26, 0.85], [6.5, '#ffb07a', 0.12, 0.25], [8, '#fff1dc', 0.0, 0], [16, '#fff1dc', 0.0, 0],
  [18, '#ff9a55', 0.13, 0.1], [19.5, '#5a2e1a', 0.22, 0.6], [21, '#2a1c14', 0.32, 1], [24, '#2a1c14', 0.34, 1]];
function lightAt(hour) {
  let i = 0;
  while (i < DAYLIGHT.length - 2 && DAYLIGHT[i + 1][0] <= hour) i++;
  const [h0, c0, a0, n0] = DAYLIGHT[i], [h1, c1, a1, n1] = DAYLIGHT[i + 1];
  const f = clamp((hour - h0) / (h1 - h0 || 1), 0, 1);
  return { tint: mix(c0, c1, f), strength: lerp(a0, a1, f), night: lerp(n0, n1, f), name: hour < 5 || hour >= 21 ? 'night' : hour < 8 ? 'dawn' : hour < 17 ? 'day' : 'evening' };
}

export function createRenderer(canvas, hooks) {
  const stage = canvas.parentElement;
  const ctx = canvas.getContext('2d');
  const cam = { x: 0, y: 0, k: 1 };
  const goal = { x: 0, y: 0, k: 1, active: false };
  let W = 1, H = 1, dpr = 1, time = 0, last = performance.now(), raf = 0;
  let pal = PAL.dark, theme = 'dark';
  let live = null, hover = null, linkFrom = null, pointerWorld = null;
  let zonesOn = true;
  const plants = new Map(); // project id -> visual state
  const paths = new Map(); // link id -> visual state
  const bugs = []; // pollinators in flight
  const fx = []; // leaves, drops, sparkles
  let fireflies = [];
  let clouds = [];

  // ---------- overlay (labels share the 3D map's styles) ----------
  const overlay = document.createElement('div');
  overlay.className = 'labels3d garden-labels';
  stage.appendChild(overlay);
  const pipeLabel = document.createElement('div');
  pipeLabel.className = 'pipe3d';
  pipeLabel.hidden = true;
  overlay.appendChild(pipeLabel);
  const zoneLabels = new Map();

  // ---------- ground texture ----------
  let tile = null, pattern = null;
  function buildTile() {
    const c = document.createElement('canvas');
    c.width = c.height = 240;
    const x = c.getContext('2d');
    const r = seeded(17);
    x.fillStyle = pal.ground; x.fillRect(0, 0, 240, 240);
    for (let i = 0; i < 26; i++) { x.fillStyle = alpha(pal.ground2, 0.8); x.beginPath(); x.ellipse(r() * 240, r() * 240, 18 + r() * 30, 10 + r() * 16, r() * 3, 0, 6.28); x.fill(); }
    x.strokeStyle = pal.tuft; x.lineWidth = 1.2; x.lineCap = 'round';
    for (let i = 0; i < 90; i++) {
      const px = r() * 240, py = r() * 240;
      for (let b = -1; b <= 1; b++) { x.beginPath(); x.moveTo(px + b * 2, py); x.quadraticCurveTo(px + b * 3, py - 4, px + b * 4.5 + (r() - 0.5) * 2, py - 6 - r() * 3); x.stroke(); }
    }
    x.fillStyle = pal.speck;
    for (let i = 0; i < 120; i++) { x.beginPath(); x.arc(r() * 240, r() * 240, 0.6 + r() * 1.2, 0, 6.28); x.fill(); }
    tile = c;
    pattern = ctx.createPattern(tile, 'repeat');
  }
  function applyTheme(t) {
    theme = t === 'light' ? 'light' : 'dark';
    pal = PAL[theme];
    buildTile();
  }
  const onTheme = (e) => applyTheme(e.detail);
  window.addEventListener('flowmap-theme', onTheme);
  applyTheme(document.documentElement.getAttribute('data-theme'));

  // ---------- size ----------
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
  function plantOf(p) {
    let v = plants.get(p.id);
    if (!v) {
      const r = seeded(p.id * 7 + 3);
      v = { id: p.id, health: 0, size: 1.2, phase: r() * 6.28, lift: 0, water: 0, perk: 0, wet: 0, leafAcc: 0, sparkAcc: 0, rnd: Array.from({ length: 24 }, () => r()), label: makeLabel(p), text: '', tf: '', goal: null, goalKey: '' };
      plants.set(p.id, v);
    }
    return v;
  }
  function makeLabel(p) {
    const label = document.createElement('div');
    label.className = 'tank3d';
    label.innerHTML = '<div class="card"><span class="ic"></span><span class="nm"></span><span class="pct"></span></div><div class="more"><div class="nums"></div><div class="st"></div><div class="goal"></div></div><div class="acts"></div><button class="need" type="button"></button>';
    const act = (name, text, title) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.title = title; b.dataset.act = name; return b; };
    label.querySelector('.acts').append(act('water', '💧 Water', 'I did something for this project'), act('task', '＋ Task', 'Plan a task'), act('connect', '🔗 Connect', 'Draw a path from this project'), act('edit', '✎', 'Edit project'));
    label.querySelector('.need').dataset.act = 'water';
    label.addEventListener('pointerdown', (e) => e.stopPropagation());
    label.addEventListener('click', (e) => {
      const a = e.target.closest('[data-act]')?.dataset.act;
      if (a) { e.stopPropagation(); hooks.onTankAction?.(a, p.id); } else hooks.onSelect?.({ type: 'project', id: p.id });
    });
    overlay.appendChild(label);
    return label;
  }
  function pathOf(l) {
    let v = paths.get(l.id);
    if (!v) { v = { id: l.id, norm: 0, speed: 0.3, flash: 0, acc: 0, dash: 0, geom: null }; paths.set(l.id, v); }
    return v;
  }

  // how tall each plant stands above the soil, pot included (plant units; x v.size for world units)
  const TOP = { tree: 154, sunflower: 175, cactus: 132, bush: 86, fruit: 142, tulips: 134 };
  // a thirsty plant droops and thins out, so it stands a little lower
  const plantHeight = (p, v) => TOP[SPECIES[p.kind] || 'tulips'] * v.size * (1 - (1 - v.health / 100) * 0.16);

  // ---------- drawing: plants ----------
  function leafColor(h) { return h >= 0.6 ? pal.leaf : h >= 0.3 ? mix(pal.leaf, pal.dry, (0.6 - h) / 0.3) : mix(pal.dry, pal.dead, (0.3 - h) / 0.3); }
  const hi = (c) => mix(c, '#e2f28c', 0.28); // sunlit side of the leaves
  function flower(x, y, r, color) {
    ctx.fillStyle = color;
    for (let i = 0; i < 5; i++) { const a = (i / 5) * 6.28; ctx.beginPath(); ctx.arc(x + Math.cos(a) * r * 0.7, y + Math.sin(a) * r * 0.7, r * 0.62, 0, 6.28); ctx.fill(); }
    ctx.fillStyle = '#ffd84a'; ctx.beginPath(); ctx.arc(x, y, r * 0.45, 0, 6.28); ctx.fill();
  }
  function coin(x, y, r) {
    ctx.fillStyle = '#e9b949'; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.28); ctx.fill();
    ctx.fillStyle = '#fff3c4'; ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.35, 0, 6.28); ctx.fill();
  }
  function leaf(x, y, len, wid, ang, color) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(len * 0.5, -wid, len, 0); ctx.quadraticCurveTo(len * 0.5, wid, 0, 0); ctx.fill();
    ctx.restore();
  }

  // Draws the plant above its pot. Origin = soil surface, up = -y, u = scale in px per unit.
  function drawSpecies(p, v, s, u) {
    const h = v.health / 100;
    const color = p.color || KINDS[p.kind]?.color || '#ff8a5c';
    const lc = leafColor(h), ls = mix(lc, '#000000', 0.25);
    const droop = (1 - h);
    const blooms = h > 0.62 ? Math.round((h - 0.62) / 0.38 * 6) + 1 : 0;
    const fruits = Math.round(outputSize(s) * 5 * clamp(h * 1.4, 0, 1));
    const R = v.rnd;
    const sp = SPECIES[p.kind] || 'tulips';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (sp === 'tree') {
      const tx = droop * 6 * u, ty = -78 * u + droop * 10 * u;
      ctx.strokeStyle = pal.trunk; ctx.lineWidth = 8 * u;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(-4 * u, -40 * u, tx, ty); ctx.stroke();
      ctx.lineWidth = 4 * u;
      ctx.beginPath(); ctx.moveTo(-1 * u, -45 * u); ctx.quadraticCurveTo(-14 * u, -55 * u, -22 * u, ty + 10 * u); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(1 * u, -50 * u); ctx.quadraticCurveTo(14 * u, -60 * u, 22 * u, ty + 8 * u); ctx.stroke();
      const full = 0.55 + 0.45 * h;
      const blobs = [[-24, 4, 22], [22, 2, 22], [0, -18, 27], [-12, 18, 18], [14, 16, 18], [0, 4, 26], [-30, -12, 15], [30, -10, 15]];
      const n = Math.max(4, Math.round(blobs.length * (0.45 + 0.55 * h)));
      for (let pass = 0; pass < 2; pass++) {
        ctx.fillStyle = pass ? lc : ls;
        for (let i = 0; i < n; i++) { const [bx, by, br] = blobs[i]; ctx.beginPath(); ctx.arc(tx + bx * u + (pass ? 0 : 3 * u), ty + by * u + (pass ? 0 : 4 * u), br * u * full, 0, 6.28); ctx.fill(); }
      }
      ctx.fillStyle = hi(lc);
      for (let i = 0; i < n; i++) { const [bx, by, br] = blobs[i]; ctx.beginPath(); ctx.arc(tx + (bx - br * 0.3) * u, ty + (by - br * 0.35) * u, br * u * full * 0.45, 0, 6.28); ctx.fill(); }
      for (let i = 0; i < blooms; i++) flower(tx + (R[i] - 0.5) * 56 * u, ty + (R[i + 6] - 0.6) * 40 * u, 4.2 * u, color);
      for (let i = 0; i < fruits; i++) coin(tx + (R[i + 12] - 0.5) * 44 * u, ty + (14 + R[i + 3] * 14) * u, 3.8 * u);
    } else if (sp === 'sunflower') {
      const hx = (R[0] - 0.5) * 8 * u + droop * 24 * u, hy = -118 * u + droop * 30 * u;
      ctx.strokeStyle = mix(lc, '#3b5a22', 0.2); ctx.lineWidth = 5 * u;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(-6 * u, -60 * u, hx, hy); ctx.stroke();
      leaf(-2 * u, -38 * u, 28 * u, 10 * u, Math.PI + 0.5 + droop * 0.6, lc);
      leaf(1 * u, -62 * u, 26 * u, 9 * u, -0.45 + droop * 0.7, lc);
      ctx.save(); ctx.translate(hx, hy); ctx.rotate(droop * 0.9);
      const petalCol = h > 0.35 ? mix(pal.petal, pal.dry, droop * 0.8) : pal.dead;
      const petals = Math.max(6, Math.round(14 * (0.4 + 0.6 * h)));
      ctx.fillStyle = petalCol;
      for (let i = 0; i < petals; i++) { ctx.save(); ctx.rotate((i / petals) * 6.28); ctx.beginPath(); ctx.ellipse(0, -15 * u, 5 * u, 10 * u, 0, 0, 6.28); ctx.fill(); ctx.restore(); }
      ctx.fillStyle = '#6b4424'; ctx.beginPath(); ctx.arc(0, 0, 10 * u, 0, 6.28); ctx.fill();
      ctx.strokeStyle = color; ctx.lineWidth = 2.4 * u; ctx.beginPath(); ctx.arc(0, 0, 10 * u, 0, 6.28); ctx.stroke();
      for (let i = 0; i < fruits; i++) coin((R[i + 5] - 0.5) * 10 * u, (R[i + 9] - 0.5) * 10 * u, 2.4 * u);
      ctx.restore();
    } else if (sp === 'cactus') {
      ctx.save(); ctx.rotate(droop * 0.22 * (R[1] > 0.5 ? 1 : -1));
      const cc = h > 0.4 ? mix(pal.cactus, pal.dry, droop * 0.8) : mix(pal.dry, pal.dead, (0.4 - h) * 2.5);
      const body = (x, y, w, hh) => { ctx.beginPath(); ctx.roundRect(x - w / 2, y - hh, w, hh, w / 2); ctx.fill(); };
      ctx.fillStyle = mix(cc, '#000000', 0.18); body(2 * u, 0, 26 * u, 86 * u);
      ctx.fillStyle = cc; body(0, 0, 24 * u, 86 * u);
      // arms
      ctx.fillStyle = cc;
      ctx.beginPath(); ctx.roundRect(-26 * u, -52 * u, 16 * u, 12 * u, 6 * u); ctx.fill(); body(-22 * u, -44 * u, 12 * u, 30 * u);
      ctx.beginPath(); ctx.roundRect(10 * u, -38 * u, 16 * u, 11 * u, 6 * u); ctx.fill(); body(22 * u, -30 * u, 11 * u, 24 * u);
      ctx.strokeStyle = mix(cc, '#000000', 0.25); ctx.lineWidth = 1.2 * u;
      for (const dx of [-5, 0, 5]) { ctx.beginPath(); ctx.moveTo(dx * u, -6 * u); ctx.lineTo(dx * u, -78 * u); ctx.stroke(); }
      ctx.fillStyle = alpha('#fff6d8', 0.7);
      for (let i = 0; i < 10; i++) { ctx.beginPath(); ctx.arc((R[i] - 0.5) * 20 * u, -(10 + R[i + 10] * 70) * u, 0.8 * u, 0, 6.28); ctx.fill(); }
      if (blooms) flower(0, -88 * u, 6.5 * u, color);
      for (let i = 0; i < Math.min(3, fruits); i++) coin((i - 1) * 9 * u, -94 * u - (blooms ? 8 * u : 0), 3 * u);
      ctx.restore();
    } else if (sp === 'bush') {
      const full = 0.6 + 0.4 * h;
      const blobs = [[-22, -18, 18], [22, -18, 18], [0, -30, 22], [-10, -12, 18], [12, -10, 18], [-30, -4, 13], [30, -4, 13]];
      for (let pass = 0; pass < 2; pass++) {
        ctx.fillStyle = pass ? lc : ls;
        for (const [bx, by, br] of blobs) { ctx.beginPath(); ctx.arc(bx * u + (pass ? 0 : 3 * u), (by + droop * 8) * u + (pass ? 0 : 3 * u), br * u * full, 0, 6.28); ctx.fill(); }
      }
      ctx.fillStyle = hi(lc);
      for (const [bx, by, br] of blobs) { ctx.beginPath(); ctx.arc((bx - br * 0.3) * u, (by - br * 0.35 + droop * 8) * u, br * u * full * 0.42, 0, 6.28); ctx.fill(); }
      for (let i = 0; i < blooms * 2; i++) flower((R[i] - 0.5) * 64 * u, (-8 - R[i + 7] * 34 + droop * 8) * u, 3.4 * u, color);
      for (let i = 0; i < fruits; i++) coin((R[i + 14] - 0.5) * 50 * u, (-6 - R[i + 2] * 20) * u, 3 * u);
    } else if (sp === 'fruit') {
      const ty = -70 * u + droop * 10 * u;
      ctx.strokeStyle = pal.trunk; ctx.lineWidth = 6 * u;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(3 * u, -35 * u, 0, ty); ctx.stroke();
      const full = 0.55 + 0.45 * h;
      const blobs = [[-18, 0, 20], [18, 0, 20], [0, -16, 24], [0, 10, 20]];
      for (let pass = 0; pass < 2; pass++) {
        ctx.fillStyle = pass ? lc : ls;
        for (const [bx, by, br] of blobs) { ctx.beginPath(); ctx.arc(bx * u + (pass ? 0 : 3 * u), ty + by * u + (pass ? 0 : 3 * u), br * u * full, 0, 6.28); ctx.fill(); }
      }
      ctx.fillStyle = hi(lc);
      for (const [bx, by, br] of blobs) { ctx.beginPath(); ctx.arc((bx - br * 0.3) * u, ty + (by - br * 0.35) * u, br * u * full * 0.45, 0, 6.28); ctx.fill(); }
      // fruit in the project's colour = sales; more when healthy and busy
      const n = Math.max(h > 0.3 ? 2 : 0, Math.round((2 + outputSize(s) * 6) * h));
      for (let i = 0; i < n; i++) {
        const fx0 = (R[i] - 0.5) * 48 * u, fy0 = ty + (R[i + 8] - 0.4) * 34 * u;
        ctx.fillStyle = mix(color, '#000000', 0.15); ctx.beginPath(); ctx.arc(fx0, fy0, 5 * u, 0, 6.28); ctx.fill();
        ctx.fillStyle = alpha('#ffffff', 0.45); ctx.beginPath(); ctx.arc(fx0 - 1.6 * u, fy0 - 1.6 * u, 1.6 * u, 0, 6.28); ctx.fill();
      }
    } else {
      // tulips
      const stems = [[-12, -70, -0.12], [0, -86, 0], [12, -66, 0.14]];
      stems.forEach(([x, y, a], i) => {
        const hx = x * u + droop * 12 * u * (i - 1 || 1), hy = y * u + droop * 22 * u;
        ctx.strokeStyle = lc; ctx.lineWidth = 3 * u;
        ctx.beginPath(); ctx.moveTo(x * 0.3 * u, 0); ctx.quadraticCurveTo(x * u, y * 0.5 * u, hx, hy); ctx.stroke();
        leaf(x * 0.3 * u, -16 * u, 22 * u, 7 * u, -Math.PI / 2 + a * 4 + (i - 1) * 0.5 + droop * (i - 1) * 0.6, lc);
        if (h > 0.25) {
          ctx.save(); ctx.translate(hx, hy); ctx.rotate(a + droop * 0.8 * (i - 1 || 1));
          ctx.fillStyle = mix(color, pal.dead, droop * 0.6);
          ctx.beginPath(); ctx.moveTo(-8 * u, 0); ctx.quadraticCurveTo(-9 * u, -14 * u, -4 * u, -16 * u); ctx.lineTo(0, -10 * u); ctx.lineTo(4 * u, -16 * u); ctx.quadraticCurveTo(9 * u, -14 * u, 8 * u, 0); ctx.quadraticCurveTo(0, 6 * u, -8 * u, 0); ctx.fill();
          ctx.restore();
        }
      });
      for (let i = 0; i < fruits; i++) coin((i - 2) * 7 * u, -4 * u, 2.6 * u);
    }
  }

  function drawPlant(p, v, s, sx, sy, u, info) {
    const h = v.health / 100;
    const { sel, hov, status } = info;
    const color = p.color || KINDS[p.kind]?.color || '#ff8a5c';
    // ground shadow, health ring and goal ring on the ground
    ctx.fillStyle = pal.shadow;
    ctx.beginPath(); ctx.ellipse(sx + 4 * u, sy + 2 * u, 34 * u, 11 * u, 0, 0, 6.28); ctx.fill();
    const ring = (rx, ry, frac, col, lw) => {
      ctx.lineWidth = lw; ctx.strokeStyle = pal.track;
      ctx.beginPath(); ctx.ellipse(sx, sy, rx, ry, 0, 0, 6.28); ctx.stroke();
      if (frac > 0.005) { ctx.strokeStyle = col; ctx.beginPath(); ctx.ellipse(sx, sy, rx, ry, 0, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); ctx.stroke(); }
    };
    ring(46 * u, 15 * u, h, STATUS_COLOR[status], (sel ? 5.5 : 4.2) * u);
    if (v.goal) ring(55 * u, 19 * u, v.goal.frac, '#e9b949', 2.8 * u);
    // pot
    const lift = v.lift * 6 * u;
    const pw = 38 * u, pb = 28 * u, ph = 30 * u, top = sy - ph - lift;
    ctx.save();
    ctx.translate(0, -lift);
    ctx.fillStyle = pal.pot;
    ctx.beginPath(); ctx.moveTo(sx - pw / 2, top + lift); ctx.lineTo(sx + pw / 2, top + lift); ctx.lineTo(sx + pb / 2, sy); ctx.lineTo(sx - pb / 2, sy); ctx.closePath(); ctx.fill();
    ctx.fillStyle = pal.potShade;
    ctx.beginPath(); ctx.moveTo(sx + pw * 0.12, top + lift); ctx.lineTo(sx + pw / 2, top + lift); ctx.lineTo(sx + pb / 2, sy); ctx.lineTo(sx + pb * 0.05, sy); ctx.closePath(); ctx.fill();
    ctx.fillStyle = color; ctx.fillRect(sx - pw * 0.46, top + lift + ph * 0.42, pw * 0.92 * 0.98, 4.5 * u); // project colour band
    ctx.fillStyle = pal.rim; ctx.beginPath(); ctx.roundRect(sx - pw / 2 - 3 * u, top + lift - 6 * u, pw + 6 * u, 8 * u, 3 * u); ctx.fill();
    // soil: darker when well watered, pale and cracked when dry
    const wet = clamp(h + v.wet * 0.5, 0, 1);
    ctx.fillStyle = mix(pal.soilDry, pal.soilWet, wet);
    ctx.beginPath(); ctx.ellipse(sx, top + lift - 2 * u, pw / 2 - 1 * u, 4 * u, 0, 0, 6.28); ctx.fill();
    if (h < 0.4) {
      ctx.strokeStyle = alpha('#3a2a1c', 0.55); ctx.lineWidth = 1 * u;
      ctx.beginPath(); ctx.moveTo(sx - 10 * u, top + lift - 2 * u); ctx.lineTo(sx - 3 * u, top + lift - 1 * u); ctx.lineTo(sx + 2 * u, top + lift - 3 * u); ctx.moveTo(sx + 5 * u, top + lift - 1 * u); ctx.lineTo(sx + 11 * u, top + lift - 2.5 * u); ctx.stroke();
    }
    // plant, swaying gently in the wind (less when dry), with a perk-up bounce after watering
    ctx.save();
    ctx.translate(sx, top + lift - 2 * u);
    const sway = Math.sin(time * 0.9 + v.phase) * 0.035 * (0.35 + h) + Math.sin(time * 2.3 + v.phase * 2) * 0.008;
    ctx.rotate(sway);
    const perk = 1 + v.perk * 0.08;
    ctx.scale(perk, perk);
    drawSpecies(p, v, s, u);
    ctx.restore();
    ctx.restore();
    // selection glow
    if (sel || hov) {
      ctx.strokeStyle = alpha(sel ? '#ffffff' : '#ffe9c8', sel ? 0.8 : 0.45); ctx.lineWidth = 1.6; ctx.setLineDash([5, 5]); ctx.lineDashOffset = -time * 12;
      ctx.beginPath(); ctx.ellipse(sx, sy, 58 * u, 20 * u, 0, 0, 6.28); ctx.stroke(); ctx.setLineDash([]);
    }
    // watering can tipping over the pot
    if (v.water > 0) {
      const k = 1 - v.water;
      const cx = sx + 34 * u, cy = top - 70 * u * v.size;
      const tilt = Math.min(1, k * 3) * 0.7;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(-tilt); ctx.globalAlpha = Math.min(1, v.water * 3);
      ctx.fillStyle = '#9fb3a0'; ctx.beginPath(); ctx.roundRect(-12 * u, -9 * u, 24 * u, 18 * u, 4 * u); ctx.fill();
      ctx.strokeStyle = '#7f9481'; ctx.lineWidth = 3 * u; ctx.beginPath(); ctx.moveTo(-12 * u, -4 * u); ctx.lineTo(-26 * u, -12 * u); ctx.stroke();
      ctx.beginPath(); ctx.arc(4 * u, -9 * u, 7 * u, Math.PI, 0); ctx.stroke();
      ctx.restore(); ctx.globalAlpha = 1;
      if (k > 0.2 && k < 0.85 && Math.random() < 0.8) fx.push({ kind: 'drop', x: (cx - 24 * u - W / 2) / cam.k + cam.x, y: (cy - 10 * u - H / 2) / cam.k + cam.y, vx: -8 + Math.random() * 6, vy: 30, life: 1, floor: p.y - 32 });
    }
  }

  // ---------- drawing: paths & pollinators ----------
  function computePaths() {
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
        const off = g.length > 1 ? (i - (g.length - 1) / 2) * 38 : 30;
        const c = { x: (a.x + b.x) / 2 + nx * off, y: (a.y + b.y) / 2 + ny * off };
        pathOf(l).geom = { a: { x: a.x, y: a.y + 4 }, c, b: { x: b.x, y: b.y + 4 }, len: Math.max(60, len) };
      });
    }
  }
  const quad = (g, t) => { const u = 1 - t; return { x: u * u * g.a.x + 2 * u * t * g.c.x + t * t * g.b.x, y: u * u * g.a.y + 2 * u * t * g.c.y + t * t * g.b.y }; };

  function drawPaths() {
    for (const l of S.world.links) {
      const v = paths.get(l.id);
      if (!v?.geom) continue;
      const g = v.geom;
      const A = toScreen(g.a.x, g.a.y), C = toScreen(g.c.x, g.c.y), B = toScreen(g.b.x, g.b.y);
      const hot = (hover?.type === 'link' && hover.id === l.id) || (S.selection?.type === 'link' && S.selection.id === l.id);
      const related = (hover?.type === 'node' && (hover.id === l.from || hover.id === l.to)) || (S.selection?.type === 'project' && (S.selection.id === l.from || S.selection.id === l.to));
      const dim = (S.selection || hover) && !hot && !related ? 0.45 : 1;
      const width = (5 + 8 * v.norm) * cam.k;
      ctx.lineCap = 'round';
      ctx.globalAlpha = dim * (hot || related ? 0.85 : 0.32 + 0.25 * v.norm);
      ctx.strokeStyle = pal.pathEdge; ctx.lineWidth = width + 3 * cam.k;
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.quadraticCurveTo(C.x, C.y, B.x, B.y); ctx.stroke();
      ctx.strokeStyle = pal.path; ctx.lineWidth = width;
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.quadraticCurveTo(C.x, C.y, B.x, B.y); ctx.stroke();
      // stepping stones drift toward the receiver: the direction of flow
      ctx.globalAlpha = dim * (hot || related ? 0.95 : 0.55);
      ctx.strokeStyle = alpha(RESOURCES[l.resource].color, theme === 'light' ? 0.8 : 0.65);
      ctx.lineWidth = Math.max(1.5, 2.4 * cam.k);
      ctx.setLineDash([2 * cam.k, 14 * cam.k]); ctx.lineDashOffset = -v.dash * cam.k;
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.quadraticCurveTo(C.x, C.y, B.x, B.y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
  }

  function drawBug(b) {
    const g = b.path.geom;
    if (!g) return;
    const p = quad(g, b.t), q = quad(g, Math.min(1, b.t + 0.01));
    const lift = Math.sin(b.t * Math.PI) * (46 + b.path.id % 3 * 8); // fly in an arc above the path
    const wob = Math.sin(time * 5 + b.ph) * 5;
    const sp = toScreen(p.x, p.y - lift + wob * 0.4);
    const ang = Math.atan2(q.y - p.y, q.x - p.x);
    const z = Math.max(0.55, Math.sqrt(cam.k)) * b.big;
    const fade = Math.min(1, b.t * 10, (1 - b.t) * 10);
    ctx.save(); ctx.translate(sp.x, sp.y); ctx.globalAlpha = fade;
    if (b.res === 'attention') { // bee
      ctx.rotate(ang);
      const flap = 0.5 + 0.5 * Math.sin(time * 38 + b.ph);
      ctx.fillStyle = alpha('#ffffff', 0.75);
      ctx.beginPath(); ctx.ellipse(-1 * z, -5 * z, 3 * z, (4 + flap * 2) * z, -0.4, 0, 6.28); ctx.fill();
      ctx.beginPath(); ctx.ellipse(2 * z, -5 * z, 3 * z, (4 + flap * 2) * z, 0.4, 0, 6.28); ctx.fill();
      ctx.fillStyle = '#f2a51f'; ctx.beginPath(); ctx.ellipse(0, 0, 6 * z, 4 * z, 0, 0, 6.28); ctx.fill();
      ctx.fillStyle = '#3a2614'; ctx.fillRect(-2 * z, -4 * z, 1.6 * z, 8 * z); ctx.fillRect(1.4 * z, -4 * z, 1.6 * z, 8 * z);
    } else if (b.res === 'money') { // golden seed
      ctx.fillStyle = alpha('#ffd66b', 0.35); ctx.beginPath(); ctx.arc(0, 0, 7 * z, 0, 6.28); ctx.fill();
      coin(0, 0, 3.6 * z);
    } else if (b.res === 'customers') { // butterfly
      ctx.rotate(ang + Math.PI / 2);
      const flap = Math.abs(Math.sin(time * 9 + b.ph));
      ctx.fillStyle = '#46c37a';
      ctx.save(); ctx.scale(0.35 + flap * 0.65, 1);
      ctx.beginPath(); ctx.ellipse(-5 * z, -3 * z, 5 * z, 4 * z, -0.5, 0, 6.28); ctx.fill();
      ctx.beginPath(); ctx.ellipse(5 * z, -3 * z, 5 * z, 4 * z, 0.5, 0, 6.28); ctx.fill();
      ctx.fillStyle = '#8fe0ad';
      ctx.beginPath(); ctx.ellipse(-4 * z, 3 * z, 3.4 * z, 3 * z, 0.4, 0, 6.28); ctx.fill();
      ctx.beginPath(); ctx.ellipse(4 * z, 3 * z, 3.4 * z, 3 * z, -0.4, 0, 6.28); ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#2d2016'; ctx.fillRect(-0.8 * z, -5 * z, 1.6 * z, 10 * z);
    } else { // firefly (progress)
      const glow = 0.6 + 0.4 * Math.sin(time * 6 + b.ph);
      ctx.fillStyle = alpha('#ff5fa2', 0.25 * glow); ctx.beginPath(); ctx.arc(0, 0, 9 * z, 0, 6.28); ctx.fill();
      ctx.fillStyle = alpha('#ffb3d4', 0.95); ctx.beginPath(); ctx.arc(0, 0, 2.6 * z, 0, 6.28); ctx.fill();
    }
    ctx.restore(); ctx.globalAlpha = 1;
  }

  // ---------- garden beds (areas) ----------
  function drawBeds(list) {
    const byGroup = new Map();
    for (const p of list) { const g = groupOf(p); (byGroup.get(g) || byGroup.set(g, []).get(g)).push(p); }
    const show = zonesOn && byGroup.size > 1;
    const seen = new Set();
    for (const [name, members] of byGroup) {
      seen.add(name);
      let lab = zoneLabels.get(name);
      if (!lab) { lab = document.createElement('div'); lab.className = 'garden-sign'; lab.textContent = name; overlay.prepend(lab); zoneLabels.set(name, lab); }
      lab.hidden = !show;
      if (!show) continue;
      // union of soft circles around every member = one rounded bed
      ctx.fillStyle = pal.bed;
      ctx.beginPath();
      for (const p of members) { const s = toScreen(p.x, p.y - 8); ctx.moveTo(s.x + 105 * cam.k, s.y); ctx.ellipse(s.x, s.y, 105 * cam.k, 62 * cam.k, 0, 0, 6.28); }
      ctx.fill('nonzero');
      ctx.strokeStyle = pal.bedEdge; ctx.lineWidth = 2; ctx.setLineDash([2, 7]);
      ctx.stroke(); ctx.setLineDash([]);
      let front = members[0];
      for (const p of members) if (p.y > front.y) front = p;
      const s = toScreen(front.x, front.y - 8);
      const tf = `translate3d(${Math.round(s.x)}px, ${Math.round(s.y + 50 * cam.k)}px, 0) translate(-50%, -50%) scale(${clamp(0.45 + cam.k * 0.7, 0.6, 1).toFixed(2)})`;
      if (lab.tf !== tf) { lab.tf = tf; lab.style.transform = tf; }
    }
    for (const [name, lab] of [...zoneLabels]) if (!seen.has(name)) { lab.remove(); zoneLabels.delete(name); }
  }

  // ---------- sky: weather from system health, light from the clock ----------
  let dayNow = lightAt(12), dayAt = 0;
  function updateDaylight() {
    if (performance.now() - dayAt < 20000) return;
    dayAt = performance.now();
    const d = new Date();
    dayNow = lightAt(d.getHours() + d.getMinutes() / 60);
  }
  function drawSky(dt) {
    const health = (live?.totals?.health ?? 70) / 100;
    // clouds drift over when projects are thirsty; their shadows cross the garden
    const want = health >= 0.72 ? 0 : health >= 0.5 ? 2 : health >= 0.35 ? 4 : 6;
    while (clouds.length < want) clouds.push({ x: Math.random() * W, y: Math.random() * H, r: 90 + Math.random() * 120, v: 6 + Math.random() * 8, a: 0 });
    clouds.forEach((c, i) => {
      c.x += c.v * dt; c.a = damp(c.a, i < want ? 1 : 0, 0.8, dt);
      if (c.x - c.r > W) { c.x = -c.r; c.y = Math.random() * H; }
      const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.r);
      g.addColorStop(0, alpha('#2a2418', (theme === 'light' ? 0.12 : 0.2) * c.a)); g.addColorStop(1, alpha('#2a2418', 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(c.x, c.y, c.r * 1.4, c.r * 0.8, 0, 0, 6.28); ctx.fill();
    });
    clouds = clouds.filter((c, i) => i < want || c.a > 0.02);
    // warm sunlight from the top-left by day
    if (dayNow.night < 0.6 && health >= 0.5) {
      const g = ctx.createRadialGradient(W * 0.1, -H * 0.1, 0, W * 0.1, -H * 0.1, Math.max(W, H) * 0.9);
      g.addColorStop(0, alpha('#fff2cc', (theme === 'light' ? 0.35 : 0.08) * (1 - dayNow.night)));
      g.addColorStop(1, alpha('#fff2cc', 0));
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    // time-of-day tint
    if (dayNow.strength > 0.005) { ctx.fillStyle = alpha(dayNow.tint, dayNow.strength * (theme === 'light' ? 0.35 : 0.8)); ctx.fillRect(0, 0, W, H); }
    // fireflies at night
    const wantFlies = Math.round(dayNow.night * 40);
    while (fireflies.length < wantFlies) fireflies.push({ x: Math.random() * W, y: Math.random() * H, ph: Math.random() * 6.28, s: 0.5 + Math.random() });
    fireflies.length = Math.min(fireflies.length, wantFlies);
    for (const f of fireflies) {
      f.x += Math.sin(time * 0.3 + f.ph) * 8 * dt; f.y += Math.cos(time * 0.25 + f.ph * 2) * 6 * dt;
      const a = (0.5 + 0.5 * Math.sin(time * 2 + f.ph * 3)) * dayNow.night;
      ctx.fillStyle = alpha('#ffe08a', 0.18 * a); ctx.beginPath(); ctx.arc(f.x, f.y, 7 * f.s, 0, 6.28); ctx.fill();
      ctx.fillStyle = alpha('#fff3c4', 0.9 * a); ctx.beginPath(); ctx.arc(f.x, f.y, 1.5 * f.s, 0, 6.28); ctx.fill();
    }
    // future view: a soft sepia wash
    if (S.offset > 0) { ctx.fillStyle = alpha('#c98a4a', theme === 'light' ? 0.12 : 0.1); ctx.fillRect(0, 0, W, H); }
  }

  // ---------- labels ----------
  function updateLabel(p, v, info, sx, top) {
    const { sel, hov } = info;
    const s = snap()?.projects[p.id] || info.s;
    const status = statusOf(s.health);
    const kind = KINDS[p.kind] || KINDS.custom;
    const nums = [];
    if (s.money > 0.5) nums.push(`<span style="color:${RESOURCES.money.color}">TZS ${fmtNum(s.money)}</span>`);
    if (s.attention > 0.5) nums.push(`<span style="color:${RESOURCES.attention.color}">🐝 ${fmtNum(s.attention)}</span>`);
    if (s.customers >= 0.05) nums.push(`<span style="color:${RESOURCES.customers.color}">🦋 ${fmtNum(s.customers)}</span>`);
    const pct = Math.round(s.health);
    const since = s.lastAction ? (s.daysSince === 0 ? 'watered today' : `${s.daysSince} day${s.daysSince === 1 ? '' : 's'} since last water`) : 'never watered';
    const need = status === 'dying' ? '💧 Water now' : status === 'thirsty' ? '💧 Thirsty' : '';
    const g = v.goal;
    const goalText = !g ? '' : g.reached ? `🏆 Goal reached` : g.current === null ? `🎯 ${fmtNum(g.target)} ${GOAL_METRICS[g.metric].short}` : `🎯 ${Math.round(g.frac * 100)}% of ${fmtNum(g.target)} ${GOAL_METRICS[g.metric].short}`;
    const text = `${p.icon}|${p.name}|${pct}|${status}|${nums.join('')}|${since}|${need}|${goalText}`;
    if (text !== v.text) {
      v.text = text;
      const q = (c) => v.label.querySelector(c);
      q('.ic').textContent = p.icon || kind.icon;
      q('.nm').textContent = p.name;
      q('.pct').textContent = `${pct}%`; q('.pct').style.color = STATUS_COLOR[status];
      q('.card').style.setProperty('--st', STATUS_COLOR[status]);
      q('.nums').innerHTML = nums.join('');
      q('.st').textContent = `${status[0].toUpperCase()}${status.slice(1)} · ${since}`;
      q('.need').textContent = need; q('.need').hidden = !need;
      q('.goal').textContent = goalText; q('.goal').hidden = !goalText;
    }
    const scale = clamp(0.55 + cam.k * 0.45, W < 520 ? 0.6 : 0.8, 1.1);
    const tf = `translate3d(${Math.round(sx)}px, ${Math.round(top)}px, 0) translate(-50%, -100%) scale(${scale.toFixed(2)})`;
    if (v.tf !== tf) { v.tf = tf; v.label.style.transform = tf; }
    v.label.style.zIndex = sel ? '6' : hov ? '5' : status === 'dying' ? '3' : '1';
    v.label.classList.toggle('sel', sel);
    v.label.classList.toggle('hov', hov);
    v.label.classList.toggle('dim', !!S.selection && !sel);
    v.label.classList.toggle('compact', cam.k < 0.5 && W < 760); // small screens, zoomed out: icon + health only
    v.label.hidden = sx < -200 || sx > W + 200 || top < -200 || top > H + 300;
  }

  // ---------- frame ----------
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!S.sim || W < 2) return;
    time += dt;
    live = liveSnap();
    updateDaylight();
    if (goal.active) {
      cam.x = damp(cam.x, goal.x, 6, dt); cam.y = damp(cam.y, goal.y, 6, dt); cam.k = damp(cam.k, goal.k, 6, dt);
      if (Math.abs(cam.x - goal.x) + Math.abs(cam.y - goal.y) < 0.4 && Math.abs(cam.k - goal.k) < 0.002) goal.active = false;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // ground that pans and zooms with the world
    if (pattern?.setTransform) pattern.setTransform(new DOMMatrix().translateSelf(W / 2 - cam.x * cam.k, H / 2 - cam.y * cam.k).scaleSelf(Math.max(0.5, cam.k)));
    ctx.fillStyle = pattern || pal.ground; ctx.fillRect(0, 0, W, H);

    const list = projects();
    drawBeds(list);
    computePaths();
    // path flow + pollinators
    for (const l of S.world.links) {
      const v = paths.get(l.id), o = live?.links[l.id];
      if (!v?.geom || !o) continue;
      v.norm = damp(v.norm, o.norm, 2, dt); v.speed = damp(v.speed, o.speed, 2, dt); v.flash = Math.max(0, v.flash - dt * 0.2);
      const vel = (18 + 45 * v.speed) * RESOURCES[l.resource].speed * (1 + v.flash * 1.8);
      v.dash += dt * vel * 0.6;
      const rate = v.norm > 0.015 ? 0.05 + 0.5 * v.norm : 0;
      v.acc += rate * dt;
      while (v.acc >= 1) { v.acc -= 1; if (bugs.length < 220) bugs.push({ path: v, res: l.resource, t: 0, v: vel, ph: Math.random() * 6.28, big: 1 }); }
    }
    for (const [id] of [...paths]) if (!S.world.links.some((l) => l.id === id)) paths.delete(id);
    drawPaths();

    // plants, back to front
    const order = [...list].sort((a, b) => a.y - b.y);
    const seen = new Set();
    for (const p of order) {
      seen.add(p.id);
      const v = plantOf(p);
      const s = live?.projects[p.id] || { health: 60 };
      v.health = damp(v.health, s.health, 1.5, dt);
      v.size = damp(v.size, 1.15 + 0.35 * outputSize(s), 3, dt);
      v.water = Math.max(0, v.water - dt / 2.4); v.perk = Math.max(0, v.perk - dt * 0.9); v.wet = Math.max(0, v.wet - dt * 0.15);
      const sel = S.selection?.type === 'project' && S.selection.id === p.id;
      const hov = hover?.type === 'node' && hover.id === p.id;
      v.lift = damp(v.lift, sel || hov ? 1 : 0, 8, dt);
      const gk = `${S.version}:${p.cfg?.goal ? JSON.stringify(p.cfg.goal) : ''}`;
      if (gk !== v.goalKey) { v.goalKey = gk; v.goal = goalProgress(p, { logs: S.world.logs, scans: S.world.scans || [], day: snap(0)?.projects[p.id], today: S.today }); }
      const status = statusOf(s.health);
      const sp = toScreen(p.x, p.y);
      const u = cam.k * v.size;
      const info = { s, sel, hov, status };
      if (sp.x > -200 && sp.x < W + 200 && sp.y > -100 && sp.y < H + 250) drawPlant(p, v, s, sp.x, sp.y, u, info);
      updateLabel(p, v, info, sp.x, sp.y - plantHeight(p, v) * cam.k * (1 + v.perk * 0.08) - v.lift * 6 * u + 6);
      // falling leaves from a dry plant, sparkles from a surging one
      if (s.health < 38) { v.leafAcc += dt * 0.9; while (v.leafAcc > 1) { v.leafAcc -= 1; fx.push({ kind: 'leaf', x: p.x + (Math.random() - 0.5) * 50 * v.size, y: p.y - (60 + Math.random() * 50) * v.size, vx: 6 + Math.random() * 10, vy: 12 + Math.random() * 8, rot: Math.random() * 6, life: 1, floor: p.y + 6, col: mix(pal.dry, pal.dead, Math.random()) }); } }
      if ((s.boost || 0) > 0.3) { v.sparkAcc += dt * 2; while (v.sparkAcc > 1) { v.sparkAcc -= 1; fx.push({ kind: 'spark', x: p.x + (Math.random() - 0.5) * 60 * v.size, y: p.y - Math.random() * 110 * v.size, vx: 0, vy: -10, life: 1 }); } }
    }
    for (const [id, v] of [...plants]) if (!seen.has(id)) { v.label.remove(); plants.delete(id); }

    // pollinators
    for (let i = bugs.length - 1; i >= 0; i--) {
      const b = bugs[i];
      if (!paths.has(b.path.id)) { bugs.splice(i, 1); continue; }
      b.t += (b.v * dt) / (b.path.geom?.len || 100);
      if (b.t >= 1) { bugs.splice(i, 1); continue; }
      if (b.t >= 0) drawBug(b);
    }
    // effects
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i];
      f.life -= dt * (f.kind === 'drop' ? 1.4 : f.kind === 'spark' ? 1.2 : 0.35);
      f.x += (f.vx || 0) * dt; f.y += (f.vy || 0) * dt;
      if (f.kind === 'drop') f.vy += 260 * dt;
      if (f.kind === 'leaf') { f.rot += dt * 2; f.vx = Math.sin(time * 2 + f.rot) * 14; if (f.y > f.floor) { f.y = f.floor; f.vy = 0; f.vx = 0; } }
      if (f.life <= 0 || (f.kind === 'drop' && f.y > f.floor)) { fx.splice(i, 1); continue; }
      const s = toScreen(f.x, f.y);
      ctx.globalAlpha = Math.min(1, f.life * 2);
      if (f.kind === 'leaf') { leaf(s.x, s.y, 9 * cam.k, 3.5 * cam.k, f.rot, f.col); }
      else if (f.kind === 'drop') { ctx.fillStyle = '#8fd0e8'; ctx.beginPath(); ctx.ellipse(s.x, s.y, 1.8 * cam.k, 3.4 * cam.k, 0, 0, 6.28); ctx.fill(); }
      else if (f.kind === 'spark') { ctx.fillStyle = '#ffe08a'; const r = 2.2 * cam.k; ctx.beginPath(); ctx.moveTo(s.x, s.y - r * 2); ctx.lineTo(s.x + r * 0.5, s.y); ctx.lineTo(s.x, s.y + r * 2); ctx.lineTo(s.x - r * 0.5, s.y); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.moveTo(s.x - r * 2, s.y); ctx.lineTo(s.x, s.y + r * 0.5); ctx.lineTo(s.x + r * 2, s.y); ctx.lineTo(s.x, s.y - r * 0.5); ctx.closePath(); ctx.fill(); }
      else if (f.kind === 'text') { ctx.font = `800 ${f.size}px Inter, system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = theme === 'light' ? 'rgba(255,252,247,0.95)' : 'rgba(12,11,10,0.9)'; ctx.strokeText(f.text, s.x, s.y); ctx.fillStyle = f.color; ctx.fillText(f.text, s.x, s.y); }
      ctx.globalAlpha = 1;
    }
    // link tool preview
    if (S.tool === 'link' && linkFrom && pointerWorld) {
      const a = project(linkFrom);
      if (a) {
        const A = toScreen(a.x, a.y), B = toScreen(pointerWorld.x, pointerWorld.y);
        ctx.setLineDash([8, 8]); ctx.lineDashOffset = -time * 20; ctx.strokeStyle = theme === 'light' ? '#5a4432' : '#ffffff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    drawSky(dt);

    // path label for the pipe you are looking at
    const lk = hover?.type === 'link' ? hover.id : S.selection?.type === 'link' ? S.selection.id : null;
    const l = lk && S.world.links.find((x) => x.id === lk);
    const pv = l && paths.get(l.id), o = l && live?.links[l.id];
    if (pv?.geom && o) {
      const m = toScreen(quad(pv.geom, 0.5).x, quad(pv.geom, 0.5).y);
      const R = RESOURCES[l.resource];
      pipeLabel.hidden = false;
      pipeLabel.textContent = l.resource === 'money' ? `TZS ${fmtNum(o.amount)}/day` : l.resource === 'attention' ? `🐝 ${fmtNum(o.amount)} views/day` : l.resource === 'customers' ? `🦋 ${fmtNum(o.amount)} customers/day` : `✨ ${Math.round(o.amount * 100)}% energy`;
      pipeLabel.style.color = R.color; pipeLabel.style.borderColor = R.color;
      pipeLabel.style.transform = `translate3d(${Math.round(m.x)}px, ${Math.round(m.y)}px, 0) translate(-50%, -50%)`;
    } else pipeLabel.hidden = true;
  }
  raf = requestAnimationFrame(frame);

  // ---------- picking ----------
  function hitPlant(sx, sy) {
    const order = [...projects()].sort((a, b) => b.y - a.y);
    for (const p of order) {
      const v = plants.get(p.id);
      if (!v) continue;
      const s = toScreen(p.x, p.y);
      const hgt = (plantHeight(p, v) + 10) * cam.k, half = 44 * cam.k * v.size;
      if (sx > s.x - half && sx < s.x + half && sy < s.y + 16 * cam.k && sy > s.y - hgt) return p;
    }
    return null;
  }
  function hitPath(sx, sy) {
    let best = null, bestD = Infinity;
    for (const l of S.world.links) {
      const v = paths.get(l.id);
      if (!v?.geom) continue;
      for (let i = 0; i <= 24; i++) { const q = toScreen(quad(v.geom, i / 24).x, quad(v.geom, i / 24).y); const d = Math.hypot(q.x - sx, q.y - sy); if (d < bestD) { bestD = d; best = l; } }
    }
    return best && bestD < Math.max(12, 10 * cam.k) ? best : null;
  }
  const pick = (sx, sy) => { const p = hitPlant(sx, sy); if (p) return { type: 'node', id: p.id }; const l = hitPath(sx, sy); return l ? { type: 'link', id: l.id } : null; };

  // ---------- input (same gestures as the 3D map) ----------
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
        if (!linkFrom) { linkFrom = hit.id; hooks.onToolHint?.('Now tap the plant it feeds'); }
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
      // keep the point that was under the fingers under them: two fingers moving together pan
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
  // mouse wheel and trackpad pinch zoom toward the cursor; two-finger trackpad scrolling pans
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
    for (const p of list) { x0 = Math.min(x0, p.x - 120); x1 = Math.max(x1, p.x + 120); y0 = Math.min(y0, p.y - 270); y1 = Math.max(y1, p.y + 80); }
    return { x0, y0, x1, y1 };
  }
  function fit({ animate = true } = {}) {
    const b = bounds();
    // leave room for the alert and Today card at the top and the controls at the bottom
    const padTop = W < 760 ? 120 : 50, padBot = W < 760 ? 60 : 20;
    const room = Math.max(120, H - padTop - padBot);
    const k = b ? clamp(Math.min(W / (b.x1 - b.x0), room / (b.y1 - b.y0)), 0.22, 1.4) : 1;
    const t = b ? { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 - (padTop - padBot) / 2 / k, k } : { x: 0, y: 0, k: 1 };
    if (animate) Object.assign(goal, t, { active: true }); else Object.assign(cam, t);
  }
  function intro() {
    fit({ animate: false });
    const end = { ...cam };
    cam.k = end.k * 0.6; cam.y = end.y + 120;
    Object.assign(goal, end, { active: true });
  }
  function focus(id) { const p = project(id); if (p) Object.assign(goal, { x: p.x, y: p.y - 70, k: Math.max(cam.k, 1), active: true }); }
  const zoomBy = (f) => Object.assign(goal, { x: cam.x, y: cam.y, k: clamp(cam.k * f, ...K), active: true });
  function startLink(id) { linkFrom = id; hooks.onToolHint?.('Now tap the plant it feeds'); }
  function burst(task) {
    const p = project(task.projectId), v = p && plants.get(p.id);
    if (!p || !v) return;
    v.water = 1; v.perk = 1; v.wet = 1;
    const q = clamp(task.quality || 3, 1, 5) / 3;
    const aimed = task.targets || [];
    for (const l of S.world.links.filter((x) => x.from === p.id)) {
      const pv = paths.get(l.id);
      if (!pv?.geom) continue;
      if (l.resource === 'money' && !task.reward) continue;
      if (aimed.length && !aimed.includes(l.to)) continue;
      pv.flash = 1;
      const n = Math.round((aimed.length ? 12 : 5) * q);
      for (let i = 0; i < n; i++) bugs.push({ path: pv, res: l.resource, t: -0.25 - i * 0.05, v: (40 + 60 * pv.speed) * 1.8, ph: Math.random() * 6.28, big: 1.25 });
    }
    const type = TASK_TYPES[task.type] || TASK_TYPES.other;
    fx.push({ kind: 'text', x: p.x, y: p.y - plantHeight(p, v) - 30, vy: -18, life: 1.6, text: `${type.icon} watered`, color: '#4fa9c9', size: 16 });
    if (task.reward > 0) fx.push({ kind: 'text', x: p.x, y: p.y - plantHeight(p, v) - 56, vy: -18, life: 1.9, text: `+TZS ${fmtNum(task.reward)}`, color: '#d99b16', size: 19 });
  }
  function replay(fromHealth, highlight = []) {
    for (const [id, h] of Object.entries(fromHealth)) { const v = plants.get(Number(id)); if (v) v.health = h; }
    highlight.forEach((id, i) => setTimeout(() => { const v = plants.get(id); if (v) { v.perk = 1; v.wet = 1; } }, 600 + i * 450));
  }
  function floatText(id, text, color) { const p = project(id), v = p && plants.get(p.id); if (v) fx.push({ kind: 'text', x: p.x, y: p.y - plantHeight(p, v) - 30, vy: -18, life: 1.5, text, color, size: 15 }); }
  function screenPos(id) { const p = project(id); if (!p) return null; const r = canvas.getBoundingClientRect(); const s = toScreen(p.x, p.y - 60); return { x: r.left + s.x, y: r.top + s.y }; }
  function destroy() {
    cancelAnimationFrame(raf); ro.disconnect(); offTool(); window.removeEventListener('flowmap-theme', onTheme);
    overlay.remove();
  }
  const timeOfDay = () => { dayAt = 0; updateDaylight(); return dayNow.name; };

  return {
    kind: 'garden', fit, intro, replay, setZones: (on) => { zonesOn = !!on; }, timeOfDay, startLink, focus, zoomBy, burst, floatText, screenPos, destroy, resize,
    legend: [['attention', '🐝 Bees', 'attention'], ['money', '🪙 Golden seeds', 'money'], ['customers', '🦋 Butterflies', 'customers'], ['progress', '✨ Fireflies', 'progress']],
    get camera() { return { ...cam }; },
  };
}
