import test from 'node:test';
import assert from 'node:assert/strict';
import { route, nearestSide } from '../public/js/surface.js';
import { sanitizeBoard } from '../shared/board.js';

const A = { x: 0, y: 0, w: 200, h: 100 }, B = { x: 500, y: 300, w: 200, h: 100 };

test('a pinned end starts exactly where it was dropped', () => {
  for (const path of ['curved', 'straight', 'elbow']) {
    const r = route({ ...A, side: 't', at: 0.25 }, { ...B, side: 'l', at: 0.8 }, path);
    assert.deepEqual([r.a.x, r.a.y], [50, 0], path);
    assert.deepEqual([r.b.x, r.b.y], [500, 380], path);
    assert.match(r.d, /^M50,0/);
  }
});

test('elbow paths with pinned sides are well formed', () => {
  const r = route({ ...A, side: 'b', at: 0.5 }, { ...B, side: 'l', at: 0.5 }, 'elbow');
  const nums = r.d.match(/-?\d+(\.\d+)?/g).map(Number);
  assert.ok(nums.length > 4);
  assert.ok(!/NaN/.test(r.d));
});

test('bending moves the middle of the line by the bend', () => {
  for (const path of ['curved', 'straight', 'elbow']) {
    const flat = route(A, B, path), bent = route(A, B, path, { bend: { x: 40, y: -30 } });
    const moved = Math.hypot(bent.mid.x - flat.mid.x, bent.mid.y - flat.mid.y);
    assert.ok(moved > 20, `${path} moved ${moved}`);
  }
  const flat = route(A, B, 'curved'), bent = route(A, B, 'curved', { bend: { x: 40, y: -30 } });
  assert.ok(Math.abs(bent.mid.x - flat.mid.x - 40) < 0.01 && Math.abs(bent.mid.y - flat.mid.y + 30) < 0.01);
});

test('nearestSide picks the closest edge and snaps to the middle', () => {
  assert.deepEqual(nearestSide(A, { x: 198, y: 20 }), { side: 'r', at: 0.2 });
  assert.deepEqual(nearestSide(A, { x: 104, y: 97 }), { side: 'b', at: 0.5 });
});

test('saving keeps pinned ends and bends, and drops junk', () => {
  const b = sanitizeBoard({ items: [{ id: 'a', type: 'card', x: 0, y: 0, w: 10, h: 10 }, { id: 'b', type: 'card', x: 50, y: 0, w: 10, h: 10 }], links: [
    { id: 'l1', from: { item: 'a', side: 'r', at: 0.3 }, to: { item: 'b', side: 'zz', at: 4 }, bend: { x: 12, y: -4 } },
    { id: 'l2', from: { item: 'a' }, to: { x: 5, y: 5 }, bend: { x: 0, y: 0 } },
  ] });
  assert.deepEqual(b.links[0].from, { item: 'a', side: 'r', at: 0.3 });
  assert.deepEqual(b.links[0].to, { item: 'b' });
  assert.deepEqual(b.links[0].bend, { x: 12, y: -4 });
  assert.equal(b.links[1].bend, undefined);
});
