// Board design sessions: the AI studies the whole board, asks the owner a few questions, then designs one
// section at a time (seeing a picture of it when the model can see), fixes what the design check finds, and
// finishes with a pass that makes the whole board consistent. The browser drives the steps, so every step
// is its own short request and the owner watches it happen.
import { HttpError } from './models.js';
import { callTool, chatOnce, readPlan, applyPlan, DESIGN_GUIDE, PLAN_ITEM_FIELDS } from './brain.js';
import { lintBoard } from './boards.js';

// design directions the owner can choose from; each is a concrete recipe, not an adjective
export const DIRECTIONS = {
  bold: { label: 'Bold studio', hint: 'Dark bars, big white text, one strong accent, grid floor', colors: ['#1c1916', '#2fb4a0', '#f5f1ea'],
    recipe: `BOLD STUDIO. Floor "grid". Frames: style.finish "tinted", style.shadow "raised", one accent for the whole board (default #2fb4a0, or #ff8a5c / #e8b86b). Slide title: text at (70,56), size 46-56, bold, ink #1c1916, left. Subtitle 18, muted. Content as stacked dark bars: shape "rect", color #1c1916, style.finish "solid", style.radius 12-14, height 64-84, gap 16; on each bar an ellipse number chip 44px in the accent (text the number, size 18, bold, textColor #1c1916) and a heading text in white (size 22, bold) with an optional detail text (#e9dfd2, size 16). One big accent sticker (96px) top-right. A soft pressed flip card (style.finish "soft", style.shadow "sunk") for "tap to reveal". Connectors: kind "tunnel", width 8, accent, flow.` },
  desk: { label: 'Paper desk', hint: 'Real paper notes, tape and pins, handwriting, dots floor', colors: ['#ffd54a', '#c9a273', '#f5f1ea'],
    recipe: `PAPER DESK. Floor "dots". Frames: style.finish "soft", style.shadow "raised", accent #e8b86b or #ff8a5c. Title 44-50 bold ink, left; a handwritten subtitle (style.hand, size 26). Content mostly paper: notes with paper sticky (#ffd54a, #ffb020, #ff8a5c), lined, index and kraft, 240-320 wide, 200-260 tall, rot between -3 and 3, held by pin "tape", "pin" or "clip"; note text size 22-28 with style.hand for personal thoughts. Steps as a checklist. Clips (paperclip, binder) on photos or cards. Connectors kind "drawn", width 3, ink #1c1916. Stickers sparingly.` },
  clean: { label: 'Clean & minimal', hint: 'Lots of space, one big statement, soft cards, plain floor', colors: ['#f5f1ea', '#8a7b6d', '#e07a5f'],
    recipe: `CLEAN & MINIMAL. Floor "plain". Frames: style.finish "soft", style.shadow "float", style.radius 28. Lots of empty space. One statement per slide: text size 56-72, bold, ink, centered or left. At most 3 supporting elements: cards with style.finish "glass" or "soft", radius 24, body size 18-20, muted. One accent colour used on one element only (#e07a5f). Thin connectors: kind "line", width 2, #8a7b6d. No rotation, no clips, no tape.` },
  playful: { label: 'Bright & playful', hint: 'Many warm colours, pills and stickers, bounce, flip cards', colors: ['#ff8a5c', '#b8e04a', '#ff6fae'],
    recipe: `BRIGHT & PLAYFUL. Floor "dots". Frames: style.finish "tinted", a different warm accent per slide (#ff8a5c, #b8e04a, #ff6fae, #ffb020, #2fb4a0). Title 46-54 bold, with a solid pill shape behind the key word. Shapes: pill, star, bubble, hexagon in solid accents with 22-28 bold text. Stickers 80-110px with anim.loop "bounce" or "wiggle". Sticky notes rotated. Flip cards for surprises, jump buttons between slides. Animations: anim.in "pop" with small delays.` },
  editorial: { label: 'Warm editorial', hint: 'Magazine layout, huge numbers, two columns, aged paper', colors: ['#e8b86b', '#3a2812', '#f1dfb6'],
    recipe: `WARM EDITORIAL. Floor "plain". Frames: style.finish "soft", accent #e8b86b. Magazine layout: two columns, huge numbers (text size 96-120, bold, accent) beside short headings (26-30 bold) and body (17-18, muted, left). Thin divider bars (shape rect 4-6px tall, accent). Side notes on paper "aged" or "kraft" with style.hand. Title 50-56 bold, tight. Quotes in a bubble shape.` },
};

const REDESIGN = /redesign|design|better|perfect|beautiful|improve|fix|new|create|build|make|more|style|look|polish|tengeneza|boresha|nzuri|mpya/i;
const SLIDE_W = 1100, SLIDE_H = 620, GAP_X = 180, GAP_Y = 200;

// ---------- understanding the board ----------
const center = (i) => ({ x: i.x + i.w / 2, y: i.y + i.h / 2 });
const within = (i, f) => { const c = center(i); return c.x >= f.x && c.x <= f.x + f.w && c.y >= f.y && c.y <= f.y + f.h; };
function sectionsOf(view) {
  const frames = view.items.filter((i) => i.type === 'frame');
  const order = view.slides || [];
  frames.sort((a, b) => ((order.indexOf(a.id) + 1) || 999) - ((order.indexOf(b.id) + 1) || 999) || a.y - b.y || a.x - b.x);
  const taken = new Set();
  const sections = frames.map((f) => {
    // the smallest frame that holds an item owns it (frames can sit inside bigger ones)
    const items = view.items.filter((i) => i !== f && i.type !== 'frame' && within(i, f) && !frames.some((g) => g !== f && g.w * g.h < f.w * f.h && within(i, g)));
    items.forEach((i) => taken.add(i.id));
    return { frame: f, items, slide: order.indexOf(f.id) + 1 };
  });
  const free = view.items.filter((i) => i.type !== 'frame' && !taken.has(i.id));
  return { sections, free };
}
const short = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s);
function local(i, ox, oy) {
  const o = { ...i, x: Math.round(i.x - ox), y: Math.round(i.y - oy) };
  if (o.text) o.text = short(o.text, 220);
  if (o.title) o.title = short(o.title, 140);
  delete o.anim;
  return JSON.stringify(o);
}
// a short picture of the whole board in words: every section, what is in it, how it is styled
function boardBrief(view) {
  const { sections, free } = sectionsOf(view);
  const kinds = (items) => Object.entries(items.reduce((m, i) => ({ ...m, [i.type]: (m[i.type] || 0) + 1 }), {})).map(([k, n]) => `${n} ${k}`).join(', ') || 'empty';
  const sizes = (items) => [...new Set(items.map((i) => i.style?.size).filter(Boolean))].sort((a, b) => b - a).slice(0, 4).join('/');
  const lines = sections.map(({ frame: f, items, slide }) => `- ${slide ? `Slide ${slide}` : 'Section'} [${f.id}] "${short(f.title || '', 60)}" at (${Math.round(f.x)},${Math.round(f.y)}) ${Math.round(f.w)}x${Math.round(f.h)}${f.color ? ` accent ${f.color}` : ''}: ${kinds(items)}${sizes(items) ? `; text sizes ${sizes(items)}` : ''}${items.filter((i) => i.text || i.title).length ? `; says: ${short(items.map((i) => (i.title || i.text || '').split('\n')[0]).filter(Boolean).join(' | '), 200)}` : ''}`);
  if (free.length) lines.push(`- Outside any frame: ${kinds(free)}`);
  return `Board "${view.name}" · floor ${view.floor} · ${view.items.length} items · ${sections.length} frames${view.slides.length ? ` (${view.slides.length} are slides)` : ''}\n${lines.join('\n') || '- (empty board)'}`;
}
function sectionDetail(view, focus) {
  const { sections, free } = sectionsOf(view);
  const s = sections.find((x) => x.frame.id === focus);
  if (s) {
    const f = s.frame;
    return { origin: { x: f.x, y: f.y }, frame: f, items: s.items,
      text: `YOUR SECTION: frame ${f.id} "${f.title || ''}"${s.slide ? ` (slide ${s.slide})` : ''}, ${Math.round(f.w)}x${Math.round(f.h)}. Coordinates below and in your answer are LOCAL to this frame: (0,0) is its top-left corner, keep everything inside 0..${Math.round(f.w)} x 0..${Math.round(f.h)} with 50-70px margins.\nFRAME: ${local(f, f.x, f.y)}\nITEMS IN IT (one per line):\n${s.items.map((i) => local(i, f.x, f.y)).join('\n') || '(none yet)'}` };
  }
  return { origin: { x: 0, y: 0 }, frame: null, items: free,
    text: `YOUR SECTION: the items outside any frame. Coordinates are absolute board coordinates.\nITEMS (one per line):\n${free.map((i) => local(i, 0, 0)).join('\n') || '(none)'}` };
}

// ---------- prompts ----------
const prefsText = (settings) => {
  const p = Array.isArray(settings.designPrefs) ? settings.designPrefs.slice(-16) : [];
  return p.length ? `WHAT THE OWNER HAS TOLD YOU THEY LIKE (respect it):\n- ${p.join('\n- ')}` : '';
};
const answersText = (answers) => (Array.isArray(answers) && answers.length ? `THE OWNER'S ANSWERS FOR THIS DESIGN:\n- ${answers.slice(0, 12).map((a) => `${short(String(a.q || ''), 140)} → ${short(String(a.a || ''), 200)}`).join('\n- ')}` : '');
const directionText = (id) => (DIRECTIONS[id] ? `STYLE DIRECTION (follow this recipe closely):\n${DIRECTIONS[id].recipe}` : 'STYLE DIRECTION: choose the one that fits the content best and keep it consistent across the board.');

const PLAN_SYSTEM = `You are a senior presentation and board designer working inside FlowMap, a creator's planning and presentation canvas. The owner presents boards full screen and screen-records them for tutorials, strategy videos and courses.
Before designing, study the whole board and the request, understand what it is for, then plan the work.
${DESIGN_GUIDE}
Answer with ONE JSON object and nothing else:
{"understanding":"2-4 sentences: what this board is for, who will see it, what is weak today",
 "questions":[{"id":"q1","q":"a short question","type":"yesno|choice|text","options":[{"id":"a","label":"short label","hint":"what it means"}]}],
 "steps":[{"focus":"<frame id> | free | new","title":"short","what":"concrete instruction for this section: layout, which tools, text sizes, colours"}],
 "summary":"one sentence plan"}
Questions: ask 0 to 4, only when the answer really changes the design and you cannot know it (from the request, the board or what the owner said they like). Good questions: big text or compact? centred or left titles? which of these layouts or colour moods? more slides or fewer? Use "choice" with 2-5 options for preferences, "yesno" for simple ones. Do not ask about style direction (FlowMap asks that itself).
Steps: one step per section that needs work (for a redesign: every frame, each with its own layout), "free" for things outside frames, "new" for each new slide or section to create. At most 14 steps. Each "what" is specific to that section's content. Write in the owner's language.`;

const SECTION_SYSTEM = (direction, settings, answers) => `You are a senior presentation and board designer working inside FlowMap. You design ONE section of the board now, item by item, with taste: real hierarchy, a clear focal point, generous space, perfect alignment, text that fits, and the right tool for each piece of content. You may move, resize, restyle, rewrite, delete and add anything in this section. Keep the owner's content and meaning unless asked to change it.
${DESIGN_GUIDE}
${directionText(direction)}
${prefsText(settings)}
${answersText(answers)}
If a picture of the section is attached, look at it: it shows how the section really renders now.
Answer with ONE JSON object and nothing else (coordinates LOCAL to the section):
{"summary":"one sentence","frame":{"title":"...","color":"#hex","style":{...}},"changes":[{"id":"<item id>", ...fields to change; "delete":true removes it}],"add":[{"type":"...","ref":"name","x":0,"y":0,"w":0,"h":0, ...}],"connect":[{"from":"id or ref","to":"id or ref","kind":"line|tunnel|raised|drawn","label":""}]}
${PLAN_ITEM_FIELDS}
Write in the owner's language.`;

const POLISH_SYSTEM = (direction, settings, answers) => `You are a senior presentation and board designer working inside FlowMap. Every section has been designed. Now look at the WHOLE board and make it consistent and polished: the same title size and position on every slide, the same body sizes, consistent accents and finishes, aligned positions across slides, even gaps, slide order that tells the story, jump links where a menu or "next" helps, connections that read well. Change only what improves the whole; do not redesign sections again.
${DESIGN_GUIDE}
${directionText(direction)}
${prefsText(settings)}
${answersText(answers)}
Answer with ONE JSON object and nothing else (absolute board coordinates):
{"summary":"one sentence","floor":"dots|grid|plain","changes":[{"id":"...", ...}],"restyle":[{"ids":[...],"types":[...],"style":{...},"color":"#hex"}],"add":[...],"connect":[...],"slides":["frame ids to add to the presenting order"]}
${PLAN_ITEM_FIELDS}`;

// ---------- the steps ----------
async function ask(ai, system, content, images, deadline) {
  const messages = [{ role: 'user', content }];
  let last = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    let text;
    try { text = await chatOnce(ai, system, messages, deadline, 12000, attempt ? [] : images); } catch (e) {
      throw new HttpError(502, e.name === 'TimeoutError' ? 'The AI took too long on this step. Try a faster model, or a smaller request.' : e.message);
    }
    try { return readPlan(text); } catch (e) {
      last = e;
      messages.push({ role: 'assistant', content: String(text).slice(0, 4000) }, { role: 'user', content: `That was not usable (${e.message}). Reply again with ONLY the JSON object${e.message.includes('cut off') ? ', shorter' : ''}.` });
    }
  }
  throw new HttpError(502, `The AI answered in a way FlowMap could not read (${last?.message}). Try again or pick another model.`);
}
const asArr = (v) => (Array.isArray(v) ? v : []);
const cleanImages = (v) => asArr(v).filter((u) => typeof u === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(u) && u.length < 3_000_000).slice(0, 2);

// where the next new slides go: after the existing ones, four to a row
function slotFor(view, n) {
  const frames = view.items.filter((i) => i.type === 'frame');
  const count = frames.length + n;
  if (!view.items.length) return { x: (n % 4) * (SLIDE_W + GAP_X), y: Math.floor(n / 4) * (SLIDE_H + GAP_Y) };
  const slides = frames.filter((f) => Math.abs(f.w - SLIDE_W) < 40 && Math.abs(f.h - SLIDE_H) < 40);
  if (slides.length) {
    const y0 = Math.min(...slides.map((f) => f.y)), x0 = Math.min(...slides.map((f) => f.x));
    return { x: x0 + (count % 4) * (SLIDE_W + GAP_X), y: y0 + Math.floor(count / 4) * (SLIDE_H + GAP_Y) };
  }
  const maxX = Math.max(...view.items.map((i) => i.x + i.w)), minY = Math.min(...view.items.map((i) => i.y));
  return { x: maxX + 300 + (n % 4) * (SLIDE_W + GAP_X), y: minY + Math.floor(n / 4) * (SLIDE_H + GAP_Y) };
}

export async function designStep(bctx, ai, boardId, body, settings, deadline) {
  const phase = String(body.phase || '');
  let view = await callTool(bctx, 'get_board', { board: boardId });
  const request = String(body.request || '').slice(0, 4000);
  const images = cleanImages(body.images);
  const answers = asArr(body.answers);

  if (phase === 'plan') {
    const plan = await ask(ai, PLAN_SYSTEM, `${boardBrief(view)}\n\nALL ITEMS (absolute coordinates):\n${view.items.slice(0, 260).map((i) => local(i, 0, 0)).join('\n') || '(none)'}\n\n${prefsText(settings)}\n\nTHE OWNER ASKS: ${request || 'Make this board look great.'}`, images, deadline);
    const frames = new Set(view.items.filter((i) => i.type === 'frame').map((i) => i.id));
    let fresh = 0;
    const steps = asArr(plan.steps).slice(0, 14).map((s) => {
      const focus = frames.has(String(s?.focus)) ? String(s.focus) : s?.focus === 'free' ? 'free' : 'new';
      const step = { focus, title: short(String(s?.title || (focus === 'new' ? 'New section' : 'Section')), 60), what: short(String(s?.what || ''), 900) };
      if (focus === 'new') step.slot = slotFor(view, fresh++);
      return step;
    }).filter((s) => s.focus !== 'free' || view.items.some((i) => i.type !== 'frame'));
    if (!steps.length && !frames.size) steps.push({ focus: 'new', title: 'First slide', what: request, slot: slotFor(view, 0) });
    const questions = asArr(plan.questions).slice(0, 4).map((q, n) => ({
      id: short(String(q?.id || `q${n + 1}`), 20), q: short(String(q?.q || ''), 160),
      type: ['yesno', 'choice', 'text'].includes(q?.type) ? q.type : asArr(q?.options).length ? 'choice' : 'yesno',
      options: asArr(q?.options).slice(0, 5).map((o, k) => ({ id: short(String(o?.id || String.fromCharCode(97 + k)), 12), label: short(String(o?.label || o || ''), 70), hint: short(String(o?.hint || ''), 120) })).filter((o) => o.label),
    })).filter((q) => q.q);
    // the style direction: asked once, then remembered
    const known = DIRECTIONS[settings.designDirection] ? settings.designDirection : null;
    if (!known && REDESIGN.test(request || 'design')) questions.unshift({ id: 'direction', q: 'Which style do you like most for this board?', type: 'choice', options: [...Object.entries(DIRECTIONS).map(([id, d]) => ({ id, label: d.label, hint: d.hint, colors: d.colors })), { id: 'auto', label: 'Let the AI decide', hint: 'It picks what fits the content' }] });
    return { phase, understanding: short(String(plan.understanding || ''), 700), summary: short(String(plan.summary || ''), 300), questions, steps, direction: known };
  }

  const direction = DIRECTIONS[body.direction] ? body.direction : DIRECTIONS[settings.designDirection] ? settings.designDirection : null;
  if (phase === 'section' || phase === 'fix') {
    let focus = String(body.focus || 'free');
    const step = body.step && typeof body.step === 'object' ? body.step : {};
    // a new slide: make its frame first, then design inside it
    if (focus === 'new') {
      const slot = step.slot && Number.isFinite(step.slot.x) && Number.isFinite(step.slot.y) ? step.slot : slotFor(view, 0);
      const made = await callTool(bctx, 'add_to_board', { board: boardId, at: { x: 0, y: 0 }, items: [{ type: 'frame', ref: 'f', x: slot.x, y: slot.y, w: SLIDE_W, h: SLIDE_H, title: short(String(step.title || 'New slide'), 80), style: { finish: 'tinted', shadow: 'raised' } }], slides: ['f'] });
      focus = made.refs.f;
      view = await callTool(bctx, 'get_board', { board: boardId });
    }
    const sec = sectionDetail(view, focus);
    const issues = asArr(body.issues).slice(0, 30).map((x) => short(String(x), 300));
    const task = phase === 'fix'
      ? `FlowMap checked this section and found these problems. Fix every one (keep the design):\n- ${issues.join('\n- ')}`
      : `THIS STEP: ${short(String(step.title || ''), 80)}: ${short(String(step.what || request), 900)}`;
    const plan = await ask(ai, SECTION_SYSTEM(direction, settings, answers), `THE WHOLE BOARD (for context):\n${boardBrief(view)}\n\n${sec.text}\n\n${task}\n\nTHE OWNER'S REQUEST: ${request || 'Make it look great.'}`, images, deadline);
    // local coordinates back to the board
    const { x: ox, y: oy } = sec.origin;
    const known = new Set(sec.items.map((i) => i.id));
    const shift = (o) => ({ ...o, ...(Number.isFinite(o.x) ? { x: o.x + ox } : {}), ...(Number.isFinite(o.y) ? { y: o.y + oy } : {}) });
    const changes = asArr(plan.changes).filter((c) => known.has(String(c?.id))).map(shift);
    if (sec.frame && plan.frame && typeof plan.frame === 'object') { const { x, y, w, h, ...rest } = plan.frame; changes.push({ ...rest, id: sec.frame.id }); }
    const add = asArr(plan.add).filter((a) => a && a.type !== 'frame').map(shift);
    const out = await applyPlan(bctx, boardId, { summary: plan.summary, changes, add, connect: asArr(plan.connect) }).catch((e) => { if (/did not change/.test(e.message)) return { summary: plan.summary || 'Nothing to change here', edits: 0, added: [] }; throw e; });
    const after = await callTool(bctx, 'get_board', { board: boardId });
    const region = sec.frame ? after.items.find((i) => i.id === sec.frame.id) : null;
    const inSec = new Set(after.items.filter((i) => i.type !== 'frame' && (region ? within(i, region) : !after.items.some((f) => f.type === 'frame' && within(i, f)))).map((i) => i.id));
    return { phase, focus, summary: short(String(out.summary || ''), 300), edits: out.edits, issues: lintBoard({ items: after.items }, inSec) };
  }

  if (phase === 'polish') {
    const plan = await ask(ai, POLISH_SYSTEM(direction, settings, answers), `${boardBrief(view)}\n\nALL ITEMS (absolute coordinates):\n${view.items.slice(0, 300).map((i) => local(i, 0, 0)).join('\n')}\n\nTHE OWNER'S REQUEST: ${request || 'Make it look great.'}`, images, deadline);
    const out = await applyPlan(bctx, boardId, plan).catch((e) => { if (/did not change/.test(e.message)) return { summary: 'Already consistent', edits: 0 }; throw e; });
    return { phase, summary: short(String(out.summary || ''), 300), edits: out.edits };
  }
  throw new HttpError(400, 'Unknown design step');
}
