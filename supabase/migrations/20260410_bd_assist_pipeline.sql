-- BD Assist Pipeline Database Schema
-- Created: April 10, 2026
-- Purpose: Track opportunities through sales pipeline stages with teaming and outcome tracking

-- ============================================================================
-- 1. USER_PIPELINE: Main opportunity tracking table
-- ============================================================================
CREATE TABLE user_pipeline (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,

  -- Opportunity reference
  notice_id TEXT,                    -- SAM.gov notice ID (if from SAM)
  source TEXT DEFAULT 'sam.gov',     -- sam.gov, grants.gov, manual
  external_url TEXT,

  -- Core fields
  title TEXT NOT NULL,
  agency TEXT,
  value_estimate TEXT,
  naics_code TEXT,
  set_aside TEXT,
  response_deadline TIMESTAMPTZ,

  -- Pipeline tracking
  stage TEXT DEFAULT 'tracking',     -- tracking, pursuing, bidding, submitted, won, lost
  win_probability INTEGER,           -- 0-100
  priority TEXT DEFAULT 'medium',    -- low, medium, high

  -- Notes and actions
  notes TEXT,
  next_action TEXT,
  next_action_date DATE,

  -- Teaming
  teaming_partners TEXT[],           -- Array of company names
  is_prime BOOLEAN DEFAULT true,

  -- Outcome (for won/lost)
  outcome_date DATE,
  outcome_notes TEXT,
  award_amount TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Ensure unique opportunities per user
  UNIQUE(user_email, notice_id)
);

-- Add comments for documentation
COMMENT ON TABLE user_pipeline IS 'Tracks opportunities through BD pipeline stages';
COMMENT ON COLUMN user_pipeline.stage IS 'Current pipeline stage: tracking, pursuing, bidding, submitted, won, lost';
COMMENT ON COLUMN user_pipeline.win_probability IS 'Estimated win probability percentage (0-100)';
COMMENT ON COLUMN user_pipeline.priority IS 'User-defined priority: low, medium, high';
COMMENT ON COLUMN user_pipeline.teaming_partners IS 'Array of teaming partner company names';
COMMENT ON COLUMN user_pipeline.is_prime IS 'True if user is prime contractor, false if subcontractor';

-- ============================================================================
-- 2. PIPELINE_HISTORY: Track stage changes and progression
-- ============================================================================
CREATE TABLE pipeline_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id UUID REFERENCES user_pipeline(id) ON DELETE CASCADE,
  from_stage TEXT,
  to_stage TEXT,
  changed_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT
);

COMMENT ON TABLE pipeline_history IS 'Audit trail of pipeline stage changes';
COMMENT ON COLUMN pipeline_history.from_stage IS 'Previous stage (null for initial entry)';
COMMENT ON COLUMN pipeline_history.to_stage IS 'New stage after transition';

-- ============================================================================
-- 3. USER_TEAMING_PARTNERS: Saved partners with outreach tracking
-- ============================================================================
CREATE TABLE user_teaming_partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,
  partner_name TEXT NOT NULL,
  partner_uei TEXT,
  partner_type TEXT,                 -- prime, sub, jv
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  naics_codes TEXT[],
  certifications TEXT[],
  notes TEXT,
  outreach_status TEXT DEFAULT 'none',  -- none, contacted, responded, meeting, partnered
  last_contact DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE user_teaming_partners IS 'Saved teaming partners with relationship tracking';
COMMENT ON COLUMN user_teaming_partners.partner_type IS 'Relationship type: prime, sub, jv';
COMMENT ON COLUMN user_teaming_partners.outreach_status IS 'Outreach progress: none, contacted, responded, meeting, partnered';
COMMENT ON COLUMN user_teaming_partners.partner_uei IS 'SAM.gov Unique Entity Identifier';

-- ============================================================================
-- INDEXES: Optimize common queries
-- ============================================================================

-- User pipeline indexes
CREATE INDEX idx_pipeline_user ON user_pipeline(user_email);
CREATE INDEX idx_pipeline_stage ON user_pipeline(stage);
CREATE INDEX idx_pipeline_deadline ON user_pipeline(response_deadline);
CREATE INDEX idx_pipeline_source ON user_pipeline(source);
CREATE INDEX idx_pipeline_notice ON user_pipeline(notice_id);

-- Pipeline history indexes
CREATE INDEX idx_history_pipeline ON pipeline_history(pipeline_id);
CREATE INDEX idx_history_changed_at ON pipeline_history(changed_at DESC);

-- Teaming partners indexes
CREATE INDEX idx_teaming_user ON user_teaming_partners(user_email);
CREATE INDEX idx_teaming_outreach ON user_teaming_partners(outreach_status);
CREATE INDEX idx_teaming_partner_name ON user_teaming_partners(partner_name);

-- ============================================================================
-- TRIGGERS: Auto-update timestamps
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to user_pipeline
CREATE TRIGGER update_user_pipeline_updated_at
  BEFORE UPDATE ON user_pipeline
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Apply trigger to user_teaming_partners
CREATE TRIGGER update_user_teaming_partners_updated_at
  BEFORE UPDATE ON user_teaming_partners
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- TRIGGER: Auto-create history entry on stage change
-- ============================================================================

CREATE OR REPLACE FUNCTION track_stage_change()
RETURNS TRIGGER AS $$
BEGIN
  -- Only track if stage actually changed
  IF OLD.stage IS DISTINCT FROM NEW.stage THEN
    INSERT INTO pipeline_history (
      pipeline_id,
      from_stage,
      to_stage,
      notes
    ) VALUES (
      NEW.id,
      OLD.stage,
      NEW.stage,
      'Stage changed automatically'
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to user_pipeline
CREATE TRIGGER track_pipeline_stage_change
  AFTER UPDATE ON user_pipeline
  FOR EACH ROW
  EXECUTE FUNCTION track_stage_change();

-- ============================================================================
-- ROW LEVEL SECURITY (RLS): Optional - enable if using Supabase auth
-- ============================================================================

-- Enable RLS on all tables (commented out - enable when using Supabase auth)
-- ALTER TABLE user_pipeline ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE pipeline_history ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE user_teaming_partners ENABLE ROW LEVEL SECURITY;

-- Example RLS policies (commented out)
-- CREATE POLICY "Users can view their own pipeline"
--   ON user_pipeline FOR SELECT
--   USING (user_email = current_user_email());

-- CREATE POLICY "Users can insert their own pipeline items"
--   ON user_pipeline FOR INSERT
--   WITH CHECK (user_email = current_user_email());

-- CREATE POLICY "Users can update their own pipeline items"
--   ON user_pipeline FOR UPDATE
--   USING (user_email = current_user_email());

-- ============================================================================
-- SAMPLE DATA (optional for testing)
-- ============================================================================

-- Example pipeline entry (commented out)
-- INSERT INTO user_pipeline (
--   user_email,
--   notice_id,
--   source,
--   title,
--   agency,
--   value_estimate,
--   naics_code,
--   set_aside,
--   response_deadline,
--   stage,
--   win_probability,
--   priority
-- ) VALUES (
--   'test@example.com',
--   'ABC123456',
--   'sam.gov',
--   'IT Support Services',
--   'Department of Defense',
--   '$5M - $10M',
--   '541512',
--   '8(a)',
--   '2026-05-15 23:59:59+00',
--   'pursuing',
--   65,
--   'high'
-- );

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
