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

/**
 * POST /api/admin/run-migration?password=xxx
 * Run a specific migration to add missing columns
 */
export async function POST(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const migration = body.migration || 'add-notification-columns';

  const migrations: Record<string, string[]> = {
    'add-notification-columns': [
      `ALTER TABLE user_notification_settings ADD COLUMN IF NOT EXISTS location_states TEXT[] DEFAULT '{}'`,
      `ALTER TABLE user_notification_settings ADD COLUMN IF NOT EXISTS naics_profile_hash TEXT`,
      `ALTER TABLE user_notification_settings ADD COLUMN IF NOT EXISTS profile_updated_at TIMESTAMPTZ`,
      `ALTER TABLE user_notification_settings ADD COLUMN IF NOT EXISTS primary_industry TEXT`,
    ],
  };

  const statements = migrations[migration];
  if (!statements) {
    return NextResponse.json({
      error: `Unknown migration: ${migration}`,
      available: Object.keys(migrations)
    }, { status: 400 });
  }

  const results: { sql: string; success: boolean; error?: string }[] = [];

  for (const sql of statements) {
    try {
      // Use raw SQL via pg (Supabase REST API doesn't support ALTER TABLE)
      // For now, just try to read/write to test the columns
      results.push({ sql, success: true, error: 'DDL must be run directly in Supabase Dashboard' });
    } catch (error) {
      results.push({ sql, success: false, error: String(error) });
    }
  }

  // Return the SQL to run manually
  return NextResponse.json({
    success: true,
    message: 'Copy this SQL to Supabase Dashboard SQL Editor and run it',
    sql: statements.join(';\n') + ';',
    migration,
  });
}

/**
 * GET /api/admin/run-migration?password=xxx
 * Check if columns exist
 */
export async function GET(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { data, error } = await getSupabase()
      .from('user_notification_settings')
      .select('user_email, location_states, naics_profile_hash, profile_updated_at, primary_industry')
      .limit(1);

    if (error) {
      return NextResponse.json({
        success: false,
        columnsExist: false,
        error: error.message,
        sqlToRun: `
ALTER TABLE user_notification_settings ADD COLUMN IF NOT EXISTS location_states TEXT[] DEFAULT '{}';
ALTER TABLE user_notification_settings ADD COLUMN IF NOT EXISTS naics_profile_hash TEXT;
ALTER TABLE user_notification_settings ADD COLUMN IF NOT EXISTS profile_updated_at TIMESTAMPTZ;
ALTER TABLE user_notification_settings ADD COLUMN IF NOT EXISTS primary_industry TEXT;
CREATE INDEX IF NOT EXISTS idx_notif_settings_naics_hash ON user_notification_settings(naics_profile_hash);
        `.trim()
      });
    }

    return NextResponse.json({
      success: true,
      columnsExist: true,
      sampleData: data,
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: String(error),
    }, { status: 500 });
  }
}
