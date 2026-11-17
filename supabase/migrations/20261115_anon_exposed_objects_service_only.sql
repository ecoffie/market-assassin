-- Least privilege for 9 RLS-disabled tables and 8 definer views that the public anon key could reach.
-- Every application caller uses the service-role key (verified 2026-11-15), so this changes no app behaviour.
-- Same pattern as 20261115_purchases_view_service_only.sql. Idempotent: REVOKE/GRANT can be re-run safely.
-- Rollback: 20261115_anon_exposed_objects_service_only.ROLLBACK.sql (restores the exact prior ACLs).

DO $$
DECLARE
  obj text;
  tables text[] := ARRAY[
    'agency_budget_authority','agency_forecasts_backup_20260804_nsf','agency_pain_points_db','agency_priorities_db',
    'budget_intel_sync_runs','contractor_capability_profiles','decision_makers_sync_state','forecast_search_analytics',
    'ops_alert_state'];
  views text[] := ARRAY[
    'agency_budget_intel','naics_budget_opportunities','forecast_coverage_gaps','dodaac_directory_display',
    'decision_maker_identities','decision_maker_roles','agency_intelligence_agency_safe','agency_intelligence_attribution'];
BEGIN
  FOREACH obj IN ARRAY tables LOOP
    IF to_regclass('public.' || quote_ident(obj)) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', obj);
      EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', obj);
    END IF;
  END LOOP;
  FOREACH obj IN ARRAY views LOOP
    IF to_regclass('public.' || quote_ident(obj)) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', obj);
      EXECUTE format('GRANT SELECT ON TABLE public.%I TO service_role', obj);
    END IF;
  END LOOP;
END $$;
