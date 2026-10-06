// Small DOM + formatting helpers. Text always goes in as text nodes, never as HTML.
import { hasGlyph, glyphs, stripGlyphs } from './icons.js';
import { saveFile } from './native.js';

// what people typed: always shown exactly as written (no icon swapping)
export const raw = (s) => document.createTextNode(s == null ? '' : String(s));
// set an element's interface text, icons included
export function setText(el, s) { if (!el) return; const t = String(s ?? ''); el.replaceChildren(...(hasGlyph(t) ? glyphs(t) : [document.createTextNode(t)])); }

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; }
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'for') el.htmlFor = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if ((k === 'title' || k === 'aria-label' || k === 'placeholder') && typeof v === 'string') el.setAttribute(k, stripGlyphs(v));
    else if (k in el && typeof v !== 'object' && !k.includes('-')) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids) {
    if (Array.isArray(k)) append(el, k);
    else if (k === null || k === undefined || k === false) continue;
    else if (k instanceof Node) el.append(k);
    else if (typeof k === 'string' && hasGlyph(k)) el.append(...glyphs(k)); // interface emoji -> line icons
    else el.append(document.createTextNode(String(k)));
  }
}
// Empties an element; the returned append() skips null/false so optional parts never render as "null".
export const clear = (el) => {
  while (el.firstChild) el.removeChild(el.firstChild);
  return { append: (...parts) => { el.append(...parts.flat().filter((x) => x !== null && x !== undefined && x !== false)); return el; } };
};
export const $ = (sel, root = document) => root.querySelector(sel);

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;

export function fmtNum(n, digits = 1) {
  if (!Number.isFinite(n)) return '–';
  const a = Math.abs(n);
  const s = n < 0 ? '-' : '';
  if (a >= 1e9) return s + (a / 1e9).toFixed(digits).replace(/\.0+$/, '') + 'B';
  if (a >= 1e6) return s + (a / 1e6).toFixed(digits).replace(/\.0+$/, '') + 'M';
  if (a >= 1e4) return s + (a / 1e3).toFixed(digits).replace(/\.0+$/, '') + 'k';
  if (a >= 100) return s + Math.round(a).toLocaleString('en-US');
  if (a >= 10) return s + a.toFixed(1).replace(/\.0$/, '');
  if (a === 0) return '0';
  return s + a.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}
export const fmtTZS = (n) => `TZS ${fmtNum(n)}`;
export const fmtFull = (n) => Math.round(n).toLocaleString('en-US');
export const pct = (v) => `${Math.round(v * 100)}%`;

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtDay(s, withWeekday = true) {
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${withWeekday ? DAYS[dt.getUTCDay()] + ' ' : ''}${d} ${MONTHS[m - 1]}`;
}
export function relDay(s, today) {
  const diff = Math.round((Date.parse(s) - Date.parse(today)) / 86400000);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff === -1) return 'yesterday';
  return diff > 0 ? `in ${diff} days` : `${-diff} days ago`;
}

export const debounce = (fn, ms) => {
  let t, args = null;
  const run = () => { clearTimeout(t); if (!args) return; const a = args; args = null; fn(...a); };
  const d = (...a) => { args = a; clearTimeout(t); t = setTimeout(run, ms); };
  d.flush = run; // do the waiting call now (leaving the page, the phone app going to the background)
  return d;
};

export function download(filename, text, type = 'application/json') {
  return saveFile(filename, new Blob([text], { type }));
}

export const store_ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
