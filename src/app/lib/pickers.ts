import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Audio } from 'expo-av';
import { detectKind } from '../../engine';
import type { AudioTrack, UIVisual } from '../types';
import { mapWithConcurrency } from './async';
import { persistMedia } from './storage';

let counter = 0;
const uid = () => `v${Date.now()}-${counter++}`;

/**
 * Pick one or more images / short clips from the gallery, in one sheet.
 * Never throws — a failure returns whatever was imported successfully.
 * Files are copied into private storage with limited concurrency so a bulk
 * import of 50+ items stays smooth instead of spiking memory and IO.
 */
export async function pickVisuals(): Promise<UIVisual[]> {
  try {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return [];
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      allowsMultipleSelection: true,
      quality: 1,
      orderedSelection: true,
    });
    if (res.canceled) return [];

    const visuals = await mapWithConcurrency(res.assets, 3, async (a) => {
      const name = a.fileName ?? a.uri.split('/').pop() ?? 'visual';
      try {
        const uri = await persistMedia(a.uri, name);
        return {
          id: uid(),
          uri,
          kind: detectKind(name, a.mimeType),
          name,
          width: a.width,
          height: a.height,
        } as UIVisual;
      } catch {
        return null;
      }
    });
    return visuals.filter((v): v is UIVisual => v != null);
  } catch {
    return [];
  }
}

/** Pick a voiceover audio file and read its duration. Never throws. */
export async function pickAudio(): Promise<AudioTrack | null> {
  try {
    const res = await DocumentPicker.getDocumentAsync({
      type: 'audio/*',
      copyToCacheDirectory: true,
    });
    if (res.canceled || res.assets.length === 0) return null;
    const asset = res.assets[0];
    const name = asset.name ?? asset.uri.split('/').pop() ?? 'audio';
    const duration = await readAudioDuration(asset.uri);
    const uri = await persistMedia(asset.uri, name);
    return { uri, name, duration };
  } catch {
    return null;
  }
}

/** Load audio just long enough to read its duration, then unload. */
export async function readAudioDuration(uri: string): Promise<number> {
  const { sound, status } = await Audio.Sound.createAsync({ uri }, { shouldPlay: false });
  try {
    const ms = status.isLoaded ? status.durationMillis ?? 0 : 0;
    return ms / 1000;
  } finally {
    await sound.unloadAsync();
  }
}
