/**
 * config.js — all tunable constants in one place.
 * Amounts of LABUBU are stored in the DB as integers in nano-LABUBU
 * (1 LABUBU = 1e9 units), to avoid floating point errors.
 */
require('dotenv').config();

const NANO = 1_000_000_000;

function envInt(name, fallback) {
  const v = parseInt(process.env[name] || '', 10);
  return Number.isFinite(v) ? v : fallback;
}

const config = {
  // --- Telegram / server ---
  botToken: process.env.BOT_TOKEN || '',
  botUsername: (process.env.BOT_USERNAME || '').replace(/^@/, ''),
  adminTelegramId: process.env.ADMIN_TELEGRAM_ID || '',
  port: envInt('PORT', 3000),
  runBot: (process.env.RUN_BOT || 'true').toLowerCase() !== 'false',
  miniAppUrl: (process.env.MINI_APP_URL || '').trim(),

  // --- Token (verified on-chain) ---
  jettonMaster: process.env.JETTON_MASTER || 'EQC4E35T2HhooVyuKj5I6OEh7JH4sFvxvkyHVqKnAiOsrWEN',
  tokenName: 'LABUBU VERSE',
  tokenSymbol: 'LABUBU',
  tokenDecimals: 9,
  totalSupply: 1_000_000_000, // LABUBU

  // --- Manual direct sale: 1 GRAM = 2,500 LABUBU (owner decision) ---
  saleRate: 2500, // LABUBU per 1 GRAM (TON)
  saleMinGram: 0.1, // minimum buy, in GRAM
  treasuryAddress: (process.env.TREASURY_ADDRESS || '').trim(),

  // --- Allocation draft (NOT confirmed by owner; constants only) ---
  allocation: {
    mining: 500_000_000,
    holdToEarn: 200_000_000,
    directSale: 150_000_000,
    lpLater: 100_000_000,
    team: 50_000_000,
  },

  // --- Farming ---
  farmDurationMs: 8 * 60 * 60 * 1000, // 8 hours per session
  farmRatePerHour: 25, // LABUBU per hour, Level 1 (free) = 600/day (25 x 24h); 200 per 8h session
  referralRate: 0.10, // referrer earns 10% of referred friend's farmed amount

  // --- Hold-to-earn (LEVEL-BASED, like Rifty) ---
  // Fixed daily pool: 1,000,000 LABUBU/day from the 200M pool over 200 days.
  // NO minimum hold: any on-chain LABUBU balance > 0 earns a share.
  // The pool is split proportionally by weight = min(start,end) balance
  // x the holder's LEVEL multiplier. Level is based on in-bot balance
  // (same LEVELS as the Mini App): Bronze 0, Silver 1,000, Gold 10,000,
  // Diamond 100,000, Master 1,000,000.
  holdDailyPool: 1_000_000, // LABUBU per day
  holdPoolTotal: 200_000_000, // LABUBU total for hold-to-earn
  holdLevels: [
    { level: 1, name: 'Bronze', minBalance: 0, multiplier: 1 },
    { level: 2, name: 'Silver', minBalance: 1_000, multiplier: 2 },
    { level: 3, name: 'Gold', minBalance: 10_000, multiplier: 3 },
    { level: 4, name: 'Diamond', minBalance: 100_000, multiplier: 5 },
    { level: 5, name: 'Master', minBalance: 1_000_000, multiplier: 10 },
  ],
  // Distribution runs daily at 00:00 UTC: distribute yesterday (min of
  // start/end balance), then snapshot today's start balances.

  // --- Tasks (seeded defaults; rewards in LABUBU) ---
  dailyCheckinReward: 50,

  // --- Withdraw ---
  withdrawMin: 10_000, // minimum withdrawal, LABUBU
  // Must keep 25% of the withdrawal amount in the account balance:
  // withdraw 10,000 needs balance >= 12,500 (2,500 stays as hold).
  withdrawHoldRate: 0.25,

  // --- TonAPI (public, no key) ---
  tonApiBase: 'https://tonapi.io/v2',

  // --- DB ---
  dbPath: require('path').join(__dirname, '..', 'data', 'labubu.db'),

  NANO,
};

module.exports = config;
