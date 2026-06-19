/**
 * Apply user_notification_settings missing-columns migration
 * (set_aside_preferences, location_zip)
 *
 * GET  ?password=xxx  → check current column presence
 * POST ?password=xxx  → attempt to add missing columns via exec_sql RPC
 *
 * Surfaced May 20 2026: fresh Google OAuth user got
 *   "Could not find the 'set_aside_preferences' column of
 *    'user_notification_settings' in the schema cache"
 * during Complete Setup. Migration file:
 *   supabase/migrations/20260520_user_notification_settings_missing_columns.sql
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const COLUMNS = [
  { name: 'set_aside_preferences', type: "TEXT[] DEFAULT '{}'::TEXT[]" },
  { name: 'location_zip', type: 'TEXT' },
] as const;

function authorized(request: NextRequest): boolean {
  const password = new URL(request.url).searchParams.get('password');
  return password === process.env.ADMIN_PASSWORD;
}

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function checkColumns() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('user_notification_settings')
    .select('*')
    .limit(1);

  if (error) {
    return { ok: false as const, error: error.message };
  }

  const sampleRow = (data && data[0]) || {};
  return {
    ok: true as const,
    present: COLUMNS.map(c => ({ column: c.name, exists: c.name in sampleRow })),
  };
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = await checkColumns();
  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();
  const results: string[] = [];
  const errors: Array<{ column: string; message: string }> = [];

  for (const col of COLUMNS) {
    // Check if column already exists by attempting to select it.
    const { error: probeError } = await supabase
      .from('user_notification_settings')
      .select(col.name)
      .limit(1);

    if (!probeError) {
      results.push(`Column ${col.name} already exists — no-op`);
      continue;
    }

    // Try to add via exec_sql RPC. If that RPC doesn't exist, the caller
    // will need to run the SQL manually via the Supabase SQL editor.
    const sql = `ALTER TABLE user_notification_settings ADD COLUMN IF NOT EXISTS ${col.name} ${col.type};`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: rpcError } = await (supabase.rpc as any)('exec_sql', { sql });

    if (rpcError) {
      errors.push({ column: col.name, message: rpcError.message });
      continue;
    }

    results.push(`Added column ${col.name}`);
  }

  // Refresh PostgREST schema cache so the new columns are immediately visible.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.rpc as any)('exec_sql', { sql: `NOTIFY pgrst, 'reload schema';` }).catch(() => {});

  const finalCheck = await checkColumns();

  return NextResponse.json({
    success: errors.length === 0,
    results,
    errors: errors.length > 0 ? errors : undefined,
    finalState: finalCheck,
    manualSqlIfRpcUnavailable: errors.length > 0
      ? COLUMNS.map(c => `ALTER TABLE user_notification_settings ADD COLUMN IF NOT EXISTS ${c.name} ${c.type};`).join('\n')
      : undefined,
  });
}
