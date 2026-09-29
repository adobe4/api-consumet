// Canvas 2D renderer for the living map: liquid-filled project tanks, curved pipes with flowing particles,
// bursts when you act, smoke when something is dying. Also owns pan / zoom / drag / hit-testing.
import { S, snap, project, projects, on } from './store.js';
import { RESOURCES, KINDS, TASK_TYPES } from '/shared/engine.js';
import { clamp, lerp, fmtNum } from './util.js';

const STATUS_COLOR = { thriving: '#46e58a', steady: '#f2d15c', thirsty: '#ffb84d', dying: '#ff4d5e' };
const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
const TEXT_FONT = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

// aspect of each node shape (width, height as multiples of radius)
const SHAPES = {
  circle: { w: 2, h: 2 },
  screen: { w: 2.5, h: 1.7 },
  phone: { w: 1.44, h: 2.1 },
  browser: { w: 2.4, h: 1.8 },
  bubble: { w: 2.3, h: 1.6 },
  hex: { w: 2, h: 1.9 },
};

function rr(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function shapePath(ctx, shape, r) {
  const s = SHAPES[shape] || SHAPES.circle;
  const w = s.w * r, h = s.h * r;
  ctx.beginPath();
  if (shape === 'circle') ctx.arc(0, 0, r, 0, Math.PI * 2);
  else if (shape === 'hex') {
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i + Math.PI / 6;
      ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r * 1.05, Math.sin(a) * r * 1.05);
    }
    ctx.closePath();
  } else if (shape === 'bubble') {
    rr(ctx, -w / 2, -h / 2, w, h, 28);
    ctx.moveTo(-w / 2 + 22, h / 2 - 2);
    ctx.lineTo(-w / 2 + 12, h / 2 + 16);
    ctx.lineTo(-w / 2 + 44, h / 2 - 2);
  } else rr(ctx, -w / 2, -h / 2, w, h, shape === 'phone' ? 20 : shape === 'screen' ? 18 : 12);
}

function seeded(seed) {
  let s = seed * 9301 + 49297;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

export function createRenderer(canvas, hooks) {
  const ctx = canvas.getContext('2d');
  const cam = { x: 0, y: 0, k: 1 };
  const camTarget = { x: 0, y: 0, k: 1, active: false };
  let W = 0, H = 0, dpr = 1;
  let raf = 0, last = performance.now(), time = 0;
  const nodes = new Map(); // id -> visual state
  const pipes = new Map(); // id -> visual state
  const rings = [];
  const smoke = [];
  const floaters = [];
  const motes = Array.from({ length: 70 }, (_, i) => { const r = seeded(i + 3); return { x: r(), y: r(), s: 0.3 + r() * 1.2, p: r() * 6.28 }; });
  let hover = null; // {type,id}
  let linkFrom = null;
  let pointerWorld = { x: 0, y: 0 };
  let drag = null; // node drag
  let pan = null;
  const pointers = new Map();
  let pinch = null;

  // ---------- coordinate helpers ----------
  const toWorld = (sx, sy) => ({ x: (sx - W / 2) / cam.k + cam.x, y: (sy - H / 2) / cam.k + cam.y });
  const canvasPoint = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  // ---------- visual state ----------
  function nodeVis(p) {
    let v = nodes.get(p.id);
    if (!v) {
      const s = snap()?.projects[p.id];
      v = { health: s ? s.health : 60, size: 50, phase: Math.random() * 6.28, smokeAcc: 0, cracks: makeCracks(p.id), flash: 0 };
      nodes.set(p.id, v);
    }
    return v;
  }
  function makeCracks(id) {
    const r = seeded(id + 11);
    return Array.from({ length: 4 }, () => {
      const pts = [];
      let x = (r() - 0.5) * 1.6, y = (r() - 0.5) * 1.6;
      for (let i = 0; i < 4; i++) { pts.push([x, y]); x += (r() - 0.5) * 0.5; y += (r() - 0.3) * 0.5; }
      return pts;
    });
  }
  function pipeVis(l) {
    let v = pipes.get(l.id);
    if (!v) { v = { norm: 0, speed: 0.3, boost: 1, parts: [], acc: 0, flash: 0, geom: null }; pipes.set(l.id, v); }
    return v;
  }

  function nodeInfo(p) {
    const s = snap()?.projects[p.id];
    return s || { health: 60, status: 'steady', flow: 0.6, money: 0, attention: 0, customers: 0, boost: 0 };
  }
  const targetSize = (s) => 46 + 16 * clamp(Math.log10(1 + s.money + s.attention * 0.02) / 5, 0, 1);

  // ---------- geometry ----------
  function computeGeoms() {
    const list = S.world.links.filter((l) => project(l.from) && project(l.to));
    const groups = new Map();
    for (const l of list) {
      const key = l.from < l.to ? `${l.from}-${l.to}` : `${l.to}-${l.from}`;
      (groups.get(key) || groups.set(key, []).get(key)).push(l);
    }
    for (const g of groups.values()) {
      g.sort((a, b) => a.id - b.id);
      g.forEach((l, i) => {
        const a = project(l.from), b = project(l.to);
        const canon = l.from < l.to ? [a, b] : [b, a];
        const dx = canon[1].x - canon[0].x, dy = canon[1].y - canon[0].y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len, ny = dx / len;
        const off = (g.length > 1 ? (i - (g.length - 1) / 2) * 34 : 26);
        const cx = (a.x + b.x) / 2 + nx * off, cy = (a.y + b.y) / 2 + ny * off;
        const ra = nodeVis(a).size * 1.12, rb = nodeVis(b).size * 1.12;
        const da = Math.hypot(cx - a.x, cy - a.y) || 1, db = Math.hypot(cx - b.x, cy - b.y) || 1;
        const p0 = { x: a.x + ((cx - a.x) / da) * ra, y: a.y + ((cy - a.y) / da) * ra };
        const p2 = { x: b.x + ((cx - b.x) / db) * rb, y: b.y + ((cy - b.y) / db) * rb };
        const v = pipeVis(l);
        // approximate arc length
        let length = 0, px = p0.x, py = p0.y;
        for (let s = 1; s <= 16; s++) {
          const t = s / 16, q = quad(p0, { x: cx, y: cy }, p2, t);
          length += Math.hypot(q.x - px, q.y - py); px = q.x; py = q.y;
        }
        v.geom = { p0, c: { x: cx, y: cy }, p2, length: Math.max(10, length) };
      });
    }
  }
  const quad = (p0, c, p2, t) => {
    const u = 1 - t;
    return { x: u * u * p0.x + 2 * u * t * c.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * c.y + t * t * p2.y };
  };
  const quadTan = (p0, c, p2, t) => {
    const dx = 2 * (1 - t) * (c.x - p0.x) + 2 * t * (p2.x - c.x), dy = 2 * (1 - t) * (c.y - p0.y) + 2 * t * (p2.y - c.y);
    const m = Math.hypot(dx, dy) || 1;
    return { x: dx / m, y: dy / m };
  };

  // ---------- simulation of visuals ----------
  function update(dt) {
    time += dt;
    const sn = snap();
    if (!sn) return;
    for (const p of projects()) {
      const v = nodeVis(p), s = nodeInfo(p);
      v.health = lerp(v.health, s.health, Math.min(1, dt * 3));
      v.size = lerp(v.size, targetSize(s), Math.min(1, dt * 4));
      v.flash = Math.max(0, v.flash - dt * 1.5);
      if (s.status === 'dying' && S.offset === 0 || (s.status === 'dying' && S.offset > 0)) {
        v.smokeAcc += dt * 2.2;
        while (v.smokeAcc > 1) {
          v.smokeAcc -= 1;
          smoke.push({ x: p.x + (Math.random() - 0.5) * v.size, y: p.y - v.size * 0.6, vx: (Math.random() - 0.5) * 8, vy: -14 - Math.random() * 10, life: 1, r: 5 + Math.random() * 6 });
        }
      }
      if (S.offset === 0 && s.boost > 0.3 && Math.random() < dt * 0.9) rings.push({ x: p.x, y: p.y, r: v.size, life: 1, color: p.color || KINDS[p.kind]?.color || '#fff', speed: 60 });
    }
    computeGeoms();
    for (const l of S.world.links) {
      const v = pipeVis(l), o = sn.links[l.id];
      if (!o || !v.geom) continue;
      v.norm = lerp(v.norm, o.norm, Math.min(1, dt * 3));
      v.speed = lerp(v.speed, o.speed, Math.min(1, dt * 3));
      v.boost = lerp(v.boost, o.boost, Math.min(1, dt * 3));
      v.flash = Math.max(0, v.flash - dt * 0.8);
      const R = RESOURCES[l.resource];
      const rate = v.norm > 0.015 ? (0.25 + 3.4 * v.norm) * (0.6 + Math.min(1, v.geom.length / 500)) : 0;
      v.acc += rate * dt;
      while (v.acc >= 1 && v.parts.length < 90) {
        v.acc -= 1;
        v.parts.push({ t: 0, off: (Math.random() - 0.5) * 2, r: 2 + Math.random() * 1.6 + v.norm * 1.8, mult: 1, ph: Math.random() * 6.28 });
      }
      if (v.acc > 3) v.acc = 0;
      const pxPerSec = (26 + 170 * v.speed) * R.speed;
      for (const q of v.parts) q.t += (pxPerSec * q.mult * dt) / v.geom.length;
      v.parts = v.parts.filter((q) => q.t < 1);
    }
    for (const r of rings) { r.r += r.speed * dt; r.life -= dt * 0.9; }
    for (let i = rings.length - 1; i >= 0; i--) if (rings[i].life <= 0) rings.splice(i, 1);
    for (const s of smoke) { s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt * 0.45; s.r += dt * 6; }
    for (let i = smoke.length - 1; i >= 0; i--) if (smoke[i].life <= 0) smoke.splice(i, 1);
    for (const f of floaters) { f.y -= 26 * dt; f.life -= dt * 0.55; }
    for (let i = floaters.length - 1; i >= 0; i--) if (floaters[i].life <= 0) floaters.splice(i, 1);
    if (camTarget.active) {
      const t = Math.min(1, dt * 5);
      cam.x = lerp(cam.x, camTarget.x, t); cam.y = lerp(cam.y, camTarget.y, t); cam.k = lerp(cam.k, camTarget.k, t);
      if (Math.abs(cam.x - camTarget.x) + Math.abs(cam.y - camTarget.y) < 0.5 && Math.abs(cam.k - camTarget.k) < 0.002) camTarget.active = false;
    }
  }

  // ---------- drawing ----------
  function drawBackground() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = ctx.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, Math.max(W, H) * 0.75);
    g.addColorStop(0, S.offset > 0 ? '#1f1710' : '#18161a');
    g.addColorStop(1, '#0a0a0b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // parallax grid
    const gs = 44 * cam.k;
    if (gs > 10) {
      ctx.fillStyle = 'rgba(255,225,190,0.06)';
      const ox = ((W / 2 - cam.x * cam.k) % gs + gs) % gs, oy = ((H / 2 - cam.y * cam.k) % gs + gs) % gs;
      for (let x = ox; x < W; x += gs) for (let y = oy; y < H; y += gs) ctx.fillRect(x - 1, y - 1, 2, 2);
    }
    // drifting motes
    for (const m of motes) {
      const x = ((m.x * W + time * 6 * m.s + Math.sin(time * 0.3 + m.p) * 20) % W + W) % W;
      const y = ((m.y * H - time * 4 * m.s) % H + H) % H;
      ctx.fillStyle = `rgba(255,215,170,${0.10 + 0.08 * Math.sin(time + m.p)})`;
      ctx.beginPath(); ctx.arc(x, y, m.s * 1.4, 0, 6.28); ctx.fill();
    }
  }

  function worldTransform() {
    ctx.setTransform(dpr * cam.k, 0, 0, dpr * cam.k, dpr * (W / 2 - cam.x * cam.k), dpr * (H / 2 - cam.y * cam.k));
  }

  function drawPipe(l) {
    const v = pipes.get(l.id);
    if (!v || !v.geom) return;
    const { p0, c, p2 } = v.geom;
    const R = RESOURCES[l.resource];
    const hot = hover?.type === 'link' && hover.id === l.id || S.selection?.type === 'link' && S.selection.id === l.id;
    const related = (hover?.type === 'node' && (hover.id === l.from || hover.id === l.to)) || (S.selection?.type === 'project' && (S.selection.id === l.from || S.selection.id === l.to));
    const dim = (S.selection || hover) && !hot && !related ? 0.45 : 1;
    const width = 4 + 12 * v.norm + (hot ? 3 : 0) + v.flash * 6;
    ctx.lineCap = 'round';
    ctx.globalAlpha = dim;
    ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.quadraticCurveTo(c.x, c.y, p2.x, p2.y);
    ctx.strokeStyle = R.color; ctx.globalAlpha = dim * (0.06 + 0.06 * v.norm + v.flash * 0.12); ctx.lineWidth = width + 8; ctx.stroke();
    ctx.globalAlpha = dim * (0.14 + 0.1 * v.norm + v.flash * 0.2); ctx.lineWidth = width; ctx.stroke();
    ctx.globalAlpha = dim * (hot ? 0.75 : 0.32 + 0.2 * v.flash); ctx.lineWidth = hot ? 2 : 1; ctx.stroke();
    // arrow head
    const tan = quadTan(p0, c, p2, 1);
    ctx.globalAlpha = dim * 0.9;
    ctx.fillStyle = R.color;
    ctx.save(); ctx.translate(p2.x, p2.y); ctx.rotate(Math.atan2(tan.y, tan.x));
    ctx.beginPath(); ctx.moveTo(1, 0); ctx.lineTo(-11, -6.5); ctx.lineTo(-8, 0); ctx.lineTo(-11, 6.5); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawParticles(l) {
    const v = pipes.get(l.id);
    if (!v || !v.geom) return;
    const { p0, c, p2 } = v.geom;
    const R = RESOURCES[l.resource];
    const spread = 2 + 12 * v.norm;
    const dim = (S.selection || hover) ? 0.85 : 1;
    ctx.globalCompositeOperation = 'lighter';
    for (const q of v.parts) {
      if (q.t < 0) continue;
      const pt = quad(p0, c, p2, q.t);
      const tan = quadTan(p0, c, p2, q.t);
      const wob = Math.sin(time * 4 + q.ph) * 0.35;
      const off = (q.off * 0.5 + wob) * spread;
      const x = pt.x - tan.y * off, y = pt.y + tan.x * off;
      const fade = Math.min(1, q.t * 8, (1 - q.t) * 8);
      drawParticle(l.resource, R.color, x, y, q.r * (q.mult > 1 ? 1.25 : 1), fade * dim, q.ph, tan);
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  function drawParticle(kind, color, x, y, r, a, ph, tan) {
    ctx.globalAlpha = a * 0.28; ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, r * 2.4, 0, 6.28); ctx.fill();
    ctx.globalAlpha = a;
    if (kind === 'attention') {
      ctx.save(); ctx.translate(x, y); ctx.rotate(Math.atan2(tan.y, tan.x));
      ctx.beginPath(); ctx.ellipse(0, 0, r * 1.7, r * 0.95, 0, 0, 6.28); ctx.fill();
      ctx.globalAlpha = a * 0.9; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, r * 0.5, 0, 6.28); ctx.fill();
      ctx.restore();
    } else if (kind === 'money') {
      ctx.beginPath(); ctx.arc(x, y, r * 1.15, 0, 6.28); ctx.fill();
      ctx.globalAlpha = a * 0.8; ctx.strokeStyle = '#fff3c4'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.arc(x, y, r * 0.65, 0, 6.28); ctx.stroke();
    } else if (kind === 'customers') {
      ctx.beginPath(); ctx.arc(x, y - r * 0.55, r * 0.75, 0, 6.28); ctx.fill();
      ctx.beginPath(); ctx.arc(x, y + r * 0.95, r * 1.15, Math.PI, 0); ctx.fill();
    } else {
      const s = r * 1.5 + Math.sin(time * 6 + ph) * 0.5;
      ctx.beginPath();
      ctx.moveTo(x, y - s * 1.3); ctx.lineTo(x + s * 0.35, y - s * 0.35); ctx.lineTo(x + s * 1.3, y); ctx.lineTo(x + s * 0.35, y + s * 0.35);
      ctx.lineTo(x, y + s * 1.3); ctx.lineTo(x - s * 0.35, y + s * 0.35); ctx.lineTo(x - s * 1.3, y); ctx.lineTo(x - s * 0.35, y - s * 0.35);
      ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawFlowLabel(l) {
    const v = pipes.get(l.id), o = snap()?.links[l.id];
    if (!v?.geom || !o) return;
    const active = hover?.type === 'link' && hover.id === l.id || S.selection?.type === 'link' && S.selection.id === l.id
      || (hover?.type === 'node' && (hover.id === l.from || hover.id === l.to)) || (S.selection?.type === 'project' && (S.selection.id === l.from || S.selection.id === l.to));
    if (!active) return;
    const m = quad(v.geom.p0, v.geom.c, v.geom.p2, 0.5);
    const R = RESOURCES[l.resource];
    const text = l.resource === 'money' ? `TZS ${fmtNum(o.amount)}/d` : l.resource === 'attention' ? `${fmtNum(o.amount)} views/d`
      : l.resource === 'customers' ? `${fmtNum(o.amount)} cust/d` : `${Math.round(o.amount * 100)}% energy`;
    ctx.font = `600 11px ${TEXT_FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + 12;
    ctx.fillStyle = 'rgba(12,11,10,0.86)';
    ctx.beginPath(); rr(ctx, m.x - w / 2, m.y - 10, w, 20, 10); ctx.fill();
    ctx.strokeStyle = R.color; ctx.globalAlpha = 0.7; ctx.lineWidth = 1; ctx.stroke(); ctx.globalAlpha = 1;
    ctx.fillStyle = R.color;
    ctx.fillText(text, m.x, m.y + 0.5);
  }

  function drawNode(p) {
    const v = nodeVis(p), s = nodeInfo(p);
    const kind = KINDS[p.kind] || KINDS.custom;
    const color = p.color || kind.color;
    const shape = kind.shape;
    const r = v.size;
    const sh = SHAPES[shape];
    const w = sh.w * r, h = sh.h * r;
    const status = s.status;
    const sel = S.selection?.type === 'project' && S.selection.id === p.id;
    const hov = hover?.type === 'node' && hover.id === p.id;
    const dying = status === 'dying';
    const shake = dying ? Math.sin(time * 38 + v.phase) * 1.3 : 0;
    const dimmed = (S.selection?.type === 'project' && !sel) || (S.selection?.type === 'link') ? 0.82 : 1;

    ctx.save();
    ctx.translate(p.x + shake, p.y);
    ctx.globalAlpha = dimmed;

    // glow
    const glow = STATUS_COLOR[status];
    const breathe = status === 'thriving' ? 0.5 + 0.5 * Math.sin(time * 2 + v.phase) : dying ? 0.5 + 0.5 * Math.sin(time * 9) : 0.35;
    const gg = ctx.createRadialGradient(0, 0, r * 0.6, 0, 0, r * 2.3);
    gg.addColorStop(0, hexA(glow, (0.12 + 0.16 * breathe) * (0.5 + s.health / 200)));
    gg.addColorStop(1, hexA(glow, 0));
    ctx.fillStyle = gg;
    ctx.beginPath(); ctx.arc(0, 0, r * 2.3, 0, 6.28); ctx.fill();

    // body
    shapePath(ctx, shape, r);
    ctx.fillStyle = 'rgba(17,16,15,0.94)';
    ctx.fill();
    ctx.save();
    shapePath(ctx, shape, r);
    ctx.clip();
    // liquid
    const level = clamp(v.health / 100, 0.03, 1);
    const top = h / 2 - level * h;
    const dead = clamp((50 - v.health) / 50, 0, 1);
    const lc = mixHex(color, '#5a3038', dead * 0.85);
    const liq = ctx.createLinearGradient(0, top, 0, h / 2);
    liq.addColorStop(0, hexA(lc, 0.55));
    liq.addColorStop(1, hexA(mixHex(lc, '#000000', 0.35), 0.92));
    const amp = 2.4 * (0.3 + level * 0.7);
    for (let pass = 0; pass < 2; pass++) {
      ctx.beginPath();
      ctx.moveTo(-w / 2 - 4, h / 2 + 4);
      for (let x = -w / 2 - 4; x <= w / 2 + 4; x += 5) ctx.lineTo(x, top + Math.sin(x * 0.09 + time * (2.1 + pass * 0.7) + v.phase + pass * 1.7) * amp);
      ctx.lineTo(w / 2 + 4, h / 2 + 4);
      ctx.closePath();
      ctx.fillStyle = pass ? hexA(lc, 0.35) : liq;
      ctx.fill();
    }
    // bubbles
    if (v.health > 35) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      for (let i = 0; i < 4; i++) {
        const t = (time * 0.18 + i * 0.27 + v.phase) % 1;
        const bx = Math.sin(v.phase * 3 + i * 2.1) * w * 0.3 + Math.sin(time * 2 + i) * 3;
        const by = h / 2 - t * (h * level);
        ctx.beginPath(); ctx.arc(bx, by, 1.4 + (i % 2), 0, 6.28); ctx.fill();
      }
    }
    // cracks when drying out
    if (v.health < 50) {
      ctx.strokeStyle = `rgba(0,0,0,${0.55 * dead + 0.1})`;
      ctx.lineWidth = 1.6;
      for (const pts of v.cracks) {
        ctx.beginPath();
        pts.forEach(([x, y], i) => ctx[i ? 'lineTo' : 'moveTo'](x * w * 0.5, y * h * 0.5));
        ctx.stroke();
      }
    }
    // glass sheen
    const sheen = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
    sheen.addColorStop(0, 'rgba(255,255,255,0.10)'); sheen.addColorStop(0.35, 'rgba(255,255,255,0)');
    ctx.fillStyle = sheen; ctx.fillRect(-w / 2, -h / 2, w, h);
    if (shape === 'browser') { ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fillRect(-w / 2, -h / 2, w, 13); }
    ctx.restore();

    // border
    shapePath(ctx, shape, r);
    ctx.lineWidth = sel ? 4 : hov ? 3.5 : 2.6;
    ctx.strokeStyle = status === 'thriving' || status === 'steady' ? mixHex(color, '#ffffff', 0.25) : glow;
    if (dying) ctx.globalAlpha = dimmed * (0.55 + 0.45 * Math.abs(Math.sin(time * 7)));
    ctx.stroke();
    ctx.globalAlpha = dimmed;
    if (v.flash > 0) { ctx.lineWidth = 6; ctx.strokeStyle = hexA('#ffffff', v.flash * 0.9); ctx.stroke(); }
    if (sel) {
      shapePath(ctx, shape, r * 1.13);
      ctx.setLineDash([7, 7]); ctx.lineDashOffset = -time * 14; ctx.lineWidth = 1.6; ctx.strokeStyle = '#fff'; ctx.globalAlpha = 0.85; ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = dimmed;
    }

    // icon
    ctx.font = `${Math.round(r * (shape === 'phone' ? 0.72 : 0.86))}px ${EMOJI_FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.globalAlpha = dimmed * (dying ? 0.65 : 1);
    ctx.fillText(p.icon || kind.icon, 0, shape === 'browser' ? 5 : 1);
    ctx.globalAlpha = dimmed;

    // badges
    if (status === 'thirsty') {
      const bob = Math.sin(time * 4) * 2;
      badge(w / 2 - 6, -h / 2 + 4 + bob, '💧', '#ffb84d');
    } else if (dying) {
      const sc = 1 + 0.15 * Math.abs(Math.sin(time * 6));
      ctx.save(); ctx.translate(w / 2 - 4, -h / 2 + 4); ctx.scale(sc, sc);
      ctx.beginPath(); ctx.arc(0, 0, 13, 0, 6.28); ctx.fillStyle = '#ff4d5e'; ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = `800 17px ${TEXT_FONT}`; ctx.fillText('!', 0, 1);
      ctx.restore();
    } else if (s.boost > 0.3) {
      badge(w / 2 - 6, -h / 2 + 4, '🔥', '#ff9a3c');
    }

    // labels
    const ly = h / 2 + 18;
    ctx.font = `700 15px ${TEXT_FONT}`;
    ctx.lineJoin = 'round'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(12,11,10,0.95)';
    ctx.strokeText(p.name, 0, ly);
    ctx.fillStyle = '#f5f1ea';
    ctx.fillText(p.name, 0, ly);
    const parts = [];
    if (s.money > 0.5) parts.push({ t: `TZS ${fmtNum(s.money)}`, c: RESOURCES.money.color });
    if (s.attention > 0.5) parts.push({ t: `👁 ${fmtNum(s.attention)}`, c: RESOURCES.attention.color });
    if (s.customers >= 0.05) parts.push({ t: `👤 ${fmtNum(s.customers)}`, c: RESOURCES.customers.color });
    ctx.font = `600 11.5px ${TEXT_FONT}`;
    const gap = 10;
    const widths = parts.map((q) => ctx.measureText(q.t).width);
    let x = -(widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, parts.length - 1)) / 2;
    parts.forEach((q, i) => {
      ctx.textAlign = 'left';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(12,11,10,0.95)'; ctx.strokeText(q.t, x, ly + 17);
      ctx.fillStyle = q.c; ctx.fillText(q.t, x, ly + 17);
      x += widths[i] + gap;
    });
    ctx.textAlign = 'center';
    ctx.font = `700 11px ${TEXT_FONT}`;
    ctx.fillStyle = STATUS_COLOR[status];
    ctx.strokeText(`${Math.round(v.health)}% · ${status}`, 0, ly + 33);
    ctx.fillText(`${Math.round(v.health)}% · ${status}`, 0, ly + 33);
    ctx.restore();
  }
  function badge(x, y, emoji, color) {
    ctx.beginPath(); ctx.arc(x, y, 13, 0, 6.28);
    ctx.fillStyle = 'rgba(15,14,13,0.95)'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = color; ctx.stroke();
    ctx.font = `13px ${EMOJI_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText(emoji, x, y + 1);
  }

  function draw() {
    drawBackground();
    worldTransform();
    for (const l of S.world.links) drawPipe(l);
    for (const l of S.world.links) drawParticles(l);
    for (const r of rings) {
      ctx.globalAlpha = Math.max(0, r.life) * 0.5; ctx.strokeStyle = r.color; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, 6.28); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (const s of smoke) {
      ctx.globalAlpha = Math.max(0, s.life) * 0.28; ctx.fillStyle = '#a8a29a';
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.28); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // nodes (selected/hovered on top)
    const order = [...projects()].sort((a, b) => Number(isTop(a)) - Number(isTop(b)));
    for (const p of order) drawNode(p);
    for (const l of S.world.links) drawFlowLabel(l);
    if (S.tool === 'link' && linkFrom) {
      const a = project(linkFrom);
      if (a) {
        ctx.setLineDash([8, 8]); ctx.lineDashOffset = -time * 20; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.globalAlpha = 0.8;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(pointerWorld.x, pointerWorld.y); ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 1;
      }
    }
    for (const f of floaters) {
      ctx.globalAlpha = clamp(f.life * 1.5, 0, 1);
      ctx.font = `800 ${f.size || 17}px ${TEXT_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(12,11,10,0.95)'; ctx.lineJoin = 'round';
      ctx.strokeText(f.text, f.x, f.y); ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
    // future overlay
    if (S.offset > 0) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = 'rgba(255,120,50,0.05)'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(255,190,140,0.045)';
      const off = (time * 20) % 6;
      for (let y = off; y < H; y += 6) ctx.fillRect(0, y, W, 1);
    }
  }
  const isTop = (p) => (S.selection?.type === 'project' && S.selection.id === p.id) || (hover?.type === 'node' && hover.id === p.id);

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!S.sim || !W) return;
    update(dt);
    draw();
  }
  raf = requestAnimationFrame(frame);

  // ---------- hit testing ----------
  function hitNode(wx, wy) {
    const list = [...projects()].reverse();
    for (const p of list) {
      const v = nodeVis(p);
      const sh = SHAPES[(KINDS[p.kind] || KINDS.custom).shape];
      if (Math.abs(wx - p.x) <= (sh.w * v.size) / 2 + 6 && Math.abs(wy - p.y) <= (sh.h * v.size) / 2 + 6) return p;
    }
    return null;
  }
  function hitLink(wx, wy) {
    let best = null, bestD = Infinity;
    for (const l of S.world.links) {
      const v = pipes.get(l.id);
      if (!v?.geom) continue;
      for (let i = 0; i <= 20; i++) {
        const q = quad(v.geom.p0, v.geom.c, v.geom.p2, i / 20);
        const d = Math.hypot(q.x - wx, q.y - wy);
        if (d < bestD) { bestD = d; best = l; }
      }
    }
    return best && bestD <= Math.max(11, 9 / cam.k) ? best : null;
  }

  // ---------- input ----------
  const setCursor = (c) => { canvas.style.cursor = c; };
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const pt = canvasPoint(e);
    pointers.set(e.pointerId, pt);
    camTarget.active = false;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: cam.k };
      drag = null; pan = null;
      return;
    }
    const w = toWorld(pt.x, pt.y);
    const node = hitNode(w.x, w.y);
    if (S.tool === 'link') {
      if (node) {
        if (!linkFrom) { linkFrom = node.id; hooks.onToolHint?.('Now click the project it feeds'); }
        else if (node.id !== linkFrom) { const from = linkFrom; linkFrom = null; hooks.onLinkPicked?.(from, node.id); }
      } else { linkFrom = null; }
      return;
    }
    if (node) { drag = { id: node.id, dx: node.x - w.x, dy: node.y - w.y, moved: false, sx: pt.x, sy: pt.y }; setCursor('grabbing'); return; }
    const link = hitLink(w.x, w.y);
    if (link) { hooks.onSelect?.({ type: 'link', id: link.id }); return; }
    pan = { sx: pt.x, sy: pt.y, cx: cam.x, cy: cam.y, moved: false };
    setCursor('grabbing');
  });
  canvas.addEventListener('pointermove', (e) => {
    const pt = canvasPoint(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, pt);
    const w = toWorld(pt.x, pt.y);
    pointerWorld = w;
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      cam.k = clamp(pinch.k * (d / pinch.d), 0.25, 2.5);
      return;
    }
    if (drag) {
      if (!drag.moved && Math.hypot(pt.x - drag.sx, pt.y - drag.sy) > 4) drag.moved = true;
      if (drag.moved) hooks.onMoved?.(drag.id, w.x + drag.dx, w.y + drag.dy);
      return;
    }
    if (pan) {
      const dx = pt.x - pan.sx, dy = pt.y - pan.sy;
      if (Math.hypot(dx, dy) > 3) pan.moved = true;
      cam.x = pan.cx - dx / cam.k; cam.y = pan.cy - dy / cam.k;
      return;
    }
    const node = hitNode(w.x, w.y);
    const link = node ? null : hitLink(w.x, w.y);
    const next = node ? { type: 'node', id: node.id } : link ? { type: 'link', id: link.id } : null;
    if (next?.id !== hover?.id || next?.type !== hover?.type) { hover = next; hooks.onHover?.(next, e.clientX, e.clientY); }
    else if (next) hooks.onHover?.(next, e.clientX, e.clientY);
    setCursor(S.tool === 'link' ? 'crosshair' : next ? 'pointer' : 'grab');
  });
  const end = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (drag) {
      if (!drag.moved) hooks.onSelect?.({ type: 'project', id: drag.id });
      drag = null;
    } else if (pan) {
      if (!pan.moved) hooks.onSelect?.(null);
      pan = null;
    }
    setCursor(S.tool === 'link' ? 'crosshair' : 'grab');
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', () => { if (hover) { hover = null; hooks.onHover?.(null); } });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const pt = canvasPoint(e);
    const before = toWorld(pt.x, pt.y);
    cam.k = clamp(cam.k * Math.exp(-e.deltaY * 0.0016), 0.25, 2.5);
    cam.x = before.x - (pt.x - W / 2) / cam.k;
    cam.y = before.y - (pt.y - H / 2) / cam.k;
    camTarget.active = false;
  }, { passive: false });
  canvas.addEventListener('dblclick', (e) => {
    const pt = canvasPoint(e);
    const w = toWorld(pt.x, pt.y);
    if (!hitNode(w.x, w.y) && !hitLink(w.x, w.y)) hooks.onAddAt?.(Math.round(w.x), Math.round(w.y));
  });

  const offTool = on('tool', () => { linkFrom = null; setCursor(S.tool === 'link' ? 'crosshair' : 'grab'); });

  // ---------- public api ----------
  function fit({ animate = true, focusId } = {}) {
    const list = projects();
    if (!list.length) { Object.assign(camTarget, { x: 0, y: 0, k: 1, active: true }); return; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of list) { x0 = Math.min(x0, p.x - 150); x1 = Math.max(x1, p.x + 150); y0 = Math.min(y0, p.y - 170); y1 = Math.max(y1, p.y + 170); }
    const k = clamp(Math.min(W / (x1 - x0), H / (y1 - y0)), 0.3, 1.25);
    const t = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 - 20, k };
    if (animate) Object.assign(camTarget, t, { active: true }); else Object.assign(cam, t);
  }
  function focus(id) {
    const p = project(id);
    if (!p) return;
    Object.assign(camTarget, { x: p.x, y: p.y, k: Math.max(cam.k, 0.9), active: true });
  }
  function zoomBy(f) {
    Object.assign(camTarget, { x: cam.x, y: cam.y, k: clamp(cam.k * f, 0.25, 2.5), active: true });
  }

  // A completed task sends a wave down every pipe it was aimed at.
  function burst(task) {
    const p = project(task.projectId);
    if (!p) return;
    const v = nodeVis(p);
    v.flash = 1;
    rings.push({ x: p.x, y: p.y, r: v.size, life: 1, color: '#ffffff', speed: 150 }, { x: p.x, y: p.y, r: v.size, life: 1, color: p.color || KINDS[p.kind]?.color, speed: 90 });
    const q = clamp(task.quality || 3, 1, 5) / 3;
    const aimed = (task.targets || []);
    for (const l of S.world.links.filter((x) => x.from === p.id)) {
      const pv = pipeVis(l);
      const hit = aimed.length ? aimed.includes(l.to) : true;
      if (l.resource === 'money' && !task.reward) continue;
      if (!hit) continue;
      pv.flash = 1;
      const n = Math.round((aimed.length ? 16 : 7) * q);
      for (let i = 0; i < n; i++) pv.parts.push({ t: -i * 0.012, off: (Math.random() - 0.5) * 2, r: 2.6 + Math.random() * 1.6, mult: 2.4 + Math.random() * 0.8, ph: Math.random() * 6.28 });
    }
    const type = TASK_TYPES[task.type] || TASK_TYPES.other;
    floaters.push({ x: p.x, y: p.y - v.size - 12, text: `${type.icon} +water`, color: '#ffd08a', life: 1.4, size: 16 });
    if (task.reward > 0) floaters.push({ x: p.x, y: p.y - v.size - 36, text: `+TZS ${fmtNum(task.reward)}`, color: RESOURCES.money.color, life: 1.7, size: 20 });
  }
  function floatText(id, text, color) {
    const p = project(id);
    if (p) floaters.push({ x: p.x, y: p.y - nodeVis(p).size - 12, text, color, life: 1.4 });
  }
  function screenPos(id) {
    const p = project(id);
    if (!p) return null;
    const r = canvas.getBoundingClientRect();
    return { x: r.left + (p.x - cam.x) * cam.k + W / 2, y: r.top + (p.y - cam.y) * cam.k + H / 2 };
  }
  function destroy() { cancelAnimationFrame(raf); ro.disconnect(); offTool(); }

  return { fit, focus, zoomBy, burst, floatText, screenPos, destroy, resize, get camera() { return { ...cam }; } };
}

// ---------- color utils ----------
function parseHex(h) {
  let s = String(h || '#888888').replace('#', '');
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  const n = parseInt(s.slice(0, 6), 16);
  return Number.isNaN(n) ? [136, 136, 136] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function hexA(hex, a) { const [r, g, b] = parseHex(hex); return `rgba(${r},${g},${b},${clamp(a, 0, 1)})`; }
function mixHex(a, b, t) {
  const A = parseHex(a), B = parseHex(b);
  return '#' + A.map((v, i) => Math.round(lerp(v, B[i], t)).toString(16).padStart(2, '0')).join('');
}
