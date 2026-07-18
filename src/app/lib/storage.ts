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
    const dest = `${MEDIA_DIR}${Date.now()}_${safe}`;
    await FileSystem.copyAsync({ from: uri, to: dest });
    return dest;
  } catch {
    // If the copy fails, fall back to the original URI (still works this session).
    return uri;
  }
}
