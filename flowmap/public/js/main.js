import { h, clear, fmtNum, fmtTZS, fmtDay, store_ls, pct, setText } from './util.js';
import { auth, setUnauthorizedHandler } from './api.js';
import { S, snap, dayFraction, project, projects, on, loadAll, resetLocal, refreshToday, select, setTool, setOffset, setScenario, currentAlerts,
  HORIZON_DAYS, resetWorld, moveProject, addDays, hasSample } from './store.js';
import { RESOURCES, KINDS } from '/shared/engine.js';
import { createRenderer as createRenderer2d } from './renderer.js';
import { showAuth, brand } from './auth-ui.js';
import { initPanels, openTab, render as renderPanels } from './panels.js';
import { openProjectEditor, openLinkEditor, openActionDialog, openHelp, openSettings, dialogHooks } from './dialogs.js';
import { toast, closeAllModals, hasModal } from './ui-common.js';
import { sfx, sound } from './audio.js';
import { openBrainSettings } from './brain-ui.js';
import { getMapStyle } from './mapstyle.js';
import { initMapUi, setMapRenderer, tankAction, openContextMenu, openViewMenu, toggleImmersive, updateToday, updateLiveBits, maybeMorningReplay, maybeWeekReview, toggleClean } from './map-ui.js';

const $ = (id) => document.getElementById(id);
const boot = $('boot'), authEl = $('auth'), appEl = $('app');
let built = false;
let renderer = null;
let mapHooks = null;
let switching = false;
const panelCtrl = { renderer: null };
let hintText = '';
let playTimer = null;

const SCEN = { planned: 'Planned tasks', keep: 'Keep my pace', stop: 'Stop posting' };

on('toast', ({ message, kind }) => toast(message, kind));
dialogHooks.logout = () => logout();

async function logout() {
  auth.token = null;
  stopPlay();
  resetLocal();
  appEl.hidden = true;
  clear(authEl);
  showAuth(authEl, (isNew) => enterApp(isNew));
}
setUnauthorizedHandler(() => { closeAllModals(); logout(); });

// The cards are plain DOM on a flat floor. The glass tanks need WebGL 2; older devices get the flat map.
async function makeRenderer(canvas, hooks) {
  if (getMapStyle() === 'cards') {
    try { return (await import('./cards.js')).createRenderer(canvas, hooks); } catch (e) { console.warn('Card view unavailable', e); }
  }
  try {
    const m = await import('./renderer3d.js');
    if (m.webglAvailable()) return m.createRenderer(canvas, hooks);
  } catch (e) { console.warn('3D map unavailable, using the flat map', e); }
  return createRenderer2d(canvas, hooks);
}

async function enterApp(isNew) {
  await loadAll();
  appEl.hidden = false;
  if (!built) { built = true; await buildApp(); }
  requestAnimationFrame(() => { renderer.resize(); if (renderer.intro) renderer.intro(); else renderer.fit({ animate: false }); });
  updateAll();
  boot.classList.add('gone');
  setMode(store_ls.get('flowmap.mode', 'tracker'));
  if (isNew || !store_ls.get('flowmap.seenHelp', false)) { store_ls.set('flowmap.seenHelp', true); setTimeout(openHelp, 400); }
  else if (renderer.replay) { maybeMorningReplay(); maybeWeekReview(); }
  if (sound.enabled && currentAlerts().some((a) => a.level === 'critical')) setTimeout(sfx.alarm, 700);
}

async function start() {
  if (auth.token) {
    try { await enterApp(false); return; } catch { auth.token = null; }
  }
  boot.classList.add('gone');
  showAuth(authEl, (isNew) => enterApp(isNew));
}

// ======================= app shell =======================
async function buildApp() {
  buildTopbar();
  buildTimeline();

  renderer = await makeRenderer($('map'), mapHooks = {
    onSelect: (sel) => { select(sel); if (sel?.type === 'project') hideTip(); },
    onMoved: (id, x, y) => moveProject(id, x, y),
    onHover: showTip,
    onAddAt: (x, y) => openProjectEditor(null, { x, y }),
    onLinkPicked: (from, to) => { setTool(null); openLinkEditor({ from, to }); },
    onToolHint: (t) => { hintText = t; updateTicker(); },
    onTankAction: (action, id) => tankAction(action, id),
    onContext: (target, x, y) => { hideTip(); openContextMenu(target, x, y); },
  });

  window.__flowmapRenderer = renderer; // handy in the browser console, and for automated checks
  initMapUi({ renderer, stage: $('stage'), app: appEl });
  buildZoom();
  buildLegend();
  initPanels({ dock: $('dock'), tabs: $('tabs'), panel: $('panel') }, panelCtrl);
  panelCtrl.renderer = renderer;
  window.addEventListener('flowmap-mapstyle', () => switchMapStyle());
  setInterval(updateLive, 1000);

  on('sim', updateAll);
  on('offset', updateAll);
  on('world', updateAll);
  on('tool', () => { hintText = S.tool === 'link' ? 'Click the project that GIVES, then the one that RECEIVES' : ''; updateTopbarTool(); updateTicker(); });
  on('fit', () => renderer.fit());
  on('pulse', ({ task }) => renderer.burst(task));
  on('selection', () => { const s = S.selection; if (s?.type === 'project') renderer.focus(s.id); });

  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshToday(); });
  window.addEventListener('flowmap-theme', () => { renderPanels(); updateAll(); }); // charts and inline colours redraw
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !hasModal()) {
      if (S.tool) setTool(null); else if (S.selection) select(null); else $('dock').classList.remove('open');
    }
  });
  $('sheet-toggle').addEventListener('click', () => $('dock').classList.toggle('open'));
  $('stage').addEventListener('pointerdown', () => { if (window.innerWidth <= 760) $('dock').classList.remove('open'); });
  window.addEventListener('resize', () => renderer.resize());
}

// Swap the map picture in place. A canvas that once held WebGL cannot give a 2D context (or the other way
// round), so the old canvas is replaced by a fresh one.
async function switchMapStyle() {
  if (switching || !renderer) return;
  switching = true;
  try {
    hideTip();
    renderer.destroy();
    const old = $('map'), fresh = old.cloneNode(false);
    old.replaceWith(fresh);
    renderer = await makeRenderer(fresh, mapHooks);
    window.__flowmapRenderer = renderer;
    panelCtrl.renderer = renderer;
    setMapRenderer(renderer);
    buildZoom();
    buildLegend();
    requestAnimationFrame(() => { renderer.resize(); if (renderer.intro) renderer.intro(); else renderer.fit({ animate: false }); });
    const s = S.selection;
    if (s?.type === 'project') setTimeout(() => renderer.focus(s.id), 900);
    toast(renderer.kind === 'cards' ? '🃏 Card view' : renderer.is3d ? '🫧 Glass tanks view' : 'Flat map view', 'info');
  } finally { switching = false; }
}

function updateAll() {
  if (!S.sim) return;
  updateHud();
  updateTimeline();
  updateTicker();
  updateBanner();
  updateEmpty();
  updateToday();
  updateLiveBits();
}

// ---------- top bar ----------
const hudEls = {};
function buildTopbar() {
  const stat = (key, cls, label) => {
    const val = h('b', null, '–'), delta = h('span', { class: 'delta' }), sofar = h('span', { class: 'sofar' });
    hudEls[key] = { val, delta, sofar };
    return h('div', { class: `stat ${cls}` }, h('small', null, label), h('div', { class: 'row', style: 'gap:6px' }, val, delta), sofar);
  };
  const meterFill = h('i');
  hudEls.meter = meterFill; hudEls.healthVal = h('b', null, '–');
  const linkBtn = h('button', { class: 'btn', id: 'tool-link', onclick: () => setTool(S.tool === 'link' ? null : 'link') }, '🔗', h('span', { class: 'lbl-txt' }, 'Connect'));
  const soundBtn = h('button', { class: 'btn icon', title: 'Sound', onclick: (e) => { sound.enabled = !sound.enabled; setText(e.currentTarget, sound.enabled ? '🔊' : '🔇'); if (sound.enabled) sfx.pop(); } }, sound.enabled ? '🔊' : '🔇');
  const modes = h('div', { class: 'modes', role: 'tablist', 'aria-label': 'Tracker or boards' },
    h('button', { type: 'button', role: 'tab', 'data-mode': 'tracker', onclick: () => setMode('tracker') }, '📊', h('span', { class: 'lbl-txt' }, 'Tracker')),
    h('button', { type: 'button', role: 'tab', 'data-mode': 'boards', onclick: () => setMode('boards') }, '🧩', h('span', { class: 'lbl-txt' }, 'Boards')));
  clear($('topbar')).append(
    brand(), modes,
    h('div', { class: 'hud' },
      stat('money', 'money', 'Money / day'), stat('attention', 'attention', 'Attention / day'), stat('customers', 'customers', 'Customers / day'), stat('net', '', 'Net / day'),
      h('div', { class: 'stat' }, h('small', null, 'System health'), hudEls.healthVal, h('div', { class: 'meter' }, meterFill))),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', onclick: () => openProjectEditor(null) }, '＋', h('span', { class: 'lbl-txt' }, 'Project')),
      linkBtn,
      h('button', { class: 'btn', onclick: () => openTab('checkin') }, '📝', h('span', { class: 'lbl-txt' }, 'Check-in')),
      h('button', { class: 'btn', title: 'AI brain: connect an AI that gives you tasks', onclick: () => openBrainSettings() }, '🧠', h('span', { class: 'lbl-txt' }, 'Brain')),
      soundBtn,
      h('button', { class: 'btn icon keep', title: 'How it works', onclick: openHelp }, '❓'),
      h('button', { class: 'btn icon keep', title: 'Settings & data', onclick: openSettings }, '⚙️')));
}
// ---------- tracker / boards ----------
let boardsUi = null;
async function setMode(mode) {
  const board = mode === 'boards';
  store_ls.set('flowmap.mode', board ? 'boards' : 'tracker');
  appEl.classList.toggle('board-mode', board);
  document.querySelectorAll('.modes [data-mode]').forEach((b) => { const on = b.dataset.mode === (board ? 'boards' : 'tracker'); b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
  $('boards-host').hidden = !board;
  if (board) {
    if (!boardsUi) boardsUi = (await import('./board/app.js')).createBoards($('boards-host'));
    boardsUi.show();
  } else {
    boardsUi?.hide();
    requestAnimationFrame(() => renderer?.resize());
  }
}
function updateTopbarTool() { $('tool-link')?.classList.toggle('on', S.tool === 'link'); }

// Real-time line under the money and attention stats: how much of today's flow has already come in.
function updateLive() {
  if (!S.sim || !hudEls.money) return;
  const f = dayFraction(), t = snap(0).totals;
  const line = (key, text) => { hudEls[key].sofar.textContent = S.offset ? '' : text; };
  line('money', `≈ TZS ${fmtNum(t.money * f)} so far today`);
  line('attention', `≈ ${fmtNum(t.attention * f)} so far today`);
  line('customers', '');
  line('net', '');
  if (!S.offset) updateHud();
  updateLiveBits();
}

function updateHud() {
  const t = snap().totals, t0 = snap(0).totals;
  const set = (key, text, now, base, invert) => {
    hudEls[key].val.textContent = text;
    const d = hudEls[key].delta;
    if (S.offset > 0 && Math.abs(base) > 0.01) {
      const ch = (now - base) / Math.abs(base);
      setText(d, `${ch >= 0 ? '▲' : '▼'}${Math.abs(Math.round(ch * 100))}%`);
      d.className = `delta ${(ch >= 0) !== !!invert ? 'up' : 'down'}`;
    } else { d.textContent = ''; d.className = 'delta'; }
  };
  set('money', fmtTZS(t.money), t.money, t0.money);
  set('attention', fmtNum(t.attention), t.attention, t0.attention);
  set('customers', fmtNum(t.customers), t.customers, t0.customers);
  set('net', fmtTZS(t.profit), t.profit, t0.profit);
  hudEls.healthVal.textContent = `${Math.round(t.health)}%`;
  hudEls.meter.style.width = `${Math.max(2, t.health)}%`;
  hudEls.meter.style.background = t.health >= 75 ? '#46e58a' : t.health >= 50 ? '#f2d15c' : t.health >= 30 ? '#ffb84d' : '#ff4d5e';
}

// ---------- ticker / banner / empty ----------
function updateTicker() {
  const host = $('stage-top');
  clear(host);
  // the future-view label sits in the same stack as alerts, so the two never cover each other
  if (S.offset) host.append(h('div', { class: 'future-banner inline' }, `⏩ FUTURE VIEW · ${fmtDay(snap().day)} · ${SCEN[S.scenario]}`));
  if (hintText) host.append(h('div', { class: 'tool-hint' }, hintText, ' ', h('button', { class: 'btn sm', style: 'margin-left:8px', onclick: () => setTool(null) }, 'Cancel')));
  const a = currentAlerts().find((x) => x.level === 'critical') || currentAlerts().find((x) => x.level === 'warn' && x.projectId);
  // minimized alerts stay small for the rest of the day; a different alert still shows in full
  const min = store_ls.get('flowmap.tickerMin', null);
  const minimized = a && min && min.id === a.id && min.day === S.today;
  const setMin = (on) => { store_ls.set('flowmap.tickerMin', on ? { id: a.id, day: S.today } : null); updateTicker(); };
  if (a && !hintText && minimized) {
    const others = currentAlerts().filter((x) => x.level === 'critical' || x.level === 'warn').length;
    host.append(h('button', { type: 'button', class: `ticker-pill${a.level === 'warn' ? ' warn' : ''}`, title: 'Show the alert', onclick: () => setMin(false) },
      a.level === 'critical' ? '🚨 ' : '⚠️ ', a.title, others > 1 ? h('span', { class: 'n' }, `+${others - 1}`) : null));
  } else if (a && !hintText) {
    host.append(h('div', { class: `ticker${a.level === 'warn' ? ' warn' : ''}`, role: 'alert' },
      h('span', { style: 'font-size:22px' }, a.level === 'critical' ? '🚨' : '⚠️'),
      h('div', { class: 'txt' }, h('b', null, a.title), h('span', null, a.detail)),
      a.action?.type === 'water' ? h('button', { class: 'btn sm primary', onclick: () => openActionDialog({ projectId: a.projectId }) }, '💧 Water') : null,
      a.projectId ? h('button', { class: 'btn sm', onclick: () => { select({ type: 'project', id: a.projectId }); } }, 'Show') : null,
      h('button', { type: 'button', class: 'ticker-x', title: 'Minimize', 'aria-label': 'Minimize this alert', onclick: () => setMin(true) }, '✕')));
  }
}
function updateBanner() {
  $('future-banner').hidden = true; // shown inside the alert stack instead (see updateTicker)
}
function updateEmpty() {
  const e = $('empty');
  const none = projects().length === 0;
  e.hidden = !none;
  if (none && !e.firstChild) {
    e.append(h('h3', null, 'Your map is empty'), h('div', null, 'Add your first project, or load the creator template.'),
      h('div', { class: 'row', style: 'justify-content:center' },
        h('button', { class: 'btn primary', onclick: () => openProjectEditor(null) }, '＋ Add a project'),
        h('button', { class: 'btn', onclick: () => resetWorld('creator') }, 'Load creator template')));
  } else if (!none) clear(e);
}

// ---------- legend, zoom ----------
const LEGEND_TEXT = { money: '· TZS', attention: '· views', customers: '· paying users', progress: '· speed-ups' };
function buildLegend() {
  const row = (k, name) => h('div', null, h('i', { class: 'dot', style: { background: RESOURCES[k].color, color: RESOURCES[k].color } }), h('b', null, name || RESOURCES[k].label), ` ${LEGEND_TEXT[k]}`);
  if (renderer?.legendNote) return clear($('legend')).append(...renderer.legendNote.map(([ic, name, text]) => h('div', { class: 'ln' }, h('span', { class: `sw sw-${ic}` }, ic === 'health' ? '90%' : ''), h('b', null, name), ` · ${text}`)));
  const rows = renderer?.legend ? renderer.legend.map(([k, name]) => row(k, name)) : ['money', 'attention', 'customers', 'progress'].map((k) => row(k));
  clear($('legend')).append(...rows);
}
function buildZoom() {
  clear($('zoom')).append(...[
    h('button', { class: 'btn', title: 'Zoom in', 'aria-label': 'Zoom in', onclick: () => renderer.zoomBy(1.25) }, '＋'),
    h('button', { class: 'btn', title: 'Zoom out', 'aria-label': 'Zoom out', onclick: () => renderer.zoomBy(0.8) }, '－'),
    h('button', { class: 'btn', title: 'Fit everything', 'aria-label': 'Fit everything', onclick: () => renderer.fit() }, '⤢'),
    h('button', { class: 'btn', title: 'Full screen (F)', 'aria-label': 'Full screen', onclick: () => toggleImmersive() }, '⛶'),
    h('button', { class: 'btn', title: 'Clean view (C): full screen, only the system, alerts pulse on the cards', 'aria-label': 'Clean view', onclick: () => toggleClean() }, 'i:scan'),
    renderer.openLook ? h('button', { class: 'btn', title: 'Look: floor, pipes, cards, theme', 'aria-label': 'Change the look', onclick: (e) => renderer.openLook(e.currentTarget) }, '🎨') : null,
    renderer.replay ? h('button', { class: 'btn', title: 'View: map style, tidy up, areas, replay, week', 'aria-label': 'More view options', onclick: (e) => openViewMenu(e.currentTarget) }, '⋯') : null,
  ].filter(Boolean));
}

// ---------- tooltip ----------
function hideTip() { $('tip').hidden = true; }
function showTip(info, x, y) {
  const tip = $('tip');
  if (!info) { tip.hidden = true; return; }
  const sn = snap();
  clear(tip);
  if (info.type === 'node') {
    const p = project(info.id), s = sn.projects[info.id];
    if (!p || !s) { tip.hidden = true; return; }
    tip.append(h('b', null, `${p.icon || KINDS[p.kind].icon} ${p.name}`), h('span', { class: 'k' }, `${KINDS[p.kind].label} · ${Math.round(s.health)}% ${s.status}`),
      s.money > 0.5 ? h('span', { style: { color: RESOURCES.money.color } }, `TZS ${fmtNum(s.money)} / day`) : null,
      s.attention > 0.5 ? h('span', { style: { color: RESOURCES.attention.color } }, `${fmtNum(s.attention)} views / day`) : null,
      s.customers >= 0.05 ? h('span', { style: { color: RESOURCES.customers.color } }, `${fmtNum(s.customers)} customers / day`) : null,
      h('span', { class: 'k' }, 'Click to inspect · drag to move'));
  } else {
    const l = S.world.links.find((q) => q.id === info.id), o = sn.links[info.id];
    if (!l || !o) { tip.hidden = true; return; }
    const R = RESOURCES[l.resource];
    tip.append(h('b', { style: { color: R.color } }, `${project(l.from).name} → ${project(l.to).name}`), h('span', { class: 'k' }, `${R.label} pipe · ${pct(l.share)} wide`),
      h('span', null, `Boost ${o.boost >= 1 ? '+' : ''}${Math.round((o.boost - 1) * 100)}%`), h('span', { class: 'k' }, 'Click to edit'));
  }
  tip.hidden = false;
  const w = tip.offsetWidth, hgt = tip.offsetHeight;
  tip.style.left = `${Math.min(window.innerWidth - w - 8, x + 16)}px`;
  tip.style.top = `${Math.min(window.innerHeight - hgt - 8, y + 16)}px`;
}

// ---------- timeline ----------
const tl = {};
function stopPlay() { if (playTimer) { clearInterval(playTimer); playTimer = null; if (tl.play) setText(tl.play, '▶'); } }
function buildTimeline() {
  tl.range = h('input', { type: 'range', min: 0, max: 90, value: 0, 'aria-label': 'Time travel', oninput: (e) => { stopPlay(); setOffset(Number(e.target.value)); } });
  tl.play = h('button', { class: 'btn icon', title: 'Play the future', onclick: () => {
    if (playTimer) { stopPlay(); return; }
    if (S.offset >= 90) setOffset(0);
    setText(tl.play, '⏸');
    playTimer = setInterval(() => { if (S.offset >= 90) { stopPlay(); return; } setOffset(S.offset + 1); }, 700);
  } }, '▶');
  tl.seg = h('div', { class: 'seg' }, Object.entries(SCEN).map(([k, label]) => h('button', { dataset: { k }, title: k === 'planned' ? 'Only the tasks on your list happen' : k === 'keep' ? 'You keep posting at each project\'s rhythm' : 'Nothing more happens', onclick: () => setScenario(k) }, label)));
  tl.when = h('div', { class: 'when' });
  tl.jump = h('div', { class: 'row', style: 'gap:4px' }, [['Today', 0], ['+7d', 7], ['+30d', 30], ['+90d', 90]].map(([t, n]) => h('button', { class: 'btn sm ghost', onclick: () => { stopPlay(); setOffset(n); } }, t)));
  clear($('timeline')).append(tl.play, tl.seg, h('div', { class: 'track' }, tl.range, h('div', { class: 'ticks' }, h('span', null, 'Today'), h('span', null, '+30d'), h('span', null, '+60d'), h('span', null, '+90d'))), tl.jump, tl.when);
}
function updateTimeline() {
  if (!tl.range) return;
  tl.range.value = S.offset;
  for (const b of tl.seg.children) b.classList.toggle('on', b.dataset.k === S.scenario);
  const d = snap();
  clear(tl.when).append(h('b', null, S.offset === 0 ? 'Today' : `+${S.offset} days`), h('small', null, fmtDay(d.day)));
  $('timeline').classList.toggle('future', S.offset > 0);
}

start();
