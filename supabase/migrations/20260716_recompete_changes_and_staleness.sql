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

-- ── 2. Per-NAICS attempt log ──────────────────────────────────────────────────
--
-- "When did we last ATTEMPT this NAICS" is a DIFFERENT FACT from "when was a
-- row of this NAICS last seen upstream", and conflating them starves the cron.
--
-- The first cut of this ranked NAICS by MAX(last_synced_at) over the rows
-- themselves -- no extra state, derived from the data. It looked elegant and it
-- was wrong. A NAICS with no real contracts (524130, 424450 and friends return
-- 0 rows from USASpending; all that remains are leftover grouped rows) never
-- gets a fresh row written, so its MAX stays pinned at the April import
-- forever. It would sit at the head of the queue permanently, be re-claimed
-- every run, sync nothing, and never let the cron reach the NAICS that need
-- work -- a job reporting success while doing nothing.
--
-- So record the attempt explicitly. This is not a cursor: there is no position
-- to drift or reset, just a timestamp per NAICS. Still self-healing -- a NAICS
-- that throws records the failure and its attempt time, so it rotates to the
-- back rather than blocking the queue, and its rows stay stale for the data to
-- show.

CREATE TABLE IF NOT EXISTS recompete_naics_sync (
  naics_code      TEXT PRIMARY KEY,
  last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_result     TEXT,        -- 'ok' | 'empty' | 'truncated' | 'error'
  contracts_found INT,
  last_error      TEXT
);

-- ── 3. NAICS ordered by staleness ─────────────────────────────────────────────
--
-- The NAICS list still comes from the data (every NAICS present in the table --
-- same semantics as the sweep's --all); only the ORDERING comes from the
-- attempt log. A NAICS never attempted has no row here and sorts first.
--
-- NOTE: a NAICS with zero rows in recompete_opportunities can never enter this
-- way. That gap predates #288; see the issue's "not in scope".

-- CREATE OR REPLACE cannot change a function's return type (42P13: "cannot
-- change return type of existing function"). An earlier cut of this returned
-- three columns; this one adds last_result. Drop first so the migration stays
-- re-runnable across that signature change.
DROP FUNCTION IF EXISTS recompete_naics_by_staleness(INT);

CREATE OR REPLACE FUNCTION recompete_naics_by_staleness(lim INT DEFAULT 40)
RETURNS TABLE (naics_code TEXT, row_count BIGINT, last_synced TIMESTAMPTZ, last_result TEXT)
LANGUAGE sql
STABLE
AS $$
  SELECT
    o.naics_code,
    COUNT(*) AS row_count,
    -- Never attempted -> epoch -> sorts first. NULLS FIRST would do the same,
    -- but being explicit keeps the ORDER BY readable.
    COALESCE(MAX(s.last_attempt_at), '1970-01-01'::TIMESTAMPTZ) AS last_synced,
    MAX(s.last_result) AS last_result
  FROM recompete_opportunities o
  LEFT JOIN recompete_naics_sync s ON s.naics_code = o.naics_code
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
--     -> expect 5 NAICS, least-recently-ATTEMPTED first (all NULL/epoch on a
--        fresh install, since nothing has been attempted yet)
--   SELECT field, count(*) FROM recompete_changes GROUP BY 1;
--     -> empty until the sync observes its first real change
--   SELECT last_result, count(*) FROM recompete_naics_sync GROUP BY 1;
--     -> after a full cycle: mostly 'ok', some 'empty', no 'error'
