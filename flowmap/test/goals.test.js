import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { goalProgress, groupOf } from '../shared/goals.js';
import { buildTemplate } from '../shared/templates.js';

const today = '2026-09-29';

test('goal progress from scans, logs and pace', () => {
  const p = { id: 1, kind: 'youtube', cfg: { goal: { metric: 'subscribers', target: 100000, by: '2026-12-28' } } };
  const scans = [{ projectId: 1, ok: true, data: { subscribers: 40000 } }];
  const g = goalProgress(p, { scans, today });
  assert.equal(g.current, 40000);
  assert.equal(g.frac, 0.4);
  assert.equal(g.daysLeft, 90);
  assert.equal(g.perDayNeeded, 60000 / 90);
  assert.equal(goalProgress({ id: 1, kind: 'youtube', cfg: {} }, { today }), null);

  // money per month: from 30 days of logs when there are enough, else estimated from the simulation
  const logs = Array.from({ length: 10 }, (_, i) => ({ projectId: 2, day: `2026-09-${String(20 + i).padStart(2, '0')}`, money: 10000 }));
  const m = goalProgress({ id: 2, kind: 'app', cfg: { goal: { metric: 'money_month', target: 600000 } } }, { logs, today });
  assert.equal(m.current, 300000);
  assert.equal(m.estimated, false);
  const est = goalProgress({ id: 3, kind: 'app', cfg: { goal: { metric: 'money_month', target: 600000 } } }, { logs: [], today, day: { money: 5000 } });
  assert.equal(est.current, 150000);
  assert.equal(est.estimated, true);
});

test('areas default by kind and can be renamed', () => {
  assert.equal(groupOf({ kind: 'tiktok', cfg: {} }), 'Channels');
  assert.equal(groupOf({ kind: 'service', cfg: { group: ' IPTV business ' } }), 'IPTV business');
});

test('tidy layout reduces pipe crossings and keeps tanks apart', async () => {
  // layout.js is a browser module; load it with its /shared import pointed at this checkout
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowmap-layout-'));
  const src = fs.readFileSync(new URL('../public/js/layout.js', import.meta.url), 'utf8').replace("'/shared/goals.js'", `'${new URL('../shared/goals.js', import.meta.url).href}'`);
  fs.writeFileSync(path.join(dir, 'layout.mjs'), src);
  const { tidyLayout, crossings } = await import(path.join(dir, 'layout.mjs'));
  const w = buildTemplate('creator', today);
  const out = tidyLayout(w.projects, w.links);
  const edges = [...new Set(w.links.map((l) => [l.from, l.to].sort().join('|')))].map((k) => k.split('|'));
  const before = crossings(new Map(w.projects.map((p) => [p.id, p])), edges);
  const after = crossings(new Map(out.map((q) => [q.id, q])), edges);
  assert.ok(after < before, `${after} < ${before}`);
  for (const a of out) for (const b of out) if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > 250);
  fs.rmSync(dir, { recursive: true, force: true });
});
