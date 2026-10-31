/* ============================================================================
   POST (kassa) — avtodromda ikki kassa bo'lishi mumkin: 1-POST va 2-POST.
   Har kompyuter o'z postini tanlaydi va har so'rovda «X-Post: 1|2»
   sarlavhasini yuboradi. Server shu raqamni seans, to'lov, qarz to'lovi
   va xarajatga yozadi — hisobot postlar bo'yicha ajratiladi.
   ========================================================================== */
export function postOf(req) {
  const raw = req && req.headers ? (req.headers['x-post'] || req.headers['X-Post']) : null;
  const n = Math.round(Number(raw));
  return n >= 1 && n <= 9 ? n : null;
}
