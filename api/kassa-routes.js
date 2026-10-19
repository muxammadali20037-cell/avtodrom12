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
        POST /api/debts/pay { ids, method }   hammasini to'lash (naqd/terminal/Klik)
   ========================================================================== */

import jwt from 'jsonwebtoken';
import { pool } from '../backend/src/db.js';
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
  schemaP = (async () => {
    const cols = await pool.query(`
      SELECT table_name, column_name, is_nullable, character_maximum_length
        FROM information_schema.columns
       WHERE table_schema='public' AND (
         (table_name='sessions' AND column_name IN ('click_amount','debt_amount','auto_close','planned_amount','settled_at','auto_closed')) OR
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
  })().catch(e => { schemaP = null; throw e; });
  return schemaP;
}

/* ---------- RASXOD ---------- */
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
  pay_method, liters::float8 liters, odometer, note, created_at, updated_at FROM expenses`;

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
    RETURNING s.id`, [String(user)]);
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
async function debtPay(req, res, user) {
  const b = await readBody(req);
  const ids = (Array.isArray(b.ids) ? b.ids : []).map(x => text(x)).filter(Boolean).slice(0, 500);
  const method = ['cash', 'terminal', 'click'].includes(text(b.method)) ? text(b.method) : '';
  if (!ids.length) return json(res, 400, { error: 'To‘lanadigan yozuv tanlanmagan' });
  if (!method) return json(res, 400, { error: 'To‘lov turini tanlang: naqd, terminal yoki Klik' });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await c.query(`
      UPDATE sessions s
         SET cash_amount = s.cash_amount + CASE WHEN $3 = 'cash' THEN s.debt_amount ELSE 0 END,
             terminal_amount = s.terminal_amount + CASE WHEN $3 = 'terminal' THEN s.debt_amount ELSE 0 END,
             click_amount = s.click_amount + CASE WHEN $3 = 'click' THEN s.debt_amount ELSE 0 END,
             amount = COALESCE(s.amount, 0) + s.debt_amount,
             settled_at = now(), debt_amount = 0
       WHERE s.user_id = $1 AND s.id::text = ANY($2::text[]) AND s.status = 'completed' AND s.debt_amount > 0
       RETURNING s.id`, [user, ids, method]);
    const done = r.rows.map(x => String(x.id));
    if (done.length) {
      await c.query(`
        UPDATE sessions SET payment_method = CASE
            WHEN ((cash_amount > 0)::int + (terminal_amount > 0)::int + (click_amount > 0)::int) > 1 THEN 'mixed'
            WHEN terminal_amount > 0 THEN 'terminal' WHEN click_amount > 0 THEN 'click' ELSE 'cash' END
         WHERE user_id = $1 AND id::text = ANY($2::text[])`, [user, done]);
    }
    await c.query('COMMIT');
    const sum = Number(b.total || 0);
    await logChange(null, user, { entity: 'session', entityId: done[0] || null, entityName: text(b.name) || null,
      action: 'debt_paid', field: method, newValue: (sum ? sum + ' so‘m, ' : '') + done.length + ' ta yozuv',
      reason: 'To‘lanmagan vaqtlar birdan to‘landi' });
    json(res, 200, { ok: true, count: done.length, ids: done });
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch { /* noop */ }
    throw e;
  } finally { c.release(); }
}

export async function handleKassaRequest(req, res) {
  const path = String(req.url || '').split('?', 1)[0];
  if (path === '/api/debts' || path === '/api/debts/pay') {
    if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return true; }
    const user = auth(req);
    if (!user) { json(res, 401, { error: 'Kirish talab qilinadi' }); return true; }
    try {
      await ensureKassaSchema();
      if (path === '/api/debts' && req.method === 'GET') { await debtList(req, res, user); return true; }
      if (path === '/api/debts/pay' && req.method === 'POST') { await debtPay(req, res, user); return true; }
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
