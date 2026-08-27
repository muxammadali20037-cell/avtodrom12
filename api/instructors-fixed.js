import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { pool } from '../backend/src/db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
const text = v => String(v ?? '').trim();
const cleanPlate = v => text(v).toUpperCase().replace(/[^A-Z0-9]/g, '');

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.end(JSON.stringify(data));
}

function auth(req) {
  try {
    const h = req.headers?.authorization || '';
    if (!h.startsWith('Bearer ')) return null;
    return String(jwt.verify(h.slice(7), JWT_SECRET).sub || '');
  } catch {
    return null;
  }
}

async function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return await new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { reject(new Error('JSON noto‘g‘ri')); }
    });
    req.on('error', reject);
  });
}

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.instructors (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      profile_id TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      approved BOOLEAN NOT NULL DEFAULT FALSE,
      approved_at TIMESTAMPTZ,
      approved_by TEXT,
      bio TEXT,
      category TEXT,
      experience_years INTEGER NOT NULL DEFAULT 0,
      settings JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function list(owner, id = null) {
  const params = [owner];
  let where = `(i.settings->>'owner_key') = $1`;
  if (id) {
    params.push(String(id));
    where += ` AND i.id = $2`;
  }

  const result = await pool.query(`
    SELECT
      i.id,
      i.active,
      i.approved,
      i.bio AS full_name,
      i.settings,
      i.created_at,
      i.updated_at,
      i.settings->>'school_id' AS school_id,
      NULL::text AS group_id,
      i.settings->>'vehicle_id' AS vehicle_id,
      COALESCE(v.plate, i.settings->>'vehicle_plate', '') AS vehicle_plate,
      COALESCE(v.model, i.settings->>'vehicle_model', '') AS vehicle_model,
      COALESCE(v.driver_name, '') AS driver_name,
      ds.name AS school_name,
      NULL::text AS group_name
    FROM public.instructors i
    LEFT JOIN public.driving_schools ds
      ON ds.id::text = (i.settings->>'school_id')
     AND ds.owner_key = $1
    LEFT JOIN public.vehicles v
      ON v.id::text = (i.settings->>'vehicle_id')
     AND v.user_id = $1
    WHERE ${where}
    ORDER BY LOWER(COALESCE(i.bio, '')), i.created_at DESC
  `, params);

  return id ? (result.rows[0] || null) : result.rows;
}

async function save(req, res, owner, id = null) {
  const b = await body(req);
  const name = text(b.fullName || b.name);
  const phone = text(b.phone) || null;
  const schoolId = text(b.schoolId);
  const plate = cleanPlate(b.vehiclePlate || b.plate);
  const model = text(b.vehicleModel || b.model);
  const active = b.active !== false;

  if (!name) return json(res, 400, { error: 'F.I.Sh. kerak' });
  if (!schoolId) return json(res, 400, { error: 'Avtoshkolani tanlang' });

  const school = await pool.query(`
    SELECT id, name
    FROM public.driving_schools
    WHERE id = $1 AND owner_key = $2 AND active = true
    LIMIT 1
  `, [schoolId, owner]);
  if (!school.rows[0]) return json(res, 404, { error: 'Avtoshkola topilmadi' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const instructorId = id ? String(id) : crypto.randomUUID();
    let existingSettings = {};

    if (id) {
      const current = await client.query(`
        SELECT id, settings
        FROM public.instructors
        WHERE id = $1 AND (settings->>'owner_key') = $2
        FOR UPDATE
      `, [instructorId, owner]);
      if (!current.rows[0]) {
        await client.query('ROLLBACK');
        return json(res, 404, { error: 'Instruktor topilmadi' });
      }
      existingSettings = current.rows[0].settings || {};
    } else {
      const duplicate = await client.query(`
        SELECT id
        FROM public.instructors
        WHERE (settings->>'owner_key') = $1
          AND LOWER(COALESCE(bio, '')) = LOWER($2)
          AND active = true
        LIMIT 1
      `, [owner, name]);
      if (duplicate.rows[0]) {
        await client.query('ROLLBACK');
        return json(res, 409, { error: 'Bu instruktor allaqachon mavjud' });
      }
    }

    let vehicle = null;
    if (plate) {
      const vr = await client.query(`
        SELECT id, plate, model, driver_name
        FROM public.vehicles
        WHERE user_id = $1
          AND REPLACE(UPPER(plate), ' ', '') = $2
        LIMIT 1
      `, [owner, plate]);

      if (!vr.rows[0]) {
        await client.query('ROLLBACK');
        return json(res, 404, { error: 'Bu avtomobil bazada topilmadi. Avval avtomobilni qo‘shing.' });
      }
      vehicle = vr.rows[0];

      const assigned = await client.query(`
        SELECT id, bio
        FROM public.instructors
        WHERE (settings->>'owner_key') = $1
          AND (settings->>'vehicle_id') = $2
          AND id <> $3
          AND active = true
        LIMIT 1
      `, [owner, String(vehicle.id), instructorId]);

      if (assigned.rows[0]) {
        await client.query('ROLLBACK');
        return json(res, 409, {
          error: `Bu avtomobil boshqa instruktorga biriktirilgan: ${assigned.rows[0].bio || 'Instruktor'}`
        });
      }
    }

    const settings = {
      ...existingSettings,
      owner_key: owner,
      school_id: schoolId,
      vehicle_id: vehicle ? String(vehicle.id) : null,
      vehicle_plate: vehicle?.plate || '',
      vehicle_model: model || vehicle?.model || ''
    };

    if (id) {
      await client.query(`
        UPDATE public.instructors
        SET bio = $1,
            active = $2,
            updated_at = NOW(),
            settings = $3::jsonb
        WHERE id = $4
      `, [name, active, JSON.stringify(settings), instructorId]);
    } else {
      await client.query(`
        INSERT INTO public.instructors
          (id, active, approved, approved_at, approved_by, bio, settings, created_at, updated_at)
        VALUES
          ($1, $2, true, NOW(), $3, $4, $5::jsonb, NOW(), NOW())
      `, [instructorId, active, owner, name, JSON.stringify(settings)]);
    }

    await client.query('COMMIT');
    return json(res, id ? 200 : 201, await list(owner, instructorId));
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('FIXED INSTRUCTOR API:', error);
    return json(res, 500, { error: error?.message || 'Instruktor saqlanmadi' });
  } finally {
    client.release();
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  const owner = auth(req);
  if (!owner) return json(res, 401, { error: 'Kirish talab qilinadi' });

  try {
    await ensureSchema();
    const id = req.query?.id ? String(req.query.id) : null;

    if (req.method === 'GET') return json(res, 200, await list(owner, id));
    if (req.method === 'POST') return save(req, res, owner, null);
    if ((req.method === 'PUT' || req.method === 'PATCH') && id) return save(req, res, owner, id);

    if (req.method === 'DELETE') {
      if (!id) return json(res, 400, { error: 'Instruktor ID kerak' });
      const result = await pool.query(`
        UPDATE public.instructors
        SET active = false,
            updated_at = NOW()
        WHERE id = $1 AND (settings->>'owner_key') = $2
        RETURNING id
      `, [id, owner]);
      if (!result.rows[0]) return json(res, 404, { error: 'Instruktor topilmadi' });
      return json(res, 200, { ok: true });
    }

    return json(res, 405, { error: 'Method ruxsat etilmagan' });
  } catch (error) {
    console.error('FIXED INSTRUCTOR API:', error);
    return json(res, 500, { error: error?.message || 'Instruktor API xatosi' });
  }
}
