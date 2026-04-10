-- Briefing Feedback Table
-- Tracks user feedback (helpful/not helpful) for briefings

CREATE TABLE IF NOT EXISTS briefing_feedback (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_email TEXT NOT NULL,
  briefing_date DATE NOT NULL,
  briefing_type TEXT NOT NULL DEFAULT 'daily', -- daily, weekly, pursuit
  rating TEXT NOT NULL, -- helpful, not_helpful
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint: one feedback per user per briefing
  CONSTRAINT unique_feedback UNIQUE (user_email, briefing_date, briefing_type)
);

-- Indexes for querying
CREATE INDEX IF NOT EXISTS idx_briefing_feedback_user ON briefing_feedback(user_email);
CREATE INDEX IF NOT EXISTS idx_briefing_feedback_date ON briefing_feedback(briefing_date);
CREATE INDEX IF NOT EXISTS idx_briefing_feedback_rating ON briefing_feedback(rating);

-- Comment
COMMENT ON TABLE briefing_feedback IS 'User feedback on daily/weekly/pursuit briefings';
