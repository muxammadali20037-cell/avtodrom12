/* ============================================================================
   AVTOSHKOLA MASHINALARI (park)

   Har bir avtoshkolaning o'z mashinalari bor. Instruktorga bitta doimiy
   mashina biriktirilgan bo'lishi mumkin, lekin amalda bir instruktor
   turli kunlarda turli mashinada uchirishi ham mumkin. Shuning uchun
   mashinalar instruktordan ALOHIDA ro'yxat sifatida saqlanadi.

   Nima uchun kerak:
     - operator o'quvchini tanlagach, faqat o'sha avtoshkolaning
       mashinalari ro'yxatdan chiqadi (qo'lda terish shart emas);
     - davomatga mashina raqami yoziladi va keyin «12-kuni soat 12 da
       Abror kimni, qaysi raqamli mashinada uchirgan» degan savolga
       aniq javob beriladi.

   Yo'llar:
     GET    /api/school-vehicles?schoolId=...   — ro'yxat
     POST   /api/school-vehicles                — qo'shish
     PUT    /api/school-vehicles/:id            — tahrirlash
     DELETE /api/school-vehicles/:id            — o'chirish (active=false)
   ========================================================================== */

import jwt from 'jsonwebtoken';
import { pool } from '../backend/src/db.js';
import { instructorExpr } from './instructor-schema.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
const text = v => String(v === null || v === undefined ? '' : v).trim();

/* Raqam bitta ko'rinishda saqlanadi: katta harf, bitta bo'sh joy.
   Solishtirishda esa bo'sh joylar butunlay olib tashlanadi, shunda
   «01 777 AAA» va «01777AAA» bir xil raqam deb qaraladi. */
const cleanPlate = v => text(v).toUpperCase().replace(/\s+/g, ' ');
const plateKey = v => text(v).toUpperCase().replace(/[^A-Z0-9]/g, '');

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
    return String(jwt.verify(h.slice(7), JWT_SECRET).sub || '');
  } catch { return null; }
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return await new Promise(resolve => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

let schemaPromise = null;
function ensureFleetSchema() {
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    const q = async sql => {
      try { await pool.query(sql); } catch (e) { console.error('FLEET SCHEMA:', e.message); }
    };
    await q(`CREATE TABLE IF NOT EXISTS school_vehicles(
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_key TEXT NOT NULL,
      school_id TEXT NOT NULL,
      plate VARCHAR(30) NOT NULL,
      plate_key VARCHAR(30),
      model VARCHAR(120),
      instructor_id TEXT,
      notes TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await q(`CREATE INDEX IF NOT EXISTS idx_school_vehicles_school
             ON school_vehicles(owner_key, school_id, active)`);
    /* Bitta avtoshkolada bitta raqam ikki marta yozilmasin */
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS uq_school_vehicles_plate
             ON school_vehicles(owner_key, school_id, plate_key) WHERE active`);
  })().catch(e => { schemaPromise = null; throw e; });
  return schemaPromise;
}

async function list(owner, schoolId) {
  const E = await instructorExpr();
  const p = [owner];
  let where = `v.owner_key=$1 AND v.active`;
  if (schoolId) { p.push(String(schoolId)); where += ` AND v.school_id=$${p.length}`; }
  const r = await pool.query(`
    SELECT v.id, v.school_id, v.plate, v.model, v.instructor_id, v.notes, v.active, v.created_at,
           ds.name AS school_name,
           ${E.name} AS instructor_name
      FROM school_vehicles v
      LEFT JOIN driving_schools ds ON ds.id::text = v.school_id
      LEFT JOIN instructors i ON i.id::text = v.instructor_id
     WHERE ${where}
     ORDER BY LOWER(COALESCE(ds.name,'')), v.plate`, p);
  return r.rows;
}

async function save(req, res, owner, id) {
  const b = await readBody(req);
  const schoolId = text(b.schoolId || b.school_id);
  const plate = cleanPlate(b.plate || b.vehiclePlate || b.vehicle_plate);
  const model = text(b.model || b.vehicleModel || b.vehicle_model) || null;
  const instructorId = text(b.instructorId || b.instructor_id) || null;
  const notes = text(b.notes) || null;
  const active = b.active === false ? false : true;

  if (!schoolId) return json(res, 400, { error: 'Avtoshkolani tanlang' });
  if (!plate) return json(res, 400, { error: 'Avtomobil raqamini kiriting' });

  const school = await pool.query(
    `SELECT id FROM driving_schools WHERE id::text=$1 AND owner_key=$2 AND active IS NOT FALSE LIMIT 1`,
    [schoolId, owner]);
  if (!school.rows[0]) return json(res, 404, { error: 'Avtoshkola topilmadi' });

  const key = plateKey(plate);

  /* Shu avtoshkolada bunday raqam bormi? */
  const dupSql = id
    ? `SELECT id FROM school_vehicles WHERE owner_key=$1 AND school_id=$2 AND plate_key=$3 AND active AND id<>$4 LIMIT 1`
    : `SELECT id FROM school_vehicles WHERE owner_key=$1 AND school_id=$2 AND plate_key=$3 AND active LIMIT 1`;
  const dupParams = id ? [owner, schoolId, key, id] : [owner, schoolId, key];
  const dup = await pool.query(dupSql, dupParams);
  if (dup.rows[0]) return json(res, 409, { error: 'Bu raqam shu avtoshkolada allaqachon bor' });

  if (id) {
    const r = await pool.query(`
      UPDATE school_vehicles
         SET school_id=$1, plate=$2, plate_key=$3, model=$4, instructor_id=$5,
             notes=$6, active=$7, updated_at=NOW()
       WHERE id=$8 AND owner_key=$9 RETURNING id`,
      [schoolId, plate, key, model, instructorId, notes, active, id, owner]);
    if (!r.rows[0]) return json(res, 404, { error: 'Avtomobil topilmadi' });
    return json(res, 200, (await list(owner, null)).find(x => String(x.id) === String(id)) || { id });
  }

  const r = await pool.query(`
    INSERT INTO school_vehicles(owner_key, school_id, plate, plate_key, model, instructor_id, notes, active)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [owner, schoolId, plate, key, model, instructorId, notes, active]);
  const made = (await list(owner, null)).find(x => String(x.id) === String(r.rows[0].id));
  return json(res, 201, made || { id: r.rows[0].id });
}

export async function handleFleetRequest(req, res) {
  const raw = String(req.url || '');
  const pathname = raw.split('?')[0];
  if (!pathname.startsWith('/api/school-vehicles')) return false;

  const owner = auth(req);
  if (!owner) { json(res, 401, { error: 'Kirish talab qilinadi' }); return true; }

  const m = pathname.match(/^\/api\/school-vehicles\/([^/]+)$/);
  const id = m ? decodeURIComponent(m[1]) : null;
  const search = new URLSearchParams(raw.split('?')[1] || '');

  try {
    await ensureFleetSchema();

    if (req.method === 'GET' && !id) {
      json(res, 200, await list(owner, text(search.get('schoolId') || search.get('school_id'))));
      return true;
    }
    if (req.method === 'POST' && !id) { await save(req, res, owner, null); return true; }
    if ((req.method === 'PUT' || req.method === 'PATCH') && id) { await save(req, res, owner, id); return true; }
    if (req.method === 'DELETE' && id) {
      const r = await pool.query(
        `UPDATE school_vehicles SET active=false, updated_at=NOW()
          WHERE id=$1 AND owner_key=$2 RETURNING id`, [id, owner]);
      json(res, r.rows[0] ? 200 : 404, r.rows[0] ? { ok: true } : { error: 'Avtomobil topilmadi' });
      return true;
    }
    json(res, 405, { error: 'Method ruxsat etilmagan' });
    return true;
  } catch (e) {
    console.error('[fleet]', e);
    json(res, 500, { error: e.message || 'Avtomobil ro‘yxati xatosi' });
    return true;
  }
}

export default handleFleetRequest;
