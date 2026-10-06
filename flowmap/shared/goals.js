// Project goals ("100k subscribers by June", "TZS 3M a month") and areas (groups of tanks on the map).
// Stored in project.cfg.goal = { metric, target, by } and project.cfg.group = "Channels".
import { addDays, dayNum } from './engine.js';

export const GOAL_METRICS = {
  subscribers: { label: 'Subscribers / followers', short: 'followers', total: true },
  money_month: { label: 'Money per month (TZS)', short: 'TZS / month', money: true },
  customers: { label: 'Paying customers', short: 'customers', total: true },
  views_month: { label: 'Views per month', short: 'views / month' },
};

export const DEFAULT_GROUP = { youtube: 'Channels', tiktok: 'Channels', app: 'Apps & sites', website: 'Apps & sites', service: 'Sales', custom: 'Other' };
export const groupOf = (p) => String(p.cfg?.group || '').trim() || DEFAULT_GROUP[p.kind] || 'Other';

// Sum of a logged number over the last 30 days, if there are enough logs to trust it.
function last30(logs, projectId, key, today) {
  const since = addDays(today, -29);
  const rows = logs.filter((l) => l.projectId === projectId && l.day >= since && l.day <= today && typeof l[key] === 'number');
  return rows.length >= 7 ? rows.reduce((a, l) => a + l[key], 0) * (30 / rows.length) : null;
}

// { metric, target, by, current, frac, estimated, perDayNeeded, daysLeft, text } or null when no goal is set
export function goalProgress(p, { logs = [], scans = [], day, today }) {
  const g = p.cfg?.goal;
  if (!g || !GOAL_METRICS[g.metric] || !(Number(g.target) > 0)) return null;
  const target = Number(g.target);
  let current = null, estimated = false;
  if (g.metric === 'subscribers') {
    for (const s of scans) if (s.projectId === p.id && s.ok) current = Math.max(current ?? 0, Number(s.data?.subscribers ?? s.data?.followers ?? 0));
  } else if (g.metric === 'money_month') {
    current = last30(logs, p.id, 'money', today);
    if (current === null && day) { current = day.money * 30; estimated = true; }
  } else if (g.metric === 'views_month') {
    current = last30(logs, p.id, 'attention', today);
    if (current === null && day) { current = day.attention * 30; estimated = true; }
  } else if (g.metric === 'customers') {
    if (p.cfg?.billing === 'monthly' && Number(p.cfg.activeCustomers) >= 0) current = Number(p.cfg.activeCustomers);
    else { current = last30(logs, p.id, 'customers', today); if (current === null && day) { current = day.customers * 30; estimated = true; } }
  }
  const frac = current === null ? 0 : Math.max(0, Math.min(1, current / target));
  const daysLeft = g.by && /^\d{4}-\d{2}-\d{2}$/.test(g.by) ? dayNum(g.by) - dayNum(today) : null;
  // pace only makes sense for totals that grow (followers, customers)
  const perDayNeeded = GOAL_METRICS[g.metric].total && current !== null && daysLeft > 0 ? Math.max(0, (target - current) / daysLeft) : null;
  return { metric: g.metric, target, by: g.by || null, current, frac, estimated, perDayNeeded, daysLeft, reached: current !== null && current >= target };
}
