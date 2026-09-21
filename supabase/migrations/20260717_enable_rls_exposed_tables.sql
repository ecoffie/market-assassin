-- Enable RLS on public tables that are readable with the ANON (public) key.
--
-- Security Advisor flagged "RLS Disabled in Public". A probe with the browser
-- anon key (shipped to every client) confirmed these tables are actually
-- reachable — recompete_changes / recompete_naics_sync leak contract data NOW,
-- and mcp_oauth_clients/codes/tokens are a LATENT credential leak (empty today,
-- but the grant is live, so any token written becomes world-readable).
--
-- Fix: enable RLS with NO policy. The app reads every one of these SERVER-SIDE
-- via the service_role key, which BYPASSES RLS — so server access is unchanged —
-- while anon/authenticated get default-deny. Verified: none of these tables are
-- read by the browser anon client (only `leads` + `purchases` are, and neither is
-- touched here — `leads` must stay anon-writable for the public lead form).
--
-- Idempotent: ENABLE ROW LEVEL SECURITY is a no-op if already enabled, and
-- IF EXISTS skips tables absent in an environment.

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    -- leaking data now
    'recompete_changes', 'recompete_naics_sync',
    -- latent credential leak (MCP OAuth)
    'mcp_oauth_clients', 'mcp_oauth_codes', 'mcp_oauth_tokens',
    -- user data
    'user_business_profiles', 'user_crm_connections',
    'email_change_log', 'email_provider_events', 'client_milestones',
    -- caches / reports (server-computed)
    'sam_api_cache', 'sam_sync_health', 'market_reports',
    'market_narrative_cache', 'mcp_external_cache', 'forecast_requests',
    'cron_logs',
    -- reference / mapping data (server-served)
    'naics_vocabulary', 'naics_program_mapping', 'budget_programs',
    'opengov_iq_contacts', 'opengov_iq_entities', 'opengov_iq_idiq_vehicles',
    -- migration bookkeeping
    'schema_migrations'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (
      SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END $$;

-- Verify (expect rowsecurity = true for every row):
--   SELECT tablename, rowsecurity FROM pg_tables
--   WHERE schemaname='public' AND tablename = ANY(ARRAY[
--     'recompete_changes','mcp_oauth_tokens','user_business_profiles','naics_vocabulary'])
--   ORDER BY tablename;
-- And re-probe with the anon key: recompete_changes should return [] or 401, not rows.
