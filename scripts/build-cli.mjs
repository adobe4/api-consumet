// Bundle the CLI into a single portable ESM file at dist/cli.mjs.
// ffmpeg-static / ffprobe-static are kept external so their bundled binaries
// resolve from node_modules at runtime.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/cli/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  outfile: 'dist/cli.mjs',
  external: ['ffmpeg-static', 'ffprobe-static'],
  logLevel: 'info',
});
