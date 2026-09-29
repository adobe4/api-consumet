// Things you do straight on the map: quick actions on a tank, the right-click / long-press menu,
// the "Today" card (tasks, progress, streak) and full-screen mode.
import { h, clear, fmtNum, fmtDay, store_ls } from './util.js';
import { S, project, select, setTool, notify, snap, currentSuggestions, scanProject, deleteLink, addDays } from './store.js';
import { KINDS, TASK_TYPES } from '/shared/engine.js';
import { openProjectEditor, openLinkEditor, openActionDialog, openTaskEditor } from './dialogs.js';
import { confirmDialog } from './ui-common.js';
import { openTab } from './panels.js';

let ctx = { renderer: null, stage: null, app: null };
let menuEl = null;

export function initMapUi({ renderer, stage, app }) {
  ctx = { renderer, stage, app };
  buildToday();
  buildMiniHud();
  document.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea, select, [contenteditable]') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleImmersive(); }
    if (e.key === 'Escape') closeMenu();
  });
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && app.classList.contains('immersive') && ctx.fsEntered) setImmersive(false); });
  document.addEventListener('pointerdown', (e) => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }, true);
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

// ---------- context menu ----------
function closeMenu() { menuEl?.remove(); menuEl = null; }
export function openContextMenu(target, x, y) {
  closeMenu();
  const item = (icon, label, fn, cls = '') => h('button', { type: 'button', class: `mi ${cls}`, role: 'menuitem', onclick: () => { closeMenu(); fn(); } }, h('span', { class: 'mic' }, icon), label);
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
      item('ⓘ', 'Details', () => tankAction('details', p.id)),
    ];
  } else if (target.type === 'link') {
    const l = S.world.links.find((q) => q.id === target.id);
    if (!l) return;
    title = `${project(l.from)?.name} → ${project(l.to)?.name}`;
    items = [
      item('✎', 'Edit pipe', () => openLinkEditor({ id: l.id }), 'primary'),
      item('↦', `Open ${project(l.from)?.name}`, () => select({ type: 'project', id: l.from })),
      item('⇥', `Open ${project(l.to)?.name}`, () => select({ type: 'project', id: l.to })),
      item('🗑', 'Remove pipe', async () => { if (await confirmDialog({ title: 'Remove this pipe?', message: `${project(l.from)?.name} will stop feeding ${project(l.to)?.name}.`, confirm: 'Remove', danger: true })) deleteLink(l.id); }, 'danger'),
    ];
  } else {
    title = 'Here';
    items = [
      item('＋', 'Add a project here', () => openProjectEditor(null, { x: target.x, y: target.y }), 'primary'),
      item('✅', 'Plan a task', () => openTaskEditor({})),
      item('⤢', 'Fit everything', () => ctx.renderer.fit()),
      item('⛶', isImmersive() ? 'Exit full screen' : 'Full screen', () => toggleImmersive()),
    ];
  }
  menuEl = h('div', { class: 'ctxmenu', role: 'menu' }, h('div', { class: 'mt' }, title), ...items);
  document.body.append(menuEl);
  const r = menuEl.getBoundingClientRect();
  menuEl.style.left = `${Math.max(8, Math.min(window.innerWidth - r.width - 8, x))}px`;
  menuEl.style.top = `${Math.max(8, Math.min(window.innerHeight - r.height - 8, y))}px`;
  menuEl.querySelector('.mi')?.focus({ preventScroll: true });
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
