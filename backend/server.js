const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const jwksClient = require('jwks-rsa');
const jwt = require('jsonwebtoken');
const webpush = require('web-push');
const db = require('./db');
const gamification = require('./gamification');

const app = express();
const PORT = process.env.PORT || 3010;
const AUTHENTIK_URL = process.env.AUTHENTIK_URL;
const AUTHENTIK_INTERNAL_URL = process.env.AUTHENTIK_INTERNAL_URL || AUTHENTIK_URL;
const OIDC_CLIENT_ID = process.env.OIDC_CLIENT_ID;
const FRONTEND_URL = process.env.FRONTEND_URL;
const ADMIN_GROUP = process.env.ADMIN_GROUP || 'taskpilot-admin';
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_EMAIL = process.env.VAPID_EMAIL || 'mailto:admin@taskpilot.local';

// Feature flags now stored in DB (seeded from env vars on first boot)
// Read dynamically per request via db.getFeatures()

// ── VAPID setup for web push ──────────────────────────────────────────────────
function initWebPush() {
  if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    console.log('[Push] VAPID configured');
  } else {
    console.warn('[Push] VAPID keys not set — push notifications disabled');
  }
}

console.log('=== TaskPilot API starting ===');
console.log('PORT              :', PORT);
console.log('AUTHENTIK_URL     :', AUTHENTIK_URL);
console.log('AUTHENTIK_INTERNAL:', AUTHENTIK_INTERNAL_URL);
console.log('OIDC_CLIENT_ID    :', OIDC_CLIENT_ID);
console.log('FRONTEND_URL      :', FRONTEND_URL);
console.log('ADMIN_GROUP       :', ADMIN_GROUP);
console.log('(features loaded from DB at runtime)');
console.log('==============================');

app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(express.json());
app.use(apiKeyAuth); // Check for API key on every request before OIDC

// ── JWKS ──────────────────────────────────────────────────────────────────────
let jwks;
async function initJwks() {
  const url = `${AUTHENTIK_INTERNAL_URL}/application/o/taskpilot/.well-known/openid-configuration`;
  console.log('[JWKS] Fetching discovery doc from:', url);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
  if (!jwks) return callback(new Error('JWKS not ready'));
  jwks.getSigningKey(header.kid, (err, key) => {
    if (err) { console.error('[JWKS] Key error:', err.message); return callback(err); }
    callback(null, key.getPublicKey());
  });
}

// ── Auth ──────────────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) {
    console.warn('[AUTH] Missing token:', req.method, req.path);
    return res.status(401).json({ error: 'Missing token' });
  }
  const token = h.slice(7);
  const u = jwt.decode(token, { complete: true });
  console.log('[AUTH] iss:', u?.payload?.iss, '| aud:', u?.payload?.aud, '| kid:', u?.header?.kid);
  jwt.verify(token, getSigningKey, {
    audience: OIDC_CLIENT_ID,
    issuer: `${AUTHENTIK_URL}/application/o/taskpilot/`,
    algorithms: ['RS256']
  }, (err, decoded) => {
    if (err) {
      console.error('[AUTH] Failed:', err.name, '-', err.message);
      return res.status(401).json({ error: 'Invalid token', detail: err.message });
    }
    const groups = Array.isArray(decoded.groups) ? decoded.groups : [];
    req.user = {
      sub: decoded.sub,
      username: decoded.preferred_username || decoded.email || decoded.sub,
      name: decoded.name || decoded.preferred_username || 'Unknown',
      groups,
      isAdmin: groups.includes(ADMIN_GROUP)
    };
    console.log('[AUTH] Verified:', req.user.username, '| groups:', groups.join(', ') || 'none', '| admin:', req.user.isAdmin);
    next();
  });
}

// Only members of ADMIN_GROUP may proceed
function requireAdmin(req, res, next) {
  if (!req.user?.isAdmin) {
    console.warn('[AUTH] Admin required, denied for:', req.user?.username);
    return res.status(403).json({ error: 'Forbidden', detail: `Requires membership of the '${ADMIN_GROUP}' group` });
  }
  next();
}

// ── API key middleware (for service accounts like Home Assistant) ─────────────
function apiKeyAuth(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key) return next(); // No key provided — fall through to OIDC auth
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  const row = db.get('SELECT * FROM api_keys WHERE key_hash=?', [hash]);
  if (!row) return res.status(401).json({ error: 'Invalid API key' });
  // Update last used timestamp (fire-and-forget)
  db.run('UPDATE api_keys SET lastUsedAt=? WHERE id=?', [new Date().toISOString(), row.id]);
  req.user = { sub: 'apikey', username: `apikey:${row.name}`, name: row.name, groups: [], isAdmin: false };
  req.isApiKey = true;
  next();
}

// Routes that allow either OIDC or API key
function requireAuthOrKey(req, res, next) {
  if (req.isApiKey) return next(); // Already authenticated via API key
  requireAuth(req, res, next);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function rowToTask(row) {
  return {
    ...row,
    estimatedDuration: Number(row.estimatedDuration),
    priority: Number(row.priority),
    recurrenceDays: row.recurrenceDays ? Number(row.recurrenceDays) : null,
    categoryId: row.categoryId || null,
    claimedBy: row.claimedBy || null,
    claimedByName: row.claimedByName || null,
    claimedAt: row.claimedAt || null,
    assignedTo: row.assignedTo || null,
    assignedToName: row.assignedToName || null,
  };
}

function scheduleNextRecurrence(task) {
  if (!task.recurring || task.recurring === 'none') return;

  // 'soon' — recreate immediately with no due date
  if (task.recurring === 'soon') {
    db.run(
      `INSERT INTO tasks (id,name,description,estimatedDuration,priority,dueDate,dateAdded,status,
        createdBy,createdByName,recurring,recurrenceDays,categoryId,assignedTo,assignedToName)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [uuidv4(), task.name, task.description, task.estimatedDuration, task.priority,
       null, new Date().toISOString(), 'open',
       task.createdBy, task.createdByName, task.recurring, null,
       task.categoryId || null, task.assignedTo || null, task.assignedToName || null]
    );
    console.log(`[RECUR] Recreated "${task.name}" immediately (soon)`);
    return;
  }
  const days = task.recurrenceDays || { daily: 1, weekly: 7, monthly: 30 }[task.recurring] || 7;
  const base = task.dueDate ? new Date(task.dueDate) : new Date();
  base.setDate(base.getDate() + days);
  const nextDue = base.toISOString().substring(0, 10);
  db.run(
    `INSERT INTO tasks (id,name,description,estimatedDuration,priority,dueDate,dateAdded,status,
      createdBy,createdByName,recurring,recurrenceDays,categoryId,assignedTo,assignedToName)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [uuidv4(), task.name, task.description, task.estimatedDuration, task.priority,
     nextDue, new Date().toISOString(), 'open',
     task.createdBy, task.createdByName, task.recurring, task.recurrenceDays,
     task.categoryId || null, task.assignedTo || null, task.assignedToName || null]
  );
  console.log(`[RECUR] Scheduled next "${task.name}" for ${nextDue}`);
}

// ── User info ─────────────────────────────────────────────────────────────────
app.get('/me', requireAuth, (req, res) => {
  res.json({
    username: req.user.username,
    name: req.user.name,
    groups: req.user.groups,
    isAdmin: req.user.isAdmin,
    features: db.getFeatures()
  });
});

// ── Category Routes (GET: all users; mutate: admin only) ──────────────────────
app.get('/categories', requireAuth, (req, res) => {
  res.json(db.all('SELECT * FROM categories ORDER BY name ASC'));
});

app.post('/categories', requireAuth, requireAdmin, (req, res) => {
  const { name, color } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  const id = uuidv4();
  try {
    db.run('INSERT INTO categories (id, name, color) VALUES (?, ?, ?)',
      [id, name.trim(), color || '#7b61ff']);
    res.status(201).json(db.get('SELECT * FROM categories WHERE id = ?', [id]));
  } catch (e) {
    res.status(409).json({ error: 'Category name already exists' });
  }
});

app.put('/categories/:id', requireAuth, requireAdmin, (req, res) => {
  const cat = db.get('SELECT * FROM categories WHERE id = ?', [req.params.id]);
  if (!cat) return res.status(404).json({ error: 'Category not found' });
  const { name, color } = req.body;
  try {
    db.run('UPDATE categories SET name = ?, color = ? WHERE id = ?',
      [name?.trim() || cat.name, color || cat.color, req.params.id]);
    res.json(db.get('SELECT * FROM categories WHERE id = ?', [req.params.id]));
  } catch (e) {
    res.status(409).json({ error: 'Category name already exists' });
  }
});

app.delete('/categories/:id', requireAuth, requireAdmin, (req, res) => {
  if (!db.get('SELECT id FROM categories WHERE id = ?', [req.params.id]))
    return res.status(404).json({ error: 'Category not found' });
  db.run('DELETE FROM categories WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// ── Task Routes ───────────────────────────────────────────────────────────────
app.get('/tasks', requireAuth, (req, res) => {
  const { status, sort = 'dateAdded', order = 'desc', categoryId } = req.query;
  const allowed = { dateAdded:'dateAdded', priority:'priority', dueDate:'dueDate', name:'name', estimatedDuration:'estimatedDuration' };
  const col = allowed[sort] || 'dateAdded';
  const dir = order === 'asc' ? 'ASC' : 'DESC';

  const conditions = [];
  const params = [];
  if (status && status !== 'all') { conditions.push('t.status = ?'); params.push(status); }
  if (categoryId === 'none') { conditions.push('t.categoryId IS NULL'); }
  else if (categoryId) { conditions.push('t.categoryId = ?'); params.push(categoryId); }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const orderClause = col === 'dueDate'
    ? `ORDER BY CASE WHEN t.dueDate IS NULL THEN 1 ELSE 0 END, t.${col} ${dir}`
    : `ORDER BY t.${col} ${dir}`;

  const rows = db.all(
    `SELECT t.*, c.name as categoryName, c.color as categoryColor
     FROM tasks t LEFT JOIN categories c ON t.categoryId = c.id
     ${where} ${orderClause}`,
    params
  );
  res.json(rows.map(rowToTask));
});

app.post('/tasks', requireAuth, (req, res) => {
  const { name, description, estimatedDuration, priority, dueDate, recurring, recurrenceDays, categoryId, assignedTo, assignedToName } = req.body;
  if (!name || !estimatedDuration || !priority)
    return res.status(400).json({ error: 'name, estimatedDuration, and priority are required' });
  if (priority < 1 || priority > 4)
    return res.status(400).json({ error: 'priority must be between 1 and 4' });
  const id = uuidv4();
  db.run(
    `INSERT INTO tasks (id,name,description,estimatedDuration,priority,dueDate,dateAdded,status,
      createdBy,createdByName,recurring,recurrenceDays,categoryId,assignedTo,assignedToName)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, name, description||'', Number(estimatedDuration), Number(priority),
     dueDate||null, new Date().toISOString(), 'open',
     req.user.username, req.user.name,
     recurring||'none', recurrenceDays||null, categoryId||null,
     assignedTo||null, assignedToName||null]
  );
  const row = db.get(
    `SELECT t.*, c.name as categoryName, c.color as categoryColor
     FROM tasks t LEFT JOIN categories c ON t.categoryId = c.id WHERE t.id = ?`, [id]
  );
  res.status(201).json(rowToTask(row));
});

app.put('/tasks/:id', requireAuth, (req, res) => {
  const existing = db.get('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Task not found' });
  const { name, description, estimatedDuration, priority, dueDate, status, recurring, recurrenceDays, categoryId, claim, assignedTo, assignedToName } = req.body;
  const u = {
    name: name ?? existing.name,
    description: description ?? existing.description,
    estimatedDuration: estimatedDuration != null ? Number(estimatedDuration) : Number(existing.estimatedDuration),
    priority: priority != null ? Number(priority) : Number(existing.priority),
    dueDate: dueDate !== undefined ? (dueDate||null) : existing.dueDate,
    status: status ?? existing.status,
    closedBy: existing.closedBy, closedByName: existing.closedByName, closedAt: existing.closedAt,
    recurring: recurring ?? existing.recurring,
    recurrenceDays: recurrenceDays != null ? Number(recurrenceDays) : existing.recurrenceDays,
    categoryId: categoryId !== undefined ? (categoryId||null) : existing.categoryId,
    claimedBy: existing.claimedBy, claimedByName: existing.claimedByName, claimedAt: existing.claimedAt,
    assignedTo: assignedTo !== undefined ? (assignedTo||null) : existing.assignedTo,
    assignedToName: assignedToName !== undefined ? (assignedToName||null) : existing.assignedToName,
  };

  // Claim task
  if (claim === true) {
    u.claimedBy = req.user.username;
    u.claimedByName = req.user.name;
    u.claimedAt = new Date().toISOString();
  }
  // Unclaim task (hand back)
  if (claim === false) {
    u.claimedBy = null; u.claimedByName = null; u.claimedAt = null;
  }
  // Closing always unsets claim
  if (status === 'closed' && existing.status !== 'closed') {
    u.closedBy = req.user.username; u.closedByName = req.user.name; u.closedAt = new Date().toISOString();
    u.claimedBy = null; u.claimedByName = null; u.claimedAt = null;
  }
  if (status === 'open' && existing.status === 'closed') {
    u.closedBy = null; u.closedByName = null; u.closedAt = null;
  }

  db.run(
    `UPDATE tasks SET name=?,description=?,estimatedDuration=?,priority=?,dueDate=?,status=?,
      closedBy=?,closedByName=?,closedAt=?,recurring=?,recurrenceDays=?,categoryId=?,
      claimedBy=?,claimedByName=?,claimedAt=?,assignedTo=?,assignedToName=? WHERE id=?`,
    [u.name,u.description,u.estimatedDuration,u.priority,u.dueDate,u.status,
     u.closedBy,u.closedByName,u.closedAt,u.recurring,u.recurrenceDays,u.categoryId,
     u.claimedBy,u.claimedByName,u.claimedAt,u.assignedTo,u.assignedToName,req.params.id]
  );

  if (status === 'closed' && existing.status !== 'closed') {
    scheduleNextRecurrence({ ...existing, ...u });
    // Always calculate points (stored), only return if features enabled
    const result = gamification.processTaskClose({ ...existing, ...u }, req.user);
    const row2 = db.get(
      `SELECT t.*, c.name as categoryName, c.color as categoryColor
       FROM tasks t LEFT JOIN categories c ON t.categoryId = c.id WHERE t.id = ?`, [req.params.id]
    );
    return res.json({ ...rowToTask(row2), _gamification: result });
  }

  const row = db.get(
    `SELECT t.*, c.name as categoryName, c.color as categoryColor
     FROM tasks t LEFT JOIN categories c ON t.categoryId = c.id WHERE t.id = ?`, [req.params.id]
  );
  res.json(rowToTask(row));
});

app.delete('/tasks/:id', requireAuth, (req, res) => {
  if (!db.get('SELECT id FROM tasks WHERE id = ?', [req.params.id]))
    return res.status(404).json({ error: 'Task not found' });
  db.run('DELETE FROM tasks WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

app.get('/tasks/stats', requireAuthOrKey, (req, res) => {
  const now = new Date().toISOString().substring(0, 10);
  const overdue = db.get(`SELECT COUNT(*) as count FROM tasks WHERE status='open' AND dueDate IS NOT NULL AND dueDate < ?`, [now]);
  const open = db.get(`SELECT COUNT(*) as count FROM tasks WHERE status='open'`);

  // Active task claimed by the current user
  const claimed = db.get(
    `SELECT t.*, c.name as categoryName, c.color as categoryColor
     FROM tasks t LEFT JOIN categories c ON t.categoryId = c.id
     WHERE t.status='open' AND t.claimedBy = ?`,
    [req.user.username]
  );

  res.json({
    overdue: Number(overdue.count),
    open: Number(open.count),
    claimedTask: claimed ? rowToTask(claimed) : null
  });
});

app.post('/tasks/suggest', requireAuth, (req, res) => {
  const { availableMinutes, excludeIds = [] } = req.body;
  if (!availableMinutes || availableMinutes <= 0)
    return res.status(400).json({ error: 'availableMinutes must be positive' });
  const candidates = db.all(
    `SELECT t.*, c.name as categoryName, c.color as categoryColor
     FROM tasks t LEFT JOIN categories c ON t.categoryId = c.id
     WHERE t.status='open' AND t.estimatedDuration <= ?
       AND (t.claimedBy IS NULL OR t.claimedBy = ?)
       AND (t.assignedTo IS NULL OR t.assignedTo = ?)`,
    [availableMinutes, req.user.username, req.user.username]
  ).map(rowToTask).filter(t => !excludeIds.includes(t.id));
  if (!candidates.length) return res.json({ task: null });
  const now = new Date();
  const ONE_MONTH = 30 * 24 * 60 * 60 * 1000;
  const urgent = t => t.dueDate && (new Date(t.dueDate) - now) <= ONE_MONTH;
  candidates.sort((a, b) => {
    const ua = urgent(a), ub = urgent(b);
    if (ua !== ub) return ua ? -1 : 1;
    if (ua && ub) {
      const d = new Date(a.dueDate) - new Date(b.dueDate); if (d) return d;
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

// ── CSV Export (admin only) ───────────────────────────────────────────────────
app.get('/tasks/export', requireAuth, requireAdmin, (req, res) => {
  const tasks = db.all(
    `SELECT t.*, c.name as categoryName FROM tasks t LEFT JOIN categories c ON t.categoryId = c.id ORDER BY t.dateAdded ASC`
  ).map(rowToTask);
  const headers = ['id','name','description','estimatedDuration','priority','dueDate','dateAdded',
    'status','createdBy','createdByName','closedBy','closedByName','closedAt','recurring',
    'recurrenceDays','categoryId','categoryName'];
  const esc = v => {
    if (v == null) return '';
    const s = String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g,'""')}"` : s;
  };
  const lines = [headers.join(','), ...tasks.map(t => headers.map(h => esc(t[h])).join(','))];
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="taskpilot-export-${new Date().toISOString().substring(0,10)}.csv"`);
  res.send(lines.join('\r\n'));
});

// ── CSV Import (admin only) ───────────────────────────────────────────────────
app.post('/tasks/import', requireAuth, requireAdmin, (req, res) => {
  const { csv } = req.body;
  if (!csv) return res.status(400).json({ error: 'No CSV data provided' });
  const lines = csv.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n').filter(l => l.trim());
  if (lines.length < 2) return res.status(400).json({ error: 'CSV must have header + at least one row' });
  function parseLine(line) {
    const fields = []; let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) { if (c==='"' && line[i+1]==='"') { cur+='"'; i++; } else if (c==='"') inQ=false; else cur+=c; }
      else { if (c==='"') inQ=true; else if (c===',') { fields.push(cur); cur=''; } else cur+=c; }
    }
    fields.push(cur); return fields;
  }
  const headers = parseLine(lines[0]).map(h => h.trim());
  const missing = ['name','estimatedDuration','priority'].filter(r => !headers.includes(r));
  if (missing.length) return res.status(400).json({ error: `Missing required columns: ${missing.join(', ')}` });
  let created=0, updated=0, skipped=0; const errors=[];
  for (let i=1; i<lines.length; i++) {
    if (!lines[i].trim()) continue;
    try {
      const vals = parseLine(lines[i]);
      const row = {}; headers.forEach((h,idx) => row[h] = vals[idx]?.trim() ?? '');
      if (!row.name) { skipped++; errors.push(`Row ${i+1}: missing name`); continue; }
      const dur = Number(row.estimatedDuration), pri = Number(row.priority);
      if (!dur || dur<1) { skipped++; errors.push(`Row ${i+1}: invalid estimatedDuration`); continue; }
      if (!pri || pri<1 || pri>4) { skipped++; errors.push(`Row ${i+1}: priority must be 1-4`); continue; }
      const catId = row.categoryId && db.get('SELECT id FROM categories WHERE id=?',[row.categoryId]) ? row.categoryId : null;
      const existing = row.id ? db.get('SELECT id FROM tasks WHERE id=?',[row.id]) : null;
      if (existing) {
        db.run(`UPDATE tasks SET name=?,description=?,estimatedDuration=?,priority=?,dueDate=?,
          status=?,createdBy=?,createdByName=?,closedBy=?,closedByName=?,closedAt=?,
          recurring=?,recurrenceDays=?,categoryId=? WHERE id=?`,
          [row.name,row.description||'',dur,pri,row.dueDate||null,row.status||'open',
           row.createdBy||null,row.createdByName||null,row.closedBy||null,row.closedByName||null,
           row.closedAt||null,row.recurring||'none',row.recurrenceDays?Number(row.recurrenceDays):null,
           catId,row.id]);
        updated++;
      } else {
        db.run(`INSERT INTO tasks (id,name,description,estimatedDuration,priority,dueDate,dateAdded,
          status,createdBy,createdByName,closedBy,closedByName,closedAt,recurring,recurrenceDays,categoryId)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [row.id||uuidv4(),row.name,row.description||'',dur,pri,row.dueDate||null,
           row.dateAdded||new Date().toISOString(),row.status||'open',
           row.createdBy||req.user.username,row.createdByName||req.user.name,
           row.closedBy||null,row.closedByName||null,row.closedAt||null,
           row.recurring||'none',row.recurrenceDays?Number(row.recurrenceDays):null,catId]);
        created++;
      }
    } catch(err) { skipped++; errors.push(`Row ${i+1}: ${err.message}`); }
  }
  res.json({ created, updated, skipped, errors });
});

// ── API Key Management (admin only) ──────────────────────────────────────────
app.get('/apikeys', requireAuth, requireAdmin, (req, res) => {
  const keys = db.all('SELECT id, name, key_prefix, createdAt, lastUsedAt FROM api_keys ORDER BY createdAt DESC');
  res.json(keys);
});

app.post('/apikeys', requireAuth, requireAdmin, (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  // Generate a secure random key with a recognisable prefix
  const rawKey = `tp_${crypto.randomBytes(32).toString('hex')}`;
  const hash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const prefix = rawKey.substring(0, 10);
  const id = uuidv4();
  db.run(
    'INSERT INTO api_keys (id, name, key_hash, key_prefix, createdAt) VALUES (?,?,?,?,?)',
    [id, name.trim(), hash, prefix, new Date().toISOString()]
  );
  // Return the raw key ONCE — it cannot be retrieved again
  res.status(201).json({ id, name: name.trim(), key: rawKey, key_prefix: prefix, createdAt: new Date().toISOString() });
});

app.delete('/apikeys/:id', requireAuth, requireAdmin, (req, res) => {
  if (!db.get('SELECT id FROM api_keys WHERE id=?', [req.params.id]))
    return res.status(404).json({ error: 'API key not found' });
  db.run('DELETE FROM api_keys WHERE id=?', [req.params.id]);
  res.json({ success: true });
});

// ── Users (for assignment dropdown) ──────────────────────────────────────────
app.get('/users', requireAuth, (req, res) => {
  // Return all users who have ever interacted with the system
  const rows = db.all(`
    SELECT username, displayName as name FROM user_stats
    UNION
    SELECT createdBy as username, createdByName as name FROM tasks WHERE createdBy IS NOT NULL
    GROUP BY username
    ORDER BY name ASC
  `);
  // Deduplicate
  const seen = new Set();
  const users = rows.filter(r => {
    if (!r.username || seen.has(r.username)) return false;
    seen.add(r.username);
    return true;
  });
  res.json(users);
});

// ── Push Notification Routes ──────────────────────────────────────────────────
app.get('/push/vapid-public-key', requireAuth, (req, res) => {
  if (!VAPID_PUBLIC_KEY) return res.status(503).json({ error: 'Push not configured' });
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

app.post('/push/subscribe', requireAuth, (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint || !keys?.p256dh || !keys?.auth)
    return res.status(400).json({ error: 'Invalid subscription object' });
  try {
    db.run(
      `INSERT OR REPLACE INTO push_subscriptions (id, username, endpoint, p256dh, auth, createdAt)
       VALUES (COALESCE((SELECT id FROM push_subscriptions WHERE endpoint=?), ?), ?,?,?,?,?)`,
      [endpoint, uuidv4(), req.user.username, endpoint, keys.p256dh, keys.auth, new Date().toISOString()]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to save subscription' });
  }
});

app.post('/push/unsubscribe', requireAuth, (req, res) => {
  const { endpoint } = req.body;
  if (endpoint) db.run('DELETE FROM push_subscriptions WHERE endpoint=?', [endpoint]);
  res.json({ success: true });
});

// ── Push notification sender (called on interval) ─────────────────────────────
async function sendOverdueNotifications() {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;
  if (!db.getFeatures().pushNotifications) return;

  const today = new Date().toISOString().substring(0, 10);
  const overdueTasks = db.all(
    `SELECT t.*, u.username as assignedUsername
     FROM tasks t
     LEFT JOIN (SELECT DISTINCT username FROM push_subscriptions) u
       ON t.assignedTo = u.username OR t.assignedTo IS NULL
     WHERE t.status='open' AND t.dueDate IS NOT NULL AND t.dueDate < ?
     LIMIT 50`, [today]
  );

  if (overdueTasks.length === 0) return;

  // Group: per-user subscriptions
  const subs = db.all('SELECT * FROM push_subscriptions');
  if (subs.length === 0) return;

  const overdueCounts = {};
  for (const task of overdueTasks) {
    // Notify assigned user if set, otherwise all subscribers
    const targets = task.assignedTo ? [task.assignedTo] : subs.map(s => s.username);
    for (const u of targets) {
      overdueCounts[u] = (overdueCounts[u] || 0) + 1;
    }
  }

  for (const sub of subs) {
    const count = overdueCounts[sub.username];
    if (!count) continue;
    const payload = JSON.stringify({
      title: 'TaskPilot ⚠️',
      body: `You have ${count} overdue task${count > 1 ? 's' : ''}`,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: 'taskpilot-overdue',
      renotify: false,
      data: { url: '/' }
    });
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        // Subscription expired — remove it
        db.run('DELETE FROM push_subscriptions WHERE endpoint=?', [sub.endpoint]);
        console.log('[Push] Removed expired subscription for', sub.username);
      } else {
        console.error('[Push] Failed to send to', sub.username, err.message);
      }
    }
  }
}

// ── Gamification Routes ───────────────────────────────────────────────────────
app.get('/gamification/me', requireAuth, (req, res) => {
  const stats = gamification.getUserStats(req.user.username);
  res.json({ stats, features: db.getFeatures(), allAchievements: gamification.getAllAchievements() });
});

app.get('/gamification/leaderboard', requireAuth, (req, res) => {
  if (!db.getFeatures().leaderboard) return res.status(403).json({ error: 'Feature disabled' });
  res.json(gamification.getLeaderboard());
});

// ── App settings routes (admin only) ─────────────────────────────────────────
app.get('/settings/features', requireAuth, requireAdmin, (req, res) => {
  res.json(db.getFeatures());
});

app.put('/settings/features', requireAuth, requireAdmin, (req, res) => {
  const allowed = ['points', 'streaks', 'achievements', 'leaderboard'];
  for (const key of allowed) {
    if (key in req.body) {
      db.setSetting(`feature_${key}`, req.body[key] ? 'true' : 'false');
    }
  }
  res.json(db.getFeatures());
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

async function start() {
  await db.init();
  try { await initJwks(); } catch(e) { console.error('JWKS init failed:', e.message); }
  initWebPush();
  // Send overdue push notifications once per hour
  setInterval(sendOverdueNotifications, 60 * 60 * 1000);
  // Also check shortly after startup
  setTimeout(sendOverdueNotifications, 30000);
  app.listen(PORT, () => console.log(`TaskPilot API running on port ${PORT}`));
}
start();
