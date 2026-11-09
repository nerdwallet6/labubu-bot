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
  farmRatePerHour: 100, // LABUBU per hour (base rate)
  referralRate: 0.10, // referrer earns 10% of referred friend's farmed amount

  // --- Hold-to-earn ---
  // Fixed daily pool: 1,000,000 LABUBU/day from the 200M pool over 200 days.
  holdDailyPool: 1_000_000, // LABUBU per day
  holdPoolTotal: 200_000_000, // LABUBU total for hold-to-earn
  holdMinBalance: 1_000_000, // minimum LABUBU held to qualify
  // Distribution runs daily at 00:00 UTC: distribute yesterday (min of
  // start/end balance), then snapshot today's start balances.

  // --- Tasks (seeded defaults; rewards in LABUBU) ---
  dailyCheckinReward: 50,

  // --- Withdraw ---
  withdrawMin: 10_000, // minimum withdrawal, LABUBU
  withdrawMinHold: 2_500, // must hold this much LABUBU on-chain (linked wallet) to withdraw

  // --- TonAPI (public, no key) ---
  tonApiBase: 'https://tonapi.io/v2',

  // --- DB ---
  dbPath: require('path').join(__dirname, '..', 'data', 'labubu.db'),

  NANO,
};

module.exports = config;
