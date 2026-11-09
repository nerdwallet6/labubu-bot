/**
 * auth.js — Telegram Mini App initData validation.
 * Per Telegram docs: secret = HMAC_SHA256(bot_token, "WebAppData"),
 * hash = HMAC_SHA256(secret, data_check_string) where data_check_string is
 * the sorted key=<value> pairs (excluding `hash`) joined with "\n".
 * Also rejects initData older than 24h.
 */
const crypto = require('crypto');
const config = require('./config');

function validateInitData(initData) {
  if (!initData || typeof initData !== 'string') return null;
  let params;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return null;
  }
  const receivedHash = params.get('hash');
  if (!receivedHash) return null;

  const pairs = [];
  for (const [key, value] of params.entries()) {
    if (key === 'hash') continue;
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const secret = crypto.createHmac('sha256', 'WebAppData').update(config.botToken).digest();
  const computed = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');

  let equal = false;
  try {
    equal = crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(receivedHash));
  } catch {
    equal = false;
  }
  if (!equal) return null;

  // Freshness: auth_date must be within the last 24 hours.
  const authDate = parseInt(params.get('auth_date') || '0', 10);
  if (!authDate || Date.now() / 1000 - authDate > 24 * 3600) return null;

  let user = null;
  try {
    user = JSON.parse(params.get('user') || 'null');
  } catch {
    return null;
  }
  if (!user || !user.id) return null;
  return user; // { id, first_name, username, ... }
}

module.exports = { validateInitData };
