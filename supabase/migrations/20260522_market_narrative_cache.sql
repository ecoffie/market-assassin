-- Mindy Says — AI market narrative cache
--
-- Caches Groq-generated market analysis for the Market Map flagship
-- page so repeat visits are instant + we don't burn budget re-
-- summarizing the same NAICS/business-type market every load.
--
-- TTL: 7 days. Underlying USAspending data only refreshes weekly
-- (and our agency_target_data_cache is 24h), so 7d on the narrative
-- is safe — it'll re-generate when the upstream data ages out.
--
-- Cache key: (naics, business_type, user_email). User email is part
-- of the key because the narrative tone shifts based on the user's
-- profile (e.g., set-aside language for 8(a) firms vs general SMB
-- language for unrestricted). Same NAICS = different narrative per
-- user is intentional.

CREATE TABLE IF NOT EXISTS market_narrative_cache (
  naics_code TEXT NOT NULL,
  business_type TEXT DEFAULT '',
  user_email TEXT NOT NULL,

  -- The Groq response. Stored as JSONB so we can evolve the prompt
  -- shape without a schema migration. Expected shape:
  --   {
  --     summary: string,         // 3-sentence market read
  --     actions: [{label, link}] // 3 recommended next actions
  --   }
  narrative JSONB NOT NULL,

  -- Observability — which model produced this so we know when a
  -- prompt/model upgrade invalidates older cached rows.
  model_used TEXT,
  prompt_tokens INT,
  completion_tokens INT,

  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (naics_code, business_type, user_email)
);

-- Common access: a user's most-recent narratives, for the future
-- "narrative history" sidebar.
CREATE INDEX IF NOT EXISTS market_narrative_cache_user_idx
  ON market_narrative_cache (user_email, generated_at DESC);

COMMENT ON TABLE market_narrative_cache IS
  'Per-(naics, business_type, user) cache of Groq market-narrative summaries for the Mindy Says card on the Market Map view. 7d TTL.';

NOTIFY pgrst, 'reload schema';
