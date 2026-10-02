// The 🧠 dialog: what the AI should know about you, the built-in daily AI, and links for outside AI agents.
import { h, clear, setText } from './util.js';
import { S, notify, saveSettings, runBrain, listAgentKeys, createAgentKey, deleteAgentKey, addAiKeys, updateAiKey, removeAiKey, testAiKey, nvidiaModels, keyModels } from './store.js';
import { openModal, field, select, confirmDialog } from './ui-common.js';

const PROVIDERS = [
  { value: 'nvidia', label: 'NVIDIA (free models)', model: 'moonshotai/kimi-k2.6', keyHint: 'Starts with nvapi-. Get one free at build.nvidia.com (API key in your profile).' },
  { value: 'gemini', label: 'Google Gemini', model: 'gemini-2.5-flash', models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite'], keyHint: 'Starts with AIza. Get one free at aistudio.google.com → Get API key.' },
  { value: 'anthropic', label: 'Anthropic (Claude)', model: 'claude-sonnet-5-5', keyHint: 'Starts with sk-ant-. Create one at console.anthropic.com.' },
  { value: 'openai', label: 'OpenAI (ChatGPT models)', model: '', keyHint: 'Create one at platform.openai.com.' },
  { value: 'compatible', label: 'Other: OpenRouter, Groq, DeepSeek…', model: '', keyHint: 'Any provider with an OpenAI-compatible API. Enter its base URL below.' },
];

function copyButton(getText) {
  return h('button', { class: 'btn sm', type: 'button', onclick: async (e) => {
    const btn = e.currentTarget;
    try { await navigator.clipboard.writeText(getText()); btn.textContent = 'Copied'; }
    catch { btn.textContent = 'Select and copy'; btn.previousElementSibling?.select?.(); }
    setTimeout(() => { btn.textContent = 'Copy'; }, 1800);
  } }, 'Copy');
}

function connectionHelp(url) {
  const step = (title, text) => h('div', { class: 'ex' }, h('div', null, h('b', null, title), h('p', null, text)));
  return h('div', { class: 'explain', style: 'margin-top:10px' },
    step('Claude (claude.ai or the Claude app)', 'Settings → Connectors → Add custom connector. Paste the link above as the URL, then ask Claude: "Check my FlowMap system and give me today\'s tasks."'),
    step('Claude Code', `Run: claude mcp add --transport http flowmap ${url}`),
    step('ChatGPT', 'Settings → Connectors (developer mode) → Create, and paste the link as the MCP server URL.'),
    step('Any other agent or script', 'Use the link as an MCP server (Streamable HTTP). Or call the REST API at /api/... with the header "Authorization: Bearer <the fm_ key at the end of the link>".'));
}

export function openBrainSettings() {
  const s = S.user.settings || {};
  const st = { about: s.about || '', daily: !!s.aiDaily };

  // ---- about ----
  const about = field('About you and your goals',
    h('textarea', { id: 'b-about', rows: 4, maxLength: 4000, placeholder: 'e.g. I run Vinei TV (Swahili tutorials) and want 100k subscribers by June. My income goal is TZS 3M a month. I can film 3 videos a week and work evenings…', oninput: (e) => { st.about = e.target.value; } }, st.about),
    'Every AI that connects to FlowMap reads this first, so it can give you tasks that fit your life and goals.');

  // ---- built-in AI: saved keys ----
  let models = null; // NVIDIA's list, loaded once
  const loadModels = async () => { if (!models) { try { models = await nvidiaModels(); } catch { models = { recommended: PROVIDERS[0].model ? [PROVIDERS[0].model] : [], all: [] }; } } return models; };
  const provLabel = (v) => (PROVIDERS.find((p) => p.value === v)?.label || v).split(' (')[0];
  const activeId = () => { const list = S.user.aiKeys || []; return list.some((k) => k.id === s.aiActive) ? s.aiActive : list[0]?.id; };
  const modelSelect = (value, onPick, mdl) => {
    const rec = mdl?.recommended || [], rest = (mdl?.all || []).filter((m) => !rec.includes(m));
    const sel = h('select', { onchange: (e) => onPick(e.target.value) },
      rec.length ? h('optgroup', { label: mdl?.recLabel || 'Best for the brain (can use tools)' }, rec.map((m) => h('option', { value: m, selected: m === value }, m))) : null,
      rest.length ? h('optgroup', { label: mdl?.allLabel || 'All NVIDIA models' }, rest.map((m) => h('option', { value: m, selected: m === value }, m))) : null);
    if (value && !rec.includes(value) && !rest.includes(value)) sel.prepend(h('option', { value, selected: true }, value));
    // NVIDIA's public list misses many models your key can use: type any model name instead
    const wrap = h('span', { class: 'mpick' }, sel);
    const typeBtn = h('button', { type: 'button', class: 'btn sm', title: 'Type any model name, e.g. meta/llama-3.3-70b-instruct', onclick: () => {
      const inp = h('input', { type: 'text', value: sel.value || value || '', placeholder: 'e.g. meta/llama-3.3-70b-instruct', spellcheck: 'false', class: 'mono',
        onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } },
        onchange: (e) => { const v = e.target.value.trim(); if (v) onPick(v); } });
      wrap.replaceChildren(inp); inp.focus(); inp.select();
    } }, 'i:pencil', ' Type');
    wrap.append(typeBtn);
    return wrap;
  };
  const status = (t) => !t ? h('span', { class: 'kchip' }, 'Not tested')
    : t.ok && t.tools ? h('span', { class: 'kchip good', title: t.note }, `✓ Works · ${(t.ms / 1000).toFixed(1)}s`)
    : t.ok ? h('span', { class: 'kchip warn', title: t.note }, '⚠️ Key works, model can\'t use tools')
    : h('span', { class: 'kchip bad', title: t.note }, `✕ ${t.note.slice(0, 60)}`);
  const keyList = h('div', { class: 'keylist' });
  // each key's own model list, asked from its provider (Gemini, OpenAI, Claude, others)
  const keyModelsCache = {};
  const loadKeyModels = async (id, fix = false) => {
    const r = await keyModels(id, fix);
    keyModelsCache[id] = { recommended: r.recommended, all: r.all, recLabel: 'Suggested', allLabel: 'All models for this key' };
    return r;
  };
  const testOne = async (id, btn) => {
    if (btn) { btn.disabled = true; setText(btn, 'Testing…'); }
    try { const r = await testAiKey(id); if (!r.result.ok) notify(`${(S.user.aiKeys || []).find((k) => k.id === id)?.label}: ${r.result.note}`, 'error'); } catch (e) { notify(e.message, 'error'); }
    paintAiKeys();
  };
  const testAll = async (btn) => {
    btn.disabled = true;
    const ids = (S.user.aiKeys || []).map((k) => k.id);
    for (let i = 0; i < ids.length; i++) { setText(btn, `Testing ${i + 1} of ${ids.length}…`); try { await testAiKey(ids[i]); } catch (e) { notify(e.message, 'error'); break; } paintAiKeys(); }
    btn.disabled = false; setText(btn, 'Test all keys');
    const list = S.user.aiKeys || [];
    const good = list.filter((k) => k.test?.ok && k.test?.tools).length;
    notify(`${good} of ${list.length} keys work with the brain`, good ? 'good' : 'error');
  };
  const paintAiKeys = async () => {
    const list = S.user.aiKeys || [];
    const act = activeId();
    const mdl = list.some((k) => k.provider === 'nvidia') ? await loadModels() : null;
    clear(keyList).append(list.length ? list.map((k) => h('div', { class: `keyrow${k.id === act ? ' active' : ''}` },
      h('button', { type: 'button', class: `btn sm${k.id === act ? ' primary' : ''}`, title: 'The brain uses this key first', onclick: async () => { s.aiActive = k.id; await saveSettings({ aiActive: k.id }); paintAiKeys(); } }, k.id === act ? '✓ In use' : 'Use'),
      h('div', { class: 'grow' },
        h('b', null, k.label), h('small', null, ` ${provLabel(k.provider)} · ••••${k.tail}`),
        h('div', { class: 'row', style: 'gap:6px;margin-top:4px;flex-wrap:wrap' },
          k.provider === 'nvidia' ? modelSelect(k.model, async (v) => { await updateAiKey(k.id, { model: v }); paintAiKeys(); }, mdl)
            : keyModelsCache[k.id] ? modelSelect(k.model, async (v) => { await updateAiKey(k.id, { model: v }); paintAiKeys(); }, keyModelsCache[k.id])
            : h('span', { class: 'mpick' },
              h('input', { type: 'text', value: k.model, placeholder: 'model name', style: 'max-width:220px', onchange: async (e) => { await updateAiKey(k.id, { model: e.target.value.trim() }); paintAiKeys(); } }),
              h('button', { type: 'button', class: 'btn sm', title: 'Show the models this key can use', onclick: async (e) => { const b = e.currentTarget; b.disabled = true; setText(b, 'Loading…'); try { await loadKeyModels(k.id); } catch (err) { notify(err.message, 'error'); } paintAiKeys(); } }, '↻ Models')),
          status(k.test))),
      h('button', { type: 'button', class: 'btn sm', onclick: (e) => testOne(k.id, e.currentTarget) }, 'Test'),
      h('button', { type: 'button', class: 'btn sm danger', title: 'Remove this key', onclick: async () => {
        if (!(await confirmDialog({ title: `Remove “${k.label}”?`, message: 'The key is deleted from FlowMap. It still exists at your provider.', confirm: 'Remove', danger: true }))) return;
        await removeAiKey(k.id); paintAiKeys();
      } }, '🗑')))
      : h('div', { class: 'hint' }, 'No AI keys yet. Add one below. NVIDIA gives free keys at build.nvidia.com.'));
  };
  // add one key, or several at once (one per line): all get the same provider and model, then each is tested
  const add = { provider: 'nvidia', model: PROVIDERS[0].model, baseUrl: '', label: '' };
  const addHost = h('div');
  const paintAdd = async () => {
    const pv = PROVIDERS.find((p) => p.value === add.provider);
    const mdl = add.provider === 'nvidia' ? await loadModels() : pv.models ? { recommended: pv.models, all: [], recLabel: 'Suggested (more after adding the key)' } : null;
    const keysBox = h('textarea', { rows: 3, autocomplete: 'off', spellcheck: 'false', class: 'mono', placeholder: 'Paste one key, or several keys (one per line)' });
    const addBtn = h('button', { type: 'button', class: 'btn primary', onclick: async () => {
      const keys = keysBox.value.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);
      if (!keys.length) { notify('Paste at least one key', 'error'); return; }
      addBtn.disabled = true; setText(addBtn, 'Adding…');
      try {
        const r = await addAiKeys({ ...add, keys });
        keysBox.value = '';
        if (!s.aiActive && r.added[0]) { s.aiActive = r.added[0]; await saveSettings({ aiActive: r.added[0] }); }
        paintAiKeys();
        for (let i = 0; i < r.added.length; i++) {
          setText(addBtn, `Testing ${i + 1} of ${r.added.length}…`);
          if (add.provider !== 'nvidia' && add.provider !== 'compatible') await loadKeyModels(r.added[i], true).catch(() => {});
          await testAiKey(r.added[i]).catch(() => {}); paintAiKeys();
        }
        const list = (S.user.aiKeys || []).filter((k) => r.added.includes(k.id));
        const good = list.filter((k) => k.test?.ok && k.test?.tools).length;
        notify(`Added ${list.length} key${list.length === 1 ? '' : 's'}: ${good} work${good === 1 ? 's' : ''} with the brain`, good === list.length ? 'good' : 'error');
      } catch (e) { notify(e.message, 'error'); }
      addBtn.disabled = false; setText(addBtn, '＋ Add and test');
    } }, '＋ Add and test');
    clear(addHost).append(
      h('div', { class: 'grid2', style: 'align-items:start' },
        field('Provider', select(PROVIDERS.map(({ value, label }) => ({ value, label })), add.provider, (v) => { add.provider = v; add.model = PROVIDERS.find((p) => p.value === v).model || ''; paintAdd(); })),
        field('Model', mdl ? modelSelect(add.model, (v) => { add.model = v; }, mdl)
          : h('input', { type: 'text', value: add.model, placeholder: pv.model || 'model name from your provider', oninput: (e) => { add.model = e.target.value.trim(); } }),
          add.provider === 'nvidia' ? 'The top group can use tools, which the brain needs. You can change it per key later.' : add.provider === 'gemini' ? 'After adding, ↻ Models shows every Gemini model your key can use.' : add.provider === 'anthropic' ? 'Leave empty for Claude Sonnet.' : 'Required.')),
      add.provider === 'compatible' ? field('Base URL', h('input', { type: 'url', value: add.baseUrl, placeholder: 'https://openrouter.ai/api/v1', oninput: (e) => { add.baseUrl = e.target.value.trim(); } })) : null,
      field('Name (optional)', h('input', { type: 'text', maxLength: 40, value: add.label, placeholder: `e.g. ${provLabel(add.provider)} main`, oninput: (e) => { add.label = e.target.value; } })),
      field('API key(s)', keysBox, `${pv.keyHint} Keys are stored encrypted and never shown again, only their last 4 characters.`),
      h('div', { class: 'row' }, addBtn));
  };
  paintAiKeys(); paintAdd();
  const aiSection = h('div', null,
    keyList,
    h('div', { class: 'row wrap', style: 'margin:8px 0 4px' }, h('button', { type: 'button', class: 'btn sm', onclick: (e) => testAll(e.currentTarget) }, 'Test all keys')),
    h('p', { class: 'hint' }, 'The brain uses the key marked “In use”. If it fails or reaches its limit, it automatically tries your other keys in order.'),
    h('details', { class: 'addkey' }, h('summary', null, '＋ Add AI keys'), addHost));
  const daily = h('label', { class: 'checkline' }, h('input', { id: 'b-daily', type: 'checkbox', checked: st.daily, onchange: (e) => { st.daily = e.target.checked; } }), h('span', null, 'Review my system every morning (about 07:00 East Africa time) and give me tasks'));
  const result = h('div');
  const save = async () => { await saveSettings({ about: st.about, aiDaily: st.daily }); };
  const runBtn = h('button', { class: 'btn', onclick: async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = 'Thinking…';
    clear(result);
    try {
      await save();
      const r = await runBrain();
      result.append(h('div', { class: 'banner good' }, h('div', null, h('b', null, `Done: ${r.actions.length} action${r.actions.length === 1 ? '' : 's'}${r.usedKey ? ` (with ${r.usedKey})` : ''}. `), r.summary)));
    } catch (err) { result.append(h('div', { class: 'banner bad' }, err.message)); }
    btn.disabled = false; setText(btn, '▶ Run a review now');
  } }, '▶ Run a review now');

  // ---- outside agents ----
  const keysHost = h('div');
  const created = h('div');
  const paintKeys = async () => {
    let keys = [];
    try { keys = await listAgentKeys(); } catch (e) { clear(keysHost).append(h('div', { class: 'hint' }, e.message)); return; }
    clear(keysHost).append(keys.length
      ? h('div', { class: 'keylist' }, keys.map((k) => h('div', { class: 'keyrow' },
        h('div', { class: 'grow' }, h('b', null, k.name), h('small', null, ` ${k.prefix}… · ${k.lastUsedAt ? `last used ${k.lastUsedAt.slice(0, 16).replace('T', ' ')}` : 'never used'}`)),
        h('button', { class: 'btn sm danger', onclick: async () => {
          if (!(await confirmDialog({ title: `Disconnect ${k.name}?`, message: 'Its link stops working immediately.', confirm: 'Disconnect', danger: true }))) return;
          await deleteAgentKey(k.id); paintKeys();
        } }, 'Disconnect'))))
      : h('div', { class: 'hint' }, 'No agents connected yet.'));
  };
  let agentName = '';
  const nameInput = h('input', { id: 'b-agent', type: 'text', maxLength: 40, placeholder: 'e.g. Claude, ChatGPT, my assistant', oninput: (e) => { agentName = e.target.value; } });
  const createBtn = h('button', { class: 'btn primary', onclick: async () => {
    try {
      const r = await createAgentKey(agentName || 'AI agent');
      const url = `${location.origin}/api/mcp/${r.key}`;
      const box = h('input', { type: 'text', readOnly: true, value: url, class: 'grow mono', onfocus: (e) => e.target.select() });
      clear(created).append(
        h('div', { class: 'banner' }, h('div', { class: 'grow' },
          h('b', null, `Connection link for ${r.item.name}`), h('div', { class: 'hint' }, 'Shown only once. Anyone with this link can read and change your system, so keep it private.'),
          h('div', { class: 'row', style: 'margin-top:8px' }, box, copyButton(() => url)))),
        connectionHelp(url));
      nameInput.value = ''; agentName = '';
      paintKeys();
    } catch (e) { notify(e.message, 'error'); }
  } }, 'Create connection link');
  paintKeys();

  const body = h('div', null,
    h('p', { class: 'lead' }, 'The brain reads your whole system: health, money, views, pipes, channel scans and tasks. Then it acts like a cell inside it: it fixes numbers that look wrong, writes notes and gives you concrete tasks. Everything it does shows up in the Brain feed on the Focus tab.'),
    about,
    h('div', { class: 'sec' }, 'Built-in AI (uses your own key)'),
    aiSection, daily,
    h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', onclick: async () => { try { await save(); notify('Brain settings saved', 'good'); } catch (e) { notify(e.message, 'error'); } } }, 'Save'), runBtn),
    result,
    h('div', { class: 'sec' }, 'Connect an outside AI agent (free)'),
    h('p', { class: 'hint' }, 'Let Claude, ChatGPT or any agent that speaks MCP work on your system from its own app. Give each one its own link so you can disconnect it separately.'),
    keysHost,
    h('div', { class: 'row', style: 'margin-top:8px' }, h('div', { class: 'grow' }, nameInput), createBtn),
    created,
  );
  return openModal({ title: '🧠 AI brain', body, wide: true, actions: [{ label: 'Close', kind: 'primary' }] });
}
