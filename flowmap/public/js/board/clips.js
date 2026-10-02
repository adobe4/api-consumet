// Clips that hold paper down: a wire paperclip, a binder clip, a push pin and a strip of tape. Drawn as SVG
// with metal or plastic shading and a soft shadow, so they look real on a dot, grid or plain floor.
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.append(e);
  return e;
};

// light, mid, shine, dark
const METALS = {
  silver: ['#fbfcfd', '#a3aaaf', '#e8ebed', '#5f666b'],
  gold: ['#fff4cc', '#c9982b', '#f6d878', '#7d5a12'],
  copper: ['#ffd9bf', '#b8653a', '#f2ab80', '#6e3418'],
  black: ['#7a7a7a', '#222222', '#555555', '#050505'],
};
export const CLIP_DEFAULT = {
  paperclip: { metal: 'silver', color: '#ff8a5c' },
  binder: { metal: 'black', color: '#e07a5f' },
  pin: { metal: 'color', color: '#ff4d5e' },
  tape: { metal: 'color', color: '#f3e3b3' },
};
export const CLIP_LABEL = { paperclip: 'Paperclip', binder: 'Binder clip', pin: 'Push pin', tape: 'Tape' };
export const METAL_LABEL = { silver: 'Silver', gold: 'Gold', copper: 'Copper', black: 'Black', color: 'Colour' };

function hexRgb(hex) {
  let h = String(hex || '').replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [255, 138, 92];
}
// t > 0 towards white, t < 0 towards black
const shade = (hex, t) => `rgb(${hexRgb(hex).map((c) => Math.round(t > 0 ? c + (255 - c) * t : c * (1 + t))).join(',')})`;
const tones = (metal, color) => METALS[metal] || [shade(color, 0.55), color, shade(color, 0.3), shade(color, -0.45)];

function grad(defs, id, stops, { x2 = 1, y2 = 0 } = {}) {
  const g = el('linearGradient', { id, x1: 0, y1: 0, x2, y2 }, defs);
  stops.forEach(([o, c, a = 1]) => el('stop', { offset: o, 'stop-color': c, 'stop-opacity': a }, g));
  return `url(#${id})`;
}

// a gem clip: inner leg, small bottom turn, top turn, long outer leg, big bottom turn, short outer leg
const GEM = 'M13 34 V86 A7 7 0 0 0 27 86 V16 A11 11 0 0 0 5 16 V94 A15 15 0 0 0 35 94 V28';

export function clipSvg(it) {
  const d = it.data || {};
  const kind = CLIP_DEFAULT[d.kind] ? d.kind : 'paperclip';
  const metal = d.metal || CLIP_DEFAULT[kind].metal;
  const color = it.color || CLIP_DEFAULT[kind].color;
  const [lt, mid, shine, dk] = tones(metal, color);
  const uid = `cl${String(it.id).replace(/[^\w-]/g, '')}`;
  const svg = el('svg', { class: `clip-svg ck-${kind}`, 'aria-hidden': 'true' });
  const defs = el('defs', {}, svg);

  if (kind === 'paperclip') {
    svg.setAttribute('viewBox', '0 0 40 112'); svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    const body = grad(defs, `${uid}b`, [[0, dk], [0.35, mid], [0.55, lt], [0.75, mid], [1, dk]]);
    el('path', { d: GEM, fill: 'none', stroke: dk, 'stroke-width': 3.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: 0.55 }, svg);
    el('path', { d: GEM, fill: 'none', stroke: body, 'stroke-width': 2.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, svg);
    el('path', { d: GEM, fill: 'none', stroke: shine, 'stroke-width': 0.9, 'stroke-linecap': 'round', opacity: 0.9, transform: 'translate(-0.6,-0.5)' }, svg);
  } else if (kind === 'binder') {
    svg.setAttribute('viewBox', '0 0 96 86'); svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    const wire = METALS.silver;
    const handle = grad(defs, `${uid}h`, [[0, wire[3]], [0.4, wire[0]], [0.6, wire[2]], [1, wire[3]]]);
    // the two wire handles folded up over the paper
    for (const path of ['M30 44 L24 8 Q23 3 28 3 L68 3 Q73 3 72 8 L66 44', 'M36 44 L31 14 Q30 10 34 10 L62 10 Q66 10 65 14 L60 44']) {
      el('path', { d: path, fill: 'none', stroke: wire[3], 'stroke-width': 3.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: 0.45 }, svg);
      el('path', { d: path, fill: 'none', stroke: handle, 'stroke-width': 2.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, svg);
    }
    const body = grad(defs, `${uid}p`, [[0, shine], [0.18, mid], [0.7, dk], [1, dk]], { x2: 0, y2: 1 });
    el('path', { d: 'M12 40 Q12 36 16 36 L80 36 Q84 36 84 40 L91 80 Q92 84 87 84 L9 84 Q4 84 5 80 Z', fill: body, stroke: dk, 'stroke-width': 1 }, svg);
    el('path', { d: 'M16 41 L80 41', stroke: lt, 'stroke-width': 1.6, 'stroke-linecap': 'round', opacity: 0.55 }, svg);
    for (const x of [16, 80]) el('ellipse', { cx: x, cy: 44, rx: 3.2, ry: 4.2, fill: wire[1], stroke: wire[3], 'stroke-width': 0.8 }, svg);
  } else if (kind === 'pin') {
    svg.setAttribute('viewBox', '0 0 54 62'); svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    const rg = el('radialGradient', { id: `${uid}r`, cx: 0.38, cy: 0.32, r: 0.75 }, defs);
    [[0, lt], [0.45, mid], [1, dk]].forEach(([o, c]) => el('stop', { offset: o, 'stop-color': c }, rg));
    el('path', { d: 'M27 40 L29 58', stroke: '#9aa1a6', 'stroke-width': 2, 'stroke-linecap': 'round', opacity: 0.6 }, svg);
    el('ellipse', { cx: 27, cy: 30, rx: 15, ry: 9, fill: dk, opacity: 0.9 }, svg);
    el('circle', { cx: 27, cy: 22, r: 18, fill: `url(#${uid}r)` }, svg);
    el('circle', { cx: 27, cy: 21, r: 10, fill: shine, opacity: 0.35 }, svg);
    el('ellipse', { cx: 21, cy: 14, rx: 6, ry: 3.6, fill: '#ffffff', opacity: 0.7, transform: 'rotate(-28 21 14)' }, svg);
  } else {
    // tape: a translucent strip with torn ends
    svg.setAttribute('viewBox', '0 0 168 46'); svg.setAttribute('preserveAspectRatio', 'none');
    const tape = grad(defs, `${uid}t`, [[0, shade(color, 0.25), 0.82], [0.5, color, 0.7], [1, shade(color, -0.12), 0.82]], { x2: 0, y2: 1 });
    const torn = 'M4 3 L10 7 L5 12 L11 17 L5 23 L11 29 L5 35 L10 40 L4 44 L164 43 L158 38 L163 33 L157 27 L163 21 L157 15 L163 9 L158 5 L164 2 Z';
    el('path', { d: torn, fill: tape }, svg);
    el('path', { d: 'M10 8 L158 7', stroke: '#ffffff', 'stroke-width': 2, opacity: 0.35 }, svg);
    for (let x = 22; x < 150; x += 18) el('path', { d: `M${x} 6 L${x - 6} 40`, stroke: '#ffffff', 'stroke-width': 0.6, opacity: 0.18 }, svg);
  }
  return svg;
}
