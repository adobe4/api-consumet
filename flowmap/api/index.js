// Vercel serverless function: every /api/* request is rewritten here (see vercel.json).
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';

let appPromise = null;
function getApp() {
  appPromise ||= (async () => {
    if (!process.env.TURSO_DATABASE_URL) throw new Error('TURSO_DATABASE_URL is not set');
    if (!process.env.FLOWMAP_SECRET || process.env.FLOWMAP_SECRET.length < 16) throw new Error('FLOWMAP_SECRET must be set (16+ random characters)');
    const db = await openDb({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
    return createApp({
      db,
      secret: process.env.FLOWMAP_SECRET,
      openSignup: process.env.ALLOW_REGISTRATION !== 'false',
      cronSecret: process.env.CRON_SECRET || '',
      youtubeKey: process.env.YOUTUBE_API_KEY || '',
    });
  })().catch((e) => { appPromise = null; throw e; });
  return appPromise;
}

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  // the rewrite passes the original path as ?path=... when the platform does not keep it in req.url
  let pathname = url.pathname;
  if (!pathname.startsWith('/api/') || pathname === '/api' || pathname === '/api/index') {
    pathname = '/api/' + String(url.searchParams.get('path') || '').replace(/^\/+/, '');
  }
  url.searchParams.delete('path');
  let app;
  try { app = await getApp(); } catch (e) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: `Server is not configured: ${e.message}` }));
  }
  return app.handle(req, res, pathname, url.searchParams);
}
