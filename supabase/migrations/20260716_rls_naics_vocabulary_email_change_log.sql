-- ============================================================================
-- RLS backstop: naics_vocabulary + email_change_log  (2026-07-16)
--
-- WHY: The Supabase Advisor flags both tables CRITICAL — "RLS Disabled in
-- Public". They are the only two public tables added since the 2026-07-05 vault
-- backstop that never got the same treatment:
--   * naics_vocabulary  (20260711) — buyer vocabulary mined from award text.
--   * email_change_log  (20260713) — email-change AUDIT trail. This one matters:
--     it holds old/new email pairs, IP + user-agent, and verify_token_hash.
--     A change-email flow is an account-takeover vector, so an exposed log is
--     both a PII leak and a roadmap for one.
--
-- THREAT MODEL (same as 20260705_vault_rls_backstop — verified again here):
--   * Every read/write path uses SUPABASE_SERVICE_ROLE_KEY, which BYPASSES RLS.
--     Verified callers: src/lib/market/vocabulary.ts (naics_vocabulary),
--     src/app/api/app/change-email/{request,confirm}/route.ts and
--     src/lib/mindy/rekey-account-email.ts (email_change_log). Enabling RLS does
--     NOT break the app.
--   * NOTHING queries either table with the anon key. The .tsx references in
--     onboarding/RecompetesPanel/ForecastsPanel are COMMENTS — those components
--     call /api/app/naics-vocabulary, which reads server-side. Verified 2026-07-16.
--   * /api/app/naics-vocabulary is intentionally unauthenticated, but it is a
--     SERVER route holding the service key — the browser never touches the table.
--     So "public data" does not require a public GRANT.
--   * Mindy users are email-only (no auth.users row), so an auth.uid()-scoped
--     policy would match nobody and give false assurance. Correct backstop here
--     is DENY-by-default for anon/authenticated.
--
-- NET EFFECT: service_role (the app) keeps full access; anon + authenticated get
-- ZERO rows. Clears both CRITICAL advisors.
--
-- SAFETY: no data change; enables RLS + adds one policy per table. Idempotent
-- (DROP POLICY IF EXISTS + guarded CREATE). Reversible:
--   ALTER TABLE public.<t> DISABLE ROW LEVEL SECURITY;
-- Run in the Supabase SQL editor (CLAUDE.md migration hand-off protocol).
-- ============================================================================

DO $$
DECLARE
  t text;
  target_tables text[] := ARRAY[
    'naics_vocabulary',
    'email_change_log'
  ];
BEGIN
  FOREACH t IN ARRAY target_tables LOOP
    -- Enable RLS (no-op if already enabled).
    EXECUTE format('ALTER TABLE IF EXISTS public.%I ENABLE ROW LEVEL SECURITY;', t);
    -- Force RLS even for the table owner, so a non-service connection can't slip
    -- past it. (service_role still bypasses — that is intended.)
    EXECUTE format('ALTER TABLE IF EXISTS public.%I FORCE ROW LEVEL SECURITY;', t);

    -- Clear any prior permissive placeholder (the USING(true)-for-everyone
    -- pattern the 2026-07-05 audit flagged) so it can't leave the door open.
    EXECUTE format('DROP POLICY IF EXISTS "Service role has full access" ON public.%I;', t);
    EXECUTE format('DROP POLICY IF EXISTS "Enable read access for all users" ON public.%I;', t);
    EXECUTE format('DROP POLICY IF EXISTS "service_role_only" ON public.%I;', t);

    -- The ONLY policy: allow service_role, deny everyone else. RLS-enabled with
    -- no permissive policy for anon/authenticated already denies them; this
    -- documents intent and covers FORCE mode.
    EXECUTE format($f$
      CREATE POLICY "service_role_only" ON public.%I
        FOR ALL
        TO service_role
        USING (true)
        WITH CHECK (true);
    $f$, t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Verify (expect: relrowsecurity = t, relforcerowsecurity = t, one policy each)
--
--   SELECT relname, relrowsecurity, relforcerowsecurity
--     FROM pg_class
--    WHERE relname IN ('naics_vocabulary','email_change_log');
--
--   SELECT tablename, policyname, roles, cmd
--     FROM pg_policies
--    WHERE tablename IN ('naics_vocabulary','email_change_log');
--
-- Then re-run the Advisor — both CRITICAL "RLS Disabled in Public" issues clear.
-- App-level smoke test (must still return terms):
--   curl -s '<APP_URL>/api/app/naics-vocabulary?codes=561730' | head -c 200
-- ---------------------------------------------------------------------------
