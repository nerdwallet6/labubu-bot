/**
 * buy.js — MANUAL direct-sale poller.
 *
 * Flow (manual sale — the owner sends LABUBU by hand):
 * 1. User asks /api/buy/info -> gets treasury address, rate (2500 LABUBU per
 *    GRAM), minimum (0.1 GRAM) and a unique memo: "LABUBU-<telegram_id>".
 * 2. User sends GRAM to the treasury (owner wallet) with that memo as the
 *    transfer comment.
 * 3. This poller (every 60s) reads the treasury's recent transactions via
 *    TonAPI, matches incoming GRAM transfers whose comment equals a waiting
 *    memo, and marks the order 'paid' (GRAM received).
 * 4. It then NOTIFIES the admin(s) on Telegram with the buyer, the GRAM
 *    amount, the LABUBU owed (2,500/GRAM) and the buyer's linked wallet.
 * 5. The OWNER sends the LABUBU Jettons manually to the buyer's wallet.
 *    Nothing is credited automatically — no in-bot balance is created.
 * 6. Each transaction hash is processed once (processed_txs table).
 *
 * If TREASURY_ADDRESS is not configured, the poller stays idle and
 * /api/buy/info reports configured:false — it never fails the server.
 */
const { db, runTransaction, getUser } = require('./db');
const config = require('./config');
const { getAccountTransactions, extractComment } = require('./ton');

const NANO = config.NANO; // 1 TON = 1e9 nanotons; 1 LABUBU = 1e9 nano-LABUBU

function memoFor(userId) {
  return `LABUBU-${userId}`;
}

// Admin Telegram IDs from .env (comma-separated).
function adminIds() {
  return (config.adminTelegramId || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Notify the owner(s) that GRAM arrived and LABUBU must be sent manually.
// `bot` is the grammy instance (may be null when RUN_BOT=false) — then we
// only log, so the order is still recorded and visible in the DB.
async function notifyAdmin(bot, { userId, grams, labubu, wallet, txHash }) {
  const msg =
    `🛒 MANUAL BUY — GRAM received\n\n` +
    `Buyer Telegram ID: ${userId}\n` +
    `GRAM received: ${grams}\n` +
    `LABUBU to send: ${labubu.toLocaleString()} (1 GRAM = ${config.saleRate.toLocaleString()})\n` +
    `Buyer's linked wallet: ${wallet || 'NOT LINKED — ask the buyer for their TON address'}\n` +
    `Tx: ${txHash}\n\n` +
    `Send the LABUBU manually to the buyer's wallet.`;
  if (!bot) {
    console.log(`[buy] ADMIN NOTICE (no bot):\n${msg}`);
    return;
  }
  for (const id of adminIds()) {
    try {
      await bot.api.sendMessage(id, msg);
    } catch (e) {
      console.log(`[buy] could not notify admin ${id}: ${e.message}`);
    }
  }
}

async function pollOnce(bot = null) {
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
    // MANUAL sale: do NOT credit any in-bot balance. Mark the order paid
    // (GRAM received) and notify the owner to send LABUBU by hand.
    const labubu = Math.floor(grams * config.saleRate);
    const labubuNano = Math.floor(grams * config.saleRate * NANO);
    const buyer = getUser(userId);
    runTransaction(() => {
      db.prepare(
        "UPDATE buy_orders SET status = 'paid', grams_nano = ?, labubu_nano = ?, tx_hash = ?, paid_at = ? WHERE id = ?"
      ).run(valueNano, labubuNano, hash, Date.now(), order.id);
    });
    matched++;
    console.log(
      `[buy] ${grams} GRAM received from user ${userId} (tx ${hash}) — ${labubu.toLocaleString()} LABUBU owed, owner sends manually.`
    );
    await notifyAdmin(bot, {
      userId,
      grams,
      labubu,
      wallet: buyer ? buyer.wallet_address : null,
      txHash: hash,
    });
  }
  return { skipped: false, checked: txs.length, matched };
}

function startBuyPoller(bot = null, intervalMs = 60_000) {
  if (!config.treasuryAddress) {
    console.log('[buy] TREASURY_ADDRESS not set — buy poller idle. Set it in .env to enable buys.');
    return null;
  }
  console.log(`[buy] poller watching treasury ${config.treasuryAddress} every ${intervalMs / 1000}s (MANUAL sale — owner sends LABUBU by hand).`);
  const timer = setInterval(() => {
    pollOnce(bot).catch((e) => console.log(`[buy] poll error: ${e.message}`));
  }, intervalMs);
  timer.unref();
  return timer;
}

module.exports = { memoFor, pollOnce, startBuyPoller };
