/* ============================================================================
   BAZADAGI HAMMA TAHRIRLAR — boshliq ilovasining «Tahrirlanganlar» bo'limi

   Muammo: o'zgartirishlar jurnaliga (change_log) faqat dastur ATAYLAB
   yozgan amallar tushardi. O'quvchi ismi/telefoni, guruh, avtoshkola,
   instruktor, mashina, narx sozlamasi, yopilgan mashina yozuvi kabi
   tahrirlarning ko'pchiligi izsiz qolardi.

   Yechim: BAZANING O'ZI yozadi. Muhim jadvallarda trigger bor: har bir
   UPDATE va DELETE (qaysi sahifa, qaysi kod yo'li bo'lmasin) `db_changes`
   jadvaliga tushadi — qaysi jadval, qaysi yozuv, qaysi ustun eski → yangi,
   qachon va KIM (kirgan login). Jurnal faqat qo'shiladi.

   Kunlik ishni tahrir deb sanamaymiz (shovqin bo'lmasin):
     • mashina yozuvi (sessions) — faqat YOPILGAN (completed) yozuv
       o'zgarsa yoki o'chirilsa; kirish, muzlatish, chiqish — oddiy ish;
     • o'quvchining dars sanog'i (attendance_count) — davomat bilan o'zi oshadi;
     • mashinaga haydovchi/instruktor biriktirish — har kirishda o'zgaradi;
     • yaratilgandan / yopilgandan keyingi 15 soniya ichidagi yozish
       (masalan, postni qo'yish) — bu yaratishning davomi;
     • updated_at, egasi (user_id / owner_key) — texnik ustunlar.
   Bir buyruq 25 tadan ko'p yozuvni o'zgartirsa (hisobni qo'shish, tozalash)
   — bitta umumiy qator: «N ta yozuv».

   KIM: tranzaksiyada `avtodrom.actor` (db.js, BEGIN'da), tranzaksiyasiz
   yozuvda — so'rov matni oxiridagi izoh `/* avt-actor:<login> *\/` (db.js
   qo'shadi). Qo'shimcha so'rov yo'q — kassa sekinlashmaydi.

   Ko'prik (Avtodrom serveri uchun, faqat o'qiydi):
     GET /api/bridge/edits?from=YYYY-MM-DD&to=YYYY-MM-DD&before=<ISO>&limit=150
     Sarlavha: X-Receipt-Key: <RECEIPT_SHARED_KEY>
     change_log (sababi bilan) + db_changes (eski → yangi) birga, eng yangisi
     tepada; bir tahrir ikkalasiga tushgan bo'lsa — bitta qator.
   ========================================================================== */
import { pool } from '../backend/src/db.js';
import { runOnce, ddl } from '../backend/src/schema-once.js';
import { checkBridgeKey, bridgeRange, bridgeKeysConfigured } from './bridge-analytics.js';
import { ensureAuditSchema } from './audit-routes.js';

/* Kuzatiladigan jadvallar: [jadval, kalit ustun, e'tiborga olinmaydigan ustunlar] */
export const TRACKED = [
  ['sessions', 'id', 'updated_at,user_id,opened_by,lessons_counted,instructor_name'],
  ['expenses', 'id', 'updated_at,user_id,owner_key'],
  ['debt_payments', 'id', 'updated_at,user_id'],
  ['students', 'id', 'updated_at,owner_key,attendance_count,last_attendance_at'],
  ['driving_schools', 'id', 'updated_at,owner_key'],
  ['school_groups', 'id', 'updated_at,owner_key'],
  ['instructors', 'id', 'updated_at,owner_key'],
  ['vehicles', 'id', 'updated_at,user_id,driver_name,instructor_id,avtodrom_instructor_id,last_seen_at'],
  ['school_vehicles', 'id', 'updated_at,owner_key,user_id'],
  ['user_settings', 'user_id', 'updated_at'],
  ['settings', 'id', 'updated_at'],
];
export const BULK = 25;

const FN = `
CREATE OR REPLACE FUNCTION avt_track_changes() RETURNS trigger LANGUAGE plpgsql AS $f$
DECLARE
  ign text[] := string_to_array(COALESCE(TG_ARGV[1], ''), ',');
  keycol text := COALESCE(NULLIF(TG_ARGV[0], ''), 'id');
  who text;
  r record;
  d jsonb;
  k text;
  acc jsonb := '[]'::jsonb;
  cnt int := 0;
  own text;
BEGIN
  IF COALESCE(current_setting('avtodrom.audit_off', true), '') = '1' THEN RETURN NULL; END IF;
  who := NULLIF(current_setting('avtodrom.actor', true), '');
  IF who IS NULL THEN who := substring(current_query() from 'avt-actor:([A-Za-z0-9_.@-]{1,80})'); END IF;
  IF TG_OP = 'DELETE' THEN
    FOR r IN SELECT to_jsonb(x) AS oj FROM avt_old x LOOP
      cnt := cnt + 1;
      own := COALESCE(own, r.oj->>'user_id', r.oj->>'owner_key');
      IF cnt <= ${BULK} THEN
        acc := acc || jsonb_build_array(jsonb_build_object('id', r.oj->>keycol, 'own', COALESCE(r.oj->>'user_id', r.oj->>'owner_key'), 'c', r.oj - ign));
      END IF;
    END LOOP;
  ELSE
    FOR r IN SELECT to_jsonb(a) AS oj, to_jsonb(b) AS nj FROM avt_old a JOIN avt_new b ON (to_jsonb(a)->>keycol) = (to_jsonb(b)->>keycol) LOOP
      IF TG_TABLE_NAME = 'sessions' AND COALESCE(r.oj->>'status', '') <> 'completed' THEN CONTINUE; END IF;
      /* yaratilish / yopilishning davomi (masalan, postni yozish) — tahrir emas */
      IF (r.oj->>'created_at') IS NOT NULL AND (r.oj->>'created_at')::timestamptz > now() - interval '15 seconds' THEN CONTINUE; END IF;
      IF TG_TABLE_NAME = 'sessions' AND (r.oj->>'finished_at') IS NOT NULL AND (r.oj->>'finished_at')::timestamptz > now() - interval '15 seconds' THEN CONTINUE; END IF;
      d := '{}'::jsonb;
      FOR k IN SELECT jsonb_object_keys(r.nj) LOOP
        IF k = ANY(ign) THEN CONTINUE; END IF;
        IF (r.oj->k) IS DISTINCT FROM (r.nj->k) THEN
          d := d || jsonb_build_object(k, jsonb_build_array(r.oj->k, r.nj->k));
        END IF;
      END LOOP;
      IF d = '{}'::jsonb THEN CONTINUE; END IF;
      cnt := cnt + 1;
      own := COALESCE(own, r.nj->>'user_id', r.nj->>'owner_key', r.oj->>'user_id', r.oj->>'owner_key');
      IF cnt <= ${BULK} THEN
        acc := acc || jsonb_build_array(jsonb_build_object('id', r.nj->>keycol, 'own', COALESCE(r.nj->>'user_id', r.nj->>'owner_key', r.oj->>'user_id', r.oj->>'owner_key'), 'c', d));
      END IF;
    END LOOP;
  END IF;
  IF cnt = 0 THEN RETURN NULL; END IF;
  IF cnt > ${BULK} THEN
    INSERT INTO db_changes(tbl, op, row_id, owner_key, actor, changes, n_rows)
    VALUES (TG_TABLE_NAME, left(TG_OP, 1), NULL, own, who, NULL, cnt);
  ELSE
    INSERT INTO db_changes(tbl, op, row_id, owner_key, actor, changes, n_rows)
    SELECT TG_TABLE_NAME, left(TG_OP, 1), e->>'id', e->>'own', who, e->'c', 1 FROM jsonb_array_elements(acc) e;
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  /* jurnal yozilmasa ham asosiy amal buzilmasin */
  RAISE WARNING 'avt_track_changes %: %', TG_TABLE_NAME, SQLERRM;
  RETURN NULL;
END $f$`;

let schemaP = null;
/** Jadval, funksiya va triggerlar — bir marta (avtodrom_migrations). */
export function ensureEditsSchema() {
  if (schemaP) return schemaP;
  schemaP = runOnce('db-changes-v1', async () => {
    await ddl(`CREATE TABLE IF NOT EXISTS db_changes(
      id BIGSERIAL PRIMARY KEY,
      at TIMESTAMPTZ NOT NULL DEFAULT now(),
      tbl TEXT NOT NULL,
      op CHAR(1) NOT NULL,
      row_id TEXT,
      owner_key TEXT,
      actor TEXT,
      changes JSONB,
      n_rows INT NOT NULL DEFAULT 1)`);
    await ddl(`CREATE INDEX IF NOT EXISTS idx_db_changes_at ON db_changes(at DESC)`);
    await ddl(`CREATE INDEX IF NOT EXISTS idx_db_changes_row ON db_changes(tbl, row_id, at)`);
    await ddl(FN);
    for (const [tbl, key, ign] of TRACKED) {
      const ex = await pool.query(`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`, [tbl]);
      if (!ex.rows[0]) continue;
      const args = `'${key}', '${ign}'`;
      await ddl(`DROP TRIGGER IF EXISTS avt_chg_u ON ${tbl}`);
      await ddl(`CREATE TRIGGER avt_chg_u AFTER UPDATE ON ${tbl} REFERENCING OLD TABLE AS avt_old NEW TABLE AS avt_new
                 FOR EACH STATEMENT EXECUTE FUNCTION avt_track_changes(${args})`);
      await ddl(`DROP TRIGGER IF EXISTS avt_chg_d ON ${tbl}`);
      await ddl(`CREATE TRIGGER avt_chg_d AFTER DELETE ON ${tbl} REFERENCING OLD TABLE AS avt_old
                 FOR EACH STATEMENT EXECUTE FUNCTION avt_track_changes(${args})`);
    }
  }).catch((e) => { schemaP = null; throw e; });
  return schemaP;
}

/* ------------------------------------------------------------------ */
/* O'qish — boshliq ilovasi uchun                                      */
/* ------------------------------------------------------------------ */
const ENTITY_TABLE = { session: 'sessions', expense: 'expenses', student: 'students', group: 'school_groups', school: 'driving_schools', instructor: 'instructors' };
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const owners = () => String(process.env.ANALYTICS_OWNER_KEYS || '').split(',').map((s) => s.trim()).filter(Boolean);

function send(res, status, data) {
  if (res.headersSent) return true;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
  return true;
}

async function safeRows(warnings, section, sql, params) {
  try { return (await pool.query(sql, params)).rows; }
  catch (e) { warnings.push({ section, error: String(e?.message || e).slice(0, 200) }); return []; }
}

/** Ism-familiyalar: login, mashina, o'quvchi, guruh, maktab, instruktor */
async function resolveNames(warnings, ids) {
  const uniq = (a) => [...new Set(a.filter(Boolean).map(String))];
  const q = (section, sql, list) => (list.length ? safeRows(warnings, section, sql, [list]) : Promise.resolve([]));
  const [users, vehicles, students, groups, schools, instructors] = await Promise.all([
    q('names_users', `SELECT id::text AS id, COALESCE(NULLIF(full_name, ''), username) AS name, username FROM users WHERE id::text = ANY($1::text[]) OR username = ANY($1::text[])`, uniq(ids.users)),
    q('names_vehicles', `SELECT id::text AS id, plate AS name FROM vehicles WHERE id::text = ANY($1::text[])`, uniq(ids.vehicles)),
    q('names_students', `SELECT id::text AS id, full_name AS name FROM students WHERE id::text = ANY($1::text[])`, uniq(ids.students)),
    q('names_groups', `SELECT id::text AS id, name FROM school_groups WHERE id::text = ANY($1::text[])`, uniq(ids.groups)),
    q('names_schools', `SELECT id::text AS id, name FROM driving_schools WHERE id::text = ANY($1::text[])`, uniq(ids.schools)),
    q('names_instructors', `SELECT id::text AS id, full_name AS name FROM instructors WHERE id::text = ANY($1::text[])`, uniq(ids.instructors)),
  ]);
  const m = (rows) => new Map(rows.map((r) => [String(r.id), r.name]));
  const um = m(users);
  for (const u of users) if (u.username) um.set(String(u.username), u.name);
  return { users: um, vehicles: m(vehicles), students: m(students), groups: m(groups), schools: m(schools), instructors: m(instructors) };
}

/* Ustun qiymati boshqa jadvalga ishora bo'lsa — nomi bilan */
const REF = { vehicle_id: 'vehicles', student_id: 'students', group_id: 'groups', school_id: 'schools', instructor_id: 'instructors' };

/* Yozuvning nomi (sarlavha uchun) */
function labelOf(tbl, row, names) {
  const g = (k) => (row && row[k] != null ? String(row[k]) : '');
  switch (tbl) {
    case 'sessions': return names.vehicles.get(g('vehicle_id')) || g('plate') || g('label') || 'Mashina yozuvi';
    case 'students': return g('full_name') || 'O‘quvchi';
    case 'driving_schools': return g('name') || 'Avtoshkola';
    case 'school_groups': return g('name') || 'Guruh';
    case 'instructors': return g('full_name') || 'Instruktor';
    case 'vehicles': return g('plate') || 'Mashina';
    case 'school_vehicles': return g('plate') || g('name') || 'Avtoshkola mashinasi';
    case 'expenses': return [g('category'), row && row.amount != null ? `${Math.round(n(row.amount))} so‘m` : ''].filter(Boolean).join(' · ') || 'Xarajat';
    case 'debt_payments': return row && row.amount != null ? `${Math.round(n(row.amount))} so‘m` : 'Qarz to‘lovi';
    case 'user_settings': case 'settings': return 'Narx sozlamalari';
    default: return tbl;
  }
}

/* change_log va db_changes BITTA so'rovda: bir tahrir ikkalasiga tushgan
   bo'lsa (o'sha yozuv, ±15 soniya) — change_log qatori db_changes'dagi
   «eski → yangi» bilan birga, db_changes qatori alohida chiqmaydi.
   Sahifalash (at, id) bo'yicha — sahifa chegarasida juftlik buzilmaydi. */
const MAP_SQL = `CASE c.entity WHEN 'session' THEN 'sessions' WHEN 'expense' THEN 'expenses' WHEN 'student' THEN 'students'
  WHEN 'group' THEN 'school_groups' WHEN 'school' THEN 'driving_schools' WHEN 'instructor' THEN 'instructors' ELSE NULL END`;
function unionSql(ownC, ownD) {
  return `
    SELECT 'log' AS kind, 'log:' || c.id::text AS id, c.created_at AS at, c.owner_key::text AS own,
           c.entity, c.entity_id, c.entity_name, c.action, c.field, c.old_value, c.new_value, c.reason, c.actor,
           m.tbl, m.op, m.row_id, m.changes, 1 AS n_rows
      FROM change_log c
      LEFT JOIN LATERAL (
        SELECT d.tbl, d.op, d.row_id, d.changes FROM db_changes d
         WHERE d.tbl = ${MAP_SQL} AND d.row_id = c.entity_id
           AND d.at BETWEEN c.created_at - interval '15 seconds' AND c.created_at + interval '15 seconds'
         ORDER BY abs(extract(epoch FROM d.at - c.created_at)) LIMIT 1) m ON TRUE
     WHERE c.created_at >= $1 AND c.created_at < $2${ownC}
       AND c.action <> 'ticket_print'
    UNION ALL
    SELECT 'db', 'db:' || lpad(d.id::text, 12, '0'), d.at, d.owner_key,
           NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, d.actor,
           d.tbl, d.op, d.row_id, d.changes, d.n_rows
      FROM db_changes d
     WHERE d.at >= $1 AND d.at < $2${ownD}
       AND NOT EXISTS (SELECT 1 FROM change_log c
                        WHERE c.action <> 'ticket_print' AND ${MAP_SQL} = d.tbl AND c.entity_id = d.row_id
                          AND c.created_at BETWEEN d.at - interval '15 seconds' AND d.at + interval '15 seconds')`;
}
const US = (col) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export async function buildEdits(range, opt = {}) {
  const warnings = [];
  await ensureAuditSchema().catch(() => {});
  await ensureEditsSchema().catch((e) => warnings.push({ section: 'schema', error: String(e?.message || e).slice(0, 200) }));
  const keys = owners();
  const limit = Math.max(1, Math.min(300, Number(opt.limit) || 150));
  /* kursor: «<vaqt mikrosoniyada>|<id>» */
  const [curAt, curId] = String(opt.before || '').split('|');
  const hasCur = curAt && !Number.isNaN(Date.parse(curAt));
  const params = [range.from.toISOString(), range.to.toISOString()];
  let ownC = '', ownD = '';
  if (keys.length) { params.push(keys); ownC = ` AND c.owner_key::text = ANY($${params.length}::text[])`; ownD = ` AND d.owner_key::text = ANY($${params.length}::text[])`; }
  const base = unionSql(ownC, ownD);
  const pageParams = [...params];
  let curSql = '';
  if (hasCur) { pageParams.push(curAt, curId || '~'); curSql = ` WHERE (u.at, u.id) < ($${pageParams.length - 1}::timestamptz, $${pageParams.length}::text)`; }
  pageParams.push(limit + 1);

  const [rows, sum] = await Promise.all([
    safeRows(warnings, 'edits', `SELECT u.*, ${US('u.at')} AS at_us FROM (${base}) u${curSql}
      ORDER BY u.at DESC, u.id DESC LIMIT $${pageParams.length}`, pageParams),
    safeRows(warnings, 'edits_days', `SELECT to_char(u.at AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM-DD') AS day, COUNT(*)::int AS n,
        COUNT(*) FILTER (WHERE u.op = 'D' OR u.action ILIKE '%delete%' OR u.action ILIKE '%cancel%')::int AS deleted
      FROM (${base}) u GROUP BY 1 ORDER BY 1`, params),
  ]);
  const more = rows.length > limit;
  const page = rows.slice(0, limit);

  /* Hozirgi qatorlar — tahrirlangan yozuvning nomi uchun (o'chirilganniki — o'z nusxasida) */
  const byTbl = new Map();
  for (const d of page) if (d.tbl && d.row_id && d.op === 'U') {
    if (!byTbl.has(d.tbl)) byTbl.set(d.tbl, new Set());
    byTbl.get(d.tbl).add(String(d.row_id));
  }
  const current = new Map();
  await Promise.all([...byTbl.entries()].map(async ([tbl, set]) => {
    const t = TRACKED.find((x) => x[0] === tbl);
    if (!t) return;
    const rs = await safeRows(warnings, `rows_${tbl}`, `SELECT to_jsonb(x) AS j FROM ${tbl} x WHERE (to_jsonb(x)->>'${t[1]}') = ANY($1::text[])`, [[...set]]);
    for (const r of rs) current.set(`${tbl}|${r.j[t[1]]}`, r.j);
  }));
  /* O'chirilgan yozuvning nusxasi — undan oldingi tahrirlarga ham nom bo'ladi */
  const delSnap = new Map();
  for (const d of page) if (d.op === 'D' && d.changes) delSnap.set(`${d.tbl}|${d.row_id}`, d.changes);
  const snapOf = (d) => {
    if (d.op === 'D') return d.changes || {};
    const cur = current.get(`${d.tbl}|${d.row_id}`) || delSnap.get(`${d.tbl}|${d.row_id}`);
    if (cur) return cur;
    /* qator yo'q — diff'dagi yangi qiymatlardan */
    const o = {};
    for (const [k, v] of Object.entries(d.changes || {})) o[k] = Array.isArray(v) ? v[1] : v;
    return o;
  };

  /* Nomlar uchun ID'lar */
  const ids = { users: [], vehicles: [], students: [], groups: [], schools: [], instructors: [] };
  for (const d of page) {
    ids.users.push(d.actor);
    if (!d.tbl) continue;
    const row = snapOf(d);
    if (row && row.vehicle_id) ids.vehicles.push(row.vehicle_id);
    if (d.op === 'U') for (const [col, val] of Object.entries(d.changes || {})) {
      const ref = REF[col];
      if (!ref) continue;
      for (const v of (Array.isArray(val) ? val : [val])) if (v != null) ids[ref].push(v);
    }
  }
  const names = await resolveNames(warnings, ids);
  const who = (a) => (a ? names.users.get(String(a)) || (!/^[0-9a-f-]{32,36}$/i.test(String(a)) ? String(a) : null) : null);

  const items = page.map((d) => {
    const snap = d.tbl ? snapOf(d) : null;
    const fields = [];
    if (d.op === 'U') {
      for (const [col, pair] of Object.entries(d.changes || {})) {
        const [ov, nv] = Array.isArray(pair) ? pair : [null, pair];
        const ref = REF[col];
        fields.push({ col, old: ov, new: nv,
          old_name: ref && ov != null ? names[ref].get(String(ov)) || null : null,
          new_name: ref && nv != null ? names[ref].get(String(nv)) || null : null });
      }
    }
    const base_ = { id: d.id, at: d.at_us || d.at, source: 'avtodrom12', kind: d.kind, table: d.tbl || null,
      op: d.op === 'D' ? 'delete' : d.op === 'U' ? 'update' : null, row_id: d.row_id || null,
      bulk: n(d.n_rows) > 1 ? n(d.n_rows) : 0, fields, snapshot: d.op === 'D' ? snap : null,
      actor: who(d.actor), actor_id: d.actor || null };
    if (d.kind === 'log') {
      return { ...base_, entity: d.entity, entity_id: d.entity_id, action: d.action,
        title: d.entity_name || (snap ? labelOf(d.tbl, snap, names) : null),
        field: d.field || null, old: d.old_value, new: d.new_value, reason: d.reason || null };
    }
    return { ...base_, title: labelOf(d.tbl, snap, names) };
  });

  const days = sum.map((r) => ({ day: r.day, n: n(r.n), deleted: n(r.deleted) }));
  const last = page[page.length - 1];
  return {
    ok: true, source: 'avtodrom12', generated_at: new Date().toISOString(),
    from_day: range.fromYmd, to_day: range.toYmd,
    total: days.reduce((a, x) => a + x.n, 0),
    deleted: days.reduce((a, x) => a + x.deleted, 0),
    days,
    items,
    next_before: more && last ? `${last.at_us}|${last.id}` : null,
    warnings,
  };
}

export async function handleEditsBridge(req, res) {
  const url = new URL(String(req.url || '/'), 'http://local');
  if (url.pathname !== '/api/bridge/edits') return false;
  if (String(req.method || 'GET').toUpperCase() !== 'GET') return send(res, 405, { ok: false, error: 'Faqat GET' });
  if (!bridgeKeysConfigured()) return send(res, 503, { ok: false, error: 'Ko‘prik kaliti sozlanmagan' });
  if (!checkBridgeKey(req)) return send(res, 401, { ok: false, error: 'Kalit noto‘g‘ri' });
  const range = bridgeRange(url.searchParams);
  if (range.error) return send(res, 400, { ok: false, error: range.error });
  try {
    return send(res, 200, await buildEdits(range, { before: url.searchParams.get('before'), limit: url.searchParams.get('limit') }));
  } catch (e) {
    console.error('BRIDGE EDITS:', e?.message || e);
    return send(res, 500, { ok: false, error: 'Tahrirlar o‘qilmadi' });
  }
}
