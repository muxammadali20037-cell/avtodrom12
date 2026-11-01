/* ============================================================================
   JARAYONDAGILARNI TOZALASH (Maxsus bo'lim)

   Eski, yopilmay qolib ketgan («Jarayonda» turib qolgan) yozuvlarni bir
   bosishda to'xtatish va ro'yxatdan olib tashlash.

     GET  /api/cleanup/preview   — nima bo'lishini oldindan ko'rsatadi
     POST /api/cleanup/run       { mode: 'safe'|'all', queue: bool, reason }
     POST /api/cleanup/undo      — oxirgi tozalashni qaytarish (24 soat ichida)

   PUL YO'QOLMASIN (mode = 'safe', standart):
     • pul olinmagan yozuv — O'CHIRILADI (status 'cancelled': hamma
       ro'yxat va hisobotdan chiqadi, bazada iz qoladi);
     • oldindan pul olingan yozuv — o'chirilmaydi, YOPILADI: pul o'z
       kunining hisobotida qoladi, qarz yozilmaydi.
   mode = 'all' — hammasi o'chiriladi (pul ham hisobotdan chiqadi).
   Kutish rejimidagilar ham olib tashlanadi (aks holda bo'shagan mashinaga
   o'zi ochilib ketardi).

   Har bir tozalash jurnalga va `session_cleanups` ga yoziladi — 24 soat
   ichida «Qaytarish» bilan avvalgi holatiga qaytadi.
   ========================================================================== */

import jwt from 'jsonwebtoken';
import { pool } from '../backend/src/db.js';
import { runOnce } from '../backend/src/schema-once.js';
import { maxsusOk, lockedResponse } from './lock-routes.js';
import { logChange } from './audit-routes.js';
import { tgNotify } from './telegram.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
const text = v => String(v === null || v === undefined ? '' : v).trim();

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
function ensureSchema() {
  if (schemaP) return schemaP;
  schemaP = runOnce('session-cleanups-v1', async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS session_cleanups(
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      mode TEXT, reason TEXT,
      items JSONB NOT NULL DEFAULT '[]'::jsonb,
      queue JSONB NOT NULL DEFAULT '[]'::jsonb,
      undone_at TIMESTAMPTZ)`);
  }).catch(e => { schemaP = null; throw e; });
  return schemaP;
}

const OPEN = `('active','frozen','paused')`;
async function openRows(db, user, lock) {
  const r = await db.query(`SELECT s.id, s.status, s.started_at, s.finished_at, s.duration_seconds, s.auto_close,
      COALESCE(s.target_duration, 0) AS target_duration, s.resumed_at, s.frozen_at,
      COALESCE(s.cash_amount, 0)::float8 AS cash, COALESCE(s.terminal_amount, 0)::float8 AS terminal,
      COALESCE(s.click_amount, 0)::float8 AS click, COALESCE(s.amount, 0)::float8 AS amount,
      COALESCE(s.planned_amount, 0)::float8 AS planned, s.post, s.correction_note, s.corrected_at,
      s.student_id, COALESCE(v.plate, s.driver_name, '—') AS plate, st.full_name AS student
    FROM sessions s LEFT JOIN vehicles v ON v.id = s.vehicle_id
    LEFT JOIN students st ON st.id::text = s.student_id::text
    WHERE s.user_id::text = $1 AND s.status IN ${OPEN}
    ORDER BY s.started_at${lock ? ' FOR UPDATE OF s' : ''}`, [user]);
  return r.rows.map(x => Object.assign(x, { paid: Number(x.cash) + Number(x.terminal) + Number(x.click) }));
}
async function queueRows(db, user, lock) {
  try {
    const r = await db.query(`SELECT id, data, created_at FROM waiting_queue
      WHERE user_id = $1 AND removed_at IS NULL ORDER BY created_at${lock ? ' FOR UPDATE' : ''}`, [user]);
    return r.rows;
  } catch { return []; }
}

async function preview(res, user) {
  const [rows, queue, last] = await Promise.all([
    openRows(pool, user, false), queueRows(pool, user, false),
    pool.query(`SELECT id, created_at, mode, jsonb_array_length(items) AS n, jsonb_array_length(queue) AS q
      FROM session_cleanups WHERE user_id = $1 AND undone_at IS NULL AND created_at > now() - interval '24 hours'
      ORDER BY created_at DESC LIMIT 1`, [user])
  ]);
  json(res, 200, {
    sessions: rows.map(x => ({ id: x.id, plate: x.plate, student: x.student, status: x.status, started_at: x.started_at,
      paid: x.paid, cash: x.cash, terminal: x.terminal, click: x.click, planned: x.planned, post: x.post, target: x.target_duration })),
    queue: queue.map(q => ({ id: q.id, label: (q.data && (q.data.label || q.data.plate || q.data.studentName)) || '—',
      startAt: q.data && q.data.startAt, prepay: q.data && q.data.prepay ? Number(q.data.prepay.amount) || 0 : 0, created_at: q.created_at })),
    last: last.rows[0] || null
  });
}

/* Bitta hisob uchun tozalash (sahifadagi tugma ham, bir martalik umumiy
   tozalash ham shuni ishlatadi). Bir vaqtda ikkita tozalash bo'lmasin —
   hisob bo'yicha qulf. */
export async function cleanupUser(user, opts) {
  const mode = opts && opts.mode === 'all' ? 'all' : 'safe';
  const withQueue = !(opts && opts.queue === false);
  const reason = text(opts && opts.reason).slice(0, 200) || 'Jarayondagilar tozalandi';
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SELECT pg_advisory_xact_lock(hashtext('avtodrom-cleanup:' || $1))`, [String(user)]);
    const rows = await openRows(c, user, true);
    const queue = withQueue ? await queueRows(c, user, true) : [];
    if (!rows.length && !queue.length) { await c.query('ROLLBACK'); return { empty: true, removed: 0, closed: 0, queue: 0, keptMoney: 0, lostMoney: 0 }; }
    const items = [];
    let removed = 0, closed = 0, keptMoney = 0, lostMoney = 0;
    const now = new Date();
    for (const x of rows) {
      const prev = { id: x.id, status: x.status, finished_at: x.finished_at, duration_seconds: x.duration_seconds,
        auto_close: x.auto_close, correction_note: x.correction_note, corrected_at: x.corrected_at, frozen_at: x.frozen_at, resumed_at: x.resumed_at };
      if (mode === 'safe' && x.paid > 0) {
        /* pul olingan — yopiladi (pul o'z kunida qoladi, qarz yozilmaydi) */
        const start = new Date(x.started_at).getTime();
        const planEnd = Number(x.target_duration) > 0 ? start + Number(x.target_duration) * 1000 : null;
        const end = new Date(Math.max(start, Math.min(now.getTime(), planEnd || now.getTime())));
        const secs = x.status === 'active' && !x.resumed_at ? Math.round((end.getTime() - start) / 1000) : Number(x.duration_seconds || 0);
        await c.query(`UPDATE sessions SET status = 'completed', finished_at = $2, duration_seconds = $3, auto_close = FALSE,
            frozen_at = NULL, resumed_at = NULL, corrected_at = now(), correction_note = $4 WHERE id = $1`,
          [x.id, end, secs, reason + ' (yopildi)']);
        prev.action = 'closed'; closed++; keptMoney += x.paid;
      } else {
        await c.query(`UPDATE sessions SET status = 'cancelled', finished_at = COALESCE(finished_at, now()), auto_close = FALSE,
            corrected_at = now(), correction_note = $2 WHERE id = $1`, [x.id, reason]);
        prev.action = 'cancelled'; removed++; lostMoney += x.paid;
      }
      items.push(prev);
    }
    for (const q of queue) {
      await c.query(`UPDATE waiting_queue SET removed_at = now(), remove_reason = 'tozalash' WHERE id = $1`, [q.id]);
    }
    const ins = await c.query(`INSERT INTO session_cleanups(user_id, mode, reason, items, queue) VALUES($1, $2, $3, $4::jsonb, $5::jsonb) RETURNING id`,
      [String(user), mode, reason, JSON.stringify(items), JSON.stringify(queue.map(q => q.id))]);
    await c.query('COMMIT');
    const summary = removed + ' ta o‘chirildi' + (closed ? ', ' + closed + ' ta pulli yopildi (' + keptMoney + ' so‘m hisobotda qoldi)' : '')
      + (queue.length ? ', kutish rejimidan ' + queue.length + ' ta' : '') + (lostMoney ? ', hisobotdan chiqqan pul: ' + lostMoney + ' so‘m' : '');
    await logChange(null, user, { entity: 'session', entityId: ins.rows[0].id, entityName: 'Jarayondagilar', action: 'cleanup',
      field: mode, newValue: summary, reason });
    await tgNotify(user, 'fix', '🧹 <b>JARAYONDAGILAR TOZALANDI</b>\n' + summary.replace(/[<>&]/g, '') + '\nSabab: ' + reason.replace(/[<>&]/g, ''));
    return { ok: true, id: ins.rows[0].id, removed, closed, queue: queue.length, keptMoney, lostMoney };
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch { /* noop */ }
    throw e;
  } finally { c.release(); }
}

async function run(req, res, user) {
  const b = await readBody(req);
  const r = await cleanupUser(user, { mode: text(b.mode), queue: b.queue !== false, reason: text(b.reason) });
  if (r.empty) return json(res, 409, { error: 'Jarayonda hech narsa yo‘q' });
  json(res, 200, r);
}

/* BIR MARTALIK (2026-11-01, rahbar so'rovi): boshliq panelida «jarayonda»
   turib qolgan hamma yozuvlar yopiladi — boshliq paneli ko'radigan hamma
   hisoblar (ANALYTICS_OWNER_KEYS berilgan bo'lsa — faqat o'shalar).
   Xavfsiz usul: pulsizlari o'chiriladi, pullilari yopiladi (pul hisobotda
   qoladi), kutish rejimidagilar olib tashlanadi. Har hisob o'zining
   «Tozalash» oynasida 24 soat ichida «Qaytarish» qila oladi. */
let onceP = null;
export function cleanupAllOnce() {
  if (onceP) return onceP;
  onceP = (async () => {
    await ensureSchema();
    return runOnce('cleanup-open-all-2026-11-01', async () => {
      const keys = String(process.env.ANALYTICS_OWNER_KEYS || '').split(',').map(x => x.trim()).filter(Boolean);
      const r = await pool.query(`SELECT DISTINCT user_id::text AS u FROM sessions WHERE status IN ${OPEN}
        ${keys.length ? 'AND user_id::text = ANY($1::text[])' : ''}`, keys.length ? [keys] : []);
      for (const x of r.rows) {
        const out = await cleanupUser(x.u, { mode: 'safe', queue: true,
          reason: 'Boshliq paneli: jarayonda qolib ketganlar yopildi (rahbar so‘rovi, 01.11.2026)' });
        console.log('CLEANUP ONCE:', x.u, JSON.stringify(out));
      }
    });
  })().catch(e => { onceP = null; console.error('CLEANUP ONCE:', e.message); });
  return onceP;
}

async function undo(res, user) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await c.query(`SELECT * FROM session_cleanups WHERE user_id = $1 AND undone_at IS NULL
      AND created_at > now() - interval '24 hours' ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [user]);
    const b = r.rows[0];
    if (!b) { await c.query('ROLLBACK'); return json(res, 409, { error: 'Qaytariladigan tozalash yo‘q (24 soatdan oshgan yoki qaytarilgan)' }); }
    let restored = 0, skipped = 0;
    for (const it of b.items || []) {
      /* faqat biz qo'ygan holatda turgan bo'lsa qaytaramiz (orada o'zgartirilmagan) */
      const want = it.action === 'closed' ? 'completed' : 'cancelled';
      const u = await c.query(`UPDATE sessions SET status = $2, finished_at = $3, duration_seconds = $4, auto_close = $5,
          correction_note = $6, corrected_at = $7, frozen_at = $8, resumed_at = $9
        WHERE id = $1 AND user_id::text = $10 AND status = $11 RETURNING id`,
        [it.id, it.status, it.finished_at, it.duration_seconds, it.auto_close, it.correction_note, it.corrected_at,
          it.frozen_at, it.resumed_at, user, want]);
      if (u.rowCount) restored++; else skipped++;
    }
    let q = 0;
    for (const id of b.queue || []) {
      const u = await c.query(`UPDATE waiting_queue SET removed_at = NULL, remove_reason = NULL
        WHERE id = $1 AND user_id = $2 AND remove_reason = 'tozalash' RETURNING id`, [id, user]).catch(() => ({ rowCount: 0 }));
      q += u.rowCount;
    }
    await c.query(`UPDATE session_cleanups SET undone_at = now() WHERE id = $1`, [b.id]);
    await c.query('COMMIT');
    await logChange(null, user, { entity: 'session', entityId: b.id, entityName: 'Jarayondagilar', action: 'cleanup_undo',
      newValue: restored + ' ta qaytarildi' + (skipped ? ', ' + skipped + ' tasi orada o‘zgargani uchun qaytarilmadi' : '') + (q ? ', kutish rejimiga ' + q + ' ta' : ''),
      reason: 'Tozalash bekor qilindi' });
    json(res, 200, { ok: true, restored, skipped, queue: q });
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch { /* noop */ }
    throw e;
  } finally { c.release(); }
}

export async function handleCleanupRequest(req, res) {
  const path = String(req.url || '').split('?', 1)[0];
  if (!path.startsWith('/api/cleanup/')) return false;
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return true; }
  const user = auth(req);
  if (!user) { json(res, 401, { error: 'Kirish talab qilinadi' }); return true; }
  if (!maxsusOk(req, user)) { lockedResponse(res); return true; }
  try {
    await ensureSchema();
    if (path === '/api/cleanup/preview' && req.method === 'GET') { await preview(res, user); return true; }
    if (path === '/api/cleanup/run' && req.method === 'POST') { await run(req, res, user); return true; }
    if (path === '/api/cleanup/undo' && req.method === 'POST') { await undo(res, user); return true; }
    json(res, 404, { error: 'Topilmadi' });
    return true;
  } catch (e) {
    console.error('CLEANUP ERROR:', e);
    json(res, 500, { error: e.message || 'Tozalashda xatolik' });
    return true;
  }
}
