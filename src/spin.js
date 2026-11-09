/**
 * spin.js — Daily Spin roll.
 *
 * Prizes are cumulative thresholds on a roll in [0,100): the roll wins the
 * FIRST prize whose `chance` it is under. So the chance of winning AT LEAST
 * a prize is exactly its listed chance (10,000 at 0.1%, 25 at 80%), and a
 * roll >= 80 wins nothing (20% of spins).
 * `randomInt` is injectable for tests (defaults to crypto.randomInt).
 */
const crypto = require('crypto');
const config = require('./config');

function rollSpin(randomInt = crypto.randomInt) {
  const roll = randomInt(0, 100000) / 1000; // [0, 100) with 3 decimals
  for (const p of config.spinPrizes) {
    if (roll < p.chance) return { prize: p.amount, roll };
  }
  return { prize: 0, roll };
}

module.exports = { rollSpin };
