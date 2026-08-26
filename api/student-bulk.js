import jwt from 'jsonwebtoken';
import { pool } from '../backend/src/db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
const uid = req => String(req.user.sub);

function auth(req, res) {
  try {
    const h = req.headers.authorization || '';
    if (!h.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Kirish talab qilinadi' });
      return false;
    }
    req.user = jwt.verify(h.slice(7), JWT_SECRET);
    return true;
  } catch {
    res.status(401).json({ error: 'Sessiya yaroqsiz yoki tugagan' });
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!auth(req, res)) return;

  const body = req.body || {};
  const schoolId = String(body.schoolId || '');
  const groupId = body.groupId ? String(body.groupId) : null;
  const rows = Array.isArray(body.rows) ? body.rows : [];

  if (!schoolId) return res.status(400).json({ error: 'Avtoshkola tanlanmagan' });
  if (!rows.length) return res.status(400).json({ error: 'Qo‘shish uchun o‘quvchilar yo‘q' });

  const owner = uid(req);
  const c = await pool.connect();
  let added = 0;
  const errors = [];

  try {
    await c.query('BEGIN');

    await c.query(`
      ALTER TABLE public.students
        ADD COLUMN IF NOT EXISTS birth_date DATE,
        ADD COLUMN IF NOT EXISTS attendance_count INTEGER NOT NULL DEFAULT 0
    `);

    const school = await c.query(
      `SELECT id FROM driving_schools WHERE id=$1 AND owner_key=$2 AND active=true`,
      [schoolId, owner]
    );
    if (!school.rows[0]) throw new Error('Avtoshkola topilmadi');

    if (groupId) {
      const group = await c.query(
        `SELECT id FROM school_groups WHERE id=$1 AND school_id=$2 AND owner_key=$3 AND active=true`,
        [groupId, schoolId, owner]
      );
      if (!group.rows[0]) throw new Error('Guruh topilmadi');
    }

    for (let i = 0; i < rows.length; i++) {
      const x = rows[i] || {};
      const fullName = String(x.fullName || '').trim();
      const birthDate = String(x.birthDate || '').trim();
      const lessons = Number(x.lessons);

      if (!fullName) {
        errors.push({ row: i + 1, error: 'F.I.Sh. bo‘sh' });
        continue;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
        errors.push({ row: i + 1, error: 'Tug‘ilgan sana YYYY-MM-DD formatida bo‘lishi kerak' });
        continue;
      }
      if (!Number.isInteger(lessons) || lessons < 0) {
        errors.push({ row: i + 1, error: 'Darslar soni noto‘g‘ri' });
        continue;
      }

      await c.query(
        `INSERT INTO students(owner_key,school_id,group_id,full_name,birth_date,attendance_count)
         VALUES($1,$2,$3,$4,$5,$6)`,
        [owner, schoolId, groupId, fullName, birthDate, Math.min(999, lessons)]
      );
      added++;
    }

    await c.query('COMMIT');
    return res.status(201).json({ added, errors });
  } catch (e) {
    await c.query('ROLLBACK');
    return res.status(400).json({ error: e.message || 'Ommaviy qo‘shishda xatolik' });
  } finally {
    c.release();
  }
}
