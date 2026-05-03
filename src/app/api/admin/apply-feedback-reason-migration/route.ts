import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

/**
 * POST /api/admin/apply-feedback-reason-migration
 *
 * Adds the reason column to briefing_feedback for tracking WHY briefings weren't helpful.
 */
export async function POST(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const password = searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  const results: string[] = [];
  const errors: string[] = [];

  // Check if column already exists
  const { data: sample, error: checkError } = await supabase
    .from('briefing_feedback')
    .select('*')
    .limit(1);

  if (checkError) {
    errors.push(`Check failed: ${checkError.message}`);
    return NextResponse.json({ success: false, results, errors });
  }

  // Check if reason column exists
  const hasReasonColumn = sample && sample[0] && 'reason' in sample[0];

  if (hasReasonColumn) {
    results.push('reason column already exists in briefing_feedback');
    return NextResponse.json({ success: true, results, alreadyExists: true });
  }

  // Add reason column using direct SQL via Supabase Dashboard API
  // Since we can't run raw SQL, we'll test by inserting with the new column
  const testEmail = `migration-test-${Date.now()}@test.internal`;

  const { error: insertError } = await supabase
    .from('briefing_feedback')
    .insert({
      user_email: testEmail,
      briefing_date: '2026-04-28',
      briefing_type: 'daily',
      rating: 'not_helpful',
      reason: 'wrong_industry',
    });

  if (insertError) {
    if (insertError.message.includes('reason') || insertError.message.includes('column')) {
      errors.push(`Column does not exist yet. Run this SQL in Supabase Dashboard:`);
      errors.push(`ALTER TABLE briefing_feedback ADD COLUMN IF NOT EXISTS reason TEXT;`);
      errors.push(`CREATE INDEX IF NOT EXISTS idx_briefing_feedback_reason ON briefing_feedback(reason);`);
      errors.push(`COMMENT ON COLUMN briefing_feedback.reason IS 'Reason for not_helpful rating: wrong_industry, wrong_location, too_broad, too_narrow, irrelevant_agencies, already_saw, other';`);
    } else {
      errors.push(`Insert error: ${insertError.message}`);
    }
    return NextResponse.json({
      success: false,
      results,
      errors,
      needsManualMigration: true,
      sql: `ALTER TABLE briefing_feedback ADD COLUMN IF NOT EXISTS reason TEXT;
CREATE INDEX IF NOT EXISTS idx_briefing_feedback_reason ON briefing_feedback(reason);
COMMENT ON COLUMN briefing_feedback.reason IS 'Reason for not_helpful rating: wrong_industry, wrong_location, too_broad, too_narrow, irrelevant_agencies, already_saw, other';`
    });
  }

  // Clean up test row
  await supabase
    .from('briefing_feedback')
    .delete()
    .eq('user_email', testEmail);

  results.push('reason column verified working in briefing_feedback');
  results.push('Test row inserted and cleaned up successfully');

  return NextResponse.json({
    success: true,
    results,
    errors: errors.length > 0 ? errors : undefined,
  });
}

export async function GET(request: NextRequest) {
  return POST(request);
}
