/**
 * Admin: Generate a test briefing for a single user
 *
 * GET /api/admin/test-briefing?password=...&email=user@example.com
 *
 * Generates a briefing, saves to briefing_log, returns the result.
 * Does NOT send email/SMS.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateBriefing } from '@/lib/briefings/delivery';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const email = searchParams.get('email')?.toLowerCase().trim();

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!email) {
    return NextResponse.json({ error: 'Email required (?email=...)' }, { status: 400 });
  }

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

  try {
    // Ensure user has a notification settings profile (auto-create default if missing)
    const { data: existingProfile } = await getSupabase()
      .from('user_notification_settings')
      .select('user_email')
      .eq('user_email', email)
      .single();

    if (!existingProfile) {
      console.log(`[TestBriefing] Creating default notification profile for ${email}`);
      const defaultNaics = ['541512', '541511', '541519', '541513', '541330'];
      const defaultAgencies = [
        'Department of Defense',
        'Department of Homeland Security',
        'Department of Veterans Affairs',
        'General Services Administration',
        'Department of Health and Human Services',
      ];

      await getSupabase().from('user_notification_settings').upsert({
        user_email: email,
        naics_codes: defaultNaics,
        agencies: defaultAgencies,
        keywords: ['cybersecurity', 'IT modernization', 'cloud', 'data analytics'],
        alerts_enabled: true,
        briefings_enabled: true,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_email' });
    }

    console.log(`[TestBriefing] Generating briefing for ${email}...`);

    const briefing = await generateBriefing(email, {
      includeWebIntel: true,
      maxItems: 15,
    });

    if (!briefing || briefing.totalItems === 0) {
      return NextResponse.json({
        success: false,
        message: 'Briefing profile exists but no items generated. Data snapshot crons may not have run yet (opportunities, recompetes, awards run 7-7:45 AM UTC daily).',
        email,
        hint: 'The generator needs snapshot data in briefing_snapshots table. Wait for crons to run, or this is a fresh install with no data.',
      });
    }

    // Save to briefing_log
    const { error: upsertError } = await getSupabase().from('briefing_log').upsert({
      user_email: email,
      briefing_date: briefing.briefingDate,
      briefing_content: briefing,
      items_count: briefing.totalItems,
      tools_included: briefing.sourcesIncluded,
      delivery_status: 'sent',
      created_at: new Date().toISOString(),
    }, { onConflict: 'user_email,briefing_date' });

    if (upsertError) {
      console.error('[TestBriefing] Upsert error:', upsertError);
    }

    return NextResponse.json({
      success: true,
      email,
      briefing_date: briefing.briefingDate,
      total_items: briefing.totalItems,
      sources: briefing.sourcesIncluded,
      saved_to_log: !upsertError,
      headline: briefing.summary.headline,
      briefing,
    });
  } catch (err) {
    console.error('[TestBriefing] Error:', err);
    return NextResponse.json({
      success: false,
      error: String(err),
      email,
    }, { status: 500 });
  }
}
