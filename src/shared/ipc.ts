// Types shared across the Electron main <-> renderer boundary. Keep this file
// free of any Node or Electron imports so it can be used from the browser side.

import type { AnimationKind, QualityPreset, VisualKind } from '../engine/types';

export interface UIVisual {
  id: string;
  path: string;
  kind: VisualKind;
  name: string;
}

export interface RenderRequest {
  audioPath: string;
  audioDuration: number;
  visuals: UIVisual[];
  /** Raw instruction text pasted by the user (parsed in main). */
  instructionsText: string;
  outPath: string;
  animation: AnimationKind;
  transition: string;
  transitionDuration: number;
  quality: QualityPreset;
  fps: number;
  width: number;
  height: number;
  seed?: number;
}

export interface TimelinePreviewItem {
  index: number;
  name: string;
  start: number;
  end: number;
  duration: number;
  animation: AnimationKind;
}

export interface RenderProgressMsg {
  progress: number;
  outTime: number;
  fps?: number;
  speed?: string;
}

export interface AutoReelApi {
  pickAudio(): Promise<{ path: string; duration: number } | null>;
  pickVisuals(): Promise<UIVisual[]>;
  pickOutput(defaultName: string): Promise<string | null>;
  previewTimeline(req: RenderRequest): Promise<TimelinePreviewItem[]>;
  startRender(req: RenderRequest): Promise<{ ok: true; outPath: string } | { ok: false; error: string }>;
  cancelRender(): Promise<void>;
  onProgress(cb: (p: RenderProgressMsg) => void): () => void;
  showInFolder(path: string): Promise<void>;
  transitions(): Promise<{ name: string; label: string; group: string }[]>;
}
