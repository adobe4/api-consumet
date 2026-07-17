import type { AnimationKind, Timeline } from '../../engine/types';

export interface ZoomTransform {
  scale: number;
  /** Translation as a fraction of canvas size (kept within the zoom slack). */
  tx: number;
  ty: number;
}

/** Client-side mirror of the engine's zoompan motion, as a simple transform. */
export function zoomTransform(animation: AnimationKind, p: number): ZoomTransform {
  const clamp01 = Math.min(1, Math.max(0, p));
  const tri = 1 - Math.abs(2 * clamp01 - 1);
  switch (animation) {
    case 'zoom-in':
      return { scale: 1 + 0.18 * clamp01, tx: 0, ty: 0 };
    case 'zoom-out':
      return { scale: 1.18 - 0.18 * clamp01, tx: 0, ty: 0 };
    case 'zoom-in-out':
      return { scale: 1 + 0.16 * tri, tx: 0, ty: 0 };
    case 'pan-right': {
      const s = 1.12; const slack = (s - 1) / 2;
      return { scale: s, tx: slack - 2 * slack * clamp01, ty: 0 };
    }
    case 'pan-left': {
      const s = 1.12; const slack = (s - 1) / 2;
      return { scale: s, tx: -slack + 2 * slack * clamp01, ty: 0 };
    }
    case 'ken-burns': {
      const s = 1 + 0.14 * clamp01; const slack = (s - 1) / 2;
      return { scale: s, tx: slack * (0.3 - 0.6 * clamp01), ty: slack * (0.2 - 0.4 * clamp01) };
    }
    case 'none':
    default:
      return { scale: 1, tx: 0, ty: 0 };
  }
}

export interface FrameState {
  /** Segment index currently on screen. */
  index: number;
  fromIndex?: number;
  /** 0..1 within an active transition (undefined when not transitioning). */
  transitionProgress?: number;
}

/**
 * Given a playhead time, return which segment is showing and whether we are in
 * the crossfade into it. The crossfade occupies the first `T` seconds of a
 * segment (matching the engine's xfade offset = segment start).
 */
export function frameAt(timeline: Timeline, t: number, transitionDuration: number): FrameState | null {
  const segs = timeline.segments;
  if (segs.length === 0) return null;
  const time = Math.min(Math.max(0, t), timeline.duration);

  let index = segs.findIndex((s) => time >= s.start && time < s.end);
  if (index === -1) index = segs.length - 1; // exactly at the end

  if (index > 0 && transitionDuration > 0) {
    const seg = segs[index];
    const into = time - seg.start;
    if (into >= 0 && into < transitionDuration) {
      return { index, fromIndex: index - 1, transitionProgress: into / transitionDuration };
    }
  }
  return { index };
}

/** Local 0..1 progress of a segment at time t (clamped past its bounds). */
export function segmentProgress(start: number, duration: number, t: number): number {
  if (duration <= 0) return 0;
  return Math.min(1, Math.max(0, (t - start) / duration));
}
