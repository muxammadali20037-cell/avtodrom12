/* ============================================================================
   AVTODROMGA KIRISH MUDDATI (guruh bo'yicha) VA SHAXSIY MUHLAT

   Har bir guruhga avtodromga qachondan qachongacha kelishi mumkinligi
   belgilanadi (school_groups.access_from / access_until). Muddat
   tugagach shu guruh o'quvchisiga davomat ham, QR chek ham yozilmaydi.

   Biror o'quvchi sababli kelolmagan bo'lsa — faqat O'SHA BIR KISHIGA
   muhlat beriladi (students.access_until). Sababsiz berilmaydi va har
   bir muhlat o'zgartirishlar jurnaliga (change_log) tushadi.

   Muddat qo'yilmagan guruh — cheklanmagan (avvalgidek ishlaydi).

   Yo'llar (operator tokeni bilan):
     GET  /api/access/status?studentId=   — o'quvchi kira oladimi
     POST /api/access/extend              — { studentId, until|null, reason }
     PUT  /api/access/group               — { groupIds:[..], from, until }
     GET  /api/access/groups              — barcha guruhlar va muddatlari
     GET  /api/access/extensions          — berilgan shaxsiy muhlatlar
   ========================================================================== */

import jwt from 'jsonwebtoken';
import { pool } from '../backend/src/db.js';
import { logChange, reasonError } from './audit-routes.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
const TODAY_SQL = `to_char((now() AT TIME ZONE 'Asia/Tashkent')::date,'YYYY-MM-DD')`;

const text = v => String(v === null || v === undefined ? '' : v).trim();
const isDay = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !isNaN(Date.parse(v + 'T00:00:00Z'));
const fmt = d => (d ? d.slice(8, 10) + '.' + d.slice(5, 7) + '.' + d.slice(0, 4) : '');
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const groupLabel = n => { const s = text(n); return !s ? 'Guruh' : (/guruh/i.test(s) ? s : s + '-guruh'); };

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
    /* Admin paneli tokeni (sub='admin') emas — operator tokeni kerak:
       ma'lumot shu akkauntniki (boshqa modullar ham sub ni owner_key qiladi) */
    return p && p.sub && String(p.sub) !== 'admin' ? String(p.sub) : null;
  } catch { return null; }
}
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  return await new Promise(resolve => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

/* ---------- ustunlar ----------
   Ustun bor bo'lsa ALTER umuman chaqirilmaydi (jadval qulflanmasin).
   Har so'rovdan OLDIN (index.js) chaqiriladi — tranzaksiya ichida emas. */
let schemaP = null;
export function ensureAccessSchema() {
  if (schemaP) return schemaP;
  schemaP = (async () => {
    const r = await pool.query(`SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema='public' AND (
        (table_name='school_groups' AND column_name IN ('access_from','access_until')) OR
        (table_name='students' AND column_name IN ('access_until','access_reason','access_set_at')))`);
    const have = new Set(r.rows.map(x => x.table_name + '.' + x.column_name));
    const need = [
      ['school_groups.access_from', 'ALTER TABLE school_groups ADD COLUMN IF NOT EXISTS access_from DATE'],
      ['school_groups.access_until', 'ALTER TABLE school_groups ADD COLUMN IF NOT EXISTS access_until DATE'],
      ['students.access_until', 'ALTER TABLE students ADD COLUMN IF NOT EXISTS access_until DATE'],
      ['students.access_reason', 'ALTER TABLE students ADD COLUMN IF NOT EXISTS access_reason TEXT'],
      ['students.access_set_at', 'ALTER TABLE students ADD COLUMN IF NOT EXISTS access_set_at TIMESTAMPTZ'],
    ];
    for (const [k, sql] of need) if (!have.has(k)) await pool.query(sql);
  })().catch(e => { schemaP = null; throw e; });
  return schemaP;
}

/* ---------- holat ---------- */
function evaluate(x) {
  const today = x.today;
  const out = {
    ok: true, limited: false, today,
    studentId: x.id, studentName: x.full_name,
    groupId: x.gid || null, group: x.gname || '',
    from: x.g_from || null, until: x.g_until || null,
    ext: x.ext_until ? { until: x.ext_until, reason: x.ext_reason || '', at: x.ext_at || null } : null,
  };
  if (!x.gid || (!x.g_from && !x.g_until)) { out.state = 'none'; return out; }
  out.limited = true;
  const gl = groupLabel(x.gname);
  if (x.g_from && today < x.g_from) {
    out.ok = false; out.state = 'notStarted';
    out.error = `${gl} avtodromga ${fmt(x.g_from)} dan kira oladi — hozircha davomat va chek yozilmaydi`;
    return out;
  }
  if (x.g_until) {
    const byExt = !!(x.ext_until && x.ext_until > x.g_until);
    const eff = byExt ? x.ext_until : x.g_until;
    out.effectiveUntil = eff; out.byExtension = byExt;
    out.daysLeft = daysBetween(today, eff);
    if (today > eff) {
      out.ok = false; out.state = 'expired';
      out.error = byExt
        ? `Shaxsiy muhlat ${fmt(eff)} da tugagan — davomat va chek yozilmaydi`
        : `${gl}ning avtodromga kirish muddati ${fmt(x.g_until)} da tugagan — davomat va chek yozilmaydi`;
      return out;
    }
    out.state = out.daysLeft <= 3 ? 'soon' : 'ok';
    return out;
  }
  out.state = 'ok';
  return out;
}

async function rowOf(db, user, studentId) {
  const r = await (db || pool).query(
    `SELECT st.id, st.full_name, to_char(st.access_until,'YYYY-MM-DD') ext_until, st.access_reason ext_reason,
            st.access_set_at ext_at, g.id gid, g.name gname,
            to_char(g.access_from,'YYYY-MM-DD') g_from, to_char(g.access_until,'YYYY-MM-DD') g_until,
            ${TODAY_SQL} today
       FROM students st LEFT JOIN school_groups g ON g.id::text = st.group_id::text
      WHERE st.id::text=$1 AND st.owner_key=$2`, [String(studentId), String(user)]);
  return r.rows[0] || null;
}

/* Davomat / QR chekdan oldin chaqiriladi. Hech qachon DDL qilmaydi va
   o'zi xato bersa ishni to'xtatmaydi (ustunlar hali yo'q bo'lsa — cheklov yo'q). */
export async function accessCheck(user, studentId) {
  try {
    const x = await rowOf(null, user, studentId);
    if (!x) return { ok: true, limited: false };
    return evaluate(x);
  } catch (e) {
    console.error('[access] tekshiruv:', e.message);
    return { ok: true, limited: false };
  }
}

/* ---------- muhlat ---------- */
async function extend(req, res, user) {
  const b = await readBody(req);
  const studentId = text(b.studentId || b.student_id);
  const until = b.until === null || b.until === '' || b.until === undefined ? null : text(b.until);
  const reason = text(b.reason);
  if (!studentId) return json(res, 400, { error: "O'quvchi tanlanmagan" });
  const x = await rowOf(null, user, studentId);
  if (!x) return json(res, 404, { error: "O'quvchi topilmadi" });

  if (until !== null) {
    if (!isDay(until)) return json(res, 400, { error: "Sanani to'g'ri kiriting" });
    const bad = reasonError(reason);
    if (bad) return json(res, 400, { error: bad, needReason: true });
    if (!x.gid || !x.g_until) return json(res, 400, { error: "Bu o'quvchining guruhiga muddat qo'yilmagan — muhlat kerak emas" });
    if (until <= x.g_until) return json(res, 400, { error: `Muhlat guruh muddatidan (${fmt(x.g_until)}) keyingi sana bo'lishi kerak` });
    if (until < x.today) return json(res, 400, { error: "O'tib ketgan sana — bugundan keyingi sanani tanlang" });
    if (daysBetween(x.today, until) > 366) return json(res, 400, { error: "Muhlat bir yildan oshmasin" });
  }

  await pool.query(
    `UPDATE students SET access_until=$1::date, access_reason=$2, access_set_at=${until ? 'now()' : 'NULL'}
      WHERE id::text=$3 AND owner_key=$4`,
    [until, until ? reason : null, String(studentId), user]);
  await logChange(null, user, {
    entity: 'student', entityId: x.id, entityName: x.full_name,
    action: until ? 'access_extend' : 'access_extend_cancel', field: 'access_until',
    oldValue: x.ext_until ? fmt(x.ext_until) : null, newValue: until ? fmt(until) : null,
    reason: until ? reason : (reason || 'Muhlat bekor qilindi'),
  });
  return json(res, 200, evaluate(await rowOf(null, user, studentId)));
}

/* ---------- guruh muddati ---------- */
async function setGroup(req, res, user) {
  const b = await readBody(req);
  const ids = (Array.isArray(b.groupIds) ? b.groupIds : [b.groupId || b.group_id]).map(text).filter(Boolean);
  const from = text(b.from) || null, until = text(b.until) || null;
  if (!ids.length) return json(res, 400, { error: 'Guruh tanlanmagan' });
  if (ids.length > 300) return json(res, 400, { error: "Bir martada ko'pi bilan 300 ta guruh" });
  if (from && !isDay(from)) return json(res, 400, { error: "Boshlanish sanasi noto'g'ri" });
  if (until && !isDay(until)) return json(res, 400, { error: "Tugash sanasi noto'g'ri" });
  if (from && until && from > until) return json(res, 400, { error: "Boshlanish sanasi tugash sanasidan keyin bo'lmasin" });

  const old = await pool.query(
    `SELECT g.id, g.name, s.name school_name, to_char(g.access_from,'YYYY-MM-DD') f, to_char(g.access_until,'YYYY-MM-DD') u
       FROM school_groups g LEFT JOIN driving_schools s ON s.id=g.school_id
      WHERE g.id::text = ANY($1::text[]) AND g.owner_key=$2`, [ids, user]);
  if (!old.rows.length) return json(res, 404, { error: 'Guruh topilmadi' });
  await pool.query(
    `UPDATE school_groups SET access_from=$1::date, access_until=$2::date
      WHERE id::text = ANY($3::text[]) AND owner_key=$4`, [from, until, old.rows.map(x => String(x.id)), user]);
  const show = (f, u) => (f || u) ? (f ? fmt(f) : '…') + ' — ' + (u ? fmt(u) : '…') : 'cheklanmagan';
  for (const g of old.rows) {
    if ((g.f || null) === from && (g.u || null) === until) continue;
    await logChange(null, user, {
      entity: 'group', entityId: g.id, entityName: (g.school_name ? g.school_name + ' — ' : '') + g.name,
      action: 'access_period', field: 'access', oldValue: show(g.f, g.u), newValue: show(from, until),
      reason: text(b.reason) || 'Kirish muddati belgilandi',
    });
  }
  return json(res, 200, { ok: true, updated: old.rows.length, from, until });
}

async function listGroups(req, res, user) {
  const r = await pool.query(`
    SELECT g.id, g.name, g.school_id, s.name school_name,
           to_char(g.access_from,'YYYY-MM-DD') access_from, to_char(g.access_until,'YYYY-MM-DD') access_until,
           (SELECT COUNT(*)::int FROM students st WHERE st.group_id=g.id AND st.active IS NOT FALSE) students,
           (SELECT COUNT(*)::int FROM students st WHERE st.group_id=g.id AND st.active IS NOT FALSE
               AND st.access_until IS NOT NULL AND g.access_until IS NOT NULL AND st.access_until > g.access_until) extended
      FROM school_groups g JOIN driving_schools s ON s.id=g.school_id
     WHERE g.owner_key=$1 AND g.active IS NOT FALSE AND s.active IS NOT FALSE
     ORDER BY s.name, length(g.name), g.name`, [user]);
  const t = await pool.query(`SELECT ${TODAY_SQL} today`);
  return json(res, 200, { today: t.rows[0].today, rows: r.rows });
}

async function listExtensions(req, res, user) {
  const r = await pool.query(`
    SELECT st.id, st.full_name, st.group_id, g.name group_name, s.name school_name,
           to_char(st.access_until,'YYYY-MM-DD') until, st.access_reason reason, st.access_set_at set_at,
           to_char(g.access_until,'YYYY-MM-DD') group_until
      FROM students st
      LEFT JOIN school_groups g ON g.id=st.group_id
      LEFT JOIN driving_schools s ON s.id=st.school_id
     WHERE st.owner_key=$1 AND st.active IS NOT FALSE AND st.access_until IS NOT NULL
     ORDER BY st.access_until DESC, st.full_name
     LIMIT 1000`, [user]);
  const t = await pool.query(`SELECT ${TODAY_SQL} today`);
  return json(res, 200, { today: t.rows[0].today, rows: r.rows });
}

export async function handleAccessRequest(req, res) {
  const path = String(req.url || '').split('?', 1)[0];
  if (!path.startsWith('/api/access/')) return false;
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return true; }
  const user = auth(req);
  if (!user) { json(res, 401, { error: 'Kirish talab qilinadi' }); return true; }
  try {
    await ensureAccessSchema();
    if (path === '/api/access/status' && req.method === 'GET') {
      const id = text(new URL(req.url, 'http://localhost').searchParams.get('studentId'));
      if (!id) { json(res, 400, { error: "O'quvchi ID kerak" }); return true; }
      json(res, 200, await accessCheck(user, id)); return true;
    }
    if (path === '/api/access/extend' && req.method === 'POST') { await extend(req, res, user); return true; }
    if (path === '/api/access/group' && (req.method === 'PUT' || req.method === 'POST')) { await setGroup(req, res, user); return true; }
    if (path === '/api/access/groups' && req.method === 'GET') { await listGroups(req, res, user); return true; }
    if (path === '/api/access/extensions' && req.method === 'GET') { await listExtensions(req, res, user); return true; }
    json(res, 404, { error: 'Topilmadi' }); return true;
  } catch (e) {
    console.error('ACCESS ERROR:', e);
    json(res, 500, { error: e.message || 'Muddat bo‘yicha xatolik' });
    return true;
  }
}
