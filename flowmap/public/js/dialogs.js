// Modal dialogs: project / pipe / task editors, the "water it" dialog, help and settings.
import { h, clear, fmtNum, fmtFull, download, fmtDay, setText } from './util.js';
import { MAP_STYLES, getMapStyle, setMapStyle } from './mapstyle.js';
import { S, snap, project, projects, nameOf, addProject, updateProject, deleteProject, addLink, updateLink, deleteLink,
  addTask, updateTask, deleteTask, completeTask, notify, hasSample, clearSample, resetWorld, importWorld, exportWorld, scanProject, saveSecrets, setCheckinRhythm } from './store.js';
import { KINDS, KIND_KEYS, RESOURCES, TASK_TYPES, CHANNELS, cfgOf, configBase } from '/shared/engine.js';
import { PLATFORMS, normalizeSources } from '/shared/sources.js';
import { GOAL_METRICS, DEFAULT_GROUP, groupOf } from '/shared/goals.js';
import { openModal, closeAllModals, confirmDialog, field, numInput, chipGroup, feelPicker, emojiPicker, resourcePicker, select } from './ui-common.js';
import { api, auth, patch, post } from './api.js';
import { sfx, sound } from './audio.js';

export const dialogHooks = { logout() {} };

const ICONS = ['▶️', '📺', '🎬', '🎓', '🎵', '⚽', '🎙️', '🛒', '💬', '📱', '🌐', '💰', '🚀', '🎮', '📰', '🧠', '🎯', '📦', '🛠️', '🔥', '🤝', '🏆'];
const COLORS = ['#ff4d5e', '#ff8a5c', '#ffa94d', '#ffc933', '#46e58a', '#b8e04a', '#ff8a3d', '#e8b86b', '#d9b38c', '#ff5fa2', '#ff6fae'];
export const HEAL_TYPES = {
  youtube: ['video', 'tutorial', 'promo', 'ad'],
  tiktok: ['tiktok', 'promo'],
  app: ['update', 'promo', 'ad'],
  website: ['update', 'promo', 'tutorial'],
  service: ['promo', 'ad'],
  custom: ['other', 'promo'],
};
const defaultChannel = (type) => ({ tiktok: 'tiktok', ad: 'ads', promo: 'whatsapp' }[type] || 'in_video');

// ---------- project editor ----------
export function openProjectEditor(id, opts = {}) {
  const existing = id ? project(id) : null;
  const kindDefaults = (k) => ({ ...KINDS[k].defaults, cadenceDays: KINDS[k].cadenceDays });
  const startKind = existing?.kind || opts.kind || 'youtube';
  const d = existing
    ? { name: existing.name, kind: existing.kind, icon: existing.icon, color: existing.color, monthlyCost: existing.monthlyCost, note: existing.note, cfg: structuredClone(cfgOf(existing)), links: (existing.sources || []).map((s) => s.url).join('\n') }
    : { name: '', kind: startKind, icon: '', color: '', monthlyCost: 0, note: '', cfg: kindDefaults(startKind), links: '' };

  // channel links: one per line, platform detected as you type
  const linkPreview = h('div', { class: 'chips' });
  const readLinks = () => {
    const out = [], bad = [];
    for (const line of d.links.split(/\s*\n\s*|\s+/).filter(Boolean)) {
      try { out.push(...normalizeSources([line])); } catch { bad.push(line); }
    }
    return { out, bad };
  };
  const paintLinks = () => {
    const { out, bad } = readLinks();
    clear(linkPreview).append(
      ...out.map((s) => h('span', { class: 'chip on', title: PLATFORMS[s.platform].scan }, `${PLATFORMS[s.platform].icon} ${PLATFORMS[s.platform].label}`)),
      ...bad.map((b) => h('span', { class: 'chip bad' }, `⚠️ "${b.slice(0, 30)}" is not a link`)));
  };

  const cfgHost = h('div');
  const preview = h('div', { class: 'banner' });
  const showPreview = () => {
    const b = configBase({ kind: d.kind, cfg: d.cfg });
    const bits = [];
    if (b.money) bits.push(`TZS ${fmtFull(b.money)}/day`);
    if (b.attention) bits.push(`${fmtFull(b.attention)} views/day`);
    if (b.customers) bits.push(`${fmtNum(b.customers)} new customers/day`);
    clear(preview).append(h('span', null, '📈 At full health this makes about: '), h('b', null, bits.join(' · ') || 'nothing yet'));
  };
  const setNum = (key) => (v) => { d.cfg[key] = v ?? 0; showPreview(); };

  const renderCfg = () => {
    clear(cfgHost);
    const k = d.kind, c = d.cfg;
    const attention = k === 'youtube' || k === 'tiktok' || k === 'custom';
    const sells = k === 'app' || k === 'website' || k === 'service' || k === 'custom';
    if (attention) cfgHost.append(field(k === 'tiktok' ? 'Views / reach per day' : 'Views per day (when healthy)', numInput(c.viewsPerDay, setNum('viewsPerDay'), { min: 0 })));
    if (k === 'youtube') cfgHost.append(field('Ad revenue per 1,000 views (TZS)', numInput(c.rpm, setNum('rpm'), { min: 0 }), 'Channels earn from ad revenue, so views matter here, not visitors.'));
    if (sells) {
      cfgHost.append(
        h('div', { class: 'grid2' },
          field('Price per customer (TZS)', numInput(c.price, setNum('price'), { min: 0 })),
          field('How customers pay', select([{ value: 'monthly', label: 'Monthly subscription' }, { value: 'one_off', label: 'One-time purchase' }, { value: 'none', label: 'No direct sales' }], c.billing || 'none', (v) => { c.billing = v; renderCfg(); }))),
      );
      if (c.billing === 'monthly') cfgHost.append(h('div', { class: 'grid2' },
        field('Paying customers now', numInput(c.activeCustomers, setNum('activeCustomers'), { min: 0 }), 'Paying users in TZS. No visitor count needed.'),
        field('Monthly churn %', numInput(c.churnPct, setNum('churnPct'), { min: 0, max: 100 }), 'Customers lost each month.')));
      cfgHost.append(h('div', { class: 'grid2' },
        field('New customers per day', numInput(c.newPerDay, setNum('newPerDay'), { min: 0 })),
        field('Per 1,000 attention received', numInput(c.conversionPer1000, setNum('conversionPer1000'), { min: 0 }), 'How well attention from other projects turns into customers here.')));
    }
    if (k !== 'tiktok') cfgHost.append(field('Other income per day (TZS)', numInput(c.baseMoneyPerDay, setNum('baseMoneyPerDay'), { min: 0 }), 'Sponsors, affiliate, anything not counted above.'));
    showPreview();
  };

  // goal: what "winning" means for this project, shown as a gold ring around the tank
  const goalHost = h('div');
  const paintGoal = () => {
    const g = d.cfg.goal || {};
    clear(goalHost).append(h('div', { class: 'grid2' },
      field('Goal', select([{ value: '', label: 'No goal' }, ...Object.entries(GOAL_METRICS).map(([value, m]) => ({ value, label: m.label }))], g.metric || '', (v) => {
        d.cfg.goal = v ? { ...(d.cfg.goal || {}), metric: v } : undefined;
        if (!v) delete d.cfg.goal;
        paintGoal();
      })),
      g.metric ? field('Target', numInput(g.target, (v) => { d.cfg.goal.target = v ?? 0; }, { min: 0 }), g.metric === 'subscribers' ? 'Read from your channel link scans.' : g.metric === 'customers' ? 'Paying customers at the same time.' : 'Measured over the last 30 days.') : h('div')),
    g.metric ? field('Reach it by (optional)', h('input', { id: 'p-goal-by', type: 'date', value: g.by || '', oninput: (e) => { d.cfg.goal.by = e.target.value || undefined; } }), 'With a date, FlowMap shows the pace you need per day.') : null);
  };
  const iconHost = h('div');
  const paintIcons = () => { clear(iconHost).append(emojiPicker(ICONS, d.icon || KINDS[d.kind].icon, (e) => { d.icon = e; })); };
  const colorHost = h('div');
  const paintColors = () => {
    clear(colorHost).append(h('div', { class: 'chips' }, COLORS.map((c) => h('button', {
      type: 'button', class: `chip${d.color === c ? ' on' : ''}`, style: { padding: '4px 9px' }, onclick: () => { d.color = c; paintColors(); },
    }, h('i', { class: 'dot', style: { background: c, width: '14px', height: '14px' } })))));
  };

  const kindHost = h('div');
  const paintKind = () => clear(kindHost).append(chipGroup(KIND_KEYS.map((k) => ({ value: k, label: `${KINDS[k].icon} ${KINDS[k].label}` })), d.kind, (k) => {
    d.kind = k;
    const keep = { goal: d.cfg.goal, group: d.cfg.group };
    d.cfg = existing ? { ...kindDefaults(k), ...d.cfg } : { ...kindDefaults(k), ...keep };
    if (!d.cfg.goal) delete d.cfg.goal;
    const gi = document.getElementById('p-group');
    if (gi) gi.placeholder = DEFAULT_GROUP[k] || 'Other';
    if (!existing && !d.icon) d.icon = '';
    renderCfg(); paintIcons();
  }));

  const body = h('div', null,
    field('Name', h('input', { type: 'text', value: d.name, maxLength: 80, placeholder: 'e.g. Vinei TV, my new app…', oninput: (e) => { d.name = e.target.value; } })),
    h('div', { class: 'field' }, h('label', null, 'What kind of project is it?'), kindHost, h('div', { class: 'hint' }, 'Each type earns and feeds the system in its own way.')),
    h('div', { class: 'field' },
      h('label', { for: 'p-links' }, 'Channel links'),
      h('textarea', { id: 'p-links', rows: 2, placeholder: 'youtube.com/@yourchannel\ntiktok.com/@you\nyourshop.co.tz', oninput: (e) => { d.links = e.target.value; paintLinks(); } }, d.links),
      linkPreview,
      h('div', { class: 'hint' }, 'One per line. FlowMap scans them every day: YouTube uploads and TikTok videos count as posts, and view growth becomes attention. Websites are checked for uptime and new posts.')),
    h('div', { class: 'sec' }, 'Look'),
    h('div', { class: 'field' }, h('label', null, 'Icon'), iconHost),
    h('div', { class: 'field' }, h('label', null, 'Color'), colorHost),
    h('div', { class: 'sec' }, 'How it earns'),
    cfgHost, preview,
    h('div', { class: 'sec' }, 'Rhythm & cost'),
    h('div', { class: 'grid2' },
      field('Needs a post / action every (days)', numInput(d.cfg.cadenceDays, (v) => { d.cfg.cadenceDays = Math.max(1, v ?? 1); }, { min: 1, max: 90 }), 'Miss this rhythm and the project starts to dry out.'),
      field('Monthly cost (TZS)', numInput(d.monthlyCost, (v) => { d.monthlyCost = v ?? 0; }, { min: 0 }), 'Tools, servers, subscriptions, ad budget.')),
    field('Check-in rhythm', chipGroup([{ value: '', label: `Like the system (${S.world.checkin || 'daily'})` }, { value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }, { value: 'off', label: 'Off' }],
      d.cfg.checkin || '', (v) => { if (v) d.cfg.checkin = v; else delete d.cfg.checkin; }), 'How often you log this project\'s numbers. Overdue, its flow and health sag and it slows the projects it feeds.'),
    h('div', { class: 'sec' }, 'Goal & area'),
    goalHost,
    field('Area on the map', h('div', null,
      h('input', { id: 'p-group', type: 'text', maxLength: 30, list: 'p-groups', value: d.cfg.group || '', placeholder: DEFAULT_GROUP[d.kind] || 'Other', oninput: (e) => { d.cfg.group = e.target.value.trim(); } }),
      h('datalist', { id: 'p-groups' }, [...new Set(projects().map(groupOf))].map((g) => h('option', { value: g })))),
    'Projects in the same area are grouped on the map. Leave empty to group by type.'),
    field('Notes', h('textarea', { maxLength: 600, oninput: (e) => { d.note = e.target.value; } }, d.note || '')),
  );
  paintKind(); paintIcons(); paintColors(); renderCfg(); paintLinks(); paintGoal();

  const actions = [];
  if (existing) actions.push({ label: 'Delete', kind: 'danger', onClick: async () => {
    if (!(await confirmDialog({ title: `Delete ${existing.name}?`, message: 'This also removes its pipes, tasks and daily logs. This cannot be undone.', confirm: 'Delete project', danger: true }))) return false;
    await deleteProject(existing.id);
    return true;
  } });
  actions.push({ label: 'Cancel' }, { label: existing ? 'Save changes' : 'Add to map', kind: 'primary', onClick: async () => {
    if (!d.name.trim()) { notify('Give the project a name first', 'error'); return false; }
    const { out: sources, bad } = readLinks();
    if (bad.length) { notify(`Fix or remove "${bad[0]}": it is not a web link`, 'error'); return false; }
    const before = JSON.stringify((existing?.sources || []).map((s) => s.url));
    const data = { name: d.name.trim(), kind: d.kind, icon: d.icon || '', color: d.color || '', monthlyCost: d.monthlyCost || 0, note: d.note || '', cfg: d.cfg, sources };
    let saved = existing;
    if (existing) await updateProject(existing.id, data);
    else {
      const pos = opts.x !== undefined ? { x: opts.x, y: opts.y } : freeSpot();
      saved = await addProject({ ...data, ...pos });
      if (saved) { sfx.pop(); notify(`${saved.name} added. Now connect it: pick "Connect" and tap two projects.`, 'good'); }
    }
    // new links get their first scan right away
    if (saved && sources.length && JSON.stringify(sources.map((s) => s.url)) !== before) {
      notify(`Scanning ${sources.length} channel link${sources.length > 1 ? 's' : ''}…`);
      scanProject(saved.id).then((r) => { if (r) notify(r.every((x) => x.ok) ? 'Channels scanned' : `Scan: ${r.find((x) => !x.ok).error}`, r.every((x) => x.ok) ? 'good' : 'error'); });
    }
    return true;
  } });
  return openModal({ title: existing ? `Edit ${existing.name}` : 'Add a project', body, actions, wide: true });
}

function freeSpot() {
  const list = projects();
  if (!list.length) return { x: 0, y: 0 };
  const cx = list.reduce((a, p) => a + p.x, 0) / list.length, cy = list.reduce((a, p) => a + p.y, 0) / list.length;
  for (let r = 260; r < 2400; r += 60) {
    for (let a = 0; a < 12; a++) {
      const x = Math.round(cx + Math.cos(a * 0.52 + r) * r), y = Math.round(cy + Math.sin(a * 0.52 + r) * r * 0.7);
      if (list.every((p) => Math.hypot(p.x - x, p.y - y) > 230)) return { x, y };
    }
  }
  return { x: cx + 300, y: cy };
}

// ---------- pipe editor ----------
const RES_HELP = {
  attention: (a, b) => `Each day this share of ${a}'s audience is exposed to ${b} (videos, TikToks, mentions).`,
  money: (a, b) => `This share of ${a}'s income is reinvested into ${b} (gear, ads, servers). It gives ${b} fuel.`,
  customers: (a, b) => `This share of ${a}'s new customers is passed to ${b} (cross-sell).`,
  progress: (a, b) => `How strongly ${a} speeds up ${b}: tools, content, proof. If ${a} dries out, ${b} slows down.`,
};

export function openLinkEditor({ id, from, to } = {}) {
  const list = projects();
  if (list.length < 2) { notify('Add at least two projects to connect them', 'error'); return null; }
  const existing = id ? S.world.links.find((l) => l.id === id) : null;
  const d = existing ? { ...existing } : { from: from ?? list[0].id, to: to ?? (list.find((p) => p.id !== (from ?? list[0].id)) || list[1]).id, resource: 'attention', share: 0.12, cost: 0, delay: 0, note: '' };
  const opts = list.map((p) => ({ value: p.id, label: `${p.icon || KINDS[p.kind].icon} ${p.name}` }));
  const helpEl = h('div', { class: 'banner' });
  const shareVal = h('b', null);
  const paint = () => {
    shareVal.textContent = `${Math.round(d.share * 100)}%`;
    clear(helpEl).append(h('span', null, RES_HELP[d.resource](nameOf(d.from), nameOf(d.to))));
  };
  const resHost = h('div');
  const body = h('div', null,
    h('div', { class: 'grid2' },
      field('From (gives)', select(opts, d.from, (v) => { d.from = Number(v); paint(); })),
      field('To (receives)', select(opts, d.to, (v) => { d.to = Number(v); paint(); }))),
    h('div', { class: 'field' }, h('label', null, 'What flows through this pipe?'), resHost),
    helpEl,
    h('div', { class: 'field' }, h('label', null, 'Pipe width — how much flows'),
      h('div', { class: 'row' }, h('input', { type: 'range', min: 1, max: 100, value: Math.round(d.share * 100), oninput: (e) => { d.share = Number(e.target.value) / 100; paint(); } }), shareVal)),
    h('div', { class: 'grid2' },
      field('Costs to run (TZS / month)', numInput(d.cost, (v) => { d.cost = v ?? 0; }, { min: 0 }), 'e.g. ad spend that pushes this pipe.'),
      field('Takes how long (days)', numInput(d.delay, (v) => { d.delay = Math.round(v ?? 0); }, { min: 0, max: 90 }), 'Lag before the flow arrives.')),
    field('Note', h('input', { type: 'text', value: d.note, maxLength: 200, placeholder: 'What is this connection?', oninput: (e) => { d.note = e.target.value; } })),
  );
  resHost.append(resourcePicker(d.resource, (r) => { d.resource = r; paint(); }));
  paint();
  const actions = [];
  if (existing) actions.push({ label: 'Delete pipe', kind: 'danger', onClick: async () => { await deleteLink(existing.id); return true; } });
  actions.push({ label: 'Cancel' }, { label: existing ? 'Save' : 'Connect', kind: 'primary', onClick: async () => {
    if (d.from === d.to) { notify('A project cannot feed itself', 'error'); return false; }
    const data = { from: d.from, to: d.to, resource: d.resource, share: d.share, cost: d.cost || 0, delay: d.delay || 0, note: d.note || '' };
    if (existing) await updateLink(existing.id, data); else { await addLink(data); sfx.pop(); }
    return true;
  } });
  return openModal({ title: existing ? 'Edit pipe' : 'Connect two projects', body, actions });
}

// ---------- shared: aim targets ----------
function targetChips(projectId, selected, onChange) {
  const linked = new Set(S.world.links.filter((l) => l.from === projectId).map((l) => l.to));
  const others = projects().filter((p) => p.id !== projectId).sort((a, b) => Number(linked.has(b.id)) - Number(linked.has(a.id)));
  if (!others.length) return h('div', { class: 'hint' }, 'No other projects yet.');
  return chipGroup(others.map((p) => ({ value: p.id, label: `${p.name}${linked.has(p.id) ? ' →' : ''}`, color: p.color || KINDS[p.kind].color })), selected, onChange, { multi: true });
}

// ---------- "water it" dialog ----------
export function openActionDialog({ projectId, taskId, type } = {}) {
  const task = taskId ? S.world.tasks.find((t) => t.id === taskId) : null;
  const p = project(task ? task.projectId : projectId);
  if (!p) return null;
  const d = {
    type: task?.type || type || HEAL_TYPES[p.kind][0],
    title: task?.title || '',
    quality: task?.quality || 3,
    channel: task?.channel || defaultChannel(type || HEAL_TYPES[p.kind][0]),
    targets: [...(task?.targets || [])],
    reward: task?.reward || 0,
  };
  const chHost = h('div');
  const paintCh = () => clear(chHost).append(chipGroup(Object.entries(CHANNELS).map(([k, v]) => ({ value: k, label: v.label })), d.channel, (v) => { d.channel = v; }));
  const typeHost = h('div');
  const paintType = () => clear(typeHost).append(chipGroup(Object.entries(TASK_TYPES).map(([k, v]) => ({ value: k, label: `${v.icon} ${v.label}` })), d.type, (v) => { d.type = v; if (!task) { d.channel = defaultChannel(v); paintCh(); } }));
  const body = h('div', null,
    h('div', { class: 'banner' }, h('span', null, task ? `Finishing “${task.title}”` : `You did something for ${p.name}. Tell the system how it went so the flow reacts.`)),
    task ? null : field('What did you do?', h('input', { type: 'text', maxLength: 140, placeholder: `e.g. Tutorial: Excel tips`, oninput: (e) => { d.title = e.target.value; } })),
    h('div', { class: 'field' }, h('label', null, 'Type'), typeHost),
    h('div', { class: 'field' }, h('label', null, 'How do you feel about it?'), feelPicker(d.quality, (v) => { d.quality = v; }), h('div', { class: 'hint' }, 'A post you are proud of sends a stronger wave.')),
    h('div', { class: 'field' }, h('label', null, 'Where did you promote?'), chHost),
    h('div', { class: 'field' }, h('label', null, 'Which projects did it push?'), targetChips(p.id, d.targets, (v) => { d.targets = v; }),
      h('div', { class: 'hint' }, 'Tap the projects you mentioned or linked. Their pipes get the boost. Leave empty for a general post.')),
    field('Money made right now (TZS, optional)', numInput(d.reward || null, (v) => { d.reward = v ?? 0; }, { min: 0 }), 'For example a sponsor payment or a sale. It is added to today\'s check-in.'),
  );
  paintCh(); paintType();
  return openModal({
    title: `💧 Water ${p.name}`, body,
    actions: [{ label: 'Cancel' }, { label: 'Pour it in 💧', kind: 'primary', onClick: async () => {
      const extra = { type: d.type, quality: d.quality, channel: d.channel, targets: d.targets, reward: d.reward || 0 };
      let res;
      if (task) res = await completeTask(task.id, extra);
      else res = await addTask({ projectId: p.id, title: d.title.trim() || `${TASK_TYPES[d.type].label} · ${p.name}`, status: 'done', doneOn: S.today, due: null, ...extra });
      if (res) {
        (d.reward > 0 ? sfx.coin : sfx.whoosh)();
        notify(d.targets.length ? `${p.name} watered. ${d.targets.map(nameOf).join(', ')} got a boost.` : `${p.name} watered.`, 'good');
      }
      return !!res;
    } }],
  });
}

// ---------- task editor ----------
export function openTaskEditor({ id, projectId, type, title } = {}) {
  const list = projects();
  if (!list.length) { notify('Add a project first', 'error'); return null; }
  const existing = id ? S.world.tasks.find((t) => t.id === id) : null;
  const d = existing ? { ...existing, targets: [...existing.targets] } : {
    projectId: projectId ?? list[0].id, title: title || '', type: type || HEAL_TYPES[(project(projectId ?? list[0].id) || list[0]).kind][0],
    due: S.today, hours: 0, cost: 0, reward: 0, targets: [], channel: 'in_video', note: '',
  };
  const tHost = h('div');
  const paintTargets = () => clear(tHost).append(targetChips(d.projectId, d.targets, (v) => { d.targets = v; }));
  const body = h('div', null,
    field('Task', h('input', { type: 'text', value: d.title, maxLength: 140, placeholder: 'e.g. Record tutorial about…', oninput: (e) => { d.title = e.target.value; } })),
    h('div', { class: 'grid2' },
      field('Project', select(list.map((p) => ({ value: p.id, label: `${p.icon || KINDS[p.kind].icon} ${p.name}` })), d.projectId, (v) => { d.projectId = Number(v); d.targets = []; paintTargets(); })),
      field('Type', select(Object.entries(TASK_TYPES).map(([k, v]) => ({ value: k, label: `${v.icon} ${v.label}` })), d.type, (v) => { d.type = v; }))),
    h('div', { class: 'grid2' },
      field('Due', h('input', { type: 'date', value: d.due || '', onchange: (e) => { d.due = e.target.value || null; } })),
      field('Hours it takes', numInput(d.hours || null, (v) => { d.hours = v ?? 0; }, { min: 0 }))),
    h('div', { class: 'grid2' },
      field('Cost (TZS)', numInput(d.cost || null, (v) => { d.cost = v ?? 0; }, { min: 0 }), 'e.g. ad budget'),
      field('Expected money (TZS)', numInput(d.reward || null, (v) => { d.reward = v ?? 0; }, { min: 0 }), 'e.g. sponsor fee, paid when done')),
    h('div', { class: 'field' }, h('label', null, 'Which projects will it push?'), tHost),
    field('Note', h('input', { type: 'text', value: d.note || '', maxLength: 400, oninput: (e) => { d.note = e.target.value; } })),
  );
  paintTargets();
  const actions = [];
  if (existing) actions.push({ label: 'Delete', kind: 'danger', onClick: async () => { await deleteTask(existing.id); return true; } });
  if (existing && existing.status !== 'done') actions.push({ label: 'Mark done…', onClick: () => { setTimeout(() => openActionDialog({ taskId: existing.id }), 0); return true; } });
  actions.push({ label: 'Cancel' }, { label: existing ? 'Save' : 'Add task', kind: 'primary', onClick: async () => {
    if (!d.title.trim()) { notify('Describe the task', 'error'); return false; }
    const data = { projectId: d.projectId, title: d.title.trim(), type: d.type, due: d.due || null, hours: d.hours || 0, cost: d.cost || 0, reward: d.reward || 0, targets: d.targets, note: d.note || '' };
    if (existing) await updateTask(existing.id, data); else await addTask({ ...data, status: 'todo' });
    return true;
  } });
  return openModal({ title: existing ? 'Edit task' : 'New task', body, actions });
}

// ---------- help ----------
export function openHelp() {
  const ex = (e, t, p) => h('div', { class: 'ex' }, h('div', { class: 'e' }, e), h('div', null, h('b', null, t), h('p', null, p)));
  return openModal({
    title: 'How FlowMap works', wide: true,
    body: h('div', { class: 'explain' },
      ex('🃏', 'Every project is a card', 'Soft cards rest on a dotted or gridded floor. Tap one and it floats up to show a bigger card underneath with its health, money, views, goal and tasks. The light on each card is its health: green, yellow, orange or red. The map opens showing everything; zoom in or out as you like. Prefer 3D? Switch to glass tanks in ⚙️ Settings.'),
      ex('🎨', 'Make the look yours', 'The 🎨 Look button sets the floor (dots, grid or plain), the size of every card (S to XXL), their finish, shape, effects and spacing, whether areas are shown, and how pipes look (thin to bold, lights on or off): sunk tunnels in the floor, raised tubes, drawn lines or plain Miro-style lines with arrows or dots at the ends. Right-click one card or pipe to style just that one.'),
      ex('🧩', 'Boards for planning, teaching and presenting', 'Switch to Boards at the top. Start from a template (tutorial video, course, strategy map, workflow, task board) or ask AI to build one. Add sticky notes, cards, shapes, frames, flip cards, checklists, prompts with a copy button, images, text files, web links, videos from this device, drawings and stickers, then join them with connectors. Right-click anything for more.'),
      ex('▶️', 'Present and record', 'Frames become slides. ▶ Present glides between them full screen with entry animations, a laser pointer (L), spotlight (S), pen (P) and speaker notes (N); the controls hide themselves so you can screen-record cleanly.'),
      ex('i:square-dashed-mouse-pointer', 'Selecting on a board', 'Click an item to select it; Shift-click adds more. Drag a box on empty space to select everything it touches. On a phone, tap the Select several tool: then tap items to add or remove them and drag a box with your finger. Drag any selected item to move them all.'),
      ex('🔒', 'Lock a board while you record or explain', 'Press 🔒 Lock (or K). Nothing can be edited or selected by accident. Tapping something makes it glow, shake or pop (you choose). Things you marked ✋ movable can still be dragged, and 🙈 Hide covers vanish when tapped. ↺ Reset puts everything back for the next take.'),
      ex('⌖', 'Jump links: glide to another place', 'Select anything, tap ⌖ and pick where it should go, by tapping it on the board or from the list. A small ➜ button appears (add your own words, or leave just the arrow). Tapping it glides the board there; ↩ Back glides home. While locked, presenting or on a shared link, tapping the item itself also jumps.'),
      ex('🗒️', 'Notes that look like real paper', 'Pick the 🗒️ note tool to choose a paper: sticky note, lined, notebook page with holes, graph paper, index card, kraft, torn scrap or old paper. Select a note to change its colour, let it lie flat, lift off the board or fold a corner, and hold it with tape, a pin or a clip. Under Aa, slide or type any text size and turn on handwriting.'),
      ex('📎', 'Paperclips, pins and tape', 'The 📎 tool (U) adds a real-looking paperclip, binder clip, push pin or strip of tape in silver, gold, copper, black or any colour. Lay it over the edge of a note, card or photo; it always sits on top. Tilt it with the round handle.'),
      ex('✨', 'The AI designer', 'On any board press ✨ AI and say what you want. It studies the whole board (it sees a picture of it when your model can see), asks you a few questions with buttons, like your favourite style or big text or not, then designs one slide or section at a time while you watch, fixes overlaps and text that does not fit, and finishes with a polish of the whole board. Pick the key and model right there. It remembers your answers; one Undo puts everything back.'),
      ex('☑', 'Tick checklists while presenting', 'Checklist boxes tick while the board is locked, presenting or opened from a shared link. Your own ticks are saved; a viewer’s ticks stay on their screen until ↺ Reset.'),
      ex('🙈', 'Hide: covers you tap away', 'Draw a Hide over an answer, a price or the next step: blurred, frosted, solid or striped, any size. While locked, presenting or on a shared link, one tap reveals what is underneath.'),
      ex('🔗', 'Share a board as a link', 'Share gives a board a link: open to anyone, or behind a password, and limited to any number of people (one browser counts as one person). Remove a person to free their place, or reset the link to cut everyone off. Viewers can look, flip cards and copy prompts, but not change anything.'),
      ex('🫧', 'In tank view every project is a tank', 'The liquid level is its health. Post, promote or improve it and it fills. Ignore it and the liquid drops, cracks appear, smoke rises and the flow slows. Below 30% it is dying.'),
      ex('🕰️', 'It runs on the real clock', 'Through the day each tank slowly drifts toward where it will be tomorrow if you do nothing, so neglect shows by evening. The top bar counts what has come in so far today.'),
      ex('🪙', 'Four kinds of flow move through the pipes', 'Gold coins = money (TZS), orange orbs = attention (views), green = customers, pink sparks = progress (tools and content that speed another project up). Brighter and busier = more flow.'),
      ex('🟢', 'Read a tank at a glance', 'The ring on the floor around each tank is its health: it fills like a progress ring and turns green, yellow, orange or red. Hover or tap a tank for its numbers.'),
      ex('🖐️', 'Moving around', 'Drag to move the map. Pinch or use the mouse wheel to zoom. On a trackpad or phone, two fingers moving together also move the map. Twist two fingers, right-drag, or use ⟳ to rotate; ◩ switches to a top-down view; ⛶ (or the F key) goes full screen.'),
      ex('👆', 'Do things right on the map', 'Right-click (or press and hold on a phone) a tank, a pipe or empty ground for a menu: water a project, plan a task, draw a pipe, scan channels or add a project exactly there. A selected tank shows quick buttons too.'),
      ex('🎯', 'Goals', 'Give a project a goal (followers, money per month, customers or views per month) in its settings. A gold ring around the tank fills as you get closer, and with a deadline FlowMap shows the pace you need per day.'),
      ex('▦', 'Areas and tidy up', 'Tanks are grouped into areas (Channels, Apps & sites, Sales, or your own names) with a soft zone on the floor. ⋯ → Tidy up arranges everything so pipes cross as little as possible; you can undo it.'),
      ex('☀️', 'Mornings and weeks', 'On your first visit each day the map replays what changed since yesterday. On Sundays you get a week in review with a score for how well you kept every project watered. Light on the map follows your time of day.'),
      ex('✅', 'Today card', 'Bottom-left: today\'s and overdue tasks with checkboxes, how many you finished, and your streak of days with real work. Tick a task and its tank splashes.'),
      ex('🔗', 'Channel links scan themselves', 'Add your YouTube, TikTok, website or Play Store links to a project. FlowMap reads them every morning: new uploads count as posts and view growth becomes attention, so you log less by hand.'),
      ex('🧠', 'An AI brain', 'Connect Claude, ChatGPT or another AI agent, or give FlowMap your own AI key. The brain reads the whole system, fixes numbers that look wrong, writes notes and gives you concrete tasks. Set it up with the 🧠 button.'),
      ex('🎬', 'Every project earns in its own way', 'Channels earn from ad revenue, TikTok makes attention, apps and websites earn from paying customers in TZS. No visitor counts needed for apps.'),
      ex('💧', 'Water it when you act', 'After posting a video or promo, tap “Water”. Tell it how you feel about it and which projects you pushed. The pipes you aimed at surge, then fade over days.'),
      ex('⏩', 'Slide into the future', 'Drag the slider at the bottom to see where each project will be in a week, a month or three months if your planned tasks happen. The Forecast tab compares that with keeping your pace or stopping.'),
      ex('✍️', 'Make it yours', 'Double-click empty space to add a project. Use Connect to draw a pipe between two projects. Click a pipe to change how much flows, what it costs and how long it takes. Add tasks such as a sponsored ad for this week.'),
      ex('📝', 'Check-ins keep the system alive', 'Log what each project made, or set a whole month at once. Choose how often you check in (daily, weekly or monthly) in ⚙️ Settings, or per project. When a check-in is late, that project\'s health and flow sag, its pipes slow down, and the projects it feeds weaken too, until you check in again.'),
      ex('🎯', 'Clean view', 'Press C (or the clean-view button next to the zoom) for full screen with only the system: no buttons, no panels. A card pulses yellow when it needs attention and red when it needs you now. Esc brings everything back.'),
      ex('⏸', 'Animations off', 'In ⚙️ Settings you can turn animations off. Nothing moves, and the flowing lights become still arrows pointing the way things flow.'),
    ),
    actions: [{ label: 'Got it', kind: 'primary' }],
  });
}

// ---------- settings / data ----------
export function openSettings() {
  const user = S.user;
  let name = user.name;
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const json = JSON.parse(await f.text());
      if (!Array.isArray(json.projects)) throw new Error('This file is not a FlowMap export');
      if (!(await confirmDialog({ title: 'Replace everything with this file?', message: `It contains ${json.projects.length} projects. Your current map will be replaced.`, confirm: 'Import', danger: true }))) return;
      if (await importWorld(json)) { notify('Imported', 'good'); closeAllModals(); }
    } catch (err) { notify(err.message || 'Could not read that file', 'error'); }
    e.target.value = '';
  } });
  let tpl = 'creator';
  const pw = { current: '', next: '' };
  const soundBtn = h('button', { class: `btn${sound.enabled ? ' on' : ''}`, onclick: (e) => { sound.enabled = !sound.enabled; e.currentTarget.classList.toggle('on', sound.enabled); setText(e.currentTarget, sound.enabled ? '🔊 Sound on' : '🔇 Sound off'); if (sound.enabled) sfx.pop(); } }, sound.enabled ? '🔊 Sound on' : '🔇 Sound off');
  const themeHost = h('div');
  const paintTheme = () => clear(themeHost).append(chipGroup(
    [{ value: 'system', label: '🖥️ Same as device' }, { value: 'light', label: '☀️ Light' }, { value: 'dark', label: '🌙 Dark' }],
    window.flowmapTheme?.pref || 'system', (v) => { window.flowmapTheme?.set(v); paintTheme(); }));
  paintTheme();
  const motionHost = h('div');
  const paintMotion = () => clear(motionHost).append(chipGroup(
    [{ value: 'full', label: '✨ Animations on' }, { value: 'calm', label: '⏸ Animations off' }],
    window.flowmapMotion?.calm ? 'calm' : 'full', (v) => { window.flowmapMotion?.set(v); paintMotion(); }),
    h('div', { class: 'hint' }, window.flowmapMotion?.calm ? 'Nothing moves. Pipes show still arrows pointing the way things flow.' : 'Lights flow through the pipes and cards react with small animations.'));
  paintMotion();
  const rhythmHost = h('div');
  const RHYTHM_HINT = { daily: 'Check in every day. Miss a day and that project\'s flow, speed and health start to drop, and the projects it feeds feel it too.', weekly: 'Check in once a week. After a week without numbers the project starts to slow down.', monthly: 'Check in once a month, for projects you track loosely.', off: 'Check-ins never slow anything down.' };
  const paintRhythm = () => clear(rhythmHost).append(chipGroup(
    [{ value: 'daily', label: '📅 Daily' }, { value: 'weekly', label: '🗓️ Weekly' }, { value: 'monthly', label: '📆 Monthly' }, { value: 'off', label: 'Off' }],
    S.world.checkin || 'daily', (v) => { setCheckinRhythm(v).catch((e) => notify(e.message, 'error')); paintRhythm(); }),
    h('div', { class: 'hint' }, `${RHYTHM_HINT[S.world.checkin || 'daily']} Each project can have its own rhythm in its settings.`));
  paintRhythm();
  const styleHost = h('div');
  const paintStyle = () => clear(styleHost).append(chipGroup(MAP_STYLES.map(({ value, label }) => ({ value, label })), getMapStyle(), (v) => { setMapStyle(v); paintStyle(); }),
    h('div', { class: 'hint' }, MAP_STYLES.find((m) => m.value === getMapStyle()).hint));
  paintStyle();
  const body = h('div', null,
    h('div', { class: 'sec' }, 'Appearance'),
    field('Theme', themeHost),
    field('Map style', styleHost),
    field('Motion', motionHost),
    h('div', { class: 'sec' }, 'Check-ins'),
    field('How often you log your numbers', rhythmHost),
    h('div', { class: 'sec' }, 'Account'),
    field('Your name', h('input', { type: 'text', value: name, maxLength: 60, oninput: (e) => { name = e.target.value; } }), user.email),
    h('div', { class: 'grid2' },
      field('Current password', h('input', { type: 'password', autocomplete: 'current-password', oninput: (e) => { pw.current = e.target.value; } })),
      field('New password (8+ characters)', h('input', { type: 'password', autocomplete: 'new-password', oninput: (e) => { pw.next = e.target.value; } }))),
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn', onclick: async () => {
        try {
          await patch('/api/me', { name });
          S.user.name = name;
          if (pw.current || pw.next) { await post('/api/me/password', pw); pw.current = pw.next = ''; }
          notify('Saved', 'good');
        } catch (e) { notify(e.message, 'error'); }
      } }, 'Save account'),
      soundBtn,
      h('button', { class: 'btn', onclick: () => { closeAllModals(); dialogHooks.logout(); } }, 'Sign out')),
    h('div', { class: 'sec' }, 'Channel scanning'),
    field('YouTube API key (optional)', h('div', { class: 'row' },
      h('input', { id: 's-ytkey', type: 'password', autocomplete: 'off', class: 'grow', placeholder: user.hasYoutubeKey ? 'Saved. Type a new key to replace it' : 'Paste a key from Google Cloud Console' }),
      h('button', { class: 'btn', onclick: async () => {
        const v = document.getElementById('s-ytkey').value.trim();
        try { await saveSecrets({ youtubeKey: v }); notify(v ? 'YouTube key saved' : 'YouTube key removed', 'good'); document.getElementById('s-ytkey').value = ''; } catch (e) { notify(e.message, 'error'); }
      } }, 'Save')),
    'Without a key FlowMap reads your public channel page, which gives approximate numbers. A free YouTube Data API key gives exact views and upload times. Leave empty and save to remove it.'),
    h('div', { class: 'sec' }, 'Your data (stored in the cloud database)'),
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn', onclick: async () => { try { download(`flowmap-${S.today}.json`, JSON.stringify(await exportWorld(), null, 2)); } catch (e) { notify(e.message, 'error'); } } }, '⬇ Export backup'),
      h('button', { class: 'btn', onclick: () => fileInput.click() }, '⬆ Import backup'), fileInput,
      hasSample() ? h('button', { class: 'btn', onclick: async () => { await clearSample(); notify('Sample activity cleared', 'good'); closeAllModals(); } }, 'Clear sample activity') : null),
    h('div', { class: 'sec' }, 'Start over'),
    h('div', { class: 'row' },
      h('div', { class: 'grow' }, select([{ value: 'creator', label: 'Creator empire (your 8 projects)' }, { value: 'newstart', label: 'New Beginning (real numbers + 90-day plan)' }, { value: 'blank', label: 'Blank canvas' }], tpl, (v) => { tpl = v; })),
      h('button', { class: 'btn danger', onclick: async () => {
        if (!(await confirmDialog({ title: 'Replace your whole map?', message: 'All projects, pipes, tasks and logs will be replaced by the template.', confirm: 'Replace everything', danger: true }))) return;
        await resetWorld(tpl); closeAllModals();
      } }, 'Load template')),
    h('div', { class: 'row', style: 'margin-top:16px' },
      h('button', { class: 'btn ghost sm', onclick: () => { closeAllModals(); openHelp(); } }, '❓ How it works'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn danger sm', onclick: async () => {
        const password = prompt('Type your password to permanently delete your account and all data:');
        if (!password) return;
        try { await api('DELETE', '/api/me', { password }); auth.token = null; location.reload(); } catch (e) { notify(e.message, 'error'); }
      } }, 'Delete account')),
  );
  return openModal({ title: 'Settings & data', body, actions: [{ label: 'Close', kind: 'primary' }] });
}
