// A picture of part of a board, drawn onto a canvas, so a vision-capable AI can see how a section really
// looks: positions, colours, paper, text sizes and wrapping, overflow and overlaps. Not a pixel copy of the
// DOM (that would need every stylesheet inlined), but faithful in the ways that matter for layout.
import { FONT_PX } from '/shared/board.js';

const INK = '#1c1916', FACE = '#f3eee6', FLOOR = '#ebe5dc';
function rgb(hex) {
  let h = String(hex || '').replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [255, 138, 92];
}
const mix = (a, b, t) => { const A = rgb(a), B = rgb(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`; };
const isDark = (hex) => { const [r, g, b] = rgb(hex); return r * 0.3 + g * 0.59 + b * 0.11 < 110; };

function roundRect(c, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
function shapePath(c, kind, x, y, w, h, radius) {
  const P = (pts) => { c.beginPath(); pts.forEach(([px, py], i) => (i ? c.lineTo(x + px * w, y + py * h) : c.moveTo(x + px * w, y + py * h))); c.closePath(); };
  switch (kind) {
    case 'ellipse': c.beginPath(); c.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); return;
    case 'pill': return roundRect(c, x, y, w, h, h / 2);
    case 'rect': return roundRect(c, x, y, w, h, radius ?? 4);
    case 'diamond': return P([[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]]);
    case 'triangle': return P([[0.5, 0.02], [0.98, 0.97], [0.02, 0.97]]);
    case 'hexagon': return P([[0.25, 0.02], [0.75, 0.02], [0.98, 0.5], [0.75, 0.98], [0.25, 0.98], [0.02, 0.5]]);
    case 'arrow': return P([[0, 0.32], [0.6, 0.32], [0.6, 0.04], [1, 0.5], [0.6, 0.96], [0.6, 0.68], [0, 0.68]]);
    case 'star': { const pts = []; for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.22 : 0.5, a = (i / 10) * Math.PI * 2 - Math.PI / 2; pts.push([0.5 + Math.cos(a) * r, 0.52 + Math.sin(a) * r]); } return P(pts); }
    case 'bubble': roundRect(c, x, y, w, h * 0.74, Math.min(18, h * 0.2)); c.moveTo(x + w * 0.42, y + h * 0.72); c.lineTo(x + w * 0.2, y + h * 0.97); c.lineTo(x + w * 0.26, y + h * 0.72); return;
    default: return roundRect(c, x, y, w, h, radius ?? 18);
  }
}
function wrap(c, text, maxW) {
  const out = [];
  for (const para of String(text || '').split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(''); continue; }
    let line = '';
    for (const w of words) {
      const t = line ? `${line} ${w}` : w;
      if (c.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t;
    }
    out.push(line);
  }
  return out;
}
const fontPx = (it) => (typeof it.style?.size === 'number' ? it.style.size : FONT_PX[it.style?.font || (it.type === 'text' ? 'l' : 'm')] || 14.5);
const fontOf = (it, px, bold) => `${bold ? 800 : it.type === 'note' ? 650 : 500} ${px}px ${it.style?.hand ? '"Caveat", cursive' : 'Manrope, system-ui, sans-serif'}`;
// draw text in a box; it is allowed to spill, so the picture shows text that does not fit
function textBox(c, it, text, x, y, w, h, { color, align, valign = 'middle', bold, px = fontPx(it) } = {}) {
  if (!text) return;
  c.font = fontOf(it, px, bold ?? (it.style?.weight >= 700 || it.type === 'text'));
  c.fillStyle = color; c.textBaseline = 'alphabetic';
  const lh = px * (it.style?.hand ? 1.15 : 1.32);
  const lines = wrap(c, text, Math.max(10, w));
  const total = lines.length * lh;
  let ty = valign === 'top' ? y + px : valign === 'bottom' ? y + h - total + px : y + (h - total) / 2 + px * 0.92;
  const al = align || it.style?.align || 'center';
  c.textAlign = al === 'left' ? 'left' : al === 'right' ? 'right' : 'center';
  const tx = al === 'left' ? x : al === 'right' ? x + w : x + w / 2;
  for (const l of lines) { c.fillText(l, tx, ty); ty += lh; }
}
const fillOf = (it, base) => {
  const f = it.style?.finish || (it.type === 'shape' ? 'solid' : it.type === 'note' ? 'tinted' : it.type === 'text' || it.type === 'sticker' ? 'none' : 'soft');
  const col = it.color || base;
  return f === 'solid' ? col : f === 'tinted' ? mix(col, FACE, 0.72) : f === 'none' ? null : f === 'glass' ? 'rgba(255,255,255,0.55)' : f === 'flat' ? FLOOR : FACE;
};
const PAPER = { sticky: null, lined: '#fbf7ee', spiral: '#fbf7ee', grid: '#f7faf4', index: '#fffdf8', kraft: '#c9a273', torn: '#fbf7ee', aged: '#efdcb0' };

function drawItem(c, it) {
  const { x, y, w, h } = it;
  const d = it.data || {};
  const tc = it.style?.textColor || INK;
  c.save();
  if (it.rot) { c.translate(x + w / 2, y + h / 2); c.rotate((it.rot * Math.PI) / 180); c.translate(-(x + w / 2), -(y + h / 2)); }
  const shadow = (blur = 14, oy = 6, a = 0.18) => { c.shadowColor = `rgba(40,28,16,${a})`; c.shadowBlur = blur; c.shadowOffsetY = oy; };
  const noShadow = () => { c.shadowColor = 'transparent'; c.shadowBlur = 0; c.shadowOffsetY = 0; };
  switch (it.type) {
    case 'frame': {
      shadow(30, 10, 0.12); roundRect(c, x, y, w, h, it.style?.radius ?? 28);
      c.fillStyle = it.style?.finish === 'tinted' ? mix(it.color || '#ff8a5c', FACE, 0.8) : FACE; c.fill(); noShadow();
      c.font = '700 13px Manrope, sans-serif'; c.fillStyle = '#8a7b6d'; c.textAlign = 'left'; c.fillText(String(it.title || '').toUpperCase().slice(0, 60), x + 26, y + 30);
      break;
    }
    case 'note': {
      const paper = d.paper || 'sticky';
      shadow(d.lift === 'flat' ? 3 : 14, d.lift === 'flat' ? 1 : 7, 0.22);
      c.beginPath(); c.rect(x, y, w, h); c.fillStyle = paper === 'sticky' ? it.color || '#ffd54a' : PAPER[paper]; c.fill(); noShadow();
      if (['lined', 'spiral', 'index'].includes(paper)) { c.strokeStyle = 'rgba(122,92,62,0.25)'; c.lineWidth = 1; const px = fontPx(it) * 1.7; for (let ly = y + 20 + px; ly < y + h; ly += px) { c.beginPath(); c.moveTo(x, ly); c.lineTo(x + w, ly); c.stroke(); } if (paper !== 'index') { c.strokeStyle = 'rgba(214,78,62,0.55)'; c.beginPath(); c.moveTo(x + 34, y); c.lineTo(x + 34, y + h); c.stroke(); } }
      if (paper === 'grid') { c.strokeStyle = 'rgba(122,92,62,0.16)'; for (let gx = x; gx < x + w; gx += 18) { c.beginPath(); c.moveTo(gx, y); c.lineTo(gx, y + h); c.stroke(); } for (let gy = y; gy < y + h; gy += 18) { c.beginPath(); c.moveTo(x, gy); c.lineTo(x + w, gy); c.stroke(); } }
      const left = ['lined', 'spiral', 'index', 'grid'].includes(paper);
      textBox(c, it, it.text, x + (left ? 46 : 18), y + 20, w - (left ? 64 : 36), h - 40, { color: paper === 'kraft' ? '#2e1f10' : '#2b2118', align: left ? 'left' : it.style?.align, valign: left ? 'top' : 'middle', bold: it.style?.weight >= 700 });
      if (d.pin === 'pin') { c.fillStyle = '#ff4d5e'; c.beginPath(); c.arc(x + w / 2, y + 4, 10, 0, Math.PI * 2); c.fill(); }
      if (d.pin === 'tape') { c.fillStyle = 'rgba(243,227,179,0.85)'; c.fillRect(x + w / 2 - 46, y - 12, 92, 26); }
      if (d.pin === 'clip') { c.strokeStyle = '#9aa1a6'; c.lineWidth = 3; roundRect(c, x + w - 46, y - 20, 22, 66, 11); c.stroke(); }
      break;
    }
    case 'text': textBox(c, it, it.text, x + 6, y, w - 12, h, { color: it.style?.muted ? '#8a7b6d' : tc, align: it.style?.align || 'left', bold: it.style?.weight >= 700 }); break;
    case 'shape': {
      const fill = fillOf(it, '#ff8a5c');
      shadow(it.style?.shadow === 'flat' ? 0 : 12, 5, 0.16); shapePath(c, d.shape || 'round', x, y, w, h, it.style?.radius);
      if (fill) { c.fillStyle = fill; c.fill(); }
      noShadow();
      textBox(c, it, it.text, x + 12, y + 8, w - 24, h - 16, { color: it.style?.textColor || (fill && fill.startsWith('#') && isDark(fill) ? '#ffffff' : INK), bold: it.style?.weight >= 700 || true });
      break;
    }
    case 'sticker': {
      const t = it.text || 'i:star';
      c.fillStyle = mix(it.color || '#ff8a5c', FACE, 0.55); c.beginPath(); c.arc(x + w / 2, y + h / 2, Math.min(w, h) * 0.42, 0, Math.PI * 2); c.fill();
      c.strokeStyle = it.color || '#ff8a5c'; c.lineWidth = Math.max(3, w * 0.06); c.stroke();
      c.font = `800 ${Math.round(Math.min(w, h) * 0.24)}px Manrope, sans-serif`; c.fillStyle = INK; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(t.startsWith('i:') ? t.slice(2, 10) : t, x + w / 2, y + h / 2); c.textBaseline = 'alphabetic';
      break;
    }
    case 'clip': {
      c.strokeStyle = d.metal === 'gold' ? '#c9982b' : d.metal === 'black' ? '#222' : d.metal === 'color' ? it.color || '#ff4d5e' : '#a3aaaf';
      c.lineWidth = 3;
      if (d.kind === 'pin') { c.fillStyle = it.color || '#ff4d5e'; c.beginPath(); c.arc(x + w / 2, y + h * 0.36, Math.min(w, h) * 0.34, 0, Math.PI * 2); c.fill(); }
      else if (d.kind === 'tape') { c.fillStyle = 'rgba(243,227,179,0.85)'; c.fillRect(x, y, w, h); }
      else if (d.kind === 'binder') { c.fillStyle = '#222'; roundRect(c, x + 4, y + h * 0.42, w - 8, h * 0.56, 4); c.fill(); roundRect(c, x + w * 0.25, y, w * 0.5, h * 0.5, 4); c.stroke(); }
      else { roundRect(c, x + w * 0.15, y, w * 0.7, h, w * 0.35); c.stroke(); roundRect(c, x + w * 0.3, y + h * 0.2, w * 0.4, h * 0.7, w * 0.2); c.stroke(); }
      break;
    }
    case 'hide': c.fillStyle = 'rgba(200,190,178,0.85)'; roundRect(c, x, y, w, h, 20); c.fill(); textBox(c, it, it.title || 'Tap to reveal', x, y, w, h, { color: '#5b4f44', px: 16 }); break;
    case 'image': c.fillStyle = '#d9d1c6'; roundRect(c, x, y, w, h, 14); c.fill(); textBox(c, it, `[image] ${it.text || ''}`, x, y, w, h, { color: '#6b5f55', px: 16 }); break;
    default: {
      // cards and the other boxy items: a panel, an accent tick, a title and the text
      const fill = fillOf(it, '#ff8a5c');
      shadow(it.style?.shadow === 'flat' ? 0 : it.style?.shadow === 'float' ? 26 : 14, it.style?.shadow === 'float' ? 12 : 6, 0.16);
      roundRect(c, x, y, w, h, it.style?.radius ?? 18); c.fillStyle = fill || FACE; c.fill(); noShadow();
      if (it.style?.shadow === 'sunk') { c.strokeStyle = 'rgba(40,28,16,0.12)'; c.lineWidth = 3; c.stroke(); }
      const px = fontPx(it), dark = fill && fill.startsWith('#') && isDark(fill);
      const col = it.style?.textColor || (dark ? '#ffffff' : INK);
      if (it.type === 'card') { c.fillStyle = it.color || '#ff8a5c'; c.fillRect(x + 18, y + 10, 26, 4); }
      let ty = y + 22;
      const title = it.type === 'flip' ? it.title : it.title || (it.type === 'checklist' ? 'Checklist' : '');
      if (title) { c.font = fontOf(it, px * 1.1, true); const tl = wrap(c, title, w - 36); textBox(c, it, title, x + 18, ty, w - 36, tl.length * px * 1.45, { color: col, align: it.type === 'flip' ? 'center' : 'left', valign: 'top', bold: true, px: px * 1.1 }); ty += tl.length * px * 1.45 + 6; }
      if (it.type === 'checklist') (d.items || []).forEach((row, n) => { const ry = ty + n * px * 1.9; c.strokeStyle = '#8a7b6d'; c.lineWidth = 1.5; c.strokeRect(x + 20, ry, px, px); if (row.done) { c.fillStyle = '#2fb4a0'; c.fillRect(x + 22, ry + 2, px - 4, px - 4); } textBox(c, it, row.t, x + 28 + px, ry - px * 0.1, w - 50 - px, px * 1.3, { color: col, align: 'left', valign: 'top' }); });
      else if (it.type === 'flip') textBox(c, it, 'TAP TO FLIP', x, y + h - 40, w, 20, { color: '#8a7b6d', px: 11 });
      else textBox(c, it, it.text, x + 18, ty, w - 36, Math.max(10, y + h - ty - 14), { color: it.style?.muted ? '#8a7b6d' : col, align: 'left', valign: 'top' });
    }
  }
  if (d.jump && !d.jumpHide) { c.fillStyle = '#ff8a3d'; roundRect(c, x + w - 30, y + h - 16, d.jumpLabel ? 110 : 30, 30, 15); c.fill(); }
  c.restore();
}

// region: { x, y, w, h } in board coordinates. Returns a JPEG data URL (or null when nothing to draw).
export function snapshotBoard(data, region, { maxW = 1280, maxH = 1100 } = {}) {
  const pad = 30;
  const r = { x: region.x - pad, y: region.y - pad, w: region.w + pad * 2, h: region.h + pad * 2 };
  const k = Math.min(1.2, maxW / r.w, maxH / r.h);
  const W = Math.max(64, Math.round(r.w * k)), H = Math.max(64, Math.round(r.h * k));
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  c.fillStyle = FLOOR; c.fillRect(0, 0, W, H);
  c.scale(k, k); c.translate(-r.x, -r.y);
  if (k > 0.25) { c.fillStyle = 'rgba(138,123,109,0.28)'; const step = 24, x0 = Math.floor(r.x / step) * step, y0 = Math.floor(r.y / step) * step; for (let gx = x0; gx < r.x + r.w; gx += step) for (let gy = y0; gy < r.y + r.h; gy += step) c.fillRect(gx, gy, 1.6, 1.6); }
  const hit = (i) => i.x < r.x + r.w && i.x + i.w > r.x && i.y < r.y + r.h && i.y + i.h > r.y;
  const items = (data.items || []).filter((i) => i.type !== 'ink' && hit(i));
  if (!items.length) return null;
  const byId = new Map(data.items.map((i) => [i.id, i]));
  const layer = (i) => (i.type === 'frame' ? 0 : i.type === 'clip' ? 2 : i.type === 'hide' ? 3 : 1);
  items.sort((a, b) => layer(a) - layer(b) || (a.z || 0) - (b.z || 0));
  // frames, then connections, then everything else on top
  items.filter((i) => i.type === 'frame').forEach((i) => drawItem(c, i));
  for (const l of data.links || []) {
    const A = l.from?.item ? byId.get(l.from.item) : null, B = l.to?.item ? byId.get(l.to.item) : null;
    const a = A ? { x: A.x + A.w / 2, y: A.y + A.h / 2 } : l.from, b = B ? { x: B.x + B.w / 2, y: B.y + B.h / 2 } : l.to;
    if (!a || !b) continue;
    c.strokeStyle = l.style?.color || '#8a7b6d'; c.lineWidth = Math.max(2, l.style?.width || 3); c.setLineDash(l.style?.dash === 'dashed' ? [14, 10] : l.style?.dash === 'dotted' ? [3, 8] : []);
    c.beginPath(); c.moveTo(a.x, a.y); c.bezierCurveTo((a.x + b.x) / 2, a.y, (a.x + b.x) / 2, b.y, b.x, b.y); c.stroke();
  }
  c.setLineDash([]);
  items.filter((i) => i.type !== 'frame').forEach((i) => drawItem(c, i));
  return cv.toDataURL('image/jpeg', 0.78);
}
