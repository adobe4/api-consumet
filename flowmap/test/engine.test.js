import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate, buildContext, alerts, suggestions, dayNum, addDays, statusOf } from '../shared/engine.js';
import { buildTemplate } from '../shared/templates.js';

const TODAY = '2026-09-29';
const world = () => buildTemplate('creator', TODAY);

test('date helpers round-trip', () => {
  assert.equal(addDays('2026-02-27', 3), '2026-03-02');
  assert.equal(dayNum('2026-09-30') - dayNum('2026-09-29'), 1);
});

test('template simulates without NaN', () => {
  const sim = simulate(world(), { today: TODAY, horizon: 90 });
  assert.equal(sim.days.length, 91);
  for (const d of sim.days) {
    for (const p of Object.values(d.projects)) {
      for (const [k, v] of Object.entries(p)) if (typeof v === 'number') assert.ok(Number.isFinite(v), `${k} is ${v}`);
    }
    for (const l of Object.values(d.links)) for (const v of Object.values(l)) assert.ok(Number.isFinite(v));
  }
});

test('neglected projects are dying, active ones are healthy', () => {
  const sim = simulate(world(), { today: TODAY, horizon: 0 });
  const p = sim.days[0].projects;
  assert.equal(statusOf(p.blonxin.health), 'dying', `blonxin ${p.blonxin.health}`);
  assert.ok(p.tiktok.health >= 75, `tiktok ${p.tiktok.health}`);
  assert.ok(p.vinei.health >= 75);
  assert.ok(p.blonxin.flow < p.tiktok.flow);
});

test('stopping all work makes the future worse than keeping pace', () => {
  const w = world();
  const keep = simulate(w, { today: TODAY, horizon: 60, scenario: 'keep' }).days[60].totals;
  const stop = simulate(w, { today: TODAY, horizon: 60, scenario: 'stop' }).days[60].totals;
  assert.ok(keep.money > stop.money, `keep ${keep.money} stop ${stop.money}`);
  assert.ok(keep.health > stop.health);
});

test('a well-aimed post boosts the targeted pipe and decays afterwards', () => {
  const w = world();
  const before = simulate(w, { today: TODAY, horizon: 0 }).days[0];
  w.tasks.push({ id: 'x', projectId: 'vinei', title: 'hit', type: 'video', status: 'done', doneOn: TODAY, quality: 5, channel: 'in_video', targets: ['mikeka'], sample: 0 });
  const sim = simulate(w, { today: TODAY, horizon: 20 });
  const link = w.links.find((l) => l.from === 'vinei' && l.to === 'mikeka' && l.resource === 'attention');
  const other = w.links.find((l) => l.from === 'vinei' && l.to === 'domo' && l.resource === 'attention');
  const a = sim.days[0].links[link.id];
  assert.ok(a.boost > 1.3, `boost ${a.boost}`);
  assert.ok(a.boost > before.links[link.id].boost);
  assert.ok(a.amount > before.links[link.id].amount);
  assert.ok(sim.days[0].links[other.id].boost < a.boost);
  assert.ok(sim.days[20].links[link.id].boost < a.boost);
});

test('logged actuals override config baselines', () => {
  const w = { projects: [{ id: 1, name: 'A', kind: 'youtube', cfg: { viewsPerDay: 1000, rpm: 500, cadenceDays: 3 }, createdOn: '2026-09-01' }], links: [], tasks: [], logs: [] };
  w.tasks.push({ id: 1, projectId: 1, title: 't', type: 'video', status: 'done', doneOn: TODAY, quality: 3, channel: 'in_video', targets: [] });
  const cfgMoney = simulate(w, { today: TODAY, horizon: 0 }).days[0].projects[1].money;
  w.logs.push({ projectId: 1, day: addDays(TODAY, -1), money: 50000, attention: null, customers: null, posts: 1 });
  const logged = simulate(w, { today: TODAY, horizon: 0 }).days[0].projects[1].money;
  assert.ok(logged > cfgMoney * 10);
});

test('alerts and suggestions surface the dying project first', () => {
  const w = world();
  const sim = simulate(w, { today: TODAY, horizon: 0 });
  const a = alerts(w, sim.ctx, sim.days[0]);
  assert.ok(a.some((x) => x.level === 'critical' && x.projectId === 'blonxin'));
  const s = suggestions(sim.ctx, sim.days[0], 3);
  assert.ok(s.length > 0);
  assert.ok(s.every((x) => x.score > 0));
});

test('links to unknown projects are ignored and empty worlds work', () => {
  const sim = simulate({ projects: [], links: [{ id: 1, from: 9, to: 8, resource: 'money', share: 1 }], tasks: [], logs: [] }, { today: TODAY, horizon: 5 });
  assert.equal(sim.days.length, 6);
  const c = buildContext({ projects: [], links: [], tasks: [], logs: [] }, { today: TODAY });
  assert.equal(c.links.length, 0);
});
