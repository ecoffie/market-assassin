-- M-Estimate self-improving loop — Phase 0: append-only prediction log.
-- Hand-run in the Supabase SQL editor (this DB has no in-app DDL).
--
-- Idempotent. Safe to re-run.
--
-- WHY THIS TABLE EXISTS (same spirit as recompete_changes, migration
-- 20260716_recompete_changes_and_staleness.sql — "the moat now counts itself"):
--
-- M-Estimate (the branded contract-value range shown on the opportunity map)
-- is currently computed ON DEMAND and never recorded. Every time we compute one
-- without logging it, that specific prediction — the exact range we told a user
-- at the exact moment we told them, against the exact comparable-award sample we
-- had on hand that day — is gone forever. USASpending only serves CURRENT state,
-- our comparable-award cache changes over time, and our own model version will
-- change too. There is no way to reconstruct "what would M-Estimate have said on
-- 2026-07-26" after the fact.
--
-- That is the entire reason Phase 0 ships alone, ahead of any award-harvest or
-- accuracy-measurement machinery (Phases 1-3, see
-- docs/strategy/PRD-m-estimate-self-improving-loop.md): the clock on "how long
-- have we been recording predictions" starts the day this table starts receiving
-- rows, not the day we get around to building the harvest join. Every day this
-- ships later is a day of predictions that can never be scored.
--
-- APPEND-ONLY ON PURPOSE: never UPDATE a row here. Each new compute for the same
-- notice_id (e.g. a re-open of the detail drawer, a model_version bump, a change
-- in the comparable-award sample) writes a NEW row. That row-level history IS the
-- moat -- it lets Phase 2 measure how the estimate evolved and whether tightening
-- the model actually reduced error, not just whether the CURRENT estimate looks
-- reasonable in hindsight.

CREATE TABLE IF NOT EXISTS m_estimate_log (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notice_id          TEXT,
  solicitation_number TEXT,
  naics              TEXT,
  agency             TEXT,
  sub_agency         TEXT,
  our_low            NUMERIC,
  our_median         NUMERIC,
  our_high           NUMERIC,
  comparable_n       INT,
  source             TEXT,        -- e.g. 'comparable_awards' (ValueRange.source)
  model_version      TEXT,        -- M_ESTIMATE_MODEL_VERSION at compute time
  estimated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- "Show me every M-Estimate ever computed for this opp" -- the read Phase 1's
-- award-harvest join will need (notice_id -> eventual award).
CREATE INDEX IF NOT EXISTS idx_m_estimate_log_notice
  ON m_estimate_log (notice_id);

-- "What's our error in NAICS x agency" -- the read Phase 2's segment-level
-- confidence-tier measurement will need.
CREATE INDEX IF NOT EXISTS idx_m_estimate_log_naics_agency
  ON m_estimate_log (naics, agency);

-- Time-ordered scans (recent-first dashboards, staleness checks, model-version
-- rollout comparisons).
CREATE INDEX IF NOT EXISTS idx_m_estimate_log_estimated_at
  ON m_estimate_log (estimated_at DESC);

-- RLS: service-role-only, matching every other append-only moat table in this
-- codebase (recompete_changes, mcp_credit_ledger, etc). No anon/authenticated
-- policy is created on purpose -- only the server (service-role client) writes
-- or reads this table.
ALTER TABLE m_estimate_log ENABLE ROW LEVEL SECURITY;

-- Verification:
--   SELECT count(*) FROM m_estimate_log;
--     -> 0 immediately after this migration (expected -- the log starts empty
--        and only fills once the logging hook is deployed and opp-detail
--        requests start flowing through it)
--   SELECT model_version, count(*) FROM m_estimate_log GROUP BY 1;
--     -> after deploy: all rows 'v1' until a future model_version bump
