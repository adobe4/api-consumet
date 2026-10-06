// Which picture of the system the tracker draws: tactile cards (the default) or the 3D glass tanks.
// Remembered per device.
import { store_ls } from './util.js';

export const MAP_STYLES = [
  { value: 'cards', label: '🃏 Cards', hint: 'Soft cards on a dotted or gridded floor. Tap one to lift it and see everything.' },
  { value: 'tanks', label: '🫧 Glass tanks', hint: '3D tanks with flowing pipes' },
];
// earlier flat styles (garden, studio, river) became the cards
const norm = (v) => (v === 'tanks' ? 'tanks' : 'cards');
export const getMapStyle = () => norm(store_ls.get('flowmap.mapStyle', 'cards'));
export function setMapStyle(style) {
  const next = norm(style);
  if (next === getMapStyle()) return;
  store_ls.set('flowmap.mapStyle', next);
  window.dispatchEvent(new CustomEvent('flowmap-mapstyle', { detail: next }));
}
