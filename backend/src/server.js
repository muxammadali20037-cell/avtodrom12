import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

dotenv.config();
const { Pool } = pg;
const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') || true }));
app.use(express.json());

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';

function tokenFor(user) {
  return jwt.sign({ sub: user.id, role: user.role, username: user.username }, JWT_SECRET, { expiresIn: '12h' });
}

async function auth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) return res.status(401).json({ error: 'Kirish talab qilinadi' });
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Sessiya yaroqsiz yoki tugagan' });
  }
}

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, database: true });
  } catch {
    res.status(503).json({ ok: false, database: false });
  }
});

app.post('/api/auth/register', async (req, res) => {
  const { fullName, username, password } = req.body;
  if (!fullName || !username || !password || password.length < 6) return res.status(400).json({ error: 'Ism, login va kamida 6 belgili parol kerak' });
  try {
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      `INSERT INTO users(full_name, username, password_hash) VALUES($1,$2,$3)
       RETURNING id, full_name, username, role`, [fullName.trim(), username.trim(), hash]
    );
    res.status(201).json({ user: rows[0], token: tokenFor(rows[0]) });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Bu login mavjud' });
    res.status(500).json({ error: 'Ro‘yxatdan o‘tishda xatolik' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE username=$1', [username?.trim()]);
    if (!rows[0] || !(await bcrypt.compare(password || '', rows[0].password_hash))) return res.status(401).json({ error: 'Login yoki parol noto‘g‘ri' });
    const user = { id: rows[0].id, full_name: rows[0].full_name, username: rows[0].username, role: rows[0].role };
    res.json({ user, token: tokenFor(user) });
  } catch { res.status(500).json({ error: 'Kirishda xatolik' }); }
});

app.get('/api/settings', auth, async (_req, res) => {
  const { rows } = await pool.query('SELECT hourly_rate, minimum_payment, calculation_mode FROM settings WHERE id=1');
  res.json(rows[0]);
});

app.put('/api/settings', auth, async (req, res) => {
  const { hourlyRate, minimumPayment, calculationMode } = req.body;
  if (!Number.isFinite(Number(hourlyRate)) || !Number.isFinite(Number(minimumPayment))) return res.status(400).json({ error: 'Narx noto‘g‘ri' });
  const { rows } = await pool.query(
    `UPDATE settings SET hourly_rate=$1, minimum_payment=$2, calculation_mode=$3, updated_at=NOW() WHERE id=1
     RETURNING hourly_rate, minimum_payment, calculation_mode`, [hourlyRate, minimumPayment, calculationMode === 'minute' ? 'minute' : 'hour']
  );
  res.json(rows[0]);
});

app.get('/api/sessions/active', auth, async (_req, res) => {
  const { rows } = await pool.query(`SELECT s.id, v.plate, v.model, v.driver_name, s.started_at
    FROM sessions s JOIN vehicles v ON v.id=s.vehicle_id WHERE s.status='active' ORDER BY s.started_at`);
  res.json(rows);
});

app.post('/api/sessions/start', auth, async (req, res) => {
  const { regionCode, firstLetter, number, lastLetters, model, driverName } = req.body;
  if (!['01','10','20','25','30','40','50','60','70','75','80','85','90','95'].includes(regionCode)) return res.status(400).json({ error: 'Viloyat kodi noto‘g‘ri' });
  if (!/^[A-Z]$/.test(firstLetter) || !/^\d{3}$/.test(number) || !/^[A-Z]{2}$/.test(lastLetters)) return res.status(400).json({ error: 'Avtomobil raqami noto‘g‘ri' });
  const plate = `${regionCode} ${firstLetter} ${number} ${lastLetters}`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let vehicle = (await client.query('SELECT * FROM vehicles WHERE plate=$1', [plate])).rows[0];
    if (!vehicle) {
      vehicle = (await client.query(`INSERT INTO vehicles(region_code,first_letter,number,last_letters,plate,model,driver_name)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [regionCode, firstLetter, number, lastLetters, plate, model || null, driverName || null])).rows[0];
    }
    const settings = (await client.query('SELECT hourly_rate, minimum_payment, calculation_mode FROM settings WHERE id=1')).rows[0];
    const session = (await client.query(`INSERT INTO sessions(vehicle_id,hourly_rate,minimum_payment,calculation_mode)
      VALUES($1,$2,$3,$4) RETURNING id,started_at`, [vehicle.id, settings.hourly_rate, settings.minimum_payment, settings.calculation_mode])).rows[0];
    await client.query('COMMIT');
    res.status(201).json({ id: session.id, plate, startedAt: session.started_at });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') return res.status(409).json({ error: 'Bu avtomobil hozir jarayonda' });
    res.status(500).json({ error: 'START bajarilmadi' });
  } finally { client.release(); }
});

app.post('/api/sessions/:id/finish', auth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const q = await client.query(`SELECT s.*, v.plate FROM sessions s JOIN vehicles v ON v.id=s.vehicle_id WHERE s.id=$1 AND s.status='active' FOR UPDATE`, [req.params.id]);
    if (!q.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Faol sessiya topilmadi' }); }
    const s = q.rows[0], finishedAt = new Date();
    const seconds = Math.max(0, Math.floor((finishedAt.getTime() - new Date(s.started_at).getTime()) / 1000));
    const minutes = seconds / 60;
    const raw = s.calculation_mode === 'minute' ? minutes * Number(s.hourly_rate) / 60 : Math.max(1, Math.ceil(minutes / 60)) * Number(s.hourly_rate);
    const amount = Math.max(Number(s.minimum_payment), raw);
    const { rows } = await client.query(`UPDATE sessions SET finished_at=$1,duration_seconds=$2,amount=$3,status='completed' WHERE id=$4
      RETURNING id,started_at,finished_at,duration_seconds,amount`, [finishedAt, seconds, amount, s.id]);
    await client.query('COMMIT');
    res.json({ ...rows[0], plate: s.plate });
  } catch { await client.query('ROLLBACK'); res.status(500).json({ error: 'FINISH bajarilmadi' }); }
  finally { client.release(); }
});

app.get('/api/reports/daily', auth, async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0,10);
  const { rows } = await pool.query(`SELECT v.plate,s.started_at,s.finished_at,s.duration_seconds,s.amount
    FROM sessions s JOIN vehicles v ON v.id=s.vehicle_id WHERE s.status='completed' AND s.started_at::date=$1 ORDER BY s.started_at DESC`, [date]);
  const summary = rows.reduce((a,x)=>({ count:a.count+1, seconds:a.seconds+Number(x.duration_seconds||0), amount:a.amount+Number(x.amount||0) }),{count:0,seconds:0,amount:0});
  res.json({ date, summary, rows });
});

app.listen(PORT, () => console.log(`AVTODROM API running on :${PORT}`));
