// three.js files the browser needs, rewritten so they load as plain ES modules (no import map, no bundler).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const THREE = path.join(ROOT, 'node_modules/three');
const ADDONS = [
  'postprocessing/EffectComposer.js', 'postprocessing/RenderPass.js', 'postprocessing/UnrealBloomPass.js', 'postprocessing/OutputPass.js',
  'postprocessing/ShaderPass.js', 'postprocessing/Pass.js', 'postprocessing/MaskPass.js',
  'shaders/CopyShader.js', 'shaders/LuminosityHighPassShader.js', 'shaders/OutputShader.js',
  'environments/RoomEnvironment.js',
];

// published path (under /vendor/three/) -> source file
export const VENDOR = new Map([
  ['three.module.min.js', 'build/three.module.min.js'],
  ['three.core.min.js', 'build/three.core.min.js'],
  ...ADDONS.map((a) => [`addons/${a}`, `examples/jsm/${a}`]),
]);

export function vendorFile(rel) {
  const src = VENDOR.get(rel);
  if (!src) return null;
  let text = fs.readFileSync(path.join(THREE, src), 'utf8');
  if (rel.startsWith('addons/')) {
    const up = '../'.repeat(rel.split('/').length - 1);
    text = text.replace(/from\s+'three'/g, `from '${up}three.module.min.js'`);
  }
  return text;
}

export function writeVendor(outDir) {
  for (const rel of VENDOR.keys()) {
    const f = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, vendorFile(rel));
  }
}
