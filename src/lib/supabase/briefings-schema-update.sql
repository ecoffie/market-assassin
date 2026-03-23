-- ============================================================
-- BRIEFINGS SCHEMA UPDATE - March 23, 2026
-- Adds retry_count column for retry logic
-- Run this in Supabase SQL Editor
-- ============================================================

-- Add retry_count column to briefing_log
ALTER TABLE briefing_log
ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;

COMMENT ON COLUMN briefing_log.retry_count IS 'Number of retry attempts for failed deliveries (max 3)';

-- Create index for retry queries
CREATE INDEX IF NOT EXISTS idx_briefing_log_retry ON briefing_log(delivery_status, retry_count)
WHERE delivery_status = 'failed' AND retry_count < 3;

-- ============================================================
-- DONE
-- ============================================================

-- Summary of changes:
-- 1. Added retry_count to briefing_log (for retry logic)
-- 2. Added index for efficient retry queries
