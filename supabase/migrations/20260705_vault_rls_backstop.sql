-- ============================================================================
-- Vault RLS backstop  (2026-07-05)  — Data Trust Layer Phase 1.3
--
-- WHY: The 5 vault tables hold the most sensitive customer PII (EIN, CAGE,
-- security clearances, contract references, resume text). The 2026-07-05 audit
-- found they have ZERO row-level security — isolation is enforced ONLY in
-- application code (`.eq('user_email', auth.email)` on every route). A single
-- dropped filter or an auth bypass = full cross-tenant read, with NO database
-- backstop. This migration adds that backstop.
--
-- THREAT MODEL FOR THIS ARCHITECTURE (why the policy looks the way it does):
--   * Every vault route uses the SERVICE_ROLE key, which BYPASSES RLS entirely
--     (verified: all 20+ vault-touching files use SUPABASE_SERVICE_ROLE_KEY).
--     So enabling RLS does NOT break the app — legit server paths are unaffected.
--   * NOTHING queries the vault as the `anon` or `authenticated` role (verified:
--     no browser/anon-key client references any vault table).
--   * Vault owners are EMAIL-ONLY users — they authenticate via the MI 2FA token,
--     NOT a Supabase Auth session. Verified: all 32 vault owners have NO row in
--     auth.users. Therefore an `auth.uid()`-scoped policy would match NOBODY and
--     give a false sense of security. The correct backstop here is DENY-by-default
--     for anon/authenticated: if the vault is ever accidentally exposed through the
--     public/anon key (the leak scenario RLS exists to stop), the DB refuses it.
--
-- NET EFFECT: service_role (the app) keeps full access; anon + authenticated get
-- ZERO rows. This is the real defense-in-depth the `coach_mode_tenancy` decision
-- called for ("RLS as the enforcement backstop"), done correctly for this DB
-- rather than a permissive USING(true) placeholder.
--
-- SAFETY: no data change; enabling RLS + adding policies only. Idempotent
-- (DROP POLICY IF EXISTS + guarded CREATE). Reversible: DISABLE ROW LEVEL
-- SECURITY per table restores prior behavior.
-- ============================================================================

DO $$
DECLARE
  t text;
  vault_tables text[] := ARRAY[
    'user_identity_profile',
    'user_past_performance',
    'user_capabilities_library',
    'user_team_members',
    'user_boilerplate_docs'
  ];
BEGIN
  FOREACH t IN ARRAY vault_tables LOOP
    -- Enable RLS (no-op if already enabled).
    EXECUTE format('ALTER TABLE IF EXISTS public.%I ENABLE ROW LEVEL SECURITY;', t);
    -- Force RLS even for the table owner role, so a non-service connection can't
    -- slip past it. (service_role still bypasses — that is intended.)
    EXECUTE format('ALTER TABLE IF EXISTS public.%I FORCE ROW LEVEL SECURITY;', t);

    -- Remove any prior permissive placeholder policy (the USING(true) pattern the
    -- audit flagged elsewhere) so it can't leave the door open.
    EXECUTE format('DROP POLICY IF EXISTS "Service role has full access" ON public.%I;', t);
    EXECUTE format('DROP POLICY IF EXISTS "vault_owner_or_service" ON public.%I;', t);
    EXECUTE format('DROP POLICY IF EXISTS "vault_deny_anon" ON public.%I;', t);

    -- The ONLY policy: allow the service_role, deny everyone else. Because RLS is
    -- enabled, the absence of a permissive policy for anon/authenticated already
    -- denies them; this explicit policy documents intent and covers FORCE mode.
    EXECUTE format($f$
      CREATE POLICY "vault_service_role_only" ON public.%I
        FOR ALL
        TO service_role
        USING (true)
        WITH CHECK (true);
    $f$, t);
  END LOOP;
END $$;

-- Verify (each table: rls enabled = true, exactly one service_role policy):
--   SELECT relname, relrowsecurity, relforcerowsecurity
--     FROM pg_class WHERE relname = ANY(ARRAY[
--       'user_identity_profile','user_past_performance',
--       'user_capabilities_library','user_team_members','user_boilerplate_docs']);
--   SELECT tablename, policyname, roles FROM pg_policies
--     WHERE tablename LIKE 'user_%' AND policyname = 'vault_service_role_only';
