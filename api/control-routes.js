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
import { instructorExpr } from './instructor-schema.js';

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
  const E = await instructorExpr();

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
            WHERE ${E.owner} = $3
              AND LOWER(TRIM(COALESCE(${E.name},''))) = LOWER(TRIM(COALESCE(${cInsName}, '')))
              AND NULLIF(TRIM(COALESCE(${cInsName}, '')), '') IS NOT NULL
            ORDER BY i.created_at NULLS LAST LIMIT 1),
          (SELECT i.id::text FROM instructors i
            JOIN vehicles v ON v.id = s.vehicle_id
            WHERE ${E.owner} = $3
              AND ${E.plate} IS NOT NULL
              AND REGEXP_REPLACE(UPPER(${E.plate}), '[^A-Z0-9]', '', 'g')
                = REGEXP_REPLACE(UPPER(COALESCE(v.plate,'')), '[^A-Z0-9]', '', 'g')
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
    /* PLATNIY — oddiy mijoz bo'lib kelganlar. Pul shular uchun olinadi.
       Yakunlanmagan (jarayondagi) sessiya uchun pul hali to'lanmagan,
       shuning uchun «to'lashi kerak» faqat yakunlanganlari bo'yicha
       hisoblanadi, jarayondagisi alohida ko'rsatiladi. */
    paid AS (
      SELECT k,
             COUNT(*)::int AS paid_sessions,
             COUNT(DISTINCT COALESCE(NULLIF(student_id, ''), 'sess:' || id::text))::int AS paid_students,
             SUM(GREATEST(1, CEIL(
               NULLIF(GREATEST(target_duration, duration_seconds), 0)::numeric / ${LESSON_SECONDS}
             )))::int AS paid_hours,
             SUM(CASE WHEN status = 'completed' THEN GREATEST(1, CEIL(
               NULLIF(GREATEST(target_duration, duration_seconds), 0)::numeric / ${LESSON_SECONDS}
             )) ELSE 0 END)::int AS billable_hours,
             COUNT(*) FILTER (WHERE status <> 'completed')::int AS pending_sessions,
             SUM(amount)::numeric  AS amount,
             SUM(cash_amount)::numeric AS cash_amount,
             SUM(terminal_amount)::numeric AS terminal_amount
        FROM keyed
       WHERE customer_type <> 'school'
       GROUP BY k
    ),
    /* BEPUL — avtoshkola davomati. Pul olinmaydi, lekin soni ko'rinadi. */
    att AS (
      SELECT k,
             SUM(GREATEST(1, lessons_counted))::int AS free_hours,
             COUNT(*)::int AS attendance_rows,
             COUNT(DISTINCT student_id)::int AS free_students
        FROM keyed
       WHERE customer_type = 'school'
       GROUP BY k
    ),
    merged AS (
      SELECT COALESCE(o.k, a.k) AS k,
             COALESCE(o.paid_sessions, 0)    AS paid_sessions,
             COALESCE(o.paid_students, 0)    AS paid_students,
             COALESCE(o.paid_hours, 0)       AS paid_hours,
             COALESCE(o.billable_hours, 0)   AS billable_hours,
             COALESCE(o.pending_sessions, 0) AS pending_sessions,
             COALESCE(o.amount, 0)           AS amount,
             COALESCE(o.cash_amount, 0)      AS cash_amount,
             COALESCE(o.terminal_amount, 0)  AS terminal_amount,
             COALESCE(a.free_hours, 0)       AS free_hours,
             COALESCE(a.attendance_rows, 0)  AS attendance_rows,
             COALESCE(a.free_students, 0)    AS free_students
        FROM paid o
        FULL OUTER JOIN att a ON a.k = o.k
    )
    SELECT m.*,
           COALESCE(${E.name},
                    (SELECT MAX(kk.ins_name_raw) FROM keyed kk WHERE kk.k = m.k)) AS instructor_name,
           i.id::text  AS instructor_id,
           ${E.phone}  AS instructor_phone,
           ${E.plate}  AS instructor_plate
      FROM merged m
      LEFT JOIN instructors i
             ON i.id::text = m.k AND ${E.owner} = $3
     ORDER BY COALESCE(${E.name}, '') ASC`;

  const owner = String(req.__ownerKey || userId);
  const r = await pool.query(sql, [userId, date, owner]);

  /* Bir soatning narxi — sozlamalardagi «soatlik narx» (masalan 100 000).
     Narx o'zgarsa, faqat sozlamadan o'zgartiriladi, kodga tegilmaydi. */
  let hourlyRate = 0;
  try {
    const s = await pool.query(
      `SELECT hourly_rate FROM user_settings WHERE user_id=$1`, [userId]);
    hourlyRate = Number(s.rows[0]?.hourly_rate || 0);
  } catch { /* sozlama bo'lmasa 0 */ }

  /* Bepul o'quvchi juda ko'payib, pullikdan bittasi ham bo'lmasa —
     instruktor hammasini «avtoshkola» deb yozib ketayotgan bo'lishi
     mumkin. Shuni alohida belgilaymiz. */
  const FREE_WARN_HOURS = 3;

  const rows = r.rows.map(x => {
    const unknown = x.k === 'none';
    const paidHours = Number(x.paid_hours) || 0;
    const billableHours = Number(x.billable_hours) || 0;
    const freeHours = Number(x.free_hours) || 0;
    const paidStudents = Number(x.paid_students) || 0;
    const freeStudents = Number(x.free_students) || 0;
    const amount = Number(x.amount) || 0;
    const pendingSessions = Number(x.pending_sessions) || 0;

    /* To'lashi kerak = uchgan pullik soat × soatlik narx.
       Jarayondagi sessiya hali yakunlanmagani uchun hisobga olinmaydi. */
    const expected = billableHours * hourlyRate;
    const payDiff = amount - expected;   /* manfiy = kam to'lagan */

    const freeWarn = !unknown && freeHours >= FREE_WARN_HOURS && paidHours === 0;

    let state;
    if (unknown) state = 'info';
    else if (payDiff < 0) state = 'unpaid';
    else if (freeWarn) state = 'freewarn';
    else if (payDiff > 0) state = 'over';
    else state = 'ok';

    return {
      key: x.k,
      instructorId: x.instructor_id || null,
      instructorName: unknown ? null : (x.instructor_name || null),
      phone: x.instructor_phone || null,
      plate: x.instructor_plate || null,
      unknown,

      /* o'quvchilar */
      paidStudents,
      freeStudents,
      totalStudents: paidStudents + freeStudents,

      /* soatlar */
      paidHours,
      billableHours,
      freeHours,
      totalHours: paidHours + freeHours,

      /* pul */
      expected,
      amount,
      cashAmount: Number(x.cash_amount) || 0,
      terminalAmount: Number(x.terminal_amount) || 0,
      payDiff,

      paidSessions: Number(x.paid_sessions) || 0,
      pendingSessions,
      attendanceRows: Number(x.attendance_rows) || 0,
      freeWarn,

      /* unpaid   — kam to'lagan (asosiy xatolik)
         freewarn — hammasi bepul yozilgan, tekshirish kerak
         over     — ortiqcha to'langan
         ok       — to'g'ri
         info     — instruktor ko'rsatilmagan, aniqlik kerak */
      state
    };
  });

  /* E'tibor talab qiladiganlari tepada tursin */
  const orderOf = s => ({ unpaid: 0, freewarn: 1, info: 2, over: 3, ok: 4 }[s] ?? 5);
  rows.sort((a, b) => orderOf(a.state) - orderOf(b.state)
    || (a.payDiff - b.payDiff)
    || String(a.instructorName || '').localeCompare(String(b.instructorName || '')));

  const summary = rows.reduce((a, x) => {
    a.paidStudents += x.paidStudents;
    a.freeStudents += x.freeStudents;
    a.paidHours += x.paidHours;
    a.freeHours += x.freeHours;
    a.expected += x.expected;
    a.amount += x.amount;
    a.pendingSessions += x.pendingSessions;
    if (x.payDiff < 0) { a.unpaidCount++; a.missingAmount += -x.payDiff; }
    if (x.state === 'over') a.overCount++;
    if (x.state === 'ok') a.okCount++;
    if (x.state === 'freewarn') a.freeWarnCount++;
    if (x.state === 'info') { a.unknownCount++; a.unknownHours += x.totalHours; }
    return a;
  }, { paidStudents: 0, freeStudents: 0, paidHours: 0, freeHours: 0,
       expected: 0, amount: 0, pendingSessions: 0,
       unpaidCount: 0, missingAmount: 0, overCount: 0, okCount: 0,
       freeWarnCount: 0, unknownCount: 0, unknownHours: 0 });

  summary.totalStudents = summary.paidStudents + summary.freeStudents;
  summary.totalHours = summary.paidHours + summary.freeHours;
  summary.hourlyRate = hourlyRate;

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
  const E = await instructorExpr();
  const owner = String(req.__ownerKey || userId);

  const sql = `
    WITH norm AS (
      SELECT s.id, s.status, s.started_at, s.finished_at,
             COALESCE(s.duration_seconds,0)::int AS duration_seconds,
             COALESCE(${cTarget},0)::int  AS target_duration,
             COALESCE(${cLessons},0)::int AS lessons_counted,
             COALESCE(${cCustomer},'regular') AS customer_type,
             COALESCE(s.amount,0)::numeric AS amount,
             COALESCE(s.cash_amount,0)::numeric AS cash_amount,
             COALESCE(s.terminal_amount,0)::numeric AS terminal_amount,
             NULLIF(TRIM(COALESCE(${cInsName},'')),'') AS ins_name_raw,
             NULLIF(${cStudent}::text,'') AS student_id,
             ${cDriver} AS driver_name,
             v.plate AS plate,
             COALESCE(
               NULLIF(${cInsId}::text,''),
               (SELECT i.id::text FROM instructors i
                 WHERE ${E.owner}=$3
                   AND LOWER(TRIM(COALESCE(${E.name},''))) = LOWER(TRIM(COALESCE(${cInsName},'')))
                   AND NULLIF(TRIM(COALESCE(${cInsName},'')),'') IS NOT NULL
                 ORDER BY i.created_at NULLS LAST LIMIT 1),
               (SELECT i.id::text FROM instructors i
                 WHERE ${E.owner}=$3
                   AND ${E.plate} IS NOT NULL
                   AND REGEXP_REPLACE(UPPER(${E.plate}), '[^A-Z0-9]', '', 'g')
                     = REGEXP_REPLACE(UPPER(COALESCE(v.plate,'')), '[^A-Z0-9]', '', 'g')
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
  let hourlyRate = 0;
  try {
    const s = await pool.query(`SELECT hourly_rate FROM user_settings WHERE user_id=$1`, [userId]);
    hourlyRate = Number(s.rows[0]?.hourly_rate || 0);
  } catch { /* sozlama bo'lmasa 0 */ }
  send(res, 200, { date, key, hourlyRate, rows: r.rows });
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
