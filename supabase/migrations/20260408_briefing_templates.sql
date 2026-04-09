-- =============================================================================
-- BRIEFING TEMPLATES - Pre-computation System
-- =============================================================================
-- Instead of generating 928 briefings (one per user), we generate 49 briefings
-- (one per unique NAICS profile), then match users to templates.
--
-- Result: 95% reduction in LLM calls, sub-hour completion time
-- =============================================================================

-- Pre-computed briefing templates by NAICS profile
CREATE TABLE IF NOT EXISTS briefing_templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Profile key: sorted JSON array of NAICS codes (deterministic)
  naics_profile TEXT NOT NULL,
  naics_profile_hash TEXT NOT NULL, -- MD5 hash for fast lookup

  -- Template metadata
  template_date DATE NOT NULL DEFAULT CURRENT_DATE,
  briefing_type TEXT NOT NULL DEFAULT 'daily', -- daily, weekly, pursuit

  -- Pre-computed briefing content (full AI-generated JSON)
  briefing_content JSONB NOT NULL,

  -- Generation stats
  opportunities_count INTEGER DEFAULT 0,
  teaming_plays_count INTEGER DEFAULT 0,
  processing_time_ms INTEGER,
  llm_provider TEXT, -- groq, anthropic, openai
  llm_model TEXT,

  -- Timestamps
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '36 hours',

  -- Constraints
  UNIQUE(naics_profile_hash, template_date, briefing_type)
);

-- Fast lookup index
CREATE INDEX IF NOT EXISTS idx_briefing_templates_lookup
  ON briefing_templates(naics_profile_hash, template_date, briefing_type);

-- Cleanup index for expired templates
CREATE INDEX IF NOT EXISTS idx_briefing_templates_expires
  ON briefing_templates(expires_at);

-- Track pre-computation runs
CREATE TABLE IF NOT EXISTS briefing_precompute_runs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  run_date DATE NOT NULL DEFAULT CURRENT_DATE,
  briefing_type TEXT NOT NULL DEFAULT 'daily',

  -- Stats
  unique_profiles_found INTEGER,
  templates_generated INTEGER,
  templates_failed INTEGER,
  total_users_covered INTEGER,

  -- Timing
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  total_duration_ms INTEGER,

  -- Details
  error_messages JSONB,

  UNIQUE(run_date, briefing_type)
);

-- View: Match users to their pre-computed templates
CREATE OR REPLACE VIEW user_briefing_templates AS
SELECT
  uns.email,
  uns.naics_codes,
  MD5(COALESCE(
    (SELECT jsonb_agg(code ORDER BY code)::TEXT
     FROM jsonb_array_elements_text(to_jsonb(uns.naics_codes)) AS code),
    '[]'
  )) AS naics_profile_hash,
  bt.id AS template_id,
  bt.briefing_content,
  bt.opportunities_count,
  bt.teaming_plays_count,
  bt.generated_at
FROM user_notification_settings uns
LEFT JOIN briefing_templates bt ON (
  bt.naics_profile_hash = MD5(COALESCE(
    (SELECT jsonb_agg(code ORDER BY code)::TEXT
     FROM jsonb_array_elements_text(to_jsonb(uns.naics_codes)) AS code),
    '[]'
  ))
  AND bt.template_date = CURRENT_DATE
  AND bt.briefing_type = 'daily'
)
WHERE uns.briefings_enabled = true;

-- Comments
COMMENT ON TABLE briefing_templates IS 'Pre-computed briefing templates by NAICS profile. One template serves many users with the same NAICS codes.';
COMMENT ON TABLE briefing_precompute_runs IS 'Tracks nightly pre-computation jobs that generate templates.';
COMMENT ON VIEW user_briefing_templates IS 'Matches users to their pre-computed briefing templates for fast email sending.';
