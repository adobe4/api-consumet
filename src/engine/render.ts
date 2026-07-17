import { spawn } from 'node:child_process';
import { ffmpegPath } from './binaries';
import { buildFfmpegArgs } from './ffmpegGraph';
import type { RenderOptions, RenderProgress } from './types';

export interface RenderHandle {
  /** Resolves with the output path on success. */
  done: Promise<string>;
  /** Cancel the in-flight render. */
  cancel: () => void;
}

/**
 * Render a timeline + audio to a video file using the bundled ffmpeg.
 * Progress is derived from ffmpeg's `-progress` stream against the known total
 * timeline duration.
 */
export function render(
  opts: RenderOptions,
  onProgress?: (p: RenderProgress) => void,
): RenderHandle {
  const { args } = buildFfmpegArgs({
    timeline: opts.timeline,
    audioPath: opts.audioPath,
    outPath: opts.outPath,
    transition: opts.transition,
    transitionDuration: opts.transitionDuration,
    quality: opts.quality,
    seed: opts.seed,
    progress: true,
  });

  const total = opts.timeline.duration || 1;
  const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });

  let stderrTail = '';
  child.stderr.on('data', (buf: Buffer) => {
    stderrTail = (stderrTail + buf.toString()).slice(-4000);
  });

  child.stdout.on('data', (buf: Buffer) => {
    if (!onProgress) return;
    const text = buf.toString();
    // ffmpeg -progress emits `key=value` lines; out_time_us is microseconds.
    const usMatch = text.match(/out_time_us=(\d+)/);
    const fpsMatch = text.match(/\bfps=([\d.]+)/);
    const speedMatch = text.match(/speed=([\d.]+x)/);
    if (usMatch) {
      const outTime = parseInt(usMatch[1], 10) / 1_000_000;
      onProgress({
        outTime,
        progress: Math.min(1, outTime / total),
        fps: fpsMatch ? parseFloat(fpsMatch[1]) : undefined,
        speed: speedMatch ? speedMatch[1] : undefined,
      });
    }
  });

  const done = new Promise<string>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        onProgress?.({ outTime: total, progress: 1 });
        resolve(opts.outPath);
      } else {
        reject(new Error(`ffmpeg exited with code ${code}\n${stderrTail}`));
      }
    });
  });

  return { done, cancel: () => child.kill('SIGKILL') };
}
