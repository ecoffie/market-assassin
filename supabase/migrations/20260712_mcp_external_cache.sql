-- MCP external-source response cache (EDGAR / Federal Register / CALC promotion).
--
-- A single shared table so the standalone Mindy MCP server (stdio transport, no
-- Next runtime) can cache keyless external API responses with per-api-type TTLs.
-- Cache-first: a warm hit skips the upstream call entirely (CALC alone fires
-- 20-180 upstream calls per fetchPricingIntel, so this is real money/latency).
--
-- Idempotent — safe to re-run. Eric pastes this into the Supabase SQL editor by
-- hand (per the CLAUDE.md migration hand-off protocol). Verify live after:
--   select count(*) from mcp_external_cache;
-- (the first cached MCP call writes a row).

CREATE TABLE IF NOT EXISTS mcp_external_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key text UNIQUE NOT NULL,          -- md5(api_type + sorted params)
  api_type text NOT NULL,                   -- 'edgar:companyfacts' | 'fedreg:documents' | 'calc:pricing'
  query_params jsonb,                       -- the params that produced this row
  response_data jsonb NOT NULL,             -- the cached upstream payload
  fetched_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,          -- per-row TTL; expired rows are treated as misses
  hit_count bigint NOT NULL DEFAULT 0       -- analytics placeholder (not yet bumped on read)
);

CREATE INDEX IF NOT EXISTS mcp_external_cache_api_type_idx ON mcp_external_cache (api_type);
CREATE INDEX IF NOT EXISTS mcp_external_cache_expires_idx ON mcp_external_cache (expires_at);

-- Internal cache only — never expose publicly. The service role bypasses RLS,
-- so the policy is belt-and-suspenders; no anon/public read is granted.
ALTER TABLE mcp_external_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mcp_external_cache service_role full" ON mcp_external_cache;
CREATE POLICY "mcp_external_cache service_role full" ON mcp_external_cache
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE mcp_external_cache IS
  'Short-TTL response cache for keyless external APIs called by the Mindy MCP server (EDGAR, Federal Register, CALC). Shared across tools; per-row expires_at drives TTL. Populated by src/lib/mcp/external-cache.ts. Service-role only.';