-- Coach Mode / org tables — RLS in line with the rest of this DB.
--
-- IMPORTANT — read before assuming this "isolates orgs": in this codebase RLS is
-- NOT the cross-tenant isolation mechanism. Every app query uses the SERVICE-ROLE
-- key (which BYPASSES RLS), and cross-org / cross-workspace isolation is enforced
-- in APPLICATION CODE (the org_id / assigned_coach / workspace_id filters in the
-- coach route + the workspace-scoped API surfaces). See migration
-- 20260513_enable_rls_all_tables.sql: the policy pattern is "service_role full
-- access, block anonymous/public" — matching that here keeps the new coach tables
-- consistent (and closes the Supabase Security Advisor "table publicly accessible"
-- gap) WITHOUT changing how the app reads/writes.
--
-- Belt-and-suspenders isolation (memory coach_mode_tenancy): the real guarantee is
-- the app-level scoping audit; RLS here blocks a stray anon-key path from reading
-- org data at all.
--
-- Hand-run in the Supabase SQL editor, then it NOTIFYs pgrst.

ALTER TABLE IF EXISTS organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS org_members   ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS org_clients   ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS org_news      ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON organizations;
  CREATE POLICY "Service role has full access" ON organizations FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON org_members;
  CREATE POLICY "Service role has full access" ON org_members FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON org_clients;
  CREATE POLICY "Service role has full access" ON org_clients FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON org_news;
  CREATE POLICY "Service role has full access" ON org_news FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

NOTIFY pgrst, 'reload schema';

-- Verify after running:
--   SELECT tablename, rowsecurity FROM pg_tables
--   WHERE schemaname='public' AND tablename IN
--     ('organizations','org_members','org_clients','org_news');
--   -> rowsecurity = true for all four.
