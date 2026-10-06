import test from 'node:test';
import assert from 'node:assert/strict';
import { linkPreview, safeUrl, platformOf, youtubeId } from '../server/preview.js';
import { arrowPath, arrowBounds } from '../public/js/board/arrows.js';

const publicDns = async () => [{ address: '93.184.216.34', family: 4 }];
const page = (html, status = 200, headers = {}) => ({ status, ok: status < 300, headers: new Map(Object.entries(headers)), text: async () => html, body: null });

test('only public addresses are fetched', async () => {
  for (const bad of ['http://localhost/x', 'http://127.0.0.1/', 'http://10.0.0.5/', 'http://192.168.1.1/', 'http://169.254.169.254/latest/meta-data', 'http://[::1]/', 'ftp://example.com/', 'http://user:pw@example.com/', 'http://metadata.google.internal/']) {
    await assert.rejects(safeUrl(bad, publicDns), /not public|Only http|password|not a link/, bad);
  }
  await assert.rejects(safeUrl('https://sneaky.example/', async () => [{ address: '10.1.2.3', family: 4 }]), /not public/);
  assert.equal((await safeUrl('https://example.com/a?b=1', publicDns)).hostname, 'example.com');
});

test('a redirect to a private address is refused', async () => {
  const fetchImpl = async (url) => (url.includes('example.com') ? page('', 302, { location: 'http://127.0.0.1/admin' }) : page('<title>secret</title>'));
  await assert.rejects(linkPreview('https://example.com/go', { fetchImpl, lookup: async (h) => (h === '127.0.0.1' ? [{ address: '127.0.0.1' }] : [{ address: '93.184.216.34' }]) }), /not public/);
});

test('web pages: title, picture, description, site', async () => {
  const html = '<html><head><title>Plain</title><meta property="og:title" content="Best IPTV boxes &amp; apps"><meta property="og:image" content="/img/cover.jpg"><meta name="description" content="A guide"><meta property="og:site_name" content="Blonxin"></head></html>';
  const p = await linkPreview('https://blog.example.org/post', { fetchImpl: async () => page(html), lookup: publicDns, fresh: true });
  assert.deepEqual([p.kind, p.title, p.image, p.description, p.site], ['link', 'Best IPTV boxes & apps', 'https://blog.example.org/img/cover.jpg', 'A guide', 'Blonxin']);
});

test('YouTube: the API key gives views, likes, date and length; without it the page or oEmbed', async () => {
  assert.equal(platformOf('https://youtu.be/dQw4w9WgXcQ'), 'youtube');
  assert.equal(youtubeId('https://www.youtube.com/shorts/abcdefghijk'), 'abcdefghijk');
  const api = { items: [{ snippet: { title: 'How to set up IPTV', channelTitle: 'Blonxin', publishedAt: '2026-01-13T10:00:00Z', thumbnails: { high: { url: 'https://i.ytimg.com/x.jpg' } } }, statistics: { viewCount: '685460', likeCount: '1294', commentCount: '230' }, contentDetails: { duration: 'PT2M30S' } }] };
  const withKey = await linkPreview('https://www.youtube.com/watch?v=tmJCHL5csaA', { youtubeKey: 'k', fetchImpl: async () => ({ json: async () => api }), lookup: publicDns, fresh: true });
  assert.deepEqual([withKey.kind, withKey.views, withKey.likes, withKey.comments, withKey.duration, withKey.author, withKey.via], ['media', 685460, 1294, 230, 150, 'Blonxin', 'api']);
  const watch = 'var ytInitialPlayerResponse = {"videoDetails":{"title":"Fix IPTV","author":"Blonxin","viewCount":"165815","lengthSeconds":"77","shortDescription":"x"},"microformat":{"playerMicroformatRenderer":{"publishDate":"2024-09-06"}}};';
  const fromPage = await linkPreview('https://youtu.be/oxYs22x3crM', { fetchImpl: async () => page(watch), lookup: publicDns, fresh: true });
  assert.deepEqual([fromPage.title, fromPage.views, fromPage.duration, fromPage.posted, fromPage.image], ['Fix IPTV', 165815, 77, '2024-09-06', 'https://i.ytimg.com/vi/oxYs22x3crM/hqdefault.jpg']);
  const oembed = await linkPreview('https://www.youtube.com/watch?v=aaaaaaaaaaa', { fetchImpl: async (u) => (u.includes('oembed') ? page('{"title":"Only title","author_name":"Chan"}') : page('blocked', 403)), lookup: publicDns, fresh: true });
  assert.deepEqual([oembed.title, oembed.author, oembed.views ?? null, oembed.via], ['Only title', 'Chan', null, 'oembed']);
});

test('TikTok and Instagram numbers', async () => {
  const tk = '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">{"__DEFAULT_SCOPE__":{"webapp.video-detail":{"itemInfo":{"itemStruct":{"desc":"Hook test","createTime":"1767225600","author":{"nickname":"vinei"},"video":{"cover":"https://p.tiktokcdn.com/c.jpg","duration":31},"stats":{"playCount":120400,"diggCount":9100,"commentCount":340,"shareCount":55}}}}}}</script>';
  const t = await linkPreview('https://www.tiktok.com/@vinei/video/1', { fetchImpl: async () => page(tk), lookup: publicDns, fresh: true });
  assert.deepEqual([t.platform, t.views, t.likes, t.comments, t.shares, t.duration, t.author], ['tiktok', 120400, 9100, 340, 55, 31, 'vinei']);
  const ig = '<meta property="og:description" content="1,234 likes, 56 comments - vineitv on March 3, 2026: &quot;Mikopo apps&quot;"><meta property="og:image" content="https://scontent.cdninstagram.com/a.jpg"><meta property="og:title" content="Vinei TV on Instagram">';
  const i = await linkPreview('https://www.instagram.com/p/XYZ/', { fetchImpl: async () => page(ig), lookup: publicDns, fresh: true });
  assert.deepEqual([i.platform, i.likes, i.comments, i.author, i.posted.slice(0, 10)], ['instagram', 1234, 56, 'vineitv', '2026-03-03']);
});

test('arrows: an outline with a head, and a box that holds it', () => {
  const d = arrowPath([[20, 60], [150, 10], [280, 60]], { body: 24, head: 'triangle', tail: 'round' });
  assert.match(d, /^M[\d.]+,[\d.]+L/); assert.ok(d.includes('a'), 'a round tail');
  assert.ok(!arrowPath([[0, 0], [50, 0], [100, 0]], { head: 'none' }).includes('NaN'));
  const b = arrowBounds([[20, 60], [150, 10], [280, 60]], 24, 'triangle', 'none');
  assert.ok(b.x0 < 20 && b.x1 > 280 && b.y0 < 10);
});
