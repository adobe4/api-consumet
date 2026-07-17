import type {
  AnimationKind,
  ParsedInstruction,
  Segment,
  Seconds,
  Timeline,
  Visual,
} from './types';
import { makeRng } from './rng';

const ANIMATION_POOL: AnimationKind[] = [
  'zoom-in',
  'zoom-out',
  'zoom-in-out',
  'pan-left',
  'pan-right',
  'ken-burns',
];

export interface BuildTimelineOptions {
  visuals: Visual[];
  instructions: ParsedInstruction[];
  /** Total audio length; used to resolve the final segment's end. */
  audioDuration: Seconds;
  fps?: number;
  width?: number;
  height?: number;
  /** Global animation choice. 'random' assigns a varied one per segment. */
  animation?: AnimationKind;
  /** Per-visual animation overrides, keyed by visual id. */
  animationOverrides?: Record<string, AnimationKind>;
  /** Minimum segment length; segments shorter than this are nudged. */
  minSegment?: Seconds;
  seed?: number;
}

/**
 * Resolve parsed instructions against the ordered visual list and the audio
 * duration to produce a concrete, gap-free timeline.
 *
 * Resolution rules:
 *  - Instructions are matched to visuals by their 1-based number, in order.
 *  - A missing start is filled from the previous segment's end (or 0).
 *  - A missing end is filled from the next segment's start (or, for the last
 *    segment, from the audio duration).
 *  - If there are no usable instructions, visuals are distributed evenly across
 *    the audio duration.
 */
export function buildTimeline(opts: BuildTimelineOptions): Timeline {
  const {
    visuals,
    instructions,
    audioDuration,
    fps = 30,
    width = 1920,
    height = 1080,
    animation = 'ken-burns',
    animationOverrides = {},
    minSegment = 0.4,
    seed,
  } = opts;

  if (visuals.length === 0) {
    return { segments: [], duration: audioDuration, fps, width, height };
  }

  const rng = makeRng(seed);
  const boundaries = resolveBoundaries(instructions, visuals.length, audioDuration);

  const segments: Segment[] = [];
  for (let i = 0; i < visuals.length; i++) {
    const visual = visuals[i];
    let start = boundaries[i].start;
    let end = boundaries[i].end;
    if (end - start < minSegment) end = start + minSegment;

    const anim = resolveAnimation(visual, animation, animationOverrides, rng);
    segments.push({
      index: i,
      visual,
      start,
      end,
      duration: end - start,
      animation: anim,
    });
  }

  return { segments, duration: audioDuration, fps, width, height };
}

interface Bound {
  start: Seconds;
  end: Seconds;
}

/**
 * Turn parsed instructions into one [start, end) window per visual index.
 * Always returns exactly `count` contiguous windows spanning [0, audio].
 */
function resolveBoundaries(
  instructions: ParsedInstruction[],
  count: number,
  audioDuration: Seconds,
): Bound[] {
  // Collect explicit start/end per visual number.
  const starts = new Array<Seconds | undefined>(count).fill(undefined);
  const ends = new Array<Seconds | undefined>(count).fill(undefined);

  const usable = instructions.filter(
    (ins) => ins.visualNumber >= 1 && ins.visualNumber <= count,
  );

  if (usable.length === 0) {
    // No instructions: distribute evenly.
    const each = audioDuration / count;
    return Array.from({ length: count }, (_, i) => ({
      start: i * each,
      end: (i + 1) * each,
    }));
  }

  for (const ins of usable) {
    const i = ins.visualNumber - 1;
    if (ins.start != null) starts[i] = ins.start;
    if (ins.end != null) ends[i] = ins.end;
  }

  // Forward fill starts: a missing start comes from the previous end/start.
  for (let i = 0; i < count; i++) {
    if (starts[i] == null) {
      if (i === 0) starts[i] = 0;
      else starts[i] = ends[i - 1] ?? starts[i - 1] ?? 0;
    }
  }
  // Fill ends: a missing end comes from the next start, or audio duration.
  for (let i = 0; i < count; i++) {
    if (ends[i] == null) {
      ends[i] = i + 1 < count ? starts[i + 1]! : audioDuration;
    }
  }

  // Enforce monotonicity and clamp to [0, audioDuration].
  const bounds: Bound[] = [];
  let cursor = 0;
  for (let i = 0; i < count; i++) {
    let s = clamp(starts[i]!, cursor, audioDuration);
    let e = clamp(ends[i]!, s, audioDuration);
    // Never let a start slip before the previous end (keeps it gap-free).
    s = Math.max(s, cursor);
    if (e < s) e = s;
    bounds.push({ start: s, end: e });
    cursor = e;
  }
  // The last visual always runs to the end of the audio.
  bounds[count - 1].end = audioDuration;
  return bounds;
}

function resolveAnimation(
  visual: Visual,
  global: AnimationKind,
  overrides: Record<string, AnimationKind>,
  rng: () => number,
): AnimationKind {
  const chosen = overrides[visual.id] ?? global;
  if (chosen === 'random') {
    return ANIMATION_POOL[Math.floor(rng() * ANIMATION_POOL.length)];
  }
  // Video clips do not get Ken Burns zoompan; they play as-is.
  if (visual.kind === 'video' && chosen !== 'none') return 'none';
  return chosen;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}
