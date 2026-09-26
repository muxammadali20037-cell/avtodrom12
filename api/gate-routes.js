import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { pool } from '../backend/src/db.js';

/* =========================================================================
   TURNIKET — kirish joyidagi QR nazorati

   OQIM
     1) Kassa vaqt ochadi (platniy) yoki davomat yozadi (avtoshkola).
        Chek chiqishidan oldin index.html shu sessiya uchun TURNIKET
        KODI so'raydi: POST /api/gate/passes { session_id }.
        Kod — 12 xonali raqam, chekda QR bo'lib bosiladi.
     2) O'quvchi turniketdagi skanerga chekni tutadi. Turniket ekrani
        (turniket.html) kodni POST /api/gate/scan ga yuboradi.
          • chek hali ishlatilmagan  -> KIRDI, turniket kirishga ochiladi
          • o'quvchi ichkarida       -> CHIQDI, vaqt yopiladi, chiqishga ochiladi
          • chek ishlatib bo'lingan  -> rad etiladi (chekni boshqaga berib
                                        bo'lmaydi)
     3) «Turniket» bo'limida: hozir kim ichkarida, kim to'lagan vaqtidan
        oshib ketgan, kun bo'yicha platniy va avtoshkola soatlari.

   NIMA O'ZGARMAYDI
     Sessiyalar, to'lov va darslar soni avvalgidek qoladi. Turniket faqat
     o'zining gate_passes / gate_events jadvallariga yozadi. Shuning uchun
     kunlik hisobot va «Nazorat» raqamlari buzilmaydi.

   KIM MUROJAAT QILADI
     Operator (JWT, index.html):
       POST /api/gate/passes                 — sessiya uchun kod (bor bo'lsa o'shani qaytaradi)
       GET  /api/gate/overview?date=         — kun hisoboti + hozir ichkaridagilar
       GET  /api/gate/alerts                 — menyudagi belgi uchun (vaqtidan oshganlar soni)
       POST /api/gate/passes/:id/close       — chiqishda urmay ketganni yopish (sabab bilan)
       POST /api/gate/passes/:id/cancel      — ishlatilmagan chekni bekor qilish
       GET/POST /api/gate/devices            — turniket qurilmalari (kalit beriladi)
       POST /api/gate/devices/:id/revoke     — qurilmani o'chirish
       GET/PUT  /api/gate/settings           — chegirma daqiqasi
     Turniket qurilmasi (X-Gate-Key, turniket.html):
       GET  /api/gate/ping                   — kalit ishlayaptimi
       POST /api/gate/scan                   — QR urildi
       POST /api/gate/manual                 — qo'lda ochildi (sabab majburiy)
       GET  /api/gate/cache                  — internet uzilsa ishlash uchun ro'yxat
   ========================================================================= */

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
const TZ = 'Asia/Tashkent';
const DEFAULT_GRACE_MIN = 15;
/* Kirgandan (yoki chiqqandan) keyin shu soniya ichida chek yana urilsa,
   bu yangi harakat emas: odam turniketdan o'tib ulgurmagan va qayta
   uryapti. Holat o'zgarmaydi, turniket O'SHA tomonga qayta ochiladi.
   Aks holda kirolmagan odam ikkinchi urishda «chiqdi» bo'lib qolardi. */
const REOPEN_SEC = 60;

const text = v => String(v ?? '').trim();
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);

function send(res, status, data) {
  if (res.headersSent) return true;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
  return true;
}

function userId(req) {
  try {
    const h = req.headers?.authorization || '';
    if (!h.startsWith('Bearer ')) return null;
    return String(jwt.verify(h.slice(7), JWT_SECRET).sub);
  } catch { return null; }
}

/* Faqat POST/PUT da chaqiriladi — GET da oqimga tegilmaydi. */
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  let parsed = {};
  try { parsed = raw ? JSON.parse(raw) : {}; } catch { parsed = {}; }
  req.body = parsed; req._body = true;
  return parsed;
}

/* ---------------- SXEMA (birinchi so'rovda o'zi yaratiladi) ---------------- */
let schemaPromise = null;
export function ensureGateSchema() {
  if (schemaPromise) return schemaPromise;
  const first = [];
  schemaPromise = (async () => {
    const q = async sql => { try { await pool.query(sql); } catch (e) { first.push(e); console.error('GATE SCHEMA:', e.message); } };
    await q(`
      CREATE TABLE IF NOT EXISTS gate_passes(
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id TEXT NOT NULL,
        code VARCHAR(16) NOT NULL,
        kind VARCHAR(12) NOT NULL DEFAULT 'paid',
        session_id TEXT NULL,
        student_id TEXT NULL,
        person_name TEXT NULL,
        school_name TEXT NULL,
        instructor_name TEXT NULL,
        plate TEXT NULL,
        paid_minutes INTEGER NOT NULL DEFAULT 60,
        status VARCHAR(12) NOT NULL DEFAULT 'issued',
        issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        valid_until TIMESTAMPTZ NOT NULL,
        in_at TIMESTAMPTZ NULL,
        out_at TIMESTAMPTZ NULL,
        closed_by VARCHAR(12) NULL,
        note TEXT NULL
      )`);
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS idx_gate_passes_code ON gate_passes(code)`);
    /* Bitta sessiyaga bitta kod: chek qayta chop etilsa o'sha kod chiqadi */
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS idx_gate_passes_session
             ON gate_passes(session_id) WHERE session_id IS NOT NULL`);
    await q(`CREATE INDEX IF NOT EXISTS idx_gate_passes_user_issued ON gate_passes(user_id, issued_at DESC)`);
    await q(`CREATE INDEX IF NOT EXISTS idx_gate_passes_user_in ON gate_passes(user_id, in_at DESC)`);
    await q(`CREATE INDEX IF NOT EXISTS idx_gate_passes_inside ON gate_passes(user_id) WHERE status='inside'`);

    await q(`
      CREATE TABLE IF NOT EXISTS gate_events(
        id BIGSERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        pass_id UUID NULL,
        code TEXT NULL,
        direction VARCHAR(12) NULL,
        result VARCHAR(12) NOT NULL,
        reason TEXT NULL,
        device_id UUID NULL,
        at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        offline BOOLEAN NOT NULL DEFAULT FALSE,
        client_id TEXT NULL
      )`);
    /* Internet qaytganda navbatdagi hodisalar qayta yuborilsa ikki marta yozilmasin */
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS idx_gate_events_client ON gate_events(client_id) WHERE client_id IS NOT NULL`);
    await q(`CREATE INDEX IF NOT EXISTS idx_gate_events_user_at ON gate_events(user_id, at DESC)`);

    await q(`
      CREATE TABLE IF NOT EXISTS gate_devices(
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        key_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NULL,
        revoked_at TIMESTAMPTZ NULL
      )`);
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS idx_gate_devices_key ON gate_devices(key_hash)`);

    await q(`
      CREATE TABLE IF NOT EXISTS gate_settings(
        user_id TEXT PRIMARY KEY,
        grace_minutes INTEGER NOT NULL DEFAULT ${DEFAULT_GRACE_MIN},
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    /* Chekka QR chiqsinmi. Boshida O'CHIQ: turniket o'rnatilmaguncha
       chek avvalgidek chiqadi, kassa kod so'rab kutmaydi. */
    await q(`ALTER TABLE gate_settings ADD COLUMN IF NOT EXISTS qr_on_ticket BOOLEAN NOT NULL DEFAULT FALSE`);
    if (first.length) { schemaPromise = null; throw first[0]; }
  })().catch(e => { schemaPromise = null; throw e; });
  return schemaPromise;
}

/* ---------------- Yordamchilar ---------------- */

/** 12 xonali tasodifiy raqam. Faqat raqam — klaviatura tili (kirill /
    lotin) skanerga ta'sir qilmaydi va kerak bo'lsa qo'lda terish oson. */
function newCode() {
  const n = BigInt('0x' + crypto.randomBytes(8).toString('hex')) % 900000000000n + 100000000000n;
  return n.toString();
}

/** Skaner nima yuborsa ham (bo'shliq, tire, havola) — 12 ta raqamni oladi. */
function normCode(v) {
  const d = String(v || '').replace(/\D/g, '');
  return /^\d{12}$/.test(d) ? d : '';
}

const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');

/** Qurilma yuborgan vaqt. Internet uzilganda hodisa keyin yuboriladi —
    shunda haqiqiy urilgan payt kerak. Juda eski yoki kelajakdagi vaqt
    qabul qilinmaydi (qurilma soati noto'g'ri bo'lsa hisob buzilmasin). */
function clientTime(v) {
  const now = Date.now();
  const t = v ? new Date(v).getTime() : NaN;
  if (!Number.isFinite(t)) return new Date(now);
  if (t > now + 2 * 60 * 1000) return new Date(now);
  if (t < now - 36 * 3600 * 1000) return new Date(now);
  return new Date(t);
}

/** YYYY-MM-DD (Toshkent) kunining boshlanish va tugash vaqti — SQL uchun. */
const DAY_START = n => `($${n}::date::timestamp AT TIME ZONE '${TZ}')`;
const DAY_END = n => `(($${n}::date + 1)::timestamp AT TIME ZONE '${TZ}')`;

function todayTashkent() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function hhmm(v) {
  if (!v) return '—';
  return new Date(v).toLocaleTimeString('uz-UZ', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
}

function durText(sec) {
  sec = Math.max(0, Math.round(num(sec)));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  if (!h) return m + ' daqiqa';
  return h + ' soat' + (m ? ' ' + m + ' daqiqa' : '');
}

/* sessions.id turi (odatda uuid). JOIN va qidiruvda `s.id::text` yozilsa
   indeks ishlamaydi va har chek chop etilganda butun sessions jadvali
   o'qiladi. Shuning uchun turni bir marta aniqlab, kodni o'sha turga
   keltiramiz. */
let sidCastPromise = null;
function sessionIdCast() {
  if (!sidCastPromise) {
    sidCastPromise = pool.query(
      `SELECT data_type FROM information_schema.columns
        WHERE table_schema='public' AND table_name='sessions' AND column_name='id'`)
      .then(r => {
        const t = String((r.rows[0] && r.rows[0].data_type) || '');
        return t === 'uuid' ? '::uuid' : t === 'bigint' ? '::bigint' : t === 'integer' ? '::integer' : '::text';
      })
      .catch(() => { sidCastPromise = null; return '::text'; });
  }
  return sidCastPromise;
}
function validSessionId(v, cast) {
  if (cast === '::uuid') return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
  if (cast === '::bigint' || cast === '::integer') return /^\d{1,18}$/.test(v);
  return !!v;
}

async function graceMinutes(user) {
  try {
    const r = await pool.query(`SELECT grace_minutes FROM gate_settings WHERE user_id=$1`, [user]);
    return r.rows[0] ? Math.max(0, num(r.rows[0].grace_minutes)) : DEFAULT_GRACE_MIN;
  } catch { return DEFAULT_GRACE_MIN; }
}

/** Kod qatori -> ekranga chiqadigan ko'rinish (vaqtlar hisoblangan). */
function passView(p, now, grace) {
  const inAt = p.in_at ? new Date(p.in_at) : null;
  const outAt = p.out_at ? new Date(p.out_at) : null;
  const used = inAt ? Math.max(0, Math.round(((outAt || now) - inAt) / 1000)) : 0;
  const paid = Math.max(0, num(p.paid_minutes)) * 60;
  const over = inAt ? Math.max(0, used - paid) : 0;
  return {
    id: p.id,
    code: p.code,
    kind: p.kind,
    status: p.status,
    person: p.person_name || null,
    school: p.school_name || null,
    instructor: p.instructor_name || null,
    plate: p.plate || null,
    paid_minutes: num(p.paid_minutes),
    issued_at: p.issued_at,
    valid_until: p.valid_until,
    in_at: p.in_at,
    out_at: p.out_at,
    used_seconds: used,
    left_seconds: inAt ? Math.max(0, paid - used) : paid,
    over_seconds: over,
    overdue: over > grace * 60,
    session_id: p.session_id || null,
    session_status: p.session_status || null,
    closed_by: p.closed_by || null,
    note: p.note || null,
  };
}

async function logEvent(db, ev) {
  try {
    await db.query(`
      INSERT INTO gate_events(user_id, pass_id, code, direction, result, reason, device_id, at, offline, client_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT DO NOTHING`,
      [ev.user, ev.passId || null, ev.code || null, ev.direction || null, ev.result,
       ev.reason || null, ev.deviceId || null, ev.at || new Date(), !!ev.offline, ev.clientId || null]);
  } catch (e) { console.error('[gate] hodisa yozilmadi:', e.message); }
}

/* =========================================================================
   OPERATOR — chek uchun kod
   ========================================================================= */

/** Sessiya uchun turniket kodi. Bir sessiyaga bitta kod: chek qayta chop
    etilsa ham o'sha kod qaytadi. Ma'lumot (kim, necha soat) mijozdan
    emas, BAZADAGI sessiyadan olinadi — kassada soatni o'zgartirib
    «ko'proq vaqt» kodini olib bo'lmaydi. */
async function createPass(req, res, user) {
  const b = await readBody(req);
  const sid = text(b.session_id || b.sessionId);
  if (!sid) return send(res, 400, { error: 'session_id kerak' });

  const ex = await pool.query(
    `SELECT * FROM gate_passes WHERE session_id=$1 AND user_id=$2`, [sid, user]);
  if (ex.rows[0]) {
    const g = await graceMinutes(user);
    return send(res, 200, { pass: passView(ex.rows[0], new Date(), g), existing: true });
  }

  /* Ustunlar to'plami o'rnatmadan o'rnatmaga farq qiladi — sessiyani
     to'liq JSON qilib olamiz, yo'q ustun xato bermaydi. */
  const cast = await sessionIdCast();
  if (!validSessionId(sid, cast)) return send(res, 404, { error: 'Sessiya topilmadi' });
  const sr = await pool.query(
    `SELECT to_jsonb(s) AS s FROM sessions s WHERE s.id = $1${cast} AND s.user_id::text=$2`, [sid, user]);
  const s = sr.rows[0] && sr.rows[0].s;
  if (!s) return send(res, 404, { error: 'Sessiya topilmadi' });
  if (String(s.status || '') === 'cancelled') return send(res, 409, { error: 'Bu yozuv bekor qilingan' });

  const kind = String(s.customer_type || '') === 'school' ? 'school' : 'paid';

  /* To'langan (ruxsat berilgan) vaqt: platniyda ochilgan soat,
     avtoshkolada darslar soni × 60 daqiqa. */
  let minutes = 0;
  if (num(s.target_duration) > 0) minutes = Math.round(num(s.target_duration) / 60);
  else if (num(s.lessons_counted) > 0) minutes = num(s.lessons_counted) * 60;
  else if (num(s.planned_minutes) > 0) minutes = num(s.planned_minutes);
  if (!minutes) minutes = 60;
  minutes = Math.min(12 * 60, Math.max(15, minutes));

  let person = text(s.driver_name) || null, school = null, plate = null;
  if (s.student_id) {
    try {
      const st = await pool.query(
        `SELECT st.full_name, ds.name AS school_name FROM students st
           LEFT JOIN driving_schools ds ON ds.id = st.school_id
          WHERE st.id::text=$1`, [String(s.student_id)]);
      if (st.rows[0]) { person = st.rows[0].full_name || person; school = st.rows[0].school_name || null; }
    } catch (e) { console.error('[gate] o‘quvchi o‘qilmadi:', e.message); }
  }
  if (s.vehicle_id) {
    try {
      const v = await pool.query(`SELECT plate FROM vehicles WHERE id::text=$1`, [String(s.vehicle_id)]);
      plate = v.rows[0] ? v.rows[0].plate : null;
    } catch (e) { console.error('[gate] avtomobil o‘qilmadi:', e.message); }
  }

  for (let i = 0; i < 6; i++) {
    const code = newCode();
    try {
      const r = await pool.query(`
        INSERT INTO gate_passes(user_id, code, kind, session_id, student_id, person_name, school_name,
                                instructor_name, plate, paid_minutes, valid_until)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
               ((NOW() AT TIME ZONE '${TZ}')::date + 1)::timestamp AT TIME ZONE '${TZ}')
        RETURNING *`,
        [user, code, kind, sid, s.student_id ? String(s.student_id) : null, person, school,
         text(s.instructor_name) || null, plate, minutes]);
      const g = await graceMinutes(user);
      return send(res, 201, { pass: passView(r.rows[0], new Date(), g) });
    } catch (e) {
      if (e.code !== '23505') throw e;
      /* Shu sessiyaga parallel so'rov kod yaratib ulgurgan bo'lsa — o'shani qaytaramiz */
      const again = await pool.query(`SELECT * FROM gate_passes WHERE session_id=$1 AND user_id=$2`, [sid, user]);
      if (again.rows[0]) {
        const g = await graceMinutes(user);
        return send(res, 200, { pass: passView(again.rows[0], new Date(), g), existing: true });
      }
      /* aks holda kod to'qnashdi — yangisini sinaymiz */
    }
  }
  return send(res, 500, { error: 'Kod yaratilmadi, qayta urinib ko‘ring' });
}

/* =========================================================================
   OPERATOR — hisobot
   ========================================================================= */
async function overview(req, res, user, search) {
  const dateRaw = text(search.get('date'));
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : todayTashkent();
  const isToday = date === todayTashkent();
  const now = new Date();
  const grace = await graceMinutes(user);
  const cast = await sessionIdCast();

  const pr = await pool.query(`
    SELECT p.*, s.status AS session_status
      FROM gate_passes p
      LEFT JOIN sessions s ON s.id = p.session_id${cast}
     WHERE p.user_id=$1 AND (
             (p.issued_at >= ${DAY_START(2)} AND p.issued_at < ${DAY_END(2)})
          OR (p.in_at     >= ${DAY_START(2)} AND p.in_at     < ${DAY_END(2)})
          ${isToday ? `OR p.status='inside'` : ''})
     ORDER BY COALESCE(p.in_at, p.issued_at) DESC
     LIMIT 1500`, [user, date]);
  const passes = pr.rows.map(p => passView(p, now, grace));

  const blank = () => ({ issued: 0, entered: 0, inside: 0, done: 0, noShow: 0,
                         paidMinutes: 0, usedSeconds: 0, overSeconds: 0, overdue: 0 });
  const sum = { paid: blank(), school: blank(), total: blank() };
  for (const p of passes) {
    for (const k of [p.kind === 'school' ? 'school' : 'paid', 'total']) {
      const t = sum[k];
      if (p.status === 'cancelled') continue;
      t.issued++;
      if (p.in_at) {
        t.entered++;
        t.paidMinutes += p.paid_minutes;
        t.usedSeconds += p.used_seconds;
        t.overSeconds += p.over_seconds;
        if (p.overdue) t.overdue++;
      } else {
        t.noShow++;
      }
      if (p.status === 'inside') t.inside++;
      if (p.status === 'done') t.done++;
    }
  }

  /* SOATLAR KESIMIDA: har soatda ichkarida nechta platniy va nechta
     avtoshkola o'quvchisi bo'lgan (kamida 1 daqiqa). */
  const dayStart = new Date(date + 'T00:00:00+05:00');
  const hours = [];
  for (let h = 0; h < 24; h++) {
    const a = new Date(dayStart.getTime() + h * 3600e3), b = new Date(a.getTime() + 3600e3);
    const row = { hour: h, paid: 0, school: 0 };
    for (const p of passes) {
      if (!p.in_at || p.status === 'cancelled') continue;
      const s = new Date(p.in_at), e = p.out_at ? new Date(p.out_at) : now;
      if (Math.min(e, b) - Math.max(s, a) >= 60e3) row[p.kind === 'school' ? 'school' : 'paid']++;
    }
    hours.push(row);
  }

  const er = await pool.query(`
    SELECT e.id, e.code, e.direction, e.result, e.reason, e.at, e.offline,
           d.name AS device_name, COALESCE(p.person_name, p.plate) AS person_name, p.kind
      FROM gate_events e
      LEFT JOIN gate_devices d ON d.id = e.device_id
      LEFT JOIN gate_passes p  ON p.id = e.pass_id
     WHERE e.user_id=$1 AND e.at >= ${DAY_START(2)} AND e.at < ${DAY_END(2)}
     ORDER BY e.at DESC
     LIMIT 300`, [user, date]);
  const events = er.rows;
  const denied = events.filter(e => e.result === 'denied').length;
  const manual = events.filter(e => /^manual/.test(String(e.direction || ''))).length;

  const dr = await pool.query(`
    SELECT id, name, created_at, last_seen_at, revoked_at FROM gate_devices
     WHERE user_id=$1 ORDER BY revoked_at NULLS FIRST, created_at DESC`, [user]);

  const qrOn = (await settingsOf(user)).qr_on_ticket;
  return send(res, 200, {
    date, isToday, now: now.toISOString(), graceMinutes: grace, qrOnTicket: qrOn,
    summary: sum, denied, manual,
    inside: passes.filter(p => p.status === 'inside')
                  .sort((a, b) => b.over_seconds - a.over_seconds || a.left_seconds - b.left_seconds),
    passes, hours, events,
    devices: dr.rows,
  });
}

/** Menyudagi belgi uchun: nechta odam ichkarida, nechtasi vaqtidan oshgan */
async function alerts(req, res, user) {
  const grace = await graceMinutes(user);
  const r = await pool.query(`
    SELECT COUNT(*)::int AS inside,
           COUNT(*) FILTER (WHERE in_at + make_interval(mins => paid_minutes + $2) < NOW())::int AS overdue
      FROM gate_passes WHERE user_id=$1 AND status='inside'`, [user, grace]);
  return send(res, 200, r.rows[0] || { inside: 0, overdue: 0 });
}

/** Chiqishda chekni urmay ketgan odamni operator yopadi. Sabab majburiy —
    keyin «nega qo'lda yopilgan» degan savolga javob shu yerda. */
async function closePass(req, res, user, id, mode) {
  const b = await readBody(req);
  const reason = text(b.reason);
  if (reason.length < 3) return send(res, 400, { error: 'Sababni yozing (kamida 3 harf)' });
  const r = mode === 'close'
    ? await pool.query(`
        UPDATE gate_passes SET status='done', out_at=NOW(), closed_by='operator',
               note=TRIM(COALESCE(note || ' · ','') || $3)
         WHERE id::text=$1 AND user_id=$2 AND status='inside' RETURNING *`, [id, user, reason])
    : await pool.query(`
        UPDATE gate_passes SET status='cancelled', closed_by='operator',
               note=TRIM(COALESCE(note || ' · ','') || $3)
         WHERE id::text=$1 AND user_id=$2 AND status='issued' RETURNING *`, [id, user, reason]);
  const p = r.rows[0];
  if (!p) return send(res, 409, { error: mode === 'close' ? 'Bu odam ichkarida emas' : 'Chek allaqachon ishlatilgan' });
  await logEvent(pool, { user, passId: p.id, code: p.code, direction: mode === 'close' ? 'manual_out' : 'cancel',
                         result: 'ok', reason: 'Operator: ' + reason });
  return send(res, 200, { pass: passView(p, new Date(), await graceMinutes(user)) });
}

/* ---------------- Qurilmalar ---------------- */
async function listDevices(req, res, user) {
  const r = await pool.query(`
    SELECT id, name, created_at, last_seen_at, revoked_at FROM gate_devices
     WHERE user_id=$1 ORDER BY revoked_at NULLS FIRST, created_at DESC`, [user]);
  return send(res, 200, { devices: r.rows });
}

/** Yangi turniket qurilmasi. Kalit FAQAT shu javobda ko'rinadi — bazada
    uning xeshi saqlanadi. Kalit yo'qolsa qurilma o'chirilib, yangisi
    qo'shiladi. */
async function addDevice(req, res, user) {
  const b = await readBody(req);
  const name = text(b.name).slice(0, 60) || 'Turniket';
  const key = crypto.randomBytes(24).toString('base64url');
  const r = await pool.query(`
    INSERT INTO gate_devices(user_id, name, key_hash) VALUES($1,$2,$3)
    RETURNING id, name, created_at, last_seen_at, revoked_at`, [user, name, sha(key)]);
  return send(res, 201, { device: r.rows[0], key });
}

async function revokeDevice(req, res, user, id) {
  const r = await pool.query(`
    UPDATE gate_devices SET revoked_at=NOW()
     WHERE id::text=$1 AND user_id=$2 AND revoked_at IS NULL RETURNING id`, [id, user]);
  if (!r.rows[0]) return send(res, 404, { error: 'Qurilma topilmadi' });
  return send(res, 200, { ok: true });
}

async function settingsOf(user) {
  const r = await pool.query(`SELECT grace_minutes, qr_on_ticket FROM gate_settings WHERE user_id=$1`, [user]);
  const row = r.rows[0];
  return {
    grace_minutes: row ? Math.max(0, num(row.grace_minutes)) : DEFAULT_GRACE_MIN,
    qr_on_ticket: !!(row && row.qr_on_ticket),
  };
}
async function readSettings(req, res, user) {
  return send(res, 200, await settingsOf(user));
}
/** Faqat yuborilgan maydon o'zgaradi: chegirmani saqlash QR sozlamasini
    o'chirib yubormasin va aksincha. */
async function writeSettings(req, res, user) {
  const b = await readBody(req);
  const cur = await settingsOf(user);
  const rawG = b.grace_minutes ?? b.graceMinutes;
  const g = rawG === undefined || rawG === null || rawG === ''
    ? cur.grace_minutes : Math.min(240, Math.max(0, Math.round(num(rawG))));
  const rawQ = b.qr_on_ticket ?? b.qrOnTicket;
  const qr = rawQ === undefined || rawQ === null ? cur.qr_on_ticket : (rawQ === true || rawQ === 'true' || rawQ === 1);
  await pool.query(`
    INSERT INTO gate_settings(user_id, grace_minutes, qr_on_ticket, updated_at) VALUES($1,$2,$3,NOW())
    ON CONFLICT (user_id) DO UPDATE SET grace_minutes=EXCLUDED.grace_minutes,
      qr_on_ticket=EXCLUDED.qr_on_ticket, updated_at=NOW()`, [user, g, qr]);
  return send(res, 200, { grace_minutes: g, qr_on_ticket: qr });
}

/* =========================================================================
   TURNIKET QURILMASI
   ========================================================================= */

async function deviceOf(req) {
  const key = text(req.headers?.['x-gate-key']);
  if (key.length < 20) return null;
  const r = await pool.query(`
    SELECT id, user_id, name FROM gate_devices WHERE key_hash=$1 AND revoked_at IS NULL`, [sha(key)]);
  const d = r.rows[0];
  if (!d) return null;
  /* Oxirgi aloqa — «qurilma ishlayaptimi» ko'rinishi uchun (daqiqada bir marta) */
  pool.query(`UPDATE gate_devices SET last_seen_at=NOW()
               WHERE id=$1 AND (last_seen_at IS NULL OR last_seen_at < NOW() - INTERVAL '1 minute')`, [d.id])
    .catch(() => {});
  return d;
}

/** QR urildi: kirish yoki chiqishni hal qiladi. */
async function scan(req, res, dev) {
  const b = await readBody(req);
  const code = normCode(b.code);
  const at = clientTime(b.at);
  const offline = !!b.offline;
  const clientId = text(b.client_id).slice(0, 80) || null;
  const user = dev.user_id;
  const grace = await graceMinutes(user);

  /* Qayta yuborilgan hodisa (internet qaytganda) — ikkinchi marta ishlanmaydi */
  if (clientId) {
    const ex = await pool.query(`SELECT result, direction, reason FROM gate_events WHERE client_id=$1`, [clientId]);
    if (ex.rows[0]) {
      const e = ex.rows[0];
      return send(res, 200, { ok: e.result === 'ok', open: e.result === 'ok' ? e.direction : null,
                              duplicate: true, title: e.result === 'ok' ? 'Qabul qilingan' : 'Rad etilgan',
                              message: e.reason || '' });
    }
  }

  const deny = async (title, message, pass) => {
    await logEvent(pool, { user, passId: pass && pass.id, code: code || text(b.code).slice(0, 40),
                           direction: null, result: 'denied', reason: title + (message ? ': ' + message : ''),
                           deviceId: dev.id, at, offline, clientId });
    return send(res, 200, { ok: false, open: null, title, message,
                            pass: pass ? passView(pass, at, grace) : null });
  };

  if (!code) return deny('Kod o‘qilmadi', 'Bu turniket cheki emas. Kassadagi yangi chekni ko‘rsating.');

  const cast = await sessionIdCast();
  const c = await pool.connect();
  let committed = false;
  try {
    await c.query('BEGIN');
    const r = await c.query(`
      SELECT p.*, s.status AS session_status
        FROM gate_passes p
        LEFT JOIN sessions s ON s.id = p.session_id${cast}
       WHERE p.code=$1 AND p.user_id=$2
       FOR UPDATE OF p`, [code, user]);
    const p = r.rows[0];

    const finish = async (upd, direction, title, message, reason) => {
      let row = p;
      if (upd) {
        const u = await c.query(upd.sql, upd.args);
        row = Object.assign({}, u.rows[0], { session_status: p.session_status });
      }
      await logEvent(c, { user, passId: p.id, code, direction, result: 'ok', reason: reason || null,
                          deviceId: dev.id, at, offline, clientId });
      await c.query('COMMIT'); committed = true;
      return send(res, 200, { ok: true, open: direction, title, message, pass: passView(row, at, grace) });
    };
    const stop = async (title, message) => {
      await c.query('ROLLBACK'); committed = true;
      return deny(title, message, p);
    };

    if (!p) return await stop('Chek topilmadi', 'Bu kod bazada yo‘q. Kassaga murojaat qiling.');

    /* Davomat yoki vaqt bekor qilingan bo'lsa chek ham kuchini yo'qotadi */
    if (p.status === 'cancelled') return await stop('Chek bekor qilingan', 'Kassaga murojaat qiling.');
    if (p.session_status === 'cancelled' && p.status === 'issued') {
      await c.query(`UPDATE gate_passes SET status='cancelled', closed_by='auto',
                            note=TRIM(COALESCE(note || ' · ','') || 'Yozuv kassada bekor qilingan')
                      WHERE id=$1`, [p.id]);
      await c.query('COMMIT'); committed = true;
      return deny('Chek bekor qilingan', 'Bu yozuv kassada bekor qilingan.', p);
    }

    const t = at.getTime();

    if (p.status === 'issued') {
      if (t > new Date(p.valid_until).getTime()) {
        return await stop('Chek muddati o‘tgan',
          'Chek ' + new Date(p.issued_at).toLocaleDateString('uz-UZ', { timeZone: TZ }) + ' kuni berilgan.');
      }
      /* Platniy vaqt kassada yopilib bo'lgan — bu chek bilan endi kirilmaydi */
      if (p.kind === 'paid' && ['completed', 'finished'].includes(String(p.session_status || ''))) {
        return await stop('Vaqt yopilgan', 'Bu chek bo‘yicha vaqt kassada yakunlangan.');
      }
      return await finish(
        { sql: `UPDATE gate_passes SET status='inside', in_at=$2 WHERE id=$1 RETURNING *`, args: [p.id, at] },
        'in', 'Xush kelibsiz',
        (p.kind === 'school' ? 'Avtoshkola' : 'Platniy') + ' · ' + durText(num(p.paid_minutes) * 60));
    }

    if (p.status === 'inside') {
      const since = t - new Date(p.in_at).getTime();
      if (since < REOPEN_SEC * 1000) {
        return await finish(null, 'in', 'Qayta ochildi', 'Hozirgina kirgansiz — turniket yana ochildi.', 'Qayta urildi');
      }
      const used = Math.max(0, Math.round(since / 1000));
      const over = Math.max(0, used - num(p.paid_minutes) * 60);
      const msg = durText(used) + ' bo‘ldi'
        + (over > grace * 60 ? ' · ' + durText(over) + ' ORTIQCHA' : '');
      return await finish(
        { sql: `UPDATE gate_passes SET status='done', out_at=$2, closed_by='gate' WHERE id=$1 RETURNING *`, args: [p.id, at] },
        'out', 'Xayr!', msg);
    }

    if (p.status === 'done') {
      const since = p.out_at ? t - new Date(p.out_at).getTime() : Infinity;
      if (since >= 0 && since < REOPEN_SEC * 1000) {
        return await finish(null, 'out', 'Qayta ochildi', 'Hozirgina chiqqansiz — turniket yana ochildi.', 'Qayta urildi');
      }
      return await stop('Chek ishlatilgan',
        'Kirdi ' + hhmm(p.in_at) + ', chiqdi ' + hhmm(p.out_at) + '. Qayta kirish uchun kassaga murojaat qiling.');
    }

    return await stop('Chek holati noma’lum', String(p.status));
  } catch (e) {
    if (!committed) { try { await c.query('ROLLBACK'); } catch {} }
    console.error('GATE SCAN:', e);
    return send(res, 500, { ok: false, open: null, title: 'Server xatosi', message: 'Qayta urinib ko‘ring' });
  } finally { c.release(); }
}

/** Qo'riqchi turniketni qo'lda ochdi. Sabab majburiy va jurnalga
    yoziladi — «Turniket» bo'limida alohida ko'rinadi. */
async function manual(req, res, dev) {
  const b = await readBody(req);
  const dir = text(b.direction) === 'out' ? 'manual_out' : 'manual_in';
  const reason = text(b.reason).slice(0, 200);
  if (reason.length < 2) return send(res, 400, { ok: false, error: 'Sabab kerak' });
  await logEvent(pool, { user: dev.user_id, direction: dir, result: 'ok', reason, deviceId: dev.id,
                         at: clientTime(b.at), offline: !!b.offline, clientId: text(b.client_id).slice(0, 80) || null });
  return send(res, 200, { ok: true, open: dir === 'manual_out' ? 'out' : 'in' });
}

/** Internet uzilganda turniket to'xtab qolmasligi uchun: bugungi ochiq
    cheklar ro'yxati. Turniket ekrani uni har daqiqada yangilab turadi. */
async function cache(req, res, dev) {
  const r = await pool.query(`
    SELECT code, status, kind, person_name, plate, paid_minutes, in_at, out_at, valid_until
      FROM gate_passes
     WHERE user_id=$1 AND (status='inside' OR (status='issued' AND valid_until > NOW())
                           OR (status='done' AND out_at > NOW() - INTERVAL '2 minutes'))
     ORDER BY issued_at DESC
     LIMIT 3000`, [dev.user_id]);
  return send(res, 200, { at: new Date().toISOString(), graceMinutes: await graceMinutes(dev.user_id), passes: r.rows });
}

/* =========================================================================
   DISPATCHER
   ========================================================================= */
export async function handleGateRequest(req, res) {
  const url = new URL(String(req.url || ''), 'http://local');
  const path = url.pathname;
  if (!path.startsWith('/api/gate/') && path !== '/api/gate') return false;
  const method = (req.method || 'GET').toUpperCase();

  try {
    await ensureGateSchema();

    /* --- Turniket qurilmasi (X-Gate-Key) --- */
    const deviceRoutes = ['/api/gate/ping', '/api/gate/scan', '/api/gate/manual', '/api/gate/cache'];
    if (deviceRoutes.includes(path)) {
      const dev = await deviceOf(req);
      if (!dev) return send(res, 401, { ok: false, error: 'Turniket kaliti noto‘g‘ri yoki o‘chirilgan' });
      if (path === '/api/gate/ping' && method === 'GET') {
        return send(res, 200, { ok: true, device: dev.name, now: new Date().toISOString(),
                                graceMinutes: await graceMinutes(dev.user_id) });
      }
      if (path === '/api/gate/scan' && method === 'POST') return await scan(req, res, dev);
      if (path === '/api/gate/manual' && method === 'POST') return await manual(req, res, dev);
      if (path === '/api/gate/cache' && method === 'GET') return await cache(req, res, dev);
      return send(res, 405, { error: 'Bu manzil bu usulni qabul qilmaydi' });
    }

    /* --- Operator (JWT) --- */
    const user = userId(req);
    if (!user) return send(res, 401, { error: 'Kirish talab qilinadi' });

    if (path === '/api/gate/passes' && method === 'POST') return await createPass(req, res, user);
    if (path === '/api/gate/overview' && method === 'GET') return await overview(req, res, user, url.searchParams);
    if (path === '/api/gate/alerts' && method === 'GET') return await alerts(req, res, user);
    if (path === '/api/gate/devices' && method === 'GET') return await listDevices(req, res, user);
    if (path === '/api/gate/devices' && method === 'POST') return await addDevice(req, res, user);
    if (path === '/api/gate/settings' && method === 'GET') return await readSettings(req, res, user);
    if (path === '/api/gate/settings' && (method === 'PUT' || method === 'POST')) return await writeSettings(req, res, user);

    let m = path.match(/^\/api\/gate\/passes\/([^/]+)\/(close|cancel)$/);
    if (m && method === 'POST') return await closePass(req, res, user, decodeURIComponent(m[1]), m[2]);
    m = path.match(/^\/api\/gate\/devices\/([^/]+)\/revoke$/);
    if (m && method === 'POST') return await revokeDevice(req, res, user, decodeURIComponent(m[1]));

    return send(res, 404, { error: 'Turniket: bunday manzil yo‘q' });
  } catch (e) {
    console.error('GATE ROUTES:', e);
    const msg = /duplicate key|violates|relation|column|syntax|operator does not exist/i.test(String(e.message))
      ? 'Server xatosi. Qayta urinib ko‘ring.' : (e.message || 'Server xatosi');
    return send(res, 500, { error: msg });
  }
}
