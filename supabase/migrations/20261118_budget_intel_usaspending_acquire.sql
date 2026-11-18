-- USASpending acquire for the existing budget tables.
-- NOT APPLIED by the session that added this file.
-- Apply only after /api/cron/sync-budget-intel is deployed:
--   npm run migrate -- --go --only 20261118_budget_intel_usaspending_acquire.sql
-- The cron row is enabled in this file, so applying it starts the 2-hour slice.
-- Upsert keys only. No deletes. No backfill.

ALTER TABLE public.agency_budget_authority
  ALTER COLUMN budget_authority TYPE numeric(20,2),
  ALTER COLUMN obligated TYPE numeric(20,2),
  ALTER COLUMN outlays TYPE numeric(20,2),
  ALTER COLUMN prior_year_authority TYPE numeric(20,2),
  ALTER COLUMN change_amount TYPE numeric(20,2),
  ALTER COLUMN change_percent TYPE numeric(12,4);

ALTER TABLE public.agency_budget_authority
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS fetched_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_key text;

ALTER TABLE public.budget_programs
  ALTER COLUMN requested_amount TYPE numeric(20,2),
  ALTER COLUMN enacted_amount TYPE numeric(20,2),
  ALTER COLUMN prior_year_amount TYPE numeric(20,2);

ALTER TABLE public.budget_programs
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS fetched_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_key text,
  ADD COLUMN IF NOT EXISTS obligated_amount numeric(20,2),
  ADD COLUMN IF NOT EXISTS gross_outlay_amount numeric(20,2),
  ADD COLUMN IF NOT EXISTS prior_year_obligated numeric(20,2),
  ADD COLUMN IF NOT EXISTS amount_basis text;

ALTER TABLE public.agency_priorities_db
  ADD COLUMN IF NOT EXISTS fetched_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_key text;

DO $$ BEGIN
  ALTER TABLE public.agency_budget_authority
    ADD CONSTRAINT agency_budget_authority_source_key_key UNIQUE (source_key);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.budget_programs
    ADD CONSTRAINT budget_programs_source_key_key UNIQUE (source_key);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.agency_priorities_db
    ADD CONSTRAINT agency_priorities_db_source_key_key UNIQUE (source_key);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.budget_intel_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table text NOT NULL CHECK (source_table IN ('budget_programs', 'agency_priorities_db', 'agency_budget_authority')),
  source_key text NOT NULL,
  target_table text NOT NULL CHECK (target_table IN ('agency_forecasts')),
  target_id uuid NOT NULL,
  link_status text NOT NULL CHECK (link_status IN ('verified', 'inferred')),
  match_basis text NOT NULL,
  evidence jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_table, source_key, target_table, target_id)
);

ALTER TABLE public.budget_intel_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS budget_intel_links_service ON public.budget_intel_links;
CREATE POLICY budget_intel_links_service ON public.budget_intel_links
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE public.budget_intel_links FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.budget_intel_links TO service_role;

INSERT INTO public.cron_jobs (job_name, route, cron_expr, timeout_ms, enabled, notes) VALUES
  ('sync-budget-intel', '/api/cron/sync-budget-intel', '17 */2 * * *', 55000, true,
   'One agency and one federal-account page per run from USASpending into agency_budget_authority, budget_programs, and agency_priorities_db. Upsert only. Apply after the route is deployed.')
ON CONFLICT (job_name) DO UPDATE SET
  route = EXCLUDED.route,
  cron_expr = EXCLUDED.cron_expr,
  timeout_ms = EXCLUDED.timeout_ms,
  enabled = EXCLUDED.enabled,
  notes = EXCLUDED.notes;
