/* ATM DataHub front end. Talks to the real server (/api) when present; otherwise runs a clearly-labelled in-browser PREVIEW. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s), app = $('#app');
  const LS = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } } };
  const S = { tok: null, user: null, cat: null, cfg: {}, health: null, lang: LS.get('dh_lang', 'both'), theme: LS.get('dh_theme', 'light'), hide: LS.get('dh_hide', false), idle: null, sel: {} };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const T = (ha, en) => S.lang === 'en' ? en : S.lang === 'ha' || ha === en ? ha : (ha.length <= 22 ? ha + ' / ' + en : en);
  const N = k => '₦' + (k / 100).toLocaleString('en-NG', { minimumFractionDigits: k % 100 ? 2 : 0, maximumFractionDigits: 2 });
  const bal = k => S.hide ? '₦ ••••••' : N(k);
  const dt = ts => new Date(ts).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  document.documentElement.dataset.theme = S.theme === 'auto' ? (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light') : S.theme;

  /* ---------- API: real server or in-browser preview ---------- */
  let PREVIEW = null;
  async function detect() {
    if (S.health) return;
    try { const r = await fetch((window.DATAHUB_API || '') + '/api/health', { cache: 'no-store' }); const j = await r.json(); if (j && j.ok) { S.health = j; return; } } catch (e) { }
    const store = { db: LS.get('dh_preview_db', null) || DHCore.emptyDB(), save() { LS.set('dh_preview_db', store.db); } };
    PREVIEW = DHCore.create({ store, provider: DHCore.mockProvider, gateway: DHCore.mockGateway, iter: 100000 });
    await PREVIEW.ensureAdmin('08000000001', 'Admin12345', '4321');
    S.health = { ok: true, preview: true, live: false, mode: 'preview' };
  }
  async function api(m, p, b, q) {
    const qs = q ? '?' + new URLSearchParams(q) : '';
    if (PREVIEW) { const r = await PREVIEW.handle(m, '/api' + p, b || {}, S.tok ? { authorization: 'Bearer ' + S.tok } : {}, q || {}); return r.json; }
    try {
      const r = await fetch((window.DATAHUB_API || '') + '/api' + p + qs, { method: m, headers: Object.assign({ 'Content-Type': 'application/json' }, S.tok ? { Authorization: 'Bearer ' + S.tok } : {}), body: m === 'GET' ? undefined : JSON.stringify(b || {}) });
      const j = await r.json(); if (r.status === 401 && S.tok) { logout(T('Ka sake shiga', 'Please log in again')); } return j;
    } catch (e) { return { ok: false, error: T('Babu intanet', 'No internet connection') }; }
  }

  /* ---------- helpers ---------- */
  function toast(m) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = m; document.body.appendChild(d); setTimeout(() => d.remove(), 2600); }
  function sheet(html) { closeSheet(); const d = document.createElement('div'); d.className = 'sheetbg'; d.id = 'sh'; d.innerHTML = '<div class="sheet"><button class="x" data-close>✕</button>' + html + '</div>'; d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-close]')) closeSheet(); }); document.body.appendChild(d); return d; }
  function closeSheet() { const d = $('#sh'); if (d) d.remove(); }
  const busy = async (btn, fn) => { if (btn.disabled) return; const t = btn.textContent; btn.disabled = true; btn.textContent = '…'; try { return await fn(); } finally { btn.disabled = false; btn.textContent = t; } };
  const rid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  const ICON = { data: '📶', airtime: '📞', electricity: '💡', cable: '📺', exam: '🎓' };
  const TYN = { data: ['Data', 'Data'], airtime: ['Kati', 'Airtime'], electricity: ['Wuta', 'Electricity'], cable: ['TV', 'Cable TV'], exam: ['Jarrabawa', 'Exam PIN'] };

  /* ---------- session: login required on every open, token kept in memory only ---------- */
  function logout(msg) { S.tok = null; S.user = null; clearTimeout(S.idle); document.body.classList.add('noav'); closeSheet(); renderAuth('login', msg); }
  function bump() { clearTimeout(S.idle); if (S.tok) S.idle = setTimeout(() => logout(T('An fitar da kai saboda rashin amfani', 'Logged out due to inactivity')), 5 * 60000); }
  ['click', 'keydown', 'touchstart'].forEach(ev => document.addEventListener(ev, bump, { passive: true }));
  document.addEventListener('visibilitychange', () => { if (document.hidden && S.tok) S.hiddenAt = Date.now(); else if (S.tok && S.hiddenAt && Date.now() - S.hiddenAt > 2 * 60000) logout(T('Shiga don ci gaba', 'Please log in to continue')); });

  /* ---------- auth screens ---------- */
  function banner() {
    const h = S.health || {};
    return h.preview ? '<div class="banner">PREVIEW MODE — runs only in this browser. No real money, no real data. Connect your server to go live.</div>'
      : (!h.live ? '<div class="banner">TEST MODE — server is running without a real provider/payment gateway. No real money moves.</div>' : '');
  }
  function renderAuth(mode, msg) {
    document.body.classList.add('noav');
    const reg = mode === 'reg';
    app.innerHTML = banner() + '<div class="auth"><img class="logo" src="logo.png" alt="ATM"><h1>ATM DataHub</h1><p>' + T('Data, kati, wuta da TV cikin sauƙi', 'Data, airtime, electricity & TV made easy') + '</p>' +
      '<div class="card">' + (reg ? '<label class="l">' + T('Cikakken suna', 'Full name') + '</label><input id="a_name" autocomplete="name">' : '') +
      '<label class="l">' + T('Lambar waya', 'Phone number') + '</label><input id="a_ph" inputmode="tel" autocomplete="username" placeholder="080xxxxxxxx">' +
      (reg ? '<label class="l">Email (' + T('zaɓi', 'optional') + ')</label><input id="a_em" type="email" autocomplete="email">' : '') +
      '<label class="l">' + T('Kalmar sirri', 'Password') + '</label><div class="ir"><input id="a_pw" type="password" autocomplete="' + (reg ? 'new-password' : 'current-password') + '"><button class="sq" id="a_eye" type="button">👁</button></div>' +
      (reg ? '<div class="mut" style="margin-top:6px">' + T('Haruffa da lambobi, akalla 8', 'Letters + numbers, at least 8') + '</div><label class="l">' + T('Lambar gayyata (zaɓi)', 'Referral code (optional)') + '</label><input id="a_ref">' : '') +
      '<div id="a_err">' + (msg ? '<div class="err">' + esc(msg) + '</div>' : '') + '</div>' +
      '<button class="btn" id="a_go">' + (reg ? T('Buɗe asusu', 'Create account') : T('Shiga', 'Login')) + '</button>' +
      '<button class="btn o" id="a_sw">' + (reg ? T('Ina da asusu — Shiga', 'I have an account — Login') : T('Sabon asusu', 'Create account')) + '</button></div>' +
      (S.health && S.health.preview ? '<div class="mut ctr">Preview admin: 08000000001 / Admin12345</div>' : '') +
      '<div class="mut ctr" style="margin-top:14px">ATM Digital Solutions & Services · 08133515448</div></div>';
    $('#a_eye').onclick = () => { const i = $('#a_pw'); i.type = i.type === 'password' ? 'text' : 'password'; };
    $('#a_sw').onclick = () => renderAuth(reg ? 'login' : 'reg');
    $('#a_go').onclick = e => busy(e.target, async () => {
      const b = { phone: $('#a_ph').value, password: $('#a_pw').value };
      if (reg) { b.name = $('#a_name').value; b.email = $('#a_em').value; b.ref = $('#a_ref').value; }
      const r = await api('POST', reg ? '/register' : '/login', b);
      if (!r.ok) { $('#a_err').innerHTML = '<div class="err">' + esc(r.error) + '</div>'; return; }
      S.tok = r.token; S.user = r.user; bump(); await boot();
    });
  }
  async function boot() {
    const [m, c] = await Promise.all([api('GET', '/me'), api('GET', '/catalog')]); if (!m.ok) return logout(m.error);
    S.user = m.user; S.cfg = m.cfg; S.cat = c; document.body.classList.toggle('noav', false);
    if (!location.hash || location.hash === '#login') location.hash = '#home'; route();
    if (!S.user.hasPin) setTimeout(() => pinSetup(), 400);
  }
  async function refresh() { const m = await api('GET', '/me'); if (m.ok) { S.user = m.user; S.cfg = m.cfg; } const c = await api('GET', '/catalog'); if (c.ok) S.cat = c; }

  /* ---------- shell ---------- */
  function nav(on) {
    const items = [['home', '🏠', T('Gida', 'Home')], ['hist', '🧾', T('Tarihi', 'History')], ['fund', '💰', T('Wallet', 'Wallet')], ['me', '👤', T('Ni', 'Profile')]];
    return '<nav>' + items.map(i => '<button data-go="' + i[0] + '" class="' + (on === i[0] ? 'on' : '') + '"><span>' + i[1] + '</span>' + i[2] + '</button>').join('') + '</nav>';
  }
  function page(title, body, on, back) {
    app.innerHTML = banner() + '<div class="pg"><button data-back>←</button><h1>' + title + '</h1></div><main>' + body + '</main>' + nav(on || '');
    wire();
  }
  function wire() {
    app.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { location.hash = '#' + b.dataset.go; });
    app.querySelectorAll('[data-back]').forEach(b => b.onclick = () => history.length > 1 ? history.back() : location.hash = '#home');
  }
  window.addEventListener('hashchange', () => { if (S.tok) route(); });

  async function route() {
    if (!S.tok) return renderAuth('login');
    const [r, a] = location.hash.slice(1).split('/'); closeSheet();
    const V = { home, data: vData, airtime: vAir, elec: vElec, cable: vCable, exam: vExam, fund: vFund, hist: vHist, rcpt: vRcpt, me: vMe, pw: vPw, pinc: vPinC, pinf: vPinF, spend: vSpend, ben: vBen, profit: vProfit, borrow: vBorrow, later: vLater, upg: vUpg, ref: vRef, admin: vAdmin };
    document.body.classList.remove('noav'); window.scrollTo(0, 0);
    try { await (V[r] || home)(a); } catch (e) { page('Error', '<div class="card">' + esc(e.message) + '</div>'); }
  }

  /* ---------- home ---------- */
  async function home() {
    await refresh(); const u = S.user;
    const t = await api('GET', '/tx', null, { limit: 5 });
    const sv = [['data', '📶', T('Data', 'Data')], ['airtime', '📞', T('Kati', 'Airtime')], ['elec', '💡', T('Wuta', 'Electricity')], ['cable', '📺', T('TV', 'Cable TV')], ['exam', '🎓', T('Jarrabawa', 'Exam PIN')], ['later', '⏰', T('Biya daga baya', 'Pay later')], ['ben', '👥', T('Abokai', 'Beneficiaries')], ['spend', '🐷', T('Kashe & Ajiya', 'Spend & Save')]];
    app.innerHTML = banner() + '<div class="top"><div class="bar"><div class="av">' + esc(u.name[0].toUpperCase()) + '</div><h1>' + T('Sannu', 'Hello') + ', ' + esc(u.name.split(' ')[0]) + '</h1>' + (u.role === 'admin' ? '<button class="ic" data-go="admin">⚙</button>' : '') + '<button class="ic" id="lo">⏻</button></div>' +
      '<div class="wal"><small>' + T('Kuɗin wallet', 'Wallet balance') + '</small><div class="amt"><span id="bv">' + bal(u.bal) + '</span><button class="eye" id="eye">' + (S.hide ? '🙈' : '👁') + '</button></div><div class="btns"><button class="wb" data-go="fund">＋ ' + T('Saka kuɗi', 'Fund wallet') + '</button><button class="wb o" data-go="hist">' + T('Tarihi', 'History') + '</button></div></div></div>' +
      '<main>' + (S.cfg.notice ? '<div class="card">📢 ' + esc(S.cfg.notice) + '</div>' : '') + '<h2>' + T('Ayyuka', 'Services') + '</h2><div class="grid4">' + sv.map(s => '<button class="sv" data-go="' + s[0] + '"><span>' + s[1] + '</span>' + s[2] + '</button>').join('') + '</div>' +
      '<h2>' + T('Kwanan nan', 'Recent') + '</h2><div class="card">' + (t.tx && t.tx.length ? t.tx.map(txRow).join('') : '<div class="mut">' + T('Babu ciniki tukuna', 'No transactions yet') + '</div>') + '</div></main>' + nav('home');
    wire(); $('#lo').onclick = () => logout(); $('#eye').onclick = () => { S.hide = !S.hide; LS.set('dh_hide', S.hide); $('#bv').textContent = bal(S.user.bal); $('#eye').textContent = S.hide ? '🙈' : '👁'; };
    bindRows();
  }
  function txRow(t) { return '<div class="li" data-rc="' + t.id + '"><div class="dot">' + (ICON[t.type] || '🧾') + '</div><div class="g"><b>' + esc(t.desc) + '</b><small>' + dt(t.ts) + ' · ' + esc(t.to) + '</small></div><div style="text-align:right"><b>' + N(t.price) + '</b><span class="pill ' + t.status + '">' + t.status + '</span></div></div>'; }
  function bindRows() { app.querySelectorAll('[data-rc]').forEach(r => r.onclick = () => location.hash = '#rcpt/' + r.dataset.rc); }

  /* ---------- purchase sheet (PIN, pay later) ---------- */
  function pinSetup() {
    const d = sheet('<h3>' + T('Saita PIN ɗin ciniki', 'Set your transaction PIN') + '</h3><p class="mut">' + T('PIN lambobi 4 — za a buƙaci shi a kowane ciniki.', '4 digits — needed for every purchase.') + '</p><input id="p1" class="pinbox" type="password" inputmode="numeric" maxlength="4" placeholder="••••"><div id="pe"></div><button class="btn" id="pg">' + T('Ajiye PIN', 'Save PIN') + '</button>');
    d.querySelector('#pg').onclick = e => busy(e.target, async () => { const r = await api('POST', '/pin/set', { pin: d.querySelector('#p1').value }); if (!r.ok) { d.querySelector('#pe').innerHTML = '<div class="err">' + esc(r.error) + '</div>'; return; } S.user.hasPin = true; closeSheet(); toast('PIN ✓'); });
  }
  function confirmBuy(order, desc, price) {
    if (!S.user.hasPin) return pinSetup();
    const d = sheet('<h3>' + T('Tabbatar da ciniki', 'Confirm purchase') + '</h3><div class="card"><b>' + esc(desc) + '</b><div class="big">' + N(price) + '</div><div class="mut">' + T('Wallet', 'Wallet') + ': ' + bal(S.user.bal) + '</div></div><label class="l">' + T('PIN ɗinka', 'Your PIN') + '</label><input id="cp" class="pinbox" type="password" inputmode="numeric" maxlength="4" placeholder="••••" autofocus><div id="ce"></div><button class="btn" id="cb">' + T('Biya yanzu', 'Pay now') + '</button><button class="btn o" id="cl">' + T('Ajiye a biya daga baya', 'Save as pay later') + '</button>');
    const idem = rid();
    d.querySelector('#cb').onclick = e => busy(e.target, async () => {
      const r = await api('POST', '/buy', Object.assign({}, order, { pin: d.querySelector('#cp').value, idem }));
      if (!r.ok) { d.querySelector('#ce').innerHTML = '<div class="err">' + esc(r.error) + '</div>'; if (r.need) d.querySelector('#ce').innerHTML += '<button class="btn o" data-go="fund" onclick="location.hash=\'#fund\'">' + T('Saka kuɗi', 'Fund wallet') + '</button>'; return; }
      S.user.bal = r.bal != null ? r.bal : S.user.bal; result(r.tx);
    });
    d.querySelector('#cl').onclick = e => busy(e.target, async () => { const r = await api('POST', '/later', order); if (!r.ok) return toast(r.error); closeSheet(); toast(T('An ajiye', 'Saved')); });
  }
  function result(t) {
    const ok = t.status === 'success', pend = t.status === 'pending' || t.status === 'processing';
    sheet('<div class="ctr"><div style="font-size:3rem">' + (ok ? '✅' : pend ? '⏳' : '↩️') + '</div><h3>' + (ok ? T('An yi nasara', 'Successful') : pend ? T('Ana jira', 'Processing') : T('Bai yi ba — an mayar da kuɗi', 'Failed — refunded')) + '</h3><div class="big">' + N(t.price) + '</div><p>' + esc(t.desc) + '</p>' +
      (t.token ? '<div class="card"><b>' + T('Token / PIN', 'Token / PIN') + '</b><div class="big" style="font-size:1.1rem;word-break:break-all">' + esc(t.token) + '</div></div>' : '') + '</div><button class="btn" id="rr">' + T('Duba rasit', 'View receipt') + '</button><button class="btn o" data-close>' + T('Rufe', 'Close') + '</button>');
    $('#rr').onclick = () => { closeSheet(); location.hash = '#rcpt/' + t.id; };
  }

  /* ---------- data ---------- */
  async function vData() {
    await refresh(); const c = S.cat, st = S.sel.data = S.sel.data || { net: 'mtn', type: 'SME', dur: 'all', phone: '' };
    const ben = (await api('GET', '/beneficiaries')).list || [];
    const draw = () => {
      const plans = (c.plans[st.net] || []).filter(p => p.type === st.type && (st.dur === 'all' || (st.dur === 'd' ? p.days <= 1 : st.dur === 'w' ? p.days > 1 && p.days <= 7 : p.days > 7)));
      page(T('Siyan Data', 'Buy Data'),
        '<div class="card"><label class="l">' + T('Zaɓi network', 'Network') + '</label><div class="nets">' + c.nets.map(n => '<button class="net ' + (st.net === n.id ? 'on' : '') + '" data-net="' + n.id + '">' + (c.rates[n.id] != null ? '<em>' + c.rates[n.id] + '%</em>' : '') + '<i style="background:' + n.c + '">' + n.n[0] + '</i>' + n.n + '</button>').join('') + '</div>' +
        '<label class="l">' + T('Lambar mai karɓa', 'Recipient number') + '</label><div class="ir"><input id="ph" inputmode="tel" placeholder="080xxxxxxxx" value="' + esc(st.phone) + '"><button class="sq" id="ct" title="Contacts">📇</button></div>' +
        '<div class="row" style="margin-top:8px"><select id="bn"><option value="">' + T('Abokai', 'Beneficiary') + '</option>' + ben.map(b => '<option value="' + b.phone + '">' + esc(b.name) + ' · ' + b.phone + '</option>').join('') + '</select><button class="btn o sm" id="mp" style="flex:none">' + T('Wayata', 'My Phone') + '</button></div></div>' +
        '<div class="tabs">' + c.types.map(t => '<button data-ty="' + t + '" class="' + (st.type === t ? 'on' : '') + '">' + t + '</button>').join('') + '</div>' +
        '<div class="chips">' + [['all', T('Duka', 'All')], ['d', T('Kullum', 'Daily')], ['w', T('Mako', 'Weekly')], ['m', T('Wata', 'Monthly')]].map(d => '<button class="chip ' + (st.dur === d[0] ? 'on' : '') + '" data-du="' + d[0] + '">' + d[1] + '</button>').join('') + '</div>' +
        '<h2>' + T('Plans da ake da su', 'Available Plans') + ' <span class="mut">' + plans.length + ' plans</span></h2><div class="plans">' + plans.map(p => '<button class="plan" data-pl="' + p.id + '"><b>' + p.label + '</b><small>' + p.days + (p.days === 1 ? ' day' : ' days') + '</small><span>' + N(p.price) + '</span></button>').join('') + '</div>' +
        (plans.length ? '' : '<div class="card mut">' + T('Babu plan', 'No plans for this filter') + '</div>'), 'home');
      app.querySelectorAll('[data-net]').forEach(b => b.onclick = () => { st.net = b.dataset.net; keep(); draw(); });
      app.querySelectorAll('[data-ty]').forEach(b => b.onclick = () => { st.type = b.dataset.ty; keep(); draw(); });
      app.querySelectorAll('[data-du]').forEach(b => b.onclick = () => { st.dur = b.dataset.du; keep(); draw(); });
      $('#bn').onchange = e => { if (e.target.value) { $('#ph').value = e.target.value; detect2(); } };
      $('#mp').onclick = () => { $('#ph').value = S.user.phone; detect2(); };
      $('#ph').oninput = detect2;
      $('#ct').onclick = async () => { try { const r = await navigator.contacts.select(['tel'], { multiple: false }); if (r[0] && r[0].tel[0]) { $('#ph').value = r[0].tel[0].replace(/[^\d+]/g, '').replace(/^\+234/, '0'); detect2(); } } catch (e) { toast(T('Wayarka ba ta goyi bayan wannan ba — rubuta lamba', 'Contact picker not supported here — type the number')); } };
      app.querySelectorAll('[data-pl]').forEach(b => b.onclick = () => {
        const p = plans.find(x => x.id === b.dataset.pl), ph = $('#ph').value; keep();
        confirmBuy({ type: 'data', plan: p.id, phone: ph }, st.net.toUpperCase() + ' ' + p.type + ' ' + p.label + ' → ' + ph, p.price);
      });
    };
    const keep = () => { const e = $('#ph'); if (e) st.phone = e.value; };
    const detect2 = () => { const n = DHCore.detectNet($('#ph').value.replace(/\D/g, '')); if (n && n !== st.net) { st.phone = $('#ph').value; st.net = n; draw(); $('#ph').focus(); } };
    draw();
  }

  /* ---------- airtime ---------- */
  async function vAir() {
    await refresh(); const c = S.cat, st = S.sel.air = S.sel.air || { net: 'mtn' };
    const ben = (await api('GET', '/beneficiaries')).list || [];
    page(T('Siyan Kati', 'Buy Airtime'), '<div class="card"><label class="l">Network</label><div class="nets">' + c.nets.map(n => '<button class="net ' + (st.net === n.id ? 'on' : '') + '" data-net="' + n.id + '"><i style="background:' + n.c + '">' + n.n[0] + '</i>' + n.n + '</button>').join('') + '</div>' +
      '<label class="l">' + T('Lambar waya', 'Phone number') + '</label><div class="ir"><input id="ph" inputmode="tel" placeholder="080xxxxxxxx"><button class="sq" id="mp">📱</button></div><select id="bn" style="margin-top:8px"><option value="">' + T('Abokai', 'Beneficiary') + '</option>' + ben.map(b => '<option value="' + b.phone + '">' + esc(b.name) + '</option>').join('') + '</select>' +
      '<label class="l">' + T('Adadi (₦)', 'Amount (₦)') + '</label><div class="chips">' + [100, 200, 500, 1000, 2000].map(a => '<button class="chip" data-am="' + a + '">₦' + a + '</button>').join('') + '</div><input id="am" inputmode="numeric" placeholder="100 - 50,000"><div class="mut" id="ds"></div><button class="btn" id="go">' + T('Ci gaba', 'Continue') + '</button></div>', 'home');
    const disc = () => { const a = +$('#am').value || 0; $('#ds').textContent = a ? T('Za ka biya', 'You pay') + ' ' + N(Math.ceil(a * (1 - c.airDisc)) * 100) : ''; };
    app.querySelectorAll('[data-net]').forEach(b => b.onclick = () => { st.net = b.dataset.net; app.querySelectorAll('.net').forEach(x => x.classList.toggle('on', x === b)); });
    app.querySelectorAll('[data-am]').forEach(b => b.onclick = () => { $('#am').value = b.dataset.am; disc(); });
    $('#am').oninput = disc; $('#mp').onclick = () => { $('#ph').value = S.user.phone; $('#ph').dispatchEvent(new Event('input')); };
    $('#bn').onchange = e => { if (e.target.value) { $('#ph').value = e.target.value; $('#ph').dispatchEvent(new Event('input')); } };
    $('#ph').oninput = () => { const n = DHCore.detectNet($('#ph').value.replace(/\D/g, '')); if (n) { st.net = n; app.querySelectorAll('.net').forEach(x => x.classList.toggle('on', x.dataset.net === n)); } };
    $('#go').onclick = () => { const a = +$('#am').value, ph = $('#ph').value; confirmBuy({ type: 'airtime', net: st.net, phone: ph, amount: a }, st.net.toUpperCase() + ' airtime ₦' + a + ' → ' + ph, Math.ceil(a * (1 - c.airDisc)) * 100); };
  }

  /* ---------- electricity / cable / exam ---------- */
  async function vElec() {
    await refresh(); const c = S.cat;
    page(T('Wutar lantarki', 'Electricity'), '<div class="card"><label class="l">Disco</label><select id="di">' + c.discos.map(d => '<option>' + d + '</option>').join('') + '</select><label class="l">' + T('Nau\'i', 'Meter type') + '</label><div class="chips"><button class="chip on" data-mt="prepaid">Prepaid</button><button class="chip" data-mt="postpaid">Postpaid</button></div><label class="l">' + T('Lambar mita', 'Meter number') + '</label><input id="mt" inputmode="numeric"><label class="l">' + T('Adadi (₦)', 'Amount (₦)') + '</label><input id="am" inputmode="numeric" placeholder="500 - 200,000"><label class="l">' + T('Lambar waya (zaɓi)', 'Phone (optional)') + '</label><input id="ph" inputmode="tel"><div id="vn" class="mut"></div><button class="btn o" id="vf">' + T('Tabbatar da mita', 'Verify meter') + '</button><button class="btn" id="go">' + T('Ci gaba', 'Continue') + '</button></div>', 'home');
    let mt = 'prepaid'; app.querySelectorAll('[data-mt]').forEach(b => b.onclick = () => { mt = b.dataset.mt; app.querySelectorAll('[data-mt]').forEach(x => x.classList.toggle('on', x === b)); });
    $('#vf').onclick = e => busy(e.target, async () => { const r = await api('POST', '/verify', { type: 'electricity', disco: $('#di').value, meter: $('#mt').value, meterType: mt }); $('#vn').textContent = r.ok ? '✔ ' + r.name : r.error; });
    $('#go').onclick = () => { const a = +$('#am').value; confirmBuy({ type: 'electricity', disco: $('#di').value, meter: $('#mt').value, meterType: mt, amount: a, phone: $('#ph').value }, $('#di').value + ' ' + mt + ' ' + $('#mt').value, a * 100); };
  }
  async function vCable() {
    await refresh(); const c = S.cat, provs = [...new Set(c.cable.map(x => x.p))]; let pv = provs[0];
    const draw = () => { page(T('TV', 'Cable TV'), '<div class="card"><div class="tabs">' + provs.map(p => '<button data-pv="' + p + '" class="' + (p === pv ? 'on' : '') + '">' + p + '</button>').join('') + '</div><label class="l">' + T('Lambar smartcard / IUC', 'Smartcard / IUC number') + '</label><input id="cd" inputmode="numeric"><div id="vn" class="mut"></div><button class="btn o" id="vf">' + T('Tabbatar', 'Verify') + '</button></div><h2>' + T('Zaɓi kunshin', 'Choose package') + '</h2><div class="plans">' + c.cable.filter(x => x.p === pv).map(x => '<button class="plan" data-pl="' + x.id + '"><b>' + x.n + '</b><small>30 days</small><span>' + N(x.price) + '</span></button>').join('') + '</div>', 'home');
      app.querySelectorAll('[data-pv]').forEach(b => b.onclick = () => { pv = b.dataset.pv; draw(); });
      $('#vf').onclick = e => busy(e.target, async () => { const r = await api('POST', '/verify', { type: 'cable', card: $('#cd').value }); $('#vn').textContent = r.ok ? '✔ ' + r.name : r.error; });
      app.querySelectorAll('[data-pl]').forEach(b => b.onclick = () => { const x = c.cable.find(y => y.id === b.dataset.pl); confirmBuy({ type: 'cable', plan: x.id, card: $('#cd').value }, x.p + ' ' + x.n + ' → ' + $('#cd').value, x.price); });
    }; draw();
  }
  async function vExam() {
    await refresh(); const c = S.cat;
    page(T('PIN na jarrabawa', 'Exam PINs'), '<div class="plans" style="grid-template-columns:1fr">' + c.exam.map(x => '<button class="plan" data-pl="' + x.id + '"><b style="font-size:1rem">' + esc(x.n) + '</b><span>' + N(x.price) + '</span></button>').join('') + '</div>', 'home');
    app.querySelectorAll('[data-pl]').forEach(b => b.onclick = () => { const x = c.exam.find(y => y.id === b.dataset.pl); confirmBuy({ type: 'exam', plan: x.id }, x.n, x.price); });
  }

  /* ---------- wallet ---------- */
  async function vFund() {
    await refresh(); const led = (await api('GET', '/ledger')).led || [];
    page('Wallet', '<div class="card ctr"><div class="mut">' + T('Kuɗin wallet', 'Wallet balance') + '</div><div class="big">' + bal(S.user.bal) + '</div></div><div class="card"><h3>' + T('Saka kuɗi', 'Fund wallet') + '</h3><div class="chips">' + [500, 1000, 2000, 5000].map(a => '<button class="chip" data-am="' + a + '">₦' + a + '</button>').join('') + '</div><input id="am" inputmode="numeric" placeholder="₦ (min ' + S.cfg.minFund + ')"><button class="btn" id="go">' + T('Ci gaba da biyan kuɗi', 'Pay with card / transfer') + '</button>' + (S.health.preview ? '<div class="mut">PREVIEW: funding is simulated.</div>' : '') + '</div><h2>' + T('Motsin kuɗi', 'Wallet activity') + '</h2><div class="card">' + (led.length ? led.slice(0, 30).map(l => '<div class="li"><div class="g"><b>' + esc(l.note) + '</b><small>' + dt(l.ts) + '</small></div><span class="' + (l.type === 'credit' ? 'pos' : 'neg') + '">' + (l.type === 'credit' ? '+' : '−') + N(l.amt) + '</span></div>').join('') : '<div class="mut">—</div>') + '</div>', 'fund');
    app.querySelectorAll('[data-am]').forEach(b => b.onclick = () => $('#am').value = b.dataset.am);
    $('#go').onclick = e => busy(e.target, async () => {
      const r = await api('POST', '/fund', { amount: $('#am').value, callback: location.origin + location.pathname + '#fundback' }); if (!r.ok) return toast(r.error);
      if (r.instant) { toast(T('An saka kuɗi', 'Wallet funded')); return vFund(); }
      sessionStorage.setItem('dh_fref', r.ref); location.href = r.url;
    });
  }
  async function checkFundReturn() { const ref = sessionStorage.getItem('dh_fref'); if (!ref) return; sessionStorage.removeItem('dh_fref'); const r = await api('GET', '/fund/verify', null, { ref }); toast(r.ok && r.done ? T('An saka kuɗi', 'Wallet funded') : T('Ana jiran tabbatarwa', 'Payment not confirmed yet')); }

  /* ---------- history / receipt ---------- */
  async function vHist() {
    const f = S.sel.hf || ''; const t = await api('GET', '/tx', null, { limit: 100, type: f });
    page(T('Tarihin ciniki', 'Transactions'), '<div class="chips">' + [['', T('Duka', 'All')], ['data', 'Data'], ['airtime', T('Kati', 'Airtime')], ['electricity', T('Wuta', 'Power')], ['cable', 'TV'], ['exam', 'Exam']].map(x => '<button class="chip ' + (f === x[0] ? 'on' : '') + '" data-f="' + x[0] + '">' + x[1] + '</button>').join('') + '</div><div class="card">' + ((t.tx || []).length ? t.tx.map(txRow).join('') : '<div class="mut">—</div>') + '</div>', 'hist');
    app.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { S.sel.hf = b.dataset.f; vHist(); }); bindRows();
  }
  async function vRcpt(id) {
    const r = await api('GET', '/tx/' + id); if (!r.ok) return page('Receipt', '<div class="card">' + esc(r.error) + '</div>');
    const t = r.tx, agent = S.user.tier !== 'user';
    page(T('Rasit', 'Receipt'), '<div class="card ctr"><div style="font-size:2.6rem">' + (t.status === 'success' ? '✅' : t.status === 'pending' ? '⏳' : '↩️') + '</div><div class="big">' + N(t.price) + '</div><span class="pill ' + t.status + '">' + t.status + '</span></div><div class="card"><table class="tbl">' + [['Service', t.desc], ['To', t.to], ['Reference', t.ref], ['Date', new Date(t.ts).toLocaleString()], ['Message', t.msg || '']].map(x => '<tr><th>' + x[0] + '</th><td>' + esc(x[1]) + '</td></tr>').join('') + '</table>' + (t.token ? '<div class="card"><b>Token / PIN</b><div class="big" style="font-size:1.1rem;word-break:break-all">' + esc(t.token) + '</div></div>' : '') + '</div>' +
      (t.status === 'success' && agent ? '<div class="card"><h3>' + T('Ribar da ka caji abokin ciniki', 'Profit: what you charged your customer') + '</h3><div class="ir"><input id="ch" inputmode="numeric" placeholder="₦" value="' + (t.charged != null ? t.charged / 100 : '') + '"><button class="btn sm" id="chs">OK</button></div></div>' : '') + '<button class="btn" id="dl">' + T('Ajiye a matsayin hoto', 'Save as image') + '</button><button class="btn o" id="sh2">' + T('Aika ta WhatsApp', 'Share on WhatsApp') + '</button>', 'hist');
    const chs = $('#chs'); if (chs) chs.onclick = async () => { const x = await api('POST', '/profit/note', { tx: t.id, charged: $('#ch').value }); toast(x.ok ? '✓' : x.error); };
    $('#dl').onclick = () => receiptPng(t); $('#sh2').onclick = () => window.open('https://wa.me/?text=' + encodeURIComponent('ATM DataHub\n' + t.desc + '\n' + N(t.price) + ' · ' + t.status + '\nRef: ' + t.ref + (t.token ? '\nToken: ' + t.token : '')), '_blank');
  }
  function receiptPng(t) {
    const c = document.createElement('canvas'); c.width = 600; c.height = 700; const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, 600, 700); x.fillStyle = '#0a8f8a'; x.fillRect(0, 0, 600, 110); x.fillStyle = '#fff'; x.font = 'bold 34px sans-serif'; x.fillText('ATM DataHub', 30, 60); x.font = '18px sans-serif'; x.fillText('Transaction receipt', 30, 90);
    x.fillStyle = '#10201f'; x.font = 'bold 48px sans-serif'; x.fillText(N(t.price), 30, 190); x.font = 'bold 22px sans-serif'; x.fillStyle = t.status === 'success' ? '#1e9e55' : '#c98a00'; x.fillText(t.status.toUpperCase(), 30, 230);
    x.fillStyle = '#10201f'; x.font = '20px sans-serif'; [['Service', t.desc], ['To', t.to], ['Date', new Date(t.ts).toLocaleString()], ['Ref', t.ref]].concat(t.token ? [['Token', t.token]] : []).forEach((r, i) => { x.fillStyle = '#5f7473'; x.fillText(r[0], 30, 290 + i * 70); x.fillStyle = '#10201f'; x.fillText(String(r[1]).slice(0, 40), 30, 318 + i * 70); });
    x.fillStyle = '#5f7473'; x.font = '16px sans-serif'; x.fillText('ATM Digital Solutions & Services · 08133515448', 30, 680);
    c.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'receipt-' + t.ref + '.png'; a.click(); });
  }

  /* ---------- profile (Security / Appearance / Help) ---------- */
  async function vMe() {
    await refresh(); const u = S.user, tab = S.sel.mt || 'sec';
    const rows = {
      sec: [['🔑', T('Canza kalmar sirri', 'Change Password'), 'pw'], ['🔢', T('Canza PIN', 'Change PIN'), 'pinc'], ['❓', T('Na manta PIN', 'Forgot PIN'), 'pinf'], ['🐷', T('Kashe & Ajiya', 'Spend & Save'), 'spend'], ['👥', T('Abokai (Beneficiaries)', 'Beneficiaries'), 'ben'], ['📈', 'Profit Management', 'profit'], ['💸', T('Masu bashi (Borrowers)', 'Borrowers'), 'borrow'], ['⏰', T('Biya daga baya', 'Pay later'), 'later'], ['⭐', T('Haɓaka asusu', 'Upgrade account'), 'upg'], ['🎁', T('Gayyaci abokai', 'Refer & earn'), 'ref']],
      app: [], help: []
    };
    let body = '';
    if (tab === 'sec') body = '<div class="card">' + rows.sec.map(r => '<div class="li" data-go="' + r[2] + '"><div class="dot">' + r[0] + '</div><div class="g"><b>' + r[1] + '</b></div>›</div>').join('') + '</div>';
    if (tab === 'app') body = '<div class="card"><label class="l">' + T('Yare', 'Theme') + '</label><div class="chips">' + [['light', 'Light'], ['dark', 'Dark'], ['auto', 'Auto']].map(x => '<button class="chip ' + (S.theme === x[0] ? 'on' : '') + '" data-th="' + x[0] + '">' + x[1] + '</button>').join('') + '</div><label class="l">' + T('Harshe', 'Language') + '</label><div class="chips">' + [['both', 'Hausa + English'], ['ha', 'Hausa'], ['en', 'English']].map(x => '<button class="chip ' + (S.lang === x[0] ? 'on' : '') + '" data-lg="' + x[0] + '">' + x[1] + '</button>').join('') + '</div><label class="l">' + T('Ɓoye balance', 'Hide balance') + '</label><div class="chips"><button class="chip ' + (S.hide ? 'on' : '') + '" data-hd="1">' + T('Ɓoye', 'Hidden') + '</button><button class="chip ' + (!S.hide ? 'on' : '') + '" data-hd="0">' + T('Nuna', 'Shown') + '</button></div></div>';
    if (tab === 'help') body = '<div class="card"><div class="li"><div class="dot">📞</div><div class="g"><b>' + esc(S.cfg.support) + '</b><small>' + T('Kira mu', 'Call us') + '</small></div><a class="btn sm" href="tel:' + esc(S.cfg.support) + '">Call</a></div><div class="li"><div class="dot">💬</div><div class="g"><b>WhatsApp</b></div><a class="btn sm" target="_blank" rel="noopener" href="https://wa.me/234' + esc(S.cfg.support.replace(/^0/, '')) + '">Chat</a></div><div class="li"><div class="dot">📣</div><div class="g"><b>WhatsApp Channel</b></div><a class="btn sm" target="_blank" rel="noopener" href="https://whatsapp.com/channel/0029VbDxOkt72WU1LQgF6w05">Follow</a></div></div><div class="card mut">ATM Digital Solutions & Services<br>Abdussalam Tahir Malumfashi</div>';
    app.innerHTML = banner() + '<div class="top ctr"><div class="av big">' + esc(u.name[0].toUpperCase()) + '</div><h2 style="margin:8px 0 0">' + esc(u.name) + '</h2><div style="opacity:.9">UID: ' + u.id + ' · ' + esc(u.phone) + '</div><div style="margin-top:6px"><span class="tier ' + (u.verified ? 'v' : '') + '">' + (u.verified ? '✔ Verified' : T('Ba a tabbatar ba', 'Not verified')) + '</span><span class="tier">' + u.tier.toUpperCase() + '</span></div></div><main><div class="tabs">' + [['sec', 'Security'], ['app', 'Appearance'], ['help', 'Help Center']].map(x => '<button data-mt="' + x[0] + '" class="' + (tab === x[0] ? 'on' : '') + '">' + x[1] + '</button>').join('') + '</div>' + body + '<button class="btn red" id="lo">' + T('Fita', 'Logout') + '</button></main>' + nav('me'); wire();
    app.querySelectorAll('[data-mt]').forEach(b => b.onclick = () => { S.sel.mt = b.dataset.mt; vMe(); });
    app.querySelectorAll('[data-th]').forEach(b => b.onclick = () => { S.theme = b.dataset.th; LS.set('dh_theme', S.theme); document.documentElement.dataset.theme = S.theme === 'auto' ? (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light') : S.theme; vMe(); });
    app.querySelectorAll('[data-lg]').forEach(b => b.onclick = () => { S.lang = b.dataset.lg; LS.set('dh_lang', S.lang); vMe(); });
    app.querySelectorAll('[data-hd]').forEach(b => b.onclick = () => { S.hide = b.dataset.hd === '1'; LS.set('dh_hide', S.hide); vMe(); });
    $('#lo').onclick = () => logout();
  }
  const form = (title, fields, btn, fn, extra) => page(title, '<div class="card">' + fields.map(f => '<label class="l">' + f[1] + '</label><input id="' + f[0] + '" ' + (f[2] || '') + '>').join('') + '<div id="fe"></div><button class="btn" id="fg">' + btn + '</button></div>' + (extra || ''), 'me') || ($('#fg').onclick = e => busy(e.target, async () => { const r = await fn(); if (!r.ok) $('#fe').innerHTML = '<div class="err">' + esc(r.error) + '</div>'; else { toast('✓'); history.back(); } }));
  const pwf = 'type="password" autocomplete="new-password"', pinf = 'type="password" inputmode="numeric" maxlength="4"';
  const vPw = () => form(T('Canza kalmar sirri', 'Change Password'), [['o', T('Kalmar sirri ta yanzu', 'Current password'), 'type="password"'], ['n', T('Sabuwar kalmar sirri', 'New password'), pwf]], T('Ajiye', 'Save'), () => api('POST', '/password/change', { old: $('#o').value, password: $('#n').value }));
  const vPinC = () => form(T('Canza PIN', 'Change PIN'), [['o', T('PIN na yanzu', 'Current PIN'), pinf], ['n', T('Sabon PIN', 'New PIN'), pinf]], T('Ajiye', 'Save'), () => api('POST', '/pin/change', { old: $('#o').value, pin: $('#n').value }));
  const vPinF = () => form(T('Na manta PIN', 'Forgot PIN'), [['o', T('Kalmar sirri don tabbatarwa', 'Your password (to confirm)'), 'type="password"'], ['n', T('Sabon PIN', 'New PIN'), pinf]], T('Saita PIN', 'Reset PIN'), () => api('POST', '/pin/forgot', { password: $('#o').value, pin: $('#n').value }));

  async function vSpend() {
    const r = await api('GET', '/spend'); const by = r.month || {}, tot = r.total || 0, pct = r.goal ? Math.min(100, Math.round(100 * r.savings / r.goal)) : 0;
    page(T('Kashe & Ajiya', 'Spend & Save'), '<div class="card"><h3>' + T('Kashewar wannan watan', 'Spent this month') + '</h3><div class="big">' + bal(tot) + '</div>' + Object.keys(by).map(k => '<div style="margin-top:8px"><div class="row" style="justify-content:space-between"><span>' + ICON[k] + ' ' + TYN[k][1] + '</span><b>' + N(by[k]) + '</b></div><div class="bar2"><i style="width:' + Math.round(100 * by[k] / tot) + '%"></i></div></div>').join('') + '</div>' +
      '<div class="card"><h3>🐷 ' + T('Ajiya', 'Savings pot') + '</h3><div class="big">' + bal(r.savings || 0) + '</div><div class="mut">' + T('Buri', 'Goal') + ': ' + N(r.goal || 0) + '</div><div class="bar2"><i style="width:' + pct + '%"></i></div><label class="l">' + T('Buri (₦)', 'Goal (₦)') + '</label><div class="ir"><input id="gl" inputmode="numeric" value="' + (r.goal ? r.goal / 100 : '') + '"><button class="btn sm" id="gs">OK</button></div><label class="l">' + T('Adadi (₦)', 'Amount (₦)') + '</label><input id="am" inputmode="numeric"><label class="l">PIN</label><input id="pn" ' + pinf + '><div class="row"><button class="btn" id="in">' + T('Saka a ajiya', 'Move to savings') + '</button><button class="btn o" id="out">' + T('Cire daga ajiya', 'Withdraw') + '</button></div></div>', 'me');
    $('#gs').onclick = async () => { await api('POST', '/savings', { goal: $('#gl').value }); vSpend(); };
    const mv = d => async () => { const x = await api('POST', '/savings', { move: d, amount: $('#am').value, pin: $('#pn').value }); if (!x.ok) return toast(x.error); toast('✓'); vSpend(); };
    $('#in').onclick = mv('in'); $('#out').onclick = mv('out');
  }
  async function vBen() {
    const draw = async l => { page(T('Abokai (Beneficiaries)', 'Beneficiaries'), '<div class="card"><input id="n" placeholder="' + T('Suna', 'Name') + '"><input id="p" inputmode="tel" placeholder="080..." style="margin-top:8px"><button class="btn" id="ad">' + T('Ƙara', 'Add') + '</button></div><div class="card">' + (l.length ? l.map(b => '<div class="li"><div class="g"><b>' + esc(b.name) + '</b><small>' + b.phone + '</small></div><button class="btn sm red" data-d="' + b.id + '">✕</button></div>').join('') : '<div class="mut">—</div>') + '</div>', 'me'); $('#ad').onclick = async () => { const r = await api('POST', '/beneficiaries', { name: $('#n').value, phone: $('#p').value }); r.ok ? draw(r.list) : toast(r.error); }; app.querySelectorAll('[data-d]').forEach(b => b.onclick = async () => draw((await api('DELETE', '/beneficiaries/' + b.dataset.d)).list)); };
    draw((await api('GET', '/beneficiaries')).list || []);
  }
  async function vBorrow() {
    const draw = l => { const owed = l.reduce((s, x) => s + x.amount - x.paid, 0); page('Borrowers', '<div class="card ctr"><div class="mut">' + T('Jimillar bashi', 'Total owed to you') + '</div><div class="big">' + N(owed) + '</div></div><div class="card"><input id="n" placeholder="' + T('Suna', 'Name') + '"><input id="p" inputmode="tel" placeholder="Phone" style="margin-top:8px"><input id="a" inputmode="numeric" placeholder="₦" style="margin-top:8px"><input id="t" placeholder="' + T('Bayani', 'Note') + '" style="margin-top:8px"><button class="btn" id="ad">' + T('Ƙara', 'Add') + '</button></div><div class="card">' + (l.length ? l.map(x => '<div class="li"><div class="g"><b>' + esc(x.name) + '</b><small>' + N(x.paid) + ' / ' + N(x.amount) + ' · ' + esc(x.note) + '</small></div>' + (x.paid < x.amount ? '<button class="btn sm" data-p="' + x.id + '">' + T('Ya biya', 'Paid') + '</button>' : '<span class="pos">✔</span>') + ' <button class="btn sm red" data-d="' + x.id + '">✕</button></div>').join('') : '<div class="mut">—</div>') + '</div>', 'me');
      $('#ad').onclick = async () => { const r = await api('POST', '/borrowers', { name: $('#n').value, phone: $('#p').value, amount: $('#a').value, note: $('#t').value }); r.ok ? draw(r.list) : toast(r.error); };
      app.querySelectorAll('[data-p]').forEach(b => b.onclick = async () => draw((await api('POST', '/borrowers/' + b.dataset.p + '/pay', { all: true })).list)); app.querySelectorAll('[data-d]').forEach(b => b.onclick = async () => draw((await api('DELETE', '/borrowers/' + b.dataset.d)).list)); };
    draw((await api('GET', '/borrowers')).list || []);
  }
  async function vProfit() {
    const r = await api('GET', '/profit');
    page('Profit Management', '<div class="card"><div class="stat"><div><small>' + T('Kuɗin shiga', 'Revenue') + '</small><b>' + N(r.revenue) + '</b></div><div><small>' + T('Kuɗin da ka kashe', 'Your cost') + '</small><b>' + N(r.cost) + '</b></div><div><small>' + T('Riba', 'Profit') + '</small><b class="pos">' + N(r.profit) + '</b></div><div><small>' + T('Wannan wata', 'This month') + '</small><b>' + N(r.month) + '</b></div></div><p class="mut">' + T('Buɗe rasit ka rubuta abin da ka caji abokin ciniki. Ciniki ba tare da bayani ba: ', 'Open a receipt and enter what you charged your customer. Sales without a note: ') + r.unnoted + '</p></div>', 'me');
  }
  async function vLater() {
    const draw = l => { page(T('Biya daga baya', 'Pay later'), '<div class="card">' + (l.length ? l.map(x => '<div class="li"><div class="g"><b>' + esc(x.desc) + '</b><small>' + N(x.price) + '</small></div><button class="btn sm" data-p="' + x.id + '">' + T('Biya', 'Pay') + '</button> <button class="btn sm red" data-d="' + x.id + '">✕</button></div>').join('') : '<div class="mut">' + T('Babu abin da aka ajiye', 'Nothing saved. Use "Save as pay later" when buying.') + '</div>') + '</div>', 'me');
      app.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { const x = l.find(y => y.id === b.dataset.p); const d = sheet('<h3>' + esc(x.desc) + '</h3><div class="big">' + N(x.price) + '</div><label class="l">PIN</label><input id="pn" class="pinbox" ' + pinf + '><div id="ce"></div><button class="btn" id="go">' + T('Biya', 'Pay') + '</button>'); d.querySelector('#go').onclick = e => busy(e.target, async () => { const r = await api('POST', '/later/' + x.id + '/pay', { pin: d.querySelector('#pn').value, idem: rid() }); if (!r.ok) { d.querySelector('#ce').innerHTML = '<div class="err">' + esc(r.error) + '</div>'; return; } result(r.tx); }); });
      app.querySelectorAll('[data-d]').forEach(b => b.onclick = async () => { await api('DELETE', '/later/' + b.dataset.d); vLater(); }); };
    draw((await api('GET', '/later')).list || []);
  }
  async function vUpg() {
    await refresh(); const u = S.user, up = S.cat.upgrade; const opts = ['agent', 'reseller'].filter(t => ['user', 'agent', 'reseller'].indexOf(t) > ['user', 'agent', 'reseller'].indexOf(u.tier));
    page(T('Haɓaka asusu', 'Upgrade account'), '<div class="card mut">' + T('Wakili da Mai sakewa suna samun farashi mai rahusa.', 'Agents and Resellers get cheaper prices on every purchase.') + '</div>' + (opts.length ? opts.map(t => '<div class="card"><h3>' + t.toUpperCase() + '</h3><div class="big">₦' + up[t].toLocaleString() + '</div><button class="btn" data-up="' + t + '">' + T('Haɓaka', 'Upgrade') + '</button></div>').join('') : '<div class="card">' + T('Kana matakin sama', 'You are on the top tier') + ' ✔</div>'), 'me');
    app.querySelectorAll('[data-up]').forEach(b => b.onclick = () => { const d = sheet('<h3>' + b.dataset.up.toUpperCase() + '</h3><label class="l">PIN</label><input id="pn" class="pinbox" ' + pinf + '><div id="ce"></div><button class="btn" id="go">OK</button>'); d.querySelector('#go').onclick = e => busy(e.target, async () => { const r = await api('POST', '/upgrade', { tier: b.dataset.up, pin: d.querySelector('#pn').value }); if (!r.ok) { d.querySelector('#ce').innerHTML = '<div class="err">' + esc(r.error) + '</div>'; return; } closeSheet(); toast('✓'); vUpg(); }); });
  }
  async function vRef() {
    const r = await api('GET', '/referrals'); const link = location.origin + location.pathname + '?ref=' + r.code;
    page(T('Gayyaci abokai', 'Refer & earn'), '<div class="card ctr"><div class="mut">' + T('Lambar gayyatarka', 'Your referral code') + '</div><div class="big">' + r.code + '</div><p>' + T('An gayyaci', 'Invited') + ': <b>' + r.count + '</b></p><button class="btn" id="sh">' + T('Aika ta WhatsApp', 'Share on WhatsApp') + '</button></div>', 'me');
    $('#sh').onclick = () => window.open('https://wa.me/?text=' + encodeURIComponent('Join ATM DataHub — cheap data, airtime, bills. Use my code ' + r.code + '\n' + link), '_blank');
  }

  /* ---------- admin ---------- */
  async function vAdmin() {
    if (S.user.role !== 'admin') return home(); const tab = S.sel.at || 'dash'; let body = '';
    if (tab === 'dash') {
      const s = await api('GET', '/admin/stats');
      body = '<div class="card"><div class="stat"><div><small>Users</small><b>' + s.users + '</b></div><div><small>Wallets total</small><b>' + N(s.wallets) + '</b></div><div><small>Sales today</small><b>' + N(s.salesToday) + '</b></div><div><small>Profit today</small><b class="pos">' + N(s.profitToday) + '</b></div><div><small>Total sales</small><b>' + N(s.sales) + '</b></div><div><small>Total profit</small><b class="pos">' + N(s.profit) + '</b></div><div><small>Pending</small><b>' + s.pending + '</b></div><div><small>Refunded</small><b>' + s.failed + '</b></div></div><p class="mut">Provider: ' + s.provider + (s.providerBalance != null ? ' · balance ' + N(s.providerBalance) : '') + ' · Gateway: ' + s.gateway + ' · ' + (s.live ? 'LIVE' : 'NOT LIVE') + '</p><button class="btn o" id="rq">Re-check pending now</button></div>';
    } else if (tab === 'users') {
      const u = (await api('GET', '/admin/users', null, { q: S.sel.uq || '' })).users || [];
      body = '<input id="uq" placeholder="Search name / phone / UID" value="' + esc(S.sel.uq || '') + '"><div class="card">' + u.map(x => '<div class="li" data-u="' + x.id + '"><div class="g"><b>' + esc(x.name) + (x.verified ? ' ✔' : '') + (x.banned ? ' 🚫' : '') + '</b><small>' + x.phone + ' · ' + x.tier + ' · ' + x.id + '</small></div><b>' + N(x.bal) + '</b></div>').join('') + '</div>';
    } else if (tab === 'tx') {
      const t = (await api('GET', '/admin/tx', null, { status: S.sel.as || '' })).tx || [];
      body = '<div class="chips">' + ['', 'pending', 'success', 'refunded'].map(x => '<button class="chip ' + ((S.sel.as || '') === x ? 'on' : '') + '" data-s="' + x + '">' + (x || 'all') + '</button>').join('') + '</div><div class="card">' + t.map(x => '<div class="li" data-t="' + x.id + '"><div class="g"><b>' + esc(x.desc) + '</b><small>' + dt(x.ts) + ' · ' + x.uid + ' · cost ' + N(x.cost) + '</small></div><div style="text-align:right"><b>' + N(x.price) + '</b><span class="pill ' + x.status + '">' + x.status + '</span></div></div>').join('') + '</div>';
    } else if (tab === 'set') {
      const p = await api('GET', '/admin/prices'); const m = p.margin, a = p.airDisc;
      body = '<div class="card"><h3>Profit margin on data/cable/exam (%)</h3><div class="row"><input id="m_user" inputmode="decimal" value="' + m.user * 100 + '"><input id="m_agent" inputmode="decimal" value="' + m.agent * 100 + '"><input id="m_reseller" inputmode="decimal" value="' + m.reseller * 100 + '"></div><div class="mut">user · agent · reseller</div><h3 style="margin-top:12px">Airtime discount to customer (%)</h3><div class="row"><input id="a_user" value="' + a.user * 100 + '"><input id="a_agent" value="' + a.agent * 100 + '"><input id="a_reseller" value="' + a.reseller * 100 + '"></div><h3 style="margin-top:12px">Notice on home screen</h3><input id="nt" value="' + esc(S.cfg.notice || '') + '"><button class="btn" id="sv">Save</button></div><div class="card"><h3>Set provider cost per plan</h3><div class="mut">Replace illustrative costs with your provider\'s real prices.</div><select id="pp">' + p.plans.map(x => '<option value="' + x.id + '">' + x.id + ' — cost ₦' + x.cost + '</option>').join('') + '</select><input id="pc" inputmode="numeric" placeholder="New cost ₦" style="margin-top:8px"><button class="btn o" id="ps">Set cost</button></div>';
    }
    page('Admin', '<div class="tabs">' + [['dash', 'Dashboard'], ['users', 'Users'], ['tx', 'Orders'], ['set', 'Prices']].map(x => '<button data-at="' + x[0] + '" class="' + (tab === x[0] ? 'on' : '') + '">' + x[1] + '</button>').join('') + '</div>' + body, 'me');
    app.querySelectorAll('[data-at]').forEach(b => b.onclick = () => { S.sel.at = b.dataset.at; vAdmin(); });
    const rq = $('#rq'); if (rq) rq.onclick = async () => { const r = await api('POST', '/admin/requery'); toast('Settled: ' + r.settled); vAdmin(); };
    const uq = $('#uq'); if (uq) uq.onchange = () => { S.sel.uq = uq.value; vAdmin(); };
    app.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { S.sel.as = b.dataset.s; vAdmin(); });
    app.querySelectorAll('[data-u]').forEach(b => b.onclick = () => adminUser(b.dataset.u, u => u.id === b.dataset.u));
    app.querySelectorAll('[data-t]').forEach(b => b.onclick = async () => { const t = (await api('GET', '/admin/tx', null, {})).tx.find(x => x.id === b.dataset.t); if (t.status !== 'pending') return toast(t.msg || t.status); const d = sheet('<h3>' + esc(t.desc) + '</h3><p>Pending. Settle manually only after checking with your provider.</p><button class="btn" id="ok">Mark success</button><button class="btn red" id="no">Fail & refund</button>'); d.querySelector('#ok').onclick = async () => { await api('POST', '/admin/tx/resolve', { id: t.id, result: 'success' }); closeSheet(); vAdmin(); }; d.querySelector('#no').onclick = async () => { await api('POST', '/admin/tx/resolve', { id: t.id, result: 'fail' }); closeSheet(); vAdmin(); }; });
    const sv = $('#sv'); if (sv) sv.onclick = async () => { const g = i => (+$('#' + i).value) / 100; const r = await api('POST', '/admin/settings', { margin: { user: g('m_user'), agent: g('m_agent'), reseller: g('m_reseller') }, airDisc: { user: g('a_user'), agent: g('a_agent'), reseller: g('a_reseller') }, notice: $('#nt').value }); toast(r.ok ? 'Saved' : r.error); };
    const ps = $('#ps'); if (ps) ps.onclick = async () => { const o = {}; o[$('#pp').value] = +$('#pc').value; const r = await api('POST', '/admin/settings', { priceOver: o }); toast(r.ok ? 'Saved' : r.error); vAdmin(); };
  }
  async function adminUser(id) {
    const u = ((await api('GET', '/admin/users', null, { q: id })).users || [])[0]; if (!u) return;
    const d = sheet('<h3>' + esc(u.name) + '</h3><p class="mut">' + u.phone + ' · ' + u.id + ' · ' + N(u.bal) + '</p><div class="chips">' + ['user', 'agent', 'reseller'].map(t => '<button class="chip ' + (u.tier === t ? 'on' : '') + '" data-t="' + t + '">' + t + '</button>').join('') + '</div><button class="btn o" id="vf">' + (u.verified ? 'Remove verified badge' : 'Mark as Verified') + '</button><button class="btn o" id="bn">' + (u.banned ? 'Unsuspend' : 'Suspend account') + '</button><label class="l">Adjust wallet ₦ (needs YOUR admin PIN)</label><input id="aa" inputmode="numeric" placeholder="Amount"><input id="an" placeholder="Reason" style="margin-top:6px"><input id="ap" ' + pinf + ' placeholder="Admin PIN" style="margin-top:6px"><div class="row"><button class="btn" id="cr">Credit</button><button class="btn red" id="db">Debit</button></div>');
    const up = async b => { const r = await api('POST', '/admin/user', Object.assign({ id: u.id }, b)); if (!r.ok) toast(r.error); closeSheet(); vAdmin(); };
    d.querySelectorAll('[data-t]').forEach(b => b.onclick = () => up({ tier: b.dataset.t })); d.querySelector('#vf').onclick = () => up({ verified: !u.verified }); d.querySelector('#bn').onclick = () => up({ banned: !u.banned });
    const adj = dir => async () => { const r = await api('POST', '/admin/adjust', { id: u.id, dir, amount: d.querySelector('#aa').value, note: d.querySelector('#an').value, pin: d.querySelector('#ap').value }); if (!r.ok) return toast(r.error); closeSheet(); vAdmin(); };
    d.querySelector('#cr').onclick = adj('credit'); d.querySelector('#db').onclick = adj('debit');
  }

  /* ---------- start ---------- */
  (async function start() {
    await detect(); const q = new URLSearchParams(location.search); S.refCode = q.get('ref');
    location.hash = ''; renderAuth(S.refCode ? 'reg' : 'login'); if (S.refCode) setTimeout(() => { const r = $('#a_ref'); if (r) r.value = S.refCode; }, 50);
    if ('serviceWorker' in navigator && !PREVIEW) { /* no service worker on purpose: login is required on every open and data must always come fresh */ }
    if (sessionStorage.getItem('dh_fref')) window.__fundPending = true;
  })();
  const _boot = boot; boot = async function () { await _boot(); if (window.__fundPending) { window.__fundPending = false; checkFundReturn(); } };
  async function boot2() { } // placeholder to keep structure simple
})();
