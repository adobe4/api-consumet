// Shared UI building blocks: modals, toasts, pickers, sparkline.
import { h, clear } from './util.js';
import { RESOURCES } from '/shared/engine.js';

// ---------- toasts ----------
export function toast(message, kind = 'info') {
  const root = document.getElementById('toasts');
  const el = h('div', { class: `toast ${kind}`, role: 'status' }, message);
  root.append(el);
  setTimeout(() => el.remove(), kind === 'error' ? 6000 : 3600);
}

// ---------- modals ----------
const stack = [];
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && stack.length) { e.stopPropagation(); stack[stack.length - 1].close(); }
}, true);

export function openModal({ title, body, actions = [], wide = false, onClose }) {
  const root = document.getElementById('modal-root');
  const closeBtn = h('button', { class: 'btn ghost icon', 'aria-label': 'Close', onclick: () => api.close() }, '✕');
  const footer = actions.length ? h('footer', null, actions.map((a) => h('button', {
    class: `btn ${a.kind || ''}`,
    onclick: async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      try { if ((await a.onClick?.()) !== false) api.close(); } finally { b.disabled = false; }
    },
  }, a.label))) : null;
  const modal = h('div', { class: `modal${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('header', null, h('h3', null, title), closeBtn), h('div', { class: 'body' }, body), footer);
  const scrim = h('div', { class: 'scrim', onmousedown: (e) => { if (e.target === scrim) api.close(); } }, modal);
  root.append(scrim);
  const api = {
    el: modal,
    close() {
      const i = stack.indexOf(api);
      if (i < 0) return;
      stack.splice(i, 1);
      scrim.remove();
      onClose?.();
    },
  };
  stack.push(api);
  setTimeout(() => modal.querySelector('input:not([type=hidden]), select, textarea')?.focus(), 30);
  return api;
}
export const closeAllModals = () => { while (stack.length) stack[stack.length - 1].close(); };
export const hasModal = () => stack.length > 0;

export function confirmDialog({ title, message, confirm = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    openModal({
      title, body: h('p', { style: 'line-height:1.5;color:var(--muted);margin:4px 0 8px' }, message),
      actions: [{ label: 'Cancel', onClick: () => done(false) }, { label: confirm, kind: danger ? 'danger' : 'primary', onClick: () => { done(true); } }],
      onClose: () => done(false),
    });
  });
}

// ---------- form pieces ----------
export const field = (label, control, hint) => h('div', { class: 'field' }, h('label', null, label), control, hint ? h('div', { class: 'hint' }, hint) : null);

export function numInput(value, onInput, { min, max, step = 'any', placeholder = '' } = {}) {
  return h('input', {
    type: 'number', inputMode: 'decimal', value: value ?? '', min, max, step, placeholder,
    oninput: (e) => { const v = e.target.value; onInput(v === '' ? null : Number(v)); },
  });
}

export function chipGroup(options, value, onChange, { multi = false } = {}) {
  const el = h('div', { class: 'chips' });
  const sel = new Set(multi ? value : [value]);
  const paint = () => {
    clear(el);
    for (const o of options) {
      el.append(h('button', {
        type: 'button', class: `chip${sel.has(o.value) ? ' on' : ''}`,
        onclick: () => {
          if (multi) { sel.has(o.value) ? sel.delete(o.value) : sel.add(o.value); onChange([...sel]); }
          else { sel.clear(); sel.add(o.value); onChange(o.value); }
          paint();
        },
      }, o.color ? h('i', { class: 'dot', style: { background: o.color } }) : null, o.label));
    }
  };
  paint();
  return el;
}

export function feelPicker(value, onChange) {
  const faces = ['😞', '😕', '🙂', '😀', '🤩'];
  const el = h('div', { class: 'feel' });
  const paint = (v) => {
    clear(el);
    faces.forEach((f, i) => el.append(h('button', { type: 'button', class: v === i + 1 ? 'on' : '', title: `${i + 1}/5`, onclick: () => { onChange(i + 1); paint(i + 1); } }, f)));
  };
  paint(value);
  return el;
}

export function emojiPicker(list, value, onChange) {
  const el = h('div', { class: 'emoji-pick' });
  const paint = (v) => {
    clear(el);
    for (const e of list) el.append(h('button', { type: 'button', class: v === e ? 'on' : '', onclick: () => { onChange(e); paint(e); } }, e));
  };
  paint(value);
  return el;
}

export function resourcePicker(value, onChange) {
  const el = h('div', { class: 'res-pick' });
  const ICON = { money: '🪙', attention: '👁', customers: '👤', progress: '⚡' };
  const paint = (v) => {
    clear(el);
    for (const [k, R] of Object.entries(RESOURCES)) {
      el.append(h('button', { type: 'button', class: v === k ? 'on' : '', style: { color: R.color }, onclick: () => { onChange(k); paint(k); } },
        h('span', null, ICON[k]), h('span', { style: 'color:var(--text)' }, R.label)));
    }
  };
  paint(value);
  return el;
}

export function select(options, value, onChange) {
  return h('select', { onchange: (e) => onChange(e.target.value) },
    options.map((o) => h('option', { value: o.value, selected: String(o.value) === String(value) }, o.label)));
}

// ---------- sparkline (inline SVG) ----------
export function sparkline(values, color, { height = 44 } = {}) {
  const NS = 'http://www.w3.org/2000/svg';
  const w = 300;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'spark');
  const nums = values.map((v) => (typeof v === 'number' ? v : null));
  const real = nums.filter((v) => v !== null);
  if (real.length < 2) return null;
  const max = Math.max(...real), min = Math.min(...real, 0);
  const span = max - min || 1;
  const pts = nums.map((v, i) => (v === null ? null : [(i / (nums.length - 1)) * w, height - 4 - ((v - min) / span) * (height - 10)])).filter(Boolean);
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', 'M' + pts.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' L'));
  path.setAttribute('fill', 'none'); path.setAttribute('stroke', color); path.setAttribute('stroke-width', '2'); path.setAttribute('stroke-linejoin', 'round');
  const area = document.createElementNS(NS, 'path');
  area.setAttribute('d', `M${pts[0][0]},${height} L` + pts.map((p) => p.join(',')).join(' L') + ` L${pts[pts.length - 1][0]},${height} Z`);
  area.setAttribute('fill', color); area.setAttribute('opacity', '0.14');
  svg.append(area, path);
  return svg;
}
