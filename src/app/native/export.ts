import { buildFfmpegArgs } from '../../engine';
import type { Timeline } from '../../engine/types';
import type { ProjectSettings } from '../types';

export interface ExportInput {
  timeline: Timeline;
  audioUri: string;
  outPath: string;
  settings: ProjectSettings;
}

export interface ExportResult {
  ok: boolean;
  outPath?: string;
  /** The ffmpeg command that would run (shared with the desktop engine). */
  command?: string[];
  error?: string;
}

/**
 * Build the render command from the shared engine and (in a future build)
 * execute it with a bundled mobile ffmpeg. The command construction is fully
 * shared with the tested desktop engine, so wiring the native executor is a
 * single call.
 */
export async function exportVideo(input: ExportInput): Promise<ExportResult> {
  const stripFile = (u: string) => u.replace(/^file:\/\//, '');
  const { args } = buildFfmpegArgs({
    timeline: input.timeline,
    audioPath: stripFile(input.audioUri),
    outPath: stripFile(input.outPath),
    transition: input.settings.transition,
    transitionDuration: input.settings.transitionDuration,
    quality: input.settings.quality,
    seed: input.settings.seed,
  });

  // The native ffmpeg executor is added in the export build. Until then the
  // command is prepared but not run, so the rest of the app is fully usable.
  return {
    ok: false,
    command: args,
    error: 'On-device export lands in the next build. Preview and design are fully working.',
  };
}
