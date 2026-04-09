-- =============================================================================
-- BRIEFING TEMPLATES - Pre-computation System
-- =============================================================================
-- Run this SQL in Supabase Dashboard > SQL Editor
--
-- This creates the enterprise pre-computation architecture:
-- - briefing_templates: Pre-computed briefings by NAICS profile
-- - briefing_precompute_runs: Tracks nightly generation jobs
--
-- Result: 95% reduction in LLM calls (928 users → 49 templates)
-- =============================================================================

-- Pre-computed briefing templates by NAICS profile
CREATE TABLE IF NOT EXISTS briefing_templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  naics_profile TEXT NOT NULL,
  naics_profile_hash TEXT NOT NULL,
  template_date DATE NOT NULL DEFAULT CURRENT_DATE,
  briefing_type TEXT NOT NULL DEFAULT 'daily',
  briefing_content JSONB NOT NULL,
  opportunities_count INTEGER DEFAULT 0,
  teaming_plays_count INTEGER DEFAULT 0,
  processing_time_ms INTEGER,
  llm_provider TEXT,
  llm_model TEXT,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '36 hours',
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
  unique_profiles_found INTEGER,
  templates_generated INTEGER,
  templates_failed INTEGER,
  total_users_covered INTEGER,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  total_duration_ms INTEGER,
  error_messages JSONB,
  UNIQUE(run_date, briefing_type)
);

-- Comments
COMMENT ON TABLE briefing_templates IS 'Pre-computed briefing templates by NAICS profile. One template serves many users with the same NAICS codes.';
COMMENT ON TABLE briefing_precompute_runs IS 'Tracks nightly pre-computation jobs that generate templates.';

-- Verify tables were created
SELECT 'briefing_templates' as table_name, count(*) as row_count FROM briefing_templates
UNION ALL
SELECT 'briefing_precompute_runs', count(*) FROM briefing_precompute_runs;
