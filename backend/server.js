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
const AUTHENTIK_URL = process.env.AUTHENTIK_URL; // e.g. https://auth.juse.nl
const OIDC_CLIENT_ID = process.env.OIDC_CLIENT_ID;

app.use(cors({
  origin: process.env.FRONTEND_URL || 'https://todo.juse.nl',
  credentials: true
}));
app.use(express.json());

// ── JWKS client (fetches Authentik's public keys to verify tokens) ──────────
const jwks = jwksClient({
  jwksUri: `${AUTHENTIK_URL}/application/o/taskpilot/.well-known/jwks.json`,
  cache: true,
  cacheMaxEntries: 5,
  cacheMaxAge: 600000 // 10 min
});

function getSigningKey(header, callback) {
  jwks.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key.getPublicKey());
  });
}

// ── Auth middleware ──────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing token' });
  }
  const token = authHeader.slice(7);
  jwt.verify(token, getSigningKey, {
    audience: OIDC_CLIENT_ID,
    issuer: `${AUTHENTIK_URL}/application/o/taskpilot/`,
    algorithms: ['RS256']
  }, (err, decoded) => {
    if (err) return res.status(401).json({ error: 'Invalid token', detail: err.message });
    // Attach user info to request
    req.user = {
      sub: decoded.sub,
      username: decoded.preferred_username || decoded.email || decoded.sub,
      name: decoded.name || decoded.preferred_username || 'Unknown'
    };
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

app.listen(PORT, () => console.log(`TaskPilot API running on port ${PORT}`));
