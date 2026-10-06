// Keeps the app's own files on the phone so FlowMap opens at once, even on a slow line, and still opens
// offline. Your data always comes fresh from the server (/api is never cached).
// The build stamps VERSION and the file list; a new deploy means a new VERSION, so phones fetch the new
// files in the background and the page offers to switch.
const VERSION = 'dev';
const PRECACHE = [];
const CACHE = `flowmap-${VERSION}`;
const RUNTIME = 'flowmap-runtime';

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // fetch fresh copies (not the browser's HTTP cache), a few at a time
    for (let i = 0; i < PRECACHE.length; i += 8) {
      await Promise.all(PRECACHE.slice(i, i + 8).map(async (u) => {
        const r = await fetch(new Request(u, { cache: 'reload' }));
        if (r.ok) await c.put(u, r);
      }));
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('flowmap-') && k !== CACHE && k !== RUNTIME) await caches.delete(k);
    await self.clients.claim();
  })());
});

const shellFor = (url) => (url.pathname.startsWith('/b/') ? '/share.html' : url.pathname === '/' || url.pathname === '/index.html' ? '/index.html' : null);

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/download/') || url.pathname === '/sw.js') return;
  if (VERSION === 'dev') return; // local development: always the files on disk
  if (req.mode === 'navigate') {
    const shell = shellFor(url);
    if (!shell) return;
    e.respondWith((async () => (await caches.match(shell, { cacheName: CACHE })) || fetch(req))());
    return;
  }
  e.respondWith((async () => {
    const hit = await caches.match(url.pathname, { cacheName: CACHE });
    if (hit) return hit;
    // anything else of ours (the 3D engine, a file added later): from the network, kept for next time
    const rt = await caches.open(RUNTIME);
    const old = await rt.match(req);
    const fresh = fetch(req).then((r) => { if (r.ok) rt.put(req, r.clone()); return r; }).catch(() => old);
    return old || fresh;
  })());
});
