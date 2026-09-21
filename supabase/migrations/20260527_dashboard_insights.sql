-- Mindy Insight daily quote cache.
--
-- One row per (user_email, insight_date). The /app dashboard hero
-- card pulls from here so we don't regenerate the quote on every
-- page view. Content Reaper pattern #1 for in-app surfaces.
--
-- Quote source can be AI-extracted from the user's briefing OR
-- deterministic from data (top opportunity, NAICS-aware stat).
-- Either way it's stored here for the day.
--
-- Built 2026-05-27 from the Content Reaper audit (final priority pattern).

CREATE TABLE IF NOT EXISTS dashboard_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  user_email TEXT NOT NULL,
  insight_date DATE NOT NULL,

  -- The actual quote rendered on the card (≤120 chars after trim)
  quote TEXT NOT NULL,
  -- Format hint for the renderer (stat, question, contrarian, fragment, sentence)
  quote_format TEXT,
  -- Source — 'ai_briefing' / 'deterministic_data' / 'fallback'
  source TEXT NOT NULL DEFAULT 'fallback',
  -- Optional source attribution shown small at the bottom of the card
  attribution TEXT,

  -- Theme cycled deterministically by day-of-week (0-6) so the user
  -- sees variety across a week but the card is stable within a day.
  theme_index INT NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Idempotency: one insight per user per day
  UNIQUE(user_email, insight_date)
);

CREATE INDEX IF NOT EXISTS idx_dashboard_insights_user_date
  ON dashboard_insights(user_email, insight_date DESC);

COMMENT ON TABLE dashboard_insights IS
  'Daily Mindy Insight quote cache — powers the /app dashboard hero card. Quote is AI-extracted or deterministic, theme cycles by day-of-week.';

NOTIFY pgrst, 'reload schema';
