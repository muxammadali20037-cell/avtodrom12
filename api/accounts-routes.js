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
     GET  /api/accounts/attach-preview?id=…
     POST /api/accounts/attach  { id, password }
          — boshqa hisobni ASOSIY hisobga qo'shish («hisobotga qo'shish»):
            uning hamma yozuvlari asosiy hisobga o'tadi, u o'z login va
            paroli bilan kiradi, lekin asosiy hisobda ishlaydi (Jarayonda,
            Navbat, Qarzlar, Hisobot — umumiy). users.parent_id; kalitda
            sub = asosiy hisob, act = kirgan login.
     POST /api/accounts/detach  { id }  — loginni ajratish (yozuvlar asosiy
            hisobda qoladi, login keyin o'z bo'sh hisobida ishlaydi)
     POST /api/accounts/post  { id, post }  — qo'shilgan login qaysi postda
            (1-POST / 2-POST) ishlashi

   LOGIN POSTI: asosiy hisobga qo'shilgan login o'z postiga BIRIKTIRILADI
   (users.post; qo'shilganda tanlanadi, tanlanmasa — 2-POST). U qaysi
   kompyuterda kirmasin, ochgan vaqti, olgan puli, qarz to'lovi va
   xarajati shu postga yoziladi: server har so'rovda X-Post ni loginning
   postiga almashtiradi (applyLoginPost). Hisobot, Excel, Telegram va
   boshliq ilovasining «Platniy» bo'limida «2-POST · Ramziddin» bo'lib chiqadi.
   ========================================================================== */

import jwt from 'jsonwebtoken';
import { pool } from '../backend/src/db.js';
import { runOnce, ddl } from '../backend/src/schema-once.js';
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
function payloadOf(req) {
  try {
    const h = req.headers?.authorization || '';
    if (!h.startsWith('Bearer ')) return null;
    const p = jwt.verify(h.slice(7), JWT_SECRET);
    return p && p.sub && String(p.sub) !== 'admin' ? p : null;
  } catch { return null; }
}
/* Ma'lumot egasi (asosiy hisob) */
function userOf(req) { const p = payloadOf(req); return p ? String(p.sub) : null; }
/* Aynan kim kirgan (qo'shilgan login bo'lsa — o'sha login) */
function actorOf(req) { const p = payloadOf(req); return p ? String(p.act || p.sub) : null; }

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

/* Qo'shilgan login qaysi asosiy hisobda ishlaydi */
let parentP = null;
function ensureParentCol() {
  if (parentP) return parentP;
  parentP = runOnce('users-parent-v1', async () => {
    await ddl(`ALTER TABLE users ADD COLUMN IF NOT EXISTS parent_id TEXT`);
  }).then(() => runOnce('users-post-v1', async () => {
    /* Qo'shilgan login qaysi postda ishlaydi (NULL — 2-POST) */
    await ddl(`ALTER TABLE users ADD COLUMN IF NOT EXISTS post SMALLINT`);
  })).catch(e => { parentP = null; throw e; });
  return parentP;
}

/* Qo'shilgan loginning posti: tanlanmagan bo'lsa — 2-POST (asosiy hisob odatda 1-POST) */
export const DEFAULT_LOGIN_POST = 2;
export function loginPost(v) {
  const n = Math.round(Number(v));
  return n >= 1 && n <= 9 ? n : DEFAULT_LOGIN_POST;
}

/* Kalitlar holati (token 30 kun amal qiladi): o'chirilgan hisob — darhol
   yaroqsiz; asosiy hisobga qo'shilgan / ajratilgan login — qayta kirsin.
   Ro'yxat har serverda 20 soniyada bir yangilanadi. */
let delSet = new Set(), parentMap = new Map(), postMap = new Map(), delAt = 0, delLoad = null;
async function accState() {
  if (Date.now() - delAt < 20000) return { deleted: delSet, parent: parentMap, post: postMap };
  if (!delLoad) delLoad = (async () => {
    await ensureDelSchema(); await ensureParentCol();
    const [d, p] = await Promise.all([
      pool.query(`SELECT user_id FROM deleted_accounts`),
      pool.query(`SELECT id::text AS id, parent_id, (to_jsonb(users)->>'post') AS post FROM users WHERE parent_id IS NOT NULL`)
    ]);
    delSet = new Set(d.rows.map(x => String(x.user_id)));
    parentMap = new Map(p.rows.map(x => [x.id, String(x.parent_id)]));
    postMap = new Map(p.rows.map(x => [x.id, loginPost(x.post)]));
    delAt = Date.now();
  })().finally(() => { delLoad = null; });
  await delLoad;
  return { deleted: delSet, parent: parentMap, post: postMap };
}

/* Qo'shilgan loginning biriktirilgan posti (oddiy hisob — null) */
export async function fixedPostOf(req) {
  const p = payloadOf(req);
  if (!p || !p.act || String(p.act) === String(p.sub)) return null;
  let st;
  try { st = await accState(); } catch { return null; }
  if (st.parent.get(String(p.act)) !== String(p.sub)) return null;
  return st.post.get(String(p.act)) || DEFAULT_LOGIN_POST;
}

/* Har /api so'rovida (kalit tekshirilgandan keyin): qo'shilgan login uchun
   X-Post — uning posti. Kompyuterda boshqa post tanlangan bo'lsa ham,
   internetsiz yozilib keyin yuborilgan amal bo'lsa ham — pul va vaqt
   loginning o'z postiga yoziladi. */
export async function applyLoginPost(req) {
  const fp = await fixedPostOf(req);
  if (!fp || !req.headers) return fp;
  /* ISTISNO: oldindan to'langan navbat/bron ochilganda kassa pul OLINGAN
     postni yuboradi (X-Post-Src: prepay) — pul o'z postida qolsin */
  const src = String(req.headers['x-post-src'] || '').toLowerCase();
  const given = Math.round(Number(req.headers['x-post']));
  if (src === 'prepay' && given >= 1 && given <= 9) return fp;
  req.headers['x-post'] = String(fp);
  return fp;
}
/* null — kalit joyida; aks holda 401 javob tanasi */
export async function tokenProblem(req) {
  const p = payloadOf(req);
  if (!p) return null;
  let st;
  try { st = await accState(); } catch { return null; }
  const sub = String(p.sub), act = p.act ? String(p.act) : null;
  if (st.deleted.has(sub) || (act && st.deleted.has(act))) return { error: 'Bu hisob o‘chirilgan', deleted: true };
  if (st.parent.has(sub)) return { error: 'Hisobingiz asosiy hisobga qo‘shildi — qaytadan kiring', relogin: true };
  if (act && act !== sub && st.parent.get(act) !== sub) return { error: 'Hisob sozlamasi o‘zgardi — qaytadan kiring', relogin: true };
  return null;
}

/* Har /api so'rovida chaqiriladi — bir daqiqada bir marta yoziladi */
const seen = new Map();
export async function trackActivity(req) {
  try {
    const user = actorOf(req);
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
  await ensureSchema(); await ensureParentCol();
  const TZ = 'Asia/Tashkent';
  const [users, acts, sess] = await Promise.all([
    pool.query(`SELECT id::text AS id, username, full_name, role, created_at, parent_id, (to_jsonb(users)->>'post') AS post FROM users ORDER BY created_at`),
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
  const names = new Map(users.rows.map(u => [u.id, u.full_name || u.username]));
  const kids = new Map();
  for (const u of users.rows) if (u.parent_id) kids.set(String(u.parent_id), (kids.get(String(u.parent_id)) || 0) + 1);
  const rows = users.rows.map(u => {
    const devs = A.get(u.id) || [];
    const s = S.get(u.id) || {};
    const t = { id: u.id, username: u.username, full_name: u.full_name, role: u.role || null, created_at: u.created_at, me: u.id === me,
      online: devs.some(d => d.online), devices: devs, last_seen: devs[0] ? devs[0].last_seen : null,
      open: Number(s.open || 0), today: Number(s.today || 0), total: Number(s.total || 0), last_session: s.last_session || null,
      parent_id: u.parent_id ? String(u.parent_id) : null, parent_name: u.parent_id ? (names.get(String(u.parent_id)) || null) : null,
      children: kids.get(u.id) || 0,
      /* qo'shilgan login — o'z postiga biriktirilgan */
      post: u.parent_id ? loginPost(u.post) : null };
    t.block = blockOf(me, t, myTotal);
    t.can_delete = !t.block;
    t.attach_block = attachBlockOf(me, t, myTotal);
    t.can_attach = !t.attach_block;
    t.can_detach = t.parent_id === me;
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
  if (t.parent_id && t.parent_id !== me) return 'Bu login boshqa asosiy hisobga qo‘shilgan — faqat o‘sha hisobdan boshqariladi.';
  if (Number(t.total || 0) > Number(myTotal || 0)) {
    return 'Bu hisobda yozuvlar sizning hisobingizdagidan ko‘p (' + t.total + ' ta, sizda ' + (myTotal || 0)
      + ' ta). Uni faqat asosiy hisobdan — yozuvlari ko‘p hisobdan kirib o‘chirish mumkin.';
  }
  return null;
}
/* Nega asosiy hisobga qo'shib bo'lmaydi (null — mumkin) */
function attachBlockOf(me, t, myTotal) {
  if (!t) return 'Hisob topilmadi';
  if (t.id === me) return 'Bu — siz hozir kirgan asosiy hisob.';
  if (t.parent_id === me) return 'Bu login allaqachon sizning hisobingizga qo‘shilgan.';
  if (t.parent_id) return 'Bu login boshqa asosiy hisobga qo‘shilgan.';
  if (t.role === 'admin') return 'Bu admin panel hisobi — qo‘shilmaydi.';
  if (WS() && WS() === t.id) return 'Umumiy baza shu hisobga bog‘langan — qo‘shilmaydi.';
  if (Number(t.children || 0) > 0) return 'Bu hisobning o‘ziga boshqa loginlar qo‘shilgan — avval ularni ajrating.';
  if (Number(t.total || 0) > Number(myTotal || 0)) {
    return 'Bu hisobda yozuvlar sizning hisobingizdagidan ko‘p (' + t.total + ' ta, sizda ' + (myTotal || 0)
      + ' ta). Asosiy hisobdan — yozuvlari ko‘p hisobdan kirib qo‘shing.';
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
  const r = await (db || pool).query(`SELECT c.table_name AS t, c.column_name AS c, c.data_type AS dt
      FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
     WHERE c.table_schema = 'public' AND c.column_name IN ('user_id', 'user_key', 'owner_key')
       AND c.table_name NOT IN ('users', 'deleted_accounts')`);
  const rank = t => { const i = ORDER.indexOf(t); return i < 0 ? -1 : i; };   // noma'lumlari — eng avval
  return r.rows.sort((a, b) => rank(a.t) - rank(b.t) || a.t.localeCompare(b.t) || a.c.localeCompare(b.c));
}

async function targetOf(id) {
  if (!/^[0-9a-f-]{8,64}$/i.test(String(id || ''))) return null;
  await ensureParentCol();
  const r = await pool.query(`SELECT u.id::text AS id, u.username, u.full_name, u.role, u.created_at, u.parent_id,
      (SELECT COUNT(*)::int FROM users k WHERE k.parent_id = u.id::text) AS children,
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
  const { groups, rows, money } = await countsOf(t.id);
  const act = await pool.query(`SELECT COUNT(*) FILTER (WHERE last_seen > now() - make_interval(secs => $2))::int AS online, MAX(last_seen) AS last_seen
      FROM user_activity WHERE user_id = $1`, [t.id, ONLINE_SEC]);
  json(res, 200, {
    account: { id: t.id, username: t.username, full_name: t.full_name, role: t.role, created_at: t.created_at,
      online_devices: Number(act.rows[0].online || 0), last_seen: act.rows[0].last_seen || null },
    total: t.total, open: t.open, my_total: myTotal, block, can_delete: !block,
    groups, rows: rows + 1, money
  });
}

/* Hisobdagi yozuvlar: guruhlab (oynada ko'rsatish uchun), jami va pul */
async function countsOf(id, skip) {
  const groups = new Map();
  let rows = 0;
  for (const x of await userTables()) {
    if (skip && skip.includes(x.t)) continue;
    try {
      const n = Number((await pool.query(`SELECT COUNT(*)::int AS n FROM ${qi(x.t)} WHERE ${qi(x.c)}::text = $1`, [id])).rows[0].n || 0);
      if (!n) continue;
      rows += n;
      const l = LABEL[x.t] || 'Boshqa ma’lumotlar';
      groups.set(l, (groups.get(l) || 0) + n);
    } catch { /* jadval o'qilmadi — o'tkazib yuboriladi */ }
  }
  let money = 0;
  try {
    money = Number((await pool.query(`SELECT COALESCE(SUM(m.cash + m.terminal + m.click), 0)::float8 AS s FROM ${MONEY_EVENTS} m WHERE m.user_id = $1`, [id])).rows[0].s || 0);
  } catch { /* noop */ }
  return {
    groups: [...groups].map(([label, n]) => ({ label, n })).sort((a, b) => rankL(a.label) - rankL(b.label) || b.n - a.n),
    rows, money
  };
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
    await c.query(`UPDATE users SET parent_id = NULL WHERE parent_id = $1`, [t.id]);
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

  delSet.add(t.id); delAt = 0;
  for (const k of [...seen.keys()]) if (k.startsWith(t.id + ':')) seen.delete(k);
  await tgForget(t.id, tgToken);
  await logChange(null, me, { entity: 'account', action: 'delete', entityId: t.id, entityName: t.username,
    reason: 'Hisob butunlay o‘chirildi: ' + (t.full_name || t.username) + ' (' + t.username + '), ' + total + ' ta yozuv' });
  json(res, 200, { ok: true, username: t.username, rows: total, sessions: done.sessions || 0, tables: done });
}

/* ===================== ASOSIY HISOBGA QO'SHISH ===================== */

/* Qo'shilganda: qo'shilgan hisobning o'z sozlamalari, paroli, boti olib
   tashlanadi (asosiy hisobniki ishlaydi); kirishlar tarixi login nomida
   qoladi; qolgan HAMMA yozuv asosiy hisobga o'tadi. */
const DROP_ON_ATTACH = ['section_locks', 'user_settings', 'tg_bots', 'tg_chats', 'tg_codes', 'tg_outbox', 'gate_settings', 'receipt_config'];
const KEEP_ON_ATTACH = ['user_activity'];
const MOVABLE = new Set(['text', 'character varying', 'uuid', 'character']);

async function attachPreview(req, res, me) {
  await ensureSchema();
  const id = new URL(req.url, 'http://x').searchParams.get('id');
  const t = await targetOf(id);
  if (!t) return json(res, 404, { error: 'Hisob topilmadi' });
  const block = attachBlockOf(me, t, await totalOf(me));
  const { groups, money } = await countsOf(t.id, DROP_ON_ATTACH.concat(KEEP_ON_ATTACH));
  const mine = await pool.query(`SELECT COALESCE(NULLIF(full_name, ''), username) AS name FROM users WHERE id::text = $1`, [me]);
  json(res, 200, {
    account: { id: t.id, username: t.username, full_name: t.full_name, created_at: t.created_at },
    main: { id: me, name: mine.rows[0] ? mine.rows[0].name : '' },
    total: t.total, open: t.open, money, groups, block, can_attach: !block,
    post: DEFAULT_LOGIN_POST
  });
}

async function attach(req, res, me) {
  await ensureSchema(); await ensureDelSchema(); await ensureParentCol();
  const b = await readBody(req);
  const t = await targetOf(b.id);
  if (!t) return json(res, 404, { error: 'Hisob topilmadi' });
  const block = attachBlockOf(me, t, await totalOf(me));
  if (block) return json(res, 409, { error: block, blocked: true });
  const pw = await checkMaxsusPassword(me, b.password);
  if (!pw.ok) return json(res, pw.status, Object.assign({ field: 'password' }, pw.body));

  /* Qaysi postda ishlaydi: tanlanmasa — 2-POST */
  const post = loginPost(b.post);
  const tgToken = await tgTokenFor(t.id);
  const ownerTo = WS() || me;
  const moved = {};
  let total = 0, merged = 0, relabeled = 0;
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SET LOCAL statement_timeout = '25s'`);
    await c.query(`SELECT id FROM users WHERE id::text = ANY($1::text[]) ORDER BY id FOR UPDATE`, [[me, t.id]]);
    const chk = await c.query(`SELECT parent_id, (SELECT COUNT(*)::int FROM users k WHERE k.parent_id = $1) AS kids FROM users WHERE id::text = $1`, [t.id]);
    if (!chk.rows[0] || chk.rows[0].parent_id || chk.rows[0].kids) throw Object.assign(new Error('Hisob holati o‘zgardi — sahifani yangilab qayta urinib ko‘ring'), { status: 409 });

    /* 1) Bir xil raqamli mashinalar birlashadi (asosiy hisobniki qoladi) */
    if ((await c.query(`SELECT to_regclass('public.vehicles') AS r`)).rows[0].r) {
      const fks = (await c.query(`SELECT cl.relname AS t, a.attname AS c
          FROM pg_constraint k JOIN pg_class cl ON cl.oid = k.conrelid
          JOIN pg_namespace n ON n.oid = cl.relnamespace
          JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
         WHERE k.contype = 'f' AND k.confrelid = 'public.vehicles'::regclass AND n.nspname = 'public'`)).rows;
      const dup = (await c.query(`SELECT tv.id AS from_id,
            (SELECT mv.id FROM vehicles mv WHERE mv.user_id::text = $2 AND mv.plate = tv.plate ORDER BY mv.created_at LIMIT 1) AS to_id
          FROM vehicles tv WHERE tv.user_id::text = $1`, [t.id, me])).rows.filter(x => x.to_id);
      for (const d of dup) {
        await c.query('SAVEPOINT v');
        try {
          for (const f of fks) await c.query(`UPDATE ${qi(f.t)} SET ${qi(f.c)} = $2 WHERE ${qi(f.c)} = $1`, [d.from_id, d.to_id]);
          await c.query(`DELETE FROM vehicles WHERE id = $1`, [d.from_id]);
          await c.query('RELEASE SAVEPOINT v');
          merged++;
        } catch { await c.query('ROLLBACK TO SAVEPOINT v'); }   // birlashmasa — oddiy ko'chadi
      }
    }
    /* 2) Qo'shilgan hisobning o'z sozlamalari / boti */
    for (const tb of DROP_ON_ATTACH) {
      if (!(await c.query(`SELECT to_regclass($1) AS r`, ['public.' + tb])).rows[0].r) continue;
      await c.query('SAVEPOINT d');
      try { await c.query(`DELETE FROM ${qi(tb)} WHERE user_id::text = $1`, [t.id]); await c.query('RELEASE SAVEPOINT d'); }
      catch { await c.query('ROLLBACK TO SAVEPOINT d'); }
    }
    /* 2b) Uning yozuvlari — o'z postiga: asosiy hisobda 1-POST bilan
           aralashib ketmasin (ochgan vaqti, olgan puli, qarz to'lovi, xarajati) */
    for (const [tb, sql] of [
      ['sessions', `UPDATE sessions SET post = $2::smallint, pay_post = CASE WHEN pay_post IS NULL THEN NULL ELSE $2::smallint END WHERE user_id::text = $1`],
      ['debt_payments', `UPDATE debt_payments SET post = $2::smallint WHERE user_id::text = $1`],
      ['expenses', `UPDATE expenses SET post = $2::smallint WHERE user_id::text = $1`],
    ]) {
      if (!(await c.query(`SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'post'`, [tb])).rows[0]) continue;
      await c.query('SAVEPOINT p');
      try { const r = await c.query(sql, [t.id, post]); await c.query('RELEASE SAVEPOINT p'); if (tb === 'sessions') relabeled = r.rowCount; }
      catch { await c.query('ROLLBACK TO SAVEPOINT p'); }
    }
    /* 3) Qolgan hamma yozuv — asosiy hisobga */
    for (const x of await userTables(c)) {
      if (DROP_ON_ATTACH.includes(x.t) || KEEP_ON_ATTACH.includes(x.t) || !MOVABLE.has(String(x.dt))) continue;
      await c.query('SAVEPOINT m');
      try {
        const r = await c.query(`UPDATE ${qi(x.t)} SET ${qi(x.c)} = $2 WHERE ${qi(x.c)}::text = $1`, [t.id, x.c === 'owner_key' ? ownerTo : me]);
        await c.query('RELEASE SAVEPOINT m');
        if (r.rowCount) { moved[x.t] = (moved[x.t] || 0) + r.rowCount; total += r.rowCount; }
      } catch (e) {
        await c.query('ROLLBACK TO SAVEPOINT m');
        throw Object.assign(new Error('«' + x.t + '» jadvalidagi yozuvlarni ko‘chirib bo‘lmadi: ' + (e.detail || e.message)), { status: 409 });
      }
    }
    await c.query(`UPDATE users SET parent_id = $2, post = $3::smallint WHERE id::text = $1`, [t.id, me, post]);
    await c.query('COMMIT');
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch { /* noop */ }
    console.error('ACCOUNT ATTACH:', e.message);
    return json(res, e.status || 500, { error: e.status ? e.message : 'Qo‘shishda xatolik — hech narsa o‘zgarmadi: ' + e.message });
  } finally { c.release(); }

  parentMap.set(t.id, me); postMap.set(t.id, post); delAt = 0;
  if (tgToken) await tgForget(t.id, tgToken);
  await logChange(null, me, { entity: 'account', action: 'attach', entityId: t.id, entityName: t.username,
    reason: 'Hisob asosiy hisobga qo‘shildi: ' + (t.full_name || t.username) + ' (' + t.username + '), ' + post + '-POST, ' + total + ' ta yozuv ko‘chdi' });
  json(res, 200, { ok: true, username: t.username, post, rows: total, sessions: moved.sessions || 0, relabeled, vehicles_merged: merged, tables: moved });
}

/* Qo'shilgan login postini o'zgartirish — bundan keyingi yozuvlar uchun
   (o'tgan yozuvlar o'z postida qoladi: kassa hisobotlari o'zgarmasin) */
async function setPost(req, res, me) {
  await ensureParentCol();
  const b = await readBody(req);
  const n = Math.round(Number(b.post));
  if (!(n >= 1 && n <= 9)) return json(res, 400, { error: 'Post 1 yoki 2 bo‘lishi kerak' });
  const t = await targetOf(b.id);
  if (!t) return json(res, 404, { error: 'Hisob topilmadi' });
  if (t.parent_id !== me) return json(res, 409, { error: 'Bu login sizning hisobingizga qo‘shilmagan — postni faqat qo‘shilgan loginga biriktirsa bo‘ladi' });
  const old = loginPost((await pool.query(`SELECT (to_jsonb(users)->>'post') AS post FROM users WHERE id::text = $1`, [t.id])).rows[0]?.post);
  await pool.query(`UPDATE users SET post = $2::smallint WHERE id::text = $1 AND parent_id = $3`, [t.id, n, me]);
  postMap.set(t.id, n); delAt = 0;
  if (old !== n) {
    await logChange(null, me, { entity: 'account', action: 'post', entityId: t.id, entityName: t.username, field: 'post',
      oldValue: old + '-POST', newValue: n + '-POST', reason: (t.full_name || t.username) + ' endi ' + n + '-POST da ishlaydi' });
  }
  json(res, 200, { ok: true, username: t.username, post: n });
}

async function detach(req, res, me) {
  await ensureParentCol();
  const b = await readBody(req);
  const t = await targetOf(b.id);
  if (!t) return json(res, 404, { error: 'Hisob topilmadi' });
  if (t.parent_id !== me) return json(res, 409, { error: 'Bu login sizning hisobingizga qo‘shilmagan' });
  await pool.query(`UPDATE users SET parent_id = NULL WHERE id::text = $1 AND parent_id = $2`, [t.id, me]);
  await pool.query(`INSERT INTO user_settings(user_id) VALUES($1) ON CONFLICT (user_id) DO NOTHING`, [t.id]).catch(() => null);
  parentMap.delete(t.id); delAt = 0;
  await logChange(null, me, { entity: 'account', action: 'detach', entityId: t.id, entityName: t.username,
    reason: 'Login asosiy hisobdan ajratildi: ' + (t.full_name || t.username) + ' (' + t.username + '). Yozuvlar asosiy hisobda qoldi.' });
  json(res, 200, { ok: true, username: t.username });
}

export async function handleAccountsRequest(req, res) {
  const path = String(req.url || '').split('?', 1)[0];
  if (!path.startsWith('/api/accounts/')) return false;
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return true; }
  const user = userOf(req);
  if (!user) { json(res, 401, { error: 'Kirish talab qilinadi' }); return true; }
  try {
    /* Yurak urishi + shu loginning biriktirilgan posti (kassa tepasidagi «2-POST» belgisi uchun) */
    if (path === '/api/accounts/ping' && req.method === 'GET') { json(res, 200, { ok: true, post: await fixedPostOf(req) }); return true; }
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
    if (path === '/api/accounts/attach-preview' && req.method === 'GET') {
      if (!maxsusOk(req, user)) { lockedResponse(res); return true; }
      await attachPreview(req, res, user);
      return true;
    }
    if (path === '/api/accounts/attach' && req.method === 'POST') {
      if (!maxsusOk(req, user)) { lockedResponse(res); return true; }
      await attach(req, res, user);
      return true;
    }
    if (path === '/api/accounts/post' && req.method === 'POST') {
      if (!maxsusOk(req, user)) { lockedResponse(res); return true; }
      await setPost(req, res, user);
      return true;
    }
    if (path === '/api/accounts/detach' && req.method === 'POST') {
      if (!maxsusOk(req, user)) { lockedResponse(res); return true; }
      await detach(req, res, user);
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
