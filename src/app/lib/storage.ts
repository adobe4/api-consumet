import * as FileSystem from 'expo-file-system';

const MEDIA_DIR = FileSystem.documentDirectory + 'vinei-media/';

async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(MEDIA_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(MEDIA_DIR, { intermediates: true });
}

/**
 * Copy a picked file into the app's private storage so it survives app
 * restarts and gallery/cache clearing. Picker URIs (content:// or cache file://)
 * are not guaranteed to persist; the returned file:// URI is stable.
 */
export async function persistMedia(uri: string, filename: string): Promise<string> {
  try {
    await ensureDir();
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const dest = `${MEDIA_DIR}${Date.now()}_${Math.floor(Math.random() * 1e6)}_${safe}`;
    await FileSystem.copyAsync({ from: uri, to: dest });
    return dest;
  } catch {
    // If the copy fails, fall back to the original URI (still works this session).
    return uri;
  }
}

/**
 * Delete a previously persisted media file. Only touches files inside our own
 * media directory — never the user's originals.
 */
export async function deletePersistedMedia(uri: string): Promise<void> {
  if (!uri.startsWith(MEDIA_DIR)) return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // Best effort.
  }
}
