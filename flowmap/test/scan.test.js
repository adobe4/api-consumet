import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseCount, parseAgeHours, parseFeed, scanSource } from '../server/scan.js';
import { openDb } from '../server/db.js';
import { loadWorld, readWorld } from '../server/models.js';
import { scanProject } from '../server/sync.js';
import { detectPlatform, normalizeSources } from '../shared/sources.js';

test('number and age parsing', () => {
  assert.equal(parseCount('21.3M'), 21300000);
  assert.equal(parseCount('829 thousand views'), 829000);
  assert.equal(parseCount('12,345 views'), 12345);
  assert.equal(parseCount('No views'), 0);
  assert.equal(parseAgeHours('5 hours ago'), 5);
  assert.equal(parseAgeHours('Streamed 2 days ago'), 48);
  assert.equal(parseAgeHours('whenever'), null);
});

test('platforms are detected from links', () => {
  assert.equal(detectPlatform('https://youtu.be/x'), 'youtube');
  assert.equal(detectPlatform('https://m.youtube.com/@a'), 'youtube');
  assert.equal(detectPlatform('https://vm.tiktok.com/x'), 'tiktok');
  assert.equal(detectPlatform('https://play.google.com/store/apps/details?id=a.b'), 'playstore');
  assert.equal(detectPlatform('https://wa.me/255700000000'), 'whatsapp');
  assert.equal(detectPlatform('https://digitalsoko.co.tz'), 'website');
  assert.throws(() => normalizeSources(['hello']));
});

test('RSS and Atom feeds', () => {
  const rss = '<rss><channel><item><title><![CDATA[Hello &amp; welcome]]></title><pubDate>Mon, 28 Sep 2026 10:00:00 GMT</pubDate></item></channel></rss>';
  const atom = '<feed><entry><title>Two</title><published>2026-09-27T08:00:00Z</published></entry></feed>';
  assert.deepEqual(parseFeed(rss), [{ title: 'Hello & welcome', publishedAt: '2026-09-28T10:00:00.000Z' }]);
  assert.equal(parseFeed(atom)[0].title, 'Two');
});

// a YouTube "Videos" page with the parts the scanner reads
const ytPage = (videos) => `<html><script>var ytInitialData = ${JSON.stringify({
  metadata: { channelMetadataRenderer: { externalId: 'UC123', title: 'Vinei TV' } },
  header: { pageHeaderRenderer: { content: { parts: [{ content: '12.4K subscribers' }, { content: '310 videos' }] } } },
  contents: { items: videos.map(([id, views, age]) => ({ lockupViewModel: { contentId: id, metadata: { lockupMetadataViewModel: { title: { content: `Video ${id}` }, metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ text: { content: '' }, accessibilityLabel: `${views} views` }, { text: { content: '' }, accessibilityLabel: `${age} ago` }] }] } } } } } })) },
})};</script></html>`;

test('YouTube scan fills posts and attention, and a manual check-in wins', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowmap-scan-'));
  const db = await openDb({ dataDir: dir });
  const uid = (await db.run("INSERT INTO users (email, name, pass) VALUES ('s@x.io', 'S', 'x')")).lastInsertRowid;
  const today = new Date().toISOString().slice(0, 10);
  await loadWorld(db, uid, { projects: [{ id: 'v', name: 'Vinei TV', kind: 'youtube', createdOn: '2020-01-01', sources: ['https://www.youtube.com/@vinei'] }] }, { replace: true });
  const project = (await readWorld(db, uid)).projects[0];

  let page = ytPage([['a', '3,000', '1 minute'], ['b', '9,000', '3 days'], ['c', '60,000', '2 months']]);
  const fetchImpl = async () => ({ status: 200, ok: true, url: 'https://www.youtube.com/@vinei/videos', text: async () => page });
  const r1 = await scanProject(db, uid, project, { tz: 'UTC', fetchImpl });
  assert.equal(r1[0].ok, true);
  assert.equal(r1[0].data.subscribers, 12400);
  let w = await readWorld(db, uid);
  const todayLog = w.logs.find((l) => l.day === today);
  assert.equal(todayLog.posts, 1);
  assert.equal(todayLog.attention, 400); // first estimate: 12k views in the last 30 days / 30
  assert.equal(w.logs.filter((l) => l.posts > 0).length, 2); // the 2-month-old video is ignored
  assert.ok(w.notes.some((n) => n.source === 'scan' && /12.4k subscribers/.test(n.text)));

  // the owner logs their own number; the next scan must not overwrite it
  await db.run('UPDATE logs SET attention = 5000, note = ? WHERE id = ?', 'from YouTube Studio', todayLog.id);
  await db.run("UPDATE scans SET at = datetime('now', '-1 day')"); // pretend the last scan was yesterday
  page = ytPage([['a', '5,000', '1 day'], ['b', '10,000', '4 days'], ['d', '1,000', '1 hour']]);
  await scanProject(db, uid, project, { tz: 'UTC', fetchImpl });
  w = await readWorld(db, uid);
  assert.equal(w.logs.find((l) => l.day === today).attention, 5000);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('scan failures are reported, not thrown', async () => {
  const down = await scanSource({ platform: 'website', url: 'https://example.invalid' }, { fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  assert.equal(down.ok, false);
  assert.match(down.error, /down/);
  const ig = await scanSource({ platform: 'instagram', url: 'https://instagram.com/x' });
  assert.equal(ig.ok, false);
  const blocked = await scanSource({ platform: 'tiktok', url: 'https://www.tiktok.com/@x' }, { fetchImpl: async () => ({ status: 200, ok: true, text: async () => '<html></html>' }) });
  assert.match(blocked.error, /Check-in/);
});
