import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'vinei.exportlog.v1';

export interface ExportLogEntry {
  t: number;
  step: string;
}

/**
 * Append a breadcrumb and AWAIT the write, so it is flushed to disk before the
 * next (possibly app-crashing) native call runs. After a native crash the last
 * breadcrumb reveals exactly which step died.
 */
export async function appendExportLog(step: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const arr: ExportLogEntry[] = raw ? JSON.parse(raw) : [];
    arr.push({ t: Date.now(), step });
    await AsyncStorage.setItem(KEY, JSON.stringify(arr.slice(-30)));
  } catch {
    /* ignore */
  }
}

export async function readExportLog(): Promise<ExportLogEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ExportLogEntry[]) : [];
  } catch {
    return [];
  }
}

export async function clearExportLog(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
