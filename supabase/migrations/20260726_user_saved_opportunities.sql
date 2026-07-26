-- User Favorites / Watchlist for the Opportunity Map (the ♡ heart on a popup card).
--
-- ROOT CAUSE this fixes: the Favorites feature (heart → save, /opportunity-map/favorites → read)
-- both read/write `user_saved_opportunities`, but the table was never created in the DB — the
-- original schema (src/lib/supabase/saved-opportunities-schema.sql) was written but never hand-run.
-- So the save POST 500'd (upsert to a missing table) and the Favorites page GET 500'd → empty page.
--
-- This is the promoted, idempotent migration for that table (+ the pursuit_brief_log it references).
-- Columns match every consumer: api/opportunities/save (POST/GET/DELETE), save-redirect,
-- pursuit-brief, and api/admin/dashboard.
--
-- RLS: service-role only — all access is via authed API routes using the service key
-- (verifyUserOwnsEmail gates the caller), matching the current convention (see 20260725_saved_searches).

CREATE TABLE IF NOT EXISTS user_saved_opportunities (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email              TEXT NOT NULL,

  -- Opportunity identifiers
  notice_id               TEXT NOT NULL,   -- SAM.gov noticeId (the heart's data-nid)
  solicitation_number     TEXT,

  -- Opportunity data (snapshot at time of save)
  opportunity_data        JSONB,           -- full opp details (nullable: heart save sends none)
  title                   TEXT,
  agency                  TEXT,
  naics_code              TEXT,
  set_aside               TEXT,
  response_deadline       TIMESTAMPTZ,
  posted_date             TIMESTAMPTZ,
  estimated_value         NUMERIC,

  -- Source tracking: 'daily_alert' | 'daily_brief' | 'manual' | 'opportunity_hunter' | 'opportunity_map'
  source                  TEXT DEFAULT 'manual',

  -- Pursuit Brief tracking
  pursuit_brief_requested BOOLEAN DEFAULT TRUE,
  pursuit_brief_sent_at   TIMESTAMPTZ,
  pursuit_brief_data      JSONB,

  -- User actions: 'watching' | 'pursuing' | 'submitted' | 'won' | 'lost' | 'no_bid'
  status                  TEXT DEFAULT 'watching',
  notes                   TEXT,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One favorite per (user, notice) — the upsert onConflict target.
  UNIQUE (user_email, notice_id)
);

CREATE INDEX IF NOT EXISTS idx_saved_opps_user     ON user_saved_opportunities(user_email);
CREATE INDEX IF NOT EXISTS idx_saved_opps_notice   ON user_saved_opportunities(notice_id);
CREATE INDEX IF NOT EXISTS idx_saved_opps_status   ON user_saved_opportunities(status);
CREATE INDEX IF NOT EXISTS idx_saved_opps_deadline ON user_saved_opportunities(response_deadline);
CREATE INDEX IF NOT EXISTS idx_saved_opps_pursuit_pending ON user_saved_opportunities(user_email)
  WHERE pursuit_brief_requested = TRUE AND pursuit_brief_sent_at IS NULL;

ALTER TABLE user_saved_opportunities ENABLE ROW LEVEL SECURITY;

-- Keep updated_at fresh on UPDATE.
CREATE OR REPLACE FUNCTION update_saved_opps_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_saved_opps_updated_at ON user_saved_opportunities;
CREATE TRIGGER update_saved_opps_updated_at
  BEFORE UPDATE ON user_saved_opportunities
  FOR EACH ROW EXECUTE FUNCTION update_saved_opps_updated_at();

COMMENT ON TABLE user_saved_opportunities IS 'User saved/favorited opportunities (Opportunity Map heart) - also triggers Pursuit Brief generation';

-- ------------------------------------------------------------
-- Pursuit Brief log (referenced by user_saved_opportunities.id)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pursuit_brief_log (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email            TEXT NOT NULL,
  saved_opportunity_id  UUID REFERENCES user_saved_opportunities(id),
  notice_id             TEXT NOT NULL,
  brief_data            JSONB NOT NULL,
  opportunity_score     INTEGER,
  sent_at               TIMESTAMPTZ,
  delivery_status       TEXT DEFAULT 'pending',   -- 'pending' | 'sent' | 'failed'
  error_message         TEXT,
  processing_time_ms    INTEGER,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pursuit_log_user   ON pursuit_brief_log(user_email);
CREATE INDEX IF NOT EXISTS idx_pursuit_log_notice ON pursuit_brief_log(notice_id);
CREATE INDEX IF NOT EXISTS idx_pursuit_log_sent   ON pursuit_brief_log(sent_at DESC);

ALTER TABLE pursuit_brief_log ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE pursuit_brief_log IS 'Log of all pursuit briefs generated and sent';
