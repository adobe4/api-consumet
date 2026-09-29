// Assembles the static site for Vercel into dist/: public/ + shared/ + vendored three.js.
// The API itself is the serverless function in api/index.js.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeVendor } from './vendor.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist');
fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'public'), OUT, { recursive: true });
fs.cpSync(path.join(ROOT, 'shared'), path.join(OUT, 'shared'), { recursive: true });
writeVendor(path.join(OUT, 'vendor/three'));
console.log('Built dist/');
