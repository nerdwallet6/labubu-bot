/**
 * hold.js — daily hold-to-earn distribution.
 *
 * Model (owner decisions, see README):
 * - Fixed daily pool: 1,000,000 LABUBU/day, from the 200M pool over 200 days.
 * - Eligibility: on-chain LABUBU balance >= 1,000,000 LABUBU.
 * - Anti-gaming: the balance must be held for the FULL 24h window. We read
 *   the balance at the start of the day and again at the end, and use the
 *   MINIMUM of the two. Buying just before the snapshot does not help.
 * - The daily pool is split proportionally by qualifying users' min balances.
 * - Rewards are credited to in-bot balances (withdrawable later via /withdraw).
 *
 * Runs once a day at 00:00 UTC (see index.js): first distribute yesterday
 * (using stored start + freshly read end balance), then snapshot today's
 * start balances. Pool accounting lives in hold_meta (days_used).
 */
const { db, runTransaction, addBalance } = require('./db');
const config = require('./config');
const { getJettonBalanceNano } = require('./ton');

const NANO = config.NANO;

function todayUtc() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function yesterdayUtc() {
  const d = new Date(Date.now() - 24 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

function getHoldMeta(key, fallback) {
  const row = db.prepare('SELECT value FROM hold_meta WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setHoldMeta(key, value) {
  db.prepare(
    'INSERT INTO hold_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

async function distributeDay(day) {
  const daysUsed = parseInt(getHoldMeta('days_used', '0'), 10);
  if (daysUsed >= 200) {
    console.log(`[hold] pool exhausted after 200 days; no distribution for ${day}.`);
    return { distributed: false, reason: 'pool exhausted' };
  }

  const rows = db
    .prepare(
      `SELECT hs.*, u.wallet_address FROM hold_snapshots hs
       JOIN users u ON u.telegram_id = hs.user_id
       WHERE hs.day = ? AND hs.balance_start IS NOT NULL AND u.wallet_address IS NOT NULL`
    )
    .all(day);

  if (rows.length === 0) {
    console.log(`[hold] no snapshots for ${day}; nothing to distribute.`);
    return { distributed: false, reason: 'no snapshots' };
  }

  // Read end-of-day balances, compute min(start, end).
  const eligible = [];
  for (const row of rows) {
    let end = null;
    try {
      end = await getJettonBalanceNano(row.wallet_address);
    } catch (e) {
      console.log(`[hold] balance lookup failed for user ${row.user_id}: ${e.message}`);
    }
    const min = end === null ? row.balance_start : Math.min(row.balance_start, end);
    db.prepare(
      'UPDATE hold_snapshots SET balance_end = ?, balance_min = ? WHERE id = ?'
    ).run(end, min, row.id);
    if (min >= config.holdMinBalance * NANO) {
      eligible.push({ user_id: row.user_id, snapshot_id: row.id, min });
    }
  }

  if (eligible.length === 0) {
    console.log(`[hold] no eligible holders for ${day}.`);
    return { distributed: false, reason: 'no eligible holders' };
  }

  const totalMin = eligible.reduce((s, e) => s + e.min, 0);
  const poolNano = config.holdDailyPool * NANO;
  let distributedNano = 0;
  runTransaction(() => {
    for (const e of eligible) {
      const share = Math.floor((poolNano * e.min) / totalMin);
      if (share <= 0) continue;
      addBalance(e.user_id, share);
      db.prepare(
        'UPDATE hold_snapshots SET reward_nano = ?, distributed_at = ? WHERE id = ?'
      ).run(share, Date.now(), e.snapshot_id);
      distributedNano += share;
    }
  });
  setHoldMeta('days_used', daysUsed + 1);

  console.log(
    `[hold] distributed ${distributedNano / NANO} LABUBU to ${eligible.length} holders for ${day}.`
  );
  return { distributed: true, holders: eligible.length, distributedNano };
}

async function snapshotDay(day) {
  const users = db
    .prepare('SELECT telegram_id, wallet_address FROM users WHERE wallet_address IS NOT NULL')
    .all();
  let snapshotted = 0;
  for (const u of users) {
    let bal = null;
    try {
      bal = await getJettonBalanceNano(u.wallet_address);
    } catch (e) {
      console.log(`[hold] snapshot lookup failed for user ${u.telegram_id}: ${e.message}`);
    }
    db.prepare(
      `INSERT INTO hold_snapshots (user_id, day, balance_start)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id, day) DO UPDATE SET balance_start = excluded.balance_start`
    ).run(u.telegram_id, day, bal);
    if (bal !== null) snapshotted++;
  }
  console.log(`[hold] snapshotted ${snapshotted}/${users.length} wallets for ${day}.`);
  return snapshotted;
}

/** Daily tick: distribute yesterday, then snapshot today. */
async function dailyTick() {
  console.log('[hold] daily tick started.');
  try {
    await distributeDay(yesterdayUtc());
  } catch (e) {
    console.log(`[hold] distribute failed: ${e.message}`);
  }
  try {
    await snapshotDay(todayUtc());
  } catch (e) {
    console.log(`[hold] snapshot failed: ${e.message}`);
  }
}

function getHoldStatus(userId) {
  const daysUsed = parseInt(getHoldMeta('days_used', '0'), 10);
  const poolRemaining = Math.max(0, config.holdPoolTotal - daysUsed * config.holdDailyPool);
  const last = db
    .prepare('SELECT * FROM hold_snapshots WHERE user_id = ? ORDER BY day DESC LIMIT 1')
    .get(userId);
  const totalEarned = db
    .prepare('SELECT COALESCE(SUM(reward_nano), 0) AS s FROM hold_snapshots WHERE user_id = ?')
    .get(userId).s;
  return {
    dailyPool: config.holdDailyPool,
    poolRemaining,
    daysUsed,
    daysTotal: 200,
    minBalance: config.holdMinBalance,
    lastSnapshot: last || null,
    totalEarnedNano: totalEarned,
  };
}

module.exports = { dailyTick, distributeDay, snapshotDay, getHoldStatus, todayUtc };
