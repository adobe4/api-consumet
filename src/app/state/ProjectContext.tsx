import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { parseInstructions, buildTimeline } from '../../engine';
import type { AnimationKind, Timeline } from '../../engine/types';
import {
  DEFAULT_SETTINGS,
  type AudioTrack,
  type CustomTransition,
  type ProjectSettings,
  type UIVisual,
} from '../types';
import { loadProject, saveProject } from './persistence';
import { deletePersistedMedia } from '../lib/storage';

interface ProjectState {
  audio: AudioTrack | null;
  visuals: UIVisual[];
  instructions: string;
  settings: ProjectSettings;
  customTransitions: CustomTransition[];
  /** Per-visual animation override (visual id -> animation). */
  animationOverrides: Record<string, AnimationKind>;
  /** Per-visual "transition into this visual" override (visual id -> style). */
  transitionOverrides: Record<string, string>;
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
  removeCustomTransition: (id: string) => void;
  setAnimationOverride: (visualId: string, anim: AnimationKind | null) => void;
  setTransitionOverride: (visualId: string, style: string | null) => void;
}

const ProjectContext = createContext<ProjectState | null>(null);

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [audio, setAudio] = useState<AudioTrack | null>(null);
  const [visuals, setVisuals] = useState<UIVisual[]>([]);
  const [instructions, setInstructions] = useState('');
  const [settings, setSettings] = useState<ProjectSettings>(DEFAULT_SETTINGS);
  const [customTransitions, setCustomTransitions] = useState<CustomTransition[]>([]);
  const [animationOverrides, setAnimationOverrides] = useState<Record<string, AnimationKind>>({});
  const [transitionOverrides, setTransitionOverrides] = useState<Record<string, string>>({});
  const hydrated = useRef(false);

  // Load the saved project once on startup.
  useEffect(() => {
    let active = true;
    loadProject().then((p) => {
      if (active && p) {
        setAudio(p.audio ?? null);
        setVisuals(p.visuals ?? []);
        setInstructions(p.instructions ?? '');
        setSettings({ ...DEFAULT_SETTINGS, ...(p.settings ?? {}) });
        setCustomTransitions(p.customTransitions ?? []);
        setAnimationOverrides(p.animationOverrides ?? {});
        setTransitionOverrides(p.transitionOverrides ?? {});
      }
      hydrated.current = true;
    });
    return () => {
      active = false;
    };
  }, []);

  // Persist whenever anything meaningful changes (after the initial load).
  // Debounced so fast typing / slider drags don't hammer storage.
  useEffect(() => {
    if (!hydrated.current) return;
    const t = setTimeout(() => {
      saveProject({
        audio,
        visuals,
        instructions,
        settings,
        customTransitions,
        animationOverrides,
        transitionOverrides,
      });
    }, 400);
    return () => clearTimeout(t);
  }, [audio, visuals, instructions, settings, customTransitions, animationOverrides, transitionOverrides]);

  // Mirror of visuals for cleanup side effects outside state updaters.
  const visualsRef = useRef(visuals);
  useEffect(() => {
    visualsRef.current = visuals;
  }, [visuals]);

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
      animationOverrides,
      seed: settings.seed,
    });
  }, [audio, visuals, instructions, settings.fps, settings.width, settings.height, settings.animation, settings.seed, animationOverrides]);

  const addVisuals = useCallback((v: UIVisual[]) => setVisuals((cur) => [...cur, ...v]), []);
  const removeVisual = useCallback((id: string) => {
    const victim = visualsRef.current.find((x) => x.id === id);
    if (victim) deletePersistedMedia(victim.uri);
    setVisuals((cur) => cur.filter((x) => x.id !== id));
    setAnimationOverrides(({ [id]: _drop, ...rest }) => rest);
    setTransitionOverrides(({ [id]: _drop, ...rest }) => rest);
  }, []);
  const clearVisuals = useCallback(() => {
    for (const v of visualsRef.current) deletePersistedMedia(v.uri);
    setVisuals([]);
    setAnimationOverrides({});
    setTransitionOverrides({});
  }, []);
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
  const removeCustomTransition = useCallback(
    (id: string) => setCustomTransitions((cur) => cur.filter((x) => x.id !== id)),
    [],
  );
  const setAnimationOverride = useCallback((visualId: string, anim: AnimationKind | null) => {
    setAnimationOverrides((cur) => {
      if (anim == null) {
        const { [visualId]: _drop, ...rest } = cur;
        return rest;
      }
      return { ...cur, [visualId]: anim };
    });
  }, []);
  const setTransitionOverride = useCallback((visualId: string, style: string | null) => {
    setTransitionOverrides((cur) => {
      if (style == null) {
        const { [visualId]: _drop, ...rest } = cur;
        return rest;
      }
      return { ...cur, [visualId]: style };
    });
  }, []);

  const value = useMemo<ProjectState>(
    () => ({
      audio, visuals, instructions, settings, customTransitions, timeline,
      animationOverrides, transitionOverrides,
      setAudio, addVisuals, removeVisual, reorderVisuals, clearVisuals,
      setInstructions, updateSettings, addCustomTransition, removeCustomTransition,
      setAnimationOverride, setTransitionOverride,
    }),
    [audio, visuals, instructions, settings, customTransitions, timeline,
      animationOverrides, transitionOverrides,
      addVisuals, removeVisual, reorderVisuals, clearVisuals, updateSettings,
      addCustomTransition, removeCustomTransition, setAnimationOverride, setTransitionOverride],
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject(): ProjectState {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProject must be used within a ProjectProvider');
  return ctx;
}
