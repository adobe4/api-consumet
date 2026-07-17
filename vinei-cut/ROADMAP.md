# Vinei Cut — feature matrix & roadmap

Legend: ✅ done (v0.1) · 🟡 partial/stub · ⬜ planned

## Core editing
| Feature | State | Notes |
|---|---|---|
| Multi-track timeline (video/overlay/text/audio) | ✅ | Data model + UI lanes |
| Import media (bulk, no-permission photo picker) | ✅ | |
| Import audio | ✅ | |
| Playhead scrub / seek | ✅ | |
| Zoom timeline | ✅ | |
| Split / trim | ✅ / 🟡 | Split done; drag-trim handles ⬜ |
| Duplicate / delete | ✅ | |
| Move / drag clips | 🟡 | `moveSelected` in VM; drag gesture ⬜ |
| Grouping | 🟡 | Model supports `groupId`; UI ⬜ |
| Undo / redo | ⬜ | Phase 4 |

## Bulk / automatic (the reason Vinei Cut exists)
| Feature | State |
|---|---|
| Transcript → timestamp cues (SRT + loose) | ✅ |
| Align N media to cues (more/fewer/none) | ✅ |
| Audio-length drives total duration | ✅ |
| Ken-Burns slow zoom auto-applied to photos | ✅ |
| Auto-transitions between aligned clips | ⬜ (Phase 2) |

## Creative tools (Phase 2)
Text (color, gradient, background, stroke, shadow, fonts) · Overlays / PIP · Stickers ·
Transitions library · In/out animations · Speed & reverse · Volume & audio fades ·
Blend modes UI.

## Render engine (Phase 3 — OpenGL ES / GLSL)
Blur · Grain · **Chroma key** · Adjust (brightness/contrast/saturation/hue/sharpen) ·
Masks & shapes · Vignette · Keyframes driving exported frames · preview == export parity.

## Import / export / project (Phase 4)
Fonts · stickers · sound-effects packs · project save/load + autosave · thumbnail cache ·
HD/60fps export presets · watermark-free high-bitrate output.

---

### Why phased?
A believable CapCut/Premiere-class editor is a multi-person, multi-year effort. This repo
builds it in honest, shippable increments: a correct engine and data model first, the
unique bulk workflow next, then the GPU compositor that makes effects preview and export
match. Each phase leaves a working, installable APK.
