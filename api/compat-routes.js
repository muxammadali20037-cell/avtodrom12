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
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_students_birth_date ON students(birth_date)`);
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

function parsePlate(regionCode, raw) {
  const region = String(regionCode || '').trim();
  const body = String(raw || '').replace(/\s+/g, '').toUpperCase();
  const regions = ['01','10','20','25','30','40','50','60','70','75','80','85','90','95'];
  if (!regions.includes(region)) throw new Error('Viloyat kodi noto‘g‘ri');
  if (!/^[A-Z0-9]{6}$/.test(body)) throw new Error('Raqam 6 ta belgi bo‘lishi kerak. Masalan: 111QQQ yoki A555AA');

  if (/^\d{3}[A-Z]{3}$/.test(body)) {
    return {
      region,
      body,
      firstLetter: body[3],
      number: body.slice(0,3),
      lastLetters: body.slice(4,6),
      plate: `${region} ${body}`
    };
  }
  if (/^[A-Z]\d{3}[A-Z]{2}$/.test(body)) {
    return {
      region,
      body,
      firstLetter: body[0],
      number: body.slice(1,4),
      lastLetters: body.slice(4,6),
      plate: `${region} ${body}`
    };
  }
  throw new Error('Raqam formati noto‘g‘ri. Masalan: 111QQQ yoki A555AA');
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

    // ===== START: compact plate is stored exactly as typed =====
    if (req.method === 'POST' && pathname === '/api/sessions/start') {
      const body = bodyOf(req);
      let p;
      try {
        p = parsePlate(body.regionCode, body.plateBody || body.plate);
      } catch (e) {
        send(res, 400, { error: e.message });
        return true;
      }

      const c = await pool.connect();
      try {
        await c.query('BEGIN');

        let vr = await c.query(`SELECT * FROM vehicles WHERE plate=$1 AND user_id=$2`, [p.plate, user]);
        let v = vr.rows[0];
        if (!v) {
          vr = await c.query(`
            INSERT INTO vehicles(
              user_id, region_code, first_letter, number, last_letters,
              plate, model, driver_name
            ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
            RETURNING *
          `, [user, p.region, p.firstLetter, p.number, p.lastLetters, p.plate, body.model || null, body.driverName || null]);
          v = vr.rows[0];
        } else {
          await c.query(`
            UPDATE vehicles
            SET model=COALESCE($1,model), driver_name=COALESCE($2,driver_name)
            WHERE id=$3 AND user_id=$4
          `, [body.model || null, body.driverName || null, v.id, user]);
        }

        let schoolId = body.schoolId ? String(body.schoolId) : null;
        let groupId = body.groupId ? String(body.groupId) : null;
        let studentId = body.studentId ? String(body.studentId) : null;

        if (studentId) {
          const sr = await c.query(`
            SELECT id,school_id,group_id
            FROM students
            WHERE id=$1 AND owner_key=$2 AND active=true
          `, [studentId, user]);
          if (!sr.rows[0]) throw new Error('O‘quvchi topilmadi');
          schoolId = sr.rows[0].school_id;
          groupId = sr.rows[0].group_id;
        }

        if (schoolId) {
          const sr = await c.query(`
            SELECT id FROM driving_schools
            WHERE id=$1 AND owner_key=$2 AND active=true
          `, [schoolId, user]);
          if (!sr.rows[0]) throw new Error('Avtoshkola topilmadi');
        }

        if (groupId) {
          const gr = await c.query(`
            SELECT id FROM school_groups
            WHERE id=$1 AND school_id=$2 AND owner_key=$3 AND active=true
          `, [groupId, schoolId, user]);
          if (!gr.rows[0]) throw new Error('Guruh noto‘g‘ri');
        }

        const active = await c.query(`
          SELECT id FROM sessions
          WHERE vehicle_id=$1 AND user_id=$2 AND status='active'
          LIMIT 1
        `, [v.id, user]);
        if (active.rows[0]) {
          await c.query('ROLLBACK');
          send(res, 409, { error: 'Bu avtomobil hozir jarayonda', activeSessionId: active.rows[0].id });
          return true;
        }

        const set = await c.query(`
          SELECT hourly_rate,minimum_payment,calculation_mode
          FROM user_settings WHERE user_id=$1
        `, [user]);
        const s = set.rows[0] || { hourly_rate:30000, minimum_payment:0, calculation_mode:'hour' };

        const r = await c.query(`
          INSERT INTO sessions(
            user_id,vehicle_id,hourly_rate,minimum_payment,calculation_mode,
            school_id,group_id,student_id,manual_price
          ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,true)
          RETURNING id,started_at
        `, [user,v.id,s.hourly_rate,s.minimum_payment,s.calculation_mode,schoolId,groupId,studentId]);

        await c.query('COMMIT');
        send(res, 201, {
          id:r.rows[0].id,
          plate:p.plate,
          plateBody:p.body,
          startedAt:r.rows[0].started_at,
          schoolId,groupId,studentId
        });
        return true;
      } catch (e) {
        try { await c.query('ROLLBACK'); } catch {}
        if (e.code === '23505') {
          send(res, 409, { error: 'Bu avtomobil hozir jarayonda' });
        } else {
          send(res, 400, { error: e.message || 'START bajarilmadi' });
        }
        return true;
      } finally {
        c.release();
      }
    }

    // ===== AVTOSHKOLA TAHRIRLASH =====
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

    // ===== O‘QUVCHI TAHRIRLASH =====
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
        SELECT id, school_id FROM students
        WHERE id=$1 AND owner_key=$2 AND active=true
      `, [id, user]);
      if (!current.rows[0]) {
        send(res, 404, { error: 'O‘quvchi topilmadi' });
        return true;
      }

      if (groupId) {
        const g = await pool.query(`
          SELECT id FROM school_groups
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
        SET full_name=$1,birth_date=$2,group_id=$3,
            manual_attendance_count=COALESCE($4,manual_attendance_count)
        WHERE id=$5 AND owner_key=$6
        RETURNING *
      `, [fullName,birthDate||null,groupId,attendanceValue,id,user]);

      send(res, 200, r.rows[0]);
      return true;
    }

    // ===== O‘QUVCHILAR RO‘YXATI =====
    if (req.method === 'GET' && pathname === '/api/students') {
      const q = new URL(req.url, 'http://localhost').searchParams;
      const params = [user];
      let where = 'st.owner_key=$1 AND st.active=true';
      if (q.get('schoolId')) { params.push(q.get('schoolId')); where += ` AND st.school_id=$${params.length}`; }
      if (q.get('groupId')) { params.push(q.get('groupId')); where += ` AND st.group_id=$${params.length}`; }

      const r = await pool.query(`
        SELECT st.id,st.owner_key,st.school_id,st.group_id,st.full_name,
               st.birth_date,st.phone,st.plate,st.notes,st.active,st.created_at,
               s.name school_name,g.name group_name,
               COALESCE(st.manual_attendance_count,0) attendance_count
        FROM students st
        JOIN driving_schools s ON s.id=st.school_id
        LEFT JOIN school_groups g ON g.id=st.group_id
        WHERE ${where}
        ORDER BY st.full_name
      `, params);
      send(res, 200, r.rows);
      return true;
    }

    // ===== OMMAVIY O‘QUVCHI QO‘SHISH: FAQAT 3 TA MAYDON =====
    if (req.method === 'POST' && pathname === '/api/student-bulk') {
      const body = bodyOf(req);
      const schoolId = String(body.schoolId || '').trim();
      const groupId = body.groupId ? String(body.groupId).trim() : null;
      const rows = Array.isArray(body.rows) ? body.rows : [];

      if (!schoolId) { send(res,400,{error:'Avtoshkola tanlanmagan'}); return true; }
      if (!rows.length) { send(res,400,{error:'O‘quvchilar ro‘yxati bo‘sh'}); return true; }

      const school = await pool.query(`
        SELECT id FROM driving_schools
        WHERE id=$1 AND owner_key=$2 AND active=true
      `,[schoolId,user]);
      if (!school.rows[0]) { send(res,404,{error:'Avtoshkola topilmadi'}); return true; }

      if (groupId) {
        const group = await pool.query(`
          SELECT id FROM school_groups
          WHERE id=$1 AND school_id=$2 AND owner_key=$3 AND active=true
        `,[groupId,schoolId,user]);
        if (!group.rows[0]) { send(res,400,{error:'Guruh noto‘g‘ri'}); return true; }
      }

      const errors=[];
      const valid=[];
      rows.forEach((row,index)=>{
        const fullName=String(row.fullName??'').trim();
        const birthDate=String(row.birthDate??'').trim();
        const lessons=Number(row.lessons??row.attendanceCount??0);
        if(!fullName){errors.push(`${index+1}-qator: F.I.Sh. kiritilmagan`);return;}
        if(!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)){errors.push(`${index+1}-qator: tug‘ilgan sana noto‘g‘ri`);return;}
        if(!Number.isInteger(lessons)||lessons<0){errors.push(`${index+1}-qator: darslar soni noto‘g‘ri`);return;}
        valid.push({fullName,birthDate,lessons});
      });

      if(!valid.length){send(res,400,{error:'Saqlash uchun to‘g‘ri ma’lumot topilmadi',errors});return true;}

      const c=await pool.connect();
      try{
        await c.query('BEGIN');
        for(const row of valid){
          await c.query(`
            INSERT INTO students(owner_key,school_id,group_id,full_name,birth_date,manual_attendance_count)
            VALUES($1,$2,$3,$4,$5,$6)
          `,[user,schoolId,groupId,row.fullName,row.birthDate,row.lessons]);
        }
        await c.query('COMMIT');
      }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}

      send(res,201,{ok:true,added:valid.length,errors});
      return true;
    }

    return false;
  } catch (error) {
    console.error('COMPAT ROUTE ERROR:', error);
    send(res,500,{error:'Ma’lumotni saqlashda server xatosi'});
    return true;
  }
}
