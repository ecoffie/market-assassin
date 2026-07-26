-- SOW → card facts (Tier 1): brand-name/or-equal flag, evaluation basis (Best Value / LPTA /
-- Trade-off), and set-aside-as-stated-in-text (fills the ~22% gap where set_aside_code is null +
-- flags mismatches). Mirrors the intel_* precompute pattern (20260726_opp_intel_precompute.sql).
-- Scope: tasks/sow-card-facts-scope-2026-07-26.md. Idempotent.

ALTER TABLE sam_opportunities ADD COLUMN IF NOT EXISTS sow_card_facts JSONB;
ALTER TABLE sam_opportunities ADD COLUMN IF NOT EXISTS sow_card_facts_computed_at TIMESTAMPTZ;

-- Own drain cursor (separate from intel_computed_at — different precompute job, different
-- cadence): least-recently-computed active opps with real SOW text first (NULLs first = never
-- computed).
CREATE INDEX IF NOT EXISTS idx_sam_sow_card_facts_computed_at ON sam_opportunities (sow_card_facts_computed_at NULLS FIRST)
  WHERE active = true;
