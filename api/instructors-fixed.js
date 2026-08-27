import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { pool } from '../backend/src/db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
const text = v => String(v ?? '').trim();
const clean = v => text(v).toUpperCase().replace(/[^A-Z0-9]/g, '');

function json(res,status,data){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');return res.end(JSON.stringify(data));}
function auth(req){try{const h=req.headers?.authorization||'';if(!h.startsWith('Bearer '))return null;return String(jwt.verify(h.slice(7),JWT_SECRET).sub||'')}catch{return null}}
async function body(req){if(req.body&&typeof req.body==='object')return req.body;if(typeof req.body==='string'){try{return JSON.parse(req.body)}catch{return {}}}return await new Promise((resolve,reject)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{try{resolve(raw?JSON.parse(raw):{})}catch{reject(new Error('JSON noto‘g‘ri'))}});req.on('error',reject)})}

async function list(owner,id=null){
  const p=[owner]; let where=`(i.settings->>'owner_key')=$1`;
  if(id){p.push(String(id));where+=` AND i.id=$2`}
  const r=await pool.query(`
    SELECT i.id,i.active,i.approved,i.bio AS full_name,i.settings,i.created_at,i.updated_at,
      i.settings->>'school_id' AS school_id,
      i.settings->>'vehicle_id' AS vehicle_id,
      COALESCE(v.plate,i.settings->>'vehicle_plate','') AS vehicle_plate,
      COALESCE(v.model,i.settings->>'vehicle_model','') AS vehicle_model,
      COALESCE(v.driver_name,'') AS driver_name,
      ds.name AS school_name
    FROM public.instructors i
    LEFT JOIN public.driving_schools ds ON ds.id::text=i.settings->>'school_id' AND ds.owner_key=$1
    LEFT JOIN public.vehicles v ON v.id::text=i.settings->>'vehicle_id' AND v.user_id=$1
    WHERE ${where}
    ORDER BY LOWER(COALESCE(i.bio,'')),i.created_at DESC`,p);
  return id?(r.rows[0]||null):r.rows;
}

async function save(req,res,owner,id=null){
  const b=await body(req); const name=text(b.fullName||b.name),phone=text(b.phone)||null,schoolId=text(b.schoolId),plate=clean(b.vehiclePlate||b.plate),model=text(b.vehicleModel||b.model),active=b.active!==false;
  if(!name)return json(res,400,{error:'F.I.Sh. kerak'});
  if(!schoolId)return json(res,400,{error:'Avtoshkolani tanlang'});
  const school=await pool.query(`SELECT id,name FROM public.driving_schools WHERE id=$1 AND owner_key=$2 AND active=true LIMIT 1`,[schoolId,owner]);
  if(!school.rows[0])return json(res,404,{error:'Avtoshkola topilmadi'});

  const c=await pool.connect();
  try{
    await c.query('BEGIN');
    const instructorId=id?String(id):crypto.randomUUID();
    let settings={owner_key:owner,school_id:String(schoolId),vehicle_id:null,vehicle_plate:'',vehicle_model:''};
    if(id){
      const cur=await c.query(`SELECT id,settings FROM public.instructors WHERE id=$1 AND settings->>'owner_key'=$2 FOR UPDATE`,[instructorId,owner]);
      if(!cur.rows[0]){await c.query('ROLLBACK');return json(res,404,{error:'Instruktor topilmadi'})}
      settings={...(cur.rows[0].settings||{}),...settings};
    }

    if(plate){
      const vr=await c.query(`SELECT id,plate,model,driver_name FROM public.vehicles WHERE user_id=$1 AND REPLACE(UPPER(plate),' ','')=$2 LIMIT 1`,[owner,plate]);
      if(!vr.rows[0]){await c.query('ROLLBACK');return json(res,404,{error:'Bu avtomobil bazada topilmadi. Avval avtomobilni qo‘shing.'})}
      const v=vr.rows[0];
      const busy=await c.query(`SELECT id,bio FROM public.instructors WHERE settings->>'owner_key'=$1 AND settings->>'vehicle_id'=$2 AND id<>$3 AND active=true LIMIT 1`,[owner,String(v.id),instructorId]);
      if(busy.rows[0]){await c.query('ROLLBACK');return json(res,409,{error:`Bu avtomobil boshqa instruktorga biriktirilgan: ${busy.rows[0].bio||'Instruktor'}`})}
      settings.vehicle_id=String(v.id);settings.vehicle_plate=v.plate||'';settings.vehicle_model=model||v.model||'';
      await c.query(`UPDATE public.vehicles SET avtodrom_instructor_id=$1,model=COALESCE(NULLIF($2,''),model),updated_at=NOW() WHERE id=$3 AND user_id=$4`,[instructorId,model,v.id,owner]);
    } else {
      settings.vehicle_id=null;settings.vehicle_plate='';settings.vehicle_model='';
      await c.query(`UPDATE public.vehicles SET avtodrom_instructor_id=NULL,updated_at=NOW() WHERE user_id=$1 AND avtodrom_instructor_id=$2`,[owner,instructorId]);
    }

    if(id){
      await c.query(`UPDATE public.instructors SET bio=$1,active=$2,updated_at=NOW(),settings=$3::jsonb WHERE id=$4 AND settings->>'owner_key'=$5`,[name,active,JSON.stringify(settings),instructorId,owner]);
    } else {
      await c.query(`INSERT INTO public.instructors(id,active,approved,approved_at,approved_by,bio,settings,created_at,updated_at) VALUES($1,$2,true,NOW(),$3,$4,$5::jsonb,NOW(),NOW())`,[instructorId,active,owner,name,JSON.stringify(settings)]);
    }

    await c.query('COMMIT');
    return json(res,id?200:201,await list(owner,instructorId));
  }catch(e){try{await c.query('ROLLBACK')}catch{};console.error('FIXED INSTRUCTOR API:',e);return json(res,500,{error:e?.message||'Instruktor saqlanmadi'})}finally{c.release()}
}

export default async function handler(req,res){
  if(req.method==='OPTIONS'){res.statusCode=204;return res.end()}
  const owner=auth(req);if(!owner)return json(res,401,{error:'Kirish talab qilinadi'});
  try{
    const id=req.query?.id?String(req.query.id):null;
    if(req.method==='GET')return json(res,200,await list(owner,id));
    if(req.method==='POST')return save(req,res,owner,null);
    if((req.method==='PUT'||req.method==='PATCH')&&id)return save(req,res,owner,id);
    if(req.method==='DELETE'&&id){const r=await pool.query(`UPDATE public.instructors SET active=false,updated_at=NOW() WHERE id=$1 AND settings->>'owner_key'=$2 RETURNING id`,[id,owner]);if(!r.rows[0])return json(res,404,{error:'Instruktor topilmadi'});await pool.query(`UPDATE public.vehicles SET avtodrom_instructor_id=NULL,updated_at=NOW() WHERE user_id=$1 AND avtodrom_instructor_id=$2`,[owner,id]);return json(res,200,{ok:true})}
    return json(res,405,{error:'Method ruxsat etilmagan'});
  }catch(e){console.error('FIXED INSTRUCTOR API:',e);return json(res,500,{error:e?.message||'Instruktor API xatosi'})}
}
