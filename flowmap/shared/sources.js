// Channel links attached to a project ("sources"), and which platform each one is.
export const PLATFORMS = {
  youtube: { label: 'YouTube', icon: '▶️', scan: 'Views, subscribers and every upload (uploads count as posts)' },
  tiktok: { label: 'TikTok', icon: '🎵', scan: 'Followers, likes and video count (new videos count as posts)' },
  instagram: { label: 'Instagram', icon: '📸', scan: 'Not readable automatically yet: log numbers in Check-in' },
  facebook: { label: 'Facebook', icon: '📘', scan: 'Not readable automatically yet: log numbers in Check-in' },
  whatsapp: { label: 'WhatsApp', icon: '💬', scan: 'Not readable automatically: log numbers in Check-in' },
  playstore: { label: 'Play Store', icon: '📱', scan: 'Rating and install range' },
  website: { label: 'Website', icon: '🌐', scan: 'Up or down, speed, and new posts from its RSS feed' },
};

export function detectPlatform(url) {
  let host;
  try { host = new URL(url).hostname.replace(/^www\.|^m\./, ''); } catch { return null; }
  if (/(^|\.)youtube\.com$|^youtu\.be$/.test(host)) return 'youtube';
  if (/(^|\.)tiktok\.com$/.test(host)) return 'tiktok';
  if (/(^|\.)instagram\.com$/.test(host)) return 'instagram';
  if (/(^|\.)facebook\.com$|^fb\.com$/.test(host)) return 'facebook';
  if (/^wa\.me$|(^|\.)whatsapp\.com$/.test(host)) return 'whatsapp';
  if (host === 'play.google.com') return 'playstore';
  return 'website';
}

// Accepts "youtube.com/@x", "@x" style shorthand is not guessed: a full link (with or without https://) is needed.
export function normalizeUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) throw new Error('empty link');
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  const u = new URL(s);
  if (!u.hostname.includes('.')) throw new Error(`"${raw}" is not a web link`);
  u.hash = '';
  return u.toString();
}

export function normalizeSources(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const url = normalizeUrl(typeof item === 'string' ? item : item?.url);
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ url, platform: detectPlatform(url) });
  }
  return out;
}
