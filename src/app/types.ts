import type { AnimationKind, QualityPreset, VisualKind } from '../engine/types';

/** A visual as tracked by the mobile UI (uri-based rather than filesystem path). */
export interface UIVisual {
  id: string;
  uri: string;
  kind: VisualKind;
  name: string;
  /** Natural pixel size when known (used to fit the preview). */
  width?: number;
  height?: number;
}

export interface AudioTrack {
  uri: string;
  name: string;
  duration: number; // seconds
}

/** Parameters for a user-designed transition (previewed live with Skia). */
export interface CustomTransition {
  id: string;
  name: string;
  /** Built-in xfade style used when exporting with ffmpeg. */
  exportBase: string;
  params: TransitionParams;
}

export interface TransitionParams {
  /** 0..1 cross-dissolve amount at the midpoint. */
  dissolve: number;
  /** Directional push 0..1 (0 = none). */
  slide: number;
  direction: 'left' | 'right' | 'up' | 'down';
  /** Zoom punch 0..1 applied through the cut. */
  zoom: number;
  /** Rotational twist in degrees applied through the cut. */
  twist: number;
  /** Edge softness 0..1 for wipes. */
  softness: number;
}

export interface ProjectSettings {
  animation: AnimationKind;
  /** A built-in xfade name, a custom transition id, 'random', or 'cut'. */
  transition: string;
  transitionDuration: number;
  quality: QualityPreset;
  width: number;
  height: number;
  fps: number;
  seed?: number;
}

export const DEFAULT_SETTINGS: ProjectSettings = {
  animation: 'ken-burns',
  transition: 'random',
  transitionDuration: 0.5,
  quality: 'high',
  // Portrait 9:16 by default (CapCut-style mobile).
  width: 1080,
  height: 1920,
  fps: 30,
};

export const DEFAULT_TRANSITION_PARAMS: TransitionParams = {
  dissolve: 1,
  slide: 0,
  direction: 'left',
  zoom: 0,
  twist: 0,
  softness: 0.3,
};
