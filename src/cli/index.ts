#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, extname, basename } from 'node:path';
import {
  parseInstructions,
  buildTimeline,
  render,
  probeDuration,
  detectKind,
  isKnownTransition,
} from '../engine/index';
import type { AnimationKind, QualityPreset, Visual } from '../engine/index';

interface Args {
  audio?: string;
  visuals?: string;
  instructions?: string;
  out?: string;
  animation: AnimationKind;
  transition: string;
  transitionDuration: number;
  quality: QualityPreset;
  fps: number;
  width: number;
  height: number;
  seed?: number;
}

const MEDIA_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.tif', '.tiff', '.heic', '.avif',
  '.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v', '.mpg', '.mpeg',
]);

function parseArgs(argv: string[]): Args {
  const a: Args = {
    animation: 'ken-burns',
    transition: 'random',
    transitionDuration: 0.5,
    quality: 'high',
    fps: 30,
    width: 1920,
    height: 1080,
  };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const val = argv[i + 1];
    switch (key) {
      case '--audio': a.audio = val; i++; break;
      case '--visuals': a.visuals = val; i++; break;
      case '--instructions': a.instructions = val; i++; break;
      case '--out': a.out = val; i++; break;
      case '--animation': a.animation = val as AnimationKind; i++; break;
      case '--transition': a.transition = val; i++; break;
      case '--transition-duration': a.transitionDuration = parseFloat(val); i++; break;
      case '--quality': a.quality = val as QualityPreset; i++; break;
      case '--fps': a.fps = parseInt(val, 10); i++; break;
      case '--size': {
        const [w, h] = val.split('x').map((n) => parseInt(n, 10));
        a.width = w; a.height = h; i++; break;
      }
      case '--seed': a.seed = parseInt(val, 10); i++; break;
      case '-h': case '--help': printHelp(); process.exit(0);
    }
  }
  return a;
}

function printHelp(): void {
  console.log(`
AutoReel — assemble a synced video from audio + ordered visuals + timecodes.

Usage:
  autoreel --audio voice.mp3 --visuals ./images --instructions script.txt --out reel.mp4 [options]

Required:
  --audio <file>          Voiceover / narration audio track
  --visuals <dir|list>    A folder of images/clips, or a comma-separated list, in order
  --out <file>            Output video path (.mp4 or .mov)

Optional:
  --instructions <file>   Text with timecodes ("visual 1: 00:00 - 00:56", "virtual 2 till 01:03").
                          If omitted, visuals are spread evenly across the audio.
  --animation <kind>      none | zoom-in | zoom-out | zoom-in-out | pan-left | pan-right |
                          ken-burns | random         (default: ken-burns)
  --transition <style>    An xfade name (fade, dissolve, wipeleft, circleopen, pixelize, ...),
                          or 'random', or 'cut'       (default: random)
  --transition-duration <s>   Crossfade length in seconds (default: 0.5)
  --quality <preset>      high | max | prores         (default: high)
  --fps <n>               Output frame rate (default: 30)
  --size <WxH>            Output resolution (default: 1920x1080)
  --seed <n>              Seed for reproducible random choices
`);
}

function collectVisuals(spec: string): Visual[] {
  const abs = resolve(spec);
  let files: string[];
  if (statSync(abs).isDirectory()) {
    files = readdirSync(abs)
      .filter((f) => MEDIA_EXTS.has(extname(f).toLowerCase()))
      .sort(naturalCompare)
      .map((f) => join(abs, f));
  } else {
    files = spec.split(',').map((s) => resolve(s.trim())).filter(Boolean);
  }
  return files.map((path, i) => ({
    id: `v${i + 1}`,
    path,
    kind: detectKind(path),
    name: basename(path),
  }));
}

/** Sort so "img2" comes before "img10". */
function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.audio || !args.visuals || !args.out) {
    printHelp();
    console.error('Error: --audio, --visuals and --out are required.\n');
    process.exit(1);
  }
  if (args.transition !== 'random' && args.transition !== 'cut' && !isKnownTransition(args.transition)) {
    console.error(`Warning: unknown transition "${args.transition}", falling back to fade.`);
  }

  const visuals = collectVisuals(args.visuals);
  if (visuals.length === 0) throw new Error('No visuals found.');
  console.log(`Found ${visuals.length} visual(s).`);

  const audioDuration = await probeDuration(resolve(args.audio));
  console.log(`Audio duration: ${audioDuration.toFixed(2)}s`);

  const instructions = args.instructions
    ? parseInstructions(readFileSync(resolve(args.instructions), 'utf8'))
    : [];
  if (instructions.length) console.log(`Parsed ${instructions.length} instruction(s).`);

  const timeline = buildTimeline({
    visuals,
    instructions,
    audioDuration,
    fps: args.fps,
    width: args.width,
    height: args.height,
    animation: args.animation,
    seed: args.seed,
  });

  console.log('\nTimeline:');
  for (const s of timeline.segments) {
    console.log(
      `  #${s.index + 1} ${s.visual.name ?? s.visual.path}  ` +
        `${fmt(s.start)} → ${fmt(s.end)}  (${s.duration.toFixed(1)}s, ${s.animation})`,
    );
  }

  console.log('\nRendering...');
  const { done } = render(
    {
      audioPath: resolve(args.audio),
      timeline,
      outPath: resolve(args.out),
      transition: args.transition,
      transitionDuration: args.transitionDuration,
      quality: args.quality,
      seed: args.seed,
    },
    (p) => {
      const pct = Math.round(p.progress * 100);
      process.stdout.write(`\r  ${pct}%  (${p.outTime.toFixed(1)}s${p.speed ? `, ${p.speed}` : ''})   `);
    },
  );
  await done;
  console.log(`\nDone → ${resolve(args.out)}`);
}

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

main().catch((err) => {
  console.error('\n' + (err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
