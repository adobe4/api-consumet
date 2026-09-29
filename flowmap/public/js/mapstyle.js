// Which picture of the system the map draws: the glass tanks (3D) or the garden (2D). Remembered per device.
import { store_ls } from './util.js';

export const MAP_STYLES = [
  { value: 'tanks', label: '🫧 Glass tanks', hint: '3D tanks with flowing pipes' },
  { value: 'garden', label: '🌱 Garden', hint: 'Every project is a plant; bees and butterflies carry the flows' },
];
export const getMapStyle = () => (store_ls.get('flowmap.mapStyle', 'tanks') === 'garden' ? 'garden' : 'tanks');
export function setMapStyle(style) {
  const next = style === 'garden' ? 'garden' : 'tanks';
  if (next === getMapStyle()) return;
  store_ls.set('flowmap.mapStyle', next);
  window.dispatchEvent(new CustomEvent('flowmap-mapstyle', { detail: next }));
}
