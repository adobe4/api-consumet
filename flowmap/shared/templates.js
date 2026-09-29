// Starter worlds. `id` values are temporary keys; the server maps them to real database ids.
import { addDays } from './engine.js';

export const TEMPLATES = {
  creator: { label: 'Creator empire (Vinei TV, Blonxin, TikTok, AI apps, shop, IPTV)', description: 'The ecosystem this app was designed around, with sample activity so you can see it move.' },
  blank: { label: 'Blank canvas', description: 'Start empty and build your own map.' },
};

export function buildTemplate(name, today) {
  if (name === 'blank') return { projects: [], links: [], tasks: [], logs: [] };
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
    { id: 'domo', name: 'Domosauti', kind: 'website', icon: '🗣️', color: '#e07a5f', x: 240, y: 20, monthlyCost: 90000, createdOn: created,
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
  return { projects, links, tasks, logs };
}
