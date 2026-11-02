/* ============================================================================
   HISOBLAR VA KOMPYUTERLAR — kim hozir kirgan

   Tizim kirishni (login) serverda saqlamaydi — kalit (token) kompyuterda
   turadi. Shuning uchun «hozir kim kirgan» faoliyat bo'yicha aniqlanadi:
   kassa sahifasi har so'rovda (va yashirin turganda ham har daqiqada)
   o'z qurilma raqamini (X-Device) yuboradi; server hisob + kompyuter
   bo'yicha oxirgi faollik vaqtini yozadi (`user_activity`, bir daqiqada
   ko'pi bilan bir marta).

     GET  /api/accounts/ping      — yurak urishi (sahifa yopiq turganda ham)
     GET  /api/accounts/activity  — hamma hisoblar: kompyuterlari, oxirgi
                                    faolligi, bugungi va ochiq yozuvlari
                                    (Maxsus kaliti bilan)
     GET  /api/accounts/delete-preview?id=…  — o'chirilsa nima ketadi
     POST /api/accounts/delete  { id, confirm, password }
          — hisob va uning HAMMA ma'lumoti bazadan butunlay o'chiriladi.
            Maxsus kaliti + Maxsus parol qayta yoziladi + hisob logini
            qo'lda yoziladi. O'z hisobini, admin hisobini va o'zidan
            ko'p yozuvli hisobni o'chirib bo'lmaydi (yangi ochilgan begona
            hisob asosiy hisobni o'chira olmasin).
          O'chirilgan hisobning kompyuterlari keyingi so'rovda tizimdan
          chiqadi (deleted_accounts — kim, qachon, nechta yozuv).
   ========================================================================== */

import jwt from 'jsonwebtoken';
import { pool } from '../backend/src/db.js';
import { runOnce } from '../backend/src/schema-once.js';
import { maxsusOk, lockedResponse, checkMaxsusPassword } from './lock-routes.js';
import { MONEY_EVENTS } from './money-sql.js';
import { logChange } from './audit-routes.js';
import { tgTokenFor, tgForget } from './telegram.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
const ONLINE_SEC = 5 * 60;

function json(res, status, data) {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}
function userOf(req) {
  try {
    const h = req.headers?.authorization || '';
    if (!h.startsWith('Bearer ')) return null;
    const p = jwt.verify(h.slice(7), JWT_SECRET);
    return p && p.sub && String(p.sub) !== 'admin' ? String(p.sub) : null;
  } catch { return null; }
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  return await new Promise(resolve => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 1e4) req.destroy(); });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

let schemaP = null;
function ensureSchema() {
  if (schemaP) return schemaP;
  schemaP = runOnce('user-activity-v1', async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS user_activity(
      user_id TEXT NOT NULL, device_id TEXT NOT NULL,
      first_seen TIMESTAMPTZ NOT NULL DEFAULT now(), last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
      ip TEXT, ua TEXT, post SMALLINT, hits INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY(user_id, device_id))`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_activity_seen ON user_activity(last_seen DESC)`);
  }).catch(e => { schemaP = null; throw e; });
  return schemaP;
}

let delSchemaP = null;
function ensureDelSchema() {
  if (delSchemaP) return delSchemaP;
  delSchemaP = runOnce('deleted-accounts-v1', async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS deleted_accounts(
      user_id TEXT PRIMARY KEY, username TEXT, full_name TEXT,
      deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_by TEXT,
      rows_deleted INTEGER, summary JSONB)`);
  }).catch(e => { delSchemaP = null; throw e; });
  return delSchemaP;
}

/* O'chirilgan hisob kalitlari (token 30 kun amal qiladi) — darhol yaroqsiz.
   Ro'yxat har serverda 20 soniyada bir yangilanadi. */
let delSet = new Set(), delAt = 0, delLoad = null;
async function deletedSet() {
  if (Date.now() - delAt < 20000) return delSet;
  if (!delLoad) delLoad = (async () => {
    await ensureDelSchema();
    const r = await pool.query(`SELECT user_id FROM deleted_accounts`);
    delSet = new Set(r.rows.map(x => String(x.user_id)));
    delAt = Date.now();
  })().finally(() => { delLoad = null; });
  await delLoad;
  return delSet;
}
export async function isDeletedAccount(req) {
  const user = userOf(req);
  if (!user) return false;
  try { return (await deletedSet()).has(user); } catch { return false; }
}

/* Har /api so'rovida chaqiriladi — bir daqiqada bir marta yoziladi */
const seen = new Map();
export async function trackActivity(req) {
  try {
    const user = userOf(req);
    if (!user) return;
    const dev = String(req.headers['x-device'] || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'nomalum';
    const k = user + ':' + dev;
    const now = Date.now();
    if (seen.has(k) && now - seen.get(k) < 60000) return;
    seen.set(k, now);
    if (seen.size > 5000) seen.clear();
    await ensureSchema();
    const h = req.headers || {};
    const ip = String(h['x-real-ip'] || h['x-vercel-forwarded-for'] || String(h['x-forwarded-for'] || '').split(',')[0] || req.socket?.remoteAddress || '').trim().slice(0, 64);
    const post = Number(h['x-post']);
    await pool.query(`INSERT INTO user_activity(user_id, device_id, ip, ua, post) VALUES($1, $2, $3, $4, $5)
      ON CONFLICT (user_id, device_id) DO UPDATE SET last_seen = now(), ip = EXCLUDED.ip, ua = EXCLUDED.ua,
        post = COALESCE(EXCLUDED.post, user_activity.post), hits = user_activity.hits + 1`,
      [user, dev, ip || null, String(h['user-agent'] || '').slice(0, 300) || null, post === 1 || post === 2 ? post : null]);
  } catch (e) { console.error('ACTIVITY:', e.message); }
}

/* «Chrome · Windows» kabi qisqa nom */
function device(ua) {
  const s = String(ua || '');
  const br = /Edg\//.test(s) ? 'Edge' : /OPR\//.test(s) ? 'Opera' : /YaBrowser/.test(s) ? 'Yandex' : /Chrome\//.test(s) ? 'Chrome'
    : /Firefox\//.test(s) ? 'Firefox' : /Safari\//.test(s) ? 'Safari' : 'Brauzer';
  const os = /Windows/.test(s) ? 'Windows' : /Android/.test(s) ? 'Android' : /iPhone|iPad/.test(s) ? 'iPhone' : /Mac OS/.test(s) ? 'Mac' : /Linux/.test(s) ? 'Linux' : '';
  return br + (os ? ' · ' + os : '');
}

async function activity(res, me) {
  await ensureSchema();
  const TZ = 'Asia/Tashkent';
  const [users, acts, sess] = await Promise.all([
    pool.query(`SELECT id::text AS id, username, full_name, role, created_at FROM users ORDER BY created_at`),
    pool.query(`SELECT user_id, device_id, first_seen, last_seen, ip, ua, post, hits,
        EXTRACT(EPOCH FROM (now() - last_seen))::int AS ago FROM user_activity ORDER BY last_seen DESC`),
    pool.query(`SELECT user_id::text AS user_id, COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status IN ('active','frozen','paused'))::int AS open,
        COUNT(*) FILTER (WHERE status <> 'cancelled' AND started_at >= ((now() AT TIME ZONE '${TZ}')::date::timestamp AT TIME ZONE '${TZ}'))::int AS today,
        MAX(started_at) FILTER (WHERE status <> 'cancelled') AS last_session
      FROM sessions GROUP BY 1`)
  ]);
  const S = new Map(sess.rows.map(x => [x.user_id, x]));
  const A = new Map();
  for (const a of acts.rows) {
    const list = A.get(a.user_id) || [];
    list.push({ device: device(a.ua), post: a.post, last_seen: a.last_seen, first_seen: a.first_seen, online: a.ago <= ONLINE_SEC,
      ip: a.ip ? a.ip.replace(/(\d+\.\d+)\.\d+\.\d+$/, '$1.*.*') : null, me: false });
    A.set(a.user_id, list);
  }
  const myTotal = Number((S.get(me) || {}).total || 0);
  const rows = users.rows.map(u => {
    const devs = A.get(u.id) || [];
    const s = S.get(u.id) || {};
    const t = { id: u.id, username: u.username, full_name: u.full_name, role: u.role || null, created_at: u.created_at, me: u.id === me,
      online: devs.some(d => d.online), devices: devs, last_seen: devs[0] ? devs[0].last_seen : null,
      open: Number(s.open || 0), today: Number(s.today || 0), total: Number(s.total || 0), last_session: s.last_session || null };
    t.block = blockOf(me, t, myTotal);
    t.can_delete = !t.block;
    return t;
  }).sort((a, b) => (b.online - a.online) || (new Date(b.last_seen || b.last_session || 0) - new Date(a.last_seen || a.last_session || 0)));
  json(res, 200, {
    accounts: rows,
    total: rows.length,
    online_accounts: rows.filter(r => r.online).length,
    online_devices: rows.reduce((n, r) => n + r.devices.filter(d => d.online).length, 0),
    today_accounts: rows.filter(r => r.today > 0).length,
    my_total: myTotal,
    window_min: ONLINE_SEC / 60
  });
}

/* ======================= HISOBNI BUTUNLAY O'CHIRISH ======================= */

const WS = () => String(process.env.WORKSPACE_OWNER_ID || '').trim();

/* Nega o'chirib bo'lmaydi (null — mumkin) */
function blockOf(me, t, myTotal) {
  if (!t) return 'Hisob topilmadi';
  if (t.id === me) return 'Bu — siz hozir kirgan hisob. O‘z hisobingizni o‘chira olmaysiz.';
  if (t.role === 'admin') return 'Bu admin panel hisobi — bu yerdan o‘chirilmaydi.';
  if (WS() && WS() === t.id) return 'Umumiy baza (avtoshkolalar, instruktorlar) shu hisobga bog‘langan — o‘chirilmaydi.';
  if (Number(t.total || 0) > Number(myTotal || 0)) {
    return 'Bu hisobda yozuvlar sizning hisobingizdagidan ko‘p (' + t.total + ' ta, sizda ' + (myTotal || 0)
      + ' ta). Uni faqat asosiy hisobdan — yozuvlari ko‘p hisobdan kirib o‘chirish mumkin.';
  }
  return null;
}

const LABEL = {
  sessions: 'Mashina yozuvlari (kirdi / chiqdi, pul)', debt_payments: 'Qarz to‘lovlari',
  expenses: 'Rasxod (xarajatlar)', waiting_queue: 'Navbat (kutish)', waiting_sessions: 'Navbat (kutish)',
  driving_schools: 'Avtoshkolalar', school_groups: 'Guruhlar', students: 'O‘quvchilar',
  instructors: 'Instruktorlar', avtodrom_instructors: 'Instruktorlar',
  vehicles: 'Mashinalar ro‘yxati', school_vehicles: 'Mashinalar ro‘yxati',
  receipts: 'Cheklar (QR)', gate_passes: 'Turniket', gate_events: 'Turniket', gate_devices: 'Turniket', gate_settings: 'Turniket',
  tg_bots: 'Telegram bot', tg_chats: 'Telegram bot', tg_codes: 'Telegram bot', tg_outbox: 'Telegram bot',
  change_log: 'O‘zgartirishlar jurnali', session_cleanups: 'Tozalash tarixi',
  user_activity: 'Kirishlar (kompyuterlar)', client_ops: 'Internetsiz amallar izi',
  section_locks: 'Sozlamalar va parollar', user_settings: 'Sozlamalar va parollar', receipt_config: 'Sozlamalar va parollar'
};
/* Avval bog'liq (bola) jadvallar, keyin asosiylari */
const ORDER = ['debt_payments', 'waiting_queue', 'tg_outbox', 'tg_codes', 'tg_chats', 'tg_bots', 'gate_events', 'gate_passes',
  'gate_devices', 'gate_settings', 'receipts', 'receipt_config', 'session_cleanups', 'client_ops', 'change_log', 'user_activity',
  'section_locks', 'expenses', 'sessions', 'waiting_sessions', 'students', 'school_groups', 'school_vehicles', 'instructors',
  'avtodrom_instructors', 'driving_schools', 'vehicles', 'user_settings'];

/* Oynada muhimlari tepada: pul va yozuvlar, keyin qolganlari */
const LORDER = [...new Set(['sessions', 'debt_payments', 'expenses', 'waiting_queue', 'driving_schools', 'school_groups', 'students',
  'instructors', 'vehicles', 'receipts', 'gate_passes', 'tg_bots', 'change_log', 'session_cleanups', 'user_activity', 'client_ops', 'section_locks'].map(t => LABEL[t]))];
const rankL = l => { const i = LORDER.indexOf(l); return i < 0 ? 99 : i; };

const qi = n => '"' + String(n).replace(/"/g, '""') + '"';

/* Bazadagi hisobga tegishli HAMMA jadval: user_id / user_key / owner_key
   ustuni bor har bir jadval (kelajakda qo'shilganlari ham) */
async function userTables(db) {
  const r = await (db || pool).query(`SELECT c.table_name AS t, c.column_name AS c
      FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
     WHERE c.table_schema = 'public' AND c.column_name IN ('user_id', 'user_key', 'owner_key')
       AND c.table_name NOT IN ('users', 'deleted_accounts')`);
  const rank = t => { const i = ORDER.indexOf(t); return i < 0 ? -1 : i; };   // noma'lumlari — eng avval
  return r.rows.sort((a, b) => rank(a.t) - rank(b.t) || a.t.localeCompare(b.t) || a.c.localeCompare(b.c));
}

async function targetOf(id) {
  if (!/^[0-9a-f-]{8,64}$/i.test(String(id || ''))) return null;
  const r = await pool.query(`SELECT u.id::text AS id, u.username, u.full_name, u.role, u.created_at,
      (SELECT COUNT(*)::int FROM sessions s WHERE s.user_id::text = u.id::text) AS total,
      (SELECT COUNT(*)::int FROM sessions s WHERE s.user_id::text = u.id::text AND s.status IN ('active','frozen','paused')) AS open
    FROM users u WHERE u.id::text = $1`, [String(id)]);
  return r.rows[0] || null;
}
async function totalOf(user) {
  const r = await pool.query(`SELECT COUNT(*)::int AS n FROM sessions WHERE user_id::text = $1`, [String(user)]);
  return Number(r.rows[0].n || 0);
}

async function preview(req, res, me) {
  await ensureSchema();
  const id = new URL(req.url, 'http://x').searchParams.get('id');
  const t = await targetOf(id);
  if (!t) return json(res, 404, { error: 'Hisob topilmadi' });
  const myTotal = await totalOf(me);
  const block = blockOf(me, t, myTotal);
  const groups = new Map();
  let rows = 0;
  for (const x of await userTables()) {
    try {
      const n = Number((await pool.query(`SELECT COUNT(*)::int AS n FROM ${qi(x.t)} WHERE ${qi(x.c)}::text = $1`, [t.id])).rows[0].n || 0);
      if (!n) continue;
      rows += n;
      const l = LABEL[x.t] || 'Boshqa ma’lumotlar';
      groups.set(l, (groups.get(l) || 0) + n);
    } catch { /* jadval o'qilmadi — o'tkazib yuboriladi */ }
  }
  let money = 0;
  try {
    money = Number((await pool.query(`SELECT COALESCE(SUM(m.cash + m.terminal + m.click), 0)::float8 AS s FROM ${MONEY_EVENTS} m WHERE m.user_id = $1`, [t.id])).rows[0].s || 0);
  } catch { /* noop */ }
  const act = await pool.query(`SELECT COUNT(*) FILTER (WHERE last_seen > now() - make_interval(secs => $2))::int AS online, MAX(last_seen) AS last_seen
      FROM user_activity WHERE user_id = $1`, [t.id, ONLINE_SEC]);
  json(res, 200, {
    account: { id: t.id, username: t.username, full_name: t.full_name, role: t.role, created_at: t.created_at,
      online_devices: Number(act.rows[0].online || 0), last_seen: act.rows[0].last_seen || null },
    total: t.total, open: t.open, my_total: myTotal, block, can_delete: !block,
    groups: [...groups].map(([label, n]) => ({ label, n })).sort((a, b) => rankL(a.label) - rankL(b.label) || b.n - a.n),
    rows: rows + 1, money
  });
}

async function remove(req, res, me) {
  await ensureSchema(); await ensureDelSchema();
  const b = await readBody(req);
  const t = await targetOf(b.id);
  if (!t) return json(res, 404, { error: 'Hisob topilmadi (allaqachon o‘chirilgan bo‘lishi mumkin)' });
  const block = blockOf(me, t, await totalOf(me));
  if (block) return json(res, 409, { error: block, blocked: true });
  if (String(b.confirm || '').trim().toLowerCase() !== String(t.username || '').trim().toLowerCase()) {
    return json(res, 400, { error: 'Tasdiqlash uchun hisob loginini aniq yozing: ' + t.username, field: 'confirm' });
  }
  const pw = await checkMaxsusPassword(me, b.password);
  if (!pw.ok) return json(res, pw.status, Object.assign({ field: 'password' }, pw.body));

  const tgToken = await tgTokenFor(t.id);
  const c = await pool.connect();
  const done = {};
  let total = 0;
  try {
    await c.query('BEGIN');
    await c.query(`SET LOCAL statement_timeout = '25s'`);
    await c.query(`SELECT 1 FROM users WHERE id::text = $1 FOR UPDATE`, [t.id]);
    /* Boshqa hisob yozuvlari shu hisobning mashinasiga bog'langan bo'lsa —
       mashina o'sha hisobga o'tadi (aks holda o'chirib bo'lmaydi) */
    await c.query('SAVEPOINT v');
    try {
      await c.query(`UPDATE vehicles v SET user_id = x.uid
          FROM (SELECT DISTINCT ON (s.vehicle_id) s.vehicle_id, s.user_id AS uid
                  FROM sessions s JOIN vehicles v2 ON v2.id = s.vehicle_id
                 WHERE v2.user_id::text = $1 AND s.user_id::text <> $1
                 ORDER BY s.vehicle_id, s.started_at DESC) x
         WHERE v.id = x.vehicle_id`, [t.id]);
      await c.query('RELEASE SAVEPOINT v');
    } catch { await c.query('ROLLBACK TO SAVEPOINT v'); }

    let todo = await userTables(c);
    for (let pass = 0; todo.length && pass < 8; pass++) {
      const next = [];
      for (const x of todo) {
        await c.query('SAVEPOINT w');
        try {
          const r = await c.query(`DELETE FROM ${qi(x.t)} WHERE ${qi(x.c)}::text = $1`, [t.id]);
          await c.query('RELEASE SAVEPOINT w');
          if (r.rowCount) { done[x.t] = (done[x.t] || 0) + r.rowCount; total += r.rowCount; }
        } catch (e) {
          await c.query('ROLLBACK TO SAVEPOINT w');
          if (e.code !== '23503') throw e;
          x.err = e.detail || e.message;
          next.push(x);
        }
      }
      if (next.length === todo.length) throw Object.assign(new Error('Bog‘liq yozuvlar sabab o‘chirib bo‘lmadi: ' + next[0].err), { status: 409 });
      todo = next;
    }
    const u = await c.query(`DELETE FROM users WHERE id::text = $1`, [t.id]);
    total += u.rowCount;
    const summary = Object.fromEntries(Object.entries(done).map(([k, n]) => [k, n]));
    await c.query(`INSERT INTO deleted_accounts(user_id, username, full_name, deleted_by, rows_deleted, summary)
        VALUES($1, $2, $3, $4, $5, $6)
        ON CONFLICT (user_id) DO UPDATE SET deleted_at = now(), deleted_by = EXCLUDED.deleted_by,
          rows_deleted = EXCLUDED.rows_deleted, summary = EXCLUDED.summary`,
      [t.id, t.username, t.full_name || null, me, total, JSON.stringify(summary)]);
    await c.query('COMMIT');
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch { /* noop */ }
    console.error('ACCOUNT DELETE:', e.message);
    return json(res, e.status || 500, { error: e.status ? e.message : 'O‘chirishda xatolik — hech narsa o‘chirilmadi: ' + e.message });
  } finally { c.release(); }

  delSet.add(t.id);
  for (const k of [...seen.keys()]) if (k.startsWith(t.id + ':')) seen.delete(k);
  await tgForget(t.id, tgToken);
  await logChange(null, me, { entity: 'account', action: 'delete', entityId: t.id, entityName: t.username,
    reason: 'Hisob butunlay o‘chirildi: ' + (t.full_name || t.username) + ' (' + t.username + '), ' + total + ' ta yozuv' });
  json(res, 200, { ok: true, username: t.username, rows: total, sessions: done.sessions || 0, tables: done });
}

export async function handleAccountsRequest(req, res) {
  const path = String(req.url || '').split('?', 1)[0];
  if (!path.startsWith('/api/accounts/')) return false;
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return true; }
  const user = userOf(req);
  if (!user) { json(res, 401, { error: 'Kirish talab qilinadi' }); return true; }
  try {
    if (path === '/api/accounts/ping' && req.method === 'GET') { json(res, 200, { ok: true }); return true; }
    if (path === '/api/accounts/activity' && req.method === 'GET') {
      if (!maxsusOk(req, user)) { lockedResponse(res); return true; }
      await activity(res, user);
      return true;
    }
    if (path === '/api/accounts/delete-preview' && req.method === 'GET') {
      if (!maxsusOk(req, user)) { lockedResponse(res); return true; }
      await preview(req, res, user);
      return true;
    }
    if (path === '/api/accounts/delete' && req.method === 'POST') {
      if (!maxsusOk(req, user)) { lockedResponse(res); return true; }
      await remove(req, res, user);
      return true;
    }
    json(res, 404, { error: 'Topilmadi' });
    return true;
  } catch (e) {
    console.error('ACCOUNTS ERROR:', e);
    json(res, 500, { error: e.message || 'Xatolik' });
    return true;
  }
}
