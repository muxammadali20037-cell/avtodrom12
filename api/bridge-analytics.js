/**
 * ANALITIKA KO'PRIGI — Avtodrom serveri uchun (mashina-mashina)
 *
 * IKKI LOYIHA, BITTA PANEL:
 *   • avtodrom12 (shu repo) — avtodrom maydonidagi sessiyalar, avtoshkolalar,
 *     QR cheklar, turniket va o'zgartirishlar jurnali.
 *   • Avtodrom — admin panelidagi «Analitika» sahifasi shu manzilga server
 *     tomonidan murojaat qiladi va ikkala loyiha ma'lumotini birlashtiradi.
 *
 *   GET /api/bridge/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD&bucket=hour|day|month
 *   Sarlavha: X-Receipt-Key: <RECEIPT_SHARED_KEY>
 *
 * Kalit QR chek ko'prigi bilan BIR XIL (RECEIPT_SHARED_KEY) — yangi sozlama
 * kerak emas. Faqat O'QIYDI, hech narsa yozmaydi.
 *
 * Kunlar Toshkent vaqti bilan (UTC+5). Har bo'lim alohida so'rov: biror
 * jadval/ustun hali yo'q bo'lsa (masalan, turniket ishlatilmagan), o'sha
 * bo'lim bo'sh qaytadi va `warnings` ga yoziladi — qolgani ishlayveradi.
 *
 * IXTIYORIY: ANALYTICS_OWNER_KEYS="uuid1,uuid2" — faqat shu hisob(lar)
 * ma'lumoti. Berilmasa — butun avtodrom (hamma operatorlar) hisoblanadi.
 */
import crypto from 'node:crypto';
import { pool } from '../backend/src/db.js';

const TZ = 'Asia/Tashkent';
const TZ_OFFSET_MS = 5 * 3600e3;               // O'zbekistonda yozgi vaqt yo'q
const MAX_DAYS = 3 * 366;
const FMT = { hour: 'HH24:00', day: 'YYYY-MM-DD', month: 'YYYY-MM' };

function send(res, status, data) {
  if (res.headersSent) return true;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
  return true;
}

/** Maxfiy kalitni vaqt-xavfsiz solishtiradi (receipt-routes.js bilan bir xil qoida). */
export function checkBridgeKey(req) {
  const key = String(process.env.RECEIPT_SHARED_KEY || '');
  if (!key) return false;
  const given = String(req.headers?.['x-receipt-key'] || '');
  if (given.length !== key.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(key)); }
  catch { return false; }
}

const owners = () => String(process.env.ANALYTICS_OWNER_KEYS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

const realYmd = (v) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};
const todayTk = () => new Date(Date.now() + TZ_OFFSET_MS).toISOString().slice(0, 10);
const startOfTk = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d) - TZ_OFFSET_MS); };

/** So'rovdan davr: ikkala kun ham KIRADI. Xato bo'lsa {error}. */
export function bridgeRange(search) {
  let a = String(search.get('from') || ''), b = String(search.get('to') || '');
  if (!a && !b) { a = todayTk(); b = a; }
  if (!realYmd(a) || !realYmd(b)) return { error: 'Sana formati: YYYY-MM-DD' };
  if (a > b) [a, b] = [b, a];
  const from = startOfTk(a);
  const to = new Date(startOfTk(b).getTime() + 864e5);
  const days = Math.round((to.getTime() - from.getTime()) / 864e5);
  if (days > MAX_DAYS) return { error: 'Oraliq 3 yildan oshmasin' };
  let bucket = String(search.get('bucket') || '');
  if (!FMT[bucket]) bucket = days <= 1 ? 'hour' : days <= 62 ? 'day' : 'month';
  const prevFrom = new Date(from.getTime() - (to.getTime() - from.getTime()));
  return { fromYmd: a, toYmd: b, from, to, prevFrom, days, bucket };
}

/* ---------------- yordamchilar ---------------- */

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const mins = (sec) => Math.round(n(sec) / 60);
const isSchool = `(s.school_id IS NOT NULL OR s.customer_type = 'school')`;

/**
 * Har so'rov o'z holicha: xato bo'lsa bo'sh natija + ogohlantirish.
 * Bitta yetishmayotgan jadval butun panelni yiqitmasin.
 */
function makeSafe(warnings) {
  return async (name, sql, params = []) => {
    try { return (await pool.query(sql, params)).rows; }
    catch (e) {
      warnings.push({ section: name, error: String(e?.message || e).slice(0, 200) });
      return [];
    }
  };
}

/* ---------------- asosiy hisob ---------------- */

export async function buildBridgeAnalytics(range) {
  const warnings = [];
  const safe = makeSafe(warnings);
  const keys = owners();
  const own = (col, idx) => (keys.length ? ` AND ${col}::text = ANY($${idx}::text[])` : '');
  const withKeys = (arr) => (keys.length ? [...arr, keys] : arr);

  const { from, to, prevFrom, bucket } = range;
  const fmt = FMT[bucket];
  const cur = withKeys([from.toISOString(), to.toISOString()]);
  const prev = withKeys([prevFrom.toISOString(), from.toISOString()]);
  const done = `s.status = 'completed' AND s.started_at >= $1 AND s.started_at < $2${own('s.user_id', 3)}`;
  const tkStart = `(s.started_at AT TIME ZONE '${TZ}')`;

  const totalsSql = `
    SELECT COUNT(*)::int                                     AS sessions,
           COUNT(*) FILTER (WHERE ${isSchool})::int          AS school,
           COALESCE(SUM(s.duration_seconds), 0)::bigint      AS seconds,
           COALESCE(SUM(s.amount), 0)::float8                AS revenue,
           COALESCE(SUM(s.cash_amount), 0)::float8           AS cash,
           COALESCE(SUM(s.terminal_amount), 0)::float8       AS terminal,
           COUNT(DISTINCT s.vehicle_id)::int                 AS vehicles,
           COUNT(DISTINCT s.student_id)::int                 AS students,
           COUNT(DISTINCT s.school_id)::int                  AS schools
      FROM sessions s WHERE ${done}`;

  const today = todayTk();
  const in7 = new Date(startOfTk(today).getTime() + 7 * 864e5 + TZ_OFFSET_MS).toISOString().slice(0, 10);

  const [
    totalsRows, prevRows, seriesRows, hourRows, heatRows, schoolRows, schoolMeta,
    instrRows, operatorRows, liveRows, waitingRows, receiptRows, receiptPrevRows,
    scannerRows, gateRows, studentRows, expiringRows,
    logRows, recentSessions, recentReceipts, recentGate,
  ] = await Promise.all([
    safe('totals', totalsSql, cur),
    safe('previous', totalsSql, prev),
    safe('series', `
      SELECT to_char(${tkStart}, '${fmt}') AS k,
             COUNT(*)::int AS sessions,
             COUNT(*) FILTER (WHERE ${isSchool})::int AS school,
             COALESCE(SUM(s.amount), 0)::float8 AS revenue,
             COALESCE(SUM(s.duration_seconds), 0)::bigint AS seconds
        FROM sessions s WHERE ${done} GROUP BY 1 ORDER BY 1`, cur),
    safe('hours', `
      SELECT EXTRACT(HOUR FROM ${tkStart})::int AS hour, COUNT(*)::int AS sessions
        FROM sessions s WHERE ${done} GROUP BY 1 ORDER BY 1`, cur),
    safe('heatmap', `
      SELECT EXTRACT(DOW FROM ${tkStart})::int AS dow, EXTRACT(HOUR FROM ${tkStart})::int AS hour, COUNT(*)::int AS n
        FROM sessions s WHERE ${done} GROUP BY 1, 2`, cur),
    safe('schools', `
      SELECT ds.id::text AS id, ds.name,
             COUNT(s.id)::int AS sessions,
             COUNT(DISTINCT s.student_id)::int AS students,
             COALESCE(SUM(s.duration_seconds), 0)::bigint AS seconds
        FROM sessions s JOIN driving_schools ds ON ds.id::text = s.school_id::text
       WHERE ${done}
       GROUP BY ds.id, ds.name ORDER BY sessions DESC LIMIT 40`, cur),
    safe('schools_meta', `
      SELECT ds.id::text AS id, ds.name, ds.active,
             NULLIF(to_jsonb(ds)->>'free_visits', '')::int AS free_visits,
             (SELECT COUNT(*) FROM students st WHERE st.school_id = ds.id AND st.active)::int AS active_students,
             (SELECT COUNT(*) FROM school_groups g WHERE g.school_id = ds.id AND g.active)::int AS active_groups
        FROM driving_schools ds WHERE TRUE${own('ds.owner_key', 1)}`, withKeys([])),
    safe('instructors', `
      SELECT COALESCE(NULLIF(i.full_name, ''), NULLIF(s.instructor_name, ''), 'Instruktorsiz') AS name,
             COUNT(*)::int AS sessions,
             COUNT(*) FILTER (WHERE ${isSchool})::int AS school,
             COALESCE(SUM(s.duration_seconds), 0)::bigint AS seconds,
             COALESCE(SUM(s.amount), 0)::float8 AS revenue
        FROM sessions s LEFT JOIN instructors i ON i.id::text = s.instructor_id::text
       WHERE ${done} GROUP BY 1 ORDER BY sessions DESC LIMIT 15`, cur),
    safe('operators', `
      SELECT COALESCE(NULLIF(u.full_name, ''), u.username, 'Operator') AS name,
             COUNT(*)::int AS sessions,
             COALESCE(SUM(s.amount), 0)::float8 AS revenue
        FROM sessions s LEFT JOIN users u ON u.id::text = s.user_id::text
       WHERE ${done} GROUP BY 1 ORDER BY sessions DESC LIMIT 10`, cur),
    safe('live', `
      SELECT s.id::text AS id, s.status, v.plate,
             COALESCE(NULLIF(to_jsonb(s)->>'driver_name', ''), v.driver_name) AS driver,
             st.full_name AS student, ds.name AS school,
             COALESCE(NULLIF(i.full_name, ''), NULLIF(s.instructor_name, '')) AS instructor,
             s.started_at, s.duration_seconds, s.resumed_at, s.frozen_at,
             NULLIF(to_jsonb(s)->>'planned_minutes', '')::int AS planned_minutes,
             ${isSchool} AS is_school
        FROM sessions s
        LEFT JOIN vehicles v         ON v.id = s.vehicle_id
        LEFT JOIN students st        ON st.id::text = s.student_id::text
        LEFT JOIN driving_schools ds ON ds.id::text = s.school_id::text
        LEFT JOIN instructors i      ON i.id::text = s.instructor_id::text
       WHERE s.status IN ('active', 'paused', 'frozen')${own('s.user_id', 1)}
       ORDER BY s.started_at ASC LIMIT 60`, withKeys([])),
    safe('waiting', `SELECT COUNT(*)::int AS n FROM waiting_sessions w WHERE TRUE${own('w.user_id', 1)}`, withKeys([])),
    safe('receipts', `
      SELECT r.status, COUNT(*)::int AS n FROM receipts r
       WHERE r.issued_at >= $1 AND r.issued_at < $2${own('r.user_id', 3)} GROUP BY 1`, cur),
    safe('receipts_prev', `
      SELECT COUNT(*)::int AS n FROM receipts r
       WHERE r.issued_at >= $1 AND r.issued_at < $2${own('r.user_id', 3)}`, prev),
    safe('receipt_scanners', `
      SELECT COALESCE(NULLIF(to_jsonb(r)->>'scanned_by_name', ''), 'Noma’lum') AS name, COUNT(*)::int AS n
        FROM receipts r
       WHERE r.scanned_at >= $1 AND r.scanned_at < $2${own('r.user_id', 3)}
       GROUP BY 1 ORDER BY n DESC LIMIT 12`, cur),
    safe('gate', `
      SELECT COALESCE(e.direction, '-') AS direction, e.result, COUNT(*)::int AS n
        FROM gate_events e
       WHERE e.at >= $1 AND e.at < $2${own('e.user_id', 3)} GROUP BY 1, 2`, cur),
    safe('students', `
      SELECT COUNT(*) FILTER (WHERE st.active)::int AS active,
             COUNT(*) FILTER (WHERE st.created_at >= $1 AND st.created_at < $2)::int AS new_in_period,
             COUNT(*)::int AS total
        FROM students st WHERE TRUE${own('st.owner_key', 3)}`, cur),
    safe('expiring', `
      SELECT COUNT(*)::int AS n FROM students st
       WHERE st.active
         AND NULLIF(to_jsonb(st)->>'access_until', '')::date BETWEEN $1::date AND $2::date${own('st.owner_key', 3)}`,
      withKeys([today, in7])),
    safe('change_log', `
      SELECT c.created_at AS at, c.entity, c.entity_name, c.action, c.field,
             c.old_value, c.new_value, c.reason, c.actor
        FROM change_log c WHERE TRUE${own('c.owner_key', 1)}
       ORDER BY c.created_at DESC LIMIT 40`, withKeys([])),
    safe('recent_sessions', `
      SELECT s.id::text AS id, s.status, s.started_at, s.finished_at, s.amount, s.duration_seconds,
             v.plate, ds.name AS school, ${isSchool} AS is_school
        FROM sessions s
        LEFT JOIN vehicles v ON v.id = s.vehicle_id
        LEFT JOIN driving_schools ds ON ds.id::text = s.school_id::text
       WHERE s.started_at > NOW() - INTERVAL '45 days'${own('s.user_id', 1)}
       ORDER BY GREATEST(s.started_at, COALESCE(s.finished_at, s.started_at)) DESC LIMIT 30`, withKeys([])),
    safe('recent_receipts', `
      SELECT r.code, r.status, r.issued_at, r.scanned_at, r.cancelled_at, r.planned_minutes,
             COALESCE(st.full_name, r.customer_name) AS person, ds.name AS school,
             NULLIF(to_jsonb(r)->>'scanned_by_name', '') AS scanned_by
        FROM receipts r
        LEFT JOIN students st        ON st.id = r.student_id
        LEFT JOIN driving_schools ds ON ds.id = r.school_id
       WHERE r.issued_at > NOW() - INTERVAL '45 days'${own('r.user_id', 1)}
       ORDER BY GREATEST(r.issued_at, COALESCE(r.scanned_at, r.issued_at), COALESCE(r.cancelled_at, r.issued_at)) DESC
       LIMIT 30`, withKeys([])),
    safe('recent_gate', `
      SELECT e.at, e.direction, e.result, e.reason, e.code
        FROM gate_events e WHERE TRUE${own('e.user_id', 1)}
       ORDER BY e.at DESC LIMIT 20`, withKeys([])),
  ]);

  /* --- jami --- */
  const tot = (r) => {
    const x = r[0] || {};
    const sessions = n(x.sessions), school = n(x.school);
    return {
      sessions, school_sessions: school, paid_sessions: Math.max(0, sessions - school),
      minutes: mins(x.seconds), revenue: n(x.revenue), cash: n(x.cash), terminal: n(x.terminal),
      vehicles: n(x.vehicles), students: n(x.students), schools: n(x.schools),
      avg_minutes: sessions ? Math.round(mins(x.seconds) / sessions) : 0,
    };
  };
  const totals = tot(totalsRows);
  const previous = tot(prevRows);

  /* --- cheklar --- */
  const rs = Object.fromEntries(receiptRows.map((r) => [String(r.status || 'unknown'), n(r.n)]));
  const issued = Object.values(rs).reduce((a, b) => a + b, 0);
  const receipts = {
    issued, by_status: rs,
    open: n(rs.issued), used: n(rs.used) + n(rs.scanned) + n(rs.completed) + n(rs.in_use),
    cancelled: n(rs.cancelled), previous_issued: n(receiptPrevRows[0]?.n),
    scanners: scannerRows.map((r) => ({ name: r.name, n: n(r.n) })),
  };

  /* --- turniket --- */
  const gate = { in: 0, out: 0, denied: 0, total: 0 };
  for (const g of gateRows) {
    const k = n(g.n); gate.total += k;
    if (String(g.result) !== 'ok' && String(g.result) !== 'allowed') gate.denied += k;
    else if (String(g.direction).endsWith('out')) gate.out += k;
    else gate.in += k;
  }

  /* --- jonli --- */
  const now = Date.now();
  const elapsed = (s) => {
    const base = n(s.duration_seconds);
    if (s.status !== 'active') return base;            // frozen / paused — vaqt to'xtagan
    if (s.resumed_at) return base + Math.max(0, Math.floor((now - new Date(s.resumed_at).getTime()) / 1000));
    return Math.max(0, Math.floor((now - new Date(s.started_at).getTime()) / 1000));
  };
  const live = liveRows.map((s) => ({
    id: s.id, status: s.status, plate: s.plate || null, driver: s.driver || null,
    student: s.student || null, school: s.school || null, instructor: s.instructor || null,
    started_at: s.started_at, minutes: mins(elapsed(s)), planned_minutes: s.planned_minutes ?? null,
    is_school: !!s.is_school,
  }));

  /* --- maktablar: davrdagi faollik + umumiy holat --- */
  const meta = new Map(schoolMeta.map((m) => [String(m.id), m]));
  const seenSchools = new Set();
  const schools = schoolRows.map((r) => {
    seenSchools.add(String(r.id));
    const m = meta.get(String(r.id)) || {};
    return {
      id: r.id, name: r.name, sessions: n(r.sessions), students: n(r.students), minutes: mins(r.seconds),
      active_students: n(m.active_students), active_groups: n(m.active_groups), free_visits: m.free_visits ?? null,
    };
  });
  for (const m of schoolMeta) {
    if (seenSchools.has(String(m.id)) || m.active === false) continue;
    schools.push({ id: m.id, name: m.name, sessions: 0, students: 0, minutes: 0,
      active_students: n(m.active_students), active_groups: n(m.active_groups), free_visits: m.free_visits ?? null });
  }

  const st = studentRows[0] || {};

  /* --- amallar lentasi --- */
  const feed = [];
  for (const c of logRows) {
    feed.push({ at: c.at, kind: 'log', action: c.action, entity: c.entity,
      title: c.entity_name || c.entity || 'O‘zgartirish',
      detail: [c.field, c.old_value != null || c.new_value != null ? `${c.old_value ?? '—'} → ${c.new_value ?? '—'}` : null, c.reason]
        .filter(Boolean).join(' · '),
      actor: c.actor || null });
  }
  for (const s of recentSessions) {
    const who = [s.plate, s.school].filter(Boolean).join(' · ');
    feed.push({ at: s.started_at, kind: 'session_start', title: who || 'Sessiya', detail: s.is_school ? 'Avtoshkola' : 'Pullik', actor: null });
    if (s.finished_at && s.status === 'completed') {
      feed.push({ at: s.finished_at, kind: 'session_finish', title: who || 'Sessiya',
        detail: `${mins(s.duration_seconds)} daq${n(s.amount) ? ` · ${n(s.amount)} so‘m` : ''}`, amount: n(s.amount), actor: null });
    }
  }
  for (const r of recentReceipts) {
    const who = [r.person, r.school].filter(Boolean).join(' · ');
    feed.push({ at: r.issued_at, kind: 'receipt_issued', title: r.code, detail: who, actor: null });
    if (r.scanned_at) feed.push({ at: r.scanned_at, kind: 'receipt_scanned', title: r.code, detail: who, actor: r.scanned_by || null });
    if (r.cancelled_at) feed.push({ at: r.cancelled_at, kind: 'receipt_cancelled', title: r.code, detail: who, actor: null });
  }
  for (const g of recentGate) {
    const ok = String(g.result) === 'ok' || String(g.result) === 'allowed';
    feed.push({ at: g.at, kind: !ok ? 'gate_denied' : String(g.direction || '').endsWith('out') ? 'gate_out' : 'gate_in',
      title: g.code || 'Turniket', detail: g.reason || '', actor: null });
  }
  feed.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return {
    ok: true,
    source: 'avtodrom12',
    generated_at: new Date().toISOString(),
    from_day: range.fromYmd, to_day: range.toYmd, days: range.days, bucket,
    scoped_to_owners: keys.length,
    totals, previous,
    series: seriesRows.map((r) => ({ key: r.k, sessions: n(r.sessions), school: n(r.school),
      paid: Math.max(0, n(r.sessions) - n(r.school)), revenue: n(r.revenue), minutes: mins(r.seconds) })),
    hours: hourRows.map((r) => ({ hour: n(r.hour), sessions: n(r.sessions) })),
    heatmap: heatRows.map((r) => ({ dow: n(r.dow), hour: n(r.hour), n: n(r.n) })),
    schools,
    instructors: instrRows.map((r) => ({ name: r.name, sessions: n(r.sessions), school: n(r.school),
      minutes: mins(r.seconds), revenue: n(r.revenue) })),
    operators: operatorRows.map((r) => ({ name: r.name, sessions: n(r.sessions), revenue: n(r.revenue) })),
    live: {
      active: live.filter((x) => x.status === 'active').length,
      frozen: live.filter((x) => x.status !== 'active').length,
      waiting: n(waitingRows[0]?.n),
      sessions: live,
    },
    receipts,
    gate,
    students: { active: n(st.active), total: n(st.total), new_in_period: n(st.new_in_period),
      expiring_7d: n(expiringRows[0]?.n),
      schools_active: schoolMeta.filter((m) => m.active !== false).length,
      groups_active: schoolMeta.reduce((a, m) => a + n(m.active_groups), 0) },
    feed: feed.slice(0, 80),
    warnings,
  };
}

/** api/index.js dan chaqiriladi. Bizniki bo'lmasa false. */
export async function handleBridgeRequest(req, res) {
  const url = new URL(String(req.url || '/'), 'http://local');
  if (url.pathname !== '/api/bridge/analytics') return false;
  if (String(req.method || 'GET').toUpperCase() !== 'GET') return send(res, 405, { ok: false, error: 'Faqat GET' });
  if (!process.env.RECEIPT_SHARED_KEY) return send(res, 503, { ok: false, error: 'RECEIPT_SHARED_KEY sozlanmagan' });
  if (!checkBridgeKey(req)) return send(res, 401, { ok: false, error: 'Kalit noto‘g‘ri' });
  const range = bridgeRange(url.searchParams);
  if (range.error) return send(res, 400, { ok: false, error: range.error });
  try {
    return send(res, 200, await buildBridgeAnalytics(range));
  } catch (e) {
    console.error('BRIDGE ANALYTICS:', e?.message || e);
    return send(res, 500, { ok: false, error: 'Analitika hisoblanmadi' });
  }
}
