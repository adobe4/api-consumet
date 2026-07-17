import { describe, it, expect } from 'vitest';
import { buildFfmpegArgs } from '../ffmpegGraph';
import { buildTimeline } from '../timeline';
import type { Visual } from '../types';

function visuals(n: number, kind: 'image' | 'video' = 'image'): Visual[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `v${i + 1}`,
    path: `/imgs/${i + 1}.jpg`,
    kind,
  }));
}

function timeline(n: number, audio = 30) {
  return buildTimeline({ visuals: visuals(n), instructions: [], audioDuration: audio, animation: 'zoom-in' });
}

describe('buildFfmpegArgs', () => {
  it('emits one input per visual plus the audio input', () => {
    const { args } = buildFfmpegArgs({
      timeline: timeline(3),
      audioPath: '/a.mp3',
      outPath: '/out.mp4',
      transition: 'fade',
      transitionDuration: 0.5,
      quality: 'high',
    });
    const inputs = args.filter((a) => a === '-i').length;
    expect(inputs).toBe(4); // 3 visuals + 1 audio
    expect(args).toContain('/a.mp3');
    expect(args[args.length - 1]).toBe('/out.mp4');
  });

  it('builds an xfade chain with correct cumulative offsets', () => {
    // Even split of 30s across 3 visuals -> starts at 0,10,20.
    const { args } = buildFfmpegArgs({
      timeline: timeline(3, 30),
      audioPath: '/a.mp3',
      outPath: '/out.mp4',
      transition: 'fade',
      transitionDuration: 0.5,
      quality: 'high',
    });
    const fc = args[args.indexOf('-filter_complex') + 1];
    // First cut at segment 1 start (10s), second at segment 2 start (20s).
    expect(fc).toContain('offset=10.000');
    expect(fc).toContain('offset=20.000');
    expect(fc).toContain('xfade=transition=fade');
    expect(fc).toContain('[vout]');
  });

  it('clamps the crossfade to the shortest segment', () => {
    // Two visuals over 4s -> 2s each; asking for a 5s crossfade must clamp.
    const res = buildFfmpegArgs({
      timeline: timeline(2, 4),
      audioPath: '/a.mp3',
      outPath: '/out.mp4',
      transition: 'fade',
      transitionDuration: 5,
      quality: 'high',
    });
    expect(res.effectiveTransitionDuration).toBeLessThanOrEqual(2 * 0.9 + 1e-9);
    expect(res.effectiveTransitionDuration).toBeGreaterThan(0);
  });

  it('uses a concat filter (no xfade) for hard cuts', () => {
    const { args } = buildFfmpegArgs({
      timeline: timeline(3),
      audioPath: '/a.mp3',
      outPath: '/out.mp4',
      transition: 'cut',
      transitionDuration: 0.5,
      quality: 'high',
    });
    const fc = args[args.indexOf('-filter_complex') + 1];
    expect(fc).toContain('concat=n=3');
    expect(fc).not.toContain('xfade');
  });

  it('varies transition styles with random selection (seeded)', () => {
    const res = buildFfmpegArgs({
      timeline: timeline(6),
      audioPath: '/a.mp3',
      outPath: '/out.mp4',
      transition: 'random',
      transitionDuration: 0.4,
      quality: 'high',
      seed: 3,
    });
    expect(res.transitions).toHaveLength(5);
    expect(new Set(res.transitions).size).toBeGreaterThan(1);
  });

  it('produces a single-clip graph with no transitions', () => {
    const { args } = buildFfmpegArgs({
      timeline: timeline(1, 12),
      audioPath: '/a.mp3',
      outPath: '/out.mp4',
      transition: 'fade',
      transitionDuration: 0.5,
      quality: 'high',
    });
    const fc = args[args.indexOf('-filter_complex') + 1];
    expect(fc).not.toContain('xfade');
    expect(fc).toContain('[c0]');
    expect(args).toContain('[c0]'); // mapped as final video
  });

  it('selects the requested quality encoder', () => {
    const prores = buildFfmpegArgs({
      timeline: timeline(2), audioPath: '/a.mp3', outPath: '/o.mov',
      transition: 'fade', transitionDuration: 0.4, quality: 'prores',
    });
    expect(prores.args).toContain('prores_ks');
  });
});
