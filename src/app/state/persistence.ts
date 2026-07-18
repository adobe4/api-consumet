import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AnimationKind } from '../../engine/types';
import type { AudioTrack, CustomTransition, ProjectSettings, UIVisual } from '../types';

const KEY = 'vinei.project.v1';

export interface PersistedProject {
  audio: AudioTrack | null;
  visuals: UIVisual[];
  instructions: string;
  settings: ProjectSettings;
  customTransitions: CustomTransition[];
  animationOverrides?: Record<string, AnimationKind>;
  transitionOverrides?: Record<string, string>;
}

export async function loadProject(): Promise<PersistedProject | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PersistedProject) : null;
  } catch {
    return null;
  }
}

export async function saveProject(project: PersistedProject): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(project));
  } catch {
    // Best-effort; ignore write failures.
  }
}
