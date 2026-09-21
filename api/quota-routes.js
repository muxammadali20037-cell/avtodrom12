/* ============================================================================
   SHARTNOMA LIMITI — «bepul kirishlar»

   Avtodrom avtoshkolalar bilan shartnoma tuzadi: har bir o'quvchi
   shartnomada ko'rsatilgan sondagi (odatda 6 yoki 9) darsni BEPUL
   uchadi. Undan ortig'i uchun avtodromga to'lov qilinadi (soatiga
   sozlamalardagi narx bo'yicha).

   Ilgari tizimda bu qoida UMUMAN yo'q edi: «6-11 nazorat» degan
   rangli yorliq bor edi, lekin u shunchaki bo'yoq — hech narsani
   hisoblamas va hech qayerga yozilmasdi. Natijada limitdan oshib
   ketgan bepul kirishlar ko'rinmas va puli olinmay qolardi.

   Endi:
     - har avtoshkolaga o'z limiti kiritiladi (driving_schools.free_visits);
     - davomat yozilganda o'quvchining nechinchi kirishi ekani
       (sessions.visit_index) va shundan nechtasi limitdan oshgani
       (sessions.over_lessons) o'sha qatorning o'ziga yoziladi;
     - kassada o'quvchi tanlanishi bilan «necha bepul qoldi» ko'rinadi;
     - nazoratda «to'lov kerak edi» degan summa chiqadi.

   Limit o'quvchiga JAMI beriladi (oyiga emas): masalan 9 ta bepul
   kirish, 10-chisidan boshlab to'lov.

   Hisob AVTODROMNING O'Z yozuvlaridan olinadi (sessions), avtoshkola
   qog'ozidagi dars sonidan emas — chunki shartnoma avtodromga kirish
   haqida, avtoshkoladagi mashg'ulot haqida emas.

   Yo'llar:
     GET /api/quota?studentId=...        — bitta o'quvchi holati
     GET /api/quota/over?from=&to=       — limitdan oshgan kirishlar
   ========================================================================== */

import jwt from 'jsonwebtoken';
import { pool } from '../backend/src/db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';

/* Shartnomada limit ko'rsatilmagan bo'lsa shu qiymat ishlatiladi */
export const DEFAULT_FREE_VISITS = 9;

const text = v => String(v === null || v === undefined ? '' : v).trim();
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const intOrNull = v => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
};

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

/* -------------------------------------------------------------------------
   Sxema. Ustunlar yo'q bo'lsa qo'shiladi — eski bazani buzmaydi.
   ------------------------------------------------------------------------- */
let schemaPromise = null;
export function ensureQuotaSchema() {
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    const q = async sql => {
      try { await pool.query(sql); } catch (e) { console.error('QUOTA SCHEMA:', e.message); }
    };
    /* Shartnomadagi bepul kirishlar soni. NULL = umumiy standart. */
    await q(`ALTER TABLE driving_schools ADD COLUMN IF NOT EXISTS free_visits INTEGER`);
    /* O'quvchining nechinchi kirishi (shu qatordagi oxirgi dars bo'yicha) */
    await q(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS visit_index INTEGER`);
    /* Shu qatordagi darslardan nechtasi limitdan oshgan */
    await q(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS over_lessons INTEGER`);
    await q(`CREATE INDEX IF NOT EXISTS idx_sessions_student_quota
             ON sessions(user_id, student_id) WHERE student_id IS NOT NULL`);
  })().catch(e => { schemaPromise = null; throw e; });
  return schemaPromise;
}

/* -------------------------------------------------------------------------
   Bitta o'quvchi bo'yicha hisob
   ------------------------------------------------------------------------- */

/* Shu o'quvchining avtodromdagi bepul (avtoshkola) darslari soni.
   `client` berilsa o'sha tranzaksiya ichida hisoblanadi. */
export async function usedVisits(db, owner, studentId) {
  const r = await db.query(
    `SELECT COALESCE(SUM(GREATEST(COALESCE(lessons_counted,1), 1)), 0)::int AS used
       FROM sessions
      WHERE user_id::text = $1
        AND student_id::text = $2
        AND COALESCE(customer_type, 'school') = 'school'
        AND COALESCE(status, 'completed') <> 'cancelled'`,
    [String(owner), String(studentId)]);
  return Number(r.rows[0]?.used || 0);
}

/* Shu o'quvchi avtoshkolasining limiti */
export async function freeLimitFor(db, owner, studentId) {
  const r = await db.query(
    `SELECT ds.id, ds.name, ds.free_visits
       FROM students st
       JOIN driving_schools ds ON ds.id = st.school_id
      WHERE st.id::text = $1
      LIMIT 1`, [String(studentId)]);
  const row = r.rows[0] || {};
  const lim = intOrNull(row.free_visits);
  return {
    schoolId: row.id || null,
    schoolName: row.name || '',
    limit: lim === null ? DEFAULT_FREE_VISITS : lim,
    explicit: lim !== null
  };
}

/* Kassada ko'rsatish uchun to'liq holat */
export async function quotaState(db, owner, studentId) {
  await ensureQuotaSchema();
  const [used, lim] = await Promise.all([
    usedVisits(db, owner, studentId),
    freeLimitFor(db, owner, studentId)
  ]);
  const left = Math.max(0, lim.limit - used);
  return {
    studentId: String(studentId),
    schoolId: lim.schoolId,
    schoolName: lim.schoolName,
    used: used,
    limit: lim.limit,
    left: left,
    over: Math.max(0, used - lim.limit),
    exhausted: left <= 0,
    explicit: lim.explicit
  };
}

/* Davomat yozilayotganda chaqiriladi.
   `lessons` — shu safar yoziladigan darslar soni.
   Qaytaradi: shu qatorga yoziladigan qiymatlar va ogohlantirish uchun holat. */
export async function quotaForInsert(db, owner, studentId, lessons) {
  const n = Math.max(1, Number(lessons) || 1);
  const st = await quotaState(db, owner, studentId);
  const visitIndex = st.used + n;
  /* Shu qatordagi darslardan nechtasi limitdan oshdi */
  const overLessons = Math.max(0, Math.min(n, visitIndex - st.limit));
  return {
    visitIndex: visitIndex,
    overLessons: overLessons,
    usedBefore: st.used,
    limit: st.limit,
    leftAfter: Math.max(0, st.limit - visitIndex),
    schoolName: st.schoolName,
    warn: overLessons > 0
  };
}

/* -------------------------------------------------------------------------
   Limitdan oshgan kirishlar ro'yxati (nazorat uchun)
   ------------------------------------------------------------------------- */
async function hourlyRate(owner) {
  try {
    const r = await pool.query(
      `SELECT hourly_rate FROM user_settings WHERE user_id::text = $1 LIMIT 1`, [String(owner)]);
    const v = Number(r.rows[0]?.hourly_rate || 0);
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch { return 0; }
}

async function overList(req, res, owner) {
  await ensureQuotaSchema();
  const url = new URL(req.url, 'http://localhost');
  let from = text(url.searchParams.get('from') || url.searchParams.get('date'));
  let to = text(url.searchParams.get('to'));
  if (!isDate(from)) from = new Date().toISOString().slice(0, 10);
  if (!isDate(to)) to = from;
  if (to < from) { const t = from; from = to; to = t; }

  const rate = await hourlyRate(owner);

  const r = await pool.query(`
    SELECT s.id, s.started_at, s.visit_index, s.over_lessons,
           COALESCE(s.lessons_counted, 1)::int AS lessons,
           st.full_name AS student_name,
           ds.name AS school_name,
           g.name  AS group_name,
           COALESCE(s.instructor_name, '') AS instructor_name,
           COALESCE(ds.free_visits, $4)::int AS free_limit
      FROM sessions s
      LEFT JOIN students st        ON st.id::text = s.student_id::text
      LEFT JOIN driving_schools ds ON ds.id::text = s.school_id::text
      LEFT JOIN school_groups g    ON g.id::text  = s.group_id::text
     WHERE s.user_id::text = $1
       AND COALESCE(s.over_lessons, 0) > 0
       AND COALESCE(s.status, 'completed') <> 'cancelled'
       AND s.started_at >= $2::date
       AND s.started_at <  ($3::date + INTERVAL '1 day')
     ORDER BY s.started_at DESC`,
    [String(owner), from, to, DEFAULT_FREE_VISITS]);

  const rows = r.rows.map(x => ({
    ...x,
    over_lessons: Number(x.over_lessons || 0),
    lessons: Number(x.lessons || 0),
    visit_index: Number(x.visit_index || 0),
    due: Number(x.over_lessons || 0) * rate
  }));

  const summary = rows.reduce((a, x) => {
    a.rows += 1;
    a.overLessons += x.over_lessons;
    a.due += x.due;
    a.students[String(x.student_name || x.id)] = 1;
    return a;
  }, { rows: 0, overLessons: 0, due: 0, students: {} });
  summary.students = Object.keys(summary.students).length;

  return json(res, 200, { from, to, hourlyRate: rate, summary, rows });
}

/* -------------------------------------------------------------------------
   Yo'naltirgich
   ------------------------------------------------------------------------- */
export async function handleQuotaRequest(req, res) {
  const path = String(req.url || '').split('?', 1)[0];
  if (path !== '/api/quota' && path !== '/api/quota/over') return false;

  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return true; }
  if (req.method !== 'GET') { json(res, 405, { error: 'Method ruxsat etilmagan' }); return true; }

  const owner = auth(req);
  if (!owner) { json(res, 401, { error: 'Kirish talab qilinadi' }); return true; }

  try {
    if (path === '/api/quota/over') { await overList(req, res, owner); return true; }

    const url = new URL(req.url, 'http://localhost');
    const studentId = text(url.searchParams.get('studentId') || url.searchParams.get('student_id'));
    if (!studentId) { json(res, 400, { error: "O'quvchi ID kerak" }); return true; }
    json(res, 200, await quotaState(pool, owner, studentId));
    return true;
  } catch (e) {
    console.error('QUOTA ERROR:', e);
    json(res, 500, { error: e.message || 'Limit hisobida xatolik' });
    return true;
  }
}
