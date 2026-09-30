// Starter worlds. `id` values are temporary keys; the server maps them to real database ids.
import { addDays } from './engine.js';

export const TEMPLATES = {
  creator: { label: 'Creator empire (Vinei TV, Blonxin, TikTok, AI apps, shop, IPTV)', description: 'The ecosystem this app was designed around, with sample activity so you can see it move.' },
  newstart: { label: 'New Beginning (Blonxin, Vinei TV, Kuni Box, AI Mikeka, Domo Sauti AI)', description: 'Your real numbers from September 2026 and the 90-day plan, with its board.' },
  blank: { label: 'Blank canvas', description: 'Start empty and build your own map.' },
};

export function buildTemplate(name, today) {
  if (name === 'blank') return { projects: [], links: [], tasks: [], logs: [] };
  if (name === 'newstart') return newStart(today);
  const D = (n) => addDays(today, n);
  const created = D(-30);

  const projects = [
    { id: 'vinei', name: 'Vinei TV', kind: 'youtube', icon: '🎓', color: '#ff4d5e', x: -140, y: -190, monthlyCost: 30000, createdOn: created,
      note: 'Swahili tutorials. Builds brand, ad revenue and trust. Main feeder of the whole system.',
      cfg: { viewsPerDay: 12000, rpm: 700, cadenceDays: 3 } },
    { id: 'blonxin', name: 'Blonxin', kind: 'youtube', icon: '📺', color: '#ff8a5c', x: -480, y: 390, monthlyCost: 15000, createdOn: created,
      note: 'IPTV channel. Ad revenue plus people sent to WhatsApp to buy subscriptions.',
      cfg: { viewsPerDay: 9000, rpm: 900, cadenceDays: 3 } },
    { id: 'newch', name: 'New Channels', kind: 'youtube', icon: '🎬', color: '#ff6fae', x: -140, y: 240, monthlyCost: 0, createdOn: created,
      note: 'Entertainment and explainer channels made with Domosauti. More channels = more ad revenue and proof for courses.',
      cfg: { viewsPerDay: 1500, rpm: 700, cadenceDays: 3 } },
    { id: 'tiktok', name: 'TikTok', kind: 'tiktok', icon: '🎵', color: '#b8e04a', x: -500, y: 10, monthlyCost: 0, createdOn: created,
      note: 'Cheap attention. Self-promo for every project and proof of Domosauti use cases.',
      cfg: { viewsPerDay: 15000, cadenceDays: 1 } },
    { id: 'mikeka', name: 'AI Mikeka', kind: 'app', icon: '⚽', color: '#e8b86b', x: 600, y: -220, monthlyCost: 40000, createdOn: created,
      note: 'AI bet analysis app. Users pay in TZS.',
      cfg: { price: 10000, billing: 'monthly', activeCustomers: 25, newPerDay: 0.8, churnPct: 20, conversionPer1000: 0.8, cadenceDays: 7 } },
    { id: 'domo', name: 'Domosauti', kind: 'website', icon: '🎙️', color: '#e07a5f', x: 240, y: 20, monthlyCost: 90000, createdOn: created,
      note: 'Swahili text-to-speech AI. Speeds up Vinei TV by cloning your voice and makes content for new channels.',
      cfg: { price: 15000, billing: 'monthly', activeCustomers: 18, newPerDay: 0.6, churnPct: 15, conversionPer1000: 1.2, cadenceDays: 7 } },
    { id: 'soko', name: 'DigitalSoko', kind: 'website', icon: '🛒', color: '#ffa94d', x: 600, y: 260, monthlyCost: 20000, createdOn: created,
      note: 'Marketplace for digital products, plus your courses.',
      cfg: { price: 20000, billing: 'one_off', activeCustomers: 0, newPerDay: 0.7, churnPct: 0, conversionPer1000: 1, cadenceDays: 7 } },
    { id: 'iptv', name: 'WhatsApp IPTV', kind: 'service', icon: '💬', color: '#4be38a', x: 200, y: 480, monthlyCost: 250000, createdOn: created,
      note: 'IPTV subscriptions sold on WhatsApp. Goes fine, brings steady TZS.',
      cfg: { price: 12000, billing: 'monthly', activeCustomers: 45, newPerDay: 0.6, churnPct: 10, conversionPer1000: 4, cadenceDays: 2 } },
  ];

  const L = (from, to, resource, share, note = '', extra = {}) => ({ id: `${from}>${to}:${resource}`, from, to, resource, share, cost: 0, delay: 0, note, ...extra });
  const links = [
    L('vinei', 'mikeka', 'attention', 0.12, 'Promo of AI Mikeka inside Vinei TV videos'),
    L('vinei', 'domo', 'attention', 0.12, 'Domosauti demos and mentions'),
    L('vinei', 'soko', 'attention', 0.1, 'Courses and products promoted in videos'),
    L('vinei', 'soko', 'progress', 0.5, 'Videos are proof for courses and digital services'),
    L('domo', 'vinei', 'progress', 0.6, 'Voice cloning speeds up Vinei TV production'),
    L('domo', 'newch', 'progress', 0.7, 'New entertainment and explainer videos are made with Domosauti'),
    L('domo', 'tiktok', 'progress', 0.4, 'TTS makes TikTok content faster'),
    L('newch', 'domo', 'attention', 0.1, 'Every video shows off the Swahili voice'),
    L('newch', 'soko', 'progress', 0.4, 'Documented as proof for services and courses'),
    L('tiktok', 'vinei', 'attention', 0.15, 'Self-promo for Vinei TV'),
    L('tiktok', 'mikeka', 'attention', 0.15, 'Self-promo for AI Mikeka'),
    L('tiktok', 'domo', 'attention', 0.15, 'Domosauti use-case demos'),
    L('tiktok', 'soko', 'attention', 0.15, 'Self-promo for DigitalSoko'),
    L('blonxin', 'iptv', 'attention', 0.1, 'Viewers pulled to WhatsApp to buy IPTV'),
    L('iptv', 'vinei', 'money', 0.08, 'IPTV cash reinvested in gear and ads'),
    L('iptv', 'domo', 'money', 0.08, 'IPTV cash pays TTS compute'),
    L('mikeka', 'vinei', 'progress', 0.3, 'AI analysis gives content ideas'),
  ];

  const T = (project, title, type, offset, opts = {}) => ({
    id: `t-${project}-${title.slice(0, 12)}`, projectId: project, title, type, status: opts.done ? 'done' : 'todo',
    due: opts.done ? null : D(offset), doneOn: opts.done ? D(offset) : null, quality: opts.q || null, channel: opts.channel || 'in_video',
    targets: opts.targets || [], hours: opts.hours || 0, cost: opts.cost || 0, reward: opts.reward || 0, sample: 1,
  });
  const tasks = [
    // sample history: shows who is thriving and who is drying up
    T('vinei', 'Tutorial: Excel tips', 'tutorial', -5, { done: true, q: 3, targets: ['soko'] }),
    T('vinei', 'Tutorial: Swahili voice-over trick', 'video', -2, { done: true, q: 4, targets: ['domo', 'mikeka'], channel: 'in_video' }),
    T('tiktok', 'TikTok: TTS demo', 'tiktok', -1, { done: true, q: 4, targets: ['domo'], channel: 'tiktok' }),
    T('tiktok', 'TikTok: DigitalSoko promo', 'tiktok', -2, { done: true, q: 3, targets: ['soko'], channel: 'tiktok' }),
    T('tiktok', 'TikTok: Vinei TV clip', 'tiktok', -3, { done: true, q: 3, targets: ['vinei'], channel: 'tiktok' }),
    T('blonxin', 'IPTV setup video', 'video', -11, { done: true, q: 3, targets: ['iptv'] }),
    T('mikeka', 'Weekend promo', 'promo', -13, { done: true, q: 3, channel: 'whatsapp' }),
    T('domo', 'New voice added', 'update', -4, { done: true, q: 4 }),
    T('soko', 'Add a new product', 'update', -8, { done: true, q: 3 }),
    T('iptv', 'Status promo', 'promo', -1, { done: true, q: 4, channel: 'whatsapp' }),
    T('newch', 'Explainer video #1', 'video', -6, { done: true, q: 3, targets: ['domo'] }),
    // open tasks
    T('tiktok', 'TikTok: Domosauti use case', 'tiktok', 0, { targets: ['domo'], channel: 'tiktok' }),
    T('vinei', 'Record Swahili tutorial', 'tutorial', 1, { targets: ['soko'], hours: 3 }),
    T('blonxin', 'IPTV review video with WhatsApp link', 'video', 1, { targets: ['iptv'], channel: 'pinned', hours: 2 }),
    T('vinei', 'Sponsored ad slot', 'sponsored', 5, { reward: 300000, hours: 2 }),
    T('soko', 'Add a new course', 'update', 3, { hours: 4 }),
    T('mikeka', 'Ship app update', 'update', 4, { hours: 5 }),
  ];

  const wobble = (i, m) => 1 + Math.sin(i * 1.7) * m;
  const logs = [];
  for (let i = 1; i <= 7; i++) {
    logs.push({ id: `l-v-${i}`, projectId: 'vinei', day: D(-i), money: Math.round(8400 * wobble(i, 0.12)), attention: Math.round(12000 * wobble(i, 0.1)), customers: null, posts: i === 2 ? 1 : 0, feel: 4, note: '', sample: 1 });
    logs.push({ id: `l-t-${i}`, projectId: 'tiktok', day: D(-i), money: null, attention: Math.round(15000 * wobble(i, 0.2)), customers: null, posts: i <= 3 ? 1 : 0, feel: 3, note: '', sample: 1 });
    logs.push({ id: `l-i-${i}`, projectId: 'iptv', day: D(-i), money: Math.round(18000 * wobble(i, 0.25)), attention: null, customers: Math.round(1 + Math.max(0, Math.sin(i))), posts: i === 1 ? 1 : 0, feel: 4, note: '', sample: 1 });
  }
  // the other projects were checked in too (no numbers logged), so the sample starts with a fresh system
  for (const id of ['blonxin', 'newch', 'mikeka', 'domo', 'soko']) logs.push({ id: `l-${id}-1`, projectId: id, day: D(-1), money: null, attention: null, customers: null, posts: 0, feel: 3, note: '', sample: 1 });
  return { projects, links, tasks, logs };
}

// The owner's real system as of 30 Sept 2026 (YouTube Studio exports and the app dashboards), with the
// 90-day plan. Numbers are daily averages of the last month; money in TZS at about 2,500 per dollar.
function newStart(today) {
  const D = (n) => addDays(today, n);
  const by = D(90);
  const projects = [
    { id: 'blonxin', name: 'Blonxin', kind: 'youtube', icon: '📺', color: '#ff8a5c', x: 300, y: -260, monthlyCost: 0, createdOn: today,
      note: 'English IPTV channel. Best earner: buying guides pay 2–4× more than setup videos.',
      cfg: { viewsPerDay: 1995, rpm: 8900, cadenceDays: 7, goal: { metric: 'money_month', target: 1000000, by } } },
    { id: 'vinei', name: 'Vinei TV', kind: 'youtube', icon: '🎓', color: '#ff4d5e', x: -160, y: 0, monthlyCost: 0, createdOn: today,
      note: 'Swahili tech channel, 128K subs. Promo engine for Domo Sauti and AI Mikeka. Money/loan videos pay most.',
      cfg: { viewsPerDay: 2185, rpm: 2620, cadenceDays: 3, goal: { metric: 'money_month', target: 300000, by } } },
    { id: 'kuni', name: 'Kuni Box', kind: 'app', icon: '📡', color: '#4be38a', x: 700, y: 0, monthlyCost: 0, createdOn: today,
      note: 'Live stream app for local channels. Grows by word of mouth: referrals, renewal reminders, match days.',
      cfg: { price: 12800, billing: 'monthly', activeCustomers: 18, newPerDay: 0.6, churnPct: 30, conversionPer1000: 1, cadenceDays: 7, goal: { metric: 'customers', target: 40, by } } },
    { id: 'mikeka', name: 'AI Mikeka', kind: 'website', icon: '⚽', color: '#e8b86b', x: 300, y: 260, monthlyCost: 0, createdOn: today,
      note: 'aimikeka.com match analysis, 15,000 TSh/month. Organic clips first, paid ads only after. 20 subscribers = 300K/month.',
      cfg: { price: 15000, billing: 'monthly', activeCustomers: 8, newPerDay: 0.3, churnPct: 30, conversionPer1000: 1, cadenceDays: 3, goal: { metric: 'customers', target: 20, by } } },
    { id: 'domo', name: 'Domo Sauti AI', kind: 'app', icon: '🎙️', color: '#e07a5f', x: -560, y: 0, monthlyCost: 0, createdOn: today,
      note: 'Swahili AI voice (TTS). My own tool for Vinei and TikTok videos, and a product. Every video I voice with it is a demo.',
      cfg: { price: 1000, billing: 'one_off', activeCustomers: 0, newPerDay: 1, churnPct: 0, conversionPer1000: 1, cadenceDays: 7, goal: { metric: 'customers', target: 50, by } } },
  ];
  const L = (from, to, resource, share, note) => ({ id: `${from}>${to}:${resource}`, from, to, resource, share, cost: 0, delay: 0, note });
  const links = [
    L('domo', 'vinei', 'progress', 0.5, "Domo voices Vinei videos, so they're faster to make"),
    L('vinei', 'domo', 'attention', 0.03, 'AI videos voiced by Domo, with the credit line and link, send creators to it'),
    L('vinei', 'mikeka', 'attention', 0.02, 'One Vinei video a month shows AI Mikeka'),
  ];
  const T = (project, title, type, offset, hours, note, targets = []) => ({
    id: `t-${project}-${offset}`, projectId: project, title, type, status: 'todo', due: D(offset), doneOn: null, quality: null,
    channel: type === 'tiktok' ? 'tiktok' : 'in_video', targets, hours, cost: 0, reward: 0, note, sample: 0,
  });
  const tasks = [
    T('blonxin', 'Video: Best IPTV Boxes 2027 (buying guide)', 'video', 2, 5, 'Buying guides pay 2–4× more than setup videos (Top 5 Boxes made $38 from 2.9K views). Add affiliate links; legal apps only.'),
    T('mikeka', '3 TikTok/Instagram clips before the weekend matches', 'tiktok', 3, 2, 'Show real analysis and post the losses too. Say match analysis, never guaranteed wins.'),
    T('kuni', 'Add renewal reminder + referral reward (free days per paying friend)', 'update', 4, 4, 'Payments went quiet after about 24 Sept; reminders 1–2 days before expiry bring renewals back.'),
    T('domo', 'Track payment prompts sent vs payments completed', 'update', 4, 1, 'If many people cancel the USSD prompt, show the price clearly before it appears.'),
    T('vinei', 'Video: App bora za mikopo (latest update)', 'video', 5, 4, "Loan videos earn 40% of Vinei's money at about 5× the rate of other topics."),
    T('vinei', 'Video: make Swahili AI voice-overs (voiced by Domo Sauti)', 'tutorial', 6, 4, 'Say "Sauti hii imetengenezwa na Domo Sauti AI" and put the link in the description.', ['domo']),
  ];
  const G = (project, money, attention, customers, note) => ({ id: `l-${project}`, projectId: project, day: today, money, attention, customers, posts: 0, feel: null, note, sample: 0 });
  const logs = [
    G('blonxin', 17800, 1995, null, 'Daily average of the last 28 days (YouTube Studio): $213.5, 55.9K views'),
    G('vinei', 5730, 2185, null, 'Daily average of the last 28 days (YouTube Studio): $68.8, 61.2K views'),
    G('kuni', 7670, null, 0.6, 'Daily average of September: 230K TSh from 18 payments'),
    G('mikeka', 4200, null, null, 'Daily average of September: 126K TSh (about 8 subscribers at 15,000)'),
    G('domo', 1000, null, 1, 'Daily average of the first 4 days: 4K TSh from 4 payments'),
  ];
  return { projects, links, tasks, logs, boards: [NEW_BEGINNING_BOARD] };
}

const NEW_BEGINNING_BOARD = {
  name: 'New Beginning', icon: '🌱',
  specs: [
    { layout: 'slides', title: 'New Beginning', slides: [
      { title: 'New Beginning', subtitle: '90 days · 1 Oct – 29 Dec 2026', emoji: 'i:rocket', points: ['Focus: grow what already pays', 'No new apps for 90 days', 'Projects that feed each other'], note: 'Built from real numbers on 30 Sept 2026: YouTube Studio exports plus the app dashboards.' },
      { title: 'Where I stand today', subtitle: 'Last 30 days, real numbers', emoji: 'i:banknote', points: ['Blonxin: ≈535K TSh ($213), 55.9K views', 'Kuni Box: 230K TSh, 18 payments', 'Vinei TV: ≈172K TSh ($69), 61K views', 'AI Mikeka: 126K TSh, about 8 subscribers', 'Domo Sauti AI: 4K TSh in its first 4 days'], note: 'Converted at about 2,500 TSh per dollar.' },
      { title: 'Blonxin: my best earner', subtitle: '1 video every week', emoji: 'i:trophy', points: ['Pays $6.13 per 1,000 views, Vinei pays $1.61', 'Buying guides pay most: Top 5 Boxes made $38 from 2.9K views', 'Mix: 3 buying guides + 1 setup/fix video', 'Box videos out by early November for the holiday season', 'Affiliate links on box reviews; legal apps only', 'Target: $400+ every 28 days'] },
      { title: 'Vinei TV: my promo engine', subtitle: '2 videos every week', emoji: 'i:megaphone', points: ["1 money/loan video: 40% of Vinei's money", '1 AI video voiced by Domo Sauti', 'Monthly: remake an old hit (call forwarding first)', 'Monthly: a video that shows AI Mikeka', 'Target: 3,000 watch hours and $120 a month'], note: 'Watch time fell from 3,832 hours (Aug 2025) to about 1,765 because uploads dropped from 7 a month to 1.' },
      { title: 'Domo Sauti AI', subtitle: 'My tool and my product', emoji: 'i:zap', points: ['Every video I voice with it is a free demo', 'Line in videos: Sauti hii imetengenezwa na Domo Sauti AI', 'Link in every Vinei description', 'Count payment prompts vs payments completed', 'Target: 50+ paying users'] },
      { title: 'AI Mikeka', subtitle: '15,000 TSh a month · organic first', emoji: 'i:flame', points: ['3 short clips a week on TikTok and Instagram', 'Post Friday–Saturday before big matches', 'Show real analysis and post the losses too', 'Say match analysis, never guaranteed wins', 'Paid ads only after organic proves people pay', 'Target: 20 subscribers = 300K TSh a month'], note: 'Meta and TikTok usually treat betting tips as gambling: expect rejections, and use a small test budget.' },
      { title: 'Kuni Box', subtitle: 'Word of mouth', emoji: 'i:heart', points: ['Referral reward: free days for each friend who pays', 'Renewal reminder 1–2 days before a subscription ends', 'Big match-day pushes', 'Check I have the rights to stream the channels', 'Target: 40 payments a month'] },
      { title: 'My weekly rhythm', subtitle: 'The same every week', emoji: 'i:clock', points: ['Mon–Tue: Vinei, 2 videos', 'Wed–Thu: Blonxin, 1 video', 'Fri–Sat: AI Mikeka clips + Kuni Box match-day push', 'Sun: check-in, log the numbers in FlowMap'] },
      { title: 'Checkpoints', subtitle: "How I'll know it's working", emoji: 'i:flag', points: ['Day 30 (31 Oct): 4 Blonxin videos, 8 Vinei videos, Kuni Box 25+ payments', 'Day 60 (30 Nov): Blonxin above $300 per 28 days, Vinei stops falling', 'Day 90 (29 Dec): top projects stronger, and I decide on the IPTV player with real numbers'] },
    ] },
    { layout: 'workflow', title: 'How my projects feed each other', nodes: [
      { id: 'domo', title: 'Domo Sauti AI', text: 'Voices my videos', kind: 'card' },
      { id: 'vinei', title: 'Vinei TV', text: '128K subs · promo engine', kind: 'card' },
      { id: 'tiktok', title: 'TikTok / Instagram', text: 'Short clips', kind: 'card' },
      { id: 'mikeka', title: 'AI Mikeka', text: 'Match analysis', kind: 'card' },
      { id: 'blonxin', title: 'Blonxin', text: 'Best earner', kind: 'card' },
      { id: 'kuni', title: 'Kuni Box', text: 'Grows by word of mouth', kind: 'card' },
    ], edges: [
      { from: 'domo', to: 'vinei', label: 'voice-overs', flow: true },
      { from: 'domo', to: 'tiktok', label: 'voice-overs', flow: true },
      { from: 'vinei', to: 'domo', label: 'new users', flow: true },
      { from: 'vinei', to: 'mikeka', label: 'monthly video', flow: true },
      { from: 'tiktok', to: 'mikeka', label: 'weekend clips', flow: true },
    ] },
    { layout: 'timeline', title: '90 days', milestones: [
      { date: '1 Oct', title: 'Start', text: 'Weekly rhythm begins' },
      { date: '31 Oct', title: 'Day 30', text: '4 Blonxin + 8 Vinei videos, Kuni Box 25+ payments' },
      { date: 'Early Nov', title: 'Holiday box videos live', text: 'Black Friday and Christmas buying season' },
      { date: '30 Nov', title: 'Day 60', text: 'Blonxin above $300 per 28 days, Vinei stops falling' },
      { date: '29 Dec', title: 'Day 90', text: 'Blonxin $400+, Kuni Box 40 payments, AI Mikeka 20 subscribers, Domo 50+ users' },
    ] },
  ],
};
