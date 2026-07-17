import type { QualityPreset, Timeline, TransitionSelection } from './types';
import { buildClipFilter } from './animations';
import { resolveTransitions } from './transitions';

export interface GraphOptions {
  timeline: Timeline;
  audioPath: string;
  outPath: string;
  transition: TransitionSelection;
  transitionDuration: number;
  quality: QualityPreset;
  seed?: number;
  /** Emit `-progress pipe:1` so the renderer can report progress. */
  progress?: boolean;
}

export interface GraphResult {
  /** ffmpeg CLI args (excluding the ffmpeg binary itself). */
  args: string[];
  /** Per-junction transition styles actually used (for the UI / debugging). */
  transitions: string[];
  /** Effective crossfade duration after clamping to the shortest segment. */
  effectiveTransitionDuration: number;
}

const QUALITY_ARGS: Record<QualityPreset, string[]> = {
  // Great quality, widely compatible, reasonable size.
  high: ['-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p'],
  // Near-lossless H.264. Big files, pristine output.
  max: ['-c:v', 'libx264', '-preset', 'veryslow', '-crf', '12', '-pix_fmt', 'yuv420p'],
  // Editing-grade intermediate (Apple ProRes 422 HQ). Huge, highest fidelity.
  prores: ['-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le'],
};

/**
 * Build the full ffmpeg argument list that renders a Timeline + audio track to
 * a single video file.
 *
 * Layout of inputs: visuals occupy inputs 0..n-1 (images looped, videos as-is),
 * and the audio track is the final input at index n.
 *
 * Transitions are implemented with `xfade`. Each non-final clip is made
 * `duration + T` long so it has a tail to cross-fade into the next clip; the
 * xfade `offset` for cut j is the cumulative start time of segment j+1, which
 * keeps the timeline total exactly equal to the audio length.
 */
export function buildFfmpegArgs(opts: GraphOptions): GraphResult {
  const { timeline, audioPath, outPath, quality } = opts;
  const { segments, fps, width, height, duration } = timeline;
  const n = segments.length;
  if (n === 0) throw new Error('Cannot render an empty timeline (no visuals).');

  const useCuts = opts.transition === 'cut' || opts.transition === 'none' || opts.transitionDuration <= 0;

  // Clamp the crossfade so it never exceeds the shortest segment (xfade needs
  // both sides to be at least T long).
  const minSeg = Math.min(...segments.map((s) => s.duration));
  const T = useCuts ? 0 : Math.max(0.05, Math.min(opts.transitionDuration, minSeg * 0.9));

  const transitions = useCuts ? [] : resolveTransitions(opts.transition, n - 1, opts.seed);

  // ---- Inputs ----------------------------------------------------------
  const inputArgs: string[] = [];
  const clipLengths: number[] = [];
  segments.forEach((seg, i) => {
    const isLast = i === n - 1;
    const clipLen = isLast ? seg.duration : seg.duration + T;
    clipLengths.push(clipLen);
    if (seg.visual.kind === 'image') {
      inputArgs.push('-loop', '1', '-t', clipLen.toFixed(3), '-i', seg.visual.path);
    } else {
      // Loop is unnecessary; the clip filter pads with a frozen last frame if
      // the source is shorter than the requested window.
      inputArgs.push('-i', seg.visual.path);
    }
  });
  const audioIndex = n;
  inputArgs.push('-i', audioPath);

  // ---- Per-clip filter chains -----------------------------------------
  const chains: string[] = [];
  segments.forEach((seg, i) => {
    const filter = buildClipFilter({
      kind: seg.visual.kind,
      animation: seg.animation,
      duration: clipLengths[i],
      fps,
      width,
      height,
    });
    chains.push(`[${i}:v]${filter}[c${i}]`);
  });

  // ---- Combine clips ---------------------------------------------------
  let finalLabel: string;
  if (n === 1) {
    finalLabel = 'c0';
  } else if (useCuts) {
    const labels = segments.map((_, i) => `[c${i}]`).join('');
    chains.push(`${labels}concat=n=${n}:v=1:a=0[vout]`);
    finalLabel = 'vout';
  } else {
    let prev = 'c0';
    let cumulative = segments[0].duration; // start time of segment 1
    for (let j = 1; j < n; j++) {
      const style = transitions[j - 1] ?? 'fade';
      const out = j === n - 1 ? 'vout' : `x${j}`;
      const offset = cumulative.toFixed(3);
      chains.push(
        `[${prev}][c${j}]xfade=transition=${style}:duration=${T.toFixed(3)}:offset=${offset}[${out}]`,
      );
      prev = out;
      cumulative += segments[j].duration;
    }
    finalLabel = 'vout';
  }

  const filterComplex = chains.join(';');

  // ---- Assemble args ---------------------------------------------------
  const args: string[] = ['-y'];
  if (opts.progress) args.push('-progress', 'pipe:1', '-nostats');
  args.push(...inputArgs);
  args.push('-filter_complex', filterComplex);
  args.push('-map', `[${finalLabel}]`, '-map', `${audioIndex}:a`);
  args.push('-r', String(fps));
  args.push(...QUALITY_ARGS[quality]);
  args.push('-c:a', 'aac', '-b:a', '320k');
  // Match output length to the audio/timeline exactly.
  args.push('-t', duration.toFixed(3));
  args.push('-movflags', '+faststart');
  args.push(outPath);

  return { args, transitions, effectiveTransitionDuration: T };
}
