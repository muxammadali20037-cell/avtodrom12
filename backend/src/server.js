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

/* ==========================================================================
   YANGI: async route'lardagi xatolar Express'ga yetib borishi uchun wrapper.
   Busiz async handler ichidagi xato "Internal Server Error" HTML sahifasi
   sifatida qaytardi va frontend uni o'qiy olmasdi.
   ========================================================================== */
['get', 'post', 'put', 'delete'].forEach(method => {
  const original = app[method].bind(app);
  app[method] = (routePath, ...handlers) => original(
    routePath,
    ...handlers.map(fn => (typeof fn === 'function' && fn.length < 4)
      ? (req, res, next) => { try { return Promise.resolve(fn(req, res, next)).catch(next); } catch (e) { return next(e); } }
      : fn)
  );
});

/* ==========================================================================
   YANGI: jadval o'zgarishlari tugamaguncha API so'rovlarini kutdirish.
   Vercel'da server "sovuq" ishga tushganda birinchi so'rovlar migratsiyadan
   oldin kelib, "column does not exist" -> 500 xatosini berardi.
   ========================================================================== */
let schemaPromise = null;
function schemaReady() {
  if (!schemaPromise) {
    schemaPromise = ensureFeatureSchema()
      .then(ensureAdminUser)
      .catch(e => { console.error('SCHEMA INIT:', e.message); });
  }
  return schemaPromise;
}
app.use(async (req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  try { await schemaReady(); } catch (e) { console.error('SCHEMA WAIT:', e.message); }
  next();
});

const REGIONS = ['01','10','20','25','30','40','50','60','70','75','80','85','90','95'];
const uid = req => String(req.user.sub);
const num = v => Number.isFinite(Number(v)) ? Number(v) : 0;

/* ==========================================================================
   YANGI: yagona ish maydoni (workspace)
   Barcha avtoshkola/guruh/o'quvchi/instruktor yozuvlari owner_key bo'yicha
   ajratilgan. Admin operator bilan BIR XIL ma'lumotni ko'rishi uchun
   owner_key tokendagi "owner" da keladi. WORKSPACE_OWNER_ID env o'rnatilsa,
   hamma (operator ham, admin ham) o'sha yagona maydonda ishlaydi.
   ========================================================================== */
const WORKSPACE_OWNER_ID = String(process.env.WORKSPACE_OWNER_ID || '').trim();
const ownerKey = req => String(req.user.owner || req.user.sub);
const LESSON_SECONDS = 3600;

function tokenFor(user, extra = {}) {
  return jwt.sign(
    { sub: user.id, role: user.role, username: user.username, owner: WORKSPACE_OWNER_ID || user.id, ...extra },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}
function auth(req, res, next) { try { const h=req.headers.authorization||''; if(!h.startsWith('Bearer ')) return res.status(401).json({error:'Kirish talab qilinadi'}); req.user=jwt.verify(h.slice(7),JWT_SECRET); next(); } catch { return res.status(401).json({error:'Sessiya yaroqsiz yoki tugagan'}); } }

/* YANGI: admin middleware */
function adminAuth(req, res, next) {
  auth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin huquqi talab qilinadi' });
    next();
  });
}

/* ==========================================================================
   O'ZGARTIRILDI: plateData — ikkala O'zbekiston formatini qo'llab-quvvatlaydi
   1) A555AA  -> "01 A 555 AA"   (eski format, saqlanadi)
   2) 111QQQ  -> "01 111 QQQ"    (yangi format, avval rad etilardi)
   ========================================================================== */
function plateData(body) {
  const region = String(body.regionCode || '');
  if (!REGIONS.includes(region)) throw new Error('Viloyat kodi noto‘g‘ri');

  const raw = String(body.plateBody || body.plate || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  if (/^[A-Z]\d{3}[A-Z]{2}$/.test(raw)) {
    const firstLetter = raw[0], number = raw.slice(1, 4), lastLetters = raw.slice(4, 6);
    return { region, firstLetter, number, lastLetters, plate: `${region} ${firstLetter} ${number} ${lastLetters}` };
  }
  if (/^\d{3}[A-Z]{3}$/.test(raw)) {
    const number = raw.slice(0, 3), lastLetters = raw.slice(3, 6);
    return { region, firstLetter: null, number, lastLetters, plate: `${region} ${number} ${lastLetters}` };
  }

  /* Eski mijozlar alohida maydon yuborsa ham ishlasin */
  const firstLetter = String(body.firstLetter || '').toUpperCase();
  const number = String(body.number || '');
  const lastLetters = String(body.lastLetters || '').toUpperCase();
  if (/^[A-Z]$/.test(firstLetter) && /^\d{3}$/.test(number) && /^[A-Z]{2,3}$/.test(lastLetters)) {
    return { region, firstLetter, number, lastLetters, plate: `${region} ${firstLetter} ${number} ${lastLetters}` };
  }
  throw new Error('Avtomobil raqami noto‘g‘ri. Masalan: A555AA yoki 111QQQ');
}

async function ensureAccountData(userId){ await pool.query(`INSERT INTO user_settings(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING`,[userId]); }

async function ensureFeatureSchema(){
  const q = async sql => { try { await pool.query(sql) } catch(e) { console.error('FEATURE SCHEMA:', e.message) } };

  await q(`CREATE TABLE IF NOT EXISTS driving_schools(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),owner_key TEXT NOT NULL,name VARCHAR(160) NOT NULL,phone VARCHAR(50),notes TEXT,active BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await q(`CREATE TABLE IF NOT EXISTS school_groups(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),owner_key TEXT NOT NULL,school_id UUID NOT NULL REFERENCES driving_schools(id) ON DELETE CASCADE,name VARCHAR(120) NOT NULL,notes TEXT,active BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await q(`CREATE TABLE IF NOT EXISTS students(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),owner_key TEXT NOT NULL,school_id UUID NOT NULL REFERENCES driving_schools(id) ON DELETE CASCADE,group_id UUID REFERENCES school_groups(id) ON DELETE SET NULL,full_name VARCHAR(160) NOT NULL,phone VARCHAR(50),plate VARCHAR(20),notes TEXT,active BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);

  /* ==========================================================================
     INSTRUKTORLAR
     Bazada allaqachon boshqa ko'rinishdagi "instructors" jadvali bo'lishi
     mumkin (masalan full_name o'rniga name, id esa TEXT). Shuning uchun
     jadvalni qayta yaratmaymiz — yetishmayotgan ustunlarni qo'shib,
     mavjud ma'lumotni saqlagan holda moslashtiramiz.
     ========================================================================== */
  await q(`CREATE TABLE IF NOT EXISTS instructors(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);

  await q(`ALTER TABLE instructors ADD COLUMN IF NOT EXISTS owner_key TEXT`);
  await q(`ALTER TABLE instructors ADD COLUMN IF NOT EXISTS school_id TEXT`);
  await q(`ALTER TABLE instructors ADD COLUMN IF NOT EXISTS full_name VARCHAR(160)`);
  await q(`ALTER TABLE instructors ADD COLUMN IF NOT EXISTS phone VARCHAR(50)`);
  await q(`ALTER TABLE instructors ADD COLUMN IF NOT EXISTS plate VARCHAR(30)`);
  await q(`ALTER TABLE instructors ADD COLUMN IF NOT EXISTS model VARCHAR(120)`);
  await q(`ALTER TABLE instructors ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active'`);
  await q(`ALTER TABLE instructors ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT TRUE`);
  await q(`ALTER TABLE instructors ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`);

  /* Eski jadvalda ism boshqa ustunda bo'lsa — ko'chiramiz */
  await q(`DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='instructors' AND column_name='name') THEN
        EXECUTE 'UPDATE instructors SET full_name = name WHERE full_name IS NULL AND name IS NOT NULL';
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='instructors' AND column_name='fio') THEN
        EXECUTE 'UPDATE instructors SET full_name = fio WHERE full_name IS NULL AND fio IS NOT NULL';
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='instructors' AND column_name='vehicle_plate') THEN
        EXECUTE 'UPDATE instructors SET plate = vehicle_plate WHERE plate IS NULL AND vehicle_plate IS NOT NULL';
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='instructors' AND column_name='vehicle_model') THEN
        EXECUTE 'UPDATE instructors SET model = vehicle_model WHERE model IS NULL AND vehicle_model IS NOT NULL';
      END IF;
    END $$;`);

  /* Eski jadvaldagi majburiy (NOT NULL) ustunlar yangi INSERT'ni bloklamasin */
  await q(`DO $$
    DECLARE c RECORD;
    BEGIN
      FOR c IN
        SELECT column_name FROM information_schema.columns
         WHERE table_name='instructors' AND is_nullable='NO' AND column_default IS NULL
           AND column_name NOT IN ('id','full_name')
      LOOP
        EXECUTE format('ALTER TABLE instructors ALTER COLUMN %I DROP NOT NULL', c.column_name);
      END LOOP;
    END $$;`);

  /* id ustuni turiga qarab avtomatik qiymat berilishini ta'minlaymiz */
  await q(`DO $$
    DECLARE id_type TEXT;
    BEGIN
      SELECT data_type INTO id_type FROM information_schema.columns
        WHERE table_name='instructors' AND column_name='id';
      IF id_type IN ('text','character varying') THEN
        EXECUTE 'ALTER TABLE instructors ALTER COLUMN id SET DEFAULT gen_random_uuid()::text';
      ELSIF id_type = 'uuid' THEN
        EXECUTE 'ALTER TABLE instructors ALTER COLUMN id SET DEFAULT gen_random_uuid()';
      END IF;
    END $$;`);

  await q(`UPDATE instructors SET active = TRUE WHERE active IS NULL`);
  await q(`UPDATE instructors SET status = 'active' WHERE status IS NULL`);
  await q(`CREATE INDEX IF NOT EXISTS idx_instructors_owner ON instructors(owner_key)`);
  /* Egasi ko'rsatilmagan eski yozuvlarni yagona ish maydoniga bog'laymiz */
  if (WORKSPACE_OWNER_ID) {
    try { await pool.query(`UPDATE instructors SET owner_key=$1 WHERE owner_key IS NULL`, [WORKSPACE_OWNER_ID]); }
    catch (e) { console.error('FEATURE SCHEMA (instructors owner):', e.message); }
  }

  /* YANGI: o'quvchi qo'shimcha maydonlari */
  await q(`ALTER TABLE students ADD COLUMN IF NOT EXISTS birth_date DATE`);
  await q(`ALTER TABLE students ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active'`);

  /* Mavjud sessiya maydonlari (o'zgarmagan) */
  await q(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20) NOT NULL DEFAULT 'cash'`);
  await q(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS cash_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await q(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS terminal_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await q(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS school_id UUID`);
  await q(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS group_id UUID`);
  await q(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS student_id UUID`);
  await q(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS manual_price BOOLEAN NOT NULL DEFAULT TRUE`);

  /* YANGI: rejadagi vaqt, dars hisobi, muzlatish, instruktor */
  await q(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS target_duration INTEGER`);
  await q(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS lessons_counted INTEGER NOT NULL DEFAULT 0`);
  await q(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS frozen_at TIMESTAMPTZ`);
  await q(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS resumed_at TIMESTAMPTZ`);
  await q(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS instructor_id UUID`);
  /* Haydovchi ismi endi SESSIYAGA yoziladi. Avval faqat vehicles jadvalida
     saqlanardi va shu raqam bilan ochilgan har bir yangi sessiyada eski ism
     avtomatik chiqib qolardi. */
  await q(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS driver_name VARCHAR(160)`);
  /* instructors.id bazada TEXT bo'lishi mumkin — instructor_id ni ham TEXT ga
     keltiramiz, shunda "operator does not exist: text = uuid" xatosi chiqmaydi */
  await q(`ALTER TABLE sessions ALTER COLUMN instructor_id TYPE TEXT USING instructor_id::text`);
  await q(`ALTER TABLE sessions ALTER COLUMN duration_seconds SET DEFAULT 0`);

  /* YANGI: 111QQQ formati uchun raqam ustunlarini moslashtirish */
  await q(`ALTER TABLE vehicles ALTER COLUMN first_letter DROP NOT NULL`);
  await q(`ALTER TABLE vehicles ALTER COLUMN last_letters TYPE VARCHAR(3)`);

  await q(`UPDATE sessions SET cash_amount=COALESCE(amount,0),payment_method='cash' WHERE status='completed' AND COALESCE(amount,0)>0 AND COALESCE(cash_amount,0)=0 AND COALESCE(terminal_amount,0)=0`);
  /* Eski yakunlangan sessiyalar: 1 tashrif = kamida 1 dars */
  await q(`UPDATE sessions SET lessons_counted=GREATEST(1,ROUND(COALESCE(duration_seconds,0)/3600.0)::int) WHERE status='completed' AND student_id IS NOT NULL AND lessons_counted=0`);

  await q(`CREATE INDEX IF NOT EXISTS idx_sessions_plate_time ON sessions(vehicle_id,started_at DESC)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_sessions_payment ON sessions(payment_method)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_sessions_user_status_time ON sessions(user_id,status,started_at DESC)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_sessions_user_started ON sessions(user_id,started_at DESC)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_sessions_student ON sessions(student_id,status)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_students_owner ON students(owner_key)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_students_school_group ON students(school_id,group_id,active)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_school_groups_owner_school ON school_groups(owner_key,school_id,active)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_schools_owner_active ON driving_schools(owner_key,active)`);
}

/* YANGI: birinchi admin hisobini .env dan yaratish (ADMIN_USERNAME + ADMIN_PASSWORD) */
/* Ilova QAYSI bazaga ulanganini ko'rsatadi. Parol hech qachon qaytarilmaydi -
   faqat server manzili va baza nomi. */
function dbInfo() {
  const raw = process.env.DATABASE_URL || process.env.POSTGRES_URL
    || process.env.POSTGRES_PRISMA_URL || process.env.SUPABASE_DB_URL || '';
  if (!raw) return { configured: false };
  try {
    const u = new URL(raw);
    return {
      configured: true,
      host: u.hostname,
      port: u.port || '5432',
      database: (u.pathname || '').replace(/^\//, ''),
      user: u.username || null,
      provider: /supabase/i.test(u.hostname) ? 'supabase'
        : /railway|rlwy/i.test(u.hostname) ? 'railway'
        : /neon/i.test(u.hostname) ? 'neon' : 'boshqa'
    };
  } catch (e) {
    return { configured: true, parse_error: true };
  }
}

export const adminStatus = { envSet: false, created: false, error: null, username: null };
async function ensureAdminUser() {
  const username = String(process.env.ADMIN_USERNAME || '').trim();
  const password = String(process.env.ADMIN_PASSWORD || '');
  adminStatus.envSet = !!(username && password);
  adminStatus.username = username || null;
  if (!username || !password) {
    console.warn('ADMIN: ADMIN_USERNAME / ADMIN_PASSWORD env o‘zgaruvchilari o‘rnatilmagan — admin hisobi yaratilmadi');
    return;
  }
  try {
    const hash = await bcrypt.hash(password, 12);
    const existing = await pool.query(`SELECT id FROM users WHERE username=$1`, [username]);
    if (existing.rows[0]) {
      await pool.query(`UPDATE users SET password_hash=$1, role='admin' WHERE username=$2`, [hash, username]);
      adminStatus.created = true;
      console.log('ADMIN: mavjud hisob yangilandi ->', username);
    } else {
      await pool.query(
        `INSERT INTO users(full_name,username,password_hash,role) VALUES($1,$2,$3,'admin')`,
        ['Administrator', username, hash]
      );
      adminStatus.created = true;
      console.log('ADMIN: yangi hisob yaratildi ->', username);
    }
  } catch (e) {
    adminStatus.error = e.message;
    console.error('ADMIN INIT:', e.message);
  }
}

/* Sessiyaning haqiqiy o'tgan vaqti — server soati bo'yicha */
function elapsedSeconds(s) {
  const base = num(s.duration_seconds);
  if (s.status === 'frozen') return base;
  if (s.resumed_at) return base + Math.max(0, Math.floor((Date.now() - new Date(s.resumed_at).getTime()) / 1000));
  return Math.max(0, Math.floor((Date.now() - new Date(s.started_at).getTime()) / 1000));
}

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    const cols = await pool.query(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema='public' AND (
         (table_name='sessions' AND column_name IN ('target_duration','lessons_counted','frozen_at','resumed_at','instructor_id'))
         OR (table_name='students' AND column_name IN ('birth_date','status'))
         OR (table_name='instructors' AND column_name IN ('id','owner_key','full_name','plate','model','status','active')))`
    );
    const types = await pool.query(
      `SELECT table_name, column_name, data_type FROM information_schema.columns
       WHERE table_schema='public' AND (
         table_name = 'instructors'
         OR (table_name IN ('sessions','students')
             AND column_name IN ('id','instructor_id','student_id','school_id','owner_key')))
       ORDER BY table_name, column_name`
    );
    const adminAccounts = await pool.query(`SELECT username FROM users WHERE role='admin' ORDER BY username`).catch(() => ({ rows: [] }));
    const counts = await pool.query(
      `SELECT (SELECT COUNT(*) FROM students)::int students,
              (SELECT COUNT(*) FROM driving_schools)::int schools,
              (SELECT COUNT(*) FROM sessions)::int sessions,
              (SELECT COUNT(*) FROM users)::int users`
    ).catch(() => ({ rows: [{}] }));
    const have = cols.rows.map(r => r.table_name + '.' + r.column_name);
    const need = ['sessions.target_duration','sessions.lessons_counted','sessions.frozen_at','sessions.resumed_at','sessions.instructor_id','students.birth_date','students.status','instructors.id','instructors.owner_key','instructors.full_name','instructors.plate','instructors.model','instructors.status','instructors.active'];
    res.json({
      ok: true, database: true,
      schema_ok: need.every(n => have.includes(n)),
      missing: need.filter(n => !have.includes(n)),
      types: types.rows.map(r => r.table_name + '.' + r.column_name + ' = ' + r.data_type),
      db: dbInfo(),
      counts: counts.rows[0],
      admin: {
        env_set: adminStatus.envSet,
        env_username: adminStatus.username,
        bootstrap_ok: adminStatus.created,
        bootstrap_error: adminStatus.error,
        accounts: adminAccounts.rows.map(r => r.username)
      }
    });
  } catch (e) {
    res.status(503).json({ ok: false, database: false, error: e.message });
  }
});
app.post('/api/auth/register',async(req,res)=>{const{fullName,username,password}=req.body;if(!fullName||!username||!password)return res.status(400).json({error:'Ism, login va parol kerak'});if(String(password).length<6)return res.status(400).json({error:'Parol kamida 6 belgidan iborat bo‘lishi kerak'});const c=await pool.connect();try{await c.query('BEGIN');const hash=await bcrypt.hash(password,12);const r=await c.query(`INSERT INTO users(full_name,username,password_hash) VALUES($1,$2,$3) RETURNING id,full_name,username,role`,[String(fullName).trim(),String(username).trim(),hash]);const user=r.rows[0];await c.query(`INSERT INTO user_settings(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING`,[user.id]);await c.query('COMMIT');res.status(201).json({user,token:tokenFor(user)})}catch(e){await c.query('ROLLBACK');res.status(e.code==='23505'?409:500).json({error:e.code==='23505'?'Bu login mavjud':'Ro‘yxatdan o‘tishda server xatosi'})}finally{c.release()}});
app.post('/api/auth/login',async(req,res)=>{try{const username=String(req.body.username||'').trim(),password=String(req.body.password||'');const r=await pool.query(`SELECT * FROM users WHERE username=$1 LIMIT 1`,[username]);if(!r.rows[0]||!(await bcrypt.compare(password,r.rows[0].password_hash)))return res.status(401).json({error:'Login yoki parol noto‘g‘ri'});const u=r.rows[0],user={id:u.id,full_name:u.full_name,username:u.username,role:u.role};await ensureAccountData(user.id);res.json({user,token:tokenFor(user)})}catch{res.status(500).json({error:'Kirishda server xatosi'})}});

/* ==========================================================================
   YANGI: ADMIN LOGIN — avval bu endpoint umuman yo'q edi (404 qaytardi)
   ========================================================================== */
app.post('/api/admin/login', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    if (!username || !password) return res.status(400).json({ error: 'Login va parol kerak' });

    const anyAdmin = await pool.query(`SELECT COUNT(*)::int n FROM users WHERE role='admin'`);
    if (!anyAdmin.rows[0].n) {
      console.warn('ADMIN LOGIN: bazada admin hisobi yo‘q');
      return res.status(503).json({
        error: 'Admin hisobi hali yaratilmagan. ADMIN_USERNAME va ADMIN_PASSWORD o‘zgaruvchilarini qo‘shib, qaytadan deploy qiling.'
      });
    }
    const r = await pool.query(`SELECT * FROM users WHERE username=$1 LIMIT 1`, [username]);
    const u = r.rows[0];
    if (!u) return res.status(401).json({ error: 'Bunday login topilmadi' });
    if (!u.password_hash || !(await bcrypt.compare(password, u.password_hash))) {
      return res.status(401).json({ error: 'Parol noto‘g‘ri' });
    }
    if (u.role !== 'admin') return res.status(403).json({ error: 'Bu hisobda admin huquqi yo‘q (roli: ' + (u.role || 'yo‘q') + ')' });

    const admin = { id: u.id, full_name: u.full_name, username: u.username, role: 'admin' };
    res.json({ admin, user: admin, token: tokenFor(admin) });
  } catch (e) {
    console.error('ADMIN LOGIN:', e.message);
    res.status(500).json({ error: 'Kirishda server xatosi' });
  }
});

app.get('/api/settings',auth,async(req,res)=>{try{await ensureAccountData(uid(req));const r=await pool.query(`SELECT hourly_rate,minimum_payment,calculation_mode FROM user_settings WHERE user_id=$1`,[uid(req)]);const x=r.rows[0];res.json({hourlyRate:Number(x?.hourly_rate||30000),minimumPayment:Number(x?.minimum_payment||0),calculationMode:x?.calculation_mode||'hour'})}catch{res.status(500).json({error:'Sozlamalarni olishda xatolik'})}});
app.put('/api/settings',auth,async(req,res)=>{try{await ensureAccountData(uid(req));const hourlyRate=num(req.body.hourlyRate),minimumPayment=num(req.body.minimumPayment);const mode=req.body.calculationMode==='minute'?'minute':'hour';if(hourlyRate<=0||minimumPayment<0)return res.status(400).json({error:'Narx noto‘g‘ri'});const r=await pool.query(`UPDATE user_settings SET hourly_rate=$1,minimum_payment=$2,calculation_mode=$3,updated_at=NOW() WHERE user_id=$4 RETURNING hourly_rate,minimum_payment,calculation_mode`,[hourlyRate,minimumPayment,mode,uid(req)]);res.json({hourlyRate:Number(r.rows[0].hourly_rate),minimumPayment:Number(r.rows[0].minimum_payment),calculationMode:r.rows[0].calculation_mode})}catch{res.status(500).json({error:'Sozlamalarni saqlashda xatolik'})}});

/* ---------------------- AVTOSHKOLA / GURUH / O'QUVCHI ---------------------- */
app.get('/api/schools',auth,async(req,res)=>{const r=await pool.query(`SELECT s.*,COUNT(DISTINCT g.id)::int group_count,COUNT(DISTINCT st.id)::int student_count FROM driving_schools s LEFT JOIN school_groups g ON g.school_id=s.id AND g.active=true LEFT JOIN students st ON st.school_id=s.id AND st.active=true WHERE s.owner_key=$1 AND s.active IS NOT FALSE GROUP BY s.id ORDER BY s.name`,[ownerKey(req)]);res.json(r.rows)});
app.post('/api/schools',auth,async(req,res)=>{const name=String(req.body.name||'').trim();if(!name)return res.status(400).json({error:'Avtoshkola nomi kerak'});const r=await pool.query(`INSERT INTO driving_schools(owner_key,name,phone,notes) VALUES($1,$2,$3,$4) RETURNING *`,[ownerKey(req),name,req.body.phone||null,req.body.notes||null]);res.status(201).json(r.rows[0])});
app.get('/api/groups',auth,async(req,res)=>{const p=[ownerKey(req)];let w='g.owner_key=$1 AND g.active IS NOT FALSE';if(req.query.schoolId){p.push(req.query.schoolId);w+=' AND g.school_id=$2'}const r=await pool.query(`SELECT g.*,s.name school_name,COUNT(st.id)::int student_count FROM school_groups g JOIN driving_schools s ON s.id=g.school_id LEFT JOIN students st ON st.group_id=g.id AND st.active=true WHERE ${w} GROUP BY g.id,s.name ORDER BY s.name,g.name`,p);res.json(r.rows)});
app.post('/api/groups',auth,async(req,res)=>{const schoolId=String(req.body.schoolId||req.body.school_id||'');const name=String(req.body.name||'').trim();if(!schoolId||!name)return res.status(400).json({error:'Avtoshkola va guruh kerak'});const own=await pool.query(`SELECT id FROM driving_schools WHERE id=$1 AND owner_key=$2`,[schoolId,ownerKey(req)]);if(!own.rows[0])return res.status(404).json({error:'Avtoshkola topilmadi'});const r=await pool.query(`INSERT INTO school_groups(owner_key,school_id,name,notes) VALUES($1,$2,$3,$4) RETURNING *`,[ownerKey(req),schoolId,name,req.body.notes||null]);res.status(201).json(r.rows[0])});

/* O'ZGARTIRILDI: attendance_count endi DARSLAR yig'indisi (1 soat = 1 dars),
   avval oddiy tashriflar SONI edi — shuning uchun 2 soat 1 ko'rinardi. */
const STUDENT_ATTENDANCE_SQL = `(SELECT COALESCE(SUM(CASE WHEN se.lessons_counted > 0 THEN se.lessons_counted ELSE 1 END),0)::int
   FROM sessions se WHERE se.student_id::text = st.id::text AND se.status = 'completed')`;

app.get('/api/students',auth,async(req,res)=>{
  const p=[ownerKey(req)];let w='st.owner_key=$1 AND st.active IS NOT FALSE';
  if(req.query.schoolId){p.push(req.query.schoolId);w+=` AND st.school_id=$${p.length}`}
  if(req.query.groupId){p.push(req.query.groupId);w+=` AND st.group_id=$${p.length}`}
  const r=await pool.query(`SELECT st.*,s.name school_name,g.name group_name,${STUDENT_ATTENDANCE_SQL} attendance_count
    FROM students st JOIN driving_schools s ON s.id=st.school_id LEFT JOIN school_groups g ON g.id=st.group_id
    WHERE ${w} ORDER BY st.full_name`,p);
  res.json(r.rows);
});

/* O'ZGARTIRILDI: camelCase ham, snake_case ham qabul qilinadi */
app.post('/api/students',auth,async(req,res)=>{
  const schoolId=String(req.body.schoolId||req.body.school_id||'');
  const groupId=(req.body.groupId||req.body.group_id)?String(req.body.groupId||req.body.group_id):null;
  const name=String(req.body.fullName||req.body.full_name||'').trim();
  if(!schoolId||!name)return res.status(400).json({error:'Avtoshkola va o‘quvchi ismi kerak'});
  const s=await pool.query(`SELECT id FROM driving_schools WHERE id=$1 AND owner_key=$2`,[schoolId,ownerKey(req)]);
  if(!s.rows[0])return res.status(404).json({error:'Avtoshkola topilmadi'});
  if(groupId){const g=await pool.query(`SELECT id FROM school_groups WHERE id=$1 AND school_id=$2 AND owner_key=$3`,[groupId,schoolId,ownerKey(req)]);if(!g.rows[0])return res.status(400).json({error:'Guruh noto‘g‘ri'})}
  const r=await pool.query(`INSERT INTO students(owner_key,school_id,group_id,full_name,phone,plate,notes,birth_date)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [ownerKey(req),schoolId,groupId,name,req.body.phone||null,req.body.plate||null,req.body.notes||null,req.body.birth_date||req.body.birthDate||null]);
  res.status(201).json(r.rows[0]);
});

/* ---------------------- YANGI: INSTRUKTORLAR ---------------------- */
app.get('/api/instructors', auth, async (req, res) => {
  const r = await pool.query(
    `SELECT i.*, s.name school_name FROM instructors i
     LEFT JOIN driving_schools s ON s.id::text = i.school_id::text
     WHERE i.owner_key = $1 AND COALESCE(i.active, TRUE) = TRUE
     ORDER BY i.full_name NULLS LAST`,
    [ownerKey(req)]
  );
  res.json(r.rows);
});
app.post('/api/instructors', auth, async (req, res) => {
  const name = String(req.body.full_name || req.body.fullName || '').trim();
  if (!name) return res.status(400).json({ error: 'Instruktor ismi kerak' });
  const r = await pool.query(
    `INSERT INTO instructors(owner_key,school_id,full_name,phone,plate,model,status)
     VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [ownerKey(req), req.body.school_id || req.body.schoolId || null, name,
     req.body.phone || null, req.body.plate || null, req.body.model || null, req.body.status || 'active']
  );
  res.status(201).json(r.rows[0]);
});
app.put('/api/instructors/:id', auth, async (req, res) => {
  const name = String(req.body.full_name || req.body.fullName || '').trim();
  if (!name) return res.status(400).json({ error: 'Instruktor ismi kerak' });
  const r = await pool.query(
    `UPDATE instructors SET school_id=$1, full_name=$2, phone=$3, plate=$4, model=$5, status=$6
     WHERE id::text=$7 AND owner_key=$8 RETURNING *`,
    [req.body.school_id || req.body.schoolId || null, name, req.body.phone || null,
     req.body.plate || null, req.body.model || null, req.body.status || 'active', req.params.id, ownerKey(req)]
  );
  if (!r.rows[0]) return res.status(404).json({ error: 'Instruktor topilmadi' });
  res.json(r.rows[0]);
});
app.delete('/api/instructors/:id', auth, async (req, res) => {
  const r = await pool.query(`UPDATE instructors SET active=false WHERE id::text=$1 AND owner_key=$2 RETURNING id`, [req.params.id, ownerKey(req)]);
  if (!r.rows[0]) return res.status(404).json({ error: 'Instruktor topilmadi' });
  res.json({ ok: true });
});
app.post('/api/instructors/bulk', auth, async (req, res) => {
  const items = Array.isArray(req.body.instructors) ? req.body.instructors : [];
  if (!items.length) return res.status(400).json({ error: 'Ro‘yxat bo‘sh' });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    let added = 0;
    for (const it of items) {
      const name = String(it.full_name || it.fullName || '').trim();
      if (!name) continue;
      await c.query(
        `INSERT INTO instructors(owner_key,school_id,full_name,phone,plate,model) VALUES($1,$2,$3,$4,$5,$6)`,
        [ownerKey(req), it.school_id || null, name, it.phone || null, it.plate || null, it.model || null]
      );
      added++;
    }
    await c.query('COMMIT');
    res.status(201).json({ added });
  } catch (e) {
    await c.query('ROLLBACK');
    res.status(400).json({ error: e.message || 'Qo‘shishda xatolik' });
  } finally { c.release(); }
});

/* ---------------------- SESSIYALAR ---------------------- */
const SESSION_SELECT = `SELECT s.id, v.plate, v.model, COALESCE(s.driver_name, v.driver_name) driver_name, s.started_at, s.status,
    COALESCE(s.duration_seconds,0) duration_seconds, s.resumed_at, s.frozen_at, s.target_duration,
    s.hourly_rate, s.minimum_payment, s.calculation_mode,
    s.school_id, s.group_id, s.student_id, s.instructor_id,
    ds.name school_name, g.name group_name, st.full_name student_name,
    i.full_name instructor_name
  FROM sessions s
  JOIN vehicles v ON v.id = s.vehicle_id
  LEFT JOIN driving_schools ds ON ds.id::text = s.school_id::text
  LEFT JOIN school_groups g ON g.id::text = s.group_id::text
  LEFT JOIN students st ON st.id::text = s.student_id::text
  LEFT JOIN instructors i ON i.id::text = s.instructor_id::text`;

app.get('/api/sessions/active', auth, async (req, res) => {
  const r = await pool.query(`${SESSION_SELECT} WHERE s.user_id=$1 AND s.status='active' ORDER BY s.started_at`, [uid(req)]);
  res.json(r.rows);
});
/* YANGI: muzlatilgan sessiyalar */
app.get('/api/sessions/frozen', auth, async (req, res) => {
  const r = await pool.query(`${SESSION_SELECT} WHERE s.user_id=$1 AND s.status='frozen' ORDER BY s.frozen_at DESC`, [uid(req)]);
  res.json(r.rows);
});

app.post('/api/sessions/start', auth, async (req, res) => {
  let p;
  try { p = plateData(req.body) } catch (e) { return res.status(400).json({ error: e.message }) }
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    let vr = await c.query(`SELECT * FROM vehicles WHERE plate=$1 AND user_id=$2`, [p.plate, uid(req)]);
    let v = vr.rows[0];
    const modelIn = String(req.body.model || '').trim();
    const driverIn = String(req.body.driverName || '').trim();
    if (!v) {
      vr = await c.query(
        `INSERT INTO vehicles(user_id,region_code,first_letter,number,last_letters,plate,model,driver_name)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [uid(req), p.region, p.firstLetter, p.number, p.lastLetters, p.plate, modelIn || null, driverIn || null]
      );
      v = vr.rows[0];
    } else if (modelIn || driverIn) {
      /* Operator yangi qiymat kiritgan bo'lsa avtomobil kartochkasi yangilanadi */
      vr = await c.query(
        `UPDATE vehicles SET model = COALESCE(NULLIF($2,''), model), driver_name = COALESCE(NULLIF($3,''), driver_name)
         WHERE id=$1 RETURNING *`,
        [v.id, modelIn, driverIn]
      );
      v = vr.rows[0];
    }
    let schoolId = req.body.schoolId ? String(req.body.schoolId) : null;
    let groupId = req.body.groupId ? String(req.body.groupId) : null;
    const studentId = req.body.studentId ? String(req.body.studentId) : null;
    const instructorId = (req.body.instructorId || req.body.instructor_id) ? String(req.body.instructorId || req.body.instructor_id) : null;

    /* Yozuv mavjudligini tekshiramiz. owner_key bo'yicha qat'iy solishtirmaymiz:
       ma'lumot turli yo'llar bilan kiritilgani uchun (admin paneli, import,
       eski versiyalar) egasi har xil yozilgan bo'lishi mumkin edi va bu
       "O'quvchi topilmadi" xatosini berardi. Sessiya baribir user_id ga
       bog'lanadi, shuning uchun xavfsizlik buzilmaydi. */
    if (studentId) {
      const sr = await c.query(`SELECT id,school_id,group_id FROM students WHERE id=$1 AND active IS NOT FALSE`, [studentId]);
      if (!sr.rows[0]) throw new Error('O‘quvchi topilmadi');
      schoolId = sr.rows[0].school_id;
      groupId = sr.rows[0].group_id;
    }
    if (schoolId) {
      const sr = await c.query(`SELECT id FROM driving_schools WHERE id=$1 AND active IS NOT FALSE`, [schoolId]);
      if (!sr.rows[0]) throw new Error('Avtoshkola topilmadi');
    }
    if (groupId) {
      const gr = await c.query(`SELECT id FROM school_groups WHERE id=$1 AND active IS NOT FALSE`, [groupId]);
      if (!gr.rows[0]) groupId = null;   /* guruh o'chirilgan bo'lsa - sessiya baribir ochiladi */
    }
    if (instructorId) {
      const ir = await c.query(`SELECT id FROM instructors WHERE id::text=$1 AND active IS NOT FALSE`, [instructorId]);
      if (!ir.rows[0]) throw new Error('Instruktor topilmadi');
    }

    /* YANGI: rejadagi vaqt (foydalanish soati). Standart 1 soat. */
    let target = num(req.body.target_duration || req.body.targetDuration);
    if (!target && num(req.body.target_hours || req.body.targetHours)) target = num(req.body.target_hours || req.body.targetHours) * LESSON_SECONDS;
    if (!target) target = LESSON_SECONDS;
    target = Math.min(12 * LESSON_SECONDS, Math.max(900, target));

    const set = await c.query(`SELECT hourly_rate,minimum_payment,calculation_mode FROM user_settings WHERE user_id=$1`, [uid(req)]);
    const s = set.rows[0] || { hourly_rate: 30000, minimum_payment: 0, calculation_mode: 'hour' };
    const r = await c.query(
      `INSERT INTO sessions(user_id,vehicle_id,hourly_rate,minimum_payment,calculation_mode,school_id,group_id,student_id,instructor_id,target_duration,driver_name,duration_seconds,manual_price)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0,true) RETURNING id,started_at,target_duration`,
      [uid(req), v.id, s.hourly_rate, s.minimum_payment, s.calculation_mode, schoolId, groupId, studentId, instructorId, target, driverIn]
    );
    await c.query('COMMIT');
    res.status(201).json({ id: r.rows[0].id, plate: p.plate, startedAt: r.rows[0].started_at, target_duration: r.rows[0].target_duration, schoolId, groupId, studentId, instructorId });
  } catch (e) {
    await c.query('ROLLBACK');
    res.status(e.code === '23505' ? 409 : 400).json({ error: e.code === '23505' ? 'Bu avtomobil hozir jarayonda' : (e.message || 'START bajarilmadi') });
  } finally { c.release(); }
});

/* YANGI: MUZLATISH */
app.post('/api/sessions/:id/freeze', auth, async (req, res) => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await c.query(`SELECT * FROM sessions WHERE id=$1 AND user_id=$2 AND status='active' FOR UPDATE`, [req.params.id, uid(req)]);
    if (!r.rows[0]) { await c.query('ROLLBACK'); return res.status(404).json({ error: 'Faol sessiya topilmadi' }); }
    const seconds = elapsedSeconds(r.rows[0]);
    const u = await c.query(
      `UPDATE sessions SET status='frozen', duration_seconds=$2, frozen_at=NOW(), resumed_at=NULL WHERE id=$1 RETURNING id,status,duration_seconds,frozen_at`,
      [req.params.id, seconds]
    );
    await c.query('COMMIT');
    res.json(u.rows[0]);
  } catch (e) { await c.query('ROLLBACK'); res.status(400).json({ error: e.message || 'Muzlatishda xatolik' }); }
  finally { c.release(); }
});

/* YANGI: DAVOM ETTIRISH */
app.post('/api/sessions/:id/resume', auth, async (req, res) => {
  const r = await pool.query(
    `UPDATE sessions SET status='active', resumed_at=NOW(), frozen_at=NULL
     WHERE id=$1 AND user_id=$2 AND status='frozen' RETURNING id,status,duration_seconds,resumed_at`,
    [req.params.id, uid(req)]
  );
  if (!r.rows[0]) return res.status(404).json({ error: 'Muzlatilgan sessiya topilmadi' });
  res.json(r.rows[0]);
});

/* O'ZGARTIRILDI: FINISH
   - cash_amount / terminal_amount (yangi frontend) ham, cashAmount / amount (eski) ham qabul qilinadi
   - muzlatilgan sessiyani ham yakunlaydi
   - lessons_counted yoziladi: 1 soat = 1 dars                                */
app.post('/api/sessions/:id/finish', auth, async (req, res) => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await c.query(
      `SELECT s.*, v.plate, ds.name school_name, g.name group_name, st.full_name student_name
       FROM sessions s JOIN vehicles v ON v.id=s.vehicle_id
       LEFT JOIN driving_schools ds ON ds.id=s.school_id
       LEFT JOIN school_groups g ON g.id=s.group_id
       LEFT JOIN students st ON st.id=s.student_id
       WHERE s.id=$1 AND s.user_id=$2 AND s.status IN ('active','frozen') FOR UPDATE OF s`,
      [req.params.id, uid(req)]
    );
    if (!r.rows[0]) { await c.query('ROLLBACK'); return res.status(404).json({ error: 'Faol sessiya topilmadi' }); }

    const s = r.rows[0];
    const end = new Date();
    const seconds = elapsedSeconds(s);

    let cash = num(req.body.cash_amount ?? req.body.cashAmount);
    let terminal = num(req.body.terminal_amount ?? req.body.terminalAmount);
    let amount = req.body.amount === undefined ? cash + terminal : num(req.body.amount);
    if (cash === 0 && terminal === 0 && amount > 0) {
      if (req.body.paymentMethod === 'terminal') terminal = amount; else cash = amount;
    }
    if (cash < 0 || terminal < 0 || amount < 0) { await c.query('ROLLBACK'); return res.status(400).json({ error: 'To‘lov summasi noto‘g‘ri' }); }
    amount = cash + terminal;
    const method = terminal > 0 && cash > 0 ? 'mixed' : terminal > 0 ? 'terminal' : 'cash';

    /* 1 soat = 1 dars. Faqat avtoshkola o'quvchisi uchun hisoblanadi. */
    const lessons = s.student_id ? Math.max(1, Math.round(seconds / LESSON_SECONDS)) : 0;

    const u = await c.query(
      `UPDATE sessions SET finished_at=$1, duration_seconds=$2, amount=$3, cash_amount=$4, terminal_amount=$5,
              payment_method=$6, lessons_counted=$7, status='completed', resumed_at=NULL, frozen_at=NULL
       WHERE id=$8 AND user_id=$9 RETURNING *`,
      [end, seconds, amount, cash, terminal, method, lessons, s.id, uid(req)]
    );
    await c.query('COMMIT');
    res.json({
      ...u.rows[0], plate: s.plate,
      amount: Number(amount), cash_amount: Number(cash), terminal_amount: Number(terminal),
      lessons_counted: lessons,
      school_name: s.school_name, group_name: s.group_name, student_name: s.student_name
    });
  } catch (e) {
    await c.query('ROLLBACK');
    res.status(400).json({ error: e.message || 'FINISH bajarilmadi' });
  } finally { c.release(); }
});

/* ---------------------- HISOBOT / TARIX / DASHBOARD ---------------------- */
const REPORT_SELECT = `SELECT s.id,v.plate,v.model,COALESCE(s.driver_name,v.driver_name) driver_name,s.started_at,s.finished_at,s.duration_seconds,
    s.amount,s.cash_amount,s.terminal_amount,s.payment_method,s.lessons_counted,s.student_id,
    ds.name school_name,g.name group_name,st.full_name student_name,i.full_name instructor_name,
    ${STUDENT_ATTENDANCE_SQL} attendance_count
  FROM sessions s JOIN vehicles v ON v.id=s.vehicle_id
  LEFT JOIN driving_schools ds ON ds.id::text=s.school_id::text
  LEFT JOIN school_groups g ON g.id::text=s.group_id::text
  LEFT JOIN students st ON st.id::text=s.student_id::text
  LEFT JOIN instructors i ON i.id::text=s.instructor_id::text`;

app.get('/api/reports/daily',auth,async(req,res)=>{try{const date=/^\d{4}-\d{2}-\d{2}$/.test(req.query.date||'')?req.query.date:new Date().toISOString().slice(0,10);const r=await pool.query(`${REPORT_SELECT} WHERE s.user_id=$1 AND s.status='completed' AND s.started_at::date=$2 ORDER BY s.started_at DESC`,[uid(req),date]);const summary=r.rows.reduce((a,x)=>{a.count++;a.seconds+=Number(x.duration_seconds||0);a.amount+=Number(x.amount||0);a.cash+=Number(x.cash_amount||0);a.terminal+=Number(x.terminal_amount||0);a.lessons+=Number(x.lessons_counted||0);return a},{count:0,seconds:0,amount:0,cash:0,terminal:0,lessons:0});res.json({date,summary,rows:r.rows})}catch(e){console.error('DAILY:',e.message);res.status(500).json({error:'Hisobotni olishda xatolik'})}});
app.get('/api/history',auth,async(req,res)=>{const plate=String(req.query.plate||'').trim().toUpperCase();if(!plate)return res.status(400).json({error:'Avtomobil raqami kerak'});const like='%'+plate.replace(/\s+/g,'%')+'%';const r=await pool.query(`${REPORT_SELECT} WHERE s.user_id=$1 AND v.plate ILIKE $2 AND s.status='completed' ORDER BY s.started_at DESC`,[uid(req),like]);res.json({plate,rows:r.rows})});
app.get('/api/dashboard',auth,async(req,res)=>{const r=await pool.query(`SELECT COUNT(*) FILTER(WHERE status='active')::int active,COUNT(*) FILTER(WHERE status='frozen')::int frozen,COUNT(*) FILTER(WHERE status='completed' AND started_at::date=CURRENT_DATE)::int today_count,COALESCE(SUM(duration_seconds) FILTER(WHERE status='completed' AND started_at::date=CURRENT_DATE),0)::bigint today_seconds,COALESCE(SUM(amount) FILTER(WHERE status='completed' AND started_at::date=CURRENT_DATE),0)::numeric today_amount,COALESCE(SUM(cash_amount) FILTER(WHERE status='completed' AND started_at::date=CURRENT_DATE),0)::numeric today_cash,COALESCE(SUM(terminal_amount) FILTER(WHERE status='completed' AND started_at::date=CURRENT_DATE),0)::numeric today_terminal,COALESCE(SUM(lessons_counted) FILTER(WHERE status='completed' AND started_at::date=CURRENT_DATE),0)::int today_lessons FROM sessions WHERE user_id=$1`,[uid(req)]);const x=r.rows[0];res.json({active:Number(x.active),frozen:Number(x.frozen),todayCount:Number(x.today_count),todaySeconds:Number(x.today_seconds),todayAmount:Number(x.today_amount),todayCash:Number(x.today_cash),todayTerminal:Number(x.today_terminal),todayLessons:Number(x.today_lessons),cash:Number(x.today_cash),terminal:Number(x.today_terminal)})});

/* ==========================================================================
   YANGI: ADMIN CRUD (avtoshkola / guruh / o'quvchi)
   ========================================================================== */
app.get('/api/admin/schools', adminAuth, async (req, res) => {
  const r = await pool.query(
    `SELECT s.*,COUNT(DISTINCT g.id)::int group_count,COUNT(DISTINCT st.id)::int student_count
     FROM driving_schools s LEFT JOIN school_groups g ON g.school_id=s.id AND g.active=true
     LEFT JOIN students st ON st.school_id=s.id AND st.active=true
     WHERE s.owner_key=$1 GROUP BY s.id ORDER BY s.name`, [ownerKey(req)]);
  res.json(r.rows);
});
app.post('/api/admin/schools', adminAuth, async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Avtoshkola nomi kerak' });
  const r = await pool.query(`INSERT INTO driving_schools(owner_key,name,phone,notes) VALUES($1,$2,$3,$4) RETURNING *`,
    [ownerKey(req), name, req.body.phone || null, req.body.notes || null]);
  res.status(201).json(r.rows[0]);
});
app.put('/api/admin/schools/:id', adminAuth, async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Avtoshkola nomi kerak' });
  const r = await pool.query(`UPDATE driving_schools SET name=$1,phone=$2 WHERE id=$3 AND owner_key=$4 RETURNING *`,
    [name, req.body.phone || null, req.params.id, ownerKey(req)]);
  if (!r.rows[0]) return res.status(404).json({ error: 'Avtoshkola topilmadi' });
  res.json(r.rows[0]);
});
app.delete('/api/admin/schools/:id', adminAuth, async (req, res) => {
  const r = await pool.query(`UPDATE driving_schools SET active=false WHERE id=$1 AND owner_key=$2 RETURNING id`, [req.params.id, ownerKey(req)]);
  if (!r.rows[0]) return res.status(404).json({ error: 'Avtoshkola topilmadi' });
  res.json({ ok: true });
});

app.post('/api/admin/groups', adminAuth, async (req, res) => {
  const schoolId = String(req.body.school_id || req.body.schoolId || '');
  const name = String(req.body.name || '').trim();
  if (!schoolId || !name) return res.status(400).json({ error: 'Avtoshkola va guruh nomi kerak' });
  const own = await pool.query(`SELECT id FROM driving_schools WHERE id=$1 AND owner_key=$2`, [schoolId, ownerKey(req)]);
  if (!own.rows[0]) return res.status(404).json({ error: 'Avtoshkola topilmadi' });
  const r = await pool.query(`INSERT INTO school_groups(owner_key,school_id,name) VALUES($1,$2,$3) RETURNING *`, [ownerKey(req), schoolId, name]);
  res.status(201).json(r.rows[0]);
});
app.put('/api/admin/groups/:id', adminAuth, async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Guruh nomi kerak' });
  const r = await pool.query(`UPDATE school_groups SET name=$1 WHERE id=$2 AND owner_key=$3 RETURNING *`, [name, req.params.id, ownerKey(req)]);
  if (!r.rows[0]) return res.status(404).json({ error: 'Guruh topilmadi' });
  res.json(r.rows[0]);
});
app.delete('/api/admin/groups/:id', adminAuth, async (req, res) => {
  const r = await pool.query(`UPDATE school_groups SET active=false WHERE id=$1 AND owner_key=$2 RETURNING id`, [req.params.id, ownerKey(req)]);
  if (!r.rows[0]) return res.status(404).json({ error: 'Guruh topilmadi' });
  res.json({ ok: true });
});

app.post('/api/admin/students', adminAuth, async (req, res) => {
  const schoolId = String(req.body.school_id || req.body.schoolId || '');
  const groupId = (req.body.group_id || req.body.groupId) ? String(req.body.group_id || req.body.groupId) : null;
  const name = String(req.body.full_name || req.body.fullName || '').trim();
  if (!schoolId || !name) return res.status(400).json({ error: 'Avtoshkola va o‘quvchi ismi kerak' });
  const s = await pool.query(`SELECT id FROM driving_schools WHERE id=$1 AND owner_key=$2`, [schoolId, ownerKey(req)]);
  if (!s.rows[0]) return res.status(404).json({ error: 'Avtoshkola topilmadi' });
  const r = await pool.query(
    `INSERT INTO students(owner_key,school_id,group_id,full_name,phone,plate,birth_date,status)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [ownerKey(req), schoolId, groupId, name, req.body.phone || null, req.body.plate || null,
     req.body.birth_date || null, req.body.status || 'active']
  );
  res.status(201).json(r.rows[0]);
});
app.put('/api/admin/students/:id', adminAuth, async (req, res) => {
  const name = String(req.body.full_name || req.body.fullName || '').trim();
  if (!name) return res.status(400).json({ error: 'O‘quvchi ismi kerak' });
  const r = await pool.query(
    `UPDATE students SET school_id=COALESCE($1,school_id), group_id=$2, full_name=$3, phone=$4, plate=$5,
            birth_date=$6, status=$7, active=($7 <> 'inactive')
     WHERE id=$8 AND owner_key=$9 RETURNING *`,
    [req.body.school_id || req.body.schoolId || null, req.body.group_id || req.body.groupId || null, name,
     req.body.phone || null, req.body.plate || null, req.body.birth_date || null,
     req.body.status || 'active', req.params.id, ownerKey(req)]
  );
  if (!r.rows[0]) return res.status(404).json({ error: 'O‘quvchi topilmadi' });
  res.json(r.rows[0]);
});
app.delete('/api/admin/students/:id', adminAuth, async (req, res) => {
  const r = await pool.query(`UPDATE students SET active=false, status='inactive' WHERE id=$1 AND owner_key=$2 RETURNING id`, [req.params.id, ownerKey(req)]);
  if (!r.rows[0]) return res.status(404).json({ error: 'O‘quvchi topilmadi' });
  res.json({ ok: true });
});
/* O'quvchi kartochkasi: ma'lumot + barcha tashriflar */
app.get('/api/admin/students/:id', adminAuth, async (req, res) => {
  const sr = await pool.query(
    `SELECT st.*, s.name school_name, g.name group_name, ${STUDENT_ATTENDANCE_SQL} attendance_count
     FROM students st JOIN driving_schools s ON s.id=st.school_id
     LEFT JOIN school_groups g ON g.id=st.group_id
     WHERE st.id=$1 AND st.owner_key=$2`, [req.params.id, ownerKey(req)]);
  if (!sr.rows[0]) return res.status(404).json({ error: 'O‘quvchi topilmadi' });
  const rows = await pool.query(`${REPORT_SELECT} WHERE s.student_id=$1 AND s.status='completed' ORDER BY s.started_at DESC LIMIT 200`, [req.params.id]);
  res.json({ student: sr.rows[0], rows: rows.rows });
});

/* ==========================================================================
   BIR MARTALIK MIGRATSIYA — darslar uchun yagona hisoblagich.
   Neon konsoliga kirish imkoni bo'lmaganda ishlatiladi: ilova o'z ulanishi
   orqali bajaradi. Faqat admin tokeni bilan chaqiriladi va ikki marta
   bajarilmaydi (avtodrom_migrations jadvali orqali kuzatiladi).
   ========================================================================== */
const LESSONS_MIGRATION = 'lessons_single_counter_v1';

app.post('/api/maintenance/lessons-migration', adminAuth, async (req, res) => {
  const c = await pool.connect();
  try {
    await c.query(`CREATE TABLE IF NOT EXISTS avtodrom_migrations(
      name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);

    const done = await c.query(`SELECT applied_at FROM avtodrom_migrations WHERE name=$1`, [LESSONS_MIGRATION]);
    if (done.rows[0]) {
      return res.json({
        ok: true, already_applied: true, applied_at: done.rows[0].applied_at,
        message: 'Migratsiya avval bajarilgan. Qayta bajarilmadi.'
      });
    }

    await c.query('BEGIN');

    /* 1. Ustunlar */
    await c.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS attendance_count integer NOT NULL DEFAULT 0`);
    await c.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS manual_attendance_count integer NOT NULL DEFAULT 0`);
    await c.query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS lessons_counted integer NOT NULL DEFAULT 0`);

    /* 2. Hozirgi holatni bitta songa yig'amiz */
    const upd = await c.query(`
      UPDATE students st
         SET attendance_count = COALESCE(st.manual_attendance_count,0)
           + COALESCE((SELECT COUNT(*) FROM sessions se
                        WHERE se.student_id = st.id AND se.status='completed'),0)`);

    const updSess = await c.query(`
      UPDATE sessions
         SET lessons_counted = GREATEST(1, ROUND(COALESCE(duration_seconds,0)/3600.0)::int)
       WHERE status='completed' AND student_id IS NOT NULL AND lessons_counted = 0`);

    /* 3. Sessiya yakunlanganda avtomatik qo'shilishi */
    await c.query(`
      CREATE OR REPLACE FUNCTION avtodrom_add_lessons() RETURNS trigger AS $fn$
      DECLARE lessons integer;
      BEGIN
        IF new.student_id IS NULL THEN RETURN new; END IF;
        IF new.status = 'completed'
           AND (tg_op = 'INSERT' OR old.status IS DISTINCT FROM 'completed') THEN
          lessons := GREATEST(1, ROUND(COALESCE(new.duration_seconds,0)/3600.0)::int);
          UPDATE students SET attendance_count = COALESCE(attendance_count,0) + lessons
           WHERE id = new.student_id;
          new.lessons_counted := lessons;
        END IF;
        RETURN new;
      END;
      $fn$ LANGUAGE plpgsql`);

    await c.query(`DROP TRIGGER IF EXISTS trg_avtodrom_add_lessons ON sessions`);
    await c.query(`CREATE TRIGGER trg_avtodrom_add_lessons
      BEFORE INSERT OR UPDATE ON sessions
      FOR EACH ROW EXECUTE FUNCTION avtodrom_add_lessons()`);

    await c.query(`INSERT INTO avtodrom_migrations(name) VALUES($1)`, [LESSONS_MIGRATION]);
    await c.query('COMMIT');

    const sample = await c.query(`
      SELECT full_name, attendance_count FROM students
       WHERE attendance_count > 0 ORDER BY attendance_count DESC LIMIT 5`);

    res.json({
      ok: true,
      already_applied: false,
      students_updated: upd.rowCount,
      sessions_updated: updSess.rowCount,
      trigger: 'trg_avtodrom_add_lessons o\'rnatildi',
      sample: sample.rows
    });
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch (e2) { /* noop */ }
    console.error('[migration]', e.message);
    res.status(500).json({ ok: false, error: e.message });
  } finally { c.release(); }
});

/* Migratsiya holatini ko'rish */
app.get('/api/maintenance/status', adminAuth, async (req, res) => {
  const applied = await pool.query(
    `SELECT name, applied_at FROM avtodrom_migrations ORDER BY applied_at`
  ).catch(() => ({ rows: [] }));
  const trg = await pool.query(
    `SELECT tgname FROM pg_trigger WHERE tgname='trg_avtodrom_add_lessons'`
  ).catch(() => ({ rows: [] }));
  const top = await pool.query(
    `SELECT full_name, attendance_count FROM students ORDER BY attendance_count DESC NULLS LAST LIMIT 5`
  ).catch(() => ({ rows: [] }));
  res.json({ migrations: applied.rows, trigger_installed: !!trg.rows[0], top_students: top.rows });
});

/* Yozuvlar qaysi egaga tegishli ekanini ko'rish */
app.get('/api/maintenance/owners', adminAuth, async (req, res) => {
  const q = async (sql) => (await pool.query(sql).catch(() => ({ rows: [] }))).rows;
  res.json({
    users: await q(`SELECT id, username, full_name, role FROM users ORDER BY created_at`),
    students: await q(`SELECT owner_key, COUNT(*)::int n FROM students GROUP BY owner_key ORDER BY n DESC`),
    schools: await q(`SELECT owner_key, COUNT(*)::int n FROM driving_schools GROUP BY owner_key ORDER BY n DESC`),
    groups: await q(`SELECT owner_key, COUNT(*)::int n FROM school_groups GROUP BY owner_key ORDER BY n DESC`),
    instructors: await q(`SELECT settings->>'owner_key' owner_key, COUNT(*)::int n FROM public.instructors GROUP BY 1 ORDER BY n DESC`)
  });
});

/* Barcha yozuvlarni bitta egaga biriktirish */
app.post('/api/maintenance/fix-owner', adminAuth, async (req, res) => {
  const target = String(req.body.ownerKey || '').trim();
  if (!target) return res.status(400).json({ error: 'ownerKey kerak' });
  const chk = await pool.query(`SELECT id FROM users WHERE id::text=$1`, [target]);
  if (!chk.rows[0]) return res.status(404).json({ error: 'Bunday foydalanuvchi topilmadi' });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const a = await c.query(`UPDATE driving_schools SET owner_key=$1 WHERE owner_key IS DISTINCT FROM $1`, [target]);
    const b = await c.query(`UPDATE school_groups   SET owner_key=$1 WHERE owner_key IS DISTINCT FROM $1`, [target]);
    const d = await c.query(`UPDATE students        SET owner_key=$1 WHERE owner_key IS DISTINCT FROM $1`, [target]);
    const e = await c.query(`UPDATE public.instructors SET settings = jsonb_set(COALESCE(settings,'{}'::jsonb), '{owner_key}', to_jsonb($1::text))
                              WHERE settings->>'owner_key' IS DISTINCT FROM $1`, [target]);
    await c.query('COMMIT');
    res.json({ ok: true, owner: target, schools: a.rowCount, groups: b.rowCount, students: d.rowCount, instructors: e.rowCount });
  } catch (err) {
    try { await c.query('ROLLBACK'); } catch (e2) { /* noop */ }
    res.status(500).json({ ok: false, error: err.message });
  } finally { c.release(); }
});

app.use(express.static(frontendPath));
app.use((req,res,next)=>{if(req.path.startsWith('/api/'))return res.status(404).json({error:'Endpoint topilmadi'});res.sendFile(path.join(frontendPath,'index.html'))});

/* Migratsiyani darhol boshlaymiz; so'rovlar yuqoridagi middleware'da kutadi */
schemaReady();

/* YANGI: barcha tutilmagan xatolar API uchun JSON qaytaradi (HTML emas) */
app.use((err, req, res, next) => {
  console.error('UNHANDLED', req.method, req.originalUrl, '->', err && err.message);
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({ error: 'Serverda xatolik: ' + ((err && err.message) || 'nomalum') });
  }
  next(err);
});

export default app;
if(process.env.VERCEL!=='1')app.listen(PORT,'0.0.0.0',()=>console.log(`AVTODROM running on :${PORT}`));
