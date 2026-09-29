// The 🧠 dialog: what the AI should know about you, the built-in daily AI, and links for outside AI agents.
import { h, clear } from './util.js';
import { S, notify, saveSettings, saveSecrets, runBrain, listAgentKeys, createAgentKey, deleteAgentKey } from './store.js';
import { openModal, field, select, confirmDialog } from './ui-common.js';

const PROVIDERS = [
  { value: 'anthropic', label: 'Anthropic (Claude)', model: 'claude-sonnet-5-5', keyHint: 'Starts with sk-ant-. Create one at console.anthropic.com.' },
  { value: 'openai', label: 'OpenAI (ChatGPT models)', model: '', keyHint: 'Create one at platform.openai.com.' },
  { value: 'compatible', label: 'Other: OpenRouter, Groq, Gemini, DeepSeek…', model: '', keyHint: 'Any provider with an OpenAI-compatible API. Enter its base URL below.' },
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
  const st = { about: s.about || '', provider: s.aiProvider || 'anthropic', model: s.aiModel || '', baseUrl: s.aiBaseUrl || '', daily: !!s.aiDaily, key: '' };
  const prov = () => PROVIDERS.find((p) => p.value === st.provider);

  // ---- about ----
  const about = field('About you and your goals',
    h('textarea', { id: 'b-about', rows: 4, maxLength: 4000, placeholder: 'e.g. I run Vinei TV (Swahili tutorials) and want 100k subscribers by June. My income goal is TZS 3M a month. I can film 3 videos a week and work evenings…', oninput: (e) => { st.about = e.target.value; } }, st.about),
    'Every AI that connects to FlowMap reads this first, so it can give you tasks that fit your life and goals.');

  // ---- built-in AI ----
  const provFields = h('div');
  const paintProv = () => {
    clear(provFields).append(...[
      h('div', { class: 'grid2' },
        field('AI provider', select(PROVIDERS.map(({ value, label }) => ({ value, label })), st.provider, (v) => { st.provider = v; paintProv(); })),
        field('Model', h('input', { id: 'b-model', type: 'text', value: st.model, placeholder: prov().model || 'model name, e.g. from your provider\'s docs', oninput: (e) => { st.model = e.target.value.trim(); } }), st.provider === 'anthropic' ? 'Leave empty to use Claude Sonnet.' : 'Required.')),
      st.provider === 'compatible' ? field('Base URL', h('input', { id: 'b-base', type: 'url', value: st.baseUrl, placeholder: 'https://openrouter.ai/api/v1', oninput: (e) => { st.baseUrl = e.target.value.trim(); } })) : null,
      field('API key', h('input', { id: 'b-key', type: 'password', autocomplete: 'off', placeholder: S.user.hasAiKey ? 'Saved. Type a new key to replace it' : 'Paste your key', oninput: (e) => { st.key = e.target.value.trim(); } }),
        `${prov().keyHint} Stored encrypted and never shown again. Each review costs a few cents on your account.`),
    ].filter(Boolean));
  };
  paintProv();
  const daily = h('label', { class: 'checkline' }, h('input', { id: 'b-daily', type: 'checkbox', checked: st.daily, onchange: (e) => { st.daily = e.target.checked; } }), h('span', null, 'Review my system every morning (about 07:00 East Africa time) and give me tasks'));
  const result = h('div');
  const save = async () => {
    await saveSettings({ about: st.about, aiProvider: st.provider, aiModel: st.model, aiBaseUrl: st.baseUrl, aiDaily: st.daily });
    if (st.key) { await saveSecrets({ aiKey: st.key }); st.key = ''; document.getElementById('b-key').value = ''; paintProv(); }
  };
  const runBtn = h('button', { class: 'btn', onclick: async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = 'Thinking…';
    clear(result);
    try {
      await save();
      const r = await runBrain();
      result.append(h('div', { class: 'banner good' }, h('div', null, h('b', null, `Done: ${r.actions.length} action${r.actions.length === 1 ? '' : 's'}. `), r.summary)));
    } catch (err) { result.append(h('div', { class: 'banner bad' }, err.message)); }
    btn.disabled = false; btn.textContent = '▶ Run a review now';
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
    provFields, daily,
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
