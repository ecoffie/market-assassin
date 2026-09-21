-- Pipeline Tracker Schema for BD Assist
-- Enables opportunity tracking through capture stages

-- User pipeline (tracked opportunities)
CREATE TABLE IF NOT EXISTS user_pipeline (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,

  -- Opportunity reference
  notice_id TEXT,                    -- SAM.gov notice ID (if from SAM)
  source TEXT DEFAULT 'sam.gov',     -- sam.gov, grants.gov, multisite, manual
  external_url TEXT,

  -- Core fields
  title TEXT NOT NULL,
  agency TEXT,
  value_estimate TEXT,               -- "$5M-$10M" format
  naics_code TEXT,
  set_aside TEXT,
  response_deadline TIMESTAMPTZ,

  -- Pipeline tracking
  stage TEXT DEFAULT 'tracking',     -- tracking, pursuing, bidding, submitted, won, lost, archived
  win_probability INTEGER,           -- 0-100
  priority TEXT DEFAULT 'medium',    -- low, medium, high, critical

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
  winner TEXT,                       -- Who won (if we lost)

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT unique_user_notice UNIQUE (user_email, notice_id)
);

-- Pipeline stage history (audit trail)
CREATE TABLE IF NOT EXISTS pipeline_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id UUID REFERENCES user_pipeline(id) ON DELETE CASCADE,
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  changed_at TIMESTAMPTZ DEFAULT NOW(),
  changed_by TEXT,                   -- user_email who made change
  notes TEXT
);

-- Saved teaming partners
CREATE TABLE IF NOT EXISTS user_teaming_partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,

  -- Partner info
  partner_name TEXT NOT NULL,
  partner_type TEXT,                 -- prime, sub, jv, mentor
  uei TEXT,                          -- Unique Entity ID if known
  cage_code TEXT,

  -- Contact
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  contact_title TEXT,

  -- Capabilities
  naics_codes TEXT[],
  certifications TEXT[],             -- 8a, WOSB, SDVOSB, HUBZone, etc.
  past_performance TEXT,             -- Brief notes

  -- Relationship tracking
  outreach_status TEXT DEFAULT 'none',  -- none, contacted, responded, meeting, partnered
  last_contact DATE,
  notes TEXT,

  -- Metadata
  source TEXT,                       -- contractor_db, briefing, manual
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT unique_user_partner UNIQUE (user_email, partner_name)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_pipeline_user ON user_pipeline(user_email);
CREATE INDEX IF NOT EXISTS idx_pipeline_stage ON user_pipeline(stage);
CREATE INDEX IF NOT EXISTS idx_pipeline_deadline ON user_pipeline(response_deadline);
CREATE INDEX IF NOT EXISTS idx_pipeline_priority ON user_pipeline(priority);
CREATE INDEX IF NOT EXISTS idx_pipeline_naics ON user_pipeline(naics_code);

CREATE INDEX IF NOT EXISTS idx_pipeline_history_pipeline ON pipeline_history(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_history_date ON pipeline_history(changed_at);

CREATE INDEX IF NOT EXISTS idx_teaming_user ON user_teaming_partners(user_email);
CREATE INDEX IF NOT EXISTS idx_teaming_status ON user_teaming_partners(outreach_status);

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_pipeline_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_pipeline_updated_at
  BEFORE UPDATE ON user_pipeline
  FOR EACH ROW
  EXECUTE FUNCTION update_pipeline_timestamp();

CREATE TRIGGER update_teaming_updated_at
  BEFORE UPDATE ON user_teaming_partners
  FOR EACH ROW
  EXECUTE FUNCTION update_pipeline_timestamp();

-- Record stage changes automatically
CREATE OR REPLACE FUNCTION record_pipeline_stage_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.stage IS DISTINCT FROM NEW.stage THEN
    INSERT INTO pipeline_history (pipeline_id, from_stage, to_stage, changed_by)
    VALUES (NEW.id, OLD.stage, NEW.stage, NEW.user_email);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER track_pipeline_stage_changes
  AFTER UPDATE ON user_pipeline
  FOR EACH ROW
  EXECUTE FUNCTION record_pipeline_stage_change();

-- Comments
COMMENT ON TABLE user_pipeline IS 'User opportunity pipeline tracker for BD Assist';
COMMENT ON TABLE pipeline_history IS 'Audit trail of pipeline stage changes';
COMMENT ON TABLE user_teaming_partners IS 'Saved teaming partners for users';
COMMENT ON COLUMN user_pipeline.stage IS 'tracking=watching, pursuing=active capture, bidding=writing proposal, submitted=awaiting decision, won/lost=outcome, archived=no longer relevant';
