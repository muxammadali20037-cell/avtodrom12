-- AVTODROM V3 SAFE MIGRATION
-- Muhim: mavjud public.instructors jadvaliga tegmaydi.
-- Eski ma'lumotlar o'chirilmaydi.
-- V3 uchun alohida bog'lanishlar ishlatiladi.

BEGIN;

CREATE TABLE IF NOT EXISTS avtodrom_instructors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_key TEXT NOT NULL,
  full_name VARCHAR(180) NOT NULL,
  phone VARCHAR(50),
  vehicle_id UUID NULL REFERENCES vehicles(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_avtodrom_instructors_owner_active
  ON avtodrom_instructors(owner_key, active);
CREATE INDEX IF NOT EXISTS idx_avtodrom_instructors_vehicle
  ON avtodrom_instructors(vehicle_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_avtodrom_instructor_active_vehicle
  ON avtodrom_instructors(vehicle_id)
  WHERE vehicle_id IS NOT NULL AND active = TRUE;

ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS avtodrom_instructor_id UUID NULL
  REFERENCES avtodrom_instructors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_vehicles_avtodrom_instructor
  ON vehicles(avtodrom_instructor_id);

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS planned_minutes INTEGER NULL;
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS avtodrom_instructor_id UUID NULL
  REFERENCES avtodrom_instructors(id) ON DELETE SET NULL;
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS customer_type VARCHAR(20) NULL;
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20) NOT NULL DEFAULT 'cash';
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS cash_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS terminal_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS manual_price BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_sessions_avtodrom_instructor_started
  ON sessions(avtodrom_instructor_id, started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_planned_minutes
  ON sessions(planned_minutes);
CREATE INDEX IF NOT EXISTS idx_sessions_customer_type
  ON sessions(customer_type);

UPDATE user_settings
SET calculation_mode = 'minute',
    minimum_payment = 0,
    updated_at = NOW()
WHERE calculation_mode IS DISTINCT FROM 'minute'
   OR minimum_payment IS DISTINCT FROM 0;

CREATE OR REPLACE FUNCTION avtodrom_v3_auto_price()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'completed'
     AND COALESCE(NEW.manual_price, FALSE) = FALSE THEN
    IF NEW.student_id IS NOT NULL
       OR COALESCE(NEW.customer_type, '') = 'school' THEN
      NEW.amount := 0;
      NEW.cash_amount := 0;
      NEW.terminal_amount := 0;
      IF COALESCE(NEW.payment_method, '') NOT IN ('cash','terminal','mixed') THEN
        NEW.payment_method := 'cash';
      END IF;
    ELSE
      NEW.amount := ROUND(
        (COALESCE(NEW.duration_seconds, 0)::NUMERIC / 60.0)
        * (COALESCE(NEW.hourly_rate, 0)::NUMERIC / 60.0),
        2
      );
      IF NEW.payment_method = 'terminal' THEN
        NEW.cash_amount := 0;
        NEW.terminal_amount := NEW.amount;
      ELSIF NEW.payment_method = 'mixed' THEN
        IF ABS(COALESCE(NEW.cash_amount,0) + COALESCE(NEW.terminal_amount,0) - COALESCE(NEW.amount,0)) > 0.01 THEN
          RAISE EXCEPTION 'Naqd + terminal summasi avtomatik hisoblangan summaga teng bo''lishi kerak';
        END IF;
      ELSE
        NEW.payment_method := 'cash';
        NEW.cash_amount := NEW.amount;
        NEW.terminal_amount := 0;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_avtodrom_v3_auto_price ON sessions;
CREATE TRIGGER trg_avtodrom_v3_auto_price
BEFORE INSERT OR UPDATE OF
  status, duration_seconds, hourly_rate, student_id, customer_type,
  payment_method, cash_amount, terminal_amount, manual_price
ON sessions
FOR EACH ROW
EXECUTE FUNCTION avtodrom_v3_auto_price();

COMMIT;
