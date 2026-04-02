/**
 * Admin: Debug briefing snapshots
 *
 * GET /api/admin/debug-snapshots?password=...&email=user@example.com
 *
 * Shows raw snapshot data for a user to debug briefing generation.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  // 1. Get user profile from unified table
  const { data: profile, error: profileError } = await supabase
    .from('user_notification_settings')
    .select('*')
    .eq('user_email', email)
    .single();

  // 2. Get today's snapshots
  const { data: todaySnapshots, error: todayError } = await supabase
    .from('briefing_snapshots')
    .select('tool, snapshot_date, raw_data, created_at')
    .eq('user_email', email)
    .eq('snapshot_date', today);

  // 3. Get yesterday's snapshots
  const { data: yesterdaySnapshots, error: yesterdayError } = await supabase
    .from('briefing_snapshots')
    .select('tool, snapshot_date, raw_data, created_at')
    .eq('user_email', email)
    .eq('snapshot_date', yesterday);

  // 4. Process snapshots like the generator does
  const organizedToday: Record<string, { itemCount: number; hasItems: boolean }> = {};

  for (const snap of (todaySnapshots || [])) {
    const data = snap.raw_data as { items?: unknown[]; signals?: unknown[] } | null;
    organizedToday[snap.tool] = {
      itemCount: data?.items?.length || data?.signals?.length || 0,
      hasItems: !!(data?.items?.length || data?.signals?.length),
    };
  }

  return NextResponse.json({
    email,
    dates: { today, yesterday },
    profile: {
      exists: !!profile,
      error: profileError?.message,
      hasAggregatedProfile: !!profile?.aggregated_profile,
      aggregatedProfile: profile?.aggregated_profile,
    },
    todaySnapshots: {
      count: todaySnapshots?.length || 0,
      error: todayError?.message,
      tools: todaySnapshots?.map(s => s.tool) || [],
      organized: organizedToday,
      raw: todaySnapshots?.map(s => ({
        tool: s.tool,
        date: s.snapshot_date,
        dataType: typeof s.raw_data,
        dataIsNull: s.raw_data === null,
        dataIsObject: typeof s.raw_data === 'object',
        hasItemsKey: s.raw_data && typeof s.raw_data === 'object' && 'items' in (s.raw_data as object),
        hasSignalsKey: s.raw_data && typeof s.raw_data === 'object' && 'signals' in (s.raw_data as object),
        itemCount: (s.raw_data as { items?: unknown[] })?.items?.length || 0,
        signalsCount: (s.raw_data as { signals?: unknown[] })?.signals?.length || 0,
        sample: JSON.stringify(s.raw_data).slice(0, 500),
      })),
    },
    yesterdaySnapshots: {
      count: yesterdaySnapshots?.length || 0,
      error: yesterdayError?.message,
      tools: yesterdaySnapshots?.map(s => s.tool) || [],
    },
  });
}
