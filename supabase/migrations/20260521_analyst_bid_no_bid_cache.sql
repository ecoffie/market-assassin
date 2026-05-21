-- AI Analyst bid/no-bid recommendation cache.
--
-- First slice of the AI BD Department (PRD-ai-bd-department.md
-- Agent #2 — Analyst). For each (opportunity, user) pair we cache
-- the LLM-generated bid/no-bid analysis so re-opening the same opp
-- doesn't re-call Groq.
--
-- Per-user cache because the analysis depends on the user's profile
-- (set-asides, NAICS, target agencies, past feedback). Same opp +
-- different user = different analysis.

CREATE TABLE IF NOT EXISTS analyst_bid_no_bid_cache (
  notice_id TEXT NOT NULL,
  user_email TEXT NOT NULL,

  -- Full LLM output as JSONB so we can evolve the prompt without a
  -- schema migration. The route serializes whatever the model
  -- returned that parsed as valid JSON. Expected shape per the v1
  -- prompt:
  --   {
  --     recommendation: 'pursue' | 'watch' | 'skip',
  --     score: 0-100,
  --     why_pursue: string[],
  --     concerns: string[],
  --     competitors_likely: string[],
  --     effort_estimate: string,
  --     next_step: string,
  --   }
  recommendation JSONB NOT NULL,

  -- Denormalized fields for indexing / filtering without unpacking
  -- the JSON on every query. e.g. "show me every PURSUE opp for
  -- user@example.com sorted by score."
  score INT,
  recommendation_label TEXT, -- 'pursue' | 'watch' | 'skip'

  -- Observability: which model produced this output. Lets us know
  -- which cached rows are stale when we upgrade prompts/models.
  model_used TEXT,
  prompt_tokens INT,
  completion_tokens INT,

  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (notice_id, user_email)
);

-- Common access pattern: a user's top-pursue opps sorted by score.
CREATE INDEX IF NOT EXISTS analyst_bid_no_bid_cache_user_score_idx
  ON analyst_bid_no_bid_cache (user_email, score DESC NULLS LAST);

-- Common access pattern: invalidate stale entries by model version.
CREATE INDEX IF NOT EXISTS analyst_bid_no_bid_cache_model_idx
  ON analyst_bid_no_bid_cache (model_used);

COMMENT ON TABLE analyst_bid_no_bid_cache IS
  'Per-(opportunity, user) cache of LLM bid/no-bid analysis. PRD-ai-bd-department.md Agent #2.';

NOTIFY pgrst, 'reload schema';
