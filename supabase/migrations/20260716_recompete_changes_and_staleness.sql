-- Recompete: append-only change log + staleness ordering for the sync cron.
-- Issue #288. Hand-run in the Supabase SQL editor (this DB has no in-app DDL).
--
-- Idempotent. Safe to re-run.
--
-- WHY THE CHANGE LOG EXISTS
--
-- sync-recompete-full upserts on contract_id with ignoreDuplicates:false, so
-- every run OVERWRITES the prior row. USASpending only serves current state --
-- it has no "as of" query -- so any change we don't record while it happens is
-- gone permanently and cannot be backfilled later at any price.
--
-- That makes this table the only route to questions the current-state table can
-- never answer:
--   * this award's expiry has slipped twice     -> it will slip again
--   * this ceiling was raised mid-period        -> scope is growing
--   * this incumbent's UEI changed              -> novation / acquisition
--
-- It is append-only ON PURPOSE. An UPDATE here would destroy the only copy of a
-- fact that no longer exists upstream.

-- ── 1. The change log ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS recompete_changes (
  id            BIGSERIAL PRIMARY KEY,
  contract_id   TEXT NOT NULL,
  piid          TEXT,
  naics_code    TEXT,
  field         TEXT NOT NULL,        -- which tracked column moved
  old_value     TEXT,                 -- TEXT, not typed: one log for dates + money + ids
  new_value     TEXT,
  observed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- "Show me this contract's history" -- the read this table exists for.
CREATE INDEX IF NOT EXISTS idx_recompete_changes_contract
  ON recompete_changes (contract_id, observed_at DESC);

-- "What slipped this week?" across the whole corpus.
CREATE INDEX IF NOT EXISTS idx_recompete_changes_field_time
  ON recompete_changes (field, observed_at DESC);

-- Guard against a re-run of the same sync double-logging an identical
-- transition. A genuine A->B->A round trip still records both legs (different
-- observed_at), which is real history; only an exact same-instant duplicate is
-- rejected.
CREATE UNIQUE INDEX IF NOT EXISTS uq_recompete_changes_event
  ON recompete_changes (contract_id, field, observed_at);

-- ── 2. NAICS ordered by staleness ─────────────────────────────────────────────
--
-- The cron shards by NAICS. Rather than persist a cursor (which can drift, or
-- corrupt, or silently skip -- the failure mode this whole issue series is
-- about), derive the next batch from the data itself: the NAICS whose freshest
-- row is oldest is the NAICS most in need of a sync.
--
-- Self-healing: a NAICS that fails mid-cycle stays stale, so the next run picks
-- it up first. Nothing to reset by hand.
--
-- NOTE: this only returns NAICS ALREADY present in the table -- the same
-- semantics as the sweep's --all. A NAICS with zero rows can never enter this
-- way. That gap predates #288; see the issue's "not in scope".

CREATE OR REPLACE FUNCTION recompete_naics_by_staleness(lim INT DEFAULT 40)
RETURNS TABLE (naics_code TEXT, row_count BIGINT, last_synced TIMESTAMPTZ)
LANGUAGE sql
STABLE
AS $$
  SELECT
    o.naics_code,
    COUNT(*) AS row_count,
    -- A NULL last_synced_at means never synced by the real per-contract sync
    -- (e.g. a leftover grouped row). NULLS FIRST would be right, but MAX()
    -- ignores NULLs, so coalesce to epoch to force those NAICS to the front.
    COALESCE(MAX(o.last_synced_at), '1970-01-01'::TIMESTAMPTZ) AS last_synced
  FROM recompete_opportunities o
  WHERE o.naics_code IS NOT NULL
  GROUP BY o.naics_code
  ORDER BY last_synced ASC, row_count DESC
  LIMIT lim;
$$;

-- The staleness scan aggregates over the whole table every run -- keep it cheap.
CREATE INDEX IF NOT EXISTS idx_recompete_naics_synced
  ON recompete_opportunities (naics_code, last_synced_at);

-- Verification:
--   SELECT * FROM recompete_naics_by_staleness(5);
--     -> expect 5 NAICS, oldest last_synced first
--   SELECT field, count(*) FROM recompete_changes GROUP BY 1;
--     -> empty until the sync observes its first real change
