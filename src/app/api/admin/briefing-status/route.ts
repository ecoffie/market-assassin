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

const EXPECTED_SCHEDULE = {
  daily: [0, 1, 2, 3, 4, 5, 6], // Every day
  weekly: [0],                   // Sunday only
  pursuit: [1],                  // Monday only
};

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
  // Note: briefing_log uses email_sent_at (not sent_at) and tools_included (not briefing_type)
  const { data: todayBriefings, error: briefingError } = await supabase
    .from('briefing_log')
    .select('user_email, email_sent_at, delivery_status, tools_included')
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

  // Get pursuit briefs sent today (they're in briefing_log with tools_included containing 'pursuit_brief')
  // Note: pursuit_brief_log table doesn't exist - pursuit briefs are tracked in briefing_log
  const todayPursuits = (todayBriefings || []).filter(b =>
    b.tools_included?.includes('pursuit_brief')
  );

  // Analyze for anomalies
  const anomalies: string[] = [];

  // Check if weekly briefings sent on wrong day
  const weeklyCount = (todayBriefings || []).filter(b =>
    b.tools_included?.includes('weekly_deep_dive')
  ).length;
  if (weeklyCount > 0 && dayOfWeek !== 0) {
    anomalies.push(`⚠️ ${weeklyCount} Weekly Deep Dive emails sent on ${dayName} (should be Sunday only)`);
  }

  // Check if pursuit briefs sent on wrong day
  const pursuitCount = (todayPursuits || []).length;
  if (pursuitCount > 0 && dayOfWeek !== 1) {
    anomalies.push(`⚠️ ${pursuitCount} Pursuit Briefs sent on ${dayName} (should be Monday only)`);
  }

  // Summary counts
  const summary = {
    date: todayUTC,
    dayOfWeek: dayName,
    dayNumber: dayOfWeek,
    counts: {
      dailyBriefings: (todayBriefings || []).filter(b =>
        b.tools_included?.includes('daily_brief')
      ).length,
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

  // Recent sends sample
  const recentSends = {
    briefings: (todayBriefings || []).slice(0, 10).map(b => ({
      email: b.user_email,
      type: b.tools_included?.join(', ') || 'unknown',
      sentAt: b.email_sent_at,
      status: b.delivery_status,
    })),
    alerts: (todayAlerts || []).slice(0, 10).map(a => ({
      email: a.user_email,
      opps: a.opportunities_count,
      sentAt: a.sent_at,
      status: a.delivery_status,
    })),
    pursuits: todayPursuits.slice(0, 10).map(p => ({
      email: p.user_email,
      type: p.tools_included?.join(', ') || 'pursuit_brief',
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
