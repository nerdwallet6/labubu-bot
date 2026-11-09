/**
 * server.js — Express API + Mini App static hosting.
 * Every /api/* route (except /api/health and /api/buy/info's public part)
 * requires a valid Telegram initData header (x-telegram-init-data).
 * Simple in-memory per-IP rate limit: 120 requests/minute.
 */
const express = require('express');
const path = require('path');
const config = require('./config');
const { db, runTransaction, getUser, upsertUser, addBalance, toLabubu, getSpins, grantSpins } = require('./db');
const { validateInitData } = require('./auth');
const { levelForHold, nextLevel, tierForLevel, miningLevels } = require('./hold');
const { memoFor } = require('./buy');
const { checkChannelMember: channelCheck } = require('./channel');
const { rollSpin } = require('./spin');
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
        "SELECT * FROM farm_sessions WHERE user_id = ? AND claimed = 0 ORDER BY started_at DESC LIMIT 1"
      )
      .get(req.tgUser.id);
    const pendingWithdraw = db
      .prepare("SELECT COUNT(*) AS c FROM withdrawals WHERE user_id = ? AND status = 'pending'")
      .get(req.tgUser.id).c;
    // Mining is permanent once started: no end, no countdown. Accrued is
    // fractional (4 decimals on the client) so it visibly ticks every second.
    let activeSession = null;
    if (active) {
      const now = Date.now();
      const lastClaim = active.last_claim_at || active.started_at;
      const unclaimed = Math.max(0, ((now - lastClaim) / 3_600_000) * active.rate_per_hour);
      activeSession = {
        id: active.id,
        started_at: active.started_at,
        rate_per_hour: active.rate_per_hour,
        last_claim_at: lastClaim,
        unclaimed,
        claimable: unclaimed > 0,
      };
    }
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
      activeSession,
      pendingWithdrawals: pendingWithdraw,
    });
  });

  // --- farming ---
  // Rifty-style: the rate is the user's LEVEL rate, set by their wallet
  // hold (on-chain LABUBU). No wallet / lookup fails = Lv1 (25/h).
  // Mining is PERMANENT once started: one start, it runs forever, no
  // session end, no restart. The rate is refreshed from the current level
  // on every claim (see /api/farm/claim).
  app.post('/api/farm/start', requireUser, async (req, res) => {
    const existing = db
      .prepare(
        "SELECT * FROM farm_sessions WHERE user_id = ? AND claimed = 0 ORDER BY started_at DESC LIMIT 1"
      )
      .get(req.tgUser.id);
    if (existing) {
      return res.status(400).json({ ok: false, error: 'a farming session is already active' });
    }
    const user = getUser(req.tgUser.id);
    let holdLabubu = 0;
    if (user.wallet_address) {
      try {
        const bal = await getJettonBalanceNano(user.wallet_address);
        if (bal !== null) holdLabubu = bal / NANO;
      } catch (e) {
        console.log(`[farm] hold lookup failed for user ${req.tgUser.id}: ${e.message} — Lv1 rate.`);
      }
    }
    const lvl = levelForHold(holdLabubu);
    const now = Date.now();
    const info = db
      .prepare(
        'INSERT INTO farm_sessions (user_id, started_at, ends_at, rate_per_hour, last_claim_at) VALUES (?, ?, NULL, ?, ?)'
      )
      .run(req.tgUser.id, now, lvl.perHour, now);
    res.json({
      ok: true,
      session: {
        id: info.lastInsertRowid,
        started_at: now,
        rate_per_hour: lvl.perHour,
        level: lvl.level,
        perDay: lvl.perDay,
      },
    });
  });

  // Claim mined LABUBU ANYTIME: pays what accrued since the last claim,
  // straight to the in-bot balance. Mining is permanent once started —
  // the session never ends and never needs a restart. On each claim the
  // rate is refreshed from the user's current level (on-chain hold), so
  // levelling up raises the rate from the next claim onward.
  app.post('/api/farm/claim', requireUser, async (req, res) => {
    const session = db
      .prepare(
        "SELECT * FROM farm_sessions WHERE user_id = ? AND claimed = 0 ORDER BY started_at DESC LIMIT 1"
      )
      .get(req.tgUser.id);
    if (!session) return res.status(400).json({ ok: false, error: 'no active farming session' });
    const now = Date.now();
    const lastClaim = session.last_claim_at || session.started_at;
    const elapsedMs = now - lastClaim;
    if (elapsedMs <= 0) {
      return res.status(400).json({ ok: false, error: 'nothing to claim yet' });
    }
    const rewardNano = Math.floor((elapsedMs / 3_600_000) * session.rate_per_hour * NANO);
    if (rewardNano <= 0) {
      return res.status(400).json({ ok: false, error: 'nothing to claim yet' });
    }
    const user = getUser(req.tgUser.id);
    // Refresh the rate from the current level (on-chain hold). The elapsed
    // period pays at the OLD rate; the NEW rate applies from now on.
    let newRate = session.rate_per_hour;
    if (user.wallet_address) {
      try {
        const bal = await getJettonBalanceNano(user.wallet_address);
        if (bal !== null) newRate = levelForHold(bal / NANO).perHour;
      } catch (e) {
        console.log(`[farm] hold lookup failed for user ${req.tgUser.id}: ${e.message} — keeping rate ${session.rate_per_hour}.`);
      }
    }
    let referralNano = 0;
    runTransaction(() => {
      addBalance(req.tgUser.id, rewardNano);
      db.prepare(
        'UPDATE farm_sessions SET last_claim_at = ?, rate_per_hour = ?, reward_nano = COALESCE(reward_nano, 0) + ? WHERE id = ?'
      ).run(now, newRate, rewardNano, session.id);
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
      rate_per_hour: newRate,
      sessionActive: true,
    });
  });

  // Check whether a Telegram user is a member of the official channel.
  // Returns true (member/admin/creator), false (left/kicked/not a member),
  // or null when the check itself failed (e.g. the bot is not an admin of
  // the channel, so Telegram refuses to answer).
  async function checkChannelMember(telegramId) {
    return channelCheck(config.botToken, config.channelUsername, telegramId);
  }

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
    // friend_buy task: ongoing auto bonus — count qualifying friend buys.
    const fb = db
      .prepare(
        'SELECT COUNT(*) AS c, COALESCE(SUM(bonus_nano),0) AS e FROM referral_buy_bonus WHERE referrer_id = ?'
      )
      .get(req.tgUser.id);
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
        progress: t.kind === 'referral' ? refCount : t.kind === 'friend_buy' ? fb.c : undefined,
        earned: t.kind === 'friend_buy' ? toLabubu(fb.e) : undefined,
      })),
    });
  });

  app.post('/api/tasks/:id/claim', requireUser, async (req, res) => {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND active = 1').get(req.params.id);
    if (!task) return res.status(404).json({ ok: false, error: 'task not found' });
    const done = db
      .prepare('SELECT 1 FROM user_tasks WHERE user_id = ? AND task_id = ?')
      .get(req.tgUser.id, task.id);
    if (done) return res.status(400).json({ ok: false, error: 'task already claimed' });

    if (task.kind === 'friend_buy') {
      // Ongoing auto bonus — credited by the buy poller, never claimed here.
      return res
        .status(400)
        .json({ ok: false, error: 'this bonus is credited automatically when your friend buys' });
    }
    if (task.kind === 'channel') {
      // Verify the user actually joined the official Telegram channel.
      // NOTE: the bot must be an admin of the channel, otherwise Telegram
      // returns 403 and the check cannot run.
      const member = await checkChannelMember(req.tgUser.id);
      if (member === null) {
        return res.status(502).json({
          ok: false,
          error:
            'could not verify channel membership — make sure the bot is an admin of the channel',
        });
      }
      if (!member) {
        return res.status(400).json({ ok: false, error: 'join the channel first' });
      }
    }
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

  // --- daily spin ---
  app.get('/api/spin/status', requireUser, (req, res) => {
    const s = getSpins(req.tgUser.id);
    const now = Date.now();
    const canClaimDaily = !s.last_daily_at || now - s.last_daily_at >= config.spinDailyIntervalMs;
    const nextDailyInMs = canClaimDaily
      ? 0
      : config.spinDailyIntervalMs - (now - s.last_daily_at);
    const history = db
      .prepare(
        'SELECT prize_nano, roll, created_at FROM spin_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 5'
      )
      .all(req.tgUser.id)
      .map((h) => ({ prize: toLabubu(h.prize_nano), roll: h.roll, created_at: h.created_at }));
    res.json({
      ok: true,
      balance: s.balance,
      totalSpins: s.total_spins,
      totalWon: toLabubu(s.total_won_nano),
      canClaimDaily,
      nextDailyInMs,
      prizes: config.spinPrizes.map((p) => p.amount),
      history,
    });
  });

  // Claim the free daily spin (1 per 24h).
  app.post('/api/spin/daily', requireUser, (req, res) => {
    const s = getSpins(req.tgUser.id);
    const now = Date.now();
    if (s.last_daily_at && now - s.last_daily_at < config.spinDailyIntervalMs) {
      const waitMs = config.spinDailyIntervalMs - (now - s.last_daily_at);
      return res.status(400).json({ ok: false, error: 'daily spin already claimed', nextDailyInMs: waitMs });
    }
    runTransaction(() => {
      grantSpins(req.tgUser.id, 1);
      db.prepare('UPDATE user_spins SET last_daily_at = ? WHERE user_id = ?').run(now, req.tgUser.id);
    });
    return res.json({ ok: true, balance: getSpins(req.tgUser.id).balance });
  });

  // Use 1 spin: roll the wheel and credit the prize (0 = no prize).
  app.post('/api/spin/spin', requireUser, (req, res) => {
    const { prize, roll } = rollSpin();
    const prizeNano = prize * NANO;
    const result = runTransaction(() => {
      const s = getSpins(req.tgUser.id);
      if (s.balance < 1) return { ok: false, error: 'no spins left' };
      db.prepare(
        'UPDATE user_spins SET balance = balance - 1, total_spins = total_spins + 1, total_won_nano = total_won_nano + ? WHERE user_id = ?'
      ).run(prizeNano, req.tgUser.id);
      if (prize > 0) addBalance(req.tgUser.id, prizeNano);
      db.prepare(
        'INSERT INTO spin_history (user_id, prize_nano, roll, created_at) VALUES (?, ?, ?, ?)'
      ).run(req.tgUser.id, prizeNano, roll, Date.now());
      return { ok: true, prize, roll, balance: getSpins(req.tgUser.id).balance };
    });
    if (!result.ok) return res.status(400).json(result);
    return res.json(result);
  });

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

  // --- hold / levels (Rifty-style: level from wallet hold) ---
  app.get('/api/hold/status', requireUser, async (req, res) => {
    const user = getUser(req.tgUser.id);
    let onchain = null;
    if (user.wallet_address) {
      try {
        onchain = await getJettonBalanceNano(user.wallet_address);
      } catch {
        onchain = null;
      }
    }
    const holdLabubu = onchain === null ? 0 : onchain / NANO;
    const lvl = levelForHold(holdLabubu);
    const next = nextLevel(lvl.level);
    res.json({
      ok: true,
      walletAddress: user.wallet_address,
      onchainBalance: onchain === null ? null : toLabubu(onchain),
      hold: holdLabubu,
      level: lvl.level,
      tier: tierForLevel(lvl.level).name,
      perHour: lvl.perHour,
      perDay: lvl.perDay,
      nextLevel: next ? { ...next, tier: tierForLevel(next.level).name } : null,
      levels: miningLevels.map((l) => ({ ...l, tier: tierForLevel(l.level).name })),
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
