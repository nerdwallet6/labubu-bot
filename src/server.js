/**
 * server.js — Express API + Mini App static hosting.
 * Every /api/* route (except /api/health and /api/buy/info's public part)
 * requires a valid Telegram initData header (x-telegram-init-data).
 * Simple in-memory per-IP rate limit: 120 requests/minute.
 */
const express = require('express');
const path = require('path');
const config = require('./config');
const { db, runTransaction, getUser, upsertUser, addBalance, toLabubu } = require('./db');
const { validateInitData } = require('./auth');
const { getHoldStatus } = require('./hold');
const { memoFor } = require('./buy');
const { getJettonBalanceNano, isTonAddress } = require('./ton');

const NANO = config.NANO;

function createServer() {
  const app = express();
  app.use(express.json({ limit: '100kb' }));

  // --- rate limit (in-memory, per IP) ---
  const hits = new Map();
  app.use((req, res, next) => {
    const now = Date.now();
    const ip = req.ip || 'unknown';
    const arr = (hits.get(ip) || []).filter((t) => now - t < 60_000);
    arr.push(now);
    hits.set(ip, arr);
    if (arr.length > 120) return res.status(429).json({ ok: false, error: 'rate limited' });
    next();
  });

  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.get('/api/health', (req, res) => {
    res.json({
      ok: true,
      token: config.tokenSymbol,
      jettonMaster: config.jettonMaster,
      buyConfigured: Boolean(config.treasuryAddress),
      miniAppConfigured: Boolean(config.miniAppUrl),
    });
  });

  // --- auth middleware for user API ---
  function requireUser(req, res, next) {
    const initData = req.header('x-telegram-init-data') || req.body?.initData || '';
    const tgUser = validateInitData(initData);
    if (!tgUser) return res.status(401).json({ ok: false, error: 'invalid initData' });
    const user = upsertUser({
      telegram_id: tgUser.id,
      username: tgUser.username,
      first_name: tgUser.first_name,
      referrer_id: null,
    });
    req.tgUser = tgUser;
    req.user = user;
    next();
  }

  // --- /api/me ---
  app.get('/api/me', requireUser, (req, res) => {
    const u = getUser(req.tgUser.id);
    const refs = db
      .prepare('SELECT COUNT(*) AS c, COALESCE(SUM(earned_nano),0) AS e FROM referrals WHERE referrer_id = ?')
      .get(req.tgUser.id);
    const active = db
      .prepare(
        "SELECT * FROM farm_sessions WHERE user_id = ? AND claimed = 0 AND ends_at > ? ORDER BY started_at DESC LIMIT 1"
      )
      .get(req.tgUser.id, Date.now());
    const pendingWithdraw = db
      .prepare("SELECT COUNT(*) AS c FROM withdrawals WHERE user_id = ? AND status = 'pending'")
      .get(req.tgUser.id).c;
    res.json({
      ok: true,
      user: {
        telegram_id: u.telegram_id,
        username: u.username,
        first_name: u.first_name,
        wallet_address: u.wallet_address,
        balance: toLabubu(u.balance_nano),
        balance_nano: u.balance_nano,
      },
      referrals: { count: refs.c, earned: toLabubu(refs.e) },
      activeSession: active
        ? {
            id: active.id,
            started_at: active.started_at,
            ends_at: active.ends_at,
            rate_per_hour: active.rate_per_hour,
            claimable: Date.now() >= active.ends_at,
          }
        : null,
      pendingWithdrawals: pendingWithdraw,
    });
  });

  // --- farming ---
  app.post('/api/farm/start', requireUser, (req, res) => {
    const existing = db
      .prepare(
        "SELECT * FROM farm_sessions WHERE user_id = ? AND claimed = 0 ORDER BY started_at DESC LIMIT 1"
      )
      .get(req.tgUser.id);
    if (existing) {
      return res.status(400).json({ ok: false, error: 'a farming session is already active' });
    }
    const now = Date.now();
    const info = db
      .prepare(
        'INSERT INTO farm_sessions (user_id, started_at, ends_at, rate_per_hour) VALUES (?, ?, ?, ?)'
      )
      .run(req.tgUser.id, now, now + config.farmDurationMs, config.farmRatePerHour);
    res.json({
      ok: true,
      session: {
        id: info.lastInsertRowid,
        started_at: now,
        ends_at: now + config.farmDurationMs,
        rate_per_hour: config.farmRatePerHour,
      },
    });
  });

  app.post('/api/farm/claim', requireUser, (req, res) => {
    const session = db
      .prepare(
        "SELECT * FROM farm_sessions WHERE user_id = ? AND claimed = 0 ORDER BY started_at DESC LIMIT 1"
      )
      .get(req.tgUser.id);
    if (!session) return res.status(400).json({ ok: false, error: 'no active farming session' });
    if (Date.now() < session.ends_at) {
      return res.status(400).json({ ok: false, error: 'session has not ended yet', ends_at: session.ends_at });
    }
    const elapsedHours = (session.ends_at - session.started_at) / 3_600_000;
    const maxHours = config.farmDurationMs / 3_600_000;
    const hours = Math.min(Math.max(0, elapsedHours), maxHours);
    const rewardNano = Math.floor(hours * session.rate_per_hour * NANO);
    const user = getUser(req.tgUser.id);
    let referralNano = 0;
    runTransaction(() => {
      addBalance(req.tgUser.id, rewardNano);
      db.prepare(
        'UPDATE farm_sessions SET claimed = 1, claimed_at = ?, reward_nano = ? WHERE id = ?'
      ).run(Date.now(), rewardNano, session.id);
      if (user.referrer_id) {
        referralNano = Math.floor(rewardNano * config.referralRate);
        if (referralNano > 0) {
          addBalance(user.referrer_id, referralNano);
          db.prepare(
            'UPDATE referrals SET earned_nano = earned_nano + ? WHERE referrer_id = ? AND referred_id = ?'
          ).run(referralNano, user.referrer_id, req.tgUser.id);
        }
      }
    });
    res.json({
      ok: true,
      claimed: toLabubu(rewardNano),
      referralBonusToReferrer: toLabubu(referralNano),
    });
  });

  // --- tasks ---
  app.get('/api/tasks', requireUser, (req, res) => {
    const tasks = db.prepare('SELECT * FROM tasks WHERE active = 1').all();
    const doneRows = db
      .prepare('SELECT task_id, done_at FROM user_tasks WHERE user_id = ?')
      .all(req.tgUser.id);
    const today = new Date().toISOString().slice(0, 10);
    const done = new Set();
    for (const r of doneRows) {
      // check-in is daily: only counts as done if claimed today (UTC)
      if (r.task_id === 'checkin') {
        if (new Date(r.done_at).toISOString().slice(0, 10) === today) done.add(r.task_id);
      } else {
        done.add(r.task_id);
      }
    }
    const refCount = db
      .prepare('SELECT COUNT(*) AS c FROM referrals WHERE referrer_id = ?')
      .get(req.tgUser.id).c;
    res.json({
      ok: true,
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        reward: toLabubu(t.reward_nano),
        kind: t.kind,
        url: t.url,
        target: t.target,
        done: done.has(t.id),
        progress: t.kind === 'referral' ? refCount : undefined,
      })),
    });
  });

  app.post('/api/tasks/:id/claim', requireUser, (req, res) => {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND active = 1').get(req.params.id);
    if (!task) return res.status(404).json({ ok: false, error: 'task not found' });
    const done = db
      .prepare('SELECT 1 FROM user_tasks WHERE user_id = ? AND task_id = ?')
      .get(req.tgUser.id, task.id);
    if (done) return res.status(400).json({ ok: false, error: 'task already claimed' });

    if (task.kind === 'referral') {
      const refCount = db
        .prepare('SELECT COUNT(*) AS c FROM referrals WHERE referrer_id = ?')
        .get(req.tgUser.id).c;
      if (refCount < (task.target || 0)) {
        return res.status(400).json({ ok: false, error: `need ${task.target} referrals`, progress: refCount });
      }
    }
    if (task.kind === 'checkin') {
      // Daily check-in: one claim per UTC day.
      const last = db
        .prepare('SELECT done_at FROM user_tasks WHERE user_id = ? AND task_id = ?')
        .get(req.tgUser.id, task.id);
      const today = new Date().toISOString().slice(0, 10);
      if (last && new Date(last.done_at).toISOString().slice(0, 10) === today) {
        return res.status(400).json({ ok: false, error: 'already checked in today' });
      }
      runTransaction(() => {
        addBalance(req.tgUser.id, task.reward_nano);
        db.prepare(
          `INSERT INTO user_tasks (user_id, task_id, done_at) VALUES (?, ?, ?)
           ON CONFLICT(user_id, task_id) DO UPDATE SET done_at = excluded.done_at`
        ).run(req.tgUser.id, task.id, Date.now());
      });
      return res.json({ ok: true, reward: toLabubu(task.reward_nano) });
    }
    if (task.kind === 'hold') {
      const user = getUser(req.tgUser.id);
      if (!user.wallet_address) {
        return res.status(400).json({ ok: false, error: 'link a TON wallet first' });
      }
      return getJettonBalanceNano(user.wallet_address)
        .then((bal) => {
          if (bal === null || bal < (task.target || 0) * NANO) {
            return res.status(400).json({ ok: false, error: 'holding requirement not met' });
          }
          return finishTaskClaim(req, res, task);
        })
        .catch(() => res.status(502).json({ ok: false, error: 'balance lookup failed' }));
    }
    if (task.kind === 'checkin') {
      // handled above (daily claim)
    }
    return finishTaskClaim(req, res, task);
  });

  function finishTaskClaim(req, res, task) {
    runTransaction(() => {
      addBalance(req.tgUser.id, task.reward_nano);
      db.prepare('INSERT INTO user_tasks (user_id, task_id, done_at) VALUES (?, ?, ?)').run(
        req.tgUser.id,
        task.id,
        Date.now()
      );
    });
    return res.json({ ok: true, reward: toLabubu(task.reward_nano) });
  }

  // --- referrals ---
  app.get('/api/referrals', requireUser, (req, res) => {
    const rows = db
      .prepare(
        `SELECT r.referred_id, u.username, u.first_name, r.earned_nano, r.created_at
         FROM referrals r LEFT JOIN users u ON u.telegram_id = r.referred_id
         WHERE r.referrer_id = ? ORDER BY r.created_at DESC LIMIT 100`
      )
      .all(req.tgUser.id);
    res.json({
      ok: true,
      link: config.botUsername
        ? `https://t.me/${config.botUsername}?start=ref_${req.tgUser.id}`
        : null,
      referrals: rows.map((r) => ({
        id: r.referred_id,
        name: r.first_name || r.username || String(r.referred_id),
        earned: toLabubu(r.earned_nano),
        created_at: r.created_at,
      })),
    });
  });

  // --- buy ---
  app.get('/api/buy/info', requireUser, (req, res) => {
    if (!config.treasuryAddress) {
      return res.json({
        ok: true,
        configured: false,
        message: 'Direct sale is not open yet — the treasury address has not been set by the owner.',
      });
    }
    res.json({
      ok: true,
      configured: true,
      treasuryAddress: config.treasuryAddress,
      rate: config.saleRate,
      rateText: `1 GRAM = ${config.saleRate.toLocaleString()} LABUBU`,
      minGram: config.saleMinGram,
      memo: memoFor(req.tgUser.id),
    });
  });

  app.post('/api/buy/prepare', requireUser, (req, res) => {
    if (!config.treasuryAddress) {
      return res.status(400).json({ ok: false, error: 'direct sale is not configured yet' });
    }
    const memo = memoFor(req.tgUser.id);
    db.prepare(
      "INSERT INTO buy_orders (user_id, memo, status, created_at) VALUES (?, ?, 'waiting', ?)"
    ).run(req.tgUser.id, memo, Date.now());
    res.json({ ok: true, memo, treasuryAddress: config.treasuryAddress, rate: config.saleRate });
  });

  // --- hold-to-earn ---
  app.get('/api/hold/status', requireUser, async (req, res) => {
    const status = getHoldStatus(req.tgUser.id);
    const user = getUser(req.tgUser.id);
    let onchain = null;
    if (user.wallet_address) {
      try {
        onchain = await getJettonBalanceNano(user.wallet_address);
      } catch {
        onchain = null;
      }
    }
    res.json({
      ok: true,
      walletAddress: user.wallet_address,
      onchainBalance: onchain === null ? null : toLabubu(onchain),
      dailyPool: status.dailyPool,
      poolRemaining: status.poolRemaining,
      daysUsed: status.daysUsed,
      daysTotal: status.daysTotal,
      minBalance: status.minBalance,
      level: status.level,
      levelName: status.levelName,
      holdMultiplier: status.holdMultiplier,
      levels: status.levels,
      totalEarned: toLabubu(status.totalEarnedNano),
      lastSnapshot: status.lastSnapshot
        ? { day: status.lastSnapshot.day, reward: toLabubu(status.lastSnapshot.reward_nano || 0) }
        : null,
    });
  });

  app.post('/api/hold/link-wallet', requireUser, (req, res) => {
    const address = (req.body?.address || '').trim();
    if (!isTonAddress(address)) {
      return res.status(400).json({ ok: false, error: 'invalid TON address' });
    }
    db.prepare('UPDATE users SET wallet_address = ? WHERE telegram_id = ?').run(
      address,
      req.tgUser.id
    );
    res.json({ ok: true, walletAddress: address });
  });

  // --- withdraw (v1: queued, admin approves manually) ---
  app.post('/api/withdraw/request', requireUser, async (req, res) => {
    const address = (req.body?.address || '').trim();
    const amount = Number(req.body?.amount);
    if (!isTonAddress(address)) {
      return res.status(400).json({ ok: false, error: 'invalid TON address' });
    }
    if (!Number.isFinite(amount) || amount < config.withdrawMin) {
      return res
        .status(400)
        .json({ ok: false, error: `minimum withdrawal is ${config.withdrawMin.toLocaleString()} LABUBU` });
    }
    const user = getUser(req.tgUser.id);
    const amountNano = Math.floor(amount * NANO);
    if (amountNano > user.balance_nano) {
      return res.status(400).json({ ok: false, error: 'insufficient balance' });
    }
    // Must keep 25% of the withdrawal amount in the account balance:
    // withdraw 10,000 needs balance >= 12,500 (2,500 stays as hold).
    const holdNano = Math.floor(amountNano * config.withdrawHoldRate);
    if (user.balance_nano < amountNano + holdNano) {
      return res.status(400).json({
        ok: false,
        error: `you must keep ${config.withdrawHoldRate * 100}% of the withdrawal (${(holdNano / NANO).toLocaleString()} LABUBU) in your balance — withdrawing ${amount.toLocaleString()} LABUBU needs at least ${((amountNano + holdNano) / NANO).toLocaleString()} LABUBU balance`,
      });
    }
    const info = runTransaction(() => {
      addBalance(req.tgUser.id, -amountNano);
      return db
        .prepare(
          "INSERT INTO withdrawals (user_id, address, amount_nano, status, created_at) VALUES (?, ?, ?, 'pending', ?)"
        )
        .run(req.tgUser.id, address, amountNano, Date.now());
    });
    res.json({ ok: true, withdrawalId: info.lastInsertRowid, status: 'pending' });
  });

  app.get('/api/withdraw/list', requireUser, (req, res) => {
    const rows = db
      .prepare('SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC LIMIT 20')
      .all(req.tgUser.id);
    res.json({
      ok: true,
      withdrawals: rows.map((w) => ({
        id: w.id,
        address: w.address,
        amount: toLabubu(w.amount_nano),
        status: w.status,
        created_at: w.created_at,
      })),
    });
  });

  return app;
}

module.exports = { createServer };
