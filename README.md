# LABUBU Mining Bot — v1

Telegram mining bot for the LABUBU Jetton on TON mainnet.

- **Token:** LABUBU VERSE / LABUBU — Jetton Master
  `EQC4E35T2HhooVyuKj5I6OEh7JH4sFvxvkyHVqKnAiOsrWEN`
  (1,000,000,000 supply, 9 decimals, verified via TonAPI)
- **Sale:** manual direct sale, **1 GRAM = 2,500 LABUBU**, minimum 0.1 GRAM.
  No DEX listing yet.
- **Features:** 8h farming sessions (100 LABUBU/hour), daily check-in + tasks,
  referrals (10% of friends' farmed amount), hold-to-earn (1,000,000 LABUBU/day
  shared proportionally, min hold 1,000,000 LABUBU), manual GRAM buy with
  automatic credit, withdraw queue with admin approval.

> ⚠️ v1 limits, read before using in production:
> - Balances are **in-bot** (SQLite). Withdrawals are queued and approved by
>   the admin manually; **auto-sending Jettons is NOT implemented** — that
>   needs a dedicated treasury wallet whose key lives only on the server.
> - The daily check-in is one claim per UTC day; other tasks are one-time.
> - The buy poller credits only transfers whose comment is exactly
>   `LABUBU-<telegram_id>` and ≥ 0.1 GRAM.
> - SQLite lives in `data/labubu.db`. On free hosting without a persistent
>   disk the file is wiped on redeploy/restart — back it up, or move to an
>   external DB (e.g. Turso free tier) before going live.

## Install

```bash
cd labubu-bot
npm install
cp .env.example .env
# edit .env (see below)
npm start
```

Requires Node.js 24+ (uses the built-in `node:sqlite` module — no native
build step, so `npm install` works on minimal hosts too).

## Configuration (.env)

| Variable | Required | Notes |
|---|---|---|
| `BOT_TOKEN` | yes (unless `RUN_BOT=false`) | From @BotFather. Never share it. |
| `BOT_USERNAME` | recommended | Bot username without `@`, for referral links. |
| `ADMIN_TELEGRAM_ID` | yes for approvals | Your Telegram user id (from @userinfobot). |
| `JETTON_MASTER` | prefilled | LABUBU Jetton master address. |
| `TREASURY_ADDRESS` | for buys | TON wallet receiving GRAM for manual sales. Leave empty until decided — buys will report "not open yet". |
| `MINI_APP_URL` | for the menu button | Public URL of the deployed Mini App (see below). |
| `PORT` | no (default 3000) | API + Mini App server port. |
| `RUN_BOT` | no (default true) | Set `false` to run the API server only (local testing / split hosting). |

Tunable economics live in `src/config.js`: farming rate/duration,
sale rate, hold-to-earn pool, allocation draft. The allocation draft
(mining 50% / hold 20% / direct sale 15% / LP 10% / team 5%) is
**not confirmed by the owner** — change it in `config.js` once decided.

## Set the Mini App as the bot Menu Button

1. Deploy `public/` to any HTTPS host (see hosting below) — the URL must
   serve `index.html`.
2. Set `MINI_APP_URL` to that URL in `.env` and restart.
3. In Telegram, open @BotFather → `/mybots` → your bot → **Bot Settings →
   Menu Button** → **Configure Menu Button** → paste the same URL.
   (Alternatively use `/setmenubutton`.)
4. Users tapping the Menu Button (or the "⛏️ Open Mining App" button in
   `/start`) open the Mini App.

## How the pieces work

- **Bot (grammy, polling):** `/start` (referral via `?start=ref_<id>`),
  `/balance`, `/buy`, `/help`, admin `/approve_withdraw <id>` and
  `/reject_withdraw <id>`.
- **API (express):** `GET /api/health`, `GET /api/me`, `POST /api/farm/start`,
  `POST /api/farm/claim`, `GET /api/tasks`, `POST /api/tasks/:id/claim`,
  `GET /api/referrals`, `GET /api/buy/info`, `POST /api/buy/prepare`,
  `GET /api/hold/status`, `POST /api/hold/link-wallet`,
  `POST /api/withdraw/request`, `GET /api/withdraw/list`.
  All user routes require a valid Telegram `initData` header
  (`x-telegram-init-data`), verified with HMAC-SHA256 per Telegram's
  WebApp spec, and are rate-limited (120 req/min/IP).
- **Hold-to-earn (`src/hold.js`):** daily at 00:00 UTC. Distributes
  yesterday's pool using `min(start-of-day, end-of-day)` on-chain balance,
  so buying just before the snapshot does not game the reward.
  Pool: 1,000,000 LABUBU/day, 200 days, from the 200M allocation.
- **Buy poller (`src/buy.js`):** every 60s, reads the treasury's recent
  transactions via TonAPI (public, no key) and credits matching memos.
- **Farming:** one active session per user, 8h, 100 LABUBU/hour, claim only
  after the session ends. Referrer gets 10% of the farmed amount.

## Free hosting options (honest limits)

- **Render free tier:** web service sleeps after ~15 min of inactivity
  (first request wakes it slowly); 750 free hours/month; **no persistent
  disk on free tier — `data/labubu.db` will be lost on redeploy/restart**
  unless you add a paid disk or use an external DB. Good for a trial.
- **Railway:** free trial credits, then pay-as-you-go; also ephemeral disk
  unless a volume is attached. Good for a trial.
- **VPS (cheapest paid):** ~$4–6/month keeps SQLite on disk and the bot
  always on. This is the realistic option once users arrive.
- **Mini App static hosting:** Netlify / Cloudflare Pages / GitHub Pages
  (free, HTTPS, fine for `public/`). The API + bot still need a server
  above; point `MINI_APP_URL` at the static host and the API base at the
  server (update the `fetch` paths in `public/index.html` if they differ).

## Security notes

- Secrets only from `.env`. Never commit `.env`, never print tokens, keys,
  or mnemonics. `.gitignore` covers `.env` and `data/*.db`.
- The bot never asks users for seed phrases or private keys. Users connect
  wallets with TON Connect / by pasting a public address only.
- Admin commands check `ADMIN_TELEGRAM_ID`.
