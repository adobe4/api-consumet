// Share a board as a link: public, or behind a password, and optionally limited to a number of people
// (one browser = one person). Good for selling a board as a course.
import { h, clear, setText } from '../util.js';
import { api } from '../api.js';
import { openModal } from '../ui-common.js';
import { notify } from '../store.js';
import { canShare, shareText } from '../native.js';

const when = (s) => { const d = new Date(s.replace(' ', 'T') + (s.endsWith('Z') ? '' : 'Z')); return Number.isNaN(d) ? s : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };

export async function openShareDialog(board) {
  let info;
  try { info = await api('GET', `/api/boards/${board.id}/share`); } catch (e) { notify(e.message, 'error'); return; }
  const body = h('div', { class: 'share' });
  const o = info.opts || {};
  const state = { mode: info.mode === 'off' ? 'public' : info.mode, seats: info.seats || 0, password: '', access: o.access || 'tap', start: o.start || 'board', expires: undefined };
  const ACCESS = [['look', '👀 Look only', 'Locked: they can look around, zoom, open links and watch it presented. Nothing they tap changes.'], ['tap', '👆 Look and tap', 'They can tick checklists and habits, flip cards and reveal covers on their own screen. Your board does not change.'], ['edit', '✏️ Can edit', 'They can change the board like you, and their changes are saved to it. Only give this to people you trust.']];
  const untilText = () => (o.expires ? `Stops working ${new Date(o.expires).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` : 'Never stops working');
  const url = () => `${location.origin}/b/${info.token}`;
  function paint() {
    const on = info.mode !== 'off';
    const seg = (opts, val, set) => h('div', { class: 'seg' }, opts.map(([v, label]) => h('button', { type: 'button', class: val === v ? 'on' : '', onclick: () => { set(v); paint(); } }, label)));
    const custom = h('input', { type: 'number', min: 1, max: 100000, value: state.seats > 0 && ![1, 2, 5, 10].includes(state.seats) ? state.seats : '', placeholder: 'Other number', class: 'seat-n', oninput: (e) => { state.seats = Math.max(0, Math.round(Number(e.target.value) || 0)); } });
    clear(body).append(
      h('div', { class: 'share-hero' }, h('span', { class: `share-dot${on ? ' on' : ''}` }), h('div', null, h('b', null, on ? 'This board has a live link' : 'This board is private'), h('small', null, on ? `${info.mode === 'password' ? 'People need the password.' : 'Anyone with the link can open it.'} ${({ look: 'Look only.', tap: 'They can look and tap.', edit: 'They can edit.' })[o.access || 'tap']} ${o.start === 'present' ? 'Opens as a presentation.' : ''} ${o.expires ? untilText() + '.' : ''}` : 'Only you can see it. Turn on a link to share it.'))),
      h('div', { class: 'sec' }, 'Who can open it'),
      seg([['public', '🌍 Anyone with the link'], ['password', '🔑 Only with a password']], state.mode, (v) => { state.mode = v; }),
      state.mode === 'password' ? h('input', { type: 'text', class: 'share-pass', placeholder: info.hasPassword ? 'Password is set. Type to change it' : 'Choose a password (4+ characters)', value: state.password, oninput: (e) => { state.password = e.target.value; } }) : null,
      h('div', { class: 'sec' }, 'What they can do'),
      seg(ACCESS.map(([v, l]) => [v, l]), state.access, (v) => { state.access = v; }),
      h('p', { class: 'hint' }, ACCESS.find((a) => a[0] === state.access)[2]),
      h('div', { class: 'sec' }, 'It opens as'),
      seg([['board', '🗺 The board'], ['present', '▶ A presentation']], state.start, (v) => { state.start = v; }),
      h('div', { class: 'sec' }, `The link stops working · ${state.expires === undefined ? untilText() : state.expires ? `in ${state.expires} day${state.expires === 1 ? '' : 's'} after saving` : 'never'}`),
      seg([[0, 'Never'], [1, 'In 1 day'], [7, 'In 7 days'], [30, 'In 30 days']], state.expires === undefined ? (o.expires ? -1 : 0) : state.expires, (v) => { state.expires = v; }),
      h('div', { class: 'sec' }, 'How many people'),
      h('div', { class: 'row wrap' }, seg([[0, 'Anyone'], [1, '1'], [2, '2'], [5, '5'], [10, '10']], state.seats, (v) => { state.seats = v; }), custom),
      h('p', { class: 'hint' }, 'Each person is counted by their browser the first time they open the link. When every place is taken, new people are turned away until you free a place below.'),
      h('div', { class: 'row', style: 'margin-top:12px' },
        h('button', { type: 'button', class: 'btn primary', onclick: save }, on ? 'Save changes' : '🔗 Create the link'),
        on ? h('button', { type: 'button', class: 'btn', onclick: () => set('off') }, 'Turn off the link') : null),
      on ? h('div', { class: 'share-link' }, h('input', { type: 'text', readonly: true, value: url(), onclick: (e) => e.target.select() }), h('button', { type: 'button', class: 'btn', onclick: (e) => { const btnEl = e.currentTarget; navigator.clipboard?.writeText(url()).then(() => { const b = btnEl; setText(b, '✓ Copied'); setTimeout(() => { setText(b, '⧉ Copy link'); }, 1500); }).catch(() => {}); } }, '⧉ Copy link'), canShare() ? h('button', { type: 'button', class: 'btn primary', onclick: () => shareText({ title: board.name, text: board.name, url: url() }) }, '📤 Send') : null) : null,
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
      info = await api('PUT', `/api/boards/${board.id}/share`, { mode: state.mode, seats: state.seats, access: state.access, start: state.start, ...(state.expires !== undefined ? { expiresInDays: state.expires } : {}), ...(state.password ? { password: state.password } : {}) });
      Object.assign(o, info.opts || {});
      state.password = ''; state.expires = undefined;
      paint();
      navigator.clipboard?.writeText(url()).catch(() => {});
      notify('Link ready and copied', 'good');
    } catch (e) { notify(e.message, 'error'); }
  }
  paint();
  openModal({ title: `🔗 Share “${board.name}”`, body, actions: [{ label: 'Done', kind: 'primary' }] });
}
