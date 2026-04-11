/**
 * One-time migration: tasks.json → tasks.db
 * Run this manually before starting the new version if you have existing data:
 *
 *   docker run --rm \
 *     -v $(pwd)/data:/data \
 *     -w /app \
 *     --entrypoint node \
 *     taskpilot-api migrate-json-to-sqlite.js
 */
const initSqlJs = require('sql.js');
const fs = require('fs');

const JSON_FILE = process.env.JSON_FILE || '/data/tasks.json';
const DB_FILE = process.env.DATA_FILE || '/data/tasks.db';

async function migrate() {
  if (!fs.existsSync(JSON_FILE)) {
    console.log('No tasks.json found, nothing to migrate.');
    process.exit(0);
  }
  if (fs.existsSync(DB_FILE)) {
    console.log('tasks.db already exists, skipping migration.');
    process.exit(0);
  }

  const tasks = JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));
  console.log(`Migrating ${tasks.length} tasks from ${JSON_FILE} to ${DB_FILE}…`);

  const SQL = await initSqlJs();
  const db = new SQL.Database();

  db.run(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '',
      estimatedDuration INTEGER NOT NULL, priority INTEGER NOT NULL,
      dueDate TEXT, dateAdded TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
      createdBy TEXT, createdByName TEXT, closedBy TEXT, closedByName TEXT,
      closedAt TEXT, recurring TEXT DEFAULT 'none', recurrenceDays INTEGER
    )
  `);

  const stmt = db.prepare(`
    INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);

  for (const t of tasks) {
    stmt.run([
      t.id, t.name, t.description || '', t.estimatedDuration, t.priority,
      t.dueDate || null, t.dateAdded, t.status,
      t.createdBy || null, t.createdByName || null,
      t.closedBy || null, t.closedByName || null, t.closedAt || null,
      t.recurring || 'none', t.recurrenceDays || null
    ]);
  }
  stmt.free();

  const buf = Buffer.from(db.export());
  fs.writeFileSync(DB_FILE, buf);
  console.log(`Done. ${tasks.length} tasks written to ${DB_FILE}`);
  console.log(`Original JSON kept at ${JSON_FILE} — delete it manually when satisfied.`);
}

migrate().catch(err => { console.error('Migration failed:', err); process.exit(1); });
