const { v4: uuidv4 } = require('uuid');
const db = require('./db');

// ── Achievement definitions ───────────────────────────────────────────────────
const ACHIEVEMENTS = [
  { id: 'first_flight',   icon: '🚀', name: 'First Flight',     desc: 'Close your first task' },
  { id: 'on_fire',        icon: '🔥', name: 'On Fire',          desc: 'Reach a 3-day streak' },
  { id: 'consistent',     icon: '🗓️', name: 'Consistent',       desc: 'Reach a 7-day streak' },
  { id: 'diamond',        icon: '💎', name: 'Diamond',          desc: 'Reach a 30-day streak' },
  { id: 'lightning',      icon: '⚡', name: 'Lightning',        desc: 'Close a critical (P1) task' },
  { id: 'sharpshooter',   icon: '🎯', name: 'Sharpshooter',     desc: 'Close 5 high-priority tasks in one day' },
  { id: 'century',        icon: '🏆', name: 'Century',          desc: 'Close 100 tasks total' },
  { id: 'early_bird',     icon: '🌅', name: 'Early Bird',       desc: 'Close a task before 9:00 AM' },
  { id: 'night_owl',      icon: '🌙', name: 'Night Owl',        desc: 'Close a task after 11:00 PM' },
  { id: 'speed_run',      icon: '🏃', name: 'Speed Run',        desc: 'Finish a task faster than its estimated time' },
  { id: 'clean_sweep',    icon: '🧹', name: 'Clean Sweep',      desc: 'Close all overdue tasks in a single day' },
  { id: 'top_pilot',      icon: '👑', name: 'Top Pilot',        desc: 'Reach #1 on the leaderboard' },
];

// ── Points calculation ────────────────────────────────────────────────────────
const PRIORITY_MULTIPLIER = { 1: 4, 2: 3, 3: 2, 4: 1 };

function calcPoints(task, streak, wasOverdue) {
  const base = Math.max(1, Math.round(task.estimatedDuration)) * (PRIORITY_MULTIPLIER[task.priority] || 1);
  const streakBonus = Math.min(streak * 0.10, 1.0); // +10% per streak day, max +100%
  const overduePenalty = wasOverdue ? 0.8 : 1.0;
  return Math.round(base * (1 + streakBonus) * overduePenalty);
}

// ── Streak update ─────────────────────────────────────────────────────────────
function updateStreak(stats, today) {
  const last = stats.lastCloseDate;
  let streak = stats.currentStreak || 0;

  if (!last) {
    streak = 1;
  } else if (last === today) {
    // Already closed one today — streak unchanged
  } else {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = yesterday.toISOString().substring(0, 10);
    streak = last === yStr ? streak + 1 : 1;
  }
  return streak;
}

// ── Weekly points reset ───────────────────────────────────────────────────────
function getWeekStart() {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay()); // Sunday
  return d.toISOString().substring(0, 10);
}

// ── Award achievement (idempotent) ────────────────────────────────────────────
function award(username, achievementId) {
  const existing = db.get(
    'SELECT id FROM user_achievements WHERE username=? AND achievementId=?',
    [username, achievementId]
  );
  if (existing) return null; // already earned
  const id = uuidv4();
  db.run(
    'INSERT INTO user_achievements (id, username, achievementId, earnedAt) VALUES (?,?,?,?)',
    [id, username, achievementId, new Date().toISOString()]
  );
  return achievementId;
}

// ── Main: process a task close ────────────────────────────────────────────────
function processTaskClose(task, user) {
  const today = new Date().toISOString().substring(0, 10);
  const now = new Date();
  const hour = now.getHours();
  const wasOverdue = task.dueDate && task.dueDate < today;

  // Get or create user stats
  let stats = db.get('SELECT * FROM user_stats WHERE username=?', [user.username]);
  if (!stats) {
    db.run(
      `INSERT INTO user_stats (username, displayName, totalPoints, tasksCompleted, currentStreak, longestStreak, lastCloseDate, weeklyPoints, weekStart)
       VALUES (?,?,0,0,0,0,NULL,0,?)`,
      [user.username, user.name, getWeekStart()]
    );
    stats = db.get('SELECT * FROM user_stats WHERE username=?', [user.username]);
  }

  const streak = updateStreak(stats, today);
  const points = calcPoints(task, streak, wasOverdue);
  const newTotal = (stats.totalPoints || 0) + points;
  const newCompleted = (stats.tasksCompleted || 0) + 1;
  const longestStreak = Math.max(stats.longestStreak || 0, streak);

  // Weekly points: reset if new week
  const weekStart = getWeekStart();
  const weeklyPoints = stats.weekStart === weekStart
    ? (stats.weeklyPoints || 0) + points
    : points;

  db.run(
    `UPDATE user_stats SET displayName=?, totalPoints=?, tasksCompleted=?, currentStreak=?,
     longestStreak=?, lastCloseDate=?, weeklyPoints=?, weekStart=? WHERE username=?`,
    [user.name, newTotal, newCompleted, streak, longestStreak, today, weeklyPoints, weekStart, user.username]
  );

  // ── Check achievements ──────────────────────────────────────────────────────
  const newlyEarned = [];

  const check = (condition, id) => { if (condition) { const r = award(user.username, id); if (r) newlyEarned.push(r); } };

  check(newCompleted === 1,    'first_flight');
  check(streak >= 3,           'on_fire');
  check(streak >= 7,           'consistent');
  check(streak >= 30,          'diamond');
  check(task.priority === 1,   'lightning');
  check(newCompleted >= 100,   'century');
  check(hour < 9,              'early_bird');
  check(hour >= 23,            'night_owl');

  // Speed run: closed faster than estimated (use claimedAt if available)
  if (task.claimedAt) {
    const claimedMs = new Date(task.claimedAt).getTime();
    const elapsedMin = (now.getTime() - claimedMs) / 60000;
    check(elapsedMin < task.estimatedDuration, 'speed_run');
  }

  // Sharpshooter: 5 P1/P2 tasks today
  const highPriorityToday = db.get(
    `SELECT COUNT(*) as cnt FROM tasks WHERE closedBy=? AND priority<=2 AND substr(closedAt,1,10)=?`,
    [user.username, today]
  );
  check((highPriorityToday?.cnt || 0) >= 5, 'sharpshooter');

  // Clean sweep: no more overdue tasks after this close
  const stillOverdue = db.get(
    `SELECT COUNT(*) as cnt FROM tasks WHERE status='open' AND dueDate IS NOT NULL AND dueDate < ?`, [today]
  );
  check((stillOverdue?.cnt || 0) === 0 && wasOverdue, 'clean_sweep');

  // Top pilot: check if now #1 on leaderboard
  const top = db.get(`SELECT username FROM user_stats ORDER BY totalPoints DESC LIMIT 1`);
  check(top?.username === user.username && newTotal > 0, 'top_pilot');

  return {
    points,
    streak,
    totalPoints: newTotal,
    newlyEarned: newlyEarned.map(id => ACHIEVEMENTS.find(a => a.id === id)).filter(Boolean)
  };
}

// ── Public getters ────────────────────────────────────────────────────────────
function getLeaderboard() {
  const weekStart = getWeekStart();
  const rows = db.all(
    `SELECT username, displayName, totalPoints, tasksCompleted, currentStreak, longestStreak,
     CASE WHEN weekStart=? THEN weeklyPoints ELSE 0 END as weeklyPoints
     FROM user_stats ORDER BY totalPoints DESC`,
    [weekStart]
  );
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

function getUserStats(username) {
  const weekStart = getWeekStart();
  const stats = db.get('SELECT * FROM user_stats WHERE username=?', [username]);
  if (!stats) return null;
  const achievements = db.all(
    'SELECT achievementId, earnedAt FROM user_achievements WHERE username=? ORDER BY earnedAt ASC',
    [username]
  );
  return {
    ...stats,
    weeklyPoints: stats.weekStart === weekStart ? stats.weeklyPoints : 0,
    achievements: achievements.map(a => ({
      ...ACHIEVEMENTS.find(def => def.id === a.achievementId),
      earnedAt: a.earnedAt
    })).filter(a => a.id)
  };
}

function getAllAchievements() { return ACHIEVEMENTS; }

module.exports = { processTaskClose, getLeaderboard, getUserStats, getAllAchievements, calcPoints };
