import test from 'node:test';
import assert from 'node:assert/strict';
import { evalExpr, cellValue, totals, statOf, invoiceTotals, nextInvoiceNo, TABLE_TEMPLATES, newRow, toCSV } from '../public/js/board/biz.js';

test('formulas: arithmetic, brackets, percent, columns', () => {
  const L = (n) => ({ Qty: 3, Price: 2500 })[n] ?? 0;
  assert.equal(evalExpr('[Qty] * [Price]', L), 7500);
  assert.equal(evalExpr('(1 + 2) * 4 - 6 / 3', L), 10);
  assert.equal(evalExpr('-2 + 5', L), 3);
  assert.equal(evalExpr('200 * 18%', L), 36);
  assert.ok(Number.isNaN(evalExpr('2 +', L)));
  assert.ok(Number.isNaN(evalExpr('alert(1)', L)));
  assert.ok(Number.isNaN(evalExpr('1/0', L)));
});

const NOW = new Date('2026-10-06T12:00:00').getTime();
function sales() {
  const t = { ...TABLE_TEMPLATES.sales(), rows: [] };
  const [date, cust, item, qty, price, , paid] = t.cols;
  const add = (d, q, p, ok) => t.rows.push(newRow({ [date.id]: d, [cust.id]: 'A', [item.id]: 'Box', [qty.id]: q, [price.id]: p, [paid.id]: ok }));
  add('2026-10-02', 2, 15000, true); add('2026-10-05', 1, 15000, false); add('2026-09-20', 4, 15000, true); add('2025-12-01', 1, 9000, true);
  return t;
}

test('tables add themselves up, formulas included', () => {
  const t = sales();
  const total = t.cols[5];
  assert.equal(cellValue(t, t.rows[0], total), 30000);
  const sum = totals(t);
  assert.equal(sum[total.id], 30000 + 15000 + 60000 + 9000);
  assert.equal(sum[t.cols[6].id], 3);
  assert.match(toCSV(t).split('\n')[0], /^Date,Customer,Item,Qty,Price,Total,Paid$/);
});

test('stats filter by month, year and a column, and compare with before', () => {
  const t = sales();
  const total = t.cols[5];
  let s = statOf(t, { col: total.id, period: 'month' }, NOW);
  assert.equal(s.value, 45000);
  assert.equal(s.prev, 60000);
  assert.equal(Math.round(s.delta * 100), -25);
  assert.equal(s.months.length, 12);
  assert.equal(s.months[11].v, 45000);
  s = statOf(t, { col: total.id, period: 'year' }, NOW);
  assert.equal(s.value, 105000);
  s = statOf(t, { col: total.id, period: 'month', offset: -1 }, NOW);
  assert.equal(s.value, 60000);
  s = statOf(t, { col: total.id, period: 'all', filterCol: t.cols[6].id, filterVal: 'true' }, NOW);
  assert.equal(s.value, 30000 + 60000 + 9000);
  s = statOf(t, { fn: 'count', period: 'all' }, NOW);
  assert.equal(s.value, 4);
});

test('spending splits by category', () => {
  const t = { ...TABLE_TEMPLATES.expenses(), rows: [] };
  const [d, cat, , amt] = t.cols;
  t.rows.push(newRow({ [d.id]: '2026-10-01', [cat.id]: 'Food', [amt.id]: 5000 }), newRow({ [d.id]: '2026-10-03', [cat.id]: 'Rent', [amt.id]: 150000 }), newRow({ [d.id]: '2026-10-04', [cat.id]: 'Food', [amt.id]: 7000 }));
  const s = statOf(t, {}, NOW);
  assert.equal(s.value, 162000);
  assert.deepEqual(s.split.map((x) => [x.name, x.v]), [['Rent', 150000], ['Food', 12000]]);
});

test('invoice totals and numbering', () => {
  const tt = invoiceTotals({ lines: [{ q: 2, p: 15000 }, { q: 1, p: 5000 }], discount: 5000, taxPct: 18 });
  assert.deepEqual([tt.sub, tt.discount, tt.tax, tt.total], [35000, 5000, 5400, 35400]);
  assert.equal(nextInvoiceNo('INV-009'), 'INV-010');
  assert.equal(nextInvoiceNo('2026/14'), '2026/15');
});
