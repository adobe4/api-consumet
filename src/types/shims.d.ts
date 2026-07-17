// Ambient declarations for the bundled binary packages. These resolve to real
// static ffmpeg/ffprobe executables at runtime on the user's machine; the
// declarations only exist so the project typechecks in environments where the
// native binaries cannot be downloaded.

declare module 'ffmpeg-static' {
  const path: string;
  export default path;
}

declare module 'ffprobe-static' {
  export const path: string;
  const _default: { path: string };
  export default _default;
}
