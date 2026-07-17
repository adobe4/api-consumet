# Vinei Cut 🎬

A **native Android video editor** built for bulk + automatic workflows, with a
dark Filmora-style vibe and a portrait, CapCut / Motion Ninja–style layout.

Vinei Cut's headline feature is **Bulk Auto-Align**: drop in dozens of images/clips
plus a transcript (or `.srt`) and the audio, and the app lays every clip onto the
timeline so the cuts land on the transcript's timestamps. Instead of hand-placing
56 images against a voice-over, you're left with just adding transitions.

> **Status: v0.1 — working foundation.** This is an honestly-scoped first slice, not
> a finished CapCut clone (that's years of team work). The core engine, data model,
> the flagship alignment feature, the editor UI shell, preview scrubbing and an MP4
> export path are real and building. The advanced creative tools are stubbed in the
> toolbar and filled in over the phases below.

---

## Get the app (APK)

Every push to the dev branch builds a debug APK in CI:

1. Open the repo's **Actions** tab → **Vinei Cut Android** → latest run.
2. Download the **`vinei-cut-debug-apk`** artifact.
3. Unzip and install `app-debug.apk` on your phone (enable "install unknown apps").

Or build it yourself — open the `vinei-cut/` folder in **Android Studio** (Giraffe+),
let it sync, and Run.

---

## What works today (v0.1)

- 📐 **Project model** — portrait 9:16 by default, multi-track (Video / Overlay / Text / Audio),
  clips with trims, transforms, keyframes, effects, blend modes, animations, grouping, text styling.
- ⚡ **Bulk Auto-Align (flagship)** — parse SRT or loose timestamp lines (`1:20 the reveal`),
  distribute N media across the timeline so cuts hit the timestamps. Handles more media than
  cues (subdivides), fewer media than cues (spans), or no transcript (even split). Optional
  slow-zoom (Ken Burns) on photos. **Unit-tested.**
- 🎞️ **Editor UI** — dark portrait layout: preview panel, transport, zoomable multi-track
  timeline with a draggable playhead, and a scrolling CapCut-style tool bar.
- 👁️ **Preview scrubbing** — tap/seek the timeline to see the frame under the playhead
  (video frames decoded on the fly), with the Ken-Burns zoom animated.
- ✂️ **Editing ops** — import media (Android photo picker, no permission prompts), import audio,
  split at playhead, duplicate, delete.
- 📤 **Export** — Media3 `Transformer` composition path that renders the video track + audio
  to an MP4 in the app's movies folder.

## Roadmap

**Phase 2 — creative tools** (the toolbar stubs): text editor (color, gradient, background,
stroke, shadow), overlays/PIP, stickers, transitions library, per-clip animations,
speed/reverse, volume/fades.

**Phase 3 — render engine:** OpenGL ES / GLSL compositor so effects preview *and* export
identically — blur, grain, **chroma key**, adjust (brightness/contrast/saturation/hue),
masks, and keyframed transforms driving the exported frames.

**Phase 4 — pro polish:** import fonts/stickers/sound-effects, project save/load & autosave,
thumbnails cache for smooth scrolling, high-bitrate export presets, undo/redo history.

See `ROADMAP.md` for the detailed feature matrix mapped to CapCut / Motion Ninja / VivaCut.

---

## Architecture

```
vinei-cut/app/src/main/java/com/vineicut/app/
  model/Timeline.kt        # Project · Track · Clip · Keyframe · Effect · TextStyle (immutable, @Serializable)
  engine/
    TranscriptParser.kt    # SRT + loose-timestamp parsing → cues
    TranscriptAligner.kt   # cues + media → positioned clips  (the flagship, pure & tested)
    ExportManager.kt       # Media3 Transformer composition → MP4
  vm/EditorViewModel.kt    # single source of truth: project, playhead, selection, edits
  ui/
    home/HomeScreen.kt
    align/BulkAlignScreen.kt
    editor/EditorScreen.kt · PreviewPanel · TimelinePanel · EditorToolbar · MediaFrame
    theme/                 # dark Filmora-style palette
```

- **Kotlin + Jetpack Compose** (dark, portrait, edge-to-edge).
- **Media3** (ExoPlayer/Transformer) for playback & export — the same stack pro editors use.
- **Coil** (+ video-frame decoder) for thumbnails and preview frames.
- **kotlinx.serialization** for project persistence.
- Min SDK 26 · Target SDK 34 · Compose BOM 2024.06.

## Tech notes / decisions

- **Native, not cross-platform** — a smooth, high-quality editor needs direct GPU + MediaCodec
  access; that's why this is Kotlin/Media3 rather than Flutter/RN.
- The alignment engine is deliberately **pure Kotlin** so it's unit-tested in CI without a device.
- The advanced effects deliberately wait for the Phase-3 GL engine so that **what you preview is
  exactly what you export** — the single most important property of a real editor.
