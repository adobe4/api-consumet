import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  pass TEXT NOT NULL,
  settings TEXT NOT NULL DEFAULT '{}',
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
`;

export function openDb(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'flowmap.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

// Re-entrant transaction: the outermost call BEGINs, nested calls use savepoints.
let depth = 0;
export function tx(db, fn) {
  const name = `sp${depth}`;
  db.exec(depth === 0 ? 'BEGIN' : `SAVEPOINT ${name}`);
  depth++;
  try {
    const out = fn();
    depth--;
    db.exec(depth === 0 ? 'COMMIT' : `RELEASE ${name}`);
    return out;
  } catch (e) {
    depth--;
    db.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${name}; RELEASE ${name}`);
    throw e;
  }
}
