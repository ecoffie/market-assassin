/**
 * Admin: Create SAM.gov Opportunities Table
 *
 * POST /api/admin/create-sam-table?password=...
 *
 * Creates the sam_opportunities table using Supabase client.
 * This is a one-time setup endpoint.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabase: any = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Check if table exists by trying to query it
  const { error: checkError } = await getSupabase()
    .from('sam_opportunities')
    .select('id')
    .limit(1);

  if (!checkError) {
    return NextResponse.json({
      success: true,
      message: 'Table sam_opportunities already exists',
      action: 'none'
    });
  }

  if (checkError.code !== 'PGRST205') {
    return NextResponse.json({
      success: false,
      error: checkError.message,
      code: checkError.code
    }, { status: 500 });
  }

  // Table doesn't exist - we need to create it via SQL
  // Since supabase-js doesn't support raw DDL, we need to use a different approach

  return NextResponse.json({
    success: false,
    message: 'Table does not exist. Please run the SQL migration manually.',
    sqlEditorUrl: 'https://getSupabase().com/dashboard/project/krpyelfrbicmvsmwovti/sql/new',
    sql: `
-- Run this SQL in Supabase SQL Editor:

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
`
  });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Check table status
  const { data, error } = await getSupabase()
    .from('sam_opportunities')
    .select('id', { count: 'exact', head: true });

  if (error?.code === 'PGRST205') {
    return NextResponse.json({
      exists: false,
      message: 'Table does not exist. POST to this endpoint for SQL to run.',
      sqlEditorUrl: 'https://getSupabase().com/dashboard/project/krpyelfrbicmvsmwovti/sql/new'
    });
  }

  if (error) {
    return NextResponse.json({
      exists: false,
      error: error.message
    }, { status: 500 });
  }

  // Table exists - get count
  const { count } = await getSupabase()
    .from('sam_opportunities')
    .select('*', { count: 'exact', head: true });

  return NextResponse.json({
    exists: true,
    count: count || 0,
    message: count ? `Table has ${count} records` : 'Table exists but is empty. Run sync to populate.'
  });
}
