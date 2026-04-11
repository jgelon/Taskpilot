const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const jwksClient = require('jwks-rsa');
const jwt = require('jsonwebtoken');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3010;
const AUTHENTIK_URL = process.env.AUTHENTIK_URL;
const AUTHENTIK_INTERNAL_URL = process.env.AUTHENTIK_INTERNAL_URL || AUTHENTIK_URL;
const OIDC_CLIENT_ID = process.env.OIDC_CLIENT_ID;
const FRONTEND_URL = process.env.FRONTEND_URL;

console.log('=== TaskPilot API starting ===');
console.log('PORT              :', PORT);
console.log('AUTHENTIK_URL     :', AUTHENTIK_URL);
console.log('AUTHENTIK_INTERNAL:', AUTHENTIK_INTERNAL_URL);
console.log('OIDC_CLIENT_ID    :', OIDC_CLIENT_ID);
console.log('FRONTEND_URL      :', FRONTEND_URL);
console.log('==============================');

app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(express.json());

// ── JWKS ─────────────────────────────────────────────────────────────────────
let jwks;

async function initJwks() {
  const discoveryUrl = `${AUTHENTIK_INTERNAL_URL}/application/o/taskpilot/.well-known/openid-configuration`;
  console.log('[JWKS] Fetching discovery doc from:', discoveryUrl);
  try {
    const res = await fetch(discoveryUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const doc = await res.json();
    console.log('[JWKS] Discovered jwks_uri:', doc.jwks_uri);
    jwks = jwksClient({ jwksUri: doc.jwks_uri, cache: true, cacheMaxEntries: 5, cacheMaxAge: 600000 });
  } catch (err) {
    const fallback = `${AUTHENTIK_INTERNAL_URL}/application/o/taskpilot/jwks/`;
    console.warn('[JWKS] Discovery failed:', err.message, '— falling back to', fallback);
    jwks = jwksClient({ jwksUri: fallback, cache: true, cacheMaxEntries: 5, cacheMaxAge: 600000 });
  }
}

function getSigningKey(header, callback) {
  if (!jwks) return callback(new Error('JWKS client not initialised yet'));
  jwks.getSigningKey(header.kid, (err, key) => {
    if (err) { console.error('[JWKS] Failed to get signing key:', err.message); return callback(err); }
    callback(null, key.getPublicKey());
  });
}

// ── Auth ──────────────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    console.warn('[AUTH] Missing token:', req.method, req.path);
    return res.status(401).json({ error: 'Missing token' });
  }
  const token = authHeader.slice(7);
  const unverified = jwt.decode(token, { complete: true });
  console.log('[AUTH] iss:', unverified?.payload?.iss, '| aud:', unverified?.payload?.aud, '| kid:', unverified?.header?.kid);

  jwt.verify(token, getSigningKey, {
    audience: OIDC_CLIENT_ID,
    issuer: `${AUTHENTIK_URL}/application/o/taskpilot/`,
    algorithms: ['RS256']
  }, (err, decoded) => {
    if (err) {
      console.error('[AUTH] Verification failed:', err.name, '-', err.message);
      return res.status(401).json({ error: 'Invalid token', detail: err.message });
    }
    req.user = {
      sub: decoded.sub,
      username: decoded.preferred_username || decoded.email || decoded.sub,
      name: decoded.name || decoded.preferred_username || 'Unknown'
    };
    console.log('[AUTH] Verified:', req.user.username);
    next();
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function rowToTask(row) {
  return {
    ...row,
    estimatedDuration: Number(row.estimatedDuration),
    priority: Number(row.priority),
    recurrenceDays: row.recurrenceDays ? Number(row.recurrenceDays) : null
  };
}

// When a recurring task is closed, create the next occurrence
function scheduleNextRecurrence(task) {
  if (!task.recurring || task.recurring === 'none') return;
  const days = task.recurrenceDays || { daily: 1, weekly: 7, monthly: 30 }[task.recurring] || 7;
  const base = task.dueDate ? new Date(task.dueDate) : new Date();
  base.setDate(base.getDate() + days);
  const nextDue = base.toISOString().substring(0, 10);
  const newId = uuidv4();
  db.run(
    `INSERT INTO tasks (id,name,description,estimatedDuration,priority,dueDate,dateAdded,status,createdBy,createdByName,recurring,recurrenceDays)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [newId, task.name, task.description, task.estimatedDuration, task.priority,
     nextDue, new Date().toISOString(), 'open',
     task.createdBy, task.createdByName, task.recurring, task.recurrenceDays]
  );
  console.log(`[RECUR] Scheduled next occurrence of "${task.name}" for ${nextDue}`);
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /tasks?status=open&sort=priority&order=asc
app.get('/tasks', requireAuth, (req, res) => {
  const { status, sort = 'dateAdded', order = 'desc' } = req.query;

  const allowed = { dateAdded: 'dateAdded', priority: 'priority', dueDate: 'dueDate', name: 'name', estimatedDuration: 'estimatedDuration' };
  const col = allowed[sort] || 'dateAdded';
  const dir = order === 'asc' ? 'ASC' : 'DESC';

  let sql = `SELECT * FROM tasks`;
  const params = [];
  if (status && status !== 'all') {
    sql += ` WHERE status = ?`;
    params.push(status);
  }
  // NULLs last for dueDate sort
  if (col === 'dueDate') {
    sql += ` ORDER BY CASE WHEN dueDate IS NULL THEN 1 ELSE 0 END, ${col} ${dir}`;
  } else {
    sql += ` ORDER BY ${col} ${dir}`;
  }

  res.json(db.all(sql, params).map(rowToTask));
});

// POST /tasks
app.post('/tasks', requireAuth, (req, res) => {
  const { name, description, estimatedDuration, priority, dueDate, recurring, recurrenceDays } = req.body;
  if (!name || !estimatedDuration || !priority)
    return res.status(400).json({ error: 'name, estimatedDuration, and priority are required' });
  if (priority < 1 || priority > 4)
    return res.status(400).json({ error: 'priority must be between 1 and 4' });

  const id = uuidv4();
  db.run(
    `INSERT INTO tasks (id,name,description,estimatedDuration,priority,dueDate,dateAdded,status,createdBy,createdByName,recurring,recurrenceDays)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, name, description || '', Number(estimatedDuration), Number(priority),
     dueDate || null, new Date().toISOString(), 'open',
     req.user.username, req.user.name,
     recurring || 'none', recurrenceDays || null]
  );
  res.status(201).json(rowToTask(db.get('SELECT * FROM tasks WHERE id = ?', [id])));
});

// PUT /tasks/:id
app.put('/tasks/:id', requireAuth, (req, res) => {
  const existing = db.get('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Task not found' });

  const { name, description, estimatedDuration, priority, dueDate, status, recurring, recurrenceDays } = req.body;

  const updated = {
    name: name ?? existing.name,
    description: description ?? existing.description,
    estimatedDuration: estimatedDuration != null ? Number(estimatedDuration) : Number(existing.estimatedDuration),
    priority: priority != null ? Number(priority) : Number(existing.priority),
    dueDate: dueDate !== undefined ? (dueDate || null) : existing.dueDate,
    status: status ?? existing.status,
    closedBy: existing.closedBy,
    closedByName: existing.closedByName,
    closedAt: existing.closedAt,
    recurring: recurring ?? existing.recurring,
    recurrenceDays: recurrenceDays != null ? Number(recurrenceDays) : existing.recurrenceDays
  };

  if (status === 'closed' && existing.status !== 'closed') {
    updated.closedBy = req.user.username;
    updated.closedByName = req.user.name;
    updated.closedAt = new Date().toISOString();
  }
  if (status === 'open') {
    updated.closedBy = null; updated.closedByName = null; updated.closedAt = null;
  }

  db.run(
    `UPDATE tasks SET name=?,description=?,estimatedDuration=?,priority=?,dueDate=?,status=?,
     closedBy=?,closedByName=?,closedAt=?,recurring=?,recurrenceDays=? WHERE id=?`,
    [updated.name, updated.description, updated.estimatedDuration, updated.priority,
     updated.dueDate, updated.status, updated.closedBy, updated.closedByName, updated.closedAt,
     updated.recurring, updated.recurrenceDays, req.params.id]
  );

  // Trigger recurrence if just closed
  if (status === 'closed' && existing.status !== 'closed') {
    scheduleNextRecurrence({ ...existing, ...updated });
  }

  res.json(rowToTask(db.get('SELECT * FROM tasks WHERE id = ?', [req.params.id])));
});

// DELETE /tasks/:id
app.delete('/tasks/:id', requireAuth, (req, res) => {
  if (!db.get('SELECT id FROM tasks WHERE id = ?', [req.params.id]))
    return res.status(404).json({ error: 'Task not found' });
  db.run('DELETE FROM tasks WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// GET /tasks/stats — overdue count etc.
app.get('/tasks/stats', requireAuth, (req, res) => {
  const now = new Date().toISOString().substring(0, 10);
  const overdue = db.get(
    `SELECT COUNT(*) as count FROM tasks WHERE status='open' AND dueDate IS NOT NULL AND dueDate < ?`, [now]
  );
  const open = db.get(`SELECT COUNT(*) as count FROM tasks WHERE status='open'`);
  res.json({ overdue: Number(overdue.count), open: Number(open.count) });
});

// POST /tasks/suggest
app.post('/tasks/suggest', requireAuth, (req, res) => {
  const { availableMinutes, excludeIds = [] } = req.body;
  if (!availableMinutes || availableMinutes <= 0)
    return res.status(400).json({ error: 'availableMinutes must be a positive number' });

  const candidates = db.all(
    `SELECT * FROM tasks WHERE status='open' AND estimatedDuration <= ?`, [availableMinutes]
  ).map(rowToTask).filter(t => !excludeIds.includes(t.id));

  if (!candidates.length) return res.json({ task: null });

  const now = new Date();
  const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;
  const isUrgent = t => t.dueDate && (new Date(t.dueDate) - now) <= ONE_MONTH_MS;

  candidates.sort((a, b) => {
    const ua = isUrgent(a), ub = isUrgent(b);
    if (ua !== ub) return ua ? -1 : 1;
    if (ua && ub) {
      const d = new Date(a.dueDate) - new Date(b.dueDate);
      if (d) return d;
      if (a.priority !== b.priority) return a.priority - b.priority;
      return new Date(a.dateAdded) - new Date(b.dateAdded);
    }
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.dueDate && !b.dueDate) return -1;
    if (!a.dueDate && b.dueDate) return 1;
    if (a.dueDate && b.dueDate) { const d = new Date(a.dueDate) - new Date(b.dueDate); if (d) return d; }
    return new Date(a.dateAdded) - new Date(b.dateAdded);
  });

  res.json({ task: candidates[0] });
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ── Boot ──────────────────────────────────────────────────────────────────────
async function start() {
  await db.init();
  try { await initJwks(); } catch (e) { console.error('JWKS init failed:', e.message); }
  app.listen(PORT, () => console.log(`TaskPilot API running on port ${PORT}`));
}

start();

// ── CSV Export ────────────────────────────────────────────────────────────────
app.get('/tasks/export', requireAuth, (req, res) => {
  const tasks = db.all('SELECT * FROM tasks ORDER BY dateAdded ASC').map(rowToTask);

  const headers = [
    'id','name','description','estimatedDuration','priority',
    'dueDate','dateAdded','status','createdBy','createdByName',
    'closedBy','closedByName','closedAt','recurring','recurrenceDays'
  ];

  const escape = v => {
    if (v == null) return '';
    const s = String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lines = [
    headers.join(','),
    ...tasks.map(t => headers.map(h => escape(t[h])).join(','))
  ];

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="taskpilot-export-${new Date().toISOString().substring(0,10)}.csv"`);
  res.send(lines.join('\r\n'));
});

// ── CSV Import ────────────────────────────────────────────────────────────────
app.post('/tasks/import', requireAuth, (req, res) => {
  const { csv } = req.body;
  if (!csv) return res.status(400).json({ error: 'No CSV data provided' });

  const lines = csv.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
  if (lines.length < 2) return res.status(400).json({ error: 'CSV must have a header row and at least one data row' });

  // Parse CSV respecting quoted fields
  function parseLine(line) {
    const fields = [];
    let cur = '', inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQuote) {
        if (c === '"' && line[i+1] === '"') { cur += '"'; i++; }
        else if (c === '"') inQuote = false;
        else cur += c;
      } else {
        if (c === '"') inQuote = true;
        else if (c === ',') { fields.push(cur); cur = ''; }
        else cur += c;
      }
    }
    fields.push(cur);
    return fields;
  }

  const headers = parseLine(lines[0]).map(h => h.trim());
  const required = ['name', 'estimatedDuration', 'priority'];
  const missing = required.filter(r => !headers.includes(r));
  if (missing.length) return res.status(400).json({ error: `Missing required columns: ${missing.join(', ')}` });

  let created = 0, updated = 0, skipped = 0;
  const errors = [];

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    try {
      const vals = parseLine(lines[i]);
      const row = {};
      headers.forEach((h, idx) => row[h] = vals[idx]?.trim() ?? '');

      if (!row.name) { skipped++; errors.push(`Row ${i+1}: missing name`); continue; }
      const dur = Number(row.estimatedDuration);
      const pri = Number(row.priority);
      if (!dur || dur < 1) { skipped++; errors.push(`Row ${i+1}: invalid estimatedDuration`); continue; }
      if (!pri || pri < 1 || pri > 4) { skipped++; errors.push(`Row ${i+1}: priority must be 1-4`); continue; }

      const existing = row.id ? db.get('SELECT id FROM tasks WHERE id = ?', [row.id]) : null;

      if (existing) {
        db.run(
          `UPDATE tasks SET name=?,description=?,estimatedDuration=?,priority=?,dueDate=?,
           status=?,createdBy=?,createdByName=?,closedBy=?,closedByName=?,closedAt=?,
           recurring=?,recurrenceDays=? WHERE id=?`,
          [row.name, row.description||'', dur, pri,
           row.dueDate||null, row.status||'open',
           row.createdBy||null, row.createdByName||null,
           row.closedBy||null, row.closedByName||null, row.closedAt||null,
           row.recurring||'none', row.recurrenceDays ? Number(row.recurrenceDays) : null,
           row.id]
        );
        updated++;
      } else {
        db.run(
          `INSERT INTO tasks (id,name,description,estimatedDuration,priority,dueDate,dateAdded,
           status,createdBy,createdByName,closedBy,closedByName,closedAt,recurring,recurrenceDays)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [row.id || uuidv4(), row.name, row.description||'', dur, pri,
           row.dueDate||null, row.dateAdded || new Date().toISOString(), row.status||'open',
           row.createdBy || req.user.username, row.createdByName || req.user.name,
           row.closedBy||null, row.closedByName||null, row.closedAt||null,
           row.recurring||'none', row.recurrenceDays ? Number(row.recurrenceDays) : null]
        );
        created++;
      }
    } catch (err) {
      skipped++;
      errors.push(`Row ${i+1}: ${err.message}`);
    }
  }

  res.json({ created, updated, skipped, errors });
});
