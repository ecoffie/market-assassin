import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

/**
 * Admin endpoint to set up forecast intelligence tables
 * GET /api/admin/setup-forecasts?password=xxx - Check status
 * POST /api/admin/setup-forecasts?password=xxx - Run setup
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Check if tables exist by querying them
  const tables = ['agency_forecasts', 'forecast_sync_runs', 'forecast_sources'];
  const status: Record<string, { exists: boolean; count: number | null; error?: string }> = {};

  for (const table of tables) {
    try {
      const { count, error } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true });

      if (error) {
        status[table] = { exists: false, count: null, error: error.message };
      } else {
        status[table] = { exists: true, count: count || 0 };
      }
    } catch (e) {
      status[table] = { exists: false, count: null, error: String(e) };
    }
  }

  const allExist = Object.values(status).every(s => s.exists);

  return NextResponse.json({
    success: true,
    status: allExist ? 'ready' : 'needs_setup',
    tables: status,
    instructions: allExist
      ? 'Tables exist. Run POST to seed sources or import data.'
      : 'Run the migration SQL in Supabase Dashboard > SQL Editor. See supabase/migrations/20260405_forecast_intelligence.sql',
  });
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const action = searchParams.get('action') || 'seed';

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      db: { schema: 'public' },
      auth: { persistSession: false },
    }
  );

  if (action === 'seed') {
    // Seed the forecast_sources table without wiping operational history
    const sources = [
      { agency_code: 'DOE', agency_name: 'Department of Energy', source_type: 'excel_direct', source_url: 'https://www.energy.gov/management/doe-forecast-opportunities', estimated_spend_coverage: 3.5, is_active: true, total_records: 0 },
      { agency_code: 'NASA', agency_name: 'NASA', source_type: 'excel_direct', source_url: 'https://www.hq.nasa.gov/office/procurement/forecast/Agencyforecast.xlsx', estimated_spend_coverage: 2.5, is_active: true, total_records: 0 },
      { agency_code: 'DOJ', agency_name: 'Department of Justice', source_type: 'excel_direct', source_url: 'https://www.justice.gov/media/1381791/dl', estimated_spend_coverage: 3.0, is_active: true, total_records: 0 },
      { agency_code: 'GSA', agency_name: 'General Services Administration', source_type: 'puppeteer', source_url: 'https://acquisitiongateway.gov/forecast', estimated_spend_coverage: 8.0, is_active: false, total_records: 0 },
      { agency_code: 'VA', agency_name: 'Department of Veterans Affairs', source_type: 'puppeteer', source_url: 'https://www.vendorportal.ecms.va.gov/evp/fco/fco.aspx', estimated_spend_coverage: 10.0, is_active: false, total_records: 0 },
      { agency_code: 'DHS', agency_name: 'Department of Homeland Security', source_type: 'puppeteer', source_url: 'https://apfs-cloud.dhs.gov/forecast/', estimated_spend_coverage: 8.0, is_active: false, total_records: 0 },
      { agency_code: 'HHS', agency_name: 'Department of Health and Human Services', source_type: 'puppeteer', source_url: 'https://procurementforecast.hhs.gov', estimated_spend_coverage: 12.0, is_active: false, total_records: 0 },
      { agency_code: 'Treasury', agency_name: 'Department of the Treasury', source_type: 'puppeteer', source_url: 'https://osdbu.forecast.treasury.gov/', estimated_spend_coverage: 2.0, is_active: false, total_records: 0 },
      { agency_code: 'EPA', agency_name: 'Environmental Protection Agency', source_type: 'puppeteer', source_url: 'https://ofmpub.epa.gov/apex/forecast/f?p=forecast', estimated_spend_coverage: 1.5, is_active: false, total_records: 0 },
      { agency_code: 'USDA', agency_name: 'Department of Agriculture', source_type: 'puppeteer', source_url: 'https://forecast.edc.usda.gov', estimated_spend_coverage: 4.0, is_active: false, total_records: 0 },
      { agency_code: 'DOD', agency_name: 'Department of Defense', source_type: 'multi_source', source_url: null, estimated_spend_coverage: 40.0, is_active: false, total_records: 0 },
    ];

    const { data: rpcResult, error: rpcError } = await supabase.rpc('seed_forecast_sources');
    if (!rpcError) {
      return NextResponse.json({
        success: true,
        action: 'seed',
        sourcesSeeded: rpcResult?.seeded || sources.length,
        method: 'rpc',
      });
    }

    // Fallback: upsert one by one to preserve health/sync fields
    let inserted = 0;
    const errors: string[] = [];

    for (const source of sources) {
      const { error } = await supabase
        .from('forecast_sources')
        .upsert(source, { onConflict: 'agency_code' });

      if (error) {
        errors.push(`${source.agency_code}: ${error.message}`);
      } else {
        inserted++;
      }
    }

    if (inserted === 0 && errors.length > 0) {
      return NextResponse.json({
        success: false,
        error: errors[0],
        allErrors: errors,
        hint: 'Table may not exist, schema cache may be stale, or the seed RPC has not been migrated yet.',
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      action: 'seed',
      sourcesSeeded: inserted,
      method: 'upsert',
      rpcError: rpcError?.message,
      errors: errors.length > 0 ? errors : undefined,
    });
  }

  if (action === 'create_tables') {
    // Create tables using raw SQL via RPC (if available)
    const createTablesSql = `
      CREATE TABLE IF NOT EXISTS agency_forecasts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        source_agency TEXT NOT NULL,
        source_type TEXT NOT NULL DEFAULT 'excel',
        source_url TEXT,
        external_id TEXT,
        title TEXT NOT NULL,
        description TEXT,
        department TEXT,
        bureau TEXT,
        contracting_office TEXT,
        program_office TEXT,
        naics_code TEXT,
        naics_description TEXT,
        psc_code TEXT,
        psc_description TEXT,
        fiscal_year TEXT,
        anticipated_quarter TEXT,
        anticipated_award_date DATE,
        solicitation_date DATE,
        performance_end_date DATE,
        estimated_value_min BIGINT,
        estimated_value_max BIGINT,
        estimated_value_range TEXT,
        contract_type TEXT,
        set_aside_type TEXT,
        competition_type TEXT,
        incumbent_name TEXT,
        incumbent_contract_number TEXT,
        poc_name TEXT,
        poc_email TEXT,
        poc_phone TEXT,
        pop_state TEXT,
        pop_city TEXT,
        pop_zip TEXT,
        pop_country TEXT DEFAULT 'USA',
        status TEXT DEFAULT 'forecast',
        raw_data JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        last_synced_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(source_agency, external_id)
      );

      CREATE TABLE IF NOT EXISTS forecast_sync_runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        source_agency TEXT NOT NULL,
        source_type TEXT NOT NULL,
        run_type TEXT NOT NULL DEFAULT 'full',
        status TEXT NOT NULL DEFAULT 'running',
        started_at TIMESTAMPTZ DEFAULT NOW(),
        completed_at TIMESTAMPTZ,
        records_fetched INT DEFAULT 0,
        records_added INT DEFAULT 0,
        records_updated INT DEFAULT 0,
        records_unchanged INT DEFAULT 0,
        error_message TEXT,
        metadata JSONB
      );

      CREATE TABLE IF NOT EXISTS forecast_sources (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agency_code TEXT UNIQUE NOT NULL,
        agency_name TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_url TEXT,
        scraper_config JSONB,
        sync_frequency TEXT DEFAULT 'weekly',
        last_sync_at TIMESTAMPTZ,
        next_sync_at TIMESTAMPTZ,
        is_active BOOLEAN DEFAULT true,
        last_success_at TIMESTAMPTZ,
        last_failure_at TIMESTAMPTZ,
        consecutive_failures INT DEFAULT 0,
        total_records INT DEFAULT 0,
        estimated_spend_coverage DECIMAL(5,2),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;

    // Try to execute via a workaround - insert into a test record
    // This won't work without proper RPC, so return instructions
    return NextResponse.json({
      success: false,
      error: 'Cannot create tables via API. Please run the SQL manually.',
      sql: createTablesSql,
      instructions: [
        '1. Go to Supabase Dashboard > SQL Editor',
        '2. Paste the SQL from supabase/migrations/20260405_forecast_intelligence.sql',
        '3. Click Run',
        '4. Then call this endpoint again with action=seed',
      ],
    });
  }

  return NextResponse.json({
    success: false,
    error: 'Unknown action',
    validActions: ['seed', 'create_tables'],
  });
}
