import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "./db.js";

dotenv.config();

const app = express();

const JWT_SECRET =
  process.env.JWT_SECRET || "CHANGE_THIS_SECRET_IN_VERCEL";

app.use(cors({
  origin: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());


// =========================
// JWT
// =========================

function tokenFor(user) {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      username: user.username
    },
    JWT_SECRET,
    {
      expiresIn: "30d"
    }
  );
}


// =========================
// AUTH MIDDLEWARE
// =========================

async function auth(req, res, next) {
  try {
    const header = req.headers.authorization || "";

    if (!header.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Kirish talab qilinadi"
      });
    }

    const token = header.slice(7);

    const decoded = jwt.verify(token, JWT_SECRET);

    req.user = decoded;

    next();
  } catch (error) {
    return res.status(401).json({
      error: "Sessiya yaroqsiz yoki tugagan"
    });
  }
}


// =========================
// ACCOUNT DATA
// =========================

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


// =========================
// HEALTH
// =========================

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      ok: true,
      database: true
    });
  } catch (error) {
    console.error(error);

    res.status(503).json({
      ok: false,
      database: false
    });
  }
});


// =========================
// REGISTER
// =========================

app.post("/api/auth/register", async (req, res) => {
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
      error: "Ism, login va kamida 6 belgili parol kerak"
    });
  }

  const cleanName = String(fullName).trim();
  const cleanUsername = String(username).trim();

  if (cleanUsername.length < 3) {
    return res.status(400).json({
      error: "Login kamida 3 belgidan iborat bo‘lsin"
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await client.query(
      `
      INSERT INTO users(
        full_name,
        username,
        password_hash
      )
      VALUES($1, $2, $3)
      RETURNING
        id,
        full_name,
        username,
        role
      `,
      [
        cleanName,
        cleanUsername,
        passwordHash
      ]
    );

    const user = result.rows[0];

    await client.query(
      `
      INSERT INTO user_settings(user_id)
      VALUES($1)
      ON CONFLICT (user_id)
      DO NOTHING
      `,
      [user.id]
    );

    await client.query("COMMIT");

    const token = tokenFor(user);

    return res.status(201).json({
      user,
      token
    });

  } catch (error) {

    await client.query("ROLLBACK");

    console.error(error);

    if (error.code === "23505") {
      return res.status(409).json({
        error: "Bu login mavjud"
      });
    }

    return res.status(500).json({
      error: "Ro‘yxatdan o‘tishda xatolik"
    });

  } finally {
    client.release();
  }
});


// =========================
// LOGIN
// =========================

app.post("/api/auth/login", async (req, res) => {
  try {

    const username = String(
      req.body.username || ""
    ).trim();

    const password = String(
      req.body.password || ""
    );

    if (!username || !password) {
      return res.status(400).json({
        error: "Login va parolni kiriting"
      });
    }

    const result = await pool.query(
      `
      SELECT
        id,
        full_name,
        username,
        password_hash,
        role
      FROM users
      WHERE username = $1
      `,
      [username]
    );

    if (!result.rows[0]) {
      return res.status(401).json({
        error: "Login yoki parol noto‘g‘ri"
      });
    }

    const row = result.rows[0];

    const correct = await bcrypt.compare(
      password,
      row.password_hash
    );

    if (!correct) {
      return res.status(401).json({
        error: "Login yoki parol noto‘g‘ri"
      });
    }

    const user = {
      id: row.id,
      full_name: row.full_name,
      username: row.username,
      role: row.role
    };

    await ensureAccountData(user.id);

    const token = tokenFor(user);

    return res.json({
      user,
      token
    });

  } catch (error) {

    console.error(error);

    return res.status(500).json({
      error: "Kirishda xatolik"
    });
  }
});


// =========================
// CURRENT USER
// =========================

app.get("/api/auth/me", auth, async (req, res) => {
  try {

    const result = await pool.query(
      `
      SELECT
        id,
        full_name,
        username,
        role
      FROM users
      WHERE id = $1
      `,
      [req.user.sub]
    );

    if (!result.rows[0]) {
      return res.status(401).json({
        error: "Account topilmadi"
      });
    }

    res.json({
      user: result.rows[0]
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Accountni olishda xatolik"
    });
  }
});


// =========================
// SETTINGS GET
// =========================

app.get("/api/settings", auth, async (req, res) => {
  try {

    await ensureAccountData(req.user.sub);

    const result = await pool.query(
      `
      SELECT
        hourly_rate,
        minimum_payment,
        calculation_mode
      FROM user_settings
      WHERE user_id = $1
      `,
      [req.user.sub]
    );

    const row = result.rows[0];

    res.json({
      hourlyRate: Number(row.hourly_rate),
      minimumPayment: Number(row.minimum_payment),
      calculationMode: row.calculation_mode
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Sozlamalarni olishda xatolik"
    });
  }
});


// =========================
// SETTINGS UPDATE
// =========================

app.put("/api/settings", auth, async (req, res) => {
  try {

    await ensureAccountData(req.user.sub);

    const hourlyRate = Number(
      req.body.hourlyRate
    );

    const minimumPayment = Number(
      req.body.minimumPayment
    );

    const calculationMode =
      req.body.calculationMode === "minute"
        ? "minute"
        : "hour";

    if (
      !Number.isFinite(hourlyRate) ||
      hourlyRate <= 0
    ) {
      return res.status(400).json({
        error: "Soatlik narx noto‘g‘ri"
      });
    }

    if (
      !Number.isFinite(minimumPayment) ||
      minimumPayment < 0
    ) {
      return res.status(400).json({
        error: "Minimal to‘lov noto‘g‘ri"
      });
    }

    const result = await pool.query(
      `
      UPDATE user_settings
      SET
        hourly_rate = $1,
        minimum_payment = $2,
        calculation_mode = $3,
        updated_at = NOW()
      WHERE user_id = $4
      RETURNING
        hourly_rate,
        minimum_payment,
        calculation_mode
      `,
      [
        hourlyRate,
        minimumPayment,
        calculationMode,
        req.user.sub
      ]
    );

    const row = result.rows[0];

    res.json({
      hourlyRate: Number(row.hourly_rate),
      minimumPayment: Number(row.minimum_payment),
      calculationMode: row.calculation_mode
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Sozlamalarni saqlashda xatolik"
    });
  }
});


// =========================
// PLATE VALIDATION
// =========================

function plateData(body) {

  const allowedRegions = [
    "01",
    "10",
    "20",
    "25",
    "30",
    "40",
    "50",
    "60",
    "70",
    "75",
    "80",
    "85",
    "90",
    "95"
  ];

  const region = String(
    body.regionCode || ""
  );

  const firstLetter = String(
    body.firstLetter || ""
  ).toUpperCase();

  const number = String(
    body.number || ""
  );

  const lastLetters = String(
    body.lastLetters || ""
  ).toUpperCase();

  if (!allowedRegions.includes(region)) {
    throw new Error("Viloyat kodi noto‘g‘ri");
  }

  if (!/^[A-Z]$/.test(firstLetter)) {
    throw new Error("Birinchi harf noto‘g‘ri");
  }

  if (!/^[0-9]{3}$/.test(number)) {
    throw new Error("Raqam aynan 3 xonali bo‘lishi kerak");
  }

  if (!/^[A-Z]{2}$/.test(lastLetters)) {
    throw new Error("Oxirgi 2 harf noto‘g‘ri");
  }

  return {
    region,
    firstLetter,
    number,
    lastLetters,
    plate: `${region} ${firstLetter} ${number} ${lastLetters}`
  };
}


// =========================
// ACTIVE SESSIONS
// =========================

app.get("/api/sessions/active", auth, async (req, res) => {

  try {

    const result = await pool.query(
      `
      SELECT
        s.id,
        v.plate,
        v.model,
        v.driver_name,
        s.started_at,
        s.hourly_rate,
        s.minimum_payment,
        s.calculation_mode
      FROM sessions s
      JOIN vehicles v
        ON v.id = s.vehicle_id
      WHERE
        s.user_id = $1
        AND s.status = 'active'
      ORDER BY s.started_at
      `,
      [req.user.sub]
    );

    res.json(result.rows);

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Faol avtomobillarni olishda xatolik"
    });
  }
});


// =========================
// START
// =========================

app.post("/api/sessions/start", auth, async (req, res) => {

  let plate;

  try {

    plate = plateData(req.body);

  } catch (error) {

    return res.status(400).json({
      error: error.message
    });
  }

  const client = await pool.connect();

  try {

    await client.query("BEGIN");

    let vehicleResult = await client.query(
      `
      SELECT *
      FROM vehicles
      WHERE
        plate = $1
        AND user_id = $2
      `,
      [
        plate.plate,
        req.user.sub
      ]
    );

    let vehicle = vehicleResult.rows[0];

    if (!vehicle) {

      vehicleResult = await client.query(
        `
        INSERT INTO vehicles(
          user_id,
          region_code,
          first_letter,
          number,
          last_letters,
          plate,
          model,
          driver_name
        )
        VALUES(
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8
        )
        RETURNING *
        `,
        [
          req.user.sub,
          plate.region,
          plate.firstLetter,
          plate.number,
          plate.lastLetters,
          plate.plate,
          req.body.model || null,
          req.body.driverName || null
        ]
      );

      vehicle = vehicleResult.rows[0];

    } else {

      await client.query(
        `
        UPDATE vehicles
        SET
          model = COALESCE($1, model),
          driver_name = COALESCE($2, driver_name)
        WHERE id = $3
        `,
        [
          req.body.model || null,
          req.body.driverName || null,
          vehicle.id
        ]
      );
    }


    const settingsResult = await client.query(
      `
      SELECT
        hourly_rate,
        minimum_payment,
        calculation_mode
      FROM user_settings
      WHERE user_id = $1
      `,
      [req.user.sub]
    );

    const settings =
      settingsResult.rows[0] || {
        hourly_rate: 30000,
        minimum_payment: 30000,
        calculation_mode: "hour"
      };


    const sessionResult = await client.query(
      `
      INSERT INTO sessions(
        user_id,
        vehicle_id,
        hourly_rate,
        minimum_payment,
        calculation_mode
      )
      VALUES(
        $1,
        $2,
        $3,
        $4,
        $5
      )
      RETURNING
        id,
        started_at
      `,
      [
        req.user.sub,
        vehicle.id,
        settings.hourly_rate,
        settings.minimum_payment,
        settings.calculation_mode
      ]
    );

    const session = sessionResult.rows[0];

    await client.query("COMMIT");

    res.status(201).json({
      id: session.id,
      plate: plate.plate,
      startedAt: session.started_at
    });

  } catch (error) {

    await client.query("ROLLBACK");

    console.error(error);

    if (error.code === "23505") {

      return res.status(409).json({
        error: "Bu avtomobil hozir jarayonda"
      });
    }

    res.status(500).json({
      error: "START bajarilmadi"
    });

  } finally {

    client.release();
  }
});


// =========================
// FINISH
// =========================

app.post("/api/sessions/:id/finish", auth, async (req, res) => {

  const client = await pool.connect();

  try {

    await client.query("BEGIN");

    const result = await client.query(
      `
      SELECT
        s.*,
        v.plate
      FROM sessions s
      JOIN vehicles v
        ON v.id = s.vehicle_id
      WHERE
        s.id = $1
        AND s.user_id = $2
        AND s.status = 'active'
      FOR UPDATE
      `,
      [
        req.params.id,
        req.user.sub
      ]
    );

    if (!result.rows[0]) {

      await client.query("ROLLBACK");

      return res.status(404).json({
        error: "Sizning accountingizda faol sessiya topilmadi"
      });
    }

    const session = result.rows[0];

    const finishedAt = new Date();

    const seconds = Math.max(
      0,
      Math.floor(
        (
          finishedAt -
          new Date(session.started_at)
        ) / 1000
      )
    );

    const minutes = seconds / 60;

    let rawAmount;

    if (
      session.calculation_mode === "minute"
    ) {

      rawAmount =
        minutes *
        Number(session.hourly_rate) /
        60;

    } else {

      rawAmount =
        Math.max(
          1,
          Math.ceil(minutes / 60)
        ) *
        Number(session.hourly_rate);
    }

    const amount = Math.max(
      Number(session.minimum_payment),
      rawAmount
    );


    const updateResult = await client.query(
      `
      UPDATE sessions
      SET
        finished_at = $1,
        duration_seconds = $2,
        amount = $3,
        status = 'completed'
      WHERE
        id = $4
        AND user_id = $5
      RETURNING
        id,
        started_at,
        finished_at,
        duration_seconds,
        amount
      `,
      [
        finishedAt,
        seconds,
        amount,
        session.id,
        req.user.sub
      ]
    );

    await client.query("COMMIT");

    const row = updateResult.rows[0];

    res.json({
      ...row,
      plate: session.plate,
      amount: Number(row.amount)
    });

  } catch (error) {

    await client.query("ROLLBACK");

    console.error(error);

    res.status(500).json({
      error: "FINISH bajarilmadi"
    });

  } finally {

    client.release();
  }
});


// =========================
// DAILY REPORT
// =========================

app.get("/api/reports/daily", auth, async (req, res) => {

  try {

    const date =
      /^\d{4}-\d{2}-\d{2}$/.test(
        req.query.date || ""
      )
        ? req.query.date
        : new Date()
            .toISOString()
            .slice(0, 10);


    const result = await pool.query(
      `
      SELECT
        v.plate,
        s.started_at,
        s.finished_at,
        s.duration_seconds,
        s.amount
      FROM sessions s
      JOIN vehicles v
        ON v.id = s.vehicle_id
      WHERE
        s.user_id = $1
        AND s.status = 'completed'
        AND s.started_at::date = $2
      ORDER BY s.started_at DESC
      `,
      [
        req.user.sub,
        date
      ]
    );


    const summary =
      result.rows.reduce(
        (acc, row) => ({
          count: acc.count + 1,
          seconds:
            acc.seconds +
            Number(row.duration_seconds || 0),
          amount:
            acc.amount +
            Number(row.amount || 0)
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
      rows: result.rows
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Hisobotni olishda xatolik"
    });
  }
});


// =========================
// DASHBOARD
// =========================

app.get("/api/dashboard", auth, async (req, res) => {

  try {

    const result = await pool.query(
      `
      SELECT

        COUNT(*)
        FILTER(
          WHERE status = 'active'
        )::int AS active,

        COUNT(*)
        FILTER(
          WHERE
            status = 'completed'
            AND started_at::date = CURRENT_DATE
        )::int AS today_count,

        COALESCE(
          SUM(duration_seconds)
          FILTER(
            WHERE
              status = 'completed'
              AND started_at::date = CURRENT_DATE
          ),
          0
        )::bigint AS today_seconds,

        COALESCE(
          SUM(amount)
          FILTER(
            WHERE
              status = 'completed'
              AND started_at::date = CURRENT_DATE
          ),
          0
        )::numeric AS today_amount

      FROM sessions

      WHERE user_id = $1
      `,
      [req.user.sub]
    );


    const row = result.rows[0];

    res.json({
      active: Number(row.active),
      todayCount: Number(row.today_count),
      todaySeconds: Number(row.today_seconds),
      todayAmount: Number(row.today_amount)
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Dashboardni olishda xatolik"
    });
  }
});


// =========================
// VERCEL
// =========================

export default app;


// =========================
// LOCAL SERVER
// =========================

if (process.env.VERCEL !== "1") {

  const PORT =
    Number(process.env.PORT || 3000);

  app.listen(
    PORT,
    "0.0.0.0",
    () => {
      console.log(
        `AVTODROM running on :${PORT}`
      );
    }
  );
}
