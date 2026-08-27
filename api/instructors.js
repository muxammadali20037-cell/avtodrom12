import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { pool } from '../backend/src/db.js';

const JWT_SECRET=process.env.JWT_SECRET||'dev-only-change-me';
const text=v=>String(v??'').trim();
const escPlate=v=>text(v).toUpperCase().replace(/\s+/g,'');
function json(res,status,data){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');return res.end(JSON.stringify(data));}
function owner(req){try{const h=req.headers?.authorization||'';if(!h.startsWith('Bearer '))return null;return String(jwt.verify(h.slice(7),JWT_SECRET).sub||'')}catch{return null}}
async function body(req){if(req.body&&typeof req.body==='object')return req.body;if(typeof req.body==='string'){try{return JSON.parse(req.body)}catch{return {}}}return await new Promise((resolve,reject)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{try{resolve(raw?JSON.parse(raw):{})}catch{reject(new Error('JSON noto‘g‘ri'))}});req.on('error',reject)})}
function fakeTelegramId(){return String(-(Date.now()*1000+Math.floor(Math.random()*1000)))}

async function list(user,id=null){
  const p=[user];let where=`i.settings->>'owner_key'=$1`;
  if(id){p.push(String(id));where+=` AND i.id=$${p.length}`}
  const r=await pool.query(`
    SELECT i.id,i.profile_id,i.active,i.approved,i.approved_at,i.approved_by,i.bio,i.category,i.experience_years,i.settings,i.created_at,i.updated_at,
      COALESCE(NULLIF(TRIM(CONCAT_WS(' ',pr.first_name,pr.last_name)),''),NULLIF(i.bio,''),'Instruktor') AS full_name,
      pr.phone,pr.username,pr.telegram_id,
      i.settings->>'school_id' AS school_id,
      i.settings->>'group_id' AS group_id,
      i.settings->>'vehicle_id' AS vehicle_id,
      COALESCE(v.plate,i.settings->>'vehicle_plate','') AS vehicle_plate,
      COALESCE(v.model,i.settings->>'vehicle_model','') AS vehicle_model,
      COALESCE(v.driver_name,'') AS driver_name,
      ds.name AS school_name,
      sg.name AS group_name
    FROM public.instructors i
    LEFT JOIN public.profiles pr ON pr.id=i.profile_id
    LEFT JOIN LATERAL (
      SELECT vv.plate,vv.model,vv.driver_name FROM public.vehicles vv
      WHERE vv.user_id=$1 AND vv.avtodrom_instructor_id=i.id
      ORDER BY vv.updated_at DESC NULLS LAST,vv.created_at DESC LIMIT 1
    ) v ON TRUE
    LEFT JOIN public.driving_schools ds ON ds.id::text=(i.settings->>'school_id') AND ds.owner_key=$1
    LEFT JOIN public.school_groups sg ON sg.id::text=(i.settings->>'group_id') AND sg.owner_key=$1
    WHERE ${where}
    ORDER BY full_name ASC`,p);
  return id?(r.rows[0]||null):r.rows;
}

async function relation(client,user,schoolId,groupId){
  if(!schoolId)throw new Error('Avtoshkolani tanlang');
  const s=await client.query(`SELECT id,name FROM public.driving_schools WHERE id=$1 AND owner_key=$2 AND active=true LIMIT 1`,[schoolId,user]);
  if(!s.rows[0])throw new Error('Avtoshkola topilmadi');
  if(!groupId)return {school_id:s.rows[0].id,school_name:s.rows[0].name,group_id:null,group_name:null};
  const g=await client.query(`SELECT id,name FROM public.school_groups WHERE id=$1 AND school_id=$2 AND owner_key=$3 AND active=true LIMIT 1`,[groupId,schoolId,user]);
  if(!g.rows[0])throw new Error('Guruh ushbu avtoshkolaga tegishli emas');
  return {school_id:s.rows[0].id,school_name:s.rows[0].name,group_id:g.rows[0].id,group_name:g.rows[0].name};
}

async function save(req,res,user,id=null){
  const b=await body(req);
  const name=text(b.fullName||b.name),phone=text(b.phone)||null,schoolId=text(b.schoolId),groupId=text(b.groupId)||null;
  const plate=escPlate(b.vehiclePlate||b.plate),model=text(b.vehicleModel||b.model),active=b.active!==false;
  if(!name)return json(res,400,{error:'F.I.Sh. kerak'});
  const c=await pool.connect();
  try{
    await c.query('BEGIN');
    const rel=await relation(c,user,schoolId,groupId);
    const instructorId=id?String(id):crypto.randomUUID();
    let profileId=null;
    if(!id){
      const parts=name.split(/\s+/).filter(Boolean);profileId=crypto.randomUUID();
      await c.query(`INSERT INTO public.profiles(id,telegram_id,first_name,last_name,phone,role,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'instructor',NOW(),NOW())`,[profileId,fakeTelegramId(),parts.shift()||name,parts.join(' ')||null,phone]);
      await c.query(`INSERT INTO public.instructors(id,profile_id,active,approved,approved_at,approved_by,bio,category,experience_years,settings,created_at,updated_at) VALUES($1,$2,$3,true,NOW(),$4,$5,$6,$7,$8::jsonb,NOW(),NOW())`,[instructorId,profileId,active,user,name,b.category||null,Math.max(0,Math.floor(Number(b.experienceYears)||0)),JSON.stringify({owner_key:user,school_id:rel.school_id,group_id:rel.group_id})]);
    }else{
      const cur=await c.query(`SELECT id,profile_id FROM public.instructors WHERE id=$1 FOR UPDATE`,[instructorId]);
      if(!cur.rows[0]){await c.query('ROLLBACK');return json(res,404,{error:'Instruktor topilmadi'})}
      profileId=cur.rows[0].profile_id;
      if(profileId){const parts=name.split(/\s+/).filter(Boolean);await c.query(`UPDATE public.profiles SET first_name=$1,last_name=$2,phone=$3,updated_at=NOW() WHERE id=$4`,[parts.shift()||name,parts.join(' ')||null,phone,profileId])}
      await c.query(`UPDATE public.instructors SET active=$1,bio=$2,updated_at=NOW(),settings=COALESCE(settings,'{}'::jsonb)||$3::jsonb WHERE id=$4`,[active,name,JSON.stringify({owner_key:user,school_id:rel.school_id,group_id:rel.group_id}),instructorId]);
    }
    if(plate){
      const vr=await c.query(`SELECT id,plate,model,driver_name,avtodrom_instructor_id FROM public.vehicles WHERE user_id=$1 AND REPLACE(UPPER(plate),' ','')=$2 LIMIT 1`,[user,plate]);
      if(!vr.rows[0]){await c.query('ROLLBACK');return json(res,404,{error:'Bu avtomobil bazada topilmadi. Avval avtomobilni qo‘shing.'})}
      const v=vr.rows[0],assigned=v.avtodrom_instructor_id?String(v.avtodrom_instructor_id):'';
      if(assigned&&assigned!==instructorId){const q=await c.query(`SELECT COALESCE(NULLIF(TRIM(CONCAT_WS(' ',pr.first_name,pr.last_name)),''),NULLIF(i.bio,''),'Instruktor') AS full_name FROM public.instructors i LEFT JOIN public.profiles pr ON pr.id=i.profile_id WHERE i.id=$1`,[assigned]);await c.query('ROLLBACK');return json(res,409,{error:`Bu avtomobil boshqa instruktorga biriktirilgan: ${q.rows[0]?.full_name||'Instruktor'}`})}
      await c.query(`UPDATE public.vehicles SET avtodrom_instructor_id=NULL,updated_at=NOW() WHERE user_id=$1 AND avtodrom_instructor_id=$2 AND id<>$3`,[user,instructorId,v.id]);
      await c.query(`UPDATE public.vehicles SET avtodrom_instructor_id=$1,model=COALESCE(NULLIF($2,''),model),driver_name=COALESCE(NULLIF($3,''),driver_name),updated_at=NOW() WHERE id=$4 AND user_id=$5`,[instructorId,model,name,v.id,user]);
      await c.query(`UPDATE public.instructors SET settings=COALESCE(settings,'{}'::jsonb)||$1::jsonb,updated_at=NOW() WHERE id=$2`,[JSON.stringify({owner_key:user,school_id:rel.school_id,group_id:rel.group_id,vehicle_id:String(v.id),vehicle_plate:v.plate,vehicle_model:model||v.model||''}),instructorId]);
    }else{
      await c.query(`UPDATE public.vehicles SET avtodrom_instructor_id=NULL,updated_at=NOW() WHERE user_id=$1 AND avtodrom_instructor_id=$2`,[user,instructorId]);
    }
    await c.query('COMMIT');
    return json(res,id?200:201,await list(user,instructorId));
  }catch(e){try{await c.query('ROLLBACK')}catch{};console.error('INSTRUCTORS API',e);return json(res,500,{error:e.message||'Instruktor API xatosi'})}finally{c.release()}
}

export default async function handler(req,res){
  if(req.method==='OPTIONS'){res.statusCode=204;return res.end()}
  const user=owner(req);if(!user)return json(res,401,{error:'Kirish talab qilinadi'});
  try{
    const parts=String(req.url||'').split('?')[0].split('/').filter(Boolean);
    const id=parts[1]||null;
    if(req.method==='GET')return json(res,200,await list(user,id));
    if(req.method==='POST')return save(req,res,user,null);
    if((req.method==='PUT'||req.method==='PATCH')&&id)return save(req,res,user,id);
    if(req.method==='DELETE'&&id){const r=await list(user,id);if(!r)return json(res,404,{error:'Instruktor topilmadi'});await pool.query(`UPDATE public.instructors SET active=false,updated_at=NOW() WHERE id=$1`,[id]);await pool.query(`UPDATE public.vehicles SET avtodrom_instructor_id=NULL,updated_at=NOW() WHERE user_id=$1 AND avtodrom_instructor_id=$2`,[user,id]);return json(res,200,{ok:true})}
    return json(res,405,{error:'Method ruxsat etilmagan'});
  }catch(e){console.error('INSTRUCTORS API',e);return json(res,500,{error:e.message||'Instruktor API xatosi'})}
}
