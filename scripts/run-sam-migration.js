#!/usr/bin/env node
/**
 * Run SAM.gov opportunities cache migration
 *
 * Usage: node scripts/run-sam-migration.js
 *
 * This creates the sam_opportunities table in Supabase.
 * You can also run the SQL directly in Supabase SQL Editor.
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://krpyelfrbicmvsmwovti.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtycHllbGZyYmljbXZzbXdvdnRpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODA3NTUwMCwiZXhwIjoyMDgzNjUxNTAwfQ.vt66ATmjPwS0HclhBP1g1-dQ-aEPEbWwG4xcn8j4GCg';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const SQL_MIGRATION = `
-- SAM.gov Opportunities Cache
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS sam_opportunities (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  notice_id TEXT NOT NULL UNIQUE,
  solicitation_number TEXT,
  title TEXT NOT NULL,
  description TEXT,
  naics_code TEXT,
  naics_codes TEXT[],
  psc_code TEXT,
  department TEXT,
  sub_tier TEXT,
  office TEXT,
  agency_hierarchy TEXT,
  posted_date TIMESTAMPTZ,
  response_deadline TIMESTAMPTZ,
  archive_date TIMESTAMPTZ,
  last_modified TIMESTAMPTZ,
  set_aside_code TEXT,
  set_aside_description TEXT,
  notice_type TEXT,
  notice_type_code TEXT,
  active BOOLEAN DEFAULT true,
  pop_city TEXT,
  pop_state TEXT,
  pop_zip TEXT,
  pop_country TEXT,
  award_amount DECIMAL(15,2),
  award_date TIMESTAMPTZ,
  awardee_name TEXT,
  awardee_uei TEXT,
  ui_link TEXT,
  raw_data JSONB,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  source TEXT DEFAULT 'sam.gov',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sam_opps_naics ON sam_opportunities(naics_code);
CREATE INDEX IF NOT EXISTS idx_sam_opps_set_aside ON sam_opportunities(set_aside_code);
CREATE INDEX IF NOT EXISTS idx_sam_opps_response_deadline ON sam_opportunities(response_deadline);
CREATE INDEX IF NOT EXISTS idx_sam_opps_active ON sam_opportunities(active);
CREATE INDEX IF NOT EXISTS idx_sam_opps_pop_state ON sam_opportunities(pop_state);
CREATE INDEX IF NOT EXISTS idx_sam_opps_synced_at ON sam_opportunities(synced_at);

-- Sync runs tracking
CREATE TABLE IF NOT EXISTS sam_sync_runs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT DEFAULT 'running',
  total_fetched INTEGER DEFAULT 0,
  new_records INTEGER DEFAULT 0,
  updated_records INTEGER DEFAULT 0,
  deleted_records INTEGER DEFAULT 0,
  error_message TEXT,
  duration_seconds INTEGER,
  api_calls_made INTEGER DEFAULT 0
);

-- Enable RLS
ALTER TABLE sam_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE sam_sync_runs ENABLE ROW LEVEL SECURITY;

-- Allow public read
CREATE POLICY IF NOT EXISTS "Allow public read sam_opportunities" ON sam_opportunities
  FOR SELECT USING (true);

CREATE POLICY IF NOT EXISTS "Service role full access sam_opportunities" ON sam_opportunities
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY IF NOT EXISTS "Service role full access sam_sync_runs" ON sam_sync_runs
  FOR ALL USING (auth.role() = 'service_role');
`;

async function main() {
  console.log('SAM.gov Opportunities Cache Migration');
  console.log('=====================================\n');

  // Check if table exists
  const { data, error } = await supabase
    .from('sam_opportunities')
    .select('id')
    .limit(1);

  if (!error) {
    console.log('✅ Table sam_opportunities already exists');
    const { count } = await supabase
      .from('sam_opportunities')
      .select('*', { count: 'exact', head: true });
    console.log(`   Current records: ${count || 0}`);
    return;
  }

  if (error.code === 'PGRST205') {
    console.log('❌ Table sam_opportunities does not exist\n');
    console.log('Please run the following SQL in Supabase SQL Editor:');
    console.log('https://supabase.com/dashboard/project/krpyelfrbicmvsmwovti/sql/new\n');
    console.log('--- Copy from here ---');
    console.log(SQL_MIGRATION);
    console.log('--- End copy ---\n');
    return;
  }

  console.log('Unknown error:', error);
}

main().catch(console.error);
