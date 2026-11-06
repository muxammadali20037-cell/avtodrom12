/* ============================================================================
   SHAXSIY QR (o'quvchi kartasi) — USB skaner bilan tez davomat (06.11.2026)

   Rahbar: «hozir QR'siz chiqaramiz. Skaner olgandan keyin birinchi chekda
   QR chiqsin, keyin o'sha QR urilsa oddiy chek chiqsin. Hozircha sozlab
   tayyor qilib qo'y.»

   Shuning uchun sozlama boshida O'CHIQ — cheklar avvalgidek chiqadi.
   Yoqilgach:
     · o'quvchiga birinchi marta chek chiqqanda chekning tagida uning
       shaxsiy QR kodi chiqadi (card_issued_at belgilanadi);
     · keyingi safar o'sha QR skanerga urilsa — o'quvchi o'zi topiladi
       va oddiy (QR'siz) chek chiqadi.

   Kod — faqat raqam: «77» + 8 ta tasodifiy raqam. Skaner klaviatura
   bo'lib yozadi; kompyuterda rus/o'zbek (kirill) tartibi yoqilgan bo'lsa
   harflar buzilib ketadi, raqamlar esa hech qachon buzilmaydi.

     GET  /api/card/settings   { enabled, issued }
     POST /api/card/settings   { enabled }              (Maxsus)
     POST /api/card/issue      { studentId }  → { card_no }
     GET  /api/card/lookup?no=7712345678     → { student }
   ========================================================================== */

import jwt from 'jsonwebtoken';
import { randomInt } from 'node:crypto';
import { pool } from '../backend/src/db.js';
import { runOnce, ddl } from '../backend/src/schema-once.js';
import { maxsusOk, lockedResponse } from './lock-routes.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
export const CARD_RE = /^77\d{8}$/;

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
    return p && p.sub && String(p.sub) !== 'admin' ? { sub: String(p.sub) } : null;
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
export function ensureCardSchema() {
  if (schemaP) return schemaP;
  schemaP = runOnce('student-card-v1', async () => {
    await ddl(`ALTER TABLE students ADD COLUMN IF NOT EXISTS card_no TEXT`);
    await ddl(`ALTER TABLE students ADD COLUMN IF NOT EXISTS card_issued_at TIMESTAMPTZ`);
    await ddl(`CREATE UNIQUE INDEX IF NOT EXISTS students_card_no_key ON students(card_no) WHERE card_no IS NOT NULL`);
    await pool.query(`CREATE TABLE IF NOT EXISTS app_settings(
      key TEXT PRIMARY KEY, value JSONB NOT NULL DEFAULT '{}'::jsonb, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  }).catch(e => { schemaP = null; throw e; });
  return schemaP;
}

const settingKey = sub => 'card:' + sub;
async function readEnabled(sub) {
  const r = await pool.query(`SELECT value FROM app_settings WHERE key = $1`, [settingKey(sub)]);
  return !!(r.rows[0] && r.rows[0].value && r.rows[0].value.enabled);
}

const pickStudent = `SELECT st.id, st.full_name, st.school_id, st.group_id, st.card_no, st.card_issued_at,
    COALESCE(st.attendance_count,0)::int AS attendance_count, s.name AS school_name, g.name AS group_name
  FROM students st LEFT JOIN driving_schools s ON s.id = st.school_id LEFT JOIN school_groups g ON g.id = st.group_id`;

export async function handleCardRequest(req, res) {
  const path = String(req.url || '').split('?', 1)[0];
  if (!path.startsWith('/api/card/')) return false;
  const u = userOf(req);
  if (!u) { json(res, 401, { error: 'Kirish talab qilinadi' }); return true; }
  try {
    await ensureCardSchema();

    if (path === '/api/card/settings' && req.method === 'GET') {
      const issued = await pool.query(`SELECT COUNT(*)::int n FROM students WHERE owner_key = $1 AND active = true AND card_issued_at IS NOT NULL`, [u.sub]);
      json(res, 200, { enabled: await readEnabled(u.sub), issued: issued.rows[0].n });
      return true;
    }

    if (path === '/api/card/settings' && req.method === 'POST') {
      if (!maxsusOk(req, u.sub)) { lockedResponse(res); return true; }
      const b = await readBody(req);
      const enabled = b.enabled === true;
      await pool.query(`INSERT INTO app_settings(key, value) VALUES($1, $2)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [settingKey(u.sub), JSON.stringify({ enabled })]);
      json(res, 200, { ok: true, enabled });
      return true;
    }

    /* Chekka QR chiqarilyapti — raqam bo'lmasa beriladi, «berildi» vaqti
       yangilanadi (qayta chiqarishda ham o'sha raqam). */
    if (path === '/api/card/issue' && req.method === 'POST') {
      const b = await readBody(req);
      const id = String(b.studentId || b.student_id || '').trim();
      if (!/^[0-9a-f-]{36}$/i.test(id)) { json(res, 400, { error: 'O‘quvchi tanlanmagan' }); return true; }
      for (let i = 0; i < 6; i++) {
        const no = '77' + String(randomInt(0, 1e8)).padStart(8, '0');
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          /* Bu texnik belgi — boshliqning «Tahrirlanganlar» jurnaliga
             (api/edits-log.js) tahrir bo'lib tushmasin */
          await c.query(`SELECT set_config('avtodrom.audit_off', '1', true)`);
          const r = await c.query(`UPDATE students SET card_no = COALESCE(card_no, $3), card_issued_at = now()
              WHERE id = $1 AND owner_key = $2 AND active = true
              RETURNING id, card_no, card_issued_at`, [id, u.sub, no]);
          await c.query('COMMIT');
          if (!r.rows.length) { json(res, 404, { error: 'O‘quvchi topilmadi' }); return true; }
          json(res, 200, { ok: true, student_id: r.rows[0].id, card_no: r.rows[0].card_no, card_issued_at: r.rows[0].card_issued_at });
          return true;
        } catch (e) {
          try { await c.query('ROLLBACK'); } catch { /* noop */ }
          if (e && e.code === '23505') continue;          /* raqam band — boshqasi */
          throw e;
        } finally { c.release(); }
      }
      json(res, 500, { error: 'QR raqami berilmadi — qayta urinib ko‘ring' });
      return true;
    }

    if (path === '/api/card/lookup' && req.method === 'GET') {
      const no = String(new URL(req.url, 'http://x').searchParams.get('no') || '').replace(/\D/g, '');
      if (!CARD_RE.test(no)) { json(res, 400, { error: 'Bu shaxsiy QR emas' }); return true; }
      const r = await pool.query(pickStudent + ` WHERE st.card_no = $1 AND st.owner_key = $2 AND st.active = true`, [no, u.sub]);
      if (!r.rows.length) { json(res, 404, { error: 'Bu QR bo‘yicha o‘quvchi topilmadi' }); return true; }
      json(res, 200, { student: r.rows[0] });
      return true;
    }

    json(res, 404, { error: 'Topilmadi' });
    return true;
  } catch (e) {
    console.error('CARD ERROR:', e);
    json(res, 500, { error: e.message || 'Xatolik' });
    return true;
  }
}
