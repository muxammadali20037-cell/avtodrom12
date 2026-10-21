/* ============================================================================
   EXCEL BO'LIMI — butun ekran jadval, Ctrl+S bilan bazaga saqlash

     GET  /api/sheet/day?date=YYYY-MM-DD
          o'sha kunning: oddiy mijozlar (JISMONIY), xarajatlar (XARAJATLAR),
          avtoshkola darslari (KURS — faqat o'qish uchun)
     POST /api/sheet/day
          { date,
            sessions: { create:[{key,set}], update:[{id,set,orig}], delete:[{id,orig}] },
            expenses: { create:[{key,set}], update:[{id,set,orig}], delete:[{id}] } }

   Saqlash BITTA tranzaksiyada: biror qatorda xato bo'lsa HECH NARSA
   saqlanmaydi va qaysi katakda xato ekani qaytariladi (jadval o'sha
   katakni qizil qiladi). Boshqa kompyuterda shu orada o'zgartirilgan
   qator ustidan yozib yuborilmaydi (orig — eski qiymat bilan solishtiriladi).
   Har bir o'zgarish jurnalga (change_log) yoziladi.

   Vaqtlar «08:30» ko'rinishida, jadval sanasi bo'yicha Toshkent vaqti
   (UTC+5). Chiqish kirishdan kichik bo'lsa — ertasi kun (23:30 → 00:40).
   ========================================================================== */

import jwt from 'jsonwebtoken';
import { pool } from '../backend/src/db.js';
import { ensureKassaSchema, cleanExpense, autoCloseDue } from './kassa-routes.js';
import { logChange } from './audit-routes.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
const TZ = 'Asia/Tashkent';
const text = v => String(v === null || v === undefined ? '' : v).trim();
const isDay = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !isNaN(Date.parse(v + 'T00:00:00Z'));
const DEFAULT_REASON = 'Excel jadvalida o‘zgartirildi';
const MAX_ITEMS = 1500;

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
    req.on('data', c => { s += c; if (s.length > 4e6) req.destroy(); });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

/* ---------- vaqt ---------- */
/* «8:30», «08.30», «830», «0830» → «08:30»; noto'g'ri bo'lsa null */
export function normTime(v) {
  const s = text(v).replace(/[.,\-\s]/g, ':');
  let m = s.match(/^(\d{1,2}):(\d{1,2})$/);
  if (!m) { const d = s.match(/^(\d{3,4})$/); if (d) m = [0, d[1].slice(0, -2), d[1].slice(-2)]; }
  if (!m) { const h = s.match(/^(\d{1,2})$/); if (h) m = [0, h[1], '0']; }
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (!(h >= 0 && h <= 23 && mi >= 0 && mi <= 59)) return null;
  return String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0');
}
/* sana + «08:30» (Toshkent, doim UTC+5) → Date */
const at = (day, hhmm) => new Date(day + 'T' + hhmm + ':00+05:00');
/* Date → «08:30» Toshkent */
function hhmmOf(ts) {
  if (!ts) return '';
  const d = new Date(new Date(ts).getTime() + 5 * 3600 * 1000);
  return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
}
/* Kirish/chiqish → [start, end]; chiqish kirishdan oldin bo'lsa ertasi kun */
function span(day, startHHMM, endHHMM) {
  const s = at(day, startHHMM);
  let e = endHHMM ? at(day, endHHMM) : null;
  if (e && e.getTime() <= s.getTime()) e = new Date(e.getTime() + 24 * 3600 * 1000);
  return [s, e];
}

const money = v => {
  if (v === '' || v === null || v === undefined) return 0;
  const n = Math.round(Number(String(v).replace(/[\s,']/g, '')));
  return Number.isFinite(n) ? n : NaN;
};
const plateOf = v => text(v).replace(/\s+/g, ' ').toUpperCase().slice(0, 60);
const methodOf = (cash, term, click) => {
  const used = [cash > 0, term > 0, click > 0].filter(Boolean).length;
  return used > 1 ? 'mixed' : term > 0 ? 'terminal' : click > 0 ? 'click' : 'cash';
};

/* ---------- O'QISH ---------- */
const S_SELECT = `
  SELECT s.id, COALESCE(v.plate, s.driver_name, '') AS plate, s.status, s.started_at, s.finished_at,
         COALESCE(s.duration_seconds, 0)::int AS duration_seconds, s.target_duration, s.auto_close, s.auto_closed,
         s.frozen_at, s.resumed_at, COALESCE(s.frozen_seconds, 0)::int AS frozen_seconds,
         COALESCE(s.cash_amount, 0)::float8 AS cash_amount, COALESCE(s.terminal_amount, 0)::float8 AS terminal_amount,
         COALESCE(s.click_amount, 0)::float8 AS click_amount, COALESCE(s.debt_amount, 0)::float8 AS debt_amount,
         COALESCE(s.planned_amount, 0)::float8 AS planned_amount,
         s.correction_note, s.hourly_rate::float8 AS hourly_rate, s.minimum_payment::float8 AS minimum_payment,
         s.calculation_mode, ds.name AS school_name
    FROM sessions s
    LEFT JOIN vehicles v ON v.id = s.vehicle_id
    LEFT JOIN driving_schools ds ON ds.id = s.school_id`;
const S_WHERE_REGULAR = `s.student_id IS NULL AND COALESCE(s.customer_type, '') <> 'school'`;

async function dayData(user, day) {
  const [ss, xx, kk] = await Promise.all([
    pool.query(`${S_SELECT}
      WHERE s.user_id = $1 AND s.status IN ('completed','active','frozen','paused')
        AND (s.started_at AT TIME ZONE '${TZ}')::date = $2::date AND ${S_WHERE_REGULAR}
      ORDER BY s.started_at, s.id LIMIT 3000`, [user, day]),
    pool.query(`SELECT id, to_char(spent_on,'YYYY-MM-DD') spent_on, person, category, vehicle, amount::float8 amount,
        pay_method, liters::float8 liters, odometer, note, created_at
        FROM expenses WHERE user_id = $1 AND deleted_at IS NULL AND spent_on = $2::date
        ORDER BY created_at, id LIMIT 3000`, [user, day]),
    pool.query(`
      SELECT s.id, st.full_name AS student_name, ds.name AS school_name, g.name AS group_name,
             COALESCE(s.instructor_name, '') AS instructor_name, COALESCE(v.plate, '') AS plate,
             s.started_at, s.finished_at, s.status, COALESCE(s.duration_seconds, 0)::int AS duration_seconds,
             COALESCE(s.lessons_counted, 0)::int AS lessons_counted
        FROM sessions s
        LEFT JOIN students st ON st.id = s.student_id
        LEFT JOIN driving_schools ds ON ds.id = s.school_id
        LEFT JOIN school_groups g ON g.id = s.group_id
        LEFT JOIN vehicles v ON v.id = s.vehicle_id
       WHERE s.user_id = $1 AND s.status IN ('completed','active','frozen','paused')
         AND (s.started_at AT TIME ZONE '${TZ}')::date = $2::date
         AND NOT (${S_WHERE_REGULAR})
       ORDER BY s.started_at, s.id LIMIT 3000`, [user, day]).catch(e => { console.error('SHEET KURS:', e.message); return { rows: [] }; })
  ]);
  const now = await pool.query(`SELECT to_char((now() AT TIME ZONE '${TZ}')::date,'YYYY-MM-DD') d, now() t`);
  return {
    date: day, today: now.rows[0].d, server_time: now.rows[0].t,
    sessions: ss.rows.map(r => Object.assign(r, { start: hhmmOf(r.started_at), end: r.status === 'completed' ? hhmmOf(r.finished_at) : '' })),
    expenses: xx.rows,
    school: kk.rows.map(r => Object.assign(r, { start: hhmmOf(r.started_at) }))
  };
}

/* ---------- avtomobil: matn bo'yicha topish yoki yaratish ---------- */
async function vehicleId(c, user, plate) {
  let r = await c.query(`SELECT id FROM vehicles WHERE plate = $1 AND user_id = $2 ORDER BY created_at LIMIT 1`, [plate, user]);
  if (r.rows[0]) return r.rows[0].id;
  r = await c.query(`INSERT INTO vehicles(user_id, plate) VALUES($1, $2) ON CONFLICT DO NOTHING RETURNING id`, [user, plate]);
  if (r.rows[0]) return r.rows[0].id;
  /* eski bazada plate UNIQUE bo'lishi mumkin */
  r = await c.query(`SELECT id FROM vehicles WHERE plate = $1 ORDER BY created_at LIMIT 1`, [plate]);
  if (r.rows[0]) return r.rows[0].id;
  throw new Error('Avtomobil saqlanmadi: ' + plate);
}

/* ---------- SAQLASH ---------- */
class RowError extends Error {
  constructor(kind, key, field, msg) { super(msg); this.kind = kind; this.key = key; this.field = field; }
}

/* Qatorning hozirgi (bazadagi) qiymati jadval ko'rinishida — solishtirish uchun */
function viewOf(r) {
  return {
    plate: text(r.plate), start: hhmmOf(r.started_at), end: r.status === 'completed' ? hhmmOf(r.finished_at) : '',
    cash: Math.round(Number(r.cash_amount || 0)), terminal: Math.round(Number(r.terminal_amount || 0)),
    click: Math.round(Number(r.click_amount || 0)), debt: Math.round(Number(r.debt_amount || 0)),
    note: text(r.correction_note)
  };
}
const same = (a, b, k) => (['cash', 'terminal', 'click', 'debt'].includes(k) ? money(a) === money(b) : text(a) === text(b));

async function save(req, res, user) {
  const b = await readBody(req);
  const day = text(b.date);
  if (!isDay(day)) return json(res, 400, { error: 'Sana noto‘g‘ri' });
  const S = b.sessions || {}, X = b.expenses || {};
  const sc = Array.isArray(S.create) ? S.create : [], su = Array.isArray(S.update) ? S.update : [], sd = Array.isArray(S.delete) ? S.delete : [];
  const xc = Array.isArray(X.create) ? X.create : [], xu = Array.isArray(X.update) ? X.update : [], xd = Array.isArray(X.delete) ? X.delete : [];
  const total = sc.length + su.length + sd.length + xc.length + xu.length + xd.length;
  if (!total) return json(res, 400, { error: 'Saqlanadigan o‘zgarish yo‘q' });
  if (total > MAX_ITEMS) return json(res, 400, { error: 'Bir martada juda ko‘p o‘zgarish (' + total + ')' });

  const nowMs = Date.now();
  const FUTURE_MS = 10 * 60000;
  const logs = [];
  const errors = [];
  const counts = { created: 0, updated: 0, deleted: 0 };

  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    /* Bitta foydalanuvchining Excel saqlashlari navbat bilan (ikki kompyuter
       bir vaqtda Ctrl+S bossa ham aralashib ketmaydi) */
    await c.query(`SELECT pg_advisory_xact_lock(hashtext('avtodrom-sheet:' || $1))`, [user]);

    const set = (await c.query(`SELECT hourly_rate, minimum_payment, calculation_mode FROM user_settings WHERE user_id = $1`, [user])).rows[0]
      || { hourly_rate: 100000, minimum_payment: 0, calculation_mode: 'half' };

    /* ===== JISMONIY: o'zgartirish va o'chirish ===== */
    const ids = [...new Set(su.concat(sd).map(x => text(x && x.id)).filter(Boolean))];
    const cur = new Map();
    if (ids.length) {
      const r = await c.query(`${S_SELECT}
        WHERE s.user_id = $1 AND s.id::text = ANY($2::text[]) AND ${S_WHERE_REGULAR}
        ORDER BY s.id FOR UPDATE OF s`, [user, ids]);
      r.rows.forEach(x => cur.set(String(x.id), x));
    }

    for (const it of sd) {
      const id = text(it && it.id);
      const row = cur.get(id);
      try {
        if (!row || row.status === 'cancelled') throw new RowError('s', id, null, 'Yozuv topilmadi (o‘chirilgan bo‘lishi mumkin)');
        await c.query(`UPDATE sessions SET status = 'cancelled', finished_at = COALESCE(finished_at, now()),
            auto_close = FALSE, corrected_at = now(), correction_note = $2 WHERE id = $1`,
          [row.id, text(it.reason) || 'Excel jadvalida o‘chirildi']);
        counts.deleted++;
        logs.push({ entity: 'session', entityId: row.id, entityName: row.plate, action: 'sheet_delete', field: 'status',
          oldValue: row.status + ' ' + hhmmOf(row.started_at) + (row.status === 'completed' ? '–' + hhmmOf(row.finished_at) : '')
            + ' · ' + (Number(row.cash_amount) + Number(row.terminal_amount) + Number(row.click_amount)) + ' so‘m',
          newValue: 'o‘chirildi', reason: text(it.reason) || 'Excel jadvalida o‘chirildi (' + day + ')' });
      } catch (e) { if (e instanceof RowError) errors.push(e); else throw e; }
    }

    for (const it of su) {
      const id = text(it && it.id);
      const row = cur.get(id);
      const sv = (it && it.set) || {}, ov = (it && it.orig) || {};
      try {
        if (!row) throw new RowError('s', id, null, 'Yozuv topilmadi (o‘chirilgan bo‘lishi mumkin)');
        if (sd.some(d => text(d && d.id) === id)) continue;
        const now = viewOf(row);
        const keys = Object.keys(sv).filter(k => ['plate', 'start', 'end', 'cash', 'terminal', 'click', 'debt', 'note'].includes(k));
        /* boshqa kompyuterda o'zgartirilganmi? */
        for (const k of keys) {
          if (k in ov && !same(ov[k], now[k], k)) {
            throw new RowError('s', id, k, 'Bu katak boshqa joyda o‘zgartirilgan (hozir: «' + now[k] + '»). Jadvalni yangilang.');
          }
        }
        const next = Object.assign({}, now);
        for (const k of keys) next[k] = sv[k];

        /* tekshiruv */
        next.plate = plateOf(next.plate);
        if (!next.plate) throw new RowError('s', id, 'plate', 'Avtomobil yozilmagan');
        const st = normTime(next.start);
        if (!st) throw new RowError('s', id, 'start', 'Kirish vaqti noto‘g‘ri (masalan 08:30)');
        const en = text(next.end) ? normTime(next.end) : '';
        if (en === null) throw new RowError('s', id, 'end', 'Chiqish vaqti noto‘g‘ri (masalan 10:15)');
        const m = {};
        for (const k of ['cash', 'terminal', 'click', 'debt']) {
          m[k] = money(next[k]);
          if (!Number.isFinite(m[k]) || m[k] < 0 || m[k] > 100000000) throw new RowError('s', id, k, 'Summa noto‘g‘ri');
        }
        const frozen = row.status === 'frozen' || row.status === 'paused';
        const timeChanged = keys.includes('start') && st !== now.start || keys.includes('end') && en !== now.end;
        if (frozen && timeChanged) throw new RowError('s', id, keys.includes('start') ? 'start' : 'end', 'Muzlatilgan yozuvning vaqtini o‘zgartirib bo‘lmaydi — avval davom ettiring');
        if (row.status === 'completed' && !en) throw new RowError('s', id, 'end', 'Chiqish vaqtini o‘chirib bo‘lmaydi. Qatorni o‘chirish uchun: Ctrl + Delete');
        const closing = row.status === 'active' && !!en;
        if (row.status !== 'completed' && !closing && m.debt > 0) throw new RowError('s', id, 'debt', 'Ichkaridagi mashinaga «to‘lanmagan» yozilmaydi — avval chiqish vaqtini yozing');

        /* O'zgarmagan vaqt bazadagidek (soniyalari bilan) qoladi */
        const sAt = st === now.start ? new Date(row.started_at) : at(day, st);
        let eAt = null;
        if (en) {
          eAt = en === now.end && row.finished_at ? new Date(row.finished_at) : at(day, en);
          if (en !== now.end && eAt.getTime() <= sAt.getTime()) eAt = new Date(eAt.getTime() + 24 * 3600 * 1000);
          if (eAt.getTime() <= sAt.getTime()) throw new RowError('s', id, 'end', 'Chiqish kirishdan keyin bo‘lishi kerak');
        }
        if (st !== now.start && sAt.getTime() > nowMs + FUTURE_MS) throw new RowError('s', id, 'start', 'Kirish vaqti hali kelmagan');
        if (eAt && en !== now.end && eAt.getTime() > nowMs + FUTURE_MS) throw new RowError('s', id, 'end', 'Chiqish vaqti hali kelmagan');
        if (eAt && eAt.getTime() - sAt.getTime() > 24 * 3600 * 1000) throw new RowError('s', id, 'end', 'Davomiylik 24 soatdan ko‘p');

        const noteEdited = keys.includes('note') && !same(sv.note, now.note, 'note');
        const note = text(next.note).slice(0, 300);
        /* Izoh yozilmagan bo'lsa — avvalgi izoh saqlanadi, bo'lmasa standart sabab */
        const reason = (noteEdited ? note : '') || now.note || DEFAULT_REASON;
        const changed = keys.filter(k => !same(sv[k], now[k], k));
        if (!changed.length) continue;

        /* avtomobil */
        let vid = null;
        if (changed.includes('plate')) {
          vid = await vehicleId(c, user, next.plate);
        }
        const paid = m.cash + m.terminal + m.click;
        const moneyChanged = changed.some(k => ['cash', 'terminal', 'click', 'debt'].includes(k));
        const params = [row.id];
        const sets = [];
        const add = (sql, v) => { params.push(v); sets.push(sql.replace('?', '$' + params.length)); };
        if (vid) add('vehicle_id = ?', vid);
        if (timeChanged || closing) {
          add('started_at = ?', sAt);
          if (eAt) {
            add('finished_at = ?', eAt);
            /* qo'lda yozilgan vaqt — davomiylik shundan */
            add('duration_seconds = ?', Math.round((eAt.getTime() - sAt.getTime()) / 1000));
          }
          if (closing) { sets.push(`status = 'completed'`, 'auto_close = FALSE', 'frozen_at = NULL', 'resumed_at = NULL'); }
        }
        if (moneyChanged || closing) {
          add('cash_amount = ?', m.cash); add('terminal_amount = ?', m.terminal); add('click_amount = ?', m.click);
          add('debt_amount = ?', m.debt); add('amount = ?', paid); add('payment_method = ?', methodOf(m.cash, m.terminal, m.click));
          if (now.debt > 0 && m.debt === 0) sets.push('settled_at = now()');
        }
        sets.push('corrected_at = now()');
        add('correction_note = ?', noteEdited ? (note || null) : reason);
        try {
          await c.query('SAVEPOINT sp_row');
          await c.query(`UPDATE sessions SET ${sets.join(', ')} WHERE id = $1`, params);
          await c.query('RELEASE SAVEPOINT sp_row');
        } catch (e) {
          await c.query('ROLLBACK TO SAVEPOINT sp_row');
          if (e.code === '23505') throw new RowError('s', id, 'plate', 'Bu avtomobil hozir ichkarida — ikki marta kirita olmaysiz');
          throw e;
        }
        counts.updated++;
        const names = { plate: 'avtomobil', start: 'kirish', end: 'chiqish', cash: 'naqd', terminal: 'terminal', click: 'Klik', debt: 'to‘lanmagan', note: 'izoh' };
        for (const k of changed) {
          logs.push({ entity: 'session', entityId: row.id, entityName: next.plate, action: 'sheet_edit', field: names[k],
            oldValue: now[k], newValue: k === 'plate' ? next.plate : ['start', 'end'].includes(k) ? (k === 'start' ? st : en) : (k === 'note' ? note : m[k]),
            reason: (noteEdited ? note : '') || DEFAULT_REASON });
        }
      } catch (e) { if (e instanceof RowError) errors.push(e); else throw e; }
    }

    /* ===== JISMONIY: yangi qatorlar ===== */
    const sCols = new Set((await c.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'sessions'`)).rows.map(x => x.column_name));
    for (const it of sc) {
      const key = text(it && it.key);
      const sv = (it && it.set) || {};
      try {
        const plate = plateOf(sv.plate);
        if (!plate) throw new RowError('s', key, 'plate', 'Avtomobil yozilmagan');
        const st = normTime(sv.start);
        if (!st) throw new RowError('s', key, 'start', 'Kirish vaqtini yozing (masalan 08:30)');
        const en = text(sv.end) ? normTime(sv.end) : '';
        if (en === null) throw new RowError('s', key, 'end', 'Chiqish vaqti noto‘g‘ri (masalan 10:15)');
        const m = {};
        for (const k of ['cash', 'terminal', 'click', 'debt']) {
          m[k] = money(sv[k]);
          if (!Number.isFinite(m[k]) || m[k] < 0 || m[k] > 100000000) throw new RowError('s', key, k, 'Summa noto‘g‘ri');
        }
        if (!en && m.debt > 0) throw new RowError('s', key, 'debt', 'Ichkaridagi mashinaga «to‘lanmagan» yozilmaydi — chiqish vaqtini yozing');
        const [sAt, eAt] = span(day, st, en);
        if (sAt.getTime() > nowMs + FUTURE_MS) throw new RowError('s', key, 'start', 'Kirish vaqti hali kelmagan');
        if (eAt && eAt.getTime() > nowMs + FUTURE_MS) throw new RowError('s', key, 'end', 'Chiqish vaqti hali kelmagan');
        if (eAt && eAt.getTime() - sAt.getTime() > 24 * 3600 * 1000) throw new RowError('s', key, 'end', 'Davomiylik 24 soatdan ko‘p');
        const note = text(sv.note).slice(0, 300);
        const vid = await vehicleId(c, user, plate);
        const paid = m.cash + m.terminal + m.click;
        const cand = [
          ['user_id', user], ['vehicle_id', vid], ['started_at', sAt], ['finished_at', eAt],
          ['duration_seconds', eAt ? Math.round((eAt.getTime() - sAt.getTime()) / 1000) : 0],
          ['hourly_rate', set.hourly_rate], ['minimum_payment', set.minimum_payment], ['calculation_mode', set.calculation_mode],
          ['status', eAt ? 'completed' : 'active'], ['customer_type', 'regular'], ['manual_price', true],
          ['amount', paid], ['cash_amount', m.cash], ['terminal_amount', m.terminal], ['click_amount', m.click],
          ['payment_method', methodOf(m.cash, m.terminal, m.click)], ['debt_amount', m.debt],
          ['lessons_counted', 0], ['correction_note', note || 'Excel jadvalida qo‘shildi'], ['corrected_at', new Date()]
        ].filter(([k]) => sCols.has(k));
        let ins;
        try {
          await c.query('SAVEPOINT sp_row');
          ins = await c.query(`INSERT INTO sessions(${cand.map(([k]) => k).join(',')})
            VALUES(${cand.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING id`, cand.map(([, v]) => v));
          await c.query('RELEASE SAVEPOINT sp_row');
        } catch (e) {
          await c.query('ROLLBACK TO SAVEPOINT sp_row');
          if (e.code === '23505') throw new RowError('s', key, 'plate', 'Bu avtomobil hozir ichkarida — chiqish vaqtini ham yozing yoki «Jarayonda»dan yoping');
          throw e;
        }
        counts.created++;
        logs.push({ entity: 'session', entityId: ins.rows[0].id, entityName: plate, action: 'sheet_create', field: 'yangi qator',
          newValue: st + (en ? '–' + en : ' (ichkarida)') + ' · ' + paid + ' so‘m' + (m.debt ? ' · qarz ' + m.debt : ''),
          reason: note || 'Excel jadvalida qo‘shildi (' + day + ')' });
      } catch (e) { if (e instanceof RowError) errors.push(e); else throw e; }
    }

    /* ===== XARAJATLAR ===== */
    const PAYV = { cash: 'cash', card: 'card', terminal: 'card', click: 'click' };
    const xIn = (sv, fallbackDay) => cleanExpense(Object.assign({}, sv, {
      spent_on: text(sv.spent_on) || fallbackDay,
      pay_method: PAYV[text(sv.pay_method)] || 'cash',
      amount: money(sv.amount)
    }), fallbackDay);
    const xFieldOf = msg => /Sana/i.test(msg) ? 'spent_on' : /turi/i.test(msg) ? 'category' : /Summa/i.test(msg) ? 'amount'
      : /Litr/i.test(msg) ? 'liters' : /Kilometr/i.test(msg) ? 'odometer' : null;

    const xIds = [...new Set(xu.concat(xd).map(x => text(x && x.id)).filter(Boolean))];
    const xCur = new Map();
    if (xIds.length) {
      const r = await c.query(`SELECT id, to_char(spent_on,'YYYY-MM-DD') spent_on, person, category, vehicle, amount::float8 amount,
          pay_method, liters::float8 liters, odometer, note FROM expenses
         WHERE user_id = $1 AND deleted_at IS NULL AND id::text = ANY($2::text[]) ORDER BY id FOR UPDATE`, [user, xIds]);
      r.rows.forEach(x => xCur.set(String(x.id), x));
    }
    const xView = r => ({ spent_on: r.spent_on, person: text(r.person), category: text(r.category), vehicle: text(r.vehicle),
      amount: Math.round(Number(r.amount || 0)), pay_method: r.pay_method, liters: r.liters === null ? '' : String(Number(r.liters)),
      odometer: r.odometer === null ? '' : String(r.odometer), note: text(r.note) });
    const xSame = (a, b, k) => (k === 'amount' ? money(a) === money(b)
      : k === 'liters' || k === 'odometer' ? (text(a) === '' && text(b) === '') || Number(a) === Number(b) : text(a) === text(b));

    for (const it of xd) {
      const id = text(it && it.id);
      const row = xCur.get(id);
      if (!row) { errors.push(new RowError('x', id, null, 'Xarajat topilmadi (o‘chirilgan bo‘lishi mumkin)')); continue; }
      await c.query(`UPDATE expenses SET deleted_at = now() WHERE id = $1`, [row.id]);
      counts.deleted++;
      logs.push({ entity: 'expense', entityId: row.id, entityName: row.category, action: 'expense_delete', field: 'amount',
        oldValue: String(row.amount), newValue: null, reason: 'Excel jadvalida o‘chirildi (' + row.spent_on + ')' });
    }
    for (const it of xu) {
      const id = text(it && it.id);
      if (xd.some(d => text(d && d.id) === id)) continue;
      const row = xCur.get(id);
      const sv = (it && it.set) || {}, ov = (it && it.orig) || {};
      try {
        if (!row) throw new RowError('x', id, null, 'Xarajat topilmadi (o‘chirilgan bo‘lishi mumkin)');
        const now = xView(row);
        const keys = Object.keys(sv).filter(k => k in now);
        for (const k of keys) {
          if (k in ov && !xSame(ov[k], now[k], k)) throw new RowError('x', id, k, 'Bu katak boshqa joyda o‘zgartirilgan. Jadvalni yangilang.');
        }
        const changed = keys.filter(k => !xSame(sv[k], now[k], k));
        if (!changed.length) continue;
        const next = Object.assign({}, now);
        for (const k of keys) next[k] = sv[k];
        const v = xIn(next, row.spent_on);
        if (v.error) throw new RowError('x', id, xFieldOf(v.error), v.error);
        await c.query(`UPDATE expenses SET spent_on=$1::date, person=$2, category=$3, vehicle=$4, amount=$5, pay_method=$6,
            liters=$7, odometer=$8, note=$9, updated_at=now() WHERE id=$10`,
          [v.spent_on, v.person, v.category, v.vehicle, v.amount, v.pay_method, v.liters, v.odometer, v.note, row.id]);
        counts.updated++;
        for (const k of changed) {
          logs.push({ entity: 'expense', entityId: row.id, entityName: v.category, action: 'sheet_edit', field: k,
            oldValue: now[k], newValue: v[k] === null || v[k] === undefined ? '' : v[k], reason: DEFAULT_REASON });
        }
      } catch (e) { if (e instanceof RowError) errors.push(e); else throw e; }
    }
    for (const it of xc) {
      const key = text(it && it.key);
      const v = xIn((it && it.set) || {}, day);
      if (v.error) { errors.push(new RowError('x', key, xFieldOf(v.error), v.error)); continue; }
      const r = await c.query(`INSERT INTO expenses(user_id, spent_on, person, category, vehicle, amount, pay_method, liters, odometer, note)
        VALUES($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [user, v.spent_on, v.person, v.category, v.vehicle, v.amount, v.pay_method, v.liters, v.odometer, v.note]);
      counts.created++;
      logs.push({ entity: 'expense', entityId: r.rows[0].id, entityName: v.category, action: 'sheet_create', field: 'amount',
        newValue: String(v.amount), reason: 'Excel jadvalida qo‘shildi (' + v.spent_on + ')' });
    }

    if (errors.length) {
      await c.query('ROLLBACK');
      return json(res, 400, {
        ok: false,
        error: errors.length === 1 ? errors[0].message : errors.length + ' ta katakda xato — qizil kataklarni tuzating',
        errors: errors.map(e => ({ kind: e.kind, key: e.key, field: e.field, error: e.message }))
      });
    }
    await c.query('COMMIT');
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch { /* noop */ }
    throw e;
  } finally { c.release(); }

  /* jurnal — saqlangandan keyin (jurnal xatosi saqlashni buzmasin) */
  for (const l of logs) await logChange(null, user, l);
  return json(res, 200, Object.assign({ ok: true, counts }, await dayData(user, day)));
}

export async function handleSheetRequest(req, res) {
  const path = String(req.url || '').split('?', 1)[0];
  if (path !== '/api/sheet/day') return false;
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return true; }
  const user = auth(req);
  if (!user) { json(res, 401, { error: 'Kirish talab qilinadi' }); return true; }
  try {
    await ensureKassaSchema();
    if (req.method === 'GET') {
      const u = new URL(req.url, 'http://localhost');
      let day = text(u.searchParams.get('date'));
      if (!day) day = (await pool.query(`SELECT to_char((now() AT TIME ZONE '${TZ}')::date,'YYYY-MM-DD') d`)).rows[0].d;
      if (!isDay(day)) { json(res, 400, { error: 'Sana noto‘g‘ri' }); return true; }
      /* vaqti tugaganlar avval yopiladi — jadval «Jarayonda» bilan bir xil bo'lsin */
      try { await autoCloseDue(user); } catch (e) { console.error('SHEET AUTO CLOSE:', e.message); }
      json(res, 200, await dayData(user, day));
      return true;
    }
    if (req.method === 'POST') { await save(req, res, user); return true; }
    json(res, 405, { error: 'Method ruxsat etilmagan' });
    return true;
  } catch (e) {
    console.error('SHEET ERROR:', e);
    json(res, 500, { error: e.message || 'Excel jadvali bo‘yicha xatolik' });
    return true;
  }
}
