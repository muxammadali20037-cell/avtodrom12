import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { pool } from '../backend/src/db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
const text = v => String(v ?? '').trim();
const cleanPlate = v => text(v).toUpperCase().replace(/[^A-Z0-9]/g, '');

function json(res,status,data){
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  return res.end(JSON.stringify(data));
}

function authUser(req){
  try{
    const h=req.headers?.authorization||'';
    if(!h.startsWith('Bearer '))return null;
    return String(jwt.verify(h.slice(7),JWT_SECRET).sub||'');
  }catch{return null}
}

async function readBody(req){
  if(req.body && typeof req.body==='object')return req.body;
  if(typeof req.body==='string'){
    try{return JSON.parse(req.body)}catch{return {}}
  }
  return await new Promise((resolve,reject)=>{
    let raw='';
    req.on('data',c=>raw+=c);
    req.on('end',()=>{
      try{resolve(raw?JSON.parse(raw):{})}catch{reject(new Error('JSON noto‘g‘ri'))}
    });
    req.on('error',reject);
  });
}

function nameParts(name){
  const p=text(name).split(/\s+/).filter(Boolean);
  return {firstName:p.shift()||text(name), lastName:p.join(' ')||null};
}

async function getInstructor(user,id=null){
  const params=[user];
  let where=`i.settings->>'owner_key'=$1`;
  if(id){
    params.push(String(id));
    where+=` AND i.id=$${params.length}`;
  }

  const r=await pool.query(`
    SELECT
      i.id,
      i.profile_id,
      i.active,
      i.approved,
      i.approved_at,
      i.approved_by,
      i.bio,
      i.category,
      i.experience_years,
      i.settings,
      i.created_at,
      i.updated_at,
      COALESCE(NULLIF(TRIM(CONCAT_WS(' ',pr.first_name,pr.last_name)),''),NULLIF(i.bio,''),'Instruktor') AS full_name,
      pr.phone,
      pr.username,
      pr.telegram_id,
      i.settings->>'school_id' AS school_id,
      NULL::text AS group_id,
      i.settings->>'vehicle_id' AS vehicle_id,
      COALESCE(i.settings->>'vehicle_plate','') AS vehicle_plate,
      COALESCE(i.settings->>'vehicle_model','') AS vehicle_model,
      COALESCE(i.settings->>'driver_name','') AS driver_name,
      ds.name AS school_name,
      NULL::text AS group_name
    FROM public.instructors i
    LEFT JOIN public.profiles pr ON pr.id=i.profile_id
    LEFT JOIN public.driving_schools ds
      ON ds.id::text=i.settings->>'school_id'
     AND ds.owner_key=$1
    WHERE ${where}
    ORDER BY LOWER(COALESCE(pr.first_name||' '||pr.last_name,i.bio,'')),i.created_at DESC
  `,params);

  return id?(r.rows[0]||null):r.rows;
}

async function schoolExists(client,user,schoolId){
  if(!schoolId)throw new Error('Avtoshkolani tanlang');
  const r=await client.query(`
    SELECT id,name
      FROM public.driving_schools
     WHERE id=$1 AND owner_key=$2 AND active=true
     LIMIT 1
  `,[String(schoolId),user]);
  if(!r.rows[0])throw new Error('Avtoshkola topilmadi');
  return r.rows[0];
}

async function save(req,res,user,id=null){
  const b=await readBody(req);
  const name=text(b.fullName||b.name);
  const phone=text(b.phone)||null;
  const schoolId=text(b.schoolId);
  const plate=cleanPlate(b.vehiclePlate||b.plate);
  const model=text(b.vehicleModel||b.model);
  const active=b.active!==false;

  if(!name)return json(res,400,{error:'F.I.Sh. kerak'});
  if(!schoolId)return json(res,400,{error:'Avtoshkolani tanlang'});

  const c=await pool.connect();
  try{
    await c.query('BEGIN');

    const school=await schoolExists(c,user,schoolId);
    const instructorId=id?String(id):crypto.randomUUID();

    const current=id
      ? await c.query(`SELECT id,profile_id,settings FROM public.instructors WHERE id=$1 AND settings->>'owner_key'=$2 FOR UPDATE`,[instructorId,user])
      : {rows:[]};

    if(id && !current.rows[0]){
      await c.query('ROLLBACK');
      return json(res,404,{error:'Instruktor topilmadi'});
    }

    let profileId=current.rows[0]?.profile_id||null;
    if(!id){
      const parts=nameParts(name);
      profileId=crypto.randomUUID();
      // profiles.telegram_id sizning schema'da NOT NULL bo‘lgani uchun texnik qiymat beriladi.
      const technicalTelegramId=String(-(Date.now()*1000+Math.floor(Math.random()*1000)));
      await c.query(`
        INSERT INTO public.profiles
          (id,telegram_id,first_name,last_name,phone,role,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,'instructor',NOW(),NOW())
      `,[profileId,technicalTelegramId,parts.firstName,parts.lastName,phone]);
    }else if(profileId){
      const parts=nameParts(name);
      await c.query(`
        UPDATE public.profiles
           SET first_name=$1,last_name=$2,phone=$3,updated_at=NOW()
         WHERE id=$4
      `,[parts.firstName,parts.lastName,phone,profileId]);
    }

    const oldSettings=current.rows[0]?.settings||{};
    const settings={
      ...oldSettings,
      owner_key:user,
      school_id:String(school.id),
      // Guruh ataylab saqlanmaydi: instruktor uchun guruh kerak emas.
      group_id:null,
      // Avtomobil raqami foydalanuvchi kiritgan qiymatdan olinadi va shu yerda saqlanadi.
      vehicle_plate:plate,
      vehicle_model:model,
      driver_name:name,
      vehicle_id:null
    };

    if(id){
      await c.query(`
        UPDATE public.instructors
           SET active=$1,
               bio=$2,
               updated_at=NOW(),
               settings=$3::jsonb
         WHERE id=$4 AND settings->>'owner_key'=$5
      `,[active,name,JSON.stringify(settings),instructorId,user]);
    }else{
      await c.query(`
        INSERT INTO public.instructors
          (id,profile_id,active,approved,approved_at,approved_by,bio,category,experience_years,settings,created_at,updated_at)
        VALUES
          ($1,$2,$3,true,NOW(),$4,$5,$6,$7,$8::jsonb,NOW(),NOW())
      `,[
        instructorId,
        profileId,
        active,
        user,
        name,
        b.category?String(b.category):null,
        Math.max(0,Math.floor(Number(b.experienceYears)||0)),
        JSON.stringify(settings)
      ]);
    }

    await c.query('COMMIT');
    return json(res,id?200:201,await getInstructor(user,instructorId));
  }catch(e){
    try{await c.query('ROLLBACK')}catch{}
    console.error('INSTRUCTORS API',e);
    return json(res,500,{error:e?.message||'Instruktor saqlanmadi'});
  }finally{c.release()}
}

export default async function handler(req,res){
  if(req.method==='OPTIONS'){res.statusCode=204;return res.end()}

  const user=authUser(req);
  if(!user)return json(res,401,{error:'Kirish talab qilinadi'});

  try{
    const path=String(req.url||'').split('?')[0].split('/').filter(Boolean);
    const id=path[1]?String(path[1]):(req.query?.id?String(req.query.id):null);

    if(req.method==='GET')return json(res,200,await getInstructor(user,id));
    if(req.method==='POST')return save(req,res,user,null);
    if((req.method==='PUT'||req.method==='PATCH')&&id)return save(req,res,user,id);

    if(req.method==='DELETE'&&id){
      const r=await pool.query(`
        UPDATE public.instructors
           SET active=false,updated_at=NOW()
         WHERE id=$1 AND settings->>'owner_key'=$2
         RETURNING id
      `,[id,user]);
      if(!r.rows[0])return json(res,404,{error:'Instruktor topilmadi'});
      return json(res,200,{ok:true});
    }

    res.setHeader('Allow','GET,POST,PUT,PATCH,DELETE,OPTIONS');
    return json(res,405,{error:'Method ruxsat etilmagan'});
  }catch(e){
    console.error('INSTRUCTORS API',e);
    return json(res,500,{error:e?.message||'Instruktor API xatosi'});
  }
}
