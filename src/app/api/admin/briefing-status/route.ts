/**
 * Briefing Status Monitor
 *
 * Quick health check for briefing system:
 * - What was sent today
 * - Any unexpected sends (wrong day)
 * - System health summary
 *
 * Usage: GET /api/admin/briefing-status?password=galata-assassin-2026
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Schedule constants: daily = every day, weekly = Sunday (0), pursuit = Monday (1)

export async function GET(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');

  if (password !== process.env.ADMIN_PASSWORD && password !== 'galata-assassin-2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const now = new Date();
  const todayUTC = now.toISOString().split('T')[0];
  const dayOfWeek = now.getUTCDay();
  const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek];

  // Get today's briefing sends
  // briefing_log uses email_sent_at and briefing_type ('daily', 'weekly', 'pursuit')
  const { data: todayBriefings, error: briefingError } = await supabase
    .from('briefing_log')
    .select('user_email, email_sent_at, delivery_status, briefing_type, tools_included')
    .gte('email_sent_at', `${todayUTC}T00:00:00Z`)
    .order('email_sent_at', { ascending: false })
    .limit(100);

  // Get today's alerts
  const { data: todayAlerts, error: alertError } = await supabase
    .from('alert_log')
    .select('user_email, alert_date, sent_at, delivery_status, opportunities_count')
    .eq('alert_date', todayUTC)
    .order('sent_at', { ascending: false })
    .limit(100);

  // Count by briefing_type (primary) with tools_included fallback for legacy records
  const dailyCount = (todayBriefings || []).filter(b =>
    b.briefing_type === 'daily' ||
    (!b.briefing_type && (b.tools_included?.includes('daily_market_intel') || b.tools_included?.includes('sam_cache_green')))
  ).length;

  const weeklyCount = (todayBriefings || []).filter(b =>
    b.briefing_type === 'weekly' ||
    (!b.briefing_type && b.tools_included?.includes('weekly_deep_dive'))
  ).length;

  const pursuitCount = (todayBriefings || []).filter(b =>
    b.briefing_type === 'pursuit' ||
    (!b.briefing_type && b.tools_included?.includes('pursuit_brief'))
  ).length;

  // Analyze for anomalies
  const anomalies: string[] = [];
  if (weeklyCount > 0 && dayOfWeek !== 0) {
    anomalies.push(`⚠️ ${weeklyCount} Weekly Deep Dive emails sent on ${dayName} (should be Sunday only)`);
  }

  // Check if pursuit briefs sent on wrong day
  if (pursuitCount > 0 && dayOfWeek !== 1) {
    anomalies.push(`⚠️ ${pursuitCount} Pursuit Briefs sent on ${dayName} (should be Monday only)`);
  }

  // Summary counts - use briefing_type as primary discriminator
  const summary = {
    date: todayUTC,
    dayOfWeek: dayName,
    dayNumber: dayOfWeek,
    counts: {
      dailyBriefings: dailyCount,
      weeklyBriefings: weeklyCount,
      pursuitBriefs: pursuitCount,
      dailyAlerts: (todayAlerts || []).length,
    },
    expectedToday: {
      daily: true,
      weekly: dayOfWeek === 0,
      pursuit: dayOfWeek === 1,
    },
    anomalies,
    health: anomalies.length === 0 ? '✅ HEALTHY' : '⚠️ CHECK ANOMALIES',
  };

  // Recent sends sample - use briefing_type for display
  const recentSends = {
    briefings: (todayBriefings || []).slice(0, 10).map(b => ({
      email: b.user_email,
      type: b.briefing_type || b.tools_included?.join(', ') || 'unknown',
      sentAt: b.email_sent_at,
      status: b.delivery_status,
    })),
    alerts: (todayAlerts || []).slice(0, 10).map(a => ({
      email: a.user_email,
      opps: a.opportunities_count,
      sentAt: a.sent_at,
      status: a.delivery_status,
    })),
    // Pursuit briefs filtered by briefing_type
    pursuits: (todayBriefings || [])
      .filter(b => b.briefing_type === 'pursuit' || (!b.briefing_type && b.tools_included?.includes('pursuit_brief')))
      .slice(0, 10)
      .map(p => ({
        email: p.user_email,
        type: p.briefing_type || 'pursuit',
        sentAt: p.email_sent_at,
        status: p.delivery_status,
      })),
  };

  return NextResponse.json({
    success: true,
    summary,
    recentSends,
    errors: {
      briefing: briefingError?.message,
      alert: alertError?.message,
      // pursuit briefs are now tracked in briefing_log, not a separate table
    },
  });
}
