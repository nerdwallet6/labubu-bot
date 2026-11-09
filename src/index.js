/**
 * index.js — entry point.
 * - Validates config (fails fast with a clear message when BOT_TOKEN is
 *   missing and the bot is supposed to run).
 * - Initializes the DB (importing db.js creates tables + seeds tasks).
 * - Starts the Express API + Mini App server.
 * - Starts the Telegram bot (polling) unless RUN_BOT=false.
 * - Starts the buy poller (manual sale: notifies the admin on GRAM receipt).
 */
require('dotenv').config();
const config = require('./config');
require('./db'); // creates tables + seeds tasks
const { createServer } = require('./server');
const { startBuyPoller } = require('./buy');

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

  let bot = null;
  if (config.runBot) {
    const { createBot } = require('./bot');
    bot = createBot();
    bot.start();
    console.log('[bot] polling started.');
    if (!config.miniAppUrl) {
      console.log('[bot] WARNING: MINI_APP_URL is not set — the Mini App button will be hidden until you set it.');
    }
  } else {
    console.log('[bot] RUN_BOT=false — bot polling disabled (API server only).');
  }

  // (No daily hold tick: Rifty-style levels pay via the mining rate itself.)

  startBuyPoller(bot);

  const shutdown = () => {
    console.log('\nShutting down...');
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
