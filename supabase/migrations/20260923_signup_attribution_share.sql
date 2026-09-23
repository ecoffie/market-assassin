-- signup_attribution — brought under schema control + share/anonymous acquisition fields.
--
-- ── WHY THE CREATE ─────────────────────────────────────────────────────────
-- `signup_attribution` has existed in production since 2026-07-06 (written by
-- /api/auth/mi-signup) but no migration ever created it: it was hand-built, so
-- the ledger could not reproduce it and nothing pinned its shape. The CREATE
-- below mirrors the LIVE table exactly as read from information_schema /
-- pg_indexes / pg_policies on 2026-09-23 (id GENERATED ALWAYS AS IDENTITY,
-- email NOT NULL, created_at NOT NULL DEFAULT now(), two indexes, RLS with a
-- single service_role policy). On prod every statement in this section is a
-- no-op; on a fresh database it builds the same table.
--
-- ── WHY THE NEW COLUMNS (Opportunity Share Attribution) ────────────────────
-- The Map is a route handler, so the global AttributionTracker never runs there
-- and a visitor who arrives from a shared opportunity link reaches signup with
-- no source. Google/Microsoft signups never wrote a row at all (574 of 1,327
-- accounts since 2026-07-06 had one). These columns let ONE row per account say
-- which anonymous browser it came from and which share brought it:
--
--   anon_id         the `anon:<uuid>` browser identity whose user_engagement
--                   history this account inherited (joined, never rewritten)
--   share_id        the individual share event (listing_share.metadata.share_id)
--                   that first brought that browser here — only ever written
--                   after server-side validation against a real listing_share
--   entry           how that first attributed arrival entered ('share', …)
--   first_touch     the browser's first-touch attribution object, verbatim shape
--                   of the gca_attr first_touch (first touch is never overwritten)
--   first_touch_at  when that first touch happened
--   claimed_at      when the anonymous history was associated with the account
--
-- Additive only. No existing row or column changes.

CREATE TABLE IF NOT EXISTS public.signup_attribution (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         TEXT NOT NULL,
  source        TEXT,
  utm_source    TEXT,
  utm_medium    TEXT,
  utm_campaign  TEXT,
  utm_content   TEXT,
  referrer      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signup_attr_source     ON public.signup_attribution (utm_source);
CREATE INDEX IF NOT EXISTS idx_signup_attr_created_at ON public.signup_attribution (created_at DESC);

ALTER TABLE public.signup_attribution ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'signup_attribution' AND policyname = 'service_role_full_access'
  ) THEN
    CREATE POLICY service_role_full_access ON public.signup_attribution
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── Share / anonymous acquisition columns ──────────────────────────────────
ALTER TABLE public.signup_attribution ADD COLUMN IF NOT EXISTS anon_id        TEXT;
ALTER TABLE public.signup_attribution ADD COLUMN IF NOT EXISTS share_id       TEXT;
ALTER TABLE public.signup_attribution ADD COLUMN IF NOT EXISTS entry          TEXT;
ALTER TABLE public.signup_attribution ADD COLUMN IF NOT EXISTS first_touch    JSONB;
ALTER TABLE public.signup_attribution ADD COLUMN IF NOT EXISTS first_touch_at TIMESTAMPTZ;
ALTER TABLE public.signup_attribution ADD COLUMN IF NOT EXISTS claimed_at     TIMESTAMPTZ;

-- Shape guards: an anon id can never be an email, a share id is a UUID. NOT VALID
-- is unnecessary (every existing row is NULL in both) but harmless to omit.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'signup_attribution_anon_id_shape') THEN
    ALTER TABLE public.signup_attribution ADD CONSTRAINT signup_attribution_anon_id_shape
      CHECK (anon_id IS NULL OR anon_id ~ '^anon:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'signup_attribution_share_id_shape') THEN
    ALTER TABLE public.signup_attribution ADD CONSTRAINT signup_attribution_share_id_shape
      CHECK (share_id IS NULL OR share_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_signup_attr_email    ON public.signup_attribution (lower(email));
CREATE INDEX IF NOT EXISTS idx_signup_attr_share_id ON public.signup_attribution (share_id) WHERE share_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_signup_attr_anon_id  ON public.signup_attribution (anon_id)  WHERE anon_id  IS NOT NULL;

-- The funnel query resolves share ids inside user_engagement.metadata. Partial so
-- it only indexes the (small) set of rows that carry one.
CREATE INDEX IF NOT EXISTS idx_user_engagement_share_id
  ON public.user_engagement ((metadata->>'share_id'))
  WHERE metadata ? 'share_id';

COMMENT ON COLUMN public.signup_attribution.share_id IS
  'Individual share event (user_engagement listing_share metadata.share_id) that first brought this account''s anonymous browser to Mindy. Written only after server-side validation: the share must exist, name the same notice, and precede the arrival.';
COMMENT ON COLUMN public.signup_attribution.anon_id IS
  'anon:<uuid> browser whose user_engagement history this account inherited at first verified session. Anonymous rows are joined through this column, never rewritten.';
