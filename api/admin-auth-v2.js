import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { pool } from '../backend/src/db.js';

const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const send = (res,status,data) => {
  if (res.headersSent) return true;
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.end(JSON.stringify(data));
  return true;
};
const bodyOf=req=>req.body&&typeof req.body==='object'?req.body:{};
/* ==========================================================================
   HAR BIR AKKAUNT O'Z MA'LUMOTINI KO'RADI.
   Admin paneli operator sessiyasi ichidan ochiladi va so'rov bilan birga
   "X-Operator-Token" sarlavhasida operator tokenini yuboradi. Shu token
   SERVERDA tekshiriladi va undagi foydalanuvchi ID si owner_key sifatida
   ishlatiladi. Token bo'lmasa eski yozuvlar uchun 'admin' qoladi.
   ========================================================================== */
function ownerOf(req){
  const raw = req.headers?.['x-operator-token'] || req.headers?.['X-Operator-Token'];
  if (raw && JWT_SECRET) {
    try {
      const p = jwt.verify(String(raw), JWT_SECRET);
      if (p && p.sub) return String(p.sub);
    } catch (e) { console.warn('OWNER: operator token yaroqsiz'); }
  }
  return 'admin';
}

function verifyAdmin(req){
  if(!JWT_SECRET) return null;
  const h=String(req.headers?.authorization||'');
  if(!h.startsWith('Bearer ')) return null;
  try{const p=jwt.verify(h.slice(7),JWT_SECRET);return p?.role==='admin'?p:null;}catch{return null;}
}

async function login(req, res) {
  const ENV_USER = String(ADMIN_USERNAME || '').trim();
  const ENV_PASS = String(ADMIN_PASSWORD || '').trim();

  if (!JWT_SECRET || !ENV_USER || !ENV_PASS) {
    console.error('ADMIN LOGIN: env yetishmayapti', {
      jwt: !!JWT_SECRET, user: !!ENV_USER, pass: !!ENV_PASS
    });
    return send(res, 503, {
      error: 'Admin authentication sozlanmagan. Vercel ENV: JWT_SECRET, ADMIN_USERNAME, ADMIN_PASSWORD'
    });
  }

  const body = bodyOf(req);
  const username = String(body.username || '').trim();
  const password = String(body.password || '').trim();

  if (username.toLowerCase() !== ENV_USER.toLowerCase()) {
    console.warn('ADMIN LOGIN: login mos kelmadi', {
      kiritilgan_uzunlik: username.length, env_uzunlik: ENV_USER.length
    });
    return send(res, 401, { error: 'Admin login noto‘g‘ri' });
  }
  if (password !== ENV_PASS) {
    console.warn('ADMIN LOGIN: parol mos kelmadi', {
      kiritilgan_uzunlik: password.length, env_uzunlik: ENV_PASS.length
    });
    return send(res, 401, { error: 'Admin parol noto‘g‘ri' });
  }

  const token = jwt.sign(
    { sub: 'admin', role: 'admin', username: ENV_USER },
    JWT_SECRET,
    { expiresIn: '8h' }
  );
  return send(res, 200, { token, admin: { username: ENV_USER, role: 'admin' } });
}

async function listSchools(owner){
  const r=await pool.query(`SELECT s.*,COUNT(DISTINCT g.id)::int group_count,COUNT(DISTINCT st.id)::int student_count FROM driving_schools s LEFT JOIN school_groups g ON g.school_id=s.id AND g.active=true LEFT JOIN students st ON st.school_id=s.id AND st.active=true WHERE s.owner_key=$1 AND s.active IS NOT FALSE GROUP BY s.id ORDER BY LOWER(s.name),s.created_at DESC`,[owner]); return r.rows;
}
async function listGroups(req,owner){
  const u=new URL(req.url,'http://localhost'); const id=u.searchParams.get('schoolId');
  const p=[owner]; let w='g.owner_key=$1 AND g.active IS NOT FALSE';
  if(id){p.push(id);w+=' AND g.school_id=$2';}
  const r=await pool.query(`SELECT g.*,s.name school_name,COUNT(st.id)::int student_count FROM school_groups g JOIN driving_schools s ON s.id=g.school_id LEFT JOIN students st ON st.group_id=g.id AND st.active=true WHERE ${w} GROUP BY g.id,s.name ORDER BY LOWER(s.name),LOWER(g.name)`,p); return r.rows;
}
async function listStudents(req,owner){
  const u=new URL(req.url,'http://localhost'); const p=[owner]; let w='st.owner_key=$1 AND st.active=true';
  const add=(v,sql)=>{p.push(v);w+=` AND ${sql.replace('#',String(p.length))}`;};
  if(u.searchParams.get('schoolId')) add(u.searchParams.get('schoolId'),'st.school_id=$#');
  if(u.searchParams.get('groupId')) add(u.searchParams.get('groupId'),'st.group_id=$#');
  /* Dars soni endi hisoblanmaydi - bazadagi yagona ustundan o'qiladi */
  const r=await pool.query(`SELECT st.id,st.full_name,st.phone,st.plate,st.birth_date,st.school_id,st.group_id,st.active,st.notes,COALESCE(st.attendance_count,0)::int attendance_count,s.name school_name,g.name group_name FROM students st JOIN driving_schools s ON s.id=st.school_id LEFT JOIN school_groups g ON g.id=st.group_id WHERE ${w} ORDER BY LOWER(st.full_name),st.created_at DESC`,p); return r.rows;
}

/* Darslar soni - YAGONA qiymat (students.attendance_count).
   Yuborilmagan bo'lsa null qaytadi, shunda UPDATE mavjud qiymatga tegmaydi. */
/* ==========================================================================
   Eski yozuvlarda owner_key turlicha yozilgan ('admin', boshqa foydalanuvchi
   ID si yoki umuman bo'sh). Shu sababli o'chirish/tahrirlash "topilmadi"
   berardi. Avval egasi bilan urinamiz; yozuv topilmasa, egasiz qayta urinamiz
   va o'sha paytda yozuvni joriy egaga biriktirib qo'yamiz.
   ========================================================================== */
async function ownerSafeQuery(sqlWithOwner, paramsWithOwner, sqlNoOwner, paramsNoOwner) {
  const first = await pool.query(sqlWithOwner, paramsWithOwner);
  if (first.rows[0] || first.rowCount) return first;
  return await pool.query(sqlNoOwner, paramsNoOwner);
}

function attendanceOf(b){
  const v = b.attendance_count ?? b.attendanceCount ?? b.manual_attendance_count ?? b.manualAttendanceCount;
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

async function handleResource(req,res,resource,id,owner){
  const method=req.method; const b=bodyOf(req);
  if(resource==='schools'){
    if(method==='GET') return send(res,200,await listSchools(owner));
    if(method==='POST'){const name=String(b.name||'').trim();if(!name)return send(res,400,{error:'Avtoshkola nomi kerak'});const r=await pool.query(`INSERT INTO driving_schools(owner_key,name,phone,notes,active) VALUES($1,$2,$3,$4,true) RETURNING *`,[owner,name,b.phone||null,b.notes||null]);return send(res,201,r.rows[0]);}
    if(!id)return send(res,400,{error:'ID kerak'});
    if(method==='DELETE'){
      /* Avtoshkola o'chirilsa ichidagi guruh, o'quvchi va instruktorlar ham
         birga o'chadi. Yozuvlar bazadan yo'qolmaydi - active=false qilinadi,
         shuning uchun eski sessiya tarixi buzilmaydi. */
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        let r = await c.query(`UPDATE driving_schools SET active=false WHERE id=$1 AND owner_key=$2 RETURNING id`,[id,owner]);
        if(!r.rows[0]) r = await c.query(`UPDATE driving_schools SET active=false WHERE id=$1 RETURNING id`,[id]);
        if(!r.rows[0]){ await c.query('ROLLBACK'); c.release(); return send(res,404,{error:'Avtoshkola topilmadi'}); }
        const g = await c.query(`UPDATE school_groups SET active=false WHERE school_id=$1 AND active IS NOT FALSE`,[id]);
        const st = await c.query(`UPDATE students SET active=false WHERE school_id=$1 AND active IS NOT FALSE`,[id]);
        const ins = await c.query(`UPDATE public.instructors SET active=false, updated_at=NOW()
                                    WHERE settings->>'school_id'=$1 AND active IS NOT FALSE`,[String(id)]);
        await c.query('COMMIT');
        c.release();
        return send(res,200,{ok:true, groups:g.rowCount, students:st.rowCount, instructors:ins.rowCount});
      } catch(e) {
        try { await c.query('ROLLBACK'); } catch(e2) { /* noop */ }
        c.release();
        return send(res,500,{error:e.message||'O‘chirishda xatolik'});
      }
    }
    const name=String(b.name||'').trim();if(!name)return send(res,400,{error:'Avtoshkola nomi kerak'});
    const r=await ownerSafeQuery(
      `UPDATE driving_schools SET name=$1,phone=$2,notes=$3,owner_key=$5 WHERE id=$4 AND owner_key=$5 RETURNING *`,[name,b.phone||null,b.notes||null,id,owner],
      `UPDATE driving_schools SET name=$1,phone=$2,notes=$3,owner_key=$5 WHERE id=$4 RETURNING *`,[name,b.phone||null,b.notes||null,id,owner]);
    return r.rows[0]?send(res,200,r.rows[0]):send(res,404,{error:'Avtoshkola topilmadi'});
  }
  if(resource==='groups'){
    if(method==='GET')return send(res,200,await listGroups(req,owner));
    if(method==='POST'){const schoolId=String(b.schoolId||b.school_id||'').trim(),name=String(b.name||'').trim();if(!schoolId||!name)return send(res,400,{error:'Avtoshkola va guruh kerak'});const r=await pool.query(`INSERT INTO school_groups(owner_key,school_id,name,notes,active) VALUES($1,$2,$3,$4,true) RETURNING *`,[owner,schoolId,name,b.notes||null]);return send(res,201,r.rows[0]);}
    if(!id)return send(res,400,{error:'ID kerak'}); if(method==='DELETE'){
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        let r = await c.query(`UPDATE school_groups SET active=false WHERE id=$1 AND owner_key=$2 RETURNING id`,[id,owner]);
        if(!r.rows[0]) r = await c.query(`UPDATE school_groups SET active=false WHERE id=$1 RETURNING id`,[id]);
        if(!r.rows[0]){ await c.query('ROLLBACK'); c.release(); return send(res,404,{error:'Guruh topilmadi'}); }
        /* Guruh o'chirilsa undagi o'quvchilar ham o'chadi */
        const st = await c.query(`UPDATE students SET active=false WHERE group_id=$1 AND active IS NOT FALSE`,[id]);
        await c.query('COMMIT');
        c.release();
        return send(res,200,{ok:true, students:st.rowCount});
      } catch(e) {
        try { await c.query('ROLLBACK'); } catch(e2) { /* noop */ }
        c.release();
        return send(res,500,{error:e.message||'O‘chirishda xatolik'});
      }
    } const name=String(b.name||'').trim();const r=await ownerSafeQuery(
      `UPDATE school_groups SET name=$1,notes=$2,owner_key=$4 WHERE id=$3 AND owner_key=$4 RETURNING *`,[name,b.notes||null,id,owner],
      `UPDATE school_groups SET name=$1,notes=$2,owner_key=$4 WHERE id=$3 RETURNING *`,[name,b.notes||null,id,owner]);
    return r.rows[0]?send(res,200,r.rows[0]):send(res,404,{error:'Guruh topilmadi'});
  }
  if(resource==='students'){
    if(method==='GET'){
      if(id){const rows=await listStudents({...req,url:'/api/admin/students'},owner);const s=rows.find(x=>String(x.id)===String(id));if(!s)return send(res,404,{error:'O‘quvchi topilmadi'});const h=await pool.query(`SELECT se.id,se.started_at,se.finished_at,se.duration_seconds,se.amount,se.cash_amount,se.terminal_amount,se.payment_method,v.plate,v.model,ds.name school_name,g.name group_name FROM sessions se JOIN vehicles v ON v.id=se.vehicle_id LEFT JOIN driving_schools ds ON ds.id=se.school_id LEFT JOIN school_groups g ON g.id=se.group_id WHERE se.student_id::text=$1 AND se.status='completed' ORDER BY se.started_at DESC`,[id]);return send(res,200,{student:s,rows:h.rows});}
      return send(res,200,await listStudents(req,owner));
    }
    if(method==='POST'){
      const schoolId=String(b.schoolId||b.school_id||'').trim(),groupId=b.groupId||b.group_id||null,name=String(b.fullName||b.full_name||b.name||'').trim();
      if(!schoolId||!name)return send(res,400,{error:'Avtoshkola va o‘quvchi ismi kerak'});
      const own=await pool.query(`SELECT id FROM driving_schools WHERE id=$1 AND owner_key=$2`,[schoolId,owner]);
      if(!own.rows[0])return send(res,404,{error:'Avtoshkola topilmadi'});
      /* YANGI: qo'lda kiritilgan dars soni ham saqlanadi */
      const attendance=attendanceOf(b)??0;
      const r=await pool.query(`INSERT INTO students(owner_key,school_id,group_id,full_name,phone,birth_date,plate,notes,active,attendance_count) VALUES($1,$2,$3,$4,$5,$6,$7,$8,true,$9) RETURNING *`,[owner,schoolId,groupId,name,b.phone||null,b.birthDate||b.birth_date||null,b.plate||null,b.notes||null,attendance]);
      return send(res,201,r.rows[0]);
    }
    if(!id)return send(res,400,{error:'ID kerak'});
    if(method==='DELETE'){
      const r=await ownerSafeQuery(
        `UPDATE students SET active=false WHERE id=$1 AND owner_key=$2 RETURNING id`,[id,owner],
        `UPDATE students SET active=false WHERE id=$1 RETURNING id`,[id]);
      return r.rows[0]?send(res,200,{ok:true}):send(res,404,{error:'O‘quvchi topilmadi'});
    }
    /* YANGI: avtoshkola, dars soni va holat ham yangilanadi */
    const name=String(b.fullName||b.full_name||b.name||'').trim();
    if(!name)return send(res,400,{error:'O‘quvchi ismi kerak'});
    const attendance=attendanceOf(b);
    const activeFlag=b.active===undefined?null:(b.active!==false);
    const setSql = `UPDATE students SET full_name=$1,phone=$2,birth_date=$3,plate=$4,notes=$5,group_id=$6,school_id=COALESCE($7,school_id),attendance_count=COALESCE($8,attendance_count),active=COALESCE($9,active)`;
    const vals = [name,b.phone||null,b.birthDate||b.birth_date||null,b.plate||null,b.notes||null,b.groupId||b.group_id||null,b.schoolId||b.school_id||null,attendance,activeFlag,id];
    const r=await ownerSafeQuery(
      setSql + `,owner_key=$11 WHERE id=$10 AND owner_key=$11 RETURNING *`, vals.concat([owner]),
      setSql + `,owner_key=$11 WHERE id=$10 RETURNING *`, vals.concat([owner]));
    return r.rows[0]?send(res,200,r.rows[0]):send(res,404,{error:'O‘quvchi topilmadi'});
  }
  if(resource==='instructors'){
    /* YANGI: o'chirilgan (active=false) instruktorlar ro'yxatda ko'rinmaydi */
    const r=await pool.query(`SELECT i.id,i.active,i.approved,i.bio full_name,i.settings,i.created_at,i.updated_at,i.settings->>'school_id' school_id,COALESCE(i.settings->>'vehicle_plate','') vehicle_plate,COALESCE(i.settings->>'vehicle_model','') vehicle_model,COALESCE(i.settings->>'phone','') phone,ds.name school_name FROM public.instructors i LEFT JOIN driving_schools ds ON ds.id::text=i.settings->>'school_id' WHERE i.active IS NOT FALSE AND i.settings->>'owner_key'=$1 ORDER BY LOWER(COALESCE(i.bio,'')),i.created_at DESC`,[owner]);if(method==='GET')return send(res,200,id?(r.rows.find(x=>String(x.id)===String(id))||null):r.rows);if(method==='DELETE'&&id){const d=await pool.query(`UPDATE public.instructors SET active=false,updated_at=NOW() WHERE id=$1 AND settings->>'owner_key'=$2 RETURNING id`,[id,owner]);return d.rows[0]?send(res,200,{ok:true}):send(res,404,{error:'Instruktor topilmadi'});}if(method==='POST'||(method==='PUT'||method==='PATCH')){const name=String(b.fullName||b.full_name||b.name||'').trim(),schoolId=String(b.schoolId||b.school_id||'').trim();if(!name||!schoolId)return send(res,400,{error:'F.I.Sh. va avtoshkola kerak'});const settings={owner_key:owner,school_id:schoolId,group_id:null,vehicle_id:null,vehicle_plate:String(b.vehiclePlate||b.vehicle_plate||b.plate||'').toUpperCase().replace(/\s+/g,' ').trim(),vehicle_model:String(b.vehicleModel||b.vehicle_model||b.model||'').trim(),driver_name:name,phone:String(b.phone||'').trim()};if(method==='POST'){const rid=crypto.randomUUID();await pool.query(`INSERT INTO public.instructors(id,active,approved,approved_at,approved_by,bio,settings,created_at,updated_at) VALUES($1,true,true,NOW(),$4,$2,$3::jsonb,NOW(),NOW())`,[rid,name,JSON.stringify(settings),String(owner).slice(0,60)]);return send(res,201,{id:rid,full_name:name,school_id:schoolId,vehicle_plate:settings.vehicle_plate,vehicle_model:settings.vehicle_model});}await pool.query(`UPDATE public.instructors SET bio=$1,active=$2,updated_at=NOW(),settings=$3::jsonb WHERE id=$4 AND settings->>'owner_key'=$5`,[name,b.active!==false,JSON.stringify(settings),id,owner]);return send(res,200,{ok:true});}
  }
  return send(res,404,{error:'Admin endpoint topilmadi'});
}

export async function handleAdminRequest(req,res){
  const pathname=String(req.url||'').split('?')[0];
  if(!pathname.startsWith('/api/admin'))return false;
  if(req.method==='OPTIONS'){res.statusCode=204;return res.end();}
  if(req.method==='POST'&&pathname==='/api/admin/login')return login(req,res);
  if(!JWT_SECRET)return send(res,503,{error:'JWT_SECRET sozlanmagan'});
  if(!verifyAdmin(req))return send(res,403,{error:'Admin ruxsati kerak'});
  try{
    const owner=ownerOf(req);
    const rest=pathname.slice('/api/admin'.length); const parts=rest.split('/').filter(Boolean); const resource=parts[0]||''; const id=parts[1]||null;
    if(resource==='me'&&req.method==='GET')return send(res,200,{admin:{username:ADMIN_USERNAME,role:'admin'}});
    if(resource==='dashboard'&&req.method==='GET'){
      const r=await pool.query(`SELECT COUNT(*) FILTER(WHERE status='active')::int active,COUNT(*) FILTER(WHERE status='completed' AND started_at::date=CURRENT_DATE)::int today_count,COALESCE(SUM(duration_seconds) FILTER(WHERE status='completed' AND started_at::date=CURRENT_DATE),0)::bigint today_seconds,COALESCE(SUM(amount) FILTER(WHERE status='completed' AND started_at::date=CURRENT_DATE),0)::numeric today_amount,COALESCE(SUM(cash_amount) FILTER(WHERE status='completed' AND started_at::date=CURRENT_DATE),0)::numeric today_cash,COALESCE(SUM(terminal_amount) FILTER(WHERE status='completed' AND started_at::date=CURRENT_DATE),0)::numeric today_terminal FROM sessions WHERE user_id::text=$1`,[owner]);return send(res,200,r.rows[0]);
    }
    if(resource==='reports'&&parts[1]==='daily'&&req.method==='GET'){
      const date=new URL(req.url,'http://localhost').searchParams.get('date')||new Date().toISOString().slice(0,10);const r=await pool.query(`SELECT se.id,v.plate,v.model,v.driver_name,se.started_at,se.finished_at,se.duration_seconds,se.amount,se.cash_amount,se.terminal_amount,se.payment_method,ds.name school_name,g.name group_name,st.full_name student_name FROM sessions se JOIN vehicles v ON v.id=se.vehicle_id LEFT JOIN driving_schools ds ON ds.id=se.school_id LEFT JOIN school_groups g ON g.id=se.group_id LEFT JOIN students st ON st.id=se.student_id WHERE se.status='completed' AND se.started_at::date=$1 AND se.user_id::text=$2 ORDER BY se.started_at DESC`,[date,owner]);const summary=r.rows.reduce((a,x)=>(a.count++,a.seconds+=Number(x.duration_seconds||0),a.amount+=Number(x.amount||0),a.cash+=Number(x.cash_amount||0),a.terminal+=Number(x.terminal_amount||0),a),{count:0,seconds:0,amount:0,cash:0,terminal:0});return send(res,200,{date,summary,rows:r.rows});
    }
    if(resource==='sessions'&&parts[1]&&req.method==='GET')return handleResource(req,res,'sessions_'+parts[1],null,owner);
    return handleResource(req,res,resource,id,owner);
  }catch(e){console.error('ADMIN API:',e);return send(res,500,{error:e?.message||'Admin server xatosi'});}
}
