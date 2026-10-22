/* ============================================================================
   MAXSUS BO'LIM — parol bilan qulf

   Hisobot (Kunlik hisobot, Rasxod, Excel, Tarix), Nazorat va Boshqaruv
   (Instruktorlar, Admin panel) bitta «Maxsus bo'lim» ichida. Kassir
   faqat kassa bo'limlarini ko'radi; rahbar parolni yozsa qolganlari ochiladi.

     GET  /api/lock/status                       { set }
     POST /api/lock/unlock  { password }         → { token, exp }
     POST /api/lock/setup   { password, account_password }
          — birinchi marta yoki «parolni unutdim»: tizimga kirish (hisob)
            paroli bilan tasdiqlanadi, shuning uchun kassir o'zicha qo'ya olmaydi
     POST /api/lock/change  { old_password, password }

   Parol bazada faqat bcrypt-xesh ko'rinishida (hamma kompyuterda bir xil).
   Noto'g'ri parolga 400 qaytariladi (401 emas — ilova 401 da tizimdan chiqaradi).
   5 marta noto'g'ri yozilsa 1 daqiqa kutiladi.
   Ochilganda qisqa muddatli kalit (X-Maxsus) beriladi — Excel va Nazorat
   API'lari shusiz ishlamaydi (maxsusOk).
   ========================================================================== */

import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { pool } from '../backend/src/db.js';
import { runOnce } from '../backend/src/schema-once.js';
import { logChange } from './audit-routes.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
const TTL_SEC = 12 * 3600;
const MAX_FAILS = 5;
const BLOCK_SEC = 60;

function json(res, status, data) {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}
function auth(req) {
  try {
    const h = req.headers?.authorization || '';
    if (!h.startsWith('Bearer ')) return null;
    const p = jwt.verify(h.slice(7), JWT_SECRET);
    return p && p.sub && String(p.sub) !== 'admin' ? String(p.sub) : null;
  } catch { return null; }
}
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  return await new Promise(resolve => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 1e4) req.destroy(); });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

let schemaP = null;
function ensureLockSchema() {
  if (schemaP) return schemaP;
  schemaP = runOnce('lock-schema-v1', async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS section_locks(
      user_id TEXT PRIMARY KEY,
      pass_hash TEXT NOT NULL,
      failed_count INTEGER NOT NULL DEFAULT 0,
      blocked_until TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  }).catch(e => { schemaP = null; throw e; });
  return schemaP;
}

/* Maxsus kalit to'g'rimi (shu foydalanuvchi uchun, muddati o'tmagan) */
export function maxsusOk(req, user) {
  try {
    const raw = req.headers?.['x-maxsus'] || req.headers?.['X-Maxsus'];
    if (!raw) return false;
    const p = jwt.verify(String(raw), JWT_SECRET);
    return !!p && p.scope === 'maxsus' && String(p.sub) === String(user);
  } catch { return false; }
}
export function lockedResponse(res) {
  json(res, 403, { error: 'Maxsus bo‘lim qulflangan — parolni kiriting', locked: true });
}

function issue(user) {
  const exp = Math.floor(Date.now() / 1000) + TTL_SEC;
  return { token: jwt.sign({ sub: String(user), scope: 'maxsus', exp }, JWT_SECRET), exp: exp * 1000 };
}
const cleanPass = v => String(v === null || v === undefined ? '' : v);

async function accountPasswordOk(user, pw) {
  if (!pw) return false;
  const r = await pool.query(`SELECT password_hash FROM users WHERE id::text = $1 LIMIT 1`, [String(user)]);
  const h = r.rows[0] && r.rows[0].password_hash;
  if (!h) return false;
  try { return await bcrypt.compare(pw, h); } catch { return false; }
}

async function status(res, user) {
  const r = await pool.query(`SELECT 1 FROM section_locks WHERE user_id = $1`, [user]);
  json(res, 200, { set: !!r.rowCount });
}

async function unlock(req, res, user) {
  const b = await readBody(req);
  const pw = cleanPass(b.password);
  const r = await pool.query(`SELECT pass_hash, failed_count, blocked_until, blocked_until > now() AS blocked,
      GREATEST(0, EXTRACT(EPOCH FROM (blocked_until - now())))::int AS wait FROM section_locks WHERE user_id = $1`, [user]);
  const row = r.rows[0];
  if (!row) return json(res, 409, { error: 'Parol hali qo‘yilmagan', notSet: true });
  if (row.blocked) return json(res, 429, { error: 'Ko‘p marta noto‘g‘ri yozildi. ' + row.wait + ' soniyadan keyin urinib ko‘ring', wait: row.wait });
  const ok = pw.length > 0 && await bcrypt.compare(pw, row.pass_hash);
  if (!ok) {
    const u = await pool.query(`UPDATE section_locks SET failed_count = failed_count + 1,
        blocked_until = CASE WHEN failed_count + 1 >= $2 THEN now() + make_interval(secs => $3) ELSE blocked_until END
      WHERE user_id = $1 RETURNING failed_count`, [user, MAX_FAILS, BLOCK_SEC]);
    const n = u.rows[0] ? u.rows[0].failed_count : 1;
    if (n >= MAX_FAILS) {
      await pool.query(`UPDATE section_locks SET failed_count = 0 WHERE user_id = $1`, [user]);
      await logChange(null, user, { entity: 'maxsus', action: 'unlock_blocked', reason: MAX_FAILS + ' marta noto‘g‘ri parol' });
      return json(res, 429, { error: 'Parol ' + MAX_FAILS + ' marta noto‘g‘ri yozildi — ' + BLOCK_SEC + ' soniya kuting', wait: BLOCK_SEC });
    }
    return json(res, 400, { error: 'Parol noto‘g‘ri' + (MAX_FAILS - n <= 2 ? ' (yana ' + (MAX_FAILS - n) + ' ta urinish)' : ''), left: MAX_FAILS - n });
  }
  await pool.query(`UPDATE section_locks SET failed_count = 0, blocked_until = NULL WHERE user_id = $1`, [user]);
  json(res, 200, Object.assign({ ok: true }, issue(user)));
}

async function setup(req, res, user) {
  const b = await readBody(req);
  const pw = cleanPass(b.password);
  if (pw.length < 4) return json(res, 400, { error: 'Parol kamida 4 ta belgi bo‘lsin', field: 'password' });
  if (pw.length > 100) return json(res, 400, { error: 'Parol juda uzun', field: 'password' });
  if (!(await accountPasswordOk(user, cleanPass(b.account_password)))) {
    return json(res, 400, { error: 'Tizimga kirish (hisob) paroli noto‘g‘ri', field: 'account' });
  }
  const had = (await pool.query(`SELECT 1 FROM section_locks WHERE user_id = $1`, [user])).rowCount > 0;
  const hash = await bcrypt.hash(pw, 10);
  await pool.query(`INSERT INTO section_locks(user_id, pass_hash) VALUES($1, $2)
    ON CONFLICT (user_id) DO UPDATE SET pass_hash = EXCLUDED.pass_hash, failed_count = 0, blocked_until = NULL, updated_at = now()`, [user, hash]);
  await logChange(null, user, { entity: 'maxsus', action: had ? 'password_reset' : 'password_set',
    reason: had ? 'Maxsus bo‘lim paroli hisob paroli bilan tiklandi' : 'Maxsus bo‘lim paroli qo‘yildi' });
  json(res, 200, Object.assign({ ok: true }, issue(user)));
}

async function change(req, res, user) {
  const b = await readBody(req);
  const pw = cleanPass(b.password);
  if (pw.length < 4) return json(res, 400, { error: 'Yangi parol kamida 4 ta belgi bo‘lsin', field: 'password' });
  const r = await pool.query(`SELECT pass_hash FROM section_locks WHERE user_id = $1`, [user]);
  if (!r.rows[0]) return json(res, 409, { error: 'Parol hali qo‘yilmagan', notSet: true });
  if (!(await bcrypt.compare(cleanPass(b.old_password), r.rows[0].pass_hash))) {
    return json(res, 400, { error: 'Hozirgi parol noto‘g‘ri', field: 'old' });
  }
  await pool.query(`UPDATE section_locks SET pass_hash = $2, failed_count = 0, blocked_until = NULL, updated_at = now() WHERE user_id = $1`,
    [user, await bcrypt.hash(pw, 10)]);
  await logChange(null, user, { entity: 'maxsus', action: 'password_change', reason: 'Maxsus bo‘lim paroli o‘zgartirildi' });
  json(res, 200, Object.assign({ ok: true }, issue(user)));
}

export async function handleLockRequest(req, res) {
  const path = String(req.url || '').split('?', 1)[0];
  if (!path.startsWith('/api/lock/')) return false;
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return true; }
  const user = auth(req);
  if (!user) { json(res, 401, { error: 'Kirish talab qilinadi' }); return true; }
  try {
    await ensureLockSchema();
    if (path === '/api/lock/status' && req.method === 'GET') { await status(res, user); return true; }
    if (path === '/api/lock/unlock' && req.method === 'POST') { await unlock(req, res, user); return true; }
    if (path === '/api/lock/setup' && req.method === 'POST') { await setup(req, res, user); return true; }
    if (path === '/api/lock/change' && req.method === 'POST') { await change(req, res, user); return true; }
    json(res, 404, { error: 'Topilmadi' }); return true;
  } catch (e) {
    console.error('LOCK ERROR:', e);
    json(res, 500, { error: e.message || 'Qulf bo‘yicha xatolik' });
    return true;
  }
}
