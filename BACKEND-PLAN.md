# ATM DataHub: from prototype to real business

This prototype (index.html) is a **demo**. It stores everything in the browser and uses a **simulated provider**. No real money, data or airtime moves. To sell for real you need the pieces below.

## 1. What the prototype already proves
- Customer app: register/login with PIN, wallet, data, airtime, electricity, cable TV, exam PINs, history, receipts (PNG), referral, auto-buy, plan finder, tiers (User / Agent / Reseller), Hausa + English.
- Admin: sales and profit dashboard, users, transactions (resolve pending, refund), price and margin editor, service on/off, announcements, settings.
- Purchase logic: debit first, call provider, auto-refund on failure, pending state resolved later (like a webhook).

## 2. Architecture for the real thing
```
Phone (PWA)  --HTTPS-->  API server  -->  Database (PostgreSQL)
                            |-->  Data/VTU provider API   (buy data, airtime, bills)
                            |-->  Payment gateway         (virtual accounts, webhooks)
                            |-->  SMS / WhatsApp          (OTP, receipts)
Admin web  --HTTPS-->  same API (role: admin, 2FA)
```
Suggested stack: Node.js (Express or Fastify) or Python (FastAPI), PostgreSQL, Redis (queues, rate limits), hosted on a VPS or a managed platform. Keep the PWA front end; replace the `DB` object and `buy()` function with API calls.

## 3. Core tables
users(id, name, phone, pin_hash, tier, status, referrer_id, created_at)
wallets(user_id, balance)  -- derived from the ledger, never edited directly
ledger(id, user_id, amount, type, reference UNIQUE, tx_id, balance_after, created_at)  -- append-only
transactions(id, user_id, service, details JSON, price, cost, status, provider_ref, idempotency_key UNIQUE, created_at)
prices(service, network, plan, cost, margin_user, margin_agent, margin_reseller)
audit_log(id, actor, action, before, after, created_at)

## 4. Purchase flow (the part that must never be wrong)
1. Client sends request with an **idempotency key** (so a double tap cannot buy twice).
2. Server checks PIN and balance, then in ONE database transaction debits the wallet and creates the transaction as `pending`.
3. Server calls the provider with your own unique reference.
4. Provider says success: mark `success`. Says failed: mark `failed` and refund through the ledger. Unclear or timeout: keep `pending`, then **re-query the provider status** until final. Never refund a transaction that may still succeed.
5. Webhooks and callbacks: verify the signature, ignore duplicates.

## 5. Payments and wallet funding
- Use a gateway that offers dedicated virtual accounts per user (examples: Paystack, Flutterwave, Monnify; compare fees, settlement time and approval requirements).
- Credit the wallet only after a verified webhook and by checking the amount with the gateway's API.
- Holding customers' money may need a licence. Get legal advice on how to structure wallets (many resellers rely on the partner's virtual accounts and settle quickly).

## 6. Providers (data, airtime, bills)
Examples of Nigerian VTU/bill API providers: VTpass, Smeplug and others. Compare: wholesale prices, uptime, support, API docs, sandbox, whether they offer exam PINs and electricity. Test in their sandbox first. Keep a **second provider** as a fallback.

## 7. Security checklist
- HTTPS everywhere, hashed PINs (bcrypt/argon2), limit PIN attempts, device/session tokens.
- Admin: 2FA, IP allow-list if possible, every admin action in the audit log.
- Provider and gateway keys only on the server, never in the app.
- Rate limiting, input validation, daily limits for new accounts, alerts for odd activity.
- Backups every day, tested restore, monitoring and alerts (low provider balance, failed purchases rising).

## 8. Legal and business
- Register the business (CAC), bank account in the business name, written terms, refund policy, privacy policy.
- Personal data: follow the Nigeria Data Protection Act 2023 (collect only what you need, protect it, tell users).
- Taxes and licensing depend on your structure. Ask an accountant and a lawyer before launching.

## 9. Pricing and profit
Profit per sale = price - provider cost. Keep a margin high enough to cover failures, gateway fees and support. Agents and resellers get lower margins in exchange for volume. Watch provider price changes daily.

## 10. How ATM DataHub can stand out (execution, not "first in the world")
- Hausa-first and English interface, simple enough for first-time users.
- Exam PINs (WAEC, NECO, NABTEB) next to data: students are your community.
- Plan finder that always shows the cheapest option across networks.
- WhatsApp-ready receipts and a WhatsApp ordering bot.
- Fair agent tiers and referral bonuses.
- Fast support through WhatsApp and honest, automatic refunds.

## 11. Suggested phases
1. Prototype (done): show it to 10 to 20 people, collect feedback.
2. Backend MVP: accounts, wallet, ONE provider, ONE gateway, data + airtime only. Test with 20 trusted users.
3. Add electricity, cable, exam PINs, agents, referral.
4. Add WhatsApp bot, scheduled auto-buy, mobile app wrapper.
5. Scale: second provider, monitoring, support team.
