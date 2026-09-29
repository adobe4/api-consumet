// Reads public numbers from a channel link. Each scanner returns plain data; server/sync.js turns it into logs.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function getText(url, { fetchImpl = fetch, timeout = 15000, headers = {} } = {}) {
  const r = await fetchImpl(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'CONSENT=YES+1; SOCS=CAI', ...headers },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeout),
  });
  return { status: r.status, ok: r.ok, text: await r.text(), url: r.url || url };
}

// "21.3M" -> 21300000, "829 thousand" -> 829000, "12,345" -> 12345
export function parseCount(s) {
  if (s === undefined || s === null) return null;
  const m = String(s).replace(/,/g, '').match(/([\d.]+)\s*(k|m|b|thousand|million|billion)?/i);
  if (!m) return /no views/i.test(s) ? 0 : null;
  const mult = { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, b: 1e9, billion: 1e9 }[(m[2] || '').toLowerCase()] || 1;
  return Math.round(parseFloat(m[1]) * mult);
}
// "5 hours ago" / "Streamed 3 days ago" -> hours
export function parseAgeHours(s) {
  const m = String(s || '').match(/(\d+)\s*(second|minute|hour|day|week|month|year)/i);
  if (!m) return null;
  const per = { second: 1 / 3600, minute: 1 / 60, hour: 1, day: 24, week: 168, month: 730, year: 8760 }[m[2].toLowerCase()];
  return Number(m[1]) * per;
}
const jsonAfter = (html, marker) => {
  const i = html.indexOf(marker);
  if (i < 0) return null;
  const start = html.indexOf('{', i);
  // walk braces so a "};" inside a string does not end the object early
  let depth = 0, inStr = false, esc = false;
  for (let j = start; j < html.length; j++) {
    const c = html[j];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) { try { return JSON.parse(html.slice(start, j + 1)); } catch { return null; } }
  }
  return null;
};
function walk(o, fn) {
  if (!o || typeof o !== 'object') return;
  if (fn(o) === false) return;
  for (const k in o) walk(o[k], fn);
}

// ---------- YouTube ----------
function youtubeChannelPath(url) {
  const u = new URL(url);
  if (u.hostname === 'youtu.be' || u.pathname.startsWith('/watch') || u.pathname.startsWith('/shorts/')) throw new Error('This is a video link. Paste the channel link instead (youtube.com/@yourchannel).');
  const m = u.pathname.match(/^\/(@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)/);
  if (!m) throw new Error('Paste the channel link, like youtube.com/@yourchannel');
  return m[1];
}

async function youtubeApi(url, key, opts) {
  const path = youtubeChannelPath(url);
  const api = (p) => getText(`https://www.googleapis.com/youtube/v3/${p}&key=${encodeURIComponent(key)}`, opts).then((r) => {
    const j = JSON.parse(r.text);
    if (j.error) throw new Error(`YouTube API: ${j.error.message}`);
    return j;
  });
  const q = path.startsWith('@') ? `forHandle=${encodeURIComponent(path)}` : path.startsWith('channel/') ? `id=${path.slice(8)}` : `forUsername=${encodeURIComponent(path.split('/')[1])}`;
  const ch = (await api(`channels?part=snippet,statistics,contentDetails&${q}`)).items?.[0];
  if (!ch) throw new Error('Channel not found');
  const uploads = ch.contentDetails.relatedPlaylists.uploads;
  const items = (await api(`playlistItems?part=contentDetails&maxResults=30&playlistId=${uploads}`)).items || [];
  const ids = items.map((i) => i.contentDetails.videoId).join(',');
  const vids = ids ? (await api(`videos?part=snippet,statistics&id=${ids}`)).items || [] : [];
  return {
    via: 'api', channelId: ch.id, title: ch.snippet.title,
    subscribers: Number(ch.statistics.subscriberCount) || null, totalViews: Number(ch.statistics.viewCount) || null, videoCount: Number(ch.statistics.videoCount) || null,
    recent: vids.map((v) => ({ id: v.id, title: v.snippet.title, views: Number(v.statistics.viewCount) || 0, publishedAt: v.snippet.publishedAt })),
  };
}

async function youtubePage(url, opts) {
  const path = youtubeChannelPath(url);
  const r = await getText(`https://www.youtube.com/${path}/videos`, opts);
  if (r.status === 404) throw new Error('Channel not found');
  const data = jsonAfter(r.text, 'var ytInitialData');
  if (!data) throw new Error('YouTube did not return the channel page (try again later, or add a YouTube API key in Settings)');
  const meta = data.metadata?.channelMetadataRenderer || {};
  const header = JSON.stringify(data.header || {});
  const subs = header.match(/([\d.,]+[KMB]?) subscribers/);
  const count = header.match(/([\d.,]+[KMB]?) videos?"/);
  const now = Date.now();
  const recent = [];
  walk(data, (o) => {
    if (o.lockupViewModel) {
      const l = o.lockupViewModel;
      const parts = [];
      walk(l.metadata, (x) => { if (x.metadataParts) { parts.push(...x.metadataParts); return false; } });
      const labels = parts.map((p) => p.accessibilityLabel || p.text?.content || '');
      const viewsLabel = labels.find((s) => /views?$/i.test(s) || /no views/i.test(s));
      const ageLabel = labels.find((s) => /ago$/i.test(s));
      const hours = parseAgeHours(ageLabel);
      if (l.contentId && hours !== null) recent.push({ id: l.contentId, title: l.metadata?.lockupMetadataViewModel?.title?.content || '', views: parseCount(viewsLabel) ?? 0, publishedAt: new Date(now - hours * 3600000).toISOString(), approx: true });
      return false;
    }
    if (o.videoRenderer) {
      const v = o.videoRenderer;
      const hours = parseAgeHours(v.publishedTimeText?.simpleText);
      if (hours !== null) recent.push({ id: v.videoId, title: v.title?.runs?.[0]?.text || '', views: parseCount(v.viewCountText?.simpleText) ?? 0, publishedAt: new Date(now - hours * 3600000).toISOString(), approx: true });
      return false;
    }
  });
  return {
    via: 'page', channelId: meta.externalId || null, title: meta.title || '',
    subscribers: subs ? parseCount(subs[1]) : null, totalViews: null, videoCount: count ? parseCount(count[1]) : null, recent,
  };
}

// ---------- TikTok ----------
async function tiktok(url, opts) {
  const u = new URL(url);
  const handle = u.pathname.match(/^\/(@[^/?]+)/)?.[1];
  if (!handle) throw new Error('Paste the profile link, like tiktok.com/@yourname');
  const r = await getText(`https://www.tiktok.com/${handle}`, opts);
  const m = r.text.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application\/json">([\s\S]*?)<\/script>/);
  let d;
  try { d = m && JSON.parse(m[1]).__DEFAULT_SCOPE__?.['webapp.user-detail']; } catch { d = null; }
  const stats = d?.userInfo?.statsV2 || d?.userInfo?.stats;
  if (!stats) throw new Error('TikTok did not share this profile right now (it blocks some servers). Log the numbers in Check-in instead.');
  return {
    title: d.userInfo.user?.nickname || handle,
    followers: Number(stats.followerCount) || 0,
    likes: Number(stats.heartCount ?? stats.heart) || 0,
    videoCount: Number(stats.videoCount) || 0,
  };
}

// ---------- Play Store ----------
async function playstore(url, opts) {
  const id = new URL(url).searchParams.get('id');
  if (!id) throw new Error('Paste the app page link (it contains ?id=...)');
  const r = await getText(`https://play.google.com/store/apps/details?id=${encodeURIComponent(id)}&hl=en`, opts);
  if (r.status === 404) throw new Error('App not found on the Play Store');
  const rating = r.text.match(/aria-label="Rated ([\d.]+) stars/);
  const installs = r.text.match(/>([\d.,]+[KMB]?\+)<\/div><div[^>]*>Downloads/) || r.text.match(/>([\d.,]+[KMB]?\+)</);
  const title = r.text.match(/<title[^>]*>([^<]+?)(?: - Apps on Google Play)?<\/title>/);
  return { title: title?.[1] || id, rating: rating ? Number(rating[1]) : null, installs: installs ? installs[1] : null, installsMin: installs ? parseCount(installs[1]) : null };
}

// ---------- Website ----------
const decode = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
export function parseFeed(xml) {
  const items = [];
  for (const m of xml.matchAll(/<(item|entry)[\s>]([\s\S]*?)<\/\1>/g)) {
    const body = m[2];
    const date = body.match(/<(pubDate|published|updated|dc:date)>([^<]+)<\/\1>/)?.[2];
    const t = date ? Date.parse(date.trim()) : NaN;
    if (!Number.isNaN(t)) items.push({ title: decode(body.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1]), publishedAt: new Date(t).toISOString() });
  }
  return items;
}
async function website(url, opts) {
  const t0 = Date.now();
  let r;
  try { r = await getText(url, opts); } catch (e) { return { up: false, status: 0, ms: Date.now() - t0, reason: e.name === 'TimeoutError' ? 'timed out' : 'unreachable' }; }
  const ms = Date.now() - t0;
  const out = { up: r.ok, status: r.status, ms, title: decode(r.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]).slice(0, 120) };
  const isFeed = /^\s*(<\?xml[^>]*>\s*)?<(rss|feed)[\s>]/.test(r.text);
  let feedUrl = isFeed ? url : null;
  if (!feedUrl) {
    const link = r.text.match(/<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*>/i)?.[0];
    const href = link?.match(/href=["']([^"']+)["']/i)?.[1];
    if (href) feedUrl = new URL(decode(href), r.url).toString();
  }
  if (feedUrl) {
    try {
      const f = isFeed ? r : await getText(feedUrl, opts);
      out.feed = feedUrl;
      out.recent = parseFeed(f.text).slice(0, 30);
    } catch { /* feed is optional */ }
  }
  return out;
}

export async function scanSource(src, { youtubeKey, fetchImpl } = {}) {
  const opts = { fetchImpl };
  try {
    let data;
    if (src.platform === 'youtube') {
      data = youtubeKey ? await youtubeApi(src.url, youtubeKey, opts).catch(() => youtubePage(src.url, opts)) : await youtubePage(src.url, opts);
    } else if (src.platform === 'tiktok') data = await tiktok(src.url, opts);
    else if (src.platform === 'playstore') data = await playstore(src.url, opts);
    else if (src.platform === 'website') {
      data = await website(src.url, opts);
      if (!data.up) return { ok: false, data, error: `Site is down (${data.status || data.reason})` };
    } else return { ok: false, data: {}, error: 'This platform cannot be read automatically. Log its numbers in Check-in.' };
    return { ok: true, data, error: '' };
  } catch (e) {
    return { ok: false, data: {}, error: e.name === 'TimeoutError' ? 'The site took too long to answer' : String(e.message || e).slice(0, 300) };
  }
}
