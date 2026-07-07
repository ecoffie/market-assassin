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
import { getReadClient } from '@/lib/supabase/server-clients';
import { isExcludedFromMetrics } from '@/lib/mindy/campaign-exclusions';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const days = parseInt(searchParams.get('days') || '7');
  const userEmail = searchParams.get('email');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Pure read-only analytics (GET, no writes) → read replica to keep off the primary.
  const supabase = getReadClient();

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
      briefingsSent,
      alertsSent,
      emailsOpened,
      linksClicked,
      topLinks,
      dailyTrends,
      topEngagedUsers,
      hiddenMatchImpressions,
    ] = await Promise.all([
      // Total briefings sent
      supabase
        .from('briefing_log')
        .select('*', { count: 'exact', head: true })
        .eq('delivery_status', 'sent')
        .gte('email_sent_at', startDateStr),

      // Total alerts sent
      supabase
        .from('alert_log')
        .select('*', { count: 'exact', head: true })
        .eq('delivery_status', 'sent')
        .gte('sent_at', startDateStr),

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

      // Top clicked links (by metadata.link_text label)
      supabase
        .from('user_engagement')
        .select('metadata')
        .eq('event_type', 'link_click')
        .gte('created_at', startDateStr),

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

      // Hidden-match CTR (#Phase-3): impressions come from alert_log
      // opportunities_data entries flagged hiddenMatch:true, vs regular opps.
      // Paired with the click counts (by link_text label) to compute CTR for each
      // and answer "do hidden matches get clicked as much as regular opps?".
      supabase
        .from('alert_log')
        .select('opportunities_data')
        .eq('delivery_status', 'sent')
        .gte('alert_date', startDateStr.split('T')[0]),
    ]);

    // Calculate metrics
    const totalBriefingsSent = briefingsSent.count || 0;
    const totalAlertsSent = alertsSent.count || 0;
    const totalSent = totalBriefingsSent + totalAlertsSent;
    const totalOpens = emailsOpened.count || 0;
    const totalClicks = linksClicked.count || 0;

    const openRate = totalSent > 0 ? ((totalOpens / totalSent) * 100).toFixed(1) : '0';
    const clickThroughRate = totalOpens > 0 ? ((totalClicks / totalOpens) * 100).toFixed(1) : '0';
    const clickToSendRate = totalSent > 0 ? ((totalClicks / totalSent) * 100).toFixed(1) : '0';

    // Aggregate top links
    const linkCounts: Record<string, number> = {};
    for (const row of topLinks.data || []) {
      const metadata = (row.metadata || {}) as Record<string, unknown>;
      const label = typeof metadata.link_text === 'string' && metadata.link_text
        ? metadata.link_text
        : 'unknown';
      linkCounts[label] = (linkCounts[label] || 0) + 1;
    }
    const sortedLinks = Object.entries(linkCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([label, count]) => ({ label, count }));

    // Hidden-match CTR vs regular-opp CTR — the readout that gates the
    // hidden-match rollout ramp (25→50→100%). Clicks come from the link_text
    // label (hidden_match_opportunity vs sam_gov_opportunity); impressions from
    // alert_log opportunities_data entries (hiddenMatch:true vs the rest).
    // Success = hidden-match CTR ≥ regular-opp CTR.
    let hiddenImpr = 0;
    let regularImpr = 0;
    for (const row of hiddenMatchImpressions.data || []) {
      const opps = Array.isArray(row.opportunities_data) ? row.opportunities_data : [];
      for (const o of opps) {
        if (o && typeof o === 'object' && (o as Record<string, unknown>).hiddenMatch === true) hiddenImpr++;
        else regularImpr++;
      }
    }
    const hiddenClicks = linkCounts['hidden_match_opportunity'] || 0;
    const regularClicks = linkCounts['sam_gov_opportunity'] || 0;
    const pct = (n: number, d: number) => (d > 0 ? Number(((n / d) * 100).toFixed(2)) : null);
    const hiddenMatchCtr = {
      hidden: { impressions: hiddenImpr, clicks: hiddenClicks, ctr: pct(hiddenClicks, hiddenImpr) },
      regular: { impressions: regularImpr, clicks: regularClicks, ctr: pct(regularClicks, regularImpr) },
      // Null until hidden-match is enabled and has accumulated sends (gated OFF
      // by default — no data is expected yet). verdict compares the two CTRs.
      verdict: hiddenImpr === 0
        ? 'no hidden-match data yet (feature gated off or no sends in window)'
        : (pct(hiddenClicks, hiddenImpr) ?? 0) >= (pct(regularClicks, regularImpr) ?? 0)
          ? 'hidden ≥ regular — safe to ramp rollout'
          : 'hidden < regular — hold / raise threshold before ramping',
    };

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
      if (!email || isExcludedFromMetrics(email)) continue; // skip comp/advocate/partner
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
        briefingsSent: totalBriefingsSent,
        alertsSent: totalAlertsSent,
        emailsOpened: totalOpens,
        linksClicked: totalClicks,
        openRate: `${openRate}%`,
        clickThroughRate: `${clickThroughRate}%`,
        clickToSendRate: `${clickToSendRate}%`,
      },
      topLinks: sortedLinks,
      hiddenMatchCtr,
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
      .select('event_type, event_source, metadata, created_at')
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
