import jwt from 'jsonwebtoken';
import { pool } from '../backend/src/db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';

function bodyOf(req) {
  if (req?.body && typeof req.body === 'object') return req.body;
  if (typeof req?.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}

function userId(req) {
  try {
    const h = req.headers?.authorization || '';
    if (!h.startsWith('Bearer ')) return null;
    const token = jwt.verify(h.slice(7), JWT_SECRET);
    return String(token.sub);
  } catch {
    return null;
  }
}

let schemaPromise = null;
function ensureCompatSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await pool.query(`
        ALTER TABLE students
          ADD COLUMN IF NOT EXISTS birth_date DATE,
          ADD COLUMN IF NOT EXISTS manual_attendance_count INTEGER NOT NULL DEFAULT 0
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_students_birth_date ON students(birth_date)
      `);
    })().catch(error => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

function send(res, status, data) {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

export async function handleCompatRequest(req, res) {
  const pathname = String(req.url || '').split('?')[0];
  if (!pathname.startsWith('/api/')) return false;

  const user = userId(req);
  if (!user) {
    send(res, 401, { error: 'Kirish talab qilinadi' });
    return true;
  }

  try {
    await ensureCompatSchema();

    const schoolMatch = pathname.match(/^\/api\/schools\/([^/]+)$/);
    if (req.method === 'PATCH' && schoolMatch) {
      const id = schoolMatch[1];
      const body = bodyOf(req);
      const name = String(body.name ?? '').trim();
      const phone = String(body.phone ?? '').trim();
      const notes = body.notes == null ? null : String(body.notes);

      if (!name) {
        send(res, 400, { error: 'Avtoshkola nomi kerak' });
        return true;
      }

      const r = await pool.query(`
        UPDATE driving_schools
        SET name=$1, phone=$2, notes=$3
        WHERE id=$4 AND owner_key=$5
        RETURNING *
      `, [name, phone || null, notes, id, user]);

      if (!r.rows[0]) {
        send(res, 404, { error: 'Avtoshkola topilmadi' });
        return true;
      }

      send(res, 200, r.rows[0]);
      return true;
    }

    const studentMatch = pathname.match(/^\/api\/students\/([^/]+)$/);
    if (req.method === 'PATCH' && studentMatch) {
      const id = studentMatch[1];
      const body = bodyOf(req);
      const fullName = String(body.fullName ?? body.name ?? '').trim();
      const birthDate = body.birthDate ? String(body.birthDate).trim() : null;
      const groupId = body.groupId ? String(body.groupId) : null;
      const attendance = body.attendanceCount ?? body.lessons ?? body.manualAttendanceCount;

      if (!fullName) {
        send(res, 400, { error: 'F.I.Sh. kerak' });
        return true;
      }
      if (birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
        send(res, 400, { error: 'Tug‘ilgan sana noto‘g‘ri' });
        return true;
      }
      if (attendance !== undefined && (!Number.isInteger(Number(attendance)) || Number(attendance) < 0)) {
        send(res, 400, { error: 'Qatnashgan darslar soni noto‘g‘ri' });
        return true;
      }

      const current = await pool.query(`
        SELECT id, school_id
        FROM students
        WHERE id=$1 AND owner_key=$2 AND active=true
      `, [id, user]);
      if (!current.rows[0]) {
        send(res, 404, { error: 'O‘quvchi topilmadi' });
        return true;
      }

      if (groupId) {
        const g = await pool.query(`
          SELECT id
          FROM school_groups
          WHERE id=$1 AND school_id=$2 AND owner_key=$3 AND active=true
        `, [groupId, current.rows[0].school_id, user]);
        if (!g.rows[0]) {
          send(res, 400, { error: 'Guruh noto‘g‘ri' });
          return true;
        }
      }

      const attendanceValue = attendance === undefined ? null : Number(attendance);
      const r = await pool.query(`
        UPDATE students
        SET full_name=$1,
            birth_date=$2,
            group_id=$3,
            manual_attendance_count=COALESCE($4, manual_attendance_count)
        WHERE id=$5 AND owner_key=$6
        RETURNING *
      `, [fullName, birthDate || null, groupId, attendanceValue, id, user]);

      send(res, 200, r.rows[0]);
      return true;
    }

    if (req.method === 'GET' && pathname === '/api/students') {
      const q = new URL(req.url, 'http://localhost').searchParams;
      const params = [user];
      let where = 'st.owner_key=$1 AND st.active=true';

      if (q.get('schoolId')) {
        params.push(q.get('schoolId'));
        where += ` AND st.school_id=$${params.length}`;
      }
      if (q.get('groupId')) {
        params.push(q.get('groupId'));
        where += ` AND st.group_id=$${params.length}`;
      }

      const r = await pool.query(`
        SELECT
          st.id, st.owner_key, st.school_id, st.group_id, st.full_name,
          st.birth_date, st.phone, st.plate, st.notes, st.active,
          st.created_at,
          s.name AS school_name,
          g.name AS group_name,
          COALESCE(st.manual_attendance_count,0) AS attendance_count
        FROM students st
        JOIN driving_schools s ON s.id=st.school_id
        LEFT JOIN school_groups g ON g.id=st.group_id
        WHERE ${where}
        ORDER BY st.full_name
      `, params);

      send(res, 200, r.rows);
      return true;
    }

    if (req.method === 'POST' && pathname === '/api/student-bulk') {
      const body = bodyOf(req);
      const schoolId = String(body.schoolId || '').trim();
      const groupId = body.groupId ? String(body.groupId).trim() : null;
      const rows = Array.isArray(body.rows) ? body.rows : [];

      if (!schoolId) {
        send(res, 400, { error: 'Avtoshkola tanlanmagan' });
        return true;
      }
      if (!rows.length) {
        send(res, 400, { error: 'O‘quvchilar ro‘yxati bo‘sh' });
        return true;
      }

      const school = await pool.query(`
        SELECT id FROM driving_schools
        WHERE id=$1 AND owner_key=$2 AND active=true
      `, [schoolId, user]);
      if (!school.rows[0]) {
        send(res, 404, { error: 'Avtoshkola topilmadi' });
        return true;
      }

      if (groupId) {
        const group = await pool.query(`
          SELECT id FROM school_groups
          WHERE id=$1 AND school_id=$2 AND owner_key=$3 AND active=true
        `, [groupId, schoolId, user]);
        if (!group.rows[0]) {
          send(res, 400, { error: 'Guruh noto‘g‘ri' });
          return true;
        }
      }

      const errors = [];
      const valid = [];
      rows.forEach((row, index) => {
        const fullName = String(row.fullName ?? '').trim();
        const birthDate = String(row.birthDate ?? '').trim();
        const lessons = Number(row.lessons ?? row.attendanceCount ?? 0);

        if (!fullName) {
          errors.push(`${index + 1}-qator: F.I.Sh. kiritilmagan`);
          return;
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
          errors.push(`${index + 1}-qator: tug‘ilgan sana YYYY-MM-DD bo‘lishi kerak`);
          return;
        }
        if (!Number.isInteger(lessons) || lessons < 0) {
          errors.push(`${index + 1}-qator: darslar soni noto‘g‘ri`);
          return;
        }
        valid.push({ fullName, birthDate, lessons });
      });

      if (!valid.length) {
        send(res, 400, { error: 'Saqlash uchun to‘g‘ri ma’lumot topilmadi', errors });
        return true;
      }

      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        for (const row of valid) {
          await c.query(`
            INSERT INTO students(
              owner_key, school_id, group_id, full_name,
              birth_date, manual_attendance_count
            ) VALUES($1,$2,$3,$4,$5,$6)
          `, [user, schoolId, groupId, row.fullName, row.birthDate, row.lessons]);
        }
        await c.query('COMMIT');
      } catch (error) {
        await c.query('ROLLBACK');
        throw error;
      } finally {
        c.release();
      }

      send(res, 201, { ok: true, added: valid.length, errors });
      return true;
    }

    return false;
  } catch (error) {
    console.error('COMPAT ROUTE ERROR:', error);
    send(res, 500, { error: 'Ma’lumotni saqlashda server xatosi' });
    return true;
  }
}
