import jwt from 'jsonwebtoken';
import { pool } from '../backend/src/db.js';

/* =========================================================
   AVTODROM V3 ROUTES
   Mavjud kodga tegmaydi. Faqat yetishmayotgan endpointlarni qo'shadi:
     PUT/DELETE /api/students/:id          (dars soni saqlanishi)
     PUT        /api/students/:id/attendance
     POST       /api/students              (birth_date + dars soni bilan)
     DELETE     /api/schools/:id
     PATCH/DELETE /api/groups/:id
     GET/POST/PUT/DELETE /api/instructors
     GET        /api/instructors/:id/daily
     GET        /api/sessions/active-v3
     POST       /api/sessions/start-v3
     GET        /api/vehicle-lookup
     GET        /api/student-history
   /api/restore/... prefiksi ham qo'llab-quvvatlanadi.
========================================================= */

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
const REGIONS = ['01','10','20','25','30','40','50','60','70','75','80','85','90','95'];
const num = v => Number.isFinite(Number(v)) ? Number(v) : 0;
const intOrNull = v => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null;
};

function userId(req) {
  try {
    const h = req.headers?.authorization || '';
    if (!h.startsWith('Bearer ')) return null;
    return String(jwt.verify(h.slice(7), JWT_SECRET).sub);
  } catch {
    return null;
  }
}

/* Vercel odatda req.body ni o'zi parse qiladi. Bo'lmasa oqimdan o'qiymiz
   va express.json() qayta o'qimasligi uchun req._body flagini qo'yamiz. */
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  let parsed = {};
  try { parsed = raw ? JSON.parse(raw) : {}; } catch { parsed = {}; }
  req.body = parsed;
  req._body = true;
  return parsed;
}

function send(res, status, data) {
  if (res.headersSent) return true;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
  return true;
}

/* Frontend dars sonini turli nom bilan yuborishi mumkin. */
function pickAttendance(body) {
  const keys = ['attendanceCount','attendance_count','attendance','lessons','lessonCount','lesson_count','lessonsCount','visits','visit_count','manualAttendanceCount','manual_attendance_count'];
  for (const k of keys) {
    if (body[k] !== undefined && body[k] !== null && body[k] !== '') {
      const n = intOrNull(body[k]);
      if (n !== null) return n;
    }
  }
  return null;
}

function normalizePlate(v) {
  return String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function buildPlate(regionCode, rawBody) {
  const region = String(regionCode || '').trim();
  const body = normalizePlate(rawBody);
  if (!REGIONS.includes(region)) throw new Error('Viloyat kodi noto‘g‘ri');
  if (!/^[A-Z0-9]{6}$/.test(body)) throw new Error('Raqam 6 ta belgi bo‘lishi kerak. Masalan: 111QQQ yoki A555AA');
  if (/^\d{3}[A-Z]{3}$/.test(body)) {
    return { region, body, firstLetter: body[3], number: body.slice(0,3), lastLetters: body.slice(4,6), plate: `${region} ${body}` };
  }
  if (/^[A-Z]\d{3}[A-Z]{2}$/.test(body)) {
    return { region, body, firstLetter: body[0], number: body.slice(1,4), lastLetters: body.slice(4,6), plate: `${region} ${body}` };
  }
  return { region, body, firstLetter: body[0], number: body.slice(1,4), lastLetters: body.slice(4,6), plate: `${region} ${body}` };
}

/* ---------------- SCHEMA ---------------- */
let schemaPromise = null;
function ensureV3Schema() {
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    const q = async sql => { try { await pool.query(sql); } catch (e) { console.error('V3 SCHEMA:', e.message); } };
    await q(`ALTER TABLE students ADD COLUMN IF NOT EXISTS birth_date DATE`);
    await q(`ALTER TABLE students ADD COLUMN IF NOT EXISTS manual_attendance_count INTEGER NOT NULL DEFAULT 0`);
    await q(`
      CREATE TABLE IF NOT EXISTS instructors(
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_key TEXT NOT NULL,
        full_name VARCHAR(160) NOT NULL,
        phone VARCHAR(50),
        vehicle_plate VARCHAR(30),
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await q(`CREATE INDEX IF NOT EXISTS idx_instructors_owner ON instructors(owner_key,active)`);
    await q(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS planned_minutes INTEGER NOT NULL DEFAULT 0`);
    await q(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS instructor_id UUID`);
    await q(`CREATE INDEX IF NOT EXISTS idx_sessions_instructor ON sessions(instructor_id,started_at DESC)`);
  })().catch(e => { schemaPromise = null; throw e; });
  return schemaPromise;
}

/* ---------------- STUDENTS ---------------- */
async function studentRow(id, user) {
  const r = await pool.query(`
    SELECT st.id, st.owner_key, st.school_id, st.group_id, st.full_name, st.birth_date,
           st.phone, st.plate, st.notes, st.active, st.created_at,
           s.name AS school_name, g.name AS group_name,
           COALESCE(st.manual_attendance_count,0)::int AS attendance_count,
           COALESCE(st.manual_attendance_count,0)::int AS manual_attendance_count
    FROM students st
    JOIN driving_schools s ON s.id = st.school_id
    LEFT JOIN school_groups g ON g.id = st.group_id
    WHERE st.id = $1 AND st.owner_key = $2
  `, [id, user]);
  return r.rows[0] || null;
}

async function createStudent(req, res, user) {
  const body = await readBody(req);
  const schoolId = String(body.schoolId || body.school_id || '').trim();
  const groupId = body.groupId || body.group_id ? String(body.groupId || body.group_id) : null;
  const fullName = String(body.fullName || body.full_name || body.name || '').trim();
  const birthDate = body.birthDate || body.birth_date ? String(body.birthDate || body.birth_date).trim() : null;
  const attendance = pickAttendance(body) ?? 0;

  if (!fullName) return send(res, 400, { error: 'F.I.Sh. kerak' });
  if (!schoolId) return send(res, 400, { error: 'Avtoshkola tanlanmagan' });
  if (birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return send(res, 400, { error: 'Tug‘ilgan sana noto‘g‘ri (YYYY-MM-DD)' });

  const s = await pool.query(`SELECT id FROM driving_schools WHERE id=$1 AND owner_key=$2 AND active=true`, [schoolId, user]);
  if (!s.rows[0]) return send(res, 404, { error: 'Avtoshkola topilmadi' });
  if (groupId) {
    const g = await pool.query(`SELECT id FROM school_groups WHERE id=$1 AND school_id=$2 AND owner_key=$3 AND active=true`, [groupId, schoolId, user]);
    if (!g.rows[0]) return send(res, 400, { error: 'Guruh noto‘g‘ri' });
  }

  const r = await pool.query(`
    INSERT INTO students(owner_key, school_id, group_id, full_name, birth_date, phone, plate, notes, manual_attendance_count)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id
  `, [user, schoolId, groupId, fullName, birthDate, body.phone || null, body.plate || null, body.notes || null, attendance]);

  return send(res, 201, await studentRow(r.rows[0].id, user));
}

async function updateStudent(req, res, user, id) {
  const body = await readBody(req);
  const current = await pool.query(`SELECT * FROM students WHERE id=$1 AND owner_key=$2`, [id, user]);
  if (!current.rows[0]) return send(res, 404, { error: 'O‘quvchi topilmadi' });
  const cur = current.rows[0];

  const fullName = body.fullName ?? body.full_name ?? body.name;
  const name = fullName === undefined ? cur.full_name : String(fullName).trim();
  if (!name) return send(res, 400, { error: 'F.I.Sh. kerak' });

  const birthRaw = body.birthDate ?? body.birth_date;
  let birthDate = cur.birth_date;
  if (birthRaw !== undefined) {
    const b = String(birthRaw || '').trim();
    if (b && !/^\d{4}-\d{2}-\d{2}$/.test(b)) return send(res, 400, { error: 'Tug‘ilgan sana noto‘g‘ri (YYYY-MM-DD)' });
    birthDate = b || null;
  }

  let schoolId = body.schoolId ?? body.school_id;
  schoolId = schoolId === undefined || schoolId === null || schoolId === '' ? cur.school_id : String(schoolId);
  const s = await pool.query(`SELECT id FROM driving_schools WHERE id=$1 AND owner_key=$2`, [schoolId, user]);
  if (!s.rows[0]) return send(res, 400, { error: 'Avtoshkola topilmadi' });

  let groupId = body.groupId ?? body.group_id;
  groupId = groupId === undefined ? cur.group_id : (groupId ? String(groupId) : null);
  if (groupId) {
    const g = await pool.query(`SELECT id FROM school_groups WHERE id=$1 AND school_id=$2 AND owner_key=$3`, [groupId, schoolId, user]);
    if (!g.rows[0]) return send(res, 400, { error: 'Guruh noto‘g‘ri' });
  }

  const phone = body.phone === undefined ? cur.phone : (String(body.phone || '').trim() || null);
  const plate = body.plate === undefined ? cur.plate : (String(body.plate || '').trim().toUpperCase() || null);

  // ASOSIY TUZATISH: dars soni endi haqiqatan saqlanadi.
  const attendance = pickAttendance(body);
  const attendanceValue = attendance === null ? Number(cur.manual_attendance_count || 0) : attendance;

  await pool.query(`
    UPDATE students
    SET full_name=$1, birth_date=$2, phone=$3, plate=$4, school_id=$5, group_id=$6,
        manual_attendance_count=$7
    WHERE id=$8 AND owner_key=$9
  `, [name, birthDate, phone, plate, schoolId, groupId, attendanceValue, id, user]);

  return send(res, 200, await studentRow(id, user));
}

async function setAttendance(req, res, user, id) {
  const body = await readBody(req);
  const value = pickAttendance(body);
  if (value === null) return send(res, 400, { error: 'Dars soni kerak' });
  const r = await pool.query(`UPDATE students SET manual_attendance_count=$1 WHERE id=$2 AND owner_key=$3 RETURNING id`, [value, id, user]);
  if (!r.rows[0]) return send(res, 404, { error: 'O‘quvchi topilmadi' });
  return send(res, 200, await studentRow(id, user));
}

async function deleteStudent(req, res, user, id) {
  const r = await pool.query(`UPDATE students SET active=false WHERE id=$1 AND owner_key=$2 RETURNING id`, [id, user]);
  if (!r.rows[0]) return send(res, 404, { error: 'O‘quvchi topilmadi' });
  return send(res, 200, { ok: true, id });
}

/* ---------------- SCHOOLS / GROUPS ---------------- */
async function deleteSchool(req, res, user, id) {
  const r = await pool.query(`UPDATE driving_schools SET active=false WHERE id=$1 AND owner_key=$2 RETURNING id`, [id, user]);
  if (!r.rows[0]) return send(res, 404, { error: 'Avtoshkola topilmadi' });
  await pool.query(`UPDATE school_groups SET active=false WHERE school_id=$1 AND owner_key=$2`, [id, user]);
  await pool.query(`UPDATE students SET active=false WHERE school_id=$1 AND owner_key=$2`, [id, user]);
  return send(res, 200, { ok: true, id });
}

async function updateGroup(req, res, user, id) {
  const body = await readBody(req);
  const name = String(body.name || '').trim();
  if (!name) return send(res, 400, { error: 'Guruh nomi kerak' });
  const r = await pool.query(`UPDATE school_groups SET name=$1 WHERE id=$2 AND owner_key=$3 RETURNING *`, [name, id, user]);
  if (!r.rows[0]) return send(res, 404, { error: 'Guruh topilmadi' });
  return send(res, 200, r.rows[0]);
}

async function deleteGroup(req, res, user, id) {
  const r = await pool.query(`UPDATE school_groups SET active=false WHERE id=$1 AND owner_key=$2 RETURNING id`, [id, user]);
  if (!r.rows[0]) return send(res, 404, { error: 'Guruh topilmadi' });
  await pool.query(`UPDATE students SET group_id=NULL WHERE group_id=$1 AND owner_key=$2`, [id, user]);
  return send(res, 200, { ok: true, id });
}

/* ---------------- INSTRUCTORS ---------------- */
async function listInstructors(req, res, user) {
  const r = await pool.query(`
    SELECT id, full_name, phone, vehicle_plate, active, created_at
    FROM instructors WHERE owner_key=$1 ORDER BY active DESC, full_name
  `, [user]);
  return send(res, 200, r.rows);
}

async function createInstructor(req, res, user) {
  const body = await readBody(req);
  const fullName = String(body.fullName || body.full_name || body.name || '').trim();
  if (!fullName) return send(res, 400, { error: 'F.I.Sh. kerak' });
  const plate = String(body.vehiclePlate || body.vehicle_plate || '').trim().toUpperCase() || null;
  const active = body.active === false ? false : true;
  const r = await pool.query(`
    INSERT INTO instructors(owner_key, full_name, phone, vehicle_plate, active)
    VALUES($1,$2,$3,$4,$5) RETURNING id, full_name, phone, vehicle_plate, active, created_at
  `, [user, fullName, String(body.phone || '').trim() || null, plate, active]);
  return send(res, 201, r.rows[0]);
}

async function updateInstructor(req, res, user, id) {
  const body = await readBody(req);
  const cur = await pool.query(`SELECT * FROM instructors WHERE id=$1 AND owner_key=$2`, [id, user]);
  if (!cur.rows[0]) return send(res, 404, { error: 'Instruktor topilmadi' });
  const c = cur.rows[0];
  const fullName = body.fullName ?? body.full_name ?? body.name;
  const name = fullName === undefined ? c.full_name : String(fullName).trim();
  if (!name) return send(res, 400, { error: 'F.I.Sh. kerak' });
  const phoneRaw = body.phone;
  const phone = phoneRaw === undefined ? c.phone : (String(phoneRaw || '').trim() || null);
  const plateRaw = body.vehiclePlate ?? body.vehicle_plate;
  const plate = plateRaw === undefined ? c.vehicle_plate : (String(plateRaw || '').trim().toUpperCase() || null);
  const active = body.active === undefined ? c.active : body.active !== false && body.active !== 'false';
  const r = await pool.query(`
    UPDATE instructors SET full_name=$1, phone=$2, vehicle_plate=$3, active=$4
    WHERE id=$5 AND owner_key=$6
    RETURNING id, full_name, phone, vehicle_plate, active, created_at
  `, [name, phone, plate, active, id, user]);
  return send(res, 200, r.rows[0]);
}

async function deleteInstructor(req, res, user, id) {
  const r = await pool.query(`DELETE FROM instructors WHERE id=$1 AND owner_key=$2 RETURNING id`, [id, user]);
  if (!r.rows[0]) return send(res, 404, { error: 'Instruktor topilmadi' });
  await pool.query(`UPDATE sessions SET instructor_id=NULL WHERE instructor_id=$1 AND user_id=$2`, [id, user]);
  return send(res, 200, { ok: true, id });
}

async function instructorDaily(req, res, user, id, search) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(search.get('date') || '') ? search.get('date') : new Date().toISOString().slice(0, 10);
  const ir = await pool.query(`SELECT id, full_name, phone, vehicle_plate, active FROM instructors WHERE id=$1 AND owner_key=$2`, [id, user]);
  if (!ir.rows[0]) return send(res, 404, { error: 'Instruktor topilmadi' });
  const inst = ir.rows[0];
  const plate = normalizePlate(inst.vehicle_plate);

  // Sessiya instruktorga to'g'ridan-to'g'ri biriktirilgan bo'lishi yoki
  // uning avtomobil raqami bo'yicha topilishi mumkin.
  const r = await pool.query(`
    SELECT s.id, v.plate, v.model, v.driver_name, s.started_at, s.finished_at,
           s.duration_seconds, s.planned_minutes, s.amount, s.cash_amount, s.terminal_amount,
           s.payment_method, s.student_id,
           ds.name AS school_name, g.name AS group_name, st.full_name AS student_name
    FROM sessions s
    JOIN vehicles v ON v.id = s.vehicle_id
    LEFT JOIN driving_schools ds ON ds.id = s.school_id
    LEFT JOIN school_groups g ON g.id = s.group_id
    LEFT JOIN students st ON st.id = s.student_id
    WHERE s.user_id = $1
      AND s.started_at::date = $2
      AND (
        s.instructor_id = $3
        OR ($4 <> '' AND REGEXP_REPLACE(UPPER(v.plate), '[^A-Z0-9]', '', 'g') = $4)
      )
    ORDER BY s.started_at
  `, [user, date, id, plate]);

  const summary = r.rows.reduce((a, x) => {
    a.count++;
    a.seconds += Number(x.duration_seconds || 0);
    a.amount += Number(x.amount || 0);
    if (x.student_id) a.school++; else a.ordinary++;
    return a;
  }, { count: 0, seconds: 0, amount: 0, school: 0, ordinary: 0 });

  return send(res, 200, { date, instructor: inst, summary, rows: r.rows });
}

/* ---------------- SESSIONS ---------------- */
async function activeV3(req, res, user) {
  const r = await pool.query(`
    SELECT s.id, v.plate, v.model, v.driver_name, s.started_at, s.status,
           s.school_id, s.group_id, s.student_id,
           COALESCE(s.planned_minutes,0)::int AS planned_minutes,
           s.instructor_id,
           COALESCE(s.hourly_rate,0)::numeric AS hourly_rate,
           COALESCE(s.frozen_seconds,0)::bigint AS frozen_seconds,
           ds.name AS school_name, g.name AS group_name, st.full_name AS student_name,
           i.full_name AS instructor_name
    FROM sessions s
    JOIN vehicles v ON v.id = s.vehicle_id
    LEFT JOIN driving_schools ds ON ds.id = s.school_id
    LEFT JOIN school_groups g ON g.id = s.group_id
    LEFT JOIN students st ON st.id = s.student_id
    LEFT JOIN instructors i ON i.id = s.instructor_id
    WHERE s.user_id = $1 AND s.status = 'active'
    ORDER BY s.started_at
  `, [user]);
  return send(res, 200, r.rows.map(x => ({
    ...x,
    planned_minutes: Number(x.planned_minutes || 0),
    hourly_rate: Number(x.hourly_rate || 0),
    frozen_seconds: Number(x.frozen_seconds || 0)
  })));
}

async function startV3(req, res, user) {
  const body = await readBody(req);
  let p;
  try {
    p = buildPlate(body.regionCode || body.region_code, body.plateBody || body.plate);
  } catch (e) {
    return send(res, 400, { error: e.message });
  }

  const plannedMinutes = intOrNull(body.plannedMinutes ?? body.planned_minutes ?? body.durationMinutes) ?? 0;
  let instructorId = body.instructorId || body.instructor_id ? String(body.instructorId || body.instructor_id) : null;

  const c = await pool.connect();
  try {
    await c.query('BEGIN');

    let vr = await c.query(`SELECT * FROM vehicles WHERE plate=$1 AND user_id=$2`, [p.plate, user]);
    let v = vr.rows[0];
    if (!v) {
      vr = await c.query(`
        INSERT INTO vehicles(user_id,region_code,first_letter,number,last_letters,plate,model,driver_name)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *
      `, [user, p.region, p.firstLetter, p.number, p.lastLetters, p.plate, body.model || null, body.driverName || null]);
      v = vr.rows[0];
    } else {
      await c.query(`UPDATE vehicles SET model=COALESCE($1,model), driver_name=COALESCE($2,driver_name) WHERE id=$3 AND user_id=$4`,
        [body.model || null, body.driverName || null, v.id, user]);
    }

    let schoolId = body.schoolId ? String(body.schoolId) : null;
    let groupId = body.groupId ? String(body.groupId) : null;
    const studentId = body.studentId ? String(body.studentId) : null;

    if (studentId) {
      const sr = await c.query(`SELECT id,school_id,group_id FROM students WHERE id=$1 AND owner_key=$2 AND active=true`, [studentId, user]);
      if (!sr.rows[0]) throw new Error('O‘quvchi topilmadi');
      schoolId = sr.rows[0].school_id;
      groupId = sr.rows[0].group_id;
    }
    if (instructorId) {
      const ir = await c.query(`SELECT id FROM instructors WHERE id=$1 AND owner_key=$2`, [instructorId, user]);
      if (!ir.rows[0]) instructorId = null;
    }
    // Instruktor tanlanmagan bo'lsa, avtomobil raqami bo'yicha topamiz.
    if (!instructorId) {
      const ir = await c.query(`
        SELECT id FROM instructors
        WHERE owner_key=$1 AND active=true
          AND REGEXP_REPLACE(UPPER(COALESCE(vehicle_plate,'')), '[^A-Z0-9]', '', 'g') = $2
        LIMIT 1
      `, [user, normalizePlate(p.plate)]);
      if (ir.rows[0]) instructorId = ir.rows[0].id;
    }

    const busy = await c.query(`SELECT id FROM sessions WHERE vehicle_id=$1 AND user_id=$2 AND status='active' LIMIT 1`, [v.id, user]);
    if (busy.rows[0]) {
      await c.query('ROLLBACK');
      return send(res, 409, { error: 'Bu avtomobil hozir jarayonda', activeSessionId: busy.rows[0].id });
    }

    const set = await c.query(`SELECT hourly_rate,minimum_payment,calculation_mode FROM user_settings WHERE user_id=$1`, [user]);
    const s = set.rows[0] || { hourly_rate: 30000, minimum_payment: 0, calculation_mode: 'minute' };

    const r = await c.query(`
      INSERT INTO sessions(user_id,vehicle_id,hourly_rate,minimum_payment,calculation_mode,
                           school_id,group_id,student_id,manual_price,planned_minutes,instructor_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,true,$9,$10)
      RETURNING id,started_at,planned_minutes,instructor_id
    `, [user, v.id, s.hourly_rate, s.minimum_payment, s.calculation_mode, schoolId, groupId, studentId, plannedMinutes, instructorId]);

    await c.query('COMMIT');
    return send(res, 201, {
      id: r.rows[0].id,
      plate: p.plate,
      plateBody: p.body,
      startedAt: r.rows[0].started_at,
      planned_minutes: Number(r.rows[0].planned_minutes || 0),
      instructor_id: r.rows[0].instructor_id,
      hourly_rate: Number(s.hourly_rate || 0),
      schoolId, groupId, studentId
    });
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch {}
    return send(res, e.code === '23505' ? 409 : 400, { error: e.code === '23505' ? 'Bu avtomobil hozir jarayonda' : (e.message || 'START bajarilmadi') });
  } finally {
    c.release();
  }
}

/* ---------------- LOOKUP / HISTORY ---------------- */
async function vehicleLookup(req, res, user, search) {
  const plate = normalizePlate(search.get('plate'));
  if (!plate) return send(res, 400, { error: 'Avtomobil raqami kerak' });

  const v = await pool.query(`
    SELECT plate, model, driver_name FROM vehicles
    WHERE user_id=$1 AND REGEXP_REPLACE(UPPER(plate),'[^A-Z0-9]','','g') = $2
    LIMIT 1
  `, [user, plate]);

  const i = await pool.query(`
    SELECT id, full_name FROM instructors
    WHERE owner_key=$1 AND active=true
      AND REGEXP_REPLACE(UPPER(COALESCE(vehicle_plate,'')),'[^A-Z0-9]','','g') = $2
    LIMIT 1
  `, [user, plate]);

  return send(res, 200, {
    plate: v.rows[0]?.plate || null,
    model: v.rows[0]?.model || null,
    driver_name: v.rows[0]?.driver_name || null,
    instructor_id: i.rows[0]?.id || null,
    instructor_name: i.rows[0]?.full_name || null
  });
}

async function studentHistory(req, res, user, search) {
  const studentId = String(search.get('studentId') || '').trim();
  if (!studentId) return send(res, 400, { error: 'studentId kerak' });
  const r = await pool.query(`
    SELECT s.id, v.plate, v.model, v.driver_name, s.started_at, s.finished_at,
           s.duration_seconds, s.amount, s.cash_amount, s.terminal_amount, s.payment_method,
           s.status, s.student_id,
           ds.name AS school_name, g.name AS group_name, st.full_name AS student_name,
           i.full_name AS instructor_name
    FROM sessions s
    JOIN vehicles v ON v.id = s.vehicle_id
    LEFT JOIN driving_schools ds ON ds.id = s.school_id
    LEFT JOIN school_groups g ON g.id = s.group_id
    LEFT JOIN students st ON st.id = s.student_id
    LEFT JOIN instructors i ON i.id = s.instructor_id
    WHERE s.user_id=$1 AND s.student_id=$2
    ORDER BY s.started_at
  `, [user, studentId]);
  return send(res, 200, { studentId, rows: r.rows });
}

/* ---------------- ROUTER ---------------- */
export async function handleV3Request(req, res) {
  const rawUrl = String(req.url || '');
  const url = new URL(rawUrl, 'http://local');
  let pathname = url.pathname;
  const search = url.searchParams;
  const method = (req.method || 'GET').toUpperCase();

  if (!pathname.startsWith('/api/')) return false;
  // Frontend ba'zi so'rovlarni /api/restore/... orqali yuboradi.
  pathname = pathname.replace(/^\/api\/restore\//, '/api/');

  const m = {
    student:    pathname.match(/^\/api\/students\/([^/]+)$/),
    attendance: pathname.match(/^\/api\/students\/([^/]+)\/attendance$/),
    school:     pathname.match(/^\/api\/schools\/([^/]+)$/),
    group:      pathname.match(/^\/api\/groups\/([^/]+)$/),
    instructor: pathname.match(/^\/api\/instructors\/([^/]+)$/),
    instDaily:  pathname.match(/^\/api\/instructors\/([^/]+)\/daily$/)
  };

  const owns =
    (method === 'POST'   && pathname === '/api/students') ||
    ((method === 'PUT' || method === 'DELETE') && m.student) ||
    ((method === 'PUT' || method === 'POST' || method === 'PATCH') && m.attendance) ||
    (method === 'DELETE' && m.school) ||
    ((method === 'PATCH' || method === 'PUT' || method === 'DELETE') && m.group) ||
    (pathname === '/api/instructors' && (method === 'GET' || method === 'POST')) ||
    (m.instructor && (method === 'GET' || method === 'PUT' || method === 'PATCH' || method === 'DELETE')) ||
    (m.instDaily && method === 'GET') ||
    (method === 'GET'  && pathname === '/api/sessions/active-v3') ||
    (method === 'POST' && pathname === '/api/sessions/start-v3') ||
    (method === 'GET'  && pathname === '/api/vehicle-lookup') ||
    (method === 'GET'  && (pathname === '/api/student-history' || pathname === '/api/student-history.js'));

  if (!owns) return false;

  const user = userId(req);
  if (!user) return send(res, 401, { error: 'Kirish talab qilinadi' });

  try {
    await ensureV3Schema();

    if (method === 'POST' && pathname === '/api/students') return await createStudent(req, res, user);
    if (m.attendance) return await setAttendance(req, res, user, m.attendance[1]);
    if (m.student && method === 'PUT') return await updateStudent(req, res, user, m.student[1]);
    if (m.student && method === 'DELETE') return await deleteStudent(req, res, user, m.student[1]);

    if (m.school && method === 'DELETE') return await deleteSchool(req, res, user, m.school[1]);
    if (m.group && (method === 'PATCH' || method === 'PUT')) return await updateGroup(req, res, user, m.group[1]);
    if (m.group && method === 'DELETE') return await deleteGroup(req, res, user, m.group[1]);

    if (m.instDaily) return await instructorDaily(req, res, user, m.instDaily[1], search);
    if (pathname === '/api/instructors' && method === 'GET') return await listInstructors(req, res, user);
    if (pathname === '/api/instructors' && method === 'POST') return await createInstructor(req, res, user);
    if (m.instructor && method === 'GET') {
      const r = await pool.query(`SELECT id,full_name,phone,vehicle_plate,active,created_at FROM instructors WHERE id=$1 AND owner_key=$2`, [m.instructor[1], user]);
      if (!r.rows[0]) return send(res, 404, { error: 'Instruktor topilmadi' });
      return send(res, 200, r.rows[0]);
    }
    if (m.instructor && (method === 'PUT' || method === 'PATCH')) return await updateInstructor(req, res, user, m.instructor[1]);
    if (m.instructor && method === 'DELETE') return await deleteInstructor(req, res, user, m.instructor[1]);

    if (pathname === '/api/sessions/active-v3') return await activeV3(req, res, user);
    if (pathname === '/api/sessions/start-v3') return await startV3(req, res, user);
    if (pathname === '/api/vehicle-lookup') return await vehicleLookup(req, res, user, search);
    if (pathname.startsWith('/api/student-history')) return await studentHistory(req, res, user, search);

    return false;
  } catch (error) {
    console.error('V3 ROUTE ERROR:', pathname, error?.message || error);
    return send(res, 500, { error: error?.message || 'Server xatosi' });
  }
}
