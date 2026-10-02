// Boards: the home page (your boards, templates, "ask AI to build one") and the editor for one board.
import { h, clear, store_ls, setText } from '../util.js';
import { api } from '../api.js';
import { S, projects, notify } from '../store.js';
import { RESOURCES } from '/shared/engine.js';
import { generateBoard, emptyBoard } from '/shared/board.js';
import { confirmDialog } from '../ui-common.js';
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
  function home() {
    editor?.destroy(); editor = null; open = null;
    store_ls.del('flowmap.board');
    const prompt = h('textarea', { class: 'ai-in', rows: 3, placeholder: 'Describe a board: “Slides for a 7-minute tutorial on growing a Swahili TikTok channel”, “A workflow for my IPTV sales”, “A course outline about voice cloning”…' });
    const build = h('button', { type: 'button', class: 'btn primary', onclick: () => aiBuild(prompt.value, build) }, '✨ Build it');
    clear(root).append(
      h('div', { class: 'bh' },
        h('div', null, h('h2', null, 'Boards'), h('p', null, 'Plan, explain and present. Frames become slides; share any board as a link.')),
        h('button', { type: 'button', class: 'btn primary', onclick: () => create(TEMPLATES[0]) }, '＋ New board')),
      h('div', { class: 'ai-box' }, h('div', { class: 'ai-h' }, h('b', null, '✨ Ask AI to build a board'), h('small', null, S.user?.hasAiKey ? 'Uses the AI from your 🧠 Brain settings' : 'Add an AI key in 🧠 Brain first, or ask your own AI agent (over MCP) to create_board')), prompt, h('div', { class: 'row', style: 'justify-content:flex-end' }, build)),
      h('div', { class: 'sec' }, 'Start from'),
      h('div', { class: 'tpls' }, TEMPLATES.map((t) => h('button', { type: 'button', class: 'tplc', onclick: () => create(t) }, h('span', { class: 'ti' }, t.icon), h('b', null, t.name), h('small', null, t.about)))),
      h('div', { class: 'sec' }, boards.length ? `Your boards · ${boards.length}` : 'Your boards'),
      boards.length ? h('div', { class: 'bgrid' }, boards.map(tile)) : h('p', { class: 'hint' }, 'No boards yet. Start from a template above.'));
  }
  function tile(b) {
    const more = h('button', { type: 'button', class: 'btn icon sm bt-more', title: 'More', onclick: (e) => { e.stopPropagation(); tileMenu(b, e.currentTarget); } }, '⋯');
    return h('div', { class: 'bt', role: 'button', tabindex: 0, onclick: () => openBoard(b.id), onkeydown: (e) => { if (e.key === 'Enter') openBoard(b.id); } },
      h('span', { class: 'bi-ic' }, b.icon || '🧩'), h('b', null, b.name),
      h('small', null, `${b.items} item${b.items === 1 ? '' : 's'}${b.slides ? ` · ${b.slides} slides` : ''} · ${new Date(b.updatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`), more);
  }
  function tileMenu(b, btn) {
    document.querySelector('.bd-menu')?.remove();
    const r = btn.getBoundingClientRect();
    const m = h('div', { class: 'ctxmenu bd-menu', role: 'menu' },
      ...[['↗', 'Open', () => openBoard(b.id)], ['▶', 'Present', () => openBoard(b.id, true)], ['🔗', 'Share', () => openShareDialog(b)],
        ['⧉', 'Duplicate', async () => { await api('POST', `/api/boards/${b.id}/duplicate`); await load(); home(); }],
        ['🗑', 'Delete', async () => { if (await confirmDialog({ title: `Delete “${b.name}”?`, message: 'The board, its uploaded files and its share link are removed for good.', confirm: 'Delete', danger: true })) { await api('DELETE', `/api/boards/${b.id}`); await load(); home(); } }, 'danger']]
        .map(([ic, label, fn, cls]) => h('button', { type: 'button', class: `mi ${cls || ''}`, onclick: () => { m.remove(); fn(); } }, h('span', { class: 'mic' }, ic), label)));
    document.body.append(m);
    const mr = { width: m.offsetWidth, height: m.offsetHeight };
    m.style.left = `${Math.min(innerWidth - mr.width - 8, r.left)}px`; m.style.top = `${Math.min(innerHeight - mr.height - 8, r.bottom + 6)}px`;
    setTimeout(() => document.addEventListener('pointerdown', function away(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('pointerdown', away, true); } }, true));
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
  async function aiBuild(text, btn) {
    if (text.trim().length < 4) { notify('Describe the board you want first', 'error'); return; }
    btn.disabled = true; setText(btn, '✨ Designing… (up to 2 minutes)');
    try {
      const r = await api('POST', '/api/boards/generate', { prompt: text });
      notify(r.summary || 'Board ready', 'good');
      openBoard(r.board.id, false, r.board);
    } catch (e) { notify(e.message, 'error'); }
    finally { btn.disabled = false; setText(btn, '✨ Build it'); }
  }

  // ---------- editor ----------
  async function openBoard(id, presentNow = false, preloaded = null) {
    try {
      const b = preloaded?.data ? preloaded : await api('GET', `/api/boards/${id}`);
      editor?.destroy();
      clear(root);
      open = b;
      store_ls.set('flowmap.board', b.id);
      editor = createEditor(root, { board: b, onBack: () => { load().then(home); }, onRenamed: (name, icon) => { b.name = name; b.icon = icon; } });
      if (presentNow) setTimeout(() => editor.present(), 500);
    } catch (e) { notify(e.message, 'error'); store_ls.del('flowmap.board'); home(); }
  }

  return { show, hide, resize: () => editor?.resize(), get active() { return !!editor; } };
}
