import React, { createContext, useContext, useMemo, useState, useCallback } from 'react';
import { parseInstructions, buildTimeline } from '../../engine';
import type { Timeline } from '../../engine/types';
import {
  DEFAULT_SETTINGS,
  type AudioTrack,
  type CustomTransition,
  type ProjectSettings,
  type UIVisual,
} from '../types';

interface ProjectState {
  audio: AudioTrack | null;
  visuals: UIVisual[];
  instructions: string;
  settings: ProjectSettings;
  customTransitions: CustomTransition[];
  /** Derived timeline (recomputed when inputs change). */
  timeline: Timeline;

  setAudio: (a: AudioTrack | null) => void;
  addVisuals: (v: UIVisual[]) => void;
  removeVisual: (id: string) => void;
  reorderVisuals: (from: number, to: number) => void;
  clearVisuals: () => void;
  setInstructions: (t: string) => void;
  updateSettings: (patch: Partial<ProjectSettings>) => void;
  addCustomTransition: (t: CustomTransition) => void;
}

const ProjectContext = createContext<ProjectState | null>(null);

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [audio, setAudio] = useState<AudioTrack | null>(null);
  const [visuals, setVisuals] = useState<UIVisual[]>([]);
  const [instructions, setInstructions] = useState('');
  const [settings, setSettings] = useState<ProjectSettings>(DEFAULT_SETTINGS);
  const [customTransitions, setCustomTransitions] = useState<CustomTransition[]>([]);

  const timeline = useMemo<Timeline>(() => {
    const audioDuration = audio?.duration ?? 0;
    return buildTimeline({
      visuals: visuals.map((v) => ({ id: v.id, path: v.uri, kind: v.kind, name: v.name })),
      instructions: parseInstructions(instructions),
      audioDuration,
      fps: settings.fps,
      width: settings.width,
      height: settings.height,
      animation: settings.animation,
      seed: settings.seed,
    });
  }, [audio, visuals, instructions, settings.fps, settings.width, settings.height, settings.animation, settings.seed]);

  const addVisuals = useCallback((v: UIVisual[]) => setVisuals((cur) => [...cur, ...v]), []);
  const removeVisual = useCallback((id: string) => setVisuals((cur) => cur.filter((x) => x.id !== id)), []);
  const clearVisuals = useCallback(() => setVisuals([]), []);
  const reorderVisuals = useCallback((from: number, to: number) => {
    setVisuals((cur) => {
      if (to < 0 || to >= cur.length) return cur;
      const next = [...cur];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }, []);
  const updateSettings = useCallback(
    (patch: Partial<ProjectSettings>) => setSettings((s) => ({ ...s, ...patch })),
    [],
  );
  const addCustomTransition = useCallback(
    (t: CustomTransition) => setCustomTransitions((cur) => [...cur.filter((x) => x.id !== t.id), t]),
    [],
  );

  const value = useMemo<ProjectState>(
    () => ({
      audio, visuals, instructions, settings, customTransitions, timeline,
      setAudio, addVisuals, removeVisual, reorderVisuals, clearVisuals,
      setInstructions, updateSettings, addCustomTransition,
    }),
    [audio, visuals, instructions, settings, customTransitions, timeline,
      addVisuals, removeVisual, reorderVisuals, clearVisuals, updateSettings, addCustomTransition],
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject(): ProjectState {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProject must be used within a ProjectProvider');
  return ctx;
}
