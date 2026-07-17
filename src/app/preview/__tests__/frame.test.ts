import { describe, it, expect } from 'vitest';
import { frameAt, segmentProgress, zoomTransform } from '../frame';
import { buildTimeline } from '../../../engine';
import type { Visual } from '../../../engine/types';

function tl() {
  const visuals: Visual[] = [1, 2, 3].map((i) => ({ id: `v${i}`, path: `${i}.jpg`, kind: 'image' }));
  return buildTimeline({ visuals, instructions: [], audioDuration: 30, animation: 'none' }); // 0-10,10-20,20-30
}

describe('frameAt', () => {
  it('returns the active segment when not transitioning', () => {
    const f = frameAt(tl(), 5, 0.5);
    expect(f).toEqual({ index: 0 });
  });

  it('flags a transition in the first T seconds of a segment', () => {
    const f = frameAt(tl(), 10.2, 0.5);
    expect(f?.index).toBe(1);
    expect(f?.fromIndex).toBe(0);
    expect(f?.transitionProgress).toBeCloseTo(0.4, 5);
  });

  it('does not transition into the first segment', () => {
    const f = frameAt(tl(), 0.1, 0.5);
    expect(f?.fromIndex).toBeUndefined();
  });

  it('clamps at the end of the timeline', () => {
    const f = frameAt(tl(), 999, 0.5);
    expect(f?.index).toBe(2);
  });

  it('has no transition when duration is 0 (hard cut)', () => {
    const f = frameAt(tl(), 10.1, 0);
    expect(f?.fromIndex).toBeUndefined();
  });
});

describe('zoomTransform', () => {
  it('zoom-in grows scale over progress', () => {
    expect(zoomTransform('zoom-in', 0).scale).toBeCloseTo(1, 5);
    expect(zoomTransform('zoom-in', 1).scale).toBeCloseTo(1.18, 5);
  });
  it('none is identity', () => {
    expect(zoomTransform('none', 0.5)).toEqual({ scale: 1, tx: 0, ty: 0 });
  });
  it('keeps pan translation within the zoom slack', () => {
    const t = zoomTransform('pan-right', 0.5);
    const slack = (t.scale - 1) / 2;
    expect(Math.abs(t.tx)).toBeLessThanOrEqual(slack + 1e-9);
  });
});

describe('segmentProgress', () => {
  it('clamps to 0..1', () => {
    expect(segmentProgress(10, 10, 5)).toBe(0);
    expect(segmentProgress(10, 10, 15)).toBe(0.5);
    expect(segmentProgress(10, 10, 999)).toBe(1);
  });
});
