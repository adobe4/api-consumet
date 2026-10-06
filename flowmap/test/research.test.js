import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RESEARCH_TOOLS } from '../server/research.js';
import { openDb } from '../server/db.js';
import { getBoard } from '../server/boards.js';

const tool = (n) => RESEARCH_TOOLS.find((t) => t.name === n);
const day = (n) => new Date(Date.now() - n * 864e5).toISOString();
// a small fake YouTube: search, videos, channels, comments and suggestions
const VIDS = {
  v1aaaaaaaaa: { title: 'Jinsi ya kupata wateja online', ch: 'UCsmall000000000000000001', views: 90000, likes: 4000, comments: 300, days: 20, dur: 'PT8M10S', desc: '0:00 Intro\n1:20 Hatua ya kwanza\n4:00 Mfano' },
  v2bbbbbbbbb: { title: 'Biashara ya mtandaoni 2026', ch: 'UCbig00000000000000000002', views: 400000, likes: 9000, comments: 800, days: 200, dur: 'PT12M', desc: 'Karibu' },
  v3ccccccccc: { title: 'Wateja online: siri 5', ch: 'UCsmall000000000000000001', views: 15000, likes: 900, comments: 50, days: 60, dur: 'PT45S', desc: '' },
};
const CHS = { UCsmall000000000000000001: { title: 'Small Biz TZ', subs: 5000, handle: '@smallbiz' }, UCbig00000000000000000002: { title: 'Big Money', subs: 900000, handle: '@bigmoney' } };
const realFetch = globalThis.fetch;
let dir, db, uid;
before(async () => {
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    const json = (o) => ({ ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o) });
    if (u.hostname === 'suggestqueries.google.com') { const q = u.searchParams.get('q'); return json([q, [`${q} kwa simu`, `${q} bure`, `${q} 2026`]]); }
    assert.equal(u.searchParams.get('key'), 'YTKEY');
    const p = u.pathname.split('/').pop();
    if (p === 'search') {
      if (u.searchParams.get('type') === 'channel') return json({ items: Object.keys(CHS).map((id) => ({ id: { channelId: id } })) });
      return json({ items: Object.keys(VIDS).map((id) => ({ id: { videoId: id } })) });
    }
    if (p === 'videos') return json({ items: u.searchParams.get('id').split(',').filter((id) => VIDS[id]).map((id) => { const v = VIDS[id]; return { id, snippet: { title: v.title, channelId: v.ch, channelTitle: CHS[v.ch].title, publishedAt: day(v.days), description: v.desc, tags: ['biashara'] }, statistics: { viewCount: String(v.views), likeCount: String(v.likes), commentCount: String(v.comments) }, contentDetails: { duration: v.dur } }; }) });
    if (p === 'channels') {
      const ids = u.searchParams.get('id') ? u.searchParams.get('id').split(',') : Object.keys(CHS).filter((id) => CHS[id].handle === u.searchParams.get('forHandle'));
      return json({ items: ids.filter((id) => CHS[id]).map((id) => ({ id, snippet: { title: CHS[id].title, customUrl: CHS[id].handle, publishedAt: day(900) }, statistics: { subscriberCount: String(CHS[id].subs), viewCount: '1000000', videoCount: '120' }, contentDetails: { relatedPlaylists: { uploads: `UU${id}` } } })) });
    }
    if (p === 'playlistItems') return json({ items: Object.keys(VIDS).filter((id) => `UU${VIDS[id].ch}` === u.searchParams.get('playlistId')).map((id) => ({ contentDetails: { videoId: id } })) });
    if (p === 'commentThreads') return json({ items: [{ snippet: { totalReplyCount: 2, topLevelComment: { snippet: { authorDisplayName: 'Asha', textDisplay: 'Asante sana!', likeCount: 12 } } } }] });
    return { ok: false, status: 404, json: async () => ({ error: { message: 'nope' } }) };
  };
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowmap-research-'));
  db = await openDb({ dataDir: dir });
  uid = (await db.run('INSERT INTO users (email, name, pass, settings) VALUES (?, ?, ?, ?)', 'r@example.com', 'R', 'x', '{}')).lastInsertRowid;
});
after(() => { globalThis.fetch = realFetch; fs.rmSync(dir, { recursive: true, force: true }); });
const ctx = () => ({ db, uid, youtubeKey: 'YTKEY' });

test('without a YouTube key the research tools say how to add one', async () => {
  await assert.rejects(tool('youtube_search').run({ db, uid, youtubeKey: '' }, { query: 'x' }), /YouTube API key/);
});

test('search and niche report: numbers, small-channel breakouts, an opportunity score', async () => {
  const s = await tool('youtube_search').run(ctx(), { query: 'wateja online', region: 'tz', language: 'sw' });
  const v1 = s.videos.find((v) => v.id === 'v1aaaaaaaaa');
  assert.equal(v1.channelSubscribers, 5000);
  assert.equal(v1.viewsPerSubscriber, 18);
  assert.ok(v1.viewsPerDay > 4000);
  const r = await tool('niche_report').run(ctx(), { query: 'wateja online' });
  assert.equal(r.numbers.videos, 3);
  assert.equal(r.breakouts.length, 2);
  assert.ok(r.opportunity > 0 && r.opportunity <= 100);
  assert.ok(r.titleWords.some((w) => w.word === 'wateja'));
});

test('channel and video deep dives', async () => {
  const c = await tool('youtube_channel').run(ctx(), { channel: 'https://www.youtube.com/@smallbiz' });
  assert.equal(c.channel.title, 'Small Biz TZ');
  assert.equal(c.videos.length, 2);
  assert.ok(c.pace.medianViewsRecent > 0);
  const v = await tool('youtube_video').run(ctx(), { url: 'https://youtu.be/v1aaaaaaaaa' });
  assert.equal(v.chapters.length, 3);
  assert.equal(v.chapters[1].title, 'Hatua ya kwanza');
  assert.equal(v.comments[0].by, 'Asha');
  assert.match(v.frames.middle, /v1aaaaaaaaa\/2\.jpg$/);
});

test('keyword ideas come from YouTube suggestions', async () => {
  const k = await tool('keyword_ideas').run(ctx(), { seed: 'biashara', language: 'sw', expand: true, questions: true });
  assert.ok(k.ideas.length > 10);
  assert.equal(k.ideas[0].from, 'biashara');
});

test('research, storyboards, comics and breakdowns land on boards; notes are remembered and found', async () => {
  const r = await tool('research_to_board').run(ctx(), { title: 'Niche: wateja online', verdict: 'Small channels win here.', channels: [{ title: 'Small Biz TZ', subscribers: 5000 }], keywords: ['wateja online', 'biashara bure'], findings: ['Short hooks', 'Use numbers'] });
  let d = JSON.parse((await getBoard(db, uid, r.board)).data);
  assert.ok(d.items.some((i) => i.type === 'frame' && i.title === 'Niche: wateja online'));
  assert.equal(d.items.filter((i) => i.type === 'note').length, 2);
  assert.equal(d.items.filter((i) => i.type === 'shape' && i.data.shape === 'pill').length, 2);
  const sb = await tool('make_storyboard').run(ctx(), { title: 'Intro video', panels: [{ scene: 'Me at the desk', shot: 'Wide', dialogue: [{ who: 'Me', text: 'Karibu!' }] }, { scene: 'Phone screen', image: 'https://i.ytimg.com/vi/v1aaaaaaaaa/1.jpg', shot: 'Screen recording' }] });
  d = JSON.parse((await getBoard(db, uid, sb.board)).data);
  assert.equal(d.order.length, 2, 'every storyboard panel is a slide');
  assert.ok(d.items.some((i) => i.type === 'image' && /1\.jpg$/.test(i.data.url)));
  const cm = await tool('make_storyboard').run(ctx(), { title: 'Comic', style: 'comic', panels: [{ scene: 'Street', dialogue: [{ who: 'Juma', text: 'Hii ni nini?' }], caption: 'Dar es Salaam, 6am' }] });
  d = JSON.parse((await getBoard(db, uid, cm.board)).data);
  assert.ok(d.items.some((i) => i.type === 'shape' && i.data.shape === 'bubble' && /JUMA/.test(i.text)));
  const bd = await tool('video_breakdown').run(ctx(), { url: 'https://www.youtube.com/watch?v=v1aaaaaaaaa' });
  d = JSON.parse((await getBoard(db, uid, bd.board)).data);
  assert.equal(d.items.filter((i) => i.type === 'image').length, 4);
  assert.ok(d.items.some((i) => i.type === 'media' && i.data.views === 90000));
  await tool('remember_on_board').run(ctx(), { title: 'Idea', text: 'Make a series about M-Pesa tips' });
  await tool('remember_on_board').run(ctx(), { text: 'Small channels win in wateja online' });
  const f = await tool('search_boards').run(ctx(), { query: 'm-pesa tips' });
  assert.equal(f.found, 1);
  assert.equal(f.results[0].boardName, 'AI Notes');
});
