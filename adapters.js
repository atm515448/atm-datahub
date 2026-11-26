/* Provider + payment-gateway adapters.
   !! VTpass and Paystack adapters were written from public documentation and are UNTESTED against the real services.
   Test them in the providers' SANDBOX first (see docs/GO-LIVE-CHECKLIST.md) before any real customer money. */
const crypto = require('crypto');
const J = async (url, opt) => { const r = await fetch(url, Object.assign({ signal: AbortSignal.timeout(45000) }, opt)); const t = await r.text(); try { return JSON.parse(t); } catch (e) { return { raw: t, http: r.status }; } };

/* ---------- VTpass (draft) ---------- */
function vtpass(env) {
  const base = env.VTPASS_BASE || 'https://sandbox.vtpass.com/api'; // live: https://vtpass.com/api
  const H = { 'api-key': env.VTPASS_API_KEY, 'secret-key': env.VTPASS_SECRET_KEY, 'public-key': env.VTPASS_PUBLIC_KEY, 'Content-Type': 'application/json' };
  const rid = ref => { // VTpass request_id must start with YYYYMMDDHHmm (Lagos time)
    const d = new Date(Date.now() + 3600e3), p = n => String(n).padStart(2, '0');
    return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + p(d.getUTCHours()) + p(d.getUTCMinutes()) + ref;
  };
  const map = r => {
    const st = r && r.content && r.content.transactions && r.content.transactions.status;
    if (r && r.code === '000' && st === 'delivered') return { status: 'success', ref: r.content.transactions.transactionId, token: r.purchased_code || r.token || null };
    if (st === 'failed' || st === 'reversed' || (r && ['016', '040'].includes(r.code))) return { status: 'failed', msg: r.response_description || 'Failed' };
    return { status: 'pending', msg: (r && r.response_description) || 'Pending' };
  };
  const NETID = { mtn: 'mtn', airtel: 'airtel', glo: 'glo', '9mobile': 'etisalat' };
  return {
    name: 'vtpass', live: true,
    async buy(o) {
      let body = { request_id: rid(o.ref) };
      if (o.type === 'airtime') Object.assign(body, { serviceID: NETID[o.net], amount: o.amount, phone: o.phone });
      else if (o.type === 'data') { const e = env.VTPASS_PLANMAP && JSON.parse(env.VTPASS_PLANMAP)[o.plan]; if (!e) throw new Error('No VTpass variation_code mapped for ' + o.plan + ' (set VTPASS_PLANMAP)'); Object.assign(body, { serviceID: e.serviceID, billersCode: o.phone, variation_code: e.code, phone: o.phone }); }
      else if (o.type === 'electricity') Object.assign(body, { serviceID: env.VTPASS_DISCOMAP ? JSON.parse(env.VTPASS_DISCOMAP)[o.disco] : '', billersCode: o.meter, variation_code: o.meterType, amount: o.amount, phone: o.phone });
      else if (o.type === 'cable') { const m = JSON.parse(env.VTPASS_CABLEMAP || '{}')[o.plan]; if (!m) throw new Error('No cable mapping'); Object.assign(body, { serviceID: m.serviceID, billersCode: o.card, variation_code: m.code, phone: env.SUPPORT_PHONE || '08000000000' }); }
      else throw new Error('Service not mapped for provider');
      o._rid = body.request_id; ridStore[o.ref] = body.request_id;
      return map(await J(base + '/pay', { method: 'POST', headers: H, body: JSON.stringify(body) }));
    },
    async query(ref) { return map(await J(base + '/requery', { method: 'POST', headers: H, body: JSON.stringify({ request_id: ridStore[ref] || ref }) })); },
    async verify(o) { const r = await J(base + '/merchant-verify', { method: 'POST', headers: H, body: JSON.stringify({ billersCode: o.meter || o.card, serviceID: '', type: o.meterType }) }); return { name: r.content && r.content.Customer_Name || '' }; },
    async balance() { const r = await J(base + '/balance', { headers: H }); return r.contents ? Math.round(r.contents.balance * 100) : null; }
  };
}
const ridStore = {}; // NOTE: persist request ids in your DB for production (see docs)

/* ---------- Paystack (draft) ---------- */
function paystack(env) {
  const H = { Authorization: 'Bearer ' + env.PAYSTACK_SECRET_KEY, 'Content-Type': 'application/json' };
  return {
    name: 'paystack', live: true,
    async init(o) {
      const r = await J('https://api.paystack.co/transaction/initialize', { method: 'POST', headers: H, body: JSON.stringify({ email: o.email, amount: o.amountKobo, reference: o.ref, callback_url: o.callback || env.PUBLIC_URL, metadata: { name: o.name } }) });
      if (!r.status) throw new Error('paystack init failed'); return { url: r.data.authorization_url };
    },
    async verify(ref) { const r = await J('https://api.paystack.co/transaction/verify/' + encodeURIComponent(ref), { headers: H }); return r.status && r.data.status === 'success' ? { status: 'success', amountKobo: r.data.amount } : { status: 'pending' }; },
    parseWebhook(raw, sig) { // returns event or null. Signature = HMAC-SHA512 of raw body with secret key
      const h = crypto.createHmac('sha512', env.PAYSTACK_SECRET_KEY).update(raw).digest('hex');
      if (!sig || h.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(h), Buffer.from(sig))) return null;
      const e = JSON.parse(raw); return e.event === 'charge.success' ? { ref: e.data.reference, amountKobo: e.data.amount } : {};
    }
  };
}
module.exports = { vtpass, paystack };
