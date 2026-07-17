import type { AnimationKind } from './types';

/**
 * Build the ffmpeg filter chain that turns one still image (or video) into a
 * WxH clip of `duration` seconds with the requested motion.
 *
 * For images we use the `zoompan` filter (the classic "Ken Burns" primitive).
 * The image is first upscaled so the zoom/pan has spare pixels to move into,
 * which keeps the motion smooth instead of shaky.
 */

export interface ClipFilterParams {
  kind: 'image' | 'video';
  animation: AnimationKind;
  duration: number;
  fps: number;
  width: number;
  height: number;
}

/** Number of output frames for a clip of `duration` at `fps`. */
export function frameCount(duration: number, fps: number): number {
  return Math.max(1, Math.round(duration * fps));
}

/**
 * Returns the zoompan `z`, `x`, `y` expressions for a given animation.
 * Expressions use `on` (output frame index, 0-based) and the baked-in frame
 * count N, plus zoompan's own `iw`/`ih`/`zoom` variables.
 */
export function zoompanExpressions(
  animation: AnimationKind,
  frames: number,
): { z: string; x: string; y: string } {
  const N1 = Math.max(1, frames - 1); // avoid divide-by-zero on 1-frame clips
  // Normalised progress 0..1 across the clip.
  const p = `(on/${N1})`;
  // Triangle wave 0..1..0 for in-then-out moves.
  const tri = `(1-abs(2*${p}-1))`;
  const cx = `x='iw/2-(iw/zoom/2)'`; // horizontal centre
  const cy = `y='ih/2-(ih/zoom/2)'`; // vertical centre

  switch (animation) {
    case 'zoom-in':
      return { z: `z='1+0.18*${p}'`, x: cx, y: cy };
    case 'zoom-out':
      return { z: `z='1.18-0.18*${p}'`, x: cx, y: cy };
    case 'zoom-in-out':
      return { z: `z='1+0.16*${tri}'`, x: cx, y: cy };
    case 'pan-left':
      return {
        z: `z='1.12'`,
        x: `x='(iw-iw/zoom)*(1-${p})'`,
        y: cy,
      };
    case 'pan-right':
      return {
        z: `z='1.12'`,
        x: `x='(iw-iw/zoom)*${p}'`,
        y: cy,
      };
    case 'ken-burns':
      // Gentle zoom-in with a slow diagonal drift.
      return {
        z: `z='1+0.14*${p}'`,
        x: `x='(iw-iw/zoom)*(0.15+0.5*${p})'`,
        y: `y='(ih-ih/zoom)*(0.2+0.4*${p})'`,
      };
    case 'none':
    default:
      return { z: `z='1'`, x: cx, y: cy };
  }
}

/**
 * Full per-clip filter chain, ending in a labelled pad (added by the caller).
 * `oversample` controls the pre-scale factor for zoompan smoothness.
 */
export function buildClipFilter(params: ClipFilterParams, oversample = 2): string {
  const { kind, animation, duration, fps, width, height } = params;
  const frames = frameCount(duration, fps);

  if (kind === 'video' || animation === 'none') {
    // Cover-fit the frame, normalise fps / SAR / pixel format, trim to length.
    return [
      `scale=${width}:${height}:force_original_aspect_ratio=increase`,
      `crop=${width}:${height}`,
      `fps=${fps}`,
      `trim=duration=${duration.toFixed(3)}`,
      `setpts=PTS-STARTPTS`,
      `setsar=1`,
      `format=yuv420p`,
    ].join(',');
  }

  const bigW = width * oversample;
  const bigH = height * oversample;
  const { z, x, y } = zoompanExpressions(animation, frames);
  return [
    `scale=${bigW}:${bigH}:force_original_aspect_ratio=increase`,
    `crop=${bigW}:${bigH}`,
    `zoompan=${z}:${x}:${y}:d=${frames}:s=${width}x${height}:fps=${fps}`,
    `setsar=1`,
    `format=yuv420p`,
  ].join(',');
}
