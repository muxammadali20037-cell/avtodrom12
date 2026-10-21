import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

/* ============================================================================
   BAZA ULANISHLARI — barqarorlik

   Vercel'da har bir funksiya (api/index.js, api/students.js, ...) o'z
   nusxalarida alohida pool ochadi. Ilgari har birida 10 tagacha ulanish
   edi: yuklama oshganda (bir nechta kompyuter + navbat/hisobot so'rovlari)
   bazaning ulanish chegarasiga yetib, «qotib» qolardi.
     • max — PG_POOL_MAX (standart 5): bitta nusxaga yetarli, bazaga yengil;
     • bo'sh ulanish 10 soniyada yopiladi — uxlab qolgan nusxalar ulanishni
       ushlab turmaydi;
     • keepAlive — tarmoq uzilishlari tez sezilsin;
     • ULANISHNI OLISHda vaqtinchalik xato (baza qayta ishga tushdi, ulanish
       uzildi, chegara to'ldi) bo'lsa 3 martagacha qayta urinadi. So'rov
       bajarilmagan bosqichda — shuning uchun yozuv ikki marta tushmaydi.
     • 3 soniyadan uzoq so'rovlar jurnalga yoziladi (sekin joylarni topish uchun).
   ========================================================================== */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  /* Bulutdagi baza SSL talab qiladi. Kompyuterda lokal Postgres bilan
     ishlaganda esa SSL yo'q — shunda PGNOSSL=1 qo'yiladi. */
  ssl: process.env.PGNOSSL === '1' ? false : { rejectUnauthorized: false },
  max: Math.max(1, Math.min(20, Number(process.env.PG_POOL_MAX) || 5)),
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000
});

pool.on('error', (error) => {
  /* Bo'sh turgan ulanish uzilsa — pool uni o'zi tashlab yuboradi */
  console.error('POSTGRES POOL ERROR:', error && error.message);
});

const TRANSIENT_CODES = new Set(['57P01', '57P02', '57P03', '53300', '53400', '08000', '08001', '08003', '08004', '08006', 'XX000']);
const TRANSIENT_NET = /ECONNRESET|ECONNREFUSED|ENOENT \S*\.s\.PGSQL|ETIMEDOUT|EPIPE|EAI_AGAIN|ENOTFOUND|timeout exceeded when trying to connect|Connection terminated|terminating connection|too many clients|remaining connection slots/i;
export function isTransientDbError(e) {
  if (!e) return false;
  if (e.code && TRANSIENT_CODES.has(String(e.code))) return true;
  return TRANSIENT_NET.test(String(e.code || '') + ' ' + String(e.message || ''));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------------------------------------------------------------------
   QULAMASLIK UCHUN HIMOYA
   1) Band (tranzaksiya ichidagi) ulanish uzilsa — pg «error» hodisasini
      chiqaradi; tinglovchi bo'lmasa butun server JARAYONI YIQILADI
      (sinovda baza qayta ishga tushganda aynan shu bo'ldi). Har bir
      ulanishga doimiy tinglovchi qo'yiladi — xato faqat jurnalga yoziladi,
      ulanish qaytarilganda pool uni tashlab yuboradi.
   2) «Unutilgan» ulanish (release qilinmagan) poolni asta-sekin to'ldirib,
      ilovani qotirib qo'yadi. Har 30 soniyada tekshiriladi: 2 daqiqadan
      ortiq band turgani jurnalga (qayerda olingani bilan), 5 daqiqadan
      ortig'i majburan yopiladi — pool bo'shaydi.
   ------------------------------------------------------------------------- */
const checkedOut = new Map();          // client -> { at, where }
const LEAK_WARN_MS = 2 * 60 * 1000;
const LEAK_KILL_MS = 5 * 60 * 1000;

function onClientError(e) {
  console.error('DB CLIENT ERROR (band ulanish):', e && (e.code || ''), e && e.message);
}

function track(client) {
  if (!client.__avtGuard) {
    client.__avtGuard = true;
    client.on('error', onClientError);
  }
  const where = (new Error().stack || '').split('\n').slice(3, 7).map(s => s.trim()).join(' | ');
  checkedOut.set(client, { at: Date.now(), where, warned: false });
  const orig = client.release;
  let done = false;
  client.release = (err) => {
    if (done) return;              // ikki marta chaqirilsa — xato bermaydi
    done = true;
    checkedOut.delete(client);
    return orig(err);
  };
  return client;
}

const watchdog = setInterval(() => {
  const now = Date.now();
  for (const [client, info] of checkedOut) {
    const ms = now - info.at;
    if (ms > LEAK_KILL_MS) {
      console.error('DB LEAK: ulanish', Math.round(ms / 1000), 's band — majburan yopildi.', info.where);
      try { client.release(new Error('leak watchdog')); } catch { checkedOut.delete(client); }
    } else if (ms > LEAK_WARN_MS && !info.warned) {
      info.warned = true;
      console.warn('DB LEAK?: ulanish', Math.round(ms / 1000), 's band.', info.where);
    }
  }
}, 30000);
if (watchdog.unref) watchdog.unref();

export function poolStats() {
  let oldest = 0;
  for (const info of checkedOut.values()) oldest = Math.max(oldest, Date.now() - info.at);
  return { max: pool.options.max, total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount,
    busy: checkedOut.size, oldest_busy_ms: oldest };
}

/* Kutilmagan xato (await qilinmagan promise) butun serverni yiqitmasin —
   faqat jurnalga yoziladi. */
if (!globalThis.__avtUnhandledGuard) {
  globalThis.__avtUnhandledGuard = true;
  process.on('unhandledRejection', (e) => {
    console.error('UNHANDLED REJECTION:', e && (e.stack || e.message || e));
  });
}

const rawConnect = pool.connect.bind(pool);
async function connectRetry() {
  let last;
  /* 4 urinish (~2.5 s): baza qayta ishga tushishi / qisqa uzilish shu
     vaqt ichida o'tib ketadi */
  for (let i = 0; i < 4; i++) {
    try { return track(await rawConnect()); }
    catch (e) {
      last = e;
      if (!isTransientDbError(e) || i === 3) throw e;
      console.warn('DB CONNECT RETRY', i + 1, e.code || '', e.message);
      await sleep(300 + 400 * i + Math.floor(Math.random() * 200));
    }
  }
  throw last;
}

/* pool.connect() — callbacksiz chaqirilsa qayta urinish bilan */
pool.connect = function connect(cb) {
  if (typeof cb === 'function') {
    return rawConnect((err, client, done) => {
      if (err) return cb(err, client, done);
      track(client);
      cb(err, client, (e) => client.release(e));
    });
  }
  return connectRetry();
};

/* pool.query() — ulanish olish qayta urinish bilan; ulanish so'rov paytida
   uzilsa, u pooldan butunlay chiqariladi (keyingi so'rov yangisini oladi). */
const SLOW_MS = 3000;
pool.query = function query(text, values, cb) {
  if (typeof values === 'function' || typeof cb === 'function') {
    /* eski callback uslubi — o'zgarishsiz */
    return pg.Pool.prototype.query.call(pool, text, values, cb);
  }
  const sql = typeof text === 'string' ? text : (text && text.text) || '';
  /* Faqat O'QISH so'rovi (SELECT) ulanish uzilganda qayta yuboriladi —
     yozuv so'rovlari hech qachon takrorlanmaydi (ikki marta tushmasin). */
  const readOnly = /^\s*(SELECT|SHOW|WITH)\b/i.test(sql)
    && !/\b(INSERT|UPDATE|DELETE|MERGE|FOR\s+UPDATE|FOR\s+SHARE|nextval|setval|pg_terminate_backend|pg_advisory)/i.test(sql);
  return (async () => {
    for (let attempt = 0; ; attempt++) {
      const client = await connectRetry();
      const t0 = Date.now();
      try {
        const r = await client.query(text, values);
        const ms = Date.now() - t0;
        if (ms > SLOW_MS) console.warn('SLOW QUERY', ms + 'ms', sql.replace(/\s+/g, ' ').slice(0, 160));
        client.release();
        return r;
      } catch (e) {
        const transient = isTransientDbError(e);
        client.release(transient ? e : undefined);
        if (transient && readOnly && attempt < 2) {
          console.warn('DB READ RETRY', attempt + 1, e.code || '', e.message);
          await sleep(300 + 500 * attempt);
          continue;
        }
        throw e;
      }
    }
  })();
};
