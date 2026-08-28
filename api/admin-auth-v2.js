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
function verifyAdmin(req){
  if(!JWT_SECRET) return null;
  const h=String(req.headers?.authorization||'');
  if(!h.startsWith('Bearer ')) return null;
  try{const p=jwt.verify(h.slice(7),JWT_SECRET);return p?.role==='admin'?p:null;}catch{return null;}
}

/* =============================================================================
   PATCH: api/admin-auth-v2.js  —  login() funksiyasini shu bilan almashtiring.

   Nima o'zgaradi:
   1. ENV qiymatlari trim qilinadi. Vercel'ga parol nusxalanganda oxiriga
      ko'rinmas bo'sh joy yoki yangi qator tushib qolishi juda tez-tez uchraydi;
      hozirgi kod qat'iy (===) solishtirgani uchun bu 401 beradi.
   2. Xato sababi aniq aytiladi: login xatomi yoki parol xatomi.
      Parolning o'zi hech qayerda qaytarilmaydi.
   3. Diagnostika uchun serverga log yoziladi (uzunliklar, qiymatlar emas).
   ============================================================================= */

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

async function listSchools(){
  const r=await pool.query(`SELECT s.*,COUNT(DISTINCT g.id)::int group_count,COUNT(DISTINCT st.id)::int student_count FROM driving_schools s LEFT JOIN school_groups g ON g.school_id=s.id AND g.active=true LEFT JOIN students st ON st.school_id=s.id AND st.active=true GROUP BY s.id ORDER BY LOWER(s.name),s.created_at DESC`); return r.rows;
}
async function listGroups(req){
  const u=new URL(req.url,'http://localhost'); const id=u.searchParams.get('schoolId'); const p=id?[id]:[]; const w=id?'g.school_id=$1':'1=1';
  const r=await pool.query(`SELECT g.*,s.name school_name,COUNT(st.id)::int student_count FROM school_groups g JOIN driving_schools s ON s.id=g.school_id LEFT JOIN students st ON st.group_id=g.id AND st.active=true WHERE ${w} GROUP BY g.id,s.name ORDER BY LOWER(s.name),LOWER(g.name)`,p); return r.rows;
}
async function listStudents(req){
  const u=new URL(req.url,'http://localhost'); const p=[]; let w='st.active=true';
  const add=(v,sql)=>{p.push(v);w+=` AND ${sql.replace('#',String(p.length))}`;};
  if(u.searchParams.get('schoolId')) add(u.searchParams.get('schoolId'),'st.school_id=$#');
  if(u.searchParams.get('groupId')) add(u.searchParams.get('groupId'),'st.group_id=$#');
  const r=await pool.query(`SELECT st.*,s.name school_name,g.name group_name,COALESCE(st.manual_attendance_count,0)+(SELECT COUNT(*) FROM sessions se WHERE se.student_id=st.id AND se.status='completed')::int attendance_count FROM students st JOIN driving_schools s ON s.id=st.school_id LEFT JOIN school_groups g ON g.id=st.group_id WHERE ${w} ORDER BY LOWER(st.full_name),st.created_at DESC`,p); return r.rows;
}
async function handleResource(req,res,resource,id){
  const method=req.method; const b=bodyOf(req);
  if(resource==='schools'){
    if(method==='GET') return send(res,200,await listSchools());
    if(method==='POST'){const name=String(b.name||'').trim();if(!name)return send(res,400,{error:'Avtoshkola nomi kerak'});const r=await pool.query(`INSERT INTO driving_schools(owner_key,name,phone,notes,active) VALUES('admin',$1,$2,$3,true) RETURNING *`,[name,b.phone||null,b.notes||null]);return send(res,201,r.rows[0]);}
    if(!id)return send(res,400,{error:'ID kerak'});
    if(method==='DELETE'){const r=await pool.query(`UPDATE driving_schools SET active=false WHERE id=$1 RETURNING id`,[id]);return r.rows[0]?send(res,200,{ok:true}):send(res,404,{error:'Avtoshkola topilmadi'});}
    const name=String(b.name||'').trim();if(!name)return send(res,400,{error:'Avtoshkola nomi kerak'});const r=await pool.query(`UPDATE driving_schools SET name=$1,phone=$2,notes=$3 WHERE id=$4 RETURNING *`,[name,b.phone||null,b.notes||null,id]);return r.rows[0]?send(res,200,r.rows[0]):send(res,404,{error:'Avtoshkola topilmadi'});
  }
  if(resource==='groups'){
    if(method==='GET')return send(res,200,await listGroups(req));
    if(method==='POST'){const schoolId=String(b.schoolId||b.school_id||'').trim(),name=String(b.name||'').trim();if(!schoolId||!name)return send(res,400,{error:'Avtoshkola va guruh kerak'});const r=await pool.query(`INSERT INTO school_groups(owner_key,school_id,name,notes,active) VALUES('admin',$1,$2,$3,true) RETURNING *`,[schoolId,name,b.notes||null]);return send(res,201,r.rows[0]);}
    if(!id)return send(res,400,{error:'ID kerak'}); if(method==='DELETE'){const r=await pool.query(`UPDATE school_groups SET active=false WHERE id=$1 RETURNING id`,[id]);return r.rows[0]?send(res,200,{ok:true}):send(res,404,{error:'Guruh topilmadi'});} const name=String(b.name||'').trim();const r=await pool.query(`UPDATE school_groups SET name=$1,notes=$2 WHERE id=$3 RETURNING *`,[name,b.notes||null,id]);return r.rows[0]?send(res,200,r.rows[0]):send(res,404,{error:'Guruh topilmadi'});
  }
  if(resource==='students'){
    if(method==='GET'){
      if(id){const rows=await listStudents({...req,url:'/api/admin/students'});const s=rows.find(x=>String(x.id)===String(id));if(!s)return send(res,404,{error:'O‘quvchi topilmadi'});const h=await pool.query(`SELECT se.id,se.started_at,se.finished_at,se.duration_seconds,se.amount,se.payment_method,v.plate,v.model,ds.name school_name,g.name group_name FROM sessions se JOIN vehicles v ON v.id=se.vehicle_id LEFT JOIN driving_schools ds ON ds.id=se.school_id LEFT JOIN school_groups g ON g.id=se.group_id WHERE se.student_id=$1 AND se.status='completed' ORDER BY se.started_at DESC`,[id]);return send(res,200,{student:s,rows:h.rows});}
      return send(res,200,await listStudents(req));
    }
    if(method==='POST'){const schoolId=String(b.schoolId||b.school_id||'').trim(),groupId=b.groupId||b.group_id||null,name=String(b.fullName||b.full_name||b.name||'').trim();if(!schoolId||!name)return send(res,400,{error:'Avtoshkola va o‘quvchi ismi kerak'});const r=await pool.query(`INSERT INTO students(owner_key,school_id,group_id,full_name,phone,birth_date,plate,notes,active) VALUES('admin',$1,$2,$3,$4,$5,$6,$7,true) RETURNING *`,[schoolId,groupId,name,b.phone||null,b.birthDate||b.birth_date||null,b.plate||null,b.notes||null]);return send(res,201,r.rows[0]);}
    if(!id)return send(res,400,{error:'ID kerak'}); if(method==='DELETE'){const r=await pool.query(`UPDATE students SET active=false WHERE id=$1 RETURNING id`,[id]);return r.rows[0]?send(res,200,{ok:true}):send(res,404,{error:'O‘quvchi topilmadi'});} const name=String(b.fullName||b.full_name||b.name||b.fullName||'').trim();const r=await pool.query(`UPDATE students SET full_name=$1,phone=$2,birth_date=$3,plate=$4,notes=$5,group_id=$6 WHERE id=$7 RETURNING *`,[name,b.phone||null,b.birthDate||b.birth_date||null,b.plate||null,b.notes||null,b.groupId||b.group_id||null,id]);return r.rows[0]?send(res,200,r.rows[0]):send(res,404,{error:'O‘quvchi topilmadi'});
  }
  if(resource==='instructors'){
    const r=await pool.query(`SELECT i.id,i.active,i.approved,i.bio full_name,i.settings,i.created_at,i.updated_at,i.settings->>'school_id' school_id,COALESCE(i.settings->>'vehicle_plate','') vehicle_plate,COALESCE(i.settings->>'vehicle_model','') vehicle_model,ds.name school_name FROM public.instructors i LEFT JOIN driving_schools ds ON ds.id::text=i.settings->>'school_id' ORDER BY LOWER(COALESCE(i.bio,'')),i.created_at DESC`);if(method==='GET')return send(res,200,id?(r.rows.find(x=>String(x.id)===String(id))||null):r.rows);if(method==='DELETE'&&id){const d=await pool.query(`UPDATE public.instructors SET active=false,updated_at=NOW() WHERE id=$1 RETURNING id`,[id]);return d.rows[0]?send(res,200,{ok:true}):send(res,404,{error:'Instruktor topilmadi'});}if(method==='POST'||(method==='PUT'||method==='PATCH')){const name=String(b.fullName||b.full_name||b.name||'').trim(),schoolId=String(b.schoolId||b.school_id||'').trim();if(!name||!schoolId)return send(res,400,{error:'F.I.Sh. va avtoshkola kerak'});const settings={owner_key:'admin',school_id:schoolId,group_id:null,vehicle_id:null,vehicle_plate:String(b.vehiclePlate||b.vehicle_plate||b.plate||'').toUpperCase().replace(/\s+/g,' ').trim(),vehicle_model:String(b.vehicleModel||b.vehicle_model||b.model||'').trim(),driver_name:name,phone:String(b.phone||'').trim()};if(method==='POST'){const rid=crypto.randomUUID();await pool.query(`INSERT INTO public.instructors(id,active,approved,approved_at,approved_by,bio,settings,created_at,updated_at) VALUES($1,true,true,NOW(),'admin',$2,$3::jsonb,NOW(),NOW())`,[rid,name,JSON.stringify(settings)]);return send(res,201,{id:rid,full_name:name,school_id:schoolId,vehicle_plate:settings.vehicle_plate,vehicle_model:settings.vehicle_model});}await pool.query(`UPDATE public.instructors SET bio=$1,active=$2,updated_at=NOW(),settings=$3::jsonb WHERE id=$4`,[name,b.active!==false,JSON.stringify(settings),id]);return send(res,200,{ok:true});}
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
    const rest=pathname.slice('/api/admin'.length); const parts=rest.split('/').filter(Boolean); const resource=parts[0]||''; const id=parts[1]||null;
    if(resource==='me'&&req.method==='GET')return send(res,200,{admin:{username:ADMIN_USERNAME,role:'admin'}});
    if(resource==='dashboard'&&req.method==='GET'){
      const r=await pool.query(`SELECT COUNT(*) FILTER(WHERE status='active')::int active,COUNT(*) FILTER(WHERE status='completed' AND started_at::date=CURRENT_DATE)::int today_count,COALESCE(SUM(duration_seconds) FILTER(WHERE status='completed' AND started_at::date=CURRENT_DATE),0)::bigint today_seconds,COALESCE(SUM(amount) FILTER(WHERE status='completed' AND started_at::date=CURRENT_DATE),0)::numeric today_amount,COALESCE(SUM(cash_amount) FILTER(WHERE status='completed' AND started_at::date=CURRENT_DATE),0)::numeric today_cash,COALESCE(SUM(terminal_amount) FILTER(WHERE status='completed' AND started_at::date=CURRENT_DATE),0)::numeric today_terminal FROM sessions`);return send(res,200,r.rows[0]);
    }
    if(resource==='reports'&&parts[1]==='daily'&&req.method==='GET'){
      const date=new URL(req.url,'http://localhost').searchParams.get('date')||new Date().toISOString().slice(0,10);const r=await pool.query(`SELECT se.id,v.plate,v.model,v.driver_name,se.started_at,se.finished_at,se.duration_seconds,se.amount,se.cash_amount,se.terminal_amount,se.payment_method,ds.name school_name,g.name group_name,st.full_name student_name FROM sessions se JOIN vehicles v ON v.id=se.vehicle_id LEFT JOIN driving_schools ds ON ds.id=se.school_id LEFT JOIN school_groups g ON g.id=se.group_id LEFT JOIN students st ON st.id=se.student_id WHERE se.status='completed' AND se.started_at::date=$1 ORDER BY se.started_at DESC`,[date]);const summary=r.rows.reduce((a,x)=>(a.count++,a.seconds+=Number(x.duration_seconds||0),a.amount+=Number(x.amount||0),a.cash+=Number(x.cash_amount||0),a.terminal+=Number(x.terminal_amount||0),a),{count:0,seconds:0,amount:0,cash:0,terminal:0});return send(res,200,{date,summary,rows:r.rows});
    }
    if(resource==='sessions'&&parts[1]&&req.method==='GET')return handleResource(req,res,'sessions_'+parts[1],null);
    return handleResource(req,res,resource,id);
  }catch(e){console.error('ADMIN API:',e);return send(res,500,{error:e?.message||'Admin server xatosi'});}
}
