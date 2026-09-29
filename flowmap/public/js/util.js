// Small DOM + formatting helpers. Text always goes in as text nodes, never as HTML.

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'for') el.htmlFor = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
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
    else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
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
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

export function download(filename, text, type = 'application/json') {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: filename });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

export const store_ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
