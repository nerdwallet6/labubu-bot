/**
 * bot.js — grammy Telegram bot (polling).
 * Commands: /start (referral ?start=ref_<id>), /balance, /buy, /help,
 * admin: /approve_withdraw <id>, /reject_withdraw <id>.
 * No secrets are ever printed. The Mini App button is only shown when
 * MINI_APP_URL is configured.
 */
const { Bot, InlineKeyboard } = require('grammy');
const config = require('./config');
const { createProxyFetch } = require('./proxyFetch');
const { db, runTransaction, getUser, upsertUser, toLabubu } = require('./db');
const { memoFor } = require('./buy');

function menuKeyboard() {
  const kb = new InlineKeyboard();
  if (config.miniAppUrl) kb.webApp('⛏️ Open Mining App', config.miniAppUrl).row();
  kb.text('💰 Balance', 'balance').text('🛒 Buy LABUBU', 'buy');
  return kb;
}

function createBot() {
  // grammy bundles node-fetch, which ignores the sandbox egress proxy and
  // fails TLS (EPROTO). proxyFetch() bridges to Node's built-in fetch
  // (proxy-aware) and converts grammy's AbortSignal to a real one.
  if (!process.env.NODE_USE_ENV_PROXY) process.env.NODE_USE_ENV_PROXY = '1';
  const bot = new Bot(config.botToken, { client: { fetch: createProxyFetch() } });

  bot.command('start', async (ctx) => {
    const from = ctx.from;
    let referrerId = null;
    const arg = (ctx.match || '').trim();
    const m = arg.match(/^ref_(\d+)$/);
    if (m) referrerId = parseInt(m[1], 10);
    const user = upsertUser({
      telegram_id: from.id,
      username: from.username,
      first_name: from.first_name,
      referrer_id: referrerId,
    });
    const refLink = `https://t.me/${ctx.me.username}?start=ref_${from.id}`;
    await ctx.reply(
      `🌟 Welcome to LABUBU Verse Mining!\n\n` +
        `Enter the Verse and build your cosmic mining adventure on Telegram.\n\n` +
        `⛏️ Collect LABUBU in the app\n` +
        `💎 Hold LABUBU and earn a share of 1,000,000 LABUBU/day\n` +
        `🎁 Complete missions and earn rewards\n` +
        `👥 Invite friends and grow your crew\n\n` +
        `🪙 Your balance: ${toLabubu(user.balance_nano).toLocaleString()} LABUBU\n\n` +
        `👇 Start your journey with the button below.\n\n` +
        `Your referral link:\n${refLink}`,
      { reply_markup: menuKeyboard() }
    );
  });

  bot.command('balance', async (ctx) => {
    const user = getUser(ctx.from.id);
    if (!user) return ctx.reply('Send /start first.');
    await ctx.reply(
      `💰 Your LABUBU balance: ${toLabubu(user.balance_nano).toLocaleString()} LABUBU\n` +
        `Wallet: ${user.wallet_address || 'not linked — set it in the Mini App'}\n\n` +
        `Withdraw with the Mini App (minimum ${config.withdrawMin.toLocaleString()} LABUBU — you must keep ${config.withdrawHoldRate * 100}% of the amount in your balance, e.g. withdrawing 10,000 needs 12,500 balance).`
    );
  });

  bot.command('buy', async (ctx) => {
    if (!config.treasuryAddress) {
      return ctx.reply(
        '🛒 Buying is not open yet — the sale wallet is still being set up. Please check back soon.'
      );
    }
    const memo = memoFor(ctx.from.id);
    await ctx.reply(
      `🛒 Buy LABUBU (manual direct sale)\n\n` +
        `Rate: 1 GRAM = ${config.saleRate.toLocaleString()} LABUBU\n` +
        `Minimum: ${config.saleMinGram} GRAM\n\n` +
        `1. Send GRAM to:\n${config.treasuryAddress}\n\n` +
        `2. Put this exact comment/memo on the transfer:\n${memo}\n\n` +
        `3. The owner sends your LABUBU manually to your linked wallet after the GRAM arrives (usually within a few hours). Make sure your TON wallet is linked in the Mini App (Wallet tab) so the owner knows where to send it.\n` +
        `Send GRAM only from a wallet where you control the comment field.`
    );
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(
      `LABUBU Mining — help\n\n` +
        `/start — register & open the menu\n` +
        `/balance — your in-bot LABUBU balance\n` +
        `/buy — how to buy LABUBU with GRAM\n` +
        `/help — this message\n\n` +
        `Mining: start an 8h farming session in the Mini App (25 LABUBU/hour, Level 1 free = 600/day), claim when it ends.\n` +
        `Referrals: 10% of what your friends farm goes to you.\n` +
        `Hold-to-earn: hold any LABUBU in your TON wallet — your daily share depends on your level (Lv1 x1, Lv2 x2, Lv3 x3, Lv4 x5, Lv5 x10). No minimum hold.\n` +
        `Withdraw: request in the Mini App; the admin approves manually in v1.`
    );
  });

  bot.callbackQuery('balance', async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = getUser(ctx.from.id);
    await ctx.reply(
      user
        ? `💰 Balance: ${toLabubu(user.balance_nano).toLocaleString()} LABUBU`
        : 'Send /start first.'
    );
  });

  bot.callbackQuery('buy', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply('Use /buy for the purchase instructions.');
  });

  // --- Admin: withdraw approval (v1 = manual send after approval) ---
  function isAdmin(ctx) {
    // ADMIN_TELEGRAM_ID may hold several comma-separated owner IDs.
    const ids = String(config.adminTelegramId || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return ids.length > 0 && ids.includes(String(ctx.from.id));
  }

  bot.command('approve_withdraw', async (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply('Not authorized.');
    const id = parseInt((ctx.match || '').trim(), 10);
    const w = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(id);
    if (!w || w.status !== 'pending') return ctx.reply(`Withdrawal #${id} not found or not pending.`);
    db.prepare(
      "UPDATE withdrawals SET status = 'approved', decided_at = ?, decided_by = ? WHERE id = ?"
    ).run(Date.now(), ctx.from.id, id);
    await ctx.reply(
      `✅ Withdrawal #${id} APPROVED.\n` +
        `Send ${toLabubu(w.amount_nano).toLocaleString()} LABUBU to ${w.address} from the treasury wallet, ` +
        `then tell the user. (v1 does not auto-send Jettons — that needs a dedicated treasury key on the server.)`
    );
    try {
      await ctx.api.sendMessage(
        w.user_id,
        `✅ Your withdrawal #${id} (${toLabubu(w.amount_nano).toLocaleString()} LABUBU) was approved. The tokens will be sent to ${w.address} shortly.`
      );
    } catch {
      /* user may have blocked the bot */
    }
  });

  bot.command('reject_withdraw', async (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply('Not authorized.');
    const id = parseInt((ctx.match || '').trim(), 10);
    const w = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(id);
    if (!w || w.status !== 'pending') return ctx.reply(`Withdrawal #${id} not found or not pending.`);
    runTransaction(() => {
      db.prepare(
        "UPDATE withdrawals SET status = 'rejected', decided_at = ?, decided_by = ? WHERE id = ?"
      ).run(Date.now(), ctx.from.id, id);
      db.prepare('UPDATE users SET balance_nano = balance_nano + ? WHERE telegram_id = ?').run(
        w.amount_nano,
        w.user_id
      );
    });
    await ctx.reply(`❌ Withdrawal #${id} rejected and refunded to the user's in-bot balance.`);
  });

  bot.catch((err) => {
    console.error('[bot] error:', err.message);
  });

  return bot;
}

module.exports = { createBot };
