import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { pool } from '../backend/src/db.js';
import { readFile } from 'node:fs/promises';

/* Kassa kompyuteriga yuklab olinadigan ko'prik dasturi (shablon).
   Sozlamalarni (server, kalit, qurilma IP/login/parol) brauzer o'zi
   to'ldiradi — qurilma paroli serverga YUBORILMAYDI. */
const bridgeTemplate = new URL('../face-bridge/avtodrom-faceid.bat', import.meta.url);

/* =========================================================================
   FACE ID — chek chiqarishdan oldin o'quvchi Face ID dan o'tganmi?

   MA'LUMOT QAYERDAN KELADI
     O'quvchilarning rasmlari e-avtota'lim.uz (DYHXX) tizimiga yuklanadi va
     u yerdan avtodromdagi Hikvision Face ID qurilmasiga tushadi. Davlat
     tizimiga dastur orqali ulanib bo'lmaydi (captcha, ruxsat yo'q), shuning
     uchun «kim qachon o'tdi» yozuvini qurilmaning O'ZIDAN o'qiymiz.

     Kassa kompyuterida kichik dastur (face-bridge/) ishlaydi: har 15
     soniyada qurilmadan bugungi o'tishlarni FAQAT O'QIYDI (ISAPI AcsEvent)
     va shu yerga yuboradi. Qurilma sozlamalariga tegilmaydi.

   QOIDA
     Sozlamada «majburiy» yoqilgan bo'lsa, bugun (Toshkent kuni) Face ID
     dan o'tmagan avtoshkola o'quvchisiga davomat ham, chek ham yozilmaydi:
     «Face ID dan o'tmagan — chek chiqarilmaydi».

     Ko'prik 10 daqiqadan beri aloqa qilmagan bo'lsa (kompyuter o'chgan,
     internet yo'q) — tekshirib bo'lmaydi, chek OGOHLANTIRISH bilan chiqadi.
     Aks holda bitta kompyuter o'chib qolsa butun kassa to'xtardi.

   O'QUVCHINI TANISH
     1) students.face_ref — qurilmadagi shaxs raqami (qo'lda bog'langan);
     2) bo'lmasa ism bo'yicha: katta-kichik harf, apostrof, kirill/lotin,
        x/h, q/k, y/i, qo'sh harf, «o'g'li/qizi» farq qilmaydi; familiya va
        ism (dastlabki ikki so'z) mos kelsa — o'sha o'quvchi.

   YO'LLAR
     Ko'prik (X-Face-Key):
       POST /api/face/events   { events:[{person_id,name,time,device}], bridge }
     Operator (JWT):
       GET  /api/face/status?studentId=  — kassa uchun: o'tganmi
       GET  /api/face/today              — bugungi o'tishlar + kim bilan mos
       GET/PUT /api/face/settings        — { required }
       POST /api/face/key                — ko'prik kaliti (bir marta ko'rinadi)
       POST /api/face/link               — { studentId, personRef } qo'lda bog'lash
   ========================================================================= */

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
const TZ = 'Asia/Tashkent';
const STALE_MIN = 10;          /* ko'prik shuncha daqiqa jim bo'lsa — «tekshirib bo'lmadi» */

const text = v => String(v ?? '').trim();
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');

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

/* ---------------- Sxema ---------------- */
let schemaPromise = null;
export function ensureFaceSchema() {
  if (schemaPromise) return schemaPromise;
  const first = [];
  schemaPromise = (async () => {
    const q = async sql => { try { await pool.query(sql); } catch (e) { first.push(e); console.error('FACE SCHEMA:', e.message); } };
    await q(`
      CREATE TABLE IF NOT EXISTS face_events(
        id BIGSERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        person_ref TEXT NOT NULL DEFAULT '',
        person_name TEXT NULL,
        at TIMESTAMPTZ NOT NULL,
        device TEXT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    /* Ko'prik bir o'tishni qayta yuborsa ikki marta yozilmasin */
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS idx_face_events_uniq ON face_events(user_id, person_ref, at)`);
    await q(`CREATE INDEX IF NOT EXISTS idx_face_events_user_at ON face_events(user_id, at DESC)`);
    await q(`
      CREATE TABLE IF NOT EXISTS face_settings(
        user_id TEXT PRIMARY KEY,
        required BOOLEAN NOT NULL DEFAULT FALSE,
        key_hash TEXT NULL,
        last_seen_at TIMESTAMPTZ NULL,
        last_event_at TIMESTAMPTZ NULL,
        bridge_info TEXT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS idx_face_settings_key ON face_settings(key_hash) WHERE key_hash IS NOT NULL`);
    /* Qurilmadagi shaxs raqami (qo'lda bog'langanda) */
    await q(`ALTER TABLE students ADD COLUMN IF NOT EXISTS face_ref TEXT NULL`);
    if (first.length) { schemaPromise = null; throw first[0]; }
  })().catch(e => { schemaPromise = null; throw e; });
  return schemaPromise;
}

/* ---------------- Ismni solishtirish ---------------- */
const CYR = { 'а':'a','б':'b','в':'v','г':'g','ғ':'g','д':'d','е':'e','ё':'yo','ж':'j','з':'z','и':'i','й':'y','к':'k','қ':'q',
  'л':'l','м':'m','н':'n','о':'o','ў':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'x','ҳ':'h','ц':'s','ч':'ch',
  'ш':'sh','щ':'sh','ъ':'','ы':'i','ь':'','э':'e','ю':'yu','я':'ya' };
const SUFFIX = new Set(['ogli', 'ugli', 'oglu', 'kizi', 'kiz']);

/** Ism → solishtirish uchun so'zlar ro'yxati (familiya, ism, ...) */
export function nameTokens(s) {
  let t = String(s || '').toLowerCase();
  t = t.replace(/[а-яёўқғҳ]/g, ch => CYR[ch] ?? ch);
  t = t.replace(/[‘’ʻʼ'`´]/g, '');
  t = t.replace(/x/g, 'h').replace(/q/g, 'k').replace(/y/g, 'i');
  t = t.replace(/[^a-z\s]/g, ' ');
  return t.split(/\s+/).filter(Boolean)
    .map(w => w.replace(/(.)\1+/g, '$1'))
    .filter(w => !SUFFIX.has(w));
}
/** Qurilmadagi ism va bazadagi ism bitta odammi: familiya va ism mos kelishi kerak */
export function sameName(a, b) {
  const x = nameTokens(a), y = nameTokens(b);
  if (x.length < 2 || y.length < 2) return false;
  const k = arr => arr.slice(0, 2).sort().join(' ');
  if (k(x) === k(y)) return true;
  /* Bir tomonda tartib boshqacha bo'lsa ham (ISM FAMILIYA): qisqa ismning
     hamma so'zlari uzunida bo'lsa */
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  const set = new Set(long);
  return short.length >= 2 && short.every(w => set.has(w));
}

/* ---------------- Tekshiruv (davomat va chek yozishdan oldin) ---------------- */
async function settingsOf(user) {
  const r = await pool.query(`SELECT * FROM face_settings WHERE user_id=$1`, [user]);
  return r.rows[0] || { required: false, key_hash: null, last_seen_at: null, last_event_at: null };
}
const DAY_START = `((NOW() AT TIME ZONE '${TZ}')::date::timestamp AT TIME ZONE '${TZ}')`;

/** Bugun shu o'quvchi Face ID dan o'tganmi. Majburiy bo'lmasa har doim ok.

    DIQQAT: bu funksiya davomat TRANZAKSIYASI ichidan chaqiriladi, shuning
    uchun bu yerda sxema (ALTER TABLE students) YARATILMAYDI — u ochiq
    tranzaksiyani kutib, so'rov abadiy osilib qolardi. Sxemani api/index.js
    har so'rov boshida, tranzaksiyadan tashqarida tayyorlaydi. Jadval hali
    yo'q bo'lsa — sozlama ham yo'q, demak tekshiruv majburiy emas. */
export async function faceCheck(user, studentId) {
  let cfg;
  try { cfg = await settingsOf(user); }
  catch (e) { return { ok: true, required: false }; }
  try {
    if (!cfg.required) return { ok: true, required: false };
    const healthy = cfg.last_seen_at && (Date.now() - new Date(cfg.last_seen_at).getTime()) < STALE_MIN * 60000;

    const sr = await pool.query(`SELECT id, full_name, face_ref FROM students WHERE id::text=$1`, [String(studentId)]);
    const st = sr.rows[0];
    if (!st) return { ok: true, required: true };

    const ev = await pool.query(`
      SELECT person_ref, person_name, MAX(at) AS at FROM face_events
       WHERE user_id=$1 AND at >= ${DAY_START}
       GROUP BY person_ref, person_name`, [user]);
    const hit = ev.rows
      .filter(e => (st.face_ref && e.person_ref === st.face_ref) || (!st.face_ref && sameName(e.person_name, st.full_name)))
      .sort((a, b) => new Date(b.at) - new Date(a.at))[0];
    if (hit) return { ok: true, required: true, passed: true, at: hit.at, name: hit.person_name, by: st.face_ref ? 'ref' : 'name' };
    if (!healthy) {
      return { ok: true, required: true, passed: false, unknown: true,
               warning: 'Face ID qurilmasidan ma’lumot kelmayapti — tekshirib bo‘lmadi' };
    }
    return { ok: false, required: true, passed: false, error: 'Face ID dan o‘tmagan — chek chiqarilmaydi' };
  } catch (e) {
    /* Tekshiruvning o'zi yiqilsa kassani to'xtatmaymiz */
    console.error('[face] tekshiruv:', e && e.message);
    return { ok: true, required: true, unknown: true, warning: 'Face ID tekshiruvi bajarilmadi' };
  }
}

/* ---------------- Ko'prik: o'tishlarni qabul qilish ---------------- */
async function ingest(req, res) {
  const key = text(req.headers?.['x-face-key']);
  if (key.length < 20) return send(res, 401, { ok: false, error: 'Kalit yo‘q' });
  const cr = await pool.query(`SELECT user_id FROM face_settings WHERE key_hash=$1`, [sha(key)]);
  const user = cr.rows[0] && cr.rows[0].user_id;
  if (!user) return send(res, 401, { ok: false, error: 'Kalit noto‘g‘ri yoki almashtirilgan' });

  const b = await readBody(req);
  /* Oddiy ro'yxat yoki Hikvision'ning o'z javobi (AcsEvent.InfoList) */
  const list = Array.isArray(b.events) ? b.events
    : Array.isArray(b?.AcsEvent?.InfoList) ? b.AcsEvent.InfoList : [];
  let saved = 0, lastAt = null;
  for (const e of list.slice(0, 500)) {
    const ref = text(e.person_id ?? e.employeeNoString ?? e.employeeNo ?? e.cardNo).slice(0, 64);
    const name = text(e.name ?? e.person_name).slice(0, 160) || null;
    const at = new Date(e.time ?? e.at);
    if ((!ref && !name) || Number.isNaN(at.getTime())) continue;
    /* Juda eski yoki kelajakdagi vaqt — qurilma soati noto'g'ri; o'tkazib yuboramiz */
    if (Math.abs(Date.now() - at.getTime()) > 3 * 86400000) continue;
    const r = await pool.query(`
      INSERT INTO face_events(user_id, person_ref, person_name, at, device)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [user, ref, name, at.toISOString(), text(e.device ?? b.device).slice(0, 80) || null]);
    saved += r.rowCount;
    if (!lastAt || at > lastAt) lastAt = at;
  }
  await pool.query(`
    UPDATE face_settings SET last_seen_at=NOW(),
           last_event_at = GREATEST(COALESCE(last_event_at, $2::timestamptz), COALESCE($2::timestamptz, last_event_at)),
           bridge_info = COALESCE($3, bridge_info)
     WHERE user_id=$1`, [user, lastAt ? lastAt.toISOString() : null, text(b.bridge).slice(0, 200) || null]);
  return send(res, 200, { ok: true, received: list.length, saved });
}

/* ---------------- Operator ---------------- */
async function status(req, res, user, search) {
  const sid = text(search.get('studentId'));
  if (!sid) return send(res, 400, { error: 'studentId kerak' });
  return send(res, 200, await faceCheck(user, sid));
}

async function today(req, res, user) {
  const cfg = await settingsOf(user);
  const ev = await pool.query(`
    SELECT person_ref, person_name, MIN(at) AS first_at, MAX(at) AS last_at, COUNT(*)::int AS n
      FROM face_events WHERE user_id=$1 AND at >= ${DAY_START}
     GROUP BY person_ref, person_name ORDER BY MAX(at) DESC LIMIT 1000`, [user]);
  const st = await pool.query(`
    SELECT st.id, st.full_name, st.face_ref, ds.name AS school_name
      FROM students st LEFT JOIN driving_schools ds ON ds.id = st.school_id
     WHERE st.owner_key=$1 AND st.active IS NOT FALSE`, [user]);
  const byRef = new Map(st.rows.filter(s => s.face_ref).map(s => [s.face_ref, s]));
  const rows = ev.rows.map(e => {
    let m = byRef.get(e.person_ref) || null, by = m ? 'ref' : null;
    if (!m) {
      const c = st.rows.filter(s => !s.face_ref && sameName(e.person_name, s.full_name));
      if (c.length === 1) { m = c[0]; by = 'name'; }
      else if (c.length > 1) by = 'many';
    }
    return { ...e, student: m ? { id: m.id, full_name: m.full_name, school_name: m.school_name } : null, by };
  });
  const seen = cfg.last_seen_at ? new Date(cfg.last_seen_at) : null;
  return send(res, 200, {
    required: !!cfg.required,
    hasKey: !!cfg.key_hash,
    lastSeenAt: cfg.last_seen_at, lastEventAt: cfg.last_event_at, bridge: cfg.bridge_info || null,
    healthy: !!(seen && Date.now() - seen.getTime() < STALE_MIN * 60000),
    rows,
    summary: { total: rows.length, matched: rows.filter(r => r.student).length },
  });
}

async function writeSettings(req, res, user) {
  const b = await readBody(req);
  const required = b.required === true || b.required === 'true';
  await pool.query(`
    INSERT INTO face_settings(user_id, required, updated_at) VALUES($1,$2,NOW())
    ON CONFLICT (user_id) DO UPDATE SET required=EXCLUDED.required, updated_at=NOW()`, [user, required]);
  return send(res, 200, { required });
}

/** Ko'prik kaliti. Faqat shu javobda ko'rinadi; yangisi olinsa eskisi ishlamaydi. */
async function newKey(req, res, user) {
  const key = crypto.randomBytes(24).toString('base64url');
  await pool.query(`
    INSERT INTO face_settings(user_id, key_hash, updated_at) VALUES($1,$2,NOW())
    ON CONFLICT (user_id) DO UPDATE SET key_hash=EXCLUDED.key_hash, updated_at=NOW()`, [user, sha(key)]);
  return send(res, 201, { key });
}

/** Qo'lda bog'lash: qurilmadagi shaxs raqami → o'quvchi. personRef bo'sh bo'lsa bog'lanish olib tashlanadi. */
async function link(req, res, user) {
  const b = await readBody(req);
  const sid = text(b.studentId), ref = text(b.personRef).slice(0, 64) || null;
  if (!sid) return send(res, 400, { error: 'studentId kerak' });
  if (ref) await pool.query(`UPDATE students SET face_ref=NULL WHERE owner_key=$1 AND face_ref=$2`, [user, ref]);
  const r = await pool.query(`UPDATE students SET face_ref=$1 WHERE id::text=$2 AND owner_key=$3 RETURNING id, full_name, face_ref`, [ref, sid, user]);
  if (!r.rows[0]) return send(res, 404, { error: 'O‘quvchi topilmadi' });
  return send(res, 200, { student: r.rows[0] });
}

/* ---------------- Dispatcher ---------------- */
export async function handleFaceRequest(req, res) {
  const url = new URL(String(req.url || ''), 'http://local');
  const path = url.pathname;
  if (!path.startsWith('/api/face/')) return false;
  const method = (req.method || 'GET').toUpperCase();
  try {
    await ensureFaceSchema();
    if (path === '/api/face/events' && method === 'POST') return await ingest(req, res);

    const user = userId(req);
    if (!user) return send(res, 401, { error: 'Kirish talab qilinadi' });
    if (path === '/api/face/status' && method === 'GET') return await status(req, res, user, url.searchParams);
    if (path === '/api/face/today' && method === 'GET') return await today(req, res, user);
    if (path === '/api/face/settings' && method === 'GET') {
      const c = await settingsOf(user);
      return send(res, 200, { required: !!c.required, hasKey: !!c.key_hash });
    }
    if (path === '/api/face/settings' && (method === 'PUT' || method === 'POST')) return await writeSettings(req, res, user);
    if (path === '/api/face/key' && method === 'POST') return await newKey(req, res, user);
    if (path === '/api/face/link' && method === 'POST') return await link(req, res, user);
    if (path === '/api/face/bridge' && method === 'GET') {
      const t = await readFile(bridgeTemplate, 'utf8');
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(t);
      return true;
    }
    return send(res, 404, { error: 'Face ID: bunday manzil yo‘q' });
  } catch (e) {
    console.error('FACE ROUTES:', e);
    return send(res, 500, { error: 'Server xatosi' });
  }
}
