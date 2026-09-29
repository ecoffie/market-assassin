-- Daily SEO health, OBSERVE-ONLY (route: /api/cron/seo-health, lib: src/lib/seo-health/).
--
-- Stores what the job observes about getmindy.ai's search health: its own crawl of sitemap
-- URLs, Google URL Inspection results, and Search Console section trends. It lets
-- escalation require persistence across runs (the same failure seen more than once)
-- instead of alerting on a single bad fetch.
--
-- Nothing here drives repairs. The job that writes these tables never edits the sitemap,
-- changes noindex, regenerates pages, warms caches, calls IndexNow or touches BigQuery.
--
--   seo_health_runs            one row per run: status, what was planned vs done, cursor movement
--   seo_health_url_checks      one row per URL observation (source = crawl | inspect)
--   seo_health_cursors         the rotating-sample position per stream. It advances only past
--                              URLs that were actually observed AND recorded, so a failed or
--                              timed-out run resumes where it stopped instead of skipping.
--   seo_health_section_daily   Search Console clicks/impressions per day per site section
--                              (upserted; Google revises recent days)
--
-- Idempotent. RLS enabled with NO policies + explicit REVOKE: only service_role can touch it.

CREATE TABLE IF NOT EXISTS public.seo_health_runs (
  id                     BIGSERIAL PRIMARY KEY,
  started_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at            TIMESTAMPTZ,
  status                 TEXT NOT NULL DEFAULT 'running'
                           CHECK (status IN ('running', 'ok', 'partial', 'failed')),
  population             INTEGER,                -- distinct sitemap URLs seen this run
  population_hash        TEXT,                   -- sha256 of the sorted URL list
  crawl_planned          INTEGER NOT NULL DEFAULT 0,
  crawl_done             INTEGER NOT NULL DEFAULT 0,
  crawl_cursor_start     TEXT,
  crawl_cursor_end       TEXT,
  inspect_planned        INTEGER NOT NULL DEFAULT 0,
  inspect_done           INTEGER NOT NULL DEFAULT 0,
  inspect_cursor_start   TEXT,
  inspect_cursor_end     TEXT,
  summary                JSONB NOT NULL DEFAULT '{}'::jsonb,
  escalations            JSONB NOT NULL DEFAULT '[]'::jsonb,
  slack_state            TEXT CHECK (slack_state IS NULL OR slack_state IN ('posted', 'failed', 'skipped')),
  error                  TEXT
);

CREATE INDEX IF NOT EXISTS seo_health_runs_started_idx ON public.seo_health_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS public.seo_health_url_checks (
  id           BIGSERIAL PRIMARY KEY,
  run_id       BIGINT NOT NULL REFERENCES public.seo_health_runs (id) ON DELETE CASCADE,
  url          TEXT NOT NULL,
  section      TEXT NOT NULL,
  source       TEXT NOT NULL CHECK (source IN ('crawl', 'inspect')),
  outcome      TEXT NOT NULL CHECK (outcome IN (
                 -- our side (crawl)
                 'ok', 'transport_failure', 'http_5xx', 'http_404', 'http_4xx', 'redirect',
                 'noindex', 'canonical_mismatch', 'empty_content',
                 -- Google's decision (inspect)
                 'indexed', 'crawled_not_indexed', 'discovered_not_indexed', 'excluded_noindex',
                 'not_found', 'soft_404', 'google_canonical_differs', 'blocked_robots',
                 'other', 'inspection_error'
               )),
  http_status  INTEGER,
  latency_ms   INTEGER,
  detail       JSONB NOT NULL DEFAULT '{}'::jsonb,
  checked_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS seo_health_url_checks_url_idx
  ON public.seo_health_url_checks (url, source, checked_at DESC);
CREATE INDEX IF NOT EXISTS seo_health_url_checks_run_idx
  ON public.seo_health_url_checks (run_id);

CREATE TABLE IF NOT EXISTS public.seo_health_cursors (
  stream          TEXT PRIMARY KEY CHECK (stream IN ('crawl', 'inspect')),
  last_url        TEXT,                -- last URL observed+recorded; NULL = start of list
  cycle           INTEGER NOT NULL DEFAULT 0,  -- completed passes over the population
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_run  BIGINT REFERENCES public.seo_health_runs (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.seo_health_section_daily (
  day          DATE NOT NULL,
  section      TEXT NOT NULL,
  clicks       INTEGER NOT NULL DEFAULT 0,
  impressions  INTEGER NOT NULL DEFAULT 0,
  pages        INTEGER NOT NULL DEFAULT 0,      -- distinct pages with any impressions that day
  fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (day, section)
);

ALTER TABLE public.seo_health_runs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_health_url_checks    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_health_cursors       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_health_section_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seo_health_runs, public.seo_health_url_checks,
              public.seo_health_cursors, public.seo_health_section_daily
  FROM anon, authenticated;
