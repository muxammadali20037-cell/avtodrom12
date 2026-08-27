import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { pool } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
const text = v => String(v ?? '').trim();
const num = v => Number.isFinite(Number(v)) ? Number(v) : 0;

function json(res, status, data) {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function owner(req) {
  try {
    const h = req.headers?.authorization || '';
    if (!h.startsWith('Bearer ')) return null;
    return String(jwt.verify(h.slice(7), JWT_SECRET).sub || '');
  } catch { return null; }
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return await new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', c => raw += c);
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('JSON noto‘g‘ri')); } });
    req.on('error', reject);
  });
}

function cleanPlate(raw) {
  return text(raw).toUpperCase().replace(/\s+/g, '');
}

function plateParts(raw) {
  const p = cleanPlate(raw);
  if (/^[A-Z]\d{3}[A-Z]{2}$/.test(p)) return { body: p, first_letter: p[0], number: p.slice(1, 4), last_letters: p.slice(4, 6) };
  if (/^\d{3}[A-Z]{3}$/.test(p)) return { body: p, first_letter: p[3], number: p.slice(0, 3), last_letters: p.slice(4, 6) };
  const m = p.match(/^(\d{2})([A-Z])(\d{3})([A-Z]{2})$/);
  if (m) return { region: m[1], body: p.slice(2), first_letter: m[2], number: m[3], last_letters: m[4] };
  return null;
}

async function ensureOwnerSettings() { /* intentionally empty: user_settings is managed by the main server */ }

async function instructorRows(user, id = null) {
  const params = [user];
  let where = `(
    (i.settings->>'owner_key')=$1
    OR EXISTS (SELECT 1 FROM vehicles vx WHERE vx.avtodrom_instructor_id=i.id AND vx.user_id=$1)
    OR EXISTS (SELECT 1 FROM sessions sx WHERE sx.avtodrom_instructor_id=i.id AND sx.user_id=$1)
  )`;
  if (id) { params.push(String(id)); where += ` AND i.id=$${params.length}`; }
  const r = await pool.query(`
    SELECT i.id,i.profile_id,i.active,i.approved,i.approved_at,i.approved_by,i.bio,i.category,i.experience_years,i.settings,i.created_at,i.updated_at,
      COALESCE(NULLIF(TRIM(CONCAT_WS(' ',p.first_name,p.last_name)),''),i.bio,'Instruktor') AS full_name,
      p.phone,p.username,p.telegram_id,
      i.settings->>'school_id' AS school_id,
      i.settings->>'group_id' AS group_id,
      i.settings->>'vehicle_id' AS vehicle_id,
      i.settings->>'vehicle_plate' AS stored_vehicle_plate,
      i.settings->>'vehicle_model' AS stored_vehicle_model,
      ds.name AS school_name,
      sg.name AS group_name,
      COALESCE(v.linked_plate, i.settings->>'vehicle_plate','') AS vehicle_plate,
      COALESCE(v.linked_model, i.settings->>'vehicle_model','') AS vehicle_model
    FROM instructors i
    LEFT JOIN profiles p ON p.id=i.profile_id
    LEFT JOIN driving_schools ds ON ds.id::text=(i.settings->>'school_id') AND ds.owner_key=$1
    LEFT JOIN school_groups sg ON sg.id::text=(i.settings->>'group_id') AND sg.owner_key=$1
    LEFT JOIN LATERAL (
      SELECT vv.plate AS linked_plate,vv.model AS linked_model
      FROM vehicles vv
      WHERE vv.user_id=$1 AND vv.avtodrom_instructor_id=i.id
      ORDER BY vv.updated_at DESC NULLS LAST,vv.created_at DESC
      LIMIT 1
    ) v ON TRUE
    WHERE ${where}
    ORDER BY full_name ASC
  `, params);
  return r.rows;
}

export async function handleInstructorRequest(req, res, forcedId = null) {
  const user = owner(req);
  if (!user) { json(res, 401, { error: 'Kirish talab qilinadi' }); return true; }

  try {
    await ensureOwnerSettings();

    if (req.method === 'GET' && !forcedId) {
      return json(res, 200, await instructorRows(user));
    }

    if (req.method === 'GET' && forcedId) {
      const rows = await instructorRows(user, forcedId);
      if (!rows[0]) return json(res, 404, { error: 'Instruktor topilmadi' });
      return json(res, 200, rows[0]);
    }

    if ((req.method === 'POST' && !forcedId) || (req.method === 'PUT' && forcedId)) {
      const b = await readBody(req);
      const fullName = text(b.fullName || b.name);
      const phone = text(b.phone);
      const schoolId = text(b.schoolId);
      const groupId = text(b.groupId) || null;
      const vehiclePlate = text(b.vehiclePlate || b.plate).toUpperCase();
      const vehicleModel = text(b.vehicleModel || b.model);
      const active = b.active !== false;

      if (!fullName) return json(res, 400, { error: 'F.I.Sh. kerak' });
      if (!schoolId) return json(res, 400, { error: 'Avtoshkolani tanlang' });

      const school = await pool.query(`SELECT id,name FROM driving_schools WHERE id=$1 AND owner_key=$2 AND active=true`, [schoolId, user]);
      if (!school.rows[0]) return json(res, 400, { error: 'Avtoshkola topilmadi' });
      let groupName = '';
      if (groupId) {
        const g = await pool.query(`SELECT id,name FROM school_groups WHERE id=$1 AND school_id=$2 AND owner_key=$3 AND active=true`, [groupId, schoolId, user]);
        if (!g.rows[0]) return json(res, 400, { error: 'Guruh noto‘g‘ri' });
        groupName = g.rows[0].name;
      }

      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        let instructorId = forcedId ? String(forcedId) : crypto.randomUUID();
        let profileId = null;

        if (forcedId) {
          const current = await c.query(`SELECT id,profile_id FROM instructors WHERE id=$1 FOR UPDATE`, [instructorId]);
          if (!current.rows[0]) { await c.query('ROLLBACK'); return json(res, 404, { error: 'Instruktor topilmadi' }); }
          profileId = current.rows[0].profile_id;
        } else {
          profileId = crypto.randomUUID();
          await c.query(`INSERT INTO profiles(id,first_name,last_name,phone,role) VALUES($1,$2,$3,$4,'instructor')`, [profileId, fullName.split(/\s+/)[0] || fullName, fullName.split(/\s+/).slice(1).join(' ') || null, phone || null]);
          await c.query(`INSERT INTO instructors(id,profile_id,active,approved,approved_at,approved_by,bio,category,experience_years,settings) VALUES($1,$2,$3,true,NOW(),$4,$5,$6,$7,$8)`, [instructorId, profileId, active, user, b.bio || null, b.category || null, Math.max(0, Math.floor(num(b.experienceYears))), JSON.stringify({ owner_key:user, school_id:schoolId, group_id:groupId, vehicle_plate:vehiclePlate, vehicle_model:vehicleModel })]);
        }

        if (forcedId) {
          const parts = fullName.split(/\s+/).filter(Boolean);
          await c.query(`UPDATE profiles SET first_name=$1,last_name=$2,phone=COALESCE($3,phone),updated_at=NOW() WHERE id=$4`, [parts.shift() || fullName, parts.join(' ') || null, phone || null, profileId]);
          await c.query(`UPDATE instructors SET active=$1,updated_at=NOW(),settings=COALESCE(settings,'{}'::jsonb)||$2::jsonb WHERE id=$3`, [active, JSON.stringify({owner_key:user,school_id:schoolId,group_id:groupId,vehicle_plate:vehiclePlate,vehicle_model:vehicleModel}), instructorId]);
        }

        if (vehiclePlate) {
          const pp = plateParts(vehiclePlate);
          let vehicleId = null;
          const normalized = cleanPlate(vehiclePlate);
          const found = await c.query(`SELECT id FROM vehicles WHERE user_id=$1 AND REPLACE(UPPER(plate),' ','')=$2 LIMIT 1`, [user, normalized]);
          if (found.rows[0]) vehicleId = found.rows[0].id;
          else if (pp?.region) {
            const inserted = await c.query(`INSERT INTO vehicles(user_id,region_code,first_letter,number,last_letters,plate,model,driver_name,avtodrom_instructor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [user,pp.region,pp.first_letter,pp.number,pp.last_letters,`${pp.region} ${pp.first_letter} ${pp.number} ${pp.last_letters}`,vehicleModel || null,fullName,instructorId]);
            vehicleId = inserted.rows[0].id;
          }
          if (vehicleId) {
            await c.query(`UPDATE vehicles SET avtodrom_instructor_id=NULL,updated_at=NOW() WHERE user_id=$1 AND avtodrom_instructor_id=$2 AND id<>$3`, [user,instructorId,vehicleId]);
            await c.query(`UPDATE vehicles SET avtodrom_instructor_id=$1,model=COALESCE(NULLIF($2,''),model),driver_name=$3,updated_at=NOW() WHERE id=$4 AND user_id=$5`, [instructorId,vehicleModel,fullName,vehicleId,user]);
            await c.query(`UPDATE instructors SET settings=COALESCE(settings,'{}'::jsonb)||$1::jsonb WHERE id=$2`, [JSON.stringify({vehicle_id:String(vehicleId),vehicle_plate:vehiclePlate,vehicle_model:vehicleModel,owner_key:user,school_id:schoolId,group_id:groupId}),instructorId]);
          }
        } else {
          await c.query(`UPDATE vehicles SET avtodrom_instructor_id=NULL,updated_at=NOW() WHERE user_id=$1 AND avtodrom_instructor_id=$2`, [user,instructorId]);
        }

        await c.query('COMMIT');
        const row = (await instructorRows(user,instructorId))[0];
        return json(res, forcedId ? 200 : 201, row || { id: instructorId, full_name: fullName, phone, school_id: schoolId, group_id: groupId, school_name: school.rows[0].name, group_name: groupName, vehicle_plate: vehiclePlate, vehicle_model: vehicleModel, active });
      } catch (e) {
        try { await c.query('ROLLBACK'); } catch {}
        throw e;
      } finally { c.release(); }
    }

    if (req.method === 'DELETE' && forcedId) {
      const id = String(forcedId);
      const exists = await instructorRows(user,id);
      if (!exists[0]) return json(res,404,{error:'Instruktor topilmadi'});
      await pool.query(`UPDATE instructors SET active=false,updated_at=NOW() WHERE id=$1`,[id]);
      return json(res,200,{ok:true});
    }

    return json(res,405,{error:'Method ruxsat etilmagan'});
  } catch (e) {
    console.error('INSTRUCTOR ROUTE ERROR:', e);
    return json(res,500,{error:e.message || 'Instruktor API xatosi'});
  }
}

export async function handleInstructorDaily(req,res,id) {
  const user = owner(req);
  if (!user) { json(res,401,{error:'Kirish talab qilinadi'}); return true; }
  try {
    const rows = await pool.query(`
      SELECT s.id,s.started_at,s.finished_at,s.duration_seconds,s.amount,s.status,
             v.plate,v.model,v.driver_name,st.full_name AS student_name,
             ds.name AS school_name,g.name AS group_name
      FROM sessions s
      JOIN vehicles v ON v.id=s.vehicle_id
      LEFT JOIN students st ON st.id=s.student_id
      LEFT JOIN driving_schools ds ON ds.id=s.school_id
      LEFT JOIN school_groups g ON g.id=s.group_id
      WHERE s.user_id=$1 AND s.avtodrom_instructor_id=$2
        AND s.started_at::date=COALESCE(NULLIF($3,''),CURRENT_DATE)
      ORDER BY s.started_at DESC
    `,[user,String(id),new URL(req.url,'http://localhost').searchParams.get('date') || '']);
    const inst=(await instructorRows(user,id))[0] || {id:String(id),full_name:'Instruktor'};
    return json(res,200,{instructor:inst,rows:rows.rows});
  } catch(e) { return json(res,500,{error:e.message || 'Instruktor hisoboti xatosi'}); }
}

export async function handleActiveV3(req,res) {
  const user=owner(req);
  if(!user){json(res,401,{error:'Kirish talab qilinadi'});return true;}
  if(req.method!=='GET'){json(res,405,{error:'Method ruxsat etilmagan'});return true;}
  try {
    const r=await pool.query(`
      SELECT s.id,s.vehicle_id,s.started_at,s.finished_at,s.duration_seconds,s.hourly_rate,s.minimum_payment,s.amount,
             s.status,s.payment_method,s.cash_amount,s.terminal_amount,s.school_id,s.group_id,s.student_id,
             s.manual_price,s.planned_minutes,s.avtodrom_instructor_id,s.customer_type,s.created_at,s.updated_at,
             v.plate,v.region_code,v.first_letter,v.number,v.last_letters,v.model,v.driver_name,
             ds.name AS school_name,g.name AS group_name,st.full_name AS student_name,
             COALESCE(NULLIF(TRIM(CONCAT_WS(' ',p.first_name,p.last_name)),''),i.bio,'') AS instructor_name,
             p.phone AS instructor_phone
      FROM sessions s
      JOIN vehicles v ON v.id=s.vehicle_id
      LEFT JOIN driving_schools ds ON ds.id=s.school_id
      LEFT JOIN school_groups g ON g.id=s.group_id
      LEFT JOIN students st ON st.id=s.student_id
      LEFT JOIN instructors i ON i.id=s.avtodrom_instructor_id
      LEFT JOIN profiles p ON p.id=i.profile_id
      WHERE s.user_id=$1 AND s.status IN ('active','paused','frozen')
      ORDER BY s.started_at ASC
    `,[user]);
    return json(res,200,r.rows);
  } catch(e) {
    console.error('ACTIVE V3 ERROR:',e);
    return json(res,500,{error:e.message || 'Faol sessiyalarni olishda xatolik'});
  }
}
