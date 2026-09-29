// The living map in 3D (three.js): glass tanks of glowing liquid, glass pipes with streams and packets flowing
// through them, bursts when you act and smoke when something is dying. Same interface as the 2D renderer.
//
// Controls follow map apps: drag (one finger, or the mouse) moves the map; pinch or the mouse wheel zooms;
// a two-finger drag on a trackpad or touch screen moves the map; twist with two fingers or right-drag rotates.
import * as THREE from '/vendor/three/three.module.min.js';
import { EffectComposer } from '/vendor/three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from '/vendor/three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '/vendor/three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '/vendor/three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from '/vendor/three/addons/environments/RoomEnvironment.js';
import { S, project, projects, on, liveSnap } from './store.js';
import { RESOURCES, KINDS, TASK_TYPES } from '/shared/engine.js';
import { clamp, lerp, fmtNum } from './util.js';

const U = 100; // map coordinates (stored on projects) per world unit
const STATUS_COLOR = { thriving: '#46e58a', steady: '#f2d15c', thirsty: '#ffb84d', dying: '#ff4d5e' };
const statusOf = (h) => (h >= 75 ? 'thriving' : h >= 50 ? 'steady' : h >= 30 ? 'thirsty' : 'dying');
// tank proportions per kind: radius, height
const FORM = { youtube: [1.05, 1.9], tiktok: [0.8, 2.25], app: [0.74, 2.4], website: [1.15, 1.55], service: [0.95, 1.75], custom: [0.9, 1.8] };
const PLINTH = 0.24;
const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));

export function webglAvailable() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2')); } catch { return false; }
}

// ---------- shaders ----------
const LIQUID_VS = /* glsl */`
  varying vec3 vN; varying vec3 vView; varying float vH; varying float vAng;
  void main() {
    vH = position.y + 0.5;
    vAng = atan(position.z, position.x);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vN = normalize(mat3(modelMatrix) * normal);
    vView = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const LIQUID_FS = /* glsl */`
  uniform vec3 uColor; uniform float uTime; uniform float uDead; uniform float uFlash; uniform float uGlow;
  varying vec3 vN; varying vec3 vView; varying float vH; varying float vAng;
  void main() {
    vec3 col = mix(uColor * 0.12, uColor * 0.7, smoothstep(0.0, 1.0, vH));
    float c = sin(vH * 16.0 - uTime * 0.55 + sin(vAng * 3.0 + uTime * 0.25) * 1.6) * 0.5 + 0.5;
    col += uColor * pow(c, 7.0) * 0.3;
    float fres = pow(1.0 - clamp(abs(dot(vN, vView)), 0.0, 1.0), 2.6);
    col += uColor * fres * (0.3 + uGlow * 0.7);
    col = mix(col, vec3(0.16, 0.11, 0.1) * (0.5 + 0.5 * vH), uDead);
    col += vec3(1.0, 0.95, 0.85) * uFlash * 0.7;
    gl_FragColor = vec4(col, 0.9);
  }`;
const SURFACE_VS = /* glsl */`
  uniform float uTime; uniform float uAmp; uniform float uSlosh;
  varying vec2 vP; varying vec3 vW;
  void main() {
    vec3 p = position; vP = p.xy;
    float r = length(p.xy);
    p.z += sin(p.x * 3.1 + uTime * 0.9) * cos(p.y * 2.7 + uTime * 0.7) * uAmp
         + sin(r * 9.0 - uTime * 4.0) * uSlosh * exp(-r * 1.2);
    vec4 wp = modelMatrix * vec4(p, 1.0); vW = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const SURFACE_FS = /* glsl */`
  uniform vec3 uColor; uniform float uDead; uniform float uFlash;
  varying vec2 vP; varying vec3 vW;
  void main() {
    float r = length(vP);
    if (r > 1.0) discard;
    vec3 n = normalize(cross(dFdx(vW), dFdy(vW))); if (n.y < 0.0) n = -n;
    vec3 v = normalize(cameraPosition - vW);
    vec3 h = normalize(normalize(vec3(0.4, 1.0, 0.25)) + v);
    float spec = pow(max(dot(n, h), 0.0), 70.0);
    float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
    vec3 col = uColor * (0.55 + 0.35 * (1.0 - r));
    col += vec3(1.0, 0.94, 0.84) * spec * 0.9 + uColor * fres * 0.35 + uColor * smoothstep(0.84, 1.0, r) * 0.8;
    col = mix(col, vec3(0.2, 0.14, 0.12), uDead);
    col += uFlash * 0.9;
    gl_FragColor = vec4(col, 0.94);
  }`;
const STREAM_VS = /* glsl */`
  varying vec2 vUv; varying vec3 vN; varying vec3 vV;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const STREAM_FS = /* glsl */`
  uniform vec3 uColor; uniform float uPhase; uniform float uIntensity; uniform float uLen; uniform float uFlash; uniform float uDim;
  varying vec2 vUv; varying vec3 vN; varying vec3 vV;
  void main() {
    float s = vUv.x * uLen;
    float f = fract(s * 0.8 - uPhase);
    float pulse = smoothstep(0.0, 0.18, f) * (1.0 - smoothstep(0.18, 0.85, f));
    float ends = smoothstep(0.0, 0.05, vUv.x) * (1.0 - smoothstep(0.95, 1.0, vUv.x));
    float fres = pow(1.0 - abs(dot(vN, vV)), 1.4);
    float k = uIntensity * (0.35 + 1.5 * pulse) + uFlash * (0.8 + 1.8 * pulse);
    vec3 col = uColor * (0.12 + k) + uColor * fres * 0.25;
    gl_FragColor = vec4(col * uDim, (0.35 + 0.55 * min(1.0, k)) * ends);
  }`;
const GROUND_VS = /* glsl */`
  varying vec3 vW;
  void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`;
const GROUND_FS = /* glsl */`
  uniform vec3 uCenter; uniform float uFuture; uniform float uTime;
  varying vec3 vW;
  void main() {
    vec2 p = vW.xz;
    vec2 q = p * 0.5;
    vec2 g = abs(fract(q - 0.5) - 0.5) / fwidth(q);
    float line = 1.0 - min(min(g.x, g.y), 1.0);
    vec2 q2 = p * 0.1;
    vec2 g2 = abs(fract(q2 - 0.5) - 0.5) / fwidth(q2);
    float major = 1.0 - min(min(g2.x, g2.y), 1.0);
    float d = length(p - uCenter.xz);
    float fade = exp(-d * 0.05);
    vec3 base = mix(vec3(0.028, 0.025, 0.023), vec3(0.075, 0.058, 0.046), fade);
    vec3 lc = mix(vec3(1.0, 0.86, 0.72), vec3(1.0, 0.55, 0.25), uFuture);
    vec3 col = base + lc * (line * 0.035 + major * 0.06) * fade;
    col += vec3(1.0, 0.5, 0.2) * uFuture * 0.03 * (0.5 + 0.5 * sin(p.y * 2.0 - uTime * 2.0)) * fade;
    gl_FragColor = vec4(col, 1.0);
  }`;

// ---------- small textures ----------
function radialTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, inner); g.addColorStop(1, outer);
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function seeded(seed) { let s = seed * 9301 + 49297; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }
function crackTexture(seed) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const x = c.getContext('2d');
  const r = seeded(seed + 7);
  x.strokeStyle = 'rgba(255,255,255,0.95)';
  x.lineCap = 'round';
  for (let i = 0; i < 7; i++) {
    let px = r() * 512, py = r() * 256;
    x.lineWidth = 1.2 + r() * 1.6;
    x.beginPath(); x.moveTo(px, py);
    for (let k = 0; k < 7; k++) {
      px += (r() - 0.5) * 70; py += (r() - 0.3) * 50;
      x.lineTo(px, py);
      if (r() < 0.3) { x.moveTo(px, py); x.lineTo(px + (r() - 0.5) * 40, py + r() * 30); x.moveTo(px, py); }
    }
    x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

export function createRenderer(canvas, hooks) {
  const stage = canvas.parentElement;
  const isTouch = matchMedia('(pointer: coarse)').matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  let pixelRatio = Math.min(window.devicePixelRatio || 1, isTouch ? 1.5 : 2);
  renderer.setPixelRatio(pixelRatio);
  // Neutral tone mapping keeps the project colours saturated instead of bleaching bright liquid to white
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  const BG = new THREE.Color('#0b0a09');
  scene.background = BG.clone();
  scene.fog = new THREE.FogExp2(BG.clone(), 0.018);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  scene.add(new THREE.HemisphereLight('#ffe9d2', '#120d0a', 0.7));
  const key = new THREE.DirectionalLight('#ffd9b0', 1.4);
  key.position.set(6, 12, 4);
  scene.add(key);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.75, 0.55, 0.82);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  let bloomOn = true;

  // ground
  const groundMat = new THREE.ShaderMaterial({ vertexShader: GROUND_VS, fragmentShader: GROUND_FS, uniforms: { uCenter: { value: new THREE.Vector3() }, uFuture: { value: 0 }, uTime: { value: 0 } } });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), groundMat);
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // drifting motes of light
  const moteGeo = new THREE.BufferGeometry();
  const MOTES = 220;
  const motePos = new Float32Array(MOTES * 3);
  const moteSeed = seeded(5);
  for (let i = 0; i < MOTES; i++) { motePos[i * 3] = (moteSeed() - 0.5) * 60; motePos[i * 3 + 1] = moteSeed() * 9 + 0.3; motePos[i * 3 + 2] = (moteSeed() - 0.5) * 60; }
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
  const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({ color: '#ffcf9a', size: 0.06, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, map: radialTexture(), sizeAttenuation: true }));
  scene.add(motes);

  const softTex = radialTexture();
  const smokeTex = radialTexture('rgba(200,190,180,0.9)', 'rgba(200,190,180,0)');

  // ---------- shared geometry ----------
  const G = {
    plinth: new THREE.CylinderGeometry(1.14, 1.24, PLINTH, 56),
    ring: new THREE.TorusGeometry(1.19, 0.03, 10, 120),
    glass: new THREE.CylinderGeometry(1, 1, 1, 64, 1, true),
    rim: new THREE.TorusGeometry(1.02, 0.045, 10, 80),
    liquid: new THREE.CylinderGeometry(1, 1, 1, 64, 1, true),
    surface: new THREE.PlaneGeometry(2, 2, 40, 40),
    hit: new THREE.CylinderGeometry(1, 1, 1, 12),
    pool: new THREE.PlaneGeometry(1, 1),
    bubble: new THREE.SphereGeometry(1, 8, 6),
    wave: new THREE.RingGeometry(0.94, 1, 96),
  };
  const glassMat = new THREE.MeshPhysicalMaterial({ color: '#ffffff', metalness: 0, roughness: 0.06, transparent: true, opacity: 0.14, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.6, side: THREE.DoubleSide, depthWrite: false });
  const pipeGlassMat = new THREE.MeshPhysicalMaterial({ color: '#fff4ea', metalness: 0, roughness: 0.1, transparent: true, opacity: 0.07, envMapIntensity: 0.7, depthWrite: false });
  const plinthMat = new THREE.MeshStandardMaterial({ color: '#1b1714', metalness: 0.7, roughness: 0.32 });
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const bubbleMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false });

  // ---------- overlay for labels ----------
  const overlay = document.createElement('div');
  overlay.className = 'labels3d';
  stage.appendChild(overlay);
  const pipeLabel = document.createElement('div');
  pipeLabel.className = 'pipe3d';
  pipeLabel.hidden = true;
  overlay.appendChild(pipeLabel);

  // ---------- state ----------
  const tanks = new Map(); // project id -> tank
  const pipes = new Map(); // link id -> pipe
  const packets = []; // {pipe, t, v, ph, big}
  const waves = [];
  const smoke = [];
  let time = 0, last = performance.now(), raf = 0;
  let hover = null, linkFrom = null, pointerGround = null;
  let W = 1, H = 1;
  let live = null;

  // ---------- camera rig ----------
  const cam = { tx: 0, tz: 0, dist: 24, yaw: 0.55, pitch: 0.86 };
  const goal = { ...cam };
  let goalActive = false;
  const LIMITS = { dist: [5, 70], pitch: [0.32, 1.48] };
  function applyCamera() {
    const cp = Math.cos(cam.pitch);
    camera.position.set(cam.tx + Math.sin(cam.yaw) * cp * cam.dist, Math.sin(cam.pitch) * cam.dist, cam.tz + Math.cos(cam.yaw) * cp * cam.dist);
    camera.lookAt(cam.tx, 0.8, cam.tz);
    camera.updateMatrixWorld();
  }
  const setGoal = (g) => { Object.assign(goal, cam, g); goal.dist = clamp(goal.dist, ...LIMITS.dist); goal.pitch = clamp(goal.pitch, ...LIMITS.pitch); goalActive = true; };
  const stopGoal = () => { goalActive = false; Object.assign(goal, cam); };

  // ---------- geometry helpers ----------
  const worldOf = (p) => new THREE.Vector3(p.x / U, 0, p.y / U);
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function rayFrom(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return raycaster;
  }
  function groundAt(clientX, clientY) {
    const out = new THREE.Vector3();
    return rayFrom(clientX, clientY).ray.intersectPlane(groundPlane, out) ? out : null;
  }
  function pick(clientX, clientY) {
    const rc = rayFrom(clientX, clientY);
    const targets = [...[...tanks.values()].map((t) => t.hit), ...[...pipes.values()].map((p) => p.hit).filter(Boolean)];
    const hit = rc.intersectObjects(targets, false)[0];
    return hit ? hit.object.userData : null;
  }

  // ---------- tanks ----------
  function makeTank(p) {
    const color = new THREE.Color(p.color || KINDS[p.kind]?.color || '#ffffff');
    const group = new THREE.Group();
    const plinth = new THREE.Mesh(G.plinth, plinthMat);
    plinth.position.y = PLINTH / 2;
    const ringMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
    const ring = new THREE.Mesh(G.ring, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = PLINTH + 0.01;
    const vessel = new THREE.Group(); // scaled to the tank's radius/height
    vessel.position.y = PLINTH;
    const liquidU = { uColor: { value: color.clone() }, uTime: { value: 0 }, uDead: { value: 0 }, uFlash: { value: 0 }, uGlow: { value: 0.5 } };
    const liquid = new THREE.Mesh(G.liquid, new THREE.ShaderMaterial({ vertexShader: LIQUID_VS, fragmentShader: LIQUID_FS, uniforms: liquidU, transparent: true, depthWrite: false }));
    liquid.renderOrder = 1;
    const surfaceU = { uColor: liquidU.uColor, uTime: liquidU.uTime, uDead: liquidU.uDead, uFlash: liquidU.uFlash, uAmp: { value: 0.02 }, uSlosh: { value: 0 } };
    const surface = new THREE.Mesh(G.surface, new THREE.ShaderMaterial({ vertexShader: SURFACE_VS, fragmentShader: SURFACE_FS, uniforms: surfaceU, transparent: true, depthWrite: false }));
    surface.rotation.x = -Math.PI / 2;
    surface.renderOrder = 2;
    const glass = new THREE.Mesh(G.glass, glassMat);
    glass.renderOrder = 3;
    const crackMat = new THREE.MeshBasicMaterial({ color: '#ffd6c2', alphaMap: crackTexture(p.id), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    const cracks = new THREE.Mesh(G.glass, crackMat);
    cracks.renderOrder = 4;
    const rimMat = new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.55), metalness: 0.85, roughness: 0.25, emissive: color.clone(), emissiveIntensity: 0.12 });
    const rimTop = new THREE.Mesh(G.rim, rimMat), rimBottom = new THREE.Mesh(G.rim, rimMat);
    rimTop.rotation.x = rimBottom.rotation.x = Math.PI / 2;
    const bubbles = new THREE.InstancedMesh(G.bubble, bubbleMat, 14);
    bubbles.frustumCulled = false;
    bubbles.renderOrder = 2;
    const pool = new THREE.Mesh(G.pool, new THREE.MeshBasicMaterial({ map: softTex, color: color.clone(), transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }));
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.012;
    const hit = new THREE.Mesh(G.hit, hitMat);
    hit.userData = { type: 'node', id: p.id };
    vessel.add(liquid, surface, glass, cracks, rimTop, rimBottom, bubbles);
    group.add(pool, plinth, ring, vessel, hit);
    scene.add(group);

    const label = document.createElement('div');
    label.className = 'tank3d';
    label.innerHTML = '<div class="ic"></div><div class="nm"></div><div class="nums"></div><div class="st"></div>';
    overlay.appendChild(label);
    const s0 = live?.projects[p.id];
    const t = {
      id: p.id, group, plinth, vessel, liquid, surface, glass, cracks, crackMat, ring, ringMat, rimTop, rimBottom, bubbles, pool, hit, label, liquidU, surfaceU, color,
      r: 1, h: 1.8, health: s0 ? s0.health : 60, level: 0.6, size: 1, flash: 0, slosh: 0, phase: Math.random() * 6.28, smokeAcc: 0,
      bubbleSeeds: Array.from({ length: 14 }, (_, i) => { const r = seeded(p.id * 31 + i); return [r() * 6.28, 0.25 + r() * 0.6, r(), 0.018 + r() * 0.025]; }),
      text: '',
    };
    tanks.set(p.id, t);
    return t;
  }
  function removeTank(t) {
    scene.remove(t.group);
    t.liquid.material.dispose(); t.surface.material.dispose(); t.crackMat.alphaMap.dispose(); t.crackMat.dispose(); t.ringMat.dispose();
    t.rimTop.material.dispose(); t.pool.material.dispose(); t.bubbles.dispose();
    t.label.remove();
    tanks.delete(t.id);
  }
  const outputSize = (s) => clamp(Math.log10(1 + (s?.money || 0) + (s?.attention || 0) * 0.02) / 5, 0, 1);

  function updateTank(t, p, dt) {
    const s = live?.projects[p.id] || { health: 60, money: 0, attention: 0, customers: 0, boost: 0 };
    const [br, bh] = FORM[p.kind] || FORM.custom;
    const size = 0.82 + 0.36 * outputSize(s);
    t.size = damp(t.size, size, 3, dt);
    t.r = br * t.size; t.h = bh * t.size;
    t.health = damp(t.health, s.health, 2.2, dt);
    const status = statusOf(t.health);
    const dying = status === 'dying';
    const dead = clamp((50 - t.health) / 50, 0, 1);
    t.level = clamp(t.health / 100, 0.04, 0.97);
    t.flash = Math.max(0, t.flash - dt * 0.9);
    t.slosh = Math.max(0, t.slosh - dt * 0.35);

    const pos = worldOf(p);
    t.group.position.set(pos.x + (dying ? Math.sin(time * 31 + t.phase) * 0.012 : 0), 0, pos.z);
    t.vessel.scale.set(t.r, 1, t.r);
    t.plinth.scale.set(t.r, 1, t.r);
    t.glass.scale.set(1, t.h, 1); t.glass.position.y = t.h / 2;
    t.cracks.scale.set(1.004, t.h, 1.004); t.cracks.position.y = t.h / 2;
    t.crackMat.opacity = dead * 0.5;
    t.rimBottom.position.y = 0.02; t.rimTop.position.y = t.h;
    const lh = t.h * t.level;
    t.liquid.scale.set(0.955, lh, 0.955); t.liquid.position.y = lh / 2 + 0.01;
    t.surface.scale.set(0.955, 0.955, 1); t.surface.position.y = lh + 0.01;
    t.hit.scale.set(t.r * 1.15, t.h + PLINTH + 0.3, t.r * 1.15); t.hit.position.y = (t.h + PLINTH) / 2;
    t.pool.scale.setScalar(t.r * 5.2);
    t.pool.material.opacity = 0.08 + 0.3 * (t.health / 100) + t.flash * 0.4;

    const u = t.liquidU;
    u.uTime.value = time + t.phase * 10;
    u.uDead.value = dead * 0.85;
    u.uFlash.value = t.flash;
    u.uGlow.value = 0.25 + 0.6 * (t.health / 100) + (s.boost > 0.3 ? 0.5 : 0);
    t.surfaceU.uAmp.value = 0.012 + 0.02 * (t.health / 100);
    t.surfaceU.uSlosh.value = t.slosh * 0.09;

    const sel = S.selection?.type === 'project' && S.selection.id === p.id;
    const hov = hover?.type === 'node' && hover.id === p.id;
    const breathe = status === 'thriving' ? 0.5 + 0.5 * Math.sin(time * 1.3 + t.phase) : dying ? 0.5 + 0.5 * Math.sin(time * 5) : 0.4;
    t.ringMat.color.set(STATUS_COLOR[status]).multiplyScalar(0.9 + 0.9 * breathe + (sel ? 1.4 : hov ? 0.7 : 0) + t.flash * 2);
    t.ring.scale.setScalar(t.r * (sel ? 1.06 + 0.02 * Math.sin(time * 3) : 1));

    // bubbles rise slowly through the liquid while the project is alive
    const m = new THREE.Matrix4();
    const alive = t.health > 30;
    t.bubbleSeeds.forEach(([ang, rad, off, size], i) => {
      const k = (time * (0.05 + size * 2) + off) % 1;
      const y = k * lh;
      const a = ang + Math.sin(time * 0.4 + i) * 0.3;
      const sc = alive ? size * (0.6 + 0.4 * (t.health / 100)) : 0;
      m.makeScale(sc / t.r, sc, sc / t.r);
      m.setPosition(Math.cos(a) * rad * 0.8, y, Math.sin(a) * rad * 0.8);
      t.bubbles.setMatrixAt(i, m);
    });
    t.bubbles.instanceMatrix.needsUpdate = true;

    // smoke from a dying tank
    if (dying) {
      t.smokeAcc += dt * 1.6;
      while (t.smokeAcc > 1) { t.smokeAcc -= 1; spawnSmoke(t.group.position.x, t.h + PLINTH, t.group.position.z, t.r); }
    }
    return { s, status, sel, hov };
  }

  // ---------- pipes ----------
  function makePipe(l) {
    const R = RESOURCES[l.resource];
    const color = new THREE.Color(R.color);
    const streamU = { uColor: { value: color }, uPhase: { value: 0 }, uIntensity: { value: 0.5 }, uLen: { value: 1 }, uFlash: { value: 0 }, uDim: { value: 1 } };
    const streamMat = new THREE.ShaderMaterial({ vertexShader: STREAM_VS, fragmentShader: STREAM_FS, uniforms: streamU, transparent: true, depthWrite: false, toneMapped: false });
    const p = { id: l.id, resource: l.resource, streamU, streamMat, color, key: '', curve: null, glass: null, stream: null, hit: null, arrow: null, norm: 0, speed: 0.3, boost: 1, flash: 0, acc: 0, length: 1 };
    pipes.set(l.id, p);
    return p;
  }
  function disposePipeMeshes(p) {
    for (const k of ['glass', 'stream', 'hit', 'arrow']) if (p[k]) { scene.remove(p[k]); p[k].geometry.dispose(); }
    if (p.arrow) p.arrow.material.dispose();
  }
  function removePipe(p) { disposePipeMeshes(p); p.streamMat.dispose(); pipes.delete(p.id); }

  function buildPipe(p, l, offset) {
    const a = project(l.from), b = project(l.to);
    const ta = tanks.get(l.from), tb = tanks.get(l.to);
    if (!a || !b || !ta || !tb) return;
    const A = worldOf(a), B = worldOf(b);
    const width = 0.05 + 0.1 * Math.sqrt(clamp(l.share, 0, 1));
    const key = [A.x, A.z, B.x, B.z, width, offset].map((v) => v.toFixed(2)).concat([ta.r, ta.h, tb.r, tb.h].map((v) => v.toFixed(1))).join(',');
    if (key === p.key) return;
    p.key = key;
    disposePipeMeshes(p);
    const dir = B.clone().sub(A).setY(0);
    const dist = dir.length() || 1;
    dir.divideScalar(dist);
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const start = A.clone().addScaledVector(dir, ta.r * 1.02).addScaledVector(side, offset * 0.35); start.y = PLINTH + ta.h * 0.62;
    const end = B.clone().addScaledVector(dir, -tb.r * 1.02).addScaledVector(side, offset * 0.35); end.y = PLINTH + tb.h * 0.45;
    const lift = 0.9 + dist * 0.12;
    const c1 = start.clone().addScaledVector(dir, dist * 0.3).addScaledVector(side, offset * 0.9); c1.y = Math.max(start.y, end.y) + lift;
    const c2 = end.clone().addScaledVector(dir, -dist * 0.3).addScaledVector(side, offset * 0.9); c2.y = Math.max(start.y, end.y) + lift * 0.8;
    p.curve = new THREE.CubicBezierCurve3(start, c1, c2, end);
    p.length = p.curve.getLength();
    const seg = Math.max(40, Math.round(p.length * 10));
    p.glass = new THREE.Mesh(new THREE.TubeGeometry(p.curve, seg, width, 14, false), pipeGlassMat);
    p.glass.renderOrder = 3;
    p.stream = new THREE.Mesh(new THREE.TubeGeometry(p.curve, seg, width * 0.62, 10, false), p.streamMat);
    p.stream.renderOrder = 1;
    p.hit = new THREE.Mesh(new THREE.TubeGeometry(p.curve, 24, Math.max(0.28, width * 2.5), 6, false), hitMat);
    p.hit.userData = { type: 'link', id: p.id };
    // a small glowing arrowhead near the receiving tank shows which way the pipe flows
    p.arrow = new THREE.Mesh(new THREE.ConeGeometry(width * 1.5, width * 4, 16).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: p.color.clone().multiplyScalar(1.4), toneMapped: false }));
    p.arrow.position.copy(p.curve.getPointAt(0.93));
    p.arrow.lookAt(p.curve.getPointAt(0.99));
    p.streamU.uLen.value = p.length;
    scene.add(p.glass, p.stream, p.hit, p.arrow);
  }

  // packets: small glowing objects that travel through the pipes, one mesh per resource
  const PACKET_MAX = 700;
  const packetGeo = {
    money: new THREE.CylinderGeometry(0.075, 0.075, 0.022, 20).rotateX(Math.PI / 2),
    attention: new THREE.SphereGeometry(0.06, 14, 10),
    customers: new THREE.CapsuleGeometry(0.035, 0.05, 4, 10),
    progress: new THREE.OctahedronGeometry(0.07),
  };
  const packetMesh = {};
  for (const [k, geo] of Object.entries(packetGeo)) {
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(RESOURCES[k].color).multiplyScalar(2.2), toneMapped: false }), PACKET_MAX);
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.renderOrder = 2;
    packetMesh[k] = mesh;
    scene.add(mesh);
  }

  function spawnPacket(p, extra = {}) {
    if (packets.length >= PACKET_MAX * 2) return;
    packets.push({ pipe: p, t: 0, v: 1, ph: Math.random() * 6.28, big: 1, ...extra });
  }

  // ---------- effects ----------
  function spawnSmoke(x, y, z, r) {
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: '#8f857c', transparent: true, opacity: 0, depthWrite: false }));
    spr.position.set(x + (Math.random() - 0.5) * r, y, z + (Math.random() - 0.5) * r);
    spr.scale.setScalar(0.5);
    scene.add(spr);
    smoke.push({ spr, life: 1, vx: (Math.random() - 0.5) * 0.15, vy: 0.35 + Math.random() * 0.25 });
  }
  function spawnWave(x, z, r, color, speed = 2.2) {
    const mesh = new THREE.Mesh(G.wave, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.8), transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.03, z);
    mesh.scale.setScalar(r);
    scene.add(mesh);
    waves.push({ mesh, life: 1, speed });
  }
  function floater(worldPos, text, color, delay = 0) {
    const el = document.createElement('div');
    el.className = 'float3d';
    el.textContent = text;
    el.style.color = color;
    el.style.animationDelay = `${delay}s`;
    overlay.appendChild(el);
    const f = { el, pos: worldPos.clone() };
    floaters.add(f);
    setTimeout(() => { el.remove(); floaters.delete(f); }, 2600 + delay * 1000);
  }
  const floaters = new Set();

  // ---------- labels ----------
  const v3 = new THREE.Vector3();
  function toScreen(pos) {
    v3.copy(pos).project(camera);
    return { x: (v3.x * 0.5 + 0.5) * W, y: (-v3.y * 0.5 + 0.5) * H, behind: v3.z > 1 };
  }
  function updateLabel(t, p, info) {
    const { s, status, sel, hov } = info;
    const kind = KINDS[p.kind] || KINDS.custom;
    const nums = [];
    if (s.money > 0.5) nums.push(`<span style="color:${RESOURCES.money.color}">TZS ${fmtNum(s.money)}</span>`);
    if (s.attention > 0.5) nums.push(`<span style="color:${RESOURCES.attention.color}">👁 ${fmtNum(s.attention)}</span>`);
    if (s.customers >= 0.05) nums.push(`<span style="color:${RESOURCES.customers.color}">👤 ${fmtNum(s.customers)}</span>`);
    const chip = status === 'thirsty' ? '💧 ' : status === 'dying' ? '⚠️ ' : s.boost > 0.3 ? '🔥 ' : '';
    const text = `${p.icon || kind.icon}|${p.name}|${nums.join('')}|${chip}${Math.round(t.health)}% · ${status}`;
    if (text !== t.text) {
      t.text = text;
      const [ic, nm, nu, st] = t.label.children;
      ic.textContent = p.icon || kind.icon;
      nm.textContent = p.name;
      nu.innerHTML = nums.join('');
      st.textContent = `${chip}${Math.round(t.health)}% · ${status}`;
      st.style.color = STATUS_COLOR[status];
    }
    const top = t.group.position.clone();
    top.y = PLINTH + t.h + 0.35;
    const sp = toScreen(top);
    const d = camera.position.distanceTo(top);
    const scale = clamp(19 / d, 0.62, 1.15);
    t.label.style.transform = `translate3d(${sp.x}px, ${sp.y}px, 0) translate(-50%, -100%) scale(${scale.toFixed(3)})`;
    t.label.style.zIndex = sel || hov ? '5' : '1';
    t.label.hidden = sp.behind;
    t.label.classList.toggle('sel', sel);
    t.label.classList.toggle('hov', hov);
    t.label.classList.toggle('compact', d > 34);
    t.label.classList.toggle('dim', !!S.selection && !sel);
  }

  // ---------- frame ----------
  let frames = 0, slowTime = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!S.sim || W < 2) return;
    time += dt;
    live = liveSnap();

    // camera easing
    if (goalActive) {
      for (const k of ['tx', 'tz', 'dist', 'yaw', 'pitch']) cam[k] = damp(cam[k], goal[k], 7, dt);
      if (Math.abs(cam.tx - goal.tx) + Math.abs(cam.tz - goal.tz) + Math.abs(cam.dist - goal.dist) * 0.2 + Math.abs(cam.yaw - goal.yaw) + Math.abs(cam.pitch - goal.pitch) < 0.002) goalActive = false;
    }
    applyCamera();

    // tanks
    const list = projects();
    const seen = new Set();
    let cx = 0, cz = 0;
    for (const p of list) {
      seen.add(p.id);
      const t = tanks.get(p.id) || makeTank(p);
      const c = p.color || KINDS[p.kind]?.color || '#ffffff';
      if (t.colorHex !== c) { t.colorHex = c; t.color.set(c); t.liquidU.uColor.value.set(c); t.pool.material.color.set(c); t.rimTop.material.color.set(c).multiplyScalar(0.55); t.rimTop.material.emissive.set(c); }
      updateLabel(t, p, updateTank(t, p, dt));
      cx += p.x / U; cz += p.y / U;
    }
    for (const t of [...tanks.values()]) if (!seen.has(t.id)) removeTank(t);
    if (list.length) groundMat.uniforms.uCenter.value.set(cx / list.length, 0, cz / list.length);
    groundMat.uniforms.uTime.value = time;
    groundMat.uniforms.uFuture.value = damp(groundMat.uniforms.uFuture.value, S.offset > 0 ? 1 : 0, 3, dt);
    scene.fog.color.copy(BG).lerp(new THREE.Color('#1a100a'), groundMat.uniforms.uFuture.value);
    scene.background.copy(scene.fog.color);

    // pipes: parallel links between the same two projects fan out
    const groups = new Map();
    const links = S.world.links.filter((l) => tanks.has(l.from) && tanks.has(l.to));
    for (const l of links) { const k = l.from < l.to ? `${l.from}-${l.to}` : `${l.to}-${l.from}`; (groups.get(k) || groups.set(k, []).get(k)).push(l); }
    const liveLinks = new Set();
    let activeLabel = null;
    for (const g of groups.values()) {
      g.sort((a, b) => a.id - b.id);
      g.forEach((l, i) => {
        liveLinks.add(l.id);
        const p = pipes.get(l.id) || makePipe(l);
        if (p.resource !== l.resource) { p.resource = l.resource; p.color.set(RESOURCES[l.resource].color); p.key = ''; }
        const canonical = l.from < l.to ? 1 : -1;
        buildPipe(p, l, (g.length > 1 ? i - (g.length - 1) / 2 : 0.35) * canonical);
        const o = live?.links[l.id];
        if (!o || !p.curve) return;
        p.norm = damp(p.norm, o.norm, 2, dt);
        p.speed = damp(p.speed, o.speed, 2, dt);
        p.boost = damp(p.boost, o.boost, 2, dt);
        p.flash = Math.max(0, p.flash - dt * 0.18);
        const R = RESOURCES[l.resource];
        // calm, real-time pace: a packet takes roughly 6-20 seconds to cross a pipe
        const vel = (0.35 + 0.8 * p.speed) * R.speed * (1 + p.flash * 1.6);
        p.streamU.uPhase.value += dt * vel * 0.8;
        p.streamU.uIntensity.value = 0.3 + 1.1 * p.norm;
        p.streamU.uFlash.value = p.flash;
        const hot = (hover?.type === 'link' && hover.id === l.id) || (S.selection?.type === 'link' && S.selection.id === l.id);
        const related = (hover?.type === 'node' && (hover.id === l.from || hover.id === l.to)) || (S.selection?.type === 'project' && (S.selection.id === l.from || S.selection.id === l.to));
        p.streamU.uDim.value = damp(p.streamU.uDim.value, (S.selection || hover) && !hot && !related ? 0.35 : hot ? 1.5 : 1, 6, dt);
        const rate = p.norm > 0.015 ? 0.06 + 0.55 * p.norm : 0;
        p.acc += rate * dt;
        while (p.acc >= 1) { p.acc -= 1; spawnPacket(p, { v: vel }); }
        if (hot || (related && S.selection)) activeLabel = { l, p, o };
      });
    }
    for (const p of [...pipes.values()]) if (!liveLinks.has(p.id)) removePipe(p);

    // packets
    const counts = { money: 0, attention: 0, customers: 0, progress: 0 };
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (let i = packets.length - 1; i >= 0; i--) {
      const k = packets[i];
      if (!pipes.has(k.pipe.id) || !k.pipe.curve) { packets.splice(i, 1); continue; }
      k.t += (k.v * dt) / k.pipe.length;
      if (k.t >= 1) { packets.splice(i, 1); continue; }
      if (k.t < 0) continue;
      const mesh = packetMesh[k.pipe.resource];
      if (counts[k.pipe.resource] >= PACKET_MAX) continue;
      const pos = k.pipe.curve.getPointAt(k.t);
      const fade = Math.min(1, k.t * 12, (1 - k.t) * 12);
      const s = fade * k.big * (0.8 + 0.5 * k.pipe.norm);
      if (k.pipe.resource === 'money') q.setFromAxisAngle(up, time * 2 + k.ph);
      else if (k.pipe.resource === 'progress') q.setFromAxisAngle(up, time * 3 + k.ph);
      else q.identity();
      m.compose(pos, q, sc.set(s, s, s));
      mesh.setMatrixAt(counts[k.pipe.resource]++, m);
    }
    for (const [res, mesh] of Object.entries(packetMesh)) { mesh.count = counts[res]; mesh.instanceMatrix.needsUpdate = true; }

    // pipe label
    if (activeLabel) {
      const { l, p, o } = activeLabel;
      const R = RESOURCES[l.resource];
      const text = l.resource === 'money' ? `TZS ${fmtNum(o.amount)}/day` : l.resource === 'attention' ? `${fmtNum(o.amount)} views/day` : l.resource === 'customers' ? `${fmtNum(o.amount)} customers/day` : `${Math.round(o.amount * 100)}% energy`;
      const sp = toScreen(p.curve.getPointAt(0.5));
      pipeLabel.hidden = sp.behind;
      pipeLabel.textContent = text;
      pipeLabel.style.color = R.color;
      pipeLabel.style.borderColor = R.color;
      pipeLabel.style.transform = `translate3d(${sp.x}px, ${sp.y}px, 0) translate(-50%, -50%)`;
    } else pipeLabel.hidden = true;

    // effects
    for (let i = waves.length - 1; i >= 0; i--) {
      const w = waves[i];
      w.life -= dt * 0.55;
      w.mesh.scale.multiplyScalar(1 + dt * w.speed * 0.6);
      w.mesh.material.opacity = Math.max(0, w.life) * 0.8;
      if (w.life <= 0) { scene.remove(w.mesh); w.mesh.material.dispose(); waves.splice(i, 1); }
    }
    for (let i = smoke.length - 1; i >= 0; i--) {
      const s = smoke[i];
      s.life -= dt * 0.28;
      s.spr.position.x += s.vx * dt; s.spr.position.y += s.vy * dt;
      s.spr.scale.setScalar(0.5 + (1 - s.life) * 1.8);
      s.spr.material.opacity = Math.min(1, (1 - s.life) * 4) * Math.max(0, s.life) * 0.45;
      if (s.life <= 0) { scene.remove(s.spr); s.spr.material.dispose(); smoke.splice(i, 1); }
    }
    const mp = moteGeo.attributes.position;
    for (let i = 0; i < MOTES; i++) {
      let y = mp.getY(i) + dt * 0.08 * (0.5 + (i % 5) * 0.2);
      if (y > 9.5) y = 0.3;
      mp.setY(i, y);
    }
    mp.needsUpdate = true;
    for (const f of floaters) {
      const sp = toScreen(f.pos);
      f.el.style.left = `${sp.x}px`; f.el.style.top = `${sp.y}px`;
    }

    // link tool preview
    updateLinkPreview();

    if (bloomOn) composer.render(); else renderer.render(scene, camera);

    // keep phones smooth: lower the resolution, then drop the glow, if frames run long
    frames++;
    if (dt > 0.034) slowTime += dt; else slowTime = Math.max(0, slowTime - dt * 0.5);
    if (frames > 120 && slowTime > 2) {
      slowTime = 0;
      if (pixelRatio > 1) { pixelRatio = 1; renderer.setPixelRatio(1); resize(); }
      else if (bloomOn) bloomOn = false;
    }
  }

  // ---------- link tool ----------
  const previewMat = new THREE.LineDashedMaterial({ color: '#ffffff', dashSize: 0.3, gapSize: 0.2, transparent: true, opacity: 0.85 });
  let previewLine = null;
  function updateLinkPreview() {
    if (previewLine) { scene.remove(previewLine); previewLine.geometry.dispose(); previewLine = null; }
    if (S.tool !== 'link' || !linkFrom || !pointerGround) return;
    const t = tanks.get(linkFrom);
    if (!t) return;
    const a = t.group.position.clone(); a.y = PLINTH + t.h * 0.6;
    const b = pointerGround.clone(); b.y = 0.6;
    const mid = a.clone().lerp(b, 0.5); mid.y += 1.2;
    const geo = new THREE.BufferGeometry().setFromPoints(new THREE.QuadraticBezierCurve3(a, mid, b).getPoints(30));
    previewLine = new THREE.Line(geo, previewMat);
    previewLine.computeLineDistances();
    scene.add(previewLine);
  }

  // ---------- input ----------
  const pointers = new Map(); // id -> {x, y}
  let mode = null; // 'pan' | 'rotate' | 'node' | 'multi' | 'link'
  let grab = null, nodeDrag = null, press = null, multi = null;
  let lastTap = { t: 0, x: 0, y: 0 };
  const setCursor = (c) => { canvas.style.cursor = c; };

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    stopGoal();
    if (pointers.size === 2) { startMulti(); return; }
    if (pointers.size > 2) return;
    press = { x: e.clientX, y: e.clientY, moved: false, at: performance.now() };
    const hit = pick(e.clientX, e.clientY);
    if (S.tool === 'link') {
      mode = 'link';
      if (hit?.type === 'node') {
        if (!linkFrom) { linkFrom = hit.id; hooks.onToolHint?.('Now tap the project it feeds'); }
        else if (hit.id !== linkFrom) { const from = linkFrom; linkFrom = null; hooks.onLinkPicked?.(from, hit.id); }
      } else linkFrom = null;
      return;
    }
    if (e.button === 2 || (e.button === 0 && (e.shiftKey || e.altKey))) { mode = 'rotate'; setCursor('move'); return; }
    if (hit?.type === 'node') {
      const p = project(hit.id);
      const g = groundAt(e.clientX, e.clientY);
      nodeDrag = { id: hit.id, dx: p.x / U - (g?.x ?? 0), dz: p.y / U - (g?.z ?? 0) };
      mode = 'node';
      press.hit = hit;
      setCursor('grabbing');
      return;
    }
    press.hit = hit;
    mode = 'pan';
    grab = groundAt(e.clientX, e.clientY);
    setCursor('grabbing');
  });

  function startMulti() {
    const [a, b] = [...pointers.values()];
    mode = 'multi';
    nodeDrag = null; grab = null;
    multi = { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) || 1, ang: Math.atan2(b.y - a.y, b.x - a.x) };
    if (press) press.moved = true;
  }
  // keep a ground point exactly under a screen point after the camera changed
  function pinGround(before, clientX, clientY) {
    if (!before) return;
    applyCamera();
    const after = groundAt(clientX, clientY);
    if (!after) return;
    cam.tx += before.x - after.x; cam.tz += before.z - after.z;
    Object.assign(goal, cam);
  }

  canvas.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    pointerGround = groundAt(e.clientX, e.clientY);
    if (press && !press.moved && Math.hypot(e.clientX - press.x, e.clientY - press.y) > (e.pointerType === 'touch' ? 8 : 4)) press.moved = true;

    if (mode === 'multi' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const cxy = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const anchor = groundAt(multi.cx, multi.cy);
      cam.dist = clamp(cam.dist * (multi.d / d), ...LIMITS.dist); // pinch: only the distance between fingers zooms
      let da = ang - multi.ang;
      if (da > Math.PI) da -= Math.PI * 2; else if (da < -Math.PI) da += Math.PI * 2;
      cam.yaw -= da; // twist rotates
      pinGround(anchor, cxy.x, cxy.y); // moving both fingers together pans
      multi = { cx: cxy.x, cy: cxy.y, d, ang };
      return;
    }
    if (mode === 'pan' && grab) {
      if (!press?.moved) return;
      pinGround(grab, e.clientX, e.clientY);
      return;
    }
    if (mode === 'rotate') {
      cam.yaw -= e.movementX * 0.006;
      cam.pitch = clamp(cam.pitch + e.movementY * 0.004, ...LIMITS.pitch);
      Object.assign(goal, cam);
      return;
    }
    if (mode === 'node' && nodeDrag) {
      if (!press?.moved) return;
      const g = pointerGround;
      if (g) hooks.onMoved?.(nodeDrag.id, Math.round((g.x + nodeDrag.dx) * U), Math.round((g.z + nodeDrag.dz) * U));
      return;
    }
    if (e.pointerType === 'mouse' && !mode) {
      const hit = pick(e.clientX, e.clientY);
      const next = hit ? { type: hit.type, id: hit.id } : null;
      if (next?.id !== hover?.id || next?.type !== hover?.type) hover = next;
      hooks.onHover?.(hover, e.clientX, e.clientY);
      setCursor(S.tool === 'link' ? 'crosshair' : hover ? 'pointer' : 'grab');
    }
  });

  const end = (e) => {
    pointers.delete(e.pointerId);
    if (mode === 'multi') {
      if (pointers.size === 1) { // continue as a one-finger pan
        const [pt] = [...pointers.values()];
        mode = 'pan'; grab = groundAt(pt.x, pt.y); press = { x: pt.x, y: pt.y, moved: true };
      } else if (!pointers.size) mode = null;
      return;
    }
    if (pointers.size) return;
    const wasClick = press && !press.moved;
    if (wasClick && mode === 'node') hooks.onSelect?.({ type: 'project', id: nodeDrag.id });
    else if (wasClick && mode === 'pan') {
      if (press.hit?.type === 'link') hooks.onSelect?.({ type: 'link', id: press.hit.id });
      else {
        hooks.onSelect?.(null);
        // double tap on empty ground adds a project there (touch has no dblclick)
        const now = performance.now();
        if (e.pointerType !== 'mouse' && now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 24) {
          const g = groundAt(e.clientX, e.clientY);
          if (g) hooks.onAddAt?.(Math.round(g.x * U), Math.round(g.z * U));
          lastTap.t = 0;
        } else lastTap = { t: now, x: e.clientX, y: e.clientY };
      }
    }
    mode = null; grab = null; nodeDrag = null; press = null;
    setCursor(S.tool === 'link' ? 'crosshair' : 'grab');
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && hover) { hover = null; hooks.onHover?.(null); } });

  // Wheel: a mouse wheel (and trackpad pinch, which arrives as ctrl+wheel) zooms toward the cursor;
  // two-finger scrolling on a trackpad moves the map, like map and design apps.
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    stopGoal();
    const mouseWheel = e.deltaMode !== 0 || (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50);
    if (e.ctrlKey || mouseWheel) {
      const anchor = groundAt(e.clientX, e.clientY);
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      cam.dist = clamp(cam.dist * Math.exp(dy * (e.ctrlKey ? 0.01 : 0.0012)), ...LIMITS.dist);
      pinGround(anchor, e.clientX, e.clientY);
    } else {
      // pan by screen pixels, converted to ground distance at the current zoom
      const r = canvas.getBoundingClientRect();
      const before = groundAt(r.left + r.width / 2, r.top + r.height / 2);
      const after = groundAt(r.left + r.width / 2 + e.deltaX, r.top + r.height / 2 + e.deltaY);
      if (before && after) { cam.tx += after.x - before.x; cam.tz += after.z - before.z; Object.assign(goal, cam); }
    }
  }, { passive: false });

  canvas.addEventListener('dblclick', (e) => {
    if (pick(e.clientX, e.clientY)) return;
    const g = groundAt(e.clientX, e.clientY);
    if (g) hooks.onAddAt?.(Math.round(g.x * U), Math.round(g.z * U));
  });

  const offTool = on('tool', () => { linkFrom = null; setCursor(S.tool === 'link' ? 'crosshair' : 'grab'); });

  // ---------- size ----------
  function resize() {
    const r = canvas.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    renderer.setSize(W, H, false);
    composer.setPixelRatio(pixelRatio);
    composer.setSize(W, H);
    bloom.resolution.set(W / 2, H / 2);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();
  applyCamera();
  raf = requestAnimationFrame(frame);

  // ---------- public api ----------
  function fit({ animate = true } = {}) {
    const list = projects();
    if (!list.length) { setGoal({ tx: 0, tz: 0, dist: 20 }); return; }
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const p of list) { x0 = Math.min(x0, p.x / U); x1 = Math.max(x1, p.x / U); z0 = Math.min(z0, p.y / U); z1 = Math.max(z1, p.y / U); }
    const radius = Math.hypot(x1 - x0, z1 - z0) / 2 + 1.4;
    const fov = (camera.fov * Math.PI) / 180;
    const fitH = radius / Math.tan(fov / 2);
    const fitW = radius / (Math.tan(fov / 2) * camera.aspect);
    const g = { tx: (x0 + x1) / 2, tz: (z0 + z1) / 2 + 0.4, dist: clamp(Math.max(fitH, fitW) * (camera.aspect < 1 ? 1.05 : 0.92), ...LIMITS.dist) };
    if (animate) setGoal(g); else { Object.assign(cam, g); Object.assign(goal, cam); applyCamera(); }
  }
  function focus(id) {
    const p = project(id);
    if (!p) return;
    setGoal({ tx: p.x / U, tz: p.y / U, dist: Math.min(cam.dist, 16) });
  }
  const zoomBy = (f) => setGoal({ dist: cam.dist / f });
  const rotateBy = (a) => setGoal({ yaw: cam.yaw + a });
  const toggleTilt = () => setGoal({ pitch: cam.pitch > 1.2 ? 0.86 : 1.45 });

  // A completed task splashes the tank and sends a surge down every pipe it was aimed at.
  function burst(task) {
    const p = project(task.projectId), t = tanks.get(task.projectId);
    if (!p || !t) return;
    t.flash = 1;
    t.slosh = 1;
    const pos = t.group.position;
    spawnWave(pos.x, pos.z, t.r * 1.2, '#ffffff', 3);
    spawnWave(pos.x, pos.z, t.r * 1.2, p.color || KINDS[p.kind]?.color, 1.8);
    const q = clamp(task.quality || 3, 1, 5) / 3;
    const aimed = task.targets || [];
    for (const l of S.world.links.filter((x) => x.from === p.id)) {
      const pp = pipes.get(l.id);
      if (!pp?.curve) continue;
      if (l.resource === 'money' && !task.reward) continue;
      if (aimed.length && !aimed.includes(l.to)) continue;
      pp.flash = 1;
      const n = Math.round((aimed.length ? 14 : 6) * q);
      const vel = (0.35 + 0.8 * pp.speed) * RESOURCES[l.resource].speed * 2.2;
      for (let i = 0; i < n; i++) spawnPacket(pp, { t: -i * 0.035, v: vel, big: 1.5 });
    }
    const type = TASK_TYPES[task.type] || TASK_TYPES.other;
    const top = pos.clone(); top.y = PLINTH + t.h + 1.1;
    floater(top, `${type.icon} +water`, '#ffd08a');
    if (task.reward > 0) floater(top.clone().setY(top.y + 0.5), `+TZS ${fmtNum(task.reward)}`, RESOURCES.money.color, 0.25);
  }
  function floatText(id, text, color) {
    const t = tanks.get(id);
    if (t) floater(t.group.position.clone().setY(PLINTH + t.h + 1.1), text, color);
  }
  function screenPos(id) {
    const t = tanks.get(id);
    if (!t) return null;
    const r = canvas.getBoundingClientRect();
    const sp = toScreen(t.group.position.clone().setY(PLINTH + t.h));
    return { x: r.left + sp.x, y: r.top + sp.y };
  }
  function destroy() {
    cancelAnimationFrame(raf); ro.disconnect(); offTool();
    overlay.remove();
    renderer.dispose();
  }

  return { fit, focus, zoomBy, rotateBy, toggleTilt, burst, floatText, screenPos, destroy, resize, is3d: true, get camera() { return { ...cam }; } };
}
