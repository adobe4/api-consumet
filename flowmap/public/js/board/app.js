// Boards: the home page (your boards, templates, "ask AI to build one") and the editor for one board.
import { h, clear, store_ls, setText } from '../util.js';
import { api } from '../api.js';
import { S, projects, notify } from '../store.js';
import { RESOURCES } from '/shared/engine.js';
import { generateBoard, emptyBoard } from '/shared/board.js';
import { confirmDialog, openModal } from '../ui-common.js';
import { openShareDialog } from './share.js';
import { createEditor } from './editor.js';

export const TEMPLATES = [
  { id: 'blank', icon: '🧩', name: 'Blank board', about: 'An empty floor to think on', spec: null },
  { id: 'tutorial', icon: '🎬', name: 'Tutorial video', about: 'Slides for a screen-recorded lesson', spec: { layout: 'slides', slides: [
    { title: 'The hook', subtitle: 'Why this matters to you today', points: ['The problem: what people get wrong', 'The promise: what you will be able to do'], emoji: 'i:flame', note: 'Look at the camera. Say the result first.' },
    { title: 'Step 1', points: ['What to do: the first action', 'Why: the reason it works', 'Tip: a common mistake to avoid'], emoji: 'i:target' },
    { title: 'Step 2', points: ['What to do', 'Show it: live demo', 'Check: how to know it worked'], emoji: 'i:lightbulb' },
    { title: 'Step 3', points: ['What to do', 'Example: a real case', 'Shortcut: the faster way'], emoji: 'i:zap' },
    { title: 'Recap', points: ['Step 1', 'Step 2', 'Step 3'], emoji: 'i:circle-check' },
    { title: 'Your next move', subtitle: 'Subscribe, comment, or try it now', points: ['Link: where to go next', 'Question: ask the viewers'], emoji: 'i:rocket' },
  ] } },
  { id: 'course', icon: '🎓', name: 'Course outline', about: 'Modules and lessons you can sell as a link', spec: { layout: 'slides', slides: [
    { title: 'Welcome', points: ['Who this is for', 'What you will be able to do', 'How to use this board'], emoji: 'i:hand' },
    { title: 'Module 1: Foundations', points: ['Lesson 1', 'Lesson 2', 'Exercise'], emoji: 'i:book-open' },
    { title: 'Module 2: Build it', points: ['Lesson 1', 'Lesson 2', 'Exercise'], emoji: 'i:wrench' },
    { title: 'Module 3: Grow it', points: ['Lesson 1', 'Lesson 2', 'Exercise'], emoji: 'i:trending-up' },
    { title: 'Final project', points: ['Brief', 'Checklist', 'Share your result'], emoji: 'i:trophy' },
  ] } },
  { id: 'strategy', icon: '🧭', name: 'Strategy map', about: 'A mind map for planning a strategy video', spec: { layout: 'mindmap', center: 'My strategy', branches: [
    { title: 'Audience', children: ['Who they are', 'What they need'] }, { title: 'Content', children: ['Formats', 'Rhythm'] },
    { title: 'Products', children: ['What I sell', 'Price'] }, { title: 'Money', children: ['Where it comes from', 'Costs'] }, { title: 'Next 30 days', children: ['Week 1', 'Week 2-4'] },
  ] } },
  { id: 'workflow', icon: '🔁', name: 'Content workflow', about: 'Boxes and arrows from idea to money', spec: { layout: 'workflow', nodes: [
    { id: 'a', title: 'Idea', text: 'From comments and trends' }, { id: 'b', title: 'Script', text: 'Hook, 3 points, call to action' }, { id: 'c', title: 'Record', text: 'Screen + voice' },
    { id: 'd', title: 'Edit', text: 'Cut, captions, thumbnail' }, { id: 'e', title: 'Publish', text: 'YouTube + TikTok' }, { id: 'f', title: 'Promote', text: 'Shorts, WhatsApp, groups' }, { id: 'g', title: 'Sell', text: 'Course or product link' },
  ], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'd' }, { from: 'd', to: 'e' }, { from: 'e', to: 'f', flow: true }, { from: 'f', to: 'g', flow: true }] } },
  { id: 'kanban', icon: '📋', name: 'Task board', about: 'To do, doing, done', spec: { layout: 'kanban', columns: [{ title: 'To do', cards: ['Plan next video', 'Update thumbnails'] }, { title: 'Doing', cards: ['Record lesson 2'] }, { title: 'Done', cards: ['Set up the board'] }] } },
  { id: 'plan', icon: '🗓️', name: '30-day plan', about: 'Milestones on a timeline', spec: { layout: 'timeline', title: 'Next 30 days', milestones: [{ title: 'Week 1', text: 'Set up and first 3 videos' }, { title: 'Week 2', text: 'Launch the offer' }, { title: 'Week 3', text: 'Collaborations' }, { title: 'Week 4', text: 'Review and double down' }] } },
  { id: 'system', icon: '📊', name: 'Map of my system', about: 'Your tracker projects and what flows between them', spec: 'system' },
];

// your projects and pipes as a workflow board (tunnel pipes carrying views, money, customers)
function systemSpec() {
  const ps = projects();
  const nodes = ps.map((p) => ({ id: String(p.id), title: `${p.icon || ''} ${p.name}`.trim(), text: p.note || '', color: p.color || undefined, group: p.cfg?.group || undefined }));
  const edges = S.world.links.filter((l) => ps.some((p) => p.id === l.from) && ps.some((p) => p.id === l.to)).map((l) => ({ from: String(l.from), to: String(l.to), label: RESOURCES[l.resource]?.label, flow: true }));
  const g = generateBoard({ layout: 'workflow', title: 'How my system flows', nodes, edges }, { style: { link: { kind: 'tunnel', width: 14, end: 'none' } } });
  g.links.forEach((l, i) => { const src = edges[i]; const res = Object.values(RESOURCES).find((r) => r.label === src?.label); if (res) l.style.color = res.color; });
  return g;
}

export function createBoards(host) {
  let editor = null, boards = [], open = null;
  const root = h('div', { class: 'boards' });
  host.append(root);

  async function load() { boards = await api('GET', '/api/boards').catch((e) => { notify(e.message, 'error'); return []; }); }
  async function show() {
    root.hidden = false;
    const last = store_ls.get('flowmap.board', null);
    if (open) return;
    await load();
    if (last && boards.some((b) => b.id === last)) return openBoard(last);
    home();
  }
  function hide() { root.hidden = true; }

  // ---------- home ----------
  let query = '', sortBy = store_ls.get('flowmap.boardSort', 'recent'), aiOpen = false;
  function home() {
    editor?.destroy(); editor = null; open = null;
    document.getElementById('app')?.classList.remove('board-open');
    store_ls.del('flowmap.board');
    const mine = boards.filter((b) => !b.demo), demos = boards.filter((b) => b.demo);
    const search = h('input', { type: 'search', class: 'bh-search', placeholder: 'Search boards', value: query, oninput: (e) => { query = e.target.value; paintGrid(); } });
    const grid = h('div', { class: 'bgrid-wrap' });
    const prompt = h('textarea', { class: 'ai-in', rows: 3, placeholder: 'Describe a board: “Slides for a 7-minute tutorial on growing a Swahili TikTok channel”, “A workflow for my IPTV sales”, “A storyboard for my next video”…' });
    const build = h('button', { type: 'button', class: 'btn primary', onclick: () => aiBuild(prompt.value, build) }, '✨ Build it');
    const aiPanel = h('div', { class: 'ai-box', hidden: !aiOpen }, h('div', { class: 'ai-h' }, h('b', null, '✨ Ask AI to build a board'), h('small', null, S.user?.hasAiKey ? 'Uses the AI from your 🧠 Brain settings' : 'Add an AI key in 🧠 Brain first, or ask your own AI agent over MCP')), prompt, h('div', { class: 'row', style: 'justify-content:flex-end' }, build));
    function paintGrid() {
      const q = query.trim().toLowerCase();
      let list = mine.filter((b) => !q || b.name.toLowerCase().includes(q));
      list = list.slice().sort(sortBy === 'name' ? (x, y) => x.name.localeCompare(y.name) : sortBy === 'size' ? (x, y) => y.items - x.items : (x, y) => String(y.updatedAt).localeCompare(String(x.updatedAt)));
      const pinned = list.filter((b) => b.pinned), rest = list.filter((b) => !b.pinned);
      clear(grid).append(
        pinned.length ? h('div', { class: 'sec' }, `📌 Pinned · ${pinned.length}`) : null,
        pinned.length ? h('div', { class: 'bgrid pinned' }, pinned.map(tile)) : null,
        h('div', { class: 'sec sec-row' }, h('span', null, q ? `Found · ${list.length}` : `Your boards · ${rest.length}`),
          h('span', { class: 'seg mini' }, [['recent', 'Recent'], ['name', 'A–Z'], ['size', 'Biggest']].map(([v, l]) => h('button', { type: 'button', class: sortBy === v ? 'on' : '', onclick: () => { sortBy = v; store_ls.set('flowmap.boardSort', v); paintGrid(); } }, l)))),
        rest.length ? h('div', { class: 'bgrid' }, rest.map(tile))
          : h('div', { class: 'bempty' }, h('b', null, q ? 'No board matches that.' : 'No boards of your own yet.'), h('small', null, q ? 'Try another word.' : 'Start a new board, ask the AI to build one, or open 🎬 Demo for ready-made examples.')));
    }
    clear(root).append(
      h('div', { class: 'bh' },
        h('div', null, h('h2', null, 'Boards'), h('p', null, 'Plan, research, track and present. Frames become slides; share any board as a link.')),
        h('div', { class: 'bh-actions' }, search,
          h('button', { type: 'button', class: 'btn', title: 'Example boards and templates', onclick: () => demoShelf(demos) }, '🎬 Demo', demos.length ? h('span', { class: 'cnt' }, String(demos.length)) : null),
          h('button', { type: 'button', class: `btn${aiOpen ? ' on' : ''}`, onclick: (e) => { aiOpen = !aiOpen; aiPanel.hidden = !aiOpen; e.currentTarget.classList.toggle('on', aiOpen); if (aiOpen) prompt.focus(); } }, '✨ Build with AI'),
          h('button', { type: 'button', class: 'btn primary', onclick: () => create(TEMPLATES[0]) }, '＋ New board'))),
      aiPanel, grid);
    paintGrid();
  }
  // a little drawing of the board: its frames, notes and cards as coloured boxes
  function miniPreview(p) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'bt-prev');
    if (!p) { svg.setAttribute('viewBox', '0 0 100 60'); return svg; }
    const pad = 40;
    svg.setAttribute('viewBox', `${-pad} ${-pad} ${p.w + pad * 2} ${p.h + pad * 2}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    for (const [k, x, y, w, hh, c, solid] of p.s) {
      const r = document.createElementNS(NS, 'rect');
      r.setAttribute('x', x); r.setAttribute('y', y); r.setAttribute('width', w); r.setAttribute('height', k === 't' ? Math.min(hh, Math.max(6, hh * 0.5)) : hh);
      r.setAttribute('rx', k === 'f' ? 14 : k === 's' ? Math.min(w, hh) / 4 : 6);
      r.setAttribute('class', `p-${k}${solid ? ' solid' : ''}`);
      if (c && k !== 't') r.style.setProperty('--pc', c);
      svg.append(r);
    }
    return svg;
  }
  const ago = (iso) => { const s = (Date.now() - new Date(iso)) / 1000; return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : s < 7 * 86400 ? `${Math.round(s / 86400)} d ago` : new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); };
  function tile(b) {
    const more = h('button', { type: 'button', class: 'btn icon sm bt-more', title: 'More', onclick: (e) => { e.stopPropagation(); tileMenu(b, e.currentTarget); } }, '⋯');
    const pin = h('button', { type: 'button', class: `bt-pin${b.pinned ? ' on' : ''}`, title: b.pinned ? 'Unpin' : 'Pin on top', onclick: (e) => { e.stopPropagation(); flags(b, { pinned: !b.pinned }); } }, '📌');
    return h('div', { class: `bt${b.pinned ? ' is-pinned' : ''}`, role: 'button', tabindex: 0, onclick: () => openBoard(b.id), onkeydown: (e) => { if (e.key === 'Enter') openBoard(b.id); } },
      h('div', { class: 'bt-top' }, miniPreview(b.preview), h('span', { class: 'bi-ic' }, b.icon || '🧩'), b.shared ? h('span', { class: 'bt-shared', title: 'Shared as a link' }, '🔗') : null),
      h('b', null, b.name),
      h('small', null, `${b.items} item${b.items === 1 ? '' : 's'}${b.slides ? ` · ${b.slides} slides` : ''} · ${ago(b.updatedAt)}`), pin, more);
  }
  async function flags(b, patch) {
    try { Object.assign(b, await api('PATCH', `/api/boards/${b.id}/flags`, patch)); home(); }
    catch (e) { notify(e.message, 'error'); }
  }
  function tileMenu(b, btn) {
    document.querySelector('.bd-menu')?.remove();
    const r = btn.getBoundingClientRect();
    const m = h('div', { class: 'ctxmenu bd-menu', role: 'menu' },
      ...[['↗', 'Open', () => openBoard(b.id)], ['▶', 'Present', () => openBoard(b.id, true)], ['🔗', 'Share', () => openShareDialog(b)],
        ['📌', b.pinned ? 'Unpin' : 'Pin on top', () => flags(b, { pinned: !b.pinned })],
        ['🎬', b.demo ? 'Move to my boards' : 'Move to Demo', () => flags(b, { demo: !b.demo, pinned: false })],
        ['⧉', 'Duplicate', async () => { await api('POST', `/api/boards/${b.id}/duplicate`); await load(); home(); }],
        ['🗑', 'Delete', async () => { if (await confirmDialog({ title: `Delete “${b.name}”?`, message: 'The board, its uploaded files and its share link are removed for good.', confirm: 'Delete', danger: true })) { await api('DELETE', `/api/boards/${b.id}`); await load(); home(); } }, 'danger']]
        .map(([ic, label, fn, cls]) => h('button', { type: 'button', class: `mi ${cls || ''}`, onclick: () => { m.remove(); fn(); } }, h('span', { class: 'mic' }, ic), label)));
    document.body.append(m);
    const mr = { width: m.offsetWidth, height: m.offsetHeight };
    m.style.left = `${Math.min(innerWidth - mr.width - 8, r.left)}px`; m.style.top = `${Math.min(innerHeight - mr.height - 8, r.bottom + 6)}px`;
    setTimeout(() => document.addEventListener('pointerdown', function away(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('pointerdown', away, true); } }, true));
  }
  // the Demo shelf: ready-made templates to start from, and the example boards you moved out of the way
  function demoShelf(demos) {
    const body = h('div', { class: 'demo-shelf' },
      h('div', { class: 'sec' }, 'Start from a template'),
      h('div', { class: 'tpls' }, TEMPLATES.map((t) => h('button', { type: 'button', class: 'tplc', onclick: () => { modal.close(); create(t); } }, h('span', { class: 'ti' }, t.icon), h('b', null, t.name), h('small', null, t.about)))),
      h('div', { class: 'sec' }, demos.length ? `Example boards · ${demos.length}` : 'Example boards'),
      demos.length ? h('div', { class: 'bgrid' }, demos.map((b) => {
        const el = tile(b);
        el.onclick = () => { modal.close(); openBoard(b.id); };
        el.querySelector('.bt-pin')?.remove();
        el.append(h('button', { type: 'button', class: 'btn sm bt-move', title: 'Move it back to your boards', onclick: (e) => { e.stopPropagation(); modal.close(); flags(b, { demo: false }); } }, '↩ To my boards'));
        return el;
      })) : h('p', { class: 'hint' }, 'No example boards here. Move any board here with ⋯ → Move to Demo to keep your list clean.'));
    const modal = openModal({ title: '🎬 Demo', body, wide: true, actions: [{ label: 'Close' }] });
  }

  async function create(t) {
    try {
      let data = emptyBoard();
      if (t.spec === 'system') { const g = systemSpec(); data = { ...data, items: g.items, links: g.links }; }
      else if (t.spec) { const g = generateBoard(t.spec); data = { ...data, items: g.items, links: g.links, order: g.order }; }
      const b = await api('POST', '/api/boards', { name: t.id === 'blank' ? 'Untitled board' : t.name, icon: t.icon, data });
      boards.unshift(b);
      openBoard(b.id, false, b);
    } catch (e) { notify(e.message, 'error'); }
  }
  // a new board designed by the AI: an empty board opens, then the designer studies the request, asks, and designs
  async function aiBuild(text, btn) {
    if (text.trim().length < 4) { notify('Describe the board you want first', 'error'); return; }
    btn.disabled = true;
    try {
      const nameGuess = text.trim().replace(/^(make|create|build|design|tengeneza)\s+(me\s+)?(a|an)?\s*/i, '').split(/[.\n]/)[0].slice(0, 48) || 'New board';
      const b = await api('POST', '/api/boards', { name: nameGuess.charAt(0).toUpperCase() + nameGuess.slice(1), icon: '✨', data: emptyBoard() });
      boards.unshift(b);
      await openBoard(b.id, false, b);
      editor?.design(text.trim(), { ask: S.user?.settings?.designAsk !== false });
    } catch (e) { notify(e.message, 'error'); }
    finally { btn.disabled = false; }
  }

  // ---------- editor ----------
  async function openBoard(id, presentNow = false, preloaded = null) {
    try {
      const b = preloaded?.data ? preloaded : await api('GET', `/api/boards/${id}`);
      editor?.destroy();
      clear(root);
      open = b;
      document.getElementById('app')?.classList.add('board-open');
      store_ls.set('flowmap.board', b.id);
      editor = createEditor(root, { board: b, onBack: () => { load().then(home); }, onRenamed: (name, icon) => { b.name = name; b.icon = icon; } });
      if (presentNow) setTimeout(() => editor.present(), 500);
    } catch (e) { notify(e.message, 'error'); store_ls.del('flowmap.board'); home(); }
  }

  // back button: the board handles its own steps first, then closes back to the boards list
  function back() {
    if (root.hidden) return false;
    if (document.querySelector('.bd-menu')) { document.querySelector('.bd-menu').remove(); return true; }
    if (!editor) return false;
    if (editor.back()) return true;
    load().then(home);
    return true;
  }
  return { show, hide, back, resize: () => editor?.resize(), get active() { return !!editor; } };
}
