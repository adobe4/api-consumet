// Share a board as a link: public, or behind a password, and optionally limited to a number of people
// (one browser = one person). Good for selling a board as a course.
import { h, clear, setText } from '../util.js';
import { api } from '../api.js';
import { openModal } from '../ui-common.js';
import { notify } from '../store.js';

const when = (s) => { const d = new Date(s.replace(' ', 'T') + (s.endsWith('Z') ? '' : 'Z')); return Number.isNaN(d) ? s : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };

export async function openShareDialog(board) {
  let info;
  try { info = await api('GET', `/api/boards/${board.id}/share`); } catch (e) { notify(e.message, 'error'); return; }
  const body = h('div', { class: 'share' });
  const state = { mode: info.mode === 'off' ? 'public' : info.mode, seats: info.seats || 0, password: '' };
  const url = () => `${location.origin}/b/${info.token}`;
  function paint() {
    const on = info.mode !== 'off';
    const seg = (opts, val, set) => h('div', { class: 'seg' }, opts.map(([v, label]) => h('button', { type: 'button', class: val === v ? 'on' : '', onclick: () => { set(v); paint(); } }, label)));
    const custom = h('input', { type: 'number', min: 1, max: 100000, value: state.seats > 0 && ![1, 2, 5, 10].includes(state.seats) ? state.seats : '', placeholder: 'Other number', class: 'seat-n', oninput: (e) => { state.seats = Math.max(0, Math.round(Number(e.target.value) || 0)); } });
    clear(body).append(
      h('div', { class: 'share-hero' }, h('span', { class: `share-dot${on ? ' on' : ''}` }), h('div', null, h('b', null, on ? 'This board has a live link' : 'This board is private'), h('small', null, on ? (info.mode === 'password' ? 'People need the password to open it.' : 'Anyone with the link can open it.') : 'Only you can see it. Turn on a link to share it.'))),
      h('div', { class: 'sec' }, 'Who can open it'),
      seg([['public', '🌍 Anyone with the link'], ['password', '🔑 Only with a password']], state.mode, (v) => { state.mode = v; }),
      state.mode === 'password' ? h('input', { type: 'text', class: 'share-pass', placeholder: info.hasPassword ? 'Password is set. Type to change it' : 'Choose a password (4+ characters)', value: state.password, oninput: (e) => { state.password = e.target.value; } }) : null,
      h('div', { class: 'sec' }, 'How many people'),
      h('div', { class: 'row wrap' }, seg([[0, 'Anyone'], [1, '1'], [2, '2'], [5, '5'], [10, '10']], state.seats, (v) => { state.seats = v; }), custom),
      h('p', { class: 'hint' }, 'Each person is counted by their browser the first time they open the link. When every place is taken, new people are turned away until you free a place below.'),
      h('div', { class: 'row', style: 'margin-top:12px' },
        h('button', { type: 'button', class: 'btn primary', onclick: save }, on ? 'Save changes' : '🔗 Create the link'),
        on ? h('button', { type: 'button', class: 'btn', onclick: () => set('off') }, 'Turn off the link') : null),
      on ? h('div', { class: 'share-link' }, h('input', { type: 'text', readonly: true, value: url(), onclick: (e) => e.target.select() }), h('button', { type: 'button', class: 'btn', onclick: (e) => { const btnEl = e.currentTarget; navigator.clipboard?.writeText(url()).then(() => { const b = btnEl; setText(b, '✓ Copied'); setTimeout(() => { setText(b, '⧉ Copy link'); }, 1500); }).catch(() => {}); } }, '⧉ Copy link')) : null,
      on ? h('div', { class: 'sec' }, `People who opened it · ${info.viewers.length}${info.seats ? ` of ${info.seats}` : ''}`) : null,
      on ? (info.viewers.length ? h('div', { class: 'share-list' }, info.viewers.map((v, i) => h('div', { class: 'share-v' }, h('span', null, `👤 ${v.label || `Person ${i + 1}`}`), h('small', null, `first ${when(v.firstSeen)} · last ${when(v.lastSeen)}`), h('button', { type: 'button', class: 'btn sm ghost', title: 'Free this place: this person loses access', onclick: async () => { info = await api('DELETE', `/api/boards/${board.id}/share/viewers/${v.id}`); paint(); } }, 'Remove')))) : h('p', { class: 'hint' }, 'Nobody has opened it yet.')) : null,
      on ? h('button', { type: 'button', class: 'btn sm ghost danger', style: 'margin-top:10px', onclick: async () => { info = await api('POST', `/api/boards/${board.id}/share/reset`); notify('New link made. The old one no longer works.', 'good'); paint(); } }, '↻ Make a new link (the old one stops working)') : null,
    );
  }
  async function set(mode) {
    try { info = await api('PUT', `/api/boards/${board.id}/share`, { mode }); paint(); } catch (e) { notify(e.message, 'error'); }
  }
  async function save() {
    try {
      info = await api('PUT', `/api/boards/${board.id}/share`, { mode: state.mode, seats: state.seats, ...(state.password ? { password: state.password } : {}) });
      state.password = '';
      paint();
      navigator.clipboard?.writeText(url()).catch(() => {});
      notify('Link ready and copied', 'good');
    } catch (e) { notify(e.message, 'error'); }
  }
  paint();
  openModal({ title: `🔗 Share “${board.name}”`, body, actions: [{ label: 'Done', kind: 'primary' }] });
}
