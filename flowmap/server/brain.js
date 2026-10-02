// The "brain": tools that let an AI agent read the living system and act on it like a neuron —
// adjusting numbers and pipes, writing notes and giving tasks. The same tools are served to outside
// agents over MCP (/api/mcp/<key>) and used by the built-in daily AI (runBrain).
import { simulate, alerts, suggestions, KIND_KEYS, RESOURCE_KEYS, TASK_TYPES, KINDS, addDays } from '../shared/engine.js';
import { RES, HttpError, fromRow, toCols, readWorld, insertSql, ownedProjectIds } from './models.js';
import { scanAll, scanProject, dayIn } from './sync.js';
import { goalProgress, groupOf } from '../shared/goals.js';
import { BOARD_TOOLS } from './boards.js';

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
        area: groupOf(p),
        goal: (() => { const g = goalProgress(p, { logs: world.logs, scans: world.scans, day: s, today }); return g && { metric: g.metric, target: g.target, by: g.by, current: g.current === null ? null : round(g.current), progressPct: round(g.frac * 100), needPerDay: g.perDayNeeded === null ? undefined : round(g.perDayNeeded, 1) }; })() || undefined,
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
  { name: 'adjust_project', description: 'Tune a project so the simulation matches reality: its run-rate settings (cfg: viewsPerDay, rpm, price, activeCustomers, newPerDay, churnPct, conversionPer1000, cadenceDays...), monthlyCost or note. cfg.goal = { metric: "subscribers" | "money_month" | "customers" | "views_month", target: number, by: "YYYY-MM-DD" } sets the goal ring; cfg.group = "Channels" puts it in an area on the map. Always give a reason; it is shown to the owner.',
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
const CORE_TOOLS = TOOLS.slice(); // the daily review works on the system, not on boards
TOOLS.push(...BOARD_TOOLS);
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
        instructions: 'You are a neuron inside the owner\'s living success system (FlowMap). Call get_overview first. Then act: adjust numbers that are clearly wrong, write short notes, and give a few concrete tasks that raise the weakest projects that matter most. Money is in TZS. You can also build boards (create_board, add_to_board): slide decks for tutorial or strategy videos, workflows, mind maps, course outlines, plans.',
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
// the first models listed for NVIDIA are strong chat models that can call tools (the brain needs tools)
export const NVIDIA_MODELS = ['moonshotai/kimi-k2.6', 'moonshotai/kimi-k3', 'deepseek-ai/deepseek-v4.1-flash', 'z-ai/glm-5.3', 'z-ai/glm-5.3-flash', 'nvidia/nemotron-3-super-120b-a12b', 'nvidia/nemotron-3-ultra-550b-a55b', 'mistralai/mistral-large-2-instruct', 'openai/gpt-oss-20b', 'google/gemma-4-31b-it'];
// Gemini through Google's OpenAI-compatible endpoint; the key's own model list fills in the rest
export const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite'];
export const AI_PROVIDERS = {
  anthropic: { label: 'Anthropic (Claude)', model: 'claude-sonnet-5-5' },
  openai: { label: 'OpenAI', model: '', baseUrl: 'https://api.openai.com/v1' },
  nvidia: { label: 'NVIDIA (free models)', model: NVIDIA_MODELS[0], baseUrl: 'https://integrate.api.nvidia.com/v1', models: NVIDIA_MODELS },
  gemini: { label: 'Google Gemini', model: GEMINI_MODELS[0], baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', models: GEMINI_MODELS },
  compatible: { label: 'Other (OpenAI-compatible: OpenRouter, Groq, DeepSeek...)', model: '', baseUrl: '' },
};
const PROVIDER_IDS = Object.keys(AI_PROVIDERS);

// ---------- saved AI keys ----------
// secrets.aiKeys = [{ id, label, provider, model, baseUrl, key }]; the older single key (secrets.aiKey + settings) still counts.
export function aiKeyList(settings = {}, secrets = {}) {
  const list = Array.isArray(secrets.aiKeys) ? secrets.aiKeys.filter((k) => k && k.key) : [];
  if (secrets.aiKey && !list.some((k) => k.id === 'main')) list.unshift({ id: 'main', label: 'My key', provider: settings.aiProvider || 'anthropic', model: settings.aiModel || '', baseUrl: settings.aiBaseUrl || '', key: secrets.aiKey });
  return list;
}
export const cfgOfKey = (k) => ({ id: k.id, label: k.label, provider: PROVIDER_IDS.includes(k.provider) ? k.provider : 'compatible', model: k.model || AI_PROVIDERS[k.provider]?.model || '', baseUrl: k.baseUrl || AI_PROVIDERS[k.provider]?.baseUrl || '', apiKey: k.key });
// the key in use first, then the others: if one fails or hits its limit the next one takes over
export function aiChain(settings = {}, secrets = {}) {
  const list = aiKeyList(settings, secrets).map(cfgOfKey);
  const i = list.findIndex((k) => k.id === settings.aiActive);
  if (i > 0) list.unshift(...list.splice(i, 1));
  return list;
}
// the chat models a key can use, straight from its provider
const NOT_CHAT = /embed|imagen|veo|tts|aqa|image|live|audio|native|learnlm|robotics|computer-use|whisper|dall-e|moderation|transcribe|search|realtime|rerank|guard/i;
export async function listModels(cfg) {
  const anth = cfg.provider === 'anthropic';
  const url = anth ? 'https://api.anthropic.com/v1/models?limit=100' : `${(cfg.baseUrl || '').replace(/\/+$/, '')}/models`;
  if (!/^https?:\/\//.test(url)) throw new HttpError(400, 'This key has no address to ask for models');
  const r = await fetch(url, { headers: anth ? { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' } : { authorization: `Bearer ${cfg.apiKey}` }, signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpError(502, `The provider refused the model list: ${plainError(r.status, errMsg(j))}`);
  const ids = (j.data || j.models || []).map((m) => String(m.id || m.name || '').replace(/^models\//, '')).filter((id) => id && !NOT_CHAT.test(id));
  const recommended = (AI_PROVIDERS[cfg.provider]?.models || []).filter((m) => ids.includes(m));
  return { recommended, all: [...new Set(ids)].sort() };
}
// a sensible model when the default is not available to this key: the newest plain "flash" or "pro"
export function bestModel(ids, provider) {
  if (provider !== 'gemini') return ids[0] || '';
  const ver = (id) => Number((id.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
  const plain = ids.filter((id) => /^gemini-\d/.test(id) && !/lite|preview|exp|thinking|\d{3,}$/.test(id));
  const pool = plain.length ? plain : ids.filter((id) => /^gemini-/.test(id));
  return pool.sort((a, b) => ver(b) - ver(a) || (/flash/.test(b) ? 1 : 0) - (/flash/.test(a) ? 1 : 0))[0] || ids[0] || '';
}
export const publicKey = (k) => ({ id: k.id, label: k.label, provider: k.provider, model: k.model || AI_PROVIDERS[k.provider]?.model || '', baseUrl: k.baseUrl || '', tail: String(k.key || '').slice(-4), test: k.test || null });

// what went wrong, in plain words
// providers word errors differently: { error: { message } }, Google's [{ error: { message } }], { detail }
const errMsg = (j) => (Array.isArray(j) ? j[0] : j)?.error?.message || j?.detail || j?.title || '';
const plainError = (status, msg) => (/valid api key|api key not valid|invalid api key|API_KEY_INVALID/i.test(msg || '') ? 'This key was rejected. Check it is copied completely and still active.' : null) || ({
  401: 'This key was rejected. Check it is copied completely and still active.',
  403: 'This key was rejected or has no access to this model.',
  404: 'This model is not available for this key. Pick another model.',
  429: 'This key reached its limit right now (free keys allow a few requests per minute). Try again shortly.',
}[status] || (status >= 500 ? 'The provider is busy or down right now. Try again soon.' : msg || `HTTP ${status}`));
// a small, real request: does the key work, and can this model call tools?
export async function testAi(cfg) {
  const t0 = Date.now();
  const tool = { name: 'report_status', description: 'Report that the connection works.', input_schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] } };
  const ask = 'This is a connection test. Call the report_status tool with ok set to true.';
  try {
    if (!cfg.apiKey) throw new Error('No key');
    if (cfg.provider !== 'anthropic' && !cfg.model) throw new Error('Choose a model');
    let tools = false, reply = '';
    if (cfg.provider === 'anthropic') {
      const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: cfg.model || AI_PROVIDERS.anthropic.model, max_tokens: 200, messages: [{ role: 'user', content: ask }], tools: [tool] }), signal: AbortSignal.timeout(30000) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(plainError(r.status, errMsg(j)));
      tools = (j.content || []).some((c) => c.type === 'tool_use');
      reply = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(' ');
    } else {
      const base = (cfg.baseUrl || AI_PROVIDERS.openai.baseUrl).replace(/\/+$/, '');
      const r = await fetch(`${base}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({ model: cfg.model, max_tokens: 300, messages: [{ role: 'user', content: ask }], tools: [{ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.input_schema } }] }), signal: AbortSignal.timeout(45000) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(plainError(r.status, errMsg(j)));
      const m = j.choices?.[0]?.message || {};
      tools = !!(m.tool_calls && m.tool_calls.length);
      reply = m.content || '';
    }
    return { ok: true, tools, ms: Date.now() - t0, at: new Date().toISOString(), note: tools ? 'Works, and it can use the brain\'s tools' : 'The key works, but this model did not use tools. Pick another model for the brain.', reply: String(reply).slice(0, 200) };
  } catch (e) {
    const msg = e.name === 'TimeoutError' ? 'No answer in time (the model may be busy; try again or pick another)' : String(e.message || e).slice(0, 300);
    return { ok: false, tools: false, ms: Date.now() - t0, at: new Date().toISOString(), note: msg };
  }
}
// run with the first key; if it fails before doing anything, try the next one
export async function withFallback(chain, run) {
  const list = Array.isArray(chain) ? chain : [chain];
  if (!list.length || !list[0]?.apiKey) throw new HttpError(400, 'Add an AI key in the 🧠 Brain settings first');
  const errors = [];
  for (const cfg of list) {
    try { const out = await run(cfg); return { ...out, usedKey: cfg.label || cfg.id }; }
    catch (e) { errors.push(`${cfg.label || cfg.provider}: ${e.message}`); if (e.status === 400 && /Choose a model/.test(e.message) && list.length === 1) throw e; }
  }
  throw new HttpError(502, list.length > 1 ? `All ${list.length} AI keys failed. ${errors.join(' · ')}` : errors[0].replace(/^[^:]+: /, ''));
}

const SYSTEM = `You are the brain of a creator's "living success system" (FlowMap). Projects are tanks; pipes carry money (TZS), attention (views), customers and progress between them. Health drops when a project misses its posting rhythm.
Each run: read the overview, then act like a neuron in the system:
- Fix settings that clearly disagree with the real numbers (adjust_project, set_pipe), always with a reason.
- Give 1 to 4 concrete tasks for today or this week (create_task), aimed at the weakest projects that matter most, with targets for the projects they should push. Do not duplicate open tasks.
- Leave 1 to 3 short notes (add_note) with what you noticed.
Respect what the owner wrote about themselves and their goals. Be specific (what to post, where, what to mention). Finish with a two-sentence summary for the owner.`;

async function anthropicTurn(cfg, system, messages, tools = CORE_TOOLS) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: cfg.model || AI_PROVIDERS.anthropic.model, max_tokens: 8000, system, messages, tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema })) }),
    signal: AbortSignal.timeout(55000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Anthropic: ${j.error?.message || r.status}`);
  messages.push({ role: 'assistant', content: j.content });
  const calls = j.content.filter((c) => c.type === 'tool_use').map((c) => ({ id: c.id, name: c.name, args: c.input }));
  const text = j.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  return { calls, text, answer: (results) => messages.push({ role: 'user', content: results.map((x) => ({ type: 'tool_result', tool_use_id: x.id, content: x.content, is_error: x.isError })) }) };
}

async function openaiTurn(cfg, system, messages, tools = CORE_TOOLS) {
  const base = (cfg.baseUrl || AI_PROVIDERS.openai.baseUrl).replace(/\/+$/, '');
  if (!messages.length || messages[0].role !== 'system') messages.unshift({ role: 'system', content: system });
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model: cfg.model, messages, tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })) }),
    signal: AbortSignal.timeout(55000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`AI provider: ${plainError(r.status, errMsg(j))}`);
  const m = j.choices?.[0]?.message || {};
  messages.push({ role: 'assistant', content: m.content || '', ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}) });
  const calls = (m.tool_calls || []).map((c) => { let args = {}; try { args = JSON.parse(c.function.arguments || '{}'); } catch { /* bad json */ } return { id: c.id, name: c.function.name, args }; });
  return { calls, text: m.content || '', answer: (results) => results.forEach((x) => messages.push({ role: 'tool', tool_call_id: x.id, content: x.content })) };
}

export async function runBrain(ctx, chain, opts = {}) { return withFallback(chain, (ai) => brainOnce(ctx, ai, opts)); }
async function brainOnce(ctx, ai, { trigger = 'manual', budgetMs = 50000 } = {}) {
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

// ---------- built-in AI: build a board from a request, or change the board that is open ----------
const BOARD_LOOK = `Make it look designed, never like a table or a plain list:
- Breathing room: 40px+ between blocks, align things on clean rows and columns.
- Group related things inside a frame (style.shadow "sunk") with a short title; use shapes (pill or round) as soft labelled buttons, flip cards for "tap to see more".
- Warm earthy colours only (#e8b86b, #ff8a5c, #e07a5f, #c9a27e, #b8e04a, #2fb4a0, #ffb020, #ff6fae, #8a7b6d); never blue or purple. One accent colour per group.
- Big bold titles (style.size 32+, bold), quieter details (style.muted), stickers (i: icons) and the odd paperclip or tape (type clip) to make it feel real; tilt notes and clips a few degrees.
- Notes are real paper: mix kinds (paper: sticky, lined, spiral, grid, index, kraft, torn, aged), hold some with tape or a pin, use handwriting (style.hand) for personal notes.
- Curved connections; "tunnel" kind with flow for money or attention moving.`;
const BOARD_SYSTEM = `You design boards inside FlowMap, a creator's planning and presentation canvas. The owner will present boards full screen and screen-record them for tutorials, strategy videos and courses.
Read the request, look at the system overview if it helps (get_overview), then call create_board once with a well-structured spec:
- For a video, lesson or pitch use layout "slides": 5 to 12 slides, each with a short punchy title, 2 to 6 points ("Heading: detail"), an emoji, and speaker notes with what to say.
- For processes use "workflow" with nodes and edges; for brainstorming "mindmap"; for task boards "kanban"; for plans over time "timeline".
Then polish it: read it with get_board and use edit_board_items (and add_to_board for extra stickers, clips or notes) so it looks great.
${BOARD_LOOK}
Write in the language the owner used. Be concrete and specific to their projects when relevant. Finish with one sentence saying what you built.`;
const BOARD_AI_TOOLS = ['get_overview', 'list_boards', 'create_board', 'get_board', 'edit_board_items', 'add_to_board'].map((n) => TOOL_BY_NAME.get(n));

// one tool-using conversation; returns the final text and the tools that ran
async function boardTurns(ctx, ai, system, tools, request, { steps = 8, onCall } = {}) {
  if (!ai?.apiKey) throw new HttpError(400, 'Add an AI key in the 🧠 Brain settings first, or connect your own AI agent over MCP');
  if (ai.provider !== 'anthropic' && !ai.model) throw new HttpError(400, 'Choose a model name in the 🧠 Brain settings');
  const bctx = { ...ctx, source: 'ai' };
  const turn = ai.provider === 'anthropic' ? anthropicTurn : openaiTurn;
  const messages = [{ role: 'user', content: String(request).slice(0, 6000) }];
  let text = '';
  const ran = [];
  const start = Date.now();
  for (let step = 0; step < steps; step++) {
    let t;
    try { t = await turn(ai, system, messages, tools); } catch (e) {
      if (!ran.length) throw new HttpError(502, e.name === 'TimeoutError' ? 'The AI provider took too long to answer' : e.message);
      break;
    }
    text = t.text || text;
    if (!t.calls.length) break;
    const results = [];
    for (const c of t.calls) {
      try {
        const out = await callTool(bctx, c.name, c.args);
        onCall?.(c.name, out);
        ran.push(c.name);
        results.push({ id: c.id, content: JSON.stringify(out).slice(0, 24000) });
      } catch (e) { results.push({ id: c.id, content: e.message, isError: true }); }
    }
    t.answer(results);
    if (Date.now() - start > 50000) break;
  }
  return { text: (text || '').trim().slice(0, 600), ran };
}

export async function runBoardAI(ctx, chain, request) { return withFallback(chain, (ai) => boardOnce(ctx, ai, request)); }
async function boardOnce(ctx, ai, request) {
  let created = null;
  const { text } = await boardTurns(ctx, ai, BOARD_SYSTEM, BOARD_AI_TOOLS, request, { onCall: (name, out) => { if (name === 'create_board' && !created) created = out.created; } });
  if (!created) throw new HttpError(502, text ? `The AI did not build a board: ${text.slice(0, 300)}` : 'The AI did not build a board. Try describing it differently.');
  return { board: created, summary: text };
}
export async function runBoardEdit(ctx, chain, board, request) {
  // one shared deadline across fallback keys, well inside the 300 s function limit
  const deadline = Date.now() + 230000;
  return withFallback(chain, (ai) => editOnce(ctx, ai, board, request, deadline));
}

// Editing the open board: the whole board goes in one compact message and the AI answers with one JSON plan,
// which the server applies. One round trip instead of a tool loop, so it works with any chat model (also
// ones that are weak at tool calls) and stays well inside the time limit even for big boards.
const PLAN_SPEC = `Answer with ONE JSON object and nothing else:
{
 "summary": "one short sentence saying what you changed",
 "floor": "dots" | "grid" | "plain",                       (optional)
 "changes": [ { "id": "<item id>", ...fields to change } ],   (optional; "delete": true removes the item)
 "restyle": [ { "ids": [...] or "types": [...], "color": "#hex", "style": {...}, "rot": n } ],   (optional; same look on many items)
 "add": [ { "type": "note|card|text|shape|frame|flip|sticker|checklist|clip|hide|image|link|prompt", "ref": "name", "x": n, "y": n, "w": n, "h": n, ...fields } ],   (optional; x/y are absolute)
 "connect": [ { "from": "<id or ref>", "to": "<id or ref>", "label": "", "kind": "line|tunnel|raised|drawn", "flow": true } ],   (optional)
 "connections": [ { "id": "<connection id>", "delete": true | "kind"/"dash"/"color"/"width"/"flow"/"label"... } ]   (optional)
}
Item fields: title, text, color (#hex), x, y, w, h, rot (degrees), z (higher = on top), locked,
 style: { finish: soft|tinted|solid|glass|flat|none, shadow: sunk|flat|raised|float, radius: 0-60, size: text px 8-200, align: left|center|right, bold: true|false, muted: true|false, textColor: #hex, hand: true|false (handwriting) },
 anim: { in: none|pop|fade|rise|zoom|draw|slide, loop: none|bounce|pulse|wiggle|float|spin|glow, delay: seconds },
 shape (for shapes: rect|round|pill|ellipse|diamond|triangle|hexagon|star|arrow|bubble), emoji (for stickers, prefer i:icon-name),
 paper (for notes: sticky|lined|spiral|grid|index|kraft|torn|aged), lift (for notes: flat|lifted|curled), pin (for notes: none|tape|pin|clip),
 jump (id or ref of another item: tapping glides there), jumpLabel (optional button text),
 clip (for clips: paperclip|binder|pin|tape), metal (silver|gold|copper|black|color), items (checklist rows; "[x] row" = ticked), back (flip card back text), cover (hide: blur|frost|solid|curtain).
Only include what changes. Use the real ids from the board.`;
const EDIT_PLAN_SYSTEM = (name) => `You edit one board inside FlowMap, a creator's planning and presentation canvas: "${name}". The owner is looking at it right now and asked for a change.
Do exactly what the owner asks. Keep everything they did not ask to change. Keep things inside their frames.
When asked to make it look better, keep the content and improve the design:
${BOARD_LOOK}
Write any new text in the language the owner used.
${PLAN_SPEC}`;

// the board as short JSON lines: what the AI needs to place and restyle things, nothing bulky
function compactBoard(view) {
  const lines = view.items.map((i) => JSON.stringify({ ...i, ...(i.text ? { text: i.text.slice(0, 160) } : {}), ...(i.title ? { title: i.title.slice(0, 120) } : {}), ...(i.anim ? { anim: undefined } : {}) }));
  const links = view.connections.map((l) => JSON.stringify({ id: l.id, from: l.from, to: l.to, ...(l.label ? { label: l.label } : {}), kind: l.style?.kind, ...(l.style?.color ? { color: l.style.color } : {}) }));
  return `Board "${view.name}" · floor ${view.floor} · ${view.items.length} items${view.slides.length ? ` · slides in order: ${view.slides.join(', ')}` : ''}\nITEMS (one per line):\n${lines.join('\n')}${links.length ? `\nCONNECTIONS:\n${links.join('\n')}` : ''}`;
}
// pull the JSON object out of a reply that may carry thinking, code fences or chatter around it
export function readPlan(text) {
  let t = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*?<\/think>/i, '');
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1];
  const start = t.indexOf('{');
  if (start < 0) throw new Error('no JSON object in the answer');
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return JSON.parse(t.slice(start, i + 1));
  }
  throw new Error('the JSON answer was cut off');
}
async function chatOnce(ai, system, messages, deadline = Date.now() + 120000) {
  const left = deadline - Date.now();
  if (left < 8000) { const e = new Error('out of time'); e.name = 'TimeoutError'; throw e; }
  const ms = Math.min(120000, left);
  const anth = ai.provider === 'anthropic';
  const r = anth
    ? await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': ai.apiKey, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: ai.model || AI_PROVIDERS.anthropic.model, max_tokens: 8000, system, messages }), signal: AbortSignal.timeout(ms) })
    : await fetch(`${(ai.baseUrl || AI_PROVIDERS.openai.baseUrl).replace(/\/+$/, '')}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${ai.apiKey}` }, body: JSON.stringify({ model: ai.model, max_tokens: 8000, temperature: 0.4, messages: [{ role: 'system', content: system }, ...messages] }), signal: AbortSignal.timeout(ms) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`AI provider: ${plainError(r.status, errMsg(j))}`);
  return anth ? (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('') : j.choices?.[0]?.message?.content || '';
}
async function editOnce(ctx, ai, board, request, deadline) {
  if (!ai?.apiKey) throw new HttpError(400, 'Add an AI key in the 🧠 Brain settings first, or connect your own AI agent over MCP');
  if (ai.provider !== 'anthropic' && !ai.model) throw new HttpError(400, 'Choose a model name in the 🧠 Brain settings');
  const bctx = { ...ctx, source: 'ai' };
  const view = await callTool(bctx, 'get_board', { board: board.id });
  const system = EDIT_PLAN_SYSTEM(view.name);
  const messages = [{ role: 'user', content: `${compactBoard(view)}\n\nTHE OWNER ASKS: ${String(request).slice(0, 4000)}` }];
  let plan = null, lastErr = null;
  for (let attempt = 0; attempt < 2 && !plan; attempt++) {
    let text;
    try { text = await chatOnce(ai, system, messages, deadline); } catch (e) {
      throw new HttpError(502, e.name === 'TimeoutError' ? 'The AI took too long. Try a faster model in 🧠 Brain, or ask for a smaller change.' : e.message);
    }
    try { plan = readPlan(text); } catch (e) {
      lastErr = e;
      messages.push({ role: 'assistant', content: String(text).slice(0, 4000) }, { role: 'user', content: `That was not usable (${e.message}). Reply again with ONLY the JSON object.` });
    }
  }
  if (!plan) throw new HttpError(502, `The AI answered in a way FlowMap could not read (${lastErr?.message}). Try again, or pick another model in 🧠 Brain.`);
  return applyPlan(bctx, view.id, plan);
}
// apply a plan with the same tools agents use, so the rules (valid colours, sizes, kinds) are the same
export async function applyPlan(bctx, boardId, plan) {
  const p = plan && typeof plan === 'object' ? plan : {};
  const arr = (v) => (Array.isArray(v) ? v : []);
  let edits = 0;
  const changes = arr(p.changes), restyle = arr(p.restyle), conns = arr(p.connections);
  if (changes.length || restyle.length || conns.length || p.floor) {
    const r = await callTool(bctx, 'edit_board_items', { board: boardId, changes, restyle, connections: conns, floor: p.floor });
    edits += r.changed + r.deleted + r.connections + (p.floor ? 1 : 0);
  }
  if (arr(p.add).length || arr(p.connect).length) {
    const r = await callTool(bctx, 'add_to_board', { board: boardId, at: { x: 0, y: 0 }, items: arr(p.add), connections: arr(p.connect) });
    edits += r.added + r.connections;
  }
  if (!edits) throw new HttpError(502, `The AI did not change anything${p.summary ? `: ${String(p.summary).slice(0, 200)}` : ''}. Try saying exactly what to change.`);
  return { summary: String(p.summary || 'Done').slice(0, 400), edits };
}

export { addNote, addDays };
