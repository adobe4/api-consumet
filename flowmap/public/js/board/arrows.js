// Big arrows: a thick body along a curve that passes through three points (start, bend, end), with a head
// and an optional tail. Returns an SVG path outline, so it can be filled, stroked and drawn on a canvas.
export const ARROW_HEADS = ['triangle', 'wide', 'thin', 'round', 'bar', 'none'];
export const ARROW_HEAD_LABEL = { triangle: 'Arrow', wide: 'Wide', thin: 'Thin', round: 'Dot', bar: 'Bar', none: 'None' };

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const len = (v) => Math.hypot(v.x, v.y) || 1;
// a quadratic curve that passes through m halfway
function curve(a, m, b) {
  const c = { x: 2 * m.x - (a.x + b.x) / 2, y: 2 * m.y - (a.y + b.y) / 2 };
  const at = (t) => ({ x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * c.x + t * t * b.x, y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * c.y + t * t * b.y });
  const N = 64, pts = [];
  for (let i = 0; i <= N; i++) pts.push(at(i / N));
  const dist = [0];
  for (let i = 1; i <= N; i++) dist.push(dist[i - 1] + len(sub(pts[i], pts[i - 1])));
  return { pts, dist, total: dist[N] };
}
// how big the head is for a body this thick
export function headSize(body, head) {
  const k = head === 'wide' ? 3.2 : head === 'thin' ? 1.8 : 2.4;
  return { len: Math.max(14, body * (head === 'thin' ? 2.4 : 1.8)), half: Math.max(9, (body * k) / 2) };
}
const f = (n) => Math.round(n * 10) / 10;

// pts: [[x,y],[x,y],[x,y]] start, bend, end. body: thickness. head/tail: one of ARROW_HEADS. taper: thinner start
export function arrowPath(pts, { body = 24, head = 'triangle', tail = 'none', taper = false } = {}) {
  const [a, m, b] = pts.map(([x, y]) => ({ x, y }));
  const { pts: P, dist, total } = curve(a, m, b);
  const hs = headSize(body, head), ts = headSize(body, tail);
  const cutEnd = ['triangle', 'wide', 'thin'].includes(head) ? Math.min(hs.len, total * 0.6) : 0;
  const cutStart = ['triangle', 'wide', 'thin'].includes(tail) ? Math.min(ts.len, total * 0.4) : 0;
  const normal = (i) => { const p = P[Math.max(0, i - 1)], q = P[Math.min(P.length - 1, i + 1)]; const d = sub(q, p), l = len(d); return { x: -d.y / l, y: d.x / l }; };
  const left = [], right = [];
  for (let i = 0; i < P.length; i++) {
    if (dist[i] < cutStart - 0.01 || dist[i] > total - cutEnd + 0.01) continue;
    const n = normal(i), w = (body / 2) * (taper ? 0.25 + 0.75 * (dist[i] / total) : 1);
    left.push({ x: P[i].x + n.x * w, y: P[i].y + n.y * w });
    right.push({ x: P[i].x - n.x * w, y: P[i].y - n.y * w });
  }
  if (!left.length) return '';
  const tip = (end) => {
    const i = end ? P.length - 1 : 0, j = end ? P.length - 1 - Math.max(1, Math.round((P.length * (end ? cutEnd : cutStart)) / Math.max(1, total))) : Math.round((P.length * cutStart) / Math.max(1, total));
    const base = P[Math.max(0, Math.min(P.length - 1, j))], n = normal(j), s = end ? hs : ts;
    return { tip: P[i], l: { x: base.x + n.x * s.half, y: base.y + n.y * s.half }, r: { x: base.x - n.x * s.half, y: base.y - n.y * s.half } };
  };
  let d = '';
  // the outline: up the left side, round the head, back down the right side, round the tail
  const L = (p) => `L${f(p.x)},${f(p.y)}`;
  d += `M${f(left[0].x)},${f(left[0].y)}`;
  left.slice(1).forEach((p) => { d += L(p); });
  if (cutEnd) { const t = tip(true); d += L(t.l) + L(t.tip) + L(t.r); }
  else d += L(right[right.length - 1]);
  right.slice().reverse().forEach((p) => { d += L(p); });
  if (cutStart) { const t = tip(false); d += L(t.r) + L(t.tip) + L(t.l); }
  d += 'Z';
  // round and bar ends are separate pieces drawn on top
  const cap = (end, kind) => {
    const p = end ? P[P.length - 1] : P[0];
    if (kind === 'round') { const r = Math.max(8, body * 0.95); return `M${f(p.x - r)},${f(p.y)}a${f(r)},${f(r)} 0 1,0 ${f(2 * r)},0a${f(r)},${f(r)} 0 1,0 ${f(-2 * r)},0Z`; }
    if (kind === 'bar') { const i = end ? P.length - 1 : 0, n = normal(i), d2 = sub(P[end ? i : 1], P[end ? i - 1 : 0]), u = { x: d2.x / len(d2), y: d2.y / len(d2) }, h = Math.max(12, body * 1.3), t = Math.max(4, body * 0.35); const c = [[h, t], [h, -t], [-h, -t], [-h, t]].map(([s, k]) => ({ x: p.x + n.x * s + u.x * k, y: p.y + n.y * s + u.y * k })); return `M${c.map((q) => `${f(q.x)},${f(q.y)}`).join('L')}Z`; }
    return '';
  };
  return d + cap(true, head) + cap(false, tail);
}
// the box an arrow needs, in its own coordinates, with room for the head
export function arrowBounds(pts, body, head, tail) {
  const pad = Math.max(headSize(body, head).half, headSize(body, tail).half, body) + 6;
  const [a, m, b] = pts.map(([x, y]) => ({ x, y }));
  const { pts: P } = curve(a, m, b);
  const xs = P.map((p) => p.x), ys = P.map((p) => p.y);
  return { x0: Math.min(...xs) - pad, y0: Math.min(...ys) - pad, x1: Math.max(...xs) + pad, y1: Math.max(...ys) + pad };
}
