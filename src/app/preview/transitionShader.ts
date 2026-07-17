import type { CustomTransition, TransitionParams } from '../types';
import { DEFAULT_TRANSITION_PARAMS } from '../types';
import { makeRng } from '../../engine';

/**
 * A single parameterised SkSL transition. It samples the outgoing (`fromImg`)
 * and incoming (`toImg`) images and combines a directional wipe, a cross
 * dissolve, a slide, a zoom punch and a twist — the same knobs exposed in the
 * transition designer. Every built-in and custom transition is expressed as a
 * point in this parameter space.
 */
export const TRANSITION_SKSL = `
uniform shader fromImg;
uniform shader toImg;
uniform float2 res;
uniform float progress;
uniform float dissolve;
uniform float slide;
uniform float2 dir;
uniform float zoom;
uniform float twist;
uniform float softness;

float2 rotscale(float2 uv, float2 c, float ang, float z) {
  float2 p = (uv - c) / z;
  float s = sin(ang);
  float co = cos(ang);
  p = float2(p.x * co - p.y * s, p.x * s + p.y * co);
  return p + c;
}

half4 main(float2 xy) {
  float2 uv = xy / res;
  float2 c = float2(0.5, 0.5);

  float angFrom = twist * (1.0 - progress);
  float angTo = -twist * progress;
  float zFrom = 1.0 + zoom * progress;
  float zTo = 1.0 - zoom * (1.0 - progress);

  float2 fromUv = rotscale(uv, c, angFrom, zFrom) + dir * slide * progress;
  float2 toUv = rotscale(uv, c, angTo, zTo) - dir * slide * (1.0 - progress);

  half4 fromCol = fromImg.eval(fromUv * res);
  half4 toCol = toImg.eval(toUv * res);

  float axis = dot(uv - c, dir) + 0.5;
  float soft = max(softness, 0.001);
  float edge = smoothstep(progress - soft, progress + soft, axis);
  float wipeMask = 1.0 - edge;

  float m = mix(wipeMask, progress, dissolve);
  return mix(fromCol, toCol, clamp(m, 0.0, 1.0));
}
`;

export function directionVector(direction: TransitionParams['direction']): [number, number] {
  switch (direction) {
    case 'left': return [-1, 0];
    case 'right': return [1, 0];
    case 'up': return [0, -1];
    case 'down': return [0, 1];
  }
}

/** Convert designer params into the uniform bag the SkSL shader expects. */
export function paramsToUniforms(
  params: TransitionParams,
  progress: number,
  width: number,
  height: number,
): Record<string, number | number[]> {
  return {
    res: [width, height],
    progress,
    dissolve: params.dissolve,
    slide: params.slide,
    dir: directionVector(params.direction),
    zoom: params.zoom,
    twist: (params.twist * Math.PI) / 180,
    softness: params.softness,
  };
}

/**
 * Built-in transitions expressed as designer parameters, so the same shader
 * previews everything. `exportBase` (used by the ffmpeg exporter) is the
 * matching xfade name.
 */
export const BUILTIN_TRANSITION_PARAMS: Record<string, { params: TransitionParams; exportBase: string }> = {
  fade: { exportBase: 'fade', params: { ...DEFAULT_TRANSITION_PARAMS, dissolve: 1, slide: 0, zoom: 0, twist: 0 } },
  dissolve: { exportBase: 'dissolve', params: { ...DEFAULT_TRANSITION_PARAMS, dissolve: 1, softness: 0.5 } },
  wipeleft: { exportBase: 'wipeleft', params: { ...DEFAULT_TRANSITION_PARAMS, dissolve: 0, direction: 'left', softness: 0.05 } },
  wiperight: { exportBase: 'wiperight', params: { ...DEFAULT_TRANSITION_PARAMS, dissolve: 0, direction: 'right', softness: 0.05 } },
  slideleft: { exportBase: 'slideleft', params: { ...DEFAULT_TRANSITION_PARAMS, dissolve: 0, slide: 1, direction: 'left', softness: 0.02 } },
  slideright: { exportBase: 'slideright', params: { ...DEFAULT_TRANSITION_PARAMS, dissolve: 0, slide: 1, direction: 'right', softness: 0.02 } },
  slideup: { exportBase: 'slideup', params: { ...DEFAULT_TRANSITION_PARAMS, dissolve: 0, slide: 1, direction: 'up', softness: 0.02 } },
  slidedown: { exportBase: 'slidedown', params: { ...DEFAULT_TRANSITION_PARAMS, dissolve: 0, slide: 1, direction: 'down', softness: 0.02 } },
  zoomin: { exportBase: 'zoomin', params: { ...DEFAULT_TRANSITION_PARAMS, dissolve: 0.6, zoom: 0.6, softness: 0.4 } },
  circleopen: { exportBase: 'circleopen', params: { ...DEFAULT_TRANSITION_PARAMS, dissolve: 0.4, zoom: 0.3, softness: 0.5 } },
};

export interface ResolvedTransition {
  params: TransitionParams;
  exportBase: string;
}

/**
 * Resolve the transition to use for the cut into segment `cutIndex` (1-based
 * within the timeline), honouring built-ins, custom transitions, 'random' and
 * 'cut'.
 */
export function resolveTransitionForCut(
  selection: string,
  cutIndex: number,
  customTransitions: CustomTransition[],
  seed?: number,
): ResolvedTransition | null {
  if (selection === 'cut' || selection === 'none') return null;

  if (selection === 'random') {
    const keys = Object.keys(BUILTIN_TRANSITION_PARAMS);
    const all = [...keys, ...customTransitions.map((c) => c.id)];
    const rng = makeRng((seed ?? 1) * 1000 + cutIndex);
    const pick = all[Math.floor(rng() * all.length)];
    return resolveTransitionForCut(pick, cutIndex, customTransitions, seed);
  }

  const custom = customTransitions.find((c) => c.id === selection);
  if (custom) return { params: custom.params, exportBase: custom.exportBase };

  const builtin = BUILTIN_TRANSITION_PARAMS[selection];
  if (builtin) return { params: builtin.params, exportBase: builtin.exportBase };

  return { params: BUILTIN_TRANSITION_PARAMS.fade.params, exportBase: 'fade' };
}
