// The "brain": tools that let an AI agent read the living system and act on it like a neuron —
// adjusting numbers and pipes, writing notes and giving tasks. The same tools are served to outside
// agents over MCP (/api/mcp/<key>) and used by the built-in daily AI (runBrain).
import { simulate, alerts, suggestions, KIND_KEYS, RESOURCE_KEYS, TASK_TYPES, KINDS, addDays } from '../shared/engine.js';
import { RES, HttpError, fromRow, toCols, readWorld, insertSql, ownedProjectIds } from './models.js';
import { scanAll, scanProject, dayIn } from './sync.js';

const round = (n, d = 0) => (Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : null);
const PROJECT_ARG = { type: 'string', description: 'Project id or name' };

async function findProject(q, uid, ref) {
  const rows = await q.all('SELECT * FROM projects WHERE user_id = ?', uid);
  const n = Number(ref);
  let row = Number.isInteger(n) ? rows.find((r) => r.id === n) : null;
  const s = String(ref ?? '').trim().toLowerCase();
  row ||= rows.find((r) => r.name.toLowerCase() === s) || rows.find((r) => r.name.toLowerCase().includes(s) && s);
  if (!row) throw new HttpError(400, `No project matches "${ref}". Known: ${rows.map((r) => `${r.id} ${r.name}`).join(', ')}`);
  return fromRow('projects', row);
}

async function addNote(q, uid, { projectId = null, source, kind = 'insight', text }) {
  await q.run('INSERT INTO notes (user_id, project_id, at, source, kind, text) VALUES (?, ?, ?, ?, ?, ?)',
    uid, projectId, new Date().toISOString(), source, kind, String(text).slice(0, 2000));
}

async function insertRow(q, uid, res, body) {
  const cols = toCols(res, body, { create: true });
  const own = await ownedProjectIds(q, uid);
  for (const c of { links: ['from_id', 'to_id'], tasks: ['project_id'] }[res] || []) if (!own.has(cols[c])) throw new HttpError(400, 'Unknown project');
  if (cols.targets) cols.targets = JSON.stringify(JSON.parse(cols.targets).filter((id) => own.has(id)));
  const names = Object.keys(cols);
  const id = (await q.run(insertSql(RES[res].table, names), uid, ...names.map((n) => cols[n]))).lastInsertRowid;
  return fromRow(res, await q.get(`SELECT * FROM ${RES[res].table} WHERE id = ?`, id));
}
async function updateRow(q, uid, res, id, body) {
  const cols = toCols(res, body, { create: false });
  const names = Object.keys(cols);
  if (names.length) await q.run(`UPDATE ${RES[res].table} SET ${names.map((n) => `${n} = ?`).join(', ')} WHERE id = ? AND user_id = ?`, ...names.map((n) => cols[n]), id, uid);
  return fromRow(res, await q.get(`SELECT * FROM ${RES[res].table} WHERE id = ?`, id));
}

async function overview(ctx) {
  const { db, uid, tz, settings } = ctx;
  const world = await readWorld(db, uid, { logDays: 120 });
  const today = dayIn(tz);
  const keep = simulate(world, { today, horizon: 30, scenario: 'keep' });
  const stop = simulate(world, { today, horizon: 30, scenario: 'stop' });
  const now = keep.days[0];
  const name = (id) => world.projects.find((p) => p.id === id)?.name || '?';
  const scanFor = (pid) => world.scans.filter((s) => s.projectId === pid).map((s) => {
    const d = s.data || {};
    return { platform: s.platform, at: s.at, ok: s.ok, error: s.error || undefined, followers: d.subscribers ?? d.followers, videos: d.videoCount, uploadsLast7d: d.recent ? d.recent.filter((v) => Date.now() - Date.parse(v.publishedAt) < 7 * 864e5).length : undefined };
  });
  return {
    today,
    aboutTheOwner: settings.about || '(the owner has not written anything about themselves or their goals yet)',
    currency: 'TZS',
    totalsPerDay: Object.fromEntries(Object.entries(now.totals).map(([k, v]) => [k, round(v, 1)])),
    projects: world.projects.filter((p) => !p.archived).map((p) => {
      const s = now.projects[p.id];
      return {
        id: p.id, name: p.name, kind: p.kind, note: p.note || undefined,
        health: round(s.health), status: s.status, needsActionEveryDays: s.cadence, daysSinceLastAction: s.lastAction ? s.daysSince : null,
        moneyPerDay: round(s.money), attentionPerDay: round(s.attention), customersPerDay: round(s.customers, 2), costPerDay: round(s.cost),
        channels: (p.sources || []).map((x) => x.url), scans: scanFor(p.id),
      };
    }),
    pipes: world.links.map((l) => ({ id: l.id, from: name(l.from), to: name(l.to), resource: l.resource, share: l.share, flowPerDay: round(now.links[l.id]?.amount, 1), monthlyCost: l.cost, delayDays: l.delay })),
    alerts: alerts(world, keep.ctx, now).slice(0, 12).map((a) => ({ level: a.level, title: a.title, detail: a.detail })),
    suggestedActions: suggestions(keep.ctx, now, 5).map((s) => ({ project: name(s.projectId), task: s.title })),
    openTasks: world.tasks.filter((t) => t.status !== 'done').slice(-40).map((t) => ({ id: t.id, project: name(t.projectId), title: t.title, due: t.due, type: t.type, from: t.source || 'owner' })),
    in30Days: {
      ifOwnerKeepsPace: { moneyPerDay: round(keep.days[30].totals.money), avgHealth: round(keep.days[30].totals.health) },
      ifOwnerStopsPosting: { moneyPerDay: round(stop.days[30].totals.money), avgHealth: round(stop.days[30].totals.health) },
    },
    recentNotes: world.notes.slice(0, 12).map((n) => ({ at: n.at.slice(0, 16), from: n.source, project: n.projectId ? name(n.projectId) : undefined, text: n.text })),
  };
}

// ---------- tools ----------
export const TOOLS = [
  { name: 'get_overview', description: 'Read the whole living system today: every project\'s health, money/attention/customers per day, pipes between projects, alerts, open tasks, the 30-day outlook, the owner\'s goals and recent notes. Start here.',
    input_schema: { type: 'object', properties: {} },
    run: (ctx) => overview(ctx) },
  { name: 'get_project', description: 'Details of one project: its settings, pipes in and out, the last 30 days of logged numbers, its tasks and latest channel scans.',
    input_schema: { type: 'object', properties: { project: PROJECT_ARG }, required: ['project'] },
    run: async ({ db, uid }, a) => {
      const p = await findProject(db, uid, a.project);
      const logs = (await db.all('SELECT * FROM logs WHERE user_id = ? AND project_id = ? ORDER BY day DESC LIMIT 30', uid, p.id)).map((r) => fromRow('logs', r));
      const tasks = (await db.all('SELECT * FROM tasks WHERE user_id = ? AND project_id = ? ORDER BY id DESC LIMIT 30', uid, p.id)).map((r) => fromRow('tasks', r));
      const links = (await db.all('SELECT * FROM links WHERE user_id = ? AND (from_id = ? OR to_id = ?)', uid, p.id, p.id)).map((r) => fromRow('links', r));
      const scans = await db.all('SELECT platform, url, at, ok, error, data FROM scans WHERE user_id = ? AND project_id = ? ORDER BY id DESC LIMIT 4', uid, p.id);
      return { project: p, settingsHelp: KINDS[p.kind]?.defaults, pipes: links, logs, tasks, scans: scans.map((s) => ({ ...s, data: JSON.parse(s.data || '{}') })) };
    } },
  { name: 'create_task', description: 'Give the owner a task. Be concrete (what to post, where, what to mention). "targets" are the projects this action should push attention/customers to.',
    input_schema: { type: 'object', properties: {
      project: PROJECT_ARG, title: { type: 'string' },
      type: { type: 'string', enum: Object.keys(TASK_TYPES) }, due: { type: 'string', description: 'YYYY-MM-DD, default today' },
      targets: { type: 'array', items: PROJECT_ARG }, hours: { type: 'number' }, cost: { type: 'number', description: 'TZS it will cost' },
      reward: { type: 'number', description: 'TZS it pays when done (e.g. a sponsorship)' }, note: { type: 'string', description: 'Why this task, in one or two sentences' },
    }, required: ['project', 'title'] },
    run: async (ctx, a) => {
      const { db, uid, source, tz } = ctx;
      const p = await findProject(db, uid, a.project);
      const targets = [];
      for (const t of a.targets || []) targets.push((await findProject(db, uid, t)).id);
      const task = await insertRow(db, uid, 'tasks', { projectId: p.id, title: a.title, type: a.type || 'other', due: a.due || dayIn(tz), targets, hours: a.hours, cost: a.cost, reward: a.reward, note: a.note || '', source });
      return { created: task };
    } },
  { name: 'update_task', description: 'Change a task: reschedule it, rename it, or mark it done/undone.',
    input_schema: { type: 'object', properties: { task_id: { type: 'integer' }, title: { type: 'string' }, due: { type: 'string' }, status: { type: 'string', enum: ['todo', 'done'] }, note: { type: 'string' } }, required: ['task_id'] },
    run: async ({ db, uid, tz }, a) => {
      const row = await db.get('SELECT id FROM tasks WHERE id = ? AND user_id = ?', a.task_id, uid);
      if (!row) throw new HttpError(404, 'No such task');
      const patch = {};
      for (const k of ['title', 'due', 'status', 'note']) if (a[k] !== undefined) patch[k] = a[k];
      if (a.status === 'done') patch.doneOn = dayIn(tz);
      if (a.status === 'todo') patch.doneOn = null;
      return { updated: await updateRow(db, uid, 'tasks', a.task_id, patch) };
    } },
  { name: 'adjust_project', description: 'Tune a project so the simulation matches reality: its run-rate settings (cfg: viewsPerDay, rpm, price, activeCustomers, newPerDay, churnPct, conversionPer1000, cadenceDays...), monthlyCost or note. Always give a reason; it is shown to the owner.',
    input_schema: { type: 'object', properties: { project: PROJECT_ARG, cfg: { type: 'object', description: 'Only the keys to change' }, monthlyCost: { type: 'number' }, note: { type: 'string' }, reason: { type: 'string' } }, required: ['project', 'reason'] },
    run: async ({ db, uid, source }, a) => {
      const p = await findProject(db, uid, a.project);
      const patch = {};
      if (a.cfg && typeof a.cfg === 'object') patch.cfg = { ...p.cfg, ...a.cfg };
      if (a.monthlyCost !== undefined) patch.monthlyCost = a.monthlyCost;
      if (a.note !== undefined) patch.note = a.note;
      const out = await updateRow(db, uid, 'projects', p.id, patch);
      await addNote(db, uid, { projectId: p.id, source, kind: 'adjustment', text: `Adjusted ${p.name}: ${JSON.stringify({ ...a.cfg, ...(a.monthlyCost !== undefined ? { monthlyCost: a.monthlyCost } : {}) })}. ${a.reason}` });
      return { updated: out };
    } },
  { name: 'set_pipe', description: 'Create, change or remove a pipe that carries a resource from one project to another. share = fraction (0-1) of the giver\'s output that reaches the receiver.',
    input_schema: { type: 'object', properties: { from: PROJECT_ARG, to: PROJECT_ARG, resource: { type: 'string', enum: RESOURCE_KEYS }, share: { type: 'number' }, cost: { type: 'number', description: 'TZS per month' }, delay: { type: 'integer', description: 'days' }, remove: { type: 'boolean' }, reason: { type: 'string' } }, required: ['from', 'to', 'resource', 'reason'] },
    run: async ({ db, uid, source }, a) => {
      const from = await findProject(db, uid, a.from), to = await findProject(db, uid, a.to);
      const row = await db.get('SELECT id FROM links WHERE user_id = ? AND from_id = ? AND to_id = ? AND resource = ?', uid, from.id, to.id, a.resource);
      let result;
      if (a.remove) {
        if (row) await db.run('DELETE FROM links WHERE id = ?', row.id);
        result = { removed: !!row };
      } else {
        const body = { share: a.share, cost: a.cost, delay: a.delay };
        for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
        result = row ? { updated: await updateRow(db, uid, 'links', row.id, body) } : { created: await insertRow(db, uid, 'links', { from: from.id, to: to.id, resource: a.resource, ...body }) };
      }
      await addNote(db, uid, { projectId: from.id, source, kind: 'adjustment', text: `${a.remove ? 'Removed' : row ? 'Changed' : 'Added'} ${a.resource} pipe ${from.name} → ${to.name}. ${a.reason}` });
      return result;
    } },
  { name: 'create_project', description: 'Add a new project (channel, app, website, sales channel) to the system, optionally with channel links to scan.',
    input_schema: { type: 'object', properties: { name: { type: 'string' }, kind: { type: 'string', enum: KIND_KEYS }, sources: { type: 'array', items: { type: 'string' }, description: 'Channel / website links' }, monthlyCost: { type: 'number' }, cfg: { type: 'object' }, note: { type: 'string' } }, required: ['name', 'kind'] },
    run: async ({ db, uid, tz, source }, a) => {
      const n = (await db.get('SELECT COUNT(*) AS n FROM projects WHERE user_id = ?', uid)).n;
      const ang = n * 2.4;
      const p = await insertRow(db, uid, 'projects', { name: a.name, kind: a.kind, sources: a.sources || [], monthlyCost: a.monthlyCost, cfg: a.cfg || {}, note: a.note || '', createdOn: dayIn(tz), x: Math.round(Math.cos(ang) * (300 + n * 40)), y: Math.round(Math.sin(ang) * (300 + n * 40)) });
      await addNote(db, uid, { projectId: p.id, source, kind: 'adjustment', text: `Added project ${p.name}.` });
      return { created: p };
    } },
  { name: 'log_numbers', description: 'Record real numbers for a project on a day (money in TZS, attention = views, customers = new paying customers, posts = pieces of content published).',
    input_schema: { type: 'object', properties: { project: PROJECT_ARG, day: { type: 'string' }, money: { type: 'number' }, attention: { type: 'number' }, customers: { type: 'number' }, posts: { type: 'integer' }, note: { type: 'string' } }, required: ['project'] },
    run: async ({ db, uid, tz }, a) => {
      const p = await findProject(db, uid, a.project);
      const day = a.day || dayIn(tz);
      const patch = toCols('logs', Object.fromEntries(['money', 'attention', 'customers', 'posts', 'note'].filter((k) => a[k] !== undefined).map((k) => [k, a[k]])), { create: false });
      const row = await db.get('SELECT id FROM logs WHERE user_id = ? AND project_id = ? AND day = ?', uid, p.id, toCols('logs', { day }, { create: false }).day);
      const names = Object.keys(patch);
      if (row) { if (names.length) await db.run(`UPDATE logs SET ${names.map((k) => `${k} = ?`).join(', ')}, sample = 0 WHERE id = ?`, ...names.map((k) => patch[k]), row.id); }
      else await db.run(insertSql('logs', ['project_id', 'day', ...names]), uid, p.id, day, ...names.map((k) => patch[k]));
      return { logged: { project: p.name, day, ...patch } };
    } },
  { name: 'add_note', description: 'Write to the owner\'s Brain feed: an insight, a warning or a plan. Keep it short and specific.',
    input_schema: { type: 'object', properties: { text: { type: 'string' }, project: PROJECT_ARG, kind: { type: 'string', enum: ['insight', 'warning', 'plan'] } }, required: ['text'] },
    run: async ({ db, uid, source }, a) => {
      const p = a.project !== undefined && a.project !== null && a.project !== '' ? await findProject(db, uid, a.project) : null;
      await addNote(db, uid, { projectId: p?.id ?? null, source, kind: a.kind || 'insight', text: a.text });
      return { ok: true };
    } },
  { name: 'scan_channels', description: 'Read the latest public numbers from the channel links (YouTube, TikTok, websites, Play Store) of one project or all of them. Updates posts and views automatically.',
    input_schema: { type: 'object', properties: { project: PROJECT_ARG } },
    run: async ({ db, uid, tz, youtubeKey }, a) => {
      const results = a.project !== undefined ? await scanProject(db, uid, await findProject(db, uid, a.project), { tz, youtubeKey }) : await scanAll(db, uid, { tz, youtubeKey });
      return { scanned: results.map((r) => ({ platform: r.platform, url: r.url, ok: r.ok, error: r.error || undefined, data: r.data })) };
    } },
];
const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

export async function callTool(ctx, name, args) {
  const t = TOOL_BY_NAME.get(name);
  if (!t) throw new HttpError(400, `Unknown tool ${name}`);
  return t.run(ctx, args || {});
}

// ---------- MCP (Streamable HTTP, JSON responses) ----------
const MCP_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
export async function handleMcp(ctx, msg) {
  const reply = (result) => ({ jsonrpc: '2.0', id: msg.id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id: msg.id ?? null, error: { code, message } });
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(-32600, 'Invalid request');
  if (msg.id === undefined) return null; // notification
  switch (msg.method) {
    case 'initialize': {
      const asked = msg.params?.protocolVersion;
      return reply({
        protocolVersion: MCP_VERSIONS.includes(asked) ? asked : MCP_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'flowmap', title: 'FlowMap living system', version: '2.0.0' },
        instructions: 'You are a neuron inside the owner\'s living success system (FlowMap). Call get_overview first. Then act: adjust numbers that are clearly wrong, write short notes, and give a few concrete tasks that raise the weakest projects that matter most. Money is in TZS.',
      });
    }
    case 'ping': return reply({});
    case 'tools/list': return reply({ tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema })) });
    case 'tools/call': {
      try {
        const out = await callTool(ctx, msg.params?.name, msg.params?.arguments);
        return reply({ content: [{ type: 'text', text: JSON.stringify(out) }] });
      } catch (e) {
        return reply({ content: [{ type: 'text', text: e.message }], isError: true });
      }
    }
    default: return fail(-32601, `Method not found: ${msg.method}`);
  }
}

// ---------- built-in AI ----------
export const AI_PROVIDERS = {
  anthropic: { label: 'Anthropic (Claude)', model: 'claude-sonnet-5-5' },
  openai: { label: 'OpenAI', model: '', baseUrl: 'https://api.openai.com/v1' },
  compatible: { label: 'Other (OpenAI-compatible: OpenRouter, Groq, Gemini, DeepSeek...)', model: '', baseUrl: '' },
};

const SYSTEM = `You are the brain of a creator's "living success system" (FlowMap). Projects are tanks; pipes carry money (TZS), attention (views), customers and progress between them. Health drops when a project misses its posting rhythm.
Each run: read the overview, then act like a neuron in the system:
- Fix settings that clearly disagree with the real numbers (adjust_project, set_pipe), always with a reason.
- Give 1 to 4 concrete tasks for today or this week (create_task), aimed at the weakest projects that matter most, with targets for the projects they should push. Do not duplicate open tasks.
- Leave 1 to 3 short notes (add_note) with what you noticed.
Respect what the owner wrote about themselves and their goals. Be specific (what to post, where, what to mention). Finish with a two-sentence summary for the owner.`;

async function anthropicTurn(cfg, system, messages) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: cfg.model || AI_PROVIDERS.anthropic.model, max_tokens: 2500, system, messages, tools: TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema })) }),
    signal: AbortSignal.timeout(55000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Anthropic: ${j.error?.message || r.status}`);
  messages.push({ role: 'assistant', content: j.content });
  const calls = j.content.filter((c) => c.type === 'tool_use').map((c) => ({ id: c.id, name: c.name, args: c.input }));
  const text = j.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  return { calls, text, answer: (results) => messages.push({ role: 'user', content: results.map((x) => ({ type: 'tool_result', tool_use_id: x.id, content: x.content, is_error: x.isError })) }) };
}

async function openaiTurn(cfg, system, messages) {
  const base = (cfg.baseUrl || AI_PROVIDERS.openai.baseUrl).replace(/\/+$/, '');
  if (!messages.length || messages[0].role !== 'system') messages.unshift({ role: 'system', content: system });
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model: cfg.model, messages, tools: TOOLS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })) }),
    signal: AbortSignal.timeout(55000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`AI provider: ${j.error?.message || r.status}`);
  const m = j.choices?.[0]?.message || {};
  messages.push({ role: 'assistant', content: m.content || '', ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}) });
  const calls = (m.tool_calls || []).map((c) => { let args = {}; try { args = JSON.parse(c.function.arguments || '{}'); } catch { /* bad json */ } return { id: c.id, name: c.function.name, args }; });
  return { calls, text: m.content || '', answer: (results) => results.forEach((x) => messages.push({ role: 'tool', tool_call_id: x.id, content: x.content })) };
}

export async function runBrain(ctx, ai, { trigger = 'manual', budgetMs = 50000 } = {}) {
  if (!ai?.apiKey) throw new HttpError(400, 'Add an AI key in Settings → AI brain first');
  if (ai.provider !== 'anthropic' && !ai.model) throw new HttpError(400, 'Choose a model name in Settings → AI brain');
  const start = Date.now();
  const bctx = { ...ctx, source: 'ai' };
  const turn = ai.provider === 'anthropic' ? anthropicTurn : openaiTurn;
  const messages = [{ role: 'user', content: `${trigger === 'daily' ? 'Daily review.' : 'The owner asked for a review now.'} Here is the system overview:\n${JSON.stringify(await overview(bctx))}` }];
  const actions = [];
  let text = '';
  for (let step = 0; step < 8; step++) {
    let t;
    try { t = await turn(ai, SYSTEM, messages); } catch (e) {
      if (!actions.length) throw new HttpError(502, e.name === 'TimeoutError' ? 'The AI provider took too long to answer' : e.message);
      text ||= `Stopped early: ${e.message}`;
      break;
    }
    text = t.text || text;
    if (!t.calls.length) break;
    const results = [];
    for (const c of t.calls) {
      try { results.push({ id: c.id, content: JSON.stringify(await callTool(bctx, c.name, c.args)).slice(0, 12000) }); actions.push(c.name); }
      catch (e) { results.push({ id: c.id, content: e.message, isError: true }); }
    }
    t.answer(results);
    if (Date.now() - start > budgetMs) { text ||= 'Stopped early to stay within the time limit.'; break; }
  }
  const summary = (text || 'Review finished.').trim().slice(0, 1500);
  await addNote(ctx.db, ctx.uid, { source: 'ai', kind: 'brain', text: summary });
  return { summary, actions };
}

export { addNote, addDays };
