import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { pool } from '../backend/src/db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
const text = v => String(v ?? '').trim();

// Instructor vehicle plate is free-form data entered in the instructor form.
// It is NOT looked up in public.vehicles and is NOT required to exist there.
const cleanPlate = v => text(v).toUpperCase().replace(/\s+/g, ' ').trim();

function json(res,status,data){
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  return res.end(JSON.stringify(data));
}

function auth(req){
  try{
    const h=req.headers?.authorization||'';
    if(!h.startsWith('Bearer ')) return null;
    return String(jwt.verify(h.slice(7),JWT_SECRET).sub||'');
  }catch{return null}
}

async function body(req){
  if(req.body&&typeof req.body==='object') return req.body;
  if(typeof req.body==='string'){
    try{return JSON.parse(req.body)}catch{return {}}
  }
  return await new Promise((resolve,reject)=>{
    let raw='';
    req.on('data',c=>raw+=c);
    req.on('end',()=>{
      try{resolve(raw?JSON.parse(raw):{})}
      catch{reject(new Error('JSON noto‘g‘ri'))}
    });
    req.on('error',reject);
  });
}

async function list(owner,id=null){
  const p=[owner];
  let where=`(i.settings->>'owner_key')=$1`;
  if(id){
    p.push(String(id));
    where+=` AND i.id=$2`;
  }

  const r=await pool.query(`
    SELECT
      i.id,
      i.active,
      i.approved,
      i.bio AS full_name,
      i.settings,
      i.created_at,
      i.updated_at,
      i.settings->>'school_id' AS school_id,
      NULL::text AS group_id,
      NULLIF(i.settings->>'vehicle_id','') AS vehicle_id,
      COALESCE(i.settings->>'vehicle_plate','') AS vehicle_plate,
      COALESCE(i.settings->>'vehicle_model','') AS vehicle_model,
      COALESCE(i.settings->>'driver_name','') AS driver_name,
      COALESCE(i.settings->>'phone','') AS phone,
      ds.name AS school_name,
      NULL::text AS group_name
    FROM public.instructors i
    LEFT JOIN public.driving_schools ds
      ON ds.id::text=i.settings->>'school_id'
     AND ds.owner_key=$1
    WHERE ${where}
    ORDER BY LOWER(COALESCE(i.bio,'')),i.created_at DESC
  `,p);

  return id?(r.rows[0]||null):r.rows;
}

async function save(req,res,owner,id=null){
  const b=await body(req);
  const name=text(b.fullName||b.name);
  const phone=text(b.phone)||null;
  const schoolId=text(b.schoolId);
  const plate=cleanPlate(b.vehiclePlate||b.plate);
  const model=text(b.vehicleModel||b.model);
  const active=b.active!==false;

  if(!name) return json(res,400,{error:'F.I.Sh. kerak'});
  if(!schoolId) return json(res,400,{error:'Avtoshkolani tanlang'});

  const c=await pool.connect();
  try{
    await c.query('BEGIN');

    const school=await c.query(`
      SELECT id,name
      FROM public.driving_schools
      WHERE id=$1 AND owner_key=$2 AND active=true
      LIMIT 1
    `,[schoolId,owner]);

    if(!school.rows[0]){
      await c.query('ROLLBACK');
      return json(res,404,{error:'Avtoshkola topilmadi'});
    }

    const instructorId=id?String(id):crypto.randomUUID();
    let current=null;

    if(id){
      const cur=await c.query(`
        SELECT id,settings
        FROM public.instructors
        WHERE id=$1 AND settings->>'owner_key'=$2
        FOR UPDATE
      `,[instructorId,owner]);

      if(!cur.rows[0]){
        await c.query('ROLLBACK');
        return json(res,404,{error:'Instruktor topilmadi'});
      }
      current=cur.rows[0];
    }

    // IMPORTANT:
    // The plate/model entered by the admin belong to the instructor record itself.
    // No lookup in public.vehicles is performed here.
    // No vehicle must already exist in the vehicle table.
    const oldSettings=current?.settings||{};
    const settings={
      ...oldSettings,
      owner_key:owner,
      school_id:String(school.id),
      group_id:null,
      vehicle_id:null,
      vehicle_plate:plate,
      vehicle_model:model,
      /* TELEFON: ilgari yuqorida o'qilardi, lekin settings ga
         yozilmasdi — shuning uchun kartochkada har doim «Telefon
         kiritilmagan» chiqardi. */
      phone:phone||'',
      driver_name:name
    };

    if(id){
      await c.query(`
        UPDATE public.instructors
        SET bio=$1,
            active=$2,
            updated_at=NOW(),
            settings=$3::jsonb
        WHERE id=$4 AND settings->>'owner_key'=$5
      `,[
        name,
        active,
        JSON.stringify(settings),
        instructorId,
        owner
      ]);
    }else{
      await c.query(`
        INSERT INTO public.instructors(
          id,active,approved,approved_at,approved_by,bio,settings,created_at,updated_at
        )
        VALUES($1,$2,true,NOW(),$3,$4,$5::jsonb,NOW(),NOW())
      `,[
        instructorId,
        active,
        owner,
        name,
        JSON.stringify(settings)
      ]);
    }

    await c.query('COMMIT');
    return json(res,id?200:201,await list(owner,instructorId));
  }catch(e){
    try{await c.query('ROLLBACK')}catch{}
    console.error('FIXED INSTRUCTOR API:',e);
    return json(res,500,{error:e?.message||'Instruktor saqlanmadi'});
  }finally{
    c.release();
  }
}

/* ============================ OMMAVIY QO'SHISH ============================
   POST /api/instructors/bulk

   Instruktorda faqat SHAXSIY ma'lumot bo'ladi: F.I.Sh., telefon va
   qaysi avtoshkolaniki. Avtomobil raqami bu yerda so'ralmaydi —
   mashinalar «Admin → Mashinalar» bo'limida alohida ro'yxat sifatida
   yuritiladi va bir instruktor turli kunlarda turli mashinada
   uchirishi mumkin.

   Ikki xil so'rov qabul qilinadi:
     { schoolId, rows: [{ fullName, phone }] }
     { instructors: [{ full_name, phone, school_id }] }   (Excel importi)

   Shu avtoshkolada aynan shunday ism bo'lsa — qayta yozilmaydi. */
async function bulkSave(req,res,owner){
  const b = await body(req);
  const topSchool = text(b.schoolId || b.school_id);
  const raw = Array.isArray(b.rows) ? b.rows
            : Array.isArray(b.instructors) ? b.instructors : [];
  if(!raw.length) return json(res,400,{error:'Ro‘yxat bo‘sh'});

  /* Ruxsat etilgan avtoshkolalar — har bir qator uchun qayta so'ramaymiz */
  const sr = await pool.query(
    `SELECT id::text AS id FROM driving_schools WHERE owner_key=$1 AND active=true`,[owner]);
  const allowed = new Set(sr.rows.map(x=>x.id));

  const norm = v => String(v??'').toUpperCase().replace(/[^A-ZЀ-ӿ0-9]/g,'');
  const added=[], skipped=[], errors=[];
  const seen = new Set();

  const c = await pool.connect();
  try{
    await c.query('BEGIN');
    for(let i=0;i<raw.length;i++){
      const row = raw[i] || {};
      const name = text(row.fullName || row.full_name || row.name);
      const schoolId = text(row.schoolId || row.school_id) || topSchool;
      if(!name){ errors.push((i+1)+'-qator: F.I.Sh. bo‘sh'); continue; }
      if(!schoolId || !allowed.has(schoolId)){
        errors.push((i+1)+'-qator ('+name+'): avtoshkola topilmadi'); continue;
      }
      const key = schoolId+'|'+norm(name);
      if(seen.has(key)){ skipped.push(name); continue; }
      seen.add(key);

      /* Shu avtoshkolada shunday ism bormi? */
      const bor = await c.query(`
        SELECT id FROM public.instructors
         WHERE settings->>'owner_key'=$1
           AND settings->>'school_id'=$2
           AND active=true
           AND UPPER(REGEXP_REPLACE(COALESCE(bio,''),'[^[:alnum:]]','','g')) = $3
         LIMIT 1`,[owner, schoolId, norm(name)]);
      if(bor.rows[0]){ skipped.push(name); continue; }

      const settings = {
        owner_key: owner,
        school_id: schoolId,
        group_id: null,
        vehicle_id: null,
        /* Ommaviy oynada mashina so'ralmaydi. Lekin Excel importida
           ustun bo'lsa, kelgan qiymat yo'qotilmaydi. */
        vehicle_plate: cleanPlate(row.plate || row.vehiclePlate || row.vehicle_plate),
        vehicle_model: text(row.model || row.vehicleModel || row.vehicle_model),
        phone: text(row.phone) || '',
        driver_name: name
      };
      await c.query(`
        INSERT INTO public.instructors(id,active,approved,approved_at,approved_by,bio,settings,created_at,updated_at)
        VALUES($1,true,true,NOW(),$2,$3,$4::jsonb,NOW(),NOW())`,
        [crypto.randomUUID(), owner, name, JSON.stringify(settings)]);
      added.push(name);
    }
    await c.query('COMMIT');
  }catch(e){
    try{await c.query('ROLLBACK')}catch{}
    console.error('INSTRUCTOR BULK:',e);
    return json(res,500,{error:e?.message||'Instruktorlar saqlanmadi'});
  }finally{ c.release(); }

  return json(res,201,{ok:true, added:added.length, skipped:skipped.length,
                       skippedNames:skipped.slice(0,20), errors});
}

export default async function handler(req,res){
  if(req.method==='OPTIONS'){
    res.statusCode=204;
    return res.end();
  }

  const owner=auth(req);
  if(!owner) return json(res,401,{error:'Kirish talab qilinadi'});

  try{
    const id=req.query?.id?String(req.query.id):null;

    if(req.method==='POST' && String(id||'')==='bulk') return bulkSave(req,res,owner);
    if(req.method==='GET') return json(res,200,await list(owner,id));
    if(req.method==='POST') return save(req,res,owner,null);
    if((req.method==='PUT'||req.method==='PATCH')&&id) return save(req,res,owner,id);

    if(req.method==='DELETE'&&id){
      const r=await pool.query(`
        UPDATE public.instructors
        SET active=false,updated_at=NOW()
        WHERE id=$1 AND settings->>'owner_key'=$2
        RETURNING id
      `,[id,owner]);

      if(!r.rows[0]) return json(res,404,{error:'Instruktor topilmadi'});
      return json(res,200,{ok:true});
    }

    return json(res,405,{error:'Method ruxsat etilmagan'});
  }catch(e){
    console.error('FIXED INSTRUCTOR API:',e);
    return json(res,500,{error:e?.message||'Instruktor API xatosi'});
  }
}
