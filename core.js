/* ATM DataHub core engine - runs in Node (real server) and in the browser (preview mode).
   All money is stored as integer KOBO. Never trust the client: price, tier and balance come from here. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('crypto').webcrypto);
  else root.DHCore = factory(root.crypto);
})(typeof self !== 'undefined' ? self : this, function (wc) {
  'use strict';
  const subtle = wc.subtle;
  const enc = new TextEncoder();
  const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
  const unhex = h => new Uint8Array(h.match(/../g).map(x => parseInt(x, 16)));
  const b64u = b => { let s = ''; new Uint8Array(b).forEach(c => s += String.fromCharCode(c)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const b64uStr = s => b64u(enc.encode(s));
  const fromB64uStr = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return new TextDecoder().decode(Uint8Array.from(atob(s), c => c.charCodeAt(0))); };
  const rnd = n => hex(wc.getRandomValues(new Uint8Array(n)));
  const digits = n => { let s = ''; const a = wc.getRandomValues(new Uint8Array(n)); a.forEach(x => s += (x % 10)); return s; };

  /* ---------- catalog ---------- */
  const NETS = [
    { id: 'mtn', n: 'MTN', c: '#f5c400' }, { id: 'airtel', n: 'Airtel', c: '#e4002b' },
    { id: 'glo', n: 'Glo', c: '#2ea84a' }, { id: '9mobile', n: '9mobile', c: '#0a7d3b' }
  ];
  const NETM = { mtn: 1, airtel: .97, glo: .94, '9mobile': 1.04 };
  /* [label, MB, days, base cost naira] - ILLUSTRATIVE: replace with your provider's real prices in Admin > Prices */
  const BASE = [['500MB', 500, 1, 150], ['1GB', 1000, 1, 270], ['1.5GB', 1500, 7, 400], ['3GB', 3000, 7, 770],
    ['2GB', 2000, 30, 700], ['5GB', 5000, 30, 1500], ['10GB', 10000, 30, 2700], ['20GB', 20000, 30, 5000], ['40GB', 40000, 30, 9500]];
  const DTYPES = { SME: 1, Gifting: 1.08, Corporate: .97 };
  const PREFIX = {
    mtn: ['0803', '0806', '0703', '0706', '0813', '0816', '0810', '0814', '0903', '0906', '0913', '0916', '0704'],
    airtel: ['0802', '0808', '0708', '0812', '0701', '0902', '0901', '0907', '0912'],
    glo: ['0805', '0807', '0705', '0815', '0811', '0905', '0915'],
    '9mobile': ['0809', '0818', '0817', '0909', '0908']
  };
  const DISCOS = ['Ikeja Electric (IKEDC)', 'Eko Electric (EKEDC)', 'Abuja (AEDC)', 'Kano (KEDCO)', 'Kaduna (KAEDCO)', 'Port Harcourt (PHED)', 'Ibadan (IBEDC)', 'Enugu (EEDC)', 'Benin (BEDC)', 'Jos (JED)', 'Yola (YEDC)'];
  const CABLE = [
    { id: 'dstv-padi', p: 'DStv', n: 'Padi', cost: 4400 }, { id: 'dstv-yanga', p: 'DStv', n: 'Yanga', cost: 6000 }, { id: 'dstv-confam', p: 'DStv', n: 'Confam', cost: 11000 }, { id: 'dstv-compact', p: 'DStv', n: 'Compact', cost: 19000 },
    { id: 'gotv-smallie', p: 'GOtv', n: 'Smallie', cost: 1900 }, { id: 'gotv-jinja', p: 'GOtv', n: 'Jinja', cost: 3900 }, { id: 'gotv-jolli', p: 'GOtv', n: 'Jolli', cost: 5800 }, { id: 'gotv-max', p: 'GOtv', n: 'Max', cost: 8500 },
    { id: 'st-nova', p: 'StarTimes', n: 'Nova', cost: 1900 }, { id: 'st-basic', p: 'StarTimes', n: 'Basic', cost: 3700 }, { id: 'st-smart', p: 'StarTimes', n: 'Smart', cost: 4700 }, { id: 'st-classic', p: 'StarTimes', n: 'Classic', cost: 6200 }
  ];
  const EXAM = [{ id: 'waec', n: 'WAEC Result Checker PIN', cost: 3400 }, { id: 'neco', n: 'NECO Result Token', cost: 1300 }, { id: 'nabteb', n: 'NABTEB Result Checker', cost: 1100 }];
  const TIERS = ['user', 'agent', 'reseller'];
  const r5 = x => Math.ceil(x / 5) * 5;
  const K = n => Math.round(n * 100);

  function defCfg() {
    return {
      secret: rnd(32), brand: 'ATM DataHub', support: '08133515448', mode: 'preview',
      margin: { user: .08, agent: .05, reseller: .03 }, airDisc: { user: .02, agent: .03, reseller: .04 },
      fee: { elec: 0, cable: 0 }, minFund: 100, maxFund: 500000, dailyLimit: { user: 200000, agent: 1000000, reseller: 5000000 },
      off: {}, priceOver: {}, upgrade: { agent: 2000, reseller: 10000 }, maintenance: false, notice: ''
    };
  }
  const emptyDB = () => ({ v: 2, cfg: defCfg(), users: {}, phones: {}, tx: [], led: [], idem: {}, fund: {}, seq: 1000, later: [], ben: {}, borrow: {}, savings: {}, log: [] });

  /* ---------- engine ---------- */
  function create(opts) {
    const store = opts.store; // {db, save()}
    const provider = opts.provider; // {name, live, buy(o), query(ref), verify(o), balance()}
    const gateway = opts.gateway; // {name, live, init(o), verify(ref), parseWebhook(raw, sig)}
    const now = opts.now || (() => Date.now());
    const db = () => store.db;
    const cfg = () => db().cfg;
    const E = (status, msg, extra) => ({ status, json: Object.assign({ ok: false, error: msg }, extra || {}) });
    const OK = (data, status) => ({ status: status || 200, json: Object.assign({ ok: true }, data || {}) });

    /* --- crypto --- */
    async function pbk(secret, salt) {
      const k = await subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
      return hex(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex(salt), iterations: opts.iter || 100000 }, k, 256));
    }
    async function mkHash(secret) { const salt = rnd(16); return salt + ':' + await pbk(secret, salt); }
    async function chkHash(secret, stored) {
      if (!stored) return false; const [salt, h] = stored.split(':'); const x = await pbk(secret, salt);
      let d = 0; for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ h.charCodeAt(i); return d === 0 && x.length === h.length;
    }
    async function hmac(key, data) { const k = await subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return b64u(await subtle.sign('HMAC', k, enc.encode(data))); }
    async function signTok(p) { const h = b64uStr('{"alg":"HS256"}'), b = b64uStr(JSON.stringify(p)); return h + '.' + b + '.' + await hmac(cfg().secret, h + '.' + b); }
    async function readTok(t) {
      try { const [h, b, s] = String(t).split('.'); if (!s || await hmac(cfg().secret, h + '.' + b) !== s) return null; const p = JSON.parse(fromB64uStr(b)); return p.exp > now() ? p : null; } catch (e) { return null; }
    }

    /* --- helpers --- */
    const normPhone = p => { p = String(p || '').replace(/[\s\-()]/g, ''); if (p.startsWith('+234')) p = '0' + p.slice(4); else if (p.startsWith('234') && p.length === 13) p = '0' + p.slice(3); return p; };
    const okPhone = p => /^0[789][01]\d{8}$/.test(p);
    const detectNet = p => { const x = p.slice(0, 4); for (const k in PREFIX) if (PREFIX[k].includes(x)) return k; return null; };
    const uid = () => 'DH' + digits(8);
    function user(id) { return db().users[id]; }
    function pub(u) {
      return { id: u.id, name: u.name, phone: u.phone, email: u.email || '', tier: u.tier, verified: !!u.verified, role: u.role, bal: u.bal, hasPin: !!u.pinHash, created: u.created, ref: u.ref, banned: !!u.banned, savings: (db().savings[u.id] || {}).bal || 0 };
    }
    function post(u, type, amt, note, ref, extra) {
      u.bal += type === 'credit' ? amt : -amt;
      const e = Object.assign({ id: 'L' + (++db().seq), uid: u.id, type, amt, bal: u.bal, note, ref, ts: now() }, extra || {});
      db().led.push(e); return e;
    }
    const audit = (who, act, d) => { db().log.push({ ts: now(), who, act, d }); if (db().log.length > 5000) db().log.splice(0, 1000); };

    /* --- pricing (always server-side) --- */
    function listData(net) {
      const o = cfg().priceOver, off = cfg().off, out = [];
      for (const t in DTYPES) BASE.forEach(([label, mb, days, cost]) => {
        const id = net + '-' + t + '-' + label;
        let c = o[id] != null ? o[id] : r5(cost * NETM[net] * DTYPES[t]);
        out.push({ id, net, type: t, label, mb, days, cost: c, off: !!off[id] });
      }); return out;
    }
    const sell = (cost, tier) => r5(cost * (1 + cfg().margin[tier]));
    const findPlan = id => { const n = id.split('-')[0]; return NETS.some(x => x.id === n) ? listData(n).find(p => p.id === id) : null; };
    const airSell = (amt, tier) => Math.ceil(amt * (1 - cfg().airDisc[tier]));
    const airCost = amt => Math.ceil(amt * (1 - .04 - .01)); // illustrative provider discount; set real value from your provider
    function successRates() {
      const since = now() - 7 * 864e5, r = {};
      NETS.forEach(n => { const t = db().tx.filter(x => x.net === n.id && x.ts > since && (x.status === 'success' || x.status === 'failed')); r[n.id] = t.length >= 10 ? Math.round(100 * t.filter(x => x.status === 'success').length / t.length) : null; });
      return r;
    }
    function catalog(u) {
      const tier = u ? u.tier : 'user';
      return {
        nets: NETS, rates: successRates(), types: Object.keys(DTYPES),
        plans: NETS.reduce((a, n) => (a[n.id] = listData(n.id).filter(p => !p.off).map(p => ({ id: p.id, type: p.type, label: p.label, mb: p.mb, days: p.days, price: sell(p.cost, tier) * 100 })), a), {}),
        discos: DISCOS, cable: CABLE.map(c => ({ id: c.id, p: c.p, n: c.n, price: sell(c.cost, tier) * 100 })),
        exam: EXAM.map(c => ({ id: c.id, n: c.n, price: sell(c.cost, tier) * 100 })),
        airDisc: cfg().airDisc[tier], upgrade: cfg().upgrade
      };
    }

    /* --- auth guards --- */
    async function authUser(h) {
      const t = (h.authorization || h.Authorization || '').replace(/^Bearer /, ''); const p = await readTok(t); if (!p) return null;
      const u = user(p.uid); return u && !u.banned ? u : null;
    }
    async function checkPin(u, pin) {
      if (!u.pinHash) return 'Set your transaction PIN first';
      if (u.pinLock && u.pinLock > now()) return 'PIN locked. Try again later';
      if (!/^\d{4}$/.test(String(pin || ''))) return 'Enter your 4-digit PIN';
      if (await chkHash(String(pin), u.pinHash)) { u.pinFail = 0; return null; }
      u.pinFail = (u.pinFail || 0) + 1; if (u.pinFail >= 3) { u.pinLock = now() + 15 * 60000; u.pinFail = 0; return 'Wrong PIN. Locked for 15 minutes'; }
      return 'Wrong PIN (' + (3 - u.pinFail) + ' tries left)';
    }
    const dayStart = () => { const d = new Date(now()); d.setHours(0, 0, 0, 0); return d.getTime(); };

    /* --- purchase flow: validate -> debit -> provider -> settle/refund --- */
    function buildOrder(u, b) {
      const tier = u.tier, o = { type: b.type };
      if (b.type === 'data') {
        const p = findPlan(String(b.plan || '')); if (!p || p.off) return { err: 'Plan not available' };
        const ph = normPhone(b.phone); if (!okPhone(ph)) return { err: 'Invalid phone number' };
        Object.assign(o, { net: p.net, phone: ph, plan: p.id, desc: p.net.toUpperCase() + ' ' + p.type + ' ' + p.label + ' (' + p.days + 'd)', price: sell(p.cost, tier), cost: p.cost });
      } else if (b.type === 'airtime') {
        const amt = Math.floor(+b.amount), ph = normPhone(b.phone), net = NETS.some(n => n.id === b.net) ? b.net : null;
        if (!okPhone(ph) || !net) return { err: 'Invalid phone or network' }; if (!(amt >= 50 && amt <= 50000)) return { err: 'Airtime must be N50 - N50,000' };
        Object.assign(o, { net, phone: ph, amount: amt, desc: net.toUpperCase() + ' airtime N' + amt, price: airSell(amt, tier), cost: airCost(amt) });
      } else if (b.type === 'electricity') {
        const amt = Math.floor(+b.amount), m = String(b.meter || '').replace(/\D/g, '');
        if (!DISCOS.includes(b.disco) || m.length < 10 || m.length > 13) return { err: 'Check disco and meter number' }; if (!(amt >= 500 && amt <= 200000)) return { err: 'Amount must be N500 - N200,000' };
        Object.assign(o, { disco: b.disco, meter: m, meterType: b.meterType === 'postpaid' ? 'postpaid' : 'prepaid', amount: amt, phone: normPhone(b.phone) || u.phone, desc: b.disco + ' ' + m, price: amt + cfg().fee.elec, cost: amt });
      } else if (b.type === 'cable') {
        const c = CABLE.find(x => x.id === b.plan), card = String(b.card || '').replace(/\D/g, ''); if (!c || card.length < 8 || card.length > 12) return { err: 'Check package and smartcard' };
        Object.assign(o, { plan: c.id, card, desc: c.p + ' ' + c.n + ' ' + card, price: sell(c.cost, tier) + cfg().fee.cable, cost: c.cost });
      } else if (b.type === 'exam') {
        const x = EXAM.find(e => e.id === b.plan); if (!x) return { err: 'Unknown exam product' };
        Object.assign(o, { plan: x.id, desc: x.n, price: sell(x.cost, tier), cost: x.cost });
      } else return { err: 'Unknown service' };
      if (cfg().off[o.type]) return { err: 'This service is paused. Try again later' };
      return { o };
    }

    async function buy(u, b) {
      if (cfg().maintenance) return E(503, 'System maintenance. Try again soon');
      const key = b.idem ? u.id + ':' + b.idem : null;
      if (key && db().idem[key]) { const t = db().tx.find(x => x.id === db().idem[key]); return OK({ tx: t, dup: true }); }
      const bo = buildOrder(u, b); if (bo.err) return E(400, bo.err);
      const o = bo.o, price = K(o.price), cost = K(o.cost);
      const pe = await checkPin(u, b.pin); if (pe) return E(403, pe);
      const spent = db().tx.filter(t => t.uid === u.id && t.ts >= dayStart() && t.status !== 'failed' && t.status !== 'refunded').reduce((s, t) => s + t.price, 0);
      if (spent + price > K(cfg().dailyLimit[u.tier])) return E(400, 'Daily limit reached for your account tier');
      if (u.bal < price) return E(402, 'Insufficient balance. Fund your wallet', { need: price - u.bal });
      const id = 'T' + (++db().seq), ref = 'DH' + now().toString(36).toUpperCase() + rnd(3).toUpperCase();
      const tx = { id, ref, uid: u.id, type: o.type, net: o.net || null, desc: o.desc, to: o.phone || o.meter || o.card || '', price, cost, status: 'processing', ts: now(), o: o };
      db().tx.push(tx); post(u, 'debit', price, o.desc, ref, { tx: id }); if (key) db().idem[key] = id;
      store.save();
      let r; try { r = await provider.buy(Object.assign({ ref }, o)); } catch (e) { r = { status: 'pending', msg: 'Provider timeout - checking' }; }
      applyResult(u, tx, r); store.save();
      return OK({ tx, bal: u.bal });
    }
    function applyResult(u, tx, r) {
      if (tx.status === 'success' || tx.status === 'failed' || tx.status === 'refunded') return;
      if (r.status === 'success') { tx.status = 'success'; tx.token = r.token || null; tx.prov = r.ref || null; tx.done = now(); tx.msg = r.msg || ''; }
      else if (r.status === 'failed') { tx.status = 'failed'; tx.msg = r.msg || 'Failed'; tx.done = now(); post(u, 'credit', tx.price, 'Refund: ' + tx.desc, tx.ref, { tx: tx.id }); tx.status = 'refunded'; }
      else { tx.status = 'pending'; tx.msg = r.msg || 'Pending'; }
    }
    async function requeryPending() {
      let n = 0;
      for (const tx of db().tx.filter(t => t.status === 'pending')) {
        let r; try { r = await provider.query(tx.ref); } catch (e) { continue; }
        if (r.status !== 'pending') { applyResult(user(tx.uid), tx, r); n++; }
        else if (now() - tx.ts > 6 * 3600e3) { tx.msg = 'Pending over 6 hours - contact support'; }
      }
      if (n) store.save(); return n;
    }

    /* --- wallet funding --- */
    function credit(refId, amtKobo, via) {
      const f = db().fund[refId]; if (!f || f.done) return false;
      if (amtKobo < f.amt) { f.short = amtKobo; return false; }
      f.done = now(); const u = user(f.uid); post(u, 'credit', f.amt, 'Wallet funding (' + via + ')', refId); store.save(); return true;
    }

    /* --- router --- */
    const ROUTES = [];
    const route = (m, p, auth, fn) => ROUTES.push({ m, re: new RegExp('^' + p.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), auth, fn });

    route('GET', '/health', 0, async () => OK({ name: cfg().brand, live: !!(provider.live && gateway.live), provider: provider.name, gateway: gateway.name, mode: cfg().mode }));
    route('POST', '/register', 0, async (c, b) => {
      const name = String(b.name || '').trim().slice(0, 60), ph = normPhone(b.phone), pw = String(b.password || '');
      if (name.length < 3) return E(400, 'Enter your full name'); if (!okPhone(ph)) return E(400, 'Enter a valid Nigerian phone number');
      if (pw.length < 8 || !/\d/.test(pw) || !/[A-Za-z]/.test(pw)) return E(400, 'Password: 8+ characters with letters and numbers');
      if (db().phones[ph]) return E(409, 'This phone number already has an account');
      const id = uid(); const u = { id, name, phone: ph, email: String(b.email || '').trim().slice(0, 80), tier: 'user', role: 'user', bal: 0, created: now(), passHash: await mkHash(pw), ref: id.slice(2), refBy: null };
      if (b.ref) { const r = Object.values(db().users).find(x => x.ref === String(b.ref)); if (r) u.refBy = r.id; }
      db().users[id] = u; db().phones[ph] = id; audit(id, 'register'); store.save();
      return OK({ token: await signTok({ uid: id, exp: now() + 12 * 3600e3 }), user: pub(u) }, 201);
    });
    route('POST', '/login', 0, async (c, b) => {
      const ph = normPhone(b.phone), u = user(db().phones[ph]);
      if (!u) { await pbk('x', rnd(16)); return E(401, 'Wrong phone number or password'); }
      if (u.lock && u.lock > now()) return E(429, 'Too many attempts. Try again in ' + Math.ceil((u.lock - now()) / 60000) + ' min');
      if (!await chkHash(String(b.password || ''), u.passHash)) {
        u.fail = (u.fail || 0) + 1; if (u.fail >= 5) { u.lock = now() + 15 * 60000; u.fail = 0; audit(u.id, 'lockout'); } store.save(); return E(401, 'Wrong phone number or password');
      }
      if (u.banned) return E(403, 'Account suspended. Contact support'); u.fail = 0; u.last = now(); store.save();
      return OK({ token: await signTok({ uid: u.id, exp: now() + 12 * 3600e3 }), user: pub(u) });
    });
    route('GET', '/me', 1, async (c) => OK({ user: pub(c.u), cfg: { support: cfg().support, notice: cfg().notice, brand: cfg().brand, minFund: cfg().minFund, maxFund: cfg().maxFund } }));
    route('GET', '/catalog', 1, async (c) => OK(catalog(c.u)));
    route('POST', '/pin/set', 1, async (c, b) => {
      if (c.u.pinHash) return E(400, 'PIN already set. Use Change PIN');
      if (!/^\d{4}$/.test(String(b.pin || ''))) return E(400, 'PIN must be 4 digits'); if (/^(\d)\1{3}$/.test(b.pin) || b.pin === '1234') return E(400, 'Choose a less obvious PIN');
      c.u.pinHash = await mkHash(String(b.pin)); store.save(); return OK({});
    });
    route('POST', '/pin/change', 1, async (c, b) => {
      const e = await checkPin(c.u, b.old); if (e) return E(403, e); if (!/^\d{4}$/.test(String(b.pin || ''))) return E(400, 'New PIN must be 4 digits');
      c.u.pinHash = await mkHash(String(b.pin)); audit(c.u.id, 'pin-change'); store.save(); return OK({});
    });
    route('POST', '/pin/forgot', 1, async (c, b) => { // re-authenticate with password, then reset PIN
      if (!await chkHash(String(b.password || ''), c.u.passHash)) return E(403, 'Wrong password'); if (!/^\d{4}$/.test(String(b.pin || ''))) return E(400, 'PIN must be 4 digits');
      c.u.pinHash = await mkHash(String(b.pin)); c.u.pinLock = 0; c.u.pinFail = 0; audit(c.u.id, 'pin-reset'); store.save(); return OK({});
    });
    route('POST', '/password/change', 1, async (c, b) => {
      if (!await chkHash(String(b.old || ''), c.u.passHash)) return E(403, 'Wrong current password'); const pw = String(b.password || '');
      if (pw.length < 8 || !/\d/.test(pw) || !/[A-Za-z]/.test(pw)) return E(400, 'Password: 8+ characters with letters and numbers');
      c.u.passHash = await mkHash(pw); c.u.cv = (c.u.cv || 0) + 1; audit(c.u.id, 'pw-change'); store.save(); return OK({});
    });
    route('POST', '/profile', 1, async (c, b) => { if (b.name) c.u.name = String(b.name).trim().slice(0, 60); if (b.email != null) c.u.email = String(b.email).trim().slice(0, 80); store.save(); return OK({ user: pub(c.u) }); });
    route('POST', '/buy', 1, async (c, b) => buy(c.u, b));
    route('POST', '/verify', 1, async (c, b) => { // meter / smartcard name lookup
      try { const r = await provider.verify({ type: b.type, disco: b.disco, meter: String(b.meter || ''), meterType: b.meterType, card: String(b.card || ''), plan: b.plan }); return OK({ name: r.name || '', address: r.address || '' }); } catch (e) { return E(502, 'Could not verify right now'); }
    });
    route('GET', '/tx', 1, async (c, b, q) => {
      let t = db().tx.filter(x => x.uid === c.u.id).slice().reverse(); if (q.type) t = t.filter(x => x.type === q.type);
      const lim = Math.min(+q.limit || 50, 200); return OK({ tx: t.slice(0, lim).map(x => { const y = Object.assign({}, x); delete y.o; return y; }) });
    });
    route('GET', '/tx/:id', 1, async (c, b, q, p) => { const t = db().tx.find(x => x.id === p.id && x.uid === c.u.id); return t ? OK({ tx: t }) : E(404, 'Not found'); });
    route('GET', '/ledger', 1, async (c) => OK({ led: db().led.filter(x => x.uid === c.u.id).slice(-100).reverse() }));
    route('POST', '/fund', 1, async (c, b) => {
      const a = Math.floor(+b.amount); if (!(a >= cfg().minFund && a <= cfg().maxFund)) return E(400, 'Amount must be N' + cfg().minFund + ' - N' + cfg().maxFund);
      const ref = 'F' + now().toString(36).toUpperCase() + rnd(3).toUpperCase(); db().fund[ref] = { uid: c.u.id, amt: K(a), ts: now() };
      try {
        const r = await gateway.init({ ref, amountKobo: K(a), email: c.u.email || (c.u.phone + '@customer.datahub'), name: c.u.name, callback: b.callback });
        if (r.instant) { credit(ref, K(a), gateway.name); return OK({ ref, instant: true, bal: c.u.bal }); }
        store.save(); return OK({ ref, url: r.url });
      } catch (e) { return E(502, 'Payment gateway unavailable'); }
    });
    route('GET', '/fund/verify', 1, async (c, b, q) => {
      const f = db().fund[q.ref]; if (!f || f.uid !== c.u.id) return E(404, 'Unknown reference');
      if (!f.done) { try { const r = await gateway.verify(q.ref); if (r.status === 'success') credit(q.ref, r.amountKobo, gateway.name); } catch (e) { } }
      return OK({ done: !!f.done, bal: c.u.bal });
    });
    route('POST', '/upgrade', 1, async (c, b) => {
      const t = b.tier; if (!cfg().upgrade[t] || TIERS.indexOf(t) <= TIERS.indexOf(c.u.tier)) return E(400, 'Not available');
      const pe = await checkPin(c.u, b.pin); if (pe) return E(403, pe); const fee = K(cfg().upgrade[t]); if (c.u.bal < fee) return E(402, 'Insufficient balance');
      post(c.u, 'debit', fee, 'Upgrade to ' + t, 'UP' + now()); c.u.tier = t; store.save(); return OK({ user: pub(c.u) });
    });
    /* beneficiaries */
    route('GET', '/beneficiaries', 1, async (c) => OK({ list: db().ben[c.u.id] || [] }));
    route('POST', '/beneficiaries', 1, async (c, b) => {
      const ph = normPhone(b.phone), nm = String(b.name || '').trim().slice(0, 40); if (!okPhone(ph) || !nm) return E(400, 'Name and valid phone needed');
      const l = db().ben[c.u.id] = db().ben[c.u.id] || []; if (l.length >= 50) return E(400, 'Limit reached'); if (!l.some(x => x.phone === ph)) l.push({ id: 'B' + (++db().seq), name: nm, phone: ph }); store.save(); return OK({ list: l });
    });
    route('DELETE', '/beneficiaries/:id', 1, async (c, b, q, p) => { db().ben[c.u.id] = (db().ben[c.u.id] || []).filter(x => x.id !== p.id); store.save(); return OK({ list: db().ben[c.u.id] }); });
    /* borrowers (people who owe the user) */
    route('GET', '/borrowers', 1, async (c) => OK({ list: db().borrow[c.u.id] || [] }));
    route('POST', '/borrowers', 1, async (c, b) => {
      const a = Math.floor(+b.amount), nm = String(b.name || '').trim().slice(0, 40); if (!nm || !(a > 0 && a < 1e8)) return E(400, 'Name and amount needed');
      const l = db().borrow[c.u.id] = db().borrow[c.u.id] || []; l.push({ id: 'R' + (++db().seq), name: nm, phone: normPhone(b.phone), amount: K(a), note: String(b.note || '').slice(0, 80), ts: now(), paid: 0 }); store.save(); return OK({ list: l });
    });
    route('POST', '/borrowers/:id/pay', 1, async (c, b, q, p) => {
      const x = (db().borrow[c.u.id] || []).find(r => r.id === p.id); if (!x) return E(404, 'Not found'); const a = b.all ? x.amount - x.paid : K(+b.amount || 0);
      if (a <= 0) return E(400, 'Enter amount'); x.paid = Math.min(x.amount, x.paid + a); store.save(); return OK({ list: db().borrow[c.u.id] });
    });
    route('DELETE', '/borrowers/:id', 1, async (c, b, q, p) => { db().borrow[c.u.id] = (db().borrow[c.u.id] || []).filter(x => x.id !== p.id); store.save(); return OK({ list: db().borrow[c.u.id] }); });
    /* spend & save */
    route('GET', '/spend', 1, async (c) => {
      const m = new Date(now()); m.setDate(1); m.setHours(0, 0, 0, 0); const by = {}, tot = { n: 0 };
      db().tx.filter(t => t.uid === c.u.id && t.ts >= m.getTime() && (t.status === 'success' || t.status === 'pending' || t.status === 'processing')).forEach(t => { by[t.type] = (by[t.type] || 0) + t.price; tot.n += t.price; });
      const s = db().savings[c.u.id] || { bal: 0, goal: 0 }; return OK({ month: by, total: tot.n, savings: s.bal, goal: s.goal });
    });
    route('POST', '/savings', 1, async (c, b) => {
      const s = db().savings[c.u.id] = db().savings[c.u.id] || { bal: 0, goal: 0, h: [] };
      if (b.goal != null) s.goal = K(Math.max(0, +b.goal || 0));
      if (b.move) {
        const a = K(Math.floor(+b.amount || 0)); if (a <= 0) return E(400, 'Enter amount');
        if (b.move === 'in') { if (c.u.bal < a) return E(402, 'Insufficient wallet balance'); const pe = await checkPin(c.u, b.pin); if (pe) return E(403, pe); post(c.u, 'debit', a, 'Moved to savings', 'SV' + now()); s.bal += a; }
        else { if (s.bal < a) return E(400, 'Not enough in savings'); const pe = await checkPin(c.u, b.pin); if (pe) return E(403, pe); s.bal -= a; post(c.u, 'credit', a, 'Withdrawn from savings', 'SV' + now()); }
      }
      store.save(); return OK({ savings: s.bal, goal: s.goal, bal: c.u.bal });
    });
    /* pay later: save an order without paying; buy later with PIN (price re-checked at that time) */
    route('GET', '/later', 1, async (c) => OK({ list: db().later.filter(x => x.uid === c.u.id).map(x => { const bo = buildOrder(c.u, x.b); return { id: x.id, ts: x.ts, desc: bo.o ? bo.o.desc : 'Unavailable', price: bo.o ? K(bo.o.price) : 0, b: x.b }; }) }));
    route('POST', '/later', 1, async (c, b) => {
      const o = Object.assign({}, b); delete o.pin; delete o.idem; const bo = buildOrder(c.u, o); if (bo.err) return E(400, bo.err);
      if (db().later.filter(x => x.uid === c.u.id).length >= 30) return E(400, 'Saved list is full'); db().later.push({ id: 'S' + (++db().seq), uid: c.u.id, ts: now(), b: o }); store.save(); return OK({});
    });
    route('DELETE', '/later/:id', 1, async (c, b, q, p) => { db().later = db().later.filter(x => !(x.id === p.id && x.uid === c.u.id)); store.save(); return OK({}); });
    route('POST', '/later/:id/pay', 1, async (c, b, q, p) => {
      const x = db().later.find(r => r.id === p.id && r.uid === c.u.id); if (!x) return E(404, 'Not found');
      const r = await buy(c.u, Object.assign({}, x.b, { pin: b.pin, idem: b.idem })); if (r.json.ok) { db().later = db().later.filter(y => y.id !== x.id); store.save(); } return r;
    });
    /* profit management: record what you charged your own customer for a purchase */
    route('POST', '/profit/note', 1, async (c, b) => {
      const t = db().tx.find(x => x.id === b.tx && x.uid === c.u.id); if (!t) return E(404, 'Not found'); t.charged = K(Math.max(0, +b.charged || 0)); store.save(); return OK({ tx: t });
    });
    route('GET', '/profit', 1, async (c) => {
      const t = db().tx.filter(x => x.uid === c.u.id && x.status === 'success'); const noted = t.filter(x => x.charged != null);
      const rev = noted.reduce((s, x) => s + x.charged, 0), cst = noted.reduce((s, x) => s + x.price, 0);
      const cm = new Date(now()); cm.setDate(1); cm.setHours(0, 0, 0, 0);
      return OK({ revenue: rev, cost: cst, profit: rev - cst, count: noted.length, unnoted: t.length - noted.length, month: noted.filter(x => x.ts >= cm.getTime()).reduce((s, x) => s + x.charged - x.price, 0) });
    });
    route('GET', '/referrals', 1, async (c) => OK({ code: c.u.ref, count: Object.values(db().users).filter(x => x.refBy === c.u.id).length }));

    /* admin */
    const adm = (m, p, fn) => route(m, '/admin' + p, 2, fn);
    adm('GET', '/stats', async () => {
      const T = db().tx, d0 = dayStart(), ok = T.filter(t => t.status === 'success'), td = ok.filter(t => t.ts >= d0);
      const sum = (a, f) => a.reduce((s, t) => s + f(t), 0);
      let pb = null; try { pb = await provider.balance(); } catch (e) { }
      return OK({ users: Object.keys(db().users).length, wallets: sum(Object.values(db().users), u => u.bal), sales: sum(ok, t => t.price), profit: sum(ok, t => t.price - t.cost), salesToday: sum(td, t => t.price), profitToday: sum(td, t => t.price - t.cost), tx: T.length, pending: T.filter(t => t.status === 'pending').length, failed: T.filter(t => t.status === 'refunded').length, providerBalance: pb, provider: provider.name, gateway: gateway.name, live: !!(provider.live && gateway.live), rates: successRates() });
    });
    adm('GET', '/users', async (c, b, q) => { let l = Object.values(db().users); if (q.q) l = l.filter(u => (u.name + u.phone + u.id).toLowerCase().includes(q.q.toLowerCase())); return OK({ users: l.slice(0, 200).map(pub) }); });
    adm('POST', '/user', async (c, b) => {
      const u = user(b.id); if (!u) return E(404, 'No user'); if (u.role === 'admin' && c.u.id !== u.id) return E(403, 'Cannot modify another admin');
      if (TIERS.includes(b.tier)) u.tier = b.tier; if (b.verified != null) u.verified = !!b.verified; if (b.banned != null) u.banned = !!b.banned;
      audit(c.u.id, 'user-edit', b); store.save(); return OK({ user: pub(u) });
    });
    adm('POST', '/adjust', async (c, b) => {
      const u = user(b.id), a = K(Math.floor(+b.amount)); if (!u || !(a > 0)) return E(400, 'User and amount needed'); const pe = await checkPin(c.u, b.pin); if (pe) return E(403, pe);
      if (b.dir === 'debit' && u.bal < a) return E(400, 'User balance too low'); post(u, b.dir === 'debit' ? 'debit' : 'credit', a, 'Admin: ' + String(b.note || 'adjustment').slice(0, 60), 'ADJ' + now()); audit(c.u.id, 'adjust', b); store.save(); return OK({ user: pub(u) });
    });
    adm('GET', '/tx', async (c, b, q) => { let t = db().tx.slice().reverse(); if (q.status) t = t.filter(x => x.status === q.status); return OK({ tx: t.slice(0, 200).map(x => { const y = Object.assign({}, x); delete y.o; return y; }) }); });
    adm('POST', '/tx/resolve', async (c, b) => { // manual settle of a stuck pending tx
      const t = db().tx.find(x => x.id === b.id); if (!t || t.status !== 'pending') return E(400, 'Not pending'); applyResult(user(t.uid), t, { status: b.result === 'success' ? 'success' : 'failed', msg: 'Resolved by admin' }); audit(c.u.id, 'resolve', b); store.save(); return OK({ tx: t });
    });
    adm('POST', '/requery', async () => OK({ settled: await requeryPending() }));
    adm('GET', '/prices', async () => OK({ margin: cfg().margin, airDisc: cfg().airDisc, over: cfg().priceOver, off: cfg().off, plans: NETS.reduce((a, n) => a.concat(listData(n.id)), []) }));
    adm('POST', '/settings', async (c, b) => {
      const k = cfg(); ['user', 'agent', 'reseller'].forEach(t => { if (b.margin && b.margin[t] != null) k.margin[t] = Math.min(.5, Math.max(0, +b.margin[t])); if (b.airDisc && b.airDisc[t] != null) k.airDisc[t] = Math.min(.1, Math.max(0, +b.airDisc[t])); });
      if (b.priceOver) Object.keys(b.priceOver).forEach(id => { const v = b.priceOver[id]; if (v === null) delete k.priceOver[id]; else if (+v > 0) k.priceOver[id] = Math.round(+v); });
      if (b.off) Object.assign(k.off, b.off); ['maintenance'].forEach(x => { if (b[x] != null) k[x] = !!b[x]; }); if (b.notice != null) k.notice = String(b.notice).slice(0, 200);
      if (b.support) k.support = String(b.support).slice(0, 20); audit(c.u.id, 'settings'); store.save(); return OK({});
    });
    adm('GET', '/export', async () => OK({ tx: db().tx, led: db().led.slice(-2000) }));

    async function handle(method, path, body, headers, query) {
      headers = headers || {}; query = query || {}; body = body || {};
      try {
        if (path.startsWith('/api')) path = path.slice(4);
        for (const r of ROUTES) {
          if (r.m !== method) continue; const m = r.re.exec(path); if (!m) continue;
          const c = {};
          if (r.auth) { c.u = await authUser(headers); if (!c.u) return E(401, 'Please log in'); if (r.auth === 2 && c.u.role !== 'admin') return E(403, 'Admins only'); }
          return await r.fn(c, body, query, m.groups || {});
        }
        return E(404, 'Not found');
      } catch (e) { return E(500, 'Server error'); }
    }

    /* admin bootstrap: creates the first admin from env/config (never ships default credentials in live mode) */
    async function ensureAdmin(phone, password, pin) {
      const ph = normPhone(phone); if (db().phones[ph]) return user(db().phones[ph]);
      const id = uid(); const u = { id, name: 'Admin', phone: ph, tier: 'reseller', role: 'admin', verified: true, bal: 0, created: now(), passHash: await mkHash(password), pinHash: await mkHash(pin), ref: id.slice(2) };
      db().users[id] = u; db().phones[ph] = id; store.save(); return u;
    }
    /* webhook entry used by the server after verifying the gateway signature */
    function webhook(evt) { if (evt && evt.ref) return credit(evt.ref, evt.amountKobo, gateway.name); return false; }

    return { handle, ensureAdmin, webhook, requeryPending, db, catalog, buy };
  }

  /* ---------- PREVIEW-ONLY adapters (clearly fake: they never move real money or data) ---------- */
  const mockProvider = {
    name: 'mock', live: false,
    async buy(o) {
      const k = String(o.phone || o.meter || o.card || '');
      if (k.endsWith('00')) return { status: 'failed', msg: 'Test failure (number ends in 00)' };
      if (k.endsWith('99')) return { status: 'pending', msg: 'Test pending (number ends in 99)' };
      const r = { status: 'success', ref: 'MOCK' + digits(8) };
      if (o.type === 'electricity') r.token = 'MOCK-' + digits(20); if (o.type === 'exam') r.token = 'MOCK-PIN-' + digits(12);
      return r;
    },
    async query() { return { status: 'success' }; },
    async verify(o) { return { name: 'TEST CUSTOMER (preview)', address: 'Preview only' }; },
    async balance() { return null; }
  };
  const mockGateway = { name: 'preview', live: false, async init() { return { instant: true }; }, async verify() { return { status: 'pending' }; } };

  return { create, mockProvider, mockGateway, emptyDB, NETS, PREFIX, detectNet: p => { const x = String(p).slice(0, 4); for (const k in PREFIX) if (PREFIX[k].includes(x)) return k; return null; } };
});
