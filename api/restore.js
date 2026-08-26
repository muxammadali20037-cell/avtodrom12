import jwt from 'jsonwebtoken';
import { pool } from '../backend/src/db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
const uid = req => String(req.user.sub);

function auth(req,res){
  const h=req.headers?.authorization||'';
  if(!h.startsWith('Bearer ')) return null;
  try{ const u=jwt.verify(h.slice(7),JWT_SECRET); req.user=u; return u; }
  catch{ res.status(401).json({error:'Kirish talab qilinadi'}); return null; }
}
function body(req){ return req.body && typeof req.body==='object' ? req.body : {}; }
function plateParts(region,raw){
  const r=String(region||'');
  const b=String(raw||'').toUpperCase().replace(/\s+/g,'');
  if(!['01','10','20','25','30','40','50','60','70','75','80','85','90','95'].includes(r)) throw Error('Viloyat kodi noto‘g‘ri');
  if(!/^(?:[A-Z]\d{3}[A-Z]{2}|\d{3}[A-Z]{3})$/.test(b)) throw Error('Raqam A555AA yoki 555AAA ko‘rinishida bo‘lishi kerak');
  let firstLetter,number,lastLetters;
  if(/^[A-Z]\d{3}[A-Z]{2}$/.test(b)){ firstLetter=b[0]; number=b.slice(1,4); lastLetters=b.slice(4); }
  else { firstLetter=b[3]; number=b.slice(0,3); lastLetters=b.slice(4); }
  return {region:r,body:b,firstLetter,number,lastLetters,plate:`${r} ${b}`};
}

let schemaPromise;
async function ensureSchema(){
  if(schemaPromise) return schemaPromise;
  schemaPromise=(async()=>{
    await pool.query(`
      CREATE TABLE IF NOT EXISTS waiting_sessions(
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        region_code VARCHAR(4) NOT NULL,
        plate VARCHAR(20) NOT NULL,
        plate_body VARCHAR(10) NOT NULL,
        model VARCHAR(160),
        driver_name VARCHAR(160),
        school_id UUID,
        group_id UUID,
        student_id UUID,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE waiting_sessions ADD COLUMN IF NOT EXISTS plate_body VARCHAR(10);
      UPDATE waiting_sessions SET plate_body=regexp_replace(plate,'^[^ ]+ ','') WHERE plate_body IS NULL;
      CREATE INDEX IF NOT EXISTS idx_waiting_user_created ON waiting_sessions(user_id,created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_waiting_user_plate ON waiting_sessions(user_id,plate);
    `);
  })().catch(e=>{schemaPromise=null;throw e});
  return schemaPromise;
}

async function startSession(c,userId,data){
  const p=plateParts(data.regionCode,data.plateBody||data.plate);
  let schoolId=data.schoolId?String(data.schoolId):null, groupId=data.groupId?String(data.groupId):null, studentId=data.studentId?String(data.studentId):null;
  if(studentId){
    const sr=await c.query(`SELECT id,school_id,group_id FROM students WHERE id=$1 AND owner_key=$2 AND active=true`,[studentId,userId]);
    if(!sr.rows[0]) throw Error('O‘quvchi topilmadi'); schoolId=sr.rows[0].school_id; groupId=sr.rows[0].group_id;
  }
  if(schoolId){
    const sr=await c.query(`SELECT id FROM driving_schools WHERE id=$1 AND owner_key=$2 AND active=true`,[schoolId,userId]);
    if(!sr.rows[0]) throw Error('Avtoshkola topilmadi');
  }
  if(groupId){
    const gr=await c.query(`SELECT id FROM school_groups WHERE id=$1 AND school_id=$2 AND owner_key=$3 AND active=true`,[groupId,schoolId,userId]);
    if(!gr.rows[0]) throw Error('Guruh noto‘g‘ri');
  }
  let vr=await c.query(`SELECT * FROM vehicles WHERE plate=$1 AND user_id=$2`,[p.plate,userId]);
  let v=vr.rows[0];
  if(!v){
    vr=await c.query(`INSERT INTO vehicles(user_id,region_code,first_letter,number,last_letters,plate,model,driver_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[userId,p.region,p.firstLetter,p.number,p.lastLetters,p.plate,data.model||null,data.driverName||null]);
    v=vr.rows[0];
  }else{
    await c.query(`UPDATE vehicles SET model=COALESCE($1,model),driver_name=COALESCE($2,driver_name) WHERE id=$3`,[data.model||null,data.driverName||null,v.id]);
  }
  const conflict=await c.query(`SELECT id FROM sessions WHERE vehicle_id=$1 AND user_id=$2 AND status='active' LIMIT 1`,[v.id,userId]);
  if(conflict.rows[0]) throw Object.assign(Error('Bu avtomobil hozir jarayonda'),{code:'CONFLICT'});
  const set=await c.query(`SELECT hourly_rate,minimum_payment,calculation_mode FROM user_settings WHERE user_id=$1`,[userId]);
  const s=set.rows[0]||{hourly_rate:30000,minimum_payment:0,calculation_mode:'hour'};
  const r=await c.query(`INSERT INTO sessions(user_id,vehicle_id,hourly_rate,minimum_payment,calculation_mode,school_id,group_id,student_id,manual_price,started_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,true,NOW()) RETURNING id,started_at`,[userId,v.id,s.hourly_rate,s.minimum_payment,s.calculation_mode,schoolId,groupId,studentId]);
  return {id:r.rows[0].id,startedAt:r.rows[0].started_at,plate:p.plate,schoolId,groupId,studentId};
}

async function waitingCreate(req,res){
  const user=auth(req,res);if(!user)return;await ensureSchema();const b=body(req);let p;
  try{p=plateParts(b.regionCode,b.plateBody||b.plate)}catch(e){return res.status(400).json({error:e.message})}
  const c=await pool.connect();try{
    await c.query('BEGIN');
    if(b.studentId){const sr=await c.query(`SELECT id FROM students WHERE id=$1 AND owner_key=$2 AND active=true`,[b.studentId,uid(req)]);if(!sr.rows[0])throw Error('O‘quvchi topilmadi');}
    const r=await c.query(`INSERT INTO waiting_sessions(user_id,region_code,plate,plate_body,model,driver_name,school_id,group_id,student_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[uid(req),p.region,p.plate,p.body,b.model||null,b.driverName||null,b.schoolId||null,b.groupId||null,b.studentId||null]);
    await c.query('COMMIT');res.status(201).json({id:r.rows[0].id,plate:r.rows[0].plate,createdAt:r.rows[0].created_at});
  }catch(e){await c.query('ROLLBACK');res.status(e.code==='23505'?409:400).json({error:e.code==='23505'?'Bu avtomobil allaqachon kutish navbatida':e.message||'Kutish navbatiga qo‘shilmadi'});}finally{c.release()}
}
async function waitingList(req,res){
  const user=auth(req,res);if(!user)return;await ensureSchema();
  const r=await pool.query(`SELECT w.*,ds.name school_name,g.name group_name,st.full_name student_name FROM waiting_sessions w LEFT JOIN driving_schools ds ON ds.id=w.school_id LEFT JOIN school_groups g ON g.id=w.group_id LEFT JOIN students st ON st.id=w.student_id WHERE w.user_id=$1 ORDER BY w.created_at,w.id`,[uid(req)]);
  res.json(r.rows.map((x,i)=>({...x,position:i+1})));
}
async function waitingStart(req,res,id){
  const user=auth(req,res);if(!user)return;await ensureSchema();const c=await pool.connect();try{
    await c.query('BEGIN');const w=await c.query(`SELECT * FROM waiting_sessions WHERE id=$1 AND user_id=$2 FOR UPDATE`,[id,uid(req)]);
    if(!w.rows[0]){await c.query('ROLLBACK');return res.status(404).json({error:'Kutishdagi avtomobil topilmadi'})}
    const active=await c.query(`SELECT id FROM sessions WHERE user_id=$1 AND status='active' LIMIT 1`,[uid(req)]);
    if(active.rows[0]){await c.query('ROLLBACK');return res.status(409).json({error:'Hozir boshqa avtomobil jarayonda. Kutish davom etadi.'})}
    const x=w.rows[0];const result=await startSession(c,uid(req),{regionCode:x.region_code,plateBody:x.plate_body,model:x.model,driverName:x.driver_name,schoolId:x.school_id,groupId:x.group_id,studentId:x.student_id});
    await c.query(`DELETE FROM waiting_sessions WHERE id=$1 AND user_id=$2`,[id,uid(req)]);await c.query('COMMIT');res.json(result);
  }catch(e){await c.query('ROLLBACK');res.status(e.code==='CONFLICT'?409:400).json({error:e.message||'Kutishdagi avtomobilni ochishda xatolik'});}finally{c.release()}
}
async function waitingDelete(req,res,id){const user=auth(req,res);if(!user)return;await ensureSchema();const r=await pool.query(`DELETE FROM waiting_sessions WHERE id=$1 AND user_id=$2 RETURNING id`,[id,uid(req)]);if(!r.rows[0])return res.status(404).json({error:'Kutishdagi avtomobil topilmadi'});res.json({ok:true});}
async function promote(req,res){
  const user=auth(req,res);if(!user)return;await ensureSchema();const c=await pool.connect();try{
    await c.query('BEGIN');const active=await c.query(`SELECT id FROM sessions WHERE user_id=$1 AND status='active' LIMIT 1`,[uid(req)]);if(active.rows[0]){await c.query('ROLLBACK');return res.json({started:false,reason:'active'})}
    const w=await c.query(`SELECT * FROM waiting_sessions WHERE user_id=$1 ORDER BY created_at,id LIMIT 1 FOR UPDATE`,[uid(req)]);if(!w.rows[0]){await c.query('ROLLBACK');return res.json({started:false,reason:'empty'})}
    const x=w.rows[0];const result=await startSession(c,uid(req),{regionCode:x.region_code,plateBody:x.plate_body,model:x.model,driverName:x.driver_name,schoolId:x.school_id,groupId:x.group_id,studentId:x.student_id});
    await c.query(`DELETE FROM waiting_sessions WHERE id=$1 AND user_id=$2`,[x.id,uid(req)]);await c.query('COMMIT');res.json({started:true,waitingId:x.id,...result});
  }catch(e){await c.query('ROLLBACK');res.status(400).json({error:e.message||'Navbatni ochishda xatolik'});}finally{c.release()}
}
async function updateSchool(req,res,id){const user=auth(req,res);if(!user)return;const b=body(req),name=String(b.name||'').trim();if(!name)return res.status(400).json({error:'Avtoshkola nomi kerak'});const r=await pool.query(`UPDATE driving_schools SET name=$1,phone=$2,notes=$3 WHERE id=$4 AND owner_key=$5 RETURNING *`,[name,b.phone||null,b.notes||null,id,uid(req)]);if(!r.rows[0])return res.status(404).json({error:'Avtoshkola topilmadi'});res.json(r.rows[0]);}
async function deleteSchool(req,res,id){const user=auth(req,res);if(!user)return;const r=await pool.query(`DELETE FROM driving_schools WHERE id=$1 AND owner_key=$2 RETURNING id`,[id,uid(req)]);if(!r.rows[0])return res.status(404).json({error:'Avtoshkola topilmadi'});res.json({ok:true});}
async function updateGroup(req,res,id){const user=auth(req,res);if(!user)return;const b=body(req),name=String(b.name||'').trim();if(!name)return res.status(400).json({error:'Guruh nomi kerak'});const r=await pool.query(`UPDATE school_groups SET name=$1,notes=$2 WHERE id=$3 AND owner_key=$4 RETURNING *`,[name,b.notes||null,id,uid(req)]);if(!r.rows[0])return res.status(404).json({error:'Guruh topilmadi'});res.json(r.rows[0]);}
async function deleteGroup(req,res,id){const user=auth(req,res);if(!user)return;const r=await pool.query(`DELETE FROM school_groups WHERE id=$1 AND owner_key=$2 RETURNING id`,[id,uid(req)]);if(!r.rows[0])return res.status(404).json({error:'Guruh topilmadi'});res.json({ok:true});}
async function updateStudent(req,res,id){const user=auth(req,res);if(!user)return;const b=body(req),name=String(b.fullName||'').trim(),schoolId=String(b.schoolId||''),groupId=b.groupId?String(b.groupId):null;if(!name||!schoolId)return res.status(400).json({error:'F.I.Sh. va avtoshkola kerak'});const s=await pool.query(`SELECT id FROM driving_schools WHERE id=$1 AND owner_key=$2 AND active=true`,[schoolId,uid(req)]);if(!s.rows[0])return res.status(404).json({error:'Avtoshkola topilmadi'});if(groupId){const g=await pool.query(`SELECT id FROM school_groups WHERE id=$1 AND school_id=$2 AND owner_key=$3 AND active=true`,[groupId,schoolId,uid(req)]);if(!g.rows[0])return res.status(400).json({error:'Guruh noto‘g‘ri'});}const r=await pool.query(`UPDATE students SET full_name=$1,phone=$2,school_id=$3,group_id=$4,plate=$5,notes=$6 WHERE id=$7 AND owner_key=$8 RETURNING *`,[name,b.phone||null,schoolId,groupId,b.plate||null,b.notes||null,id,uid(req)]);if(!r.rows[0])return res.status(404).json({error:'O‘quvchi topilmadi'});res.json(r.rows[0]);}
async function deleteStudent(req,res,id){const user=auth(req,res);if(!user)return;const r=await pool.query(`DELETE FROM students WHERE id=$1 AND owner_key=$2 RETURNING id`,[id,uid(req)]);if(!r.rows[0])return res.status(404).json({error:'O‘quvchi topilmadi'});res.json({ok:true});}
async function bulkStudents(req,res){const user=auth(req,res);if(!user)return;const rows=Array.isArray(body(req).rows)?body(req).rows:[];if(!rows.length)return res.status(400).json({error:'Qo‘shish uchun qatorlar yo‘q'});const c=await pool.connect();let added=0,errors=[];try{await c.query('BEGIN');for(let i=0;i<rows.length;i++){const x=rows[i]||{},name=String(x.fullName||'').trim(),phone=String(x.phone||'').trim(),schoolId=String(x.schoolId||''),groupId=x.groupId?String(x.groupId):null,plate=String(x.plate||'').trim();if(!name||!schoolId){errors.push({row:i+1,error:'F.I.Sh. va avtoshkola kerak'});continue}const s=await c.query(`SELECT id FROM driving_schools WHERE id=$1 AND owner_key=$2 AND active=true`,[schoolId,uid(req)]);if(!s.rows[0]){errors.push({row:i+1,error:'Avtoshkola topilmadi'});continue}if(groupId){const g=await c.query(`SELECT id FROM school_groups WHERE id=$1 AND school_id=$2 AND owner_key=$3 AND active=true`,[groupId,schoolId,uid(req)]);if(!g.rows[0]){errors.push({row:i+1,error:'Guruh noto‘g‘ri'});continue}}const notes=`ATTENDANCE_BASE=${Math.max(0,Math.floor(Number(x.lessons||0)))}`;await c.query(`INSERT INTO students(owner_key,school_id,group_id,full_name,phone,plate,notes) VALUES($1,$2,$3,$4,$5,$6,$7)`,[uid(req),schoolId,groupId,name,phone||null,plate||null,notes]);added++;}await c.query('COMMIT');res.status(201).json({added,errors});}catch(e){await c.query('ROLLBACK');res.status(400).json({error:e.message||'Ommaviy qo‘shishda xatolik'});}finally{c.release()}}

export default async function handler(req,res){const path=new URL(req.url||'/', 'http://vercel.local').pathname;try{
  if(path==='/api/restore/waiting'&&req.method==='GET')return waitingList(req,res);
  if(path==='/api/restore/waiting'&&req.method==='POST')return waitingCreate(req,res);
  let m=path.match(/^\/api\/restore\/waiting\/([^/]+)\/start$/);if(m&&req.method==='POST')return waitingStart(req,res,m[1]);
  m=path.match(/^\/api\/restore\/waiting\/([^/]+)$/);if(m&&req.method==='DELETE')return waitingDelete(req,res,m[1]);
  if(path==='/api/restore/waiting/promote'&&req.method==='POST')return promote(req,res);
  m=path.match(/^\/api\/restore\/schools\/([^/]+)$/);if(m&&req.method==='PUT')return updateSchool(req,res,m[1]);if(m&&req.method==='DELETE')return deleteSchool(req,res,m[1]);
  m=path.match(/^\/api\/restore\/groups\/([^/]+)$/);if(m&&req.method==='PUT')return updateGroup(req,res,m[1]);if(m&&req.method==='DELETE')return deleteGroup(req,res,m[1]);
  m=path.match(/^\/api\/restore\/students\/([^/]+)$/);if(m&&req.method==='PUT')return updateStudent(req,res,m[1]);if(m&&req.method==='DELETE')return deleteStudent(req,res,m[1]);
  if(path==='/api/restore/students/bulk'&&req.method==='POST')return bulkStudents(req,res);
  if(path==='/api/restore/start'&&req.method==='POST'){const user=auth(req,res);if(!user)return;const c=await pool.connect();try{await c.query('BEGIN');const result=await startSession(c,uid(req),body(req));await c.query('COMMIT');res.status(201).json(result);}catch(e){await c.query('ROLLBACK');res.status(e.code==='CONFLICT'?409:400).json({error:e.message||'Vaqt ochilmadi'});}finally{c.release()}return;}
  return res.status(404).json({error:'Restore API endpoint topilmadi'});
}catch(e){console.error('RESTORE API',e);return res.status(500).json({error:e.message||'Server xatosi'});}}
