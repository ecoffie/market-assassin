-- Anti-repetition memory for briefings
--
-- Tracks the top "story angles" (opportunity titles + themes + lead
-- headlines) used in each briefing template per NAICS profile, so the
-- next precompute run for that profile can tell the AI which angles
-- were already used in the last 30 days and to prefer fresh framings.
--
-- Mirrors Content Reaper's previousAngles localStorage pattern but
-- aggregated at the NAICS-profile level since briefings are
-- pre-computed per profile (not per user).
--
-- Built 2026-05-27 from the Content Reaper pattern audit. Highest-
-- compounding pattern in the audit per Eric's "1-1-1" instinct: zero
-- new UI, zero email-template changes, but every briefing gets fresher
-- week-over-week.

CREATE TABLE IF NOT EXISTS briefing_angle_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Profile this angle history is for. Briefings are pre-computed at
  -- this granularity, so we track avoidance at the same granularity.
  naics_profile_hash TEXT NOT NULL,

  -- Which briefing type (daily / weekly / pursuit). Each has different
  -- repetition tolerance — pursuit briefs naturally repeat top targets
  -- while daily briefs should evolve faster.
  briefing_type TEXT NOT NULL,

  -- ISO date the briefing was generated (NOT sent). Briefings are
  -- pre-computed nightly so this is the precompute date.
  briefing_date DATE NOT NULL,

  -- Array of short "angle" strings extracted from the briefing content.
  -- Examples:
  --   - "Navy zero-trust cybersecurity"
  --   - "FY26 NDAA AI/ML compliance mandate"
  --   - "small business goal shortfall at DoD"
  -- Cap at 5 angles per briefing — more is noise.
  angles TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lookup index: get last 10 angles for a profile + type
CREATE INDEX IF NOT EXISTS idx_angle_history_lookup
  ON briefing_angle_history(naics_profile_hash, briefing_type, briefing_date DESC);

-- Cleanup index: prune rows older than 60 days (we only need last 30)
CREATE INDEX IF NOT EXISTS idx_angle_history_age
  ON briefing_angle_history(briefing_date);

COMMENT ON TABLE briefing_angle_history IS
  'Anti-repetition memory for briefings. Tracks top 5 angles per profile per briefing so precompute can tell the AI to prefer fresh framings. Aggregated at naics_profile_hash level. Last 10 rows (~10 briefings, ~2 weeks daily / ~10 weeks weekly) injected into next prompt.';

NOTIFY pgrst, 'reload schema';
