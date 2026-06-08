-- LLM usage + cost tracking (Eric: users on $149/mo can't run up $200 bills —
-- track per-user spend, cap it, and surface it before it's a surprise. Acquisition
-- needs provable unit economics).
--
-- One row per LLM call: who, which tool, provider/model, tokens, and the $ cost
-- computed from per-model prices. Aggregated per user/month for the budget cap +
-- per tool for the cost dashboard.

CREATE TABLE IF NOT EXISTS llm_usage_log (
  id           BIGSERIAL PRIMARY KEY,
  user_email   TEXT,                       -- null for system/cron calls
  tool         TEXT NOT NULL,              -- 'proposal_chat', 'mindy_chat', 'bid_no_bid', etc.
  job          TEXT,                        -- 'reasoning' | 'drafting' | 'referee' | 'extraction'
  provider     TEXT,                        -- 'openai' | 'groq70b' | 'claude' | ...
  model        TEXT,
  prompt_tokens     INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  cost_usd     NUMERIC(10,5) DEFAULT 0,     -- computed: tokens × per-model price
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_llm_usage_user_month ON llm_usage_log (user_email, created_at);
CREATE INDEX IF NOT EXISTS idx_llm_usage_tool ON llm_usage_log (tool, created_at);

-- Fast per-user current-month spend (drives the budget cap). A view keeps the
-- cap check a single cheap query.
CREATE OR REPLACE VIEW llm_usage_month AS
SELECT
  user_email,
  date_trunc('month', created_at) AS month,
  SUM(cost_usd)                   AS cost_usd,
  SUM(prompt_tokens + completion_tokens) AS tokens,
  COUNT(*)                        AS calls
FROM llm_usage_log
WHERE user_email IS NOT NULL
GROUP BY user_email, date_trunc('month', created_at);
