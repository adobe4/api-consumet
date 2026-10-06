// The card tracker: every project is a soft physical card resting on the floor, with a light that shows its
// health. Tap a card and it lifts while a larger card rises from beneath it with everything that matters:
// health, numbers, trend, goal, tasks and actions. Pipes (or lines) carry views, money, customers and speed-ups
// between projects, with light flowing faster where more flows. Same interface as the other map renderers.
import { S, project, projects, on, snap, completeTask, currentAlerts } from './store.js';
import { KINDS, RESOURCES, TASK_TYPES } from '/shared/engine.js';
import { goalProgress, groupOf, GOAL_METRICS } from '/shared/goals.js';
import { h, fmtNum, clear, setText } from './util.js';
import { hasGlyph } from './icons.js';
import { createSurface, route, drawLink, svgEl } from './surface.js';
import { globalLook, cardLook, pipeLook, lookPanel, cardStylePanel, pipeStylePanel } from './looks.js';

const ST = (hp) => (hp >= 75 ? 'thriving' : hp >= 50 ? 'steady' : hp >= 30 ? 'thirsty' : 'dying');
const ST_WORD = { thriving: 'Thriving', steady: 'Steady', thirsty: 'Needs attention', dying: 'Needs you now' };
const ST_VAR = { thriving: 'var(--good)', steady: 'var(--st-steady)', thirsty: 'var(--st-thirsty)', dying: 'var(--bad)' };
const INFO_W = { compact: 290, normal: 336, wide: 430 };
const addDay = (d, n) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

export function createRenderer(canvas, hooks) {
  const stage = canvas.parentElement;
  canvas.style.display = 'none';
  let linkFrom = null, openId = null, hoverLink = null, destroyed = false;
  const cards = new Map(), pipes = new Map(), lights = new Map();
  // spacing: the map can be drawn tighter than the saved layout (made for tanks), so cards read large when it all fits.
  // Saved positions never change; X/Y give where a project is drawn.
  const SPREAD = { tight: 0.6, normal: 0.8, wide: 1 };
  const sp = () => SPREAD[globalLook().spacing] || SPREAD.tight;
  const X = (p) => p.x * sp(), Y = (p) => p.y * sp();
  let areaEls = new Map();

  const sf = createSurface(stage, {
    minK: 0.15, maxK: 3, className: 'sf-tracker',
    onPointerDown: (e) => {
      if (e.target.closest('.pc, .pinfo')) return 'handled';
      const hit = e.target.closest?.('[data-link]');
      if (hit && e.button === 0) { pipeDown(e, Number(hit.dataset.link)); return 'handled'; }
      return 'pan';
    },
    onContext: (e, w) => {
      const card = e.target.closest?.('.pc');
      const hit = e.target.closest?.('[data-link]');
      if (card) hooks.onContext?.({ type: 'node', id: Number(card.dataset.id) }, e.clientX, e.clientY);
      else if (hit) hooks.onContext?.({ type: 'link', id: Number(hit.dataset.link) }, e.clientX, e.clientY);
      else hooks.onContext?.({ type: 'ground', x: Math.round(w.x / sp()), y: Math.round(w.y / sp()) }, e.clientX, e.clientY);
    },
    onDoubleClick: (e, w) => { if (!e.target.closest('.pc, .pinfo, [data-link]')) hooks.onAddAt?.(Math.round(w.x / sp()), Math.round(w.y / sp())); },
  });
  const { layer, under, overlay } = sf;
  const pipeGroup = svgEl('g', { class: 'pc-pipes' }, under);
  const lightGroup = svgEl('g', { class: 'pc-lights' }, sf.flows);
  // area trays lie on the floor, under the pipes
  const floorLayer = h('div', { class: 'sf-floor' });
  sf.world.insertBefore(floorLayer, under);
  const ghost = svgEl('path', { class: 'pc-ghost', fill: 'none' }, under);
  const tip = h('div', { class: 'pipe-tip', hidden: true });
  overlay.append(tip);
  const info = h('div', { class: 'pinfo', hidden: true });
  layer.append(info);
  sf.root.addEventListener('sf-tap', () => { if (S.tool === 'link') { linkFrom = null; hooks.onToolHint?.('Tap the project that GIVES'); drawGhost(); return; } hooks.onSelect?.(null); });

  // ---------- look ----------
  let lastFitKey = null;
  function applyLook() {
    const g = globalLook();
    sf.setGround(g.ground);
    sf.root.dataset.card = g.card;
    render();
    // new spacing or card size: show it all again
    const key = `${g.spacing}|${g.cardSize}`;
    if (lastFitKey && key !== lastFitKey && !openId) requestAnimationFrame(() => fit());
    lastFitKey = key;
  }

  // ---------- cards ----------
  function cardEl(p) {
    let c = cards.get(p.id);
    if (!c) {
      c = h('div', { class: 'pc', tabindex: 0, role: 'button', 'data-id': p.id }, h('span', { class: 'alrt', 'aria-hidden': 'true' }), h('span', { class: 'led' }), h('span', { class: 'em' }), h('span', { class: 'nm' }));
      c.addEventListener('pointerdown', (e) => cardDown(e, p.id));
      c.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(p.id); } });
      c.addEventListener('pointerenter', () => { c.classList.add('hov'); highlight(p.id); });
      c.addEventListener('pointerleave', () => { c.classList.remove('hov'); highlight(null); });
      layer.append(c);
      cards.set(p.id, c);
    }
    return c;
  }
  function renderCard(p) {
    const c = cardEl(p), l = cardLook(p), s = snap()?.projects[p.id];
    const st = ST(s?.health ?? 60);
    c.style.left = `${X(p)}px`; c.style.top = `${Y(p)}px`;
    c.style.setProperty('--c', p.color || KINDS[p.kind]?.color || '#ff8a5c');
    c.style.setProperty('--st', ST_VAR[st]);
    // alerts live on the card itself: a yellow pulse when it needs attention, red when it needs you now
    const lv = Math.max(alertLevel.get(p.id) || 0, st === 'dying' ? 2 : st === 'thirsty' ? 1 : 0, s?.checkinOverdue > 0 ? (s.fresh <= 0.6 ? 2 : 1) : 0);
    c.dataset.alert = lv === 2 ? 'bad' : lv === 1 ? 'warn' : '';
    c.dataset.st = st; c.dataset.finish = l.finish; c.dataset.size = l.size; c.dataset.shape = l.shape; c.dataset.fx = l.fx;
    setText(c.querySelector('.em'), l.icon ? (hasGlyph(p.icon) ? p.icon : KINDS[p.kind]?.icon || '⬢') : '');
    c.querySelector('.em').hidden = !l.icon;
    c.querySelector('.nm').textContent = p.name;
    c.setAttribute('aria-label', `${p.name}, ${Math.round(s?.health ?? 0)}% health. Open details`);
    c.classList.toggle('lifted', openId === p.id);
    c.classList.toggle('linking', linkFrom === p.id);
    c.classList.toggle('dimmed', !!S.selection && S.selection.type === 'project' && S.selection.id !== p.id && !related(S.selection.id, p.id));
  }
  const related = (a, b) => S.world.links.some((l) => (l.from === a && l.to === b) || (l.to === a && l.from === b));
  const boxOf = (id) => { const p = project(id), c = cards.get(id); if (!p || !c) return null; const w = c.offsetWidth || 120, hh = c.offsetHeight || 46; return { x: X(p) - w / 2, y: Y(p) - hh / 2, w, h: hh }; };

  // ---------- pipes ----------
  const THICK = { thin: 0.6, normal: 1, bold: 1.5 };
  function pipeState(l) {
    const sel = S.selection?.type === 'link' && S.selection.id === l.id;
    const focus = S.selection?.type === 'project' ? S.selection.id : hoverId;
    const hot = sel || hoverLink === l.id || (focus != null && (l.from === focus || l.to === focus)) || flash.has(l.id);
    const dim = !hot && (focus != null || (S.selection?.type === 'link' && !sel));
    return { hot, dim };
  }
  // only = a set of project ids: redraw just their pipes (while dragging)
  function renderPipes(only = null) {
    const live = snap(), f = THICK[globalLook().thick] || 1;
    const seen = new Set();
    for (const l of S.world.links) {
      if (!project(l.from) || !project(l.to) || l.from === l.to) continue;
      seen.add(l.id);
      if (only && !only.has(l.from) && !only.has(l.to) && pipes.has(l.id)) continue;
      let g = pipes.get(l.id), fg = lights.get(l.id);
      if (!g) { g = svgEl('g', {}, pipeGroup); pipes.set(l.id, g); }
      if (!fg) { fg = svgEl('g', {}, lightGroup); lights.set(l.id, fg); }
      const look = pipeLook(l), o = live?.links[l.id] || { norm: 0.1, speed: 0.4, amount: 0 };
      const A = boxOf(l.from), B = boxOf(l.to);
      if (!A || !B) continue;
      const pipe = look.kind !== 'line';
      const n = Math.min(1, o.norm || 0);
      const width = look.width || (pipe ? (6 + 8 * n) * f : (1.8 + 1.8 * n) * f);
      const r = route(A, B, look.path, { center: pipe && look.end === 'none' && look.start === 'none', gap: pipe ? 2 : 6 });
      const { hot, dim } = pipeState(l);
      drawLink(g, r, { ...look, width }, sf.id, { hot, dim, speed: (3.6 - 2.4 * Math.min(1, o.speed || 0)) / (flash.has(l.id) ? 3 : 1), hitId: l.id, flowG: fg });
      g.style.setProperty('--link', look.color);
      g.dataset.id = l.id;
    }
    for (const [id, g] of [...pipes]) if (!seen.has(id)) { g.remove(); pipes.delete(id); lights.get(id)?.remove(); lights.delete(id); }
  }
  // hovering only changes emphasis: no redraw
  function pipeStates() {
    for (const l of S.world.links) {
      const g = pipes.get(l.id), fg = lights.get(l.id);
      if (!g) continue;
      const { hot, dim } = pipeState(l);
      g.classList.toggle('hot', hot); g.classList.toggle('dim', dim);
      fg?.classList.toggle('hot', hot); fg?.classList.toggle('dim', dim);
    }
  }
  let hoverId = null;
  function highlight(id) { if (hoverId === id) return; hoverId = id; pipeStates(); }
  const flash = new Set();

  // ---------- areas: sunk trays under each group ----------
  function renderAreas() {
    const list = projects();
    const groups = new Map();
    for (const p of list) { const g = groupOf(p); (groups.get(g) || groups.set(g, []).get(g)).push(p); }
    const mode = globalLook().areas;
    const show = mode !== 'off' && groups.size > 1;
    const next = new Map();
    if (show) for (const [name, members] of groups) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of members) { const b = boxOf(p.id); if (!b) continue; x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
      if (!Number.isFinite(x0)) continue;
      let el = areaEls.get(name);
      if (!el) { el = h('div', { class: 'pc-area' }, h('span', null, name)); floorLayer.append(el); }
      el.firstChild.textContent = name;
      el.dataset.mode = mode;
      Object.assign(el.style, { left: `${x0 - 48}px`, top: `${y0 - 56}px`, width: `${x1 - x0 + 96}px`, height: `${y1 - y0 + 96}px` });
      next.set(name, el);
    }
    for (const [name, el] of areaEls) if (!next.has(name)) el.remove();
    areaEls = next;
  }

  // ---------- the info card ----------
  function spark(p) {
    const since = addDay(S.today, -13);
    const logs = S.world.logs.filter((x) => x.projectId === p.id && x.day >= since && x.day <= S.today);
    const key = logs.some((x) => (x.money || 0) > 0) ? 'money' : 'attention';
    if (logs.length >= 3) {
      const byDay = new Map(logs.map((x) => [x.day, x[key] || 0]));
      return { key, label: 'last 14 days', vals: Array.from({ length: 14 }, (_, i) => byDay.get(addDay(since, i)) || 0) };
    }
    const k2 = (snap(0)?.projects[p.id]?.money || 0) > 0.5 ? 'money' : 'attention';
    return { key: k2, label: 'next 14 days if you keep going', vals: Array.from({ length: 14 }, (_, i) => S.sim.days[Math.min(S.sim.days.length - 1, i)]?.projects[p.id]?.[k2] || 0) };
  }
  function sparkSvg(vals, color) {
    const w = 300, hh = 46, mx = Math.max(...vals, 1), mn = Math.min(...vals, 0);
    const X = (i) => (i / (vals.length - 1)) * w, Y = (v) => hh - 4 - ((v - mn) / (mx - mn || 1)) * (hh - 12);
    const line = vals.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
    const svg = svgEl('svg', { class: 'pi-spark', viewBox: `0 0 ${w} ${hh}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    const gid = `sg${Math.random().toString(36).slice(2, 7)}`;
    const defs = svgEl('defs', {}, svg), lg = svgEl('linearGradient', { id: gid, x1: 0, x2: 0, y1: 0, y2: 1 }, defs);
    svgEl('stop', { offset: 0, 'stop-color': color, 'stop-opacity': 0.32 }, lg); svgEl('stop', { offset: 1, 'stop-color': color, 'stop-opacity': 0 }, lg);
    svgEl('path', { d: `${line} L${w},${hh} L0,${hh} Z`, fill: `url(#${gid})` }, svg);
    svgEl('path', { d: line, fill: 'none', stroke: color, 'stroke-width': 2.2, 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke' }, svg);
    svgEl('circle', { cx: X(vals.length - 1), cy: Y(vals[vals.length - 1]), r: 3.5, fill: color }, svg);
    return svg;
  }
  function ring(hp, st) {
    const r = 26, C = 2 * Math.PI * r;
    const svg = svgEl('svg', { class: 'pi-ring', viewBox: '0 0 64 64', 'aria-hidden': 'true' });
    svgEl('circle', { class: 'tr', cx: 32, cy: 32, r }, svg);
    const v = svgEl('circle', { class: 'val', cx: 32, cy: 32, r, style: `stroke:${ST_VAR[st]};stroke-dasharray:${C};stroke-dashoffset:${C}` }, svg);
    const t = svgEl('text', { x: 32, y: 32 }, svg); t.textContent = `${Math.round(hp)}%`;
    requestAnimationFrame(() => requestAnimationFrame(() => { v.style.strokeDashoffset = String(C * (1 - Math.max(0, Math.min(100, hp)) / 100)); }));
    return svg;
  }
  function fillInfo(p) {
    const s = snap()?.projects[p.id] || { health: 0 }, s0 = snap(0)?.projects[p.id] || s, l = cardLook(p);
    const st = ST(s.health), color = p.color || KINDS[p.kind]?.color || '#ff8a5c';
    const sec = new Set(l.info.sections);
    const since = s.lastAction ? (s.daysSince === 0 ? 'worked on today' : `last work ${s.daysSince} day${s.daysSince === 1 ? '' : 's'} ago`) : 'no work logged yet';
    info.style.width = `${INFO_W[l.info.width] || INFO_W.normal}px`;
    info.style.setProperty('--c', color);
    const stat = (v, label, cvar) => h('div', { class: 'pi-stat' }, h('b', { style: { color: cvar } }, v), h('small', null, label));
    const stats = [];
    if (s.money > 0.5 || s0.money > 0.5) stats.push(stat(`TZS ${fmtNum(s.money)}`, 'money / day', 'var(--money)'));
    if (s.attention > 0.5 || s0.attention > 0.5) stats.push(stat(fmtNum(s.attention), 'views / day', 'var(--attention)'));
    if (s.customers >= 0.05) stats.push(stat(fmtNum(s.customers), 'customers / day', 'var(--customers)'));
    stats.push(stat(`TZS ${fmtNum(s.profit ?? (s.money - s.cost))}`, 'profit / day', (s.profit ?? 0) >= 0 ? 'var(--good)' : 'var(--bad)'));
    const goal = goalProgress(p, { logs: S.world.logs, scans: S.world.scans || [], day: s0, today: S.today });
    const open = S.world.tasks.filter((t) => t.projectId === p.id && t.status !== 'done').sort((a, b) => (a.due || '9').localeCompare(b.due || '9'));
    const sp = spark(p);
    const act = (a, label, cls = '') => h('button', { type: 'button', class: `btn ${cls}`, onclick: (e) => { e.stopPropagation(); doAction(a, p.id, e.currentTarget); } }, label);
    clear(info).append(
      h('div', { class: 'pi-top' }, ring(s.health, st), h('div', { class: 'pi-who' }, h('b', null, `${p.icon || ''} ${p.name}`), h('small', null, `${ST_WORD[st]} · ${since}`))),
      s.checkinOverdue > 0 ? h('div', { class: 'pi-stale' }, h('span', null, `📝 Check-in ${s.checkinOverdue} day${s.checkinOverdue === 1 ? '' : 's'} late · flow down to ${Math.round((0.5 + 0.5 * s.fresh) * 100)}%`), act('checkin', 'Check in', 'sm primary')) : null,
      !s.checkinOverdue && s.upstreamStale > 0 ? h('div', { class: 'pi-stale soft' }, h('span', null, '⚠️ Slowed by a project that feeds it and is waiting for a check-in')) : null,
      sec.has('stats') ? h('div', { class: 'pi-stats' }, ...stats.slice(0, 3)) : null,
      sec.has('chart') ? h('div', { class: 'pi-chart' }, sparkSvg(sp.vals, color), h('small', null, `${sp.key === 'money' ? 'Money' : 'Views'} · ${sp.label}`)) : null,
      sec.has('goal') && goal ? h('div', { class: 'pi-goal' },
        h('div', { class: 'row' }, h('span', null, `🎯 ${fmtNum(goal.target)} ${GOAL_METRICS[goal.metric]?.short || ''}`), h('span', { class: 'spacer' }), h('b', null, goal.reached ? 'Reached 🏆' : `${Math.round(goal.frac * 100)}%`)),
        h('div', { class: 'meter' }, h('i', { style: { width: `${Math.round(goal.frac * 100)}%`, background: 'linear-gradient(90deg, var(--accent-2), var(--accent))' } }))) : null,
      sec.has('tasks') ? h('div', { class: 'pi-tasks' }, open.length ? open.slice(0, 3).map((t) => {
        const late = t.due && t.due < S.today;
        return h('div', { class: `pi-task${late ? ' late' : ''}` },
          h('button', { type: 'button', class: 'check', title: 'Done', 'aria-label': `Mark ${t.title} done`, onclick: (e) => { e.stopPropagation(); e.currentTarget.classList.add('on'); completeTask(t.id); } }),
          h('span', { class: 'tt' }, `${TASK_TYPES[t.type]?.icon || '•'} ${t.title}`), h('em', null, t.due ? (late ? 'late' : t.due === S.today ? 'today' : t.due.slice(5)) : ''));
      }) : h('div', { class: 'pi-empty' }, 'No open tasks. Plan the next move.')) : null,
      sec.has('note') && p.note ? h('p', { class: 'pi-note selectable' }, p.note) : null,
      sec.has('channels') && (p.sources || []).length ? h('div', { class: 'pi-chan' }, (p.sources || []).slice(0, 3).map((x) => h('a', { href: x.url, target: '_blank', rel: 'noopener' }, x.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 42)))) : null,
      sec.has('actions') ? h('div', { class: 'pi-acts' }, act('water', '💧 Log', 'primary'), act('task', '＋ Plan'), act('style', '🎨 Style'), act('details', '⋯ More')) : null,
    );
    placeInfo(p);
  }
  function placeInfo(p) {
    const b = boxOf(p.id);
    if (!b) return;
    const w = parseFloat(info.style.width) || INFO_W.normal;
    info.style.left = `${X(p) - w / 2}px`;
    info.style.top = `${b.y - 16}px`;
  }
  function doAction(a, id, btn) {
    if (a === 'style') return cardStylePanel(id, btn);
    if (a === 'details') return hooks.onTankAction?.('details', id);
    hooks.onTankAction?.(a, id);
  }
  function open(id) {
    const p = project(id);
    if (!p) return;
    const was = openId;
    openId = id;
    if (was && was !== id) cards.get(was)?.classList.remove('lifted');
    cards.get(id)?.classList.add('lifted');
    fillInfo(p);
    info.hidden = false;
    info.classList.remove('out', 'in'); void info.offsetWidth; info.classList.add('in');
    // bring the whole card into view at a comfortable size
    requestAnimationFrame(() => {
      const b = boxOf(id), ih = info.offsetHeight, w = parseFloat(info.style.width);
      const box = { x: X(p) - w / 2 - 20, y: b.y - 30, w: w + 40, h: ih + 50 };
      const { W, H } = sf.size;
      const tl = sf.toScreen(box.x, box.y), br = sf.toScreen(box.x + box.w, box.y + box.h);
      const visible = tl.x > 8 && tl.y > 60 && br.x < W - 8 && br.y < H - 8 && sf.cam.k >= 0.8;
      if (!visible) sf.fit(box, { pad: 24, maxZoom: Math.max(1, Math.min(1.2, sf.cam.k)), insets: { top: 60 } });
    });
  }
  function close() {
    if (!openId) return;
    cards.get(openId)?.classList.remove('lifted');
    openId = null;
    info.classList.remove('in'); info.classList.add('out');
    const done = (e) => { if (e.target !== info) return; info.removeEventListener('animationend', done); if (!openId) info.hidden = true; };
    info.addEventListener('animationend', done);
  }
  function toggle(id) {
    if (S.tool === 'link') return pickForLink(id);
    if (openId === id) { hooks.onSelect?.(null); return; }
    hooks.onSelect?.({ type: 'project', id });
  }
  info.addEventListener('pointerdown', (e) => e.stopPropagation());
  info.addEventListener('dblclick', (e) => e.stopPropagation());

  // ---------- dragging and tapping cards ----------
  function cardDown(e, id) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const c = cards.get(id), p = project(id);
    c.setPointerCapture(e.pointerId);
    const start = { x: e.clientX, y: e.clientY, px: p.x, py: p.y, moved: false };
    const move = (ev) => {
      const dx = (ev.clientX - start.x) / sf.cam.k / sp(), dy = (ev.clientY - start.y) / sf.cam.k / sp();
      if (!start.moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5) return;
      if (!start.moved) { start.moved = true; c.classList.add('dragging'); if (openId === id) close(); }
      hooks.onMoved?.(id, Math.round(start.px + dx), Math.round(start.py + dy));
      c.style.left = `${X(p)}px`; c.style.top = `${Y(p)}px`;
      if (!start.raf) start.raf = requestAnimationFrame(() => { start.raf = 0; renderPipes(new Set([id])); if (globalLook().areas !== 'off') renderAreas(); });
    };
    const up = () => {
      c.removeEventListener('pointermove', move); c.removeEventListener('pointerup', up); c.removeEventListener('pointercancel', up);
      c.classList.remove('dragging');
      if (!start.moved) toggle(id);
    };
    c.addEventListener('pointermove', move); c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
  }
  function pipeDown(e, id) {
    const up = () => { sf.root.removeEventListener('pointerup', up); hooks.onSelect?.({ type: 'link', id }); };
    sf.root.addEventListener('pointerup', up);
  }
  sf.root.addEventListener('pointermove', (e) => {
    const hit = e.target.closest?.('[data-link]');
    const id = hit ? Number(hit.dataset.link) : null;
    if (id !== hoverLink) { hoverLink = id; pipeStates(); }
    showTip(id, e);
    if (S.tool === 'link' && linkFrom) drawGhost(sf.toWorld(sf.local(e).x, sf.local(e).y));
  });
  sf.root.addEventListener('pointerleave', () => { hoverLink = null; tip.hidden = true; pipeStates(); });
  function showTip(id, e) {
    const l = id && S.world.links.find((x) => x.id === id);
    const o = l && snap()?.links[l.id];
    if (!l || !o) { tip.hidden = true; return; }
    const R = RESOURCES[l.resource];
    const amt = l.resource === 'money' ? `TZS ${fmtNum(o.amount)} / day` : l.resource === 'attention' ? `${fmtNum(o.amount)} views / day` : l.resource === 'customers' ? `${fmtNum(o.amount)} customers / day` : `+${Math.round(o.amount * 100)}% speed`;
    clear(tip).append(h('b', null, amt), h('span', null, `${project(l.from)?.name} → ${project(l.to)?.name}`));
    tip.style.setProperty('--c', R.color);
    const pt = sf.local(e);
    tip.style.transform = `translate(${Math.round(pt.x + 14)}px, ${Math.round(pt.y + 14)}px)`;
    tip.hidden = false;
  }

  // ---------- connect tool ----------
  function pickForLink(id) {
    if (!linkFrom) { linkFrom = id; hooks.onToolHint?.('Now tap the project it feeds'); render(); return; }
    if (linkFrom === id) return;
    const from = linkFrom; linkFrom = null; drawGhost(); render();
    hooks.onLinkPicked?.(from, id);
  }
  function drawGhost(pt) {
    const p = linkFrom && project(linkFrom);
    if (!p || !pt) { ghost.setAttribute('d', ''); return; }
    ghost.setAttribute('d', `M${X(p)},${Y(p)} L${pt.x},${pt.y}`);
  }

  // ---------- render ----------
  let alertLevel = new Map();
  function readAlerts() {
    alertLevel = new Map();
    if (S.offset !== 0) return; // alerts describe today; the future shows through health
    for (const a of currentAlerts()) {
      const lv = a.level === 'critical' ? 2 : a.level === 'warn' ? 1 : 0;
      if (!lv) continue;
      if (a.id === 'stale') continue; // each card shows its own lateness instead
      for (const id of a.projectIds || (a.projectId ? [a.projectId] : [])) alertLevel.set(id, Math.max(alertLevel.get(id) || 0, lv));
    }
  }
  function render() {
    if (destroyed || !S.sim) return;
    readAlerts();
    const list = projects();
    const seen = new Set(list.map((p) => p.id));
    for (const [id, c] of [...cards]) if (!seen.has(id)) { c.remove(); cards.delete(id); }
    for (const p of list) renderCard(p);
    renderAreas();
    renderPipes();
    sf.root.classList.toggle('future', S.offset > 0);
    sf.root.classList.toggle('linking', S.tool === 'link');
    if (openId && !project(openId)) close();
    else if (openId) fillInfo(project(openId));
  }
  const offs = [
    on('world', render), on('sim', render), on('offset', render), on('look', applyLook),
    on('selection', () => {
      const s = S.selection;
      if (s?.type === 'project') { if (openId !== s.id) open(s.id); } else close();
      render();
    }),
    on('tool', () => { linkFrom = null; drawGhost(); render(); }),
    (() => { const f = () => render(); window.addEventListener('flowmap-motion', f); return () => window.removeEventListener('flowmap-motion', f); })(),
  ];

  // ---------- public api ----------
  function allBounds() {
    const bs = projects().map((p) => boxOf(p.id)).filter(Boolean);
    if (!bs.length) return { x: -300, y: -200, w: 600, h: 400 };
    const x0 = Math.min(...bs.map((b) => b.x)), y0 = Math.min(...bs.map((b) => b.y)), x1 = Math.max(...bs.map((b) => b.x + b.w)), y1 = Math.max(...bs.map((b) => b.y + b.h));
    return { x: x0 - 20, y: y0 - 24, w: x1 - x0 + 40, h: y1 - y0 + 44 };
  }
  // keep the whole system clear of the panels that float over the map (banner, today card, zoom buttons)
  function insets() {
    const root = sf.root.getBoundingClientRect();
    const phone = sf.size.W < 760;
    const ins = { top: phone ? 80 : 64, bottom: 20, left: 8, right: phone ? 64 : 72 };
    const mid = root.top + root.height / 2;
    const dock = document.querySelector('.dock');
    const over = [...stage.querySelectorAll('.stage-top > *, .future-banner, .today, .legend')];
    if (dock && getComputedStyle(dock).position === 'fixed') over.push(dock); // the phone's bottom sheet
    for (const e of over) {
      if (e.hidden || (e.offsetParent === null && getComputedStyle(e).position !== 'fixed')) continue;
      const r = e.getBoundingClientRect();
      if (!r.width || !r.height || r.bottom < root.top || r.top > root.bottom || r.right < root.left || r.left > root.right) continue;
      // a panel over the top or bottom part of the map: keep the system above or below it
      if (r.top + r.height / 2 < mid) ins.top = Math.max(ins.top, r.bottom - root.top + 10);
      else ins.bottom = Math.max(ins.bottom, root.bottom - r.top + 10);
    }
    return ins;
  }
  function fit({ animate = true } = {}) { sf.fit(allBounds(), { pad: 24, maxZoom: 1.3, insets: insets(), animate }); }
  // the first view shows everything; it is refitted once fonts and the floating panels have settled,
  // unless the person has already moved the map
  let touched = false;
  sf.root.addEventListener('pointerdown', () => { touched = true; });
  sf.root.addEventListener('wheel', () => { touched = true; }, { passive: true });
  function intro() {
    render();
    fit({ animate: false });
    const again = () => { if (!touched && !destroyed && !openId) { render(); fit({ animate: false }); } };
    document.fonts?.ready.then(again);
    setTimeout(again, 400);
    layer.classList.remove('intro'); void layer.offsetWidth; layer.classList.add('intro');
    [...cards.values()].forEach((c, i) => c.style.setProperty('--i', i));
  }
  function focus(id) {
    const p = project(id);
    if (!p) return;
    if (openId !== id) sf.centerOn(X(p), Y(p) + 120, Math.max(sf.cam.k, 0.9));
  }
  function burst(task) {
    const p = project(task.projectId), c = p && cards.get(p.id);
    if (!c) return;
    c.classList.remove('burst'); void c.offsetWidth; c.classList.add('burst');
    const ripple = h('div', { class: 'pc-ripple', style: { left: `${X(p)}px`, top: `${Y(p)}px`, '--c': p.color || '#ff8a5c' } });
    layer.append(ripple); setTimeout(() => ripple.remove(), 1200);
    const type = TASK_TYPES[task.type] || TASK_TYPES.other;
    floatText(p.id, `${type.icon} Done`, 'var(--good)');
    if (task.reward > 0) setTimeout(() => floatText(p.id, `+TZS ${fmtNum(task.reward)}`, 'var(--money)'), 250);
    for (const l of S.world.links) if (l.from === p.id) flash.add(l.id);
    renderPipes();
    setTimeout(() => { for (const l of S.world.links) if (l.from === p.id) flash.delete(l.id); renderPipes(); }, 2600);
  }
  function floatText(id, text, color) {
    const p = project(id), b = boxOf(id);
    if (!p || !b) return;
    const el = h('div', { class: 'pc-float', style: { left: `${X(p)}px`, top: `${b.y - 8}px`, color } }, text);
    layer.append(el); setTimeout(() => el.remove(), 2200);
  }
  function replay(fromHealth, highlightIds = []) {
    highlightIds.forEach((id, i) => setTimeout(() => { const c = cards.get(id); if (c) { c.classList.remove('burst'); void c.offsetWidth; c.classList.add('burst'); } }, 500 + i * 400));
  }
  function screenPos(id) { const p = project(id); if (!p) return null; const r = sf.root.getBoundingClientRect(), s = sf.toScreen(X(p), Y(p)); return { x: r.left + s.x, y: r.top + s.y }; }
  function destroy() {
    destroyed = true;
    offs.forEach((f) => f());
    sf.destroy();
    canvas.style.display = '';
  }
  applyLook();

  return {
    kind: 'cards', fit, intro, replay, focus, burst, floatText, screenPos, destroy,
    resize: () => sf.resize(),
    zoomBy: (f) => sf.zoomBy(f),
    setZones: () => {}, // areas are part of the look here
    lookAreas: true,
    startLink: (id) => { linkFrom = id; hooks.onToolHint?.('Now tap the project it feeds'); render(); },
    timeOfDay: () => { const hr = new Date().getHours(); return hr < 5 || hr >= 21 ? 'night' : hr < 8 ? 'dawn' : hr < 17 ? 'day' : 'evening'; },
    openLook: (anchor) => lookPanel(anchor, { onTidy: () => import('./map-ui.js').then((m) => m.tidy()), onFit: () => fit() }),
    styleProject: (id, at) => cardStylePanel(id, at),
    styleLink: (id, at) => { const l = S.world.links.find((x) => x.id === id); if (l) pipeStylePanel(l, at); },
    legendNote: [['width', 'Pipes', 'wider and faster = more flows'], ['led', 'Light', 'health: green good, red needs you'], ['tap', 'Tap a card', 'to lift it and see everything']],
    get camera() { return { ...sf.cam }; },
  };
}
