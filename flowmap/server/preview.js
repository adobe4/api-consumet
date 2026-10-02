// Link previews and research cards: title, picture and site for any link; for videos and posts (YouTube,
// TikTok, Instagram...) also the numbers: views, likes, comments, when it was posted, length.
// Only public http(s) addresses are fetched: never this server, the local network or cloud metadata.
import dns from 'node:dns/promises';
import net from 'node:net';
import { HttpError } from './models.js';
import { parseCount } from './scan.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const MAX_HTML = 1_500_000;

function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:127.') || v.startsWith('::ffff:10.') || v.startsWith('::ffff:192.168.');
}
export async function safeUrl(raw, lookup = dns.lookup) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { throw new HttpError(400, 'That is not a link'); }
  if (!/^https?:$/.test(u.protocol)) throw new HttpError(400, 'Only http and https links can be previewed');
  if (u.username || u.password) throw new HttpError(400, 'Links with a password in them are not previewed');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i.test(host)) throw new HttpError(400, 'That address is not public');
  const ips = net.isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => { throw new HttpError(400, 'That site could not be found'); })).map((x) => x.address);
  if (!ips.length || ips.some(privateIp)) throw new HttpError(400, 'That address is not public');
  return u;
}
// fetch with redirects checked one by one, so a public link cannot bounce to a private address
async function getPage(url, { fetchImpl = fetch, lookup, json = false } = {}) {
  let u = await safeUrl(url, lookup);
  for (let hop = 0; hop < 5; hop++) {
    const r = await fetchImpl(u.toString(), { redirect: 'manual', headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'CONSENT=YES+1; SOCS=CAI', Accept: json ? 'application/json' : 'text/html,application/xhtml+xml' }, signal: AbortSignal.timeout(12000) });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { u = await safeUrl(new URL(r.headers.get('location'), u).toString(), lookup); continue; }
    const reader = r.body?.getReader?.();
    let text = '';
    if (reader) {
      const dec = new TextDecoder();
      for (;;) { const { done, value } = await reader.read(); if (done) break; text += dec.decode(value, { stream: true }); if (text.length > MAX_HTML) { reader.cancel().catch(() => {}); break; } }
    } else text = (await r.text()).slice(0, MAX_HTML);
    return { status: r.status, ok: r.ok, text, url: u.toString() };
  }
  throw new HttpError(400, 'Too many redirects');
}
const dec = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).trim();
function metaTags(html, base) {
  const out = {};
  for (const m of html.matchAll(/<meta\s+[^>]*>/gi)) {
    const tag = m[0];
    const key = (tag.match(/(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i) || [])[1];
    const val = (tag.match(/content\s*=\s*["']([^"']*)["']/i) || [])[1];
    if (key && val !== undefined && !(key.toLowerCase() in out)) out[key.toLowerCase()] = dec(val);
  }
  const title = dec((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
  const abs = (v) => { try { return v ? new URL(v, base).toString() : ''; } catch { return ''; } };
  return {
    title: out['og:title'] || out['twitter:title'] || title,
    description: out['og:description'] || out['twitter:description'] || out.description || '',
    image: abs(out['og:image'] || out['og:image:url'] || out['twitter:image'] || out['twitter:image:src']),
    site: out['og:site_name'] || '',
    posted: out['article:published_time'] || out.uploaddate || out.datepublished || '',
    raw: out,
  };
}
const jsonAfter = (html, marker) => {
  const i = html.indexOf(marker);
  if (i < 0) return null;
  const start = html.indexOf('{', i);
  let depth = 0, inStr = false, esc = false;
  for (let j = start; j < html.length; j++) {
    const c = html[j];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === '{') depth++; else if (c === '}' && --depth === 0) { try { return JSON.parse(html.slice(start, j + 1)); } catch { return null; } }
  }
  return null;
};
const isoDuration = (s) => { const m = String(s || '').match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/); return m ? (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0) : null; };
const num = (v) => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

export function platformOf(url) {
  let h = '';
  try { h = new URL(url).hostname.replace(/^www\.|^m\./, ''); } catch { return null; }
  if (/(^|\.)youtube\.com$|^youtu\.be$/.test(h)) return 'youtube';
  if (/(^|\.)tiktok\.com$/.test(h)) return 'tiktok';
  if (/(^|\.)instagram\.com$/.test(h)) return 'instagram';
  if (/(^|\.)(x|twitter)\.com$/.test(h)) return 'x';
  if (/(^|\.)facebook\.com$|^fb\.watch$/.test(h)) return 'facebook';
  if (/(^|\.)vimeo\.com$/.test(h)) return 'vimeo';
  return null;
}
export function youtubeId(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1, 12) || null;
    if (u.searchParams.get('v')) return u.searchParams.get('v').slice(0, 11);
    const m = u.pathname.match(/^\/(?:shorts|live|embed|v)\/([\w-]{11})/);
    return m ? m[1] : null;
  } catch { return null; }
}

async function youtube(url, { youtubeKey, fetchImpl, lookup }) {
  const id = youtubeId(url);
  if (!id) return null;
  const card = { platform: 'youtube', kind: 'media', url: `https://www.youtube.com/watch?v=${id}`, videoId: id, image: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, short: /\/shorts\//.test(url) };
  if (youtubeKey) {
    try {
      const r = await (fetchImpl || fetch)(`https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${id}&key=${encodeURIComponent(youtubeKey)}`, { signal: AbortSignal.timeout(12000) });
      const v = (await r.json()).items?.[0];
      if (v) return { ...card, title: v.snippet.title, author: v.snippet.channelTitle, description: String(v.snippet.description || '').slice(0, 300), image: v.snippet.thumbnails?.maxres?.url || v.snippet.thumbnails?.high?.url || card.image, posted: v.snippet.publishedAt, views: num(v.statistics.viewCount), likes: num(v.statistics.likeCount), comments: num(v.statistics.commentCount), duration: isoDuration(v.contentDetails?.duration), via: 'api' };
    } catch { /* the page and oEmbed below still work */ }
  }
  try {
    const r = await getPage(card.url, { fetchImpl, lookup });
    const p = jsonAfter(r.text, 'ytInitialPlayerResponse');
    const vd = p?.videoDetails, mf = p?.microformat?.playerMicroformatRenderer;
    if (vd?.title) {
      const likes = r.text.match(/"label":"([\d,.]+[KMB]?) likes?"/) || r.text.match(/like this video along with ([\d,]+) other/);
      return { ...card, title: vd.title, author: vd.author, description: String(vd.shortDescription || '').slice(0, 300), posted: mf?.publishDate || mf?.uploadDate || '', views: num(vd.viewCount), likes: likes ? parseCount(likes[1]) : null, duration: num(vd.lengthSeconds), via: 'page' };
    }
  } catch { /* fall through to oEmbed */ }
  const r = await getPage(`https://www.youtube.com/oembed?url=${encodeURIComponent(card.url)}&format=json`, { fetchImpl, lookup, json: true });
  const o = JSON.parse(r.text);
  return { ...card, title: o.title, author: o.author_name, via: 'oembed', note: 'YouTube shared only the title. Add a YouTube API key in Settings for views and dates.' };
}
async function tiktok(url, { fetchImpl, lookup }) {
  const card = { platform: 'tiktok', kind: 'media', url };
  try {
    const r = await getPage(url, { fetchImpl, lookup });
    const m = r.text.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application\/json">([\s\S]*?)<\/script>/);
    const it = m && JSON.parse(m[1]).__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct;
    if (it) {
      const st = it.statsV2 || it.stats || {};
      return { ...card, url: r.url, title: it.desc, author: it.author?.nickname || it.author?.uniqueId, image: it.video?.cover || it.video?.originCover, posted: it.createTime ? new Date(Number(it.createTime) * 1000).toISOString() : '', views: num(st.playCount), likes: num(st.diggCount), comments: num(st.commentCount), shares: num(st.shareCount), duration: num(it.video?.duration), via: 'page' };
    }
  } catch { /* oEmbed below */ }
  const r = await getPage(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, { fetchImpl, lookup, json: true });
  const o = JSON.parse(r.text);
  return { ...card, title: o.title, author: o.author_name, image: o.thumbnail_url, via: 'oembed', note: 'TikTok shared only the title and picture right now.' };
}
// Instagram and Facebook put the numbers in the description: "1,234 likes, 56 comments - name on March 3, 2024: ..."
function socialFromMeta(platform, m, url) {
  const d = m.description || '';
  const likes = d.match(/([\d.,]+[KMB]?)\s+likes?/i), comments = d.match(/([\d.,]+[KMB]?)\s+comments?/i), views = d.match(/([\d.,]+[KMB]?)\s+(?:views|plays)/i);
  const on = d.match(/ on ([A-Z][a-z]+ \d{1,2}, \d{4})/);
  const who = d.match(/comments? - ([^ ]+) on /) || (m.title || '').match(/^(.+?) (?:on Instagram|\| Facebook)/);
  return { platform, kind: 'media', url, title: (d.split(': ').slice(1).join(': ') || m.title || '').replace(/^"|"$/g, '').slice(0, 300), author: who ? who[1] : m.site, image: m.image, posted: on ? new Date(`${on[1]} UTC`).toISOString() : m.posted, views: views ? parseCount(views[1]) : null, likes: likes ? parseCount(likes[1]) : null, comments: comments ? parseCount(comments[1]) : null, via: 'page' };
}

const cache = new Map();
export async function linkPreview(raw, { youtubeKey, fetchImpl, lookup, fresh = false } = {}) {
  const url = (await safeUrl(raw, lookup)).toString();
  const hit = cache.get(url);
  if (!fresh && hit && Date.now() - hit.at < 20 * 60 * 1000) return hit.data;
  const platform = platformOf(url);
  const opts = { youtubeKey, fetchImpl, lookup };
  let data = null;
  if (platform === 'youtube') data = await youtube(url, opts);
  else if (platform === 'tiktok') data = await tiktok(url, opts);
  if (!data) {
    const r = await getPage(url, opts);
    if (!r.ok) throw new HttpError(502, `The site answered ${r.status}`);
    const m = metaTags(r.text, r.url);
    data = platform === 'instagram' || platform === 'facebook' ? socialFromMeta(platform, m, r.url)
      : { platform: platform || 'web', kind: platform ? 'media' : 'link', url: r.url, title: m.title, description: m.description.slice(0, 300), image: m.image, site: m.site || new URL(r.url).hostname.replace(/^www\./, ''), posted: m.posted };
  }
  data = { ...data, title: String(data.title || '').slice(0, 300), fetchedAt: new Date().toISOString() };
  cache.set(url, { at: Date.now(), data });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return data;
}
