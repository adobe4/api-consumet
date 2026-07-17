# AutoReel (Android)

**A portrait, CapCut-style mobile app that assembles a synced video from a voiceover, a pile of visuals, and AI timecode instructions — with a live GPU preview and a custom transition designer.**

You already have the workflow: script → voiceover → transcript → an AI tells you *which visual goes at which timecode*. AutoReel does the last, tedious step automatically:

1. Add your **voiceover audio**.
2. Add your **visuals** (images / short clips) in order.
3. Paste the **AI placement instructions** (`visual 1: 00:00 – 00:56`, `virtual 2 till 01:03`, …).
4. **Watch it play** — a real-time GPU preview with zoom motion and transitions.
5. **Design your own transitions** (dissolve, slide, zoom, twist, softness, direction) and save them.
6. **Export** the finished video.

## 📲 Getting the APK

Every push to the working branch builds an installable APK automatically via
**GitHub Actions** — you don't need Android Studio or any tooling.

1. Open the repo's **Actions** tab on GitHub.
2. Click the latest **Build Android APK** run.
3. Download the **`autoreel-debug-apk`** artifact at the bottom.
4. Copy `app-debug.apk` to your phone and install it (allow "install from unknown sources").

You can also trigger a build manually: Actions → *Build Android APK* → **Run workflow**.

## Features in this build

- **Instruction parser** — forgiving timecode formats: `visual 1: 00:00 - 00:56`,
  `virtual 2 till 01:03`, worded numbers, enumerations, auto-numbering. Empty = spread evenly.
- **Auto timeline** — every visual placed at its exact second, synced to the audio, gap-free.
- **Real-time preview** — `react-native-skia` renders the reel on the GPU: per-visual zoom/pan
  (Ken Burns, zoom in/out, pan, random) and live cross-transitions, scrubbable timeline, play/pause.
- **Transition designer** — a parameterised SkSL shader (dissolve · slide · direction · zoom ·
  twist · edge softness) with a looping live preview; save your creations and use them per cut,
  or pick **random per cut**.
- **Portrait-first** — 9:16 by default (also 4K/1:1/16:9), the CapCut-mobile layout.

> **On-device export** builds the exact ffmpeg render command from the shared engine and lands
> in the next build (the mobile ffmpeg executor is being wired). Preview and the designer are
> fully functional now.

## Architecture

```
src/
  engine/            Pure, unit-tested core (shared, no UI/native deps)
    parseInstructions.ts   timecode text  → structured instructions
    timeline.ts            instructions + visuals + audio → segments
    animations.ts          zoompan (Ken Burns) filter builder
    transitions.ts         xfade transition library
    ffmpegGraph.ts         builds the full ffmpeg render command (used by export)
    media.ts / rng.ts
  app/
    state/             ProjectContext — audio, visuals, instructions, derived timeline
    preview/           Skia preview: frame math, SkSL transition shader, playhead
    components/        Slider, chips, timeline strip, visual rows, transition preview
    screens/           EditorScreen (assemble) · DesignerScreen (transition designer)
    native/            export.ts — builds the render command (executor added next build)
App.tsx                Editor / Transitions tabs
```

The **engine** is platform-agnostic TypeScript and is the same code the preview,
the designer, and the exporter all build on — so the render always matches what you saw.

## Develop locally (optional)

Requires Node 18+. For a device/emulator you also need Android Studio.

```bash
npm install
npm run android        # build & run on a connected device / emulator
# or
npm start              # Metro + Expo dev server
```

## Tests & typecheck

```bash
npm test               # 41 unit tests (parser, timeline, ffmpeg graph, preview math)
npm run typecheck
```

Both also run in CI before every APK build.

## License

MIT
