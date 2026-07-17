/**
 * Core domain types for the AutoReel engine.
 *
 * A "visual" is one image or short video clip that the user places on the
 * timeline (the user calls these "virtuals"). The engine takes an ordered list
 * of visuals + a voiceover audio track + a set of timecode instructions and
 * assembles a synced video.
 */

export type Seconds = number;

export type VisualKind = 'image' | 'video';

export interface Visual {
  /** Stable id (used by the UI). */
  id: string;
  /** Absolute path on disk. */
  path: string;
  kind: VisualKind;
  /** Display name (file name), optional. */
  name?: string;
}

/**
 * A single parsed instruction line, before it is matched against the audio
 * length or the visual list. Either bound may be undefined and is resolved
 * later by the timeline builder (implicit start = previous end, implicit last
 * end = audio duration).
 */
export interface ParsedInstruction {
  /** 1-based visual number as written by the user ("visual 3" -> 3). */
  visualNumber: number;
  start?: Seconds;
  end?: Seconds;
  /** The raw source text this was parsed from (for debugging / UI). */
  raw: string;
}

export type AnimationKind =
  | 'none'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-in-out'
  | 'pan-left'
  | 'pan-right'
  | 'ken-burns'
  | 'random';

/** A resolved segment: one visual shown across a concrete [start, end) window. */
export interface Segment {
  index: number;
  visual: Visual;
  start: Seconds;
  end: Seconds;
  duration: Seconds;
  animation: AnimationKind;
}

export interface Timeline {
  segments: Segment[];
  /** Total timeline length in seconds (matches audio duration). */
  duration: Seconds;
  fps: number;
  width: number;
  height: number;
}

export type QualityPreset = 'high' | 'max' | 'prores';

export interface RenderOptions {
  audioPath: string;
  timeline: Timeline;
  outPath: string;
  /** Global crossfade duration between visuals, in seconds. 0 = hard cuts. */
  transitionDuration: Seconds;
  /**
   * Transition style selection. A concrete xfade name applies that style to
   * every cut; 'random' picks a different style per cut; 'cut' means no
   * crossfade.
   */
  transition: TransitionSelection;
  quality: QualityPreset;
  /** Optional deterministic seed for 'random' animation / transition choices. */
  seed?: number;
}

export type TransitionSelection = string; // an xfade name, 'random', or 'cut'

export interface RenderProgress {
  /** 0..1 */
  progress: number;
  /** Timestamp reported by ffmpeg (seconds of output produced). */
  outTime: Seconds;
  fps?: number;
  speed?: string;
}
