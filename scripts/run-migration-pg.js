#!/usr/bin/env node
/**
 * Run SAM.gov migration using pg library
 */

const { Pool } = require('pg');

const DATABASE_URL = 'postgresql://postgres.krpyelfrbicmvsmwovti:[2g0MRz3\\JL4q,sUf@aws-0-us-east-1.pooler.supabase.com:6543/postgres';

const SQL = `
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

CREATE INDEX IF NOT EXISTS idx_sam_opps_naics ON sam_opportunities(naics_code);
CREATE INDEX IF NOT EXISTS idx_sam_opps_set_aside ON sam_opportunities(set_aside_code);
CREATE INDEX IF NOT EXISTS idx_sam_opps_response_deadline ON sam_opportunities(response_deadline);
CREATE INDEX IF NOT EXISTS idx_sam_opps_active ON sam_opportunities(active);
CREATE INDEX IF NOT EXISTS idx_sam_opps_pop_state ON sam_opportunities(pop_state);
CREATE INDEX IF NOT EXISTS idx_sam_opps_synced_at ON sam_opportunities(synced_at);

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
`;

async function main() {
  console.log('Running SAM.gov migration...');

  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    const client = await pool.connect();
    console.log('Connected to database');

    await client.query(SQL);
    console.log('Migration completed successfully!');

    // Verify
    const result = await client.query('SELECT COUNT(*) FROM sam_opportunities');
    console.log(`Table exists with ${result.rows[0].count} records`);

    client.release();
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
