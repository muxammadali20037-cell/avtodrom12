/* ============================================================================
   BIR AMAL — BIR MARTA (internetsiz rejim uchun)

   Kassa internetsiz ishlaganda «Kirdi», «Chiqdi», «To'lash», davomat
   kompyuterda navbatga yoziladi va internet qaytganda serverga yuboriladi.
   Internet sekin/uzilib-ulanib turganda bir xil so'rov ikki marta yetib
   kelishi mumkin (javob qaytmay qoldi — sahifa qayta yubordi). Shunda
   pul yoki davomat IKKI MARTA yozilmasligi kerak.

   Sahifa har bir amalga noyob raqam beradi: `X-Op-Id` sarlavhasi.
     • birinchi kelganda — amal bajariladi, muvaffaqiyatli javob (2xx)
       client_ops jadvaliga saqlanadi (javob yuborilishidan OLDIN);
     • yana kelsa — amal QAYTA BAJARILMAYDI, saqlangan javob qaytariladi;
     • xato bilan tugasa (4xx/5xx) — hech narsa saqlanmaydi, qayta urinish
       mumkin (xato bo'lsa bazaga hech narsa yozilmagan bo'ladi);
     • hali bajarilayotgan bo'lsa — 409 { inProgress: true } (sahifa
       biroz kutib yana yuboradi). 90 soniyadan ortiq «osilib» qolgan
       bo'lsa (server o'chib qolgan) — qaytadan bajariladi.
   Jadval yo'q bo'lsa yoki baza xato bersa — oddiy ishlaydi (to'xtamaydi).
   ========================================================================== */

import jwt from 'jsonwebtoken';
import { pool } from '../backend/src/db.js';
import { runOnce } from '../backend/src/schema-once.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
const OP_RE = /^[A-Za-z0-9_-]{8,80}$/;

let schemaP = null;
function ensureOpsSchema() {
  if (schemaP) return schemaP;
  schemaP = runOnce('client-ops-v1', async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS client_ops(
      op_id TEXT PRIMARY KEY,
      user_key TEXT NOT NULL,
      method TEXT,
      path TEXT,
      status INTEGER NOT NULL DEFAULT 0,
      body TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      done_at TIMESTAMPTZ)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_client_ops_created ON client_ops(created_at)`);
  }).catch(e => { schemaP = null; throw e; });
  return schemaP;
}

function userOf(req) {
  try {
    const h = req.headers?.authorization || '';
    if (!h.startsWith('Bearer ')) return null;
    const p = jwt.verify(h.slice(7), JWT_SECRET);
    return p && p.sub ? String(p.sub) : null;
  } catch { return null; }
}

function sendJson(res, status, data, extra) {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (extra) for (const k of Object.keys(extra)) res.setHeader(k, extra[k]);
  res.end(typeof data === 'string' ? data : JSON.stringify(data));
}

const toBuf = (chunk, enc) => Buffer.isBuffer(chunk) ? chunk
  : chunk instanceof Uint8Array ? Buffer.from(chunk)
  : Buffer.from(String(chunk), typeof enc === 'string' ? enc : 'utf8');

/* true — javob shu yerning o'zida yuborildi (takroriy so'rov). */
export async function opGuard(req, res) {
  const raw = req.headers?.['x-op-id'];
  if (!raw || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return false;
  const op = String(raw).trim();
  if (!OP_RE.test(op)) return false;
  const user = userOf(req);
  if (!user) return false;
  const path = String(req.url || '').split('?', 1)[0].slice(0, 200);

  try { await ensureOpsSchema(); }
  catch (e) { console.error('CLIENT OPS SCHEMA:', e.message); return false; }

  let ins;
  try {
    ins = await pool.query(`INSERT INTO client_ops(op_id, user_key, method, path) VALUES($1, $2, $3, $4)
      ON CONFLICT (op_id) DO NOTHING RETURNING op_id`, [op, user, req.method, path]);
  } catch (e) { console.error('CLIENT OPS:', e.message); return false; }

  if (!ins.rowCount) {
    let row = null;
    try {
      const r = await pool.query(`SELECT user_key, status, body, path,
          created_at < now() - interval '90 seconds' AS stale FROM client_ops WHERE op_id = $1`, [op]);
      row = r.rows[0] || null;
    } catch (e) { console.error('CLIENT OPS READ:', e.message); return false; }
    if (row && row.user_key !== user) { sendJson(res, 409, { error: 'Amal raqami band' }); return true; }
    if (row && row.status > 0) {
      sendJson(res, row.status, row.body || '{}', { 'X-Op-Replay': '1' });
      return true;
    }
    if (row && !row.stale) {
      sendJson(res, 409, { error: 'Bu amal hozir bajarilmoqda — biroz kuting', inProgress: true });
      return true;
    }
    /* «osilib» qolgan (yoki o'chirilgan) — qaytadan bajaramiz */
    try {
      await pool.query(`INSERT INTO client_ops(op_id, user_key, method, path) VALUES($1, $2, $3, $4)
        ON CONFLICT (op_id) DO UPDATE SET created_at = now(), status = 0, body = NULL`, [op, user, req.method, path]);
    } catch (e) { console.error('CLIENT OPS RETAKE:', e.message); }
  }

  /* Javobni ushlab qolamiz: avval saqlanadi, keyin yuboriladi (Vercel'da
     javob ketgach funksiya to'xtatilishi mumkin) */
  const chunks = [];
  const origWrite = res.write;
  const origEnd = res.end;
  res.write = function write(chunk, enc, cb) {
    if (chunk && typeof chunk !== 'function') chunks.push(toBuf(chunk, enc));
    return origWrite.apply(this, arguments);
  };
  let ending = false;
  res.end = function end(chunk, enc, cb) {
    if (ending) return this;
    ending = true;
    const args = arguments;
    if (chunk && typeof chunk !== 'function') chunks.push(toBuf(chunk, enc));
    const status = res.statusCode || 200;
    const keep = status >= 200 && status < 400;
    const body = keep ? Buffer.concat(chunks).toString('utf8') : null;
    const p = keep
      ? pool.query(`UPDATE client_ops SET status = $2, body = $3, done_at = now() WHERE op_id = $1`, [op, status, body])
      : pool.query(`DELETE FROM client_ops WHERE op_id = $1 AND status = 0`, [op]);
    p.catch(e => console.error('CLIENT OPS SAVE:', e.message))
      .finally(() => { origEnd.apply(res, args); });
    return this;
  };

  /* Eski yozuvlar (14 kundan oldingi) vaqti-vaqti bilan tozalanadi */
  if (Math.random() < 0.02) {
    pool.query(`DELETE FROM client_ops WHERE created_at < now() - interval '14 days'`).catch(() => {});
  }
  return false;
}
