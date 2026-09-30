// Things you do straight on the map: quick actions on a tank, the right-click / long-press menu,
// the "Today" card (tasks, progress, streak) and full-screen mode.
import { h, clear, fmtNum, fmtDay, store_ls } from './util.js';
import { S, project, projects, select, setTool, notify, snap, currentSuggestions, scanProject, deleteLink, addDays, savePositions } from './store.js';
import { KINDS, TASK_TYPES, simulate, cadenceOf } from '/shared/engine.js';
import { openProjectEditor, openLinkEditor, openActionDialog, openTaskEditor } from './dialogs.js';
import { confirmDialog, openModal } from './ui-common.js';
import { tidyLayout, crossings } from './layout.js';
import { openTab } from './panels.js';
import { getMapStyle, setMapStyle } from './mapstyle.js';

let ctx = { renderer: null, stage: null, app: null };
let menuEl = null;

export function initMapUi({ renderer, stage, app }) {
  ctx = { renderer, stage, app };
  // remember when you were last here, so the morning replay can say what is new since then
  prevSeen = store_ls.get('flowmap.lastSeenAt', null);
  store_ls.set('flowmap.lastSeenAt', new Date().toISOString());
  renderer.setZones?.(store_ls.get('flowmap.zones', true));
  buildToday();
  buildMiniHud();
  document.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea, select, [contenteditable]') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (ctx.app.classList.contains('board-mode')) return; // boards have their own keys
    if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleImmersive(); }
    if (e.key === 'Escape') closeMenu();
  });
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && app.classList.contains('immersive') && ctx.fsEntered) setImmersive(false); });
  document.addEventListener('pointerdown', (e) => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }, true);
}

// after switching map style
export function setMapRenderer(renderer) {
  ctx.renderer = renderer;
  renderer.setZones?.(store_ls.get('flowmap.zones', true));
}

// ---------- tank quick actions ----------
export function tankAction(action, id) {
  const p = project(id);
  if (!p) return;
  closeMenu();
  if (action === 'water') openActionDialog({ projectId: id });
  else if (action === 'task') openTaskEditor({ projectId: id });
  else if (action === 'connect') { setTool('link'); ctx.renderer.startLink?.(id); }
  else if (action === 'edit') openProjectEditor(id);
  else if (action === 'details') { select({ type: 'project', id }); openTab('focus'); }
  else if (action === 'scan') {
    notify(`Scanning ${p.name}…`);
    scanProject(id).then((r) => { if (r) notify(r.every((x) => x.ok) ? `${p.name} scanned` : r.find((x) => !x.ok).error, r.every((x) => x.ok) ? 'good' : 'error'); });
  }
}

// ---------- menus ----------
function closeMenu() { menuEl?.remove(); menuEl = null; }
const item = (icon, label, fn, cls = '') => h('button', { type: 'button', class: `mi ${cls}`, role: 'menuitem', onclick: () => { closeMenu(); fn(); } }, h('span', { class: 'mic' }, icon), label);
function showMenu(title, items, x, y, { above = false } = {}) {
  closeMenu();
  menuEl = h('div', { class: 'ctxmenu', role: 'menu' }, h('div', { class: 'mt' }, title), ...items.filter(Boolean));
  document.body.append(menuEl);
  const r = { width: menuEl.offsetWidth, height: menuEl.offsetHeight };
  menuEl.style.left = `${Math.max(8, Math.min(window.innerWidth - r.width - 8, x))}px`;
  menuEl.style.top = `${Math.max(8, Math.min(window.innerHeight - r.height - 8, above ? y - r.height - 8 : y))}px`;
  menuEl.querySelector('.mi')?.focus({ preventScroll: true });
}

// the ⋯ button next to the zoom controls
export function openViewMenu(anchor) {
  const r = anchor.getBoundingClientRect();
  const zonesOn = store_ls.get('flowmap.zones', true);
  const rd = ctx.renderer;
  showMenu('View', [
    rd.openLook ? item('🎨', 'Look: floor, pipes, cards', () => rd.openLook(anchor), 'primary') : null,
    getMapStyle() === 'cards'
      ? item('🫧', 'Switch to glass tanks (3D)', () => setMapStyle('tanks'))
      : item('🃏', 'Switch to cards', () => setMapStyle('cards')),
    rd.autoLayout ? null : item('✨', 'Tidy up the layout', () => tidy(), 'primary'),
    rd.autoLayout ? null : item('▦', zonesOn ? 'Hide areas' : 'Show areas', () => setZones(!zonesOn)),
    window.flowmapTheme ? (window.flowmapTheme.current === 'light'
      ? item('🌙', 'Dark mode', () => window.flowmapTheme.set('dark'))
      : item('☀️', 'Light mode', () => window.flowmapTheme.set('light'))) : null,
    rd.rotateBy ? item('⟳', 'Rotate the view', () => rd.rotateBy(Math.PI / 4)) : null,
    rd.toggleTilt ? item('◩', 'Tilted / top-down view', () => rd.toggleTilt()) : null,
    item('☀️', 'Replay since yesterday', () => morningReplay()),
    item('📊', 'Week in review', () => openWeekReview()),
  ], r.left - 230, r.bottom, { above: true });
}
export function setZones(on) {
  store_ls.set('flowmap.zones', !!on);
  ctx.renderer.setZones?.(!!on);
}

export function openContextMenu(target, x, y) {
  let title, items;
  if (target.type === 'node') {
    const p = project(target.id);
    if (!p) return;
    title = `${p.icon || KINDS[p.kind]?.icon || '⬢'} ${p.name}`;
    items = [
      item('💧', 'I did something for it', () => tankAction('water', p.id), 'primary'),
      item('＋', 'Plan a task', () => tankAction('task', p.id)),
      item('🔗', 'Draw a pipe from here', () => tankAction('connect', p.id)),
      (p.sources || []).length ? item('📡', 'Scan its channels', () => tankAction('scan', p.id)) : item('📡', 'Add channel links', () => tankAction('edit', p.id)),
      item('✎', 'Edit project', () => tankAction('edit', p.id)),
      ctx.renderer.styleProject ? item('🎨', 'Style this card', () => ctx.renderer.styleProject(p.id, { x, y })) : null,
      item('ⓘ', 'Details', () => tankAction('details', p.id)),
    ];
  } else if (target.type === 'link') {
    const l = S.world.links.find((q) => q.id === target.id);
    if (!l) return;
    title = `${project(l.from)?.name} → ${project(l.to)?.name}`;
    items = [
      item('✎', 'Edit pipe', () => openLinkEditor({ id: l.id }), 'primary'),
      ctx.renderer.styleLink ? item('🎨', 'Pipe style: tunnel, tube, line, arrows', () => ctx.renderer.styleLink(l.id, { x, y })) : null,
      item('↦', `Open ${project(l.from)?.name}`, () => select({ type: 'project', id: l.from })),
      item('⇥', `Open ${project(l.to)?.name}`, () => select({ type: 'project', id: l.to })),
      item('🗑', 'Remove pipe', async () => { if (await confirmDialog({ title: 'Remove this pipe?', message: `${project(l.from)?.name} will stop feeding ${project(l.to)?.name}.`, confirm: 'Remove', danger: true })) deleteLink(l.id); }, 'danger'),
    ];
  } else {
    title = 'Here';
    items = [
      item('＋', 'Add a project here', () => openProjectEditor(null, { x: target.x, y: target.y }), 'primary'),
      item('✅', 'Plan a task', () => openTaskEditor({})),
      item('✨', 'Tidy up the layout', () => tidy()),
      item('⤢', 'Fit everything', () => ctx.renderer.fit()),
      ctx.renderer.openLook ? item('🎨', 'Look: floor, pipes, cards', () => ctx.renderer.openLook({ x, y })) : null,
      item('⛶', isImmersive() ? 'Exit full screen' : 'Full screen', () => toggleImmersive()),
    ];
  }
  showMenu(title, items, x, y);
}

// ---------- tidy layout (with undo) ----------
let undoEl = null;
function animatePositions(target, ms = 1100) {
  const from = new Map(target.map(({ id }) => { const p = project(id); return [id, { x: p.x, y: p.y }]; }));
  const t0 = performance.now();
  return new Promise((resolve) => {
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      for (const q of target) {
        const p = project(q.id), f = from.get(q.id);
        if (p && f) { p.x = f.x + (q.x - f.x) * e; p.y = f.y + (q.y - f.y) * e; }
      }
      if (k < 1) requestAnimationFrame(step); else resolve();
    };
    requestAnimationFrame(step);
  });
}
function edgesOf(list) {
  const ids = new Set(list.map((p) => p.id));
  return [...new Set(S.world.links.filter((l) => ids.has(l.from) && ids.has(l.to) && l.from !== l.to).map((l) => (l.from < l.to ? `${l.from}|${l.to}` : `${l.to}|${l.from}`)))].map((k) => k.split('|').map(Number));
}
export async function tidy() {
  const list = projects();
  if (list.length < 2) { notify('Add a few projects first'); return; }
  const prev = list.map((p) => ({ id: p.id, x: p.x, y: p.y }));
  const next = tidyLayout(list, S.world.links);
  const edges = edgesOf(list);
  const before = crossings(new Map(prev.map((q) => [q.id, q])), edges), after = crossings(new Map(next.map((q) => [q.id, q])), edges);
  await animatePositions(next);
  ctx.renderer.fit();
  savePositions(next);
  undoEl?.remove();
  undoEl = h('div', { class: 'undo-bar', role: 'status' },
    h('span', null, `✨ Tidied: ${before} → ${after} pipe crossings`),
    h('button', { type: 'button', class: 'btn sm', onclick: async () => { undoEl?.remove(); undoEl = null; await animatePositions(prev); ctx.renderer.fit(); savePositions(prev); } }, 'Undo'));
  ctx.stage.append(undoEl);
  const mine = undoEl;
  setTimeout(() => { if (undoEl === mine) { mine.remove(); undoEl = null; } }, 12000);
}

// ---------- morning replay ----------
let prevSeen = null;
export function maybeMorningReplay() {
  if (store_ls.get('flowmap.replayDay', null) === S.today || !projects().length) return false;
  store_ls.set('flowmap.replayDay', S.today);
  setTimeout(morningReplay, 2400); // after the opening camera glide
  return true;
}
let replayEl = null;
export function morningReplay() {
  if (!projects().length) return;
  const yesterday = addDays(S.today, -1);
  const y = simulate(S.world, { today: yesterday, horizon: 0, scenario: 'stop' }).days[0];
  const now = snap(0);
  const rows = [];
  const highlight = [];
  for (const p of projects()) {
    const a = y.projects[p.id]?.health ?? 0, b = now.projects[p.id]?.health ?? 0;
    const recent = (d) => d === yesterday || d === S.today;
    const posts = S.world.logs.filter((l) => l.projectId === p.id && !l.sample && recent(l.day)).reduce((s, l) => s + (l.posts || 0), 0);
    const done = S.world.tasks.filter((t) => t.projectId === p.id && t.status === 'done' && recent(t.doneOn)).length;
    if (posts || done) highlight.push(p.id);
    rows.push({ p, a, b, d: b - a, posts, done, s: now.projects[p.id] });
  }
  ctx.renderer.replay?.(Object.fromEntries(rows.map((r) => [r.p.id, r.a])), highlight);
  const notes = (S.world.notes || []).filter((n) => !prevSeen || n.at > prevSeen);
  rows.sort((m, n) => Math.abs(n.d) - Math.abs(m.d) || m.b - n.b);
  const tod = ctx.renderer.timeOfDay?.();
  const hello = tod === 'dawn' || tod === 'day' ? '☀️ Good morning' : tod === 'evening' ? '🌇 Good evening' : '🌙 Welcome back';
  replayEl?.remove();
  replayEl = h('div', { class: 'replay-card', role: 'dialog', 'aria-label': 'Since yesterday' },
    h('div', { class: 'rh' }, h('b', null, hello), h('small', null, 'Since yesterday')),
    h('div', { class: 'rlist' }, rows.slice(0, 6).map((r) => {
      const up = r.d > 0.5, down = r.d < -0.5;
      const what = r.posts || r.done ? [r.posts ? `${r.posts} post${r.posts > 1 ? 's' : ''}` : '', r.done ? `${r.done} task${r.done > 1 ? 's' : ''} done` : ''].filter(Boolean).join(' · ')
        : r.s?.lastAction ? `no action · ${r.s.daysSince} days since the last` : 'no action yet';
      return h('button', { type: 'button', class: 'rrow', onclick: () => select({ type: 'project', id: r.p.id }) },
        h('span', null, r.p.icon || KINDS[r.p.kind]?.icon || '⬢'),
        h('span', { class: 'grow' }, h('b', null, r.p.name), h('small', null, what)),
        h('span', { class: `rd ${up ? 'up' : down ? 'down' : ''}` }, `${Math.round(r.b)}%`, h('small', null, up ? ` ▲${Math.round(r.d)}` : down ? ` ▼${Math.round(-r.d)}` : ' ·')));
    })),
    notes.length ? h('button', { type: 'button', class: 'rnotes', onclick: () => { replayEl?.remove(); openTab('focus'); } }, `🧠 ${notes.length} new note${notes.length > 1 ? 's' : ''} from scans and your AI →`) : null,
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn sm ghost', onclick: () => morningReplay() }, '↻ Replay'),
      h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'btn sm primary', onclick: () => { replayEl?.remove(); replayEl = null; } }, 'Got it')));
  ctx.stage.append(replayEl);
}

// ---------- week in review ----------
const weekStart = (day) => addDays(day, -((new Date(`${day}T12:00:00`).getDay() + 6) % 7));
export function maybeWeekReview() {
  const dow = new Date(`${S.today}T12:00:00`).getDay(); // 0 = Sunday
  if (dow !== 0 && dow !== 1) return;
  const wk = dow === 0 ? weekStart(S.today) : weekStart(addDays(S.today, -1));
  if (store_ls.get('flowmap.weekShown', null) === wk || !projects().length) return;
  store_ls.set('flowmap.weekShown', wk);
  setTimeout(openWeekReview, store_ls.get('flowmap.replayDay', null) === S.today ? 5200 : 2600);
}
export function openWeekReview() {
  const from = addDays(S.today, -6);
  const inWeek = (d) => d && d >= from && d <= S.today;
  const ago = simulate(S.world, { today: addDays(S.today, -7), horizon: 0, scenario: 'stop' }).days[0];
  const now = snap(0);
  const per = projects().map((p) => {
    const days = new Set();
    for (const t of S.world.tasks) if (t.projectId === p.id && t.status === 'done' && inWeek(t.doneOn) && !t.sample) days.add(t.doneOn);
    for (const l of S.world.logs) if (l.projectId === p.id && l.posts > 0 && inWeek(l.day) && !l.sample) days.add(l.day);
    const needed = Math.max(1, Math.round(7 / cadenceOf(p)));
    const isNew = (p.createdOn || '') > addDays(S.today, -7); // did not exist a week ago: no fair comparison
    const h1 = now.projects[p.id]?.health ?? 0;
    return { p, acted: days.size, needed, score: Math.min(1, days.size / needed), isNew, h0: isNew ? h1 : ago.projects[p.id]?.health ?? 0, h1 };
  });
  const compared = per.filter((r) => !r.isNew);
  const score = Math.round((per.reduce((a, r) => a + r.score, 0) / (per.length || 1)) * 100);
  const grade = score >= 90 ? 'Excellent week' : score >= 70 ? 'Good week' : score >= 50 ? 'Okay week' : 'The system needs care';
  const tasksDone = S.world.tasks.filter((t) => t.status === 'done' && inWeek(t.doneOn) && !t.sample).length;
  const posts = S.world.logs.filter((l) => inWeek(l.day) && !l.sample).reduce((a, l) => a + (l.posts || 0), 0);
  const money = S.world.logs.filter((l) => inWeek(l.day) && !l.sample && typeof l.money === 'number').reduce((a, l) => a + l.money, 0);
  const avg = (k, list = per) => list.reduce((a, r) => a + r[k], 0) / (list.length || 1);
  const dh = compared.length ? avg('h1', compared) - avg('h0', compared) : null;
  const best = [...(compared.length ? compared : per)].sort((a, b) => (b.h1 - b.h0) - (a.h1 - a.h0) || b.h1 - a.h1)[0];
  const worst = [...per].sort((a, b) => a.score - b.score || a.h1 - b.h1)[0];
  const stat = (label, value, cls = '') => h('div', null, h('small', null, label), h('b', { class: cls }, value));
  const body = h('div', { class: 'week' },
    h('div', { class: 'week-top' },
      h('div', { class: 'score-ring', style: { '--p': `${score}%` } }, h('span', null, h('b', null, score), h('small', null, 'score'))),
      h('div', null, h('h3', null, grade), h('p', { class: 'hint' }, `${fmtDay(from, false)} – ${fmtDay(S.today, false)}. The score is how well each project got the action its rhythm needs (a post, a promo, a finished task).`))),
    h('div', { class: 'kv' },
      stat('Tasks done', String(tasksDone)), stat('Posts', String(posts)), stat('Money logged', `TZS ${fmtNum(money)}`, 'm'),
      stat('Avg health', `${Math.round(avg('h1'))}%`), stat('Change', dh === null ? 'new this week' : `${dh >= 0 ? '+' : ''}${Math.round(dh)} pts`, dh >= 0 ? 'c' : ''), stat('Projects', String(per.length))),
    S.world.tasks.some((t) => t.sample) || S.world.logs.some((l) => l.sample) ? h('p', { class: 'hint' }, '🧪 Sample activity is not counted here, only what you really did.') : null,
    h('div', { class: 'h' }, 'Each project this week'),
    h('div', { class: 'week-list' }, per.sort((a, b) => b.score - a.score).map((r) => h('div', { class: 'wrow' },
      h('span', { class: 'wn' }, `${r.p.icon || KINDS[r.p.kind]?.icon || ''} ${r.p.name}`),
      h('div', { class: 'meter grow' }, h('i', { style: { width: `${Math.max(3, r.score * 100)}%`, background: r.score >= 1 ? '#46e58a' : r.score >= 0.5 ? '#f2d15c' : '#ff8a5c' } })),
      h('small', null, `${r.acted}/${r.needed}`),
      r.isNew ? h('small', null, 'new') : h('small', { class: r.h1 >= r.h0 ? 'up' : 'down' }, `${r.h1 >= r.h0 ? '▲' : '▼'}${Math.abs(Math.round(r.h1 - r.h0))}`)))),
    h('div', { class: 'grid2', style: 'margin-top:12px' },
      best ? h('div', { class: 'card' }, h('small', { class: 'hint' }, '🏅 Best this week'), h('div', null, h('b', null, best.p.name), best.isNew ? ` · ${Math.round(best.h1)}% health` : ` · health ${best.h1 >= best.h0 ? '+' : ''}${Math.round(best.h1 - best.h0)}`)) : null,
      worst ? h('div', { class: 'card' }, h('small', { class: 'hint' }, '💧 Needs you next week'), h('div', null, h('b', null, worst.p.name), ` · ${worst.acted} of ${worst.needed} actions`)) : null),
    h('div', { class: 'h' }, 'Plan next week'),
    h('div', { class: 'list' }, currentSuggestions(3).map((s) => h('div', { class: 'row', style: 'gap:8px;margin-bottom:6px' },
      h('span', { class: 'grow' }, s.title),
      h('button', { type: 'button', class: 'btn sm', onclick: () => openTaskEditor({ projectId: s.projectId, type: s.type, title: s.title }) }, '＋ Plan')))));
  openModal({ title: '📊 Week in review', body, wide: true, actions: [{ label: 'Close', kind: 'primary' }] });
}

// ---------- full screen ----------
const isImmersive = () => ctx.app.classList.contains('immersive');
function setImmersive(on) {
  ctx.app.classList.toggle('immersive', on);
  if (on) {
    // the real Fullscreen API where the browser allows it; the layout change alone works everywhere (iPhone too)
    const el = document.documentElement;
    ctx.fsEntered = false;
    el.requestFullscreen?.({ navigationUI: 'hide' }).then(() => { ctx.fsEntered = true; }).catch(() => {});
  } else if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  requestAnimationFrame(() => { ctx.renderer.resize(); ctx.renderer.fit(); });
  updateLiveBits();
}
export const toggleImmersive = () => setImmersive(!isImmersive());

let mini = null;
function buildMiniHud() {
  mini = { health: h('b'), money: h('b'), meter: h('i') };
  ctx.stage.append(h('div', { class: 'mini-hud' },
    h('div', null, h('small', null, 'Health'), mini.health, h('div', { class: 'meter' }, mini.meter)),
    h('div', null, h('small', null, 'Money / day'), mini.money),
    h('button', { class: 'btn sm', type: 'button', onclick: () => setImmersive(false), title: 'Exit full screen (F)' }, '⤡ Exit')));
}

// ---------- Today card ----------
let todayEl = null;
function buildToday() {
  todayEl = h('div', { class: 'today' });
  ctx.stage.append(todayEl);
}

// consecutive days with at least one real action (a finished task or a logged/scanned post)
function streakDays() {
  const days = new Set();
  for (const t of S.world.tasks) if (t.status === 'done' && t.doneOn && !t.sample) days.add(t.doneOn);
  for (const l of S.world.logs) if (l.posts > 0 && !l.sample) days.add(l.day);
  let d = days.has(S.today) ? S.today : addDays(S.today, -1);
  let n = 0;
  while (days.has(d)) { n++; d = addDays(d, -1); }
  return { n, today: days.has(S.today) };
}

export function updateToday() {
  if (!todayEl || !S.sim) return;
  const collapsed = store_ls.get('flowmap.todayCollapsed', window.innerWidth <= 760);
  const due = S.world.tasks.filter((t) => t.status !== 'done' && t.due && t.due <= S.today && project(t.projectId))
    .sort((a, b) => a.due.localeCompare(b.due));
  const doneToday = S.world.tasks.filter((t) => t.status === 'done' && t.doneOn === S.today).length;
  const total = doneToday + due.length;
  const { n: streak, today: actedToday } = streakDays();
  const frac = total ? doneToday / total : actedToday ? 1 : 0;
  const head = h('button', { type: 'button', class: 'today-head', 'aria-expanded': String(!collapsed), onclick: () => { store_ls.set('flowmap.todayCollapsed', !collapsed); updateToday(); } },
    h('span', { class: 'ring', style: { '--p': `${Math.round(frac * 100)}%` } }, h('span', null, total ? `${doneToday}/${total}` : actedToday ? '✓' : '0')),
    h('span', { class: 'grow' }, h('b', null, 'Today'), h('small', null, total ? `${doneToday} of ${total} done` : actedToday ? 'You watered something today' : 'Nothing done yet')),
    streak ? h('span', { class: 'streak', title: 'Days in a row with a finished task or a post' }, `🔥 ${streak}`) : null,
    h('span', { class: 'chev' }, collapsed ? '▸' : '▾'));
  clear(todayEl).append(head);
  todayEl.classList.toggle('collapsed', collapsed);
  if (collapsed) return;

  const list = h('div', { class: 'today-list' });
  for (const t of due.slice(0, 5)) {
    const p = project(t.projectId);
    const late = t.due < S.today;
    list.append(h('div', { class: 'trow' },
      h('button', { type: 'button', class: 'check', title: 'Done: water the project', 'aria-label': `Mark "${t.title}" done`, onclick: () => openActionDialog({ taskId: t.id }) }),
      h('button', { type: 'button', class: 'tt', onclick: () => { select({ type: 'project', id: p.id }); } },
        h('b', null, `${(TASK_TYPES[t.type] || TASK_TYPES.other).icon} ${t.title}`),
        h('small', { class: late ? 'late' : '' }, `${p.icon || KINDS[p.kind]?.icon || ''} ${p.name}${late ? ` · ${fmtDay(t.due, false)}` : ''}`))));
  }
  if (due.length > 5) list.append(h('button', { type: 'button', class: 'more-link', onclick: () => openTab('tasks') }, `+${due.length - 5} more`));
  if (!due.length) {
    const sug = currentSuggestions(1)[0];
    if (sug) {
      const p = project(sug.projectId);
      list.append(h('div', { class: 'tsug' }, h('small', null, 'Best thing to do next'), h('b', null, sug.title),
        h('button', { type: 'button', class: 'btn sm primary', onclick: () => openActionDialog({ projectId: p.id, type: sug.type }) }, '💧 I did it'),
        h('button', { type: 'button', class: 'btn sm', onclick: () => openTaskEditor({ projectId: p.id, type: sug.type, title: sug.title }) }, '＋ Plan it')));
    } else list.append(h('div', { class: 'hint' }, 'Everything is watered. 🌊'));
  }
  list.append(h('div', { class: 'row', style: 'margin-top:6px' },
    h('button', { type: 'button', class: 'btn sm ghost', onclick: () => openTaskEditor({}) }, '＋ Task'),
    h('button', { type: 'button', class: 'btn sm ghost', onclick: () => openWeekReview() }, '📊 Week'),
    h('span', { class: 'spacer' }),
    h('button', { type: 'button', class: 'btn sm ghost', onclick: () => openTab('tasks') }, 'All tasks →')));
  todayEl.append(list);
}

export function updateLiveBits() {
  if (!mini || !S.sim) return;
  const t = snap().totals;
  mini.health.textContent = `${Math.round(t.health)}%`;
  mini.meter.style.width = `${Math.max(2, t.health)}%`;
  mini.meter.style.background = t.health >= 75 ? '#46e58a' : t.health >= 50 ? '#f2d15c' : t.health >= 30 ? '#ffb84d' : '#ff4d5e';
  mini.money.textContent = `TZS ${fmtNum(t.money)}`;
}
