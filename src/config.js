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
    { level: 21, hold: 84420, perHour: 359.1, perDay: 8619 },
    { level: 22, hold: 93986, perHour: 384.5, perDay: 9228 },
    { level: 23, hold: 104114, perHour: 410.5, perDay: 9852 },
    { level: 24, hold: 114810, perHour: 437.1, perDay: 10490 },
    { level: 25, hold: 126079, perHour: 464.3, perDay: 11142 },
    { level: 26, hold: 137926, perHour: 492.0, perDay: 11807 },
    { level: 27, hold: 150356, perHour: 520.3, perDay: 12486 },
    { level: 28, hold: 163373, perHour: 549.1, perDay: 13179 },
    { level: 29, hold: 176981, perHour: 578.5, perDay: 13884 },
    { level: 30, hold: 191185, perHour: 608.4, perDay: 14602 },
    { level: 31, hold: 205990, perHour: 638.8, perDay: 15332 },
    { level: 32, hold: 221398, perHour: 669.8, perDay: 16075 },
    { level: 33, hold: 237415, perHour: 701.3, perDay: 16830 },
    { level: 34, hold: 254044, perHour: 733.2, perDay: 17596 },
    { level: 35, hold: 271289, perHour: 765.6, perDay: 18375 },
    { level: 36, hold: 289154, perHour: 798.5, perDay: 19165 },
    { level: 37, hold: 307641, perHour: 831.9, perDay: 19966 },
    { level: 38, hold: 326755, perHour: 865.8, perDay: 20779 },
    { level: 39, hold: 346500, perHour: 900.1, perDay: 21602 },
    { level: 40, hold: 366877, perHour: 934.9, perDay: 22437 },
    { level: 41, hold: 387892, perHour: 970.1, perDay: 23282 },
    { level: 42, hold: 409547, perHour: 1005.8, perDay: 24138 },
    { level: 43, hold: 431844, perHour: 1041.8, perDay: 25004 },
    { level: 44, hold: 454788, perHour: 1078.4, perDay: 25881 },
    { level: 45, hold: 478382, perHour: 1115.3, perDay: 26768 },
    { level: 46, hold: 502628, perHour: 1152.7, perDay: 27665 },
    { level: 47, hold: 527529, perHour: 1190.5, perDay: 28572 },
    { level: 48, hold: 553088, perHour: 1228.7, perDay: 29489 },
    { level: 49, hold: 579308, perHour: 1267.3, perDay: 30416 },
    { level: 50, hold: 606192, perHour: 1306.4, perDay: 31353 },
    { level: 51, hold: 633742, perHour: 1345.8, perDay: 32299 },
    { level: 52, hold: 661962, perHour: 1385.6, perDay: 33255 },
    { level: 53, hold: 690854, perHour: 1425.8, perDay: 34220 },
    { level: 54, hold: 720420, perHour: 1466.4, perDay: 35194 },
    { level: 55, hold: 750663, perHour: 1507.4, perDay: 36178 },
    { level: 56, hold: 781586, perHour: 1548.8, perDay: 37171 },
    { level: 57, hold: 813191, perHour: 1590.5, perDay: 38173 },
    { level: 58, hold: 845480, perHour: 1632.6, perDay: 39183 },
    { level: 59, hold: 878457, perHour: 1675.1, perDay: 40203 },
    { level: 60, hold: 912123, perHour: 1718.0, perDay: 41232 },
    { level: 61, hold: 946480, perHour: 1761.2, perDay: 42269 },
    { level: 62, hold: 981532, perHour: 1804.8, perDay: 43315 },
    { level: 63, hold: 1017280, perHour: 1848.8, perDay: 44370 },
    { level: 64, hold: 1053727, perHour: 1893.0, perDay: 45433 },
    { level: 65, hold: 1090874, perHour: 1937.7, perDay: 46505 },
    { level: 66, hold: 1128725, perHour: 1982.7, perDay: 47585 },
    { level: 67, hold: 1167281, perHour: 2028.0, perDay: 48673 },
    { level: 68, hold: 1206545, perHour: 2073.8, perDay: 49770 },
    { level: 69, hold: 1246518, perHour: 2119.8, perDay: 50875 },
    { level: 70, hold: 1287202, perHour: 2166.2, perDay: 51988 },
    { level: 71, hold: 1328601, perHour: 2212.9, perDay: 53109 },
    { level: 72, hold: 1370715, perHour: 2259.9, perDay: 54238 },
    { level: 73, hold: 1413547, perHour: 2307.3, perDay: 55376 },
    { level: 74, hold: 1457099, perHour: 2355.0, perDay: 56521 },
    { level: 75, hold: 1501373, perHour: 2403.1, perDay: 57674 },
    { level: 76, hold: 1546371, perHour: 2451.5, perDay: 58835 },
    { level: 77, hold: 1592094, perHour: 2500.1, perDay: 60003 },
    { level: 78, hold: 1638545, perHour: 2549.1, perDay: 61179 },
    { level: 79, hold: 1685726, perHour: 2598.5, perDay: 62363 },
    { level: 80, hold: 1733638, perHour: 2648.1, perDay: 63555 },
    { level: 81, hold: 1782283, perHour: 2698.1, perDay: 64754 },
    { level: 82, hold: 1831664, perHour: 2748.4, perDay: 65961 },
    { level: 83, hold: 1881782, perHour: 2799.0, perDay: 67175 },
    { level: 84, hold: 1932638, perHour: 2849.8, perDay: 68396 },
    { level: 85, hold: 1984236, perHour: 2901.0, perDay: 69625 },
    { level: 86, hold: 2036575, perHour: 2952.5, perDay: 70861 },
    { level: 87, hold: 2089659, perHour: 3004.4, perDay: 72105 },
    { level: 88, hold: 2143488, perHour: 3056.5, perDay: 73356 },
    { level: 89, hold: 2198066, perHour: 3108.9, perDay: 74614 },
    { level: 90, hold: 2253392, perHour: 3161.6, perDay: 75879 },
    { level: 91, hold: 2309470, perHour: 3214.6, perDay: 77151 },
    { level: 92, hold: 2366300, perHour: 3268.0, perDay: 78431 },
    { level: 93, hold: 2423885, perHour: 3321.5, perDay: 79717 },
    { level: 94, hold: 2482226, perHour: 3375.5, perDay: 81011 },
    { level: 95, hold: 2541324, perHour: 3429.6, perDay: 82311 },
    { level: 96, hold: 2601182, perHour: 3484.1, perDay: 83618 },
    { level: 97, hold: 2661801, perHour: 3538.9, perDay: 84933 },
    { level: 98, hold: 2723182, perHour: 3593.9, perDay: 86254 },
    { level: 99, hold: 2785327, perHour: 3649.3, perDay: 87582 },
    { level: 100, hold: 2848238, perHour: 3704.8, perDay: 88916 },
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
