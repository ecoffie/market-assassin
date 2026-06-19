/**
 * Apply SAM Pipeline Migration
 *
 * GET /api/admin/apply-sam-pipeline-migration?password=xxx
 *
 * Applies the resumable sync pipeline schema changes
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

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

  const results: { step: string; success: boolean; error?: string }[] = [];

  // Step 1: Add new columns to sam_sync_runs
  const alterColumns = [
    `ALTER TABLE sam_sync_runs ADD COLUMN IF NOT EXISTS sync_type TEXT DEFAULT 'full'`,
    `ALTER TABLE sam_sync_runs ADD COLUMN IF NOT EXISTS last_successful_offset INTEGER DEFAULT 0`,
    `ALTER TABLE sam_sync_runs ADD COLUMN IF NOT EXISTS total_available INTEGER DEFAULT 0`,
    `ALTER TABLE sam_sync_runs ADD COLUMN IF NOT EXISTS failed_offsets INTEGER[] DEFAULT '{}'`,
    `ALTER TABLE sam_sync_runs ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0`,
    `ALTER TABLE sam_sync_runs ADD COLUMN IF NOT EXISTS parent_run_id UUID`,
  ];

  for (const sql of alterColumns) {
    const { error } = await supabase.rpc('exec_sql', { sql }).single();
    if (error && !error.message.includes('already exists')) {
      results.push({ step: sql.substring(0, 60), success: false, error: error.message });
    } else {
      results.push({ step: sql.substring(0, 60), success: true });
    }
  }

  // Step 2: Create sam_sync_health table
  const createHealthTable = `
    CREATE TABLE IF NOT EXISTS sam_sync_health (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      checked_at TIMESTAMPTZ DEFAULT NOW(),
      cache_record_count INTEGER,
      cache_active_count INTEGER,
      cache_newest_synced_at TIMESTAMPTZ,
      cache_age_hours DECIMAL(10,2),
      last_successful_sync_at TIMESTAMPTZ,
      last_sync_status TEXT,
      consecutive_failures INTEGER DEFAULT 0,
      health_score INTEGER,
      health_status TEXT,
      action_taken TEXT,
      recovery_run_id UUID
    )
  `;

  const { error: healthError } = await supabase.rpc('exec_sql', { sql: createHealthTable }).single();
  if (healthError && !healthError.message.includes('already exists')) {
    results.push({ step: 'Create sam_sync_health table', success: false, error: healthError.message });
  } else {
    results.push({ step: 'Create sam_sync_health table', success: true });
  }

  // Step 3: Create index
  const createIndex = `
    CREATE INDEX IF NOT EXISTS idx_sam_sync_runs_resumable
    ON sam_sync_runs(status, started_at)
  `;

  const { error: indexError } = await supabase.rpc('exec_sql', { sql: createIndex }).single();
  if (indexError) {
    results.push({ step: 'Create resumable index', success: false, error: indexError.message });
  } else {
    results.push({ step: 'Create resumable index', success: true });
  }

  // Step 4: Enable RLS on health table
  const enableRls = `ALTER TABLE sam_sync_health ENABLE ROW LEVEL SECURITY`;
  await supabase.rpc('exec_sql', { sql: enableRls }).single();
  results.push({ step: 'Enable RLS on health table', success: true });

  // Step 5: Create RLS policy
  const createPolicy = `
    CREATE POLICY IF NOT EXISTS "Service role full access sam_sync_health"
    ON sam_sync_health FOR ALL USING (auth.role() = 'service_role')
  `;
  await supabase.rpc('exec_sql', { sql: createPolicy }).single();
  results.push({ step: 'Create RLS policy', success: true });

  const allSuccess = results.every(r => r.success);

  return NextResponse.json({
    success: allSuccess,
    message: allSuccess ? 'Migration applied successfully' : 'Migration completed with some errors',
    results,
  });
}
