import type { VisualKind } from './types';

const IMAGE_EXTS = new Set([
  'jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'tif', 'tiff', 'heic', 'heif', 'avif',
]);
const VIDEO_EXTS = new Set([
  'mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'mpg', 'mpeg', 'wmv', 'flv', '3gp',
]);

/** Lowercase extension without the dot, from a path/uri/filename. */
export function extOf(pathOrUri: string): string {
  const clean = pathOrUri.split('?')[0].split('#')[0];
  const base = clean.split(/[/\\]/).pop() ?? clean;
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/**
 * Classify a media file as image or video by extension. Pure string logic so it
 * is safe to use in React Native (no node:path). MIME type, when known, wins.
 */
export function detectKind(pathOrUri: string, mime?: string): VisualKind {
  if (mime) {
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('image/')) return 'image';
  }
  const ext = extOf(pathOrUri);
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (IMAGE_EXTS.has(ext)) return 'image';
  return 'image';
}
