// Which picture of the system the map draws: the glass tanks (3D map) or the River (a flow chart laid
// out automatically). Remembered per device.
import { store_ls } from './util.js';

export const MAP_STYLES = [
  { value: 'tanks', label: '🫧 Glass tanks', hint: '3D tanks with flowing pipes' },
  { value: 'river', label: '〰️ River', hint: 'Where attention starts, what it feeds and what you earn, left to right. Wider = more.' },
];
// 'garden' and 'studio' were earlier flat styles; anyone who picked one gets the River
const norm = (v) => (v === 'river' || v === 'studio' || v === 'garden' ? 'river' : 'tanks');
export const getMapStyle = () => norm(store_ls.get('flowmap.mapStyle', 'tanks'));
export function setMapStyle(style) {
  const next = norm(style);
  if (next === getMapStyle()) return;
  store_ls.set('flowmap.mapStyle', next);
  window.dispatchEvent(new CustomEvent('flowmap-mapstyle', { detail: next }));
}
