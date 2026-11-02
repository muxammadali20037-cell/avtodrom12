/* ============================================================================
   HISOBLAR VA KOMPYUTERLAR — kim hozir kirgan

   Tizim kirishni (login) serverda saqlamaydi — kalit (token) kompyuterda
   turadi. Shuning uchun «hozir kim kirgan» faoliyat bo'yicha aniqlanadi:
   kassa sahifasi har so'rovda (va yashirin turganda ham har daqiqada)
   o'z qurilma raqamini (X-Device) yuboradi; server hisob + kompyuter
   bo'yicha oxirgi faollik vaqtini yozadi (`user_activity`, bir daqiqada
   ko'pi bilan bir marta).

     GET  /api/accounts/ping      — yurak urishi (sahifa yopiq turganda ham)
     GET  /api/accounts/activity  — hamma hisoblar: kompyuterlari, oxirgi
                                    faolligi, bugungi va ochiq yozuvlari
                                    (Maxsus kaliti bilan)
   ========================================================================== */

import jwt from 'jsonwebtoken';
import { pool } from '../backend/src/db.js';
import { runOnce } from '../backend/src/schema-once.js';
import { maxsusOk, lockedResponse } from './lock-routes.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
const ONLINE_SEC = 5 * 60;

function json(res, status, data) {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}
function userOf(req) {
  try {
    const h = req.headers?.authorization || '';
    if (!h.startsWith('Bearer ')) return null;
    const p = jwt.verify(h.slice(7), JWT_SECRET);
    return p && p.sub && String(p.sub) !== 'admin' ? String(p.sub) : null;
  } catch { return null; }
}

let schemaP = null;
function ensureSchema() {
  if (schemaP) return schemaP;
  schemaP = runOnce('user-activity-v1', async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS user_activity(
      user_id TEXT NOT NULL, device_id TEXT NOT NULL,
      first_seen TIMESTAMPTZ NOT NULL DEFAULT now(), last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
      ip TEXT, ua TEXT, post SMALLINT, hits INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY(user_id, device_id))`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_activity_seen ON user_activity(last_seen DESC)`);
  }).catch(e => { schemaP = null; throw e; });
  return schemaP;
}

/* Har /api so'rovida chaqiriladi — bir daqiqada bir marta yoziladi */
const seen = new Map();
export async function trackActivity(req) {
  try {
    const user = userOf(req);
    if (!user) return;
    const dev = String(req.headers['x-device'] || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'nomalum';
    const k = user + ':' + dev;
    const now = Date.now();
    if (seen.has(k) && now - seen.get(k) < 60000) return;
    seen.set(k, now);
    if (seen.size > 5000) seen.clear();
    await ensureSchema();
    const h = req.headers || {};
    const ip = String(h['x-real-ip'] || h['x-vercel-forwarded-for'] || String(h['x-forwarded-for'] || '').split(',')[0] || req.socket?.remoteAddress || '').trim().slice(0, 64);
    const post = Number(h['x-post']);
    await pool.query(`INSERT INTO user_activity(user_id, device_id, ip, ua, post) VALUES($1, $2, $3, $4, $5)
      ON CONFLICT (user_id, device_id) DO UPDATE SET last_seen = now(), ip = EXCLUDED.ip, ua = EXCLUDED.ua,
        post = COALESCE(EXCLUDED.post, user_activity.post), hits = user_activity.hits + 1`,
      [user, dev, ip || null, String(h['user-agent'] || '').slice(0, 300) || null, post === 1 || post === 2 ? post : null]);
  } catch (e) { console.error('ACTIVITY:', e.message); }
}

/* «Chrome · Windows» kabi qisqa nom */
function device(ua) {
  const s = String(ua || '');
  const br = /Edg\//.test(s) ? 'Edge' : /OPR\//.test(s) ? 'Opera' : /YaBrowser/.test(s) ? 'Yandex' : /Chrome\//.test(s) ? 'Chrome'
    : /Firefox\//.test(s) ? 'Firefox' : /Safari\//.test(s) ? 'Safari' : 'Brauzer';
  const os = /Windows/.test(s) ? 'Windows' : /Android/.test(s) ? 'Android' : /iPhone|iPad/.test(s) ? 'iPhone' : /Mac OS/.test(s) ? 'Mac' : /Linux/.test(s) ? 'Linux' : '';
  return br + (os ? ' · ' + os : '');
}

async function activity(res, me) {
  await ensureSchema();
  const TZ = 'Asia/Tashkent';
  const [users, acts, sess] = await Promise.all([
    pool.query(`SELECT id::text AS id, username, full_name, created_at FROM users ORDER BY created_at`),
    pool.query(`SELECT user_id, device_id, first_seen, last_seen, ip, ua, post, hits,
        EXTRACT(EPOCH FROM (now() - last_seen))::int AS ago FROM user_activity ORDER BY last_seen DESC`),
    pool.query(`SELECT user_id::text AS user_id,
        COUNT(*) FILTER (WHERE status IN ('active','frozen','paused'))::int AS open,
        COUNT(*) FILTER (WHERE status <> 'cancelled' AND started_at >= ((now() AT TIME ZONE '${TZ}')::date::timestamp AT TIME ZONE '${TZ}'))::int AS today,
        MAX(started_at) FILTER (WHERE status <> 'cancelled') AS last_session
      FROM sessions GROUP BY 1`)
  ]);
  const S = new Map(sess.rows.map(x => [x.user_id, x]));
  const A = new Map();
  for (const a of acts.rows) {
    const list = A.get(a.user_id) || [];
    list.push({ device: device(a.ua), post: a.post, last_seen: a.last_seen, first_seen: a.first_seen, online: a.ago <= ONLINE_SEC,
      ip: a.ip ? a.ip.replace(/(\d+\.\d+)\.\d+\.\d+$/, '$1.*.*') : null, me: false });
    A.set(a.user_id, list);
  }
  const rows = users.rows.map(u => {
    const devs = A.get(u.id) || [];
    const s = S.get(u.id) || {};
    return { id: u.id, username: u.username, full_name: u.full_name, created_at: u.created_at, me: u.id === me,
      online: devs.some(d => d.online), devices: devs, last_seen: devs[0] ? devs[0].last_seen : null,
      open: Number(s.open || 0), today: Number(s.today || 0), last_session: s.last_session || null };
  }).sort((a, b) => (b.online - a.online) || (new Date(b.last_seen || b.last_session || 0) - new Date(a.last_seen || a.last_session || 0)));
  json(res, 200, {
    accounts: rows,
    total: rows.length,
    online_accounts: rows.filter(r => r.online).length,
    online_devices: rows.reduce((n, r) => n + r.devices.filter(d => d.online).length, 0),
    today_accounts: rows.filter(r => r.today > 0).length,
    window_min: ONLINE_SEC / 60
  });
}

export async function handleAccountsRequest(req, res) {
  const path = String(req.url || '').split('?', 1)[0];
  if (!path.startsWith('/api/accounts/')) return false;
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return true; }
  const user = userOf(req);
  if (!user) { json(res, 401, { error: 'Kirish talab qilinadi' }); return true; }
  try {
    if (path === '/api/accounts/ping' && req.method === 'GET') { json(res, 200, { ok: true }); return true; }
    if (path === '/api/accounts/activity' && req.method === 'GET') {
      if (!maxsusOk(req, user)) { lockedResponse(res); return true; }
      await activity(res, user);
      return true;
    }
    json(res, 404, { error: 'Topilmadi' });
    return true;
  } catch (e) {
    console.error('ACCOUNTS ERROR:', e);
    json(res, 500, { error: e.message || 'Xatolik' });
    return true;
  }
}
