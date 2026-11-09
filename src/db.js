/**
 * db.js — SQLite storage (Node.js built-in node:sqlite, no native deps).
 * All LABUBU amounts are integers in nano-LABUBU (1 LABUBU = 1e9 units).
 */
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const config = require('./config');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

/** Run fn() inside a transaction; returns fn()'s value, rolls back on error. */
function runTransaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  telegram_id   INTEGER PRIMARY KEY,
  username      TEXT,
  first_name    TEXT,
  referrer_id   INTEGER,
  wallet_address TEXT,
  balance_nano  INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS farm_sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(telegram_id),
  started_at    INTEGER NOT NULL,
  ends_at       INTEGER NOT NULL,
  rate_per_hour INTEGER NOT NULL,
  claimed      INTEGER NOT NULL DEFAULT 0,
  claimed_at    INTEGER,
  reward_nano   INTEGER
);

CREATE TABLE IF NOT EXISTS tasks (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT NOT NULL,
  reward_nano INTEGER NOT NULL,
  kind        TEXT NOT NULL,   -- 'checkin' | 'referral' | 'hold' | 'friend_buy' | 'channel'
  url         TEXT,
  target      INTEGER,         -- e.g. referrals needed, or min hold
  active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS user_tasks (
  user_id    INTEGER NOT NULL REFERENCES users(telegram_id),
  task_id    TEXT NOT NULL REFERENCES tasks(id),
  done_at    INTEGER NOT NULL,
  PRIMARY KEY (user_id, task_id)
);

CREATE TABLE IF NOT EXISTS referrals (
  referrer_id INTEGER NOT NULL,
  referred_id INTEGER NOT NULL,
  earned_nano INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (referrer_id, referred_id)
);

CREATE TABLE IF NOT EXISTS buy_orders (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(telegram_id),
  memo            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'waiting', -- waiting|paid|failed
  grams_nano      INTEGER,
  labubu_nano     INTEGER,
  tx_hash         TEXT,
  created_at      INTEGER NOT NULL,
  paid_at         INTEGER
);

CREATE TABLE IF NOT EXISTS processed_txs (
  tx_hash     TEXT PRIMARY KEY,
  processed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS referral_buy_bonus (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer_id   INTEGER NOT NULL,
  referred_id   INTEGER NOT NULL,
  order_id      INTEGER NOT NULL UNIQUE,
  bonus_nano    INTEGER NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_spins (
  user_id        INTEGER PRIMARY KEY REFERENCES users(telegram_id),
  balance        INTEGER NOT NULL DEFAULT 0, -- free spins available
  total_spins    INTEGER NOT NULL DEFAULT 0,
  total_won_nano INTEGER NOT NULL DEFAULT 0,
  last_daily_at  INTEGER                   -- ms timestamp of last daily free spin
);

CREATE TABLE IF NOT EXISTS spin_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(telegram_id),
  prize_nano  INTEGER NOT NULL,
  roll        REAL NOT NULL, -- roll in [0,100)
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS hold_snapshots (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users(telegram_id),
  day            TEXT NOT NULL,   -- YYYY-MM-DD (UTC)
  balance_start  INTEGER,         -- nano-LABUBU at start of day
  balance_end    INTEGER,         -- nano-LABUBU at end of day
  balance_min    INTEGER,
  reward_nano    INTEGER,
  distributed_at INTEGER,
  UNIQUE(user_id, day)
);

CREATE TABLE IF NOT EXISTS hold_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS withdrawals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(telegram_id),
  address     TEXT NOT NULL,
  amount_nano INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending', -- pending|approved|rejected
  created_at  INTEGER NOT NULL,
  decided_at  INTEGER,
  decided_by  INTEGER
);
`);

// --- Seed default tasks (idempotent) ---
const seedTasks = [
  {
    id: 'checkin',
    title: 'Daily check-in',
    description: 'Open the bot every day and claim your daily bonus.',
    reward_nano: config.dailyCheckinReward * config.NANO,
    kind: 'checkin',
    url: null,
    target: null,
  },
  {
    id: 'invite1',
    title: 'Invite 1 friend',
    description: 'Invite 1 friend with your referral link.',
    reward_nano: 500 * config.NANO,
    kind: 'referral',
    url: null,
    target: 1,
  },
  {
    id: 'friend_buy',
    title: 'Friend buys LABUBU',
    description:
      'Every friend you invite who buys at least 2,500 LABUBU earns you +1,000 LABUBU. Bonus is credited automatically.',
    reward_nano: config.friendBuyBonus * config.NANO,
    kind: 'friend_buy',
    url: null,
    target: config.friendBuyMinLabubu,
  },
  {
    id: 'join_channel',
    title: 'Join the Telegram channel',
    description: 'Join our official Telegram channel to claim this bonus.',
    reward_nano: 500 * config.NANO,
    kind: 'channel',
    url: 'https://t.me/LabubuVerse_Mining',
    target: null,
  },
  {
    id: 'hold1m',
    title: 'Hold LABUBU in your wallet',
    description: 'Link your TON wallet and hold any amount of LABUBU to claim this bonus.',
    reward_nano: 1000 * config.NANO,
    kind: 'hold',
    url: null,
    target: 1, // any on-chain LABUBU balance >= 1 qualifies (no minimum hold)
  },
];
const insertTask = db.prepare(`
  INSERT INTO tasks (id, title, description, reward_nano, kind, url, target)
  VALUES (@id, @title, @description, @reward_nano, @kind, @url, @target)
  ON CONFLICT(id) DO UPDATE SET
    title = excluded.title,
    description = excluded.description,
    reward_nano = excluded.reward_nano,
    kind = excluded.kind,
    url = excluded.url,
    target = excluded.target
`);
for (const t of seedTasks) insertTask.run(t);
// Old invite task (3 friends) is replaced by invite1 (1 friend).
db.prepare("UPDATE tasks SET active = 0 WHERE id = 'invite3'").run();

// --- Helpers ---
function getUser(telegramId) {
  return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
}

function upsertUser({ telegram_id, username, first_name, referrer_id }) {
  const now = Date.now();
  const existing = getUser(telegram_id);
  if (existing) {
    db.prepare(
      'UPDATE users SET username = ?, first_name = ?, last_seen_at = ? WHERE telegram_id = ?'
    ).run(username || existing.username, first_name || existing.first_name, now, telegram_id);
    return getUser(telegram_id);
  }
  // Validate referrer: must exist, must not be self.
  let ref = null;
  if (referrer_id && referrer_id !== telegram_id && getUser(referrer_id)) ref = referrer_id;
  db.prepare(
    'INSERT INTO users (telegram_id, username, first_name, referrer_id, balance_nano, created_at, last_seen_at) VALUES (?, ?, ?, ?, 0, ?, ?)'
  ).run(telegram_id, username || null, first_name || null, ref, now, now);
  if (ref) {
    const r = db
      .prepare(
        'INSERT INTO referrals (referrer_id, referred_id, earned_nano, created_at) VALUES (?, ?, 0, ?) ON CONFLICT(referrer_id, referred_id) DO NOTHING'
      )
      .run(ref, telegram_id, now);
    // New referral: the referrer earns 1 free Daily Spin.
    if (r.changes === 1) grantSpins(ref, 1);
  }
  return getUser(telegram_id);
}

// --- Daily Spin helpers ---
function getSpins(userId) {
  let row = db.prepare('SELECT * FROM user_spins WHERE user_id = ?').get(userId);
  if (!row) {
    db.prepare('INSERT OR IGNORE INTO user_spins (user_id) VALUES (?)').run(userId);
    row = db.prepare('SELECT * FROM user_spins WHERE user_id = ?').get(userId);
  }
  return row;
}

function grantSpins(userId, n) {
  getSpins(userId);
  db.prepare('UPDATE user_spins SET balance = balance + ? WHERE user_id = ?').run(n, userId);
}

function addBalance(telegramId, deltaNano) {
  db.prepare('UPDATE users SET balance_nano = balance_nano + ? WHERE telegram_id = ?').run(
    deltaNano,
    telegramId
  );
}

function toLabubu(nano) {
  return nano / config.NANO;
}

module.exports = { db, runTransaction, getUser, upsertUser, addBalance, toLabubu, getSpins, grantSpins };
