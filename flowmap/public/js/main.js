import { h, clear, fmtNum, fmtTZS, fmtDay, store_ls, pct } from './util.js';
import { auth, setUnauthorizedHandler } from './api.js';
import { S, snap, project, projects, on, loadAll, resetLocal, refreshToday, select, setTool, setOffset, setScenario, currentAlerts,
  HORIZON_DAYS, resetWorld, moveProject, addDays, hasSample } from './store.js';
import { RESOURCES, KINDS } from '/shared/engine.js';
import { createRenderer } from './renderer.js';
import { showAuth, brand } from './auth-ui.js';
import { initPanels, openTab } from './panels.js';
import { openProjectEditor, openLinkEditor, openActionDialog, openHelp, openSettings, dialogHooks } from './dialogs.js';
import { toast, closeAllModals, hasModal } from './ui-common.js';
import { sfx, sound } from './audio.js';

const $ = (id) => document.getElementById(id);
const boot = $('boot'), authEl = $('auth'), appEl = $('app');
let built = false;
let renderer = null;
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

async function enterApp(isNew) {
  await loadAll();
  appEl.hidden = false;
  if (!built) { built = true; buildApp(); }
  requestAnimationFrame(() => { renderer.resize(); renderer.fit({ animate: false }); });
  updateAll();
  boot.classList.add('gone');
  if (isNew || !store_ls.get('flowmap.seenHelp', false)) { store_ls.set('flowmap.seenHelp', true); setTimeout(openHelp, 400); }
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
function buildApp() {
  buildTopbar();
  buildLegend();
  buildZoom();
  buildTimeline();

  renderer = createRenderer($('map'), {
    onSelect: (sel) => { select(sel); if (sel?.type === 'project') hideTip(); },
    onMoved: (id, x, y) => moveProject(id, x, y),
    onHover: showTip,
    onAddAt: (x, y) => openProjectEditor(null, { x, y }),
    onLinkPicked: (from, to) => { setTool(null); openLinkEditor({ from, to }); },
    onToolHint: (t) => { hintText = t; updateTicker(); },
  });

  initPanels({ dock: $('dock'), tabs: $('tabs'), panel: $('panel') }, { renderer });

  on('sim', updateAll);
  on('offset', updateAll);
  on('world', updateAll);
  on('tool', () => { hintText = S.tool === 'link' ? 'Click the project that GIVES, then the one that RECEIVES' : ''; updateTopbarTool(); updateTicker(); });
  on('fit', () => renderer.fit());
  on('pulse', ({ task }) => renderer.burst(task));
  on('selection', () => { const s = S.selection; if (s?.type === 'project') renderer.focus(s.id); });

  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshToday(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !hasModal()) {
      if (S.tool) setTool(null); else if (S.selection) select(null); else $('dock').classList.remove('open');
    }
  });
  $('sheet-toggle').addEventListener('click', () => $('dock').classList.toggle('open'));
  $('stage').addEventListener('pointerdown', () => { if (window.innerWidth <= 760) $('dock').classList.remove('open'); });
  window.addEventListener('resize', () => renderer.resize());
}

function updateAll() {
  if (!S.sim) return;
  updateHud();
  updateTimeline();
  updateTicker();
  updateBanner();
  updateEmpty();
}

// ---------- top bar ----------
const hudEls = {};
function buildTopbar() {
  const stat = (key, cls, label) => {
    const val = h('b', null, '–'), delta = h('span', { class: 'delta' });
    hudEls[key] = { val, delta };
    return h('div', { class: `stat ${cls}` }, h('small', null, label), h('div', { class: 'row', style: 'gap:6px' }, val, delta));
  };
  const meterFill = h('i');
  hudEls.meter = meterFill; hudEls.healthVal = h('b', null, '–');
  const linkBtn = h('button', { class: 'btn', id: 'tool-link', onclick: () => setTool(S.tool === 'link' ? null : 'link') }, '🔗', h('span', { class: 'lbl-txt' }, 'Connect'));
  const soundBtn = h('button', { class: 'btn icon', title: 'Sound', onclick: (e) => { sound.enabled = !sound.enabled; e.currentTarget.textContent = sound.enabled ? '🔊' : '🔇'; if (sound.enabled) sfx.pop(); } }, sound.enabled ? '🔊' : '🔇');
  clear($('topbar')).append(
    brand(),
    h('div', { class: 'hud' },
      stat('money', 'money', 'Money / day'), stat('attention', 'attention', 'Attention / day'), stat('customers', 'customers', 'Customers / day'), stat('net', '', 'Net / day'),
      h('div', { class: 'stat' }, h('small', null, 'System health'), hudEls.healthVal, h('div', { class: 'meter' }, meterFill))),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', onclick: () => openProjectEditor(null) }, '＋', h('span', { class: 'lbl-txt' }, 'Project')),
      linkBtn,
      h('button', { class: 'btn', onclick: () => openTab('checkin') }, '📝', h('span', { class: 'lbl-txt' }, 'Check-in')),
      soundBtn,
      h('button', { class: 'btn icon', title: 'How it works', onclick: openHelp }, '❓'),
      h('button', { class: 'btn icon', title: 'Settings & data', onclick: openSettings }, '⚙️')));
}
function updateTopbarTool() { $('tool-link')?.classList.toggle('on', S.tool === 'link'); }

function updateHud() {
  const t = snap().totals, t0 = snap(0).totals;
  const set = (key, text, now, base, invert) => {
    hudEls[key].val.textContent = text;
    const d = hudEls[key].delta;
    if (S.offset > 0 && Math.abs(base) > 0.01) {
      const ch = (now - base) / Math.abs(base);
      d.textContent = `${ch >= 0 ? '▲' : '▼'}${Math.abs(Math.round(ch * 100))}%`;
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
  if (hintText) host.append(h('div', { class: 'tool-hint' }, hintText, ' ', h('button', { class: 'btn sm', style: 'margin-left:8px', onclick: () => setTool(null) }, 'Cancel')));
  const a = currentAlerts().find((x) => x.level === 'critical') || currentAlerts().find((x) => x.level === 'warn' && x.projectId);
  if (a && !hintText) {
    host.append(h('div', { class: `ticker${a.level === 'warn' ? ' warn' : ''}`, role: 'alert' },
      h('span', { style: 'font-size:22px' }, a.level === 'critical' ? '🚨' : '⚠️'),
      h('div', { class: 'txt' }, h('b', null, a.title), h('span', null, a.detail)),
      a.action?.type === 'water' ? h('button', { class: 'btn sm primary', onclick: () => openActionDialog({ projectId: a.projectId }) }, '💧 Water') : null,
      a.projectId ? h('button', { class: 'btn sm', onclick: () => { select({ type: 'project', id: a.projectId }); } }, 'Show') : null));
  }
}
function updateBanner() {
  const b = $('future-banner');
  b.hidden = S.offset === 0;
  if (S.offset) b.textContent = `🔮 FUTURE VIEW · ${fmtDay(snap().day)} · ${SCEN[S.scenario]}`;
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
function buildLegend() {
  const row = (k, text) => h('div', null, h('i', { class: 'dot', style: { background: RESOURCES[k].color, color: RESOURCES[k].color } }), h('b', null, RESOURCES[k].label), ` ${text}`);
  clear($('legend')).append(row('money', '· TZS'), row('attention', '· views'), row('customers', '· paying users'), row('progress', '· speed-ups'));
}
function buildZoom() {
  clear($('zoom')).append(
    h('button', { class: 'btn', title: 'Zoom in', onclick: () => renderer.zoomBy(1.25) }, '＋'),
    h('button', { class: 'btn', title: 'Zoom out', onclick: () => renderer.zoomBy(0.8) }, '－'),
    h('button', { class: 'btn', title: 'Fit everything', onclick: () => renderer.fit() }, '⤢'));
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
function stopPlay() { if (playTimer) { clearInterval(playTimer); playTimer = null; if (tl.play) tl.play.textContent = '▶'; } }
function buildTimeline() {
  tl.range = h('input', { type: 'range', min: 0, max: 90, value: 0, 'aria-label': 'Time travel', oninput: (e) => { stopPlay(); setOffset(Number(e.target.value)); } });
  tl.play = h('button', { class: 'btn icon', title: 'Play the future', onclick: () => {
    if (playTimer) { stopPlay(); return; }
    if (S.offset >= 90) setOffset(0);
    tl.play.textContent = '⏸';
    playTimer = setInterval(() => { if (S.offset >= 90) { stopPlay(); return; } setOffset(S.offset + 1); }, 130);
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
