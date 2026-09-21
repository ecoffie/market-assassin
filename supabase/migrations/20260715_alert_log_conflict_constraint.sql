-- Fix the alert_log ON CONFLICT 42P10 storm.
--
-- The app upserts alert_log with onConflict = (user_email, alert_date, alert_type)
-- (src/lib/alerts/delivery-log.ts), but only a (user_email, alert_date) unique
-- constraint exists. So every alert send throws
--   42P10  "there is no unique or exclusion constraint matching the ON CONFLICT
--           specification"
-- on the first attempt, then the code falls back to the 2-col target. The write
-- succeeds via the fallback, but Postgres logs a 42P10 every time — the bulk of
-- the project's Postgres error volume (~3k/day). briefing_log already has the
-- equivalent 3-col constraint and does NOT error; this brings alert_log in line.
--
-- Safe to add: the existing (user_email, alert_date) uniqueness means there is at
-- most one row per (user_email, alert_date), hence at most one per the 3-col
-- superset — so the new constraint cannot fail on duplicate data.
--
-- Idempotent. Run in the Supabase SQL editor.

-- 1) Add the 3-column unique constraint the app actually targets.
DO $$
BEGIN
  ALTER TABLE public.alert_log
    ADD CONSTRAINT alert_log_user_date_type_key
    UNIQUE (user_email, alert_date, alert_type);
EXCEPTION
  WHEN duplicate_table THEN NULL;   -- constraint already exists
  WHEN duplicate_object THEN NULL;  -- constraint already exists
END $$;

-- 2) Drop any legacy 2-column (user_email, alert_date) UNIQUE constraint. It is
--    stricter than the app's intent (it blocks a user from receiving more than
--    one alert_type on the same day) and, once the 3-col constraint exists, a
--    mixed-type same-day insert would hit it as a 23505. Dropping it lets the
--    3-col ON CONFLICT be authoritative. Matches columns as a set, order-agnostic.
DO $$
DECLARE
  c record;
  target int2[];
BEGIN
  SELECT array_agg(attnum ORDER BY attnum) INTO target
  FROM pg_attribute
  WHERE attrelid = 'public.alert_log'::regclass
    AND attname IN ('user_email', 'alert_date');

  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.alert_log'::regclass
      AND con.contype = 'u'
      AND (SELECT array_agg(k ORDER BY k) FROM unnest(con.conkey) AS k) = target
  LOOP
    EXECUTE format('ALTER TABLE public.alert_log DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

-- Verify:
--   SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE conrelid = 'public.alert_log'::regclass AND contype = 'u';
-- Expect exactly one UNIQUE (user_email, alert_date, alert_type).
