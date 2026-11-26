/* ATM DataHub server - zero dependencies. Node 18+.  Run: node server/server.js  (see docs/DEPLOY.md) */
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const Core = require('../src/core.js');
const env = Object.assign({}, process.env);
try { fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n').forEach(l => { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l); if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }); } catch (e) { }
const PORT = +env.PORT || 3000, DATA = env.DATA_DIR || path.join(__dirname, '..', 'data'), PUB = path.join(__dirname, '..', 'public');
fs.mkdirSync(DATA, { recursive: true });
const FILE = path.join(DATA, 'db.json');

/* ---- JSON store with atomic writes + daily backups (move to PostgreSQL when you grow) ---- */
const store = { db: null, t: null, dirty: false };
try { store.db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { store.db = Core.emptyDB(); }
function flush() { if (!store.dirty) return; store.dirty = false; const tmp = FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(store.db)); fs.renameSync(tmp, FILE); }
store.save = () => { store.dirty = true; if (!store.t) store.t = setTimeout(() => { store.t = null; flush(); }, 300); };
function backup() { try { store.dirty = true; flush(); const d = path.join(DATA, 'backups'); fs.mkdirSync(d, { recursive: true }); fs.copyFileSync(FILE, path.join(d, 'db-' + new Date().toISOString().slice(0, 10) + '.json')); const l = fs.readdirSync(d).sort(); l.slice(0, Math.max(0, l.length - 14)).forEach(f => fs.unlinkSync(path.join(d, f))); } catch (e) { console.error('backup failed', e.message); } }

/* ---- choose adapters from env ---- */
const A = require('./adapters.js');
const LIVE = env.MODE === 'live';
let provider = Core.mockProvider, gateway = Core.mockGateway;
if (LIVE) {
  if (!env.VTPASS_API_KEY || !env.PAYSTACK_SECRET_KEY || !env.ADMIN_PHONE || !env.ADMIN_PASSWORD || !env.ADMIN_PIN) { console.error('MODE=live needs VTPASS_*, PAYSTACK_SECRET_KEY, ADMIN_PHONE, ADMIN_PASSWORD, ADMIN_PIN in .env'); process.exit(1); }
  provider = A.vtpass(env); gateway = A.paystack(env); store.db.cfg.mode = 'live';
} else { store.db.cfg.mode = 'test'; }
const core = Core.create({ store, provider, gateway });
if (env.ADMIN_PHONE && env.ADMIN_PASSWORD && env.ADMIN_PIN) core.ensureAdmin(env.ADMIN_PHONE, env.ADMIN_PASSWORD, env.ADMIN_PIN);
else if (!LIVE) core.ensureAdmin('08000000001', 'Admin12345', '4321'), console.log('TEST MODE admin: 08000000001 / Admin12345 / PIN 4321');

/* ---- http ---- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
const hits = {}; setInterval(() => { for (const k in hits) delete hits[k]; }, 60000).unref();
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'" };
if (LIVE) SEC['Strict-Transport-Security'] = 'max-age=31536000';
const readBody = (req, max = 1e6) => new Promise((res, rej) => { let b = ''; req.on('data', c => { b += c; if (b.length > max) { rej(new Error('big')); req.destroy(); } }); req.on('end', () => res(b)); });

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'); const send = (s, o, h) => { res.writeHead(s, Object.assign({ 'Content-Type': 'application/json' }, SEC, h || {})); res.end(typeof o === 'string' ? o : JSON.stringify(o)); };
  try {
    if (u.pathname === '/webhook/paystack' && req.method === 'POST') {
      const raw = await readBody(req); const evt = gateway.parseWebhook ? gateway.parseWebhook(raw, req.headers['x-paystack-signature']) : null;
      if (evt === null) return send(401, { ok: false }); core.webhook(evt); return send(200, { ok: true });
    }
    if (u.pathname.startsWith('/api/')) {
      const ip = req.socket.remoteAddress + (req.headers['x-forwarded-for'] || ''); hits[ip] = (hits[ip] || 0) + 1; if (hits[ip] > 120) return send(429, { ok: false, error: 'Too many requests' });
      let body = {}; if (req.method === 'POST' || req.method === 'DELETE') { const raw = await readBody(req, 50000); if (raw) try { body = JSON.parse(raw); } catch (e) { return send(400, { ok: false, error: 'Bad JSON' }); } }
      const q = Object.fromEntries(u.searchParams); const r = await core.handle(req.method, u.pathname, body, req.headers, q); return send(r.status, r.json, { 'Cache-Control': 'no-store' });
    }
    let p = decodeURIComponent(u.pathname); if (p === '/') p = '/index.html';
    let f = path.normalize(path.join(PUB, p)); if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(PUB, 'index.html');
    res.writeHead(200, Object.assign({ 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }, SEC)); fs.createReadStream(f).pipe(res);
  } catch (e) { send(500, { ok: false, error: 'Server error' }); }
});
server.listen(PORT, () => console.log('ATM DataHub on :' + PORT + ' mode=' + (LIVE ? 'LIVE' : 'TEST (no real money)')));
setInterval(() => core.requeryPending().catch(() => { }), 120000).unref();
setInterval(backup, 6 * 3600e3).unref(); backup();
process.on('SIGTERM', () => { flush(); process.exit(0); }); process.on('SIGINT', () => { flush(); process.exit(0); });
