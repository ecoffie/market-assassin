/**
 * Apply Treatment Type Migration
 *
 * POST /api/admin/apply-treatment-type-migration?password=xxx
 *
 * Adds treatment_type column and experiment_log table for paid status alignment.
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

  // Step 1: Add treatment_type column
  const alterStatements = [
    {
      name: 'treatment_type',
      sql: `ALTER TABLE user_notification_settings ADD COLUMN IF NOT EXISTS treatment_type TEXT DEFAULT 'alerts'`,
    },
  ];

  for (const stmt of alterStatements) {
    try {
      const { error } = await supabase.rpc('exec_sql', { sql: stmt.sql });
      if (error) {
        results.push({ step: `Add column ${stmt.name}`, status: 'skipped', error: 'RPC not available' });
      } else {
        results.push({ step: `Add column ${stmt.name}`, status: 'success' });
      }
    } catch (err) {
      results.push({ step: `Add column ${stmt.name}`, status: 'error', error: String(err) });
    }
  }

  // Step 2: Create index on treatment_type
  const indexes = [
    {
      name: 'idx_user_notification_settings_treatment_type',
      sql: `CREATE INDEX IF NOT EXISTS idx_user_notification_settings_treatment_type ON user_notification_settings(treatment_type)`,
    },
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

  // Step 3: Create or update experiment_log table with new columns
  const experimentLogSql = `
    CREATE TABLE IF NOT EXISTS experiment_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_email TEXT NOT NULL,
      action TEXT NOT NULL,
      old_value JSONB,
      new_value JSONB,
      reason TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  try {
    const { error } = await supabase.rpc('exec_sql', { sql: experimentLogSql });
    if (error) {
      results.push({ step: 'Create experiment_log table', status: 'skipped', error: 'RPC not available' });
    } else {
      results.push({ step: 'Create experiment_log table', status: 'success' });
    }
  } catch (err) {
    results.push({ step: 'Create experiment_log table', status: 'error', error: String(err) });
  }

  // Step 4: Create indexes on experiment_log
  const logIndexes = [
    { name: 'idx_experiment_log_user_email', sql: `CREATE INDEX IF NOT EXISTS idx_experiment_log_user_email ON experiment_log(user_email)` },
    { name: 'idx_experiment_log_action', sql: `CREATE INDEX IF NOT EXISTS idx_experiment_log_action ON experiment_log(action)` },
    { name: 'idx_experiment_log_reason', sql: `CREATE INDEX IF NOT EXISTS idx_experiment_log_reason ON experiment_log(reason)` },
    { name: 'idx_experiment_log_created_at', sql: `CREATE INDEX IF NOT EXISTS idx_experiment_log_created_at ON experiment_log(created_at)` },
  ];

  for (const idx of logIndexes) {
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

  // Check if columns exist now
  const { data: sample, error: checkError } = await supabase
    .from('user_notification_settings')
    .select('user_email, treatment_type')
    .limit(1);

  const columnsExist = !checkError && sample !== null;

  // Check experiment_log
  const { error: logError } = await supabase
    .from('experiment_log')
    .select('id')
    .limit(1);

  const experimentLogExists = !logError;

  return NextResponse.json({
    success: true,
    message: 'Treatment type migration attempted',
    columnsExist,
    experimentLogExists,
    results,
    note: columnsExist
      ? 'Migration successful! treatment_type column now exists.'
      : 'RPC not available. Run the SQL migration directly in Supabase SQL Editor.',
    sqlForManualRun: `
-- Add treatment_type column
ALTER TABLE user_notification_settings
ADD COLUMN IF NOT EXISTS treatment_type TEXT DEFAULT 'alerts';

-- Add index for treatment_type queries
CREATE INDEX IF NOT EXISTS idx_user_notification_settings_treatment_type
ON user_notification_settings(treatment_type);

-- Create experiment_log table if not exists
CREATE TABLE IF NOT EXISTS experiment_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,
  action TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes on experiment_log
CREATE INDEX IF NOT EXISTS idx_experiment_log_user_email ON experiment_log(user_email);
CREATE INDEX IF NOT EXISTS idx_experiment_log_action ON experiment_log(action);
CREATE INDEX IF NOT EXISTS idx_experiment_log_reason ON experiment_log(reason);
CREATE INDEX IF NOT EXISTS idx_experiment_log_created_at ON experiment_log(created_at);
`,
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
  const hasTreatmentType = columns.includes('treatment_type');

  // Check experiment_log table
  const { error: logError } = await supabase
    .from('experiment_log')
    .select('id')
    .limit(1);

  const experimentLogExists = !logError;

  // Get treatment type distribution if column exists
  let treatmentCounts: Record<string, number> = {};
  if (hasTreatmentType) {
    const { data: users } = await supabase
      .from('user_notification_settings')
      .select('treatment_type');

    if (users) {
      for (const user of users) {
        const type = user.treatment_type || 'alerts';
        treatmentCounts[type] = (treatmentCounts[type] || 0) + 1;
      }
    }
  }

  return NextResponse.json({
    success: true,
    currentColumns: columns,
    hasTreatmentType,
    experimentLogExists,
    treatmentCounts,
    migrationNeeded: !hasTreatmentType || !experimentLogExists,
  });
}
