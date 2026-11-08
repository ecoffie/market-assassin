-- Contractor job postings — the raw material for "who's hiring" intelligence.
--
-- Two public sources, both previously fetched LIVE (1h cache, nothing stored) by the
-- govcongiants.com /jobs board:
--   jsearch  — private-sector postings aggregated from LinkedIn / Indeed / Glassdoor / ZipRecruiter
--   usajobs  — federal agency postings (who is staffing up to BUY: contract specialists etc.)
--
-- Stored so the history exists: first_seen_at / last_seen_at give the 30-day trend, how long a
-- role has stayed open, and whether it keeps coming back. A cached API response can't answer
-- any of those. One row per posting; the daily sync upserts on id.
--
-- first_seen_at is set ONLY on insert: the sync never sends it, so an upsert that hits an
-- existing row leaves it untouched. last_seen_at moves every time a sync sees the posting.
--
-- recipient_uei is filled by a later matching pass (exact normalized name -> UEI). NULL means
-- "not matched", never "not a contractor".

CREATE TABLE IF NOT EXISTS contractor_job_postings (
  id                   text PRIMARY KEY,            -- '<source>:<source_job_id>'
  source               text NOT NULL CHECK (source IN ('jsearch', 'usajobs')),
  source_job_id        text NOT NULL,
  title                text NOT NULL,
  employer_name        text NOT NULL,
  employer_norm        text NOT NULL,               -- lowercased, punctuation + Inc/LLC/Corp stripped
  recipient_uei        text,                        -- matched later; NULL = not matched
  department           text,                        -- usajobs: parent department
  city                 text,
  state                text,                        -- 2-letter when known
  remote               boolean NOT NULL DEFAULT false,
  clearance            text,                        -- 'TS/SCI' | 'Top Secret' | 'Secret' | 'Public Trust' | NULL (not stated)
  contingent_on_award  boolean NOT NULL DEFAULT false, -- posting says it depends on winning a contract
  salary_min           numeric,
  salary_max           numeric,
  posted_at            timestamptz,
  expires_at           timestamptz,
  apply_url            text,
  description          text,                        -- first 4,000 chars
  search_query         text,                        -- the query that found it (provenance)
  first_seen_at        timestamptz NOT NULL DEFAULT now(),
  last_seen_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cjp_employer_norm ON contractor_job_postings (employer_norm);
CREATE INDEX IF NOT EXISTS idx_cjp_uei          ON contractor_job_postings (recipient_uei) WHERE recipient_uei IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cjp_state        ON contractor_job_postings (state);
CREATE INDEX IF NOT EXISTS idx_cjp_last_seen    ON contractor_job_postings (last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_cjp_first_seen   ON contractor_job_postings (first_seen_at DESC);

ALTER TABLE contractor_job_postings ENABLE ROW LEVEL SECURITY;
-- Service-role only (no policies). Pages read through server routes.
