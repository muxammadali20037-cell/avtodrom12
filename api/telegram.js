/* ============================================================================
   TELEGRAM BOT — kassa xabarlari va raqam bo'yicha ma'lumot

   Rahbar @BotFather'da bot yaratadi va tokenni Maxsus bo'lim → «Telegram
   bot» sahifasiga qo'yadi. Shundan keyin:
     • XABARLAR: Kirdi, Chiqdi, vaqti tugab yopildi, qarz to'landi,
       tuzatishlar — ulangan chatlarga (shaxsiy yoki guruh) o'zi boradi;
     • SO'ROV: botga mashina raqamini yozsa («01A777AA», «148», «455 dilnoza»)
       — hozir ichkaridami, bugun necha marta, qancha to'lagan, qarzi,
       oxirgi tashriflari. Buyruqlar: /ichkarida, /bugun, /qarzlar,
       /raqam 01A777AA (guruhda), /yordam.

   XAVFSIZLIK
     • Bot faqat ULANGAN chatlarga javob beradi. Ulash — Maxsus bo'limda
       chiqadigan 6 xonali kod (10 daqiqa amal qiladi) botga yuboriladi.
       Begona odam yozsa — hech qanday ma'lumot berilmaydi.
     • Webhook manzilida maxfiy qism bor va Telegram'ning
       X-Telegram-Bot-Api-Secret-Token sarlavhasi tekshiriladi.
     • Token bazada shifrlangan (AES-256-GCM, kalit JWT_SECRET dan) va
       sahifaga hech qachon qaytarilmaydi.

   XABARLAR NAVBATI (tg_outbox): xabar avval bazaga yoziladi, keyin
   yuboriladi. Telegram vaqtincha javob bermasa — keyinroq qayta urinadi
   (429 da Telegram aytgan vaqtdan keyin). Kassa ishini hech qachon
   to'xtatmaydi: bot ishlamasa ham Kirdi/Chiqdi odatdagidek.
   ========================================================================== */

import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { pool } from '../backend/src/db.js';
import { runOnce } from '../backend/src/schema-once.js';
import { maxsusOk, lockedResponse } from './lock-routes.js';
import { MONEY_EVENTS, IS_KECHAGI } from './money-sql.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
const TG_BASE = () => String(process.env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/+$/, '');
const TZ = 'Asia/Tashkent';

/* Qaysi xabarlar — standart hammasi yoqilgan */
export const TG_EVENTS = {
  start: 'Kirdi — vaqt ochildi',
  finish: 'Chiqdi — yopildi (pul bilan)',
  auto: 'Vaqti tugab o‘zi yopildi',
  debt: 'Qarz to‘landi',
  fix: 'Tuzatishlar: to‘g‘rilash, qarz to‘lovi bekor qilindi'
};
const DEFAULT_EVENTS = Object.fromEntries(Object.keys(TG_EVENTS).map(k => [k, true]));

/* ---------------- yordamchilar ---------------- */
const text = v => String(v === null || v === undefined ? '' : v).trim();
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
export const h = s => String(s === null || s === undefined ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const som = n => String(Math.round(num(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' so‘m';
const tk = d => new Date(new Date(d).getTime() + 5 * 3600e3);
export const hhmm = d => (d ? tk(d).toISOString().slice(11, 16) : '—');
export const ddmm = d => { const x = tk(d).toISOString(); return x.slice(8, 10) + '.' + x.slice(5, 7); };
const todayTk = () => tk(Date.now()).toISOString().slice(0, 10);
export function dur(sec) {
  const m = Math.max(0, Math.round(num(sec) / 60));
  const hh = Math.floor(m / 60), mm = m % 60;
  return hh ? hh + ' soat' + (mm ? ' ' + mm + ' daq' : '') : mm + ' daq';
}
/* Telegram 4096 belgidan uzun xabarni qabul qilmaydi. Har qator o'zi yopiq
   (teglar qator ichida), shuning uchun qator chegarasida kesamiz. */
export function clip(t, max) {
  const s = String(t);
  const m = max || 3900;
  if (s.length <= m) return s;
  const cut = s.lastIndexOf('\n', m);
  return s.slice(0, cut > 0 ? cut : m) + '\n…';
}
const plateKey = s => String(s || '').toUpperCase().replace(/[\s\-.,'`‘’ʻʼ"]/g, '');
const PAY = { cash: 'naqd', terminal: 'terminal', click: 'Klik', mixed: 'aralash' };
const moneyParts = (c, t, k) => [num(c) > 0 ? 'naqd ' + som(c) : '', num(t) > 0 ? 'terminal ' + som(t) : '', num(k) > 0 ? 'Klik ' + som(k) : '']
  .filter(Boolean).join(' + ');

function json(res, status, data) {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}
function auth(req) {
  try {
    const hd = req.headers?.authorization || '';
    if (!hd.startsWith('Bearer ')) return null;
    const p = jwt.verify(hd.slice(7), JWT_SECRET);
    return p && p.sub && String(p.sub) !== 'admin' ? String(p.sub) : null;
  } catch { return null; }
}
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  return await new Promise(resolve => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 2e5) req.destroy(); });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

/* ---------------- token shifrlash ---------------- */
const KEY = () => crypto.createHash('sha256').update('avtodrom-tg:' + JWT_SECRET).digest();
function enc(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY(), iv);
  const data = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data].map(b => b.toString('base64')).join('.');
}
function dec(s) {
  try {
    const [iv, tag, data] = String(s).split('.').map(x => Buffer.from(x, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', KEY(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(data), d.final()]).toString('utf8');
  } catch { return null; }
}

/* ---------------- sxema ---------------- */
let schemaP = null;
export function ensureTgSchema() {
  if (schemaP) return schemaP;
  schemaP = runOnce('telegram-v1', async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS tg_bots(
      user_id TEXT PRIMARY KEY,
      token_enc TEXT NOT NULL,
      bot_id BIGINT, bot_username TEXT, bot_name TEXT,
      hook_secret TEXT NOT NULL UNIQUE,
      events JSONB NOT NULL DEFAULT '{}'::jsonb,
      webhook_ok BOOLEAN NOT NULL DEFAULT FALSE,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS tg_chats(
      user_id TEXT NOT NULL, chat_id BIGINT NOT NULL,
      title TEXT, kind TEXT, username TEXT,
      notify BOOLEAN NOT NULL DEFAULT TRUE,
      linked_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_seen TIMESTAMPTZ, last_error TEXT,
      PRIMARY KEY(user_id, chat_id))`);
    await pool.query(`CREATE TABLE IF NOT EXISTS tg_codes(
      code TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS tg_outbox(
      id BIGSERIAL PRIMARY KEY, user_id TEXT NOT NULL, chat_id BIGINT NOT NULL, text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', tries INTEGER NOT NULL DEFAULT 0,
      next_at TIMESTAMPTZ NOT NULL DEFAULT now(), claimed_at TIMESTAMPTZ, sent_at TIMESTAMPTZ,
      error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_tg_outbox_due ON tg_outbox(next_at) WHERE status IN ('pending','sending')`);
  }).catch(e => { schemaP = null; throw e; });
  return schemaP;
}

/* Bot ulanganmi (umuman) — 60 soniya keshlanadi, bot yo'q bo'lsa bazaga ortiqcha so'rov yo'q */
let anyAt = 0, anyVal = false;
export async function tgAnyBots() {
  if (Date.now() - anyAt < 60000) return anyVal;
  anyAt = Date.now();
  try {
    const t = await pool.query(`SELECT to_regclass('public.tg_bots') AS t`);
    anyVal = !!(t.rows[0] && t.rows[0].t) && (await pool.query(`SELECT EXISTS(SELECT 1 FROM tg_bots) AS x`)).rows[0].x;
  } catch { anyVal = false; }
  return anyVal;
}

/* ---------------- Telegram API ---------------- */
async function tgApi(token, method, payload, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || 8000);
  try {
    const r = await fetch(TG_BASE() + '/bot' + token + '/' + method, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}), signal: ctrl.signal
    });
    const j = await r.json().catch(() => ({ ok: false, error_code: r.status, description: 'Javob o‘qilmadi' }));
    if (!j.error_code && !j.ok) j.error_code = r.status;
    return j;
  } catch (e) {
    return { ok: false, error_code: 0, description: e && e.name === 'AbortError' ? 'Telegram javob bermadi' : String(e && e.message || e) };
  } finally { clearTimeout(timer); }
}

const tokenCache = new Map();          // user -> { token, at }
async function tokenOf(user) {
  const c = tokenCache.get(user);
  if (c && Date.now() - c.at < 60000) return c.token;
  const r = await pool.query(`SELECT token_enc FROM tg_bots WHERE user_id = $1`, [user]);
  const token = r.rows[0] ? dec(r.rows[0].token_enc) : null;
  tokenCache.set(user, { token, at: Date.now() });
  return token;
}

/* ---------------- XABAR YUBORISH (navbat) ---------------- */
/* Kassa yo'llari shuni chaqiradi. Hech qachon xato tashlamaydi. */
export async function tgNotify(user, event, message) {
  try {
    if (!user || !message || !(await tgAnyBots())) return;
    await ensureTgSchema();
    const b = await pool.query(`SELECT events FROM tg_bots WHERE user_id = $1`, [String(user)]);
    if (!b.rows[0]) return;
    const ev = Object.assign({}, DEFAULT_EVENTS, b.rows[0].events || {});
    if (event && ev[event] === false) return;
    const r = await pool.query(`INSERT INTO tg_outbox(user_id, chat_id, text)
      SELECT $1, chat_id, $2 FROM tg_chats WHERE user_id = $1 AND notify RETURNING id`, [String(user), clip(message)]);
    if (r.rowCount) setImmediate(() => { flushTg(5000).catch(() => {}); });
  } catch (e) { console.error('TG NOTIFY:', e.message); }
}

let flushing = null;
export function flushTg(maxMs) {
  if (flushing) return flushing;
  flushing = (async () => {
    const t0 = Date.now();
    const limit = maxMs || 4000;
    while (Date.now() - t0 < limit) {
      const c = await pool.query(`UPDATE tg_outbox SET status = 'sending', claimed_at = now(), tries = tries + 1
        WHERE id IN (SELECT id FROM tg_outbox
                      WHERE (status = 'pending' AND next_at <= now())
                         OR (status = 'sending' AND claimed_at < now() - interval '2 minutes')
                      ORDER BY id LIMIT 10 FOR UPDATE SKIP LOCKED)
        RETURNING id, user_id, chat_id, text, tries`);
      if (!c.rowCount) break;
      for (const m of c.rows.sort((a, b) => Number(a.id) - Number(b.id))) {
        const token = await tokenOf(m.user_id);
        if (!token) { await pool.query(`UPDATE tg_outbox SET status = 'failed', error = 'bot ulanmagan' WHERE id = $1`, [m.id]); continue; }
        const j = await tgApi(token, 'sendMessage', { chat_id: Number(m.chat_id), text: m.text, parse_mode: 'HTML', disable_web_page_preview: true }, 8000);
        if (j.ok) { await pool.query(`UPDATE tg_outbox SET status = 'sent', sent_at = now(), error = NULL WHERE id = $1`, [m.id]); continue; }
        const code = num(j.error_code);
        const wait = num(j.parameters && j.parameters.retry_after);
        if (code === 429) {
          await pool.query(`UPDATE tg_outbox SET status = 'pending', next_at = now() + make_interval(secs => $2), error = $3 WHERE id = $1`,
            [m.id, Math.max(1, wait || 5), j.description || '429']);
        } else if (code === 400 || code === 403) {
          /* chat yo'q / bot guruhdan chiqarilgan / bloklangan — qayta urinish foydasiz */
          await pool.query(`UPDATE tg_outbox SET status = 'failed', error = $2 WHERE id = $1`, [m.id, j.description || String(code)]);
          if (code === 403) await pool.query(`UPDATE tg_chats SET notify = FALSE, last_error = $3 WHERE user_id = $1 AND chat_id = $2`,
            [m.user_id, m.chat_id, j.description || 'bot bloklangan']);
        } else if (m.tries >= 8) {
          await pool.query(`UPDATE tg_outbox SET status = 'failed', error = $2 WHERE id = $1`, [m.id, j.description || 'yuborilmadi']);
        } else {
          await pool.query(`UPDATE tg_outbox SET status = 'pending', next_at = now() + make_interval(secs => $2), error = $3 WHERE id = $1`,
            [m.id, 15 * m.tries, j.description || 'yuborilmadi']);
        }
      }
    }
    if (Math.random() < 0.02) await pool.query(`DELETE FROM tg_outbox WHERE created_at < now() - interval '14 days'`).catch(() => {});
  })().catch(e => console.error('TG FLUSH:', e.message)).finally(() => { flushing = null; });
  return flushing;
}

/* Fon so'rovlarida (kassa har necha soniyada so'raydi) navbatdagi xabarlar
   yuboriladi — Vercel funksiyasi javobdan keyin to'xtab qolsa ham xabar
   yo'qolmaydi, keyingi so'rovda ketadi. */
export async function tgFlushIfAny(maxMs) {
  try {
    if (!(await tgAnyBots())) return;
    await Promise.race([flushTg(maxMs || 1500), new Promise(r => setTimeout(r, maxMs || 1500))]);
  } catch { /* noop */ }
}

/* ---------------- KASSA HODISALARI → MATN ---------------- */
const postTxt = p => (num(p) ? ' · ' + num(p) + '-POST' : '');
export const tgText = {
  start(x) {
    const plan = num(x.target) > 0 && !x.open;
    const end = plan ? new Date(new Date(x.startedAt).getTime() + num(x.target) * 1000) : null;
    const paid = num(x.cash) + num(x.terminal) + num(x.click);
    return '🟢 <b>KIRDI</b> · <b>' + h(x.plate) + '</b>\n'
      + '🕐 ' + hhmm(x.startedAt) + (end ? '–' + hhmm(end) + ' · ' + dur(x.target) : ' · vaqt ochiq') + '\n'
      + '💵 ' + (paid > 0 ? 'to‘landi: ' + h(moneyParts(x.cash, x.terminal, x.click))
        : plan ? 'to‘lanmagan — ' + som(x.planned) : 'pul chiqishda olinadi')
      + postTxt(x.post) + (x.offline ? '\n📴 internetsiz yozilgan (keyin yuborildi)' : '');
  },
  finish(x) {
    const paid = num(x.cash) + num(x.terminal) + num(x.click);
    return '🔴 <b>CHIQDI</b> · <b>' + h(x.plate) + '</b>\n'
      + '🕐 ' + hhmm(x.startedAt) + '–' + hhmm(x.finishedAt) + ' · ' + dur(x.seconds) + '\n'
      + '💵 ' + (paid > 0 ? h(moneyParts(x.cash, x.terminal, x.click)) : 'pul olinmadi')
      + (num(x.debt) > 0 ? '\n⏳ to‘lanmagan: <b>' + som(x.debt) + '</b>' : '')
      + postTxt(x.post) + (x.note ? '\n' + h(x.note) : '');
  },
  auto(x) {
    return '⏰ <b>VAQTI TUGADI</b> · <b>' + h(x.plate) + '</b>\n'
      + '🕐 ' + hhmm(x.startedAt) + '–' + hhmm(x.finishedAt) + ' · ' + dur(x.seconds) + '\n'
      + (num(x.debt) > 0 ? '⏳ to‘lanmagan: <b>' + som(x.debt) + '</b>' : '💵 to‘langan: ' + som(x.paid));
  },
  debt(x) {
    return '💰 <b>QARZ TO‘LANDI</b> · <b>' + h(x.name) + '</b>\n'
      + som(x.total) + ' · ' + h(PAY[x.method] || x.method) + (x.count > 1 ? ' · ' + x.count + ' ta yozuv' : '')
      + (x.oldDays ? '\n📅 ' + h(x.oldDays) + ' dagi qarz' : '') + postTxt(x.post);
  },
  unpay(x) {
    return '↩️ <b>QARZ TO‘LOVI BEKOR QILINDI</b> · <b>' + h(x.plate) + '</b>\n'
      + som(x.amount) + ' yana «To‘lanmagan»da\nSabab: ' + h(x.reason) + postTxt(x.post);
  },
  correct(x) {
    return '✏️ <b>TO‘G‘RILANDI</b> · <b>' + h(x.plate) + '</b>\n'
      + h(x.from) + ' → ' + h(x.to) + '\nSabab: ' + h(x.reason) + postTxt(x.post);
  }
};

/* ---------------- BOT SO'ROVLARI ---------------- */
async function plateReport(user, q) {
  const key = plateKey(q);
  if (key.length < 2) return 'Mashina raqamini yozing, masalan: <code>01A777AA</code> yoki <code>148</code>';
  const exact = await pool.query(`SELECT id, plate FROM vehicles WHERE user_id::text = $1
      AND regexp_replace(upper(plate), '[[:space:]\\-.,''\`‘’ʻʼ"]', '', 'g') = $2`, [user, key]);
  let veh = exact.rows;
  if (!veh.length) {
    const like = await pool.query(`SELECT v.plate, MAX(s.started_at) AS last_at FROM vehicles v
        LEFT JOIN sessions s ON s.vehicle_id = v.id AND s.status <> 'cancelled'
       WHERE v.user_id::text = $1 AND regexp_replace(upper(v.plate), '[[:space:]\\-.,''\`‘’ʻʼ"]', '', 'g') LIKE '%' || $2 || '%'
       GROUP BY v.plate ORDER BY MAX(s.started_at) DESC NULLS LAST LIMIT 8`, [user, key]);
    if (!like.rows.length) return '🔎 <b>' + h(q) + '</b> — topilmadi.\nRaqamni to‘liq yozing (masalan <code>01A777AA</code>).';
    if (like.rows.length > 1) {
      return '🔎 Bir nechta mashina mos keldi — kerakligini aniq yozing:\n'
        + like.rows.map(r => '• <code>' + h(r.plate) + '</code>' + (r.last_at ? ' (oxirgi: ' + ddmm(r.last_at) + ')' : '')).join('\n');
    }
    veh = (await pool.query(`SELECT id, plate FROM vehicles WHERE user_id::text = $1 AND plate = $2`, [user, like.rows[0].plate])).rows;
  }
  const ids = veh.map(v => v.id);
  const plate = veh[0].plate;
  const day = todayTk();
  const [inside, today, debts, last, total] = await Promise.all([
    pool.query(`SELECT s.started_at, s.status, COALESCE(s.target_duration,0) AS target, s.auto_close, s.planned_amount,
        COALESCE(s.cash_amount,0) c, COALESCE(s.terminal_amount,0) t, COALESCE(s.click_amount,0) k, s.post,
        COALESCE(s.duration_seconds,0) d, s.resumed_at
      FROM sessions s WHERE s.vehicle_id = ANY($1) AND s.status IN ('active','frozen','paused') ORDER BY s.started_at`, [ids]),
    pool.query(`SELECT COUNT(*)::int n, COALESCE(SUM(CASE WHEN s.status='active' THEN EXTRACT(EPOCH FROM now()-s.started_at) ELSE s.duration_seconds END),0)::bigint sec,
        COALESCE(SUM(s.amount),0)::float8 paid, COALESCE(SUM(s.debt_amount),0)::float8 debt
      FROM sessions s WHERE s.vehicle_id = ANY($1) AND s.status IN ('completed','active','frozen','paused')
        AND s.started_at >= ($2::date::timestamp AT TIME ZONE '${TZ}') AND s.started_at < (($2::date + 1)::timestamp AT TIME ZONE '${TZ}')`, [ids, day]),
    pool.query(`SELECT COUNT(*)::int n, COALESCE(SUM(s.debt_amount),0)::float8 total, MIN(s.started_at) oldest
      FROM sessions s WHERE s.vehicle_id = ANY($1) AND s.status = 'completed' AND s.debt_amount > 0`, [ids]),
    pool.query(`SELECT s.started_at, s.finished_at, s.status, COALESCE(s.duration_seconds,0) d, COALESCE(s.amount,0) a,
        COALESCE(s.cash_amount,0) c, COALESCE(s.terminal_amount,0) t, COALESCE(s.click_amount,0) k,
        COALESCE(s.debt_amount,0) debt, COALESCE(s.debt_paid,0) dp, s.settled_at, s.post, s.pay_post, s.student_id
      FROM sessions s WHERE s.vehicle_id = ANY($1) AND s.status IN ('completed','active','frozen','paused')
      ORDER BY s.started_at DESC LIMIT 6`, [ids]),
    pool.query(`SELECT COUNT(*)::int n, MIN(s.started_at) first FROM sessions s
      WHERE s.vehicle_id = ANY($1) AND s.status IN ('completed','active','frozen','paused')`, [ids])
  ]);
  const out = ['🚗 <b>' + h(plate) + '</b>'];
  if (inside.rows.length) {
    for (const s of inside.rows) {
      const el = s.status === 'active' ? (Date.now() - new Date(s.resumed_at || s.started_at).getTime()) / 1000 + num(s.resumed_at ? s.d : 0) : num(s.d);
      const paid = num(s.c) + num(s.t) + num(s.k);
      const end = num(s.target) > 0 ? new Date(new Date(s.started_at).getTime() + num(s.target) * 1000) : null;
      out.push('🟢 <b>HOZIR ICHKARIDA</b>' + (s.status !== 'active' ? ' (muzlatilgan)' : '') + ' — ' + hhmm(s.started_at) + ' dan, ' + dur(el)
        + (end ? '\n   reja: ' + hhmm(end) + ' gacha' + (end.getTime() < Date.now() ? ' (vaqti o‘tdi)' : ' (' + dur((end.getTime() - Date.now()) / 1000) + ' qoldi)') : '')
        + '\n   ' + (paid > 0 ? 'to‘langan: ' + moneyParts(s.c, s.t, s.k) : num(s.planned_amount) > 0 ? 'to‘lanmagan — ' + som(s.planned_amount) : 'pul chiqishda')
        + postTxt(s.post));
    }
  } else out.push('⚪️ Hozir ichkarida emas');
  const T = today.rows[0];
  out.push('📅 <b>Bugun:</b> ' + (T.n ? T.n + ' marta · ' + dur(T.sec) + ' · to‘lagan ' + som(T.paid) + (num(T.debt) > 0 ? ' · qarz ' + som(T.debt) : '') : 'kelmagan'));
  const D = debts.rows[0];
  out.push(num(D.total) > 0 ? '⏳ <b>To‘lanmagan:</b> ' + som(D.total) + ' (' + D.n + ' ta, ' + ddmm(D.oldest) + ' dan)' : '✅ Qarzi yo‘q');
  if (last.rows.length) {
    out.push('\n<b>Oxirgi tashriflar:</b>');
    for (const r of last.rows) {
      const m = moneyParts(r.c, r.t, r.k);
      out.push('• ' + ddmm(r.started_at) + ' ' + hhmm(r.started_at) + (r.finished_at ? '–' + hhmm(r.finished_at) : ' — ichkarida')
        + ' · ' + dur(r.d)
        + (r.student_id ? ' · avtoshkola' : (m ? ' · ' + m : ''))
        + (num(r.debt) > 0 ? ' · <b>qarz ' + som(r.debt) + '</b>' : '')
        + (num(r.dp) > 0 ? ' · qarz ' + som(r.dp) + ' ' + (r.settled_at ? ddmm(r.settled_at) : '') + ' to‘langan' : ''));
    }
  }
  const A = total.rows[0];
  if (A.n) out.push('\nJami: ' + A.n + ' marta kelgan' + (A.first ? ', birinchi: ' + ddmm(A.first) + '.' + tk(A.first).toISOString().slice(0, 4) : ''));
  return out.join('\n');
}

async function insideReport(user) {
  const r = await pool.query(`SELECT COALESCE(v.plate, s.driver_name, '—') plate, s.started_at, s.status, COALESCE(s.target_duration,0) target,
      COALESCE(s.cash_amount,0)+COALESCE(s.terminal_amount,0)+COALESCE(s.click_amount,0) paid, s.planned_amount, s.post,
      s.student_id, st.full_name student
    FROM sessions s LEFT JOIN vehicles v ON v.id = s.vehicle_id LEFT JOIN students st ON st.id::text = s.student_id::text
    WHERE s.user_id::text = $1 AND s.status IN ('active','frozen','paused') ORDER BY s.started_at LIMIT 60`, [user]);
  if (!r.rows.length) return '⚪️ Hozir avtodromda mashina yo‘q.';
  const lines = r.rows.map(s => {
    const end = num(s.target) > 0 ? new Date(new Date(s.started_at).getTime() + num(s.target) * 1000) : null;
    return (s.student_id ? '🎓 ' : '🚗 ') + '<b>' + h(s.plate) + '</b>' + (s.student ? ' (' + h(s.student) + ')' : '')
      + ' — ' + hhmm(s.started_at) + (end ? '–' + hhmm(end) : ' dan') + ' · ' + dur((Date.now() - new Date(s.started_at).getTime()) / 1000)
      + (s.status !== 'active' ? ' · muzlatilgan' : '')
      + (s.student_id ? '' : num(s.paid) > 0 ? ' · to‘langan' : num(s.planned_amount) > 0 ? ' · to‘lanmagan ' + som(s.planned_amount) : ' · ochiq')
      + postTxt(s.post);
  });
  return '🟢 <b>Hozir ichkarida: ' + r.rows.length + ' ta</b>\n' + lines.join('\n');
}

async function todayReport(user) {
  const day = todayTk();
  const range = `m.at >= ($2::date::timestamp AT TIME ZONE '${TZ}') AND m.at < (($2::date + 1)::timestamp AT TIME ZONE '${TZ}')`;
  const [m, c, d] = await Promise.all([
    pool.query(`SELECT COALESCE(SUM(m.total),0)::float8 total, COALESCE(SUM(m.cash),0)::float8 cash, COALESCE(SUM(m.terminal),0)::float8 terminal,
        COALESCE(SUM(m.click),0)::float8 click, COALESCE(SUM(m.total) FILTER (WHERE ${IS_KECHAGI('m')}),0)::float8 kech,
        COALESCE(SUM(m.total) FILTER (WHERE m.post = 1),0)::float8 p1, COALESCE(SUM(m.total) FILTER (WHERE m.post = 2),0)::float8 p2
      FROM ${MONEY_EVENTS} m WHERE m.user_id = $1 AND ${range}`, [user, day]),
    pool.query(`SELECT COUNT(*) FILTER (WHERE NOT (s.student_id IS NOT NULL OR s.school_id IS NOT NULL OR COALESCE(s.customer_type,'')='school'))::int paid_n,
        COUNT(*) FILTER (WHERE s.student_id IS NOT NULL OR s.school_id IS NOT NULL OR COALESCE(s.customer_type,'')='school')::int school_n,
        COUNT(*) FILTER (WHERE s.status IN ('active','frozen','paused'))::int inside,
        COALESCE(SUM(s.debt_amount),0)::float8 debt
      FROM sessions s WHERE s.user_id::text = $1 AND s.status IN ('completed','active','frozen','paused')
        AND s.started_at >= ($2::date::timestamp AT TIME ZONE '${TZ}') AND s.started_at < (($2::date + 1)::timestamp AT TIME ZONE '${TZ}')`, [user, day]),
    pool.query(`SELECT COALESCE(SUM(amount),0)::float8 total, COALESCE(SUM(amount) FILTER (WHERE pay_method = 'cash'),0)::float8 cash
      FROM expenses WHERE user_id::text = $1 AND deleted_at IS NULL AND spent_on = $2::date`, [user, day]).catch(() => ({ rows: [{ total: 0, cash: 0 }] }))
  ]);
  const M = m.rows[0], C = c.rows[0], E = d.rows[0];
  return '📊 <b>Bugun, ' + ddmm(Date.now()) + '</b>\n'
    + '💰 Jami tushum: <b>' + som(M.total) + '</b>\n'
    + '   naqd ' + som(M.cash) + ' · terminal ' + som(M.terminal) + ' · Klik ' + som(M.click) + '\n'
    + (num(M.kech) ? '   shundan oldingi kunlar qarzidan: ' + som(M.kech) + '\n' : '')
    + '🏷 1-POST: ' + som(M.p1) + ' · 2-POST: ' + som(M.p2) + '\n'
    + '🚗 Mashinalar: ' + C.paid_n + ' ta · 🎓 avtoshkola: ' + C.school_n + ' ta · hozir ichkarida: ' + C.inside + '\n'
    + (num(C.debt) ? '⏳ Bugungi to‘lanmagan: ' + som(C.debt) + '\n' : '')
    + (num(E.total) ? '🧾 Xarajat: ' + som(E.total) + ' (naqd ' + som(E.cash) + ')\n' : '')
    + '💵 Kassada naqd (taxminan): ' + som(num(M.cash) - num(E.cash));
}

async function debtsReport(user) {
  try { const k = await import('./kassa-routes.js'); await k.autoCloseDue(user); } catch { /* noop */ }
  const r = await pool.query(`SELECT COALESCE(v.plate, s.driver_name, '—') plate, COUNT(*)::int n, SUM(s.debt_amount)::float8 total, MIN(s.started_at) oldest
    FROM sessions s LEFT JOIN vehicles v ON v.id = s.vehicle_id
    WHERE s.user_id::text = $1 AND s.status = 'completed' AND s.debt_amount > 0
    GROUP BY 1 ORDER BY 3 DESC LIMIT 30`, [user]);
  if (!r.rows.length) return '✅ To‘lanmagan qarz yo‘q.';
  const sum = r.rows.reduce((a, x) => a + num(x.total), 0);
  return '⏳ <b>To‘lanmagan: ' + som(sum) + '</b>\n'
    + r.rows.map(x => '• <b>' + h(x.plate) + '</b> — ' + som(x.total) + (x.n > 1 ? ' (' + x.n + ' ta)' : '') + ' · ' + ddmm(x.oldest) + ' dan').join('\n');
}

const HELP = '🤖 <b>Avtodrom bot</b>\n'
  + '• Mashina raqamini yozing — <code>01A777AA</code>, <code>148</code>, <code>455 dilnoza</code>: hozir ichkaridami, bugun, qarzi, oxirgi tashriflari\n'
  + '• /ichkarida — hozir avtodromdagi mashinalar\n'
  + '• /bugun — bugungi tushum (1-POST, 2-POST)\n'
  + '• /qarzlar — to‘lanmaganlar\n'
  + '• Guruhda: <code>/raqam 01A777AA</code>\n'
  + 'Kirdi / Chiqdi / qarz to‘lovlari haqida xabarlar o‘zi keladi.';

/* ---------------- WEBHOOK ---------------- */
const codeFails = new Map();           // `${user}:${chat}` -> { n, at } — kod tanlab topishga qarshi
async function webhook(req, res, secret) {
  await ensureTgSchema();
  const b = await pool.query(`SELECT user_id, bot_username FROM tg_bots WHERE hook_secret = $1`, [secret]);
  const bot = b.rows[0];
  const hdr = String(req.headers['x-telegram-bot-api-secret-token'] || '');
  if (!bot || hdr !== secret) return json(res, 404, { ok: false });
  const user = String(bot.user_id);
  const upd = await readBody(req);
  const msg = upd && (upd.message || upd.edited_message || upd.channel_post);
  if (!msg || !msg.chat) return json(res, 200, { ok: true });
  const chat = msg.chat;
  const raw = text(msg.text || msg.caption || '');
  const reply = t => json(res, 200, { method: 'sendMessage', chat_id: chat.id, text: clip(t),
    parse_mode: 'HTML', disable_web_page_preview: true, ...(chat.type !== 'private' ? { reply_to_message_id: msg.message_id } : {}) });
  if (!raw) return json(res, 200, { ok: true });

  /* buyruq: «/bugun@avto_bot arg» → cmd=bugun, arg */
  let cmd = '', arg = raw;
  const cm = raw.match(/^\/([A-Za-z_]+)(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]*))?$/);
  if (cm) {
    if (cm[2] && bot.bot_username && cm[2].toLowerCase() !== String(bot.bot_username).toLowerCase()) return json(res, 200, { ok: true });
    cmd = cm[1].toLowerCase(); arg = text(cm[3]);
  }
  const linked = (await pool.query(`SELECT notify FROM tg_chats WHERE user_id = $1 AND chat_id = $2`, [user, chat.id])).rows[0];

  if (!linked) {
    /* ulash: «/start 123456» yoki shunchaki «123456» */
    const code = (cmd === 'start' ? arg : raw).replace(/\D/g, '');
    const fk = user + ':' + chat.id, f = codeFails.get(fk);
    if (f && f.n >= 5 && Date.now() - f.at < 10 * 60000) return reply('⏳ Ko‘p marta noto‘g‘ri kod yozildi. 10 daqiqadan keyin urinib ko‘ring.');
    if (/^\d{6}$/.test(code)) {
      const del = await pool.query(`DELETE FROM tg_codes WHERE code = $1 AND user_id = $2 AND expires_at > now() RETURNING code`, [code, user]);
      if (del.rowCount) {
        const title = chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || String(chat.id);
        await pool.query(`INSERT INTO tg_chats(user_id, chat_id, title, kind, username, last_seen) VALUES($1, $2, $3, $4, $5, now())
          ON CONFLICT (user_id, chat_id) DO UPDATE SET title = EXCLUDED.title, kind = EXCLUDED.kind, notify = TRUE, last_seen = now(), last_error = NULL`,
          [user, chat.id, String(title).slice(0, 120), chat.type || '', chat.username || null]);
        return reply('✅ <b>Ulandi!</b> Endi bu ' + (chat.type === 'private' ? 'chatga' : 'guruhga') + ' kassa xabarlari keladi.\n\n' + HELP);
      }
      codeFails.set(fk, { n: (f && Date.now() - f.at < 10 * 60000 ? f.n : 0) + 1, at: Date.now() });
      return reply('❌ Kod noto‘g‘ri yoki eskirgan. Kassada (Maxsus bo‘lim → Telegram bot) yangi kod oling.');
    }
    if (chat.type !== 'private' && !cm) return json(res, 200, { ok: true });   /* guruhdagi boshqa gaplarga jim */
    return reply('🔒 Bu bot avtodrom kassasi uchun.\nUlanish uchun kassadagi <b>Maxsus bo‘lim → Telegram bot</b> sahifasidagi 6 xonali kodni yuboring.');
  }

  await pool.query(`UPDATE tg_chats SET last_seen = now() WHERE user_id = $1 AND chat_id = $2`, [user, chat.id]).catch(() => {});
  try {
    if (cmd === 'start' || cmd === 'help' || cmd === 'yordam') return reply(HELP);
    if (cmd === 'ichkarida' || cmd === 'inside') return reply(await insideReport(user));
    if (cmd === 'bugun' || cmd === 'today' || cmd === 'hisobot') return reply(await todayReport(user));
    if (cmd === 'qarzlar' || cmd === 'qarz' || cmd === 'debts') return reply(await debtsReport(user));
    if (cmd === 'raqam' || cmd === 'r' || cmd === 'mashina') return reply(arg ? await plateReport(user, arg) : 'Raqamni yozing: <code>/raqam 01A777AA</code>');
    if (cmd) return reply('Bunday buyruq yo‘q.\n\n' + HELP);
    if (chat.type !== 'private') return json(res, 200, { ok: true });    /* guruhda faqat buyruqlar */
    return reply(await plateReport(user, raw.slice(0, 40)));
  } catch (e) {
    console.error('TG BOT:', e.message);
    return reply('⚠️ Ma’lumot olinmadi, birozdan keyin qayta yozing.');
  }
}

/* ---------------- SOZLASH (Maxsus bo'lim) ---------------- */
function publicBase(req) {
  if (process.env.PUBLIC_URL) return String(process.env.PUBLIC_URL).replace(/\/+$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return proto + '://' + host;
}

async function status(res, user) {
  const b = (await pool.query(`SELECT bot_username, bot_name, events, webhook_ok, last_error, updated_at FROM tg_bots WHERE user_id = $1`, [user])).rows[0];
  if (!b) return json(res, 200, { configured: false, events: TG_EVENTS });
  const chats = (await pool.query(`SELECT chat_id::text AS chat_id, title, kind, username, notify, linked_at, last_seen, last_error
    FROM tg_chats WHERE user_id = $1 ORDER BY linked_at`, [user])).rows;
  const q = (await pool.query(`SELECT COUNT(*) FILTER (WHERE status IN ('pending','sending'))::int pending,
      COUNT(*) FILTER (WHERE status = 'failed' AND created_at > now() - interval '1 day')::int failed,
      MAX(sent_at) last_sent FROM tg_outbox WHERE user_id = $1`, [user])).rows[0];
  json(res, 200, { configured: true, bot_username: b.bot_username, bot_name: b.bot_name, webhook_ok: b.webhook_ok,
    last_error: b.last_error, events: TG_EVENTS, enabled: Object.assign({}, DEFAULT_EVENTS, b.events || {}), chats, queue: q });
}

async function connect(req, res, user) {
  const body = await readBody(req);
  const token = text(body.token).replace(/\s+/g, '');
  if (!/^\d{5,15}:[A-Za-z0-9_-]{30,60}$/.test(token)) return json(res, 400, { error: 'Token noto‘g‘ri ko‘rinishda. BotFather bergan tokenni to‘liq qo‘ying (masalan 123456789:AAH...)' });
  const me = await tgApi(token, 'getMe', {}, 10000);
  if (!me.ok || !me.result) return json(res, 400, { error: me.error_code === 401 || me.error_code === 404 ? 'Token noto‘g‘ri — BotFather bergan tokenni tekshiring' : 'Telegram bilan bog‘lanib bo‘lmadi: ' + (me.description || '') });
  const old = (await pool.query(`SELECT hook_secret FROM tg_bots WHERE user_id = $1`, [user])).rows[0];
  const secret = old ? old.hook_secret : crypto.randomBytes(24).toString('hex');
  const url = publicBase(req) + '/api/telegram/hook/' + secret;
  const wh = await tgApi(token, 'setWebhook', { url, secret_token: secret, allowed_updates: ['message', 'edited_message'], drop_pending_updates: true, max_connections: 20 }, 10000);
  await tgApi(token, 'setMyCommands', { commands: [
    { command: 'ichkarida', description: 'Hozir avtodromdagi mashinalar' },
    { command: 'bugun', description: 'Bugungi tushum' },
    { command: 'qarzlar', description: 'To‘lanmaganlar' },
    { command: 'raqam', description: 'Mashina haqida: /raqam 01A777AA' },
    { command: 'yordam', description: 'Qanday ishlatiladi' }
  ] }, 8000);
  await pool.query(`INSERT INTO tg_bots(user_id, token_enc, bot_id, bot_username, bot_name, hook_secret, webhook_ok, last_error)
    VALUES($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (user_id) DO UPDATE SET token_enc = EXCLUDED.token_enc, bot_id = EXCLUDED.bot_id, bot_username = EXCLUDED.bot_username,
      bot_name = EXCLUDED.bot_name, webhook_ok = EXCLUDED.webhook_ok, last_error = EXCLUDED.last_error, updated_at = now()`,
    [user, enc(token), me.result.id, me.result.username || null, me.result.first_name || null, secret, !!wh.ok, wh.ok ? null : (wh.description || 'webhook o‘rnatilmadi')]);
  tokenCache.delete(user); anyAt = 0;
  json(res, 200, { ok: true, bot_username: me.result.username, webhook_ok: !!wh.ok,
    warning: wh.ok ? null : 'Bot ulandi, lekin Telegram manzilni qabul qilmadi: ' + (wh.description || '') + ' — sayt https manzilida ochilganini tekshiring' });
}

async function disconnect(res, user) {
  const token = await tokenOf(user);
  if (token) await tgApi(token, 'deleteWebhook', { drop_pending_updates: true }, 8000);
  await pool.query(`DELETE FROM tg_outbox WHERE user_id = $1 AND status IN ('pending','sending')`, [user]);
  await pool.query(`DELETE FROM tg_bots WHERE user_id = $1`, [user]);
  tokenCache.delete(user); anyAt = 0;
  json(res, 200, { ok: true });
}

async function newCode(res, user) {
  const b = (await pool.query(`SELECT bot_username FROM tg_bots WHERE user_id = $1`, [user])).rows[0];
  if (!b) return json(res, 409, { error: 'Avval botni ulang (token)' });
  await pool.query(`DELETE FROM tg_codes WHERE user_id = $1 OR expires_at < now()`, [user]);
  let code = '';
  for (let i = 0; i < 5; i++) {
    code = String(crypto.randomInt(100000, 1000000));
    const r = await pool.query(`INSERT INTO tg_codes(code, user_id, expires_at) VALUES($1, $2, now() + interval '10 minutes')
      ON CONFLICT (code) DO NOTHING RETURNING code`, [code, user]);
    if (r.rowCount) break;
  }
  json(res, 200, { code, bot_username: b.bot_username, expires_in: 600,
    link: b.bot_username ? 'https://t.me/' + b.bot_username + '?start=' + code : null,
    group_link: b.bot_username ? 'https://t.me/' + b.bot_username + '?startgroup=' + code : null });
}

async function setChat(req, res, user) {
  const body = await readBody(req);
  const id = text(body.chat_id);
  if (!/^-?\d{1,20}$/.test(id)) return json(res, 400, { error: 'Chat tanlanmagan' });
  if (body.remove === true) {
    await pool.query(`DELETE FROM tg_chats WHERE user_id = $1 AND chat_id = $2::bigint`, [user, id]);
    return json(res, 200, { ok: true });
  }
  await pool.query(`UPDATE tg_chats SET notify = $3, last_error = CASE WHEN $3 THEN NULL ELSE last_error END WHERE user_id = $1 AND chat_id = $2::bigint`, [user, id, body.notify !== false]);
  json(res, 200, { ok: true });
}

async function setEvents(req, res, user) {
  const body = await readBody(req);
  const ev = {};
  for (const k of Object.keys(TG_EVENTS)) ev[k] = !(body.events && body.events[k] === false);
  const r = await pool.query(`UPDATE tg_bots SET events = $2::jsonb, updated_at = now() WHERE user_id = $1`, [user, JSON.stringify(ev)]);
  if (!r.rowCount) return json(res, 409, { error: 'Avval botni ulang' });
  json(res, 200, { ok: true, enabled: ev });
}

async function testMsg(res, user) {
  const r = await pool.query(`INSERT INTO tg_outbox(user_id, chat_id, text)
    SELECT $1, chat_id, $2 FROM tg_chats WHERE user_id = $1 AND notify RETURNING id`,
    [user, '✅ <b>Sinov xabari</b>\nAvtodrom kassasidan xabarlar shu yerga keladi. ' + hhmm(Date.now())]);
  if (!r.rowCount) return json(res, 409, { error: 'Hali hech kim ulanmagan — «Odam yoki guruh qo‘shish» ni bosing' });
  await Promise.race([flushTg(6000), new Promise(x => setTimeout(x, 6000))]);
  const st = await pool.query(`SELECT status, error FROM tg_outbox WHERE id = ANY($1::bigint[])`, [r.rows.map(x => x.id)]);
  const sent = st.rows.filter(x => x.status === 'sent').length;
  json(res, 200, { ok: true, total: r.rowCount, sent, errors: st.rows.filter(x => x.status === 'failed' || x.error).map(x => x.error).filter(Boolean) });
}

export async function handleTelegramRequest(req, res) {
  const path = String(req.url || '').split('?', 1)[0];
  if (!path.startsWith('/api/telegram/')) return false;
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return true; }
  try {
    const hm = path.match(/^\/api\/telegram\/hook\/([A-Za-z0-9_-]{16,128})$/);
    if (hm) {
      if (req.method !== 'POST') { json(res, 405, { ok: false }); return true; }
      await webhook(req, res, hm[1]);
      return true;
    }
    const user = auth(req);
    if (!user) { json(res, 401, { error: 'Kirish talab qilinadi' }); return true; }
    if (!maxsusOk(req, user)) { lockedResponse(res); return true; }
    await ensureTgSchema();
    if (path === '/api/telegram/status' && req.method === 'GET') { await status(res, user); return true; }
    if (path === '/api/telegram/connect' && req.method === 'POST') { await connect(req, res, user); return true; }
    if (path === '/api/telegram/disconnect' && req.method === 'POST') { await disconnect(res, user); return true; }
    if (path === '/api/telegram/code' && req.method === 'POST') { await newCode(res, user); return true; }
    if (path === '/api/telegram/chat' && req.method === 'POST') { await setChat(req, res, user); return true; }
    if (path === '/api/telegram/events' && req.method === 'POST') { await setEvents(req, res, user); return true; }
    if (path === '/api/telegram/test' && req.method === 'POST') { await testMsg(res, user); return true; }
    json(res, 404, { error: 'Topilmadi' });
    return true;
  } catch (e) {
    console.error('TELEGRAM ERROR:', e);
    json(res, 500, { error: e.message || 'Telegram bo‘yicha xatolik' });
    return true;
  }
}
