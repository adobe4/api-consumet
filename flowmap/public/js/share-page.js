// The public page behind a shared board link (/b/<token>). No account needed: the viewer may be asked for a
// password, and a limited link gives this browser one of its places, remembered so it never counts twice.
import { h, clear, store_ls } from './util.js';
import { on } from './store.js';
import { toast } from './ui-common.js';
import { createEditor } from './board/editor.js';

on('toast', ({ message, kind }) => toast(message, kind));

const token = (location.pathname.match(/^\/b\/([\w-]{6,80})/) || [])[1] || new URLSearchParams(location.search).get('t') || '';
const KEY = `flowmap.viewer.${token}`;
const gate = document.getElementById('gate');
const app = document.getElementById('app');
const boot = document.getElementById('boot');

async function call(method, url, body) {
  let res;
  try { res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); }
  catch { throw Object.assign(new Error('Cannot reach the server. Check your connection.'), { status: 0 }); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  return data;
}
const ready = () => { boot.classList.add('gone'); setTimeout(() => boot.remove(), 450); };

function card(...kids) {
  gate.hidden = false;
  clear(gate).append(h('div', { class: 'auth-card share-gate' },
    h('div', { class: 'brand' }, h('span', { class: 'sg-mark' }, '🧩'), 'FlowMap'), ...kids));
  ready();
}
function dead(title, text) {
  document.title = `${title} · FlowMap`;
  card(h('h2', null, title), h('p', { class: 'sub' }, text), h('a', { class: 'btn', href: '/' }, 'Go to FlowMap'));
}

function ask(meta, error = '') {
  document.title = `${meta.name} · FlowMap`;
  const pass = meta.needsPassword ? h('input', { id: 's-pass', type: 'password', autocomplete: 'current-password', placeholder: 'Password from the owner' }) : null;
  const label = h('input', { id: 's-name', type: 'text', autocomplete: 'name', maxlength: 60, placeholder: 'So the owner knows who you are', value: store_ls.get('flowmap.viewer-name', '') });
  const msg = h('p', { class: 'err', hidden: !error }, error);
  const go = h('button', { type: 'submit', class: 'btn primary' }, 'Open the board');
  const form = h('form', { class: 'sg-form', onsubmit: async (e) => {
    e.preventDefault();
    if (pass && !pass.value) { msg.hidden = false; msg.textContent = 'Type the password first'; pass.focus(); return; }
    go.disabled = true; go.textContent = 'Opening…';
    try {
      store_ls.set('flowmap.viewer-name', label.value.trim());
      await enter({ password: pass?.value, label: label.value.trim() });
    } catch (err) {
      go.disabled = false; go.textContent = 'Open the board';
      msg.hidden = false; msg.textContent = err.message;
      if (pass) { pass.value = ''; pass.focus(); }
    }
  } },
  pass ? h('div', { class: 'field' }, h('label', { for: 's-pass' }, '🔒 Password'), pass) : null,
  h('div', { class: 'field' }, h('label', { for: 's-name' }, 'Your name (optional)'), label),
  msg, go);
  card(
    h('div', { class: 'sg-board' }, h('span', { class: 'sg-ic' }, meta.icon || '🧩'), h('div', null, h('b', null, meta.name), h('small', null, [meta.needsPassword ? 'Protected by a password' : 'Shared board', meta.limited ? 'limited places' : ''].filter(Boolean).join(' · ')))),
    meta.limited ? h('p', { class: 'sub' }, 'This link opens on a limited number of devices. Opening it here keeps a place for this browser.') : null,
    form);
  (pass || label).focus();
}

async function enter({ password, label } = {}) {
  const r = await call('POST', `/api/share/${token}/open`, { viewer: store_ls.get(KEY, undefined), password, label });
  store_ls.set(KEY, r.viewer);
  show(r.board, r.viewer, r.opts || {});
}

function show(board, viewer, opts = {}) {
  document.title = `${board.name} · FlowMap`;
  gate.hidden = true;
  app.hidden = false;
  const host = document.getElementById('boards-host');
  const root = h('div', { class: 'boards' });
  host.append(root);
  const ed = createEditor(root, { board: { ...board, version: board.version || 0 }, share: { token, viewer, access: opts.access || 'tap' } });
  addEventListener('resize', () => ed.resize());
  // the owner chose to open it as a presentation
  if (opts.start === 'present') setTimeout(() => ed.present(), 600);
  ready();
}

async function start() {
  if (!token) return dead('This link is not complete', 'Check that you copied the whole link.');
  let meta;
  try { meta = await call('GET', `/api/share/${token}`); }
  catch (e) { return e.status === 410 ? dead('This link has expired', 'Ask the owner for a new link.') : e.status === 404 ? dead('This link is off', 'The owner stopped sharing this board, or made a new link. Ask them for the new one.') : dead('Something went wrong', e.message); }
  // a browser that already has its place walks straight in
  if (store_ls.get(KEY, null)) {
    try { return await enter(); } catch { store_ls.del(KEY); }
  }
  if (meta.full) return dead('Every place is taken', 'This link is limited to a few people, and they have all opened it. Ask the owner for access.');
  if (!meta.needsPassword && !meta.limited) {
    try { return await enter(); } catch (e) { return dead('Could not open the board', e.message); }
  }
  ask(meta);
}
start();
