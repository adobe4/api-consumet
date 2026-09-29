// Turns channel scans into the numbers the simulation runs on: uploads become posts (which keep a project
// healthy), view growth becomes attention per day, and anything notable becomes a note in the Brain feed.
import { scanSource } from './scan.js';
import { fromRow, scanOut } from './models.js';
import { fmtCompact } from '../shared/format.js';

export const AUTO_NOTE = 'auto: channel scan';
const HOUR = 3600000;

// YYYY-MM-DD in the user's own time zone
export function dayIn(tz, date = new Date()) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date); }
  catch { return date.toISOString().slice(0, 10); }
}

async function upsertLog(q, uid, projectId, day, patch) {
  const row = await q.get('SELECT * FROM logs WHERE user_id = ? AND project_id = ? AND day = ?', uid, projectId, day);
  if (row) {
    const names = Object.keys(patch);
    if (names.length) await q.run(`UPDATE logs SET ${names.map((n) => `${n} = ?`).join(', ')}, sample = 0 WHERE id = ?`, ...names.map((n) => patch[n]), row.id);
    return;
  }
  const cols = { project_id: projectId, day, note: AUTO_NOTE, ...patch };
  const names = Object.keys(cols);
  await q.run(`INSERT INTO logs (user_id, ${names.join(', ')}) VALUES (?, ${names.map(() => '?').join(', ')})`, uid, ...names.map((n) => cols[n]));
}

// views gained per day between two scans of the same channel
function youtubeViewsPerDay(prev, cur, hours) {
  if (!prev || hours < 6) return null;
  if (cur.totalViews && prev.totalViews) return Math.max(0, cur.totalViews - prev.totalViews) / (hours / 24);
  const before = new Map((prev.recent || []).map((v) => [v.id, v.views]));
  let gained = 0;
  for (const v of cur.recent || []) gained += before.has(v.id) ? Math.max(0, v.views - before.get(v.id)) : v.views;
  return gained / (hours / 24);
}
// first scan: recent videos' views spread over their age gives a floor for the daily rate
function youtubeFirstEstimate(cur) {
  const month = (cur.recent || []).filter((v) => Date.now() - Date.parse(v.publishedAt) < 30 * 24 * HOUR);
  return month.length ? month.reduce((a, v) => a + v.views, 0) / 30 : null;
}

export async function scanProject(db, uid, project, { tz, youtubeKey, fetchImpl } = {}) {
  const today = dayIn(tz);
  const sources = project.sources || [];
  const results = [];
  const postsByDay = new Map();
  let attention = null;
  const lines = [];

  for (const src of sources) {
    const prevRow = await db.get('SELECT * FROM scans WHERE user_id = ? AND project_id = ? AND url = ? AND ok = 1 ORDER BY id DESC LIMIT 1', uid, project.id, src.url);
    const prev = prevRow ? scanOut(prevRow) : null;
    const r = await scanSource(src, { youtubeKey, fetchImpl });
    const at = new Date().toISOString();
    const ins = await db.run('INSERT INTO scans (user_id, project_id, url, platform, at, ok, data, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      uid, project.id, src.url, src.platform, at, r.ok ? 1 : 0, JSON.stringify(r.data || {}), r.error || '');
    results.push({ id: ins.lastInsertRowid, projectId: project.id, url: src.url, platform: src.platform, at, ok: r.ok, data: r.data, error: r.error });
    if (!r.ok) { lines.push(`${src.platform}: ${r.error}`); continue; }
    const d = r.data;
    const hours = prev ? (Date.parse(at) - Date.parse(prev.at)) / HOUR : 0;

    if (src.platform === 'youtube') {
      const since = Date.now() - 45 * 24 * HOUR;
      for (const v of d.recent || []) {
        const t = Date.parse(v.publishedAt);
        if (t >= since) { const day = dayIn(tz, new Date(t)); postsByDay.set(day, (postsByDay.get(day) || 0) + 1); }
      }
      const rate = prev ? youtubeViewsPerDay(prev.data, d, hours) : youtubeFirstEstimate(d);
      if (rate !== null) attention = (attention || 0) + rate;
      const week = (d.recent || []).filter((v) => Date.now() - Date.parse(v.publishedAt) < 7 * 24 * HOUR).length;
      const fresh = prev ? (d.recent || []).filter((v) => !(prev.data.recent || []).some((p) => p.id === v.id)) : [];
      lines.push(`YouTube: ${d.subscribers ? `${fmtCompact(d.subscribers)} subscribers, ` : ''}${week} upload${week === 1 ? '' : 's'} in 7 days${rate !== null ? `, about ${fmtCompact(rate)} views/day${prev ? '' : ' (first estimate)'}` : ''}${fresh.length ? `. New: "${fresh[0].title}"` : ''}`);
    } else if (src.platform === 'tiktok') {
      if (prev && d.videoCount > (prev.data.videoCount || 0)) postsByDay.set(today, (postsByDay.get(today) || 0) + (d.videoCount - prev.data.videoCount));
      const grow = prev ? d.followers - (prev.data.followers || 0) : null;
      lines.push(`TikTok: ${fmtCompact(d.followers)} followers${grow !== null ? ` (${grow >= 0 ? '+' : ''}${fmtCompact(grow)})` : ''}, ${fmtCompact(d.likes)} likes, ${d.videoCount} videos`);
    } else if (src.platform === 'website') {
      for (const it of d.recent || []) {
        const t = Date.parse(it.publishedAt);
        if (Date.now() - t < 45 * 24 * HOUR) { const day = dayIn(tz, new Date(t)); postsByDay.set(day, (postsByDay.get(day) || 0) + 1); }
      }
      lines.push(`Website up (${d.ms} ms)${d.feed ? `, ${(d.recent || []).length} posts in its feed` : ''}`);
    } else if (src.platform === 'playstore') {
      lines.push(`Play Store: ${d.rating ?? '?'}★, ${d.installs || '?'} installs`);
    }
  }

  // write what we learned into the logs (a manual check-in always wins over the scanner)
  if (postsByDay.size || attention !== null) {
    await db.tx(async (q) => {
      const created = project.createdOn || '0000-00-00';
      for (const [day, n] of postsByDay) {
        if (day < created || day > today) continue;
        const row = await q.get('SELECT posts FROM logs WHERE user_id = ? AND project_id = ? AND day = ?', uid, project.id, day);
        if (!row || row.posts < n) await upsertLog(q, uid, project.id, day, { posts: n });
      }
      if (attention !== null) {
        const row = await q.get('SELECT attention, note FROM logs WHERE user_id = ? AND project_id = ? AND day = ?', uid, project.id, today);
        if (!row || row.attention === null || row.note === AUTO_NOTE) await upsertLog(q, uid, project.id, today, { attention: Math.round(attention) });
      }
    });
  }
  if (lines.length) {
    await db.run('INSERT INTO notes (user_id, project_id, at, source, kind, text) VALUES (?, ?, ?, ?, ?, ?)',
      uid, project.id, new Date().toISOString(), 'scan', results.some((x) => !x.ok) ? 'warning' : 'scan', `${project.name}: ${lines.join(' · ')}`);
  }
  return results;
}

export async function scanAll(db, uid, opts = {}) {
  const rows = await db.all("SELECT * FROM projects WHERE user_id = ? AND archived = 0 AND sources != '[]'", uid);
  const out = [];
  for (const r of rows) out.push(...(await scanProject(db, uid, fromRow('projects', r), opts)));
  return out;
}
