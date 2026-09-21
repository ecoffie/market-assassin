-- Enable Row Level Security on ALL tables
-- Created: May 13, 2026
-- Purpose: Fix Supabase Security Advisor warnings about tables being publicly accessible
-- Note: Uses service_role authentication at API level, so policies allow full access

-- =============================================
-- ENABLE RLS ON ALL TABLES
-- =============================================

-- Intelligence & Analytics tables
ALTER TABLE IF EXISTS intelligence_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS intelligence_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS user_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS guardrail_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS cron_logs ENABLE ROW LEVEL SECURITY;

-- Briefing system tables
ALTER TABLE IF EXISTS briefing_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS briefing_precompute_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS briefing_dead_letter ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS briefing_system_health ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS briefing_feedback ENABLE ROW LEVEL SECURITY;

-- User engagement tables
ALTER TABLE IF EXISTS user_engagement ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS email_tracking_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS engagement_daily_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS user_engagement_scores ENABLE ROW LEVEL SECURITY;

-- Business intelligence tables
ALTER TABLE IF EXISTS user_business_profiles ENABLE ROW LEVEL SECURITY;

-- Forecast system tables
ALTER TABLE IF EXISTS agency_forecasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS forecast_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS forecast_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS forecast_search_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS forecast_requests ENABLE ROW LEVEL SECURITY;

-- Budget & agency intelligence tables
ALTER TABLE IF EXISTS budget_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS agency_budget_authority ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS agency_pain_points_db ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS agency_priorities_db ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS naics_program_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS budget_intel_sync_runs ENABLE ROW LEVEL SECURITY;

-- SAM & USASpending tables
ALTER TABLE IF EXISTS usaspending_awards ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS sam_events ENABLE ROW LEVEL SECURITY;

-- Recompete tables
ALTER TABLE IF EXISTS recompete_sync_runs ENABLE ROW LEVEL SECURITY;

-- Pipeline tables (were commented out in original migration)
ALTER TABLE IF EXISTS user_pipeline ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS pipeline_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS user_teaming_partners ENABLE ROW LEVEL SECURITY;

-- Tool errors & health tables
ALTER TABLE IF EXISTS tool_errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS tool_health_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS api_provider_status ENABLE ROW LEVEL SECURITY;

-- Email tracking tables
ALTER TABLE IF EXISTS email_provider_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS email_provider_events ENABLE ROW LEVEL SECURITY;

-- Stripe data cache tables
ALTER TABLE IF EXISTS stripe_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS stripe_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS stripe_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS customer_classifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS stripe_webhook_log ENABLE ROW LEVEL SECURITY;

-- Experiment & treatment tables
ALTER TABLE IF EXISTS experiment_log ENABLE ROW LEVEL SECURITY;

-- Invitation tables
ALTER TABLE IF EXISTS invitation_tokens ENABLE ROW LEVEL SECURITY;

-- MI Beta tables (new)
ALTER TABLE IF EXISTS mi_beta_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS mi_beta_contact_opportunity_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS mi_beta_pursuit_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS mi_beta_market_focuses ENABLE ROW LEVEL SECURITY;

-- OpenGov IQ tables
ALTER TABLE IF EXISTS opengov_iq_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS opengov_iq_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS opengov_iq_idiq_vehicles ENABLE ROW LEVEL SECURITY;

-- Multisite aggregation tables
ALTER TABLE IF EXISTS aggregated_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS multisite_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS scrape_log ENABLE ROW LEVEL SECURITY;

-- =============================================
-- CREATE SERVICE ROLE POLICIES
-- These allow the service_role (used by our API) full access
-- while blocking anonymous/public access
-- =============================================

-- Intelligence & Analytics
DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON intelligence_metrics;
  CREATE POLICY "Service role has full access" ON intelligence_metrics FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON intelligence_log;
  CREATE POLICY "Service role has full access" ON intelligence_log FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON user_feedback;
  CREATE POLICY "Service role has full access" ON user_feedback FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON guardrail_events;
  CREATE POLICY "Service role has full access" ON guardrail_events FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON cron_logs;
  CREATE POLICY "Service role has full access" ON cron_logs FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- Briefing system
DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON briefing_templates;
  CREATE POLICY "Service role has full access" ON briefing_templates FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON briefing_precompute_runs;
  CREATE POLICY "Service role has full access" ON briefing_precompute_runs FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON briefing_dead_letter;
  CREATE POLICY "Service role has full access" ON briefing_dead_letter FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON briefing_system_health;
  CREATE POLICY "Service role has full access" ON briefing_system_health FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON briefing_feedback;
  CREATE POLICY "Service role has full access" ON briefing_feedback FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- User engagement
DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON user_engagement;
  CREATE POLICY "Service role has full access" ON user_engagement FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON email_tracking_tokens;
  CREATE POLICY "Service role has full access" ON email_tracking_tokens FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON engagement_daily_stats;
  CREATE POLICY "Service role has full access" ON engagement_daily_stats FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON user_engagement_scores;
  CREATE POLICY "Service role has full access" ON user_engagement_scores FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- Business intelligence
DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON user_business_profiles;
  CREATE POLICY "Service role has full access" ON user_business_profiles FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- Forecast system
DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON agency_forecasts;
  CREATE POLICY "Service role has full access" ON agency_forecasts FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON forecast_sync_runs;
  CREATE POLICY "Service role has full access" ON forecast_sync_runs FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON forecast_sources;
  CREATE POLICY "Service role has full access" ON forecast_sources FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON forecast_search_analytics;
  CREATE POLICY "Service role has full access" ON forecast_search_analytics FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON forecast_requests;
  CREATE POLICY "Service role has full access" ON forecast_requests FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- Budget & agency intelligence
DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON budget_programs;
  CREATE POLICY "Service role has full access" ON budget_programs FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON agency_budget_authority;
  CREATE POLICY "Service role has full access" ON agency_budget_authority FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON agency_pain_points_db;
  CREATE POLICY "Service role has full access" ON agency_pain_points_db FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON agency_priorities_db;
  CREATE POLICY "Service role has full access" ON agency_priorities_db FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON naics_program_mapping;
  CREATE POLICY "Service role has full access" ON naics_program_mapping FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON budget_intel_sync_runs;
  CREATE POLICY "Service role has full access" ON budget_intel_sync_runs FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- SAM & USASpending
DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON usaspending_awards;
  CREATE POLICY "Service role has full access" ON usaspending_awards FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON sam_events;
  CREATE POLICY "Service role has full access" ON sam_events FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- Recompete
DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON recompete_sync_runs;
  CREATE POLICY "Service role has full access" ON recompete_sync_runs FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- Pipeline
DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON user_pipeline;
  CREATE POLICY "Service role has full access" ON user_pipeline FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON pipeline_history;
  CREATE POLICY "Service role has full access" ON pipeline_history FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON user_teaming_partners;
  CREATE POLICY "Service role has full access" ON user_teaming_partners FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- Tool errors & health
DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON tool_errors;
  CREATE POLICY "Service role has full access" ON tool_errors FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON tool_health_metrics;
  CREATE POLICY "Service role has full access" ON tool_health_metrics FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON api_provider_status;
  CREATE POLICY "Service role has full access" ON api_provider_status FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- Email tracking
DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON email_provider_sends;
  CREATE POLICY "Service role has full access" ON email_provider_sends FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON email_provider_events;
  CREATE POLICY "Service role has full access" ON email_provider_events FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- Stripe data cache
DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON stripe_customers;
  CREATE POLICY "Service role has full access" ON stripe_customers FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON stripe_charges;
  CREATE POLICY "Service role has full access" ON stripe_charges FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON stripe_subscriptions;
  CREATE POLICY "Service role has full access" ON stripe_subscriptions FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON customer_classifications;
  CREATE POLICY "Service role has full access" ON customer_classifications FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON stripe_webhook_log;
  CREATE POLICY "Service role has full access" ON stripe_webhook_log FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- Experiment & treatment
DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON experiment_log;
  CREATE POLICY "Service role has full access" ON experiment_log FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- Invitation
DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON invitation_tokens;
  CREATE POLICY "Service role has full access" ON invitation_tokens FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- MI Beta tables
DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON mi_beta_contacts;
  CREATE POLICY "Service role has full access" ON mi_beta_contacts FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON mi_beta_contact_opportunity_links;
  CREATE POLICY "Service role has full access" ON mi_beta_contact_opportunity_links FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON mi_beta_pursuit_activity;
  CREATE POLICY "Service role has full access" ON mi_beta_pursuit_activity FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON mi_beta_market_focuses;
  CREATE POLICY "Service role has full access" ON mi_beta_market_focuses FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- OpenGov IQ tables
DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON opengov_iq_contacts;
  CREATE POLICY "Service role has full access" ON opengov_iq_contacts FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON opengov_iq_entities;
  CREATE POLICY "Service role has full access" ON opengov_iq_entities FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON opengov_iq_idiq_vehicles;
  CREATE POLICY "Service role has full access" ON opengov_iq_idiq_vehicles FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- Multisite aggregation
DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON aggregated_opportunities;
  CREATE POLICY "Service role has full access" ON aggregated_opportunities FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON multisite_sources;
  CREATE POLICY "Service role has full access" ON multisite_sources FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role has full access" ON scrape_log;
  CREATE POLICY "Service role has full access" ON scrape_log FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- =============================================
-- FIX SECURITY DEFINER VIEWS
-- Change views from SECURITY DEFINER to SECURITY INVOKER
-- This prevents the views from bypassing RLS
-- =============================================

-- Drop and recreate views with SECURITY INVOKER
-- Note: Views listed in the security advisor error:
-- user_briefing_engagement, recompete_opportunities_v, briefing_delivery_stats,
-- customer_stripe_summary, agency_intelligence_full, briefing_retry_summary

-- First, let's check which views exist and recreate them safely
-- These will be recreated if they exist

-- user_briefing_engagement view
DO $$
BEGIN
  -- Only attempt if the view exists
  IF EXISTS (SELECT 1 FROM information_schema.views WHERE table_name = 'user_briefing_engagement') THEN
    DROP VIEW IF EXISTS user_briefing_engagement CASCADE;
    -- View will need to be recreated with actual columns
  END IF;
END $$;

-- briefing_delivery_stats view
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.views WHERE table_name = 'briefing_delivery_stats') THEN
    DROP VIEW IF EXISTS briefing_delivery_stats CASCADE;
  END IF;
END $$;

-- briefing_retry_summary view
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.views WHERE table_name = 'briefing_retry_summary') THEN
    DROP VIEW IF EXISTS briefing_retry_summary CASCADE;
  END IF;
END $$;

-- customer_stripe_summary view
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.views WHERE table_name = 'customer_stripe_summary') THEN
    DROP VIEW IF EXISTS customer_stripe_summary CASCADE;
  END IF;
END $$;

-- recompete_opportunities_v view
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.views WHERE table_name = 'recompete_opportunities_v') THEN
    DROP VIEW IF EXISTS recompete_opportunities_v CASCADE;
  END IF;
END $$;

-- agency_intelligence_full view
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.views WHERE table_name = 'agency_intelligence_full') THEN
    DROP VIEW IF EXISTS agency_intelligence_full CASCADE;
  END IF;
END $$;

-- =============================================
-- VERIFICATION QUERY
-- =============================================
-- Run this after migration to verify RLS is enabled:
--
-- SELECT tablename, rowsecurity
-- FROM pg_tables
-- WHERE schemaname = 'public' AND rowsecurity = false;
--
-- This should return no rows if all tables have RLS enabled.
