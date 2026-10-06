// Research and drawing tools for AI agents connected over MCP: the board becomes a second brain. Agents can
// dig into YouTube (channels, videos, niches, keywords) with the owner's YouTube API key, lay what they find
// out on a board as real video cards and notes, draw storyboards and comics, turn a video link into a visual
// breakdown, remember things on a notes board and search everything the boards hold.
import { HttpError } from './models.js';
import { findBoard, createBoard, saveBoard, itemFromSpec, lintBoard } from './boards.js';
import { linkPreview, youtubeId } from './preview.js';
import { makeLink, emptyBoard } from '../shared/board.js';

const parse = (s) => { try { return JSON.parse(s); } catch { return emptyBoard(); } };
const n = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
const clampInt = (v, lo, hi, d) => { const x = Math.round(Number(v)); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d; };
const DAY = 864e5;
const isoSecs = (s) => { const m = String(s || '').match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/); return m ? (Number(m[1] || 0) * 86400) + (Number(m[2] || 0) * 3600) + (Number(m[3] || 0) * 60) + Number(m[4] || 0) : null; };
const ageDays = (iso) => Math.max(1, (Date.now() - new Date(iso).getTime()) / DAY);
const median = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); if (!s.length) return 0; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
const short = (s, k) => (s && s.length > k ? `${s.slice(0, k - 1)}…` : s || '');
const fmt = (v) => { const x = Number(v) || 0; return x >= 1e9 ? `${(x / 1e9).toFixed(1)}B` : x >= 1e6 ? `${(x / 1e6).toFixed(1)}M` : x >= 1e4 ? `${Math.round(x / 1e3)}K` : x >= 1e3 ? `${(x / 1e3).toFixed(1)}K` : String(Math.round(x)); };

// ---------- YouTube Data API ----------
async function yt(key, path, params) {
  if (!key) throw new HttpError(400, 'Add a YouTube API key in FlowMap Settings first (Settings → YouTube API key). It is free from Google Cloud.');
  const qs = new URLSearchParams({ ...params, key });
  const r = await fetch(`https://www.googleapis.com/youtube/v3/${path}?${qs}`, { signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) {
    const msg = j.error?.message || `HTTP ${r.status}`;
    if (/quota/i.test(msg)) throw new HttpError(429, 'The YouTube API quota for today is used up (it resets at midnight Pacific time). Searches cost the most; channel and video reads are cheap.');
    throw new HttpError(502, `YouTube API: ${String(msg).replace(/<[^>]+>/g, '')}`);
  }
  return j;
}
const videoOut = (v) => {
  const views = n(v.statistics?.viewCount), likes = n(v.statistics?.likeCount), comments = n(v.statistics?.commentCount);
  const posted = v.snippet?.publishedAt;
  return {
    id: v.id, url: `https://www.youtube.com/watch?v=${v.id}`, title: v.snippet?.title, channel: v.snippet?.channelTitle, channelId: v.snippet?.channelId,
    posted, ageDays: posted ? Math.round(ageDays(posted)) : null, views, likes, comments, duration: isoSecs(v.contentDetails?.duration),
    viewsPerDay: views != null && posted ? Math.round(views / ageDays(posted)) : null,
    engagement: views ? Math.round(((likes || 0) + (comments || 0)) / views * 10000) / 100 : null,
    thumb: v.snippet?.thumbnails?.maxres?.url || v.snippet?.thumbnails?.high?.url || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
  };
};
async function videosById(key, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const j = await yt(key, 'videos', { part: 'snippet,statistics,contentDetails', id: ids.slice(i, i + 50).join(','), maxResults: 50 });
    out.push(...(j.items || []));
  }
  return out;
}
async function channelsById(key, ids) {
  if (!ids.length) return [];
  const j = await yt(key, 'channels', { part: 'snippet,statistics,contentDetails,brandingSettings', id: [...new Set(ids)].slice(0, 50).join(',') });
  return j.items || [];
}
const channelOut = (c) => ({
  id: c.id, url: c.snippet?.customUrl ? `https://www.youtube.com/${c.snippet.customUrl}` : `https://www.youtube.com/channel/${c.id}`, title: c.snippet?.title, handle: c.snippet?.customUrl || null,
  subscribers: n(c.statistics?.subscriberCount), views: n(c.statistics?.viewCount), videos: n(c.statistics?.videoCount), country: c.snippet?.country || null,
  created: c.snippet?.publishedAt, about: short(c.snippet?.description || '', 400), thumb: c.snippet?.thumbnails?.high?.url || c.snippet?.thumbnails?.default?.url,
  keywords: short(c.brandingSettings?.channel?.keywords || '', 300),
});
// a channel from a link, @handle, channel id or plain name
async function resolveChannel(key, ref) {
  const s = String(ref || '').trim();
  if (!s) throw new HttpError(400, 'Say which channel: a link, @handle, channel id or name');
  let m;
  if ((m = s.match(/(?:youtube\.com\/)?(@[\w.-]+)/))) { const j = await yt(key, 'channels', { part: 'snippet,statistics,contentDetails,brandingSettings', forHandle: m[1] }); if (j.items?.[0]) return j.items[0]; }
  if ((m = s.match(/(UC[\w-]{22})/))) { const [c] = await channelsById(key, [m[1]]); if (c) return c; }
  if (youtubeId(s)) { const [v] = await videosById(key, [youtubeId(s)]); if (v) { const [c] = await channelsById(key, [v.snippet.channelId]); if (c) return c; } }
  const j = await yt(key, 'search', { part: 'snippet', type: 'channel', q: s, maxResults: 1 });
  const id = j.items?.[0]?.snippet?.channelId || j.items?.[0]?.id?.channelId;
  if (!id) throw new HttpError(404, `No YouTube channel found for "${s}"`);
  const [c] = await channelsById(key, [id]);
  return c;
}
async function channelVideos(key, ch, max) {
  const uploads = ch.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) return [];
  const ids = [];
  let token = '';
  while (ids.length < max) {
    const j = await yt(key, 'playlistItems', { part: 'contentDetails', playlistId: uploads, maxResults: 50, ...(token ? { pageToken: token } : {}) });
    ids.push(...(j.items || []).map((i) => i.contentDetails.videoId));
    token = j.nextPageToken;
    if (!token) break;
  }
  return (await videosById(key, ids.slice(0, max))).map(videoOut);
}
// chapters written in the description ("0:00 Intro", "2:15 Step one")
function chaptersOf(desc) {
  const out = [];
  for (const line of String(desc || '').split('\n')) {
    const m = line.match(/^\s*(?:\(|\[)?((?:\d{1,2}:)?\d{1,2}:\d{2})(?:\)|\])?\s*[-–—:|]?\s*(.{2,120})$/);
    if (m) { const p = m[1].split(':').map(Number); out.push({ at: p.reduce((a, x) => a * 60 + x, 0), time: m[1], title: m[2].trim() }); }
  }
  return out.length >= 2 && out[0].at === 0 ? out : [];
}
// words that matter in titles: what the top videos have in common
const STOP = new Set('the a an and or of to in on for with is are how what why this that your you my i me it be from at by as best top new vs video 2024 2025 2026 2027 na ya wa kwa ni za la cha vya kuhusu jinsi gani hii huu hizi kama au bila tu sana'.split(' '));
function topWords(titles, k = 15) {
  const c = new Map();
  for (const t of titles) for (const w of new Set(String(t).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/))) if (w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w)) c.set(w, (c.get(w) || 0) + 1);
  return [...c].sort((a, b) => b[1] - a[1]).slice(0, k).map(([word, count]) => ({ word, count }));
}
// YouTube's own search suggestions: what people type
async function suggest(q, { hl = 'en', gl = '' } = {}) {
  const qs = new URLSearchParams({ client: 'firefox', ds: 'yt', q, hl, ...(gl ? { gl } : {}) });
  const r = await fetch(`https://suggestqueries.google.com/complete/search?${qs}`, { signal: AbortSignal.timeout(8000) });
  const t = await r.text();
  try { const j = JSON.parse(t); return Array.isArray(j?.[1]) ? j[1].map(String) : []; } catch { return []; }
}

// ---------- laying things out on a board ----------
// the board to draw on: an existing one by id or name, or a new one with that name
async function boardFor(db, uid, ref, { icon = '🔎', create = true } = {}) {
  if (ref !== undefined && ref !== null && ref !== '') {
    try { const r = await findBoard(db, uid, ref); return { r, d: parse(r.data), fresh: false }; } catch (e) { if (!create || /^\d+$/.test(String(ref))) throw e; }
  }
  const b = await createBoard(db, uid, { name: String(ref || 'Research').slice(0, 80), icon });
  const r = await findBoard(db, uid, b.id);
  return { r, d: parse(r.data), fresh: true };
}
// a free spot to the right of everything on the board
function freeOrigin(d) {
  const items = (d.items || []).filter((i) => i.type !== 'ink');
  if (!items.length) return { x: 0, y: 0 };
  return { x: Math.max(...items.map((i) => i.x + i.w)) + 200, y: Math.min(...items.map((i) => i.y)) };
}
async function commit(db, uid, r, d, made, links = []) {
  for (const it of made) d.items.push(it);
  for (const l of links) d.links.push(l);
  await saveBoard(db, uid, r.id, { data: d });
  const check = lintBoard(d, new Set(made.map((i) => i.id)));
  return { board: r.id, name: r.name, added: made.length, ids: made.map((i) => i.id), ...(check.length ? { designCheck: check.slice(0, 10) } : {}) };
}
const spec = (o, at) => itemFromSpec(o, at);

// ---------- the tools ----------
const BOARD_ARG = { type: 'string', description: 'Board id or name. A name that does not exist yet makes a new board with that name.' };
export const RESEARCH_TOOLS = [
  { name: 'youtube_search', description: 'Search YouTube with the owner\'s API key: videos (with views, likes, comments, age, views per day, engagement %) or channels (with subscribers and total views). Use it to find what works in a niche, competitors and outliers. Costs 100 quota units per call (about 100 searches a day), so search with intent.',
    input_schema: { type: 'object', properties: {
      query: { type: 'string' }, kind: { type: 'string', enum: ['video', 'channel'] }, order: { type: 'string', enum: ['relevance', 'viewCount', 'date', 'rating'] },
      max: { type: 'number', description: '1-25, default 15' }, region: { type: 'string', description: 'Country code, e.g. TZ, KE, US' }, language: { type: 'string', description: 'Language code, e.g. sw, en' },
      within_days: { type: 'number', description: 'Only videos posted in the last N days' }, length: { type: 'string', enum: ['any', 'short', 'medium', 'long'], description: 'short < 4 min (Shorts), medium 4-20, long > 20' },
    }, required: ['query'] },
    run: async ({ youtubeKey }, a) => {
      const kind = a.kind === 'channel' ? 'channel' : 'video';
      const params = { part: 'snippet', type: kind, q: String(a.query).slice(0, 200), maxResults: clampInt(a.max, 1, 25, 15), order: ['relevance', 'viewCount', 'date', 'rating'].includes(a.order) ? a.order : 'relevance' };
      if (a.region) params.regionCode = String(a.region).slice(0, 2).toUpperCase();
      if (a.language) params.relevanceLanguage = String(a.language).slice(0, 5);
      if (kind === 'video' && Number(a.within_days) > 0) params.publishedAfter = new Date(Date.now() - Number(a.within_days) * DAY).toISOString();
      if (kind === 'video' && ['short', 'medium', 'long'].includes(a.length)) params.videoDuration = a.length;
      const s = await yt(youtubeKey, 'search', params);
      if (kind === 'channel') {
        const chs = await channelsById(youtubeKey, (s.items || []).map((i) => i.id?.channelId || i.snippet?.channelId).filter(Boolean));
        return { query: a.query, channels: chs.map(channelOut) };
      }
      const vids = (await videosById(youtubeKey, (s.items || []).map((i) => i.id?.videoId).filter(Boolean))).map(videoOut);
      const chs = new Map((await channelsById(youtubeKey, vids.map((v) => v.channelId))).map((c) => [c.id, n(c.statistics?.subscriberCount)]));
      for (const v of vids) { v.channelSubscribers = chs.get(v.channelId) ?? null; v.viewsPerSubscriber = v.channelSubscribers ? Math.round((v.views / v.channelSubscribers) * 10) / 10 : null; }
      return { query: a.query, videos: vids };
    } },
  { name: 'youtube_channel', description: 'Dig into one YouTube channel (link, @handle, id or name): subscribers, total views, how often it uploads, median views of recent videos, its best videos, views per subscriber, and its recent or top uploads with full numbers.',
    input_schema: { type: 'object', properties: { channel: { type: 'string' }, videos: { type: 'string', enum: ['recent', 'top'], description: 'recent uploads, or the best of the last 100' }, max: { type: 'number', description: '1-50, default 20' } }, required: ['channel'] },
    run: async ({ youtubeKey }, a) => {
      const ch = await resolveChannel(youtubeKey, a.channel);
      const want = clampInt(a.max, 1, 50, 20);
      let vids = await channelVideos(youtubeKey, ch, a.videos === 'top' ? 100 : want);
      const recent = vids.slice(0, 30);
      const span = recent.length > 1 ? (new Date(recent[0].posted) - new Date(recent[recent.length - 1].posted)) / DAY : 0;
      const med = median(recent.map((v) => v.views));
      if (a.videos === 'top') vids = vids.sort((x, y) => (y.views || 0) - (x.views || 0)).slice(0, want);
      const info = channelOut(ch);
      return {
        channel: info,
        pace: { uploadsPerWeek: span ? Math.round((recent.length - 1) / span * 7 * 10) / 10 : null, lastUpload: recent[0]?.posted || null, medianViewsRecent: med, medianViewsPerSubscriber: info.subscribers ? Math.round(med / info.subscribers * 100) / 100 : null, shortsShare: recent.length ? Math.round(recent.filter((v) => v.duration && v.duration <= 60).length / recent.length * 100) : null },
        outliers: recent.filter((v) => med && v.views > med * 3).map((v) => ({ title: v.title, url: v.url, views: v.views, timesMedian: Math.round(v.views / med * 10) / 10 })),
        titleWords: topWords(recent.map((v) => v.title), 12),
        videos: vids,
      };
    } },
  { name: 'youtube_video', description: 'Everything about one YouTube video from its link: title, full description, tags, chapters, numbers (views, likes, comments, views per day, engagement), length, the channel and its size, thumbnails (also frames from the start, middle and end of the video), and top comments.',
    input_schema: { type: 'object', properties: { url: { type: 'string' }, comments: { type: 'number', description: 'How many top comments, 0-30 (default 10)' } }, required: ['url'] },
    run: async ({ youtubeKey }, a) => {
      const id = youtubeId(String(a.url || ''));
      if (!id) throw new HttpError(400, 'That is not a YouTube video link');
      const [v] = await videosById(youtubeKey, [id]);
      if (!v) throw new HttpError(404, 'Video not found (it may be private or removed)');
      const out = videoOut(v);
      const [c] = await channelsById(youtubeKey, [v.snippet.channelId]);
      let comments = [];
      const k = clampInt(a.comments, 0, 30, 10);
      if (k) try { comments = ((await yt(youtubeKey, 'commentThreads', { part: 'snippet', videoId: id, order: 'relevance', maxResults: k, textFormat: 'plainText' })).items || []).map((t) => ({ by: t.snippet.topLevelComment.snippet.authorDisplayName, text: short(t.snippet.topLevelComment.snippet.textDisplay, 400), likes: t.snippet.topLevelComment.snippet.likeCount, replies: t.snippet.totalReplyCount })); } catch { comments = []; }
      return {
        ...out, description: short(v.snippet.description || '', 4000), tags: v.snippet.tags || [], category: v.snippet.categoryId, language: v.snippet.defaultAudioLanguage || v.snippet.defaultLanguage || null,
        chapters: chaptersOf(v.snippet.description), channel: c ? channelOut(c) : { title: v.snippet.channelTitle },
        viewsPerSubscriber: c?.statistics?.subscriberCount ? Math.round(out.views / Number(c.statistics.subscriberCount) * 10) / 10 : null,
        frames: { start: `https://i.ytimg.com/vi/${id}/1.jpg`, middle: `https://i.ytimg.com/vi/${id}/2.jpg`, end: `https://i.ytimg.com/vi/${id}/3.jpg`, cover: out.thumb },
        comments,
      };
    } },
  { name: 'keyword_ideas', description: 'Keyword ideas from YouTube\'s own search suggestions (what people actually type), for a seed word in a language and country. expand: also try the seed followed by each letter, for many more long-tail ideas. Free: no API quota.',
    input_schema: { type: 'object', properties: { seed: { type: 'string' }, language: { type: 'string', description: 'e.g. sw, en' }, region: { type: 'string', description: 'e.g. TZ' }, expand: { type: 'boolean' }, questions: { type: 'boolean', description: 'Also try how/why/what/jinsi/kwa nini in front of the seed' } }, required: ['seed'] },
    run: async (_ctx, a) => {
      const seed = String(a.seed || '').trim().slice(0, 80);
      if (!seed) throw new HttpError(400, 'Give a seed word');
      const o = { hl: String(a.language || 'en').slice(0, 5), gl: String(a.region || '').slice(0, 2).toUpperCase() };
      const asks = [seed];
      if (a.expand) for (const ch of 'abcdefghijklmnoprstuwyz') asks.push(`${seed} ${ch}`);
      if (a.questions) for (const qw of o.hl.startsWith('sw') ? ['jinsi ya', 'kwa nini', 'nini', 'namna ya'] : ['how to', 'why', 'what is', 'best']) asks.push(`${qw} ${seed}`);
      const seen = new Map();
      for (let i = 0; i < asks.length; i += 6) {
        const batch = await Promise.all(asks.slice(i, i + 6).map((q) => suggest(q, o).catch(() => [])));
        batch.forEach((list, j) => list.forEach((s, rank) => { const cur = seen.get(s); const score = (asks[i + j] === seed ? 30 : 10) - rank; if (!cur || cur.score < score) seen.set(s, { phrase: s, score, from: asks[i + j] }); }));
      }
      const ideas = [...seen.values()].filter((x) => x.phrase.toLowerCase() !== seed.toLowerCase()).sort((x, y) => y.score - x.score).slice(0, 120).map(({ phrase, from }) => ({ phrase, from }));
      return { seed, language: o.hl, region: o.gl || null, ideas, note: ideas.length ? 'Top ideas come straight from the seed; the rest are long-tail. Check demand with youtube_search or niche_report.' : 'YouTube gave no suggestions for this seed. Try a shorter or more common word.' };
    } },
  { name: 'niche_report', description: 'Size up a niche or keyword: the top videos for it (recent or all time), how big their channels are, median views, views per day, how many small channels break through (a sign of opportunity), common title words, typical length, and a simple opportunity score from 0 to 100. Costs about 102 quota units.',
    input_schema: { type: 'object', properties: { query: { type: 'string' }, region: { type: 'string' }, language: { type: 'string' }, within_days: { type: 'number', description: 'Only videos from the last N days (default 365)' }, max: { type: 'number', description: '5-25, default 20' } }, required: ['query'] },
    run: async ({ youtubeKey }, a) => {
      const days = clampInt(a.within_days, 1, 3650, 365);
      const params = { part: 'snippet', type: 'video', q: String(a.query).slice(0, 200), maxResults: clampInt(a.max, 5, 25, 20), order: 'viewCount', publishedAfter: new Date(Date.now() - days * DAY).toISOString() };
      if (a.region) params.regionCode = String(a.region).slice(0, 2).toUpperCase();
      if (a.language) params.relevanceLanguage = String(a.language).slice(0, 5);
      const s = await yt(youtubeKey, 'search', params);
      const vids = (await videosById(youtubeKey, (s.items || []).map((i) => i.id?.videoId).filter(Boolean))).map(videoOut);
      if (!vids.length) return { query: a.query, videos: [], note: 'No videos found. Try a broader word or a longer time window.' };
      const subs = new Map((await channelsById(youtubeKey, vids.map((v) => v.channelId))).map((c) => [c.id, n(c.statistics?.subscriberCount) || 0]));
      for (const v of vids) { v.channelSubscribers = subs.get(v.channelId) ?? null; v.viewsPerSubscriber = v.channelSubscribers ? Math.round(v.views / v.channelSubscribers * 10) / 10 : null; }
      const small = vids.filter((v) => (v.channelSubscribers ?? 0) < 10000);
      const breakouts = vids.filter((v) => v.viewsPerSubscriber != null && v.viewsPerSubscriber >= 3);
      const medViews = median(vids.map((v) => v.views)), medPerDay = median(vids.map((v) => v.viewsPerDay)), medSubs = median(vids.map((v) => v.channelSubscribers));
      const channels = new Set(vids.map((v) => v.channelId)).size;
      // demand (views per day), openness (small channels and breakouts), freshness (recent hits), spread (many channels, not one giant)
      const demand = Math.min(1, Math.log10(1 + medPerDay) / 4);
      const openness = Math.min(1, (small.length / vids.length) * 0.6 + (breakouts.length / vids.length) * 0.8);
      const fresh = vids.filter((v) => v.ageDays <= 90).length / vids.length;
      const spread = channels / vids.length;
      const score = Math.round((demand * 0.4 + openness * 0.35 + fresh * 0.1 + spread * 0.15) * 100);
      return {
        query: a.query, window: `last ${days} days`, opportunity: score,
        verdict: score >= 65 ? 'Strong: real demand and small channels win here' : score >= 45 ? 'Promising: demand is there; stand out with better titles and thumbnails' : score >= 30 ? 'Crowded or quiet: pick a narrower angle' : 'Weak: little demand or dominated by big channels',
        numbers: { videos: vids.length, channels, medianViews: medViews, medianViewsPerDay: medPerDay, medianChannelSubscribers: medSubs, smallChannelShare: Math.round(small.length / vids.length * 100), breakouts: breakouts.length, medianLengthMinutes: Math.round(median(vids.map((v) => v.duration)) / 60) },
        titleWords: topWords(vids.map((v) => v.title)), breakouts: breakouts.slice(0, 8).map((v) => ({ title: v.title, url: v.url, views: v.views, channelSubscribers: v.channelSubscribers, viewsPerSubscriber: v.viewsPerSubscriber })),
        videos: vids,
      };
    } },
  { name: 'research_to_board', description: 'Lay research out on a board as a section you can read and present: a title, real video cards (thumbnail, title, channel, views, likes, comments, age) for YouTube/TikTok/Instagram links, channel cards with their numbers, keyword chips, findings on paper notes, and an optional verdict. Use it after youtube_search / youtube_channel / niche_report so the owner sees what you found.',
    input_schema: { type: 'object', properties: {
      board: BOARD_ARG, title: { type: 'string' }, verdict: { type: 'string', description: 'One or two sentences: the conclusion' },
      videos: { type: 'array', items: { type: 'string' }, description: 'Video or post links (up to 24)' },
      channels: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, url: { type: 'string' }, subscribers: { type: 'number' }, views: { type: 'number' }, videos: { type: 'number' }, note: { type: 'string' } } }, description: 'Channels with their numbers (from youtube_channel)' },
      keywords: { type: 'array', items: { type: 'string' } }, findings: { type: 'array', items: { type: 'string' }, description: 'Short findings or ideas, one per note' },
      columns: { type: 'number', description: 'Cards per row, 2-6 (default 4)' },
    }, required: ['title'] },
    run: async ({ db, uid, youtubeKey }, a) => {
      const { r, d } = await boardFor(db, uid, a.board || a.title, { icon: '🔎' });
      const at = freeOrigin(d);
      const cols = clampInt(a.columns, 2, 6, 4), CW = 300, CH = 300, G = 30, P = 50;
      const videos = (Array.isArray(a.videos) ? a.videos : []).map(String).slice(0, 24);
      const cards = await Promise.all(videos.map((u) => linkPreview(u, { youtubeKey }).catch((e) => ({ url: u, error: e.message }))));
      const made = [];
      let y = P + 70;
      const inner = [];
      inner.push(spec({ type: 'text', x: P, y: P - 10, w: cols * (CW + G) - G, h: 60, text: String(a.title).slice(0, 120), style: { size: 40, bold: true, align: 'left', family: 'display' } }, at));
      if (a.verdict) { inner.push(spec({ type: 'card', x: P, y, w: cols * (CW + G) - G, h: 100, title: 'Verdict', text: String(a.verdict).slice(0, 600), color: '#2fb4a0', style: { finish: 'tinted', size: 18 } }, at)); y += 130; }
      cards.forEach((c, i) => {
        const x = P + (i % cols) * (CW + G), yy = y + Math.floor(i / cols) * (CH + G);
        const it = spec({ type: 'media', x, y: yy, w: CW, h: CH, url: c.url }, at);
        it.data = { ...it.data, url: c.url, platform: c.platform, title: c.title, author: c.author, views: c.views ?? null, likes: c.likes ?? null, comments: c.comments ?? null, shares: c.shares ?? null, posted: c.posted || '', duration: c.duration || null, image: c.image || '', ...(c.error ? { error: c.error } : {}), ...(c.note ? { note: c.note } : {}) };
        inner.push(it);
      });
      if (cards.length) y += Math.ceil(cards.length / cols) * (CH + G) + 10;
      const chs = Array.isArray(a.channels) ? a.channels.slice(0, 12) : [];
      chs.forEach((c, i) => {
        const x = P + (i % cols) * (CW + G), yy = y + Math.floor(i / cols) * 170;
        const lines = [c.subscribers != null && `👥 ${fmt(c.subscribers)} subscribers`, c.views != null && `👁 ${fmt(c.views)} views`, c.videos != null && `🎬 ${fmt(c.videos)} videos`, c.note].filter(Boolean).join('\n');
        inner.push(spec({ type: 'card', x, y: yy, w: CW, h: 140, title: String(c.title || 'Channel').slice(0, 80), text: lines, color: '#ff8a5c', style: { finish: 'tinted' } }, at));
      });
      if (chs.length) y += Math.ceil(chs.length / cols) * 170 + 10;
      const kws = Array.isArray(a.keywords) ? a.keywords.map(String).slice(0, 30) : [];
      if (kws.length) {
        inner.push(spec({ type: 'text', x: P, y, w: 400, h: 34, text: 'Keywords', style: { size: 20, bold: true, align: 'left' } }, at));
        y += 44;
        let x = P, rowY = y;
        for (const k of kws) {
          const w = Math.min(360, 40 + k.length * 10);
          if (x + w > P + cols * (CW + G) - G) { x = P; rowY += 58; }
          inner.push(spec({ type: 'shape', shape: 'pill', x, y: rowY, w, h: 44, text: k, color: '#e8b86b', style: { finish: 'solid', size: 15, bold: true } }, at));
          x += w + 12;
        }
        y = rowY + 70;
      }
      const notes = Array.isArray(a.findings) ? a.findings.map(String).slice(0, 16) : [];
      notes.forEach((t, i) => {
        const x = P + (i % cols) * (CW + G), yy = y + Math.floor(i / cols) * 230;
        inner.push(spec({ type: 'note', x, y: yy, w: CW, h: 200, text: t.slice(0, 400), paper: ['sticky', 'lined', 'index', 'kraft'][i % 4], pin: 'tape', rot: [-2, 1.5, -1, 2][i % 4], color: ['#ffd54a', '#fff7e0', '#f5f1ea', '#c9a27e'][i % 4], style: { size: 18, hand: true } }, at));
      });
      if (notes.length) y += Math.ceil(notes.length / cols) * 230;
      const frame = spec({ type: 'frame', x: 0, y: 0, w: cols * (CW + G) - G + P * 2, h: y + P, title: String(a.title).slice(0, 80), color: '#2fb4a0', style: { finish: 'soft', shadow: 'raised' } }, at);
      frame.z = Math.min(0, ...d.items.map((i) => i.z || 0)) - 1;
      made.push(frame, ...inner);
      return commit(db, uid, r, d, made);
    } },
  { name: 'make_storyboard', description: 'Draw a storyboard or a comic on a board. Storyboard: numbered panels with the picture area (an image link, or a sketch description on paper), shot type, what happens, dialogue and timing, like a film or video plan. Comic: panels with thick ink borders, speech bubbles and caption boxes. Each panel can be presented as a slide. Images must be https links (for example YouTube thumbnails from youtube_video).',
    input_schema: { type: 'object', properties: {
      board: BOARD_ARG, title: { type: 'string' }, style: { type: 'string', enum: ['storyboard', 'comic'] }, columns: { type: 'number', description: '1-4 (default 3)' }, slides: { type: 'boolean', description: 'Make every panel a slide (default true for storyboards)' },
      panels: { type: 'array', items: { type: 'object', properties: {
        scene: { type: 'string', description: 'What we see (also the sketch text when there is no image)' }, image: { type: 'string', description: 'https image link' },
        shot: { type: 'string', description: 'e.g. Close-up, Wide, Over the shoulder, B-roll, Screen recording' }, dialogue: { type: 'array', items: { type: 'object', properties: { who: { type: 'string' }, text: { type: 'string' } } } },
        caption: { type: 'string', description: 'Narration or caption box' }, duration: { type: 'string', description: 'e.g. 0:00-0:05' }, notes: { type: 'string' },
      } } },
    }, required: ['title', 'panels'] },
    run: async ({ db, uid }, a) => {
      const comic = a.style === 'comic';
      const { r, d } = await boardFor(db, uid, a.board || a.title, { icon: comic ? '💥' : '🎬' });
      const at = freeOrigin(d);
      const panels = (Array.isArray(a.panels) ? a.panels : []).slice(0, 40);
      if (!panels.length) throw new HttpError(400, 'Give at least one panel');
      const cols = clampInt(a.columns, 1, 4, comic ? 2 : 3);
      const PW = comic ? 560 : 520, PH = comic ? 460 : 560, G = comic ? 26 : 50, P = 60;
      const made = [], slideIds = [];
      const head = spec({ type: 'text', x: P, y: 30, w: cols * (PW + G), h: 70, text: String(a.title).slice(0, 120), style: { size: comic ? 54 : 44, bold: true, align: 'left', family: comic ? 'marker' : 'display' } }, at);
      made.push(head);
      panels.forEach((p, i) => {
        const px = P + (i % cols) * (PW + G), py = 130 + Math.floor(i / cols) * (PH + G);
        const o = { x: at.x + px, y: at.y + py };
        const frame = spec({ type: 'frame', x: 0, y: 0, w: PW, h: PH, title: comic ? '' : `${i + 1}${p.shot ? ` · ${String(p.shot).slice(0, 40)}` : ''}${p.duration ? ` · ${String(p.duration).slice(0, 20)}` : ''}`, color: comic ? '#1c1916' : '#e8b86b', style: comic ? { finish: 'flat', shadow: 'flat', radius: 4, strokeW: 5, strokeC: '#1c1916' } : { finish: 'soft', shadow: 'raised' } }, o);
        frame.z = -900 + i;
        made.push(frame);
        if (!comic) slideIds.push(frame.id);
        const picH = comic ? PH - 40 : 300;
        const pic = p.image && /^https:\/\//.test(String(p.image))
          ? spec({ type: 'image', x: 20, y: comic ? 20 : 46, w: PW - 40, h: picH, url: String(p.image).slice(0, 2000) }, o)
          : spec({ type: 'note', x: 20, y: comic ? 20 : 46, w: PW - 40, h: picH, text: String(p.scene || '').slice(0, 400), paper: 'grid', lift: 'flat', color: comic ? '#fffdf5' : '#f5f1ea', style: { size: comic ? 24 : 24, hand: true, align: 'center' } }, o);
        made.push(pic);
        if (comic) {
          // speech bubbles over the picture, a caption box on top
          (Array.isArray(p.dialogue) ? p.dialogue : []).slice(0, 3).forEach((dl, k) => {
            const txt = `${dl.who ? `${String(dl.who).slice(0, 20).toUpperCase()}: ` : ''}${String(dl.text || '').slice(0, 160)}`;
            const w = Math.min(PW - 80, 160 + txt.length * 4);
            made.push(spec({ type: 'shape', shape: 'bubble', x: k % 2 ? PW - w - 30 : 30, y: 60 + k * 120, w, h: 100, text: txt, color: '#ffffff', style: { finish: 'solid', size: 16, bold: true, family: 'marker', strokeW: 3, strokeC: '#1c1916', textColor: '#1c1916' } }, o));
          });
          if (p.caption) made.push(spec({ type: 'shape', shape: 'rect', x: 20, y: 20, w: Math.min(PW - 40, 120 + String(p.caption).length * 6), h: 52, text: String(p.caption).slice(0, 140), color: '#ffd54a', style: { finish: 'solid', size: 15, bold: true, strokeW: 3, strokeC: '#1c1916', textColor: '#1c1916', radius: 0 } }, o));
          if (p.image && p.scene) made.push(spec({ type: 'text', x: 24, y: PH - 52, w: PW - 48, h: 32, text: String(p.scene).slice(0, 120), style: { size: 13, muted: true, align: 'left' } }, o));
        } else {
          let y = 46 + picH + 14;
          if (p.image && p.scene) { made.push(spec({ type: 'text', x: 20, y, w: PW - 40, h: 56, text: String(p.scene).slice(0, 220), style: { size: 16, bold: true, align: 'left' } }, o)); y += 62; }
          const dl = (Array.isArray(p.dialogue) ? p.dialogue : []).map((x) => `${x.who ? `${x.who}: ` : ''}${x.text || ''}`).join('\n');
          const words = [p.caption && `🎙 ${p.caption}`, dl && `💬 ${dl}`, p.notes && `📝 ${p.notes}`].filter(Boolean).join('\n');
          if (words) made.push(spec({ type: 'text', x: 20, y, w: PW - 40, h: Math.min(PH - y - 16, 30 + words.split('\n').length * 24), text: words.slice(0, 600), style: { size: 16, align: 'left' } }, o));
          made.push(spec({ type: 'shape', shape: 'ellipse', x: PW - 66, y: 54, w: 44, h: 44, text: String(i + 1), color: '#1c1916', style: { finish: 'solid', size: 18, bold: true, textColor: '#ffffff' } }, o));
        }
      });
      const links = [];
      if (!comic) for (let i = 1; i < slideIds.length; i++) links.push(makeLink({ item: slideIds[i - 1] }, { item: slideIds[i] }, { style: { kind: 'drawn', end: 'arrow', color: '#c9a27e' } }));
      if (a.slides !== false && !comic) d.order = [...(d.order || []), ...slideIds];
      if (a.slides === true && comic) d.order = [...(d.order || []), ...made.filter((m) => m.type === 'frame').map((m) => m.id)];
      return commit(db, uid, r, d, made, links);
    } },
  { name: 'video_breakdown', description: 'Turn a YouTube link into a visual breakdown on a board: the cover, frames from the start, middle and end of the video, its numbers, the chapters as a timeline, the hook (first lines of the description) and top comments. Great for studying a competitor or planning a remake.',
    input_schema: { type: 'object', properties: { url: { type: 'string' }, board: BOARD_ARG }, required: ['url'] },
    run: async (ctx, a) => {
      const v = await RESEARCH_TOOLS.find((t) => t.name === 'youtube_video').run(ctx, { url: a.url, comments: 6 });
      const { r, d } = await boardFor(ctx.db, ctx.uid, a.board || `Breakdown: ${short(v.title, 50)}`, { icon: '🎞️' });
      const at = freeOrigin(d);
      const W = 1500, P = 50, made = [];
      made.push(spec({ type: 'text', x: P, y: 30, w: W - 2 * P, h: 70, text: short(v.title, 110), style: { size: 34, bold: true, align: 'left' } }, at));
      made.push(spec({ type: 'text', x: P, y: 100, w: W - 2 * P, h: 34, text: `${v.channel?.title || ''}${v.channel?.subscribers ? ` · ${fmt(v.channel.subscribers)} subscribers` : ''} · ${fmt(v.views)} views · ${fmt(v.likes)} likes · ${fmt(v.comments)} comments · ${v.ageDays} days old · ${fmt(v.viewsPerDay)} views/day${v.viewsPerSubscriber ? ` · ${v.viewsPerSubscriber}× its subscribers` : ''}`, style: { size: 16, muted: true, align: 'left' } }, at));
      made.push(spec({ type: 'image', x: P, y: 150, w: 640, h: 360, url: v.thumb }, at));
      made.push(spec({ type: 'text', x: P, y: 518, w: 640, h: 26, text: 'Cover (thumbnail)', style: { size: 13, muted: true, align: 'left' } }, at));
      [['start', 'Near the start'], ['middle', 'Middle'], ['end', 'Near the end']].forEach(([k, label], i) => {
        made.push(spec({ type: 'image', x: 720 + i * 250, y: 150, w: 230, h: 130, url: v.frames[k] }, at));
        made.push(spec({ type: 'text', x: 720 + i * 250, y: 286, w: 230, h: 24, text: label, style: { size: 13, muted: true, align: 'left' } }, at));
      });
      const hook = String(v.description || '').split('\n').filter((l) => l.trim()).slice(0, 4).join('\n');
      made.push(spec({ type: 'card', x: 720, y: 330, w: 730, h: 180, title: 'Hook and description', text: short(hook, 500), color: '#e8b86b', style: { finish: 'tinted', size: 15 } }, at));
      let y = 570;
      if (v.chapters.length) {
        made.push(spec({ type: 'text', x: P, y, w: 600, h: 34, text: 'Chapters', style: { size: 22, bold: true, align: 'left' } }, at));
        y += 46;
        const cw = Math.max(160, Math.min(260, (W - 2 * P) / Math.min(v.chapters.length, 6) - 16));
        v.chapters.slice(0, 18).forEach((c, i) => {
          const x = P + (i % 6) * (cw + 16), yy = y + Math.floor(i / 6) * 110;
          made.push(spec({ type: 'card', x, y: yy, w: cw, h: 94, title: c.time, text: short(c.title, 70), color: '#ff8a5c', style: { finish: 'tinted', size: 14 } }, at));
        });
        y += Math.ceil(Math.min(v.chapters.length, 18) / 6) * 110 + 20;
      }
      if (v.tags.length) { made.push(spec({ type: 'card', x: P, y, w: W - 2 * P, h: 90, title: 'Tags', text: short(v.tags.join(', '), 400), color: '#c9a27e', style: { finish: 'soft', size: 14 } }, at)); y += 110; }
      v.comments.slice(0, 6).forEach((c, i) => {
        made.push(spec({ type: 'note', x: P + (i % 3) * 470, y: y + Math.floor(i / 3) * 210, w: 440, h: 190, text: `“${short(c.text, 220)}”\n— ${c.by} · 👍 ${fmt(c.likes)}`, paper: 'index', pin: 'pin', rot: [-1.5, 1, -0.5][i % 3], style: { size: 15 } }, at));
      });
      if (v.comments.length) y += Math.ceil(Math.min(v.comments.length, 6) / 3) * 210;
      const frame = spec({ type: 'frame', x: 0, y: 0, w: W, h: y + P, title: 'Video breakdown', color: '#ff8a5c', style: { finish: 'soft', shadow: 'raised' } }, at);
      frame.z = Math.min(0, ...d.items.map((i) => i.z || 0)) - 1;
      const media = spec({ type: 'media', x: W + 40, y: 0, w: 320, h: 300 }, at);
      media.data = { ...media.data, url: v.url, platform: 'youtube', title: v.title, author: v.channel?.title, views: v.views, likes: v.likes, comments: v.comments, posted: v.posted, duration: v.duration, image: v.thumb };
      return commit(ctx.db, ctx.uid, r, d, [frame, ...made, media]);
    } },
  { name: 'remember_on_board', description: 'Your notebook: write a note on the owner\'s "AI Notes" board (or another board) so it is kept for later and the owner can see it. Use it for findings, ideas, decisions and things to check. Notes pile up in a tidy grid with a date.',
    input_schema: { type: 'object', properties: { text: { type: 'string' }, title: { type: 'string' }, board: { type: 'string', description: 'Default: "AI Notes"' }, color: { type: 'string', description: '#hex (warm colours)' } }, required: ['text'] },
    run: async ({ db, uid }, a) => {
      const { r, d } = await boardFor(db, uid, a.board || 'AI Notes', { icon: '🧠' });
      const notes = d.items.filter((i) => i.type === 'note' && i.data?.mem);
      const k = notes.length, cols = 5;
      const x = (k % cols) * 300, y = 120 + Math.floor(k / cols) * 300;
      const made = [];
      if (!d.items.some((i) => i.data?.memHead)) { const t = spec({ type: 'text', x: 0, y: 0, w: 1400, h: 80, text: '🧠 AI Notes', style: { size: 48, bold: true, align: 'left' } }, { x: 0, y: 0 }); t.data = { ...t.data, memHead: true }; made.push(t); }
      const date = new Date().toISOString().slice(0, 10);
      const note = spec({ type: 'note', x, y, w: 270, h: 270, text: `${a.title ? `${String(a.title).slice(0, 80)}\n\n` : ''}${String(a.text).slice(0, 1200)}\n\n— ${date}`, color: a.color || ['#ffd54a', '#ffb020', '#e8b86b', '#ff8a5c', '#b8e04a'][k % 5], rot: [-2, 1.5, -1, 2, 0][k % 5], pin: 'pin', style: { size: 15 } }, { x: 0, y: 0 });
      note.data = { ...note.data, mem: true };
      made.push(note);
      return commit(db, uid, r, d, made);
    } },
  { name: 'search_boards', description: 'Search everything written on the owner\'s boards (titles, text, notes, checklists, video cards, tables) for words, to recall what was planned, researched or remembered. Returns the matching items with their board.',
    input_schema: { type: 'object', properties: { query: { type: 'string' }, max: { type: 'number', description: 'Default 30' } }, required: ['query'] },
    run: async ({ db, uid }, a) => {
      const words = String(a.query || '').toLowerCase().split(/\s+/).filter((w) => w.length > 1);
      if (!words.length) throw new HttpError(400, 'Give words to search for');
      const rows = await db.all('SELECT id, name, data FROM boards WHERE user_id = ?', uid);
      const hits = [];
      for (const b of rows) {
        const d = parse(b.data);
        for (const it of d.items || []) {
          const dd = it.data || {};
          const text = [it.title, it.text, dd.back, dd.title, dd.author, dd.url, ...(dd.items || []).map((x) => x.t), ...(dd.rows || []).map((row) => Object.values(row.c || {}).join(' '))].filter(Boolean).join(' ');
          const low = text.toLowerCase();
          const score = words.reduce((s, w) => s + (low.includes(w) ? 1 : 0), 0);
          if (score === words.length || (words.length > 2 && score >= words.length - 1)) hits.push({ board: b.id, boardName: b.name, item: it.id, type: it.type, score, text: short(text.replace(/\s+/g, ' '), 300) });
        }
      }
      hits.sort((x, y) => y.score - x.score);
      return { query: a.query, found: hits.length, results: hits.slice(0, clampInt(a.max, 1, 100, 30)) };
    } },
];

export const RESEARCH_GUIDE = 'Boards are also your research desk and notebook: youtube_search, youtube_channel, youtube_video, keyword_ideas and niche_report dig into YouTube with the owner\'s API key; research_to_board, video_breakdown and make_storyboard put what you find on a board as real video cards, notes and panels; remember_on_board keeps notes for later and search_boards finds anything already written. Always show your research on a board, then sum it up in a few lines.';
