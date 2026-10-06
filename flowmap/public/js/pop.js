// Floating tactile panels (style pickers, quick menus) anchored to an element or a screen point.
import { h } from './util.js';

let current = null;
export function closePop() { if (current) { const c = current; current = null; c.el.classList.add('out'); setTimeout(() => c.el.remove(), 160); c.onClose?.(); } }
export const popOpen = () => !!current;

export function openPop({ anchor, x, y, title, body, onClose, className = '', width }) {
  closePop();
  const el = h('div', { class: `pop ${className}`, role: 'dialog', 'aria-label': title || 'Options' },
    title ? h('div', { class: 'pop-h' }, h('b', null, title), h('button', { class: 'pop-x', type: 'button', 'aria-label': 'Close', onclick: closePop }, '✕')) : null,
    h('div', { class: 'pop-b' }, body));
  if (width) el.style.width = `${width}px`;
  document.body.append(el);
  const r = { width: el.offsetWidth, height: el.offsetHeight }; // layout size: the pop-in animation scales the box
  let px = x, py = y;
  if (anchor) {
    const a = anchor.getBoundingClientRect();
    const side = anchor.closest('.bd-tools') && getComputedStyle(anchor.closest('.bd-tools')).flexDirection === 'column';
    if (side) { px = a.right + 12; py = a.top - 8; } // beside a vertical toolbar, never on top of it
    else { px = a.left; py = a.bottom + 8; if (py + r.height > innerHeight - 8) py = a.top - r.height - 8; }
  }
  el.style.left = `${Math.max(8, Math.min(innerWidth - r.width - 8, px ?? innerWidth / 2 - r.width / 2))}px`;
  el.style.top = `${Math.max(8, Math.min(innerHeight - r.height - 8, py ?? innerHeight / 2 - r.height / 2))}px`;
  current = { el, onClose };
  setTimeout(() => {
    const away = (e) => { if (!current || current.el !== el) return document.removeEventListener('pointerdown', away, true); if (!el.contains(e.target) && !e.target.closest?.('.pop-keep')) { document.removeEventListener('pointerdown', away, true); closePop(); } };
    document.addEventListener('pointerdown', away, true);
  });
  return el;
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && current) { e.stopPropagation(); closePop(); } }, true);

// ---------- small controls used inside panels ----------
export function segRow(label, options, value, onPick) {
  const wrap = h('div', { class: 'pr' }, h('span', { class: 'pl' }, label));
  const seg = h('div', { class: 'seg pseg' });
  const paint = (v) => [...seg.children].forEach((b) => b.classList.toggle('on', b.dataset.v === String(v)));
  for (const [v, text, tip] of options) seg.append(h('button', { type: 'button', 'data-v': String(v), title: tip || text, onclick: () => { paint(v); onPick(v); } }, text));
  paint(value);
  wrap.append(seg);
  return wrap;
}
export function swatchRow(label, colors, value, onPick, { allowCustom = true } = {}) {
  const wrap = h('div', { class: 'pr' }, h('span', { class: 'pl' }, label));
  const row = h('div', { class: 'sws' });
  const paint = (v) => [...row.querySelectorAll('.sw')].forEach((b) => b.classList.toggle('on', b.dataset.c === v));
  for (const c of colors) row.append(h('button', { type: 'button', class: 'sw', 'data-c': c, style: { '--c': c || 'var(--raise)' }, title: c || 'Default', 'aria-label': c ? `Colour ${c}` : 'Default colour', onclick: () => { paint(c); onPick(c); } }, c ? '' : '∅'));
  if (allowCustom) {
    const input = h('input', { type: 'color', class: 'sw-custom', value: /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#ff8a3d', 'aria-label': 'Custom colour', oninput: (e) => { paint(''); onPick(e.target.value); } });
    row.append(h('label', { class: 'sw sw-pick', title: 'Any colour' }, '＋', input));
  }
  paint(value || '');
  wrap.append(row);
  return wrap;
}
export function toggleRow(label, value, onPick) {
  const b = h('button', { type: 'button', class: 'tgl', 'aria-pressed': String(!!value), onclick: () => { const v = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(v)); onPick(v); } });
  return h('div', { class: 'pr' }, h('span', { class: 'pl' }, label), b);
}
export function rangeRow(label, value, min, max, step, onPick) {
  return h('div', { class: 'pr' }, h('span', { class: 'pl' }, label), h('input', { type: 'range', min, max, step, value, oninput: (e) => onPick(Number(e.target.value)) }));
}
