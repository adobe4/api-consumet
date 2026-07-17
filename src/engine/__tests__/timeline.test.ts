import { describe, it, expect } from 'vitest';
import { buildTimeline } from '../timeline';
import { parseInstructions } from '../parseInstructions';
import type { Visual } from '../types';

function visuals(n: number, kind: 'image' | 'video' = 'image'): Visual[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `v${i + 1}`,
    path: `/imgs/${i + 1}.jpg`,
    kind,
  }));
}

describe('buildTimeline', () => {
  it('resolves "till"-style instructions into contiguous segments', () => {
    const instructions = parseInstructions(
      [
        'virtual one is from 00:00 to 00:56',
        'virtual two is till 01:03',
        'virtual 3 is till 01:40',
      ].join('\n'),
    );
    const tl = buildTimeline({
      visuals: visuals(3),
      instructions,
      audioDuration: 100,
      animation: 'none',
    });
    expect(tl.segments.map((s) => [s.start, s.end])).toEqual([
      [0, 56],
      [56, 63],
      [63, 100],
    ]);
    // No gaps, spans the whole audio.
    expect(tl.segments[0].start).toBe(0);
    expect(tl.segments.at(-1)!.end).toBe(100);
  });

  it('fills the last segment to the audio end even if unspecified', () => {
    const instructions = parseInstructions('visual 1: 0:00 - 0:10');
    const tl = buildTimeline({
      visuals: visuals(2),
      instructions,
      audioDuration: 30,
      animation: 'none',
    });
    expect(tl.segments[1].end).toBe(30);
  });

  it('distributes evenly when there are no instructions', () => {
    const tl = buildTimeline({
      visuals: visuals(4),
      instructions: [],
      audioDuration: 40,
      animation: 'none',
    });
    expect(tl.segments.map((s) => s.duration)).toEqual([10, 10, 10, 10]);
  });

  it('never produces overlapping or negative segments', () => {
    const instructions = parseInstructions('visual 1: 0:00 - 0:50\nvisual 2: 0:20 - 0:40');
    const tl = buildTimeline({
      visuals: visuals(2),
      instructions,
      audioDuration: 60,
      animation: 'none',
    });
    for (const s of tl.segments) expect(s.end).toBeGreaterThanOrEqual(s.start);
    for (let i = 1; i < tl.segments.length; i++) {
      expect(tl.segments[i].start).toBeGreaterThanOrEqual(tl.segments[i - 1].end - 1e-9);
    }
  });

  it('forces video visuals to have no zoompan animation', () => {
    const tl = buildTimeline({
      visuals: visuals(2, 'video'),
      instructions: [],
      audioDuration: 20,
      animation: 'zoom-in',
    });
    expect(tl.segments.every((s) => s.animation === 'none')).toBe(true);
  });

  it('is deterministic for random animation given a seed', () => {
    const a = buildTimeline({ visuals: visuals(5), instructions: [], audioDuration: 50, animation: 'random', seed: 7 });
    const b = buildTimeline({ visuals: visuals(5), instructions: [], audioDuration: 50, animation: 'random', seed: 7 });
    expect(a.segments.map((s) => s.animation)).toEqual(b.segments.map((s) => s.animation));
  });
});
