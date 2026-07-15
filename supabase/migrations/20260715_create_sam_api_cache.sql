-- Create the missing sam_api_cache table.
--
-- src/lib/sam/utils.ts caches SAM/USAspending API responses here, but the table
-- did not exist — every cache write returned 404 (PGRST205) and every read
-- missed, so SAM caching has been fully broken and every call hit the live API
-- (aggravating the USAspending rate limits the snapshot crons fight). Columns
-- mirror the read/write/cleanup usage in sam/utils.ts and the sibling
-- web_intelligence_cache table.
--
-- Idempotent. Run in the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS public.sam_api_cache (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key     text NOT NULL UNIQUE,          -- upsert onConflict target
  api_type      text,
  query_params  jsonb,
  response_data jsonb,
  fetched_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz,
  hit_count     integer NOT NULL DEFAULT 0
);

-- Expiry cleanup filters on expires_at.
CREATE INDEX IF NOT EXISTS idx_sam_api_cache_expires_at
  ON public.sam_api_cache (expires_at);

-- Writes/reads are service-role only (server-side), which bypasses RLS. Enable
-- RLS with NO permissive policy so anon/authenticated get no access to cached
-- payloads. (Matches the security-advisor "RLS enabled on all public tables".)
ALTER TABLE public.sam_api_cache ENABLE ROW LEVEL SECURITY;

-- Verify:
--   SELECT to_regclass('public.sam_api_cache');            -- expect: sam_api_cache
--   SELECT relrowsecurity FROM pg_class
--   WHERE oid = 'public.sam_api_cache'::regclass;          -- expect: t
