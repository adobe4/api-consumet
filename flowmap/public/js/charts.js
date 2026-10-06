// Multi-line canvas chart for the forecast tab, with hover read-out and click-to-scrub.
import { fmtNum } from './util.js';

export function lineChart(canvas, cfg) {
  // cfg: () => { series:[{label,color,values}], marker, format(v), hover }
  let hoverIdx = null;
  const draw = () => {
    const c = cfg();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = canvas.getBoundingClientRect();
    const W = Math.max(10, r.width), H = Math.max(10, r.height);
    if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const pad = { l: 46, r: 12, t: 12, b: 24 };
    const n = c.series[0].values.length;
    let max = 0, min = c.min ?? 0;
    for (const s of c.series) for (const v of s.values) { max = Math.max(max, v); min = Math.min(min, v); }
    if (c.max) max = c.max;
    if (max === min) max = min + 1;
    max *= 1.08;
    const X = (i) => pad.l + (i / (n - 1)) * (W - pad.l - pad.r);
    const Y = (v) => pad.t + (1 - (v - min) / (max - min)) * (H - pad.t - pad.b);
    // colours come from the page theme so the chart reads on dark and light panels
    const css = getComputedStyle(document.documentElement);
    const ink = css.getPropertyValue('--ink').trim() || '255, 255, 255';
    const muted = css.getPropertyValue('--muted').trim() || '#a09a92';
    // series colours are made for dark panels; darken them a little on light paper
    const light = document.documentElement.getAttribute('data-theme') === 'light';
    const tone = (hex) => {
      const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
      if (!light || !m) return hex;
      const n = parseInt(m[1], 16);
      return `rgb(${[16, 8, 0].map((sh) => Math.round(((n >> sh) & 255) * 0.72)).join(',')})`;
    };
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = `rgba(${ink},0.10)`; ctx.fillStyle = muted; ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const v = min + ((max - min) * i) / 4, y = Y(v);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
      ctx.textAlign = 'right'; ctx.fillText(c.format(v), pad.l - 6, y);
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const d of [0, 30, 60, 90]) if (d < n) ctx.fillText(d === 0 ? 'Today' : `+${d}d`, X(d), H - pad.b + 6);
    for (const s of c.series) {
      ctx.beginPath();
      s.values.forEach((v, i) => ctx[i ? 'lineTo' : 'moveTo'](X(i), Y(v)));
      ctx.strokeStyle = tone(s.color); ctx.lineWidth = s.width || 2.2; ctx.globalAlpha = s.dim ? 0.55 : 1; ctx.lineJoin = 'round'; ctx.stroke(); ctx.globalAlpha = 1;
    }
    if (c.marker > 0 && c.marker < n) {
      ctx.setLineDash([4, 4]); ctx.strokeStyle = `rgba(${ink},0.55)`;
      ctx.beginPath(); ctx.moveTo(X(c.marker), pad.t); ctx.lineTo(X(c.marker), H - pad.b); ctx.stroke(); ctx.setLineDash([]);
    }
    if (hoverIdx !== null) {
      const x = X(hoverIdx);
      ctx.strokeStyle = `rgba(${ink},0.4)`;
      ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, H - pad.b); ctx.stroke();
      const lines = [hoverIdx === 0 ? 'Today' : `+${hoverIdx} days`, ...c.series.map((s) => `${s.label}: ${c.format(s.values[hoverIdx])}`)];
      ctx.font = '600 11.5px system-ui, sans-serif';
      const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 18, bh = lines.length * 16 + 10;
      const bx = Math.min(W - bw - 4, Math.max(pad.l, x + 10)), by = pad.t + 4;
      ctx.fillStyle = 'rgba(14,13,12,0.94)'; ctx.strokeStyle = 'rgba(255,220,180,0.3)';
      ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 8); ctx.fill(); ctx.stroke();
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      lines.forEach((l, i) => { ctx.fillStyle = i === 0 ? '#f5f1ea' : c.series[i - 1].color; ctx.fillText(l, bx + 9, by + 14 + i * 16); });
      c.series.forEach((s) => { ctx.beginPath(); ctx.arc(x, Y(s.values[hoverIdx]), 3.5, 0, 6.28); ctx.fillStyle = s.color; ctx.fill(); });
    }
    canvas._geom = { X, n, pad, W };
  };
  const idxAt = (e) => {
    const g = canvas._geom;
    if (!g) return null;
    const r = canvas.getBoundingClientRect();
    const t = (e.clientX - r.left - g.pad.l) / (g.W - g.pad.l - g.pad.r);
    return Math.max(0, Math.min(g.n - 1, Math.round(t * (g.n - 1))));
  };
  canvas.onmousemove = (e) => { hoverIdx = idxAt(e); draw(); };
  canvas.onmouseleave = () => { hoverIdx = null; draw(); };
  canvas.onclick = (e) => cfg().onPick?.(idxAt(e));
  requestAnimationFrame(draw);
  return { draw };
}
export const compactFmt = (v) => fmtNum(v);
