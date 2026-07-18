import {
  FFmpegKit,
  ReturnCode,
  type FFmpegSession,
  type Statistics,
} from '@wokcito/ffmpeg-kit-react-native';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { buildFfmpegArgs } from '../../engine';
import type { Timeline } from '../../engine/types';
import type { ProjectSettings } from '../types';
import { appendExportLog } from './exportLog';

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
 * Video encoders to try, best first. Each fails immediately (before rendering)
 * if it isn't compiled into the bundled ffmpeg, so falling back is cheap.
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

function tail(text: string, n = 700): string {
  return text.length > n ? '…' + text.slice(-n) : text;
}

/**
 * Run one ffmpeg command safely. Uses the async (callback) API — the blocking
 * variant can wedge the JS thread — and swallows every possible throw (the
 * statistics callback is invoked by native code, so a throw there would crash
 * the whole app). Always resolves; never rejects.
 */
function runFfmpeg(
  args: string[],
  totalSeconds: number,
  onProgress?: (p: number) => void,
): Promise<{ success: boolean; logs: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (success: boolean, logs: string) => {
      if (settled) return;
      settled = true;
      resolve({ success, logs });
    };

    const onComplete = async (session: FFmpegSession) => {
      try {
        const rc = await session.getReturnCode();
        if (ReturnCode.isSuccess(rc)) {
          done(true, '');
        } else {
          let logs = '';
          try {
            logs = await session.getAllLogsAsString();
          } catch {
            logs = 'render failed';
          }
          done(false, logs);
        }
      } catch (e) {
        done(false, e instanceof Error ? e.message : String(e));
      }
    };

    const onStats = (stats: Statistics) => {
      try {
        const seconds = (stats?.getTime?.() ?? 0) / 1000;
        if (seconds > 0 && totalSeconds > 0) {
          onProgress?.(Math.max(0, Math.min(1, seconds / totalSeconds)));
        }
      } catch {
        /* never let the native-invoked callback throw */
      }
    };

    try {
      const maybePromise = FFmpegKit.executeWithArgumentsAsync(args, onComplete, undefined, onStats);
      // Some versions return a promise that can reject if the session fails to start.
      (maybePromise as unknown as Promise<unknown>)?.catch?.((e: unknown) =>
        done(false, e instanceof Error ? e.message : String(e)),
      );
    } catch (e) {
      done(false, e instanceof Error ? e.message : String(e));
    }
  });
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
 * Render the timeline + audio to an MP4 on-device, then save it to the gallery.
 * Never throws — any failure comes back as { ok:false, error }.
 */
export async function exportVideo(
  input: ExportInput,
  onProgress?: (p: number) => void,
): Promise<ExportResult> {
  try {
    await appendExportLog('export tapped');
    if (input.timeline.segments.length === 0) {
      return { ok: false, error: 'Add at least one visual before exporting.' };
    }
    if (!input.audioUri) {
      return { ok: false, error: 'Add a voiceover before exporting.' };
    }

    const total = input.timeline.duration || 1;
    const outUri = `${FileSystem.cacheDirectory}vinei-export-${Date.now()}.mp4`;
    const outPath = stripFileScheme(outUri);

    // Preflight: this is the FIRST call into ffmpeg, so it triggers loading the
    // native library. Awaiting the breadcrumb first means that if the library
    // load crashes the whole app, the last saved breadcrumb pinpoints it.
    await appendExportLog('loading ffmpeg native library (running -version)');
    const preflight = await runFfmpeg(['-version'], 1);
    await appendExportLog(`ffmpeg loaded: success=${preflight.success}`);
    if (!preflight.success) {
      return { ok: false, error: `ffmpeg could not start: ${tail(preflight.logs, 200)}` };
    }

    let lastLogs = '';
    for (const encoder of VIDEO_ENCODERS) {
      await appendExportLog(`render start (encoder=${encoder.name}, segments=${input.timeline.segments.length})`);
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
        // Lower zoom pre-scale on mobile to keep memory in check.
        oversample: 1.5,
      });

      onProgress?.(0);
      const { success, logs } = await runFfmpeg(args, total, onProgress);
      await appendExportLog(`render done (encoder=${encoder.name}, success=${success})`);
      if (success) {
        onProgress?.(1);
        const saved = await saveToGallery(outUri);
        await appendExportLog(`saved to gallery: ${saved}`);
        return { ok: true, outPath: outUri, savedToGallery: saved };
      }
      lastLogs = logs;
      if (!MISSING_ENCODER.test(logs)) break; // real error → stop, don't retry
    }
    await appendExportLog(`export failed: ${tail(lastLogs, 160)}`);
    return { ok: false, error: tail(lastLogs) || 'Export failed.' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await appendExportLog(`export threw: ${msg}`);
    return { ok: false, error: msg };
  }
}
