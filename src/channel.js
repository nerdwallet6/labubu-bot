/**
 * channel.js — check whether a Telegram user joined the official channel.
 *
 * Uses the Bot API getChatMember (GET). The bot must be an admin of the
 * channel, otherwise Telegram answers 403 and the check cannot run.
 *
 * Returns true (member/administrator/creator), false (left/kicked/not a
 * member), or null when the check itself failed.
 * `fetchFn` is injectable for tests (defaults to global fetch).
 */
async function checkChannelMember(botToken, channelUsername, telegramId, fetchFn = fetch) {
  if (!botToken || !channelUsername) return null;
  try {
    const url =
      `https://api.telegram.org/bot${botToken}/getChatMember` +
      `?chat_id=@${channelUsername}&user_id=${telegramId}`;
    const res = await fetchFn(url);
    const data = await res.json().catch(() => null);
    if (!data || !data.ok) return null;
    const status = data.result && data.result.status;
    return status === 'member' || status === 'administrator' || status === 'creator';
  } catch {
    return null;
  }
}

module.exports = { checkChannelMember };
