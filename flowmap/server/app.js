// FlowMap JSON API. Runs inside the local Node server (server/index.js) and as a Vercel function (api/index.js).
import crypto from 'node:crypto';
import { hashPassword, verifyPassword, signToken, verifyToken, makeLimiter, encryptJson, decryptJson, newAgentKey, hashAgentKey, AGENT_PREFIX } from './auth.js';
import { RES, HttpError, fromRow, toCols, readWorld, loadWorld, ownedProjectIds, deleteProjects, deleteUser, insertSql, noteOut } from './models.js';
import { simulate, alerts, suggestions } from '../shared/engine.js';
import { buildTemplate, TEMPLATES } from '../shared/templates.js';
import { scanProject, scanAll, dayIn } from './sync.js';
import { designStep, DIRECTIONS } from './design.js';
import { linkPreview } from './preview.js';
import { sanitizeBoard } from '../shared/board.js';
import { handleMcp, runBrain, runBoardAI, runBoardEdit, AI_PROVIDERS, aiKeyList, aiChain, publicKey, testAi, cfgOfKey, listModels, bestModel, withFallback } from './brain.js';
import { listBoards, getBoard, boardOut, createBoard, seedBoards, saveBoard, setBoardFlags, deleteBoard, listDeleted, restoreBoard, eraseDeleted, purgeDeleted, duplicateBoard, addFile, getFile, shareInfo, setShare, resetShare, removeViewer, shareMeta, openShare, saveShared, sharedFile } from './boards.js';
import { generateBoard } from '../shared/board.js';

const safeJson = (s) => { try { return JSON.parse(s); } catch { return {}; } };
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function createApp({ db, secret, openSignup = true, cronSecret = '', youtubeKey = '' }) {
  const authLimit = makeLimiter(12, 10 * 60 * 1000);
  const brainLimit = makeLimiter(20, 60 * 60 * 1000);
  const designLimit = makeLimiter(160, 60 * 60 * 1000); // one design session is several short steps
  const editLimit = makeLimiter(120, 60 * 60 * 1000); // quick edits: the owner tries things
  const previewLimit = makeLimiter(300, 60 * 60 * 1000);

  // ---------- helpers ----------
  const secretsOf = (u) => decryptJson(secret, u.secrets);
  const settingsOf = (u) => safeJson(u.settings);
  const publicUser = (u) => {
    const s = secretsOf(u);
    const keys = aiKeyList(settingsOf(u), s);
    return { id: u.id, email: u.email, name: u.name, settings: settingsOf(u), hasAiKey: keys.length > 0, aiKeys: keys.map(publicKey), hasYoutubeKey: !!s.youtubeKey };
  };
  const todayOf = (u, q) => (DAY.test(q || '') ? q : dayIn(settingsOf(u).tz));
  const ctxFor = (u, source = 'you') => ({ db, uid: u.id, tz: settingsOf(u).tz, settings: settingsOf(u), youtubeKey: secretsOf(u).youtubeKey || youtubeKey, source });
  const clientIp = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '?';

  async function userFromAgentKey(key) {
    const row = await db.get('SELECT * FROM agent_keys WHERE hash = ?', hashAgentKey(key));
    if (!row) return null;
    db.run("UPDATE agent_keys SET last_used_at = datetime('now') WHERE id = ?", row.id).catch(() => {});
    const user = await db.get('SELECT * FROM users WHERE id = ?', row.user_id);
    return user && { user, agent: row.name };
  }
  async function requireUser(req) {
    const h = String(req.headers.authorization || '');
    const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
    if (token.startsWith(AGENT_PREFIX)) {
      const a = await userFromAgentKey(token);
      if (a) return a;
    } else {
      const uid = verifyToken(secret, token);
      const user = uid && (await db.get('SELECT * FROM users WHERE id = ?', uid));
      if (user) return { user, agent: null };
    }
    throw new HttpError(401, 'Please sign in');
  }
  function parseCreds(body) {
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) throw new HttpError(400, 'Enter a valid email');
    if (password.length < 8 || password.length > 200) throw new HttpError(400, 'Password must be at least 8 characters');
    return { email, password };
  }
  async function checkRefs(uid, res, cols) {
    const own = await ownedProjectIds(db, uid);
    const need = { links: ['from_id', 'to_id'], tasks: ['project_id'], logs: ['project_id'] }[res] || [];
    for (const c of need) if (cols[c] !== undefined && !own.has(cols[c])) throw new HttpError(400, 'Unknown project');
    if (res === 'links' && cols.from_id !== undefined && cols.from_id === cols.to_id) throw new HttpError(400, 'A project cannot feed itself');
    if (res === 'tasks' && cols.targets !== undefined) cols.targets = JSON.stringify(JSON.parse(cols.targets).filter((id) => own.has(id)));
  }
  async function upsertLog(q, uid, projectId, day, patch) {
    const row = await q.get('SELECT * FROM logs WHERE project_id = ? AND day = ? AND user_id = ?', projectId, day, uid);
    if (row) {
      const names = Object.keys(patch);
      if (names.length) await q.run(`UPDATE logs SET ${names.map((n) => `${n} = ?`).join(', ')}, sample = 0 WHERE id = ?`, ...names.map((n) => patch[n]), row.id);
      return q.get('SELECT * FROM logs WHERE id = ?', row.id);
    }
    const cols = { project_id: projectId, day, ...patch };
    const names = Object.keys(cols);
    const id = (await q.run(insertSql('logs', names), uid, ...names.map((n) => cols[n]))).lastInsertRowid;
    return q.get('SELECT * FROM logs WHERE id = ?', id);
  }
  // Finishing a task that carries a reward (e.g. a sponsored deal) pays into that day's log.
  async function withReward(uid, before, row) {
    const out = fromRow('tasks', row);
    if ((!before || before.status !== 'done') && row.status === 'done' && row.reward > 0 && row.done_on) {
      const prev = await db.get('SELECT money FROM logs WHERE project_id = ? AND day = ?', row.project_id, row.done_on);
      const log = await upsertLog(db, uid, row.project_id, row.done_on, { money: (prev?.money || 0) + row.reward });
      return { ...out, log: fromRow('logs', log) };
    }
    return out;
  }
  const worldOut = async (u) => ({ ...(await readWorld(db, u.id)), user: publicUser(u) });

  // ---------- routes ----------
  const routes = [];
  const route = (method, pattern, handler, { auth = true, agents = true } = {}) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    routes.push({ method, re, keys, handler, auth, agents });
  };

  route('GET', '/api/health', () => ({ ok: true, time: new Date().toISOString() }), { auth: false });
  route('GET', '/api/templates', () => TEMPLATES, { auth: false });
  route('GET', '/api/ai-providers', () => AI_PROVIDERS, { auth: false });

  route('POST', '/api/auth/register', async ({ body, req }) => {
    if (!openSignup) throw new HttpError(403, 'Registration is closed');
    const { email, password } = parseCreds(body);
    if (!authLimit(`reg:${clientIp(req)}`)) throw new HttpError(429, 'Too many attempts, wait a few minutes');
    if (await db.get('SELECT id FROM users WHERE email = ?', email)) throw new HttpError(409, 'That email already has an account');
    const name = String(body.name || '').trim().slice(0, 60) || email.split('@')[0];
    const template = TEMPLATES[body.template] ? body.template : 'creator';
    const settings = typeof body.tz === 'string' && body.tz.length < 60 ? { tz: body.tz } : {};
    const uid = (await db.run('INSERT INTO users (email, name, pass, settings) VALUES (?, ?, ?, ?)', email, name, hashPassword(password), JSON.stringify(settings))).lastInsertRowid;
    try {
      const world = buildTemplate(template, DAY.test(body.today || '') ? body.today : dayIn(settings.tz));
      await loadWorld(db, uid, world, { replace: true });
      await seedBoards(db, uid, world.boards);
    } catch (e) { await deleteUser(db, uid); throw e; }
    return { token: signToken(secret, uid), user: publicUser(await db.get('SELECT * FROM users WHERE id = ?', uid)) };
  }, { auth: false });

  route('POST', '/api/auth/login', async ({ body, req }) => {
    const { email, password } = parseCreds(body);
    if (!authLimit(`login:${clientIp(req)}:${email}`)) throw new HttpError(429, 'Too many attempts, wait a few minutes');
    const u = await db.get('SELECT * FROM users WHERE email = ?', email);
    // verify against a dummy hash when the user is unknown so timing does not reveal accounts
    const ok = u ? verifyPassword(password, u.pass) : (verifyPassword(password, 's1$AAAAAAAAAAAAAAAAAAAAAA$' + 'A'.repeat(86)), false);
    if (!ok) throw new HttpError(401, 'Wrong email or password');
    return { token: signToken(secret, u.id), user: publicUser(u) };
  }, { auth: false });

  route('GET', '/api/me', ({ user }) => ({ user: publicUser(user) }));
  route('PATCH', '/api/me', async ({ user, body }) => {
    const name = body.name === undefined ? user.name : String(body.name).trim().slice(0, 60);
    let settings = settingsOf(user);
    if (body.settings && typeof body.settings === 'object') {
      settings = { ...settings, ...body.settings };
      if (typeof settings.about === 'string') settings.about = settings.about.slice(0, 4000);
      if (JSON.stringify(settings).length > 8000) throw new HttpError(400, 'settings too large');
    }
    await db.run('UPDATE users SET name = ?, settings = ? WHERE id = ?', name, JSON.stringify(settings), user.id);
    return { user: publicUser({ ...user, name, settings: JSON.stringify(settings) }) };
  }, { agents: false });
  // AI keys are write-only: stored encrypted, never sent back
  route('PUT', '/api/me/secrets', async ({ user, body }) => {
    const s = secretsOf(user);
    for (const k of ['aiKey', 'youtubeKey']) {
      if (body[k] === undefined) continue;
      const v = String(body[k] || '').trim();
      if (v.length > 400) throw new HttpError(400, `${k} is too long`);
      if (v) s[k] = v; else delete s[k];
    }
    const enc = encryptJson(secret, s);
    await db.run('UPDATE users SET secrets = ? WHERE id = ?', enc, user.id);
    return { user: publicUser({ ...user, secrets: enc }) };
  }, { agents: false });
  // ---------- saved AI keys (write-only: the key itself never comes back) ----------
  const saveKeys = async (user, sec, keys) => {
    sec.aiKeys = keys; // the older single key moves into the list the first time the list changes
    delete sec.aiKey;
    const enc = encryptJson(secret, sec);
    await db.run('UPDATE users SET secrets = ? WHERE id = ?', enc, user.id);
    return publicUser({ ...user, secrets: enc });
  };
  const cleanKey = (b, prev = {}) => {
    const provider = Object.keys(AI_PROVIDERS).includes(b.provider) ? b.provider : prev.provider || 'nvidia';
    const out = {
      ...prev,
      label: String(b.label ?? prev.label ?? '').trim().slice(0, 40) || AI_PROVIDERS[provider].label.split(' (')[0],
      provider, model: String(b.model ?? prev.model ?? '').trim().slice(0, 120), baseUrl: String(b.baseUrl ?? prev.baseUrl ?? '').trim().slice(0, 300),
    };
    if (out.baseUrl && !/^https:\/\//.test(out.baseUrl)) throw new HttpError(400, 'The base URL must start with https://');
    return out;
  };
  // add one key, or several at once (keys: [..] one per line in the app)
  route('POST', '/api/me/ai-keys', async ({ user, body }) => {
    const sec = secretsOf(user);
    const keys = aiKeyList(settingsOf(user), sec);
    const raw = (Array.isArray(body.keys) ? body.keys : [body.key]).map((k) => String(k || '').trim()).filter(Boolean);
    const fresh = [...new Set(raw)].filter((k) => !keys.some((x) => x.key === k));
    if (!fresh.length) throw new HttpError(400, raw.length ? 'These keys are already saved' : 'Paste a key');
    if (keys.length + fresh.length > 20) throw new HttpError(400, 'You can save up to 20 AI keys');
    if (fresh.some((k) => k.length > 400 || /\s/.test(k))) throw new HttpError(400, 'A key looks wrong (too long or has spaces)');
    const base = cleanKey(body);
    const added = fresh.map((key, i) => ({ ...base, id: crypto.randomBytes(6).toString('hex'), label: fresh.length > 1 ? `${base.label} ${keys.length + i + 1}` : base.label, key }));
    const all = [...keys, ...added];
    const out = await saveKeys(user, sec, all);
    return { user: out, added: added.map((k) => k.id) };
  }, { agents: false });
  route('PATCH', '/api/me/ai-keys/:id', async ({ user, params, body }) => {
    const sec = secretsOf(user);
    const keys = aiKeyList(settingsOf(user), sec);
    const i = keys.findIndex((k) => k.id === params.id);
    if (i < 0) throw new HttpError(404, 'No such key');
    keys[i] = cleanKey(body, keys[i]);
    return { user: await saveKeys(user, sec, keys) };
  }, { agents: false });
  route('DELETE', '/api/me/ai-keys/:id', async ({ user, params }) => {
    const sec = secretsOf(user);
    const keys = aiKeyList(settingsOf(user), sec).filter((k) => k.id !== params.id);
    return { user: await saveKeys(user, sec, keys) };
  }, { agents: false });
  // a real, tiny request with the saved key; the result is kept so the list can show it
  route('POST', '/api/me/ai-keys/:id/test', async ({ user, params }) => {
    if (!brainLimit(`aitest:${user.id}`)) throw new HttpError(429, 'Too many tests this hour. Try again later.');
    const sec = secretsOf(user);
    const keys = aiKeyList(settingsOf(user), sec);
    const k = keys.find((x) => x.id === params.id);
    if (!k) throw new HttpError(404, 'No such key');
    const result = await testAi(cfgOfKey(k));
    k.test = { ok: result.ok, tools: result.tools, note: result.note, ms: result.ms, at: result.at };
    return { result, user: await saveKeys(user, sec, keys) };
  }, { agents: false });
  // the models this saved key can use, asked from its provider; "fix" also moves the key to an available model
  route('GET', '/api/me/ai-keys/:id/models', async ({ user, params, query }) => {
    if (!brainLimit(`aitest:${user.id}`)) throw new HttpError(429, 'Too many requests this hour. Try again later.');
    const sec = secretsOf(user);
    const keys = aiKeyList(settingsOf(user), sec);
    const k = keys.find((x) => x.id === params.id);
    if (!k) throw new HttpError(404, 'No such key');
    const cfg = cfgOfKey(k);
    const out = await listModels(cfg);
    if (query.get('fix') === '1' && out.all.length && !out.all.includes(cfg.model)) {
      k.model = bestModel(out.all, cfg.provider); k.test = null;
      return { ...out, model: k.model, user: await saveKeys(user, sec, keys) };
    }
    return { ...out, model: cfg.model };
  }, { agents: false });
  // NVIDIA's own model list (public), so the app can offer every model without typing
  let nvidiaCache = null;
  route('GET', '/api/ai-models/nvidia', async () => {
    if (nvidiaCache && Date.now() - nvidiaCache.at < 3600000) return nvidiaCache.data;
    const skip = /embed|guard|reward|safety|rerank|vl\b|vila|vision|fuyu|coder|code|kosmos|paligemma|neva|clip|parse|ocr|retriev|deplot|detector|calibration|cosmos|translate|asr|tts|diffusion|med|fin-/i;
    let ids = [];
    try {
      const r = await fetch('https://integrate.api.nvidia.com/v1/models', { signal: AbortSignal.timeout(15000) });
      ids = ((await r.json()).data || []).map((m) => m.id).filter((id) => !skip.test(id)).sort();
    } catch { /* offline: the recommended list still works */ }
    const recommended = AI_PROVIDERS.nvidia.models;
    const data = { recommended, all: [...new Set([...recommended, ...ids])] };
    nvidiaCache = { at: Date.now(), data };
    return data;
  }, { auth: false });
  route('POST', '/api/me/password', async ({ user, body }) => {
    if (!verifyPassword(String(body.current || ''), user.pass)) throw new HttpError(403, 'Current password is wrong');
    const next = String(body.next || '');
    if (next.length < 8 || next.length > 200) throw new HttpError(400, 'New password must be at least 8 characters');
    await db.run('UPDATE users SET pass = ? WHERE id = ?', hashPassword(next), user.id);
    return { ok: true };
  }, { agents: false });
  route('DELETE', '/api/me', async ({ user, body }) => {
    if (!verifyPassword(String(body.password || ''), user.pass)) throw new HttpError(403, 'Password is wrong');
    await deleteUser(db, user.id);
    return { ok: true };
  }, { agents: false });

  // ---------- agent keys ----------
  route('GET', '/api/agent-keys', async ({ user }) => (await db.all('SELECT id, name, prefix, created_at, last_used_at FROM agent_keys WHERE user_id = ? ORDER BY id', user.id))
    .map((r) => ({ id: r.id, name: r.name, prefix: r.prefix, createdAt: r.created_at, lastUsedAt: r.last_used_at })), { agents: false });
  route('POST', '/api/agent-keys', async ({ user, body }) => {
    const name = String(body.name || '').trim().slice(0, 40) || 'AI agent';
    if ((await db.get('SELECT COUNT(*) AS n FROM agent_keys WHERE user_id = ?', user.id)).n >= 20) throw new HttpError(400, 'You already have 20 agent keys: remove one first');
    const key = newAgentKey();
    const id = (await db.run('INSERT INTO agent_keys (user_id, name, hash, prefix) VALUES (?, ?, ?, ?)', user.id, name, hashAgentKey(key), key.slice(0, 7))).lastInsertRowid;
    return { key, item: { id, name, prefix: key.slice(0, 7), createdAt: new Date().toISOString(), lastUsedAt: null } };
  }, { agents: false });
  route('DELETE', '/api/agent-keys/:id', async ({ user, params }) => {
    const r = await db.run('DELETE FROM agent_keys WHERE id = ? AND user_id = ?', Number(params.id), user.id);
    if (!r.changes) throw new HttpError(404, 'Not found');
    return { ok: true };
  }, { agents: false });

  // ---------- world ----------
  route('GET', '/api/world', ({ user }) => worldOut(user));
  route('GET', '/api/world/export', async ({ user }) => {
    const w = await readWorld(db, user.id, { logDays: 5000 });
    return { app: 'flowmap', version: 2, exportedAt: new Date().toISOString(), projects: w.projects, links: w.links, tasks: w.tasks, logs: w.logs };
  });
  route('POST', '/api/world/import', async ({ user, body }) => {
    const w = body.world || body;
    const ids = (w.projects || []).map((p) => p && p.id);
    if (ids.some((i) => i === undefined || i === null) || new Set(ids).size !== ids.length) throw new HttpError(400, 'Every project needs a unique id');
    await loadWorld(db, user.id, w, { replace: body.replace !== false });
    return readWorld(db, user.id);
  }, { agents: false });
  route('POST', '/api/world/reset', async ({ user, body }) => {
    const template = TEMPLATES[body.template] ? body.template : 'blank';
    const world = buildTemplate(template, todayOf(user, body.today));
    await loadWorld(db, user.id, world, { replace: true });
    await seedBoards(db, user.id, world.boards);
    return readWorld(db, user.id);
  }, { agents: false });
  route('POST', '/api/world/clear-sample', async ({ user }) => {
    await db.run('DELETE FROM tasks WHERE user_id = ? AND sample = 1', user.id);
    await db.run('DELETE FROM logs WHERE user_id = ? AND sample = 1', user.id);
    return readWorld(db, user.id);
  });

  // Same engine as the browser, so other tools can read the simulation.
  route('GET', '/api/report', async ({ user, query }) => {
    const world = await readWorld(db, user.id);
    const t = todayOf(user, query.get('today'));
    const horizon = Math.min(365, Math.max(0, Number(query.get('horizon')) || 30));
    const scenario = ['planned', 'keep', 'stop'].includes(query.get('scenario')) ? query.get('scenario') : 'planned';
    const sim = simulate(world, { today: t, horizon, scenario });
    const now = sim.days[0];
    const named = (map) => world.projects.filter((p) => map[p.id]).map((p) => ({ id: p.id, name: p.name, kind: p.kind, ...map[p.id] }));
    return { today: t, scenario, totals: now.totals, projects: named(now.projects), alerts: alerts(world, sim.ctx, now), suggestions: suggestions(sim.ctx, now, 5), forecast: sim.days.map((d) => ({ day: d.day, ...d.totals })) };
  });

  // ---------- channels & brain ----------
  route('POST', '/api/projects/:id/scan', async ({ user, params }) => {
    const row = await db.get('SELECT * FROM projects WHERE id = ? AND user_id = ?', Number(params.id), user.id);
    if (!row) throw new HttpError(404, 'Not found');
    const results = await scanProject(db, user.id, fromRow('projects', row), ctxFor(user));
    return { results, world: await readWorld(db, user.id) };
  });
  route('POST', '/api/scan', async ({ user }) => ({ results: await scanAll(db, user.id, ctxFor(user)), world: await readWorld(db, user.id) }));
  route('POST', '/api/brain/run', async ({ user, req }) => {
    if (!brainLimit(`brain:${user.id}`)) throw new HttpError(429, 'The brain already ran many times this hour. Try again later.');
    const s = settingsOf(user);
    const out = await runBrain(ctxFor(user), aiChain(s, secretsOf(user)), { trigger: 'manual' });
    return { ...out, world: await readWorld(db, user.id) };
  }, { agents: false });
  // ---------- boards ----------
  const aiOf = (user) => aiChain(settingsOf(user), secretsOf(user));
  // ---------- link previews and research cards ----------
  route('GET', '/api/preview', async ({ user, query }) => {
    if (!previewLimit(`preview:${user.id}`)) throw new HttpError(429, 'Too many previews this hour. Try again later.');
    return linkPreview(query.get('url'), { youtubeKey: secretsOf(user).youtubeKey || youtubeKey, fresh: query.get('fresh') === '1' });
  }, { agents: false });
  // ---------- assets: designs saved to reuse on any board ----------
  const assetOut = (r) => ({ id: r.id, name: r.name, thumb: r.thumb, createdAt: r.created_at, ...(r.data ? { data: JSON.parse(r.data) } : {}) });
  route('GET', '/api/assets', async ({ user }) => (await db.all('SELECT id, name, thumb, created_at FROM board_assets WHERE user_id = ? ORDER BY id DESC', user.id)).map(assetOut), { agents: false });
  route('GET', '/api/assets/:id', async ({ user, params }) => {
    const r = await db.get('SELECT * FROM board_assets WHERE id = ? AND user_id = ?', Number(params.id), user.id);
    if (!r) throw new HttpError(404, 'No such asset');
    return assetOut(r);
  }, { agents: false });
  route('POST', '/api/assets', async ({ user, body }) => {
    if ((await db.get('SELECT COUNT(*) AS n FROM board_assets WHERE user_id = ?', user.id)).n >= 300) throw new HttpError(400, 'You can keep up to 300 assets');
    let data;
    try { data = sanitizeBoard({ items: body.data?.items, links: body.data?.links }); } catch (e) { throw new HttpError(400, e.message); }
    if (!data.items.length) throw new HttpError(400, 'Select something to save');
    if (JSON.stringify(data).length > 600000) throw new HttpError(400, 'That is too big for one asset (over 600 KB). Save a smaller part.');
    const thumb = typeof body.thumb === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(body.thumb) && body.thumb.length < 120000 ? body.thumb : '';
    const name = String(body.name || '').trim().slice(0, 60) || 'Asset';
    const id = (await db.run('INSERT INTO board_assets (user_id, name, thumb, data) VALUES (?, ?, ?, ?)', user.id, name, thumb, JSON.stringify({ items: data.items, links: data.links }))).lastInsertRowid;
    return assetOut(await db.get('SELECT id, name, thumb, created_at FROM board_assets WHERE id = ?', id));
  }, { agents: false });
  route('PATCH', '/api/assets/:id', async ({ user, params, body }) => {
    const name = String(body.name || '').trim().slice(0, 60);
    if (!name) throw new HttpError(400, 'Give it a name');
    await db.run('UPDATE board_assets SET name = ? WHERE id = ? AND user_id = ?', name, Number(params.id), user.id);
    return { ok: true };
  }, { agents: false });
  route('DELETE', '/api/assets/:id', async ({ user, params }) => { await db.run('DELETE FROM board_assets WHERE id = ? AND user_id = ?', Number(params.id), user.id); return { ok: true }; }, { agents: false });
  route('GET', '/api/boards', async ({ user }) => listBoards(db, user.id));
  route('POST', '/api/boards', async ({ user, body }) => {
    let data = body.data;
    if (!data && body.spec) { const g = generateBoard(body.spec); data = { v: 1, items: g.items, links: g.links, order: g.order, settings: {} }; }
    return createBoard(db, user.id, { name: body.name, icon: body.icon, data });
  });
  route('POST', '/api/boards/generate', async ({ user, body }) => {
    if (!brainLimit(`brain:${user.id}`)) throw new HttpError(429, 'The AI already ran many times this hour. Try again later.');
    const request = String(body.prompt || '').trim();
    if (request.length < 4) throw new HttpError(400, 'Describe the board you want');
    const out = await runBoardAI(ctxFor(user), aiOf(user), request);
    return { ...out, board: boardOut(await getBoard(db, user.id, out.board.id)) };
  }, { agents: false });
  // one step of a design session (plan with questions, a section, a fix, the final polish)
  route('GET', '/api/design/directions', async () => Object.fromEntries(Object.entries(DIRECTIONS).map(([id, d]) => [id, { label: d.label, hint: d.hint, colors: d.colors }])), { auth: false });
  route('POST', '/api/boards/:id/design', async ({ user, params, body }) => {
    if (!designLimit(`design:${user.id}`)) throw new HttpError(429, 'The AI already ran many design steps this hour. Try again later.');
    const b = await getBoard(db, user.id, params.id);
    const settings = settingsOf(user);
    let chain = aiOf(user);
    const i = chain.findIndex((k) => k.id === body.keyId);
    if (i > 0) chain = [chain[i], ...chain.slice(0, i), ...chain.slice(i + 1)];
    const deadline = Date.now() + 240000;
    const out = await withFallback(chain, (ai) => {
      if (ai.provider !== 'anthropic' && !ai.model) throw new HttpError(400, 'Choose a model name in the 🧠 Brain settings');
      return designStep({ ...ctxFor(user), source: 'ai' }, ai, b.id, body, settings, deadline);
    }).catch((e) => { console.error(`design ${body.phase} failed (board ${b.id}): ${e.message}`); throw e; });
    return { ...out, board: boardOut(await getBoard(db, user.id, b.id)) };
  }, { agents: false });
  route('POST', '/api/boards/:id/ai', async ({ user, params, body }) => {
    if (!editLimit(`edit:${user.id}`)) throw new HttpError(429, 'The AI already ran many times this hour. Try again later.');
    const request = String(body.prompt || '').trim();
    if (request.length < 3) throw new HttpError(400, 'Say what to change');
    const b = await getBoard(db, user.id, params.id);
    let chain = aiOf(user);
    const k = chain.findIndex((x) => x.id === body.keyId);
    if (k > 0) chain = [chain[k], ...chain.slice(0, k), ...chain.slice(k + 1)];
    const images = (Array.isArray(body.images) ? body.images : []).filter((u) => typeof u === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(u) && u.length < 3_000_000).slice(0, 2);
    const scope = Array.isArray(body.scope) ? body.scope.filter((x) => typeof x === 'string').slice(0, 200) : null;
    const out = await runBoardEdit(ctxFor(user), chain, { id: b.id, name: b.name }, request, { scope, images }).catch((e) => { console.error(`board AI failed (board ${b.id}): ${e.message}`); throw e; });
    return { ...out, board: boardOut(await getBoard(db, user.id, b.id)) };
  }, { agents: false });
  route('GET', '/api/boards/:id', async ({ user, params }) => boardOut(await getBoard(db, user.id, params.id)));
  route('PATCH', '/api/boards/:id/flags', async ({ user, params, body }) => setBoardFlags(db, user.id, params.id, { pinned: typeof body.pinned === 'boolean' ? body.pinned : undefined, demo: typeof body.demo === 'boolean' ? body.demo : undefined }));
  route('PUT', '/api/boards/:id', async ({ user, params, body }) => saveBoard(db, user.id, params.id, body));
  route('DELETE', '/api/boards/:id', async ({ user, params }) => deleteBoard(db, user.id, params.id));
  route('GET', '/api/boards-deleted', async ({ user }) => listDeleted(db, user.id));
  route('POST', '/api/boards-deleted/:id/restore', async ({ user, params }) => restoreBoard(db, user.id, params.id));
  route('DELETE', '/api/boards-deleted/:id', async ({ user, params }) => eraseDeleted(db, user.id, params.id), { agents: false });
  route('POST', '/api/boards/:id/duplicate', async ({ user, params }) => duplicateBoard(db, user.id, params.id));
  route('POST', '/api/boards/:id/files', async ({ user, params, body }) => addFile(db, user.id, { ...body, boardId: params.id }));
  route('GET', '/api/board-files/:id', async ({ user, params }) => getFile(db, user.id, params.id));
  route('GET', '/api/boards/:id/share', async ({ user, params }) => shareInfo(db, user.id, params.id), { agents: false });
  route('PUT', '/api/boards/:id/share', async ({ user, params, body }) => setShare(db, user.id, params.id, body), { agents: false });
  route('POST', '/api/boards/:id/share/reset', async ({ user, params }) => resetShare(db, user.id, params.id), { agents: false });
  route('DELETE', '/api/boards/:id/share/viewers/:vid', async ({ user, params }) => removeViewer(db, user.id, params.id, params.vid), { agents: false });
  // public side of a shared link (no account needed)
  route('GET', '/api/share/:token', async ({ params }) => shareMeta(db, params.token), { auth: false });
  route('POST', '/api/share/:token/open', async ({ params, body, req }) => openShare(db, params.token, body, { tryPassword: () => authLimit(`share:${clientIp(req)}:${params.token}`) }), { auth: false });
  route('PUT', '/api/share/:token/board', async ({ params, body }) => saveShared(db, params.token, body), { auth: false });
  route('GET', '/api/share/:token/files/:fid', async ({ params, query }) => sharedFile(db, params.token, query.get ? query.get('viewer') : query.viewer, params.fid), { auth: false });

  route('DELETE', '/api/notes/:id', async ({ user, params }) => {
    await db.run('DELETE FROM notes WHERE id = ? AND user_id = ?', Number(params.id), user.id);
    return { ok: true };
  });
  route('POST', '/api/notes', async ({ user, agent, body }) => {
    const text = String(body.text || '').trim().slice(0, 2000);
    if (!text) throw new HttpError(400, 'text is required');
    const pid = body.projectId === undefined || body.projectId === null ? null : Number(body.projectId);
    if (pid !== null && !(await ownedProjectIds(db, user.id)).has(pid)) throw new HttpError(400, 'Unknown project');
    const id = (await db.run('INSERT INTO notes (user_id, project_id, at, source, kind, text) VALUES (?, ?, ?, ?, ?, ?)', user.id, pid, new Date().toISOString(), agent ? `agent:${agent}` : 'you', ['insight', 'warning', 'plan'].includes(body.kind) ? body.kind : 'insight', text)).lastInsertRowid;
    return noteOut(await db.get('SELECT * FROM notes WHERE id = ?', id));
  });

  // Daily job (Vercel Cron): scan every channel, then let the built-in AI review each system that asked for it.
  route('GET', '/api/cron/daily', async ({ req }) => {
    if (!cronSecret || req.headers.authorization !== `Bearer ${cronSecret}`) throw new HttpError(401, 'Not allowed');
    const started = Date.now();
    const report = [];
    for (const user of await db.all('SELECT * FROM users ORDER BY id')) {
      if (Date.now() - started > 240000) { report.push({ user: user.id, skipped: 'time limit' }); continue; }
      const item = { user: user.id };
      try { const n = await purgeDeleted(db, user.id); if (n) item.erasedBoards = n; } catch (e) { item.purgeError = e.message; }
      try { item.scans = (await scanAll(db, user.id, ctxFor(user))).length; } catch (e) { item.scanError = e.message; }
      const s = settingsOf(user), chain = aiChain(s, secretsOf(user));
      if (s.aiDaily && chain.length) {
        try { item.brain = (await runBrain(ctxFor(user), chain, { trigger: 'daily', budgetMs: 40000 })).actions.length; }
        catch (e) { item.brainError = e.message; }
      }
      report.push(item);
    }
    return { ok: true, report };
  }, { auth: false });

  // generic CRUD
  for (const res of Object.keys(RES)) {
    const table = RES[res].table;
    route('GET', `/api/${res}`, async ({ user }) => (await db.all(`SELECT * FROM ${table} WHERE user_id = ?`, user.id)).map((r) => fromRow(res, r)));
    route('POST', `/api/${res}`, async ({ user, agent, body }) => {
      if (res === 'logs') return saveLog(user, body);
      if (res === 'tasks' && agent && !body.source) body = { ...body, source: `agent:${agent}` };
      const cols = toCols(res, body, { create: true });
      await checkRefs(user.id, res, cols);
      const names = Object.keys(cols);
      const id = (await db.run(insertSql(table, names), user.id, ...names.map((n) => cols[n]))).lastInsertRowid;
      const row = await db.get(`SELECT * FROM ${table} WHERE id = ?`, id);
      return res === 'tasks' ? withReward(user.id, null, row) : fromRow(res, row);
    });
    route('PATCH', `/api/${res}/:id`, async ({ user, body, params }) => {
      const id = Number(params.id);
      const before = await db.get(`SELECT * FROM ${table} WHERE id = ? AND user_id = ?`, id, user.id);
      if (!before) throw new HttpError(404, 'Not found');
      const cols = toCols(res, body, { create: false });
      await checkRefs(user.id, res, cols);
      const names = Object.keys(cols);
      if (names.length) await db.run(`UPDATE ${table} SET ${names.map((n) => `${n} = ?`).join(', ')} WHERE id = ? AND user_id = ?`, ...names.map((n) => cols[n]), id, user.id);
      const row = await db.get(`SELECT * FROM ${table} WHERE id = ?`, id);
      return res === 'tasks' ? withReward(user.id, before, row) : fromRow(res, row);
    });
    route('DELETE', `/api/${res}/:id`, async ({ user, params }) => {
      const id = Number(params.id);
      if (!(await db.get(`SELECT id FROM ${table} WHERE id = ? AND user_id = ?`, id, user.id))) throw new HttpError(404, 'Not found');
      if (res === 'projects') await db.tx((q) => deleteProjects(q, user.id, [id]));
      else await db.run(`DELETE FROM ${table} WHERE id = ? AND user_id = ?`, id, user.id);
      return { ok: true };
    });
  }

  async function saveLog(user, body) {
    const cols = toCols('logs', body, { create: false });
    if (cols.project_id === undefined || cols.day === undefined) throw new HttpError(400, 'projectId and day are required');
    await checkRefs(user.id, 'logs', cols);
    const { project_id, day, ...patch } = cols;
    return fromRow('logs', await upsertLog(db, user.id, project_id, day, patch));
  }

  // Spread a monthly total over the days of that month ("the channel made 240,000 in September").
  route('POST', '/api/logs/spread', async ({ user, body }) => {
    const month = String(body.month || '');
    if (!/^\d{4}-\d{2}$/.test(month)) throw new HttpError(400, 'month must be YYYY-MM');
    const projectId = Number(body.projectId);
    if (!(await ownedProjectIds(db, user.id)).has(projectId)) throw new HttpError(400, 'Unknown project');
    const [y, m] = month.split('-').map(Number);
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const t = todayOf(user, body.today);
    const lastDay = t.startsWith(month) ? Number(t.slice(8)) : daysInMonth; // only spread up to today for the current month
    const patch = {};
    for (const k of ['money', 'attention', 'customers']) {
      if (typeof body[k] === 'number' && Number.isFinite(body[k]) && body[k] >= 0) patch[k] = Math.round((body[k] / lastDay) * 100) / 100;
    }
    if (!Object.keys(patch).length) throw new HttpError(400, 'Give at least one of money, attention, customers');
    const logs = await db.tx(async (q) => {
      const rows = [];
      for (let d = 1; d <= lastDay; d++) rows.push(fromRow('logs', await upsertLog(q, user.id, projectId, `${month}-${String(d).padStart(2, '0')}`, patch)));
      return rows;
    });
    return { logs };
  });

  // ---------- dispatch ----------
  async function readBody(req, limit) {
    if (req.body !== undefined && typeof req.body === 'object' && req.body !== null && !Buffer.isBuffer(req.body)) return req.body; // pre-parsed by the host
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > limit) throw new HttpError(413, 'Request too large');
      chunks.push(c);
    }
    const raw = size ? Buffer.concat(chunks).toString('utf8') : typeof req.body === 'string' ? req.body : '';
    if (!raw) return {};
    try { return JSON.parse(raw); } catch { throw new HttpError(400, 'Invalid JSON'); }
  }
  const sendJson = (res, status, obj, extra = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
    res.end(obj === null ? '' : JSON.stringify(obj));
  };
  const MCP_CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS' };

  // MCP endpoint for AI agents: /api/mcp/<agent key>, or /api/mcp with "Authorization: Bearer <agent key>"
  async function mcp(req, res, pathname) {
    if (req.method === 'OPTIONS') return sendJson(res, 204, null, MCP_CORS);
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Use POST (MCP Streamable HTTP)' }, { ...MCP_CORS, Allow: 'POST' });
    const key = decodeURIComponent(pathname.slice('/api/mcp/'.length)) || String(req.headers.authorization || '').replace(/^Bearer\s+/, '');
    const who = key.startsWith(AGENT_PREFIX) ? await userFromAgentKey(key) : null;
    if (!who) return sendJson(res, 401, { error: 'Unknown agent key. Create one in FlowMap → Settings → AI agents.' }, MCP_CORS);
    const body = await readBody(req, 1_000_000);
    const ctx = { ...ctxFor(who.user, `agent:${who.agent}`) };
    if (Array.isArray(body)) {
      const out = (await Promise.all(body.map((m) => handleMcp(ctx, m)))).filter(Boolean);
      return out.length ? sendJson(res, 200, out, MCP_CORS) : sendJson(res, 202, null, MCP_CORS);
    }
    const out = await handleMcp(ctx, body);
    return out ? sendJson(res, 200, out, MCP_CORS) : sendJson(res, 202, null, MCP_CORS);
  }

  async function handle(req, res, pathname, query) {
    try {
      if (pathname === '/api/mcp' || pathname.startsWith('/api/mcp/')) return await mcp(req, res, pathname);
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(pathname);
        if (!m) continue;
        const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        const ctx = { req, params, query, user: null, agent: null, body: {} };
        if (r.auth) {
          Object.assign(ctx, await requireUser(req));
          if (ctx.agent && !r.agents) throw new HttpError(403, 'Agent keys cannot do this');
        }
        if (req.method !== 'GET' && req.method !== 'DELETE') ctx.body = await readBody(req, 3_000_000);
        else if (req.method === 'DELETE') ctx.body = await readBody(req, 10_000).catch(() => ({}));
        return sendJson(res, 200, await r.handler(ctx));
      }
      throw new HttpError(404, 'No such endpoint');
    } catch (e) {
      if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message, ...(e.latest ? { latest: e.latest } : {}) });
      if (String(e?.message || '').includes('UNIQUE')) return sendJson(res, 409, { error: 'Already exists' });
      console.error(e);
      return sendJson(res, 500, { error: 'Server error' });
    }
  }

  return { handle };
}
