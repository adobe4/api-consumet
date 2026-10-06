// Tiny synthesised sound cues (no audio files). Off by default; the toggle lives in the top bar.
import { store_ls } from './util.js';

let ctx = null;
let enabled = store_ls.get('flowmap.sound', false);

export const sound = {
  get enabled() { return enabled; },
  set enabled(v) { enabled = !!v; store_ls.set('flowmap.sound', enabled); },
};

function ac() {
  if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, start, dur, { type = 'sine', gain = 0.06, slide = 0 } = {}) {
  const c = ac();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  const t0 = c.currentTime + start;
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(c.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

export const sfx = {
  coin() { if (enabled) { tone(988, 0, 0.09, { type: 'square', gain: 0.03 }); tone(1319, 0.08, 0.22, { type: 'square', gain: 0.03 }); } },
  whoosh() { if (enabled) tone(220, 0, 0.35, { type: 'sawtooth', gain: 0.025, slide: 4 }); },
  pop() { if (enabled) tone(520, 0, 0.08, { gain: 0.05, slide: 1.6 }); },
  alarm() { if (enabled) { tone(300, 0, 0.16, { type: 'sawtooth', gain: 0.03 }); tone(240, 0.2, 0.22, { type: 'sawtooth', gain: 0.03 }); } },
  success() { if (enabled) { tone(523, 0, 0.12, { gain: 0.05 }); tone(659, 0.1, 0.12, { gain: 0.05 }); tone(784, 0.2, 0.25, { gain: 0.05 }); } },
};
