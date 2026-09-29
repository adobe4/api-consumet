// Which picture of the system the map draws: the glass tanks (3D) or Studio (flat, rings and ribbons).
// Remembered per device.
import { store_ls } from './util.js';

export const MAP_STYLES = [
  { value: 'tanks', label: '🫧 Glass tanks', hint: '3D tanks with flowing pipes' },
  { value: 'studio', label: '◎ Studio', hint: 'Clean and flat: rings show health and goals, ribbons show what flows, dots are tasks' },
];
// 'garden' was an earlier flat style; anyone who picked it gets Studio
const norm = (v) => (v === 'studio' || v === 'garden' ? 'studio' : 'tanks');
export const getMapStyle = () => norm(store_ls.get('flowmap.mapStyle', 'tanks'));
export function setMapStyle(style) {
  const next = norm(style);
  if (next === getMapStyle()) return;
  store_ls.set('flowmap.mapStyle', next);
  window.dispatchEvent(new CustomEvent('flowmap-mapstyle', { detail: next }));
}
