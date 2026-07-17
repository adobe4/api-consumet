import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

/**
 * Resolve the bundled ffmpeg / ffprobe executables.
 *
 * When packaged with electron-builder the binaries are unpacked from the asar
 * archive, so the path contains `app.asar` and must be rewritten to
 * `app.asar.unpacked`. In dev they resolve directly inside node_modules.
 */
function unpacked(p: string): string {
  return p.replace('app.asar', 'app.asar.unpacked');
}

export const ffmpegPath: string = unpacked(ffmpegStatic as unknown as string);
export const ffprobePath: string = unpacked(ffprobeStatic.path);
