-- DoD SBIR/STTR topics cache (Eric #6, 2026-07-28) — the defense gap in search_sbir. search_sbir read
-- NIH RePORTER (biomedical AWARDS) only, so it returned nothing for defense work (EOD etc.). This table
-- caches DoD SBIR/STTR OPEN TOPICS from the official sbir.gov API (agency=DOD). The sync cron drains
-- the API into this table (it's rate-limited + intermittently under maintenance, so we NEVER call it
-- live per user query — cache-first, the standing pattern); search_sbir reads THIS table.
--
-- Field names from the sbir.gov Topics data dictionary (Title, Branch, Number, Description, SBIR Topic
-- Link) + solicitation-level agency/program/open/close dates.

CREATE TABLE IF NOT EXISTS dod_sbir_topics (
  topic_number        text PRIMARY KEY,          -- the citable code (e.g. "A254-001"); PK = upsert key
  title               text NOT NULL,
  solicitation_title  text,
  agency              text NOT NULL DEFAULT 'DOD',
  branch              text,                       -- Army / Navy / Air Force / SOCOM / DTRA / MDA …
  program             text,                       -- 'SBIR' | 'STTR'
  phase               text,
  open_date           date,
  close_date          date,
  status              text,                       -- open | future | closed
  description         text,
  url                 text,                       -- sbir_topic_link
  solicitation        text,                       -- parent solicitation id (for a DSIP deep-link)
  synced_at           timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Search/filter indexes: by close date (open topics first), by branch, and a trigram-friendly title.
CREATE INDEX IF NOT EXISTS dod_sbir_topics_close_idx  ON dod_sbir_topics (close_date DESC);
CREATE INDEX IF NOT EXISTS dod_sbir_topics_status_idx ON dod_sbir_topics (status);
CREATE INDEX IF NOT EXISTS dod_sbir_topics_branch_idx ON dod_sbir_topics (branch);

-- RLS: service-role only (same as the other cache tables; the app reads via the service client).
ALTER TABLE dod_sbir_topics ENABLE ROW LEVEL SECURITY;
