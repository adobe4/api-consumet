// FlowMap simulation engine.
// Pure functions, no DOM and no Node APIs, so the browser and the server run identical maths.
//
// Mental model
//  - Every project has a HEALTH (0-100) that rises when you take action (post, promo, task) and
//    decays when you neglect it. Health sets the project's FLOW LEVEL (how fast its "water" runs).
//  - Numbers you enter are the run-rate of a HEALTHY project. Neglect thins the flow, good posts
//    (pulses) thicken it, and pipes carry a share of a project's output into the projects it feeds.
//  - Four resources flow along pipes: money, attention, customers, progress.

export const RESOURCES = {
  money: { label: 'Money', unit: 'TZS', color: '#ffc933', ref: 150000, speed: 0.8 },
  attention: { label: 'Attention', unit: 'views', color: '#ff8a3d', ref: 40000, speed: 1.15 },
  customers: { label: 'Customers', unit: 'customers', color: '#46e58a', ref: 15, speed: 0.7 },
  progress: { label: 'Progress', unit: 'energy', color: '#ff5fa2', ref: 1, speed: 0.95 },
};
export const RESOURCE_KEYS = Object.keys(RESOURCES);

// cadenceDays = how often the project needs a post / action to stay healthy.
export const KINDS = {
  youtube: { label: 'YouTube channel', icon: '▶️', color: '#ff4d5e', cadenceDays: 3, shape: 'screen',
    defaults: { viewsPerDay: 3000, rpm: 900, baseMoneyPerDay: 0, viewsPerAttention: 0.04 } },
  tiktok: { label: 'TikTok account', icon: '🎵', color: '#b8e04a', cadenceDays: 1, shape: 'circle',
    defaults: { viewsPerDay: 8000, viewsPerAttention: 0.03 } },
  app: { label: 'App', icon: '📱', color: '#e8b86b', cadenceDays: 7, shape: 'phone',
    defaults: { price: 5000, billing: 'monthly', activeCustomers: 20, newPerDay: 1, churnPct: 15, conversionPer1000: 1 } },
  website: { label: 'Website / marketplace', icon: '🌐', color: '#ffa94d', cadenceDays: 7, shape: 'browser',
    defaults: { price: 15000, billing: 'one_off', activeCustomers: 0, newPerDay: 0.6, churnPct: 0, conversionPer1000: 1 } },
  service: { label: 'Sales channel / service', icon: '💬', color: '#4be38a', cadenceDays: 2, shape: 'bubble',
    defaults: { price: 10000, billing: 'monthly', activeCustomers: 40, newPerDay: 0.8, churnPct: 12, conversionPer1000: 3 } },
  custom: { label: 'Custom project', icon: '⬢', color: '#d9b38c', cadenceDays: 7, shape: 'hex',
    defaults: { viewsPerDay: 0, price: 0, billing: 'none', activeCustomers: 0, newPerDay: 0, churnPct: 0, conversionPer1000: 1, baseMoneyPerDay: 0 } },
};
export const KIND_KEYS = Object.keys(KINDS);

// strength = how big a burst this action makes, half = days for the burst to fade to half.
export const TASK_TYPES = {
  video: { label: 'Post a video', icon: '🎬', strength: 1.0, half: 4 },
  tiktok: { label: 'TikTok post', icon: '🎵', strength: 0.6, half: 1.5 },
  tutorial: { label: 'Tutorial', icon: '🎓', strength: 0.8, half: 6 },
  promo: { label: 'Promo / self-promo', icon: '📣', strength: 0.9, half: 3 },
  ad: { label: 'Paid ad', icon: '💸', strength: 1.2, half: 2 },
  sponsored: { label: 'Sponsored deal', icon: '🤝', strength: 1.0, half: 5 },
  update: { label: 'Update / improve', icon: '🛠️', strength: 0.7, half: 7 },
  other: { label: 'Other task', icon: '✅', strength: 0.4, half: 3 },
};
export const CHANNELS = {
  in_video: { label: 'Inside the video', factor: 1.0 },
  pinned: { label: 'Pinned comment', factor: 0.7 },
  description: { label: 'Video description', factor: 0.5 },
  tiktok: { label: 'TikTok', factor: 0.8 },
  whatsapp: { label: 'WhatsApp status / groups', factor: 0.9 },
  community: { label: 'Community post / Stories', factor: 0.6 },
  ads: { label: 'Paid placement', factor: 1.1 },
  other: { label: 'Somewhere else', factor: 0.5 },
};
const QUALITY = [0, 0.4, 0.7, 1.0, 1.3, 1.7]; // "how do I feel about it" 1..5

// ---------- dates (all 'YYYY-MM-DD' strings, treated as UTC day numbers) ----------
export const dayNum = (s) => {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
};
export const dayStr = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
export const addDays = (s, n) => dayStr(dayNum(s) + n);
export const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const clamp01 = (v) => clamp(v, 0, 1);
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const squash = (x, cap = 1.6) => cap * Math.tanh(x / cap);

const HEAL_TYPE = { youtube: 'video', tiktok: 'tiktok', app: 'promo', website: 'promo', service: 'promo', custom: 'other' };

export function cfgOf(p) {
  const k = KINDS[p.kind] || KINDS.custom;
  return { ...k.defaults, cadenceDays: k.cadenceDays, ...(p.cfg || {}) };
}
export const cadenceOf = (p) => Math.max(1, num(cfgOf(p).cadenceDays, 3));

export function statusOf(health) {
  if (health >= 75) return 'thriving';
  if (health >= 50) return 'steady';
  if (health >= 30) return 'thirsty';
  return 'dying';
}
export const flowLevelOf = (health) => 0.12 + 0.88 * clamp01(health / 100);

// ---------- check-in rhythm ----------
// How often the owner says they will log real numbers: for the whole system (world.checkin) or per project
// (cfg.checkin, '' = follow the system). A check-in that is overdue makes that project's numbers stale:
// its health and flow sag, its pipes slow, and the projects it feeds feel it too.
export const CHECKIN_RHYTHMS = { daily: 1, weekly: 7, monthly: 30 };
export const checkinDaysOf = (world, p) => CHECKIN_RHYTHMS[(p.cfg && p.cfg.checkin) || world.checkin] || 0;
// 1 = fresh, falling to 0.4 once a check-in is more than two rhythms late
export function freshAt(ctx, p, dn) {
  const R = ctx.rhythm.get(p.id);
  if (!R) return { fresh: 1, overdue: 0, lastCheckin: null };
  // the forecast assumes you check in again from tomorrow; only "stop" keeps the silence going
  if (dn > ctx.todayN && ctx.scenario !== 'stop') return { fresh: 1, overdue: 0, lastCheckin: null };
  const days = ctx.checkins.get(p.id);
  let last = null;
  for (const d of days) { if (d > Math.min(dn, ctx.todayN)) break; last = d; }
  if (last === null) last = p.createdOn ? dayNum(p.createdOn) : null; // a new project gets one rhythm of grace
  if (last === null) return { fresh: 1, overdue: 0, lastCheckin: null };
  const overdue = Math.max(0, dn - last - R);
  return { fresh: overdue ? 1 - 0.6 * clamp01(overdue / (2 * R + 1)) : 1, overdue, lastCheckin: dayStr(last) };
}

// ---------- context ----------
// scenario: 'planned' = only the tasks already on your list happen
//           'keep'    = you also keep posting at each project's cadence
//           'stop'    = nothing more happens
export function buildContext(world, { today, scenario = 'planned' }) {
  const todayN = dayNum(today);
  const projects = (world.projects || []).filter((p) => !p.archived);
  const byId = new Map(projects.map((p) => [p.id, p]));
  const links = (world.links || []).filter((l) => byId.has(l.from) && byId.has(l.to) && l.from !== l.to);
  const outgoing = new Map(projects.map((p) => [p.id, []]));
  const incoming = new Map(projects.map((p) => [p.id, []]));
  for (const l of links) { outgoing.get(l.from).push(l); incoming.get(l.to).push(l); }

  // actions per project (day numbers), pulses (bursts) per project
  const actions = new Map(projects.map((p) => [p.id, []]));
  const pulses = new Map(projects.map((p) => [p.id, []]));
  const pushPulse = (task, dn, planned) => {
    const type = TASK_TYPES[task.type] || TASK_TYPES.other;
    const q = QUALITY[clamp(Math.round(num(task.quality, 3)), 1, 5)];
    const ch = (CHANNELS[task.channel] || CHANNELS.in_video).factor;
    pulses.get(task.projectId).push({
      day: dn, targets: (task.targets || []).filter((t) => byId.has(t)),
      strength: type.strength * q * ch, half: type.half, planned,
    });
  };
  for (const p of projects) {
    const a = actions.get(p.id);
    const cn = p.createdOn ? dayNum(p.createdOn) : todayN;
    a.push(Math.min(cn, todayN), Math.min(cn, todayN)); // grace period: a new project counts as 2 actions
  }
  for (const t of world.tasks || []) {
    if (!actions.has(t.projectId)) continue;
    if (t.status === 'done' && t.doneOn) {
      const dn = dayNum(t.doneOn);
      actions.get(t.projectId).push(dn);
      pushPulse(t, dn, false);
    } else if (t.status !== 'done' && scenario !== 'stop' && t.due) {
      // today shows only what really happened; an unfinished task (even one due today) counts from tomorrow
      const dn = Math.max(dayNum(t.due), todayN + 1);
      actions.get(t.projectId).push(dn);
      pushPulse({ ...t, quality: t.quality || 3 }, dn, true);
    }
  }
  const logsBy = new Map(projects.map((p) => [p.id, []]));
  for (const l of world.logs || []) {
    if (!logsBy.has(l.projectId)) continue;
    logsBy.get(l.projectId).push(l);
    if (num(l.posts) > 0) actions.get(l.projectId).push(dayNum(l.day));
  }
  if (scenario === 'keep') {
    for (const p of projects) {
      const cad = cadenceOf(p);
      const type = p.kind === 'youtube' ? 'video' : p.kind === 'tiktok' ? 'tiktok' : 'promo';
      for (let d = todayN + 1; d <= todayN + 400; d += cad) {
        actions.get(p.id).push(d);
        pushPulse({ projectId: p.id, type, quality: 3, channel: 'in_video', targets: [] }, d, true);
      }
    }
  }
  for (const a of actions.values()) a.sort((x, y) => x - y);
  // "normal rhythm": the burst level you would carry if you posted on schedule with an average post.
  // Run-rates are defined at this level, so only posts above/below your rhythm move the numbers.
  const steady = new Map(projects.map((p) => {
    const t = TASK_TYPES[HEAL_TYPE[p.kind] || 'other'];
    return [p.id, t.strength / (1 - Math.pow(0.5, cadenceOf(p) / t.half))];
  }));
  const rhythm = new Map(projects.map((p) => [p.id, checkinDaysOf(world, p)]));
  const checkins = new Map(projects.map((p) => [p.id, [...new Set(logsBy.get(p.id).map((l) => dayNum(l.day)))].sort((a, b) => a - b)]));
  return { today, todayN, scenario, projects, byId, links, outgoing, incoming, actions, pulses, steady, logsBy, rhythm, checkins, base: new Map() };
}

// ---------- health & pulses ----------
export function healthAt(ctx, p, dn) {
  const cad = cadenceOf(p);
  const acts = ctx.actions.get(p.id);
  let last = -Infinity;
  let inWindow = 0;
  const win = cad * 4;
  for (const a of acts) {
    if (a > dn) break;
    last = a;
    if (a > dn - win) inWindow++;
  }
  if (last === -Infinity) return { health: 0, daysSince: 999, lastAction: null };
  const since = dn - last;
  const recency = clamp01(1 - Math.max(0, since - cad) / (cad * 3));
  const consistency = clamp01(inWindow / 4);
  return { health: Math.round(100 * (0.6 * recency + 0.4 * consistency) * 10) / 10, daysSince: since, lastAction: dayStr(last) };
}

function pulseSum(ctx, projectId, dn, filter) {
  let s = 0;
  for (const pu of ctx.pulses.get(projectId) || []) {
    const age = dn - pu.day;
    if (age < 0 || age > pu.half * 6) continue;
    const w = filter ? filter(pu) : 1;
    if (!w) continue;
    s += pu.strength * w * Math.pow(0.5, age / pu.half);
  }
  return s;
}
// Multiplier for one pipe. A post aimed at a project pushes its pipe fully; an un-aimed post gives each pipe a quarter.
// 1.0 = your normal rhythm, above = a hot streak of aimed posts, below = the pipe is going quiet.
function linkBoost(ctx, link, dn) {
  const s = pulseSum(ctx, link.from, dn, (pu) => (pu.targets.length === 0 ? 0.25 : pu.targets.includes(link.to) ? 1 : 0));
  return clamp(0.6 + (0.4 * s) / (0.25 * ctx.steady.get(link.from)), 0.6, 3);
}
// Multiplier on the project's own output (views spike after a hit video, customers after a promo).
const selfMult = (ctx, p, dn) => clamp(0.75 + (0.25 * pulseSum(ctx, p.id, dn)) / ctx.steady.get(p.id), 0.75, 2);

// ---------- baseline run-rates ----------
export function configBase(p) {
  const c = cfgOf(p);
  let attention = 0, money = 0, customers = 0;
  if (p.kind === 'youtube' || p.kind === 'tiktok' || (p.kind === 'custom' && num(c.viewsPerDay) > 0)) attention = num(c.viewsPerDay);
  if (p.kind === 'youtube') money += (attention * num(c.rpm)) / 1000;
  if (p.kind !== 'youtube' && p.kind !== 'tiktok') {
    customers = num(c.newPerDay);
    if (c.billing === 'monthly') money += (num(c.activeCustomers) * num(c.price)) / 30;
    else if (c.billing === 'one_off') money += customers * num(c.price);
  }
  money += num(c.baseMoneyPerDay);
  return { attention, money, customers };
}

// Logged actuals (last 14 days) override the config. They describe how things are *today*, so they are
// scaled up by today's flow level to recover the healthy run-rate the simulation works from.
function baseFor(ctx, p) {
  const b = configBase(p);
  const fl0 = Math.max(0.3, flowLevelOf(healthAt(ctx, p, ctx.todayN).health));
  const logs = ctx.logsBy.get(p.id).filter((l) => {
    const d = ctx.todayN - dayNum(l.day);
    return d >= 0 && d < 14;
  });
  for (const key of ['money', 'attention', 'customers']) {
    const vals = [];
    for (const l of logs) {
      if (typeof l[key] !== 'number') continue;
      vals.push(l[key]);
    }
    if (vals.length) b[key] = vals.reduce((a, c) => a + c, 0) / vals.length / fl0;
  }
  return b;
}

// ---------- simulation ----------
export function simulate(world, { today, horizon = 90, scenario = 'planned' } = {}) {
  const ctx = buildContext(world, { today, scenario });
  const P = ctx.projects;
  const base = new Map(P.map((p) => [p.id, baseFor(ctx, p)]));
  ctx.base = base;

  // reference: healthy, un-pulsed system -> incomings the base numbers already contain
  const refInc = new Map();
  for (const p of P) {
    let att = 0, cust = 0, money = 0, prog = 0;
    for (const l of ctx.incoming.get(p.id)) {
      const src = base.get(l.from);
      if (l.resource === 'attention') att += src.attention * l.share;
      else if (l.resource === 'customers') cust += src.customers * l.share;
      else if (l.resource === 'money') money += src.money * l.share;
      else if (l.resource === 'progress') prog += l.share;
    }
    refInc.set(p.id, { att, cust, money, prog });
  }

  // The base numbers already contain what the ecosystem delivers today. Cap that share so that a
  // generous conversion setting can never claim more than the project actually earns.
  const eco = new Map();
  for (const p of P) {
    const c = cfgOf(p);
    const ref = refInc.get(p.id);
    const b = base.get(p.id);
    const attKind = p.kind === 'youtube' || p.kind === 'tiktok';
    const claimed = attKind ? ref.att * num(c.viewsPerAttention, 0.04) : (ref.att / 1000) * num(c.conversionPer1000, 1) + ref.cust;
    const own = attKind ? b.attention : b.customers;
    eco.set(p.id, claimed > 0 ? Math.min(1, (0.85 * own) / claimed) : 1);
  }

  const extra = new Map(P.map((p) => [p.id, 0])); // Δ-customers living on subscription
  const days = [];
  const hist = []; // for pipe delays: hist[d] = Map(id -> totals)

  for (let d = 0; d <= horizon; d++) {
    const dn = ctx.todayN + d;
    const state = new Map();
    // phase 1: health and own output
    for (const p of P) {
      const h = healthAt(ctx, p, dn);
      const f = freshAt(ctx, p, dn);
      // stale numbers: health sags and the project gives out less
      const health = Math.round(h.health * (0.55 + 0.45 * f.fresh) * 10) / 10;
      const flow = flowLevelOf(health) * (0.5 + 0.5 * f.fresh);
      const sb = selfMult(ctx, p, dn) - 1;
      state.set(p.id, { p, ...h, health, flow, sb, fresh: f.fresh, overdue: f.overdue, lastCheckin: f.lastCheckin });
    }
    // a living system: projects fed by stale ones weaken too
    for (const p of P) {
      const inc = ctx.incoming.get(p.id);
      if (!inc.length) continue;
      const u = inc.reduce((a, l) => a + (1 - state.get(l.from).fresh), 0) / inc.length;
      if (u <= 0) continue;
      const st = state.get(p.id);
      st.health = Math.round(st.health * (1 - 0.25 * u) * 10) / 10;
      st.flow *= 1 - 0.15 * u;
      st.upstreamStale = u;
    }
    // phase 2: incoming effects from yesterday (or delayed) totals
    const srcAt = (l) => {
      const k = d - 1 - Math.max(0, Math.round(num(l.delay)));
      if (k >= 0) return hist[k].get(l.from);
      // before day 0 we only know today's own health, so approximate with the source's own run-rate
      const st = state.get(l.from);
      const m = st.flow * (1 + st.sb);
      const b = base.get(l.from);
      return { attention: b.attention * m, customers: b.customers * m, money: b.money * m, flow: st.flow };
    };
    for (const p of P) {
      const st = state.get(p.id);
      const c = cfgOf(p);
      const ref = refInc.get(p.id);
      let att = 0, cust = 0, money = 0, prog = 0;
      for (const l of ctx.incoming.get(p.id)) {
        const src = srcAt(l);
        if (!src) continue;
        const boost = linkBoost(ctx, l, dn);
        if (l.resource === 'attention') att += src.attention * l.share * boost;
        else if (l.resource === 'customers') cust += src.customers * l.share * boost;
        else if (l.resource === 'money') money += src.money * l.share;
        else if (l.resource === 'progress') prog += l.share * src.flow * boost;
      }
      const progD = clamp(0.35 * (prog - ref.prog), -0.35, 0.3);
      const dailyCost = num(p.monthlyCost) / 30;
      const fuelD = 0.25 * Math.tanh((money - ref.money) / Math.max(3000, dailyCost * 8));
      const mult = st.flow * (1 + st.sb) * (1 + progD) * (1 + fuelD);
      const b = base.get(p.id);
      let attention = b.attention * mult;
      let customers = b.customers * mult;
      let moneyOwn = b.money * mult;
      // ecosystem deltas
      const attKind = p.kind === 'youtube' || p.kind === 'tiktok';
      if (attKind) {
        const dViews = (att - ref.att) * num(c.viewsPerAttention, 0.04) * eco.get(p.id);
        attention += dViews;
        if (p.kind === 'youtube') moneyOwn += (dViews * num(c.rpm)) / 1000;
      } else {
        const dCust = (((att - ref.att) / 1000) * num(c.conversionPer1000, 1) + (cust - ref.cust)) * eco.get(p.id);
        customers += dCust;
        if (c.billing === 'monthly') {
          extra.set(p.id, Math.max(-num(c.activeCustomers), extra.get(p.id) * (1 - num(c.churnPct) / 100 / 30) + dCust));
          moneyOwn += (extra.get(p.id) * num(c.price)) / 30;
        } else if (c.billing === 'one_off') moneyOwn += dCust * num(c.price);
      }
      Object.assign(st, {
        attention: Math.max(0, attention), customers: Math.max(0, customers), money: Math.max(0, moneyOwn),
        progress: st.flow, fuelIn: money, incAttention: att, incCustomers: cust, incProgress: prog,
        progressBoost: progD, fuelBoost: fuelD,
      });
    }
    // phase 3: costs (monthly + pipes + planned task spend), pipe flows
    const spend = new Map();
    for (const t of world.tasks || []) {
      if (!state.has(t.projectId) || !num(t.cost)) continue;
      const when = t.status === 'done' ? t.doneOn : t.due;
      if (when && dayNum(when) === dn) spend.set(t.projectId, (spend.get(t.projectId) || 0) + t.cost);
    }
    const pipeCost = new Map();
    for (const l of ctx.links) pipeCost.set(l.from, (pipeCost.get(l.from) || 0) + num(l.cost) / 30);
    const tot = { money: 0, cost: 0, attention: 0, customers: 0, health: 0 };
    const projOut = {};
    for (const p of P) {
      const st = state.get(p.id);
      st.cost = num(p.monthlyCost) / 30 + (pipeCost.get(p.id) || 0) + (spend.get(p.id) || 0);
      st.profit = st.money - st.cost;
      st.status = statusOf(st.health);
      tot.money += st.money; tot.cost += st.cost; tot.attention += st.attention; tot.customers += st.customers; tot.health += st.health;
      projOut[p.id] = {
        health: st.health, status: st.status, flow: st.flow, daysSince: st.daysSince, lastAction: st.lastAction,
        money: st.money, attention: st.attention, customers: st.customers, progress: st.progress, cost: st.cost, profit: st.profit,
        fuelIn: st.fuelIn, incAttention: st.incAttention, incCustomers: st.incCustomers, boost: st.sb,
        progressBoost: st.progressBoost, fuelBoost: st.fuelBoost, cadence: cadenceOf(st.p),
        fresh: st.fresh, checkinOverdue: st.overdue, lastCheckin: st.lastCheckin, checkinEvery: ctx.rhythm.get(st.p.id), upstreamStale: st.upstreamStale || 0,
      };
    }
    tot.profit = tot.money - tot.cost;
    tot.health = P.length ? tot.health / P.length : 0;
    const linkOut = {};
    for (const l of ctx.links) {
      const src = state.get(l.from);
      const boost = linkBoost(ctx, l, dn);
      let amount = 0;
      if (l.resource === 'attention') amount = src.attention * l.share * boost;
      else if (l.resource === 'customers') amount = src.customers * l.share * boost;
      else if (l.resource === 'money') amount = src.money * l.share;
      else amount = src.flow * l.share * boost;
      const R = RESOURCES[l.resource];
      const norm = l.resource === 'progress' ? clamp01(amount * 1.2) : clamp01(Math.log10(1 + amount) / Math.log10(1 + R.ref));
      const speed = clamp01(0.15 + 0.55 * src.flow + 0.3 * clamp01((boost - 1) / 1.4));
      linkOut[l.id] = { amount, boost, norm, speed };
    }
    days.push({ day: dayStr(dn), offset: d, projects: projOut, links: linkOut, totals: tot });
    hist.push(new Map(P.map((p) => { const s = state.get(p.id); return [p.id, { attention: s.attention, customers: s.customers, money: s.money, flow: s.flow }]; })));
  }
  return { today, scenario, ctx, days };
}

// ---------- reading the result ----------
export function importanceMap(ctx, snap) {
  // how much of the system leans on each project: its own money + what it feeds downstream
  const imp = new Map();
  let maxV = 1;
  for (const p of ctx.projects) {
    let v = 1 + (snap.projects[p.id]?.money || 0) / 5000;
    for (const l of ctx.outgoing.get(p.id)) v += 2 + (snap.links[l.id]?.norm || 0) * 6;
    imp.set(p.id, v);
    maxV = Math.max(maxV, v);
  }
  for (const [k, v] of imp) imp.set(k, v / maxV);
  return imp;
}

export function suggestions(ctx, snap, limit = 4) {
  const imp = importanceMap(ctx, snap);
  const nameOf = (id) => ctx.byId.get(id)?.name || '?';
  const out = [];
  for (const p of ctx.projects) {
    const s = snap.projects[p.id];
    const need = (100 - s.health) / 100;
    const pendingToday = (ctx.actions.get(p.id) || []).some((d) => d >= ctx.todayN && d <= ctx.todayN + 1);
    if (need < 0.15 || (pendingToday && need < 0.5)) continue;
    const targets = ctx.outgoing.get(p.id)
      .filter((l) => l.resource === 'attention' || l.resource === 'customers')
      .sort((a, b) => (snap.links[b.id]?.norm || 0) - (snap.links[a.id]?.norm || 0)).slice(0, 2).map((l) => l.to);
    const type = HEAL_TYPE[p.kind] || 'other';
    const label = TASK_TYPES[type].label;
    const title = targets.length ? `${label} for ${p.name} that mentions ${targets.map(nameOf).join(' + ')}` : `${label} for ${p.name}`;
    out.push({ projectId: p.id, type, title, targets, score: need * (0.4 + imp.get(p.id)), health: s.health });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function alerts(world, ctx, snap) {
  const out = [];
  const T = ctx.today;
  const imp = importanceMap(ctx, snap);
  for (const p of ctx.projects) {
    const s = snap.projects[p.id];
    const feeds = ctx.outgoing.get(p.id).map((l) => ctx.byId.get(l.to)?.name).filter(Boolean);
    const uniq = [...new Set(feeds)];
    const since = s.lastAction ? `${s.daysSince} day${s.daysSince === 1 ? '' : 's'} since the last action (needs one every ${s.cadence})` : 'no action recorded yet';
    if (s.health < 30) {
      out.push({ id: `dying-${p.id}`, level: 'critical', projectId: p.id, title: `${p.name} is dying`,
        detail: `${since}. Flow is at ${Math.round(s.flow * 100)}%.${uniq.length ? ` It feeds ${uniq.join(', ')} — they will feel it.` : ''}`,
        action: { type: 'water', projectId: p.id }, weight: 100 + imp.get(p.id) * 10 });
    } else if (s.health < 50) {
      out.push({ id: `thirsty-${p.id}`, level: 'warn', projectId: p.id, title: `${p.name} needs water`,
        detail: `${since}. Health ${Math.round(s.health)}%.`, action: { type: 'water', projectId: p.id }, weight: 60 + imp.get(p.id) * 10 });
    } else {
      const hot = ctx.outgoing.get(p.id).filter((l) => (snap.links[l.id]?.boost || 1) > 1.4);
      if (hot.length || s.boost > 0.3) {
        const best = hot.sort((a, b) => snap.links[b.id].boost - snap.links[a.id].boost)[0];
        const pct = best ? Math.round((snap.links[best.id].boost - 1) * 100) : Math.round(s.boost * 100);
        out.push({ id: `surge-${p.id}`, level: 'good', projectId: p.id, title: `${p.name} is surging`,
          detail: best ? `A recent post is pushing the pipe to ${ctx.byId.get(best.to).name} at +${pct}%. Keep the momentum.` : `A recent post lifted its output by ${pct}%.`, weight: 10 });
      }
    }
  }
  for (const t of world.tasks || []) {
    if (t.status !== 'done' && t.due && dayNum(t.due) < ctx.todayN && ctx.byId.has(t.projectId)) {
      out.push({ id: `late-${t.id}`, level: 'warn', projectId: t.projectId, taskId: t.id, title: `Overdue: ${t.title}`,
        detail: `${ctx.todayN - dayNum(t.due)} day(s) late for ${ctx.byId.get(t.projectId).name}.`, weight: 40 });
    }
  }
  if (snap.totals.profit < 0) {
    out.push({ id: 'cash', level: 'warn', title: 'Costs are higher than income',
      detail: `The system loses about ${Math.round(-snap.totals.profit).toLocaleString('en-US')} TZS per day.`, weight: 50 });
  }
  const stale = ctx.projects.filter((p) => snap.projects[p.id]?.checkinOverdue > 0);
  if (stale.length) {
    const worst = Math.min(...stale.map((p) => snap.projects[p.id].fresh));
    out.push({ id: 'stale', level: worst <= 0.6 ? 'critical' : 'warn', projectIds: stale.map((p) => p.id), title: stale.length === 1 ? `Check in ${stale[0].name}` : `${stale.length} projects are waiting for a check-in`,
      detail: `${stale.map((p) => p.name).join(', ')} ${stale.length === 1 ? 'has' : 'have'} no fresh numbers, so ${stale.length === 1 ? 'its' : 'their'} flow is slowing and the projects they feed feel it.`,
      action: { type: 'checkin' }, weight: 45 + (1 - worst) * 50 });
  }
  const loggedToday = (world.logs || []).some((l) => l.day === T);
  if (!loggedToday && ctx.projects.length && !stale.length && [...ctx.rhythm.values()].some((r) => r === 1)) {
    out.push({ id: 'checkin', level: 'info', title: 'Daily check-in pending', detail: 'Log today\'s money, attention and customers to keep the simulation honest.', action: { type: 'checkin' }, weight: 5 });
  }
  return out.sort((a, b) => b.weight - a.weight);
}

export const kindOrder = KIND_KEYS;
