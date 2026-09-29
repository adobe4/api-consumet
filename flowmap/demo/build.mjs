// Builds a static, server-free copy of FlowMap: the same frontend, with js/api.js swapped for
// demo/local-api.js (data kept in the browser). Usage: node demo/build.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'dist-demo'));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const write = (p, s) => { const f = path.join(OUT, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };

fs.rmSync(OUT, { recursive: true, force: true });

// absolute imports become relative so the demo can live under any path
for (const f of fs.readdirSync(path.join(ROOT, 'public/js'))) {
  const src = f === 'api.js' ? read('demo/local-api.js') : read(`public/js/${f}`);
  write(`js/${f}`, src.replaceAll("from '/shared/", "from '../shared/"));
}
const models = read('server/models.js');
const txImport = "import { tx } from './db.js';";
if (!models.includes(txImport)) throw new Error('server/models.js changed: update demo/build.mjs');
write('js/models.js', models.replace(txImport, 'const tx = (db, fn) => fn();'));

for (const f of ['engine.js', 'templates.js']) write(`shared/${f}`, read(`shared/${f}`));
write('css/app.css', read('public/css/app.css'));

// page body only: the host wraps it in its own document skeleton
const html = read('public/index.html');
const head = html.slice(html.indexOf('<head>') + 6, html.indexOf('</head>'));
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
const page = [
  '<title>FlowMap</title>',
  ...head.split('\n').map((l) => l.trim()).filter((l) => /^<link|^<meta name="theme-color"/.test(l)),
  '<style>:root{color-scheme:dark}html,body{background:#0a0a0b}</style>',
  body.trim(),
].join('\n').replaceAll('href="/css/', 'href="css/').replaceAll('src="/js/', 'src="js/');
write('index.html', page + '\n');

console.log(`FlowMap demo built in ${OUT}`);
