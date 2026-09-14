import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  /* Bulutdagi baza SSL talab qiladi. Kompyuterda lokal Postgres bilan
     ishlaganda esa SSL yo'q — shunda PGNOSSL=1 qo'yiladi. */
  ssl: process.env.PGNOSSL === '1' ? false : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

pool.on('error', (error) => {
  console.error(
    'POSTGRES POOL ERROR:',
    error
  );
});
