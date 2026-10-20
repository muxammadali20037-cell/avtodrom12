/**
 * BOSHLIQ KO'PRIGI — Avtodrom «Boshliq ilovasi» uchun (mashina-mashina)
 *
 *   GET /api/bridge/owner?from=YYYY-MM-DD&to=YYYY-MM-DD&bucket=hour|day|month
 *   Sarlavha: X-Receipt-Key: <RECEIPT_SHARED_KEY>   (Analitika ko'prigi bilan bir xil)
 *
 * Avtodrom serveri shu manzildan o'qiydi va boshliq telefonidagi ilovada
 * uch bo'limni ko'rsatadi. Bu yerdan ikkitasi va xarajatlar keladi:
 *   • AVTOSHKOLA — shartnoma bo'yicha kelgan o'quvchilar (sessions.school_id
 *     yoki customer_type='school'): darslar, o'quvchilar, avtoshkolalar,
 *     limitdan oshgan (pullik bo'lishi kerak) darslar, QR cheklar.
 *   • PLATNIY (oddiy mijoz) — vaqt ochib kiradigan mashinalar: tushum
 *     (naqd / terminal / Klik), qarzlar, mashina raqamlari, soatlar.
 *   • XARAJATLAR — «Rasxod» (expenses): turlari, mashina, kim, to'lov usuli.
 *
 * Faqat O'QIYDI. Kunlar Toshkent vaqti bilan. Har bo'lim alohida so'rov:
 * biror ustun/jadval yo'q bo'lsa o'sha bo'lim bo'sh qaytadi va `warnings`
 * ga yoziladi — qolgani ishlayveradi (bridge-analytics.js bilan bir xil qoida).
 *
 * IXTIYORIY: ANALYTICS_OWNER_KEYS="uuid1,uuid2" — faqat shu hisob(lar).
 */
import { pool } from '../backend/src/db.js';
import { checkBridgeKey, bridgeRange } from './bridge-analytics.js';

const TZ = 'Asia/Tashkent';
const TZ_OFFSET_MS = 5 * 3600e3;
const FMT = { hour: 'HH24:00', day: 'YYYY-MM-DD', month: 'YYYY-MM' };

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const mins = (sec) => Math.round(n(sec) / 60);
const todayTk = () => new Date(Date.now() + TZ_OFFSET_MS).toISOString().slice(0, 10);

/* Ustun yo'q bo'lsa ham yiqilmasin — to_jsonb orqali o'qiladi */
const col = (alias, name) => `NULLIF(to_jsonb(${alias})->>'${name}', '')`;
const numCol = (alias, name) => `COALESCE(${col(alias, name)}::numeric, 0)`;

/** Avtoshkola sessiyasi. customer_type NULL bo'lsa ham to'g'ri ishlasin (NOT NULL = NULL tuzog'i). */
export const IS_SCHOOL = `(s.school_id IS NOT NULL OR COALESCE(s.customer_type, '') = 'school')`;
export const IS_PAID = `NOT ${IS_SCHOOL}`;

function send(res, status, data) {
  if (res.headersSent) return true;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
  return true;
}

const owners = () => String(process.env.ANALYTICS_OWNER_KEYS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

function makeSafe(warnings, db) {
  return async (name, sql, params = []) => {
    try { return (await db.query(sql, params)).rows; }
    catch (e) {
      warnings.push({ section: name, error: String(e?.message || e).slice(0, 200) });
      return [];
    }
  };
}

/** Sessiyaning hozirgacha o'tgan vaqti (soniya) — muzlatilganda to'xtaydi */
function elapsedSec(s, now) {
  const base = n(s.duration_seconds);
  if (s.status !== 'active') return base;
  if (s.resumed_at) return base + Math.max(0, Math.floor((now - new Date(s.resumed_at).getTime()) / 1000));
  return Math.max(0, Math.floor((now - new Date(s.started_at).getTime()) / 1000));
}

/* ======================================================================= */

export async function buildOwnerBridge(range, db = pool) {
  const warnings = [];
  const safe = makeSafe(warnings, db);
  const keys = owners();
  const own = (c, idx) => (keys.length ? ` AND ${c}::text = ANY($${idx}::text[])` : '');
  const withKeys = (arr) => (keys.length ? [...arr, keys] : arr);

  const { from, to, prevFrom, bucket, fromYmd, toYmd } = range;
  const fmt = FMT[bucket] || FMT.day;
  const cur = withKeys([from.toISOString(), to.toISOString()]);
  const prev = withKeys([prevFrom.toISOString(), from.toISOString()]);
  const done = `s.status = 'completed' AND s.started_at >= $1 AND s.started_at < $2${own('s.user_id', 3)}`;
  const tk = `(s.started_at AT TIME ZONE '${TZ}')`;
  const secs = `COALESCE(s.duration_seconds, 0)`;
  const lessons = `GREATEST(COALESCE(${col('s', 'lessons_counted')}::int, 1), 1)`;

  /* Xarajatlar — sana ustuni (DATE), oldingi davr ham kunlar bilan */
  const prevToYmd = new Date(new Date(`${fromYmd}T00:00:00Z`).getTime() - 864e5).toISOString().slice(0, 10);
  const prevFromYmd = new Date(new Date(`${fromYmd}T00:00:00Z`).getTime() - range.days * 864e5).toISOString().slice(0, 10);
  const expCur = withKeys([fromYmd, toYmd]);
  const expPrev = withKeys([prevFromYmd, prevToYmd]);
  const expWhere = `e.deleted_at IS NULL AND e.spent_on BETWEEN $1::date AND $2::date${own('e.user_id', 3)}`;
  const expKey = bucket === 'month' ? `to_char(e.spent_on, 'YYYY-MM')` : `to_char(e.spent_on, 'YYYY-MM-DD')`;

  const today = todayTk();
  const in7 = new Date(new Date(`${today}T00:00:00Z`).getTime() + 7 * 864e5).toISOString().slice(0, 10);

  const totalsSql = `
    SELECT
      COUNT(*) FILTER (WHERE ${IS_PAID})::int                               AS p_sessions,
      COALESCE(SUM(${secs}) FILTER (WHERE ${IS_PAID}), 0)::bigint            AS p_seconds,
      COALESCE(SUM(COALESCE(s.amount, 0)) FILTER (WHERE ${IS_PAID}), 0)::float8        AS p_revenue,
      COALESCE(SUM(COALESCE(s.cash_amount, 0)) FILTER (WHERE ${IS_PAID}), 0)::float8   AS p_cash,
      COALESCE(SUM(COALESCE(s.terminal_amount, 0)) FILTER (WHERE ${IS_PAID}), 0)::float8 AS p_terminal,
      COALESCE(SUM(${numCol('s', 'click_amount')}) FILTER (WHERE ${IS_PAID}), 0)::float8 AS p_click,
      COALESCE(SUM(${numCol('s', 'debt_amount')}) FILTER (WHERE ${IS_PAID}), 0)::float8  AS p_debt,
      COUNT(*) FILTER (WHERE ${IS_PAID} AND ${numCol('s', 'debt_amount')} > 0)::int      AS p_debt_n,
      COUNT(*) FILTER (WHERE ${IS_PAID} AND COALESCE(${col('s', 'auto_closed')}::boolean, FALSE))::int AS p_auto_closed,
      COUNT(DISTINCT s.vehicle_id) FILTER (WHERE ${IS_PAID})::int            AS p_vehicles,
      COUNT(*) FILTER (WHERE ${IS_PAID} AND ${secs} <= 1800)::int            AS p_d30,
      COUNT(*) FILTER (WHERE ${IS_PAID} AND ${secs} > 1800 AND ${secs} <= 3600)::int  AS p_d60,
      COUNT(*) FILTER (WHERE ${IS_PAID} AND ${secs} > 3600 AND ${secs} <= 7200)::int  AS p_d120,
      COUNT(*) FILTER (WHERE ${IS_PAID} AND ${secs} > 7200)::int             AS p_dmore,
      COUNT(*) FILTER (WHERE ${IS_SCHOOL})::int                              AS s_sessions,
      COALESCE(SUM(${lessons}) FILTER (WHERE ${IS_SCHOOL}), 0)::int          AS s_lessons,
      COALESCE(SUM(${secs}) FILTER (WHERE ${IS_SCHOOL}), 0)::bigint          AS s_seconds,
      COALESCE(SUM(COALESCE(s.amount, 0)) FILTER (WHERE ${IS_SCHOOL}), 0)::float8 AS s_revenue,
      COUNT(DISTINCT s.student_id) FILTER (WHERE ${IS_SCHOOL})::int          AS s_students,
      COUNT(DISTINCT s.school_id) FILTER (WHERE ${IS_SCHOOL})::int           AS s_schools,
      COALESCE(SUM(COALESCE(${col('s', 'over_lessons')}::int, 0)) FILTER (WHERE ${IS_SCHOOL}), 0)::int AS s_over
    FROM sessions s WHERE ${done}`;

  const [
    totalsRows, prevRows, seriesRows, hourRows, plateRows, plateNewRows, debtRows, debtTop,
    liveRows, waitingRows, operatorRows,
    schoolRows, schoolMeta, overRows, schoolInstr, receiptRows, studentRows, expiringRows,
    expTot, expPrevRows, expCat, expVeh, expPerson, expSeries, expRecent,
  ] = await Promise.all([
    safe('totals', totalsSql, cur),
    safe('previous', totalsSql, prev),
    safe('series', `
      SELECT to_char(${tk}, '${fmt}') AS k,
             COUNT(*) FILTER (WHERE ${IS_PAID})::int AS paid,
             COALESCE(SUM(COALESCE(s.amount, 0)) FILTER (WHERE ${IS_PAID}), 0)::float8 AS paid_revenue,
             COUNT(*) FILTER (WHERE ${IS_SCHOOL})::int AS school,
             COALESCE(SUM(${lessons}) FILTER (WHERE ${IS_SCHOOL}), 0)::int AS school_lessons,
             COALESCE(SUM(COALESCE(s.amount, 0)) FILTER (WHERE ${IS_SCHOOL}), 0)::float8 AS school_revenue
        FROM sessions s WHERE ${done} GROUP BY 1 ORDER BY 1`, cur),
    safe('hours', `
      SELECT EXTRACT(HOUR FROM ${tk})::int AS hour,
             COUNT(*) FILTER (WHERE ${IS_PAID})::int AS paid,
             COALESCE(SUM(COALESCE(s.amount, 0)) FILTER (WHERE ${IS_PAID}), 0)::float8 AS paid_revenue,
             COUNT(*) FILTER (WHERE ${IS_SCHOOL})::int AS school
        FROM sessions s WHERE ${done} GROUP BY 1 ORDER BY 1`, cur),
    /* Mashina raqamlari — eng ko'p pul qoldirganlar */
    safe('plates', `
      SELECT COALESCE(NULLIF(v.plate, ''), ${col('s', 'driver_name')}, '—') AS plate,
             MAX(COALESCE(${col('s', 'driver_name')}, v.driver_name)) AS driver,
             COUNT(*)::int AS visits,
             COALESCE(SUM(${secs}), 0)::bigint AS seconds,
             COALESCE(SUM(COALESCE(s.amount, 0)), 0)::float8 AS revenue,
             COALESCE(SUM(${numCol('s', 'debt_amount')}), 0)::float8 AS debt,
             MAX(s.started_at) AS last_at
        FROM sessions s LEFT JOIN vehicles v ON v.id = s.vehicle_id
       WHERE ${done} AND ${IS_PAID}
       GROUP BY 1 ORDER BY revenue DESC, visits DESC LIMIT 40`, cur),
    /* Yangi mashinalar — shu davrdan oldin hech kelmagan */
    safe('plates_new', `
      WITH p AS (SELECT DISTINCT s.vehicle_id FROM sessions s WHERE ${done} AND ${IS_PAID} AND s.vehicle_id IS NOT NULL)
      SELECT COUNT(*)::int AS plates,
             COUNT(*) FILTER (WHERE NOT EXISTS (
               SELECT 1 FROM sessions o WHERE o.vehicle_id = p.vehicle_id AND o.status = 'completed'
                  AND o.started_at < $1${own('o.user_id', 3)}))::int AS new_plates
        FROM p`, cur),
    /* Qarzlar — davrdan qat'i nazar, HOZIR to'lanmagan */
    safe('debts', `
      SELECT COUNT(*)::int AS n, COALESCE(SUM(${numCol('s', 'debt_amount')}), 0)::float8 AS total,
             COUNT(DISTINCT s.vehicle_id)::int AS vehicles, MIN(s.started_at) AS oldest
        FROM sessions s
       WHERE s.status = 'completed' AND ${numCol('s', 'debt_amount')} > 0${own('s.user_id', 1)}`, withKeys([])),
    safe('debts_top', `
      SELECT COALESCE(NULLIF(v.plate, ''), ${col('s', 'driver_name')}, '—') AS plate,
             COUNT(*)::int AS n, COALESCE(SUM(${numCol('s', 'debt_amount')}), 0)::float8 AS total,
             MIN(s.started_at) AS oldest
        FROM sessions s LEFT JOIN vehicles v ON v.id = s.vehicle_id
       WHERE s.status = 'completed' AND ${numCol('s', 'debt_amount')} > 0${own('s.user_id', 1)}
       GROUP BY 1 ORDER BY total DESC LIMIT 20`, withKeys([])),
    safe('live', `
      SELECT s.id::text AS id, s.status, v.plate,
             COALESCE(${col('s', 'driver_name')}, v.driver_name) AS driver,
             st.full_name AS student, ds.name AS school,
             COALESCE(NULLIF(i.full_name, ''), ${col('s', 'instructor_name')}) AS instructor,
             s.started_at, s.duration_seconds,
             ${col('s', 'resumed_at')}::timestamptz AS resumed_at,
             ${col('s', 'planned_minutes')}::int AS planned_minutes,
             ${col('s', 'target_duration')}::int AS target_duration,
             ${col('s', 'planned_amount')}::numeric::float8 AS planned_amount,
             (COALESCE(s.cash_amount, 0) + COALESCE(s.terminal_amount, 0) + ${numCol('s', 'click_amount')})::float8 AS paid_so_far,
             COALESCE(${col('s', 'auto_close')}::boolean, FALSE) AS auto_close,
             ${IS_SCHOOL} AS is_school
        FROM sessions s
        LEFT JOIN vehicles v         ON v.id = s.vehicle_id
        LEFT JOIN students st        ON st.id::text = s.student_id::text
        LEFT JOIN driving_schools ds ON ds.id::text = s.school_id::text
        LEFT JOIN instructors i      ON i.id::text = ${col('s', 'instructor_id')}
       WHERE s.status IN ('active', 'paused', 'frozen')${own('s.user_id', 1)}
       ORDER BY s.started_at ASC LIMIT 80`, withKeys([])),
    safe('waiting', `SELECT COUNT(*)::int AS n FROM waiting_sessions w WHERE TRUE${own('w.user_id', 1)}`, withKeys([])),
    safe('operators', `
      SELECT COALESCE(NULLIF(u.full_name, ''), u.username, 'Operator') AS name,
             COUNT(*) FILTER (WHERE ${IS_PAID})::int AS paid,
             COUNT(*) FILTER (WHERE ${IS_SCHOOL})::int AS school,
             COALESCE(SUM(COALESCE(s.amount, 0)), 0)::float8 AS revenue
        FROM sessions s LEFT JOIN users u ON u.id::text = s.user_id::text
       WHERE ${done} GROUP BY 1 ORDER BY revenue DESC, paid DESC LIMIT 10`, cur),

    /* ---------------- AVTOSHKOLA ---------------- */
    safe('schools', `
      SELECT ds.id::text AS id, ds.name,
             COUNT(s.id)::int AS sessions,
             COALESCE(SUM(${lessons}), 0)::int AS lessons,
             COUNT(DISTINCT s.student_id)::int AS students,
             COALESCE(SUM(${secs}), 0)::bigint AS seconds,
             COALESCE(SUM(COALESCE(${col('s', 'over_lessons')}::int, 0)), 0)::int AS over,
             COALESCE(SUM(COALESCE(s.amount, 0)), 0)::float8 AS revenue
        FROM sessions s JOIN driving_schools ds ON ds.id::text = s.school_id::text
       WHERE ${done}
       GROUP BY ds.id, ds.name ORDER BY lessons DESC, sessions DESC LIMIT 60`, cur),
    safe('schools_meta', `
      SELECT ds.id::text AS id, ds.name, ds.active, ds.phone,
             ${col('ds', 'free_visits')}::int AS free_visits,
             (SELECT COUNT(*) FROM students st WHERE st.school_id = ds.id AND st.active)::int AS active_students,
             (SELECT COUNT(*) FROM school_groups g WHERE g.school_id = ds.id AND g.active)::int AS active_groups
        FROM driving_schools ds WHERE TRUE${own('ds.owner_key', 1)}`, withKeys([])),
    /* Limitdan oshgan darslar — avtoshkola to'lashi kerak bo'lgan summa (soat narxi bo'yicha) */
    safe('over_limit', `
      SELECT s.school_id::text AS school_id,
             COALESCE(SUM(COALESCE(${col('s', 'over_lessons')}::int, 0)), 0)::int AS over,
             COUNT(DISTINCT s.student_id) FILTER (WHERE COALESCE(${col('s', 'over_lessons')}::int, 0) > 0)::int AS students,
             COALESCE(SUM(COALESCE(${col('s', 'over_lessons')}::int, 0) * COALESCE(us.hourly_rate, 0)), 0)::float8 AS due
        FROM sessions s LEFT JOIN user_settings us ON us.user_id::text = s.user_id::text
       WHERE ${done} AND ${IS_SCHOOL} AND COALESCE(${col('s', 'over_lessons')}::int, 0) > 0
       GROUP BY 1`, cur),
    safe('school_instructors', `
      SELECT COALESCE(NULLIF(i.full_name, ''), ${col('s', 'instructor_name')}, 'Instruktorsiz') AS name,
             COUNT(*)::int AS sessions, COALESCE(SUM(${lessons}), 0)::int AS lessons,
             COALESCE(SUM(${secs}), 0)::bigint AS seconds
        FROM sessions s LEFT JOIN instructors i ON i.id::text = ${col('s', 'instructor_id')}
       WHERE ${done} AND ${IS_SCHOOL} GROUP BY 1 ORDER BY lessons DESC LIMIT 15`, cur),
    safe('receipts', `
      SELECT r.status, COUNT(*)::int AS n FROM receipts r
       WHERE r.issued_at >= $1 AND r.issued_at < $2${own('r.user_id', 3)} GROUP BY 1`, cur),
    safe('students', `
      SELECT COUNT(*) FILTER (WHERE st.active)::int AS active,
             COUNT(*) FILTER (WHERE st.created_at >= $1 AND st.created_at < $2)::int AS new_in_period,
             COUNT(*)::int AS total
        FROM students st WHERE TRUE${own('st.owner_key', 3)}`, cur),
    safe('expiring', `
      SELECT COUNT(*)::int AS n FROM students st
       WHERE st.active AND ${col('st', 'access_until')}::date BETWEEN $1::date AND $2::date${own('st.owner_key', 3)}`,
      withKeys([today, in7])),

    /* ---------------- XARAJATLAR ---------------- */
    safe('expenses', `
      SELECT COUNT(*)::int AS n, COALESCE(SUM(e.amount), 0)::float8 AS total,
             COALESCE(SUM(e.amount) FILTER (WHERE e.pay_method = 'cash'), 0)::float8 AS cash,
             COALESCE(SUM(e.amount) FILTER (WHERE e.pay_method = 'card'), 0)::float8 AS card,
             COALESCE(SUM(e.amount) FILTER (WHERE e.pay_method = 'click'), 0)::float8 AS click,
             COALESCE(SUM(e.liters), 0)::float8 AS liters
        FROM expenses e WHERE ${expWhere}`, expCur),
    safe('expenses_prev', `SELECT COALESCE(SUM(e.amount), 0)::float8 AS total FROM expenses e WHERE ${expWhere}`, expPrev),
    safe('expenses_category', `
      SELECT e.category AS name, COUNT(*)::int AS n, COALESCE(SUM(e.amount), 0)::float8 AS total,
             COALESCE(SUM(e.liters), 0)::float8 AS liters
        FROM expenses e WHERE ${expWhere} GROUP BY 1 ORDER BY total DESC LIMIT 30`, expCur),
    safe('expenses_vehicle', `
      SELECT e.vehicle AS name, COUNT(*)::int AS n, COALESCE(SUM(e.amount), 0)::float8 AS total,
             COALESCE(SUM(e.liters), 0)::float8 AS liters, MAX(e.odometer)::int AS odometer
        FROM expenses e WHERE ${expWhere} AND COALESCE(e.vehicle, '') <> '' GROUP BY 1 ORDER BY total DESC LIMIT 20`, expCur),
    safe('expenses_person', `
      SELECT e.person AS name, COUNT(*)::int AS n, COALESCE(SUM(e.amount), 0)::float8 AS total
        FROM expenses e WHERE ${expWhere} AND COALESCE(e.person, '') <> '' GROUP BY 1 ORDER BY total DESC LIMIT 20`, expCur),
    safe('expenses_series', `
      SELECT ${expKey} AS k, COALESCE(SUM(e.amount), 0)::float8 AS total
        FROM expenses e WHERE ${expWhere} GROUP BY 1 ORDER BY 1`, expCur),
    safe('expenses_recent', `
      SELECT e.id::text AS id, to_char(e.spent_on, 'YYYY-MM-DD') AS day, e.category, e.person, e.vehicle,
             e.amount::float8 AS amount, e.pay_method, e.liters::float8 AS liters, e.odometer, e.note, e.created_at
        FROM expenses e WHERE ${expWhere}
       ORDER BY e.spent_on DESC, e.created_at DESC LIMIT 60`, expCur),
  ]);

  /* ---------------- jamlash ---------------- */
  const T = totalsRows[0] || {}, P = prevRows[0] || {};

  const paidTotals = (x) => {
    const sessions = n(x.p_sessions);
    return {
      sessions, minutes: mins(x.p_seconds), revenue: n(x.p_revenue),
      cash: n(x.p_cash), terminal: n(x.p_terminal), click: n(x.p_click),
      debt: n(x.p_debt), debt_sessions: n(x.p_debt_n), auto_closed: n(x.p_auto_closed),
      vehicles: n(x.p_vehicles),
      avg_check: sessions ? Math.round(n(x.p_revenue) / sessions) : 0,
      avg_minutes: sessions ? Math.round(mins(x.p_seconds) / sessions) : 0,
    };
  };
  const schoolTotals = (x) => {
    const sessions = n(x.s_sessions);
    return {
      sessions, lessons: n(x.s_lessons), minutes: mins(x.s_seconds), revenue: n(x.s_revenue),
      students: n(x.s_students), schools: n(x.s_schools), over_lessons: n(x.s_over),
    };
  };

  /* Avtoshkolalar: davrdagi faollik + umumiy holat + limitdan oshgan summa */
  const meta = new Map(schoolMeta.map((m) => [String(m.id), m]));
  const overBy = new Map(overRows.map((o) => [String(o.school_id), o]));
  const seen = new Set();
  const schools = schoolRows.map((r) => {
    seen.add(String(r.id));
    const m = meta.get(String(r.id)) || {};
    const o = overBy.get(String(r.id)) || {};
    return {
      id: r.id, name: r.name, phone: m.phone || null,
      sessions: n(r.sessions), lessons: n(r.lessons), students: n(r.students), minutes: mins(r.seconds),
      over_lessons: n(r.over), over_due: n(o.due), revenue: n(r.revenue),
      active_students: n(m.active_students), active_groups: n(m.active_groups), free_visits: m.free_visits ?? null,
    };
  });
  for (const m of schoolMeta) {
    if (seen.has(String(m.id)) || m.active === false) continue;
    schools.push({ id: m.id, name: m.name, phone: m.phone || null, sessions: 0, lessons: 0, students: 0, minutes: 0,
      over_lessons: 0, over_due: 0, revenue: 0, active_students: n(m.active_students), active_groups: n(m.active_groups),
      free_visits: m.free_visits ?? null });
  }
  const overDue = overRows.reduce((a, o) => a + n(o.due), 0);
  const overStudents = overRows.reduce((a, o) => a + n(o.students), 0);

  const rs = Object.fromEntries(receiptRows.map((r) => [String(r.status || 'unknown'), n(r.n)]));
  const receipts = {
    issued: Object.values(rs).reduce((a, b) => a + b, 0),
    open: n(rs.issued),
    used: n(rs.used) + n(rs.scanned) + n(rs.completed) + n(rs.in_use),
    cancelled: n(rs.cancelled),
  };

  const now = Date.now();
  const live = liveRows.map((s) => {
    const el = elapsedSec(s, now);
    const planned = s.planned_minutes ?? (s.target_duration ? Math.round(n(s.target_duration) / 60) : null);
    return {
      id: s.id, status: s.status, plate: s.plate || null, driver: s.driver || null,
      student: s.student || null, school: s.school || null, instructor: s.instructor || null,
      started_at: s.started_at, minutes: mins(el), planned_minutes: planned || null,
      planned_amount: s.planned_amount ?? null, paid_so_far: n(s.paid_so_far), auto_close: !!s.auto_close,
      is_school: !!s.is_school,
    };
  });
  const livePaid = live.filter((x) => !x.is_school), liveSchool = live.filter((x) => x.is_school);

  const st = studentRows[0] || {};
  const pn = plateNewRows[0] || {};
  const D = debtRows[0] || {};
  const E = expTot[0] || {};

  return {
    ok: true,
    source: 'avtodrom12',
    kind: 'owner',
    generated_at: new Date().toISOString(),
    from_day: fromYmd, to_day: toYmd, days: range.days, bucket,
    scoped_to_owners: keys.length,

    paid: {
      totals: paidTotals(T), previous: paidTotals(P),
      durations: { upto30: n(T.p_d30), upto60: n(T.p_d60), upto120: n(T.p_d120), more: n(T.p_dmore) },
      plates: {
        total: n(pn.plates), new: n(pn.new_plates), returning: Math.max(0, n(pn.plates) - n(pn.new_plates)),
        top: plateRows.map((r) => ({ plate: r.plate, driver: r.driver || null, visits: n(r.visits), minutes: mins(r.seconds),
          revenue: n(r.revenue), debt: n(r.debt), last_at: r.last_at })),
      },
      debts: {
        total: n(D.total), sessions: n(D.n), vehicles: n(D.vehicles), oldest: D.oldest || null,
        top: debtTop.map((r) => ({ plate: r.plate, n: n(r.n), total: n(r.total), oldest: r.oldest })),
      },
      operators: operatorRows.map((r) => ({ name: r.name, paid: n(r.paid), school: n(r.school), revenue: n(r.revenue) })),
      live: { active: livePaid.filter((x) => x.status === 'active').length, frozen: livePaid.filter((x) => x.status !== 'active').length,
        waiting: n(waitingRows[0]?.n), sessions: livePaid },
    },

    school: {
      totals: schoolTotals(T), previous: schoolTotals(P),
      over_limit: { lessons: n(T.s_over), students: overStudents, due: overDue },
      schools,
      instructors: schoolInstr.map((r) => ({ name: r.name, sessions: n(r.sessions), lessons: n(r.lessons), minutes: mins(r.seconds) })),
      receipts,
      students: { active: n(st.active), total: n(st.total), new_in_period: n(st.new_in_period), expiring_7d: n(expiringRows[0]?.n),
        schools_active: schoolMeta.filter((m) => m.active !== false).length,
        groups_active: schoolMeta.reduce((a, m) => a + n(m.active_groups), 0) },
      live: { count: liveSchool.length, sessions: liveSchool },
    },

    series: seriesRows.map((r) => ({ key: r.k, paid: n(r.paid), paid_revenue: n(r.paid_revenue), school: n(r.school),
      school_lessons: n(r.school_lessons), school_revenue: n(r.school_revenue) })),
    hours: hourRows.map((r) => ({ hour: n(r.hour), paid: n(r.paid), paid_revenue: n(r.paid_revenue), school: n(r.school) })),

    expenses: {
      total: n(E.total), count: n(E.n), previous_total: n(expPrevRows[0]?.total),
      by_method: { cash: n(E.cash), card: n(E.card), click: n(E.click) }, liters: n(E.liters),
      categories: expCat.map((r) => ({ name: r.name, n: n(r.n), total: n(r.total), liters: n(r.liters) })),
      vehicles: expVeh.map((r) => ({ name: r.name, n: n(r.n), total: n(r.total), liters: n(r.liters), odometer: r.odometer ?? null })),
      people: expPerson.map((r) => ({ name: r.name, n: n(r.n), total: n(r.total) })),
      series: expSeries.map((r) => ({ key: r.k, total: n(r.total) })),
      recent: expRecent.map((r) => ({ id: r.id, day: r.day, category: r.category, person: r.person || null, vehicle: r.vehicle || null,
        amount: n(r.amount), method: r.pay_method, liters: r.liters ?? null, odometer: r.odometer ?? null, note: r.note || null,
        created_at: r.created_at })),
    },

    warnings,
  };
}

/** api/index.js dan chaqiriladi. Bizniki bo'lmasa false. */
export async function handleOwnerBridgeRequest(req, res) {
  const url = new URL(String(req.url || '/'), 'http://local');
  if (url.pathname !== '/api/bridge/owner') return false;
  if (String(req.method || 'GET').toUpperCase() !== 'GET') return send(res, 405, { ok: false, error: 'Faqat GET' });
  if (!process.env.RECEIPT_SHARED_KEY) return send(res, 503, { ok: false, error: 'RECEIPT_SHARED_KEY sozlanmagan' });
  if (!checkBridgeKey(req)) return send(res, 401, { ok: false, error: 'Kalit noto‘g‘ri' });
  const range = bridgeRange(url.searchParams);
  if (range.error) return send(res, 400, { ok: false, error: range.error });
  try {
    return send(res, 200, await buildOwnerBridge(range));
  } catch (e) {
    console.error('OWNER BRIDGE:', e?.message || e);
    return send(res, 500, { ok: false, error: 'Boshliq ma’lumoti hisoblanmadi' });
  }
}
