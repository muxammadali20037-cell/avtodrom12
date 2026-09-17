/* ============================================================================
   INSTRUKTOR TARIXI  —  GET /api/instructors/:id/daily?date=&from=&to=

   Savol: «12-sentabr kuni soat 12 da Abror ismli instruktor kimni
   uchirgan va qaysi raqamli mashinada?» Javob shu yerdan chiqadi.
   Avtoshkola o'quvchilari (davomat) ham, oddiy mijozlar (chastniy) ham
   bir ro'yxatda ko'rinadi.

   Avval bu fayl ishlamasdi:
     - `s.avtodrom_instructor_id` ustunidan qidirardi, ilova esa
       `s.instructor_id` ga yozadi — natija doim bo'sh chiqardi;
     - `JOIN vehicles` ichki birlashma edi, davomat yozuvlarida esa
       mashina bo'lmasligi mumkin — ular butunlay tushib qolardi.

   Instruktor UCH yo'l bilan topiladi (biri ishlamasa — keyingisi):
     1) sessions.instructor_id
     2) sessions.instructor_name (ism bo'yicha, katta-kichik harfsiz)
     3) avtomobil raqami (instruktorga biriktirilgan raqam)
   ========================================================================== */

import jwt from 'jsonwebtoken';
import { pool } from '../backend/src/db.js';
import { instructorExpr } from './instructor-schema.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
const text = v => String(v === null || v === undefined ? '' : v).trim();
const plateKey = v => text(v).toUpperCase().replace(/[^A-Z0-9]/g, '');
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

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'GET') return json(res, 405, { error: 'Method ruxsat etilmagan' });

  const user = auth(req);
  if (!user) return json(res, 401, { error: 'Kirish talab qilinadi' });

  try {
    const url = new URL(req.url, 'http://localhost');
    const id = text(req.query?.id || url.searchParams.get('id'));
    if (!id) return json(res, 400, { error: 'Instruktor ID kerak' });

    const one = text(req.query?.date || url.searchParams.get('date'));
    let from = text(url.searchParams.get('from'));
    let to = text(url.searchParams.get('to'));
    if (!isDate(from)) from = isDate(one) ? one : new Date().toISOString().slice(0, 10);
    if (!isDate(to)) to = from;
    if (to < from) { const t = from; from = to; to = t; }

    const E = await instructorExpr();
    const ir = await pool.query(`
      SELECT i.id, ${E.name} AS full_name, i.active,
             ${E.plate} AS vehicle_plate,
             ${E.model} AS vehicle_model,
             ${E.school} AS school_id,
             ds.name AS school_name,
             ${E.phone} AS phone
        FROM public.instructors i
        LEFT JOIN public.driving_schools ds
               ON ds.id::text = ${E.school} AND ds.owner_key = $1
       WHERE i.id::text = $2 AND ${E.owner} = $1
       LIMIT 1`, [user, id]);

    if (!ir.rows[0]) return json(res, 404, { error: 'Instruktor topilmadi' });
    const inst = ir.rows[0];
    const key = plateKey(inst.vehicle_plate);
    const name = text(inst.full_name).toLowerCase();

    const r = await pool.query(`
      SELECT s.id, s.started_at, s.finished_at,
             COALESCE(s.duration_seconds,0)::int AS duration_seconds,
             COALESCE(s.lessons_counted,0)::int  AS lessons_counted,
             COALESCE(s.amount,0)::numeric       AS amount,
             COALESCE(s.cash_amount,0)::numeric  AS cash_amount,
             COALESCE(s.terminal_amount,0)::numeric AS terminal_amount,
             s.status, s.payment_method,
             COALESCE(s.customer_type, CASE WHEN s.student_id IS NOT NULL THEN 'school' ELSE 'ordinary' END) AS customer_type,
             v.plate, v.model,
             COALESCE(s.driver_name, v.driver_name) AS driver_name,
             st.full_name AS student_name,
             ds.name AS school_name, g.name AS group_name
        FROM public.sessions s
        LEFT JOIN public.vehicles v       ON v.id = s.vehicle_id
        LEFT JOIN public.students st      ON st.id::text = s.student_id::text
        LEFT JOIN public.driving_schools ds ON ds.id::text = s.school_id::text
        LEFT JOIN public.school_groups g  ON g.id::text = s.group_id::text
       WHERE s.user_id = $1
         AND COALESCE(s.status,'completed') <> 'cancelled'
         AND s.started_at >= $2::date
         AND s.started_at <  ($3::date + INTERVAL '1 day')
         AND (
              s.instructor_id::text = $4
           OR ($5 <> '' AND LOWER(TRIM(COALESCE(s.instructor_name,''))) = $5)
           OR ($6 <> '' AND REGEXP_REPLACE(UPPER(COALESCE(v.plate,'')), '[^A-Z0-9]', '', 'g') = $6)
         )
       ORDER BY s.started_at DESC`,
      [user, from, to, id, name, key]);

    const rows = r.rows.map(x => ({
      ...x,
      amount: Number(x.amount || 0),
      cash_amount: Number(x.cash_amount || 0),
      terminal_amount: Number(x.terminal_amount || 0),
      duration_seconds: Number(x.duration_seconds || 0),
      /* Davomatda «1 soat = 1 dars»; eski yozuvlarda lessons_counted
         bo'lmasligi mumkin — o'shanda vaqtdan hisoblanadi. */
      lessons: Number(x.lessons_counted) > 0
        ? Number(x.lessons_counted)
        : Math.max(1, Math.round(Number(x.duration_seconds || 0) / 3600))
    }));

    const school = rows.filter(x => x.customer_type === 'school');
    const priv = rows.filter(x => x.customer_type !== 'school');
    const summary = {
      total: rows.length,
      students: school.length,
      private: priv.length,
      school_lessons: school.reduce((a, x) => a + x.lessons, 0),
      private_hours: priv.reduce((a, x) => a + x.lessons, 0),
      total_minutes: Math.round(rows.reduce((a, x) => a + x.duration_seconds, 0) / 60),
      total_amount: rows.reduce((a, x) => a + x.amount, 0)
    };

    return json(res, 200, { date: from, from, to, instructor: inst, summary, rows });
  } catch (e) {
    console.error('INSTRUCTOR DAILY ERROR:', e);
    return json(res, 500, { error: e.message || 'Instruktor hisoboti xatosi' });
  }
}
