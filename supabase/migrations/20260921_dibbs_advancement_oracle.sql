-- DIBBS — the missing advancement oracle (Workstream A, DIBBS error rate).
--
-- ── THE DEFECT: dibbs_rfqs CANNOT ANSWER "DID THIS RUN ADD ANYTHING?" ───────
-- Measured on production 2026-09-21. `dibbs_rfqs` has exactly two clocks,
-- `scraped_at` and `synced_at`, and the ingest sets BOTH on every upserted row:
--
--     synced_at: new Date().toISOString()      -- src/lib/dibbs/ingest.ts
--
-- The upsert conflicts on solicitation_number, so a run that re-reads the SAME
-- daily index file and adds NOTHING NEW still stamps every one of those ~2,400
-- rows with a fresh synced_at. max(synced_at) therefore reports "current" on a
-- run that advanced nothing. It is a LAST-TOUCH clock being read as an
-- ADVANCEMENT clock — the same conflation that let darpa_baa and nsf_sbir report
-- 60 green checkmarks over two dead sources (20260920_specialty_source_advancement).
--
-- Consequences measured today, all three of which this migration exists to end:
--
--   1. There is no column recording when a solicitation was FIRST seen, so
--      "rows upserted" cannot be split into new vs re-touched. 57,816 rows, and
--      not one of them can say when it arrived.
--   2. `sam_opportunities_advancement()` and `research_source_advancement()` both
--      exist. There is no `dibbs_*_advancement()`. DIBBS is the one specialty
--      source with no advancement oracle at all.
--   3. `data_source_instances.dibbs_dla_flat_files` is registered
--      source_state='current' / intervention_state='none_required' with
--      last_data_advance = NULL — asserted healthy on an unmeasured quantity.
--      The sibling assessment that "DIBBS is advancing (1d behind)" is derived
--      from max(synced_at), i.e. from the touch clock described above.
--
-- Nothing about fetching, routing, the cost guard or the STARVED verdict changes
-- here. This is an OBSERVABILITY migration: changing the fetcher in the same pass
-- would destroy the before/after that the next week of runs is supposed to supply.

-- ── 1. A first-seen clock that the upsert cannot overwrite ──────────────────
-- Deliberately added WITHOUT a default first, so the 57,816 pre-existing rows
-- stay NULL. Adding it WITH `DEFAULT now()` would backfill every existing row
-- with the migration timestamp and claim the entire corpus arrived today — a
-- fabricated advancement, which is the exact failure class this migration is
-- closing. NULL is the honest encoding: we do not know when these rows arrived,
-- and `count ?? 0` on that is data fabrication (Bug Prevention Rule #11).
ALTER TABLE public.dibbs_rfqs
  ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ;

-- The default applies to FUTURE inserts only. The ingest upserts a row object
-- that does not mention first_seen_at, so PostgREST emits
--   INSERT ... ON CONFLICT (solicitation_number) DO UPDATE SET <listed columns>
-- and first_seen_at is absent from that SET list: stamped once on insert, never
-- touched on update. That property is what makes it an advancement clock rather
-- than a second copy of synced_at.
ALTER TABLE public.dibbs_rfqs
  ALTER COLUMN first_seen_at SET DEFAULT NOW();

COMMENT ON COLUMN public.dibbs_rfqs.first_seen_at IS
  'When this solicitation was FIRST inserted. Insert-only: never present in the upsert payload, so ON CONFLICT DO UPDATE cannot touch it. NULL = arrived before 2026-09-21 and is genuinely unmeasured, NOT zero. synced_at is a last-touch clock and reports "current" for a run that added nothing.';

-- Advancement queries are "how many rows are newer than this run started", so
-- the index is on the clock itself.
CREATE INDEX IF NOT EXISTS idx_dibbs_rfqs_first_seen_at
  ON public.dibbs_rfqs (first_seen_at DESC NULLS LAST);

-- ── 2. The oracle — both clocks, side by side, never merged ─────────────────
-- Mirrors sam_opportunities_advancement() / research_source_advancement(), with
-- one addition those two do not need: DIBBS has a KNOWN BLIND WINDOW (every row
-- predating this migration), and that window is reported as a population rather
-- than folded into a state. A caller must be able to see how much of the corpus
-- the oracle cannot speak for.
CREATE OR REPLACE FUNCTION public.dibbs_source_advancement()
RETURNS TABLE(
  rows_held bigint,
  rows_open bigint,
  -- The honest blind spot: rows that arrived before first_seen_at existed.
  rows_unmeasured bigint,
  -- LAST-TOUCH clock. Moves whenever a run upserts anything, new or not.
  last_touch timestamptz,
  -- TRUE ADVANCEMENT clock. Moves ONLY when a solicitation is seen for the
  -- first time. NULL until the first post-migration insert lands.
  last_data_advance timestamptz,
  days_since_touch integer,
  days_since_advance integer,
  advancement_state text
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    count(*)::bigint,
    count(*) FILTER (WHERE d.return_by_date >= CURRENT_DATE)::bigint,
    count(*) FILTER (WHERE d.first_seen_at IS NULL)::bigint,
    max(d.synced_at),
    max(d.first_seen_at),
    (CURRENT_DATE - max(d.synced_at)::date)::integer,
    (CURRENT_DATE - max(d.first_seen_at)::date)::integer,
    CASE
      -- No advancement clock yet => UNMEASURED. Never 'current': a healthy
      -- last_touch is exactly the signal that has been misread as health.
      WHEN max(d.first_seen_at) IS NULL                          THEN 'unmeasured'
      -- DLA publishes one index file per BUSINESS day, so a weekend with no new
      -- solicitations is upstream quiet, not staleness. 3 days spans Sat+Sun.
      WHEN CURRENT_DATE - max(d.first_seen_at)::date <= 3        THEN 'current'
      WHEN CURRENT_DATE - max(d.first_seen_at)::date <= 14       THEN 'content_stale'
      ELSE 'unreachable'
    END
  FROM public.dibbs_rfqs d;
$$;

COMMENT ON FUNCTION public.dibbs_source_advancement() IS
  'DIBBS advancement. Reports the last-touch clock (max(synced_at)) and the true advancement clock (max(first_seen_at)) SEPARATELY, because the ingest re-stamps synced_at on every re-upserted row: a run that re-reads the same daily index file and adds nothing new still moves last_touch to now. rows_unmeasured counts the pre-2026-09-21 corpus the advancement clock cannot speak for.';
