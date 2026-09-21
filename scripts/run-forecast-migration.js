#!/usr/bin/env node
/**
 * Run Forecast Intelligence migration
 * Creates tables: agency_forecasts, forecast_sync_runs, forecast_sources
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load env manually
const envPath = path.join(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const envVars = {};
envContent.split('\n').forEach(line => {
  const [key, ...valueParts] = line.split('=');
  if (key && valueParts.length) {
    envVars[key.trim()] = valueParts.join('=').trim();
  }
});

const supabaseUrl = envVars.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = envVars.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runMigration() {
  console.log('Running Forecast Intelligence migration...\n');

  // Check if tables already exist
  const tables = ['agency_forecasts', 'forecast_sync_runs', 'forecast_sources'];

  console.log('Checking existing tables...');
  for (const table of tables) {
    const { error } = await supabase.from(table).select('*', { count: 'exact', head: true });
    if (!error) {
      console.log(`  ✅ ${table} - exists`);
    } else if (error.code === '42P01' || error.message.includes('does not exist')) {
      console.log(`  ⏳ ${table} - needs creation`);
    } else {
      console.log(`  ⚠️ ${table} - ${error.message}`);
    }
  }

  console.log('\n--- Running SQL statements ---\n');

  // Main forecasts table
  const createForecasts = await runSQL('agency_forecasts', `
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
    )
  `);

  // Sync runs table
  const createSyncRuns = await runSQL('forecast_sync_runs', `
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
    )
  `);

  // Sources table
  const createSources = await runSQL('forecast_sources', `
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
    )
  `);

  // Seed sources
  if (createSources) {
    console.log('\nSeeding forecast sources...');
    const sources = [
      { agency_code: 'DOE', agency_name: 'Department of Energy', source_type: 'excel_direct', source_url: 'https://www.energy.gov/management/doe-forecast-opportunities', estimated_spend_coverage: 3.5, is_active: true },
      { agency_code: 'NASA', agency_name: 'NASA', source_type: 'excel_direct', source_url: 'https://www.hq.nasa.gov/office/procurement/forecast/Agencyforecast.xlsx', estimated_spend_coverage: 2.5, is_active: true },
      { agency_code: 'DOJ', agency_name: 'Department of Justice', source_type: 'excel_direct', source_url: 'https://www.justice.gov/media/1381791/dl', estimated_spend_coverage: 3.0, is_active: true },
      { agency_code: 'GSA', agency_name: 'General Services Administration', source_type: 'puppeteer', source_url: 'https://acquisitiongateway.gov/forecast', estimated_spend_coverage: 8.0, is_active: false },
      { agency_code: 'VA', agency_name: 'Department of Veterans Affairs', source_type: 'puppeteer', source_url: 'https://www.vendorportal.ecms.va.gov/evp/fco/fco.aspx', estimated_spend_coverage: 10.0, is_active: false },
      { agency_code: 'DHS', agency_name: 'Department of Homeland Security', source_type: 'puppeteer', source_url: 'https://apfs-cloud.dhs.gov/forecast/', estimated_spend_coverage: 8.0, is_active: false },
      { agency_code: 'HHS', agency_name: 'Department of Health and Human Services', source_type: 'puppeteer', source_url: 'https://procurementforecast.hhs.gov', estimated_spend_coverage: 12.0, is_active: false },
      { agency_code: 'Treasury', agency_name: 'Department of the Treasury', source_type: 'puppeteer', source_url: 'https://osdbu.forecast.treasury.gov/', estimated_spend_coverage: 2.0, is_active: false },
      { agency_code: 'EPA', agency_name: 'Environmental Protection Agency', source_type: 'puppeteer', source_url: 'https://ofmpub.epa.gov/apex/forecast/f?p=forecast', estimated_spend_coverage: 1.5, is_active: false },
      { agency_code: 'USDA', agency_name: 'Department of Agriculture', source_type: 'puppeteer', source_url: 'https://forecast.edc.usda.gov', estimated_spend_coverage: 4.0, is_active: false },
      { agency_code: 'DOD', agency_name: 'Department of Defense', source_type: 'multi_source', source_url: null, estimated_spend_coverage: 40.0, is_active: false },
    ];

    const { error } = await supabase
      .from('forecast_sources')
      .upsert(sources, { onConflict: 'agency_code' });

    if (error) {
      console.log(`  ⚠️ Error seeding sources: ${error.message}`);
    } else {
      console.log(`  ✅ Seeded ${sources.length} forecast sources`);
    }
  }

  // Final verification
  console.log('\n--- Final Verification ---\n');
  for (const table of tables) {
    const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
    if (!error) {
      console.log(`  ✅ ${table}: ${count || 0} records`);
    } else {
      console.log(`  ❌ ${table}: ${error.message}`);
    }
  }

  console.log('\n=== Migration Complete ===\n');
  console.log('If tables were not created automatically, run this SQL in Supabase Dashboard:');
  console.log('  File: supabase/migrations/20260405_forecast_intelligence.sql\n');
}

async function runSQL(name, sql) {
  // First check if table exists
  const { error: checkError } = await supabase.from(name).select('*', { count: 'exact', head: true });

  if (!checkError) {
    console.log(`  ✅ ${name} - already exists`);
    return true;
  }

  // Table doesn't exist - note: Supabase JS client can't run DDL directly
  // The admin would need to run this manually or via the dashboard
  console.log(`  ⚠️ ${name} - needs manual creation (DDL not supported via API)`);
  return false;
}

runMigration().catch(console.error);
