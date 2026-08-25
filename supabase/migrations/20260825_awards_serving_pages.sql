-- ============================================================================
-- Durable awards serving layer  (2026-08-25)
--
-- WHY THIS EXISTS
-- ---------------
-- Between June and August 2026 getmindy.ai lost ~86% of its search impressions
-- (36,257 -> 5,100 per 28d). 11,772 /contractors/<x>/contracts pages rendered
-- "Showing contracts 1-0 of 0 total" beneath titles reading
-- "Senture LLC - 29 Federal Contracts ($399M)".
--
-- The awards data was never missing. Redis was the ONLY copy, its TTL is 90 days,
-- and `queryCached()` returns [] on a cache MISS -- indistinguishable from a
-- genuine zero-row result. Live BigQuery was disabled for cost, so every read took
-- the miss path and every page published a zero it could not prove.
--
-- The census that followed settled the architecture question with data rather than
-- preference: EVERY bq: key expires within 90 days, and none are permanent. So the
-- entire ~0.58GB working set turns over on a 90-day cycle and repopulates through
-- cold misses. This outage was not a one-off -- it is what a 90-day TTL does when
-- nothing refills it.
--
-- 9,639 public SEO pages over slow-changing federal award data are not cache-shaped.
-- This table is the durable copy. Redis returns to being an accelerator in front of
-- it, not the only thing standing between Google and a false claim.
--
-- READ ORDER IN PRODUCTION (see src/lib/bigquery/recipients.ts):
--   1. Redis hit
--   2. this table  (may repopulate Redis with bounded TTL jitter)
--   3. honest unavailable state + noindex
--   NEVER a live BigQuery call on a web request.
--
-- SAFETY: additive only. Creates one table + indexes. No existing object is
-- altered or dropped. Idempotent (IF NOT EXISTS throughout).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.awards_serving_pages (
  id                    bigserial PRIMARY KEY,

  -- ── identity of the page ────────────────────────────────────────────────
  recipient_uei         text        NOT NULL,
  page_number           int         NOT NULL,
  page_size             int         NOT NULL,
  -- Mirrors the Redis DATA_VERSION prefix so both layers invalidate in step.
  data_version          text        NOT NULL,
  -- 'staging' rows are built and validated; 'live' rows are what production
  -- reads. Promotion is an atomic UPDATE, so a half-built generation is never
  -- served. The previous generation is retained for the rollback window.
  lifecycle             text        NOT NULL DEFAULT 'staging'
                                    CHECK (lifecycle IN ('staging', 'live', 'retired')),

  -- ── payload ─────────────────────────────────────────────────────────────
  row_count             int         NOT NULL CHECK (row_count >= 0),
  payload               jsonb       NOT NULL,

  -- ── counts, each with ONE unambiguous meaning ───────────────────────────
  -- These three are deliberately separate columns because conflating them is
  -- how "29 Federal Contracts" ended up above 124 rows. For Senture:
  --   contract_count             = 23   distinct award_id / PIID
  --   displayed_action_count     = 124  rows we render (obligation_amount > 0)
  --   total_action_count         = 330  every row incl. $0 modifications
  contract_count        int         NOT NULL CHECK (contract_count >= 0),
  displayed_action_count int        NOT NULL CHECK (displayed_action_count >= 0),
  total_action_count    int         NOT NULL CHECK (total_action_count >= 0),

  -- SUM(obligation_amount) over DISPLAYED actions only (obligation_amount > 0).
  -- NOT the rollup's total_obligated, which is computed on a different basis and
  -- differs: Senture is $429,353,782.14 here vs $399,095,920.33 in the rollup.
  -- Two honest numbers measuring different things -- never silently swapped.
  displayed_obligated   numeric(20,2) NOT NULL,

  -- ── provenance ──────────────────────────────────────────────────────────
  -- MAX(action_date) in the source at build time: how current the DATA is.
  source_as_of          date,
  -- When this row was built: how current the BUILD is. Distinct from the above;
  -- a fresh build over stale source is not fresh data.
  generated_at          timestamptz NOT NULL DEFAULT now(),
  -- sha256 of the canonical payload. Lets a read-back verify without re-querying
  -- BigQuery, and makes an unchanged rebuild detectable as a no-op.
  payload_checksum      text        NOT NULL,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  -- One row per page per generation. The upsert target, which is what makes the
  -- build idempotent and resumable PER KEY rather than per recipient.
  CONSTRAINT awards_serving_pages_uniq
    UNIQUE (recipient_uei, page_number, page_size, data_version)
);

-- The production read: exact-match lookup of one live page.
CREATE INDEX IF NOT EXISTS awards_serving_pages_read_idx
  ON public.awards_serving_pages (recipient_uei, page_number, page_size, data_version)
  WHERE lifecycle = 'live';

-- Promotion / retirement sweeps over a whole generation.
CREATE INDEX IF NOT EXISTS awards_serving_pages_generation_idx
  ON public.awards_serving_pages (data_version, lifecycle);

-- Rolling-refresh selection: oldest builds first.
CREATE INDEX IF NOT EXISTS awards_serving_pages_staleness_idx
  ON public.awards_serving_pages (generated_at)
  WHERE lifecycle = 'live';

COMMENT ON TABLE public.awards_serving_pages IS
  'Durable precomputed /contractors/<uei>/contracts pages. The authoritative copy; '
  'Redis is a read-through accelerator in front of it. Never read live BigQuery on a '
  'web request. See 20260825_awards_serving_pages.sql for the incident that produced it.';

COMMENT ON COLUMN public.awards_serving_pages.contract_count IS
  'Distinct contracts (award_id/PIID). Senture: 23.';
COMMENT ON COLUMN public.awards_serving_pages.displayed_action_count IS
  'Award ACTIONS rendered on the page (obligation_amount > 0). Senture: 124.';
COMMENT ON COLUMN public.awards_serving_pages.total_action_count IS
  'All actions incl. $0 modifications. Senture: 330.';
COMMENT ON COLUMN public.awards_serving_pages.displayed_obligated IS
  'SUM(obligation_amount) over displayed actions. NOT rollup.total_obligated, which '
  'is computed differently (Senture: 429,353,782.14 here vs 399,095,920.33 there).';
COMMENT ON COLUMN public.awards_serving_pages.lifecycle IS
  'staging -> validated -> promoted to live atomically. Prior generation kept as '
  'retired for the rollback window.';

-- RLS: this is PUBLIC SEO content, but reads go through the service role like every
-- other server-rendered path. Deny anon/authenticated by default, consistent with
-- the vault backstop pattern (20260705_vault_rls_backstop.sql).
ALTER TABLE public.awards_serving_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.awards_serving_pages FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS awards_serving_pages_service_role_only ON public.awards_serving_pages;
CREATE POLICY awards_serving_pages_service_role_only
  ON public.awards_serving_pages
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Verify:
--   SELECT lifecycle, data_version, COUNT(*), SUM(row_count)
--     FROM public.awards_serving_pages GROUP BY 1,2;
--   SELECT relrowsecurity, relforcerowsecurity FROM pg_class
--     WHERE relname = 'awards_serving_pages';
