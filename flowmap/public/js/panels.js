// The side dock: Focus (inspector), Tasks, Check-in, Forecast and Alerts.
import { h, clear, fmtNum, fmtTZS, fmtDay, relDay, pct, store_ls } from './util.js';
import { S, snap, project, projects, nameOf, on, select as selectItem, currentAlerts, currentSuggestions, scenarios, HORIZON_DAYS,
  setOffset, setScenario, saveLogs, spreadMonth, clearSample, hasSample, logFor, addTask, completeTask, reopenTask, updateTask, notify, addDays,
  scanProject, scanAllChannels, runBrain, dismissNote } from './store.js';
import { PLATFORMS } from '/shared/sources.js';
import { openBrainSettings } from './brain-ui.js';
import { KINDS, RESOURCES, TASK_TYPES, dayNum } from '/shared/engine.js';
import { sparkline, feelPicker, field, numInput, select as selectEl } from './ui-common.js';
import { lineChart } from './charts.js';
import { openProjectEditor, openLinkEditor, openActionDialog, openTaskEditor, HEAL_TYPES } from './dialogs.js';
import { sfx } from './audio.js';

const TABS = [['focus', '🎯 Focus'], ['tasks', '✅ Tasks'], ['checkin', '📝 Check-in'], ['forecast', '📈 Forecast'], ['alerts', '🚨 Alerts']];
const SCEN = { planned: 'Planned tasks only', keep: 'Keep my pace', stop: 'Stop posting' };
const SCEN_COLOR = { planned: '#ffc933', keep: '#46e58a', stop: '#ff4d5e' };
const METRICS = { money: ['Money/day', '#ffc933'], profit: ['Net/day', '#c0f06a'], attention: ['Attention/day', '#ff8a3d'], customers: ['Customers/day', '#46e58a'], health: ['Health', '#ff5fa2'] };

let ctrl = { renderer: null };
let tab = store_ls.get('flowmap.tab', 'focus');
let els = {};
let taskFilter = { status: 'open', project: 'all' };
let checkinDay = null;
let drafts = {};
let metric = 'money';
let dirtyInput = false;
let lastViewKey = '';

const resColor = (r) => RESOURCES[r].color;
const kindOf = (p) => KINDS[p.kind] || KINDS.custom;
const colorOf = (p) => p.color || kindOf(p).color;
const iconOf = (p) => p.icon || kindOf(p).icon;
const dot = (color) => h('i', { class: 'dot', style: { background: color } });
const pill = (status, text) => h('span', { class: `pill ${status}` }, text || status);
const fmtAmount = (res, v) => (res === 'money' ? `TZS ${fmtNum(v)}/d` : res === 'attention' ? `${fmtNum(v)} views/d` : res === 'customers' ? `${fmtNum(v)} cust/d` : `${Math.round(v * 100)}%`);
const healthColor = (v) => (v >= 75 ? '#46e58a' : v >= 50 ? '#f2d15c' : v >= 30 ? '#ffb84d' : '#ff4d5e');
const kvBox = (cls, label, value) => h('div', null, h('small', null, label), h('b', { class: cls }, value));
const healthBar = (v) => h('div', { class: 'meter' }, h('i', { style: { width: `${Math.max(2, v)}%`, background: healthColor(v) } }));

export function initPanels(elements, controller) {
  els = elements;
  ctrl = controller;
  renderTabs();
  on('world', () => refresh());
  on('sim', () => refresh());
  on('selection', () => { if (S.selection && tab !== 'focus') tab = 'focus'; render(); });
  on('offset', () => { if (tab === 'forecast' || tab === 'focus') refresh(); });
  els.panel.addEventListener('focusin', (e) => { dirtyInput = e.target.matches('input, textarea, select'); });
  els.panel.addEventListener('focusout', () => { dirtyInput = false; });
  render();
}

export function openTab(name) {
  tab = name;
  store_ls.set('flowmap.tab', name);
  render();
  els.dock.classList.add('open');
}

function refresh() {
  if (dirtyInput && els.panel.contains(document.activeElement)) { renderTabs(); return; }
  render();
}

function renderTabs() {
  const n = currentAlerts().filter((a) => a.level === 'critical' || a.level === 'warn').length;
  clear(els.tabs).append(...TABS.map(([k, label]) => h('button', {
    role: 'tab', class: tab === k ? 'on' : '', 'aria-selected': tab === k,
    onclick: () => { tab = k; store_ls.set('flowmap.tab', k); render(); },
  }, label, k === 'alerts' && n ? h('span', { class: 'badge' }, n) : null)));
}

export function render() {
  if (!S.sim) return;
  // keep the scroll position while the same view refreshes; start at the top when the view changes
  const viewKey = `${tab}:${S.selection ? `${S.selection.type}${S.selection.id}` : ''}`;
  const top = viewKey === lastViewKey ? els.panel.scrollTop : 0;
  lastViewKey = viewKey;
  clear(els.panel);
  const view = { focus: focusPanel, tasks: tasksPanel, checkin: checkinPanel, forecast: forecastPanel, alerts: alertsPanel }[tab] || focusPanel;
  els.panel.append(view());
  els.panel.scrollTop = top;
  renderTabs();
}

// ======================= FOCUS =======================
function focusPanel() {
  const sel = S.selection;
  if (sel?.type === 'project' && project(sel.id)) return projectInspector(project(sel.id));
  if (sel?.type === 'link' && S.world.links.find((l) => l.id === sel.id)) return linkInspector(S.world.links.find((l) => l.id === sel.id));
  return overview();
}

function overview() {
  const sn = snap();
  const t = sn.totals;
  const wrap = h('div');
  if (hasSample()) wrap.append(h('div', { class: 'banner' }, h('span', { class: 'grow' }, '🧪 Sample activity is loaded so you can see the system move. Your numbers are placeholders: edit them anytime.'),
    h('button', { class: 'btn sm', onclick: async () => { await clearSample(); notify('Sample activity cleared', 'good'); } }, 'Clear')));
  wrap.append(
    h('div', { class: 'h' }, S.offset ? `System in +${S.offset} days` : 'System today'),
    h('div', { class: 'kv' },
      kvBox('m', 'Money / day', fmtTZS(t.money)), kvBox('a', 'Attention / day', fmtNum(t.attention)), kvBox('c', 'Customers / day', fmtNum(t.customers)),
      kvBox('', 'Costs / day', fmtTZS(t.cost)), kvBox(t.profit >= 0 ? 'c' : '', 'Net / day', fmtTZS(t.profit)), kvBox('', 'Avg health', `${Math.round(t.health)}%`)),
  );
  const sug = currentSuggestions(4);
  wrap.append(h('div', { class: 'h' }, '💧 Water next'));
  if (!sug.length) wrap.append(h('div', { class: 'card' }, 'Everything is well watered. 🌊 Keep the rhythm going.'));
  for (const s of sug) {
    const p = project(s.projectId);
    wrap.append(h('div', { class: 'card' },
      h('div', { class: 'row', style: 'margin-bottom:8px' }, dot(colorOf(p)), h('b', { class: 'grow' }, p.name), pill(snap(0).projects[p.id].status, `${Math.round(s.health)}%`)),
      h('div', { style: 'color:var(--muted);margin-bottom:9px;font-size:12.5px' }, s.title),
      h('div', { class: 'row' },
        h('button', { class: 'btn sm primary', onclick: () => openActionDialog({ projectId: p.id, type: s.type }) }, '💧 I did it'),
        h('button', { class: 'btn sm', onclick: () => openTaskEditor({ projectId: p.id, type: s.type, title: s.title }) }, '＋ Add as task'),
        h('button', { class: 'btn sm ghost', onclick: () => { selectItem({ type: 'project', id: p.id }); ctrl.renderer?.focus(p.id); } }, 'Open'))));
  }
  wrap.append(brainFeed());
  wrap.append(h('div', { class: 'h', style: 'margin-top:16px' }, 'Health map'));
  const list = [...projects()].sort((a, b) => sn.projects[a.id].health - sn.projects[b.id].health);
  for (const p of list) {
    const s = sn.projects[p.id];
    wrap.append(h('div', { class: 'flow-row', onclick: () => { selectItem({ type: 'project', id: p.id }); ctrl.renderer?.focus(p.id); } },
      dot(colorOf(p)), h('span', { style: 'width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, p.name),
      h('div', { class: 'meter grow', style: 'flex:1;margin:0' }, h('i', { style: { width: `${Math.max(2, s.health)}%`, background: healthColor(s.health) } })),
      h('span', { class: 'amt', style: { color: healthColor(s.health) } }, `${Math.round(s.health)}%`)));
  }
  wrap.append(h('div', { class: 'card', style: 'margin-top:14px;color:var(--muted);font-size:12.5px;line-height:1.5' },
    '👆 Click a project to inspect it. Drag to rearrange. Double-click empty space to add a project. Click a pipe to edit what flows through it.'));
  return wrap;
}

// ---------- brain feed ----------
const WHO = { ai: ['🧠', 'AI brain'], scan: ['📡', 'Channel scan'], you: ['🙂', 'You'] };
const whoOf = (source) => WHO[source] || (source?.startsWith('agent:') ? ['🤖', source.slice(6)] : ['🧠', source || 'AI']);
const ago = (iso) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
function noteItem(n, withProject = true) {
  const [icon, who] = whoOf(n.source);
  const p = n.projectId ? project(n.projectId) : null;
  return h('div', { class: `note ${n.kind}` },
    h('span', { class: 'who', title: who }, icon),
    h('div', null, n.text, h('span', { class: 'meta' }, `${who} · ${ago(n.at)}${withProject && p ? ` · ${p.name}` : ''}`)),
    h('button', { class: 'x', title: 'Dismiss', 'aria-label': 'Dismiss note', onclick: () => dismissNote(n.id) }, '✕'));
}
function brainFeed() {
  const notes = (S.world.notes || []).slice(0, 8);
  const hasAi = S.user?.hasAiKey;
  const busy = h('span', { class: 'hint' });
  const run = async (btn, fn, label) => {
    btn.disabled = true; busy.textContent = label;
    try { await fn(); } catch (e) { notify(e.message, 'error'); }
    btn.disabled = false; busy.textContent = '';
  };
  const hasChannels = projects().some((p) => (p.sources || []).length);
  return h('div', null,
    h('div', { class: 'h', style: 'margin-top:16px' }, '🧠 Brain', h('span', { class: 'spacer' }),
      h('button', { class: 'btn sm ghost', onclick: () => openBrainSettings() }, 'Set up')),
    h('div', { class: 'row wrap', style: 'margin-bottom:10px' },
      hasAi ? h('button', { class: 'btn sm primary', onclick: (e) => run(e.currentTarget, async () => { const r = await runBrain(); notify(`Brain: ${r.actions.length} action${r.actions.length === 1 ? '' : 's'}`, 'good'); }, 'Thinking… (up to a minute)') }, '▶ Review my system') : null,
      hasChannels ? h('button', { class: 'btn sm', onclick: (e) => run(e.currentTarget, async () => { const r = await scanAllChannels(); if (r) notify(`Scanned ${r.length} channel link${r.length === 1 ? '' : 's'}`, 'good'); }, 'Scanning channels…') }, '📡 Scan channels') : null,
      busy),
    notes.length ? h('div', { class: 'feed' }, notes.map((n) => noteItem(n)))
      : h('div', { class: 'card', style: 'color:var(--muted);font-size:12.5px;line-height:1.5' },
        hasAi || hasChannels ? 'Nothing new yet. Scans and AI reviews will show up here.' : 'Add channel links to your projects so FlowMap can read your real numbers, and connect an AI to get daily tasks. ', !hasAi ? h('button', { class: 'btn sm', onclick: () => openBrainSettings() }, 'Connect an AI') : null));
}

function channelsBlock(p) {
  const sources = p.sources || [];
  const wrap = h('div');
  wrap.append(h('div', { class: 'h', style: 'margin-top:14px' }, '📡 Channels', h('span', { class: 'spacer' }),
    sources.length ? h('button', { class: 'btn sm', onclick: async (e) => { e.currentTarget.disabled = true; e.currentTarget.textContent = 'Scanning…'; await scanProject(p.id); } }, 'Scan now') : null,
    h('button', { class: 'btn sm ghost', onclick: () => openProjectEditor(p.id) }, sources.length ? 'Edit links' : '＋ Add links')));
  if (!sources.length) { wrap.append(h('div', { class: 'hint' }, 'Add this project\'s YouTube, TikTok or website link and FlowMap reads its posts and views for you.')); return wrap; }
  for (const src of sources) {
    const sc = (S.world.scans || []).find((x) => x.projectId === p.id && x.url === src.url);
    const d = sc?.data || {};
    const bits = [];
    if (d.subscribers) bits.push(`${fmtNum(d.subscribers)} subscribers`);
    if (d.followers) bits.push(`${fmtNum(d.followers)} followers`);
    if (d.likes) bits.push(`${fmtNum(d.likes)} likes`);
    if (d.videoCount) bits.push(`${fmtNum(d.videoCount)} videos`);
    if (d.recent && src.platform !== 'website') bits.push(`${d.recent.filter((v) => Date.now() - Date.parse(v.publishedAt) < 7 * 864e5).length} uploads in 7 days`);
    if (src.platform === 'website' && sc?.ok) bits.push(`up · ${d.ms} ms`, d.feed ? `${(d.recent || []).length} posts in feed` : 'no RSS feed found');
    if (d.rating) bits.push(`${d.rating}★`, `${d.installs} installs`);
    const latest = d.recent?.[0];
    wrap.append(h('div', { class: 'channel' },
      h('div', null, `${PLATFORMS[src.platform]?.icon || '🔗'} `, h('a', { href: src.url, target: '_blank', rel: 'noopener noreferrer' }, src.url.replace(/^https?:\/\/(www\.)?/, ''))),
      sc ? (sc.ok ? h('div', { class: 'stats' }, bits.join(' · ') || 'Read OK') : h('div', { class: 'err' }, sc.error)) : h('div', { class: 'stats' }, 'Not scanned yet'),
      latest?.title && src.platform === 'youtube' ? h('div', { class: 'stats' }, `Latest: "${latest.title}" · ${fmtNum(latest.views)} views`) : null,
      sc ? h('div', { class: 'hint' }, `Scanned ${ago(sc.at)}`) : null));
  }
  const notes = (S.world.notes || []).filter((n) => n.projectId === p.id && n.source !== 'scan').slice(0, 3);
  if (notes.length) wrap.append(h('div', { class: 'feed', style: 'margin-top:8px' }, notes.map((n) => noteItem(n, false))));
  return wrap;
}

function logSeries(p, key, days = 14) {
  return Array.from({ length: days }, (_, i) => {
    const l = logFor(p.id, addDays(S.today, -(days - 1 - i)));
    return l && typeof l[key] === 'number' ? l[key] : null;
  });
}

function projectInspector(p) {
  const sn = snap(), s = sn.projects[p.id];
  const now = snap(0).projects[p.id];
  const wrap = h('div');
  wrap.append(h('div', { class: 'big-name' },
    h('div', { class: 'ico', style: { borderColor: colorOf(p) } }, iconOf(p)),
    h('div', { class: 'grow' }, h('h3', null, p.name), h('small', null, kindOf(p).label)),
    pill(s.status, `${Math.round(s.health)}% ${s.status}`),
  ));
  wrap.append(healthBar(s.health));
  const since = now.lastAction ? `Last action ${relDay(now.lastAction, S.today)} · needs one every ${now.cadence} day${now.cadence === 1 ? '' : 's'}` : 'No action recorded yet';
  wrap.append(h('div', { class: 'hint', style: 'margin:6px 0 12px' }, since, ` · flow ${pct(s.flow)}`));
  wrap.append(h('div', { class: 'kv' },
    kvBox('m', 'Money / day', fmtTZS(s.money)), kvBox('a', 'Attention / day', fmtNum(s.attention)), kvBox('c', 'Customers / day', fmtNum(s.customers)),
    kvBox('', 'Costs / day', fmtTZS(s.cost)), kvBox(s.profit >= 0 ? 'c' : '', 'Profit / day', fmtTZS(s.profit)), kvBox('p', 'Flow level', pct(s.flow))));

  wrap.append(h('div', { class: 'h' }, '💧 Water it'));
  const types = HEAL_TYPES[p.kind] || ['other'];
  const grid = h('div', { class: 'water' },
    ...types.map((t) => h('button', { class: `btn${t === types[0] ? ' primary' : ''}`, onclick: () => openActionDialog({ projectId: p.id, type: t }) }, TASK_TYPES[t].icon, TASK_TYPES[t].label)),
    h('button', { class: 'btn', onclick: () => openTaskEditor({ projectId: p.id }) }, '＋ Plan a task'));
  wrap.append(grid);

  const money = sparkline(logSeries(p, 'money'), RESOURCES.money.color);
  const att = money ? null : sparkline(logSeries(p, 'attention'), RESOURCES.attention.color);
  if (money || att) wrap.append(h('div', { class: 'card' }, h('div', { class: 'lbl' }, `Last 14 days · ${money ? 'money' : 'attention'} (from your check-ins)`), money || att));

  wrap.append(channelsBlock(p));
  const incoming = S.world.links.filter((l) => l.to === p.id), outgoing = S.world.links.filter((l) => l.from === p.id);
  const flowRows = (links, dir) => h('div', null, links.map((l) => h('div', { class: 'flow-row', onclick: () => selectItem({ type: 'link', id: l.id }) },
    dot(resColor(l.resource)), h('span', null, dir === 'in' ? `from ${nameOf(l.from)}` : `to ${nameOf(l.to)}`),
    h('span', { class: 'amt', style: { color: resColor(l.resource) } }, fmtAmount(l.resource, sn.links[l.id]?.amount || 0)))));
  wrap.append(
    h('div', { class: 'h', style: 'margin-top:14px' }, 'Feeds', h('span', { class: 'spacer' }), h('button', { class: 'btn sm', onclick: () => openLinkEditor({ from: p.id }) }, '＋ Pipe out')),
    outgoing.length ? flowRows(outgoing, 'out') : h('div', { class: 'hint' }, 'Feeds nothing yet.'),
    h('div', { class: 'h', style: 'margin-top:14px' }, 'Eats from', h('span', { class: 'spacer' }), h('button', { class: 'btn sm', onclick: () => openLinkEditor({ to: p.id }) }, '＋ Pipe in')),
    incoming.length ? flowRows(incoming, 'in') : h('div', { class: 'hint' }, 'Eats from nothing yet.'),
  );
  if (s.fuelBoost || s.progressBoost) wrap.append(h('div', { class: 'hint', style: 'margin-top:8px' },
    `Ecosystem effect on output: ${s.progressBoost >= 0 ? '+' : ''}${Math.round(s.progressBoost * 100)}% from progress pipes, ${s.fuelBoost >= 0 ? '+' : ''}${Math.round(s.fuelBoost * 100)}% from money pipes.`));

  const open = S.world.tasks.filter((t) => t.projectId === p.id && t.status !== 'done').sort((a, b) => (a.due || '9').localeCompare(b.due || '9')).slice(0, 5);
  wrap.append(h('div', { class: 'h', style: 'margin-top:14px' }, 'Open tasks'));
  if (!open.length) wrap.append(h('div', { class: 'hint' }, 'Nothing planned. A plan keeps the project alive in the forecast.'));
  else wrap.append(h('div', { class: 'list' }, open.map(taskRow)));
  if (p.note) wrap.append(h('div', { class: 'card', style: 'margin-top:14px;color:var(--muted);line-height:1.5' }, p.note));
  wrap.append(h('div', { class: 'row', style: 'margin-top:14px' },
    h('button', { class: 'btn', onclick: () => openProjectEditor(p.id) }, '✎ Edit project'),
    h('button', { class: 'btn ghost', onclick: () => ctrl.renderer?.focus(p.id) }, '⌖ Center'),
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn ghost', onclick: () => selectItem(null) }, 'Close')));
  return wrap;
}

function linkInspector(l) {
  const o = snap().links[l.id] || { amount: 0, boost: 1 };
  const R = RESOURCES[l.resource];
  const a = project(l.from), b = project(l.to);
  return h('div', null,
    h('div', { class: 'big-name' }, h('div', { class: 'ico', style: { borderColor: R.color, color: R.color } }, l.resource === 'money' ? '🪙' : l.resource === 'attention' ? '👁' : l.resource === 'customers' ? '👤' : '⚡'),
      h('div', { class: 'grow' }, h('h3', null, `${a.name} → ${b.name}`), h('small', { style: { color: R.color } }, `${R.label} pipe`))),
    h('div', { class: 'kv' },
      kvBox('', 'Flowing now', fmtAmount(l.resource, o.amount)), kvBox('', 'Boost', `${o.boost >= 1 ? '+' : ''}${Math.round((o.boost - 1) * 100)}%`), kvBox('', 'Pipe width', pct(l.share)),
      kvBox('', 'Cost / month', fmtTZS(l.cost)), kvBox('', 'Delay', `${l.delay} d`), kvBox('', 'Type', R.label)),
    l.note ? h('div', { class: 'card', style: 'color:var(--muted)' }, l.note) : null,
    h('div', { class: 'hint', style: 'margin-bottom:12px' }, 'A post aimed at this project pushes this pipe harder for a few days. Then it fades back to normal.'),
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn primary', onclick: () => openLinkEditor({ id: l.id }) }, '✎ Edit pipe'),
      h('button', { class: 'btn', onclick: () => selectItem({ type: 'project', id: a.id }) }, `Open ${a.name}`),
      h('button', { class: 'btn', onclick: () => selectItem({ type: 'project', id: b.id }) }, `Open ${b.name}`),
      h('button', { class: 'btn ghost', onclick: () => selectItem(null) }, 'Close')));
}

// ======================= TASKS =======================
function taskRow(t) {
  const p = project(t.projectId);
  if (!p) return null;
  const type = TASK_TYPES[t.type] || TASK_TYPES.other;
  const done = t.status === 'done';
  const late = !done && t.due && t.due < S.today;
  const when = done ? `done ${relDay(t.doneOn || S.today, S.today)}` : t.due ? `due ${relDay(t.due, S.today)}` : 'no date';
  return h('div', { class: `item${done ? ' done' : ''}` },
    h('button', { class: `check${done ? ' on' : ''}`, title: done ? 'Reopen' : 'Mark done', onclick: () => (done ? reopenTask(t.id) : openActionDialog({ taskId: t.id })) }, done ? '✓' : ''),
    h('div', { class: 't', onclick: () => openTaskEditor({ id: t.id }), style: 'cursor:pointer' },
      h('b', null, `${type.icon} ${t.title}`, t.source && t.source !== 'you' ? h('span', { class: 'src-badge', title: t.note || '' }, `${whoOf(t.source)[0]} ${whoOf(t.source)[1]}`) : null),
      h('small', { class: late ? 'late' : '' }, dot(colorOf(p)), ' ', p.name, ' · ', when, t.reward ? ` · 🪙 ${fmtNum(t.reward)}` : '', t.cost ? ` · −${fmtNum(t.cost)}` : '')),
  );
}

function tasksPanel() {
  const wrap = h('div');
  const opts = [{ value: 'all', label: 'All projects' }, ...projects().map((p) => ({ value: p.id, label: p.name }))];
  wrap.append(h('div', { class: 'row', style: 'margin-bottom:12px' },
    h('div', { class: 'seg' }, ['open', 'done'].map((s) => h('button', { class: taskFilter.status === s ? 'on' : '', onclick: () => { taskFilter.status = s; render(); } }, s === 'open' ? 'Open' : 'Done'))),
    h('div', { class: 'grow' }, selectEl(opts, taskFilter.project, (v) => { taskFilter.project = v === 'all' ? 'all' : Number(v); render(); })),
    h('button', { class: 'btn primary', onclick: () => openTaskEditor({ projectId: taskFilter.project === 'all' ? undefined : taskFilter.project }) }, '＋ Task')));
  const match = (t) => (taskFilter.project === 'all' || t.projectId === taskFilter.project) && project(t.projectId);
  if (taskFilter.status === 'done') {
    const done = S.world.tasks.filter((t) => t.status === 'done' && match(t)).sort((a, b) => (b.doneOn || '').localeCompare(a.doneOn || '')).slice(0, 40);
    wrap.append(done.length ? h('div', { class: 'list' }, done.map(taskRow)) : h('div', { class: 'hint' }, 'Nothing finished yet.'));
    return wrap;
  }
  const open = S.world.tasks.filter((t) => t.status !== 'done' && match(t));
  const groups = [
    ['Overdue', open.filter((t) => t.due && t.due < S.today)],
    ['Today', open.filter((t) => t.due === S.today)],
    ['Upcoming', open.filter((t) => t.due && t.due > S.today)],
    ['No date', open.filter((t) => !t.due)],
  ];
  let any = false;
  for (const [label, arr] of groups) {
    if (!arr.length) continue;
    any = true;
    arr.sort((a, b) => (a.due || '9').localeCompare(b.due || '9'));
    wrap.append(h('div', { class: 'h', style: 'margin-top:8px' }, label, h('span', { class: 'pill' }, arr.length)), h('div', { class: 'list' }, arr.map(taskRow)));
  }
  if (!any) wrap.append(h('div', { class: 'card' }, 'No open tasks. Plan a sponsored ad, a tutorial or a promo. Planned tasks keep projects healthy in the forecast.'));
  const sug = currentSuggestions(3);
  if (sug.length) {
    wrap.append(h('div', { class: 'h', style: 'margin-top:18px' }, 'Suggested by the system'));
    for (const s of sug) wrap.append(h('div', { class: 'item' }, h('div', { class: 't' }, h('b', null, s.title), h('small', null, `${nameOf(s.projectId)} · health ${Math.round(s.health)}%`)),
      h('button', { class: 'btn sm', onclick: () => addTask({ projectId: s.projectId, title: s.title, type: s.type, targets: s.targets, due: S.today, status: 'todo' }) }, '＋ Add')));
  }
  return wrap;
}

// ======================= CHECK-IN =======================
const FIELDS = {
  youtube: ['money', 'attention', 'posts'], tiktok: ['attention', 'posts'], app: ['money', 'customers', 'posts'],
  website: ['money', 'customers', 'posts'], service: ['money', 'customers', 'posts'], custom: ['money', 'attention', 'customers', 'posts'],
};
const FIELD_LABEL = { money: ['Money (TZS)', 'money'], attention: ['Views / reach', 'attention'], customers: ['New customers', 'customers'], posts: ['Posts / promos', 'posts'] };

function streak() {
  const days = new Set(S.world.logs.filter((l) => !l.sample && (l.money !== null || l.attention !== null || l.customers !== null || l.posts > 0)).map((l) => l.day));
  let d = days.has(S.today) ? S.today : addDays(S.today, -1), n = 0;
  while (days.has(d)) { n++; d = addDays(d, -1); }
  return n;
}

function checkinPanel() {
  checkinDay = checkinDay || S.today;
  const day = checkinDay;
  const wrap = h('div');
  const st = streak();
  wrap.append(h('div', { class: 'day-nav' },
    h('button', { class: 'btn sm', onclick: () => { checkinDay = addDays(day, -1); render(); } }, '‹'),
    h('b', null, day === S.today ? `Today · ${fmtDay(day)}` : fmtDay(day)),
    h('button', { class: 'btn sm', disabled: day >= S.today, onclick: () => { checkinDay = addDays(day, 1); render(); } }, '›')));
  wrap.append(h('div', { class: 'hint', style: 'margin:-4px 0 12px;text-align:center' }, st ? `🔥 ${st}-day check-in streak` : 'Log a day to start a streak', ' · these numbers calibrate the simulation.'));
  const key = (pid) => `${day}|${pid}`;
  const touched = new Set();
  for (const p of projects()) {
    const existing = logFor(p.id, day);
    const d = drafts[key(p.id)] || (drafts[key(p.id)] = { money: existing?.money ?? null, attention: existing?.attention ?? null, customers: existing?.customers ?? null, posts: existing?.posts ?? 0, feel: existing?.feel ?? null, note: existing?.note ?? '' });
    const fields = FIELDS[p.kind] || FIELDS.custom;
    const card = h('div', { class: `log-card${existing && !existing.sample ? ' saved' : ''}` });
    const stepper = h('div', { class: 'stepper' },
      h('button', { onclick: () => { d.posts = Math.max(0, d.posts - 1); touched.add(p.id); count.textContent = d.posts; } }, '−'),
      h("b", null, d.posts),
      h('button', { onclick: () => { d.posts++; touched.add(p.id); count.textContent = d.posts; } }, '+'));
    const count = stepper.querySelector('b');
    const cells = fields.map((f) => f === 'posts'
      ? h('div', null, h('small', { class: 'u' }, FIELD_LABEL.posts[0]), h('div', { style: 'margin-top:4px' }, stepper))
      : h('div', null, h('small', { class: 'u' }, FIELD_LABEL[f][0]), numInput(d[f], (v) => { d[f] = v; touched.add(p.id); }, { min: f === 'money' ? undefined : 0 })));
    card.append(
      h('div', { class: 'hd' }, dot(colorOf(p)), h('span', { class: 'grow' }, `${iconOf(p)} ${p.name}`), existing?.sample ? h('span', { class: 'pill' }, 'sample') : null),
      h('div', { class: 'grid3' }, cells),
      h('div', { class: 'row', style: 'margin-top:9px' }, h('small', { class: 'u' }, 'Felt'), feelPicker(d.feel, (v) => { d.feel = v; touched.add(p.id); })),
    );
    wrap.append(card);
  }
  wrap.append(h('div', { class: 'sticky-save' },
    h('button', { class: 'btn primary grow', style: 'justify-content:center', onclick: async () => {
      const entries = [];
      for (const p of projects()) {
        const d = drafts[key(p.id)];
        const has = d && (d.money !== null || d.attention !== null || d.customers !== null || d.posts > 0 || d.feel !== null);
        if (has && (touched.has(p.id) || !logFor(p.id, day))) entries.push({ projectId: p.id, day, money: d.money, attention: d.attention, customers: d.customers, posts: d.posts, feel: d.feel, note: d.note || '' });
      }
      if (!entries.length) { notify('Nothing to save yet. Fill in at least one number.', 'error'); return; }
      await saveLogs(entries);
      for (const e of entries) delete drafts[`${e.day}|${e.projectId}`];
      sfx.success();
      notify(`Saved ${entries.length} project${entries.length > 1 ? 's' : ''}. The simulation just re-calibrated.`, 'good');
    } }, '💾 Save check-in')));

  // month at once
  const m = { projectId: projects()[0]?.id, month: S.today.slice(0, 7), money: null, attention: null, customers: null };
  wrap.append(h('div', { class: 'h', style: 'margin-top:18px' }, 'Set a whole month at once'),
    h('div', { class: 'card' },
      h('div', { class: 'hint', style: 'margin-bottom:10px' }, 'Know the monthly total (e.g. YouTube earnings)? Enter it and it is spread evenly over the days.'),
      h('div', { class: 'grid2' },
        field('Project', selectEl(projects().map((p) => ({ value: p.id, label: p.name })), m.projectId, (v) => { m.projectId = Number(v); })),
        field('Month', h('input', { type: 'month', value: m.month, onchange: (e) => { m.month = e.target.value; } }))),
      h('div', { class: 'grid3', style: 'display:grid;grid-template-columns:repeat(3,1fr);gap:8px' },
        field('Money (TZS)', numInput(null, (v) => { m.money = v; }, { min: 0 })), field('Attention', numInput(null, (v) => { m.attention = v; }, { min: 0 })), field('Customers', numInput(null, (v) => { m.customers = v; }, { min: 0 }))),
      h('button', { class: 'btn', onclick: async () => {
        const body = { projectId: m.projectId, month: m.month };
        for (const k of ['money', 'attention', 'customers']) if (m[k] !== null) body[k] = m[k];
        if (Object.keys(body).length < 3) { notify('Enter at least one total', 'error'); return; }
        const n = await spreadMonth(body);
        if (n) notify(`Spread over ${n} days`, 'good');
      } }, 'Apply to the month')));
  return wrap;
}

// ======================= FORECAST =======================
const sum = (sim, key, from, to) => sim.days.slice(from, to + 1).reduce((a, d) => a + d.totals[key], 0);

function forecastPanel() {
  const sc = scenarios();
  const wrap = h('div');
  wrap.append(
    h('div', { class: 'h' }, 'Where is this heading?'),
    h('div', { class: 'row wrap', style: 'margin-bottom:10px' }, h('div', { class: 'seg' }, Object.entries(METRICS).map(([k, [label]]) => h('button', { class: metric === k ? 'on' : '', onclick: () => { metric = k; render(); } }, label)))));
  const canvas = h('canvas');
  const fmt = metric === 'health' ? (v) => `${Math.round(v)}%` : metric === 'money' || metric === 'profit' ? (v) => fmtNum(v) : (v) => fmtNum(v);
  const upto = 90;
  const chart = lineChart(canvas, () => ({
    series: Object.keys(SCEN).map((k) => ({ label: SCEN[k], color: SCEN_COLOR[k], values: sc[k].days.slice(0, upto + 1).map((d) => d.totals[metric]), dim: k !== S.scenario, width: k === S.scenario ? 3 : 1.8 })),
    marker: S.offset, format: fmt, min: metric === 'profit' ? undefined : 0, max: metric === 'health' ? 105 : undefined,
    onPick: (i) => { setOffset(i); },
  }));
  wrap.append(h('div', { class: 'chart-wrap' }, canvas),
    h('div', { class: 'row wrap', style: 'margin:-2px 0 12px;font-size:12px;color:var(--muted)' }, Object.keys(SCEN).map((k) => h('span', null, h('i', { class: 'legend-line', style: { background: SCEN_COLOR[k] } }), SCEN[k]))),
    h('div', { class: 'hint', style: 'margin-bottom:12px' }, 'Click the chart to jump the map to that day.'));
  requestAnimationFrame(() => chart.draw());

  const next30 = (k) => sum(sc[k], 'money', 1, 30), cost30 = (k) => sum(sc[k], 'cost', 1, 30);
  wrap.append(h('div', { class: 'h' }, 'Next 30 days'), h('div', { class: 'kv' },
    ...Object.keys(SCEN).map((k) => h('div', { style: { borderColor: SCEN_COLOR[k] + '66' } }, h('small', null, SCEN[k]), h('b', { class: 'm' }, fmtTZS(next30(k))), h('small', null, `net ${fmtNum(next30(k) - cost30(k))}`)))));
  const delta = next30('keep') - next30('stop');
  wrap.append(h('div', { class: 'banner' }, h('span', null, delta > 0 ? `Keeping your pace is worth about TZS ${fmtNum(delta)} more over the next 30 days than stopping.` : 'Not enough activity to compare yet. Plan some tasks.')));

  wrap.append(h('div', { class: 'h', style: 'margin-top:14px' }, `Per project · ${SCEN[S.scenario]}`));
  const tbl = h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Project', 'Health', '+30d', 'Money/d', '+30d'].map((x) => h('th', null, x)))));
  const body = h('tbody');
  for (const p of projects()) {
    const a = S.sim.days[0].projects[p.id], b = S.sim.days[30].projects[p.id];
    if (!a || !b) continue;
    const arrow = b.health > a.health + 2 ? '▲' : b.health < a.health - 2 ? '▼' : '•';
    body.append(h('tr', { class: 'click', onclick: () => { selectItem({ type: 'project', id: p.id }); ctrl.renderer?.focus(p.id); } },
      h('td', null, dot(colorOf(p)), ' ', p.name), h('td', { style: { color: healthColor(a.health) } }, `${Math.round(a.health)}%`),
      h('td', { style: { color: healthColor(b.health) } }, `${arrow} ${Math.round(b.health)}%`), h('td', null, fmtNum(a.money)), h('td', null, fmtNum(b.money))));
  }
  tbl.append(body);
  wrap.append(tbl);
  return wrap;
}

// ======================= ALERTS =======================
const ALERT_ICON = { critical: '🚨', warn: '⚠️', good: '🔥', info: '📝' };

export function alertActions(a) {
  const btns = [];
  if (a.action?.type === 'water') btns.push(h('button', { class: 'btn sm primary', onclick: () => openActionDialog({ projectId: a.projectId }) }, '💧 Water it'));
  if (a.action?.type === 'checkin') btns.push(h('button', { class: 'btn sm primary', onclick: () => openTab('checkin') }, 'Check in'));
  if (a.taskId) btns.push(h('button', { class: 'btn sm primary', onclick: () => openActionDialog({ taskId: a.taskId }) }, 'Mark done'));
  if (a.projectId) btns.push(h('button', { class: 'btn sm', onclick: () => { selectItem({ type: 'project', id: a.projectId }); ctrl.renderer?.focus(a.projectId); } }, 'Show on map'));
  return h('div', { class: 'row wrap' }, btns);
}

function alertsPanel() {
  const list = currentAlerts();
  const wrap = h('div', null, h('div', { class: 'h' }, 'Alerts'));
  if (!list.length) wrap.append(h('div', { class: 'card' }, 'All calm. 🌊 Nothing needs your attention.'));
  for (const a of list) wrap.append(h('div', { class: `alert ${a.level}` }, h('div', { class: 'ic' }, ALERT_ICON[a.level]), h('div', { style: 'flex:1;min-width:0' }, h('b', null, a.title), h('p', null, a.detail), alertActions(a))));
  return wrap;
}
