-- Data-quality quarantine for recompete_opportunities.
-- Adds a quality_flag so corrupt rows (implausible values, parse placeholders) are
-- HIDDEN from the Expiring Contracts view without deleting them (reversible; re-derive
-- later). Hand-run in Supabase SQL editor (this DB has no in-app DDL — rule #6).

ALTER TABLE recompete_opportunities
  ADD COLUMN IF NOT EXISTS quality_flag TEXT;   -- null = clean; else reason ('implausible_value','placeholder_value')

-- Partial index so the "WHERE quality_flag IS NULL" filter stays cheap.
CREATE INDEX IF NOT EXISTS idx_recompete_quality_clean
  ON recompete_opportunities (period_of_performance_current_end)
  WHERE quality_flag IS NULL;

-- Backfill the flag (idempotent — safe to re-run):
-- 1. Implausible: any single vehicle valued over $100B is a ceiling-aggregate/parse error.
UPDATE recompete_opportunities
  SET quality_flag = 'implausible_value'
  WHERE quality_flag IS NULL AND potential_total_value > 100000000000;

-- 2. Round-number placeholders (exact 1e8 / 1e9 / 1e11 / 1e12 = parse artifacts).
UPDATE recompete_opportunities
  SET quality_flag = 'placeholder_value'
  WHERE quality_flag IS NULL
    AND potential_total_value IN (100000000, 1000000000, 100000000000, 1000000000000);

-- Verify after running:
--   SELECT quality_flag, count(*) FROM recompete_opportunities GROUP BY quality_flag;
--   (expect: implausible_value ~2, placeholder_value ~84, NULL ~9395)

-- ADDENDUM (verification caught this): the "99,999,999,999" all-9s value is a
-- max/sentinel cap artifact (e.g. Noble Supply hardware contracts shown as ~$100B).
-- It's just under the $100B threshold so the rule above missed it. Quarantine it
-- specifically — but NOT the legitimate $50-100B GWAC ceilings (GDIT/IBM/Accenture
-- are real). Only the exact all-9s sentinel.
UPDATE recompete_opportunities
  SET quality_flag = 'sentinel_value'
  WHERE quality_flag IS NULL AND potential_total_value = 99999999999;
