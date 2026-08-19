import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

dotenv.config();

const app = express();

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET =
  process.env.JWT_SECRET || 'dev-only-change-me';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const frontendPath = path.resolve(
  __dirname,
  '../../frontend'
);

app.use(
  cors({
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN
          .split(',')
          .map(x => x.trim())
      : true,
    credentials: true
  })
);

app.use(express.json());

function tokenFor(u) {
  return jwt.sign(
    {
      sub: u.id,
      role: u.role,
      username: u.username
    },
    JWT_SECRET,
    {
      expiresIn: '30d'
    }
  );
}

async function auth(req, res, next) {
  try {
    const h = req.headers.authorization || '';

    if (!h.startsWith('Bearer ')) {
      return res
        .status(401)
        .json({
          error: 'Kirish talab qilinadi'
        });
    }

    req.user = jwt.verify(
      h.slice(7),
      JWT_SECRET
    );

    next();
  } catch {
    return res
      .status(401)
      .json({
        error: 'Sessiya yaroqsiz yoki tugagan'
      });
  }
}

function plateData(b) {
  const regions = [
    '01',
    '10',
    '20',
    '25',
    '30',
    '40',
    '50',
    '60',
    '70',
    '75',
    '80',
    '85',
    '90',
    '95'
  ];

  const r = String(
    b.regionCode || ''
  );

  const f = String(
    b.firstLetter || ''
  ).toUpperCase();

  const n = String(
    b.number || ''
  );

  const l = String(
    b.lastLetters || ''
  ).toUpperCase();

  if (
    !regions.includes(r) ||
    !/^[A-Z]$/.test(f) ||
    !/^[0-9]{3}$/.test(n) ||
    !/^[A-Z]{2}$/.test(l)
  ) {
    throw Error(
      'Avtomobil raqami noto‘g‘ri'
    );
  }

  return {
    r,
    f,
    n,
    l,
    plate: `${r} ${f} ${n} ${l}`
  };
}

async function ensureAccountData(userId) {
  await pool.query(
    `
    INSERT INTO user_settings(user_id)
    VALUES($1)
    ON CONFLICT (user_id)
    DO NOTHING
    `,
    [userId]
  );
}


/* =========================
   HEALTH
========================= */

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');

    res.json({
      ok: true,
      database: true
    });
  } catch (e) {
    console.error(e);

    res.status(503).json({
      ok: false,
      database: false
    });
  }
});


/* =========================
   REGISTER
========================= */

app.post(
  '/api/auth/register',
  async (req, res) => {
    const {
      fullName,
      username,
      password
    } = req.body;

    if (
      !fullName ||
      !username ||
      !password ||
      password.length < 6
    ) {
      return res.status(400).json({
        error:
          'Ism, login va kamida 6 belgili parol kerak'
      });
    }

    const c = await pool.connect();

    try {
      await c.query('BEGIN');

      const hash = await bcrypt.hash(
        password,
        12
      );

      const q = await c.query(
        `
        INSERT INTO users
        (
          full_name,
          username,
          password_hash
        )
        VALUES
        ($1,$2,$3)
        RETURNING
          id,
          full_name,
          username,
          role
        `,
        [
          fullName.trim(),
          username.trim(),
          hash
        ]
      );

      const u = q.rows[0];

      await c.query(
        `
        INSERT INTO user_settings(user_id)
        VALUES($1)
        `,
        [u.id]
      );

      await c.query('COMMIT');

      res.status(201).json({
        user: u,
        token: tokenFor(u)
      });

    } catch (e) {

      await c.query('ROLLBACK');

      console.error(e);

      res.status(
        e.code === '23505'
          ? 409
          : 500
      ).json({
        error:
          e.code === '23505'
            ? 'Bu login mavjud'
            : 'Ro‘yxatdan o‘tishda xatolik'
      });

    } finally {
      c.release();
    }
  }
);


/* =========================
   LOGIN
========================= */

app.post(
  '/api/auth/login',
  async (req, res) => {

    try {

      const username =
        String(
          req.body.username || ''
        ).trim();

      const password =
        req.body.password || '';

      const q = await pool.query(
        `
        SELECT *
        FROM users
        WHERE username=$1
        `,
        [username]
      );

      if (
        !q.rows[0] ||
        !(await bcrypt.compare(
          password,
          q.rows[0].password_hash
        ))
      ) {
        return res.status(401).json({
          error:
            'Login yoki parol noto‘g‘ri'
        });
      }

      const u = {
        id: q.rows[0].id,
        full_name:
          q.rows[0].full_name,
        username:
          q.rows[0].username,
        role:
          q.rows[0].role
      };

      await ensureAccountData(u.id);

      res.json({
        user: u,
        token: tokenFor(u)
      });

    } catch (e) {

      console.error(e);

      res.status(500).json({
        error:
          'Kirishda server xatosi'
      });
    }
  }
);


/* =========================
   SETTINGS
========================= */

app.get(
  '/api/settings',
  auth,
  async (req, res) => {

    try {

      await ensureAccountData(
        req.user.sub
      );

      const q = await pool.query(
        `
        SELECT
          hourly_rate,
          minimum_payment,
          calculation_mode
        FROM user_settings
        WHERE user_id=$1
        `,
        [req.user.sub]
      );

      const row = q.rows[0];

      res.json({
        hourlyRate:
          Number(row.hourly_rate),

        minimumPayment:
          Number(row.minimum_payment),

        calculationMode:
          row.calculation_mode
      });

    } catch (e) {

      console.error(e);

      res.status(500).json({
        error:
          'Sozlamalarni olishda xatolik'
      });
    }
  }
);


app.put(
  '/api/settings',
  auth,
  async (req, res) => {

    try {

      await ensureAccountData(
        req.user.sub
      );

      const h =
        Number(req.body.hourlyRate);

      const m =
        Number(req.body.minimumPayment);

      if (
        !Number.isFinite(h) ||
        h <= 0 ||
        !Number.isFinite(m) ||
        m < 0
      ) {
        return res.status(400).json({
          error:
            'Narx noto‘g‘ri'
        });
      }

      const mode =
        req.body.calculationMode ===
        'minute'
          ? 'minute'
          : 'hour';

      const q = await pool.query(
        `
        UPDATE user_settings
        SET
          hourly_rate=$1,
          minimum_payment=$2,
          calculation_mode=$3,
          updated_at=NOW()
        WHERE user_id=$4

        RETURNING
          hourly_rate,
          minimum_payment,
          calculation_mode
        `,
        [
          h,
          m,
          mode,
          req.user.sub
        ]
      );

      const row = q.rows[0];

      res.json({
        hourlyRate:
          Number(row.hourly_rate),

        minimumPayment:
          Number(row.minimum_payment),

        calculationMode:
          row.calculation_mode
      });

    } catch (e) {

      console.error(e);

      res.status(500).json({
        error:
          'Sozlamalarni saqlashda xatolik'
      });
    }
  }
);


/* =========================
   ACTIVE SESSIONS
========================= */

app.get(
  '/api/sessions/active',
  auth,
  async (req, res) => {

    try {

      const q = await pool.query(
        `
        SELECT
          s.id,
          v.plate,
          v.model,
          v.driver_name,
          s.started_at,
          s.hourly_rate,
          s.calculation_mode

        FROM sessions s

        JOIN vehicles v
          ON v.id=s.vehicle_id

        WHERE
          s.user_id=$1
          AND s.status='active'

        ORDER BY s.started_at
        `,
        [req.user.sub]
      );

      res.json(q.rows);

    } catch (e) {

      console.error(e);

      res.status(500).json({
        error:
          'Faol sessiyalarni olishda xatolik'
      });
    }
  }
);


/* =========================
   START
========================= */

app.post(
  '/api/sessions/start',
  auth,
  async (req, res) => {

    let p;

    try {

      p = plateData(req.body);

    } catch (e) {

      return res.status(400).json({
        error: e.message
      });
    }

    const c =
      await pool.connect();

    try {

      await c.query('BEGIN');

      let v =
        (
          await c.query(
            `
            SELECT *
            FROM vehicles
            WHERE
              plate=$1
              AND user_id=$2
            `,
            [
              p.plate,
              req.user.sub
            ]
          )
        ).rows[0];

      if (!v) {

        v =
          (
            await c.query(
              `
              INSERT INTO vehicles
              (
                user_id,
                region_code,
                first_letter,
                number,
                last_letters,
                plate,
                model,
                driver_name
              )
              VALUES
              ($1,$2,$3,$4,$5,$6,$7,$8)

              RETURNING *
              `,
              [
                req.user.sub,
                p.r,
                p.f,
                p.n,
                p.l,
                p.plate,
                req.body.model || null,
                req.body.driverName || null
              ]
            )
          ).rows[0];
      }

      const settings =
        (
          await c.query(
            `
            SELECT
              hourly_rate,
              minimum_payment,
              calculation_mode

            FROM user_settings

            WHERE user_id=$1
            `,
            [req.user.sub]
          )
        ).rows[0] || {
          hourly_rate: 30000,
          minimum_payment: 0,
          calculation_mode: 'hour'
        };

      const x =
        (
          await c.query(
            `
            INSERT INTO sessions
            (
              user_id,
              vehicle_id,
              hourly_rate,
              minimum_payment,
              calculation_mode
            )

            VALUES
            ($1,$2,$3,$4,$5)

            RETURNING
              id,
              started_at
            `,
            [
              req.user.sub,
              v.id,
              settings.hourly_rate,
              settings.minimum_payment,
              settings.calculation_mode
            ]
          )
        ).rows[0];

      await c.query('COMMIT');

      res.status(201).json({
        id: x.id,
        plate: p.plate,
        startedAt: x.started_at
      });

    } catch (e) {

      await c.query('ROLLBACK');

      console.error(e);

      res.status(
        e.code === '23505'
          ? 409
          : 500
      ).json({
        error:
          e.code === '23505'
            ? 'Bu avtomobil hozir jarayonda'
            : 'START bajarilmadi'
      });

    } finally {
      c.release();
    }
  }
);


/* =========================
   FINISH
========================= */

app.post(
  '/api/sessions/:id/finish',
  auth,
  async (req, res) => {

    const c =
      await pool.connect();

    try {

      await c.query('BEGIN');

      const q =
        await c.query(
          `
          SELECT
            s.*,
            v.plate

          FROM sessions s

          JOIN vehicles v
            ON v.id=s.vehicle_id

          WHERE
            s.id=$1
            AND s.user_id=$2
            AND s.status='active'

          FOR UPDATE
          `,
          [
            req.params.id,
            req.user.sub
          ]
        );

      if (!q.rows[0]) {

        await c.query('ROLLBACK');

        return res.status(404).json({
          error:
            'Sizning accountingizda faol sessiya topilmadi'
        });
      }

      const s = q.rows[0];

      const end = new Date();

      const sec =
        Math.max(
          0,
          Math.floor(
            (
              end -
              new Date(s.started_at)
            ) / 1000
          )
        );

      const min = sec / 60;

      const raw =
        s.calculation_mode === 'minute'
          ? min *
            Number(s.hourly_rate) /
            60
          : Math.max(
              1,
              Math.ceil(min / 60)
            ) *
            Number(s.hourly_rate);

      const amount =
        Math.max(
          Number(s.minimum_payment),
          raw
        );

      const u =
        await c.query(
          `
          UPDATE sessions

          SET
            finished_at=$1,
            duration_seconds=$2,
            amount=$3,
            status='completed'

          WHERE
            id=$4
            AND user_id=$5

          RETURNING
            id,
            started_at,
            finished_at,
            duration_seconds,
            amount
          `,
          [
            end,
            sec,
            amount,
            s.id,
            req.user.sub
          ]
        );

      await c.query('COMMIT');

      res.json({
        ...u.rows[0],
        plate: s.plate,
        amount:
          Number(u.rows[0].amount)
      });

    } catch (e) {

      await c.query('ROLLBACK');

      console.error(e);

      res.status(500).json({
        error:
          'FINISH bajarilmadi'
      });

    } finally {
      c.release();
    }
  }
);


/* =========================
   DAILY REPORT
========================= */

app.get(
  '/api/reports/daily',
  auth,
  async (req, res) => {

    try {

      const date =
        /^\d{4}-\d{2}-\d{2}$/.test(
          req.query.date || ''
        )
          ? req.query.date
          : new Date()
              .toISOString()
              .slice(0, 10);

      const q =
        await pool.query(
          `
          SELECT
            v.plate,
            s.started_at,
            s.finished_at,
            s.duration_seconds,
            s.amount

          FROM sessions s

          JOIN vehicles v
            ON v.id=s.vehicle_id

          WHERE
            s.user_id=$1
            AND s.status='completed'
            AND started_at::date=$2

          ORDER BY s.started_at DESC
          `,
          [
            req.user.sub,
            date
          ]
        );

      const summary =
        q.rows.reduce(
          (a, x) => ({
            count:
              a.count + 1,

            seconds:
              a.seconds +
              Number(
                x.duration_seconds || 0
              ),

            amount:
              a.amount +
              Number(
                x.amount || 0
              )
          }),
          {
            count: 0,
            seconds: 0,
            amount: 0
          }
        );

      res.json({
        date,
        summary,
        rows: q.rows
      });

    } catch (e) {

      console.error(e);

      res.status(500).json({
        error:
          'Hisobotni olishda xatolik'
      });
    }
  }
);


/* =========================
   DASHBOARD
========================= */

app.get(
  '/api/dashboard',
  auth,
  async (req, res) => {

    try {

      const q =
        await pool.query(
          `
          SELECT

            COUNT(*)
              FILTER(
                WHERE status='active'
              )::int active,

            COUNT(*)
              FILTER(
                WHERE
                  status='completed'
                  AND started_at::date=CURRENT_DATE
              )::int today_count,

            COALESCE(
              SUM(duration_seconds)
                FILTER(
                  WHERE
                    status='completed'
                    AND started_at::date=CURRENT_DATE
                ),
              0
            )::bigint today_seconds,

            COALESCE(
              SUM(amount)
                FILTER(
                  WHERE
                    status='completed'
                    AND started_at::date=CURRENT_DATE
                ),
              0
            )::numeric today_amount

          FROM sessions

          WHERE user_id=$1
          `,
          [req.user.sub]
        );

      const r = q.rows[0];

      res.json({
        active:
          r.active,

        todayCount:
          r.today_count,

        todaySeconds:
          Number(r.today_seconds),

        todayAmount:
          Number(r.today_amount)
      });

    } catch (e) {

      console.error(e);

      res.status(500).json({
        error:
          'Dashboardni olishda xatolik'
      });
    }
  }
);


/* =========================
   FRONTEND
========================= */

app.use(
  express.static(frontendPath)
);


/*
   Express 5 uchun to‘g‘ri wildcard
*/
app.get(
  '/{*splat}',
  (_req, res) => {
    res.sendFile(
      path.join(
        frontendPath,
        'index.html'
      )
    );
  }
);


/* =========================
   EXPORT
========================= */

export default app;


/*
   Faqat lokal kompyuterda
   serverni ishga tushirish.
   
   Vercel'da app.listen ishlatilmaydi.
*/

if (!process.env.VERCEL) {

  app.listen(
    PORT,
    '0.0.0.0',
    () => {
      console.log(
        `AVTODROM running on :${PORT}`
      );
    }
  );
}
