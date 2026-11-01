/* ============================================================================
   KIRISH KODI — saytga kirishdan oldin umumiy kod (standart 1212)

   Sayt ochilganda avval «Kirish kodi» so'raladi, keyin login/parol
   (yoki saqlangan hisob). Kod to'g'ri bo'lsa server 12 soatlik kalit
   beradi (X-Entry). Login va ro'yxatdan o'tish shu kalitsiz ishlamaydi —
   kodni bilmagan odam hisobga kira olmaydi va yangi hisob ham ocholmaydi.

     POST /api/entry/check   { pin }              → { token, exp }
     POST /api/entry/change  { pin }  (hisob + Maxsus kaliti bilan)

   Kod bazada bcrypt-xesh bo'lib saqlanadi (`site_entry`). Hali
   o'zgartirilmagan bo'lsa — ENTRY_PIN muhit o'zgaruvchisi yoki 1212.
   Noto'g'ri kod: shu manzildan 5 marta → 1 daqiqa, 10 marta → 10 daqiqa
   kutiladi (`entry_fails`).
   ========================================================================== */

import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { pool } from '../backend/src/db.js';
import { runOnce } from '../backend/src/schema-once.js';
import { maxsusOk, lockedResponse } from './lock-routes.js';
import { logChange } from './audit-routes.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
const DEFAULT_PIN = () => String(process.env.ENTRY_PIN || '1212');
const TTL_SEC = 12 * 3600;

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
/* Mijoz manzili: Vercel o'zi qo'yadigan sarlavhalar birinchi (mijoz soxtalashtira olmaydi) */
function ipOf(req) {
  const h = req.headers || {};
  const v = String(h['x-real-ip'] || h['x-vercel-forwarded-for'] || String(h['x-forwarded-for'] || '').split(',')[0] || '').trim();
  return (v || req.socket?.remoteAddress || 'unknown').slice(0, 64);
}

let schemaP = null;
function ensureSchema() {
  if (schemaP) return schemaP;
  schemaP = runOnce('site-entry-v1', async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS site_entry(
      id INTEGER PRIMARY KEY DEFAULT 1, pin_hash TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS entry_fails(
      ip TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0, until TIMESTAMPTZ, at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  }).catch(e => { schemaP = null; throw e; });
  return schemaP;
}

/* X-Entry kaliti to'g'rimi */
export function entryOk(req) {
  try {
    const raw = req.headers?.['x-entry'];
    if (!raw) return false;
    const p = jwt.verify(String(raw), JWT_SECRET);
    return !!p && p.scope === 'entry';
  } catch { return false; }
}
function issue() {
  const exp = Math.floor(Date.now() / 1000) + TTL_SEC;
  return { token: jwt.sign({ scope: 'entry', n: crypto.randomBytes(6).toString('hex'), exp }, JWT_SECRET), exp: exp * 1000 };
}
async function pinMatches(pin) {
  const r = await pool.query(`SELECT pin_hash FROM site_entry WHERE id = 1`);
  if (!r.rows[0]) {
    const a = Buffer.from(String(pin)), b = Buffer.from(DEFAULT_PIN());
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  try { return await bcrypt.compare(String(pin), r.rows[0].pin_hash); } catch { return false; }
}

async function check(req, res) {
  const b = await readBody(req);
  const pin = String(b.pin === undefined || b.pin === null ? '' : b.pin).replace(/\s+/g, '');
  const ip = ipOf(req);
  const f = (await pool.query(`SELECT n, until > now() AS blocked, GREATEST(0, EXTRACT(EPOCH FROM (until - now())))::int AS wait
    FROM entry_fails WHERE ip = $1`, [ip])).rows[0];
  if (f && f.blocked) return json(res, 429, { error: 'Ko‘p marta noto‘g‘ri kiritildi. ' + f.wait + ' soniyadan keyin urinib ko‘ring', wait: f.wait });
  if (pin && await pinMatches(pin)) {
    await pool.query(`DELETE FROM entry_fails WHERE ip = $1`, [ip]);
    return json(res, 200, Object.assign({ ok: true }, issue()));
  }
  const u = await pool.query(`INSERT INTO entry_fails(ip, n, at) VALUES($1, 1, now())
    ON CONFLICT (ip) DO UPDATE SET n = CASE WHEN entry_fails.at < now() - interval '1 hour' THEN 1 ELSE entry_fails.n + 1 END, at = now()
    RETURNING n`, [ip]);
  const n = u.rows[0].n;
  if (n % 5 === 0) {
    const secs = n >= 10 ? 600 : 60;
    await pool.query(`UPDATE entry_fails SET until = now() + make_interval(secs => $2) WHERE ip = $1`, [ip, secs]);
    return json(res, 429, { error: 'Kod ' + n + ' marta noto‘g‘ri kiritildi — ' + (secs >= 600 ? '10 daqiqa' : '1 daqiqa') + ' kuting', wait: secs });
  }
  json(res, 400, { error: 'Kirish kodi noto‘g‘ri' });
}

async function change(req, res, user) {
  const b = await readBody(req);
  const pin = String(b.pin === undefined || b.pin === null ? '' : b.pin).replace(/\s+/g, '');
  if (!/^\d{4,8}$/.test(pin)) return json(res, 400, { error: 'Kod 4–8 ta raqamdan iborat bo‘lsin' });
  const hash = await bcrypt.hash(pin, 10);
  await pool.query(`INSERT INTO site_entry(id, pin_hash, updated_by) VALUES(1, $1, $2)
    ON CONFLICT (id) DO UPDATE SET pin_hash = EXCLUDED.pin_hash, updated_at = now(), updated_by = EXCLUDED.updated_by`, [hash, user]);
  await logChange(null, user, { entity: 'site', action: 'entry_pin_change', reason: 'Saytga kirish kodi o‘zgartirildi' });
  json(res, 200, { ok: true });
}

export async function handleEntryRequest(req, res) {
  const path = String(req.url || '').split('?', 1)[0];
  if (!path.startsWith('/api/entry/')) return false;
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return true; }
  try {
    await ensureSchema();
    if (path === '/api/entry/check' && req.method === 'POST') { await check(req, res); return true; }
    if (path === '/api/entry/change' && req.method === 'POST') {
      const user = auth(req);
      if (!user) { json(res, 401, { error: 'Kirish talab qilinadi' }); return true; }
      if (!maxsusOk(req, user)) { lockedResponse(res); return true; }
      await change(req, res, user);
      return true;
    }
    json(res, 404, { error: 'Topilmadi' });
    return true;
  } catch (e) {
    console.error('ENTRY ERROR:', e);
    json(res, 500, { error: e.message || 'Kirish kodi bo‘yicha xatolik' });
    return true;
  }
}

/* Login / ro'yxatdan o'tish — kirish kalitisiz yopiq */
export function guardAuth(req, res) {
  const path = String(req.url || '').split('?', 1)[0];
  if (req.method !== 'POST' || (path !== '/api/auth/login' && path !== '/api/auth/register')) return false;
  if (entryOk(req)) return false;
  json(res, 403, { error: 'Avval saytga kirish kodini kiriting', entry: true });
  return true;
}
