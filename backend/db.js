const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_FILE = process.env.DATA_FILE || '/data/tasks.db';

let db;

function save() {
  const data = db.export();
  const buf = Buffer.from(data);
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, DB_FILE);
}

async function init() {
  const SQL = await initSqlJs();
  const dir = path.dirname(DB_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (fs.existsSync(DB_FILE)) {
    const buf = fs.readFileSync(DB_FILE);
    db = new SQL.Database(buf);
    console.log('[DB] Loaded existing database from', DB_FILE);
  } else {
    db = new SQL.Database();
    console.log('[DB] Created new database at', DB_FILE);
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '#7b61ff'
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      estimatedDuration INTEGER NOT NULL,
      priority INTEGER NOT NULL,
      dueDate TEXT,
      dateAdded TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      createdBy TEXT,
      createdByName TEXT,
      closedBy TEXT,
      closedByName TEXT,
      closedAt TEXT,
      recurring TEXT DEFAULT 'none',
      recurrenceDays INTEGER,
      categoryId TEXT REFERENCES categories(id) ON DELETE SET NULL,
      claimedBy TEXT,
      claimedByName TEXT,
      claimedAt TEXT
    )
  `);

  // Migrations for upgrades from older schemas
  const migrations = [
    'ALTER TABLE tasks ADD COLUMN categoryId TEXT REFERENCES categories(id) ON DELETE SET NULL',
    'ALTER TABLE tasks ADD COLUMN claimedBy TEXT',
    'ALTER TABLE tasks ADD COLUMN claimedByName TEXT',
    'ALTER TABLE tasks ADD COLUMN claimedAt TEXT',
  ];
  for (const sql of migrations) {
    try { db.run(sql); } catch (_) { /* column already exists */ }
  }

  save();
  initGamification();
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function get(sql, params = []) {
  return all(sql, params)[0] || null;
}

function run(sql, params = []) {
  db.run(sql, params);
  save();
}

module.exports = { init, all, get, run, save };

// Called from init() — run after tables exist
function initGamification() {
  db.run(`
    CREATE TABLE IF NOT EXISTS user_stats (
      username TEXT PRIMARY KEY,
      displayName TEXT,
      totalPoints INTEGER DEFAULT 0,
      tasksCompleted INTEGER DEFAULT 0,
      currentStreak INTEGER DEFAULT 0,
      longestStreak INTEGER DEFAULT 0,
      lastCloseDate TEXT,
      weeklyPoints INTEGER DEFAULT 0,
      weekStart TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS user_achievements (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      achievementId TEXT NOT NULL,
      earnedAt TEXT NOT NULL,
      UNIQUE(username, achievementId)
    )
  `);

  // Add claimedAt to tasks if missing (needed for speed run achievement)
  try { db.run('ALTER TABLE tasks ADD COLUMN claimedAt TEXT'); } catch(_) {}
  save();
}
