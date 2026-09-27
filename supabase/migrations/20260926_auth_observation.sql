-- R0 — auth-method observability (behaviour-neutral).
-- tasks/mindy-entitlement-audit-2026-09-26.md §12 E1/E6, §14 R0.
--
-- Two service-role-only tables and one atomic RPC. Nothing in the app READS these to make
-- a decision; they exist so Eric can see, after ~7 days, who still authenticates with the
-- weak methods (plaintext ma_access_email cookie, claimed staff email) before R1 removes
-- them, and how /api/app/federal-contacts is used (listing vs roster/bulk) before E6 gates.
--
-- Volume is bounded by construction:
--   auth_observation_daily  one row per (day, probe, route, method, verified, matches); the
--                           route is id-normalized app-side, so this is O(routes × methods) per day.
--   auth_observation_emails one row per (day, probe, route, method, email), and the RPC stops
--                           inserting NEW rows for a day once it holds p_email_cap rows (existing
--                           rows keep counting). Emails are recorded ONLY for weak auth methods,
--                           unauthenticated Pro-gate calls and federal-contacts usage.
--
-- Idempotent. RLS enabled with NO policies + explicit REVOKE: only service_role can touch it.

CREATE TABLE IF NOT EXISTS public.auth_observation_daily (
  day                       DATE        NOT NULL,
  probe                     TEXT        NOT NULL,
  route                     TEXT        NOT NULL,
  method                    TEXT        NOT NULL,
  verified_identity_present TEXT        NOT NULL,
  claimed_matches_identity  TEXT        NOT NULL,
  count                     BIGINT      NOT NULL DEFAULT 0,
  first_seen                TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (day, probe, route, method, verified_identity_present, claimed_matches_identity)
);

CREATE TABLE IF NOT EXISTS public.auth_observation_emails (
  day        DATE        NOT NULL,
  probe      TEXT        NOT NULL,
  route      TEXT        NOT NULL,
  method     TEXT        NOT NULL,
  email      TEXT        NOT NULL,
  count      BIGINT      NOT NULL DEFAULT 0,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (day, probe, route, method, email)
);

CREATE INDEX IF NOT EXISTS auth_observation_emails_day_idx ON public.auth_observation_emails (day);

ALTER TABLE public.auth_observation_daily  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_observation_emails ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auth_observation_daily, public.auth_observation_emails FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_auth_observation(
  p_day       DATE,
  p_probe     TEXT,
  p_route     TEXT,
  p_method    TEXT,
  p_verified  TEXT,
  p_matches   TEXT,
  p_email     TEXT DEFAULT NULL,
  p_email_cap INTEGER DEFAULT 5000
) RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.auth_observation_daily AS d
    (day, probe, route, method, verified_identity_present, claimed_matches_identity, count)
  VALUES
    (p_day, left(p_probe, 40), left(p_route, 120), left(p_method, 40), left(p_verified, 8), left(p_matches, 8), 1)
  ON CONFLICT (day, probe, route, method, verified_identity_present, claimed_matches_identity)
  DO UPDATE SET count = d.count + 1, last_seen = now();

  IF p_email IS NULL OR length(p_email) = 0 THEN
    RETURN;
  END IF;

  -- Existing (day, probe, route, method, email) row: always count it.
  UPDATE public.auth_observation_emails e
     SET count = e.count + 1, last_seen = now()
   WHERE e.day = p_day AND e.probe = left(p_probe, 40) AND e.route = left(p_route, 120)
     AND e.method = left(p_method, 40) AND e.email = lower(left(p_email, 254));
  IF FOUND THEN
    RETURN;
  END IF;

  -- New row: only while the day is under its cap (bounded volume even under abuse).
  IF (SELECT count(*) FROM public.auth_observation_emails WHERE day = p_day) >= p_email_cap THEN
    RETURN;
  END IF;

  INSERT INTO public.auth_observation_emails AS e (day, probe, route, method, email, count)
  VALUES (p_day, left(p_probe, 40), left(p_route, 120), left(p_method, 40), lower(left(p_email, 254)), 1)
  ON CONFLICT (day, probe, route, method, email)
  DO UPDATE SET count = e.count + 1, last_seen = now();
END;
$$;

REVOKE ALL ON FUNCTION public.record_auth_observation(DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_auth_observation(DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER)
  TO service_role;
