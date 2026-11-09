/**
 * index.js — entry point.
 * - Validates config (fails fast with a clear message when BOT_TOKEN is
 *   missing and the bot is supposed to run).
 * - Initializes the DB (importing db.js creates tables + seeds tasks).
 * - Starts the Express API + Mini App server.
 * - Starts the Telegram bot (polling) unless RUN_BOT=false.
 * - Starts the daily hold-to-earn tick (00:00 UTC) and the buy poller.
 */
require('dotenv').config();
const config = require('./config');
require('./db'); // creates tables + seeds tasks
const { createServer } = require('./server');
const { dailyTick } = require('./hold');
const { startBuyPoller } = require('./buy');
const cron = require('node-cron');

function main() {
  if (config.runBot && !config.botToken) {
    console.error(
      'ERROR: BOT_TOKEN is not set.\n' +
        'Copy .env.example to .env and set BOT_TOKEN (from @BotFather),\n' +
        'or run with RUN_BOT=false to start the API server only.'
    );
    process.exit(1);
  }

  const app = createServer();
  const server = app.listen(config.port, () => {
    console.log(`[server] API + Mini App listening on http://localhost:${config.port}`);
    console.log(`[server] health: http://localhost:${config.port}/api/health`);
  });

  if (config.runBot) {
    const { createBot } = require('./bot');
    const bot = createBot();
    bot.start();
    console.log('[bot] polling started.');
    if (!config.miniAppUrl) {
      console.log('[bot] WARNING: MINI_APP_URL is not set — the Mini App button will be hidden until you set it.');
    }
  } else {
    console.log('[bot] RUN_BOT=false — bot polling disabled (API server only).');
  }

  // Daily hold-to-earn: 00:00 UTC.
  cron.schedule('0 0 * * *', () => {
    dailyTick().catch((e) => console.error('[hold] tick error:', e.message));
  });
  console.log('[hold] daily tick scheduled at 00:00 UTC.');

  startBuyPoller();

  const shutdown = () => {
    console.log('\nShutting down...');
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
