import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(request: NextRequest) {
  // Verify admin password
  const password = request.nextUrl.searchParams.get('password');
  if (password !== (process.env.ADMIN_PASSWORD || 'galata-assassin-2026')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    // Check if column exists first
    const { data: sample, error: sampleError } = await supabase
      .from('briefing_log')
      .select('*')
      .limit(1);

    if (sampleError) {
      return NextResponse.json({ error: sampleError.message }, { status: 500 });
    }

    const columnExists = sample && sample.length > 0 && 'briefing_type' in sample[0];

    if (columnExists) {
      return NextResponse.json({
        success: true,
        message: 'Column briefing_type already exists',
        columnExists: true,
      });
    }

    // Column doesn't exist - return instructions for manual execution
    return NextResponse.json({
      success: false,
      message: 'Column briefing_type does NOT exist. Run POST to apply migration.',
      sql: `
ALTER TABLE briefing_log
ADD COLUMN IF NOT EXISTS briefing_type TEXT DEFAULT 'daily'
CHECK (briefing_type IN ('daily', 'weekly', 'pursuit'));

CREATE INDEX IF NOT EXISTS idx_briefing_log_type
ON briefing_log(briefing_type, briefing_date);

CREATE INDEX IF NOT EXISTS idx_briefing_log_date_user_type
ON briefing_log(briefing_date, user_email, briefing_type);
      `,
      columnExists: false,
    });

  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  // Verify admin password
  const password = request.nextUrl.searchParams.get('password');
  if (password !== (process.env.ADMIN_PASSWORD || 'galata-assassin-2026')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // First check if column already exists
  const { data: sample } = await supabase
    .from('briefing_log')
    .select('*')
    .limit(1);

  if (sample && sample.length > 0 && 'briefing_type' in sample[0]) {
    return NextResponse.json({
      success: true,
      message: 'Column briefing_type already exists - no migration needed',
      columnExists: true,
    });
  }

  // Column doesn't exist - try using the exec_sql RPC if available
  // Otherwise return SQL to run manually
  try {
    // Try calling an exec_sql function if it exists
    const { error: rpcError } = await supabase.rpc('exec_sql', {
      sql_query: `
        ALTER TABLE briefing_log
        ADD COLUMN IF NOT EXISTS briefing_type TEXT DEFAULT 'daily'
        CHECK (briefing_type IN ('daily', 'weekly', 'pursuit'));

        CREATE INDEX IF NOT EXISTS idx_briefing_log_type
        ON briefing_log(briefing_type, briefing_date);

        CREATE INDEX IF NOT EXISTS idx_briefing_log_date_user_type
        ON briefing_log(briefing_date, user_email, briefing_type);

        COMMENT ON COLUMN briefing_log.briefing_type IS 'Type of briefing: daily, weekly, or pursuit';
      `
    });

    if (rpcError) {
      // RPC function doesn't exist - return SQL for manual execution
      return NextResponse.json({
        success: false,
        message: 'No exec_sql RPC function available. Please run the SQL manually in Supabase Dashboard.',
        sql: `
-- Run this in Supabase Dashboard > SQL Editor

ALTER TABLE briefing_log
ADD COLUMN IF NOT EXISTS briefing_type TEXT DEFAULT 'daily'
CHECK (briefing_type IN ('daily', 'weekly', 'pursuit'));

CREATE INDEX IF NOT EXISTS idx_briefing_log_type
ON briefing_log(briefing_type, briefing_date);

CREATE INDEX IF NOT EXISTS idx_briefing_log_date_user_type
ON briefing_log(briefing_date, user_email, briefing_type);

COMMENT ON COLUMN briefing_log.briefing_type IS 'Type of briefing: daily, weekly, or pursuit';
        `,
        rpcError: rpcError.message,
      });
    }

    // Verify the column was added
    const { data: verify } = await supabase
      .from('briefing_log')
      .select('briefing_type')
      .limit(1);

    if (verify) {
      return NextResponse.json({
        success: true,
        message: 'Migration applied successfully! briefing_type column added to briefing_log.',
      });
    }

    return NextResponse.json({
      success: false,
      message: 'Migration may have partially applied. Please verify in Supabase Dashboard.',
    });

  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({
      error: msg,
      hint: 'Run the SQL manually in Supabase Dashboard > SQL Editor',
      sql: `
ALTER TABLE briefing_log
ADD COLUMN IF NOT EXISTS briefing_type TEXT DEFAULT 'daily'
CHECK (briefing_type IN ('daily', 'weekly', 'pursuit'));

CREATE INDEX IF NOT EXISTS idx_briefing_log_type
ON briefing_log(briefing_type, briefing_date);

CREATE INDEX IF NOT EXISTS idx_briefing_log_date_user_type
ON briefing_log(briefing_date, user_email, briefing_type);
      `
    }, { status: 500 });
  }
}
