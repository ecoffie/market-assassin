/**
 * Admin: Engagement Metrics Dashboard API
 *
 * Provides comprehensive email engagement analytics:
 * - Open rates (emails sent vs opened)
 * - Click-through rates (opens vs clicks)
 * - Most clicked links
 * - Daily/weekly trends
 * - Top engaged users
 *
 * GET ?password=...&days=7 - Get metrics for last N days (default 7)
 * GET ?password=...&email=user@example.com - Get metrics for specific user
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const days = parseInt(searchParams.get('days') || '7');
  const userEmail = searchParams.get('email');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString();

  try {
    // If specific user requested
    if (userEmail) {
      return await getUserMetrics(supabase, userEmail, startDateStr);
    }

    // Get overall metrics
    const [
      emailsSent,
      emailsOpened,
      linksClicked,
      topLinks,
      dailyTrends,
      topEngagedUsers,
    ] = await Promise.all([
      // Total emails sent (briefing_log entries with sent status)
      supabase
        .from('briefing_log')
        .select('*', { count: 'exact', head: true })
        .eq('delivery_status', 'sent')
        .gte('email_sent_at', startDateStr),

      // Unique email opens
      supabase
        .from('user_engagement')
        .select('*', { count: 'exact', head: true })
        .eq('event_type', 'email_open')
        .gte('created_at', startDateStr),

      // Total link clicks
      supabase
        .from('user_engagement')
        .select('*', { count: 'exact', head: true })
        .eq('event_type', 'link_click')
        .gte('created_at', startDateStr),

      // Top clicked links (by link_text label)
      supabase
        .from('user_engagement')
        .select('link_text')
        .eq('event_type', 'link_click')
        .gte('created_at', startDateStr)
        .not('link_text', 'is', null),

      // Daily engagement trends
      supabase
        .from('user_engagement')
        .select('event_type, created_at')
        .gte('created_at', startDateStr)
        .order('created_at', { ascending: true }),

      // Top engaged users (most opens + clicks)
      supabase
        .from('user_engagement')
        .select('user_email, event_type')
        .gte('created_at', startDateStr)
        .not('user_email', 'is', null),
    ]);

    // Calculate metrics
    const totalSent = emailsSent.count || 0;
    const totalOpens = emailsOpened.count || 0;
    const totalClicks = linksClicked.count || 0;

    const openRate = totalSent > 0 ? ((totalOpens / totalSent) * 100).toFixed(1) : '0';
    const clickThroughRate = totalOpens > 0 ? ((totalClicks / totalOpens) * 100).toFixed(1) : '0';
    const clickToSendRate = totalSent > 0 ? ((totalClicks / totalSent) * 100).toFixed(1) : '0';

    // Aggregate top links
    const linkCounts: Record<string, number> = {};
    for (const row of topLinks.data || []) {
      const label = row.link_text || 'unknown';
      linkCounts[label] = (linkCounts[label] || 0) + 1;
    }
    const sortedLinks = Object.entries(linkCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([label, count]) => ({ label, count }));

    // Aggregate daily trends
    const dailyData: Record<string, { opens: number; clicks: number }> = {};
    for (const row of dailyTrends.data || []) {
      const date = new Date(row.created_at).toISOString().split('T')[0];
      if (!dailyData[date]) {
        dailyData[date] = { opens: 0, clicks: 0 };
      }
      if (row.event_type === 'email_open') {
        dailyData[date].opens++;
      } else if (row.event_type === 'link_click') {
        dailyData[date].clicks++;
      }
    }
    const trends = Object.entries(dailyData)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, data]) => ({ date, ...data }));

    // Aggregate top engaged users
    const userEngagement: Record<string, { opens: number; clicks: number }> = {};
    for (const row of topEngagedUsers.data || []) {
      const email = row.user_email;
      if (!email) continue;
      if (!userEngagement[email]) {
        userEngagement[email] = { opens: 0, clicks: 0 };
      }
      if (row.event_type === 'email_open') {
        userEngagement[email].opens++;
      } else if (row.event_type === 'link_click') {
        userEngagement[email].clicks++;
      }
    }
    const topUsers = Object.entries(userEngagement)
      .map(([email, data]) => ({
        email,
        opens: data.opens,
        clicks: data.clicks,
        total: data.opens + data.clicks,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 20);

    return NextResponse.json({
      period: {
        days,
        startDate: startDateStr,
        endDate: new Date().toISOString(),
      },
      summary: {
        emailsSent: totalSent,
        emailsOpened: totalOpens,
        linksClicked: totalClicks,
        openRate: `${openRate}%`,
        clickThroughRate: `${clickThroughRate}%`,
        clickToSendRate: `${clickToSendRate}%`,
      },
      topLinks: sortedLinks,
      dailyTrends: trends,
      topEngagedUsers: topUsers,
    });

  } catch (error) {
    console.error('[EngagementMetrics] Error:', error);
    return NextResponse.json({
      error: String(error),
    }, { status: 500 });
  }
}

/**
 * Get metrics for a specific user
 */
async function getUserMetrics(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userEmail: string,
  startDateStr: string
) {
  const [
    opensResult,
    clicksResult,
    recentActivity,
  ] = await Promise.all([
    // User's opens
    supabase
      .from('user_engagement')
      .select('*', { count: 'exact', head: true })
      .eq('user_email', userEmail.toLowerCase())
      .eq('event_type', 'email_open')
      .gte('created_at', startDateStr),

    // User's clicks
    supabase
      .from('user_engagement')
      .select('*', { count: 'exact', head: true })
      .eq('user_email', userEmail.toLowerCase())
      .eq('event_type', 'link_click')
      .gte('created_at', startDateStr),

    // Recent activity (last 20 events)
    supabase
      .from('user_engagement')
      .select('event_type, link_text, page_url, created_at')
      .eq('user_email', userEmail.toLowerCase())
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  return NextResponse.json({
    userEmail,
    opens: opensResult.count || 0,
    clicks: clicksResult.count || 0,
    recentActivity: recentActivity.data || [],
  });
}
