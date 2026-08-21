-- AVTODROM feature upgrade
-- Safe additive migration. The backend also runs these statements on startup.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS driving_schools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_key TEXT NOT NULL,
  name VARCHAR(160) NOT NULL,
  phone VARCHAR(50),
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS school_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_key TEXT NOT NULL,
  school_id UUID NOT NULL REFERENCES driving_schools(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_key TEXT NOT NULL,
  school_id UUID NOT NULL REFERENCES driving_schools(id) ON DELETE CASCADE,
  group_id UUID REFERENCES school_groups(id) ON DELETE SET NULL,
  full_name VARCHAR(160) NOT NULL,
  phone VARCHAR(50),
  plate VARCHAR(20),
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20) NOT NULL DEFAULT 'cash';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS cash_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS terminal_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS school_id UUID;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS group_id UUID;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS student_id UUID;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS manual_price BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS frozen_at TIMESTAMPTZ;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS frozen_seconds BIGINT NOT NULL DEFAULT 0;
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_status_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_status_check CHECK (status IN ('active','frozen','completed'));

UPDATE sessions
SET cash_amount = COALESCE(amount,0), payment_method = 'cash'
WHERE status='completed'
  AND COALESCE(amount,0)>0
  AND COALESCE(cash_amount,0)=0
  AND COALESCE(terminal_amount,0)=0;

CREATE INDEX IF NOT EXISTS idx_sessions_plate_time ON sessions(vehicle_id,started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_payment ON sessions(payment_method);
CREATE INDEX IF NOT EXISTS idx_sessions_user_frozen ON sessions(user_id,status,frozen_at DESC);
CREATE INDEX IF NOT EXISTS idx_students_owner ON students(owner_key);
CREATE INDEX IF NOT EXISTS idx_school_groups_owner ON school_groups(owner_key);
CREATE INDEX IF NOT EXISTS idx_schools_owner ON driving_schools(owner_key);
