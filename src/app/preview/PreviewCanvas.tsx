import { useMemo } from 'react';
import {
  Canvas,
  Fill,
  ImageShader,
  Shader,
  Skia,
  useImage,
} from '@shopify/react-native-skia';
import type { Timeline } from '../../engine/types';
import type { CustomTransition } from '../types';
import { frameAt, segmentProgress, zoomTransform, type ZoomTransform } from './frame';
import {
  TRANSITION_SKSL,
  paramsToUniforms,
  resolveTransitionForCut,
} from './transitionShader';

const runtimeEffect = Skia.RuntimeEffect.Make(TRANSITION_SKSL);

interface Props {
  timeline: Timeline;
  time: number;
  width: number;
  height: number;
  transition: string;
  transitionDuration: number;
  customTransitions: CustomTransition[];
  seed?: number;
}

function toTransform(zt: ZoomTransform, width: number, height: number) {
  return [{ scale: zt.scale }, { translateX: zt.tx * width }, { translateY: zt.ty * height }];
}

/**
 * GPU-accelerated live preview of the assembled reel at a given playhead time.
 * Everything renders through ImageShaders (linear filtering) for clean scaling;
 * during a cut, both visuals are composited with the parameterised SkSL
 * transition, each carrying its own zoom so motion stays continuous.
 */
export function PreviewCanvas({
  timeline,
  time,
  width,
  height,
  transition,
  transitionDuration,
  customTransitions,
  seed,
}: Props) {
  const segs = timeline.segments;
  const frame = frameAt(timeline, time, transitionDuration);

  const currentUri = frame ? segs[frame.index]?.visual.path ?? '' : '';
  const fromUri =
    frame?.fromIndex != null ? segs[frame.fromIndex]?.visual.path ?? currentUri : currentUri;

  const currentImage = useImage(currentUri);
  const fromImage = useImage(fromUri);

  const rect = useMemo(() => ({ x: 0, y: 0, width, height }), [width, height]);
  const origin = useMemo(() => ({ x: width / 2, y: height / 2 }), [width, height]);

  const inTransition = frame?.transitionProgress != null && frame.fromIndex != null;

  const currentTransform = useMemo(() => {
    if (!frame) return undefined;
    const seg = segs[frame.index];
    if (!seg) return undefined;
    const p = segmentProgress(seg.start, seg.duration, time);
    return toTransform(zoomTransform(seg.animation, p), width, height);
  }, [frame, segs, time, width, height]);

  const fromTransform = useMemo(() => {
    if (!inTransition || !frame || frame.fromIndex == null) return undefined;
    const seg = segs[frame.fromIndex];
    if (!seg) return undefined;
    const p = segmentProgress(seg.start, seg.duration, time);
    return toTransform(zoomTransform(seg.animation, p), width, height);
  }, [inTransition, frame, segs, time, width, height]);

  const transitionUniforms = useMemo(() => {
    if (!inTransition || !frame) return null;
    const resolved = resolveTransitionForCut(transition, frame.index, customTransitions, seed);
    if (!resolved) return null;
    return paramsToUniforms(resolved.params, frame.transitionProgress ?? 0, width, height);
  }, [inTransition, frame, transition, customTransitions, seed, width, height]);

  return (
    <Canvas style={{ width, height }}>
      <Fill color="#000000" />
      {inTransition && runtimeEffect && transitionUniforms ? (
        <Fill>
          <Shader source={runtimeEffect} uniforms={transitionUniforms}>
            <ImageShader
              image={fromImage}
              fit="cover"
              rect={rect}
              tx="clamp"
              ty="clamp"
              fm="linear"
              mm="linear"
              transform={fromTransform}
              origin={origin}
            />
            <ImageShader
              image={currentImage}
              fit="cover"
              rect={rect}
              tx="clamp"
              ty="clamp"
              fm="linear"
              mm="linear"
              transform={currentTransform}
              origin={origin}
            />
          </Shader>
        </Fill>
      ) : (
        <Fill>
          <ImageShader
            image={currentImage}
            fit="cover"
            rect={rect}
            tx="clamp"
            ty="clamp"
            fm="linear"
            mm="linear"
            transform={currentTransform}
            origin={origin}
          />
        </Fill>
      )}
    </Canvas>
  );
}
