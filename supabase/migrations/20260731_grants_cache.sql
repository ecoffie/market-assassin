-- Grants cache: STORE Grants.gov opportunities so the Grants layer of the Opportunities map is a
-- first-class map source (fast, bbox-queryable) instead of a live per-pan API call. (Eric 2026-07-31,
-- "store the grants" — Option 1.)
--
-- WHY store: grants live only at Grants.gov (searchGrants hits the live API). A live call on every
-- map pan would be slow + rate-limited, and grants have NO place of performance, so "grants in this
-- viewport" is meaningless live. Storing them (via scripts/ingest-grants.ts) + pinning at the
-- AWARDING AGENCY's HQ (the SBIR precedent — honestly flagged "agency HQ · approximate") makes them
-- behave like SAM/DIBBS/forecasts: an indexed table the map bbox-queries.
--
-- Location: derived from agencyCode's DEPARTMENT prefix → HQ city (DOS/HHS/USDA/… → DC; NSF →
-- Alexandria, etc.), geocoded to real coords + jittered. NEVER a fabricated lat/lng.
--
-- Hand-run in the Supabase SQL editor (no in-app DDL). Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS public.grants_cache (
  opp_number       text PRIMARY KEY,          -- Grants.gov opportunity number (the natural key)
  title            text,
  agency           text,                       -- full sub-bureau name ("Centers for Disease Control - NCEZID")
  agency_code      text,                       -- "DOS-BIH" etc. (department prefix drives the HQ)
  description      text,
  award_ceiling    bigint,                     -- may be NULL (Grants.gov often omits it → pin shows a dot, no $)
  posted_date      date,
  close_date       date,
  status           text,
  cfda_list        text[],
  url              text,
  -- map coords, derived from the agency-code department prefix → HQ city (agency HQ · approximate)
  map_lat          double precision,
  map_lng          double precision,
  map_loc_source   text,                       -- 'agency_hq' (all grants — never a real place of performance)
  scraped_at       timestamptz DEFAULT now(),
  synced_at        timestamptz DEFAULT now()
);

-- Bbox index for the viewport query, mirroring dibbs_rfqs / agency_forecasts.
CREATE INDEX IF NOT EXISTS grants_cache_map_bbox_idx
  ON public.grants_cache (map_lat, map_lng)
  WHERE map_lat IS NOT NULL;

-- Close-date index for "open grants only" filtering (posted grants past their close_date are noise).
CREATE INDEX IF NOT EXISTS grants_cache_close_date_idx
  ON public.grants_cache (close_date);

-- RLS: service-role only (the map route reads with the service key; no public direct access).
ALTER TABLE public.grants_cache ENABLE ROW LEVEL SECURITY;

-- Verify:
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'grants_cache';
--   SELECT indexname FROM pg_indexes WHERE tablename = 'grants_cache';
