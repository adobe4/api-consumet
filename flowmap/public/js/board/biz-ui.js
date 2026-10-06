// How business tools look on a board: tables with totals, stat tiles with filters, and invoices.
import { h, raw, fmtNum } from '../util.js';
import { cellValue, totals, statOf, invoiceTotals, invoiceDefaults, fmtMoney, isNumeric, isMoney, mainValueCol, STAT_PERIODS } from './biz.js';

const NS = 'http://www.w3.org/2000/svg';
const ed = (cls, text, field, placeholder) => h('div', { class: `ed ${cls}`, 'data-field': field, 'data-ph': placeholder || '' }, raw(text || ''));
const shortDate = (s) => { if (!s) return ''; const [y, m, d] = String(s).split('-').map(Number); if (!y || !m || !d) return String(s); return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: y === new Date().getFullYear() ? undefined : '2-digit' }); };
const longDate = (s) => { if (!s) return ''; const [y, m, d] = String(s).split('-').map(Number); return y && m && d ? new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : String(s); };
const big = (n, cur) => (Math.abs(n) >= 1e7 ? `${cur ? `${cur} ` : ''}${fmtNum(n)}` : fmtMoney(n, cur));

// rows in the order the table asks for
export function orderedRows(t) {
  const rows = [...(t.rows || [])];
  // newest first unless you chose otherwise, so the latest sale is always on top
  const sort = t.sort || ((t.cols || []).some((c) => c.type === 'date') ? 'new' : 'added');
  if (sort === 'new') { const dc = t.cols.find((c) => c.type === 'date'); if (dc) rows.sort((a, b) => String(cellValue(t, b, dc)).localeCompare(String(cellValue(t, a, dc)))); else rows.reverse(); }
  else if (sort === 'big') { const vc = mainValueCol(t.cols); if (vc) rows.sort((a, b) => (Number(cellValue(t, b, vc)) || 0) - (Number(cellValue(t, a, vc)) || 0)); }
  return rows;
}

// what one row is called: "New sale", "3 expenses"
const NOUN = { sales: 'sale', expenses: 'expense', debts: 'debt', goals: 'goal', blank: 'row' };
const TITLE_NOUN = { sales: 'sale', spending: 'expense', expenses: 'expense', debts: 'debt', goals: 'goal' };
export const nounOf = (it) => NOUN[it.data?.kind] || TITLE_NOUN[String(it.title || '').trim().toLowerCase()] || 'row';
export const plural = (n, w) => `${fmtNum(n)} ${w}${n === 1 ? '' : 's'}`;
export function fmtCell(col, v) {
  if (col.type === 'money' || (col.type === 'calc' && col.money)) return v === '' || Number.isNaN(v) ? '' : fmtMoney(v, '');
  if (col.type === 'number' || col.type === 'calc') return v === '' ? '' : Number.isNaN(v) ? '?' : fmtNum(v, 2);
  if (col.type === 'date') return shortDate(v);
  return String(v ?? '');
}
// rows shown: all, this month or last month (by the table's date column)
export function shownRows(t, now = Date.now()) {
  const rows = orderedRows(t);
  const dc = (t.cols || []).find((c) => c.type === 'date');
  if (!dc || !t.show || t.show === 'all') return rows;
  const d = new Date(now), off = t.show === 'last' ? -1 : 0;
  const a = new Date(d.getFullYear(), d.getMonth() + off, 1), b = new Date(d.getFullYear(), d.getMonth() + off + 1, 0);
  const key = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  const from = key(a), to = key(b);
  return rows.filter((r) => { const v = String(cellValue(t, r, dc) || ''); return v >= from && v <= to; });
}

export function tableView(it, ctx) {
  const t = { cols: [], rows: [], ...(it.data || {}) };
  const cur = t.currency ?? 'TZS';
  const editable = !ctx.readonly;
  const noun = nounOf(it);
  const dc = t.cols.find((c) => c.type === 'date');
  const rows = shownRows(t);
  const sums = totals(t, rows);
  const main = mainValueCol(t.cols), check = t.cols.find((c) => c.type === 'check');
  // the numbers that matter, big, above the table
  const kpis = h('div', { class: 'tb-kpis' },
    main ? h('div', { class: 'tb-kpi big' }, h('b', null, raw(fmtMoney(sums[main.id] || 0, isMoney(main) ? cur : ''))), h('small', null, raw(main.name))) : null,
    h('div', { class: 'tb-kpi' }, h('b', null, raw(fmtNum(rows.length))), h('small', null, raw(`${noun}${rows.length === 1 ? '' : 's'}`))),
    check ? h('div', { class: 'tb-kpi' }, h('b', null, raw(`${sums[check.id] || 0}/${rows.length}`)), h('small', null, raw(check.name.toLowerCase()))) : null);
  const head = h('tr', null, t.cols.map((c) => h('th', { class: `ty-${c.type}`, title: c.type === 'calc' ? `Worked out: ${c.expr || ''}` : '' }, raw(c.name))));
  const body = rows.map((r) => h('tr', { 'data-act': editable ? 'tb-row' : null, 'data-r': r.id, title: editable ? `Tap to change this ${noun}` : '' }, t.cols.map((c) => {
    const v = cellValue(t, r, c);
    if (c.type === 'check') return h('td', { class: 'ty-check' }, h('button', { type: 'button', class: `check${v ? ' on' : ''}`, 'data-act': editable ? 'tb-check' : null, 'data-r': r.id, 'data-c': c.id, 'aria-label': v ? 'Untick' : 'Tick' }, v ? '✓' : ''));
    return h('td', { class: `ty-${c.type}` }, raw(fmtCell(c, v)));
  })));
  const hasSum = t.cols.some((c) => c.id in sums);
  const foot = hasSum && rows.length ? h('tr', null, t.cols.map((c, i) => h('td', { class: `ty-${c.type}` }, c.id in sums ? raw(c.type === 'check' ? `${sums[c.id]}/${rows.length}` : fmtCell(c, sums[c.id])) : i === 0 ? raw('Total') : null))) : null;
  const shows = [['all', 'All'], ['month', 'This month'], ['last', 'Last month']];
  return [
    h('div', { class: 'tb-top' }, ed('ttl', it.title, 'title', 'Table'),
      dc ? h('span', { class: 'st-periods' }, shows.map(([v, l]) => h('button', { type: 'button', class: `st-p${(t.show || 'all') === v ? ' on' : ''}`, 'data-act': 'tb-show', 'data-v': v }, l))) : null),
    kpis,
    rows.length ? h('div', { class: 'tb-wrap sf-scroll' }, h('table', { class: 'tb' }, h('thead', null, head), h('tbody', null, body), foot ? h('tfoot', null, foot) : null))
      : h('div', { class: 'tb-emptybox' }, h('b', null, raw((t.rows || []).length ? `No ${noun}s in this period` : `No ${noun}s yet`)), h('small', null, raw(editable ? `Tap “New ${noun}” to add the first one. Totals add up by themselves.` : 'Nothing here yet.'))),
    editable ? h('div', { class: 'tb-bot' }, h('button', { type: 'button', class: 'tb-addb', 'data-act': 'tb-add' }, raw(`＋ New ${noun}`))) : null,
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
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const isOverdue = (d) => d.status !== 'paid' && d.due && d.due < todayKey();
// the invoice as a sheet of paper; tapping a part of it (when you can edit) opens the form at that part
export function invoiceBody(d0, { editable = true, print = false, accent = '' } = {}) {
  const d = { ...invoiceDefaults(), ...d0 };
  const tt = invoiceTotals(d);
  const cur = d.currency || '';
  const tap = editable && !print;
  const f = (focus, cls, text, ph) => h('span', { class: `inv-f ${cls || ''}${text ? '' : ' empty'}`, 'data-act': tap ? 'inv-edit' : null, 'data-f': focus, 'data-ph': tap ? ph : '' }, raw(text || ''));
  const stamp = d.status === 'paid' ? ['paid', 'PAID'] : isOverdue(d) ? ['late', 'OVERDUE'] : d.status === 'sent' ? ['sent', 'SENT'] : null;
  return h('div', { class: `inv${print ? ' inv-print' : ''}`, style: accent ? { '--ia': accent } : null },
    h('div', { class: 'inv-head' },
      h('div', { class: 'inv-from' },
        d.logo ? h('img', { class: 'inv-logo', src: d.logo, alt: '' }) : null,
        f('from.name', 'inv-biz', d.from?.name, 'Your business name'), f('from.details', 'inv-pre', d.from?.details, 'Address, phone, email, TIN')),
      h('div', { class: 'inv-meta' }, h('b', { class: 'inv-word' }, 'INVOICE'),
        h('div', null, h('small', null, 'No. '), f('no', '', d.no, 'INV-001')),
        h('div', null, h('small', null, 'Date '), f('date', '', longDate(d.date), 'Date')),
        h('div', null, h('small', null, 'Due '), f('due', isOverdue(d) ? 'inv-late' : '', longDate(d.due), 'Due date')))),
    h('div', { class: 'inv-to' }, h('small', null, 'BILL TO'), f('to.name', 'inv-client', d.to?.name, 'Client name'), f('to.details', 'inv-pre', d.to?.details, 'Client address, phone')),
    h('table', { class: 'inv-lines' },
      h('thead', null, h('tr', null, h('th', null, 'Description'), h('th', null, 'Qty'), h('th', null, 'Price'), h('th', null, raw(`Amount${cur ? ` (${cur})` : ''}`)))),
      h('tbody', { 'data-act': tap ? 'inv-edit' : null, 'data-f': 'lines' }, tt.lines.length ? tt.lines.map((l) => h('tr', null,
        h('td', null, raw(l.d || '—')), h('td', { class: 'n' }, raw(fmtNum(Number(l.q) || 0, 2))), h('td', { class: 'n' }, raw(fmtMoney(l.p))), h('td', { class: 'n' }, raw(fmtMoney(l.amount)))))
        : h('tr', null, h('td', { colspan: 4, class: 'inv-noline' }, tap ? 'Tap to add what you are charging for' : '')))),
    h('div', { class: 'inv-sum' },
      h('div', null, h('span', null, 'Subtotal'), h('b', null, raw(fmtMoney(tt.sub, cur)))),
      tt.discount ? h('div', null, h('span', null, 'Discount'), h('b', null, raw(`− ${fmtMoney(tt.discount, cur)}`))) : null,
      tt.tax ? h('div', null, h('span', null, raw(`Tax (${d.taxPct}%)`)), h('b', null, raw(fmtMoney(tt.tax, cur)))) : null,
      h('div', { class: 'inv-total' }, h('span', null, 'Total'), h('b', null, raw(fmtMoney(tt.total, cur))))),
    h('div', { class: 'inv-notes' }, f('pay', 'inv-pre', d.pay, 'How to pay: M-Pesa / bank account'), f('notes', 'inv-pre inv-note', d.notes, 'A note for the client')),
    stamp ? h('div', { class: `inv-stamp s-${stamp[0]}` }, stamp[1]) : null);
}
export function invoiceView(it, ctx) {
  const d = { ...invoiceDefaults(), ...it.data };
  const paid = d.status === 'paid';
  const can = !ctx.readonly;
  return [invoiceBody(d, { editable: can, accent: it.color || '' }),
    h('div', { class: 'inv-bar' },
      can ? h('button', { type: 'button', class: 'ib', 'data-act': 'inv-edit', 'data-f': 'from.name', title: 'Change anything on this invoice' }, raw('✏️ Edit')) : null,
      can ? h('button', { type: 'button', class: `ib${paid ? ' on' : ''}`, 'data-act': 'inv-paid', title: paid ? 'Mark it as not paid' : 'Mark it as paid' }, raw(paid ? '✓ Paid' : 'Mark paid')) : null,
      h('button', { type: 'button', class: 'ib', 'data-act': 'inv-copy', title: 'Copy it as text for WhatsApp or SMS' }, raw('📋 Copy')),
      h('button', { type: 'button', class: 'ib main', 'data-act': 'inv-print', title: 'Print it, or choose “Save as PDF” to send it' }, raw('🖨 PDF')))];
}
// the invoice as a message, for WhatsApp or SMS
export function invoiceText(d0) {
  const d = { ...invoiceDefaults(), ...d0 };
  const tt = invoiceTotals(d), cur = d.currency ? `${d.currency} ` : '';
  const out = [`*INVOICE ${d.no}*${d.from?.name ? ` · ${d.from.name}` : ''}`];
  if (d.to?.name) out.push(`Bill to: ${d.to.name}`);
  out.push(`Date: ${longDate(d.date)}${d.due ? ` · Due: ${longDate(d.due)}` : ''}`, '');
  for (const l of tt.lines) out.push(`• ${l.d || 'Item'}: ${fmtNum(Number(l.q) || 0, 2)} × ${fmtMoney(l.p)} = ${fmtMoney(l.amount)}`);
  out.push('', `Subtotal: ${cur}${fmtMoney(tt.sub)}`);
  if (tt.discount) out.push(`Discount: −${cur}${fmtMoney(tt.discount)}`);
  if (tt.tax) out.push(`Tax (${d.taxPct}%): ${cur}${fmtMoney(tt.tax)}`);
  out.push(`*Total: ${cur}${fmtMoney(tt.total)}*`);
  if (d.status === 'paid') out.push('Status: PAID ✓');
  if (d.pay) out.push('', `Pay: ${d.pay}`);
  if (d.notes) out.push('', d.notes);
  return out.join('\n');
}
