import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Audio } from 'expo-av';
import { detectKind } from '../../engine';
import type { AudioTrack, UIVisual } from '../types';
import { persistMedia } from './storage';

let counter = 0;
const uid = () => `v${Date.now()}-${counter++}`;

/** Pick one or more images / short clips from the gallery, in one sheet. */
export async function pickVisuals(): Promise<UIVisual[]> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return [];
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images', 'videos'],
    allowsMultipleSelection: true,
    quality: 1,
    orderedSelection: true,
  });
  if (res.canceled) return [];
  // Copy each pick into private storage so the project survives restarts.
  return Promise.all(
    res.assets.map(async (a) => {
      const name = a.fileName ?? a.uri.split('/').pop() ?? 'visual';
      const uri = await persistMedia(a.uri, name);
      return {
        id: uid(),
        uri,
        kind: detectKind(name, a.mimeType),
        name,
        width: a.width,
        height: a.height,
      };
    }),
  );
}

/** Pick a voiceover audio file and read its duration. */
export async function pickAudio(): Promise<AudioTrack | null> {
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
