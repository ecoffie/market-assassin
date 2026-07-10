-- ════════════════════════════════════════════════════════════════════════════
-- SECURITY (P4): close the anon-read exposure on ALL public tables.
--
-- FINDING (2026-07-10): all 127 public tables were readable by the browser-shipped
-- anon key (NEXT_PUBLIC_SUPABASE_ANON_KEY) — a live PII/payment-data leak
-- (purchases, stripe_*, user_profiles, contacts, leads, audit_log, ...). Supabase
-- Advisor flagged 54; the real number was every table.
--
-- WHY THIS IS SAFE: the app reads Supabase ONLY via the service-role key (287 API
-- routes, server-side). 0 client files use the anon key for table reads. The
-- service_role BYPASSES RLS, so enabling RLS + a service_role policy closes the
-- anon leak WITHOUT breaking the app.
--
-- This does three things per public table:
--   1. ENABLE + FORCE row level security
--   2. add a service_role-only ALL policy (so the app keeps full access)
--   3. REVOKE table privileges from anon + authenticated (defense-in-depth)
--
-- Idempotent: re-runnable. Hand-run in Supabase SQL Editor (this DB has no in-app
-- DDL). Verify with the anon probe afterward (see tasks note).
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.relname AS tbl
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'          -- ordinary tables only (not views/matviews)
  LOOP
    -- 1. Enable + force RLS (FORCE also applies RLS to the table owner).
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', r.tbl);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', r.tbl);

    -- 2. Service-role full access (the app's server-side key). Drop-then-create
    --    so the policy definition is deterministic on re-run.
    EXECUTE format('DROP POLICY IF EXISTS service_role_full_access ON public.%I;', r.tbl);
    EXECUTE format(
      'CREATE POLICY service_role_full_access ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true);',
      r.tbl
    );

    -- 3. Defense-in-depth: strip privileges from the public/anon/authenticated
    --    roles so even a future missing policy can't leak.
    EXECUTE format('REVOKE ALL ON public.%I FROM anon;', r.tbl);
    EXECUTE format('REVOKE ALL ON public.%I FROM authenticated;', r.tbl);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC;', r.tbl);
  END LOOP;
END $$;

-- Belt-and-suspenders at the schema level too (blocks NEW tables from inheriting
-- broad grants via default privileges already granted to these roles).
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
