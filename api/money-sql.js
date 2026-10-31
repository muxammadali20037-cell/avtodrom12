/* ============================================================================
   PUL HARAKATI — barcha hisobotlar uchun BITTA qoida

   Kassaga tushgan pul ikki joydan keladi:
     1) seansning o'z to'lovi (oldindan yoki chiqishda): naqd / terminal /
        Klik — seans BOSHLANGAN kunga (Kunlik hisobot, Excel, Nazorat bilan
        bir xil); ichkaridagi (oldindan to'lagan) mashinaning puli ham;
     2) keyin to'langan qarz (debt_payments) — TO'LANGAN kunga.
   Bitta pul ikki marta sanalmaydi: qarz to'langanda seansning
   cash/terminal/click ustunlari o'zgarmaydi, faqat debt_payments ga yoziladi.

   `at` — pul qaysi paytga tegishli, `post` — qaysi kassa (1-POST / 2-POST).
   Ustun eski bazada bo'lmasa ham yiqilmasin — to_jsonb orqali o'qiladi.
   ========================================================================== */

const j = (a, c) => `NULLIF(to_jsonb(${a})->>'${c}', '')`;

export const MONEY_EVENTS = `(
  SELECT s.user_id::text AS user_id, s.id AS session_id, 'session'::text AS kind, s.started_at AS at,
         COALESCE(s.cash_amount, 0)::numeric AS cash,
         COALESCE(s.terminal_amount, 0)::numeric AS terminal,
         COALESCE(${j('s', 'click_amount')}::numeric, 0) AS click,
         COALESCE(s.amount, 0)::numeric AS total,
         COALESCE(${j('s', 'pay_post')}::int, ${j('s', 'post')}::int, 1) AS post,
         (s.school_id IS NOT NULL OR s.student_id IS NOT NULL OR COALESCE(s.customer_type, '') = 'school') AS is_school,
         COALESCE(NULLIF(v.plate, ''), ${j('s', 'driver_name')}, '—') AS plate
    FROM sessions s LEFT JOIN vehicles v ON v.id = s.vehicle_id
   WHERE s.status IN ('completed', 'active', 'frozen', 'paused')
  UNION ALL
  SELECT d.user_id::text, d.session_id, 'debt'::text, d.paid_at,
         CASE WHEN d.method IN ('terminal', 'click') THEN 0 ELSE d.amount END::numeric,
         CASE WHEN d.method = 'terminal' THEN d.amount ELSE 0 END::numeric,
         CASE WHEN d.method = 'click' THEN d.amount ELSE 0 END::numeric,
         d.amount::numeric,
         COALESCE(d.post, 1)::int,
         FALSE,
         COALESCE(NULLIF(v.plate, ''), ${j('s', 'driver_name')}, '—')
    FROM debt_payments d
    LEFT JOIN sessions s ON s.id = d.session_id
    LEFT JOIN vehicles v ON v.id = s.vehicle_id
)`;

/* Seans bo'yicha (mashina, instruktor, operator reytinglari): o'sha seans
   olib kelgan JAMI pul = o'z to'lovi + keyin to'langan qarzi */
export const SESSION_MONEY = (a = 's') => `(COALESCE(${a}.amount, 0) + COALESCE(NULLIF(to_jsonb(${a})->>'debt_paid', '')::numeric, 0))`;
