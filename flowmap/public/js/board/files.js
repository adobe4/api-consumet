// Files on boards. Images and text files are uploaded to the account (shrunk first when large);
// videos stay on this device only (IndexedDB), so a board shows them here and a placeholder elsewhere.
import { api } from '../api.js';

const blobCache = new Map(); // fileId -> Promise<objectURL>
export function fileUrl(fileId, share) {
  const key = share ? `${share.token}:${fileId}` : String(fileId);
  if (!blobCache.has(key)) {
    const url = share ? `/api/share/${share.token}/files/${fileId}?viewer=${encodeURIComponent(share.viewer)}` : `/api/board-files/${fileId}`;
    const p = (share ? fetch(url).then((r) => r.json()) : api('GET', url)).then((f) => {
      if (!f?.data) throw new Error(f?.error || 'File not available');
      const bin = atob(f.data), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return URL.createObjectURL(new Blob([bytes], { type: f.mime }));
    });
    p.catch(() => blobCache.delete(key));
    blobCache.set(key, p);
  }
  return blobCache.get(key);
}
export async function fileText(fileId, share) {
  const u = await fileUrl(fileId, share);
  return (await fetch(u)).text();
}

const toBase64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });

// large photos are resized to at most 1800px and re-encoded, so they fit the 1.5 MB limit
async function shrinkImage(file) {
  if (file.size < 900_000 || file.type === 'image/gif' || file.type === 'image/svg+xml') return file;
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  for (const q of [0.86, 0.75, 0.62, 0.5]) {
    const b = await new Promise((res) => c.toBlob(res, 'image/jpeg', q));
    if (b && b.size < 1_450_000) return new File([b], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' });
  }
  return file;
}

export async function uploadFile(boardId, file) {
  let f = file;
  if (f.type.startsWith('image/')) f = await shrinkImage(f);
  const mime = f.type || (/\.(md|txt|csv|srt|json)$/i.test(f.name) ? 'text/plain' : '');
  if (f.size > 1_550_000) throw new Error(`${file.name} is larger than 1.5 MB. Use a smaller file, or a link.`);
  const out = await api('POST', `/api/boards/${boardId}/files`, { name: f.name, mime, data: await toBase64(f) });
  blobCache.set(String(out.id), Promise.resolve(URL.createObjectURL(f)));
  return out;
}

// ---------- videos: this device only ----------
const DB = 'flowmap-videos';
const idb = () => new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore('v'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
export async function saveVideo(file) {
  const id = `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const db = await idb();
  await new Promise((res, rej) => { const t = db.transaction('v', 'readwrite'); t.objectStore('v').put(file, id); t.oncomplete = res; t.onerror = () => rej(t.error); });
  return { localId: id, name: file.name, size: file.size };
}
const videoUrls = new Map();
export async function videoUrl(localId) {
  if (videoUrls.has(localId)) return videoUrls.get(localId);
  try {
    const db = await idb();
    const blob = await new Promise((res, rej) => { const r = db.transaction('v').objectStore('v').get(localId); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    if (!blob) return null;
    const u = URL.createObjectURL(blob);
    videoUrls.set(localId, u);
    return u;
  } catch { return null; }
}

export function pickFiles(accept, multiple = false) {
  return new Promise((res) => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = accept; i.multiple = multiple;
    i.onchange = () => res([...(i.files || [])]);
    i.click();
  });
}
