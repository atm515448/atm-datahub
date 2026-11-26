# Before ANY real customer money

- [ ] The VTpass and Paystack adapters were written from public docs and are UNTESTED against the real services. Test every
      service (data, airtime, electricity, cable, exam) in the SANDBOX with test keys, including a failed and a pending order.
- [ ] Fill VTPASS_PLANMAP / DISCOMAP / CABLEMAP so each plan id maps to a real provider code. Unmapped plans will fail (and refund).
- [ ] In Admin > Prices replace the illustrative costs with your provider's real prices so you do not sell at a loss.
- [ ] Fund a wallet with Paystack test card, confirm webhook credits exactly once.
- [ ] Use a strong ADMIN_PASSWORD and PIN; change defaults; HTTPS only.
- [ ] Persistent disk + off-server backups of data/db.json. Consider moving to PostgreSQL as users grow.
- [ ] Legal: register the business (CAC), get advice from a lawyer/accountant on holding customer wallet balances, tax, and NDPA 2023 data protection.
- [ ] Publish Terms/Privacy; never sell customers' personal data.
- [ ] Start small: 5-10 real users, watch Admin > Orders daily for pending items.
