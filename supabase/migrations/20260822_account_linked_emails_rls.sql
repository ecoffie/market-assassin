-- ============================================================================
-- account_linked_emails RLS backstop  (2026-08-22)
--
-- WHY: A live audit of pg_tables found 174/182 public tables with RLS enabled.
-- Of the 8 without it, 7 hold public federal reference data (agency budgets,
-- forecasts, award-derived statistics, a backup table). ONE holds customer data:
--
--   account_linked_emails — (owner_email, linked_email) pairs proving that a
--   signed-in user controls a second address (e.g. their Stripe checkout email).
--
-- It had NO RLS, and `anon` + `authenticated` both held SELECT (verified via
-- has_table_privilege). That is the same defect class as the vault leak closed by
-- 20260705_vault_rls_backstop.sql: application-code-only isolation with a
-- readable public key path underneath it. Small blast radius today (3 rows), but
-- the table maps a user's identities to each other — exactly the join an attacker
-- wants — and it grows with every billing-email link.
--
-- THREAT MODEL (same as the vault backstop — see that file for the full reasoning):
--   * The app reads/writes this table with the SERVICE_ROLE key, which BYPASSES
--     RLS. Enabling RLS therefore does NOT change application behavior.
--   * Users here are email-only (MI 2FA token, no auth.users row), so an
--     auth.uid()-scoped policy would match NOBODY and give false assurance.
--     The correct backstop is deny-anon/authenticated + service-role passthrough.
--
-- NET EFFECT: service_role keeps full access; anon + authenticated get ZERO rows.
--
-- SAFETY: no data change. Idempotent (DROP POLICY IF EXISTS + guarded CREATE).
-- Reversible: ALTER TABLE ... DISABLE ROW LEVEL SECURITY restores prior behavior.
--
-- VERIFY AFTER APPLYING (must return rls=true, anon=false):
--   SELECT relrowsecurity AS rls,
--          has_table_privilege('anon', oid, 'SELECT') AS anon
--   FROM pg_class WHERE relname = 'account_linked_emails';
-- ============================================================================

ALTER TABLE IF EXISTS public.account_linked_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.account_linked_emails FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "account_linked_emails_service_role_only"
    ON public.account_linked_emails;

  CREATE POLICY "account_linked_emails_service_role_only"
    ON public.account_linked_emails
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- Belt and suspenders: strip the table-level grants that made it anon-readable
-- in the first place. RLS alone would block the rows; removing the privilege
-- means the public key cannot even address the table.
DO $$ BEGIN
  REVOKE ALL ON public.account_linked_emails FROM anon, authenticated, PUBLIC;
EXCEPTION WHEN undefined_table THEN NULL; END $$;

NOTIFY pgrst, 'reload schema';
