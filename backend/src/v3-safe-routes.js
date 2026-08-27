import jwt from 'jsonwebtoken';
import { pool } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';

function ownerId(req) {
  try {
    const h = req.headers?.authorization || '';
    if (!h.startsWith('Bearer ')) return null;
    return String(jwt.verify(h.slice(7), JWT_SECRET).sub || '');
  } catch { return null; }
}

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function auth(req, res) {
  const id = ownerId(req);
  if (!id) {
    json(res, 401, { error: 'Kirish talab qilinadi' });
    return null;
  }
  return id;
}

async function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return await new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', c => raw += c);
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { reject(new Error('JSON noto‘g‘ri')); }
    });
    req.on('error', reject);
  });
}

const text = v => String(v ?? '').trim();
const num = v => Number.isFinite(Number(v)) ? Number(v) : 0;

function plateFromBody(b) {
  const region = text(b.regionCode).toUpperCase();
  const firstLetter = text(b.firstLetter).toUpperCase();
  const number = text(b.number);
  const lastLetters = text(b.lastLetters).toUpperCase();
  const regions = ['01','10','20','25','30','40','50','60','70','75','80','85','90','95'];

  if (!regions.includes(region)) throw new Error('Viloyat kodi noto‘g‘ri');
  if (!/^[A-Z]$/.test(firstLetter)) throw new Error('Birinchi harf noto‘g‘ri');
  if (!/^\d{3}$/.test(number)) throw new Error('Avtomobil raqami 3 xonali bo‘lishi kerak');
  if (!/^[A-Z]{2}$/.test(lastLetters)) throw new Error('Oxirgi harflar noto‘g‘ri');

  return {
    region,
    firstLetter,
    number,
    lastLetters,
    plate: `${region} ${firstLetter} ${number} ${lastLetters}`
  };
}

function plateQuery(raw) {
  const q = text(raw).toUpperCase().replace(/\s+/g, '');
  const m = q.match(/^(\d{2})([A-Z])(\d{3})([A-Z]{2})$/);
  return m ? `${m[1]} ${m[2]} ${m[3]} ${m[4]}` : null;
}

/* =========================================================
   INSTRUCTORS
   Real schema:
   instructors(id, profile_id, active, approved, ...)
   profiles(id, first_name, last_name, phone, ...)
   No avtodrom_instructors table is used.
   ========================================================= */

async function listInstructors(owner, res) {
  const r = await pool.query(`
    SELECT
      i.id,
      COALESCE(
        NULLIF(TRIM(CONCAT_WS(' ', p.first_name, p.last_name)), ''),
        i.bio,
        i.id
      ) AS full_name,
      p.phone,
      p.username,
      p.telegram_id,
      i.active,
      i.approved,
      v.id AS vehicle_id,
      v.plate AS vehicle_plate,
      v.model AS vehicle_model
    FROM instructors i
    LEFT JOIN profiles p
      ON p.id = i.profile_id
    LEFT JOIN LATERAL (
      SELECT id, plate, model
      FROM vehicles
      WHERE user_id = $1
        AND avtodrom_instructor_id = i.id
      ORDER BY created_at DESC
      LIMIT 1
    ) v ON TRUE
    WHERE i.active = TRUE
      AND i.approved = TRUE
    ORDER BY full_name ASC
  `, [owner]);

  return json(res, 200, r.rows);
}

async function saveInstructor(owner, res, req, id = null) {
  const b = await body(req);
  const instructorId = text(id || b.instructorId || b.id);
  const fullName = text(b.fullName);
  const phone = text(b.phone) || null;
  const plate = text(b.vehiclePlate).toUpperCase();
  const active = b.active !== false;

  if (!instructorId) {
    return json(res, 400, {
      error: 'Instruktor ID kerak'
    });
  }

  const c = await pool.connect();
  try {
    await c.query('BEGIN');

    const current = await c.query(`
      SELECT i.*, p.id AS profile_id_real
      FROM instructors i
      LEFT JOIN profiles p ON p.id = i.profile_id
      WHERE i.id = $1
      FOR UPDATE
    `, [instructorId]);

    if (!current.rows[0]) {
      await c.query('ROLLBACK');
      return json(res, 404, { error: 'Instruktor topilmadi' });
    }

    let vehicleId = null;

    if (plate) {
      const normalized = plateQuery(plate);
      const q = normalized
        ? await c.query(`
            SELECT id
            FROM vehicles
            WHERE user_id = $1 AND plate = $2
            LIMIT 1
          `, [owner, normalized])
        : await c.query(`
            SELECT id
            FROM vehicles
            WHERE user_id = $1
              AND REPLACE(UPPER(plate), ' ', '') = REPLACE($2, ' ', '')
            LIMIT 1
          `, [owner, plate]);

      if (!q.rows[0]) {
        await c.query('ROLLBACK');
        return json(res, 404, {
          error: 'Bu avtomobil topilmadi. Avval avtomobilni bazaga qo‘shing.'
        });
      }

      vehicleId = q.rows[0].id;
    }

    const profileId = current.rows[0].profile_id_real;

    if (profileId && (fullName || phone !== null)) {
      const parts = fullName.split(/\s+/).filter(Boolean);
      const firstName = parts.shift() || null;
      const lastName = parts.join(' ') || null;

      await c.query(`
        UPDATE profiles
        SET
          first_name = COALESCE($1, first_name),
          last_name = COALESCE($2, last_name),
          phone = COALESCE($3, phone),
          updated_at = NOW()
        WHERE id = $4
      `, [firstName, lastName, phone, profileId]);
    }

    await c.query(`
      UPDATE instructors
      SET active = $1, updated_at = NOW()
      WHERE id = $2
    `, [active, instructorId]);

    if (vehicleId) {
      await c.query(`
        UPDATE vehicles
        SET avtodrom_instructor_id = NULL, updated_at = NOW()
        WHERE user_id = $1
          AND avtodrom_instructor_id IS NOT NULL
          AND avtodrom_instructor_id <> $2
          AND id = $3
      `, [owner, instructorId, vehicleId]);

      await c.query(`
        UPDATE vehicles
        SET avtodrom_instructor_id = $1, updated_at = NOW()
        WHERE id = $2 AND user_id = $3
      `, [instructorId, vehicleId, owner]);
    } else if (b.vehiclePlate !== undefined) {
      await c.query(`
        UPDATE vehicles
        SET avtodrom_instructor_id = NULL, updated_at = NOW()
        WHERE user_id = $1
          AND avtodrom_instructor_id = $2
      `, [owner, instructorId]);
    }

    await c.query('COMMIT');

    const result = await pool.query(`
      SELECT
        i.id,
        COALESCE(
          NULLIF(TRIM(CONCAT_WS(' ', p.first_name, p.last_name)), ''),
          i.bio,
          i.id
        ) AS full_name,
        p.phone,
        i.active,
        i.approved,
        v.id AS vehicle_id,
        v.plate AS vehicle_plate,
        v.model AS vehicle_model
      FROM instructors i
      LEFT JOIN profiles p ON p.id = i.profile_id
      LEFT JOIN LATERAL (
        SELECT id, plate, model
        FROM vehicles
        WHERE user_id = $1
          AND avtodrom_instructor_id = i.id
        ORDER BY created_at DESC
        LIMIT 1
      ) v ON TRUE
      WHERE i.id = $2
      LIMIT 1
    `, [owner, instructorId]);

    return json(res, 200, result.rows[0]);
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch {}
    return json(res, 400, {
      error: e.message || 'Instruktorni saqlashda xatolik'
    });
  } finally {
    c.release();
  }
}

async function vehicleLookup(owner, res, req) {
  const raw = text(new URL(req.url, 'http://localhost').searchParams.get('plate') || '');
  const plate = plateQuery(raw);

  const r = plate
    ? await pool.query(`
        SELECT
          v.id,
          v.plate,
          v.model,
          v.driver_name,
          v.avtodrom_instructor_id AS instructor_id,
          COALESCE(
            NULLIF(TRIM(CONCAT_WS(' ', p.first_name, p.last_name)), ''),
            i.bio,
            i.id
          ) AS instructor_name
        FROM vehicles v
        LEFT JOIN instructors i
          ON i.id = v.avtodrom_instructor_id
        LEFT JOIN profiles p
          ON p.id = i.profile_id
        WHERE v.user_id = $1
          AND v.plate = $2
        LIMIT 1
      `, [owner, plate])
    : await pool.query(`
        SELECT
          v.id,
          v.plate,
          v.model,
          v.driver_name,
          v.avtodrom_instructor_id AS instructor_id,
          COALESCE(
            NULLIF(TRIM(CONCAT_WS(' ', p.first_name, p.last_name)), ''),
            i.bio,
            i.id
          ) AS instructor_name
        FROM vehicles v
        LEFT JOIN instructors i
          ON i.id = v.avtodrom_instructor_id
        LEFT JOIN profiles p
          ON p.id = i.profile_id
        WHERE v.user_id = $1
          AND REPLACE(UPPER(v.plate), ' ', '') = REPLACE(UPPER($2), ' ', '')
        LIMIT 1
      `, [owner, raw]);

  return json(res, 200, r.rows[0] || null);
}

async function startV3(owner, res, req) {
  const b = await body(req);

  let p;
  try {
    p = plateFromBody(b);
  } catch (e) {
    return json(res, 400, { error: e.message });
  }

  const planned = Math.floor(num(b.plannedMinutes || b.durationMinutes));
  if (planned <= 0 || planned > 1440) {
    return json(res, 400, {
      error: 'Avtodromda bo‘lish vaqti 1 daqiqadan 24 soatgacha bo‘lishi kerak'
    });
  }

  const customerType = text(b.customerType).toLowerCase() === 'school'
    ? 'school'
    : 'ordinary';

  const c = await pool.connect();
  try {
    await c.query('BEGIN');

    let vr = await c.query(`
      SELECT *
      FROM vehicles
      WHERE user_id = $1 AND plate = $2
      LIMIT 1
    `, [owner, p.plate]);

    let v = vr.rows[0];

    if (!v) {
      vr = await c.query(`
        INSERT INTO vehicles(
          user_id,
          region_code,
          first_letter,
          number,
          last_letters,
          plate,
          model,
          driver_name
        )
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING *
      `, [
        owner,
        p.region,
        p.firstLetter,
        p.number,
        p.lastLetters,
        p.plate,
        b.model || null,
        b.driverName || null
      ]);
      v = vr.rows[0];
    } else if (b.model || b.driverName) {
      await c.query(`
        UPDATE vehicles
        SET
          model = COALESCE($1, model),
          driver_name = COALESCE($2, driver_name),
          updated_at = NOW()
        WHERE id = $3 AND user_id = $4
      `, [b.model || null, b.driverName || null, v.id, owner]);
    }

    let instructorId = text(b.instructorId) || null;
    if (!instructorId && v.avtodrom_instructor_id) {
      instructorId = String(v.avtodrom_instructor_id);
    }

    if (instructorId) {
      const ir = await c.query(`
        SELECT id
        FROM instructors
        WHERE id = $1
          AND active = TRUE
          AND approved = TRUE
        LIMIT 1
      `, [instructorId]);

      if (!ir.rows[0]) instructorId = null;
    }

    let schoolId = text(b.schoolId) || null;
    let groupId = text(b.groupId) || null;
    let studentId = text(b.studentId) || null;

    if (customerType === 'school') {
      if (!schoolId || !groupId || !studentId) {
        await c.query('ROLLBACK');
        return json(res, 400, {
          error: 'Avtoshkola, guruh va o‘quvchini tanlang.'
        });
      }

      const sr = await c.query(`
        SELECT id, school_id, group_id
        FROM students
        WHERE id = $1
          AND owner_key = $2
          AND active = TRUE
      `, [studentId, owner]);

      if (!sr.rows[0]) {
        await c.query('ROLLBACK');
        return json(res, 404, { error: 'O‘quvchi topilmadi' });
      }

      schoolId = sr.rows[0].school_id;
      groupId = sr.rows[0].group_id;
    } else {
      schoolId = null;
      groupId = null;
      studentId = null;
    }

    const active = await c.query(`
      SELECT id, status
      FROM sessions
      WHERE user_id = $1
        AND vehicle_id = $2
        AND status IN ('active','paused','frozen')
      LIMIT 1
    `, [owner, v.id]);

    if (active.rows[0]) {
      await c.query('ROLLBACK');
      return json(res, 409, {
        error: 'Bu avtomobil hozir jarayonda',
        activeSessionId: active.rows[0].id
      });
    }

    const set = await c.query(`
      SELECT hourly_rate
      FROM user_settings
      WHERE user_id = $1
      LIMIT 1
    `, [owner]);

    const hourlyRate = Number(set.rows[0]?.hourly_rate || 30000);

    const r = await c.query(`
      INSERT INTO sessions(
        user_id,
        vehicle_id,
        hourly_rate,
        minimum_payment,
        calculation_mode,
        school_id,
        group_id,
        student_id,
        manual_price,
        planned_minutes,
        avtodrom_instructor_id,
        customer_type,
        status
      )
      VALUES(
        $1,$2,$3,0,'minute',$4,$5,$6,false,$7,$8,$9,'active'
      )
      RETURNING id, started_at
    `, [
      owner,
      v.id,
      hourlyRate,
      schoolId,
      groupId,
      studentId,
      planned,
      instructorId,
      customerType
    ]);

    await c.query('COMMIT');

    return json(res, 201, {
      id: r.rows[0].id,
      plate: v.plate,
      startedAt: r.rows[0].started_at,
      plannedMinutes: planned,
      instructorId,
      customerType
    });
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch {}
    return json(res, 400, {
      error: e.message || 'START bajarilmadi'
    });
  } finally {
    c.release();
  }
}

async function activeV3(owner, res) {
  const r = await pool.query(`
    SELECT
      se.id,
      se.started_at,
      se.finished_at,
      se.status,
      se.duration_seconds,
      se.amount,
      se.hourly_rate,
      se.planned_minutes,
      se.customer_type,
      se.avtodrom_instructor_id AS instructor_id,
      v.plate,
      v.model,
      v.driver_name,
      COALESCE(
        NULLIF(TRIM(CONCAT_WS(' ', p.first_name, p.last_name)), ''),
        i.bio,
        i.id
      ) AS instructor_name,
      se.school_id,
      se.group_id,
      se.student_id,
      ds.name AS school_name,
      g.name AS group_name,
      st.full_name AS student_name
    FROM sessions se
    JOIN vehicles v
      ON v.id = se.vehicle_id
    LEFT JOIN instructors i
      ON i.id = se.avtodrom_instructor_id
    LEFT JOIN profiles p
      ON p.id = i.profile_id
    LEFT JOIN driving_schools ds
      ON ds.id = se.school_id
    LEFT JOIN school_groups g
      ON g.id = se.group_id
    LEFT JOIN students st
      ON st.id = se.student_id
    WHERE se.user_id = $1
      AND se.status IN ('active','paused','frozen')
    ORDER BY se.started_at
  `, [owner]);

  return json(res, 200, r.rows.map(x => ({
    ...x,
    customer_type: x.customer_type || (x.student_id ? 'school' : 'ordinary')
  })));
}

async function daily(owner, res, req, id) {
  const date = text(
    new URL(req.url, 'http://localhost').searchParams.get('date')
  ) || new Date().toISOString().slice(0, 10);

  const ir = await pool.query(`
    SELECT
      i.id,
      COALESCE(
        NULLIF(TRIM(CONCAT_WS(' ', p.first_name, p.last_name)), ''),
        i.bio,
        i.id
      ) AS full_name,
      p.phone,
      i.active,
      v.plate AS vehicle_plate,
      v.model AS vehicle_model
    FROM instructors i
    LEFT JOIN profiles p
      ON p.id = i.profile_id
    LEFT JOIN LATERAL (
      SELECT plate, model
      FROM vehicles
      WHERE user_id = $1
        AND avtodrom_instructor_id = i.id
      ORDER BY created_at DESC
      LIMIT 1
    ) v ON TRUE
    WHERE i.id = $2
    LIMIT 1
  `, [owner, id]);

  if (!ir.rows[0]) {
    return json(res, 404, { error: 'Instruktor topilmadi' });
  }

  const r = await pool.query(`
    SELECT
      se.id,
      se.started_at,
      se.finished_at,
      se.status,
      se.planned_minutes,
      se.duration_seconds,
      se.amount,
      se.hourly_rate,
      se.customer_type,
      v.plate,
      v.model,
      ds.name AS school_name,
      g.name AS group_name,
      st.full_name AS student_name
    FROM sessions se
    JOIN vehicles v
      ON v.id = se.vehicle_id
    LEFT JOIN driving_schools ds
      ON ds.id = se.school_id
    LEFT JOIN school_groups g
      ON g.id = se.group_id
    LEFT JOIN students st
      ON st.id = se.student_id
    WHERE se.user_id = $1
      AND se.avtodrom_instructor_id = $2
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
    total_minutes: rows.reduce((a, x) => a + x.duration_minutes, 0),
    total_amount: rows.reduce((a, x) => a + x.amount, 0)
  };

  return json(res, 200, {
    date,
    instructor: ir.rows[0],
    summary,
    rows
  });
}

export async function handleSafeV3(req, res) {
  const path = String(req.url || '').split('?')[0];

  if (!path.startsWith('/api/')) return false;

  const owner = auth(req, res);
  if (!owner) return true;

  try {
    if (req.method === 'GET' && path === '/api/instructors') {
      return await listInstructors(owner, res), true;
    }

    if (req.method === 'POST' && path === '/api/instructors') {
      return await saveInstructor(owner, res, req), true;
    }

    const dailyMatch = path.match(/^\/api\/instructors\/([^/]+)\/daily$/);
    if (req.method === 'GET' && dailyMatch) {
      return await daily(owner, res, req, decodeURIComponent(dailyMatch[1])), true;
    }

    const instructorMatch = path.match(/^\/api\/instructors\/([^/]+)$/);
    if (req.method === 'PUT' && instructorMatch) {
      return await saveInstructor(
        owner,
        res,
        req,
        decodeURIComponent(instructorMatch[1])
      ), true;
    }

    if (req.method === 'GET' && path === '/api/vehicle-lookup') {
      return await vehicleLookup(owner, res, req), true;
    }

    if (req.method === 'POST' && path === '/api/sessions/start-v3') {
      return await startV3(owner, res, req), true;
    }

    if (req.method === 'GET' && path === '/api/sessions/active-v3') {
      return await activeV3(owner, res), true;
    }

    return false;
  } catch (e) {
    console.error('SAFE V3:', e);
    json(res, 500, {
      error: e.message || 'V3 server xatosi'
    });
    return true;
  }
}
