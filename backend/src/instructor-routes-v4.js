import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { pool } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
const text = v => String(v ?? '').trim();
const num = v => Number.isFinite(Number(v)) ? Number(v) : 0;

function json(res,status,data){
  if(res.headersSent)return;
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}
function owner(req){
  try{
    const h=req.headers?.authorization||'';
    if(!h.startsWith('Bearer '))return null;
    return String(jwt.verify(h.slice(7),JWT_SECRET).sub||'');
  }catch{return null;}
}
async function body(req){
  if(req.body&&typeof req.body==='object')return req.body;
  if(typeof req.body==='string'){try{return JSON.parse(req.body)}catch{return {}}}
  return await new Promise((resolve,reject)=>{
    let raw='';
    req.on('data',c=>raw+=c);
    req.on('end',()=>{try{resolve(raw?JSON.parse(raw):{})}catch{reject(new Error('JSON noto‘g‘ri'))}});
    req.on('error',reject);
  });
}
function cleanPlate(raw){return text(raw).toUpperCase().replace(/[^A-Z0-9]/g,'');}

async function schoolGroup(c,ownerKey,schoolId,groupId){
  if(!schoolId)throw new Error('Avtoshkolani tanlang');
  const s=await c.query(`SELECT id,name FROM driving_schools WHERE id=$1 AND owner_key=$2 AND active=true LIMIT 1`,[schoolId,ownerKey]);
  if(!s.rows[0])throw new Error('Avtoshkola topilmadi');
  if(!groupId)return {school_id:s.rows[0].id,school_name:s.rows[0].name,group_id:null,group_name:null};
  const g=await c.query(`SELECT id,name FROM school_groups WHERE id=$1 AND school_id=$2 AND owner_key=$3 AND active=true LIMIT 1`,[groupId,schoolId,ownerKey]);
  if(!g.rows[0])throw new Error('Guruh ushbu avtoshkolaga tegishli emas');
  return {school_id:s.rows[0].id,school_name:s.rows[0].name,group_id:g.rows[0].id,group_name:g.rows[0].name};
}

async function rows(ownerKey,id=null){
  const p=[ownerKey];
  let where=`((i.settings->>'owner_key')=$1 OR EXISTS(SELECT 1 FROM vehicles vx WHERE vx.avtodrom_instructor_id=i.id AND vx.user_id=$1) OR EXISTS(SELECT 1 FROM sessions sx WHERE sx.avtodrom_instructor_id=i.id AND sx.user_id=$1))`;
  if(id){p.push(String(id));where+=` AND i.id=$${p.length}`;}
  const r=await pool.query(`
    SELECT i.id,i.profile_id,i.active,i.approved,i.approved_at,i.approved_by,i.bio,i.category,i.experience_years,i.settings,i.created_at,i.updated_at,
      COALESCE(NULLIF(TRIM(CONCAT_WS(' ',pr.first_name,pr.last_name)),''),NULLIF(i.bio,''),'Instruktor') AS full_name,
      pr.phone,pr.username,pr.telegram_id,
      i.settings->>'school_id' AS school_id,i.settings->>'group_id' AS group_id,i.settings->>'vehicle_id' AS vehicle_id,
      COALESCE(v.plate,i.settings->>'vehicle_plate','') AS vehicle_plate,
      COALESCE(v.model,i.settings->>'vehicle_model','') AS vehicle_model,
      COALESCE(v.driver_name,'') AS driver_name,
      ds.name AS school_name,sg.name AS group_name
    FROM instructors i
    LEFT JOIN profiles pr ON pr.id=i.profile_id
    LEFT JOIN driving_schools ds ON ds.id::text=(i.settings->>'school_id') AND ds.owner_key=$1
    LEFT JOIN school_groups sg ON sg.id::text=(i.settings->>'group_id') AND sg.owner_key=$1
    LEFT JOIN LATERAL(
      SELECT vv.plate,vv.model,vv.driver_name FROM vehicles vv
      WHERE vv.user_id=$1 AND vv.avtodrom_instructor_id=i.id
      ORDER BY vv.updated_at DESC NULLS LAST,vv.created_at DESC LIMIT 1
    )v ON TRUE
    WHERE ${where}
    ORDER BY full_name ASC`,p);
  return id?(r.rows[0]||null):r.rows;
}

async function save(req,res,ownerKey,id=null){
  const b=await body(req);
  const fullName=text(b.fullName||b.name),phone=text(b.phone)||null,schoolId=text(b.schoolId),groupId=text(b.groupId)||null,
    vehiclePlate=text(b.vehiclePlate||b.plate).toUpperCase(),vehicleModel=text(b.vehicleModel||b.model),active=b.active!==false;
  if(!fullName)return json(res,400,{error:'F.I.Sh. kerak'});
  const c=await pool.connect();
  try{
    await c.query('BEGIN');
    const rel=await schoolGroup(c,ownerKey,schoolId,groupId);
    const instructorId=id?String(id):crypto.randomUUID();
    let profileId=null;
    if(!id){
      if(phone){
        const d=await c.query(`SELECT i.id FROM instructors i JOIN profiles pr ON pr.id=i.profile_id WHERE (i.settings->>'owner_key')=$1 AND LOWER(COALESCE(pr.phone,''))=LOWER($2) AND LOWER(TRIM(CONCAT_WS(' ',pr.first_name,pr.last_name)))=LOWER(TRIM($3)) LIMIT 1`,[ownerKey,phone,fullName]);
        if(d.rows[0]){await c.query('ROLLBACK');return json(res,409,{error:'Bu instruktor allaqachon mavjud'});}
      }
      profileId=crypto.randomUUID();
      const parts=fullName.split(/\s+/).filter(Boolean);
      await c.query(`INSERT INTO profiles(id,first_name,last_name,phone,role,created_at,updated_at) VALUES($1,$2,$3,$4,'instructor',NOW(),NOW())`,[profileId,parts.shift()||fullName,parts.join(' ')||null,phone]);
      await c.query(`INSERT INTO instructors(id,profile_id,active,approved,approved_at,approved_by,bio,category,experience_years,settings,created_at,updated_at) VALUES($1,$2,$3,true,NOW(),$4,$5,$6,$7,$8::jsonb,NOW(),NOW())`,[instructorId,profileId,active,ownerKey,fullName,b.category||null,Math.max(0,Math.floor(num(b.experienceYears))),JSON.stringify({owner_key:ownerKey,school_id:rel.school_id,group_id:rel.group_id})]);
    }else{
      const cur=await c.query(`SELECT id,profile_id FROM instructors WHERE id=$1 FOR UPDATE`,[instructorId]);
      if(!cur.rows[0]){await c.query('ROLLBACK');return json(res,404,{error:'Instruktor topilmadi'});}
      profileId=cur.rows[0].profile_id;
      if(profileId){const parts=fullName.split(/\s+/).filter(Boolean);await c.query(`UPDATE profiles SET first_name=$1,last_name=$2,phone=COALESCE($3,phone),updated_at=NOW() WHERE id=$4`,[parts.shift()||fullName,parts.join(' ')||null,phone,profileId]);}
      await c.query(`UPDATE instructors SET active=$1,bio=$2,updated_at=NOW(),settings=COALESCE(settings,'{}'::jsonb)||$3::jsonb WHERE id=$4`,[active,fullName,JSON.stringify({owner_key:ownerKey,school_id:rel.school_id,group_id:rel.group_id}),instructorId]);
    }

    if(vehiclePlate){
      const q=cleanPlate(vehiclePlate);
      const vr=await c.query(`SELECT id,plate,model,driver_name,avtodrom_instructor_id FROM vehicles WHERE user_id=$1 AND REPLACE(UPPER(plate),' ','')=$2 LIMIT 1`,[ownerKey,q]);
      const vehicle=vr.rows[0];
      if(!vehicle){await c.query('ROLLBACK');return json(res,404,{error:'Bu avtomobil topilmadi. Avval avtomobilni bazaga qo‘shing.'});}
      const assignedId=vehicle.avtodrom_instructor_id?String(vehicle.avtodrom_instructor_id):'';
      if(assignedId&&assignedId!==instructorId){
        const rr=await c.query(`SELECT COALESCE(NULLIF(TRIM(CONCAT_WS(' ',pr.first_name,pr.last_name)),''),NULLIF(i.bio,''),'Instruktor') AS full_name FROM instructors i LEFT JOIN profiles pr ON pr.id=i.profile_id WHERE i.id=$1 LIMIT 1`,[assignedId]);
        await c.query('ROLLBACK');
        return json(res,409,{error:`Bu avtomobil boshqa instruktorga biriktirilgan: ${rr.rows[0]?.full_name||'boshqa instruktor'}`});
      }
      await c.query(`UPDATE vehicles SET avtodrom_instructor_id=NULL,updated_at=NOW() WHERE user_id=$1 AND avtodrom_instructor_id=$2 AND id<>$3`,[ownerKey,instructorId,vehicle.id]);
      await c.query(`UPDATE vehicles SET avtodrom_instructor_id=$1,model=COALESCE(NULLIF($2,''),model),driver_name=COALESCE(NULLIF($3,''),driver_name),updated_at=NOW() WHERE id=$4 AND user_id=$5`,[instructorId,vehicleModel,fullName,vehicle.id,ownerKey]);
      await c.query(`UPDATE instructors SET settings=COALESCE(settings,'{}'::jsonb)||$1::jsonb,updated_at=NOW() WHERE id=$2`,[JSON.stringify({owner_key:ownerKey,school_id:rel.school_id,group_id:rel.group_id,vehicle_id:String(vehicle.id),vehicle_plate:vehicle.plate,vehicle_model:vehicleModel||vehicle.model||''}),instructorId]);
    }else{
      await c.query(`UPDATE vehicles SET avtodrom_instructor_id=NULL,updated_at=NOW() WHERE user_id=$1 AND avtodrom_instructor_id=$2`,[ownerKey,instructorId]);
    }
    await c.query('COMMIT');
    return json(res,id?200:201,await rows(ownerKey,instructorId));
  }catch(e){try{await c.query('ROLLBACK')}catch{};console.error('INSTRUCTOR API:',e.message||e);return json(res,e.statusCode||500,{error:e.message||'Instruktor API xatosi'});}finally{c.release();}
}

export async function handleInstructorRequest(req,res,forcedId=null){
  if(req.method==='OPTIONS'){res.statusCode=204;return res.end();}
  const u=owner(req);if(!u)return json(res,401,{error:'Kirish talab qilinadi'});
  try{
    if(req.method==='GET'&&!forcedId)return json(res,200,await rows(u));
    if(req.method==='GET'&&forcedId){const r=await rows(u,forcedId);return r?json(res,200,r):json(res,404,{error:'Instruktor topilmadi'});}
    if(req.method==='POST'&&!forcedId)return save(req,res,u,null);
    if(req.method==='PUT'&&forcedId)return save(req,res,u,forcedId);
    if(req.method==='DELETE'&&forcedId){const r=await rows(u,forcedId);if(!r)return json(res,404,{error:'Instruktor topilmadi'});await pool.query(`UPDATE instructors SET active=false,updated_at=NOW() WHERE id=$1`,[String(forcedId)]);await pool.query(`UPDATE vehicles SET avtodrom_instructor_id=NULL,updated_at=NOW() WHERE user_id=$1 AND avtodrom_instructor_id=$2`,[u,String(forcedId)]);return json(res,200,{ok:true});}
    return json(res,405,{error:'Method ruxsat etilmagan'});
  }catch(e){console.error('INSTRUCTORS API:',e.message||e);return json(res,500,{error:e.message||'Instruktorlar API xatosi'});}
}

export async function handleInstructorDaily(req,res,id){
  const u=owner(req);if(!u)return json(res,401,{error:'Kirish talab qilinadi'});
  try{
    const date=text(new URL(req.url,'http://localhost').searchParams.get('date'))||new Date().toISOString().slice(0,10);
    const instructor=await rows(u,id);if(!instructor)return json(res,404,{error:'Instruktor topilmadi'});
    const r=await pool.query(`SELECT s.id,s.started_at,s.finished_at,s.duration_seconds,s.amount,s.status,s.planned_minutes,s.hourly_rate,s.customer_type,s.payment_method,v.plate,v.model,v.driver_name,st.full_name AS student_name,ds.name AS school_name,g.name AS group_name FROM sessions s JOIN vehicles v ON v.id=s.vehicle_id LEFT JOIN students st ON st.id=s.student_id LEFT JOIN driving_schools ds ON ds.id=s.school_id LEFT JOIN school_groups g ON g.id=s.group_id WHERE s.user_id=$1 AND s.avtodrom_instructor_id=$2 AND s.started_at >= ($3::date AT TIME ZONE 'Asia/Tashkent') AND s.started_at < (($3::date + INTERVAL '1 day') AT TIME ZONE 'Asia/Tashkent') ORDER BY s.started_at DESC`,[u,String(id),date]);
    const out=r.rows.map(x=>({...x,customer_type:x.customer_type||(x.student_name?'school':'ordinary'),duration_minutes:Math.round(Number(x.duration_seconds||0)/60),amount:Number(x.amount||0)}));
    return json(res,200,{date,instructor,summary:{total:out.length,students:out.filter(x=>x.customer_type==='school').length,private:out.filter(x=>x.customer_type!=='school').length,total_minutes:out.reduce((a,x)=>a+x.duration_minutes,0),total_amount:out.reduce((a,x)=>a+x.amount,0)},rows:out});
  }catch(e){return json(res,500,{error:e.message||'Instruktor hisoboti xatosi'});}
}

export async function handleActiveV3(req,res){
  const u=owner(req);if(!u)return json(res,401,{error:'Kirish talab qilinadi'});if(req.method!=='GET')return json(res,405,{error:'Method ruxsat etilmagan'});
  try{
    const r=await pool.query(`SELECT s.id,s.vehicle_id,s.started_at,s.finished_at,s.duration_seconds,s.hourly_rate,s.minimum_payment,s.amount,s.status,s.payment_method,s.cash_amount,s.terminal_amount,s.school_id,s.group_id,s.student_id,s.manual_price,s.planned_minutes,s.avtodrom_instructor_id,s.customer_type,s.created_at,s.updated_at,v.plate,v.region_code,v.first_letter,v.number,v.last_letters,v.model,v.driver_name,ds.name AS school_name,g.name AS group_name,st.full_name AS student_name,COALESCE(NULLIF(TRIM(CONCAT_WS(' ',p.first_name,p.last_name)),''),i.bio,'') AS instructor_name,p.phone AS instructor_phone FROM sessions s JOIN vehicles v ON v.id=s.vehicle_id LEFT JOIN driving_schools ds ON ds.id=s.school_id LEFT JOIN school_groups g ON g.id=s.group_id LEFT JOIN students st ON st.id=s.student_id LEFT JOIN instructors i ON i.id=s.avtodrom_instructor_id LEFT JOIN profiles p ON p.id=i.profile_id WHERE s.user_id=$1 AND s.status IN ('active','paused','frozen') ORDER BY s.started_at ASC`,[u]);
    return json(res,200,r.rows);
  }catch(e){console.error('ACTIVE V3 ERROR:',e.message||e);return json(res,500,{error:e.message||'Faol sessiyalarni olishda xatolik'});}
}
