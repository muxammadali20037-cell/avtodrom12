/* ============================================================================
   INSTRUKTOR JADVALI IKKI XIL KO'RINISHDA

   Loyiha tarixi davomida `instructors` jadvali ikki marta o'zgargan:

     eski:  alohida ustunlar — full_name, owner_key, phone, plate, model,
            school_id
     yangi: `bio` ustunida ism, qolgani esa `settings` JSONB ichida —
            {"owner_key":..,"school_id":..,"vehicle_plate":..,
             "vehicle_model":..,"phone":..}

   Hozirgi ilova (api/instructors-fixed.js) YANGI ko'rinishda yozadi,
   lekin bazada eski yozuvlar ham qolgan bo'lishi mumkin va ba'zi
   o'rnatmalarda ustunlarning o'zi yo'q.

   Shuning uchun SQL ni qat'iy yozib bo'lmaydi: `i.full_name` yo'q
   bo'lsa butun so'rov «column does not exist» bilan yiqiladi. Bu modul
   jadvalda QAYSI ustunlar borligini bir marta tekshirib, o'shalardan
   moslashuvchan ifoda quradi. Barcha hisobotlar shu ifodani ishlatadi.
   ========================================================================== */

import { pool } from '../backend/src/db.js';

let colsPromise = null;

/** `instructors` jadvalidagi ustunlar to'plami (bir marta o'qiladi). */
export function instructorCols() {
  if (colsPromise) return colsPromise;
  colsPromise = pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='instructors'`)
    .then(r => new Set(r.rows.map(x => x.column_name)))
    .catch(e => { colsPromise = null; throw e; });
  return colsPromise;
}

function pickCol(cols, parts) {
  const on = parts.filter(Boolean);
  if (!on.length) return `NULL::text`;
  return on.length === 1 ? on[0] : `COALESCE(${on.join(', ')})`;
}

/**
 * Instruktor maydonlari uchun SQL ifodalar. Jadval taxallusi `i`
 * bo'lishi shart.
 *   name   — F.I.Sh.
 *   owner  — egasi (owner_key)
 *   plate  — avtomobil raqami
 *   model  — avtomobil rusumi
 *   phone  — telefon
 *   school — avtoshkola id
 */
export function insExpr(cols) {
  const has = c => cols.has(c);
  const j = has('settings');
  const s = key => (j ? `NULLIF(TRIM(i.settings->>'${key}'),'')` : null);

  return {
    name: pickCol(cols, [
      has('full_name') ? `NULLIF(TRIM(i.full_name),'')` : null,
      has('bio') ? `NULLIF(TRIM(i.bio),'')` : null,
      s('full_name')
    ]),
    owner: pickCol(cols, [
      has('owner_key') ? `NULLIF(TRIM(i.owner_key),'')` : null,
      s('owner_key')
    ]),
    plate: pickCol(cols, [
      has('plate') ? `NULLIF(TRIM(i.plate),'')` : null,
      has('vehicle_plate') ? `NULLIF(TRIM(i.vehicle_plate),'')` : null,
      s('vehicle_plate')
    ]),
    model: pickCol(cols, [
      has('model') ? `NULLIF(TRIM(i.model),'')` : null,
      has('vehicle_model') ? `NULLIF(TRIM(i.vehicle_model),'')` : null,
      s('vehicle_model')
    ]),
    phone: pickCol(cols, [
      has('phone') ? `NULLIF(TRIM(i.phone),'')` : null,
      s('phone')
    ]),
    school: pickCol(cols, [
      has('school_id') ? `NULLIF(TRIM(i.school_id::text),'')` : null,
      s('school_id')
    ])
  };
}

/** Bir chaqiruvda ham ustunlarni, ham ifodalarni beradi. */
export async function instructorExpr() {
  return insExpr(await instructorCols());
}
