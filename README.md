# AutoReel

**Turn a voiceover + a pile of visuals + AI timecode instructions into a finished, synced video — automatically.**

AutoReel automates the tedious part of faceless / narration-style video editing: dropping dozens of images or short clips onto a timeline at exact timestamps, adding motion, and adding transitions. Instead of placing 50 visuals by hand in a video editor, you:

1. Drop in your **voiceover audio**.
2. Add your **visuals** (images or short AI clips) in order.
3. Paste the **placement instructions** your AI already gives you
   (`visual 1: 00:00 – 00:56`, `virtual 2 till 01:03`, …).
4. Pick **motion** (slow zoom, Ken Burns, pan, random) and **transitions**
   (fade, wipe, slide, circle, pixelize… random or fixed).
5. **Export** at up to 4K, H.264 or ProRes.

Everything is rendered with a bundled **ffmpeg** — nothing else to install.

---

## The workflow it fits

```
script  →  voiceover (TTS)  →  transcript/timecodes  →  AI gives visual placements
                                                              │
                                       generate visuals (images / 6–8s clips)
                                                              │
                                                     ┌────────▼────────┐
                                                     │    AutoReel     │  ← you are here
                                                     │  audio+visuals+ │
                                                     │  instructions → │
                                                     │  animated,      │
                                                     │  transitioned,  │
                                                     │  exported video │
                                                     └─────────────────┘
```

## Instruction formats understood

The parser is deliberately forgiving. All of these work:

```
visual 1: 00:00 - 00:56
virtual one is from 00:00 to 00:56
virtual 2 is till 01:03
Visual 3 till 01:40
4) 1:40 - 2:10
00:00 - 00:10          (auto-numbered in order)
```

- Timecodes may be `SS`, `MM:SS`, or `HH:MM:SS` (with optional `.ms`).
- A line with only an **end** time (`till 01:03`) starts where the previous
  visual ended.
- The last visual always runs to the end of the audio.
- No instructions at all → visuals are spread evenly across the audio.

## Motion (per visual)

`ken-burns` · `zoom-in` · `zoom-out` · `zoom-in-out` · `pan-left` · `pan-right`
· `random` · `none`. Rendered with ffmpeg's `zoompan` on an oversized frame for
smooth, jitter-free movement. (Video clips play as-is.)

## Transitions (between visuals)

40+ styles mapped to ffmpeg `xfade`: fades, wipes, slides, smooth slides,
circle/rect crops, opens/closes, diagonals, slices, pixelize, radial, blur,
zoom, squeeze, wind. Choose one style, or **random per cut**, or **hard cut**.
Crossfade duration is adjustable and auto-clamped to the shortest segment.

---

## Install & run (development)

Requires Node 18+.

```bash
npm install          # downloads Electron + the bundled ffmpeg/ffprobe binaries
npm run dev          # launch the desktop app
```

> In restricted/offline environments the ffmpeg binary download may be blocked.
> On a normal machine `npm install` fetches it automatically.

### Build a distributable app

```bash
npm run dist         # packaged app in ./release (dmg / nsis / AppImage)
```

## Use it from the command line

No GUI needed — the same engine runs headless:

```bash
npm run build:cli    # bundles the CLI to dist/cli.mjs (once)

node dist/cli.mjs \
  --audio voice.mp3 \
  --visuals ./images \
  --instructions script.txt \
  --out reel.mp4 \
  --animation ken-burns \
  --transition random \
  --transition-duration 0.5 \
  --quality high \
  --size 1920x1080 --fps 30
```

`--visuals` accepts a folder (files are natural-sorted: `img2` before `img10`)
or a comma-separated list. Run `node dist/cli.mjs --help` for all options.
During development you can also run it directly: `npm run cli -- --help`.

---

## How it works

```
src/
  engine/           Platform-agnostic core (unit-tested)
    parseInstructions.ts   timecode text  → structured instructions
    timeline.ts            instructions + visuals + audio length → segments
    animations.ts          per-clip zoompan (Ken Burns) filter builder
    transitions.ts         the xfade transition library
    ffmpegGraph.ts         builds the full ffmpeg filter_complex + args
    render.ts / ffprobe.ts spawn the bundled ffmpeg / ffprobe
  main/             Electron main process (dialogs, IPC, invokes the engine)
  preload/          Safe contextBridge API exposed to the UI
  renderer/         React UI (sources · instructions · timeline · export)
  cli/              Headless command-line front end to the same engine
  shared/           Types shared across the main/renderer boundary
```

The renderer never touches Node or ffmpeg directly; it sends a request over IPC
and the main process builds the timeline and runs the render, streaming progress
back.

### Timeline / transition math

Each non-final clip is rendered `duration + T` long (T = crossfade) so it has a
tail to blend into the next clip. Each `xfade` `offset` is the cumulative start
time of the next segment, which keeps the total output length exactly equal to
the audio — so audio and visuals never drift.

## Testing & typecheck

```bash
npm test             # engine unit tests (parser, timeline, ffmpeg graph)
npm run typecheck    # node + web TypeScript projects
```

## Roadmap

The core assembly pipeline is complete. Planned next:

- **Real-time WebGL scrubbing preview** in the app (currently: computed timeline
  + render-to-file).
- **Custom transition designer** — build your own transitions from shapes,
  opacity, blending, twist and zoom, save them as bundles, and import short
  overlay clips as transitions.
- **Per-visual** animation/transition overrides in the UI (the engine already
  supports per-segment settings).
- Effects/color adjustments and text/caption overlays.

## License

MIT
