// How each kind of board item looks. build() returns the element's inner content; the editor positions it.
import { h, fmtNum, raw } from '../util.js';
import { icon } from '../icons.js';
import { S, project } from '../store.js';
import { KINDS } from '/shared/engine.js';
import { fileUrl, videoUrl } from './files.js';
import { clipSvg } from './clips.js';

const star = (() => { const pts = []; for (let i = 0; i < 10; i++) { const r = i % 2 ? 22 : 50, a = (i / 10) * Math.PI * 2 - Math.PI / 2; pts.push(`${50 + Math.cos(a) * r},${52 + Math.sin(a) * r}`); } return `M${pts.join(' L')}Z`; })();
export const SHAPE_PATHS = {
  diamond: 'M50,1 L99,50 L50,99 L1,50Z', triangle: 'M50,2 L98,97 L2,97Z', hexagon: 'M25,2 H75 L98,50 L75,98 H25 L2,50Z', star,
  arrow: 'M1,32 H60 V4 L99,50 L60,96 V68 H1Z', bubble: 'M8,2 H92 Q98,2 98,8 V66 Q98,72 92,72 H42 L20,97 L24,72 H8 Q2,72 2,66 V8 Q2,2 8,2Z',
};
export const SHAPE_LABEL = { rect: '▭ Box', round: '▢ Rounded', pill: '⬭ Pill', ellipse: '◯ Circle', diamond: '◇ Diamond', triangle: '△ Triangle', hexagon: '⬡ Hexagon', star: '☆ Star', arrow: '➜ Arrow', bubble: '💬 Speech' };
const NS = 'http://www.w3.org/2000/svg';

export const TYPE_LABEL = { note: 'Sticky note', card: 'Card', text: 'Text', shape: 'Shape', frame: 'Frame', flip: 'Flip card', image: 'Image', video: 'Video', file: 'File', link: 'Link', project: 'Project', sticker: 'Sticker', ink: 'Drawing', checklist: 'Checklist', prompt: 'Prompt', hide: 'Hide', clip: 'Clip' };
// typed text goes in raw: what people write is never turned into icons
const ed = (cls, text, field, placeholder) => h('div', { class: `ed ${cls}`, 'data-field': field, 'data-ph': placeholder || '' }, raw(text || ''));
const ellipsis = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// ctx: { share, onCheck(item, i), onCopy(item), onFlip(item), onOpenFile(item), onPickVideo(item), readonly }
export function buildItem(it, ctx) {
  const d = it.data || {};
  switch (it.type) {
    case 'note': return [h('div', { class: 'paper' }), notePin(it), ed('txt', it.text, 'text', 'Write something…')];
    case 'text': return [ed('txt', it.text, 'text', 'Text')];
    case 'card': {
      const kids = [];
      if (d.cover || d.coverFile) kids.push(imgBox(d.cover, d.coverFile, ctx, 'cover'));
      kids.push(h('div', { class: 'cb' },
        d.num ? h('span', { class: 'num' }, String(d.num)) : null,
        ed('ttl', it.title, 'title', 'Title'), ed('txt', it.text, 'text', 'Details'),
        (d.attach || []).length ? h('div', { class: 'atts' }, d.attach.map((a) => h('button', { type: 'button', class: 'att', 'data-act': 'open-attach', 'data-file': a.fileId, title: `Open ${a.name}` }, h('b', null, (a.name.split('.').pop() || 'file').slice(0, 4).toUpperCase()), raw(ellipsis(a.name, 26))))) : null));
      return kids;
    }
    case 'shape': {
      const s = d.shape || 'round';
      if (SHAPE_PATHS[s]) {
        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('class', 'shp');
        const p = document.createElementNS(NS, 'path'); p.setAttribute('d', SHAPE_PATHS[s]); p.setAttribute('vector-effect', 'non-scaling-stroke');
        svg.append(p);
        return [svg, ed('txt', it.text, 'text', '')];
      }
      return [ed('txt', it.text, 'text', '')];
    }
    case 'frame': return [h('div', { class: 'ftab' }, h('i'), ed('ttl', it.title, 'title', 'Frame'), h('span', { class: 'slide-no' }))];
    case 'flip': {
      const lines = String(d.back || '').split('\n').filter(Boolean);
      return [h('div', { class: 'fin' },
        h('div', { class: 'face front' }, h('div', null, ed('ttl', it.title, 'title', 'Front'), h('small', null, 'TAP TO FLIP'))),
        h('div', { class: 'face back' }, h('h4', null, raw(it.title || 'Inside')),
          lines.length ? h('ul', null, lines.map((l) => h('li', null, h('i'), raw(l)))) : h('p', null, 'Double-click to write the back.')))];
    }
    case 'image': return [imgBox(d.url, d.fileId, ctx, 'img'), it.text ? h('div', { class: 'cap' }, raw(it.text)) : null];
    case 'video': {
      const box = h('div', { class: 'vid' }, h('div', { class: 'vwait' }, '🎬'));
      if (d.url) box.replaceChildren(h('video', { src: d.url, controls: true, playsinline: true, preload: 'metadata' }));
      else if (d.localId) videoUrl(d.localId).then((u) => {
        if (u) box.replaceChildren(h('video', { src: u, controls: true, playsinline: true, preload: 'metadata' }));
        else box.replaceChildren(h('div', { class: 'vmiss' }, h('b', null, icon('clapperboard'), ' ', raw(d.name || 'Video')), h('small', null, 'This video lives on the device that added it.'), ctx.readonly ? null : h('button', { type: 'button', class: 'btn sm', 'data-act': 'pick-video' }, 'Choose the file here')));
      });
      return [box, h('div', { class: 'cap' }, raw(it.text || d.name || 'Video'), h('span', null, d.localId ? 'on this device' : ''))];
    }
    case 'file': return [h('div', { class: 'fchip', 'data-act': 'open-file' }, h('b', null, (d.name || 'file').split('.').pop().slice(0, 4).toUpperCase()), h('div', null, h('strong', null, raw(ellipsis(d.name || 'File', 40))), h('small', null, `${d.size ? `${fmtNum(d.size / 1024)} KB · ` : ''}${ctx.readonly ? 'tap' : 'double-click'} to open`))), d.preview ? h('pre', { class: 'fprev sf-scroll' }, raw(d.preview)) : null];
    case 'link': {
      let host = '';
      try { host = new URL(d.url).hostname.replace(/^www\./, ''); } catch { /* not a url yet */ }
      return [h('div', { class: 'lk' }, h('span', { class: 'fav' }, (host[0] || '🔗').toUpperCase()), h('div', null, ed('ttl', it.title || host, 'title', 'Link title'), h('small', null, host || 'add a link')), h('a', { class: 'btn sm', href: d.url || '#', target: '_blank', rel: 'noopener noreferrer', 'data-act': 'open-link' }, 'Open ↗')), it.text ? ed('txt', it.text, 'text', '') : null];
    }
    case 'project': {
      const p = project(d.projectId), s = p && S.sim?.days[S.offset]?.projects[p.id];
      if (!p) return [h('div', { class: 'pj missing' }, 'This project is gone')];
      const hp = Math.round(s?.health ?? 0), st = hp >= 75 ? 'var(--good)' : hp >= 50 ? '#e2b000' : hp >= 30 ? '#f08a00' : 'var(--bad)';
      return [h('div', { class: 'pj', style: { '--st': st, '--c': p.color || KINDS[p.kind]?.color || '#ff8a5c' } },
        h('div', { class: 'pjh' }, h('i', { class: 'led' }), h('b', null, `${p.icon || ''} ${p.name}`), h('span', null, `${hp}%`)),
        h('div', { class: 'pjs' }, s?.money > 0.5 ? h('div', null, h('b', null, `TZS ${fmtNum(s.money)}`), h('small', null, 'money/day')) : null, s?.attention > 0.5 ? h('div', null, h('b', null, fmtNum(s.attention)), h('small', null, 'views/day')) : null),
        h('small', { class: 'live' }, '● live from your tracker'))];
    }
    // an icon sticker ('i:arrow-right', drawn in the item colour) or an emoji exactly as chosen
    case 'sticker': { const t = it.text || 'i:star'; return [t.startsWith('i:') ? h('span', { class: 'emo ico' }, icon(t.slice(2))) : h('span', { class: 'emo' }, raw(t))]; }
    case 'checklist': {
      const items = d.items || [];
      const done = items.filter((x) => x.done).length;
      return [h('div', { class: 'ckh' }, ed('ttl', it.title, 'title', 'Checklist'), h('span', null, `${done}/${items.length}`)),
        h('div', { class: 'meter' }, h('i', { style: { width: `${items.length ? (done / items.length) * 100 : 0}%` } })),
        h('div', { class: 'cks sf-scroll' }, items.map((x, i) => h('label', { class: `ck${x.done ? ' on' : ''}` }, h('button', { type: 'button', class: `check${x.done ? ' on' : ''}`, 'data-act': 'check', 'data-i': i, 'aria-label': x.done ? 'Mark not done' : 'Mark done' }, x.done ? '✓' : ''), h('span', null, raw(x.t)))),
          ctx.readonly ? null : h('button', { type: 'button', class: 'ckadd', 'data-act': 'check-add' }, '＋ Add item'))];
    }
    case 'prompt': return [h('div', { class: 'prh' }, h('span', null, '✦'), ed('ttl', it.title, 'title', 'Prompt'), h('button', { type: 'button', class: 'btn sm primary', 'data-act': 'copy', title: 'Copy the prompt' }, '⧉ Copy')), ed('txt selectable sf-scroll', it.text, 'text', 'Write or paste a prompt…')];
    // a cover over other things: blurred, frosted, solid or striped; tapped away while presenting
    case 'clip': return [clipSvg(it)];
    case 'hide': return [h('div', { class: 'hz' }, d.nolabel ? null : h('div', { class: 'hz-l' }, h('span', { class: 'hz-ic' }, d.tap === 'move' ? '✋' : d.tap === 'none' ? '🙈' : '👆'), ed('ttl', it.title, 'title', 'Tap to reveal')))];
    default: return [];
  }
}
// what holds a paper note to the board: a strip of tape, a push pin or a paperclip
function notePin(it) {
  const pin = it.data?.pin;
  if (!pin || pin === 'none') return null;
  const kind = pin === 'clip' ? 'paperclip' : pin;
  return h('span', { class: `np np-${pin}` }, clipSvg({ id: `${it.id}np`, color: pin === 'tape' ? '#f3e3b3' : pin === 'pin' ? '#ff4d5e' : '', data: { kind, metal: pin === 'clip' ? 'silver' : 'color' } }));
}
function imgBox(url, fileId, ctx, cls) {
  const img = h('img', { alt: '', draggable: false, loading: 'lazy', referrerpolicy: 'no-referrer' });
  const box = h('div', { class: cls }, img);
  if (fileId) fileUrl(fileId, ctx.share).then((u) => { img.src = u; }).catch(() => box.classList.add('broken'));
  else if (url) { img.src = url; img.onerror = () => box.classList.add('broken'); }
  else box.classList.add('empty');
  return box;
}
// the content key: when it changes the item is rebuilt; position changes never rebuild
export const contentKey = (it) => JSON.stringify([it.type, it.title, it.text, it.data, it.type === 'clip' ? it.color : 0, S.offset, it.type === 'project' ? S.version : 0]);
