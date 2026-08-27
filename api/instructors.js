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
  if(typeof req.body==='string'){try{return JSON.parse(req.body)}catch{return {}}}
  return await new Promise((resolve,reject)=>{
    let raw='';
    req.on('data',c=>raw+=c);
    req.on('end',()=>{try{resolve(raw?JSON.parse(raw):{})}catch{reject(new Error('JSON noto‘g‘ri'))}});
    req.on('error',reject);
  });
}

async function list(owner,id=null){
  const p=[owner]; let where=`(i.settings->>'owner_key')=$1`;
  if(id){p.push(String(id));where+=` AND i.id=$2`}
  const r=await pool.query(`
    SELECT
      i.id,i.active,i.approved,i.bio AS full_name,i.settings,i.created_at,i.updated_at,
      i.settings->>'school_id' AS school_id,
      NULL::text AS group_id,
      NULL::text AS vehicle_id,
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
  const b=await readBody(req);
  const name=text(b.fullName||b.name);
  const phone=text(b.phone)||'';
  const schoolId=text(b.schoolId);
  const plate=cleanPlate(b.vehiclePlate||b.plate);
  const model=text(b.vehicleModel||b.model);
  const active=b.active!==false;

  if(!name)return json(res,400,{error:'F.I.Sh. kerak'});
  if(!schoolId)return json(res,400,{error:'Avtoshkolani tanlang'});

  const school=await pool.query(`SELECT id,name FROM public.driving_schools WHERE id=$1 AND owner_key=$2 AND active=true LIMIT 1`,[schoolId,owner]);
  if(!school.rows[0])return json(res,404,{error:'Avtoshkola topilmadi'});

  const c=await pool.connect();
  try{
    await c.query('BEGIN');
    const instructorId=id?String(id):crypto.randomUUID();
    let oldSettings={};

    if(id){
      const cur=await c.query(`SELECT id,settings FROM public.instructors WHERE id=$1 AND settings->>'owner_key'=$2 FOR UPDATE`,[instructorId,owner]);
      if(!cur.rows[0]){await c.query('ROLLBACK');return json(res,404,{error:'Instruktor topilmadi'});}
      oldSettings=cur.rows[0].settings||{};
    }

    const settings={
      ...oldSettings,
      owner_key:owner,
      school_id:String(school.id),
      group_id:null,
      vehicle_id:null,
      vehicle_plate:plate,
      vehicle_model:model,
      driver_name:name,
      phone
    };

    if(id){
      await c.query(`UPDATE public.instructors SET bio=$1,active=$2,updated_at=NOW(),settings=$3::jsonb WHERE id=$4 AND settings->>'owner_key'=$5`,[name,active,JSON.stringify(settings),instructorId,owner]);
    }else{
      await c.query(`INSERT INTO public.instructors(id,active,approved,approved_at,approved_by,bio,settings,created_at,updated_at) VALUES($1,$2,true,NOW(),$3,$4,$5::jsonb,NOW(),NOW())`,[instructorId,active,owner,name,JSON.stringify(settings)]);
    }

    await c.query('COMMIT');
    return json(res,id?200:201,await list(owner,instructorId));
  }catch(e){
    try{await c.query('ROLLBACK')}catch{}
    console.error('INSTRUCTORS API',e);
    return json(res,500,{error:e?.message||'Instruktor saqlanmadi'});
  }finally{c.release();}
}

export default async function handler(req,res){
  if(req.method==='OPTIONS'){res.statusCode=204;return res.end()}
  const user=authUser(req);
  if(!user)return json(res,401,{error:'Kirish talab qilinadi'});
  try{
    const path=String(req.url||'').split('?')[0].split('/').filter(Boolean);
    const id=path[1]?String(path[1]):(req.query?.id?String(req.query.id):null);
    if(req.method==='GET')return json(res,200,await list(user,id));
    if(req.method==='POST')return save(req,res,user,null);
    if((req.method==='PUT'||req.method==='PATCH')&&id)return save(req,res,user,id);
    if(req.method==='DELETE'&&id){
      const r=await pool.query(`UPDATE public.instructors SET active=false,updated_at=NOW() WHERE id=$1 AND settings->>'owner_key'=$2 RETURNING id`,[id,user]);
      if(!r.rows[0])return json(res,404,{error:'Instruktor topilmadi'});
      return json(res,200,{ok:true});
    }
    return json(res,405,{error:'Method ruxsat etilmagan'});
  }catch(e){
    console.error('INSTRUCTORS API',e);
    return json(res,500,{error:e?.message||'Instruktor API xatosi'});
  }
}
