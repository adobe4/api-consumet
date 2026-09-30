// Looks: how things are drawn, chosen by the owner. One global look (floor, default pipe style, card finish)
// plus overrides per project card and per pipe. Saved to the account so every device shows the same.
import { h, debounce } from './util.js';
import { S, emit, saveSettings, updateProject, updateLink, project } from './store.js';
import { RESOURCES } from '/shared/engine.js';
import { openPop, segRow, swatchRow, toggleRow, rangeRow, closePop } from './pop.js';

export const CARD_COLORS = ['', '#ff4d5e', '#ff8a5c', '#ffb020', '#e8b86b', '#b8e04a', '#4be38a', '#2fb4a0', '#e07a5f', '#ff6fae', '#c9a27e', '#8a7b6d'];
export const LOOK_DEFAULT = { ground: 'dots', pipe: 'tunnel', card: 'soft', lines: 'curved', labels: true };
export const CARD_DEFAULT = { finish: '', size: 'm', shape: 'round', fx: 'none', icon: true, info: { sections: ['stats', 'chart', 'goal', 'tasks', 'actions'], width: 'normal' } };
export const INFO_SECTIONS = [['stats', 'Numbers'], ['chart', 'Trend'], ['goal', 'Goal'], ['tasks', 'Tasks'], ['note', 'Note'], ['channels', 'Channels'], ['actions', 'Buttons']];

export const globalLook = () => ({ ...LOOK_DEFAULT, ...(S.user?.settings?.look || {}) });
export const cardLook = (p) => {
  const l = p?.cfg?.look || {};
  return { ...CARD_DEFAULT, ...l, info: { ...CARD_DEFAULT.info, ...(l.info || {}) } };
};
// a project pipe: its own look, else the global default. Pipes carry their resource colour unless recoloured.
export function pipeLook(link) {
  const g = globalLook(), l = link?.look || {};
  const kind = l.kind || g.pipe;
  return {
    kind, path: l.path || (kind === 'line' ? g.lines : 'curved'), dash: l.dash || 'solid',
    start: l.start || 'none', end: l.end || (kind === 'line' ? 'arrow' : 'none'),
    color: l.color || RESOURCES[link?.resource]?.color || '#ff8a3d', width: l.width || 0, flow: l.flow ?? true,
  };
}

const persistLook = debounce((look) => saveSettings({ look }).catch(() => {}), 500);
export function setGlobalLook(patch) {
  S.user.settings = { ...(S.user.settings || {}), look: { ...globalLook(), ...patch } };
  emit('look');
  persistLook(S.user.settings.look);
}
const persistCard = new Map();
export function setCardLook(id, patch) {
  const p = project(id);
  if (!p) return;
  const cur = cardLook(p);
  const next = { ...cur, ...patch, info: { ...cur.info, ...(patch.info || {}) } };
  p.cfg = { ...(p.cfg || {}), look: next };
  emit('look');
  if (!persistCard.has(id)) persistCard.set(id, debounce(() => updateProject(id, { cfg: project(id).cfg }), 600));
  persistCard.get(id)();
}
const persistPipe = new Map();
export function setPipeLook(link, patch) {
  link.look = { ...(link.look || {}), ...patch };
  emit('look');
  if (!persistPipe.has(link.id)) persistPipe.set(link.id, debounce(() => updateLink(link.id, { look: link.look }), 600));
  persistPipe.get(link.id)();
}

// ---------- editors ----------
export const PIPE_KINDS = [['tunnel', 'Tunnel', 'Cut into the floor'], ['raised', 'Tube', 'Raised tube on top'], ['drawn', 'Painted', 'Painted on the floor'], ['line', 'Line', 'A plain connection line']];
export const PATHS = [['curved', 'Curved'], ['straight', 'Straight'], ['elbow', 'Elbow']];
export const DASHES = [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']];
export const ENDS = [['none', '—', 'Nothing'], ['arrow', '➜', 'Arrow'], ['triangle', '▶', 'Triangle'], ['dot', '●', 'Dot'], ['diamond', '◆', 'Diamond'], ['bar', '┃', 'Bar']];

export function lookPanel(anchorOrPoint) {
  const g = globalLook();
  const theme = window.flowmapTheme;
  const body = h('div', { class: 'pgrid' },
    theme ? segRow('Theme', [['system', 'Device'], ['light', 'Light'], ['dark', 'Dark']], theme.pref || 'system', (v) => theme.set(v)) : null,
    segRow('Floor', [['dots', 'Dots'], ['grid', 'Grid'], ['plain', 'Plain']], g.ground, (v) => setGlobalLook({ ground: v })),
    segRow('Pipes', PIPE_KINDS, g.pipe, (v) => setGlobalLook({ pipe: v })),
    segRow('Lines', PATHS, g.lines, (v) => setGlobalLook({ lines: v })),
    segRow('Cards', [['soft', 'Soft'], ['tinted', 'Tinted'], ['solid', 'Solid'], ['glass', 'Glass'], ['flat', 'Flat']], g.card, (v) => setGlobalLook({ card: v })),
    h('p', { class: 'phint' }, 'Every card and pipe can also have its own style: tap it, then 🎨 Style.'));
  return openPop({ ...(anchorOrPoint instanceof Element ? { anchor: anchorOrPoint } : anchorOrPoint), title: '🎨 Look', body, width: 380 });
}

export function cardStylePanel(id, anchorOrPoint) {
  const p = project(id);
  if (!p) return null;
  const l = cardLook(p);
  const set = (patch) => setCardLook(id, patch);
  const sections = new Set(l.info.sections);
  const secRow = h('div', { class: 'pr' }, h('span', { class: 'pl' }, 'Show'),
    h('div', { class: 'chips' }, ...INFO_SECTIONS.map(([k, label]) => {
      const b = h('button', { type: 'button', class: `chip${sections.has(k) ? ' on' : ''}`, onclick: () => { sections.has(k) ? sections.delete(k) : sections.add(k); b.classList.toggle('on', sections.has(k)); set({ info: { sections: INFO_SECTIONS.map(([x]) => x).filter((x) => sections.has(x)) } }); } }, label);
      return b;
    })));
  const body = h('div', { class: 'pgrid' },
    swatchRow('Colour', CARD_COLORS, p.color || '', (c) => { updateProject(id, { color: c }); emit('look'); }),
    segRow('Finish', [['', 'Default'], ['soft', 'Soft'], ['tinted', 'Tinted'], ['solid', 'Solid'], ['glass', 'Glass'], ['flat', 'Flat']], l.finish, (v) => set({ finish: v })),
    segRow('Size', [['s', 'S'], ['m', 'M'], ['l', 'L'], ['xl', 'XL']], l.size, (v) => set({ size: v })),
    segRow('Shape', [['round', 'Rounded'], ['pill', 'Pill'], ['square', 'Square'], ['circle', 'Circle']], l.shape, (v) => set({ shape: v })),
    segRow('Effect', [['none', 'None'], ['glow', 'Glow'], ['float', 'Float'], ['pulse', 'Pulse'], ['shine', 'Shine']], l.fx, (v) => set({ fx: v })),
    toggleRow('Show icon', l.icon, (v) => set({ icon: v })),
    h('div', { class: 'psec' }, 'Info card'),
    secRow,
    segRow('Width', [['compact', 'Compact'], ['normal', 'Normal'], ['wide', 'Wide']], l.info.width, (v) => set({ info: { width: v } })),
    h('div', { class: 'row', style: 'justify-content:flex-end' }, h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { const q = project(id); q.cfg = { ...(q.cfg || {}) }; delete q.cfg.look; emit('look'); updateProject(id, { cfg: q.cfg }); closePop(); } }, 'Reset to default')));
  return openPop({ ...(anchorOrPoint instanceof Element ? { anchor: anchorOrPoint } : anchorOrPoint), title: `🎨 ${p.name}`, body, width: 400, className: 'pop-keep-open' });
}

// shared by project pipes and board connections: style is the current look, set(patch) applies a change
export function linkStyleBody(style, set, { showColor = true, colors, fitWidth = false } = {}) {
  let width = style.width || 3;
  const thick = rangeRow('Thickness', width, 1, 40, 1, (v) => { width = v; set({ width: v }); });
  // a tunnel or tube needs body to read as one, and a plain line looks wrong fat: fix the thickness when the style changes
  const kind = (v) => {
    const patch = { kind: v };
    if (fitWidth && (v === 'tunnel' || v === 'raised') && width < 10) patch.width = 14;
    if (fitWidth && (v === 'line' || v === 'drawn') && width > 8) patch.width = 3;
    if (patch.width) { width = patch.width; thick.querySelector('input').value = String(width); }
    set(patch);
  };
  return h('div', { class: 'pgrid' },
    segRow('Style', PIPE_KINDS, style.kind, kind),
    segRow('Path', PATHS, style.path, (v) => set({ path: v })),
    segRow('Line', DASHES, style.dash, (v) => set({ dash: v })),
    segRow('Start', ENDS, style.start, (v) => set({ start: v })),
    segRow('End', ENDS, style.end, (v) => set({ end: v })),
    showColor ? swatchRow('Colour', colors || ['', '#ff8a3d', '#ffc933', '#46e58a', '#ff5fa2', '#ff4d5e', '#e8b86b', '#2fb4a0', '#8a7b6d', '#f5f1ea'], style.color || '', (c) => set({ color: c })) : null,
    thick,
    toggleRow('Flowing light', style.flow, (v) => set({ flow: v })));
}
export function pipeStylePanel(link, anchorOrPoint) {
  const cur = { ...pipeLook(link), color: link.look?.color || '', width: link.look?.width || 0 };
  const body = h('div', null, linkStyleBody(cur, (patch) => setPipeLook(link, patch)),
    h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:8px' }, h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { link.look = {}; emit('look'); updateLink(link.id, { look: {} }); closePop(); } }, 'Reset to default')));
  return openPop({ ...(anchorOrPoint instanceof Element ? { anchor: anchorOrPoint } : anchorOrPoint), title: '🎨 Pipe style', body, width: 420 });
}
