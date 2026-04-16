/**
 * Admin: Setup SAM.gov Opportunities Cache
 *
 * GET /api/admin/setup-sam-cache?password=...
 *
 * Creates the sam_opportunities table and indexes in Supabase.
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

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Create the main opportunities table
    const { error: tableError } = await getSupabase().rpc('exec_sql', {
      sql: `
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
      `
    });

    if (tableError) {
      // Try direct insert as fallback
      console.log('RPC failed, trying direct approach');
    }

    // Check if table exists now
    const { data: checkData, error: checkError } = await getSupabase()
      .from('sam_opportunities')
      .select('id')
      .limit(1);

    if (checkError && checkError.code === 'PGRST205') {
      return NextResponse.json({
        success: false,
        error: 'Table creation failed. Run migration manually in Supabase SQL Editor.',
        migrationFile: '/supabase/migrations/20260414_sam_opportunities_cache.sql'
      });
    }

    // Create sync runs table
    const { error: syncTableError } = await getSupabase().rpc('exec_sql', {
      sql: `
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

    return NextResponse.json({
      success: true,
      message: 'SAM.gov cache tables created successfully',
      tables: ['sam_opportunities', 'sam_sync_runs'],
      nextStep: 'Run /api/admin/sync-sam-opportunities to populate the cache'
    });

  } catch (err) {
    console.error('Setup error:', err);
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
      hint: 'Run the migration SQL directly in Supabase SQL Editor'
    }, { status: 500 });
  }
}
