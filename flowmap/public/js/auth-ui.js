import { h, clear } from './util.js';
import { post, auth } from './api.js';
import { localToday } from '/shared/engine.js';

const MARK = () => {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 32 32'); svg.setAttribute('class', 'brand-mark');
  svg.innerHTML = '<rect width="32" height="32" rx="9" fill="#151517" stroke="#3a2f26"/><path d="M5 22c6-11 10 7 22-10" stroke="#ff8a3d" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="27" cy="12" r="3.2" fill="#ffc933"/><circle cx="5" cy="22" r="2.6" fill="#46e58a"/>';
  return svg;
};
export const brand = () => h('div', { class: 'brand' }, MARK(), h('span', null, 'FlowMap'));

export function showAuth(root, onDone) {
  root.hidden = false;
  let mode = 'login';
  let busy = false;
  const state = { name: '', email: '', password: '', template: 'creator' };
  const errBox = h('div');
  const form = h('form', { novalidate: true });
  const tabs = h('div', { class: 'auth-tabs' });
  const title = h('h2');
  const sub = h('p', { class: 'sub' });

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    clear(errBox);
    busy = true;
    btn.disabled = true;
    try {
      const body = mode === 'register'
        ? { name: state.name, email: state.email, password: state.password, template: state.template, today: localToday() }
        : { email: state.email, password: state.password };
      const r = await post(mode === 'register' ? '/api/auth/register' : '/api/auth/login', body);
      auth.token = r.token;
      root.hidden = true;
      await onDone(mode === 'register');
    } catch (err) {
      errBox.append(h('div', { class: 'err', role: 'alert' }, err.message));
    } finally { busy = false; btn.disabled = false; }
  };
  const btn = h('button', { class: 'btn primary', type: 'submit', style: 'width:100%;justify-content:center;padding:11px' });
  form.addEventListener('submit', submit);

  const paint = () => {
    clear(tabs).append(...['login', 'register'].map((m) => h('button', { type: 'button', class: mode === m ? 'on' : '', onclick: () => { mode = m; clear(errBox); paint(); } }, m === 'login' ? 'Sign in' : 'Create account')));
    title.textContent = mode === 'login' ? 'Welcome back' : 'Build your living map';
    sub.textContent = mode === 'login' ? 'Sign in to see how your success system is doing today.' : 'Track every project as a living system: money, attention and customers flowing between them.';
    btn.textContent = mode === 'login' ? 'Sign in' : 'Create my map';
    clear(form).append(
      mode === 'register' ? h('div', { class: 'field' }, h('label', { for: 'a-name' }, 'Your name'), h('input', { id: 'a-name', type: 'text', autocomplete: 'name', value: state.name, oninput: (e) => { state.name = e.target.value; } })) : null,
      h('div', { class: 'field' }, h('label', { for: 'a-email' }, 'Email'), h('input', { id: 'a-email', type: 'email', autocomplete: 'email', value: state.email, oninput: (e) => { state.email = e.target.value; } })),
      h('div', { class: 'field' }, h('label', { for: 'a-pass' }, mode === 'register' ? 'Password (8+ characters)' : 'Password'),
        h('input', { id: 'a-pass', type: 'password', autocomplete: mode === 'register' ? 'new-password' : 'current-password', value: state.password, oninput: (e) => { state.password = e.target.value; } })),
      mode === 'register' ? h('div', { class: 'field' }, h('label', null, 'Start with'), h('div', { class: 'tpl' },
        [['creator', 'Creator empire', 'Vinei TV, Blonxin, TikTok, AI Mikeka, Domosauti, DigitalSoko and WhatsApp IPTV, preloaded with sample activity.'], ['blank', 'Blank canvas', 'Start empty and build your own map.']]
          .map(([v, t, d]) => h('label', null, h('input', { type: 'radio', name: 'tpl', value: v, checked: state.template === v, onchange: () => { state.template = v; } }), h('div', null, h('b', null, t), h('span', null, d)))))) : null,
      errBox, btn,
    );
  };
  paint();
  root.append(h('div', { class: 'auth-card' }, brand(), title, sub, tabs, form));
}
