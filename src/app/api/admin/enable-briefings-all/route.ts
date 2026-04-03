/**
 * Enable Briefings for ALL Users
 *
 * One-time admin endpoint to enable briefings for all users
 * in user_notification_settings table.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');
  const expectedPassword = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

  if (password !== expectedPassword) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    // Count before
    const { count: beforeCount } = await supabase
      .from('user_notification_settings')
      .select('*', { count: 'exact', head: true })
      .eq('briefings_enabled', true);

    // Update all users to have briefings_enabled = true
    const { error } = await supabase
      .from('user_notification_settings')
      .update({
        briefings_enabled: true,
        updated_at: new Date().toISOString()
      })
      .eq('is_active', true);

    if (error) {
      console.error('[EnableBriefingsAll] Error:', error);
      return NextResponse.json({
        success: false,
        error: error.message
      }, { status: 500 });
    }

    // Count after
    const { count: afterCount } = await supabase
      .from('user_notification_settings')
      .select('*', { count: 'exact', head: true })
      .eq('briefings_enabled', true);

    console.log(`[EnableBriefingsAll] Enabled briefings: ${beforeCount} -> ${afterCount}`);

    return NextResponse.json({
      success: true,
      message: 'Briefings enabled for all active users',
      before: beforeCount,
      after: afterCount,
      newlyEnabled: (afterCount || 0) - (beforeCount || 0)
    });
  } catch (err) {
    console.error('[EnableBriefingsAll] Fatal error:', err);
    return NextResponse.json({
      success: false,
      error: String(err)
    }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');
  const expectedPassword = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

  if (password !== expectedPassword) {
    return NextResponse.json({
      error: 'Unauthorized',
      usage: 'POST ?password=xxx to enable briefings for all users'
    }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Preview mode - show counts
  const { count: totalActive } = await supabase
    .from('user_notification_settings')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true);

  const { count: briefingsEnabled } = await supabase
    .from('user_notification_settings')
    .select('*', { count: 'exact', head: true })
    .eq('briefings_enabled', true);

  const { count: briefingsDisabled } = await supabase
    .from('user_notification_settings')
    .select('*', { count: 'exact', head: true })
    .eq('briefings_enabled', false)
    .eq('is_active', true);

  return NextResponse.json({
    mode: 'preview',
    totalActive,
    briefingsEnabled,
    briefingsDisabled,
    willEnable: briefingsDisabled,
    instructions: 'POST ?password=xxx to enable briefings for all users'
  });
}
