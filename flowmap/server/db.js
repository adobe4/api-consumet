// Database access through libSQL: a local SQLite file in development, Turso (free hosted SQLite) in production.
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  pass TEXT NOT NULL,
  settings TEXT NOT NULL DEFAULT '{}',
  secrets TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'custom',
  icon TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '',
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  monthly_cost REAL NOT NULL DEFAULT 0,
  cfg TEXT NOT NULL DEFAULT '{}',
  sources TEXT NOT NULL DEFAULT '[]',
  note TEXT NOT NULL DEFAULT '',
  created_on TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  to_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  resource TEXT NOT NULL,
  share REAL NOT NULL DEFAULT 0.1,
  cost REAL NOT NULL DEFAULT 0,
  delay INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_links_user ON links(user_id);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'other',
  status TEXT NOT NULL DEFAULT 'todo',
  due TEXT,
  done_on TEXT,
  quality INTEGER,
  channel TEXT NOT NULL DEFAULT 'in_video',
  targets TEXT NOT NULL DEFAULT '[]',
  hours REAL NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  reward REAL NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  sample INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id);
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  money REAL,
  attention REAL,
  customers REAL,
  posts INTEGER NOT NULL DEFAULT 0,
  feel INTEGER,
  note TEXT NOT NULL DEFAULT '',
  sample INTEGER NOT NULL DEFAULT 0,
  UNIQUE(project_id, day)
);
CREATE INDEX IF NOT EXISTS idx_logs_user_day ON logs(user_id, day);
CREATE TABLE IF NOT EXISTS scans (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  platform TEXT NOT NULL,
  at TEXT NOT NULL,
  ok INTEGER NOT NULL DEFAULT 1,
  data TEXT NOT NULL DEFAULT '{}',
  error TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_scans_project ON scans(project_id, at);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'insight',
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id, at);
CREATE TABLE IF NOT EXISTS boards (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_boards_user ON boards(user_id);
CREATE TABLE IF NOT EXISTS board_files (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  board_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_board_files_board ON board_files(board_id);
CREATE TABLE IF NOT EXISTS board_viewers (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  board_id INTEGER NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT '',
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_board_viewers_board ON board_viewers(board_id);
CREATE TABLE IF NOT EXISTS agent_keys (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);
CREATE TABLE IF NOT EXISTS board_assets (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  thumb TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_board_assets_user ON board_assets(user_id);
`;

// columns added after the first release, for databases created before them
const ADDED = [['users', 'secrets', "TEXT NOT NULL DEFAULT ''"], ['projects', 'sources', "TEXT NOT NULL DEFAULT '[]'"], ['tasks', 'source', "TEXT NOT NULL DEFAULT ''"], ['links', 'look', "TEXT NOT NULL DEFAULT '{}'"],
  ['boards', 'share_token', 'TEXT'], ['boards', 'share_mode', "TEXT NOT NULL DEFAULT 'off'"], ['boards', 'share_pass', "TEXT NOT NULL DEFAULT ''"], ['boards', 'share_seats', 'INTEGER NOT NULL DEFAULT 0'],
  ['boards', 'pinned', 'INTEGER NOT NULL DEFAULT 0'], ['boards', 'demo', 'INTEGER NOT NULL DEFAULT 0'], ['boards', 'share_opts', "TEXT NOT NULL DEFAULT '{}'"],
  ['boards', 'deleted_at', 'TEXT']];
const VERSION = 6;
// the example boards older accounts were given: they move into the Demo shelf (one tap moves them back)
const DEMO_NAMES = ['Tutorial video', 'Course outline', 'Strategy map', 'Content workflow', 'Task board', '30-day plan', 'Map of my system'];

const toArgs = (args) => args.map((a) => (a === undefined ? null : typeof a === 'boolean' ? Number(a) : a));
const plain = (row) => (row ? Object.fromEntries(Object.entries(row)) : undefined);

// get / all / run / tx over either the client or an open transaction
class Q {
  constructor(exec) { this.exec = exec; }
  async get(sql, ...args) { return plain((await this.exec(sql, args)).rows[0]); }
  async all(sql, ...args) { return (await this.exec(sql, args)).rows.map(plain); }
  async run(sql, ...args) {
    const r = await this.exec(sql, args);
    return { changes: r.rowsAffected, lastInsertRowid: r.lastInsertRowid === undefined ? 0 : Number(r.lastInsertRowid) };
  }
}

class Tx extends Q {
  constructor(t) { super((sql, args) => t.execute({ sql, args: toArgs(args) })); this.t = t; this.depth = 0; }
  // nested tx() calls inside a transaction become savepoints
  async tx(fn) {
    const name = `sp${this.depth++}`;
    await this.t.execute(`SAVEPOINT ${name}`);
    try { const out = await fn(this); await this.t.execute(`RELEASE ${name}`); return out; }
    catch (e) { await this.t.execute(`ROLLBACK TO ${name}`); await this.t.execute(`RELEASE ${name}`); throw e; }
    finally { this.depth--; }
  }
}

export class Db extends Q {
  constructor(client) { super((sql, args) => client.execute({ sql, args: toArgs(args) })); this.client = client; }
  async tx(fn) {
    const t = await this.client.transaction('write');
    try { const out = await fn(new Tx(t)); await t.commit(); return out; }
    catch (e) { await t.rollback().catch(() => {}); throw e; }
    finally { t.close(); }
  }
  close() { this.client.close(); }
}

export async function openDb({ url, authToken, dataDir } = {}) {
  if (!url) {
    fs.mkdirSync(dataDir, { recursive: true });
    url = 'file:' + path.join(dataDir, 'flowmap.db');
  }
  // the web client talks to Turso over HTTP and needs no native module (lighter serverless bundle)
  const { createClient } = url.startsWith('file:') ? await import('@libsql/client') : await import('@libsql/client/web');
  const client = createClient({ url, authToken });
  const db = new Db(client);
  // Turso does not allow setting PRAGMA user_version, so the schema version lives in a table
  await client.execute('CREATE TABLE IF NOT EXISTS flowmap_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const v = Number((await db.get("SELECT value FROM flowmap_meta WHERE key = 'schema'"))?.value || 0);
  if (v < VERSION) {
    await client.executeMultiple(SCHEMA);
    for (const [table, col, def] of ADDED) {
      // already there on databases created with the current schema
      await client.execute(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`).catch((e) => { if (!/duplicate column/i.test(e.message)) throw e; });
    }
    if (v > 0 && v < 5) await db.run(`UPDATE boards SET demo = 1 WHERE name IN (${DEMO_NAMES.map(() => '?').join(',')})`, ...DEMO_NAMES);
    await db.run("INSERT OR REPLACE INTO flowmap_meta (key, value) VALUES ('schema', ?)", String(VERSION));
  }
  if (url.startsWith('file:')) {
    await client.execute('PRAGMA journal_mode = WAL').catch(() => {});
    await client.execute('PRAGMA foreign_keys = ON').catch(() => {});
  }
  return db;
}
