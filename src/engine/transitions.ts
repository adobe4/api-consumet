import type { TransitionSelection } from './types';
import { makeRng } from './rng';

/**
 * The transition library. Every entry maps to a built-in ffmpeg `xfade`
 * transition, so they render with hardware-friendly, well-tested filters.
 * Grouped for the UI; the flat list drives 'random'.
 */
export interface TransitionDef {
  /** xfade transition name. */
  name: string;
  /** Human label for the UI. */
  label: string;
  group: TransitionGroup;
}

export type TransitionGroup =
  | 'Dissolve'
  | 'Wipe'
  | 'Slide'
  | 'Smooth'
  | 'Shape'
  | 'Open/Close'
  | 'Diagonal'
  | 'Slice'
  | 'Effect';

export const TRANSITIONS: TransitionDef[] = [
  { name: 'fade', label: 'Fade', group: 'Dissolve' },
  { name: 'fadeblack', label: 'Fade Through Black', group: 'Dissolve' },
  { name: 'fadewhite', label: 'Fade Through White', group: 'Dissolve' },
  { name: 'fadegrays', label: 'Fade Through Gray', group: 'Dissolve' },
  { name: 'dissolve', label: 'Dissolve', group: 'Dissolve' },
  { name: 'distance', label: 'Distance', group: 'Dissolve' },

  { name: 'wipeleft', label: 'Wipe Left', group: 'Wipe' },
  { name: 'wiperight', label: 'Wipe Right', group: 'Wipe' },
  { name: 'wipeup', label: 'Wipe Up', group: 'Wipe' },
  { name: 'wipedown', label: 'Wipe Down', group: 'Wipe' },

  { name: 'slideleft', label: 'Slide Left', group: 'Slide' },
  { name: 'slideright', label: 'Slide Right', group: 'Slide' },
  { name: 'slideup', label: 'Slide Up', group: 'Slide' },
  { name: 'slidedown', label: 'Slide Down', group: 'Slide' },

  { name: 'smoothleft', label: 'Smooth Left', group: 'Smooth' },
  { name: 'smoothright', label: 'Smooth Right', group: 'Smooth' },
  { name: 'smoothup', label: 'Smooth Up', group: 'Smooth' },
  { name: 'smoothdown', label: 'Smooth Down', group: 'Smooth' },

  { name: 'circlecrop', label: 'Circle Crop', group: 'Shape' },
  { name: 'rectcrop', label: 'Rectangle Crop', group: 'Shape' },
  { name: 'circleopen', label: 'Circle Open', group: 'Open/Close' },
  { name: 'circleclose', label: 'Circle Close', group: 'Open/Close' },
  { name: 'horzopen', label: 'Horizontal Open', group: 'Open/Close' },
  { name: 'horzclose', label: 'Horizontal Close', group: 'Open/Close' },
  { name: 'vertopen', label: 'Vertical Open', group: 'Open/Close' },
  { name: 'vertclose', label: 'Vertical Close', group: 'Open/Close' },

  { name: 'diagtl', label: 'Diagonal Top-Left', group: 'Diagonal' },
  { name: 'diagtr', label: 'Diagonal Top-Right', group: 'Diagonal' },
  { name: 'diagbl', label: 'Diagonal Bottom-Left', group: 'Diagonal' },
  { name: 'diagbr', label: 'Diagonal Bottom-Right', group: 'Diagonal' },

  { name: 'hlslice', label: 'Slice H-Left', group: 'Slice' },
  { name: 'hrslice', label: 'Slice H-Right', group: 'Slice' },
  { name: 'vuslice', label: 'Slice V-Up', group: 'Slice' },
  { name: 'vdslice', label: 'Slice V-Down', group: 'Slice' },

  { name: 'pixelize', label: 'Pixelize', group: 'Effect' },
  { name: 'radial', label: 'Radial', group: 'Effect' },
  { name: 'hblur', label: 'Blur', group: 'Effect' },
  { name: 'zoomin', label: 'Zoom In', group: 'Effect' },
  { name: 'squeezev', label: 'Squeeze Vertical', group: 'Effect' },
  { name: 'squeezeh', label: 'Squeeze Horizontal', group: 'Effect' },
  { name: 'wind', label: 'Wind', group: 'Effect' },
];

const NAME_SET = new Set(TRANSITIONS.map((t) => t.name));

export function isKnownTransition(name: string): boolean {
  return NAME_SET.has(name);
}

/**
 * Resolve the transition style for each of the `count` cuts (junctions) in a
 * timeline of `count + 1` segments.
 *
 *  - a concrete xfade name  -> that style at every cut
 *  - 'random'               -> a varied style per cut (seeded, reproducible)
 *  - 'cut' / 'none'         -> handled upstream (no xfade); returns []
 */
export function resolveTransitions(
  selection: TransitionSelection,
  count: number,
  seed?: number,
): string[] {
  if (count <= 0) return [];
  if (selection === 'cut' || selection === 'none') return [];

  if (selection === 'random') {
    const rng = makeRng(seed);
    const out: string[] = [];
    let last = '';
    for (let i = 0; i < count; i++) {
      let pick = TRANSITIONS[Math.floor(rng() * TRANSITIONS.length)].name;
      // Avoid repeating the same transition back-to-back when possible.
      if (pick === last && TRANSITIONS.length > 1) {
        pick = TRANSITIONS[Math.floor(rng() * TRANSITIONS.length)].name;
      }
      out.push(pick);
      last = pick;
    }
    return out;
  }

  const name = isKnownTransition(selection) ? selection : 'fade';
  return new Array(count).fill(name);
}
