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
  referralRate: 0.10, // referrer earns 10% of referred friend's farmed amount

  // --- Rifty-style mining levels (copied from Rifty Mining's level table) ---
  // LEVEL IS SET BY WALLET HOLD (on-chain LABUBU balance). Each level has
  // its own mining rate (LABUBU/hour and /day). Lv1 needs no hold (25/h =
  // 600/day); Lv20 needs 75,411 LABUBU held (334.4/h = 8,025/day).
  // A farming session pays its level's perHour rate x 8 hours.
  miningLevels: [
    { level: 1, hold: 0, perHour: 25.0, perDay: 600 },
    { level: 2, hold: 116, perHour: 28.8, perDay: 690 },
    { level: 3, hold: 533, perHour: 35.6, perDay: 854 },
    { level: 4, hold: 1300, perHour: 44.4, perDay: 1066 },
    { level: 5, hold: 2447, perHour: 54.9, perDay: 1317 },
    { level: 6, hold: 3999, perHour: 66.8, perDay: 1602 },
    { level: 7, hold: 5972, perHour: 79.9, perDay: 1918 },
    { level: 8, hold: 8383, perHour: 94.2, perDay: 2260 },
    { level: 9, hold: 11245, perHour: 109.5, perDay: 2629 },
    { level: 10, hold: 14572, perHour: 125.9, perDay: 3021 },
    { level: 11, hold: 18373, perHour: 143.1, perDay: 3435 },
    { level: 12, hold: 22659, perHour: 161.3, perDay: 3871 },
    { level: 13, hold: 27440, perHour: 180.3, perDay: 4327 },
    { level: 14, hold: 32723, perHour: 200.1, perDay: 4802 },
    { level: 15, hold: 38518, perHour: 220.7, perDay: 5297 },
    { level: 16, hold: 44831, perHour: 242.0, perDay: 5809 },
    { level: 17, hold: 51671, perHour: 264.1, perDay: 6338 },
    { level: 18, hold: 59043, perHour: 286.8, perDay: 6884 },
    { level: 19, hold: 66954, perHour: 310.3, perDay: 7447 },
    { level: 20, hold: 75411, perHour: 334.4, perDay: 8025 },
  ],

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
