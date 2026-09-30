// Local FlowMap server: static files + the JSON API (server/app.js). On Vercel, api/index.js serves the API instead.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { loadSecret } from './auth.js';
import { createApp } from './app.js';
import { vendorFile } from '../scripts/vendor.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const SHARED = path.join(ROOT, 'shared');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const PORT = Number(process.env.PORT || 8787);

const db = await openDb({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN, dataDir: DATA_DIR });
const app = createApp({
  db,
  secret: loadSecret(DATA_DIR),
  openSignup: process.env.ALLOW_REGISTRATION !== 'false',
  cronSecret: process.env.CRON_SECRET || '',
  youtubeKey: process.env.YOUTUBE_API_KEY || '',
});

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};
const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob: https:; media-src 'self' blob: data:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};
const send = (res, status, body, headers = {}) => { res.writeHead(status, { ...SEC_HEADERS, ...headers }); res.end(body); };

function serveStatic(res, pathname) {
  if (pathname.startsWith('/vendor/three/')) {
    const text = vendorFile(pathname.slice('/vendor/three/'.length));
    return text === null ? send(res, 404, 'Not found') : send(res, 200, text, { 'Content-Type': MIME['.js'], 'Cache-Control': 'public, max-age=86400' });
  }
  let base = PUBLIC;
  let rel = pathname;
  if (pathname.startsWith('/shared/')) { base = SHARED; rel = pathname.slice('/shared'.length); }
  if (rel === '/' || rel === '') rel = '/index.html';
  if (/^\/b\/[A-Za-z0-9_-]+\/?$/.test(rel)) rel = '/share.html'; // shared board links
  const file = path.normalize(path.join(base, rel));
  if (!file.startsWith(base + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    if (path.extname(pathname)) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
    return send(res, 200, fs.readFileSync(path.join(PUBLIC, 'index.html')), { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
  }
  send(res, 200, fs.readFileSync(file), { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) return app.handle(req, res, url.pathname, url.searchParams);
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  try { serveStatic(res, decodeURIComponent(url.pathname)); } catch { send(res, 400, 'Bad request'); }
});

server.listen(PORT, () => console.log(`FlowMap running on http://localhost:${PORT}  (data: ${process.env.TURSO_DATABASE_URL ? 'Turso' : DATA_DIR})`));
process.on('SIGTERM', () => server.close(() => { db.close(); process.exit(0); }));
