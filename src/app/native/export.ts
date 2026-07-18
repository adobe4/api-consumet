import { FFmpegKit, FFmpegKitConfig, ReturnCode } from '@wokcito/ffmpeg-kit-react-native';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { buildFfmpegArgs } from '../../engine';
import type { Timeline } from '../../engine/types';
import type { ProjectSettings } from '../types';

export interface ExportInput {
  timeline: Timeline;
  audioUri: string;
  settings: ProjectSettings;
}

export interface ExportResult {
  ok: boolean;
  outPath?: string;
  savedToGallery?: boolean;
  error?: string;
}

/**
 * Video encoders to try, best first. Each one fails immediately (before any
 * rendering) if it isn't compiled into the bundled ffmpeg, so falling back is
 * cheap. libx264 = best quality (GPL builds); libopenh264 = LGPL H.264;
 * mpeg4 = universal fallback that exists in every ffmpeg build.
 */
const VIDEO_ENCODERS: { name: string; args: string[] }[] = [
  { name: 'libx264', args: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p'] },
  { name: 'libopenh264', args: ['-c:v', 'libopenh264', '-b:v', '10M', '-pix_fmt', 'yuv420p'] },
  { name: 'mpeg4', args: ['-c:v', 'mpeg4', '-q:v', '3', '-pix_fmt', 'yuv420p'] },
];

const MISSING_ENCODER = /unknown encoder|encoder not found|cannot find|not compiled|no such/i;

function stripFileScheme(uri: string): string {
  return uri.replace(/^file:\/\//, '');
}

function tail(text: string, n = 600): string {
  return text.length > n ? text.slice(-n) : text;
}

async function saveToGallery(fileUri: string): Promise<boolean> {
  try {
    const perm = await MediaLibrary.requestPermissionsAsync();
    if (!perm.granted) return false;
    await MediaLibrary.createAssetAsync(fileUri);
    return true;
  } catch {
    return false;
  }
}

/**
 * Render the timeline + audio to an MP4 on-device using the bundled ffmpeg,
 * then save it to the gallery. Reports 0..1 progress.
 */
export async function exportVideo(
  input: ExportInput,
  onProgress?: (p: number) => void,
): Promise<ExportResult> {
  if (input.timeline.segments.length === 0) {
    return { ok: false, error: 'Add at least one visual before exporting.' };
  }
  if (!input.audioUri) {
    return { ok: false, error: 'Add a voiceover before exporting.' };
  }

  const total = input.timeline.duration || 1;
  const outUri = `${FileSystem.cacheDirectory}vinei-export-${Date.now()}.mp4`;
  const outPath = stripFileScheme(outUri);

  FFmpegKitConfig.enableStatisticsCallback((stats) => {
    const seconds = (stats.getTime?.() ?? 0) / 1000;
    onProgress?.(Math.max(0, Math.min(1, seconds / total)));
  });

  let lastLogs = '';
  try {
    for (const encoder of VIDEO_ENCODERS) {
      const { args } = buildFfmpegArgs({
        timeline: input.timeline,
        audioPath: stripFileScheme(input.audioUri),
        outPath,
        transition: input.settings.transition,
        transitionDuration: input.settings.transitionDuration,
        quality: input.settings.quality,
        seed: input.settings.seed,
        progress: false,
        videoCodecArgs: encoder.args,
      });

      onProgress?.(0);
      const session = await FFmpegKit.executeWithArguments(args);
      const rc = await session.getReturnCode();

      if (ReturnCode.isSuccess(rc)) {
        onProgress?.(1);
        const saved = await saveToGallery(outUri);
        return { ok: true, outPath: outUri, savedToGallery: saved };
      }

      lastLogs = await session.getAllLogsAsString();
      // Only fall back to the next encoder when THIS one is simply missing.
      if (!MISSING_ENCODER.test(lastLogs)) break;
    }
    return { ok: false, error: tail(lastLogs) || 'Export failed.' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    FFmpegKitConfig.enableStatisticsCallback(() => {});
  }
}
