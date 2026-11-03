/* ============================================================================
   BIR MARTALIK TUZATISH (03.11.2026, rahbar: «oldingi kunlarga umuman
   yozmasin — bugun to'ladimi, pul bugungi kunga tushsin»).

   Bu qoida kiritilishidan oldin, 03.11.2026 kuni o'tgan kunlardagi qarzlar
   «To'g'rilash» yoki Excel jadvali orqali yopilgan bo'lsa, pul o'sha O'TGAN
   kunning naqd/terminal/Klik iga yozilgan edi. Bu yerda o'sha pul
   to'g'rilangan paytdagi bugungi to'lovga (debt_payments) ko'chiriladi:
   o'tgan kunning puli avvalgidek, 03.11 tushumi — qarzdan to'langan.

   Faqat aniq holatlar: jurnalda (change_log) 03.11 kuni o'tgan kun yozuvining
   pul katagi OSHGAN, hozirgi qiymat jurnaldagi oxirgi qiymat bilan bir xil
   (keyin o'zgarmagan), kamaygan katak yo'q, keyin qarz to'lovi yo'q.
   ========================================================================== */

import { pool } from '../backend/src/db.js';
import { runOnce } from '../backend/src/schema-once.js';

const DAY = '2026-11-03';
const FIELD = { 'naqd': 'cash', 'terminal': 'terminal', 'Klik': 'click' };
const COL = { cash: 'cash_amount', terminal: 'terminal_amount', click: 'click_amount' };

export async function movePastCorrections(day = DAY) {
  const ok = await pool.query(`SELECT to_regclass('public.change_log') AS l, to_regclass('public.debt_payments') AS d`);
  if (!ok.rows[0].l || !ok.rows[0].d) return { moved: 0 };
  const logs = (await pool.query(`SELECT l.entity_id, l.field, l.old_value, l.new_value, l.created_at
      FROM change_log l
     WHERE l.entity = 'session' AND l.action IN ('correct', 'sheet_edit') AND l.field IN ('naqd', 'terminal', 'Klik')
       AND (l.created_at AT TIME ZONE 'Asia/Tashkent')::date = $1::date
     ORDER BY l.created_at, l.id`, [day])).rows;
  const by = new Map();
  for (const l of logs) {
    const g = by.get(l.entity_id) || {};
    const k = FIELD[l.field];
    if (!g[k]) g[k] = { old: Number(l.old_value), now: Number(l.new_value), at: l.created_at };
    else { g[k].now = Number(l.new_value); g[k].at = l.created_at; }
    by.set(l.entity_id, g);
  }
  let moved = 0, sum = 0;
  for (const [id, g] of by) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const r = await c.query(`SELECT s.*, (s.started_at AT TIME ZONE 'Asia/Tashkent')::date AS sday,
          to_char((s.started_at AT TIME ZONE 'Asia/Tashkent')::date, 'YYYY-MM-DD') AS sdays
        FROM sessions s WHERE s.id::text = $1 FOR UPDATE`, [id]);
      const s = r.rows[0];
      const keys = Object.keys(g);
      const bad = !s || s.status !== 'completed' || !(s.sdays < day) || Number(s.debt_paid || 0) > 0
        || keys.some(k => !Number.isFinite(g[k].old) || !Number.isFinite(g[k].now) || g[k].now < g[k].old
          || Math.round(Number(s[COL[k]] || 0)) !== Math.round(g[k].now));
      const inc = keys.reduce((a, k) => a + (g[k].now - g[k].old), 0);
      if (bad || inc <= 0) { await c.query('ROLLBACK'); continue; }
      const post = Number(s.pay_post || s.post || 1) || 1;
      const last = keys.map(k => g[k].at).sort().pop();
      for (const k of keys) {
        const amt = g[k].now - g[k].old;
        if (amt <= 0) continue;
        await c.query(`INSERT INTO debt_payments(user_id, session_id, amount, method, post, session_day, paid_at, note)
          VALUES($1, $2, $3, $4, $5, $6, $7, $8)`,
          [String(s.user_id), s.id, amt, k, post, s.sday, g[k].at, 'Avtomatik: ' + day.split('-').reverse().join('.') + ' dagi to‘g‘rilash shu kungi tushumga ko‘chirildi']);
      }
      const o = { cash: Number(s.cash_amount || 0), terminal: Number(s.terminal_amount || 0), click: Number(s.click_amount || 0) };
      for (const k of keys) o[k] = g[k].old;
      const paid = o.cash + o.terminal + o.click;
      const used = [o.cash > 0, o.terminal > 0, o.click > 0].filter(Boolean).length;
      const method = used > 1 ? 'mixed' : o.terminal > 0 ? 'terminal' : o.click > 0 ? 'click' : 'cash';
      await c.query(`UPDATE sessions SET cash_amount = $2, terminal_amount = $3, click_amount = $4, amount = $5, payment_method = $6,
          debt_paid = COALESCE(debt_paid, 0) + $7::numeric, settled_at = COALESCE(settled_at, $8::timestamptz) WHERE id = $1`,
        [s.id, o.cash, o.terminal, o.click, paid, method, inc, last]);
      await c.query(`INSERT INTO change_log(owner_key, entity, entity_id, entity_name, action, field, old_value, new_value, reason, actor)
          VALUES($1, 'session', $2, NULL, 'debt_paid', 'avtomatik', $3, $4, $5, 'tizim')`,
        [String(s.user_id), String(s.id), String(inc) + ' so‘m ' + s.sdays + ' kuniga yozilgan edi',
          String(inc) + ' so‘m ' + day + ' tushumiga ko‘chirildi', 'Pul faqat to‘langan kunga (o‘tgan kunga yozilmaydi)']);
      await c.query('COMMIT');
      moved++; sum += inc;
    } catch (e) {
      try { await c.query('ROLLBACK'); } catch { /* noop */ }
      console.error('MOVE PAST CORRECTION:', id, e.message);
    } finally { c.release(); }
  }
  if (moved) console.log('MOVE PAST CORRECTIONS:', moved, 'ta yozuv,', sum, 'so‘m', day, 'tushumiga');
  return { moved, sum };
}

let onceP = null;
export function movePastCorrectionsOnce() {
  if (onceP) return onceP;
  onceP = runOnce('move-past-corrections-2026-11-03', () => movePastCorrections(DAY)).catch(e => { onceP = null; throw e; });
  return onceP;
}
