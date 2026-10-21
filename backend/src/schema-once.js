/* ============================================================================
   SXEMA O'ZGARISHLARI — FAQAT BIR MARTA

   MUAMMO (baza «qotib» qolardi): har bir modul server har uyg'onganda
   (Vercel'da bu kuniga yuzlab marta) `ALTER TABLE ... ADD COLUMN IF NOT
   EXISTS`, `DROP/CREATE TRIGGER`, `ADD CONSTRAINT` yuborardi. PostgreSQL bu
   buyruqlar uchun — ustun allaqachon bo'lsa ham — avval jadvalni TO'LIQ
   QULFLAYDI (ACCESS EXCLUSIVE). O'sha paytda biror uzunroq so'rov (hisobot)
   ishlayotgan bo'lsa, qulf uni kutadi, qolgan hamma so'rovlar esa qulf
   ortida navbatga turadi — ilova qotadi; ikki server bir vaqtda trigger
   yaratsa xato ham berardi.

   YECHIM:
     runOnce(nom, fn) — fn bazada `avtodrom_migrations` jadvalida «nom»
       yozilmagan bo'lsagina bajariladi; muvaffaqiyatli bo'lsa yoziladi.
       Keyingi uyg'onishlarda bitta yengil SELECT (qulfsiz) va tamom.
       Sxema o'zgarsa — nomdagi versiya oshiriladi (masalan v2 → v3).
     ddl(sql) — DDL ni o'z tranzaksiyasida `lock_timeout = 4s` bilan
       bajaradi: qulfni tez ololmasa kutib qolmaydi (hamma so'rovlarni
       to'xtatmaydi), xato bilan qaytadi va 2 marta qayta urinadi.
   ========================================================================== */

import { pool } from './db.js';

const memo = new Map();
let tableP = null;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function migrationsTable() {
  if (!tableP) {
    tableP = (async () => {
      const r = await pool.query(`SELECT to_regclass('public.avtodrom_migrations') AS t`);
      if (!r.rows[0] || !r.rows[0].t) {
        await pool.query(`CREATE TABLE IF NOT EXISTS avtodrom_migrations(
          name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
      }
    })().catch(e => { tableP = null; throw e; });
  }
  return tableP;
}

export function runOnce(name, fn) {
  if (memo.has(name)) return memo.get(name);
  const p = (async () => {
    await migrationsTable();
    const r = await pool.query(`SELECT 1 FROM avtodrom_migrations WHERE name = $1`, [name]);
    if (r.rowCount) return false;
    const t0 = Date.now();
    await fn();
    await pool.query(`INSERT INTO avtodrom_migrations(name) VALUES($1) ON CONFLICT (name) DO NOTHING`, [name]);
    console.log('SCHEMA ONCE:', name, 'bajarildi,', Date.now() - t0, 'ms');
    return true;
  })().catch(e => { memo.delete(name); throw e; });
  memo.set(name, p);
  return p;
}

/* ---------------------------------------------------------------------------
   BAZA TOMONIDAGI HIMOYA (bir marta, ilova foydalanuvchisi uchun):
     idle_in_transaction_session_timeout = 60s
        — Vercel funksiyasi tranzaksiya o'rtasida to'xtab qolsa, ochiq
          tranzaksiya qulflarni abadiy ushlab turardi (hamma narsa qotadi).
          Endi 60 soniyadan keyin baza uni o'zi yopadi.
     statement_timeout = 120s — cheksiz ishlab qolgan so'rov to'xtatiladi.
     lock_timeout = 20s — qulfni abadiy kutib qolmaydi, xato qaytaradi.
   Yangi ulanishlarga ta'sir qiladi. Ruxsat bo'lmasa — jurnalga yoziladi,
   ilova ishlashda davom etadi.
   ------------------------------------------------------------------------- */
let safetyP = null;
export function ensureDbSafety() {
  if (safetyP) return safetyP;
  safetyP = runOnce('db-role-timeouts-v1', async () => {
    for (const sql of [
      `ALTER ROLE CURRENT_USER SET idle_in_transaction_session_timeout = '60s'`,
      `ALTER ROLE CURRENT_USER SET statement_timeout = '120s'`,
      `ALTER ROLE CURRENT_USER SET lock_timeout = '20s'`
    ]) {
      try { await pool.query(sql); }
      catch (e) { console.warn('DB SAFETY:', sql.split(' SET ')[1], '—', e.message); }
    }
  }).catch(e => { safetyP = null; console.warn('DB SAFETY:', e.message); return false; });
  return safetyP;
}

/* Hozirgi ulanishdagi chegaralar — /api/health uchun */
export async function dbLimits() {
  try {
    const r = await pool.query(`SELECT current_setting('statement_timeout') AS statement_timeout,
      current_setting('idle_in_transaction_session_timeout') AS idle_in_tx_timeout,
      current_setting('lock_timeout') AS lock_timeout,
      current_setting('max_connections') AS max_connections,
      (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database())::int AS connections_now`);
    return r.rows[0];
  } catch (e) { return { error: e.message }; }
}

export async function ddl(sql, params) {
  for (let i = 0; i < 3; i++) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SET LOCAL lock_timeout = '4s'`);
      await c.query(sql, params);
      await c.query('COMMIT');
      return;
    } catch (e) {
      try { await c.query('ROLLBACK'); } catch { /* noop */ }
      /* 55P03 — qulf olinmadi: band paytni kutib qayta urinamiz */
      if (e && e.code === '55P03' && i < 2) { await sleep(700 * (i + 1)); continue; }
      throw e;
    } finally { c.release(); }
  }
}
