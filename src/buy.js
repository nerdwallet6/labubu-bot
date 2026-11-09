/**
 * buy.js — manual direct-sale poller.
 *
 * Flow:
 * 1. User asks /api/buy/info -> gets treasury address, rate (2500 LABUBU per
 *    GRAM), minimum (0.1 GRAM) and a unique memo: "LABUBU-<telegram_id>".
 * 2. User sends GRAM to the treasury with that memo as the transfer comment.
 * 3. This poller (every 60s) reads the treasury's recent transactions via
 *    TonAPI, matches incoming GRAM transfers whose comment equals a waiting
 *    memo, and credits LABUBU to the buyer's in-bot balance.
 * 4. Each transaction hash is processed once (processed_txs table).
 *
 * If TREASURY_ADDRESS is not configured, the poller stays idle and
 * /api/buy/info reports configured:false — it never fails the server.
 */
const { db, runTransaction, addBalance } = require('./db');
const config = require('./config');
const { getAccountTransactions, extractComment } = require('./ton');

const NANO = config.NANO; // 1 TON = 1e9 nanotons; 1 LABUBU = 1e9 nano-LABUBU

function memoFor(userId) {
  return `LABUBU-${userId}`;
}

async function pollOnce() {
  if (!config.treasuryAddress) return { skipped: true, reason: 'no treasury configured' };
  let txs;
  try {
    txs = await getAccountTransactions(config.treasuryAddress, 20);
  } catch (e) {
    console.log(`[buy] TonAPI lookup failed: ${e.message}`);
    return { skipped: true, reason: 'tonapi error' };
  }

  let matched = 0;
  for (const tx of txs) {
    const hash = tx.hash;
    if (!hash) continue;
    const already = db.prepare('SELECT 1 FROM processed_txs WHERE tx_hash = ?').get(hash);
    if (already) continue;
    db.prepare('INSERT OR IGNORE INTO processed_txs (tx_hash, processed_at) VALUES (?, ?)').run(
      hash,
      Date.now()
    );

    const msg = tx.in_msg || {};
    if (!msg.source) continue; // only incoming transfers
    const valueNano = Number(msg.value || 0);
    if (valueNano <= 0) continue;
    const comment = (extractComment(tx) || '').trim();
    const m = comment.match(/^LABUBU-(\d+)$/);
    if (!m) continue;

    const userId = parseInt(m[1], 10);
    const order = db
      .prepare(
        "SELECT * FROM buy_orders WHERE user_id = ? AND memo = ? AND status = 'waiting' ORDER BY created_at DESC LIMIT 1"
      )
      .get(userId, comment);
    if (!order) {
      console.log(`[buy] memo ${comment} has no waiting order; tx ${hash} ignored for credit.`);
      continue;
    }

    const grams = valueNano / 1e9;
    if (grams < config.saleMinGram) {
      console.log(
        `[buy] tx ${hash}: ${grams} GRAM below minimum ${config.saleMinGram}; order left waiting.`
      );
      continue;
    }
    const labubuNano = Math.floor(grams * config.saleRate * NANO);
    runTransaction(() => {
      addBalance(userId, labubuNano);
      db.prepare(
        "UPDATE buy_orders SET status = 'paid', grams_nano = ?, labubu_nano = ?, tx_hash = ?, paid_at = ? WHERE id = ?"
      ).run(valueNano, labubuNano, hash, Date.now(), order.id);
    });
    matched++;
    console.log(
      `[buy] credited ${labubuNano / NANO} LABUBU to user ${userId} for ${grams} GRAM (tx ${hash}).`
    );
  }
  return { skipped: false, checked: txs.length, matched };
}

function startBuyPoller(intervalMs = 60_000) {
  if (!config.treasuryAddress) {
    console.log('[buy] TREASURY_ADDRESS not set — buy poller idle. Set it in .env to enable buys.');
    return null;
  }
  console.log(`[buy] poller watching treasury ${config.treasuryAddress} every ${intervalMs / 1000}s.`);
  const timer = setInterval(() => {
    pollOnce().catch((e) => console.log(`[buy] poll error: ${e.message}`));
  }, intervalMs);
  timer.unref();
  return timer;
}

module.exports = { memoFor, pollOnce, startBuyPoller };
