/* ============================================================================
   KUTISH REJIMI (NAVBAT) — SERVERDA

   Ilgari navbat har kompyuterning brauzerida (localStorage) saqlanardi:
   bir kompyuterda qo'yilgan navbat ikkinchisida ko'rinmasdi. Endi navbat
   bazada — hamma kompyuterda bir xil.

     GET    /api/queue                  kutayotganlar (qo'yilgan tartibda)
     POST   /api/queue                  { data, waiting_for }  — qo'shish
     DELETE /api/queue/:id              navbatdan chiqarish
     POST   /api/queue/:id/claim        boshlashni «band qilish» — ikki
                                        kompyuter bir mijozni ikki marta
                                        boshlab yubormasin (2 daqiqa)
     POST   /api/queue/:id/release      boshlanmadi — bandlik bekor
     POST   /api/queue/:id/done         { session_id } — boshlandi, navbatdan
                                        chiqadi

   `waiting_for` — navbatga qo'yilgan paytda shu mashinada ichkarida
   bo'lgan yozuv. U yopilgach (mashina bo'shagach) navbatdagi birinchisi
   o'zi boshlanadi (sahifada Queue.checkAuto).
   ========================================================================== */

import jwt from 'jsonwebtoken';
import { pool } from '../backend/src/db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';

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
    req.on('data', c => { s += c; if (s.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

let schemaP = null;
export function ensureQueueSchema() {
  if (schemaP) return schemaP;
  schemaP = (async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS waiting_queue(
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id TEXT NOT NULL,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      waiting_for TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      claimed_at TIMESTAMPTZ,
      removed_at TIMESTAMPTZ,
      remove_reason TEXT,
      session_id TEXT)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_waiting_queue_open ON waiting_queue(user_id, created_at) WHERE removed_at IS NULL`);
  })().catch(e => { schemaP = null; throw e; });
  return schemaP;
}

const ROW = `id, data, waiting_for, created_at, claimed_at`;
const isId = v => /^[0-9a-f-]{36}$/i.test(String(v || ''));

export async function handleQueueRequest(req, res) {
  const path = String(req.url || '').split('?', 1)[0];
  if (path !== '/api/queue' && !path.startsWith('/api/queue/')) return false;
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return true; }
  const user = auth(req);
  if (!user) { json(res, 401, { error: 'Kirish talab qilinadi' }); return true; }
  try {
    await ensureQueueSchema();
    const rest = path.slice('/api/queue'.length).split('/').filter(Boolean);
    const id = rest[0] ? decodeURIComponent(rest[0]) : '';
    const act = rest[1] || '';
    if (id && !isId(id)) { json(res, 404, { error: 'Navbat elementi topilmadi' }); return true; }

    if (!id && req.method === 'GET') {
      /* waiting_status — oldingi mashina holati (active/frozen/completed):
         sahifa shunga qarab navbatdagini o'zi boshlaydi */
      const r = await pool.query(`SELECT q.id, q.data, q.waiting_for, q.created_at, q.claimed_at, s.status AS waiting_status,
                s.finished_at AS waiting_finished_at
          FROM waiting_queue q LEFT JOIN sessions s ON s.id::text = q.waiting_for
         WHERE q.user_id = $1 AND q.removed_at IS NULL
         ORDER BY q.created_at, q.id LIMIT 500`, [user]);
      json(res, 200, { rows: r.rows }); return true;
    }
    if (!id && req.method === 'POST') {
      const b = await readBody(req);
      const data = b && typeof b.data === 'object' && b.data ? b.data : null;
      if (!data) { json(res, 400, { error: 'Navbat ma’lumoti yo‘q' }); return true; }
      if (JSON.stringify(data).length > 8000) { json(res, 400, { error: 'Navbat ma’lumoti juda katta' }); return true; }
      const wf = b.waiting_for ? String(b.waiting_for).slice(0, 64) : null;
      const r = await pool.query(`INSERT INTO waiting_queue(user_id, data, waiting_for) VALUES($1, $2, $3) RETURNING ${ROW}`,
        [user, JSON.stringify(data), wf]);
      json(res, 201, { row: r.rows[0] }); return true;
    }
    if (id && !act && req.method === 'DELETE') {
      const r = await pool.query(`UPDATE waiting_queue SET removed_at = now(), remove_reason = 'removed'
        WHERE id = $1 AND user_id = $2 AND removed_at IS NULL RETURNING id`, [id, user]);
      json(res, 200, { ok: true, removed: r.rowCount }); return true;
    }
    if (id && act === 'claim' && req.method === 'POST') {
      const r = await pool.query(`UPDATE waiting_queue SET claimed_at = now()
        WHERE id = $1 AND user_id = $2 AND removed_at IS NULL
          AND (claimed_at IS NULL OR claimed_at < now() - interval '2 minutes')
        RETURNING ${ROW}`, [id, user]);
      if (!r.rows[0]) { json(res, 409, { error: 'Bu navbatdagi allaqachon boshlangan yoki boshlanmoqda' }); return true; }
      json(res, 200, { ok: true, row: r.rows[0] }); return true;
    }
    if (id && act === 'release' && req.method === 'POST') {
      await pool.query(`UPDATE waiting_queue SET claimed_at = NULL WHERE id = $1 AND user_id = $2 AND removed_at IS NULL`, [id, user]);
      json(res, 200, { ok: true }); return true;
    }
    if (id && act === 'done' && req.method === 'POST') {
      const b = await readBody(req);
      await pool.query(`UPDATE waiting_queue SET removed_at = now(), remove_reason = 'started', session_id = $3
        WHERE id = $1 AND user_id = $2 AND removed_at IS NULL`, [id, user, b.session_id ? String(b.session_id).slice(0, 64) : null]);
      json(res, 200, { ok: true }); return true;
    }
    json(res, 405, { error: 'Method ruxsat etilmagan' }); return true;
  } catch (e) {
    console.error('QUEUE ERROR:', e);
    json(res, 500, { error: e.message || 'Navbat bo‘yicha xatolik' });
    return true;
  }
}
