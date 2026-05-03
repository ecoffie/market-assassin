/**
 * Apply Experiment Cohort Migration
 *
 * POST /api/admin/apply-experiment-migration?password=xxx
 *
 * Applies the experiment_cohorts migration to add columns for A/B testing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }

  const results: { step: string; status: string; error?: string }[] = [];

  // Add columns one by one (IF NOT EXISTS is handled by ALTER TABLE)
  const alterStatements = [
    { name: 'experiment_cohort', sql: `ALTER TABLE user_notification_settings ADD COLUMN IF NOT EXISTS experiment_cohort TEXT` },
    { name: 'cohort_assigned_at', sql: `ALTER TABLE user_notification_settings ADD COLUMN IF NOT EXISTS cohort_assigned_at TIMESTAMPTZ` },
    { name: 'paid_status', sql: `ALTER TABLE user_notification_settings ADD COLUMN IF NOT EXISTS paid_status BOOLEAN DEFAULT FALSE` },
    { name: 'stripe_customer_id', sql: `ALTER TABLE user_notification_settings ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT` },
    { name: 'products_owned', sql: `ALTER TABLE user_notification_settings ADD COLUMN IF NOT EXISTS products_owned JSONB DEFAULT '[]'::jsonb` },
    { name: 'beta_pioneer', sql: `ALTER TABLE user_notification_settings ADD COLUMN IF NOT EXISTS beta_pioneer BOOLEAN DEFAULT FALSE` },
    { name: 'alerts_opened_30d', sql: `ALTER TABLE user_notification_settings ADD COLUMN IF NOT EXISTS alerts_opened_30d INTEGER DEFAULT 0` },
    { name: 'set_aside_certifications', sql: `ALTER TABLE user_notification_settings ADD COLUMN IF NOT EXISTS set_aside_certifications TEXT[] DEFAULT '{}'` },
  ];

  for (const stmt of alterStatements) {
    try {
      const { error } = await supabase.rpc('exec_sql', { sql: stmt.sql });
      if (error) {
        // Try direct query as fallback
        const { error: directError } = await supabase.from('user_notification_settings').select('user_email').limit(1);
        if (directError) throw directError;
        results.push({ step: `Add column ${stmt.name}`, status: 'skipped', error: 'RPC not available, column may already exist' });
      } else {
        results.push({ step: `Add column ${stmt.name}`, status: 'success' });
      }
    } catch (err) {
      results.push({ step: `Add column ${stmt.name}`, status: 'error', error: String(err) });
    }
  }

  // Create experiment_log table
  const createTableSql = `
    CREATE TABLE IF NOT EXISTS experiment_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_email TEXT NOT NULL,
      action TEXT NOT NULL,
      cohort_before TEXT,
      cohort_after TEXT,
      reason TEXT,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  try {
    const { error } = await supabase.rpc('exec_sql', { sql: createTableSql });
    if (error) {
      results.push({ step: 'Create experiment_log table', status: 'skipped', error: 'RPC not available' });
    } else {
      results.push({ step: 'Create experiment_log table', status: 'success' });
    }
  } catch (err) {
    results.push({ step: 'Create experiment_log table', status: 'error', error: String(err) });
  }

  // Create indexes
  const indexes = [
    { name: 'idx_notif_settings_experiment_cohort', sql: `CREATE INDEX IF NOT EXISTS idx_notif_settings_experiment_cohort ON user_notification_settings(experiment_cohort)` },
    { name: 'idx_notif_settings_paid_status', sql: `CREATE INDEX IF NOT EXISTS idx_notif_settings_paid_status ON user_notification_settings(paid_status)` },
    { name: 'idx_experiment_log_user_email', sql: `CREATE INDEX IF NOT EXISTS idx_experiment_log_user_email ON experiment_log(user_email)` },
    { name: 'idx_experiment_log_created_at', sql: `CREATE INDEX IF NOT EXISTS idx_experiment_log_created_at ON experiment_log(created_at)` },
  ];

  for (const idx of indexes) {
    try {
      const { error } = await supabase.rpc('exec_sql', { sql: idx.sql });
      if (error) {
        results.push({ step: `Create index ${idx.name}`, status: 'skipped', error: 'RPC not available' });
      } else {
        results.push({ step: `Create index ${idx.name}`, status: 'success' });
      }
    } catch (err) {
      results.push({ step: `Create index ${idx.name}`, status: 'error', error: String(err) });
    }
  }

  // Check if columns exist by querying the table
  const { data: sample, error: checkError } = await supabase
    .from('user_notification_settings')
    .select('user_email, experiment_cohort, paid_status')
    .limit(1);

  const columnsExist = !checkError && sample !== null;

  return NextResponse.json({
    success: true,
    message: 'Migration attempted',
    columnsExist,
    results,
    note: 'If RPC is not available, run the SQL migration directly in Supabase SQL Editor',
  });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }

  // Check current state
  const { data: sample, error } = await supabase
    .from('user_notification_settings')
    .select('*')
    .limit(1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const columns = sample && sample.length > 0 ? Object.keys(sample[0]) : [];
  const hasExperimentColumns = columns.includes('experiment_cohort');

  // Check experiment_log table
  const { data: logSample, error: logError } = await supabase
    .from('experiment_log')
    .select('*')
    .limit(1);

  const experimentLogExists = !logError;

  // Get cohort counts if columns exist
  let cohortCounts: Record<string, number> = {};
  if (hasExperimentColumns) {
    const { data: users } = await supabase
      .from('user_notification_settings')
      .select('experiment_cohort')
      .not('experiment_cohort', 'is', null);

    if (users) {
      for (const user of users) {
        const cohort = user.experiment_cohort || 'unassigned';
        cohortCounts[cohort] = (cohortCounts[cohort] || 0) + 1;
      }
    }
  }

  return NextResponse.json({
    success: true,
    currentColumns: columns,
    hasExperimentColumns,
    experimentLogExists,
    cohortCounts,
  });
}
