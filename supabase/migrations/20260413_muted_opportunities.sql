-- User muted opportunities table
-- Tracks which opportunities a user doesn't want to see in future briefings

CREATE TABLE IF NOT EXISTS user_muted_opportunities (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_email TEXT NOT NULL,
  notice_id TEXT,
  title TEXT NOT NULL,
  reason TEXT DEFAULT 'not_interested',
  muted_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint to prevent duplicate mutes
  CONSTRAINT unique_user_mute UNIQUE (user_email, COALESCE(notice_id, title))
);

-- Index for fast lookups during briefing generation
CREATE INDEX IF NOT EXISTS idx_muted_user_email ON user_muted_opportunities(user_email);
CREATE INDEX IF NOT EXISTS idx_muted_notice_id ON user_muted_opportunities(notice_id) WHERE notice_id IS NOT NULL;

-- RLS policies
ALTER TABLE user_muted_opportunities ENABLE ROW LEVEL SECURITY;

-- Service role can do everything
CREATE POLICY "Service role full access" ON user_muted_opportunities
  FOR ALL
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE user_muted_opportunities IS 'Tracks opportunities users have muted/hidden from their briefings';
COMMENT ON COLUMN user_muted_opportunities.reason IS 'Why muted: not_interested, already_bidding, wrong_naics, too_large, etc.';
