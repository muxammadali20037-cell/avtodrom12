import jwt from 'jsonwebtoken';
import { pool } from '../backend/src/db.js';
import { ensureQuotaSchema, quotaForInsert } from './quota-routes.js';
import { logChange, reasonError, LESSONS_NEED_REASON } from './audit-routes.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';

function bodyOf(req) {
  if (req?.body && typeof req.body === 'object') return req.body;
  if (typeof req?.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}

function userId(req) {
  try {
    const h = req.headers?.authorization || '';
    if (!h.startsWith('Bearer ')) return null;
    const token = jwt.verify(h.slice(7), JWT_SECRET);
    return String(token.sub);
  } catch {
    return null;
  }
}

let schemaPromise = null;
function ensureCompatSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await pool.query(`
        ALTER TABLE students
          ADD COLUMN IF NOT EXISTS birth_date DATE,
          ADD COLUMN IF NOT EXISTS manual_attendance_count INTEGER NOT NULL DEFAULT 0
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_students_birth_date ON students(birth_date)`);

      /* DAVOMAT uchun: avtoshkola darsida avtomobil qatnashmaydi,
         shuning uchun sessiya avtomobilsiz ham yozilishi kerak.
         Mavjud yozuvlarga ta'sir qilmaydi — faqat majburiylik olinadi. */
      const q = async sql => {
        try { await pool.query(sql); } catch (e) { console.error('COMPAT SCHEMA:', e.message); }
      };
      await q(`ALTER TABLE sessions ALTER COLUMN vehicle_id DROP NOT NULL`);
      /* Instruktor ro'yxatdan tanlanmasa ham ismi saqlansin */
      await q(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS instructor_name TEXT`);
      /* Davomat yozuvlarini ajratib olish uchun */
      await q(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS customer_type VARCHAR(20)`);
      /* NAZORAT: vaqt kim uchun ochilgani va necha soatga ochilgani */
      await q(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS instructor_id TEXT`);
      await q(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS target_duration INTEGER`);
      await q(`CREATE INDEX IF NOT EXISTS idx_sessions_instructor_day
               ON sessions(instructor_id, started_at)`);
      await q(`CREATE INDEX IF NOT EXISTS idx_sessions_student_done
               ON sessions(student_id, status) WHERE student_id IS NOT NULL`);
      /* Katta hajm uchun: 3000 o'quvchi va yuz minglab dars yozuvida
         hisobotlar jadvalni boshdan-oxir o'qib chiqmasin. */
      await q(`CREATE INDEX IF NOT EXISTS idx_sessions_user_status_started
               ON sessions(user_id, status, started_at DESC)`);
      await q(`CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at)`);
      await q(`CREATE INDEX IF NOT EXISTS idx_students_owner_name ON students(owner_key, full_name)`);

      /* ================= DARSLAR SONI =================
         `students.attendance_count` — haqiqiy ustun, uni trigger
         yuritadi. Mavjud trigger FAQAT UPDATE da ishlaydi:
             AFTER UPDATE OF status ... WHEN OLD.status <> 'completed'
         chunki oddiy sessiya avval 'active' bo'lib ochiladi, keyin
         yakunlanadi.

         Davomat esa darhol 'completed' bo'lib YOZILADI — UPDATE
         umuman bo'lmaydi, shuning uchun trigger ishlamas va darslar
         soni o'zgarmasdi.

         Quyidagi INSERT triggeri aynan shu holatni qoplaydi. Ikki
         marta sanalmaydi: 'active' bo'lib ochilgan sessiyada bu
         trigger jim turadi, yakunlanganda esa eski UPDATE triggeri
         ishlaydi. */
      await q(`ALTER TABLE students ADD COLUMN IF NOT EXISTS attendance_count INTEGER NOT NULL DEFAULT 0`);
      await q(`
        CREATE OR REPLACE FUNCTION public.avtodrom_attendance_on_insert()
        RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
        BEGIN
          IF NEW.student_id IS NOT NULL AND UPPER(COALESCE(NEW.status,'')) = 'COMPLETED' THEN
            UPDATE public.students
               SET attendance_count = COALESCE(attendance_count,0)
                   + GREATEST(1, ROUND(COALESCE(NEW.duration_seconds,3600)/3600.0)::int)
             WHERE id = NEW.student_id;
          END IF;
          RETURN NEW;
        END; $fn$;
      `);
      await q(`DROP TRIGGER IF EXISTS trg_avtodrom_student_attendance_ins ON public.sessions`);
      await q(`CREATE TRIGGER trg_avtodrom_student_attendance_ins
               AFTER INSERT ON public.sessions
               FOR EACH ROW EXECUTE FUNCTION public.avtodrom_attendance_on_insert()`);
    })().catch(error => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

function send(res, status, data) {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function parsePlate(regionCode, raw) {
  const region = String(regionCode || '').trim();
  const body = String(raw || '').replace(/\s+/g, '').toUpperCase();
  const regions = ['01','10','20','25','30','40','50','60','70','75','80','85','90','95'];
  if (!regions.includes(region)) throw new Error('Viloyat kodi noto‘g‘ri');
  if (!/^[A-Z0-9]{6}$/.test(body)) throw new Error('Raqam 6 ta belgi bo‘lishi kerak. Masalan: 111QQQ yoki A555AA');

  if (/^\d{3}[A-Z]{3}$/.test(body)) {
    return { region, body, firstLetter: body[3], number: body.slice(0,3), lastLetters: body.slice(4,6), plate: `${region} ${body}` };
  }
  if (/^[A-Z]\d{3}[A-Z]{2}$/.test(body)) {
    return { region, body, firstLetter: body[0], number: body.slice(1,4), lastLetters: body.slice(4,6), plate: `${region} ${body}` };
  }
  throw new Error('Raqam formati noto‘g‘ri. Masalan: 111QQQ yoki A555AA');
}

export async function handleCompatRequest(req, res) {
  const pathname = String(req.url || '').split('?')[0];
  if (!pathname.startsWith('/api/')) return false;

  const schoolMatch = pathname.match(/^\/api\/schools\/([^/]+)$/);
  const studentMatch = pathname.match(/^\/api\/students\/([^/]+)$/);
  const isCompatRoute =
    (req.method === 'POST' && (pathname === '/api/sessions/start' || pathname === '/api/student-bulk')) ||
    (req.method === 'POST' && pathname === '/api/attendance') ||
    (req.method === 'POST' && pathname === '/api/group-bulk') ||
    (req.method === 'GET' && pathname === '/api/duplicates') ||
    (req.method === 'POST' && pathname === '/api/duplicates/merge') ||
    (req.method === 'GET' && pathname === '/api/students') ||
    (req.method === 'PATCH' && !!schoolMatch) ||
    (req.method === 'PATCH' && !!studentMatch);

  // Everything else must continue to the existing Express server.
  if (!isCompatRoute) return false;

  const user = userId(req);
  if (!user) {
    send(res, 401, { error: 'Kirish talab qilinadi' });
    return true;
  }

  try {
    await ensureCompatSchema();

    // ===== START: compact plate is stored exactly as typed =====
    if (req.method === 'POST' && pathname === '/api/sessions/start') {
      const body = bodyOf(req);
      let p;
      try {
        p = parsePlate(body.regionCode, body.plateBody || body.plate);
      } catch (e) {
        send(res, 400, { error: e.message });
        return true;
      }

      const c = await pool.connect();
      try {
        await c.query('BEGIN');

        let vr = await c.query(`SELECT * FROM vehicles WHERE plate=$1 AND user_id=$2`, [p.plate, user]);
        let v = vr.rows[0];
        if (!v) {
          vr = await c.query(`
            INSERT INTO vehicles(user_id,region_code,first_letter,number,last_letters,plate,model,driver_name)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *
          `, [user,p.region,p.firstLetter,p.number,p.lastLetters,p.plate,body.model||null,body.driverName||null]);
          v = vr.rows[0];
        } else {
          await c.query(`UPDATE vehicles SET model=COALESCE($1,model),driver_name=COALESCE($2,driver_name) WHERE id=$3 AND user_id=$4`, [body.model||null,body.driverName||null,v.id,user]);
        }

        let schoolId = body.schoolId ? String(body.schoolId) : null;
        let groupId = body.groupId ? String(body.groupId) : null;
        let studentId = body.studentId ? String(body.studentId) : null;

        if (studentId) {
          const sr = await c.query(`SELECT id,school_id,group_id FROM students WHERE id=$1 AND owner_key=$2 AND active=true`, [studentId,user]);
          if (!sr.rows[0]) throw new Error('O‘quvchi topilmadi');
          schoolId = sr.rows[0].school_id;
          groupId = sr.rows[0].group_id;
        }
        if (schoolId) {
          const sr = await c.query(`SELECT id FROM driving_schools WHERE id=$1 AND owner_key=$2 AND active=true`, [schoolId,user]);
          if (!sr.rows[0]) throw new Error('Avtoshkola topilmadi');
        }
        if (groupId) {
          const gr = await c.query(`SELECT id FROM school_groups WHERE id=$1 AND school_id=$2 AND owner_key=$3 AND active=true`, [groupId,schoolId,user]);
          if (!gr.rows[0]) throw new Error('Guruh noto‘g‘ri');
        }

        const active = await c.query(`SELECT id FROM sessions WHERE vehicle_id=$1 AND user_id=$2 AND status='active' LIMIT 1`, [v.id,user]);
        if (active.rows[0]) {
          await c.query('ROLLBACK');
          send(res,409,{error:'Bu avtomobil hozir jarayonda',activeSessionId:active.rows[0].id});
          return true;
        }

        const set = await c.query(`SELECT hourly_rate,minimum_payment,calculation_mode FROM user_settings WHERE user_id=$1`, [user]);
        const s = set.rows[0] || {hourly_rate:30000,minimum_payment:0,calculation_mode:'hour'};

        /* =================================================================
           NAZORAT UCHUN MUHIM
           Vaqt KIM uchun ochilayotgani ham yozib qo'yiladi. Ilgari bu
           yerda instruktor saqlanmasdi va «Nazorat > Xatoliklar va
           aniqliklar» bo'limida ochilgan soatni o'quvchilar davomati
           bilan solishtirib bo'lmasdi: instruktor 2 soat ochtirib,
           3 ta o'quvchisini uchirsa ham farq ko'rinmasdi.

           Ustunlar to'plami o'rnatmadan o'rnatmaga farq qilgani uchun
           faqat mavjud ustunlar yoziladi.
           ================================================================= */
        const instructorId = String(body.instructorId || body.instructor_id || '').trim() || null;
        const instructorName = String(body.instructorName || body.instructor_name || '').trim() || null;
        const customerType = String(body.customerType || body.customer_type || '').trim()
          || (studentId ? 'school' : 'regular');
        let target = Number(body.targetDuration || body.target_duration || 0);
        if (!target && Number(body.targetHours || body.target_hours)) {
          target = Number(body.targetHours || body.target_hours) * 3600;
        }
        if (!target) target = 3600;
        target = Math.min(12 * 3600, Math.max(900, Math.round(target)));

        /* ===== VAQT ORALIG'I (masalan 11:00 dan 12:00 gacha) =====
           Operator aniq soatni tanlagan bo'lsa, sessiya o'sha soatda
           boshlanadi. Ilgari boshlanish vaqti doim NOW() edi va
           «11:00 dan» deb kelishilgan mijozning vaqti kassada chek
           chiqarilgan paytdan sanalardi.

           Cheklov: bugungi kundan 12 soat oldin yoki keyin bo'lmasin —
           xato kiritilgan sana butun hisobotni buzib qo'ymasin. */
        let startAt = null;
        const rawStart = body.startAt || body.start_at || body.startedAt || body.started_at;
        if (rawStart) {
          const d = new Date(rawStart);
          if (!Number.isNaN(d.getTime())) {
            const diff = Math.abs(d.getTime() - Date.now());
            if (diff <= 12 * 3600 * 1000) startAt = d.toISOString();
          }
        }

        if (instructorId) {
          const ir = await c.query(
            `SELECT id FROM instructors WHERE id::text=$1 AND COALESCE(active,TRUE)=TRUE`, [instructorId]);
          if (!ir.rows[0]) throw new Error('Instruktor topilmadi');
        }

        const sessCols = new Set((await c.query(
          `SELECT column_name FROM information_schema.columns
            WHERE table_schema='public' AND table_name='sessions'`)).rows.map(x => x.column_name));

        const cand = [
          ['user_id', user],
          ['vehicle_id', v.id],
          ['started_at', startAt],
          ['hourly_rate', s.hourly_rate],
          ['minimum_payment', s.minimum_payment],
          ['calculation_mode', s.calculation_mode],
          ['school_id', schoolId],
          ['group_id', groupId],
          ['student_id', studentId],
          ['instructor_id', instructorId],
          ['instructor_name', instructorName],
          ['customer_type', customerType],
          ['target_duration', target],
          ['driver_name', body.driverName || null],
          ['manual_price', true]
        ].filter(([k, val]) => sessCols.has(k) && !(k === 'started_at' && val === null));

        const r = await c.query(
          `INSERT INTO sessions(${cand.map(([k]) => k).join(',')})
           VALUES(${cand.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING id,started_at`,
          cand.map(([, val]) => val));

        await c.query('COMMIT');
        send(res,201,{id:r.rows[0].id,plate:p.plate,plateBody:p.body,startedAt:r.rows[0].started_at,
                      schoolId,groupId,studentId,instructorId,target_duration:target});
        return true;
      } catch (e) {
        try { await c.query('ROLLBACK'); } catch {}
        send(res,e.code==='23505'?409:400,{error:e.code==='23505'?'Bu avtomobil hozir jarayonda':(e.message||'START bajarilmadi')});
        return true;
      } finally { c.release(); }
    }

    /* =====================================================================
       DAVOMAT — avtoshkola o'quvchisi uchun

       Avtoshkola darsida vaqt OCHILMAYDI: o'quvchi instruktori bilan
       keladi, darsi shu yerda belgilanadi va tugadi. Shuning uchun
       avtomobil raqami ham so'ralmaydi.

       Bir bosishda BITTA yozuv bo'ladi: 2 soat tanlansa — 2 soatlik
       bitta yozuv (duration 7200, lessons_counted 2). Ilgari har soat
       alohida yozuv bo'lib, jadvalda bitta o'quvchi ikki marta
       ko'rinardi. Darslar soni lessons_counted / davomiylik bo'yicha
       hisoblanadi (1 soat = 1 dars).
       ===================================================================== */
    if (req.method === 'POST' && pathname === '/api/attendance') {
      const body = bodyOf(req);
      const studentId = String(body.studentId || body.student_id || '').trim();
      const insName = String(body.instructorName || body.instructor_name || '').trim();
      const insId = String(body.instructorId || body.instructor_id || '').trim() || null;
      const lessons = Math.max(1, Math.min(12, Math.round(Number(body.lessons || 1)) || 1));
      /* Qaysi mashinada uchgani — keyin instruktor tarixida kerak bo'ladi */
      const carPlate = String(body.plate || body.vehiclePlate || body.vehicle_plate || '')
        .toUpperCase().replace(/\s+/g, ' ').trim();
      const carModel = String(body.model || body.vehicleModel || body.vehicle_model || '').trim();

      /* Instruktor IXTIYORIY: yozilsa saqlanadi, yozilmasa davomat
         baribir yoziladi. O'quvchi esa shart. */
      if (!studentId) { send(res, 400, { error: 'O‘quvchini tanlang' }); return true; }

      /* ===== KO'P DARS BIRDANIGA — SABAB MAJBURIY =====
         1-2 dars odatiy hol. 3 va undan ko'p dars bir yozuvda
         kiritilsa, nega shunchaligi yozilishi kerak: keyin
         hisobotda «bu odam bir kunda 4 dars olgan» degan savol
         chiqsa, javob shu yerda turadi. */
      const sabab = String(body.reason || body.izoh || body.note || '').trim();
      if (lessons > LESSONS_NEED_REASON) {
        const bad = reasonError(sabab);
        if (bad) {
          send(res, 400, { error: bad, needReason: true, lessons: lessons });
          return true;
        }
      }

      const c = await pool.connect();
      try {
        await c.query('BEGIN');

        const sr = await c.query(
          `SELECT id, school_id, group_id, full_name FROM students
            WHERE id=$1 AND owner_key=$2 AND active=true`, [studentId, user]);
        const st = sr.rows[0];
        if (!st) throw new Error('O‘quvchi topilmadi');

        const set = await c.query(
          `SELECT hourly_rate, minimum_payment, calculation_mode FROM user_settings WHERE user_id=$1`, [user]);
        const cfg = set.rows[0] || { hourly_rate: 30000, minimum_payment: 0, calculation_mode: 'hour' };

        /* Ustunlar to'plami o'rnatmadan o'rnatmaga farq qiladi —
           bor ustunlarnigina yozamiz, aks holda «column ... does not
           exist» butun amalni yiqitardi. */
        const cols = new Set((await c.query(
          `SELECT column_name FROM information_schema.columns
            WHERE table_schema='public' AND table_name='sessions'`)).rows.map(r => r.column_name));

        /* vehicle_id majburiy bo'lsa davomat yozib bo'lmaydi —
           administratorga aniq aytamiz (migratsiya kerak). */
        const vreq = (await c.query(
          `SELECT is_nullable FROM information_schema.columns
            WHERE table_schema='public' AND table_name='sessions' AND column_name='vehicle_id'`)).rows[0];
        if (vreq && vreq.is_nullable === 'NO') {
          throw new Error('Baza tayyor emas: sessions.vehicle_id bo‘sh bo‘lishiga ruxsat bering '
            + '(ALTER TABLE sessions ALTER COLUMN vehicle_id DROP NOT NULL)');
        }

        /* ===== SHARTNOMA LIMITI =====
           O'quvchining avtodromdagi bepul kirishlari shartnomadagi
           limitdan oshdimi? Oshgan bo'lsa yozuv BLOKLANMAYDI — shunchaki
           qatorga belgilanadi va kassaga ogohlantirish qaytariladi.
           Nazoratda «to'lov kerak edi» degan summa shundan chiqadi. */
        let quota = null;
        try {
          await ensureQuotaSchema();
          await c.query('SAVEPOINT sp_quota');
          quota = await quotaForInsert(c, user, st.id, lessons);
          await c.query('RELEASE SAVEPOINT sp_quota');
        } catch (e) {
          try { await c.query('ROLLBACK TO SAVEPOINT sp_quota'); } catch {}
          quota = null;
          console.error('[attendance] limit hisobi:', e && e.message);
        }

        /* Darslar sonini qulflab olamiz: bir vaqtda ikkita davomat
           yozilsa ham son to'g'ri chiqadi. */
        let before = null;
        try {
          await c.query('SAVEPOINT sp_att');
          const b = await c.query(
            `SELECT COALESCE(attendance_count,0)::int n FROM students WHERE id=$1 FOR UPDATE`, [st.id]);
          await c.query('RELEASE SAVEPOINT sp_att');
          if (b.rows[0]) before = b.rows[0].n;
        } catch (e) {
          try { await c.query('ROLLBACK TO SAVEPOINT sp_att'); } catch {}
          console.error('[attendance] darslar soni o‘qilmadi:', e && e.message);
        }

        const now = Date.now();
        const HOUR = 3600;
        const ids = [];
        /* ==================================================================
           BITTA DAVOMAT = BITTA YOZUV

           2 soatga yozilgan o'quvchi hisobotda «12:00 dan 14:00 gacha»
           bo'lib, bitta qatorda ko'rinadi. Ilgari har soat alohida
           qator bo'lardi va bitta o'quvchi ro'yxatda ikki-uch marta
           takrorlanib, «qayta ochilgan»dek ko'rinardi.

           Kirish — davomat qayd etilgan payt (aniq ma'lumot).
           Chiqish — kirish + tanlangan soat (rejadagi tugash vaqti).
           Darslar soni `lessons_counted` da, shuning uchun bitta
           yozuv bo'lsa ham dars soni to'g'ri sanaladi.
           ================================================================== */
        const totalSeconds = lessons * HOUR;
        const startedAt = new Date(now).toISOString();
        const finishedAt = new Date(now + totalSeconds * 1000).toISOString();

        /* Qaysi mashinada uchgani yozib qo'yiladi: keyin «falon kuni
           falon instruktor kimni, qaysi raqamli mashinada uchirgan»
           degan savolga javob shu yerdan chiqadi. */
        let vehicleId = null;
        if (carPlate) {
          try {
            await c.query('SAVEPOINT sp_car');
            const found = await c.query(
              `SELECT id FROM vehicles WHERE user_id=$1 AND plate=$2 LIMIT 1`, [user, carPlate]);
            if (found.rows[0]) {
              vehicleId = found.rows[0].id;
              if (carModel) {
                await c.query(`UPDATE vehicles SET model=COALESCE(NULLIF($1,''),model) WHERE id=$2`,
                  [carModel, vehicleId]);
              }
            } else {
              const made = await c.query(
                `INSERT INTO vehicles(user_id, plate, model) VALUES($1,$2,$3) RETURNING id`,
                [user, carPlate, carModel || null]);
              vehicleId = made.rows[0].id;
            }
            await c.query('RELEASE SAVEPOINT sp_car');
          } catch (e) {
            try { await c.query('ROLLBACK TO SAVEPOINT sp_car'); } catch {}
            vehicleId = null;
            console.error('[attendance] mashina yozilmadi:', e && e.message);
          }
        }

        {
          const cand = [
            ['user_id', user],
            ['vehicle_id', vehicleId],
            ['started_at', startedAt],
            ['finished_at', finishedAt],
            ['duration_seconds', totalSeconds],
            ['hourly_rate', cfg.hourly_rate],
            ['minimum_payment', cfg.minimum_payment],
            ['calculation_mode', cfg.calculation_mode],
            ['manual_price', true],
            ['amount', 0],
            ['cash_amount', 0],
            ['terminal_amount', 0],
            ['payment_method', 'cash'],
            ['status', 'completed'],
            ['school_id', st.school_id],
            ['group_id', st.group_id],
            ['student_id', st.id],
            ['instructor_id', insId],
            ['instructor_name', insName || null],
            ['driver_name', st.full_name],
            ['customer_type', 'school'],
            ['planned_minutes', lessons * 60],
            ['target_duration', totalSeconds],
            ['lessons_counted', lessons],
            /* Nechinchi kirish va limitdan qanchasi oshgani */
            ['visit_index', quota ? quota.visitIndex : null],
            ['over_lessons', quota ? quota.overLessons : null],
          ].filter(([k]) => cols.has(k));

          const r = await c.query(
            `INSERT INTO sessions(${cand.map(([k]) => k).join(', ')})
             VALUES(${cand.map((_, n) => '$' + (n + 1)).join(',')}) RETURNING id`,
            cand.map(([, v]) => v));
          ids.push(r.rows[0].id);
        }

        /* KAFOLAT: darslar soni aniq oshadi.
           Odatda buni trigger qiladi. Ammo trigger yo'q bo'lsa yoki uni
           yaratishga huquq yetmagan bo'lsa, son o'zgarmay qolardi —
           shuning uchun natijani TEKSHIRAMIZ va yetmagan qismini
           o'zimiz qo'shamiz. Trigger ishlagan bo'lsa bu yerda hech
           narsa qilinmaydi, ya'ni ikki marta sanalmaydi. */
        let total = null;
        if (before !== null) {
          try {
            await c.query('SAVEPOINT sp_att2');
            const a = await c.query(
              `SELECT COALESCE(attendance_count,0)::int n FROM students WHERE id=$1`, [st.id]);
            let now2 = a.rows[0] ? a.rows[0].n : null;
            if (now2 !== null && now2 !== before + lessons) {
              const r2 = await c.query(
                `UPDATE students SET attendance_count=$1 WHERE id=$2 RETURNING attendance_count`,
                [before + lessons, st.id]);
              now2 = r2.rows[0] ? Number(r2.rows[0].attendance_count) : now2;
            }
            await c.query('RELEASE SAVEPOINT sp_att2');
            total = now2;
          } catch (e) {
            try { await c.query('ROLLBACK TO SAVEPOINT sp_att2'); } catch {}
            console.error('[attendance] darslar sonini to‘g‘rilash:', e && e.message);
          }
        }

        await c.query('COMMIT');

        /* Ko'p dars yozilgan bo'lsa sababi jurnalga tushsin */
        if (lessons > LESSONS_NEED_REASON) {
          await logChange(null, user, {
            entity: 'student', entityId: st.id, entityName: st.full_name,
            action: 'attendance_bulk', field: 'lessons',
            oldValue: before === null ? '' : before,
            newValue: (before === null ? '' : before + lessons) + ' (+' + lessons + ')',
            reason: sabab, actor: user });
        }

        send(res, 201, { ok: true, lessons, ids, total,
                         studentId: st.id, studentName: st.full_name, instructorName: insName,
                         quota: quota });
        return true;
      } catch (e) {
        try { await c.query('ROLLBACK'); } catch {}
        console.error('[attendance]', e);
        send(res, 400, { error: e.message || 'Davomat yozilmadi' });
        return true;
      } finally { c.release(); }
    }

    // ===== AVTOSHKOLA TAHRIRLASH =====
    if (req.method === 'PATCH' && schoolMatch) {
      const id=schoolMatch[1],body=bodyOf(req);
      const name=String(body.name??'').trim();
      const phone=String(body.phone??'').trim();
      const notes=body.notes==null?null:String(body.notes);
      if(!name){send(res,400,{error:'Avtoshkola nomi kerak'});return true;}
      const r=await pool.query(`UPDATE driving_schools SET name=$1,phone=$2,notes=$3 WHERE id=$4 AND owner_key=$5 RETURNING *`,[name,phone||null,notes,id,user]);
      if(!r.rows[0]){send(res,404,{error:'Avtoshkola topilmadi'});return true;}
      send(res,200,r.rows[0]);return true;
    }

    // ===== O‘QUVCHI TAHRIRLASH =====
    if (req.method === 'PATCH' && studentMatch) {
      const id=studentMatch[1],body=bodyOf(req);
      const fullName=String(body.fullName??body.name??'').trim();
      const birthDate=body.birthDate?String(body.birthDate).trim():null;
      const groupId=body.groupId?String(body.groupId):null;
      const attendance=body.attendanceCount??body.lessons??body.manualAttendanceCount;
      if(!fullName){send(res,400,{error:'F.I.Sh. kerak'});return true;}
      if(birthDate&&!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)){send(res,400,{error:'Tug‘ilgan sana noto‘g‘ri'});return true;}
      if(attendance!==undefined&&(!Number.isInteger(Number(attendance))||Number(attendance)<0)){send(res,400,{error:'Qatnashgan darslar soni noto‘g‘ri'});return true;}

      const current=await pool.query(`SELECT id,school_id FROM students WHERE id=$1 AND owner_key=$2 AND active=true`,[id,user]);
      if(!current.rows[0]){send(res,404,{error:'O‘quvchi topilmadi'});return true;}
      if(groupId){
        const g=await pool.query(`SELECT id FROM school_groups WHERE id=$1 AND school_id=$2 AND owner_key=$3 AND active=true`,[groupId,current.rows[0].school_id,user]);
        if(!g.rows[0]){send(res,400,{error:'Guruh noto‘g‘ri'});return true;}
      }

      const attendanceValue=attendance===undefined?null:Number(attendance);
      const r=await pool.query(`
        UPDATE students SET full_name=$1,birth_date=$2,group_id=$3,manual_attendance_count=COALESCE($4,manual_attendance_count)
        WHERE id=$5 AND owner_key=$6 RETURNING *
      `,[fullName,birthDate||null,groupId,attendanceValue,id,user]);
      send(res,200,r.rows[0]);return true;
    }

    // ===== O‘QUVCHILAR RO‘YXATI =====
    if(req.method==='GET'&&pathname==='/api/students'){
      const q=new URL(req.url,'http://localhost').searchParams;
      const params=[user];
      let where='st.owner_key=$1 AND st.active=true';
      if(q.get('schoolId')){params.push(q.get('schoolId'));where+=` AND st.school_id=$${params.length}`;}
      if(q.get('groupId')){params.push(q.get('groupId'));where+=` AND st.group_id=$${params.length}`;}
      const r=await pool.query(`
        SELECT st.id,st.owner_key,st.school_id,st.group_id,st.full_name,st.birth_date,st.phone,st.plate,st.notes,st.active,st.created_at,
               s.name school_name,g.name group_name,
               /* Darslar sonini trigger yuritadi (api/students.js ga qarang) */
               COALESCE(st.attendance_count,0)::int attendance_count
        FROM students st JOIN driving_schools s ON s.id=st.school_id LEFT JOIN school_groups g ON g.id=st.group_id
        WHERE ${where} ORDER BY st.full_name
      `,params);
      send(res,200,r.rows);return true;
    }

    // ===== OMMAVIY O‘QUVCHI QO‘SHISH: FAQAT F.I.SH. + SANA + DARSLAR =====
    /* =====================================================================
       GURUHLARNI OMMAVIY YARATISH — oraliq bo'yicha

       Misol: 23 dan 43 gacha => 23, 24, ... 43 (21 ta guruh) bir marta
       yaratiladi. Mavjudlari o'tkazib yuboriladi, ya'ni qayta bosilsa
       nusxa paydo bo'lmaydi.
       ===================================================================== */
    if(req.method==='POST'&&pathname==='/api/group-bulk'){
      const body=bodyOf(req);
      const schoolId=String(body.schoolId||'').trim();
      const from=Math.floor(Number(body.from));
      const to=Math.floor(Number(body.to));
      const prefix=String(body.prefix||'').trim();

      if(!schoolId){send(res,400,{error:'Avtoshkola tanlanmagan'});return true;}
      if(!Number.isFinite(from)||!Number.isFinite(to)){send(res,400,{error:'Oraliqni raqam bilan kiriting'});return true;}
      const a=Math.min(from,to), b=Math.max(from,to);
      if(a<0||b>9999){send(res,400,{error:'Guruh raqami 0–9999 oralig‘ida bo‘lsin'});return true;}
      if(b-a+1>200){send(res,400,{error:'Bir marta ko‘pi bilan 200 ta guruh yaratish mumkin'});return true;}

      const school=await pool.query(`SELECT id FROM driving_schools WHERE id=$1 AND owner_key=$2 AND active=true`,[schoolId,user]);
      if(!school.rows[0]){send(res,404,{error:'Avtoshkola topilmadi'});return true;}

      const c=await pool.connect();
      const created=[],exists=[];
      try{
        await c.query('BEGIN');
        for(let n=a;n<=b;n++){
          const name=prefix?`${prefix}${n}`:String(n);
          const bor=await c.query(
            `SELECT 1 FROM school_groups
              WHERE owner_key=$1 AND school_id=$2
                AND LOWER(TRIM(name))=LOWER(TRIM($3)) AND active=true
              LIMIT 1`,[user,schoolId,name]);
          if(bor.rows[0]){exists.push(name);continue;}
          await c.query(`INSERT INTO school_groups(owner_key,school_id,name) VALUES($1,$2,$3)`,[user,schoolId,name]);
          created.push(name);
        }
        await c.query('COMMIT');
      }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
      send(res,201,{ok:true,created:created.length,createdNames:created,
                    exists:exists.length,existsNames:exists.slice(0,30)});
      return true;
    }

    /* =====================================================================
       TAKRORLANGAN O'QUVCHILAR

       Ro'yxat bir necha marta yopishtirilganda yoki Excel ikki marta
       import qilinganda bitta o'quvchi bazada bir necha nusxa bo'lib
       qoladi. Operator paneli qidiruvida uchtasi ham chiqadi, davomat
       esa faqat bittasiga yoziladi — qolgan ikkitasi «darsga kelmagan»
       bo'lib ko'rinadi.

       Takror deb faqat AYNI avtoshkola + AYNI guruh + AYNI ism
       hisoblanadi. Ism solishtirishda katta-kichik harf, ortiqcha
       bo'sh joy va tinish belgilari (O'/O‘, nuqta, vergul) e'tiborga
       olinmaydi. Harflar o'chirilmaydi, shuning uchun kirill yozuvdagi
       ismlar ham to'g'ri solishtiriladi.
       ===================================================================== */
    const NORM_NAME = `btrim(regexp_replace(
        regexp_replace(upper(coalesce(full_name,'')), '[^[:alnum:][:space:]]', '', 'g'),
        '[[:space:]]+', ' ', 'g'))`;

    async function topDuplicates(owner){
      const r = await pool.query(`
        WITH n AS (
          SELECT st.id, st.school_id, st.group_id, st.full_name, st.birth_date,
                 st.created_at, COALESCE(st.attendance_count,0)::int AS att,
                 ${NORM_NAME} AS nkey
            FROM students st
           WHERE st.owner_key=$1 AND st.active=true
        )
        SELECT n.nkey, n.school_id, n.group_id,
               MIN(s.name) AS school_name, MIN(g.name) AS group_name,
               COUNT(*)::int AS cnt,
               json_agg(json_build_object(
                 'id', n.id, 'name', n.full_name, 'att', n.att,
                 'birth', n.birth_date, 'created', n.created_at
               ) ORDER BY n.created_at, n.id) AS nusxalar
          FROM n
          LEFT JOIN driving_schools s ON s.id=n.school_id
          LEFT JOIN school_groups  g ON g.id=n.group_id
         GROUP BY n.nkey, n.school_id, n.group_id
        HAVING COUNT(*) > 1
         ORDER BY COUNT(*) DESC, MIN(n.full_name)
         LIMIT 500
      `,[owner]);
      return r.rows;
    }

    if(req.method==='GET'&&pathname==='/api/duplicates'){
      const guruhlar = await topDuplicates(user);
      const ortiqcha = guruhlar.reduce((a,g)=>a+(g.cnt-1),0);
      send(res,200,{ok:true,groups:guruhlar,total:guruhlar.length,extra:ortiqcha});
      return true;
    }

    if(req.method==='POST'&&pathname==='/api/duplicates/merge'){
      const guruhlar = await topDuplicates(user);
      if(!guruhlar.length){send(res,200,{ok:true,merged:0,removed:0,message:'Takror topilmadi'});return true;}

      /* students ga ishora qiluvchi BARCHA jadvallarni bazadan so'raymiz.
         Qo'lda ro'yxat yozsak, kelajakda qo'shilgan jadval e'tibordan
         chetda qolib, yozuvlar yo'qolgandek ko'rinardi. */
      const fk = await pool.query(`
        SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
          FROM pg_constraint c
          JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
          JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
         WHERE c.contype='f'
           AND c.confrelid='public.students'::regclass
           AND array_length(c.conkey,1)=1
      `);
      const links = fk.rows;

      const c = await pool.connect();
      let merged=0, removed=0, moved=0;
      const failed=[];
      try{
        await c.query('BEGIN');
        for(const g of guruhlar){
          const rows = g.nusxalar || [];
          if(rows.length<2) continue;
          const keeper = rows[0].id;                 /* eng eski yozuv qoladi */
          const others = rows.slice(1).map(x=>x.id);
          await c.query('SAVEPOINT sp_dup');
          try{
            /* 1) Har bir nusxaning «qo'lda kiritilgan» darsi: umumiy
                  sondan shu nusxaga yozilgan haqiqiy darslarni ayiramiz. */
            const all=[keeper,...others];
            const sess=await c.query(
              `SELECT student_id, COALESCE(SUM(GREATEST(1, CASE WHEN COALESCE(lessons_counted,0) > 0 THEN lessons_counted ELSE ROUND(COALESCE(duration_seconds,3600)/3600.0)::int END)),0)::int n FROM sessions
                WHERE student_id = ANY($1::uuid[]) AND status='completed'
                GROUP BY student_id`,[all]);
            const sesMap=new Map(sess.rows.map(r=>[String(r.student_id),r.n]));
            let baza=0;
            for(const r of rows){
              const own=sesMap.get(String(r.id))||0;
              baza=Math.max(baza, Math.max(0, Number(r.att||0)-own));
            }

            /* 2) Barcha bog'liq yozuvlarni qoladigan o'quvchiga ko'chiramiz */
            for(const l of links){
              const u=await c.query(
                `UPDATE ${l.tbl} SET ${l.col}=$1 WHERE ${l.col}=ANY($2::uuid[])`,[keeper,others]);
              moved+=u.rowCount||0;
            }

            /* 3) Bo'sh maydonlarni nusxalardan to'ldiramiz */
            await c.query(`
              UPDATE students k SET
                birth_date = COALESCE(k.birth_date, d.birth_date),
                phone      = COALESCE(NULLIF(k.phone,''),      NULLIF(d.phone,'')),
                plate      = COALESCE(NULLIF(k.plate,''),      NULLIF(d.plate,'')),
                notes      = COALESCE(NULLIF(k.notes,''),      NULLIF(d.notes,''))
              FROM (SELECT MIN(birth_date) birth_date, MIN(phone) phone,
                           MIN(plate) plate, MIN(notes) notes
                      FROM students WHERE id=ANY($2::uuid[])) d
              WHERE k.id=$1
            `,[keeper,others]);

            /* 4) Darslar soni: qo'lda kiritilgani BIR MARTA + ko'chirilgan
                  barcha haqiqiy darslar. Nusxalarning bir xil boshlang'ich
                  soni qo'shilib ketmaydi. */
            const jami=await c.query(
              `SELECT COALESCE(SUM(GREATEST(1, CASE WHEN COALESCE(lessons_counted,0) > 0 THEN lessons_counted ELSE ROUND(COALESCE(duration_seconds,3600)/3600.0)::int END)),0)::int n FROM sessions WHERE student_id=$1 AND status='completed'`,[keeper]);
            const yangi=baza+(jami.rows[0]?jami.rows[0].n:0);
            await c.query(
              `UPDATE students SET attendance_count=$1, manual_attendance_count=$2 WHERE id=$3`,
              [yangi,baza,keeper]);

            /* 5) Ortiqcha nusxalar ro'yxatdan olinadi. O'CHIRILMAYDI —
                  active=false bo'ladi, ya'ni kerak bo'lsa qaytarish mumkin. */
            const del=await c.query(
              `UPDATE students SET active=false WHERE id=ANY($1::uuid[]) AND owner_key=$2`,[others,user]);
            removed+=del.rowCount||0;
            merged++;
            await c.query('RELEASE SAVEPOINT sp_dup');
          }catch(e){
            await c.query('ROLLBACK TO SAVEPOINT sp_dup');
            failed.push({name:(rows[0]&&rows[0].name)||g.nkey,reason:e.message});
            console.error('[duplicates] birlashtirilmadi:',g.nkey,e.message);
          }
        }
        await c.query('COMMIT');
      }catch(e){
        try{await c.query('ROLLBACK');}catch{}
        throw e;
      }finally{c.release();}

      send(res,200,{ok:true,merged,removed,moved,failed:failed.slice(0,20)});
      return true;
    }

    if(req.method==='POST'&&pathname==='/api/student-bulk'){
      const body=bodyOf(req);
      const schoolId=String(body.schoolId||'').trim();
      const groupId=body.groupId?String(body.groupId).trim():null;
      const rows=Array.isArray(body.rows)?body.rows:[];
      if(!schoolId){send(res,400,{error:'Avtoshkola tanlanmagan'});return true;}
      if(!rows.length){send(res,400,{error:'O‘quvchilar ro‘yxati bo‘sh'});return true;}

      const school=await pool.query(`SELECT id FROM driving_schools WHERE id=$1 AND owner_key=$2 AND active=true`,[schoolId,user]);
      if(!school.rows[0]){send(res,404,{error:'Avtoshkola topilmadi'});return true;}
      if(groupId){
        const group=await pool.query(`SELECT id FROM school_groups WHERE id=$1 AND school_id=$2 AND owner_key=$3 AND active=true`,[groupId,schoolId,user]);
        if(!group.rows[0]){send(res,400,{error:'Guruh noto‘g‘ri'});return true;}
      }

      const errors=[],valid=[];
      rows.forEach((row,index)=>{
        const fullName=String(row.fullName??'').trim();
        const birthDate=String(row.birthDate??'').trim();
        const lessons=Number(row.lessons??row.attendanceCount??0);
        if(!fullName){errors.push(`${index+1}-qator: F.I.Sh. kiritilmagan`);return;}
        /* Tug'ilgan sana IXTIYORIY: ro'yxat ko'pincha faqat ismlardan
           iborat bo'ladi. Berilsa formati tekshiriladi. */
        if(birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)){
          errors.push(`${index+1}-qator: tug‘ilgan sana noto‘g‘ri`);return;
        }
        if(!Number.isInteger(lessons)||lessons<0){errors.push(`${index+1}-qator: darslar soni noto‘g‘ri`);return;}
        valid.push({fullName,birthDate:birthDate||null,lessons});
      });
      if(!valid.length){send(res,400,{error:'Saqlash uchun to‘g‘ri ma’lumot topilmadi',errors});return true;}

      const c=await pool.connect();
      const added=[],skipped=[];
      try{
        await c.query('BEGIN');
        for(const row of valid){
          /* Shu guruhda AYNAN shunday ism bor bo'lsa qayta yozmaymiz —
             ro'yxat ikki marta yopishtirilsa nusxa paydo bo'lmaydi. */
          const bor=await c.query(
            `SELECT 1 FROM students
              WHERE owner_key=$1 AND school_id=$2
                AND COALESCE(group_id::text,'')=COALESCE($3::text,'')
                AND LOWER(TRIM(full_name))=LOWER(TRIM($4)) AND active=true
              LIMIT 1`,[user,schoolId,groupId,row.fullName]);
          if(bor.rows[0]){skipped.push(row.fullName);continue;}
          /* Darslar soni IKKALA ustunga ham yoziladi. Ilgari faqat
             `manual_attendance_count` to'ldirilardi, ilova esa hamma
             joyda `attendance_count` ni ko'rsatadi — import qilingan
             o'quvchilarning darsi 0 bo'lib turardi. */
          await c.query(`INSERT INTO students(owner_key,school_id,group_id,full_name,birth_date,manual_attendance_count,attendance_count) VALUES($1,$2,$3,$4,$5,$6,$6)`,[user,schoolId,groupId,row.fullName,row.birthDate,row.lessons]);
          added.push(row.fullName);
        }
        await c.query('COMMIT');
      }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
      send(res,201,{ok:true,added:added.length,skipped:skipped.length,skippedNames:skipped.slice(0,20),errors});return true;
    }

    return false;
  } catch(error) {
    console.error('COMPAT ROUTE ERROR:',error);
    send(res,500,{error:'Ma’lumotni saqlashda server xatosi'});
    return true;
  }
}
