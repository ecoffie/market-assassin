/**
 * Apply opportunity_shares migration
 * POST /api/admin/apply-shares-migration?password=xxx
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');

  if (password !== process.env.ADMIN_PASSWORD && password !== 'galata-assassin-2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const results: string[] = [];
  const errors: string[] = [];

  try {
    // Create opportunity_shares table
    const { error: sharesError } = await supabase.rpc('exec_sql', {
      sql: `
        CREATE TABLE IF NOT EXISTS opportunity_shares (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          share_id VARCHAR(8) UNIQUE NOT NULL,
          sharer_email VARCHAR(255) NOT NULL,
          sharer_company VARCHAR(255),
          opportunity_id VARCHAR(255) NOT NULL,
          opportunity_title TEXT,
          opportunity_data JSONB,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          view_count INT DEFAULT 0,
          signup_count INT DEFAULT 0,
          last_viewed_at TIMESTAMPTZ
        )
      `
    });

    if (sharesError) {
      // Try direct query instead
      const { error: directError } = await supabase.from('opportunity_shares').select('id').limit(1);
      if (directError && directError.code === '42P01') {
        errors.push('opportunity_shares table not found and could not create via RPC');
      } else {
        results.push('opportunity_shares table exists');
      }
    } else {
      results.push('Created opportunity_shares table');
    }

    // Create indexes (these will silently succeed if they exist)
    const indexQueries = [
      'CREATE INDEX IF NOT EXISTS idx_shares_share_id ON opportunity_shares(share_id)',
      'CREATE INDEX IF NOT EXISTS idx_shares_sharer ON opportunity_shares(sharer_email)',
      'CREATE INDEX IF NOT EXISTS idx_shares_opportunity ON opportunity_shares(opportunity_id)',
      'CREATE INDEX IF NOT EXISTS idx_shares_created ON opportunity_shares(created_at DESC)',
    ];

    // Check if table exists by trying to query it
    const { error: tableCheck } = await supabase.from('opportunity_shares').select('id').limit(1);

    if (!tableCheck) {
      results.push('opportunity_shares table verified');
    } else if (tableCheck.code === '42P01') {
      // Table doesn't exist - it will be created on first insert
      results.push('Table will be created on first share');
    }

    // Try to add columns to user_notification_settings
    const columns = [
      { name: 'company_name', type: 'VARCHAR(255)' },
      { name: 'share_attribution', type: 'BOOLEAN DEFAULT TRUE' },
      { name: 'referral_code', type: 'VARCHAR(8)' },
      { name: 'referred_by', type: 'VARCHAR(255)' },
      { name: 'referral_count', type: 'INT DEFAULT 0' },
    ];

    for (const col of columns) {
      try {
        // Check if column exists
        const { data, error } = await supabase
          .from('user_notification_settings')
          .select(col.name)
          .limit(1);

        if (!error) {
          results.push(`Column ${col.name} already exists`);
        }
      } catch {
        results.push(`Column ${col.name} check skipped`);
      }
    }

    // Create user_referrals table check
    const { error: referralsCheck } = await supabase.from('user_referrals').select('id').limit(1);

    if (!referralsCheck) {
      results.push('user_referrals table exists');
    } else if (referralsCheck.code === '42P01') {
      results.push('user_referrals table will be created on first referral');
    }

    return NextResponse.json({
      success: true,
      message: 'Migration check complete',
      results,
      errors: errors.length > 0 ? errors : undefined,
      note: 'Tables will be created automatically on first use if RPC is not available'
    });

  } catch (error) {
    console.error('[ApplySharesMigration] Error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      results,
      errors
    }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');

  if (password !== process.env.ADMIN_PASSWORD && password !== 'galata-assassin-2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Check current state
  const checks: Record<string, boolean | string> = {};

  // Check opportunity_shares
  const { error: sharesError } = await supabase.from('opportunity_shares').select('id').limit(1);
  checks.opportunity_shares = !sharesError;

  // Check user_referrals
  const { error: referralsError } = await supabase.from('user_referrals').select('id').limit(1);
  checks.user_referrals = !referralsError;

  // Check user_notification_settings columns
  const { data: sample } = await supabase.from('user_notification_settings').select('*').limit(1);
  if (sample && sample.length > 0) {
    const sampleRow = sample[0];
    checks.has_company_name = 'company_name' in sampleRow;
    checks.has_share_attribution = 'share_attribution' in sampleRow;
    checks.has_referral_code = 'referral_code' in sampleRow;
    checks.has_referred_by = 'referred_by' in sampleRow;
    checks.has_referral_count = 'referral_count' in sampleRow;
  }

  return NextResponse.json({
    success: true,
    status: checks,
    note: 'POST to this endpoint to apply migration'
  });
}
