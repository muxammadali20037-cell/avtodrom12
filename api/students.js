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
    if(!h.startsWith('Bearer ')){json(res,401,{error:'Kirish talab qilinadi'});return false;}
    req.user=jwt.verify(h.slice(7),JWT_SECRET);return true;
  }catch{json(res,401,{error:'Sessiya yaroqsiz yoki tugagan'});return false;}
}
async function ensureSchema(){
  await pool.query(`ALTER TABLE public.students ADD COLUMN IF NOT EXISTS attendance_count integer NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE public.students ADD COLUMN IF NOT EXISTS birth_date date`);
  await pool.query(`ALTER TABLE public.students DROP CONSTRAINT IF EXISTS students_attendance_count_nonnegative`);
  await pool.query(`ALTER TABLE public.students ADD CONSTRAINT students_attendance_count_nonnegative CHECK (attendance_count >= 0)`);
  await pool.query(`
    UPDATE public.students
       SET attendance_count = GREATEST(
         COALESCE(attendance_count,0),
         COALESCE(NULLIF((substring(notes from 'ATTENDANCE_BASE=([0-9]+)')),'')::int,0)
       ),
           notes = NULLIF(regexp_replace(COALESCE(notes,''),'(^|;)ATTENDANCE_BASE=[0-9]+;?','','i'),'')
     WHERE notes ~ 'ATTENDANCE_BASE=[0-9]+'
  `);
  await pool.query(`
    CREATE OR REPLACE FUNCTION public.avtodrom_increment_student_attendance()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
    BEGIN
      IF NEW.student_id IS NOT NULL AND UPPER(COALESCE(NEW.status,''))='COMPLETED' AND UPPER(COALESCE(OLD.status,''))<>'COMPLETED' THEN
        UPDATE public.students SET attendance_count=COALESCE(attendance_count,0)+1 WHERE id=NEW.student_id;
      END IF;
      RETURN NEW;
    END; $$;
  `);
  await pool.query(`DROP TRIGGER IF EXISTS trg_avtodrom_student_attendance ON public.sessions`);
  await pool.query(`CREATE TRIGGER trg_avtodrom_student_attendance AFTER UPDATE OF status ON public.sessions FOR EACH ROW EXECUTE FUNCTION public.avtodrom_increment_student_attendance()`);
}

export default async function handler(req,res){
  if(req.method==='OPTIONS'){res.statusCode=204;return res.end();}
  if(!auth(req,res))return;
  try{
    await ensureSchema();
    const owner=uid(req);

    if(req.method==='GET'){
      /* O'CHIRILGAN O'QUVCHI RO'YXATGA TUSHMASIN.
         DELETE `active=false` qiladi, lekin bu ro'yxat uni filtrlamasdi:
         o'quvchi o'chirilgach ham operator qidiruvida chiqib turardi va
         bir necha marta o'chirilsa ham qaytaverardi. */
      const p=[owner];let w='st.owner_key=$1 AND st.active=true';
      if(req.query.schoolId){p.push(String(req.query.schoolId));w+=` AND st.school_id=$${p.length}`;}
      if(req.query.groupId){p.push(String(req.query.groupId));w+=` AND st.group_id=$${p.length}`;}
      const r=await pool.query(`
        SELECT st.*,s.name school_name,g.name group_name,
               COALESCE(st.attendance_count,0)::int AS attendance_count
          FROM students st
          JOIN driving_schools s ON s.id=st.school_id
          LEFT JOIN school_groups g ON g.id=st.group_id
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
      const birthDate=body.birthDate ? String(body.birthDate).trim() : null;
      const phone=String(body.phone||'').trim()||null;
      const plate=String(body.plate||'').trim()||null;
      let attendanceCount=Math.max(0,Math.min(9999,Math.floor(Number(body.attendanceCount ?? body.attendance_count ?? 0))));
      let notes=String(body.notes||'').trim();
      if(typeof body.notes==='string'){
        const m=body.notes.match(/ATTENDANCE_BASE=(\d+)/i);
        if(m){
          if(!attendanceCount) attendanceCount=Math.max(0,Math.min(9999,Number(m[1])));
          notes=body.notes.replace(/(^|;)ATTENDANCE_BASE=\d+;?/i,'$1').replace(/^;|;$/g,'').trim();
        }
      }
      if(!schoolId||!name)return json(res,400,{error:'Avtoshkola va o‘quvchi ismi kerak'});
      const s=await pool.query(`SELECT id FROM driving_schools WHERE id=$1 AND owner_key=$2 AND active=true`,[schoolId,owner]);
      if(!s.rows[0])return json(res,404,{error:'Avtoshkola topilmadi'});
      if(groupId){
        const g=await pool.query(`SELECT id FROM school_groups WHERE id=$1 AND school_id=$2 AND owner_key=$3 AND active=true`,[groupId,schoolId,owner]);
        if(!g.rows[0])return json(res,400,{error:'Guruh noto‘g‘ri'});
      }
      /* AYNI GURUHDA AYNI ISM IKKI MARTA YOZILMASIN.
         Ro'yxat ikki marta kiritilganda yoki o'chirib qayta qo'shilganda
         bazada nusxalar to'planib qolardi. Solishtirishda katta-kichik
         harf, ortiqcha bo'sh joy va tinish belgilari hisobga olinmaydi. */
      const NORM=`btrim(regexp_replace(
        regexp_replace(upper(coalesce(full_name,'')), '[^[:alnum:][:space:]]', '', 'g'),
        '[[:space:]]+', ' ', 'g'))`;
      const NORMQ=`btrim(regexp_replace(
        regexp_replace(upper($4::text), '[^[:alnum:][:space:]]', '', 'g'),
        '[[:space:]]+', ' ', 'g'))`;
      const bor=await pool.query(`
        SELECT id,active FROM students
         WHERE owner_key=$1 AND school_id=$2
           AND COALESCE(group_id::text,'')=COALESCE($3::text,'')
           AND ${NORM}=${NORMQ}
         ORDER BY active DESC, created_at
         LIMIT 1
      `,[owner,schoolId,groupId,name]);

      if(bor.rows[0] && bor.rows[0].active){
        return json(res,409,{error:'Bu guruhda shu ismli o‘quvchi allaqachon bor',
                             id:bor.rows[0].id,duplicate:true});
      }
      if(bor.rows[0]){
        /* Avval o'chirilgan ekan — yangi qator yaratmaymiz, o'shani
           qaytaramiz. Shunda o'lik yozuvlar to'planib ketmaydi. */
        const rev=await pool.query(`
          UPDATE students SET active=true,group_id=$1,birth_date=COALESCE($2,birth_date),
                 phone=COALESCE($3,phone),plate=COALESCE($4,plate),
                 notes=COALESCE($5,notes),attendance_count=$6
           WHERE id=$7 AND owner_key=$8 RETURNING *
        `,[groupId,birthDate,phone,plate,notes||null,attendanceCount,bor.rows[0].id,owner]);
        return json(res,201,rev.rows[0]);
      }

      const r=await pool.query(`
        INSERT INTO students(owner_key,school_id,group_id,full_name,birth_date,phone,plate,notes,attendance_count)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING *
      `,[owner,schoolId,groupId,name,birthDate,phone,plate,notes||null,attendanceCount]);
      return json(res,201,r.rows[0]);
    }

    if(req.method==='PATCH' || req.method==='PUT'){
      const id=String(req.url.split('?')[0].split('/').filter(Boolean).pop()||'');
      if(!id)return json(res,400,{error:'O‘quvchi ID kerak'});
      const body=req.body||{};
      const current=await pool.query(`
        SELECT * FROM students WHERE id=$1 AND owner_key=$2 AND active=true
      `,[id,owner]);
      if(!current.rows[0])return json(res,404,{error:'O‘quvchi topilmadi'});

      const old=current.rows[0];
      const fullName=String(body.fullName ?? old.full_name ?? '').trim();
      const birthDate=body.birthDate!==undefined ? (String(body.birthDate||'').trim()||null) : (old.birth_date||null);
      const phone=body.phone!==undefined ? (String(body.phone||'').trim()||null) : (old.phone||null);
      const plate=body.plate!==undefined ? (String(body.plate||'').trim()||null) : (old.plate||null);
      const schoolId=body.schoolId!==undefined ? (String(body.schoolId||'').trim()||null) : old.school_id;
      const groupId=body.groupId!==undefined ? (body.groupId?String(body.groupId):null) : old.group_id;
      const attendanceRaw=body.attendanceCount!==undefined ? body.attendanceCount : body.attendance_count;
      const attendanceCount=attendanceRaw!==undefined
        ? Math.max(0,Math.min(9999,Math.floor(Number(attendanceRaw)||0)))
        : Number(old.attendance_count||0);

      if(!fullName||!schoolId)return json(res,400,{error:'F.I.Sh. va avtoshkolani kiriting'});
      const s=await pool.query(`SELECT id FROM driving_schools WHERE id=$1 AND owner_key=$2 AND active=true`,[schoolId,owner]);
      if(!s.rows[0])return json(res,404,{error:'Avtoshkola topilmadi'});
      if(groupId){
        const g=await pool.query(`SELECT id FROM school_groups WHERE id=$1 AND school_id=$2 AND owner_key=$3 AND active=true`,[groupId,schoolId,owner]);
        if(!g.rows[0])return json(res,400,{error:'Guruh noto‘g‘ri'});
      }

      const r=await pool.query(`
        UPDATE students
           SET full_name=$1,
               birth_date=$2,
               phone=$3,
               plate=$4,
               school_id=$5,
               group_id=$6,
               attendance_count=$7
         WHERE id=$8 AND owner_key=$9 AND active=true
         RETURNING *,
           (SELECT name FROM driving_schools WHERE id=students.school_id) AS school_name,
           (SELECT name FROM school_groups WHERE id=students.group_id) AS group_name
      `,[fullName,birthDate,phone,plate,schoolId,groupId,attendanceCount,id,owner]);
      return json(res,200,r.rows[0]);
    }

    if(req.method==='DELETE'){
      const id=String(req.url.split('?')[0].split('/').filter(Boolean).pop()||'');
      if(!id)return json(res,400,{error:'O‘quvchi ID kerak'});
      const r=await pool.query(`
        UPDATE students SET active=false
         WHERE id=$1 AND owner_key=$2 AND active=true
         RETURNING id,full_name
      `,[id,owner]);
      if(!r.rows[0])return json(res,404,{error:'O‘quvchi topilmadi'});
      return json(res,200,{ok:true,id:r.rows[0].id,full_name:r.rows[0].full_name});
    }

    res.setHeader('Allow','GET,POST,PATCH,PUT,DELETE,OPTIONS');
    return json(res,405,{error:'Method not allowed'});
  }catch(e){
    console.error('STUDENTS API:',e);
    return json(res,500,{error:e.message||'O‘quvchilar bilan ishlashda xatolik'});
  }
}
