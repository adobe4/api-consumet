import { describe, it, expect } from 'vitest';
import {
  BUILTIN_TRANSITION_PARAMS,
  directionVector,
  paramsToUniforms,
  resolveTransitionForCut,
} from '../transitionShader';
import { DEFAULT_TRANSITION_PARAMS } from '../../types';
import type { CustomTransition } from '../../types';

describe('directionVector', () => {
  it('maps directions to unit vectors', () => {
    expect(directionVector('left')).toEqual([-1, 0]);
    expect(directionVector('down')).toEqual([0, 1]);
  });
});

describe('paramsToUniforms', () => {
  it('converts twist degrees to radians and packs res', () => {
    const u = paramsToUniforms({ ...DEFAULT_TRANSITION_PARAMS, twist: 180 }, 0.5, 1080, 1920);
    expect(u.res).toEqual([1080, 1920]);
    expect(u.progress).toBe(0.5);
    expect(u.twist).toBeCloseTo(Math.PI, 5);
  });
});

describe('resolveTransitionForCut', () => {
  const customs: CustomTransition[] = [
    { id: 'custom-1', name: 'Whip', exportBase: 'slideleft', params: DEFAULT_TRANSITION_PARAMS },
  ];

  it('returns null for hard cut', () => {
    expect(resolveTransitionForCut('cut', 1, [])).toBeNull();
  });

  it('resolves built-ins', () => {
    const r = resolveTransitionForCut('wipeleft', 1, []);
    expect(r?.exportBase).toBe('wipeleft');
  });

  it('resolves custom transitions by id', () => {
    const r = resolveTransitionForCut('custom-1', 1, customs);
    expect(r?.exportBase).toBe('slideleft');
  });

  it('falls back to fade for unknown names', () => {
    const r = resolveTransitionForCut('does-not-exist', 1, []);
    expect(r?.exportBase).toBe('fade');
  });

  it('random is deterministic per cut given a seed', () => {
    const a = resolveTransitionForCut('random', 2, customs, 7);
    const b = resolveTransitionForCut('random', 2, customs, 7);
    expect(a?.exportBase).toBe(b?.exportBase);
  });

  it('every built-in maps to a valid export base', () => {
    for (const [, v] of Object.entries(BUILTIN_TRANSITION_PARAMS)) {
      expect(typeof v.exportBase).toBe('string');
      expect(v.exportBase.length).toBeGreaterThan(0);
    }
  });
});
