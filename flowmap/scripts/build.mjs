// Assembles the static site for Vercel into dist/: public/ + shared/ + vendored three.js.
// The API itself is the serverless function in api/index.js.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeVendor } from './vendor.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist');
fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'public'), OUT, { recursive: true });
fs.cpSync(path.join(ROOT, 'shared'), path.join(OUT, 'shared'), { recursive: true });
writeVendor(path.join(OUT, 'vendor/three'));

// ---------- fast start on phones ----------
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
const web = (f) => `/${path.relative(OUT, f).split(path.sep).join('/')}`;
// 1. every script a page needs at start, asked for at once (an ES module chain otherwise costs one round trip
//    per level, which is slow on a mobile line)
function staticImports(entry, seen = new Set()) {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  const src = fs.readFileSync(path.join(OUT, entry), 'utf8');
  for (const m of src.matchAll(/^\s*import\s[^'"]*?from\s*['"]([^'"]+)['"]/gm)) {
    const spec = m[1];
    if (!spec.startsWith('.') && !spec.startsWith('/')) continue;
    const next = spec.startsWith('/') ? spec : path.posix.join(path.posix.dirname(entry), spec);
    if (fs.existsSync(path.join(OUT, next))) staticImports(next, seen);
  }
  return seen;
}
for (const [page, entry] of [['index.html', '/js/main.js'], ['share.html', '/js/share-page.js']]) {
  const file = path.join(OUT, page);
  const mods = [...staticImports(entry)].filter((m) => m !== entry);
  const tags = mods.map((m) => `<link rel="modulepreload" href="${m}">`).join('\n  ');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('</head>', `  ${tags}\n</head>`));
}
// 2. the service worker keeps the app's files on the phone; a new deploy gets a new version
const keep = walk(OUT).filter((f) => !/[\\/](vendor|download|\.well-known)[\\/]/.test(f) && !/\.(txt|map|apk)$/.test(f) && !f.endsWith(`${path.sep}sw.js`));
const hash = crypto.createHash('sha1');
for (const f of keep.sort()) hash.update(f).update(fs.readFileSync(f));
const version = hash.digest('hex').slice(0, 12);
const swFile = path.join(OUT, 'sw.js');
fs.writeFileSync(swFile, fs.readFileSync(swFile, 'utf8')
  .replace("const VERSION = 'dev';", `const VERSION = '${version}';`)
  .replace('const PRECACHE = [];', `const PRECACHE = ${JSON.stringify(keep.map(web).filter((u) => u !== '/index.html').concat('/index.html'))};`));
console.log(`Built dist/ (version ${version}, ${keep.length} files kept offline)`);
