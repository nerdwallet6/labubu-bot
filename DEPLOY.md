# Deploy LABUBU bot + Mini App ke Render (gratis)

Bot dan Mini App sudah jadi dan jalan di server ini, tapi Mini App butuh URL
publik (https) supaya bisa dibuka di dalam Telegram. Server ini tidak bisa
memberi URL publik — Cloudflare Tunnel dan localtunnel dua-duanya diblokir
oleh batasan jaringan server (POST ke luar digantung; tunnel tidak bisa dibuat).

## Cara deploy (sekali saja)

1. Buat akun gratis di https://render.com (bisa login pakai GitHub).
2. Upload kode bot ini ke repo GitHub (privat boleh):
   - folder `labubu-bot/` — JANGAN ikutsertakan file `.env` (ada token bot).
   - file yang wajib ada: `package.json`, `src/`, `public/`, `render.yaml`.
3. Di Render: New → Web Service → pilih repo GitHub itu.
   - Render membaca `render.yaml` otomatis.
   - Isi secret env var `BOT_TOKEN` (token dari BotFather) di dashboard Render.
   - Deploy.
4. Setelah deploy pertama berhasil, catat URL service-nya, misal
   `https://labubu-bot.onrender.com`.
5. Di dashboard Render, set env var `MINI_APP_URL` ke URL itu, lalu
   "Manual Deploy" sekali lagi (redeploy).
6. Selesai: buka bot @LabubuVerseMiningbot, kirim `/start`, tombol
   "⛏️ Open Mining App" muncul.

## Catatan

- Render gratis: server tidur setelah ~15 menit tidak ada trafik (bangun lagi
  saat ada yang buka, agak lambat di awal), dan database SQLite terhapus
  setiap restart/redeploy. Untuk produksi: tambah persistent disk (berbayar)
  atau pindah database ke Turso.
- Kalau mau saya yang deploy-kan: buat akun Render, buat API key di
  Account Settings → API Keys, kirim key-nya lewat jalur aman, dan saya
  yang deploy + isi MINI_APP_URL-nya.
- Bot yang jalan di server ini tetap aktif sampai deploy Render selesai.
