import jwt from 'jsonwebtoken';
import { pool } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';

function ownerId(req) {
  try {
    const h = req.headers.authorization || '';
    if (!h.startsWith('Bearer ')) return null;
    const token = h.slice(7);
    const payload = jwt.verify(token, JWT_SECRET);
    return String(payload.sub || '');
  } catch {
    return null;
  }
}

function authOwner(req, res) {
  const owner = ownerId(req);
  if (!owner) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Kirish talab qilinadi' }));
    return null;
  }
  return owner;
}

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function bodyJson(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('JSON noto‘g‘ri')); }
    });
    req.on('error', reject);
  });
}

function clean(v) { return String(v ?? '').trim(); }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

function parsePlate(body) {
  const region = clean(body.regionCode).toUpperCase();
  const firstLetter = clean(body.firstLetter).toUpperCase();
  const number = clean(body.number);
  const lastLetters = clean(body.lastLetters).toUpperCase();
  if (!/^\d{2}$/.test(region)) throw new Error('Viloyat kodi noto‘g‘ri');
  if (!/^[A-Z]$/.test(firstLetter)) throw new Error('Birinchi harf noto‘g‘ri');
  if (!/^\d{3}$/.test(number)) throw new Error('Avtomobil raqami 3 xonali bo‘lishi kerak');
  if (!/^[A-Z]{2}$/.test(lastLetters)) throw new Error('Oxirgi harflar noto‘g‘ri');
  return { region, firstLetter, number, lastLetters, plate: `${region} ${firstLetter} ${number} ${lastLetters}` };
}

function parsePlateQuery(value) {
  const raw = clean(value).toUpperCase();
  const compact = raw.replace(/\s+/g, '');
  const m = compact.match(/^(\d{2})([A-Z])(\d{3})([A-Z]{2})$/);
  if (m) return { region: m[1], firstLetter: m[2], number: m[3], lastLetters: m[4], plate: `${m[1]} ${m[2]} ${m[3]} ${m[4]}` };
  return { raw };
}

async function ensureV3Schema() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS instructors (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_key TEXT NOT NULL,
      full_name VARCHAR(180) NOT NULL,
      phone VARCHAR(50),
      vehicle_id UUID NULL REFERENCES vehicles(id) ON DELETE SET NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS instructor_id UUID NULL REFERENCES instructors(id) ON DELETE SET NULL`,
    `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS planned_minutes INTEGER NULL`,
    `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS instructor_id UUID NULL REFERENCES instructors(id) ON DELETE SET NULL`,
    `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS customer_type VARCHAR(20) NULL`,
    `CREATE INDEX IF NOT EXISTS idx_v3_instructors_owner_active ON instructors(owner_key, active)`,
    `CREATE INDEX IF NOT EXISTS idx_v3_instructors_vehicle ON instructors(vehicle_id)`,
    `CREATE INDEX IF NOT EXISTS idx_v3_vehicles_instructor ON vehicles(instructor_id)`,
    `CREATE INDEX IF NOT EXISTS idx_v3_sessions_instructor_started ON sessions(instructor_id, started_at)`,
    `CREATE INDEX IF NOT EXISTS idx_v3_sessions_planned_minutes ON sessions(planned_minutes)`
  ];
  for (const sql of statements) {
    try { await pool.query(sql); } catch (e) { console.error('V3 schema:', e.message); }
  }
}

async function listInstructors(req, res, owner) {
  await ensureV3Schema();
  const r = await pool.query(`
    SELECT i.id, i.full_name, i.phone, i.active, i.vehicle_id,
           v.plate AS vehicle_plate, v.model AS vehicle_model,
           i.created_at, i.updated_at
    FROM instructors i
    LEFT JOIN vehicles v ON v.id = i.vehicle_id AND v.user_id = $1
    WHERE i.owner_key = $1
    ORDER BY i.active DESC, i.full_name
  `, [owner]);
  return json(res, 200, r.rows);
}

async function saveInstructor(req, res, owner, id = null) {
  await ensureV3Schema();
  const b = await bodyJson(req);
  const fullName = clean(b.fullName);
  const phone = clean(b.phone) || null;
  const vehiclePlate = clean(b.vehiclePlate).toUpperCase();
  const active = b.active !== false;
  if (!fullName) return json(res, 400, { error: 'F.I.Sh. kerak' });

  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    let vehicleId = null;
    if (vehiclePlate) {
      const p = parsePlateQuery(vehiclePlate);
      let vr;
      if (p.plate) {
        vr = await c.query(`SELECT id FROM vehicles WHERE user_id=$1 AND plate=$2 LIMIT 1`, [owner, p.plate]);
      } else {
        vr = await c.query(`SELECT id FROM vehicles WHERE user_id=$1 AND REPLACE(UPPER(plate),' ','')=REPLACE($2,' ','') LIMIT 1`, [owner, vehiclePlate]);
      }
      if (!vr.rows[0]) return json(res, 404, { error: 'Bu avtomobil topilmadi. Avval avtomobilni bazaga qo‘shing.' });
      vehicleId = vr.rows[0].id;
    }

    if (id) {
      const exists = await c.query(`SELECT id, vehicle_id FROM instructors WHERE id=$1 AND owner_key=$2 FOR UPDATE`, [id, owner]);
      if (!exists.rows[0]) return json(res, 404, { error: 'Instruktor topilmadi' });
      const r = await c.query(`
        UPDATE instructors
        SET full_name=$1, phone=$2, vehicle_id=$3, active=$4, updated_at=NOW()
        WHERE id=$5 AND owner_key=$6
        RETURNING *
      `, [fullName, phone, vehicleId, active, id, owner]);
      if (exists.rows[0].vehicle_id && String(exists.rows[0].vehicle_id) !== String(vehicleId || '')) {
        await c.query(`UPDATE vehicles SET instructor_id=NULL WHERE id=$1 AND user_id=$2`, [exists.rows[0].vehicle_id, owner]);
      }
      if (vehicleId) await c.query(`UPDATE vehicles SET instructor_id=$1 WHERE id=$2 AND user_id=$3`, [id, vehicleId, owner]);
      await c.query('COMMIT');
      return json(res, 200, r.rows[0]);
    }

    const r = await c.query(`
      INSERT INTO instructors(owner_key, full_name, phone, vehicle_id, active)
      VALUES($1,$2,$3,$4,$5) RETURNING *
    `, [owner, fullName, phone, vehicleId, active]);
    if (vehicleId) await c.query(`UPDATE vehicles SET instructor_id=$1 WHERE id=$2 AND user_id=$3`, [r.rows[0].id, vehicleId, owner]);
    await c.query('COMMIT');
    return json(res, 201, r.rows[0]);
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch {}
    return json(res, 400, { error: e.message || 'Instruktorni saqlashda xatolik' });
  } finally { c.release(); }
}

async function dailyInstructor(req, res, owner, id) {
  await ensureV3Schema();
  const date = clean(new URL(req.url, 'http://localhost').searchParams.get('date')) || new Date().toISOString().slice(0, 10);
  const ir = await pool.query(`
    SELECT i.id, i.full_name, i.phone, i.active, v.plate vehicle_plate, v.model vehicle_model
    FROM instructors i LEFT JOIN vehicles v ON v.id=i.vehicle_id AND v.user_id=$1
    WHERE i.id=$2 AND i.owner_key=$1
  `, [owner, id]);
  if (!ir.rows[0]) return json(res, 404, { error: 'Instruktor topilmadi' });
  const r = await pool.query(`
    SELECT se.id, se.started_at, se.finished_at, se.status, se.planned_minutes,
           se.duration_seconds, se.amount, se.hourly_rate, se.customer_type,
           v.plate, v.model,
           ds.name school_name, g.name group_name, st.full_name student_name
    FROM sessions se
    JOIN vehicles v ON v.id=se.vehicle_id
    LEFT JOIN driving_schools ds ON ds.id=se.school_id
    LEFT JOIN school_groups g ON g.id=se.group_id
    LEFT JOIN students st ON st.id=se.student_id
    WHERE se.user_id=$1 AND se.instructor_id=$2
      AND se.started_at >= ($3::date AT TIME ZONE 'Asia/Tashkent')
      AND se.started_at < (($3::date + INTERVAL '1 day') AT TIME ZONE 'Asia/Tashkent')
    ORDER BY se.started_at
  `, [owner, id, date]);
  const rows = r.rows.map(x => ({
    ...x,
    customer_type: x.customer_type || (x.student_name ? 'school' : 'ordinary'),
    duration_minutes: Math.round(Number(x.duration_seconds || 0) / 60),
    amount: Number(x.amount || 0)
  }));
  const summary = {
    total: rows.length,
    students: rows.filter(x => x.customer_type === 'school').length,
    private: rows.filter(x => x.customer_type !== 'school').length,
    total_minutes: rows.reduce((a, x) => a + Number(x.duration_minutes || 0), 0),
    total_amount: rows.reduce((a, x) => a + Number(x.amount || 0), 0)
  };
  return json(res, 200, { date, instructor: ir.rows[0], summary, rows });
}

async function vehicleLookup(req, res, owner) {
  const q = new URL(req.url, 'http://localhost').searchParams.get('plate') || '';
  const p = parsePlateQuery(q);
  let r;
  if (p.plate) {
    r = await pool.query(`
      SELECT v.id, v.plate, v.model, v.driver_name, v.instructor_id,
             i.full_name instructor_name
      FROM vehicles v
      LEFT JOIN instructors i ON i.id=v.instructor_id AND i.owner_key=$1
      WHERE v.user_id=$1 AND v.plate=$2 LIMIT 1
    `, [owner, p.plate]);
  } else {
    r = await pool.query(`
      SELECT v.id, v.plate, v.model, v.driver_name, v.instructor_id,
             i.full_name instructor_name
      FROM vehicles v
      LEFT JOIN instructors i ON i.id=v.instructor_id AND i.owner_key=$1
      WHERE v.user_id=$1 AND REPLACE(UPPER(v.plate),' ','')=REPLACE(UPPER($2),' ','') LIMIT 1
    `, [owner, q]);
  }
  return json(res, 200, r.rows[0] || null);
}

async function startV3(req, res, owner) {
  await ensureV3Schema();
  const b = await bodyJson(req);
  let p;
  try {
    p = parsePlate({
      regionCode: b.regionCode,
      firstLetter: b.firstLetter,
      number: b.number,
      lastLetters: b.lastLetters
    });
  } catch (e) { return json(res, 400, { error: e.message }); }

  const planned = Math.floor(num(b.plannedMinutes || b.durationMinutes));
  if (planned <= 0 || planned > 24 * 60) return json(res, 400, { error: 'Avtodromda bo‘lish vaqti 1 daqiqadan 24 soatgacha bo‘lishi kerak' });
  const customerType = clean(b.customerType).toLowerCase() === 'school' ? 'school' : 'ordinary';
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    let vr = await c.query(`SELECT * FROM vehicles WHERE user_id=$1 AND plate=$2 LIMIT 1`, [owner, p.plate]);
    let v = vr.rows[0];
    if (!v) {
      vr = await c.query(`
        INSERT INTO vehicles(user_id,region_code,first_letter,number,last_letters,plate,model,driver_name)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *
      `, [owner,p.region,p.firstLetter,p.number,p.lastLetters,p.plate,b.model || null,b.driverName || null]);
      v = vr.rows[0];
    } else {
      if (b.model && !v.model) await c.query(`UPDATE vehicles SET model=$1 WHERE id=$2 AND user_id=$3`, [b.model, v.id, owner]);
      if (b.driverName && !v.driver_name) await c.query(`UPDATE vehicles SET driver_name=$1 WHERE id=$2 AND user_id=$3`, [b.driverName, v.id, owner]);
    }

    let instructorId = b.instructorId ? clean(b.instructorId) : null;
    if (!instructorId && v.instructor_id) instructorId = String(v.instructor_id);
    if (instructorId) {
      const ir = await c.query(`SELECT id FROM instructors WHERE id=$1 AND owner_key=$2 AND active=true`, [instructorId, owner]);
      if (!ir.rows[0]) instructorId = null;
    }

    let schoolId = b.schoolId ? clean(b.schoolId) : null;
    let groupId = b.groupId ? clean(b.groupId) : null;
    let studentId = b.studentId ? clean(b.studentId) : null;
    if (customerType === 'school') {
      if (!schoolId || !groupId || !studentId) return json(res, 400, { error: 'Avtoshkola, guruh va o‘quvchini tanlang.' });
      const sr = await c.query(`SELECT id,school_id,group_id FROM students WHERE id=$1 AND owner_key=$2 AND active=true`, [studentId, owner]);
      if (!sr.rows[0]) return json(res, 404, { error: 'O‘quvchi topilmadi' });
      schoolId = sr.rows[0].school_id; groupId = sr.rows[0].group_id;
    } else {
      schoolId = null; groupId = null; studentId = null;
    }

    const set = await c.query(`SELECT hourly_rate FROM user_settings WHERE user_id=$1`, [owner]);
    const hourlyRate = Number(set.rows[0]?.hourly_rate || 30000);
    const activeCheck = await c.query(`SELECT id FROM sessions WHERE user_id=$1 AND vehicle_id=$2 AND status='active' LIMIT 1`, [owner, v.id]);
    if (activeCheck.rows[0]) return json(res, 409, { error: 'Bu avtomobil hozir jarayonda' });

    const r = await c.query(`
      INSERT INTO sessions(
        user_id,vehicle_id,hourly_rate,minimum_payment,calculation_mode,
        school_id,group_id,student_id,manual_price,planned_minutes,instructor_id,customer_type,status
      ) VALUES($1,$2,$3,0,'minute',$4,$5,$6,false,$7,$8,$9,'active')
      RETURNING id,started_at,planned_minutes,instructor_id,customer_type
    `, [owner,v.id,hourlyRate,schoolId,groupId,studentId,planned,instructorId,customerType]);

    await c.query('COMMIT');
    return json(res, 201, { id:r.rows[0].id, plate:v.plate, startedAt:r.rows[0].started_at, plannedMinutes:planned, instructorId, customerType });
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch {}
    return json(res, 400, { error: e.message || 'START bajarilmadi' });
  } finally { c.release(); }
}

async function activeV3(req, res, owner) {
  await ensureV3Schema();
  const r = await pool.query(`
    SELECT se.id, se.started_at, se.finished_at, se.status,
           se.duration_seconds, se.amount, se.hourly_rate, se.planned_minutes,
           se.customer_type, se.instructor_id,
           v.plate, v.model, v.driver_name,
           i.full_name instructor_name,
           se.school_id, se.group_id, se.student_id,
           ds.name school_name, g.name group_name, st.full_name student_name
    FROM sessions se
    JOIN vehicles v ON v.id=se.vehicle_id
    LEFT JOIN instructors i ON i.id=se.instructor_id AND i.owner_key=$1
    LEFT JOIN driving_schools ds ON ds.id=se.school_id
    LEFT JOIN school_groups g ON g.id=se.group_id
    LEFT JOIN students st ON st.id=se.student_id
    WHERE se.user_id=$1 AND se.status='active'
    ORDER BY se.started_at
  `, [owner]);
  const rows = r.rows.map(x => ({ ...x, customer_type: x.customer_type || (x.student_id ? 'school' : 'ordinary') }));
  return json(res, 200, rows);
}

export async function handleV3Request(req, res) {
  const pathname = String(req.url || '').split('?')[0];
  if (!pathname.startsWith('/api/')) return false;
  const owner = authOwner(req, res);
  if (!owner) return true;
  try {
    if (req.method === 'GET' && pathname === '/api/instructors') return await listInstructors(req, res, owner), true;
    if (req.method === 'POST' && pathname === '/api/instructors') return await saveInstructor(req, res, owner), true;
    if (req.method === 'PUT' && pathname.startsWith('/api/instructors/')) {
      const id = pathname.split('/').pop();
      if (id && id !== 'daily') return await saveInstructor(req, res, owner, decodeURIComponent(id)), true;
    }
    const dailyMatch = pathname.match(/^\/api\/instructors\/([^/]+)\/daily$/);
    if (req.method === 'GET' && dailyMatch) return await dailyInstructor(req, res, owner, decodeURIComponent(dailyMatch[1])), true;
    if (req.method === 'GET' && pathname === '/api/vehicle-lookup') return await vehicleLookup(req, res, owner), true;
    if (req.method === 'POST' && pathname === '/api/sessions/start-v3') return await startV3(req, res, owner), true;
    if (req.method === 'GET' && pathname === '/api/sessions/active-v3') return await activeV3(req, res, owner), true;
    return false;
  } catch (e) {
    console.error('V3 route:', e);
    json(res, 500, { error: e.message || 'V3 server xatosi' });
    return true;
  }
}
