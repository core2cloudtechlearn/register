// Core2CloudX GenAI workshop: registration site + admin dashboard.
// Zero npm dependencies. Needs Node 22.5+ (uses the built-in node:sqlite).
//   ADMIN_PASSWORD=... UPI_ID=name@bank node server.js
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const UPI_ID = process.env.UPI_ID || '';
const UPI_NAME = process.env.UPI_NAME || 'Core2CloudX';
// Razorpay: set KEY_ID + KEY_SECRET to switch on online payment. WEBHOOK_SECRET is for the backup webhook.
const RZP_KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const RZP_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';
const RZP_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || '';
const RZP_API = (process.env.RAZORPAY_API_BASE || 'https://api.razorpay.com').replace(/\/$/, ''); // override only for tests
const RZP_ON = !!(RZP_KEY_ID && RZP_KEY_SECRET);
// Online payment is OFF unless PAYMENTS=on. Registration works without it; payment links are sent on WhatsApp.
const PAYMENTS_ON = process.env.PAYMENTS === 'on';
const WHATSAPP = (process.env.WHATSAPP_NUMBER || '917338884345').replace(/\D/g, ''); // WhatsApp + call number, with country code
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || 'connect@core2cloud.in';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'registrations.db');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 20 * 1024;

if (!ADMIN_PASSWORD) {
  console.error('Set ADMIN_PASSWORD before starting, e.g. ADMIN_PASSWORD=choose-a-strong-one node server.js');
  process.exit(1);
}

// Prices in rupees, base fee 4,999. Change here only; the page reads them from /api/config.
const WORKSHOP = {
  title: 'Build Your Own AI Agent in 3 Days',
  dates: '17, 18 & 19 October 2026',
  basePrice: 4999,
  categories: {
    professional: { label: 'Working professional', price: 999 },
    student: { label: 'Student (individual)', price: 499 },
    college_group: { label: 'College group', price: 299 },
    existing: { label: 'Existing user', price: 0 },
  },
};

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    phone TEXT NOT NULL,
    category TEXT NOT NULL,
    organisation TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    group_name TEXT NOT NULL DEFAULT '',
    group_size INTEGER,
    existing_user_id TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'direct',
    amount INTEGER NOT NULL,
    pay_status TEXT NOT NULL,
    txn_ref TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT ''
  );
`);
db.exec(`CREATE TABLE IF NOT EXISTS rp_orders (
  order_id TEXT PRIMARY KEY, ref TEXT NOT NULL, amount_paise INTEGER NOT NULL, created_at TEXT NOT NULL)`);
const haveCols = new Set(db.prepare('PRAGMA table_info(registrations)').all().map(c => c.name));
for (const [col, ddl] of [['rzp_payment_id', "TEXT NOT NULL DEFAULT ''"], ['pay_method', "TEXT NOT NULL DEFAULT ''"], ['paid_at', "TEXT NOT NULL DEFAULT ''"]]) {
  if (!haveCols.has(col)) db.exec(`ALTER TABLE registrations ADD COLUMN ${col} ${ddl}`);
}
const PAY_STATUSES = ['pending', 'contacted', 'submitted', 'paid', 'verify', 'waived', 'cancelled'];

const q = {
  insert: db.prepare(`INSERT INTO registrations
    (ref, created_at, updated_at, name, email, phone, category, organisation, city, group_name, group_size, existing_user_id, source, amount, pay_status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`),
  byRef: db.prepare('SELECT * FROM registrations WHERE ref = ?'),
  all: db.prepare('SELECT * FROM registrations ORDER BY id DESC'),
  setTxn: db.prepare("UPDATE registrations SET txn_ref = ?, pay_status = 'submitted', updated_at = ? WHERE ref = ? AND pay_status IN ('pending','submitted')"),
  addOrder: db.prepare('INSERT INTO rp_orders (order_id, ref, amount_paise, created_at) VALUES (?,?,?,?)'),
  order: db.prepare('SELECT * FROM rp_orders WHERE order_id = ?'),
  markPaid: db.prepare("UPDATE registrations SET pay_status = 'paid', rzp_payment_id = ?, pay_method = ?, paid_at = ?, updated_at = ? WHERE ref = ? AND pay_status != 'paid'"),
  admin: db.prepare('UPDATE registrations SET pay_status = ?, notes = ?, updated_at = ? WHERE id = ?'),
};

// ---------- helpers ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function send(res, code, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(code, {
    'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Cache-Control': 'no-store', ...headers,
  });
  res.end(isObj ? JSON.stringify(body) : body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(new Error('too_large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch { reject(new Error('bad_json')); } });
    req.on('error', reject);
  });
}

function readRaw(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 200 * 1024) { reject(new Error('too_large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const hmacHex = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');

// Mark the registration behind a Razorpay order as paid. Safe to call twice (verify + webhook).
function settleOrder(orderId, paymentId, method, paidPaise) {
  const o = q.order.get(orderId);
  if (!o) return { ok: false, why: 'unknown_order' };
  if (paidPaise != null && Number(paidPaise) !== o.amount_paise) return { ok: false, why: 'amount_mismatch' };
  const reg = q.byRef.get(o.ref);
  if (!reg || reg.amount * 100 !== o.amount_paise) return { ok: false, why: 'amount_mismatch' };
  const now = new Date().toISOString();
  q.markPaid.run(String(paymentId || ''), String(method || 'razorpay').slice(0, 20), now, now, o.ref);
  return { ok: true, ref: o.ref };
}

const hits = new Map(); // ip -> timestamps (in memory is enough for one small server)
function rateLimited(ip, limit, windowMs) {
  const now = Date.now();
  const list = (hits.get(ip + limit) || []).filter(t => now - t < windowMs);
  list.push(now); hits.set(ip + limit, list);
  return list.length > limit;
}
const clientIp = req => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';

const clean = (v, max = 120) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const makeRef = () => {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return 'C2C-' + Array.from(crypto.randomBytes(5), b => a[b % a.length]).join('');
};

// admin session: signed cookie derived from the password, so it survives restarts
const SESSION = crypto.createHmac('sha256', ADMIN_PASSWORD).update('c2c-admin-session').digest('hex');
const safeEq = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const isAdmin = req => {
  const m = /(?:^|;\s*)c2c_admin=([a-f0-9]+)/.exec(req.headers.cookie || '');
  return !!m && safeEq(m[1], SESSION);
};

function toCsv(rows) {
  const cols = ['ref', 'created_at', 'name', 'email', 'phone', 'category', 'organisation', 'city', 'group_name', 'group_size',
    'existing_user_id', 'source', 'amount', 'pay_status', 'pay_method', 'rzp_payment_id', 'paid_at', 'txn_ref', 'notes'];
  const esc = v => { let s = String(v ?? ''); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n');
}

// ---------- API ----------
async function handleApi(req, res, url) {
  const ip = clientIp(req);

  if (req.method === 'GET' && url.pathname === '/api/config') {
    return send(res, 200, { ...WORKSHOP, payments: PAYMENTS_ON, whatsapp: WHATSAPP, email: CONTACT_EMAIL, upiId: PAYMENTS_ON ? UPI_ID : '', upiName: UPI_NAME, razorpay: PAYMENTS_ON && RZP_ON ? { keyId: RZP_KEY_ID } : null });
  }

  if (req.method === 'POST' && url.pathname === '/api/register') {
    if (rateLimited(ip, 8, 60 * 60 * 1000)) return send(res, 429, { error: 'Too many attempts. Please try again in an hour.' });
    let b; try { b = await readJson(req); } catch { return send(res, 400, { error: 'Invalid request.' }); }
    if (clean(b.website)) return send(res, 200, { ok: true, ref: 'C2C-XXXXX', amount: 0, status: 'pending' }); // honeypot: pretend success

    const cat = WORKSHOP.categories[b.category];
    const name = clean(b.name), email = clean(b.email, 160).toLowerCase(), phone = clean(b.phone, 20).replace(/[\s-]/g, '');
    const err = [];
    if (!cat) err.push('Choose who you are registering as.');
    if (name.length < 2) err.push('Enter your full name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) err.push('Enter a valid email address.');
    if (!/^(\+?91)?[6-9]\d{9}$/.test(phone)) err.push('Enter a valid 10-digit mobile number.');
    if (b.consent !== true) err.push('Please accept the contact consent.');
    const organisation = clean(b.organisation), city = clean(b.city, 60);
    const groupName = clean(b.group_name), existingId = clean(b.existing_user_id, 160);
    let groupSize = null;
    if (b.category === 'college_group') {
      groupSize = Math.round(Number(b.group_size));
      if (!organisation) err.push('Enter your college name.');
      if (!groupName) err.push('Enter your group or coordinator name.');
      if (!(groupSize >= 1 && groupSize <= 1000)) err.push('Enter how many students are in your group.');
    }
    if (b.category === 'student' && !organisation) err.push('Enter your college name.');
    if (b.category === 'professional' && !organisation) err.push('Enter your company or role.');
    if (b.category === 'existing' && !existingId) err.push('Enter the email or ID you used on our earlier course.');
    if (err.length) return send(res, 422, { error: err[0], errors: err });

    const source = clean(b.source, 40).toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'direct';
    const amount = cat.price * (groupSize || 1); // never trust a price from the browser; groups pay per student
    const status = b.category === 'existing' ? 'verify' : 'pending';
    const now = new Date().toISOString();
    for (let i = 0; i < 5; i++) {
      const ref = makeRef();
      try {
        q.insert.run(ref, now, now, name, email, phone, b.category, organisation, city, groupName, groupSize, existingId, source, amount, status);
        return send(res, 201, { ok: true, ref, amount, status, category: cat.label });
      } catch (e) {
        if (/registrations\.email/.test(e.message)) {
          return send(res, 409, { error: 'This email is already registered. Check your email or WhatsApp for your reference, or contact us.' });
        }
        if (!/registrations\.ref/.test(e.message)) { console.error(e); return send(res, 500, { error: 'Something went wrong. Please try again.' }); }
      }
    }
    return send(res, 500, { error: 'Something went wrong. Please try again.' });
  }

  if (req.method === 'POST' && url.pathname === '/api/payment') {
    if (!PAYMENTS_ON) return send(res, 503, { error: 'Online payment is not switched on.' });
    if (rateLimited(ip, 20, 60 * 60 * 1000)) return send(res, 429, { error: 'Too many attempts. Please try again later.' });
    let b; try { b = await readJson(req); } catch { return send(res, 400, { error: 'Invalid request.' }); }
    const txn = clean(b.txn_ref, 60), ref = clean(b.ref, 20).toUpperCase();
    if (txn.length < 6) return send(res, 422, { error: 'Enter the UPI transaction ID (12 digits) from your payment app.' });
    const r = q.setTxn.run(txn, new Date().toISOString(), ref);
    if (!r.changes) return send(res, 404, { error: 'Registration not found or already confirmed.' });
    return send(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/pay/order') {
    if (!RZP_ON || !PAYMENTS_ON) return send(res, 503, { error: 'Online payment is not switched on.' });
    if (rateLimited(ip, 15, 60 * 60 * 1000)) return send(res, 429, { error: 'Too many attempts. Please try again later.' });
    let b; try { b = await readJson(req); } catch { return send(res, 400, { error: 'Invalid request.' }); }
    const reg = q.byRef.get(clean(b.ref, 20).toUpperCase());
    if (!reg) return send(res, 404, { error: 'Registration not found.' });
    if (reg.pay_status === 'paid') return send(res, 409, { error: 'This registration is already paid.' });
    if (reg.amount <= 0 || !['pending', 'submitted'].includes(reg.pay_status)) return send(res, 409, { error: 'No payment is due for this registration.' });
    let order;
    try {
      const r = await fetch(RZP_API + '/v1/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(RZP_KEY_ID + ':' + RZP_KEY_SECRET).toString('base64') },
        body: JSON.stringify({ amount: reg.amount * 100, currency: 'INR', receipt: reg.ref, notes: { ref: reg.ref, email: reg.email } }),
        signal: AbortSignal.timeout(15000),
      });
      order = await r.json();
      if (!r.ok || !order.id) throw new Error(JSON.stringify(order).slice(0, 300));
    } catch (e) { console.error('Razorpay order failed:', e.message); return send(res, 502, { error: 'Could not start the payment. Please try again in a moment.' }); }
    q.addOrder.run(order.id, reg.ref, reg.amount * 100, new Date().toISOString());
    return send(res, 200, { orderId: order.id, amount: reg.amount * 100, keyId: RZP_KEY_ID, name: reg.name, email: reg.email, phone: reg.phone, ref: reg.ref });
  }

  if (req.method === 'POST' && url.pathname === '/api/pay/verify') {
    if (!RZP_ON || !PAYMENTS_ON) return send(res, 503, { error: 'Online payment is not switched on.' });
    if (rateLimited(ip, 30, 60 * 60 * 1000)) return send(res, 429, { error: 'Too many attempts. Please try again later.' });
    let b; try { b = await readJson(req); } catch { return send(res, 400, { error: 'Invalid request.' }); }
    const oid = clean(b.razorpay_order_id, 60), pid = clean(b.razorpay_payment_id, 60), sig = clean(b.razorpay_signature, 128);
    if (!oid || !pid || !sig || !safeEq(sig, hmacHex(RZP_KEY_SECRET, oid + '|' + pid))) return send(res, 400, { error: 'Payment could not be verified. If money was deducted it will be matched automatically, or contact us with your reference.' });
    const r = settleOrder(oid, pid, 'razorpay');
    return r.ok ? send(res, 200, { ok: true, ref: r.ref }) : send(res, 400, { error: 'Payment could not be matched. Please contact us with your payment ID.' });
  }

  if (req.method === 'POST' && url.pathname === '/api/razorpay/webhook') {
    if (!PAYMENTS_ON || !RZP_WEBHOOK_SECRET) return send(res, 503, { error: 'Webhook not configured.' });
    let raw; try { raw = await readRaw(req); } catch { return send(res, 400, { error: 'Invalid request.' }); }
    if (!safeEq(String(req.headers['x-razorpay-signature'] || ''), hmacHex(RZP_WEBHOOK_SECRET, raw))) return send(res, 400, { error: 'Bad signature.' });
    let ev; try { ev = JSON.parse(raw.toString()); } catch { return send(res, 400, { error: 'Invalid request.' }); }
    const pay = ev.payload && ev.payload.payment && ev.payload.payment.entity;
    if ((ev.event === 'payment.captured' || ev.event === 'order.paid') && pay && pay.order_id) {
      const r = settleOrder(pay.order_id, pay.id, pay.method, pay.amount);
      if (!r.ok) console.error('Webhook could not settle', pay.order_id, r.why);
    }
    return send(res, 200, { ok: true }); // 200 for any validly signed event so Razorpay does not keep retrying
  }

  // ----- admin -----
  if (req.method === 'POST' && url.pathname === '/api/admin/login') {
    if (rateLimited(ip, 10, 15 * 60 * 1000)) return send(res, 429, { error: 'Too many attempts. Try again in 15 minutes.' });
    let b; try { b = await readJson(req); } catch { return send(res, 400, { error: 'Invalid request.' }); }
    if (!safeEq(String(b.password || ''), ADMIN_PASSWORD)) return send(res, 401, { error: 'Wrong password.' });
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    return send(res, 200, { ok: true }, { 'Set-Cookie': `c2c_admin=${SESSION}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${secure}` });
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/logout') {
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'c2c_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }
  if (url.pathname.startsWith('/api/admin/')) {
    if (!isAdmin(req)) return send(res, 401, { error: 'Not signed in.' });
    if (req.method === 'GET' && url.pathname === '/api/admin/registrations') return send(res, 200, { rows: q.all.all() });
    if (req.method === 'GET' && url.pathname === '/api/admin/export.csv') {
      return send(res, 200, '﻿' + toCsv(q.all.all()), { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="registrations.csv"' });
    }
    const m = /^\/api\/admin\/registrations\/(\d+)$/.exec(url.pathname);
    if (req.method === 'PATCH' && m) {
      let b; try { b = await readJson(req); } catch { return send(res, 400, { error: 'Invalid request.' }); }
      if (!PAY_STATUSES.includes(b.pay_status)) return send(res, 422, { error: 'Unknown status.' });
      q.admin.run(b.pay_status, clean(b.notes, 500), new Date().toISOString(), Number(m[1]));
      return send(res, 200, { ok: true });
    }
  }
  return send(res, 404, { error: 'Not found.' });
}

// ---------- static ----------
function serveStatic(req, res, url) {
  let p = url.pathname === '/' ? '/index.html' : url.pathname === '/admin' ? '/admin.html' : url.pathname;
  const file = path.normalize(path.join(PUBLIC_DIR, p));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden');
  fs.readFile(file, (e, data) => {
    if (e) return send(res, 404, 'Not found');
    const type = MIME[path.extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' });
    res.end(data);
  });
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const run = url.pathname.startsWith('/api/') ? handleApi(req, res, url) : (serveStatic(req, res, url), null);
  if (run) run.catch(e => { console.error(e); if (!res.headersSent) send(res, 500, { error: 'Server error.' }); });
}).listen(PORT, () => {
  console.log(`Registration:  http://localhost:${PORT}/`);
  console.log(`Admin:         http://localhost:${PORT}/admin`);
  console.log(PAYMENTS_ON ? (RZP_ON ? `Payments: ON, Razorpay (${RZP_KEY_ID.startsWith('rzp_live') ? 'LIVE' : 'test'} mode)` : 'Payments: ON, manual UPI') : 'Payments: OFF (registration only; send payment links on WhatsApp)');
});
