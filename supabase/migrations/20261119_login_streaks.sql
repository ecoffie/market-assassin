-- Login streaks (owner, 2026-11-19: "streaks where you can win extra credits for being inside and
-- logging into Mindy everyday"; rewards picked: +25 credits every 7 days in a row, +100 at every 30).
--
-- Additive only. Creates one table and one function; touches nothing that exists.
-- Do not apply from an agent session. Apply after review with:
--   npm run migrate -- --go --only 20261119_login_streaks.sql
--
-- One row per person. A "day" is the America/New_York calendar day, decided by the SERVER (the
-- client never says what day it is, so changing a device clock cannot extend a streak).
-- The credit reward itself is NOT granted here: the app grants it through applyCreditOnce with the
-- key streak:<email>:<day>, so a reward can never be paid twice for the same day.

CREATE TABLE IF NOT EXISTS public.user_login_streaks (
  user_email      TEXT PRIMARY KEY,
  current_streak  INTEGER NOT NULL DEFAULT 0 CHECK (current_streak >= 0),
  longest_streak  INTEGER NOT NULL DEFAULT 0 CHECK (longest_streak >= 0),
  last_active_day DATE,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_login_streaks ENABLE ROW LEVEL SECURITY;
-- No policies: service role only, like the other per-user ledgers.

-- Record today's visit and return the streak AFTER it. Atomic: the row lock makes two tabs opening
-- at the same moment count once. counted_today = true only for the call that moved the streak.
CREATE OR REPLACE FUNCTION public.mindy_streak_checkin(p_email TEXT, p_day DATE)
RETURNS TABLE (current_streak INTEGER, longest_streak INTEGER, counted_today BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT := lower(trim(p_email));
  v_row   public.user_login_streaks%ROWTYPE;
  v_next  INTEGER;
BEGIN
  IF v_email IS NULL OR v_email = '' OR p_day IS NULL THEN
    RAISE EXCEPTION 'mindy_streak_checkin: email and day are required';
  END IF;

  INSERT INTO public.user_login_streaks (user_email) VALUES (v_email)
  ON CONFLICT (user_email) DO NOTHING;

  SELECT * INTO v_row FROM public.user_login_streaks WHERE user_email = v_email FOR UPDATE;

  IF v_row.last_active_day = p_day THEN
    RETURN QUERY SELECT v_row.current_streak, v_row.longest_streak, FALSE;
    RETURN;
  END IF;
  -- A day older than the last one recorded (should not happen: the server picks the day) is ignored.
  IF v_row.last_active_day IS NOT NULL AND p_day < v_row.last_active_day THEN
    RETURN QUERY SELECT v_row.current_streak, v_row.longest_streak, FALSE;
    RETURN;
  END IF;

  IF v_row.last_active_day = p_day - 1 THEN
    v_next := v_row.current_streak + 1;
  ELSE
    v_next := 1;
  END IF;

  UPDATE public.user_login_streaks
     SET current_streak  = v_next,
         longest_streak  = GREATEST(v_row.longest_streak, v_next),
         last_active_day = p_day,
         updated_at      = now()
   WHERE user_email = v_email;

  RETURN QUERY SELECT v_next, GREATEST(v_row.longest_streak, v_next), TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.mindy_streak_checkin(TEXT, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mindy_streak_checkin(TEXT, DATE) TO service_role;
