import { useMemo } from 'react';
import {
  Canvas,
  Fill,
  ImageShader,
  Shader,
  Skia,
  useImage,
} from '@shopify/react-native-skia';
import type { TransitionParams } from '../types';
import { TRANSITION_SKSL, paramsToUniforms } from '../preview/transitionShader';

const effect = Skia.RuntimeEffect.Make(TRANSITION_SKSL);

interface Props {
  fromUri: string;
  toUri: string;
  params: TransitionParams;
  progress: number;
  width: number;
  height: number;
}

/** Looping preview of a single transition with the current designer params. */
export function TransitionPreview({ fromUri, toUri, params, progress, width, height }: Props) {
  const fromImage = useImage(fromUri);
  const toImage = useImage(toUri);
  const rect = useMemo(() => ({ x: 0, y: 0, width, height }), [width, height]);
  const uniforms = useMemo(
    () => paramsToUniforms(params, progress, width, height),
    [params, progress, width, height],
  );

  // Guard: never feed a null image into the shader (native crash on Android).
  const ready = fromImage != null && toImage != null;

  return (
    <Canvas style={{ width, height }}>
      <Fill color="#000000" />
      {effect && ready && (
        <Fill>
          <Shader source={effect} uniforms={uniforms}>
            <ImageShader image={fromImage} fit="cover" rect={rect} tx="clamp" ty="clamp" fm="linear" />
            <ImageShader image={toImage} fit="cover" rect={rect} tx="clamp" ty="clamp" fm="linear" />
          </Shader>
        </Fill>
      )}
    </Canvas>
  );
}
