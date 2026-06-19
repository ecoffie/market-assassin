import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const mode = searchParams.get('mode') || 'preview';

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return NextResponse.json(
      { success: false, error: 'Supabase is not configured' },
      { status: 500 }
    );
  }

  // List of all tables that need RLS enabled
  const tables = [
    // Intelligence & Analytics
    'intelligence_metrics', 'intelligence_log', 'user_feedback', 'guardrail_events', 'cron_logs',
    // Briefing system
    'briefing_templates', 'briefing_precompute_runs', 'briefing_dead_letter',
    'briefing_system_health', 'briefing_feedback',
    // User engagement
    'user_engagement', 'email_tracking_tokens', 'engagement_daily_stats', 'user_engagement_scores',
    // Business intelligence
    'user_business_profiles',
    // Forecast system
    'agency_forecasts', 'forecast_sync_runs', 'forecast_sources',
    'forecast_search_analytics', 'forecast_requests',
    // Budget & agency intelligence
    'budget_programs', 'agency_budget_authority', 'agency_pain_points_db',
    'agency_priorities_db', 'naics_program_mapping', 'budget_intel_sync_runs',
    // SAM & USASpending
    'usaspending_awards', 'sam_events',
    // Recompete
    'recompete_sync_runs',
    // Pipeline
    'user_pipeline', 'pipeline_history', 'user_teaming_partners',
    // Tool errors & health
    'tool_errors', 'tool_health_metrics', 'api_provider_status',
    // Email tracking
    'email_provider_sends', 'email_provider_events',
    // Stripe data cache
    'stripe_customers', 'stripe_charges', 'stripe_subscriptions',
    'customer_classifications', 'stripe_webhook_log',
    // Experiment & treatment
    'experiment_log',
    // Invitation
    'invitation_tokens',
    // MI Beta tables
    'mi_beta_contacts', 'mi_beta_contact_opportunity_links',
    'mi_beta_pursuit_activity', 'mi_beta_market_focuses',
    // OpenGov IQ tables
    'opengov_iq_contacts', 'opengov_iq_entities', 'opengov_iq_idiq_vehicles',
    // Multisite aggregation
    'aggregated_opportunities', 'multisite_sources', 'scrape_log',
  ];

  const results: { table: string; status: string; error?: string }[] = [];

  if (mode === 'execute') {
    for (const table of tables) {
      try {
        // Enable RLS
        const { error: rlsError } = await supabase.rpc('enable_rls_on_table', { table_name: table });

        if (rlsError) {
          // RPC doesn't exist, we need another approach
          results.push({
            table,
            status: 'skipped',
            error: 'RPC function not available - use Supabase Dashboard SQL Editor'
          });
        } else {
          results.push({ table, status: 'enabled' });
        }
      } catch (err) {
        results.push({
          table,
          status: 'error',
          error: err instanceof Error ? err.message : 'Unknown error'
        });
      }
    }
  }

  return NextResponse.json({
    success: true,
    mode,
    message: mode === 'preview'
      ? 'Preview mode - use ?mode=execute to apply changes'
      : 'RLS migration attempted',
    tablesCount: tables.length,
    tables,
    results: mode === 'execute' ? results : undefined,
    instructions: `
To apply the RLS migration:

1. Go to Supabase Dashboard → SQL Editor
2. Copy and run the migration from:
   /Users/ericcoffie/Market Assasin/market-assassin/supabase/migrations/20260513_enable_rls_all_tables.sql

Or use the Supabase CLI:
   supabase db push --linked

The migration will:
- Enable RLS on ${tables.length} tables
- Create "Service role has full access" policies
- Drop problematic Security Definer views
    `
  });
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { sql } = body;

  if (!sql) {
    return NextResponse.json({ error: 'SQL required in request body' }, { status: 400 });
  }

  // For safety, only allow specific statements
  const allowedPatterns = [
    /^ALTER TABLE .+ ENABLE ROW LEVEL SECURITY;?$/i,
    /^CREATE POLICY .+$/i,
    /^DROP POLICY .+$/i,
    /^DROP VIEW .+$/i,
  ];

  const statements = sql.split(';').filter((s: string) => s.trim());
  const disallowed = statements.filter((s: string) =>
    !allowedPatterns.some(p => p.test(s.trim()))
  );

  if (disallowed.length > 0) {
    return NextResponse.json({
      error: 'Only ALTER TABLE ENABLE ROW LEVEL SECURITY and policy statements allowed',
      disallowed
    }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    message: 'SQL validated but cannot execute via REST API. Use Supabase Dashboard SQL Editor.',
    instructions: 'Go to Supabase Dashboard → SQL Editor and run the migration file.'
  });
}
