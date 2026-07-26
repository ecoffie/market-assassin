-- Discover Panel Cache — precompute store for the two Mindy landing "Discover" panels
-- (NAICS Leaderboard + Underserved markets). Built by /api/cron/build-discover-panels
-- from live USASpending; the page reads cheap from here (never a per-page-load API call).
--
-- GROUNDED: `data` holds only real USASpending-derived rows (3-FY contract spend, real
-- FY-over-FY rank movement, real top-5 recipient concentration). No fabricated numbers.

CREATE TABLE IF NOT EXISTS discover_panel_cache (
  panel     text        PRIMARY KEY,               -- 'naics_leaderboard' | 'underserved'
  data      jsonb       NOT NULL,                  -- the precomputed rows for that panel
  built_at  timestamptz NOT NULL DEFAULT now()
);

-- Service-role only — the cron writes, server components read via the service client.
ALTER TABLE discover_panel_cache ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'discover_panel_cache'
      AND policyname = 'discover_panel_cache_service_role'
  ) THEN
    CREATE POLICY discover_panel_cache_service_role
      ON discover_panel_cache
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
