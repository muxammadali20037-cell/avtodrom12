-- Account isolation: every user's vehicles/sessions/settings are separated.
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
CREATE TABLE IF NOT EXISTS user_settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  hourly_rate NUMERIC(12,2) NOT NULL DEFAULT 30000,
  minimum_payment NUMERIC(12,2) NOT NULL DEFAULT 0,
  calculation_mode VARCHAR(10) NOT NULL DEFAULT 'hour',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vehicles_user_id ON vehicles(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id_status ON sessions(user_id,status);
