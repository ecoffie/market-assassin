-- SAM.gov API Cache Table
-- Stores cached responses from all SAM APIs to reduce API calls and improve performance

-- Drop existing table if needed (uncomment for fresh start)
-- DROP TABLE IF EXISTS sam_api_cache;

CREATE TABLE IF NOT EXISTS sam_api_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Cache identification
  cache_key TEXT UNIQUE NOT NULL,  -- MD5 hash of api_type + query params
  api_type TEXT NOT NULL,           -- opportunities, awards, entity, subaward, hierarchy

  -- Query details
  query_params JSONB NOT NULL,

  -- Response data
  response_data JSONB NOT NULL,

  -- Timestamps
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,

  -- Stats
  hit_count INTEGER DEFAULT 0,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_sam_cache_key ON sam_api_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_sam_cache_api_type ON sam_api_cache(api_type);
CREATE INDEX IF NOT EXISTS idx_sam_cache_expires ON sam_api_cache(expires_at);

-- Index for cleanup queries
CREATE INDEX IF NOT EXISTS idx_sam_cache_expires_cleanup ON sam_api_cache(expires_at) WHERE expires_at < NOW();

-- RLS Policies
ALTER TABLE sam_api_cache ENABLE ROW LEVEL SECURITY;

-- Service role has full access (for API operations)
CREATE POLICY "sam_cache_service_role_all" ON sam_api_cache
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Allow public read (for debugging)
CREATE POLICY "sam_cache_public_select" ON sam_api_cache
  FOR SELECT
  USING (true);

-- Function to clean expired entries (call from cron)
CREATE OR REPLACE FUNCTION clean_sam_api_cache()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM sam_api_cache
  WHERE expires_at < NOW();

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Comments
COMMENT ON TABLE sam_api_cache IS 'Cache for SAM.gov API responses to reduce API calls';
COMMENT ON COLUMN sam_api_cache.cache_key IS 'MD5 hash of api_type + sorted query params';
COMMENT ON COLUMN sam_api_cache.api_type IS 'API type: opportunities, awards, entity, subaward, hierarchy';
COMMENT ON COLUMN sam_api_cache.query_params IS 'Original query parameters used';
COMMENT ON COLUMN sam_api_cache.response_data IS 'Full API response (JSON)';
COMMENT ON COLUMN sam_api_cache.expires_at IS 'When this cache entry expires (based on API-specific TTL)';
COMMENT ON COLUMN sam_api_cache.hit_count IS 'Number of times this cached entry was retrieved';
