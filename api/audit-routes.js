/* ============================================================================
   O'ZGARTIRISHLAR JURNALI (audit)

   Muammo: kimdir o'quvchining dars sonini 8 dan 3 ga tushirib qo'ysa yoki
   bir kunda 4 soat davomat yozib yuborsa, ertaga «nega bunday bo'lgan?»
   degan savolga javob yo'q edi — o'zgarish izsiz ketardi.

   Endi bunday amallar SABABSIZ bajarilmaydi. Har bir o'zgarish
   jurnalga tushadi: nima o'zgargani (eski va yangi qiymat), kim
   o'zgartirgani, qachon va NEGA.

   Jurnal faqat qo'shiladi — o'chirilmaydi va tahrirlanmaydi.

   Yo'llar:
     GET /api/audit?entity=student&entityId=...   — bitta o'quvchi tarixi
     GET /api/audit?from=&to=                     — kun/oraliq bo'yicha
   ========================================================================== */

import jwt from 'jsonwebtoken';
import { pool } from '../backend/src/db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';

/* Sabab shundan qisqa bo'lsa qabul qilinmaydi — «a», «.», «ok» kabi
   quruq belgilar jurnalni foydasiz qilib qo'yadi. */
export const MIN_REASON = 5;

/* Bir marta yozilganda shu sondan ko'p dars bo'lsa sabab so'raladi */
export const LESSONS_NEED_REASON = 2;

const text = v => String(v === null || v === undefined ? '' : v).trim();
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

function json(res, status, data) {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify(data));
}

function auth(req) {
  try {
    const h = req.headers?.authorization || '';
    if (!h.startsWith('Bearer ')) return null;
    return String(jwt.verify(h.slice(7), JWT_SECRET).sub || '');
  } catch { return null; }
}

/* Sabab yetarlimi? Yetarli bo'lmasa xato matnini qaytaradi. */
export function reasonError(reason) {
  const r = text(reason);
  if (!r) return 'Sababini yozing — izohsiz saqlanmaydi.';
  if (r.length < MIN_REASON) return 'Sabab juda qisqa — kamida ' + MIN_REASON + ' ta belgi yozing.';
  return '';
}

let schemaPromise = null;
export function ensureAuditSchema() {
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    const q = async sql => {
      try { await pool.query(sql); } catch (e) { console.error('AUDIT SCHEMA:', e.message); }
    };
    await q(`CREATE TABLE IF NOT EXISTS change_log(
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_key TEXT NOT NULL,
      entity VARCHAR(40) NOT NULL,          -- 'student' | 'attendance' | ...
      entity_id TEXT,
      entity_name TEXT,                     -- o'sha paytdagi nomi (keyin o'zgarsa ham qoladi)
      action VARCHAR(40) NOT NULL,          -- 'lessons_edit' | 'attendance_bulk' | ...
      field VARCHAR(60),
      old_value TEXT,
      new_value TEXT,
      reason TEXT NOT NULL,
      actor TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await q(`CREATE INDEX IF NOT EXISTS idx_change_log_entity
             ON change_log(owner_key, entity, entity_id, created_at DESC)`);
    await q(`CREATE INDEX IF NOT EXISTS idx_change_log_date
             ON change_log(owner_key, created_at DESC)`);
  })().catch(e => { schemaPromise = null; throw e; });
  return schemaPromise;
}

/* Jurnalga yozish. `db` tranzaksiya klienti bo'lishi mumkin.
   Jurnal yozilmay qolsa ASOSIY amal buzilmasin — xato faqat logga
   chiqadi, chunki davomatni yo'qotgandan ko'ra jurnalsiz qolgani afzal. */
export async function logChange(db, owner, rec) {
  try {
    await ensureAuditSchema();
    await (db || pool).query(
      `INSERT INTO change_log(owner_key, entity, entity_id, entity_name, action,
                              field, old_value, new_value, reason, actor)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [String(owner), text(rec.entity), rec.entityId ? String(rec.entityId) : null,
       text(rec.entityName) || null, text(rec.action) || 'edit',
       text(rec.field) || null,
       rec.oldValue === null || rec.oldValue === undefined ? null : String(rec.oldValue),
       rec.newValue === null || rec.newValue === undefined ? null : String(rec.newValue),
       text(rec.reason), text(rec.actor) || String(owner)]);
    return true;
  } catch (e) {
    console.error('AUDIT LOG:', e.message);
    return false;
  }
}

/* Bitta obyekt bo'yicha oxirgi yozuvlar */
export async function historyFor(owner, entity, entityId, limit) {
  await ensureAuditSchema();
  const r = await pool.query(
    `SELECT id, entity, entity_id, entity_name, action, field,
            old_value, new_value, reason, actor, created_at
       FROM change_log
      WHERE owner_key = $1 AND entity = $2 AND entity_id = $3
      ORDER BY created_at DESC
      LIMIT $4`,
    [String(owner), String(entity), String(entityId), Math.min(100, Math.max(1, Number(limit) || 20))]);
  return r.rows;
}

export async function handleAuditRequest(req, res) {
  const path = String(req.url || '').split('?', 1)[0];
  if (path !== '/api/audit') return false;

  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return true; }
  if (req.method !== 'GET') { json(res, 405, { error: 'Method ruxsat etilmagan' }); return true; }

  const owner = auth(req);
  if (!owner) { json(res, 401, { error: 'Kirish talab qilinadi' }); return true; }

  try {
    await ensureAuditSchema();
    const url = new URL(req.url, 'http://localhost');
    const entity = text(url.searchParams.get('entity'));
    const entityId = text(url.searchParams.get('entityId') || url.searchParams.get('entity_id'));

    if (entity && entityId) {
      json(res, 200, { rows: await historyFor(owner, entity, entityId, url.searchParams.get('limit')) });
      return true;
    }

    let from = text(url.searchParams.get('from') || url.searchParams.get('date'));
    let to = text(url.searchParams.get('to'));
    if (!isDate(from)) from = new Date().toISOString().slice(0, 10);
    if (!isDate(to)) to = from;
    if (to < from) { const t = from; from = to; to = t; }

    const p = [String(owner), from, to];
    let where = `owner_key=$1 AND created_at >= $2::date AND created_at < ($3::date + INTERVAL '1 day')`;
    if (entity) { p.push(entity); where += ` AND entity=$${p.length}`; }

    const r = await pool.query(
      `SELECT id, entity, entity_id, entity_name, action, field,
              old_value, new_value, reason, actor, created_at
         FROM change_log
        WHERE ${where}
        ORDER BY created_at DESC
        LIMIT 500`, p);
    json(res, 200, { from, to, rows: r.rows });
    return true;
  } catch (e) {
    console.error('AUDIT ERROR:', e);
    json(res, 500, { error: e.message || 'Jurnal xatosi' });
    return true;
  }
}
