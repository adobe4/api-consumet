// "Tidy up": arrange tanks so connected projects sit close, areas stay together and pipes cross as little
// as possible. A small force layout is run from several starting points; the one with the fewest crossings wins.
import { groupOf } from '/shared/goals.js';

const GAP = 330; // minimum comfortable distance between two tank centres (map units)

function seeded(seed) { let s = seed * 9301 + 49297; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }

const cross = (a, b, c, d) => {
  const o = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
};

export function crossings(pos, edges) {
  let n = 0;
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const [a, b] = edges[i], [c, d] = edges[j];
      if (a === c || a === d || b === c || b === d) continue;
      if (cross(pos.get(a), pos.get(b), pos.get(c), pos.get(d))) n++;
    }
  }
  return n;
}

function run(projects, edges, seed) {
  const rnd = seeded(seed);
  const groups = [...new Set(projects.map(groupOf))];
  const pos = new Map();
  // start: areas on a circle, members around their area
  const R = GAP * (0.9 + projects.length * 0.12);
  projects.forEach((p, i) => {
    const gi = groups.indexOf(groupOf(p));
    const ga = (gi / groups.length) * Math.PI * 2 + seed;
    const r = groups.length > 1 ? R * 0.6 : 0;
    pos.set(p.id, { x: Math.cos(ga) * r + (rnd() - 0.5) * GAP, y: Math.sin(ga) * r + (rnd() - 0.5) * GAP, vx: 0, vy: 0, g: gi, i });
  });
  const ids = projects.map((p) => p.id);
  for (let it = 0; it < 420; it++) {
    const cool = 1 - it / 420;
    const cent = groups.map(() => ({ x: 0, y: 0, n: 0 }));
    for (const id of ids) { const q = pos.get(id); cent[q.g].x += q.x; cent[q.g].y += q.y; cent[q.g].n++; }
    for (const c of cent) { c.x /= c.n || 1; c.y /= c.n || 1; }
    for (let i = 0; i < ids.length; i++) {
      const a = pos.get(ids[i]);
      for (let j = i + 1; j < ids.length; j++) {
        const b = pos.get(ids[j]);
        let dx = a.x - b.x, dy = a.y - b.y;
        let d = Math.hypot(dx, dy) || 1;
        if (d < 1) { dx = rnd() - 0.5; dy = rnd() - 0.5; d = 1; }
        const want = a.g === b.g ? GAP : GAP * 1.35;
        const f = d < want * 1.6 ? ((want * 1.6 - d) / d) * 0.12 : (GAP * GAP * 0.25) / (d * d * d);
        a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
      }
    }
    for (const [u, v] of edges) {
      const a = pos.get(u), b = pos.get(v);
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
      const f = ((d - GAP * 1.3) / d) * 0.03;
      a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
    }
    for (const id of ids) {
      const q = pos.get(id), c = cent[q.g];
      q.vx += (c.x - q.x) * 0.02 - q.x * 0.002;
      q.vy += (c.y - q.y) * 0.02 - q.y * 0.002;
      const sp = Math.hypot(q.vx, q.vy), max = 60 * cool + 4;
      if (sp > max) { q.vx *= max / sp; q.vy *= max / sp; }
      q.x += q.vx; q.y += q.vy;
      q.vx *= 0.6; q.vy *= 0.6;
    }
  }
  return pos;
}

// Returns [{ id, x, y }] with the new positions, centred on the old centre of the map.
export function tidyLayout(projects, links) {
  if (projects.length < 2) return projects.map((p) => ({ id: p.id, x: p.x, y: p.y }));
  const ids = new Set(projects.map((p) => p.id));
  const seen = new Set();
  const edges = [];
  for (const l of links) {
    if (!ids.has(l.from) || !ids.has(l.to) || l.from === l.to) continue;
    const k = l.from < l.to ? `${l.from}-${l.to}` : `${l.to}-${l.from}`;
    if (seen.has(k)) continue;
    seen.add(k);
    edges.push([l.from, l.to]);
  }
  let best = null, bestScore = Infinity;
  for (let seed = 1; seed <= 10; seed++) {
    const pos = run(projects, edges, seed);
    let tight = 0;
    const list = [...pos.values()];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (Math.hypot(list[i].x - list[j].x, list[i].y - list[j].y) < GAP * 0.8) tight++;
    const score = crossings(pos, edges) * 10 + tight * 25;
    if (score < bestScore) { bestScore = score; best = pos; }
  }
  const cx = projects.reduce((a, p) => a + p.x, 0) / projects.length, cy = projects.reduce((a, p) => a + p.y, 0) / projects.length;
  const vals = [...best.values()];
  const bx = vals.reduce((a, q) => a + q.x, 0) / vals.length, by = vals.reduce((a, q) => a + q.y, 0) / vals.length;
  return projects.map((p) => { const q = best.get(p.id); return { id: p.id, x: Math.round(q.x - bx + cx), y: Math.round(q.y - by + cy) }; });
}
