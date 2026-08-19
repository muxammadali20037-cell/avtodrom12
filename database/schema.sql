-- AVTODROM12 database schema
-- PostgreSQL

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name VARCHAR(120) NOT NULL,
  username VARCHAR(80) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role VARCHAR(30) NOT NULL DEFAULT 'operator',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  hourly_rate NUMERIC(12,2) NOT NULL DEFAULT 30000,
  minimum_payment NUMERIC(12,2) NOT NULL DEFAULT 30000,
  calculation_mode VARCHAR(20) NOT NULL DEFAULT 'hour',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT settings_singleton CHECK (id = 1)
);

INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region_code VARCHAR(2) NOT NULL,
  first_letter CHAR(1) NOT NULL,
  number CHAR(3) NOT NULL,
  last_letters CHAR(2) NOT NULL,
  plate VARCHAR(20) NOT NULL UNIQUE,
  model VARCHAR(100),
  driver_name VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT vehicle_number_3_digits CHECK (number ~ '^[0-9]{3}$'),
  CONSTRAINT vehicle_region_allowed CHECK (region_code IN ('01','10','20','25','30','40','50','60','70','75','80','85','90','95'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  duration_seconds BIGINT,
  hourly_rate NUMERIC(12,2) NOT NULL,
  calculation_mode VARCHAR(20) NOT NULL,
  minimum_payment NUMERIC(12,2) NOT NULL,
  amount NUMERIC(12,2),
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sessions_status CHECK (status IN ('active','completed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_session_per_vehicle
ON sessions(vehicle_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS sessions_started_at_idx ON sessions(started_at);
CREATE INDEX IF NOT EXISTS sessions_status_idx ON sessions(status);
CREATE INDEX IF NOT EXISTS vehicles_plate_idx ON vehicles(plate);
