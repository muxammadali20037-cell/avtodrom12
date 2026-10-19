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
        POST   /api/expenses                  { spent_on, person, category, vehicle, amount, pay_method, liters, odometer, note }
        PUT    /api/expenses/:id
        DELETE /api/expenses/:id              (yozuv o'chirilmaydi — deleted_at; jurnalga tushadi)
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
         (table_name='sessions' AND column_name='click_amount') OR
         (table_name='vehicles' AND column_name IN ('region_code','first_letter','number','last_letters','plate')))`);
    const col = {};
    cols.rows.forEach(r => { col[r.table_name + '.' + r.column_name] = r; });

    if (!col['sessions.click_amount']) {
      await pool.query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS click_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
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

export async function handleKassaRequest(req, res) {
  const path = String(req.url || '').split('?', 1)[0];
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
