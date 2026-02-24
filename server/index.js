import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import Database from 'better-sqlite3';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

const {
  PORT = 8080,
  PUBLIC_APP_URL,
  BOT_TOKEN,
  ADMIN_CHAT_ID,
  CRYPTOPAY_TOKEN,
  CRYPTOPAY_WEBHOOK_SECRET
} = process.env;

if (!PUBLIC_APP_URL || !BOT_TOKEN || !ADMIN_CHAT_ID || !CRYPTOPAY_TOKEN || !CRYPTOPAY_WEBHOOK_SECRET) {
  console.error('Missing env vars. Check Render env.');
  process.exit(1);
}

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: '2mb' }));

// --- DB ---
const db = new Database('data.db');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  free_uploads INTEGER NOT NULL DEFAULT 0,
  referred_by TEXT
);

CREATE TABLE IF NOT EXISTS referrals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer_user_id TEXT NOT NULL,
  referred_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  invoice_id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  wallet TEXT NOT NULL,
  title TEXT NOT NULL,
  filename TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS weekly_winner (
  week_key TEXT PRIMARY KEY,
  submission_id INTEGER,
  paid_out INTEGER NOT NULL DEFAULT 0
);
`);

const upsertUser = db.prepare(`
INSERT INTO users (user_id, free_uploads, referred_by)
VALUES (@user_id, COALESCE(@free_uploads, 0), @referred_by)
ON CONFLICT(user_id) DO UPDATE SET
  free_uploads = users.free_uploads
`);

const getUser = db.prepare(`SELECT * FROM users WHERE user_id = ?`);
const setReferredBy = db.prepare(`UPDATE users SET referred_by = ? WHERE user_id = ? AND (referred_by IS NULL OR referred_by = '')`);
const addReferral = db.prepare(`INSERT INTO referrals (referrer_user_id, referred_user_id, created_at) VALUES (?, ?, ?)`);
const incFree = db.prepare(`UPDATE users SET free_uploads = free_uploads + 1 WHERE user_id = ?`);
const decFree = db.prepare(`UPDATE users SET free_uploads = free_uploads - 1 WHERE user_id = ? AND free_uploads > 0`);

const insertInvoice = db.prepare(`INSERT OR REPLACE INTO invoices (invoice_id, user_id, status, created_at) VALUES (?, ?, ?, ?)`);
const getInvoice = db.prepare(`SELECT * FROM invoices WHERE invoice_id = ?`);
const setInvoiceStatus = db.prepare(`UPDATE invoices SET status = ? WHERE invoice_id = ?`);

const insertSubmission = db.prepare(`
INSERT INTO submissions (user_id, wallet, title, filename, source, created_at)
VALUES (?, ?, ?, ?, ?, ?)
`);

const countPaidRefSubmissions = db.prepare(`
SELECT COUNT(*) as c
FROM submissions
WHERE source = 'paid'
AND user_id IN (SELECT referred_user_id FROM referrals WHERE referrer_user_id = ?)
`);

function now() { return Date.now(); }

// --- uploads folder ---
const uploadsDir = path.resolve('uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const safe = `${Date.now()}-${Math.random().toString(16).slice(2)}-${file.originalname}`.replace(/[^\w.\-]/g, '_');
    cb(null, safe);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.mimetype);
    cb(ok ? null : new Error('Only images'), ok);
  }
});

// --- telegram notify ---
async function tgSend(text) {
  await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    chat_id: ADMIN_CHAT_ID,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  });
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// --- Crypto Pay API client ---
const cryptoPay = axios.create({
  baseURL: 'https://pay.crypt.bot/api',
  headers: { 'Crypto-Pay-API-Token': CRYPTOPAY_TOKEN }
});

// bind referral once (start_param = ref_<id>)
function bindReferralOnce(user_id, start_param) {
  if (!start_param || !start_param.startsWith('ref_')) return;
  const referrer = start_param.slice(4);
  if (!referrer || referrer === user_id) return;

  upsertUser.run({ user_id, free_uploads: 0, referred_by: null });
  const u = getUser.get(user_id);
  if (u?.referred_by) return;

  setReferredBy.run(referrer, user_id);
  addReferral.run(referrer, user_id, now());
}

// create invoice (1 TON)
app.post('/api/create-invoice', async (req, res) => {
  try {
    const { user_id, start_param = '' } = req.body || {};
    if (!user_id) return res.status(400).json({ ok: false });

    upsertUser.run({ user_id, free_uploads: 0, referred_by: null });
    bindReferralOnce(user_id, start_param);

    const payload = JSON.stringify({ user_id });

    const r = await cryptoPay.post('/createInvoice', {
      asset: 'TON',
      amount: '1',
      description: 'Загрузка изображения (1 TON)',
      payload,
      paid_btn_name: 'callback',
      paid_btn_url: PUBLIC_APP_URL
    });

    if (!r.data?.ok) return res.status(500).json({ ok: false, error: r.data?.error || 'CRYPTOPAY_ERROR' });

    const inv = r.data.result;
    insertInvoice.run(inv.invoice_id, user_id, 'active', now());

    res.json({
      ok: true,
      invoice_id: inv.invoice_id,
      pay_url: inv.web_app_invoice_url || inv.mini_app_invoice_url || inv.bot_invoice_url
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

// invoice status for polling
app.get('/api/invoice-status', (req, res) => {
  const invoice_id = Number(req.query.invoice_id);
  if (!invoice_id) return res.status(400).json({ ok: false });
  const inv = getInvoice.get(invoice_id);
  res.json({ ok: true, status: inv?.status || 'unknown' });
});

// Crypto Pay webhook
app.post(`/api/cryptopay/webhook/${CRYPTOPAY_WEBHOOK_SECRET}`, (req, res) => {
  try {
    const upd = req.body;
    if (upd?.update_type === 'invoice_paid') {
      const invoice = upd.payload;
      const invoice_id = invoice.invoice_id;
      setInvoiceStatus.run('paid', invoice_id);
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false });
  }
});

// user info
app.get('/api/me', (req, res) => {
  const user_id = String(req.query.user_id || '');
  if (!user_id) return res.status(400).json({ ok: false });

  upsertUser.run({ user_id, free_uploads: 0, referred_by: null });
  const u = getUser.get(user_id);
  res.json({ ok: true, free_uploads: u?.free_uploads || 0 });
});

// submit (paid or free)
app.post('/api/submit', upload.single('image'), async (req, res) => {
  try {
    const { user_id, wallet, title, invoice_id = '', use_free = '0' } = req.body || {};
    if (!user_id || !wallet || !title) return res.status(400).json({ ok: false, error: 'BAD_INPUT' });
    if (!req.file) return res.status(400).json({ ok: false, error: 'NO_FILE' });

    upsertUser.run({ user_id, free_uploads: 0, referred_by: null });

    let source = 'paid';

    if (use_free === '1') {
      const r = decFree.run(user_id);
      if (r.changes !== 1) return res.status(400).json({ ok: false, error: 'NO_FREE_CREDITS' });
      source = 'free';
    } else {
      const invId = Number(invoice_id);
      if (!invId) return res.status(400).json({ ok: false, error: 'NO_INVOICE' });

      const inv = getInvoice.get(invId);
      if (!inv || inv.user_id !== user_id) return res.status(400).json({ ok: false, error: 'BAD_INVOICE' });
      if (inv.status !== 'paid') return res.status(400).json({ ok: false, error: 'NOT_PAID' });

      // use once
      setInvoiceStatus.run('used', invId);
      source = 'paid';
    }

    const id = insertSubmission.run(user_id, wallet, title, req.file.filename, source, now()).lastInsertRowid;

    // referral reward: each 3 paid submissions by referred users => +1 free upload to referrer
    const u = getUser.get(user_id);
    if (source === 'paid' && u?.referred_by) {
      const referrer = u.referred_by;
      const c = countPaidRefSubmissions.get(referrer).c || 0;
      if (c % 3 === 0) incFree.run(referrer);
    }

    await tgSend(
      [
        '🧩 <b>Новая работа</b>',
        `<b>Название:</b> ${escapeHtml(title)}`,
        `<b>Кошелёк:</b> ${escapeHtml(wallet)}`,
        `<b>Оплата:</b> ${source === 'paid' ? 'Crypto Pay (1 TON)' : 'Бесплатная загрузка'}`,
        `<b>ID:</b> ${id}`,
        `<b>Важно:</b> если кошелёк требует MEMO — проверь, что пользователь его указал.`
      ].join('\n')
    );

    res.json({ ok: true, submission_id: id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

app.get('/health', (_req, res) => res.send('ok'));

app.listen(PORT, () => console.log('server started'));