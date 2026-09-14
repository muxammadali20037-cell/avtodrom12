/* ============================================================================
   NAZORAT — «Xatoliklar va aniqliklar»

   MUAMMO
   Chastniy (oddiy) instruktor avtodromga o'quvchilarini olib keladi va
   operatordan vaqt ochishni so'raydi: «menga 2 soat ochib yubor». Pulni
   ham shu 2 soatga to'laydi. Lekin aslida o'sha kuni unga 3 ta o'quvchi
   kelib, har biri 1 soatdan uchgan bo'lishi mumkin — ya'ni 3 soat.
   1 soatlik farq hisobdan tushib qoladi.

   YECHIM
   Kun bo'yicha har bir instruktor uchun ikkita son solishtiriladi:

     1) OCHILGAN SOAT  — instruktor uchun ochilgan (va to'langan) vaqt.
        Manba: oddiy mijoz sessiyalari (customer_type <> 'school').

     2) DAVOMAT SOATI  — o'sha instruktor bilan uchgan o'quvchilar darsi.
        Manba: avtoshkola davomati (customer_type = 'school'),
        har bir yozuv = 1 dars = 1 soat.

   Farq = davomat - ochilgan.
     farq > 0  -> KAM OCHILGAN (pul yetmagan)   — qizil
     farq < 0  -> ORTIQCHA OCHILGAN             — sariq
     farq = 0  -> to'g'ri                        — yashil

   Instruktor UCH yo'l bilan topiladi (biri ishlamasa — keyingisi):
     a) sessions.instructor_id
     b) sessions.instructor_name (ism bo'yicha bazadagi instruktor)
     c) avtomobil raqami (vehicles.plate = instructors.plate)

   Instruktor umuman aniqlanmagan yozuvlar alohida «Instruktor
   ko'rsatilmagan» qatoriga yig'iladi — bu «aniqliklar» qismi.
   ========================================================================== */

import jwt from 'jsonwebtoken';
import { pool } from '../backend/src/db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
const LESSON_SECONDS = 3600;

function tokenOf(req) {
  try {
    const h = req.headers?.authorization || '';
    if (!h.startsWith('Bearer ')) return null;
    return jwt.verify(h.slice(7), JWT_SECRET);
  } catch { return null; }
}

function send(res, code, data) {
  if (!res.headersSent) {
    res.statusCode = code;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
  }
  res.end(JSON.stringify(data));
}

/* Har bir o'rnatmada ustunlar to'plami har xil bo'lishi mumkin.
   Yo'q ustunni SQL ga qo'shsak butun so'rov yiqiladi — shuning uchun
   avval tekshirib, yo'qlari o'rniga NULL qo'yamiz. */
let colsCache = null;
async function sessionCols() {
  if (colsCache) return colsCache;
  const r = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='sessions'`);
  colsCache = new Set(r.rows.map(x => x.column_name));
  return colsCache;
}
const col = (cols, name, fallback) => (cols.has(name) ? `s.${name}` : fallback);

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

async function discrepancies(req, res, userId, search) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(search.get('date') || '')
    ? search.get('date') : todayISO();

  const cols = await sessionCols();

  const cCustomer  = col(cols, 'customer_type',    `NULL::text`);
  const cInsId     = col(cols, 'instructor_id',    `NULL::text`);
  const cInsName   = col(cols, 'instructor_name',  `NULL::text`);
  const cTarget    = col(cols, 'target_duration',  `NULL::int`);
  const cLessons   = col(cols, 'lessons_counted',  `NULL::int`);
  const cStudent   = col(cols, 'student_id',       `NULL::text`);
  const cDuration  = col(cols, 'duration_seconds', `0`);
  const cAmount    = col(cols, 'amount',           `0`);
  const cCash      = col(cols, 'cash_amount',      `0`);
  const cTerm      = col(cols, 'terminal_amount',  `0`);

  /* norm — kunlik barcha sessiyalar, instruktori aniqlangan holda */
  const sql = `
    WITH norm AS (
      SELECT
        s.id,
        s.status,
        s.started_at,
        COALESCE(${cCustomer}, 'regular')                       AS customer_type,
        NULLIF(TRIM(COALESCE(${cInsName}, '')), '')             AS ins_name_raw,
        COALESCE(${cDuration}, 0)::int                          AS duration_seconds,
        COALESCE(${cTarget}, 0)::int                            AS target_duration,
        COALESCE(${cLessons}, 0)::int                           AS lessons_counted,
        NULLIF(${cStudent}::text, '')                           AS student_id,
        COALESCE(${cAmount}, 0)::numeric                        AS amount,
        COALESCE(${cCash}, 0)::numeric                          AS cash_amount,
        COALESCE(${cTerm}, 0)::numeric                          AS terminal_amount,
        COALESCE(
          NULLIF(${cInsId}::text, ''),
          (SELECT i.id::text FROM instructors i
            WHERE i.owner_key = $3
              AND LOWER(TRIM(COALESCE(i.full_name,''))) = LOWER(TRIM(COALESCE(${cInsName}, '')))
              AND NULLIF(TRIM(COALESCE(${cInsName}, '')), '') IS NOT NULL
            ORDER BY i.created_at NULLS LAST LIMIT 1),
          (SELECT i.id::text FROM instructors i
            JOIN vehicles v ON v.id = s.vehicle_id
            WHERE i.owner_key = $3
              AND NULLIF(TRIM(COALESCE(i.plate,'')), '') IS NOT NULL
              AND REPLACE(UPPER(TRIM(i.plate)), ' ', '') = REPLACE(UPPER(TRIM(COALESCE(v.plate,''))), ' ', '')
            ORDER BY i.created_at NULLS LAST LIMIT 1)
        ) AS ins_id
      FROM sessions s
      WHERE s.user_id = $1
        AND s.started_at::date = $2::date
        AND COALESCE(s.status, 'completed') <> 'cancelled'
    ),
    keyed AS (
      SELECT n.*,
             COALESCE(n.ins_id, CASE WHEN n.ins_name_raw IS NOT NULL
                                     THEN 'name:' || LOWER(n.ins_name_raw) END, 'none') AS k
      FROM norm n
    ),
    opened AS (
      SELECT k,
             COUNT(*)::int AS opened_sessions,
             SUM(GREATEST(1, CEIL(
               NULLIF(GREATEST(target_duration, duration_seconds), 0)::numeric / ${LESSON_SECONDS}
             )))::int AS opened_hours,
             SUM(amount)::numeric  AS amount,
             SUM(cash_amount)::numeric AS cash_amount,
             SUM(terminal_amount)::numeric AS terminal_amount
        FROM keyed
       WHERE customer_type <> 'school'
       GROUP BY k
    ),
    att AS (
      SELECT k,
             SUM(GREATEST(1, lessons_counted))::int AS lesson_hours,
             COUNT(*)::int AS attendance_rows,
             COUNT(DISTINCT student_id)::int AS students
        FROM keyed
       WHERE customer_type = 'school'
       GROUP BY k
    ),
    merged AS (
      SELECT COALESCE(o.k, a.k) AS k,
             COALESCE(o.opened_sessions, 0) AS opened_sessions,
             COALESCE(o.opened_hours, 0)    AS opened_hours,
             COALESCE(o.amount, 0)          AS amount,
             COALESCE(o.cash_amount, 0)     AS cash_amount,
             COALESCE(o.terminal_amount, 0) AS terminal_amount,
             COALESCE(a.lesson_hours, 0)    AS lesson_hours,
             COALESCE(a.attendance_rows, 0) AS attendance_rows,
             COALESCE(a.students, 0)        AS students
        FROM opened o
        FULL OUTER JOIN att a ON a.k = o.k
    )
    SELECT m.*,
           COALESCE(i.full_name,
                    (SELECT MAX(kk.ins_name_raw) FROM keyed kk WHERE kk.k = m.k)) AS instructor_name,
           i.id::text  AS instructor_id,
           i.phone     AS instructor_phone,
           i.plate     AS instructor_plate,
           (m.lesson_hours - m.opened_hours) AS diff
      FROM merged m
      LEFT JOIN instructors i
             ON i.id::text = m.k AND i.owner_key = $3
     ORDER BY (m.lesson_hours - m.opened_hours) DESC,
              COALESCE(i.full_name, '') ASC`;

  const owner = String(req.__ownerKey || userId);
  const r = await pool.query(sql, [userId, date, owner]);

  const rows = r.rows.map(x => {
    const opened = Number(x.opened_hours) || 0;
    const lessons = Number(x.lesson_hours) || 0;
    const diff = lessons - opened;
    const unknown = x.k === 'none';
    return {
      key: x.k,
      instructorId: x.instructor_id || null,
      instructorName: unknown ? null : (x.instructor_name || null),
      phone: x.instructor_phone || null,
      plate: x.instructor_plate || null,
      unknown,
      openedSessions: Number(x.opened_sessions) || 0,
      openedHours: opened,
      lessonHours: lessons,
      attendanceRows: Number(x.attendance_rows) || 0,
      students: Number(x.students) || 0,
      amount: Number(x.amount) || 0,
      cashAmount: Number(x.cash_amount) || 0,
      terminalAmount: Number(x.terminal_amount) || 0,
      diff,
      /* under  — kam ochilgan (pul yetmagan), asosiy xatolik
         over   — ortiqcha ochilgan
         ok     — mos
         info   — faqat aniqlik kiritish kerak (instruktor noma'lum) */
      state: unknown ? 'info' : (diff > 0 ? 'under' : diff < 0 ? 'over' : 'ok')
    };
  });

  /* Bir soatning narxi — kam to'langan pulni taxminlash uchun */
  let hourlyRate = 0;
  try {
    const s = await pool.query(
      `SELECT hourly_rate FROM user_settings WHERE user_id=$1`, [userId]);
    hourlyRate = Number(s.rows[0]?.hourly_rate || 0);
  } catch { /* sozlama bo'lmasa 0 */ }

  const summary = rows.reduce((a, x) => {
    a.openedHours += x.openedHours;
    a.lessonHours += x.lessonHours;
    a.students += x.students;
    a.amount += x.amount;
    if (x.state === 'under') { a.underCount++; a.underHours += x.diff; }
    if (x.state === 'over')  { a.overCount++;  a.overHours  += -x.diff; }
    if (x.state === 'ok')    a.okCount++;
    if (x.state === 'info')  { a.unknownCount++; a.unknownHours += x.lessonHours; }
    return a;
  }, { openedHours: 0, lessonHours: 0, students: 0, amount: 0,
       underCount: 0, underHours: 0, overCount: 0, overHours: 0,
       okCount: 0, unknownCount: 0, unknownHours: 0 });

  summary.hourlyRate = hourlyRate;
  summary.missingAmount = summary.underHours * hourlyRate;

  send(res, 200, { date, hourlyRate, summary, rows });
  return true;
}

/* Bitta instruktorning kun kesimidagi barcha yozuvlari — «tafsilot» */
async function details(req, res, userId, search) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(search.get('date') || '')
    ? search.get('date') : todayISO();
  const key = String(search.get('key') || '').trim();
  if (!key) { send(res, 400, { error: 'Instruktor kaliti kerak' }); return true; }

  const cols = await sessionCols();
  const cCustomer = col(cols, 'customer_type',   `NULL::text`);
  const cInsId    = col(cols, 'instructor_id',   `NULL::text`);
  const cInsName  = col(cols, 'instructor_name', `NULL::text`);
  const cTarget   = col(cols, 'target_duration', `NULL::int`);
  const cLessons  = col(cols, 'lessons_counted', `NULL::int`);
  const cStudent  = col(cols, 'student_id',      `NULL::text`);
  const cDriver   = col(cols, 'driver_name',     `NULL::text`);
  const owner = String(req.__ownerKey || userId);

  const sql = `
    WITH norm AS (
      SELECT s.id, s.status, s.started_at, s.finished_at,
             COALESCE(s.duration_seconds,0)::int AS duration_seconds,
             COALESCE(${cTarget},0)::int  AS target_duration,
             COALESCE(${cLessons},0)::int AS lessons_counted,
             COALESCE(${cCustomer},'regular') AS customer_type,
             NULLIF(TRIM(COALESCE(${cInsName},'')),'') AS ins_name_raw,
             NULLIF(${cStudent}::text,'') AS student_id,
             ${cDriver} AS driver_name,
             v.plate AS plate,
             COALESCE(
               NULLIF(${cInsId}::text,''),
               (SELECT i.id::text FROM instructors i
                 WHERE i.owner_key=$3
                   AND LOWER(TRIM(COALESCE(i.full_name,''))) = LOWER(TRIM(COALESCE(${cInsName},'')))
                   AND NULLIF(TRIM(COALESCE(${cInsName},'')),'') IS NOT NULL
                 ORDER BY i.created_at NULLS LAST LIMIT 1),
               (SELECT i.id::text FROM instructors i
                 WHERE i.owner_key=$3
                   AND NULLIF(TRIM(COALESCE(i.plate,'')),'') IS NOT NULL
                   AND REPLACE(UPPER(TRIM(i.plate)),' ','') = REPLACE(UPPER(TRIM(COALESCE(v.plate,''))),' ','')
                 ORDER BY i.created_at NULLS LAST LIMIT 1)
             ) AS ins_id
        FROM sessions s
        LEFT JOIN vehicles v ON v.id = s.vehicle_id
       WHERE s.user_id=$1 AND s.started_at::date=$2::date
         AND COALESCE(s.status,'completed') <> 'cancelled'
    )
    SELECT n.*, st.full_name AS student_name
      FROM norm n
      LEFT JOIN students st ON st.id::text = n.student_id
     WHERE COALESCE(n.ins_id,
             CASE WHEN n.ins_name_raw IS NOT NULL THEN 'name:'||LOWER(n.ins_name_raw) END,
             'none') = $4
     ORDER BY n.started_at`;

  const r = await pool.query(sql, [userId, date, owner, key]);
  send(res, 200, { date, key, rows: r.rows });
  return true;
}

export async function handleControlRequest(req, res) {
  const raw = String(req.url || '');
  const pathname = raw.split('?')[0];
  if (!pathname.startsWith('/api/control/')) return false;

  const token = tokenOf(req);
  if (!token) { send(res, 401, { error: 'Kirish talab qilinadi' }); return true; }
  const userId = String(token.sub);
  req.__ownerKey = String(process.env.WORKSPACE_OWNER_ID || token.owner || token.sub);

  const search = new URLSearchParams(raw.split('?')[1] || '');

  try {
    if (req.method === 'GET' && pathname === '/api/control/discrepancies') {
      return await discrepancies(req, res, userId, search);
    }
    if (req.method === 'GET' && pathname === '/api/control/details') {
      return await details(req, res, userId, search);
    }
  } catch (e) {
    console.error('[control]', e);
    send(res, 500, { error: e.message || 'Nazorat hisobotini olishda xatolik' });
    return true;
  }
  return false;
}

export default handleControlRequest;
