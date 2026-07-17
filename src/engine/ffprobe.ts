import { execFile } from 'node:child_process';
import { extname } from 'node:path';
import { promisify } from 'node:util';
import { ffprobePath } from './binaries';
import type { VisualKind } from './types';

const execFileAsync = promisify(execFile);

const IMAGE_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.tif', '.tiff', '.heic', '.avif',
]);
const VIDEO_EXTS = new Set([
  '.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v', '.mpg', '.mpeg', '.wmv', '.flv',
]);

/** Best-effort classification of a media file by extension. */
export function detectKind(path: string): VisualKind {
  const ext = extname(path).toLowerCase();
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (IMAGE_EXTS.has(ext)) return 'image';
  // Unknown: assume image (a single still is the safer default for b-roll).
  return 'image';
}

/** Return the duration of a media file in seconds via ffprobe. */
export async function probeDuration(path: string): Promise<number> {
  const { stdout } = await execFileAsync(ffprobePath, [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    path,
  ]);
  const seconds = parseFloat(stdout.trim());
  if (Number.isNaN(seconds)) {
    throw new Error(`Could not read duration of ${path}`);
  }
  return seconds;
}
