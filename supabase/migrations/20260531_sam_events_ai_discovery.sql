-- AI Event Discovery — Slice 5 of the Target Market Research roadmap
-- (tasks/target-market-research-roadmap.md).
--
-- When a saved target has few known events, Mindy searches the open web
-- for industry days / conferences tied to that agency, structures them
-- with an LLM, and persists into sam_events so future users hit the
-- cache. Roadmap rationale: "1 prompt × maintenance" beats a 150-scraper
-- farm — better recall, adapts to site redesigns, discovers new event
-- series organically.
--
-- This migration is additive + idempotent. Existing extract-sam-events
-- rows keep working: the new `source` column defaults to 'sam_gov', so
-- the daily SAM.gov extraction is unaffected.

-- ---------------------------------------------------------------------
-- 1) Provenance columns on sam_events
-- ---------------------------------------------------------------------
ALTER TABLE sam_events
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'sam_gov',  -- 'sam_gov' | 'ai_web_search'
  ADD COLUMN IF NOT EXISTS confidence NUMERIC,             -- 0..1, AI-discovered only (NULL for SAM rows)
  ADD COLUMN IF NOT EXISTS discovered_via TEXT;            -- 'ai_web_search' | NULL

COMMENT ON COLUMN sam_events.source IS
  'Where this event came from. ''sam_gov'' = daily SAM.gov Special-Notice extraction (extract-sam-events cron). ''ai_web_search'' = Mindy AI web discovery (Slice 5). Defaults to sam_gov so existing rows are unaffected.';
COMMENT ON COLUMN sam_events.confidence IS
  'AI confidence 0..1 that this is a real, correctly-dated upcoming event. NULL for SAM.gov rows (authoritative). Low values get a "verify date" badge in the UI.';

CREATE INDEX IF NOT EXISTS idx_sam_events_source ON sam_events(source);

-- ---------------------------------------------------------------------
-- 2) Throttle table — one discovery run per (agency, week)
-- ---------------------------------------------------------------------
-- Roadmap: "Cache TTL: 7 days per (agency, week)." We don't want to
-- re-fire Serper + Groq for the same agency on every button click, so
-- we stamp each run and skip if a fresh one exists. agency_key is a
-- normalized lowercase agency name so "Department of the Air Force" and
-- "department of the air force" collapse to one run.
CREATE TABLE IF NOT EXISTS ai_event_discovery_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_key TEXT NOT NULL,                  -- normalized agency name (lowercased, trimmed)
  agency_name TEXT NOT NULL,                 -- human-readable, as searched
  last_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  events_found INT NOT NULL DEFAULT 0,
  events_persisted INT NOT NULL DEFAULT 0,
  queries_used TEXT[],                       -- the search queries fired (for audit/debugging)
  triggered_by TEXT,                         -- user_email that triggered the run
  CONSTRAINT unique_agency_discovery UNIQUE (agency_key)
);

CREATE INDEX IF NOT EXISTS idx_ai_event_discovery_runs_recent
  ON ai_event_discovery_runs (last_run_at DESC);

COMMENT ON TABLE ai_event_discovery_runs IS
  'Throttle log for AI event discovery (roadmap Slice 5). One row per normalized agency. last_run_at gates re-runs to a 7-day TTL so we do not re-fire Serper + Groq for the same agency on every click. Upsert by agency_key.';

NOTIFY pgrst, 'reload schema';
