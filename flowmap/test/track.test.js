import test from 'node:test';
import assert from 'node:assert/strict';
import { habitState, periodKey, keyTime, tick, cycleCell, checklistState, markChecklist, boardStatus, progressOf } from '../public/js/board/track.js';

const at = (s) => new Date(s).getTime();
const NOW = at('2026-10-06T15:30:00');

test('period keys', () => {
  assert.equal(periodKey('day', NOW), '2026-10-06');
  assert.equal(periodKey('hour', NOW), '2026-10-06T15');
  assert.equal(periodKey('2h', NOW), '2026-10-06T14');
  assert.equal(periodKey('week', NOW), '2026-10-05'); // the Monday
  assert.equal(keyTime('2026-10-06T15'), at('2026-10-06T15:00:00'));
});

test('a daily habit: streak, today still open, yesterday missed warns', () => {
  const log = { '2026-10-01': 'done', '2026-10-02': 'done', '2026-10-03': 'part', '2026-10-04': 'done' };
  let st = habitState({ every: 'day', start: '2026-10-01', log }, NOW);
  assert.equal(st.status, 'late'); // the 5th was missed
  assert.equal(st.streak, 0);
  assert.equal(st.best, 4);
  assert.equal(st.missed, 1);
  st = habitState({ every: 'day', start: '2026-10-01', log: { ...log, '2026-10-05': 'done' } }, NOW);
  assert.equal(st.status, 'due');
  assert.equal(st.streak, 5);
  st = habitState(tick({ every: 'day', start: '2026-10-01', log: { ...log, '2026-10-05': 'done' } }, '2026-10-06'), NOW);
  assert.equal(st.status, 'ok');
  assert.equal(st.streak, 6);
});

test('a 30 day challenge counts days ahead and finishes', () => {
  const st = habitState({ every: 'day', start: '2026-10-05', length: 30, log: { '2026-10-05': 'done' } }, NOW);
  assert.equal(st.total, 30);
  assert.equal(st.periods.length, 30);
  assert.equal(st.periods.filter((p) => p.s === 'todo').length, 28);
  assert.equal(st.periods.find((p) => p.k === '2026-10-06').s, 'now');
  const log = {};
  for (let d = 1; d <= 3; d++) log[`2026-10-0${d}`] = 'done';
  const fin = habitState({ every: 'day', start: '2026-10-01', length: 3, log }, NOW);
  assert.equal(fin.status, 'finished');
  assert.equal(fin.score, 1);
});

test('restart when missed starts the run again after the miss', () => {
  const log = { '2026-10-01': 'done', '2026-10-02': 'done', '2026-10-04': 'done', '2026-10-05': 'done' };
  const st = habitState({ every: 'day', start: '2026-10-01', length: 10, onMiss: 'restart', log }, NOW);
  assert.equal(st.restarts, 1);
  assert.equal(st.done, 2);
  assert.equal(st.run[0].k, '2026-10-04');
  assert.equal(st.status, 'due');
  const fresh = habitState({ every: 'day', start: '2026-10-01', onMiss: 'restart', log: { '2026-10-01': 'done' } }, NOW);
  assert.equal(fresh.status, 'restarted');
});

test('rest days do not count as misses', () => {
  // 2026-10-03/04 are Saturday and Sunday
  const st = habitState({ every: 'day', start: '2026-10-01', days: [1, 2, 3, 4, 5], log: { '2026-10-01': 'done', '2026-10-02': 'done', '2026-10-05': 'done' } }, NOW);
  assert.equal(st.missed, 0);
  assert.equal(st.streak, 3);
  assert.equal(st.status, 'due');
});

test('calendar cells cycle done, partial, empty', () => {
  let d = { log: {} };
  d = cycleCell(d, 'k'); assert.equal(d.log.k, 'done');
  d = cycleCell(d, 'k'); assert.equal(d.log.k, 'part');
  d = cycleCell(d, 'k'); assert.equal(d.log.k, undefined);
});

test('a checklist that resets daily: old ticks do not count, missing a whole day warns', () => {
  const data = { every: 'day', since: at('2026-10-01T09:00'), items: [{ t: 'a', done: true, at: at('2026-10-06T08:00') }, { t: 'b', done: true, at: at('2026-10-05T08:00') }] };
  let st = checklistState(data, NOW);
  assert.deepEqual(st.on, [true, false]);
  assert.equal(st.status, 'late');
  const full = markChecklist({ ...data, items: data.items.map((x) => ({ ...x, at: at('2026-10-05T10:00') })) }, at('2026-10-05T11:00'));
  assert.deepEqual(full.full, ['2026-10-05']);
  st = checklistState({ ...full, items: data.items }, NOW);
  assert.equal(st.status, 'due');
});

test('a missed habit warns the items it feeds, following connections', () => {
  const board = {
    items: [{ id: 'h', type: 'habit', data: { every: 'day', start: '2026-10-04', log: {} } }, { id: 'p', type: 'card' }, { id: 'q', type: 'card' }, { id: 'z', type: 'card' }],
    links: [{ from: { item: 'h' }, to: { item: 'p' } }, { from: { item: 'p' }, to: { item: 'q' } }, { from: { item: 'z' }, to: { item: 'h' } }],
  };
  const s = boardStatus(board, NOW);
  assert.deepEqual(s.late, ['h']);
  assert.equal(s.hurt.get('p').depth, 1);
  assert.equal(s.hurt.get('q').depth, 2);
  assert.equal(s.hurt.has('z'), false);
});

test('progress from a habit, a checklist or a number', () => {
  const pr = progressOf({ type: 'habit', data: { every: 'day', start: '2026-10-05', length: 10, log: { '2026-10-05': 'done', '2026-10-06': 'part' } } }, {}, NOW);
  assert.equal(pr.frac, 0.15);
  assert.equal(progressOf(null, { value: 30, target: 120 }, NOW).frac, 0.25);
});
