/**
 * POSTLAR KESIMIDA — boshliq va analitika ko'priklari uchun «Kassirlar»
 *
 * Ilgari kassirlar HISOB nomi bo'yicha guruhlanardi. Boshqa login asosiy
 * hisobga qo'shilgach (masalan, Ramziddin «Platniylar» hisobiga) uning
 * yozuvlari asosiy hisob nomiga qo'shilib ketardi — u alohida ko'rinmasdi.
 * Endi har qator — POST (1-POST, 2-POST): shu postda ochilgan kirishlar va
 * shu postda olingan pul (kassa hisoboti bilan bir xil qoida, money-sql.js).
 * Postga biriktirilgan login bo'lsa, uning ismi post yonida chiqadi:
 * «2-POST · Ramziddin».
 *
 *   postOperators(safe, { done, mWhere, params, isPaid, isSchool })
 *     done   — sessions s uchun shart (bridge'dagi `done`, $1..$3)
 *     mWhere — MONEY_EVENTS m uchun shart (o'sha parametrlar bilan)
 */
import { MONEY_EVENTS } from './money-sql.js';
import { loginPost } from './accounts-routes.js';

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const postNo = (v) => { const x = Math.round(Number(v)); return x >= 1 && x <= 9 ? x : 1; };

export async function postOperators(safe, { done, mWhere, params, isPaid, isSchool }) {
  const [sess, money, users] = await Promise.all([
    safe('operators', `
      SELECT s.user_id::text AS uid, COALESCE(NULLIF(to_jsonb(s)->>'post', '')::int, 1) AS post,
             COUNT(*)::int AS sessions,
             COUNT(*) FILTER (WHERE ${isPaid})::int AS paid,
             COUNT(*) FILTER (WHERE ${isSchool})::int AS school,
             COALESCE(SUM(COALESCE(s.duration_seconds, 0)), 0)::bigint AS seconds
        FROM sessions s WHERE ${done} GROUP BY 1, 2`, params),
    safe('operators_money', `
      SELECT m.user_id AS uid, m.post,
             COALESCE(SUM(m.total), 0)::float8 AS total, COALESCE(SUM(m.cash), 0)::float8 AS cash,
             COALESCE(SUM(m.terminal), 0)::float8 AS terminal, COALESCE(SUM(m.click), 0)::float8 AS click
        FROM ${MONEY_EVENTS} m WHERE ${mWhere} GROUP BY 1, 2`, params),
    safe('operators_users', `
      SELECT u.id::text AS id, COALESCE(NULLIF(u.full_name, ''), u.username, 'Operator') AS name,
             NULLIF(to_jsonb(u)->>'parent_id', '') AS parent_id, NULLIF(to_jsonb(u)->>'post', '') AS post
        FROM users u`, []),
  ]);

  const names = new Map(users.map((u) => [String(u.id), u.name]));
  /* asosiy hisob + post → shu postga biriktirilgan loginlar */
  const bound = new Map();
  for (const u of users) {
    if (!u.parent_id) continue;
    const k = `${u.parent_id}|${loginPost(u.post)}`;
    if (!bound.has(k)) bound.set(k, []);
    bound.get(k).push(u.name);
  }

  const rows = new Map();
  const row = (uid, post) => {
    const k = `${uid}|${post}`;
    if (!rows.has(k)) rows.set(k, { uid, post, sessions: 0, paid: 0, school: 0, seconds: 0, revenue: 0, cash: 0, terminal: 0, click: 0 });
    return rows.get(k);
  };
  for (const s of sess) {
    const r = row(String(s.uid), postNo(s.post));
    r.sessions += n(s.sessions); r.paid += n(s.paid); r.school += n(s.school); r.seconds += n(s.seconds);
  }
  for (const m of money) {
    const r = row(String(m.uid), postNo(m.post));
    r.revenue += n(m.total); r.cash += n(m.cash); r.terminal += n(m.terminal); r.click += n(m.click);
  }

  const list = [...rows.values()].filter((r) => r.sessions || r.revenue);
  const manyAccounts = new Set(list.map((r) => r.uid)).size > 1;
  return list.map((r) => {
    const account = names.get(r.uid) || 'Hisob';
    const people = bound.get(`${r.uid}|${r.post}`) || [];
    const who = people.length ? people.join(', ') + (manyAccounts ? ` (${account})` : '') : account;
    return {
      name: `${r.post}-POST · ${who}`,
      post: r.post, account, people,
      sessions: r.sessions, paid: r.paid, school: r.school, minutes: Math.round(r.seconds / 60),
      revenue: r.revenue, cash: r.cash, terminal: r.terminal, click: r.click,
    };
  }).sort((a, b) => a.account.localeCompare(b.account) || a.post - b.post);
}
