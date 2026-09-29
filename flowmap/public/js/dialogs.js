// Modal dialogs: project / pipe / task editors, the "water it" dialog, help and settings.
import { h, clear, fmtNum, fmtFull, download, fmtDay } from './util.js';
import { S, snap, project, projects, nameOf, addProject, updateProject, deleteProject, addLink, updateLink, deleteLink,
  addTask, updateTask, deleteTask, completeTask, notify, hasSample, clearSample, resetWorld, importWorld, exportWorld } from './store.js';
import { KINDS, KIND_KEYS, RESOURCES, TASK_TYPES, CHANNELS, cfgOf, configBase } from '/shared/engine.js';
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
    ? { name: existing.name, kind: existing.kind, icon: existing.icon, color: existing.color, monthlyCost: existing.monthlyCost, note: existing.note, cfg: { ...cfgOf(existing) } }
    : { name: '', kind: startKind, icon: '', color: '', monthlyCost: 0, note: '', cfg: kindDefaults(startKind) };

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
    d.cfg = existing ? { ...kindDefaults(k), ...d.cfg } : kindDefaults(k);
    if (!existing && !d.icon) d.icon = '';
    renderCfg(); paintIcons();
  }));

  const body = h('div', null,
    field('Name', h('input', { type: 'text', value: d.name, maxLength: 80, placeholder: 'e.g. Vinei TV, my new app…', oninput: (e) => { d.name = e.target.value; } })),
    h('div', { class: 'field' }, h('label', null, 'What kind of project is it?'), kindHost, h('div', { class: 'hint' }, 'Each type earns and feeds the system in its own way.')),
    h('div', { class: 'sec' }, 'Look'),
    h('div', { class: 'field' }, h('label', null, 'Icon'), iconHost),
    h('div', { class: 'field' }, h('label', null, 'Color'), colorHost),
    h('div', { class: 'sec' }, 'How it earns'),
    cfgHost, preview,
    h('div', { class: 'sec' }, 'Rhythm & cost'),
    h('div', { class: 'grid2' },
      field('Needs a post / action every (days)', numInput(d.cfg.cadenceDays, (v) => { d.cfg.cadenceDays = Math.max(1, v ?? 1); }, { min: 1, max: 90 }), 'Miss this rhythm and the project starts to dry out.'),
      field('Monthly cost (TZS)', numInput(d.monthlyCost, (v) => { d.monthlyCost = v ?? 0; }, { min: 0 }), 'Tools, servers, subscriptions, ad budget.')),
    field('Notes', h('textarea', { maxLength: 600, oninput: (e) => { d.note = e.target.value; } }, d.note || '')),
  );
  paintKind(); paintIcons(); paintColors(); renderCfg();

  const actions = [];
  if (existing) actions.push({ label: 'Delete', kind: 'danger', onClick: async () => {
    if (!(await confirmDialog({ title: `Delete ${existing.name}?`, message: 'This also removes its pipes, tasks and daily logs. This cannot be undone.', confirm: 'Delete project', danger: true }))) return false;
    await deleteProject(existing.id);
    return true;
  } });
  actions.push({ label: 'Cancel' }, { label: existing ? 'Save changes' : 'Add to map', kind: 'primary', onClick: async () => {
    if (!d.name.trim()) { notify('Give the project a name first', 'error'); return false; }
    const data = { name: d.name.trim(), kind: d.kind, icon: d.icon || '', color: d.color || '', monthlyCost: d.monthlyCost || 0, note: d.note || '', cfg: d.cfg };
    if (existing) await updateProject(existing.id, data);
    else {
      const pos = opts.x !== undefined ? { x: opts.x, y: opts.y } : freeSpot();
      const p = await addProject({ ...data, ...pos });
      if (p) { sfx.pop(); notify(`${p.name} added. Now connect it: pick "Connect" and tap two projects.`, 'good'); }
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
    title: 'How your living map works', wide: true,
    body: h('div', { class: 'explain' },
      ex('🫧', 'Every project is a tank', 'The liquid level is its health. Post, promote or improve it and it fills. Ignore it and the liquid drops, cracks appear and the flow slows. Below 30% it is dying.'),
      ex('🪙', 'Four kinds of water flow through the pipes', 'Gold = money (TZS), blue = attention (views), green = customers, purple = progress (tools and content that speed another project up). Thicker and faster = more flow.'),
      ex('🎬', 'Every project earns in its own way', 'Channels earn from ad revenue, TikTok makes attention, apps and websites earn from paying customers in TZS. No visitor counts needed for apps.'),
      ex('💧', 'Water it when you act', 'After posting a video or promo, tap “Water”. Tell it how you feel about it and which projects you pushed. The pipes you aimed at surge, then fade over days.'),
      ex('⏩', 'Scrub the timeline', 'Drag the bar at the bottom to see the future. Compare “planned tasks only”, “keep my pace” and “stop posting” to see what happens if you slack.'),
      ex('✍️', 'Make it yours', 'Double-click empty space to add a project. Use Connect to draw a pipe between two projects. Click a pipe to change how much flows, what it costs and how long it takes. Add tasks such as a sponsored ad for this week.'),
      ex('📝', 'Daily check-in keeps it honest', 'Log what each project made today, or set a whole month at once. The simulation adapts to your real numbers.'),
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
  const soundBtn = h('button', { class: `btn${sound.enabled ? ' on' : ''}`, onclick: (e) => { sound.enabled = !sound.enabled; e.currentTarget.classList.toggle('on', sound.enabled); e.currentTarget.textContent = sound.enabled ? '🔊 Sound on' : '🔇 Sound off'; if (sound.enabled) sfx.pop(); } }, sound.enabled ? '🔊 Sound on' : '🔇 Sound off');
  const body = h('div', null,
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
    h('div', { class: 'sec' }, 'Your data (stored in the cloud database)'),
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn', onclick: async () => { try { download(`flowmap-${S.today}.json`, JSON.stringify(await exportWorld(), null, 2)); } catch (e) { notify(e.message, 'error'); } } }, '⬇ Export backup'),
      h('button', { class: 'btn', onclick: () => fileInput.click() }, '⬆ Import backup'), fileInput,
      hasSample() ? h('button', { class: 'btn', onclick: async () => { await clearSample(); notify('Sample activity cleared', 'good'); closeAllModals(); } }, 'Clear sample activity') : null),
    h('div', { class: 'sec' }, 'Start over'),
    h('div', { class: 'row' },
      h('div', { class: 'grow' }, select([{ value: 'creator', label: 'Creator empire (your 8 projects)' }, { value: 'blank', label: 'Blank canvas' }], tpl, (v) => { tpl = v; })),
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
