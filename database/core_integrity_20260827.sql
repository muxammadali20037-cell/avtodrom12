-- AVTODROM12 core relation integrity
-- Verified before applying to production:
--   sessions -> vehicles orphans: 0
--   sessions -> schools orphans: 0
--   sessions -> groups orphans: 0
--   sessions -> students orphans: 0
--   students -> schools orphans: 0
--   students -> group/school mismatches: 0
--   duplicate active sessions per vehicle: 0
-- This migration is idempotent and does not delete business data.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'school_groups_id_school_unique'
  ) THEN
    ALTER TABLE public.school_groups
      ADD CONSTRAINT school_groups_id_school_unique UNIQUE (id, school_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sessions_group_fk'
  ) THEN
    ALTER TABLE public.sessions
      ADD CONSTRAINT sessions_group_fk
      FOREIGN KEY (group_id) REFERENCES public.school_groups(id)
      ON DELETE SET NULL NOT VALID;
    ALTER TABLE public.sessions VALIDATE CONSTRAINT sessions_group_fk;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sessions_student_fk'
  ) THEN
    ALTER TABLE public.sessions
      ADD CONSTRAINT sessions_student_fk
      FOREIGN KEY (student_id) REFERENCES public.students(id)
      ON DELETE SET NULL NOT VALID;
    ALTER TABLE public.sessions VALIDATE CONSTRAINT sessions_student_fk;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sessions_school_group_started
  ON public.sessions(school_id, group_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_student_started
  ON public.sessions(student_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_students_school_name
  ON public.students(school_id, lower(full_name));
