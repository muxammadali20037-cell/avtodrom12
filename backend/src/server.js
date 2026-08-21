import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

dotenv.config();
const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendPath = path.resolve(__dirname, '../../frontend');
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

const REGIONS = ['01','10','20','25','30','40','50','60','70','75','80','85','90','95'];
const uid = req => String(req.user.sub);
const num = v => Number.isFinite(Number(v)) ? Number(v) : 0;

function tokenFor(user) {
  return jwt.sign({ sub: user.id, role: user.role, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
}
function auth(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    if (!h.startsWith('Bearer ')) return res.status(401).json({ error: 'Kirish talab qilinadi' });
    req.user = jwt.verify(h.slice(7), JWT_SECRET);
    next();
  } catch { return res.status(401).json({ error: 'Sessiya yaroqsiz yoki tugagan' }); }
}
function plateData(body) {
  const region = String(body.regionCode || '');
  const firstLetter = String(body.firstLetter || '').toUpperCase();
  const number = String(body.number || '');
  const lastLetters = String(body.lastLetters || '').toUpperCase();
  if (!REGIONS.includes(region)) throw new Error('Viloyat kodi noto‘g‘ri');
  if (!/^[A-Z]$/.test(firstLetter)) throw new Error('Birinchi harf noto‘g‘ri');
  if (!/^\d{3}$/.test(number)) throw new Error('Avtomobil raqami 3 xonali bo‘lishi kerak');
  if (!/^[A-Z]{2}$/.test(lastLetters)) throw new Error('Oxirgi harflar noto‘g‘ri');
  return { region, firstLetter, number, lastLetters, plate: `${region} ${firstLetter} ${number} ${lastLetters}` };
}
async function ensureAccountData(userId) {
  await pool.query(`INSERT INTO user_settings(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING`, [userId]);
}
async function ensureFeatureSchema() {
  const q = async sql => { try { await pool.query(sql); } catch (e) { console.error('FEATURE SCHEMA:', e.message); } };
  await q(`CREATE TABLE IF NOT EXISTS driving_schools(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),owner_key TEXT NOT NULL,name VARCHAR(160) NOT NULL,phone VARCHAR(50),notes TEXT,active BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await q(`CREATE TABLE IF NOT EXISTS school_groups(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),owner_key TEXT NOT NULL,school_id UUID NOT NULL REFERENCES driving_schools(id) ON DELETE CASCADE,name VARCHAR(120) NOT NULL,notes TEXT,active BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await q(`CREATE TABLE IF NOT EXISTS students(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),owner_key TEXT NOT NULL,school_id UUID NOT NULL REFERENCES driving_schools(id) ON DELETE CASCADE,group_id UUID REFERENCES school_groups(id) ON DELETE SET NULL,full_name VARCHAR(160) NOT NULL,phone VARCHAR(50),plate VARCHAR(20),notes TEXT,active BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await q(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20) NOT NULL DEFAULT 'cash'`);
  await q(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS cash_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await q(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS terminal_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await q(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS school_id UUID`);
  await q(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS group_id UUID`);
  await q(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS student_id UUID`);
  await q(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS manual_price BOOLEAN NOT NULL DEFAULT TRUE`);
  await q(`UPDATE sessions SET cash_amount=COALESCE(amount,0),payment_method='cash' WHERE status='completed' AND COALESCE(amount,0)>0 AND COALESCE(cash_amount,0)=0 AND COALESCE(terminal_amount,0)=0`);
  await q(`CREATE INDEX IF NOT EXISTS idx_sessions_plate_time ON sessions(vehicle_id,started_at DESC)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_sessions_payment ON sessions(payment_method)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_students_owner ON students(owner_key)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_school_groups_owner ON school_groups(owner_key)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_schools_owner ON driving_schools(owner_key)`);
}

app.get('/api/health', async (req,res)=>{ try { await pool.query('SELECT 1'); res.json({ok:true,database:true}); } catch { res.status(503).json({ok:false,database:false}); } });
app.post('/api/auth/register', async (req,res)=>{ const {fullName,username,password}=req.body; if(!fullName||!username||!password)return res.status(400).json({error:'Ism, login va parol kerak'}); if(String(password).length<6)return res.status(400).json({error:'Parol kamida 6 belgidan iborat bo‘lishi kerak'}); const c=await pool.connect(); try { await c.query('BEGIN'); const hash=await bcrypt.hash(password,12); const r=await c.query(`INSERT INTO users(full_name,username,password_hash) VALUES($1,$2,$3) RETURNING id,full_name,username,role`,[String(fullName).trim(),String(username).trim(),hash]); const user=r.rows[0]; await c.query(`INSERT INTO user_settings(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING`,[user.id]); await c.query('COMMIT'); res.status(201).json({user,token:tokenFor(user)}); } catch(e) { await c.query('ROLLBACK'); res.status(e.code==='23505'?409:500).json({error:e.code==='23505'?'Bu login mavjud':'Ro‘yxatdan o‘tishda server xatosi'}); } finally { c.release(); } });
app.post('/api/auth/login', async (req,res)=>{ try { const username=String(req.body.username||'').trim(),password=String(req.body.password||''); const r=await pool.query(`SELECT * FROM users WHERE username=$1 LIMIT 1`,[username]); if(!r.rows[0]||!(await bcrypt.compare(password,r.rows[0].password_hash)))return res.status(401).json({error:'Login yoki parol noto‘g‘ri'}); const u=r.rows[0],user={id:u.id,full_name:u.full_name,username:u.username,role:u.role}; await ensureAccountData(user.id); res.json({user,token:tokenFor(user)}); } catch { res.status(500).json({error:'Kirishda server xatosi'}); } });

app.get('/api/settings',auth,async(req,res)=>{try{await ensureAccountData(uid(req));const r=await pool.query(`SELECT hourly_rate,minimum_payment,calculation_mode FROM user_settings WHERE user_id=$1`,[uid(req)]);const x=r.rows[0];res.json({hourlyRate:Number(x?.hourly_rate||30000),minimumPayment:Number(x?.minimum_payment||0),calculationMode:x?.calculation_mode||'hour'})}catch{res.status(500).json({error:'Sozlamalarni olishda xatolik'})}});
app.put('/api/settings',auth,async(req,res)=>{try{await ensureAccountData(uid(req));const hourlyRate=num(req.body.hourlyRate),minimumPayment=num(req.body.minimumPayment);const mode=req.body.calculationMode==='minute'?'minute':'hour';if(hourlyRate<=0||minimumPayment<0)return res.status(400).json({error:'Narx noto‘g‘ri'});const r=await pool.query(`UPDATE user_settings SET hourly_rate=$1,minimum_payment=$2,calculation_mode=$3,updated_at=NOW() WHERE user_id=$4 RETURNING hourly_rate,minimum_payment,calculation_mode`,[hourlyRate,minimumPayment,mode,uid(req)]);res.json({hourlyRate:Number(r.rows[0].hourly_rate),minimumPayment:Number(r.rows[0].minimum_payment),calculationMode:r.rows[0].calculation_mode})}catch{res.status(500).json({error:'Sozlamalarni saqlashda xatolik'})}});

app.get('/api/schools',auth,async(req,res)=>{const r=await pool.query(`SELECT s.*,COUNT(DISTINCT g.id)::int group_count,COUNT(DISTINCT st.id)::int student_count FROM driving_schools s LEFT JOIN school_groups g ON g.school_id=s.id AND g.active=true LEFT JOIN students st ON st.school_id=s.id AND st.active=true WHERE s.owner_key=$1 GROUP BY s.id ORDER BY s.name`,[uid(req)]);res.json(r.rows)});
app.post('/api/schools',auth,async(req,res)=>{const name=String(req.body.name||'').trim();if(!name)return res.status(400).json({error:'Avtoshkola nomi kerak'});const r=await pool.query(`INSERT INTO driving_schools(owner_key,name,phone,notes) VALUES($1,$2,$3,$4) RETURNING *`,[uid(req),name,req.body.phone||null,req.body.notes||null]);res.status(201).json(r.rows[0])});
app.get('/api/groups',auth,async(req,res)=>{const p=[uid(req)];let w='g.owner_key=$1';if(req.query.schoolId){p.push(req.query.schoolId);w+=' AND g.school_id=$2'}const r=await pool.query(`SELECT g.*,s.name school_name,COUNT(st.id)::int student_count FROM school_groups g JOIN driving_schools s ON s.id=g.school_id LEFT JOIN students st ON st.group_id=g.id AND st.active=true WHERE ${w} GROUP BY g.id,s.name ORDER BY s.name,g.name`,p);res.json(r.rows)});
app.post('/api/groups',auth,async(req,res)=>{const schoolId=String(req.body.schoolId||''),name=String(req.body.name||'').trim();if(!schoolId||!name)return res.status(400).json({error:'Avtoshkola va guruh kerak'});const own=await pool.query(`SELECT id FROM driving_schools WHERE id=$1 AND owner_key=$2`,[schoolId,uid(req)]);if(!own.rows[0])return res.status(404).json({error:'Avtoshkola topilmadi'});const r=await pool.query(`INSERT INTO school_groups(owner_key,school_id,name,notes) VALUES($1,$2,$3,$4) RETURNING *`,[uid(req),schoolId,name,req.body.notes||null]);res.status(201).json(r.rows[0])});
app.get('/api/students',auth,async(req,res)=>{const p=[uid(req)];let w='st.owner_key=$1';if(req.query.schoolId){p.push(req.query.schoolId);w+=` AND st.school_id=$${p.length}`}if(req.query.groupId){p.push(req.query.groupId);w+=` AND st.group_id=$${p.length}`}const r=await pool.query(`SELECT st.*,s.name school_name,g.name group_name,COUNT(se.id)::int attendance_count FROM students st JOIN driving_schools s ON s.id=st.school_id LEFT JOIN school_groups g ON g.id=st.group_id LEFT JOIN sessions se ON se.student_id=st.id AND se.status='completed' WHERE ${w} GROUP BY st.id,s.name,g.name ORDER BY st.full_name`,p);res.json(r.rows)});
app.post('/api/students',auth,async(req,res)=>{const schoolId=String(req.body.schoolId||''),groupId=req.body.groupId?String(req.body.groupId):null,name=String(req.body.fullName||'').trim();if(!schoolId||!name)return res.status(400).json({error:'Avtoshkola va o‘quvchi ismi kerak'});const s=await pool.query(`SELECT id FROM driving_schools WHERE id=$1 AND owner_key=$2`,[schoolId,uid(req)]);if(!s.rows[0])return res.status(404).json({error:'Avtoshkola topilmadi'});if(groupId){const g=await pool.query(`SELECT id FROM school_groups WHERE id=$1 AND school_id=$2 AND owner_key=$3`,[groupId,schoolId,uid(req)]);if(!g.rows[0])return res.status(400).json({error:'Guruh noto‘g‘ri'})}const r=await pool.query(`INSERT INTO students(owner_key,school_id,group_id,full_name,phone,plate,notes) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[uid(req),schoolId,groupId,name,req.body.phone||null,req.body.plate||null,req.body.notes||null]);res.status(201).json(r.rows[0])});

app.get('/api/sessions/active',auth,async(req,res)=>{const r=await pool.query(`SELECT s.id,v.plate,v.model,v.driver_name,s.started_at,s.school_id,s.group_id,s.student_id,ds.name school_name,g.name group_name,st.full_name student_name FROM sessions s JOIN vehicles v ON v.id=s.vehicle_id LEFT JOIN driving_schools ds ON ds.id=s.school_id LEFT JOIN school_groups g ON g.id=s.group_id LEFT JOIN students st ON st.id=s.student_id WHERE s.user_id=$1 AND s.status='active' ORDER BY s.started_at`,[uid(req)]);res.json(r.rows)});
app.post('/api/sessions/start',auth,async(req,res)=>{let p;try{p=plateData(req.body)}catch(e){return res.status(400).json({error:e.message})}const c=await pool.connect();try{await c.query('BEGIN');let vr=await c.query(`SELECT * FROM vehicles WHERE plate=$1 AND user_id=$2`,[p.plate,uid(req)]);let v=vr.rows[0];if(!v){vr=await c.query(`INSERT INTO vehicles(user_id,region_code,first_letter,number,last_letters,plate,model,driver_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[uid(req),p.region,p.firstLetter,p.number,p.lastLetters,p.plate,req.body.model||null,req.body.driverName||null]);v=vr.rows[0]}
let schoolId=req.body.schoolId?String(req.body.schoolId):null,groupId=req.body.groupId?String(req.body.groupId):null,studentId=req.body.studentId?String(req.body.studentId):null;
if(studentId){const sr=await c.query(`SELECT id,school_id,group_id FROM students WHERE id=$1 AND owner_key=$2 AND active=true`,[studentId,uid(req)]);if(!sr.rows[0])throw new Error('O‘quvchi topilmadi');schoolId=sr.rows[0].school_id;groupId=sr.rows[0].group_id}
if(schoolId){const sr=await c.query(`SELECT id FROM driving_schools WHERE id=$1 AND owner_key=$2 AND active=true`,[schoolId,uid(req)]);if(!sr.rows[0])throw new Error('Avtoshkola topilmadi')}
if(groupId){const gr=await c.query(`SELECT id FROM school_groups WHERE id=$1 AND school_id=$2 AND owner_key=$3 AND active=true`,[groupId,schoolId,uid(req)]);if(!gr.rows[0])throw new Error('Guruh noto‘g‘ri')}
const set=await c.query(`SELECT hourly_rate,minimum_payment,calculation_mode FROM user_settings WHERE user_id=$1`,[uid(req)]);const s=set.rows[0]||{hourly_rate:30000,minimum_payment:0,calculation_mode:'hour'};
const r=await c.query(`INSERT INTO sessions(user_id,vehicle_id,hourly_rate,minimum_payment,calculation_mode,school_id,group_id,student_id,manual_price) VALUES($1,$2,$3,$4,$5,$6,$7,$8,true) RETURNING id,started_at`,[uid(req),v.id,s.hourly_rate,s.minimum_payment, s.calculation_mode,schoolId,groupId,studentId]);await c.query('COMMIT');res.status(201).json({id:r.rows[0].id,plate:p.plate,startedAt:r.rows[0].started_at,schoolId,groupId,studentId})}catch(e){await c.query('ROLLBACK');res.status(e.code==='23505'?409:400).json({error:e.code==='23505'?'Bu avtomobil hozir jarayonda':e.message||'START bajarilmadi'})}finally{c.release()}});
app.post('/api/sessions/:id/finish',auth,async(req,res)=>{const c=await pool.connect();try{await c.query('BEGIN');const r=await c.query(`SELECT s.*,v.plate,ds.name school_name,g.name group_name,st.full_name student_name FROM sessions s JOIN vehicles v ON v.id=s.vehicle_id LEFT JOIN driving_schools ds ON ds.id=s.school_id LEFT JOIN school_groups g ON g.id=s.group_id LEFT JOIN students st ON st.id=s.student_id WHERE s.id=$1 AND s.user_id=$2 AND s.status='active' FOR UPDATE`,[req.params.id,uid(req)]);if(!r.rows[0]){await c.query('ROLLBACK');return res.status(404).json({error:'Faol sessiya topilmadi'})}const s=r.rows[0],end=new Date(),seconds=Math.max(0,Math.floor((end-new Date(s.started_at))/1000)),amount=num(req.body.amount);if(amount<0)return res.status(400).json({error:'Narx noto‘g‘ri'});let cash=num(req.body.cashAmount),terminal=num(req.body.terminalAmount);const method=['cash','terminal','mixed'].includes(req.body.paymentMethod)?req.body.paymentMethod:'cash';if(s.student_id){if(amount!==0)return res.status(400).json({error:'Avtoshkola o‘quvchisi uchun to‘lov 0 bo‘lishi kerak'});cash=0;terminal=0}else{if(method==='cash'){cash=amount;terminal=0}else if(method==='terminal'){cash=0;terminal=amount}else if(Math.abs(cash+terminal-amount)>0.01)return res.status(400).json({error:'Naqd + terminal summasi umumiy narxga teng bo‘lishi kerak'})}const u=await c.query(`UPDATE sessions SET finished_at=$1,duration_seconds=$2,amount=$3,cash_amount=$4,terminal_amount=$5,payment_method=$6,status='completed' WHERE id=$7 AND user_id=$8 RETURNING *`,[end,seconds,amount,cash,terminal,method,s.id,uid(req)]);await c.query('COMMIT');res.json({...u.rows[0],plate:s.plate,amount:Number(amount),cash_amount:Number(cash),terminal_amount:Number(terminal),school_name:s.school_name,group_name:s.group_name,student_name:s.student_name})}catch(e){await c.query('ROLLBACK');res.status(400).json({error:e.message||'FINISH bajarilmadi'})}finally{c.release()}});

app.get('/api/reports/daily',auth,async(req,res)=>{try{const date=/^\d{4}-\d{2}-\d{2}$/.test(req.query.date||'')?req.query.date:new Date().toISOString().slice(0,10);const r=await pool.query(`SELECT s.id,v.plate,v.model,v.driver_name,s.started_at,s.finished_at,s.duration_seconds,s.amount,s.cash_amount,s.terminal_amount,s.payment_method,ds.name school_name,g.name group_name,st.full_name student_name FROM sessions s JOIN vehicles v ON v.id=s.vehicle_id LEFT JOIN driving_schools ds ON ds.id=s.school_id LEFT JOIN school_groups g ON g.id=s.group_id LEFT JOIN students st ON st.id=s.student_id WHERE s.user_id=$1 AND s.status='completed' AND s.started_at::date=$2 ORDER BY s.started_at DESC`,[uid(req),date]);const summary=r.rows.reduce((a,x)=>{a.count++;a.seconds+=Number(x.duration_seconds||0);a.amount+=Number(x.amount||0);a.cash+=Number(x.cash_amount||0);a.terminal+=Number(x.terminal_amount||0);return a},{count:0,seconds:0,amount:0,cash:0,terminal:0});res.json({date,summary,rows:r.rows})}catch{res.status(500).json({error:'Hisobotni olishda xatolik'})}});
app.get('/api/history',auth,async(req,res)=>{const plate=String(req.query.plate||'').trim().toUpperCase();if(!plate)return res.status(400).json({error:'Avtomobil raqami kerak'});const r=await pool.query(`SELECT s.id,v.plate,v.model,v.driver_name,s.started_at,s.finished_at,s.duration_seconds,s.amount,s.cash_amount,s.terminal_amount,s.payment_method,ds.name school_name,g.name group_name,st.full_name student_name FROM sessions s JOIN vehicles v ON v.id=s.vehicle_id LEFT JOIN driving_schools ds ON ds.id=s.school_id LEFT JOIN school_groups g ON g.id=s.group_id LEFT JOIN students st ON st.id=s.student_id WHERE s.user_id=$1 AND v.plate ILIKE $2 AND s.status='completed' ORDER BY s.started_at DESC`,[uid(req),plate]);res.json({plate,rows:r.rows})});
app.get('/api/dashboard',auth,async(req,res)=>{const r=await pool.query(`SELECT COUNT(*) FILTER(WHERE status='active')::int active,COUNT(*) FILTER(WHERE status='completed' AND started_at::date=CURRENT_DATE)::int today_count,COALESCE(SUM(duration_seconds) FILTER(WHERE status='completed' AND started_at::date=CURRENT_DATE),0)::bigint today_seconds,COALESCE(SUM(amount) FILTER(WHERE status='completed' AND started_at::date=CURRENT_DATE),0)::numeric today_amount,COALESCE(SUM(cash_amount) FILTER(WHERE status='completed' AND started_at::date=CURRENT_DATE),0)::numeric today_cash,COALESCE(SUM(terminal_amount) FILTER(WHERE status='completed' AND started_at::date=CURRENT_DATE),0)::numeric today_terminal FROM sessions WHERE user_id=$1`,[uid(req)]);const x=r.rows[0];res.json({active:Number(x.active),todayCount:Number(x.today_count),todaySeconds:Number(x.today_seconds),todayAmount:Number(x.today_amount),todayCash:Number(x.today_cash),todayTerminal:Number(x.today_terminal)})});

app.use(express.static(frontendPath));
app.use((req,res,next)=>{if(req.path.startsWith('/api/'))return next();res.sendFile(path.join(frontendPath,'index.html'))});
ensureFeatureSchema().catch(e=>console.error('FEATURE INIT',e));
export default app;
if(process.env.VERCEL!=='1')app.listen(PORT,'0.0.0.0',()=>console.log(`AVTODROM running on :${PORT}`));
