/* ============================================================================
   KASSA: erkin yozuvli avtomobil, Klik to'lovi va RASXOD (xarajatlar)

   1) Ustunlar / cheklovlar (har so'rovdan OLDIN, tranzaksiyadan tashqarida,
      faqat kerak bo'lsa — jadval bejiz qulflanmasin):
        - sessions.click_amount — Klik orqali to'lov
        - vehicles: «455 dilnoza» kabi istalgan matn avtomobil sifatida
          saqlanishi uchun qat'iy raqam cheklovlari olib tashlanadi
          (hudud kodi ro'yxati, 3 xonali raqam, NOT NULL, 20 belgi)
        - expenses — xarajatlar jadvali

   2) RASXOD:
        GET    /api/expenses?date=YYYY-MM-DD  yoki ?from=&to=
        (3- va 4-bandlar pastda)
        POST   /api/expenses                  { spent_on, person, category, vehicle, amount, pay_method, liters, odometer, note }
        PUT    /api/expenses/:id
        DELETE /api/expenses/:id              (yozuv o'chirilmaydi — deleted_at; jurnalga tushadi)

   3) VAQTI TUGAGANDA O'ZI YOPILADI: «1 soatga» kabi ochilgan oddiy mijoz
      (auto_close) rejadagi vaqt tugashi bilan yopiladi — chiqish vaqti
      aynan reja bo'yicha. To'lanmagan qismi qarzga (debt_amount) yoziladi.
      Fon jarayoni shart emas: faol ro'yxat, hisobot va qarzlar
      so'ralganda avval muddati o'tganlar yopiladi (autoCloseDue).

   4) TO'LANMAGAN (qarz): bir kunda 4–5 marta kelib, oxirida «qancha
      bo'ldi?» deb hammasini birdan to'laydiganlar uchun.
        GET  /api/debts                       to'lanmagan yozuvlar
        POST /api/debts/pay { ids, method, amount? }   to'lash (naqd/terminal/Klik);
             amount — qo'lda yozilgan summa: qarzdan kam bo'lsa eng eskisidan
             boshlab to'lanadi, qolgani «To'lanmagan»da qoladi

   5) BIR QISMINI YOPISH: vaqti ochiq mijoz «2 soatini yopaman» deb pul
      to'laydi va yurishda davom etadi.
        POST /api/sessions/:id/split { minutes, cash_amount, terminal_amount, click_amount, debt_amount }
      Kirgan vaqtdan boshlab tanlangan vaqt alohida YOPILGAN yozuv bo'ladi
      (pul yoki qarz bilan), ichkaridagi yozuv esa o'sha nuqtadan davom
      etadi (id o'zgarmaydi — talon, navbat, belgilar joyida qoladi).

   6) TO'G'RILASH: to'lanmagan «to'langan» bo'lib qolgan yoki aksincha —
      qo'lda to'g'rilanadi, SABAB majburiy, har bir o'zgarish jurnalga.
        POST /api/sessions/:id/correct { cash_amount, terminal_amount, click_amount, debt_amount, reason }
   ========================================================================== */

import jwt from 'jsonwebtoken';
import { tgNotify, tgText, tgAnyBots, ddmm } from './telegram.js';
import { pool } from '../backend/src/db.js';
import { runOnce, ddl } from '../backend/src/schema-once.js';
import { postOf } from '../backend/src/post.js';
import { logChange } from './audit-routes.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
const TZ_TODAY = `(now() AT TIME ZONE 'Asia/Tashkent')::date`;
const text = v => String(v === null || v === undefined ? '' : v).trim();
const isDay = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !isNaN(Date.parse(v + 'T00:00:00Z'));
const PAY = ['cash', 'card', 'click'];

function json(res, status, data) {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}
function auth(req) {
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
    req.on('data', c => { s += c; if (s.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

/* ---------- ustunlar ---------- */
let schemaP = null;
export function ensureKassaSchema() {
  if (schemaP) return schemaP;
  schemaP = runOnce('kassa-schema-v3', async () => {
    const cols = await pool.query(`
      SELECT table_name, column_name, is_nullable, character_maximum_length
        FROM information_schema.columns
       WHERE table_schema='public' AND (
         (table_name='sessions' AND column_name IN ('click_amount','debt_amount','auto_close','planned_amount','settled_at','auto_closed','corrected_at','correction_note')) OR
         (table_name='vehicles' AND column_name IN ('region_code','first_letter','number','last_letters','plate')))`);
    const col = {};
    cols.rows.forEach(r => { col[r.table_name + '.' + r.column_name] = r; });

    if (!col['sessions.click_amount']) {
      await pool.query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS click_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
    }
    /* Qarz va avtomatik yopish */
    if (!col['sessions.debt_amount']) await pool.query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS debt_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
    if (!col['sessions.auto_close']) await pool.query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS auto_close BOOLEAN NOT NULL DEFAULT FALSE`);
    if (!col['sessions.planned_amount']) await pool.query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS planned_amount NUMERIC(12,2)`);
    if (!col['sessions.settled_at']) await pool.query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ`);
    if (!col['sessions.auto_closed']) await pool.query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS auto_closed BOOLEAN NOT NULL DEFAULT FALSE`);
    if (!col['sessions.corrected_at']) await pool.query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS corrected_at TIMESTAMPTZ`);
    if (!col['sessions.correction_note']) await pool.query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS correction_note TEXT`);
    if (!col['sessions.debt_amount'] || !col['sessions.auto_close']) {
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_sessions_debt ON sessions(user_id) WHERE debt_amount > 0`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_sessions_autoclose ON sessions(user_id) WHERE auto_close AND status = 'active'`);
    }

    /* vehicles — erkin matn uchun */
    const cons = await pool.query(`SELECT conname FROM pg_constraint
      WHERE conrelid='public.vehicles'::regclass AND conname IN ('vehicle_number_3_digits','vehicle_region_allowed')`);
    for (const r of cons.rows) await pool.query(`ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS ${r.conname}`);
    for (const c of ['region_code', 'first_letter', 'number', 'last_letters']) {
      if (col['vehicles.' + c] && col['vehicles.' + c].is_nullable === 'NO') {
        await pool.query(`ALTER TABLE vehicles ALTER COLUMN ${c} DROP NOT NULL`);
      }
    }
    const pl = col['vehicles.plate'];
    if (pl && pl.character_maximum_length !== null && Number(pl.character_maximum_length) < 80) {
      await pool.query(`ALTER TABLE vehicles ALTER COLUMN plate TYPE VARCHAR(80)`);
    }

    await pool.query(`CREATE TABLE IF NOT EXISTS expenses(
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id TEXT NOT NULL,
      spent_on DATE NOT NULL,
      person TEXT,
      category TEXT NOT NULL,
      vehicle TEXT,
      amount NUMERIC(14,2) NOT NULL DEFAULT 0,
      pay_method TEXT NOT NULL DEFAULT 'cash',
      liters NUMERIC(10,2),
      odometer INTEGER,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ,
      deleted_at TIMESTAMPTZ)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_expenses_user_day ON expenses(user_id, spent_on) WHERE deleted_at IS NULL`);
  }).then(() => runOnce('kassa-schema-v4-post-debtpay', async () => {
    /* POST (1-POST / 2-POST) va QARZ TO'LOVLARI to'langan kuni bo'yicha.
       Ustun bor bo'lsa ALTER chaqirilmaydi (jadval bejiz qulflanmasin). */
    const cols = new Set((await pool.query(`SELECT table_name || '.' || column_name AS k FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name IN ('sessions', 'expenses')`)).rows.map(r => r.k));
    if (!cols.has('sessions.post')) await ddl(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS post SMALLINT`);
    if (!cols.has('sessions.pay_post')) await ddl(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS pay_post SMALLINT`);
    if (!cols.has('sessions.debt_paid')) await ddl(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS debt_paid NUMERIC(12,2) NOT NULL DEFAULT 0`);
    if (!cols.has('expenses.post')) await ddl(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS post SMALLINT`);
    await pool.query(`CREATE TABLE IF NOT EXISTS debt_payments(
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id TEXT NOT NULL,
      session_id UUID NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      method TEXT NOT NULL,
      post SMALLINT,
      session_day DATE,
      paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      note TEXT)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_debt_payments_user_paid ON debt_payments(user_id, paid_at)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_debt_payments_session ON debt_payments(session_id)`);
  })).then(() => runOnce('kassa-schema-v5-debt-reversal', async () => {
    /* o'tgan kundagi xato to'lov o'chirilmaydi — bugungi sana bilan teskari (manfiy) yozuv */
    await ddl(`ALTER TABLE debt_payments ADD COLUMN IF NOT EXISTS reversal_of UUID`);
  })).catch(e => { schemaP = null; throw e; });
  return schemaP;
}

/* ---------- RASXOD ---------- */
/* Excel bo'limi (sheet-routes.js) ham shu tekshiruvdan foydalanadi */
export function cleanExpense(b, todayFallback) { return clean(b, todayFallback); }
function clean(b, todayFallback) {
  const out = {
    spent_on: text(b.spent_on || b.spentOn || b.date) || todayFallback,
    person: text(b.person).slice(0, 120) || null,
    category: text(b.category).slice(0, 80),
    vehicle: text(b.vehicle).toUpperCase().slice(0, 40) || null,
    amount: Math.round(Number(b.amount)),
    pay_method: PAY.includes(text(b.pay_method || b.payMethod)) ? text(b.pay_method || b.payMethod) : 'cash',
    liters: b.liters === '' || b.liters === null || b.liters === undefined ? null : Number(b.liters),
    odometer: b.odometer === '' || b.odometer === null || b.odometer === undefined ? null : Math.round(Number(b.odometer)),
    note: text(b.note).slice(0, 300) || null,
  };
  if (!isDay(out.spent_on)) return { error: "Sanani to'g'ri kiriting" };
  if (!out.category) return { error: 'Xarajat turini yozing' };
  if (!Number.isFinite(out.amount) || out.amount <= 0) return { error: "Summani kiriting (0 dan katta)" };
  if (out.amount > 1e10) return { error: 'Summa juda katta' };
  if (out.liters !== null && (!Number.isFinite(out.liters) || out.liters < 0)) return { error: "Litr noto'g'ri" };
  if (out.odometer !== null && (!Number.isFinite(out.odometer) || out.odometer < 0)) return { error: "Kilometr noto'g'ri" };
  return out;
}
const SELECT = `SELECT id, to_char(spent_on,'YYYY-MM-DD') spent_on, person, category, vehicle, amount::float8 amount,
  pay_method, liters::float8 liters, odometer, note, created_at, updated_at, (to_jsonb(expenses)->>'post')::int AS post FROM expenses`;

async function list(req, res, user) {
  const u = new URL(req.url, 'http://localhost');
  let from = text(u.searchParams.get('from') || u.searchParams.get('date'));
  let to = text(u.searchParams.get('to') || u.searchParams.get('date'));
  if (!from && !to) { const t = await pool.query(`SELECT to_char(${TZ_TODAY},'YYYY-MM-DD') d`); from = to = t.rows[0].d; }
  if (!isDay(from) || !isDay(to)) return json(res, 400, { error: "Sanani to'g'ri kiriting" });
  if (from > to) { const x = from; from = to; to = x; }
  const r = await pool.query(`${SELECT} WHERE user_id=$1 AND deleted_at IS NULL AND spent_on BETWEEN $2::date AND $3::date
    ORDER BY spent_on DESC, created_at DESC LIMIT 5000`, [user, from, to]);
  const summary = { count: r.rows.length, total: 0, cash: 0, card: 0, click: 0, byCategory: {} };
  r.rows.forEach(x => {
    summary.total += x.amount;
    summary[x.pay_method] = (summary[x.pay_method] || 0) + x.amount;
    summary.byCategory[x.category] = (summary.byCategory[x.category] || 0) + x.amount;
  });
  return json(res, 200, { from, to, rows: r.rows, summary });
}

async function create(req, res, user) {
  const t = await pool.query(`SELECT to_char(${TZ_TODAY},'YYYY-MM-DD') d`);
  const b = clean(await readBody(req), t.rows[0].d);
  if (b.error) return json(res, 400, { error: b.error });
  const r = await pool.query(`INSERT INTO expenses(user_id, spent_on, person, category, vehicle, amount, pay_method, liters, odometer, note)
    VALUES($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [user, b.spent_on, b.person, b.category, b.vehicle, b.amount, b.pay_method, b.liters, b.odometer, b.note]);
  const post = postOf(req);
  if (post) { try { await pool.query(`UPDATE expenses SET post = $1 WHERE id = $2`, [post, r.rows[0].id]); } catch (e) { /* ustun hali yo'q */ } }
  const row = (await pool.query(`${SELECT} WHERE id=$1`, [r.rows[0].id])).rows[0];
  return json(res, 201, row);
}

async function update(req, res, user, id) {
  const old = (await pool.query(`${SELECT} WHERE id::text=$1 AND user_id=$2 AND deleted_at IS NULL`, [id, user])).rows[0];
  if (!old) return json(res, 404, { error: 'Xarajat topilmadi' });
  const b = clean(await readBody(req), old.spent_on);
  if (b.error) return json(res, 400, { error: b.error });
  await pool.query(`UPDATE expenses SET spent_on=$1::date, person=$2, category=$3, vehicle=$4, amount=$5, pay_method=$6,
      liters=$7, odometer=$8, note=$9, updated_at=now() WHERE id::text=$10 AND user_id=$11`,
    [b.spent_on, b.person, b.category, b.vehicle, b.amount, b.pay_method, b.liters, b.odometer, b.note, id, user]);
  if (Number(old.amount) !== b.amount || old.category !== b.category) {
    await logChange(null, user, { entity: 'expense', entityId: id, entityName: b.category,
      action: 'expense_edit', field: 'amount', oldValue: old.category + ' ' + old.amount, newValue: b.category + ' ' + b.amount,
      reason: 'Xarajat tahrirlandi' });
  }
  return json(res, 200, (await pool.query(`${SELECT} WHERE id::text=$1`, [id])).rows[0]);
}

async function remove(req, res, user, id) {
  const r = await pool.query(`UPDATE expenses SET deleted_at=now() WHERE id::text=$1 AND user_id=$2 AND deleted_at IS NULL
    RETURNING category, amount::float8 amount, to_char(spent_on,'YYYY-MM-DD') spent_on`, [id, user]);
  if (!r.rows[0]) return json(res, 404, { error: 'Xarajat topilmadi' });
  const x = r.rows[0];
  await logChange(null, user, { entity: 'expense', entityId: id, entityName: x.category,
    action: 'expense_delete', field: 'amount', oldValue: String(x.amount), newValue: null,
    reason: "Xarajat o'chirildi (" + x.spent_on + ')' });
  return json(res, 200, { ok: true });
}

/* ---------- VAQTI TUGAGANLARNI YOPISH ----------
   Chiqish vaqti — aynan rejadagi tugash (muzlatib-davom ettirilganda
   qolgan vaqt hisobga olinadi). Olingan pul o'zgarmaydi; rejadagi narxdan
   kami qarzga yoziladi. */
export async function autoCloseDue(user) {
  if (!user) return 0;
  await ensureKassaSchema();
  const r = await pool.query(`
    WITH due AS (
      SELECT id,
             CASE WHEN resumed_at IS NOT NULL
                  THEN resumed_at + make_interval(secs => GREATEST(target_duration - COALESCE(duration_seconds, 0), 0))
                  ELSE started_at + make_interval(secs => target_duration) END AS end_at,
             COALESCE(cash_amount, 0) + COALESCE(terminal_amount, 0) + COALESCE(click_amount, 0) AS paid
        FROM sessions
       WHERE user_id = $1 AND status = 'active' AND auto_close = TRUE
         AND COALESCE(target_duration, 0) > 0 AND student_id IS NULL)
    UPDATE sessions s
       SET status = 'completed', finished_at = due.end_at, duration_seconds = s.target_duration,
           amount = due.paid, debt_amount = GREATEST(COALESCE(s.planned_amount, 0) - due.paid, 0),
           auto_closed = TRUE, resumed_at = NULL, frozen_at = NULL
      FROM due
     WHERE s.id = due.id AND due.end_at <= now()
    RETURNING s.id, s.vehicle_id, s.started_at, s.finished_at, s.duration_seconds, s.amount, s.debt_amount`, [String(user)]);
  /* Telegram: «vaqti tugadi» xabarlari */
  if (r.rowCount && await tgAnyBots()) {
    try {
      const pl = await pool.query(`SELECT id, plate FROM vehicles WHERE id = ANY($1)`, [r.rows.map(x => x.vehicle_id).filter(Boolean)]);
      const by = new Map(pl.rows.map(x => [String(x.id), x.plate]));
      for (const x of r.rows) {
        await tgNotify(user, 'auto', tgText.auto({ plate: by.get(String(x.vehicle_id)) || '—', startedAt: x.started_at, finishedAt: x.finished_at,
          seconds: x.duration_seconds, paid: x.amount, debt: x.debt_amount }));
      }
    } catch (e) { console.error('TG AUTO:', e.message); }
  }
  return r.rowCount;
}
/* api/index.js chaqiradi: faol ro'yxat / hisobot so'ralishidan oldin */
export async function sweepForRequest(req) {
  if (req.method !== 'GET') return;
  const path = String(req.url || '').split('?', 1)[0];
  if (!['/api/sessions/active', '/api/reports/daily', '/api/sessions/frozen'].includes(path)) return;
  const user = auth(req);
  if (user) await autoCloseDue(user);
}

/* ---------- TO'LANMAGAN (QARZ) ---------- */
async function debtList(req, res, user) {
  await autoCloseDue(user);
  const r = await pool.query(`
    SELECT s.id, v.plate, s.started_at, s.finished_at, COALESCE(s.duration_seconds, 0) AS duration_seconds,
           s.target_duration, s.debt_amount, COALESCE(s.amount, 0) AS amount, s.auto_closed
      FROM sessions s LEFT JOIN vehicles v ON v.id = s.vehicle_id
     WHERE s.user_id = $1 AND s.status = 'completed' AND s.debt_amount > 0
     ORDER BY v.plate, s.started_at
     LIMIT 3000`, [user]);
  const total = r.rows.reduce((a, x) => a + Number(x.debt_amount || 0), 0);
  json(res, 200, { rows: r.rows, total });
}
/* QARZNI TO'LASH. Pul seansning o'z kuniga EMAS, TO'LANGAN KUNGA yoziladi:
   bugun qarzga qoldi, ertaga to'ladi — pul ertangi hisobotga tushadi
   («KECHAGI» qatori). Seansning o'z to'lovlari (naqd/terminal/Klik)
   o'zgarmaydi; qarz debt_payments jadvaliga (summa, turi, post, vaqt)
   yoziladi, seansda debt_amount = 0, debt_paid += summa. */
async function debtPay(req, res, user) {
  const b = await readBody(req);
  const ids = (Array.isArray(b.ids) ? b.ids : []).map(x => text(x)).filter(Boolean).slice(0, 500);
  const method = ['cash', 'terminal', 'click'].includes(text(b.method)) ? text(b.method) : '';
  if (!ids.length) return json(res, 400, { error: 'To‘lanadigan yozuv tanlanmagan' });
  if (!method) return json(res, 400, { error: 'To‘lov turini tanlang: naqd, terminal yoki Klik' });
  /* QO'LDA SUMMA: berilmasa — hammasi */
  let want = null;
  if (b.amount !== undefined && b.amount !== null && String(b.amount).trim() !== '') {
    want = Math.round(Number(String(b.amount).replace(/[\s,]/g, '')));
    if (!Number.isFinite(want) || want <= 0) return json(res, 400, { error: 'Summani to‘g‘ri yozing', field: 'amount' });
  }
  const post = postOf(req);
  /* Vaqti tugagan «1 soatga» yozuvlar avval yopilsin — internetsiz paytda
     «To'lanmagan»ga tushgan (server hali yopmagan) qarz ham to'lansin */
  try { await autoCloseDue(user); } catch (e) { console.error('DEBT PAY sweep:', e.message); }
  /* Internetsiz to'langan bo'lsa — haqiqiy to'langan vaqt (ko'pi bilan 3 kun oldin) */
  let paidAt = null;
  if (b.paid_at || b.paidAt) {
    const d = new Date(b.paid_at || b.paidAt);
    if (!isNaN(d.getTime()) && d.getTime() <= Date.now() + 60000 && d.getTime() >= Date.now() - 3 * 86400000) paidAt = d;
  }
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await c.query(`
      SELECT s.id, s.debt_amount, (s.started_at AT TIME ZONE 'Asia/Tashkent')::date AS day, s.started_at,
             (s.started_at AT TIME ZONE 'Asia/Tashkent')::date < (COALESCE($3::timestamptz, now()) AT TIME ZONE 'Asia/Tashkent')::date AS old
        FROM sessions s
       WHERE s.user_id = $1 AND s.id::text = ANY($2::text[]) AND s.status = 'completed' AND s.debt_amount > 0
       ORDER BY s.started_at
       FOR UPDATE OF s`, [user, ids, paidAt]);
    const owed = r.rows.reduce((a, x) => a + Number(x.debt_amount || 0), 0);
    if (want !== null && want > owed) {
      /* internetsiz olingan pul keyin yetib kelsa — qarzdan ortig'i yozilmaydi */
      if (b.offline === true) want = owed;
      else { await c.query('ROLLBACK'); return json(res, 400, { error: 'Qarzdan ko‘p yozildi — jami qarz ' + Math.round(owed).toLocaleString('ru-RU') + ' so‘m', field: 'amount', owed }); }
    }
    const done = [];
    let sum = 0, left = want === null ? Infinity : want;
    for (const x of r.rows) {
      if (left <= 0) break;
      const debt = Number(x.debt_amount || 0);
      if (debt <= 0) continue;
      const amt = Math.min(debt, left);
      await c.query(`INSERT INTO debt_payments(user_id, session_id, amount, method, post, session_day, paid_at, note)
        VALUES($1, $2, $3, $4, $5, $6, COALESCE($7, now()), $8)`,
        [user, x.id, amt, method, post, x.day, paidAt, amt < debt ? 'qisman to‘lov' : null]);
      /* to'liq to'landi — yopiladi; qisman — qolgani qarz bo'lib turadi */
      await c.query(`UPDATE sessions SET debt_paid = COALESCE(debt_paid, 0) + $3, debt_amount = debt_amount - $3,
          settled_at = CASE WHEN debt_amount - $3 <= 0 THEN COALESCE($2, now()) ELSE settled_at END WHERE id = $1`, [x.id, paidAt, amt]);
      done.push(String(x.id));
      sum += amt;
      left -= amt;
    }
    const rest = Math.max(0, owed - sum);
    if (!done.length) {
      await c.query('ROLLBACK');
      return json(res, 409, { error: 'Bu qarz allaqachon to‘langan yoki topilmadi — ro‘yxat yangilanmoqda', nothing: true });
    }
    await c.query('COMMIT');
    {
      const oldDays = [...new Set(r.rows.filter(x => x.old && done.includes(String(x.id))).map(x => ddmm(x.started_at)))].join(', ');
      await tgNotify(user, 'debt', tgText.debt({ name: text(b.name) || '—', total: sum, method, count: done.length, oldDays, post, rest }));
    }
    await logChange(null, user, { entity: 'session', entityId: done[0] || null, entityName: text(b.name) || null,
      action: 'debt_paid', field: method, newValue: sum + ' so‘m, ' + done.length + ' ta yozuv' + (post ? ', ' + post + '-POST' : '')
        + (rest > 0 ? ', qisman — ' + rest + ' so‘m qarz qoldi' : ''),
      reason: 'To‘lanmagan vaqtlar to‘landi (to‘langan kunning hisobotiga yoziladi)' });
    json(res, 200, { ok: true, count: done.length, ids: done, total: sum, rest, partial: rest > 0 });
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch { /* noop */ }
    throw e;
  } finally { c.release(); }
}

/* QARZ TO'LOVINI BEKOR QILISH — xato to'lov (boshqa mijozniki bosilgan,
   noto'g'ri usul): to'lov yozuvlari o'chiriladi, qarz yana «To'lanmagan»ga
   qaytadi, keyin to'g'risi bilan to'lanadi. Sabab majburiy, jurnalga
   (qachon, qancha, qaysi usul, qaysi post) yoziladi. */
async function debtUnpay(req, res, user) {
  const b = await readBody(req);
  const id = text(b.session_id || b.id);
  const reason = text(b.reason).replace(/\s+/g, ' ').slice(0, 300);
  if (!id) return json(res, 400, { error: 'Yozuv tanlanmagan' });
  if (reason.length < 5) return json(res, 400, { error: 'Sababini yozing (kamida 5 ta harf)' });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await c.query(`SELECT s.id, s.status, COALESCE(s.debt_amount, 0)::numeric AS debt_amount,
        COALESCE(s.debt_paid, 0)::numeric AS debt_paid, s.settled_at, COALESCE(v.plate, s.driver_name, '') AS plate
      FROM sessions s LEFT JOIN vehicles v ON v.id = s.vehicle_id
      WHERE s.id::text = $1 AND s.user_id = $2 FOR UPDATE OF s`, [id, user]);
    const s = r.rows[0];
    if (!s) { await c.query('ROLLBACK'); return json(res, 404, { error: 'Yozuv topilmadi' }); }
    /* Yopilgan kunlar o'zgarmasin: BUGUN qilingan to'lov — o'chiriladi;
       o'tgan kundagi to'lov — o'sha kunning hisobotida qoladi, bugungi
       sana bilan teskari (manfiy) yozuv qo'shiladi (o'sha post, o'sha usul). */
    const pr = await c.query(`SELECT id, amount::float8 AS amount, method, post, session_day, paid_at, reversal_of,
        (paid_at AT TIME ZONE 'Asia/Tashkent')::date = (now() AT TIME ZONE 'Asia/Tashkent')::date AS today
      FROM debt_payments WHERE session_id = $1 AND user_id = $2 ORDER BY paid_at FOR UPDATE`, [s.id, user]);
    const reversed = new Set(pr.rows.filter(x => x.reversal_of).map(x => String(x.reversal_of)));
    const open = pr.rows.filter(x => Number(x.amount) > 0 && !x.reversal_of && !reversed.has(String(x.id)));
    const back = open.reduce((a, x) => a + Number(x.amount || 0), 0);
    if (!open.length || back <= 0) { await c.query('ROLLBACK'); return json(res, 409, { error: 'Bu yozuvda to‘langan qarz yo‘q' }); }
    let deleted = 0, reversedN = 0;
    for (const x of open) {
      if (x.today) { await c.query(`DELETE FROM debt_payments WHERE id = $1`, [x.id]); deleted++; }
      else {
        await c.query(`INSERT INTO debt_payments(user_id, session_id, amount, method, post, session_day, paid_at, note, reversal_of)
          VALUES($1, $2, $3, $4, $5, $6, now(), $7, $8)`,
          [user, s.id, -Number(x.amount), x.method, x.post, x.session_day, 'Bekor qilindi: ' + reason, x.id]);
        reversedN++;
      }
    }
    /* qarz qaytadi. Qisman to'langan (qarzi hali yopilmagan — settled_at yo'q):
       qolgan qarz + qaytgan to'lov. To'liq yopilgan: eski xato tufayli qarz
       ham yozilgan bo'lsa — ikki barobar bo'lmasin (GREATEST). */
    const partialOpen = !s.settled_at && Number(s.debt_amount) > 0;
    await c.query(`UPDATE sessions SET debt_amount = CASE WHEN $4 THEN COALESCE(debt_amount, 0) + $2 ELSE GREATEST(COALESCE(debt_amount, 0), $2) END,
        debt_paid = GREATEST(COALESCE(debt_paid, 0) - $2, 0), settled_at = NULL,
        corrected_at = now(), correction_note = $3 WHERE id = $1`, [s.id, back, reason, partialOpen]);
    await c.query('COMMIT');
    await tgNotify(user, 'fix', tgText.unpay({ plate: s.plate || '—', amount: back, reason, post: postOf(req) }));
    const pays = { rows: open };
    const tk = d => new Date(new Date(d).getTime() + 5 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
    await logChange(null, user, { entity: 'session', entityId: s.id, entityName: s.plate || null, action: 'debt_unpaid',
      field: pays.rows.map(x => x.method).join(','),
      oldValue: pays.rows.map(x => Number(x.amount) + ' so‘m ' + x.method + ' ' + tk(x.paid_at) + (x.post ? ' ' + x.post + '-POST' : '')).join('; '),
      newValue: 'bekor qilindi — ' + back + ' so‘m yana «To‘lanmagan»da'
        + (reversedN ? ' (o‘tgan kun to‘lovi o‘z kunida qoldi, bugun teskari yozuv)' : ''), reason });
    json(res, 200, { ok: true, id: s.id, debt_amount: partialOpen ? Number(s.debt_amount) + back : Math.max(Number(s.debt_amount), back), returned: back, deleted, reversed: reversedN });
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch { /* noop */ }
    throw e;
  } finally { c.release(); }
}

/* ---------- BIR QISMINI YOPISH ---------- */
const money0 = v => Math.max(0, Math.round(Number(v) || 0));
async function sessionSplit(req, res, user, id) {
  const b = await readBody(req);
  const minutes = Math.round(Number(b.minutes) || 0);
  if (minutes < 15 || minutes > 12 * 60) return json(res, 400, { error: 'Yopiladigan vaqtni tanlang' });
  const cash = money0(b.cash_amount ?? b.cashAmount), terminal = money0(b.terminal_amount ?? b.terminalAmount);
  const click = money0(b.click_amount ?? b.clickAmount), debt = money0(b.debt_amount ?? b.debtAmount);
  if (cash + terminal + click + debt <= 0) return json(res, 400, { error: 'Summa ko‘rsatilmagan' });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await c.query(`SELECT * FROM sessions WHERE id::text = $1 AND user_id = $2 FOR UPDATE`, [id, user]);
    const s = r.rows[0];
    if (!s) { await c.query('ROLLBACK'); return json(res, 404, { error: 'Yozuv topilmadi' }); }
    if (s.status !== 'active') { await c.query('ROLLBACK'); return json(res, 409, { error: 'Faqat ichkaridagi vaqtni bo‘lib yopish mumkin' }); }
    if (s.student_id) { await c.query('ROLLBACK'); return json(res, 400, { error: 'Avtoshkola o‘quvchisi uchun emas' }); }
    if (s.resumed_at) { await c.query('ROLLBACK'); return json(res, 400, { error: 'Muzlatib davom ettirilgan vaqtni bo‘lib bo‘lmaydi — «Chiqdi» dan yoping' }); }
    if (Number(s.target_duration) > 0) { await c.query('ROLLBACK'); return json(res, 400, { error: 'Soati belgilangan vaqt o‘zi yopiladi — bo‘lish shart emas' }); }
    const start = new Date(s.started_at);
    const cut = new Date(start.getTime() + minutes * 60000);
    /* Yaxlitlangan yarim soat hozirdan sal keyin bo'lishi mumkin (1 soat 58 daq → 2 soat) */
    if (cut.getTime() > Date.now() + 30 * 60000) { await c.query('ROLLBACK'); return json(res, 400, { error: 'Tanlangan vaqt hali o‘tmagan' }); }
    const cols = new Set((await c.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'sessions'`)).rows.map(x => x.column_name));
    const paid = cash + terminal + click;
    const used = [cash > 0, terminal > 0, click > 0].filter(Boolean).length;
    const method = used > 1 ? 'mixed' : terminal > 0 ? 'terminal' : click > 0 ? 'click' : 'cash';
    const cand = [
      ['user_id', s.user_id], ['vehicle_id', s.vehicle_id], ['started_at', s.started_at], ['finished_at', cut],
      ['duration_seconds', minutes * 60], ['hourly_rate', s.hourly_rate], ['minimum_payment', s.minimum_payment],
      ['calculation_mode', s.calculation_mode], ['amount', paid], ['cash_amount', cash], ['terminal_amount', terminal],
      ['click_amount', click], ['payment_method', method], ['status', 'completed'], ['customer_type', s.customer_type],
      ['instructor_id', s.instructor_id], ['instructor_name', s.instructor_name], ['driver_name', s.driver_name],
      ['manual_price', true], ['debt_amount', debt], ['target_duration', minutes * 60], ['lessons_counted', 0],
      ['school_id', s.school_id], ['group_id', s.group_id],
      ['post', s.post || postOf(req)], ['pay_post', postOf(req)], ['opened_by', s.opened_by || null]
    ].filter(([k, v]) => cols.has(k) && !(['post', 'pay_post', 'opened_by'].includes(k) && v === null));
    if (click > 0 && !cols.has('click_amount')) throw new Error('Klik to‘lovi uchun baza hali tayyor emas');
    const ins = await c.query(`INSERT INTO sessions(${cand.map(([k]) => k).join(',')})
      VALUES(${cand.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING id`, cand.map(([, v]) => v));
    await c.query(`UPDATE sessions SET started_at = $1 WHERE id = $2`, [cut, s.id]);
    await c.query('COMMIT');
    {
      const pr = await pool.query(`SELECT plate FROM vehicles WHERE id = $1`, [s.vehicle_id]).catch(() => ({ rows: [] }));
      await tgNotify(user, 'finish', tgText.finish({ plate: (pr.rows[0] && pr.rows[0].plate) || text(b.name) || '—', startedAt: start, finishedAt: cut,
        seconds: minutes * 60, cash, terminal, click, debt, post: postOf(req), note: '✂️ bir qismi yopildi, qolgani davom etyapti' }));
    }
    await logChange(null, user, { entity: 'session', entityId: s.id, entityName: text(b.name) || null, action: 'split',
      field: 'started_at', oldValue: start.toISOString(), newValue: cut.toISOString(),
      reason: minutes + ' daqiqa yopildi: ' + (paid ? paid + ' so‘m ' + method : '') + (debt ? ' qarz ' + debt + ' so‘m' : '') });
    json(res, 200, { ok: true, closedId: ins.rows[0].id, id: s.id, continuesFrom: cut.toISOString(), minutes, paid, debt });
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch { /* noop */ }
    throw e;
  } finally { c.release(); }
}

/* ---------- TO'G'RILASH ---------- */
async function sessionCorrect(req, res, user, id) {
  const b = await readBody(req);
  const reason = text(b.reason).replace(/\s+/g, ' ').slice(0, 300);
  if (reason.length < 5) return json(res, 400, { error: 'Sababini yozing (kamida 5 ta harf)' });
  const vals = {};
  for (const k of ['cash_amount', 'terminal_amount', 'click_amount', 'debt_amount']) {
    const v = Number(b[k]);
    if (!Number.isFinite(v) || v < 0 || v > 100000000) return json(res, 400, { error: 'Summa noto‘g‘ri' });
    vals[k] = Math.round(v);
  }
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await c.query(`SELECT s.*, v.plate FROM sessions s LEFT JOIN vehicles v ON v.id = s.vehicle_id
      WHERE s.id::text = $1 AND s.user_id = $2 FOR UPDATE OF s`, [id, user]);
    const s = r.rows[0];
    if (!s) { await c.query('ROLLBACK'); return json(res, 404, { error: 'Yozuv topilmadi' }); }
    if (s.student_id || String(s.customer_type || '') === 'school') { await c.query('ROLLBACK'); return json(res, 400, { error: 'Avtoshkola darsi tekin — to‘lovi yo‘q' }); }
    if (s.status === 'cancelled') { await c.query('ROLLBACK'); return json(res, 400, { error: 'Bekor qilingan yozuv' }); }
    /* Qarzi keyin to'langan (pul to'langan kunning hisobotida) — bu yerda
       o'zgartirilsa pul ikki marta sanalardi. Avval to'lov bekor qilinadi. */
    if (Number(s.debt_paid || 0) > 0) {
      await c.query('ROLLBACK');
      return json(res, 409, { error: 'Bu yozuvning qarzi keyin to‘langan (' + Math.round(Number(s.debt_paid)) + ' so‘m). To‘lov xato bo‘lsa — «Qarz to‘lovini bekor qilish» tugmasini bosing.', debtPaid: true });
    }
    /* Ichkaridagi yozuvda qarz bo'lmaydi — u yopilganda hisoblanadi */
    if (s.status !== 'completed' && vals.debt_amount > 0) { await c.query('ROLLBACK'); return json(res, 400, { error: 'Ichkaridagi mashinaga «to‘lanmagan» yozib bo‘lmaydi — u chiqqanda yoziladi' }); }
    const old = { cash_amount: Number(s.cash_amount || 0), terminal_amount: Number(s.terminal_amount || 0),
      click_amount: Number(s.click_amount || 0), debt_amount: Number(s.debt_amount || 0) };
    const changed = Object.keys(vals).filter(k => old[k] !== vals[k]);
    if (!changed.length) { await c.query('ROLLBACK'); return json(res, 400, { error: 'Hech narsa o‘zgarmadi' }); }
    const paid = vals.cash_amount + vals.terminal_amount + vals.click_amount;
    const used = [vals.cash_amount > 0, vals.terminal_amount > 0, vals.click_amount > 0].filter(Boolean).length;
    const method = used > 1 ? 'mixed' : vals.terminal_amount > 0 ? 'terminal' : vals.click_amount > 0 ? 'click' : 'cash';
    const settle = old.debt_amount > 0 && vals.debt_amount === 0;
    await c.query(`UPDATE sessions SET cash_amount = $1, terminal_amount = $2, click_amount = $3, debt_amount = $4,
        amount = $5, payment_method = $6, corrected_at = now(),
        correction_note = $7, settled_at = CASE WHEN $8 THEN now() ELSE settled_at END
      WHERE id = $9`,
      [vals.cash_amount, vals.terminal_amount, vals.click_amount, vals.debt_amount, paid, method, reason, settle, s.id]);
    await c.query('COMMIT');
    const names = { cash_amount: 'naqd', terminal_amount: 'terminal', click_amount: 'Klik', debt_amount: 'to‘lanmagan' };
    {
      const fmt = v => Object.keys(names).filter(k => v[k] > 0).map(k => names[k] + ' ' + String(v[k]).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')).join(' + ') || 'pul yo‘q';
      await tgNotify(user, 'fix', tgText.correct({ plate: s.plate || '—', from: fmt(old), to: fmt(vals), reason, post: postOf(req) }));
    }
    for (const k of changed) {
      await logChange(null, user, { entity: 'session', entityId: s.id, entityName: s.plate || null, action: 'correct',
        field: names[k], oldValue: old[k], newValue: vals[k], reason: reason });
    }
    json(res, 200, { ok: true, id: s.id, amount: paid, debt_amount: vals.debt_amount, payment_method: method, changed });
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch { /* noop */ }
    throw e;
  } finally { c.release(); }
}

/* ---------- CHEK CHOP ETILDI (jurnal) ----------
   «Qachon chek chiqarilgan?» degan savolga aniq javob bo'lsin: har
   chiqarilgan / qayta chiqarilgan kirish taloni vaqti bilan yoziladi. */
async function ticketLog(req, res, user, id) {
  const b = await readBody(req);
  const kind = text(b.kind) === 'reprint' ? 'reprint' : 'print';
  const r = await pool.query(`SELECT s.id, COALESCE(v.plate, s.driver_name, '') AS plate FROM sessions s
    LEFT JOIN vehicles v ON v.id = s.vehicle_id WHERE s.id::text = $1 AND s.user_id = $2`, [id, user]);
  if (!r.rows[0]) return json(res, 404, { error: 'Yozuv topilmadi' });
  /* internetsiz chiqarilgan chek — keyin yuboriladi, haqiqiy vaqti bilan */
  let at = null;
  if (b.at) {
    const d = new Date(b.at);
    if (!isNaN(d.getTime()) && d.getTime() <= Date.now() + 60000 && Date.now() - d.getTime() <= 72 * 3600 * 1000) at = d;
  }
  await logChange(null, user, { entity: 'session', entityId: r.rows[0].id, entityName: r.rows[0].plate, action: 'ticket_print',
    field: kind === 'reprint' ? 'qayta' : 'birinchi', newValue: text(b.note).slice(0, 120) || (at && b.offline ? 'internetsiz' : null),
    reason: kind === 'reprint' ? 'Kirish taloni qayta chiqarildi' : 'Kirish taloni chiqarildi', at });
  json(res, 200, { ok: true });
}

export async function handleKassaRequest(req, res) {
  const path = String(req.url || '').split('?', 1)[0];
  const tm = path.match(/^\/api\/sessions\/([^/]+)\/ticket$/);
  if (tm) {
    if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return true; }
    if (req.method !== 'POST') { json(res, 405, { error: 'Method ruxsat etilmagan' }); return true; }
    const user = auth(req);
    if (!user) { json(res, 401, { error: 'Kirish talab qilinadi' }); return true; }
    try { await ticketLog(req, res, user, decodeURIComponent(tm[1])); }
    catch (e) { console.error('TICKET LOG ERROR:', e); json(res, 500, { error: e.message || 'Yozilmadi' }); }
    return true;
  }
  const cm = path.match(/^\/api\/sessions\/([^/]+)\/correct$/);
  if (cm) {
    if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return true; }
    if (req.method !== 'POST') { json(res, 405, { error: 'Method ruxsat etilmagan' }); return true; }
    const user = auth(req);
    if (!user) { json(res, 401, { error: 'Kirish talab qilinadi' }); return true; }
    try { await ensureKassaSchema(); await sessionCorrect(req, res, user, decodeURIComponent(cm[1])); }
    catch (e) { console.error('CORRECT ERROR:', e); json(res, 500, { error: e.message || 'To‘g‘rilanmadi' }); }
    return true;
  }
  const sm = path.match(/^\/api\/sessions\/([^/]+)\/split$/);
  if (sm) {
    if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return true; }
    if (req.method !== 'POST') { json(res, 405, { error: 'Method ruxsat etilmagan' }); return true; }
    const user = auth(req);
    if (!user) { json(res, 401, { error: 'Kirish talab qilinadi' }); return true; }
    try { await ensureKassaSchema(); await sessionSplit(req, res, user, decodeURIComponent(sm[1])); }
    catch (e) { console.error('SPLIT ERROR:', e); json(res, 500, { error: e.message || 'Bo‘lib yopilmadi' }); }
    return true;
  }
  if (path === '/api/debts' || path === '/api/debts/pay' || path === '/api/debts/unpay') {
    if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return true; }
    const user = auth(req);
    if (!user) { json(res, 401, { error: 'Kirish talab qilinadi' }); return true; }
    try {
      await ensureKassaSchema();
      if (path === '/api/debts' && req.method === 'GET') { await debtList(req, res, user); return true; }
      if (path === '/api/debts/pay' && req.method === 'POST') { await debtPay(req, res, user); return true; }
      if (path === '/api/debts/unpay' && req.method === 'POST') { await debtUnpay(req, res, user); return true; }
      json(res, 405, { error: 'Method ruxsat etilmagan' }); return true;
    } catch (e) {
      console.error('DEBTS ERROR:', e);
      json(res, 500, { error: e.message || 'To‘lanmaganlar bo‘yicha xatolik' });
      return true;
    }
  }
  if (path !== '/api/expenses' && !path.startsWith('/api/expenses/')) return false;
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return true; }
  const user = auth(req);
  if (!user) { json(res, 401, { error: 'Kirish talab qilinadi' }); return true; }
  try {
    await ensureKassaSchema();
    const id = path.startsWith('/api/expenses/') ? decodeURIComponent(path.slice('/api/expenses/'.length)) : '';
    if (!id && req.method === 'GET') { await list(req, res, user); return true; }
    if (!id && req.method === 'POST') { await create(req, res, user); return true; }
    if (id && req.method === 'PUT') { await update(req, res, user, id); return true; }
    if (id && req.method === 'DELETE') { await remove(req, res, user, id); return true; }
    json(res, 405, { error: 'Method ruxsat etilmagan' }); return true;
  } catch (e) {
    console.error('EXPENSES ERROR:', e);
    json(res, 500, { error: e.message || 'Xarajatlar bo‘yicha xatolik' });
    return true;
  }
}
