const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const jwksClient = require('jwks-rsa');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3010;
const DATA_FILE = process.env.DATA_FILE || '/data/tasks.json';
const AUTHENTIK_URL = process.env.AUTHENTIK_URL; // public URL — used for issuer claim validation
const AUTHENTIK_INTERNAL_URL = process.env.AUTHENTIK_INTERNAL_URL || AUTHENTIK_URL; // internal — used for JWKS fetch
const OIDC_CLIENT_ID = process.env.OIDC_CLIENT_ID;
const FRONTEND_URL = process.env.FRONTEND_URL;

// ── Log config on startup so you can verify values in docker logs ────────────
console.log('=== TaskPilot API starting ===');
console.log('PORT              :', PORT);
console.log('AUTHENTIK_URL     :', AUTHENTIK_URL);
console.log('AUTHENTIK_INTERNAL:', AUTHENTIK_INTERNAL_URL);
console.log('OIDC_CLIENT_ID    :', OIDC_CLIENT_ID);
console.log('FRONTEND_URL      :', FRONTEND_URL);
console.log('JWKS URI          :', `${AUTHENTIK_INTERNAL_URL}/application/o/taskpilot/.well-known/jwks.json`);
console.log('Expected issuer   :', `${AUTHENTIK_URL}/application/o/taskpilot/`);
console.log('==============================');

app.use(cors({
  origin: FRONTEND_URL,
  credentials: true
}));
app.use(express.json());

// ── JWKS client — URI is discovered from OpenID config at startup ────────────
// Authentik's JWKS endpoint is /application/o/<slug>/jwks/
// We discover the exact URI from the .well-known doc to be safe.
let jwks;

async function initJwks() {
  const discoveryUrl = `${AUTHENTIK_INTERNAL_URL}/application/o/taskpilot/.well-known/openid-configuration`;
  console.log('[JWKS] Fetching discovery doc from:', discoveryUrl);
  try {
    const res = await fetch(discoveryUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const doc = await res.json();
    const jwksUri = doc.jwks_uri;
    console.log('[JWKS] Discovered jwks_uri:', jwksUri);
    jwks = jwksClient({
      jwksUri,
      cache: true,
      cacheMaxEntries: 5,
      cacheMaxAge: 600000
    });
  } catch (err) {
    console.error('[JWKS] Discovery failed:', err.message);
    // Fall back to the conventional Authentik path
    const fallback = `${AUTHENTIK_INTERNAL_URL}/application/o/taskpilot/jwks/`;
    console.warn('[JWKS] Falling back to:', fallback);
    jwks = jwksClient({
      jwksUri: fallback,
      cache: true,
      cacheMaxEntries: 5,
      cacheMaxAge: 600000
    });
  }
}

function getSigningKey(header, callback) {
  if (!jwks) return callback(new Error('JWKS client not initialised yet'));
  jwks.getSigningKey(header.kid, (err, key) => {
    if (err) {
      console.error('[JWKS] Failed to get signing key:', err.message);
      return callback(err);
    }
    callback(null, key.getPublicKey());
  });
}

// ── Auth middleware ──────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.warn('[AUTH] Request missing Bearer token:', req.method, req.path);
    return res.status(401).json({ error: 'Missing token' });
  }
  const token = authHeader.slice(7);

  // Decode without verifying first, just to log what we received
  const unverified = jwt.decode(token, { complete: true });
  console.log('[AUTH] Verifying token — iss:', unverified?.payload?.iss, '| aud:', unverified?.payload?.aud, '| kid:', unverified?.header?.kid);

  jwt.verify(token, getSigningKey, {
    audience: OIDC_CLIENT_ID,
    issuer: `${AUTHENTIK_URL}/application/o/taskpilot/`,
    algorithms: ['RS256']
  }, (err, decoded) => {
    if (err) {
      console.error('[AUTH] Token verification failed:', err.name, '-', err.message);
      return res.status(401).json({ error: 'Invalid token', detail: err.message });
    }
    req.user = {
      sub: decoded.sub,
      username: decoded.preferred_username || decoded.email || decoded.sub,
      name: decoded.name || decoded.preferred_username || 'Unknown'
    };
    console.log('[AUTH] Verified user:', req.user.username);
    next();
  });
}

// ── Data helpers ─────────────────────────────────────────────────────────────
function ensureDataFile() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify([]));
}
function readTasks() {
  ensureDataFile();
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}
function writeTasks(tasks) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(tasks, null, 2));
}

// ── Routes ───────────────────────────────────────────────────────────────────

// GET /tasks
app.get('/tasks', requireAuth, (req, res) => {
  res.json(readTasks());
});

// POST /tasks
app.post('/tasks', requireAuth, (req, res) => {
  const { name, description, estimatedDuration, priority, dueDate } = req.body;
  if (!name || !estimatedDuration || !priority)
    return res.status(400).json({ error: 'name, estimatedDuration, and priority are required' });
  if (priority < 1 || priority > 4)
    return res.status(400).json({ error: 'priority must be between 1 and 4' });

  const task = {
    id: uuidv4(),
    name,
    description: description || '',
    estimatedDuration: Number(estimatedDuration),
    priority: Number(priority),
    dueDate: dueDate || null,
    dateAdded: new Date().toISOString(),
    status: 'open',
    createdBy: req.user.username,
    createdByName: req.user.name,
    closedBy: null,
    closedByName: null,
    closedAt: null
  };
  const tasks = readTasks();
  tasks.push(task);
  writeTasks(tasks);
  res.status(201).json(task);
});

// PUT /tasks/:id
app.put('/tasks/:id', requireAuth, (req, res) => {
  const tasks = readTasks();
  const idx = tasks.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Task not found' });

  const task = tasks[idx];
  const { name, description, estimatedDuration, priority, dueDate, status } = req.body;

  if (name !== undefined) task.name = name;
  if (description !== undefined) task.description = description;
  if (estimatedDuration !== undefined) task.estimatedDuration = Number(estimatedDuration);
  if (priority !== undefined) {
    if (priority < 1 || priority > 4)
      return res.status(400).json({ error: 'priority must be between 1 and 4' });
    task.priority = Number(priority);
  }
  if (dueDate !== undefined) task.dueDate = dueDate || null;
  if (status !== undefined) {
    // Record who closed it
    if (status === 'closed' && task.status !== 'closed') {
      task.closedBy = req.user.username;
      task.closedByName = req.user.name;
      task.closedAt = new Date().toISOString();
    }
    if (status === 'open') {
      task.closedBy = null;
      task.closedByName = null;
      task.closedAt = null;
    }
    task.status = status;
  }

  tasks[idx] = task;
  writeTasks(tasks);
  res.json(task);
});

// DELETE /tasks/:id
app.delete('/tasks/:id', requireAuth, (req, res) => {
  const tasks = readTasks();
  const idx = tasks.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Task not found' });
  tasks.splice(idx, 1);
  writeTasks(tasks);
  res.json({ success: true });
});

// POST /tasks/suggest
app.post('/tasks/suggest', requireAuth, (req, res) => {
  const { availableMinutes, excludeIds = [] } = req.body;
  if (!availableMinutes || availableMinutes <= 0)
    return res.status(400).json({ error: 'availableMinutes must be a positive number' });

  const tasks = readTasks();
  const now = new Date();

  const candidates = tasks.filter(t =>
    t.status === 'open' &&
    t.estimatedDuration <= availableMinutes &&
    !excludeIds.includes(t.id)
  );

  if (candidates.length === 0) return res.json({ task: null });

  const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;
  function isUrgent(task) {
    if (!task.dueDate) return false;
    return (new Date(task.dueDate) - now) <= ONE_MONTH_MS;
  }

  candidates.sort((a, b) => {
    const urgentA = isUrgent(a);
    const urgentB = isUrgent(b);
    if (urgentA !== urgentB) return urgentA ? -1 : 1;

    if (urgentA && urgentB) {
      const diff = new Date(a.dueDate) - new Date(b.dueDate);
      if (diff !== 0) return diff;
      if (a.priority !== b.priority) return a.priority - b.priority;
      return new Date(a.dateAdded) - new Date(b.dateAdded);
    }

    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.dueDate && !b.dueDate) return -1;
    if (!a.dueDate && b.dueDate) return 1;
    if (a.dueDate && b.dueDate) {
      const diff = new Date(a.dueDate) - new Date(b.dueDate);
      if (diff !== 0) return diff;
    }
    return new Date(a.dateAdded) - new Date(b.dateAdded);
  });

  res.json({ task: candidates[0] });
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ── Boot ─────────────────────────────────────────────────────────────────────
initJwks().then(() => {
  app.listen(PORT, () => console.log(`TaskPilot API running on port ${PORT}`));
}).catch(err => {
  console.error('Fatal: could not initialise JWKS, starting anyway:', err.message);
  app.listen(PORT, () => console.log(`TaskPilot API running on port ${PORT} (JWKS pending)`));
});
