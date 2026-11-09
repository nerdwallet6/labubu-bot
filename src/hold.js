/**
 * hold.js — Rifty-style mining levels.
 *
 * The LEVEL is set by WALLET HOLD: how much LABUBU the user holds in their
 * linked TON wallet (on-chain balance). Each level has its own mining rate
 * (see config.miningLevels, copied from Rifty Mining's level table):
 * Lv1 (hold 0) = 25/h = 600/day ... Lv100 (hold 2,848,238) = 3,704.8/h = 88,916/day.
 *
 * A farming session pays its level's perHour rate x 8 hours. The level is
 * read from the chain when a session starts (and shown in the Mini App from
 * /api/hold/status). No wallet linked (or lookup fails) = Lv1.
 *
 * NOTE: the earlier fixed-daily-pool hold-to-earn model (1,000,000/day split
 * by balance x level multiplier) was REPLACED by this Rifty model on
 * 2026-11-09 — the pool distribution is gone; the rate itself is the reward.
 * The hold_snapshots / hold_meta tables remain in the DB schema, unused.
 */
const config = require('./config');

// Tier names for the level table (5 tiers x 20 levels):
// BRONZE 1-20, SILVER 21-40, GOLD 41-60, PLATINUM 61-80, ULTIMATE 81-100.
const TIERS = [
  { name: 'BRONZE', emoji: '🥉', from: 1, to: 20 },
  { name: 'SILVER', emoji: '🥈', from: 21, to: 40 },
  { name: 'GOLD', emoji: '🥇', from: 41, to: 60 },
  { name: 'PLATINUM', emoji: '💎', from: 61, to: 80 },
  { name: 'ULTIMATE', emoji: '👑', from: 81, to: 100 },
];

// Tier row for a level number (1-100). Returns the tier object.
function tierForLevel(level) {
  for (const t of TIERS) {
    if (level >= t.from && level <= t.to) return t;
  }
  return TIERS[TIERS.length - 1];
}

// Level row for a wallet hold (in whole LABUBU). Returns the highest level
// whose hold requirement is met.
function levelForHold(holdLabubu) {
  let cur = config.miningLevels[0];
  for (const l of config.miningLevels) {
    if (holdLabubu >= l.hold) cur = l;
  }
  return cur;
}

// Next level after `level` (null at max level).
function nextLevel(level) {
  return config.miningLevels.find((l) => l.level === level + 1) || null;
}

module.exports = { levelForHold, nextLevel, tierForLevel, TIERS, miningLevels: config.miningLevels };
