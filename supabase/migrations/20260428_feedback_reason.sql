-- Add reason column to briefing_feedback table
-- Tracks WHY a briefing was not helpful for matching improvements

ALTER TABLE briefing_feedback
ADD COLUMN IF NOT EXISTS reason TEXT;

-- Create index for reason analysis
CREATE INDEX IF NOT EXISTS idx_briefing_feedback_reason ON briefing_feedback(reason);

-- Update comment
COMMENT ON COLUMN briefing_feedback.reason IS 'Reason for not_helpful rating: wrong_industry, wrong_location, too_broad, too_narrow, irrelevant_agencies, already_saw, other';
