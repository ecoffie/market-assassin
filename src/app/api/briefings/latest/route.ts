/**
 * Public Briefing API
 *
 * Returns a user's latest briefing(s) as JSON.
 * Auth: email + briefings entitlement check (KV and/or user_profiles).
 *
 * GET /api/briefings/latest?email=user@example.com         → latest briefing
 * GET /api/briefings/latest?email=user@example.com&days=7  → last 7 days (max 30)
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { hasBriefingsAccess } from '@/lib/briefings/access';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get('email')?.toLowerCase().trim();
  const daysParam = searchParams.get('days');
  const days = daysParam ? Math.min(Math.max(parseInt(daysParam, 10) || 1, 1), 30) : 1;

  if (!email) {
    return NextResponse.json({ error: 'Email required' }, { status: 400 });
  }

  // Check briefing access via KV and paid entitlement fallback
  const hasAccess = await hasBriefingsAccess(email);
  if (!hasAccess) {
    return NextResponse.json({ error: 'No briefing access' }, { status: 403 });
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

  // Filter out future-dated briefings (pursuit briefs are scheduled for next Monday)
  // and show only briefings up to today
  const today = new Date().toISOString().split('T')[0];

  const { data, error } = await getSupabase()
    .from('briefing_log')
    .select('briefing_date, briefing_content, items_count, created_at')
    .eq('user_email', email)
    .lte('briefing_date', today)
    .order('briefing_date', { ascending: false })
    .limit(days);

  if (error) {
    console.error('[BriefingsAPI] Supabase error:', error);
    return NextResponse.json({ error: 'Failed to fetch briefings' }, { status: 500 });
  }

  if (!data || data.length === 0) {
    return NextResponse.json({
      success: true,
      briefing: null,
      message: 'No briefings found. Briefings are generated daily at 7 AM UTC.',
    });
  }

  if (days === 1) {
    return NextResponse.json({
      success: true,
      briefing: data[0].briefing_content,
      briefing_date: data[0].briefing_date,
      generated_at: data[0].created_at,
    });
  }

  return NextResponse.json({
    success: true,
    count: data.length,
    briefings: data.map((d: { briefing_date: string; created_at: string; items_count: number; briefing_content: unknown }) => ({
      briefing_date: d.briefing_date,
      generated_at: d.created_at,
      items_count: d.items_count,
      content: d.briefing_content,
    })),
  });
}
