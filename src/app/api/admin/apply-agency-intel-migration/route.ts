/**
 * Admin API: Apply Agency Intelligence Migration
 * Checks and applies the agency_intelligence database schema
 *
 * Usage:
 *   GET ?password=xxx - Check migration status
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

export async function GET(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({
      endpoint: '/api/admin/apply-agency-intel-migration',
      description: 'Check and apply agency_intelligence database migration',
      usage: 'GET ?password=xxx',
    });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: 'Missing Supabase credentials' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Check if tables exist
  const tables = ['agency_intelligence', 'intelligence_sync_runs', 'intelligence_sources'];
  const status: Record<string, string> = {};

  for (const table of tables) {
    const { error } = await supabase.from(table).select('*').limit(1);

    if (error?.message.includes('does not exist')) {
      status[table] = 'NEEDS CREATION';
    } else if (error) {
      status[table] = `ERROR: ${error.message}`;
    } else {
      status[table] = 'exists';
    }
  }

  const allExist = Object.values(status).every(s => s === 'exists');

  if (allExist) {
    // Get stats
    const { count: intelCount } = await supabase
      .from('agency_intelligence')
      .select('*', { count: 'exact', head: true });

    const { count: sourcesCount } = await supabase
      .from('intelligence_sources')
      .select('*', { count: 'exact', head: true });

    return NextResponse.json({
      success: true,
      message: 'All migrations applied successfully',
      status,
      stats: {
        agency_intelligence_records: intelCount || 0,
        configured_sources: sourcesCount || 0,
      },
      nextSteps: [
        'Run sync: POST /api/admin/sync-agency-intel?password=xxx',
        'Check specific agency: GET /api/admin/sync-agency-intel?password=xxx&agency=DOD',
      ],
    });
  }

  return NextResponse.json({
    success: false,
    message: 'Migration needs to be applied manually',
    status,
    instructions: {
      step1: 'Go to Supabase SQL Editor:',
      url: 'https://supabase.com/dashboard/project/krpyelfrbicmvsmwovti/sql/new',
      step2: 'Copy the contents of: supabase/migrations/20260419_agency_intelligence.sql',
      step3: 'Paste and run the SQL',
      step4: 'Refresh this endpoint to verify',
    },
    migrationFile: 'supabase/migrations/20260419_agency_intelligence.sql',
  });
}
