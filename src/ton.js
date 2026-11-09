/**
 * ton.js — read-only helpers for the TON blockchain via TonAPI (public, no key).
 * Never sends transactions and never handles private keys.
 */
const config = require('./config');

async function fetchJson(url, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`TonAPI HTTP ${res.status} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/**
 * On-chain LABUBU balance of a TON wallet address, in nano-LABUBU.
 * Returns null when the address has no LABUBU wallet or the lookup fails.
 */
async function getJettonBalanceNano(ownerAddress) {
  const url = `${config.tonApiBase}/accounts/${encodeURIComponent(ownerAddress)}/jettons/${config.jettonMaster}`;
  const data = await fetchJson(url);
  if (!data || typeof data.balance === 'undefined') return null;
  const n = BigInt(data.balance);
  return n > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(n);
}

/**
 * Recent transactions of an account (newest first).
 * Returns the raw TonAPI `transactions` array (possibly empty).
 */
async function getAccountTransactions(address, limit = 20) {
  // Note: the transactions endpoint lives under /blockchain/accounts/...,
  // not /accounts/... (the latter 404s with "404 page not found").
  const url = `${config.tonApiBase}/blockchain/accounts/${encodeURIComponent(address)}/transactions?limit=${limit}`;
  const data = await fetchJson(url);
  return Array.isArray(data.transactions) ? data.transactions : [];
}

/**
 * Extract a text comment from a TonAPI transaction's incoming message.
 * TonAPI v2 puts it in in_msg.decoded.comment for text comments.
 * Falls back to decoding a base64 body as UTF-8 text.
 */
function extractComment(tx) {
  const msg = tx && tx.in_msg;
  if (!msg) return '';
  if (msg.decoded && typeof msg.decoded.comment === 'string') return msg.decoded.comment;
  if (typeof msg.comment === 'string') return msg.comment;
  if (typeof msg.raw_body === 'string') {
    try {
      const buf = Buffer.from(msg.raw_body, 'base64');
      // Text comment cells start with a 32-bit zero op; strip it.
      if (buf.length > 4 && buf.readUInt32BE(0) === 0) {
        return buf.slice(4).toString('utf8').replace(/\0+$/g, '');
      }
      return buf.toString('utf8').replace(/\0+$/g, '');
    } catch {
      return '';
    }
  }
  return '';
}

/** Very small TON address sanity check (raw or user-friendly form). */
function isTonAddress(addr) {
  if (typeof addr !== 'string') return false;
  return /^(EQ|UQ|0:)[A-Za-z0-9_-]{46,48}$/.test(addr.trim());
}

module.exports = { getJettonBalanceNano, getAccountTransactions, extractComment, isTonAddress };
