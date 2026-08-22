import jwt from 'jsonwebtoken';
import { pool } from '../backend/src/db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
const uid = req => String(req.user.sub);

function json(res, code, data){
  res.statusCode=code;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function auth(req,res){
  try{
    const h=req.headers.authorization||'';
    if(!h.startsWith('Bearer ')){
      json(res,401,{error:'Kirish talab qilinadi'});
      return false;
    }
    req.user=jwt.verify(h.slice(7),JWT_SECRET);
    return true;
  }catch{
    json(res,401,{error:'Sessiya yaroqsiz yoki tugagan'});
    return false;
  }
}

async function ensureSchema(){
  await pool.query(`
    ALTER TABLE public.students
    ADD COLUMN IF NOT EXISTS attendance_count integer NOT NULL DEFAULT 0
  `);
  await pool.query(`
    ALTER TABLE public.students
    DROP CONSTRAINT IF EXISTS students_attendance_count_nonnegative
  `);
  await pool.query(`
    ALTER TABLE public.students
    ADD CONSTRAINT students_attendance_count_nonnegative
    CHECK (attendance_count >= 0)
  `);
}

export default async function handler(req,res){
  if(req.method==='OPTIONS'){
    res.statusCode=204;
    return res.end();
  }
  if(!auth(req,res))return;

  try{
    await ensureSchema();
    const owner=uid(req);

    if(req.method==='GET'){
      const p=[owner];
      let w='st.owner_key=$1';

      if(req.query.schoolId){
        p.push(String(req.query.schoolId));
        w+=` AND st.school_id=$${p.length}`;
      }
      if(req.query.groupId){
        p.push(String(req.query.groupId));
        w+=` AND st.group_id=$${p.length}`;
      }

      const r=await pool.query(`
        SELECT
          st.*,
          s.name AS school_name,
          g.name AS group_name,
          COALESCE(st.attendance_count,0)::int AS attendance_count
        FROM public.students st
        JOIN public.driving_schools s ON s.id=st.school_id
        LEFT JOIN public.school_groups g ON g.id=st.group_id
        WHERE ${w}
        ORDER BY st.full_name,st.created_at
      `,p);

      return json(res,200,r.rows);
    }

    if(req.method==='POST'){
      const body=req.body||{};
      const schoolId=String(body.schoolId||'');
      const groupId=body.groupId?String(body.groupId):null;
      const name=String(body.fullName||'').trim();
      const phone=String(body.phone||'').trim()||null;
      const plate=String(body.plate||'').trim()||null;

      const rawAttendance = body.attendanceCount ?? body.attendance_count ?? 0;
      const parsedAttendance = Number(rawAttendance);
      const attendanceCount = Number.isFinite(parsedAttendance)
        ? Math.max(0,Math.min(999,Math.floor(parsedAttendance)))
        : 0;

      if(!schoolId||!name){
        return json(res,400,{error:'Avtoshkola va o‘quvchi ismi kerak'});
      }

      const s=await pool.query(`
        SELECT id
        FROM public.driving_schools
        WHERE id=$1 AND owner_key=$2 AND active=true
      `,[schoolId,owner]);

      if(!s.rows[0]){
        return json(res,404,{error:'Avtoshkola topilmadi'});
      }

      if(groupId){
        const g=await pool.query(`
          SELECT id
          FROM public.school_groups
          WHERE id=$1 AND school_id=$2 AND owner_key=$3 AND active=true
        `,[groupId,schoolId,owner]);

        if(!g.rows[0]){
          return json(res,400,{error:'Guruh noto‘g‘ri'});
        }
      }

      const r=await pool.query(`
        INSERT INTO public.students(
          owner_key,
          school_id,
          group_id,
          full_name,
          phone,
          plate,
          notes,
          attendance_count
        )
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING *
      `,[
        owner,
        schoolId,
        groupId,
        name,
        phone,
        plate,
        body.notes||null,
        attendanceCount
      ]);

      return json(res,201,r.rows[0]);
    }

    res.setHeader('Allow','GET,POST,OPTIONS');
    return json(res,405,{error:'Method not allowed'});
  }catch(e){
    console.error('STUDENTS API:',e);
    return json(res,500,{error:e.message||'O‘quvchilar bilan ishlashda xatolik'});
  }
}
