// Business tools inside a board: tables that add themselves up (sales, spending, debts, goals),
// stat tiles that filter a table by month, year or category, and invoices. Pure logic, no DOM.

export const COL_TYPES = ['text', 'number', 'money', 'date', 'select', 'check', 'calc'];
export const COL_LABEL = { text: 'Text', number: 'Number', money: 'Money', date: 'Date', select: 'Choice', check: 'Tick', calc: 'Formula' };
const rid = (p) => `${p}${Math.random().toString(36).slice(2, 8)}`;
export const newCol = (type, name, extra = {}) => ({ id: rid('c'), name, type, ...extra });
export const newRow = (c = {}) => ({ id: rid('r'), c });
const pad = (n) => String(n).padStart(2, '0');
export const dateKey = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

export const TABLE_TEMPLATES = {
  sales: () => ({ title: 'Sales', cols: [newCol('date', 'Date'), newCol('text', 'Customer'), newCol('text', 'Item'), newCol('number', 'Qty'), newCol('money', 'Price'), newCol('calc', 'Total', { expr: '[Qty] * [Price]', money: true }), newCol('check', 'Paid')] }),
  expenses: () => ({ title: 'Spending', cols: [newCol('date', 'Date'), newCol('select', 'Category', { options: ['Food', 'Transport', 'Rent', 'Data & phone', 'Business', 'Family', 'Other'] }), newCol('text', 'Note'), newCol('money', 'Amount')] }),
  debts: () => ({ title: 'Debts', cols: [newCol('text', 'Who'), newCol('money', 'Owed'), newCol('money', 'Paid'), newCol('calc', 'Left', { expr: '[Owed] - [Paid]', money: true }), newCol('date', 'Due'), newCol('check', 'Settled')] }),
  goals: () => ({ title: 'Goals', cols: [newCol('text', 'Goal'), newCol('number', 'Target'), newCol('number', 'Done'), newCol('calc', '%', { expr: '[Done] / [Target] * 100' }), newCol('date', 'By')] }),
  blank: () => ({ title: 'Table', cols: [newCol('text', 'Name'), newCol('number', 'Amount')] }),
};
export const TEMPLATE_LABEL = { sales: '💰 Sales', expenses: '🧾 Spending', debts: '🤝 Debts', goals: '🎯 Goals', blank: '▦ Blank' };

// ---------- formulas: numbers, [Column names], + - * / and brackets ----------
export function evalExpr(expr, lookup) {
  const src = String(expr || '');
  const toks = [];
  for (let i = 0; i < src.length;) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '[') { const j = src.indexOf(']', i); if (j < 0) return NaN; toks.push({ v: Number(lookup(src.slice(i + 1, j).trim())) || 0 }); i = j + 1; continue; }
    const m = /^\d+(\.\d+)?|^\.\d+/.exec(src.slice(i));
    if (m) { toks.push({ v: Number(m[0]) }); i += m[0].length; continue; }
    if ('+-*/()%'.includes(ch)) { toks.push({ op: ch }); i++; continue; }
    return NaN;
  }
  let k = 0;
  const peek = () => toks[k], take = () => toks[k++];
  function atom() {
    const t = take();
    if (!t) return NaN;
    if (t.op === '-') return -atom();
    if (t.op === '+') return atom();
    if (t.op === '(') { const v = sum(); if (take()?.op !== ')') return NaN; return pct(v); }
    if ('v' in t) return pct(t.v);
    return NaN;
  }
  function pct(v) { if (peek()?.op === '%') { take(); return v / 100; } return v; }
  function prod() { let v = atom(); while (peek() && (peek().op === '*' || peek().op === '/')) { const o = take().op, r = atom(); v = o === '*' ? v * r : r === 0 ? NaN : v / r; } return v; }
  function sum() { let v = prod(); while (peek() && (peek().op === '+' || peek().op === '-')) { const o = take().op, r = prod(); v = o === '+' ? v + r : v - r; } return v; }
  const v = sum();
  return k === toks.length ? v : NaN;
}

const numOf = (v) => { if (typeof v === 'number') return v; const n = Number(String(v ?? '').replace(/[, _]/g, '')); return Number.isFinite(n) ? n : 0; };
export const isNumeric = (col) => col && (col.type === 'number' || col.type === 'money' || col.type === 'calc');
export const isMoney = (col) => col && (col.type === 'money' || (col.type === 'calc' && col.money));
// the column a total is about: a money formula (Total, Left) first, else the last money column, else any number
export const mainValueCol = (cols = []) => cols.find((c) => c.type === 'calc' && c.money) || [...cols].reverse().find(isMoney) || cols.find(isNumeric);
// the value of one cell, working out formulas (a formula may use other formulas, not itself)
export function cellValue(t, row, col, depth = 0) {
  if (!col) return '';
  if (col.type === 'calc') {
    if (depth > 6) return NaN;
    const byName = (name) => { const c = t.cols.find((x) => x.name.toLowerCase() === name.toLowerCase()); return c && c !== col ? (c.type === 'check' ? (row.c?.[c.id] ? 1 : 0) : numOf(cellValue(t, row, c, depth + 1))) : 0; };
    const v = evalExpr(col.expr, byName);
    return Number.isFinite(v) ? Math.round(v * 100) / 100 : NaN;
  }
  const v = row.c?.[col.id];
  if (col.type === 'number' || col.type === 'money') return v === '' || v == null ? '' : numOf(v);
  if (col.type === 'check') return !!v;
  return v ?? '';
}
export function totals(t, rows = t.rows || []) {
  const out = {};
  for (const col of t.cols || []) {
    if (isNumeric(col)) out[col.id] = Math.round(rows.reduce((a, r) => { const v = cellValue(t, r, col); return a + (Number.isFinite(v) ? numOf(v) : 0); }, 0) * 100) / 100;
    else if (col.type === 'check') out[col.id] = rows.filter((r) => r.c?.[col.id]).length;
  }
  return out;
}

// ---------- stats: one number from a table, for a month, a year or all time, with an optional filter ----------
export const STAT_FNS = [['sum', 'Total'], ['count', 'How many'], ['avg', 'Average'], ['max', 'Biggest'], ['min', 'Smallest']];
export const STAT_PERIODS = [['month', 'Month'], ['year', 'Year'], ['30d', '30 days'], ['all', 'All time']];
const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export function periodRange(period, offset = 0, now = Date.now()) {
  const d = new Date(now);
  if (period === 'month') { const a = new Date(d.getFullYear(), d.getMonth() + offset, 1), b = new Date(d.getFullYear(), d.getMonth() + offset + 1, 1); return { from: dateKey(a), to: dateKey(b - 1), label: a.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) }; }
  if (period === 'year') { const y = d.getFullYear() + offset; return { from: `${y}-01-01`, to: `${y}-12-31`, label: String(y) }; }
  if (period === '30d') { const b = new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset * 30), a = new Date(b.getFullYear(), b.getMonth(), b.getDate() - 29); return { from: dateKey(a), to: dateKey(b), label: offset ? `${a.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${b.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : 'Last 30 days' }; }
  return { from: '', to: '', label: 'All time' };
}
function agg(fn, vals) {
  if (fn === 'count') return vals.length;
  const nums = vals.filter(Number.isFinite);
  if (!nums.length) return 0;
  if (fn === 'avg') return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
  if (fn === 'max') return Math.max(...nums);
  if (fn === 'min') return Math.min(...nums);
  return Math.round(nums.reduce((a, b) => a + b, 0) * 100) / 100;
}
export function statOf(t, cfg = {}, now = Date.now()) {
  const cols = t?.cols || [], rows = t?.rows || [];
  const valCol = cols.find((c) => c.id === cfg.col) || mainValueCol(cols);
  const dateCol = cols.find((c) => c.id === cfg.dateCol) || cols.find((c) => c.type === 'date');
  const catCol = cols.find((c) => c.id === cfg.byCol) || cols.find((c) => c.type === 'select');
  const fn = cfg.fn || 'sum', period = dateCol ? cfg.period || 'month' : 'all', offset = Number(cfg.offset) || 0;
  const pass = (r) => !cfg.filterCol || !cfg.filterVal || String(cellValue(t, r, cols.find((c) => c.id === cfg.filterCol)) ?? '') === String(cfg.filterVal);
  const inRange = (r, rg) => !rg.from || (() => { const v = String(cellValue(t, r, dateCol) || ''); return v >= rg.from && v <= rg.to; })();
  const valsFor = (rg) => rows.filter((r) => pass(r) && inRange(r, rg)).map((r) => (valCol ? numOf(cellValue(t, r, valCol)) : 1));
  const rg = periodRange(period, offset, now), prevRg = periodRange(period, offset - 1, now);
  const value = agg(fn, valsFor(rg)), prev = period === 'all' ? null : agg(fn, valsFor(prevRg));
  const delta = prev ? (value - prev) / Math.abs(prev) : null;
  // the last 12 months, for the little chart
  const months = [];
  if (dateCol) {
    const base = new Date(now);
    const endMonth = period === 'year' ? new Date(base.getFullYear() + offset, 11, 1) : new Date(base.getFullYear(), base.getMonth() + (period === 'month' ? offset : 0), 1);
    for (let i = 11; i >= 0; i--) {
      const a = new Date(endMonth.getFullYear(), endMonth.getMonth() - i, 1), b = new Date(a.getFullYear(), a.getMonth() + 1, 1);
      months.push({ key: monthKey(a), label: a.toLocaleDateString(undefined, { month: 'short' }), v: agg(fn, valsFor({ from: dateKey(a), to: dateKey(b - 1) })) });
    }
  }
  // split by a choice column (category), biggest first
  let split = [];
  if (catCol) {
    const groups = new Map();
    for (const r of rows) if (pass(r) && inRange(r, rg)) { const k = String(cellValue(t, r, catCol) || '—'); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(valCol ? numOf(cellValue(t, r, valCol)) : 1); }
    split = [...groups].map(([name, vals]) => ({ name, v: agg(fn, vals) })).sort((a, b) => b.v - a.v);
  }
  return { value, prev, delta, label: rg.label, period, fn, valCol, dateCol, catCol, months, split, money: isMoney(valCol) && fn !== 'count' };
}

// ---------- invoices ----------
export function invoiceTotals(d = {}) {
  const lines = (d.lines || []).map((l) => ({ ...l, amount: Math.round(numOf(l.q || 0) * numOf(l.p || 0) * 100) / 100 }));
  const sub = Math.round(lines.reduce((a, l) => a + l.amount, 0) * 100) / 100;
  const discount = Math.min(sub, numOf(d.discount || 0));
  const tax = Math.round((sub - discount) * (numOf(d.taxPct || 0) / 100) * 100) / 100;
  return { lines, sub, discount, tax, total: Math.round((sub - discount + tax) * 100) / 100 };
}
export function nextInvoiceNo(no) {
  const m = /^(.*?)(\d+)(\D*)$/.exec(String(no || 'INV-000'));
  if (!m) return `${no}-2`;
  return `${m[1]}${String(Number(m[2]) + 1).padStart(m[2].length, '0')}${m[3]}`;
}
export function invoiceDefaults(now = Date.now()) {
  const due = new Date(now); due.setDate(due.getDate() + 14);
  return { no: 'INV-001', date: dateKey(now), due: dateKey(due), currency: 'TZS', from: { name: '', details: '' }, to: { name: '', details: '' }, lines: [{ d: 'Service', q: 1, p: 0 }], taxPct: 0, discount: 0, notes: 'Thank you for your business.', pay: '', status: 'draft' };
}

export function fmtMoney(n, cur = '') {
  const v = Number(n) || 0;
  const s = Math.abs(v) >= 1000 || Number.isInteger(v) ? Math.round(v).toLocaleString('en-US') : v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return `${cur ? `${cur} ` : ''}${s}`;
}

export function toCSV(t) {
  const q = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [t.cols.map((c) => q(c.name)).join(',')];
  for (const r of t.rows || []) lines.push(t.cols.map((c) => { const v = cellValue(t, r, c); return q(typeof v === 'boolean' ? (v ? 'yes' : '') : v); }).join(','));
  return lines.join('\n');
}
