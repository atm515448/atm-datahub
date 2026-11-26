# Deploy ATM DataHub (real version)

## 1. Try it on a computer or Termux (TEST mode, no real money)
    node server/server.js
Open http://localhost:3000 . Test admin: 08000000001 / Admin12345 / PIN 4321 (test mode only).
Test numbers: phone ending 00 = fails (auto refund), ending 99 = pending.

## 2. Put it online
Any host that runs Node 18+ (VPS like Contabo/Hetzner/DigitalOcean, or Render/Railway). Needs HTTPS and a DISK THAT PERSISTS
(free tiers wipe the disk = you lose all wallets). Copy this folder, create `.env` from `.env.example`, run `node server/server.js`
behind HTTPS (Caddy or nginx), keep alive with pm2 or systemd. Backups are saved daily in data/backups — copy them off the server.

## 3. Go live ONLY after docs/GO-LIVE-CHECKLIST.md
Set MODE=live in .env. In live mode the app refuses to start without provider keys and admin credentials, and the
TEST banner disappears automatically.

## Paystack webhook
In Paystack dashboard set webhook URL to https://your-domain.com/webhook/paystack
