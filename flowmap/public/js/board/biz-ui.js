// How business tools look on a board: tables with totals, stat tiles with filters, and invoices.
import { h, raw, fmtNum } from '../util.js';
import { cellValue, totals, statOf, invoiceTotals, invoiceDefaults, fmtMoney, isNumeric, isMoney, mainValueCol, STAT_PERIODS } from './biz.js';

const NS = 'http://www.w3.org/2000/svg';
const ed = (cls, text, field, placeholder) => h('div', { class: `ed ${cls}`, 'data-field': field, 'data-ph': placeholder || '' }, raw(text || ''));
const shortDate = (s) => { if (!s) return ''; const [y, m, d] = String(s).split('-').map(Number); if (!y || !m || !d) return String(s); return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: y === new Date().getFullYear() ? undefined : '2-digit' }); };
const longDate = (s) => { if (!s) return ''; const [y, m, d] = String(s).split('-').map(Number); return y && m && d ? new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : String(s); };
const big = (n, cur) => (Math.abs(n) >= 1e7 ? `${cur ? `${cur} ` : ''}${fmtNum(n)}` : fmtMoney(n, cur));
const TYPE_ICON = { text: '', number: '#', money: '¤', date: '◷', select: '▾', check: '✓', calc: 'ƒ' };

// rows in the order the table asks for
export function orderedRows(t) {
  const rows = [...(t.rows || [])];
  if (t.sort === 'new') { const dc = t.cols.find((c) => c.type === 'date'); if (dc) rows.sort((a, b) => String(cellValue(t, b, dc)).localeCompare(String(cellValue(t, a, dc)))); else rows.reverse(); }
  else if (t.sort === 'big') { const vc = mainValueCol(t.cols); if (vc) rows.sort((a, b) => (Number(cellValue(t, b, vc)) || 0) - (Number(cellValue(t, a, vc)) || 0)); }
  return rows;
}

export function tableView(it, ctx) {
  const t = { cols: [], rows: [], ...(it.data || {}) };
  const cur = t.currency ?? 'TZS';
  const sums = totals(t);
  const fmt = (col, v) => {
    if (col.type === 'money' || (col.type === 'calc' && col.money)) return v === '' || Number.isNaN(v) ? '' : fmtMoney(v, '');
    if (col.type === 'number' || col.type === 'calc') return v === '' ? '' : Number.isNaN(v) ? '?' : fmtNum(v, 2);
    if (col.type === 'date') return shortDate(v);
    return String(v ?? '');
  };
  const editable = !ctx.readonly;
  const rows = orderedRows(t);
  const head = h('tr', null, t.cols.map((c) => h('th', { class: `ty-${c.type}`, title: c.type === 'calc' ? `Formula: ${c.expr || ''}` : '' }, TYPE_ICON[c.type] ? h('i', null, TYPE_ICON[c.type]) : null, raw(c.name))), editable ? h('th', { class: 'tb-x' }) : null);
  const body = rows.map((r) => h('tr', { 'data-r': r.id }, t.cols.map((c) => {
    const v = cellValue(t, r, c);
    if (c.type === 'check') return h('td', { class: 'ty-check' }, h('button', { type: 'button', class: `check${v ? ' on' : ''}`, 'data-act': 'tb-check', 'data-r': r.id, 'data-c': c.id, 'aria-label': v ? 'Untick' : 'Tick' }, v ? '✓' : ''));
    return h('td', { class: `ty-${c.type}${editable && c.type !== 'calc' ? ' tap' : ''}`, 'data-act': editable && c.type !== 'calc' ? 'tb-cell' : null, 'data-r': r.id, 'data-c': c.id }, raw(fmt(c, v)));
  }), editable ? h('td', { class: 'tb-x' }, h('button', { type: 'button', class: 'tb-del', 'data-act': 'tb-del', 'data-r': r.id, title: 'Remove this row' }, '×')) : null));
  const hasSum = t.cols.some((c) => c.id in sums);
  const foot = hasSum && rows.length ? h('tr', null, t.cols.map((c, i) => h('td', { class: `ty-${c.type}` }, c.id in sums ? raw(c.type === 'check' ? `${sums[c.id]}/${rows.length}` : fmt(c, sums[c.id])) : i === 0 ? raw('Total') : null)), editable ? h('td', { class: 'tb-x' }) : null) : null;
  const moneyCol = mainValueCol(t.cols);
  return [
    h('div', { class: 'tb-top' }, ed('ttl', it.title, 'title', 'Table'), h('small', null, raw(`${rows.length} row${rows.length === 1 ? '' : 's'}${moneyCol && rows.length ? ` · ${cur ? `${cur} ` : ''}${fmtNum(sums[moneyCol.id])}` : ''}`))),
    h('div', { class: 'tb-wrap sf-scroll' }, h('table', { class: 'tb' }, h('thead', null, head), h('tbody', null, body), foot ? h('tfoot', null, foot) : null),
      rows.length ? null : h('p', { class: 'tb-empty' }, editable ? 'No rows yet. Tap ＋ Add row.' : 'No rows yet.')),
    editable ? h('div', { class: 'tb-bot' }, h('button', { type: 'button', class: 'btn sm primary', 'data-act': 'tb-add' }, '＋ Add row')) : null,
  ];
}

export const STAT_VIEWS = [['number', '# Number'], ['months', '▮ By month'], ['split', '☰ By category']];
export function statView(it, ctx) {
  const d = it.data || {};
  const src = ctx.source?.(it);
  if (!src || src.type !== 'table') {
    // nothing to count yet: pick a table right here
    const tables = ctx.candidates?.(['table']) || [];
    return [h('div', { class: 'pg-pick' }, h('b', null, 'Which table should this count?'),
      tables.length ? h('div', { class: 'pg-picks sf-scroll' }, tables.map((t) => h('button', { type: 'button', class: 'pg-choice', 'data-act': 'st-pick', 'data-id': t.id }, raw(`🧮 ${t.title || 'Table'}`))))
        : h('small', null, 'Add a 🧮 table first (sales, spending, debts). Then pick it here to see totals by month and year.'))];
  }
  const t = src.data || {};
  const cur = t.currency ?? 'TZS';
  const s = statOf(t, d);
  const fnName = { sum: 'Total', count: 'Count', avg: 'Average', max: 'Biggest', min: 'Smallest' }[s.fn];
  const colName = s.valCol && s.fn !== 'count' && s.valCol.name.toLowerCase() !== fnName.toLowerCase() ? ` ${s.valCol.name.toLowerCase()}` : '';
  const what = `${fnName}${colName}${d.filterCol && d.filterVal ? ` · ${d.filterVal}` : ''}`;
  const good = d.good === 'down' ? -1 : 1;
  const delta = s.delta == null ? null : h('span', { class: `st-delta ${s.delta * good > 0 ? 'up' : s.delta * good < 0 ? 'down' : ''}` }, raw(`${s.delta > 0 ? '▲' : s.delta < 0 ? '▼' : '='} ${Math.abs(Math.round(s.delta * 100))}%`), h('small', null, raw(` vs ${s.period === 'month' ? 'month before' : s.period === 'year' ? 'year before' : 'before'}`)));
  const kids = [
    h('div', { class: 'st-top' }, ed('ttl', it.title || src.title || 'Stat', 'title', 'Stat'), h('small', { class: 'pg-src' }, raw(what))),
    h('div', { class: 'st-nav' },
      s.period === 'all' ? null : h('button', { type: 'button', class: 'st-arrow', 'data-act': 'st-prev', title: 'Earlier' }, '‹'),
      h('b', null, raw(s.label)),
      s.period === 'all' ? null : h('button', { type: 'button', class: 'st-arrow', 'data-act': 'st-next', title: 'Later', disabled: (Number(d.offset) || 0) >= 0 }, '›'),
      h('span', { class: 'st-periods' }, s.dateCol ? STAT_PERIODS.map(([v, l]) => h('button', { type: 'button', class: `st-p${s.period === v ? ' on' : ''}`, 'data-act': 'st-period', 'data-v': v }, l)) : null)),
    h('div', { class: 'st-big' }, h('b', null, raw(s.money ? big(s.value, cur) : fmtNum(s.value, 2))), delta),
  ];
  const view = d.view || (s.dateCol ? 'months' : 'number');
  if (!(t.rows || []).length) { kids.push(h('p', { class: 'pg-empty' }, raw(`Add rows to ${src.title || 'the table'} and this fills in by itself.`))); return kids; }
  if (view === 'months' && s.months.length) {
    const top = Math.max(1, ...s.months.map((m) => m.v));
    kids.push(h('div', { class: 'st-bars' }, s.months.map((m, i) => h('div', { class: `st-col${i === s.months.length - 1 && s.period === 'month' ? ' cur' : ''}`, title: `${m.label}: ${s.money ? fmtMoney(m.v, cur) : fmtNum(m.v, 2)}` }, h('i', { style: { height: `${Math.max(2, (m.v / top) * 100)}%` } }), h('small', null, raw(m.label.slice(0, 1)))))));
  } else if (view === 'split' && s.split.length) {
    const top = Math.max(1, ...s.split.map((x) => x.v));
    kids.push(h('div', { class: 'st-split sf-scroll' }, s.split.slice(0, 8).map((x) => h('div', { class: 'st-row' }, h('span', null, raw(x.name)), h('div', { class: 'st-track' }, h('i', { style: { width: `${(x.v / top) * 100}%` } })), h('b', null, raw(s.money ? fmtNum(x.v) : fmtNum(x.v, 2)))))));
  }
  return kids;
}

// ---------- invoices ----------
const E = (f, kind, text, ph, cls = '') => h('span', { class: `inv-f ${cls}${text ? '' : ' empty'}`, 'data-act': 'inv-edit', 'data-f': f, 'data-kind': kind, 'data-ph': ph }, raw(text || ''));
export function invoiceBody(d0, { editable = true, print = false } = {}) {
  const d = { ...invoiceDefaults(), ...d0 };
  const tt = invoiceTotals(d);
  const cur = d.currency || '';
  const f = (path, kind, text, ph, cls) => (editable && !print ? E(path, kind, text, ph, cls) : h('span', { class: `inv-f ${cls || ''}` }, raw(text || '')));
  return h('div', { class: `inv${print ? ' inv-print' : ''}` },
    h('div', { class: 'inv-head' },
      h('div', { class: 'inv-from' }, f('from.name', 'text', d.from?.name, 'Your business name', 'inv-biz'), f('from.details', 'multi', d.from?.details, 'Address, phone, email, TIN', 'inv-pre')),
      h('div', { class: 'inv-meta' }, h('b', { class: 'inv-word' }, 'INVOICE'),
        h('div', null, h('small', null, 'No. '), f('no', 'text', d.no, 'INV-001')),
        h('div', null, h('small', null, 'Date '), f('date', 'date', longDate(d.date), 'Date')),
        h('div', null, h('small', null, 'Due '), f('due', 'date', longDate(d.due), 'Due date')))),
    h('div', { class: 'inv-to' }, h('small', null, 'BILL TO'), f('to.name', 'text', d.to?.name, 'Client name', 'inv-client'), f('to.details', 'multi', d.to?.details, 'Client address, phone', 'inv-pre')),
    h('table', { class: 'inv-lines' },
      h('thead', null, h('tr', null, h('th', null, 'Description'), h('th', null, 'Qty'), h('th', null, 'Price'), h('th', null, raw(`Amount${cur ? ` (${cur})` : ''}`)), editable && !print ? h('th', { class: 'tb-x' }) : null)),
      h('tbody', null, tt.lines.map((l, i) => h('tr', null,
        h('td', null, f(`lines.${i}.d`, 'text', l.d, 'Item or service')),
        h('td', { class: 'n' }, f(`lines.${i}.q`, 'number', fmtNum(Number(l.q) || 0, 2), '1')),
        h('td', { class: 'n' }, f(`lines.${i}.p`, 'number', fmtMoney(l.p), '0')),
        h('td', { class: 'n' }, raw(fmtMoney(l.amount))),
        editable && !print ? h('td', { class: 'tb-x' }, h('button', { type: 'button', class: 'tb-del', 'data-act': 'inv-del', 'data-i': i, title: 'Remove line' }, '×')) : null)))),
    editable && !print ? h('button', { type: 'button', class: 'inv-add', 'data-act': 'inv-add' }, '＋ Add a line') : null,
    h('div', { class: 'inv-sum' },
      h('div', null, h('span', null, 'Subtotal'), h('b', null, raw(fmtMoney(tt.sub, cur)))),
      tt.discount ? h('div', null, h('span', null, 'Discount'), h('b', null, raw(`− ${fmtMoney(tt.discount, cur)}`))) : null,
      tt.tax ? h('div', null, h('span', null, raw(`Tax (${d.taxPct}%)`)), h('b', null, raw(fmtMoney(tt.tax, cur)))) : null,
      h('div', { class: 'inv-total' }, h('span', null, 'Total'), h('b', null, raw(fmtMoney(tt.total, cur))))),
    h('div', { class: 'inv-notes' }, f('pay', 'multi', d.pay, 'How to pay: M-Pesa / bank account', 'inv-pre'), f('notes', 'multi', d.notes, 'A note for the client', 'inv-pre inv-note')),
    d.status === 'paid' ? h('div', { class: 'inv-stamp' }, 'PAID') : d.status === 'sent' ? h('div', { class: 'inv-stamp sent' }, 'SENT') : null);
}
export function invoiceView(it, ctx) {
  return [invoiceBody(it.data || {}, { editable: !ctx.readonly }),
    h('div', { class: 'inv-bar' }, h('button', { type: 'button', class: 'btn sm', 'data-act': 'inv-print', title: 'Print it, or choose “Save as PDF” to send it' }, '🖨 Print / PDF'))];
}
