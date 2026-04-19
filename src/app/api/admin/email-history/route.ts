/**
 * Email History API
 *
 * View all sent alerts and briefings with filtering
 * GET /api/admin/email-history?password=xxx&email=xxx&type=alert|briefing
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

export async function GET(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');
  const emailFilter = request.nextUrl.searchParams.get('email');
  const typeFilter = request.nextUrl.searchParams.get('type');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  interface EmailRecord {
    id: string;
    type: 'alert' | 'briefing';
    email: string;
    date: string;
    sentAt: string;
    status: string;
    details?: string;
  }

  const emails: EmailRecord[] = [];
  let totalAlerts = 0;
  let totalBriefings = 0;
  let last7Days = 0;
  let failedLast7Days = 0;

  // Fetch alerts
  if (!typeFilter || typeFilter === 'alert') {
    let alertQuery = supabase
      .from('alert_log')
      .select('id, user_email, alert_date, sent_at, delivery_status, opportunities_count')
      .order('sent_at', { ascending: false })
      .limit(200);

    if (emailFilter) {
      alertQuery = alertQuery.ilike('user_email', `%${emailFilter}%`);
    }

    const { data: alerts, error: alertError } = await alertQuery;

    if (!alertError && alerts) {
      for (const alert of alerts) {
        emails.push({
          id: `alert-${alert.id}`,
          type: 'alert',
          email: alert.user_email,
          date: alert.alert_date,
          sentAt: alert.sent_at,
          status: alert.delivery_status || 'unknown',
          details: alert.opportunities_count ? `${alert.opportunities_count} opps` : undefined,
        });
      }
    }

    // Get total alerts count
    const { count: alertCount } = await supabase
      .from('alert_log')
      .select('*', { count: 'exact', head: true });
    totalAlerts = alertCount || 0;

    // Get 7-day stats for alerts
    const { data: recentAlerts } = await supabase
      .from('alert_log')
      .select('delivery_status')
      .gte('alert_date', sevenDaysAgo);

    if (recentAlerts) {
      for (const a of recentAlerts) {
        last7Days++;
        if (a.delivery_status === 'failed') failedLast7Days++;
      }
    }
  }

  // Fetch briefings
  if (!typeFilter || typeFilter === 'briefing') {
    let briefingQuery = supabase
      .from('briefing_log')
      .select('id, user_email, briefing_date, email_sent_at, delivery_status, tools_included')
      .order('email_sent_at', { ascending: false })
      .limit(200);

    if (emailFilter) {
      briefingQuery = briefingQuery.ilike('user_email', `%${emailFilter}%`);
    }

    const { data: briefings, error: briefingError } = await briefingQuery;

    if (!briefingError && briefings) {
      for (const briefing of briefings) {
        emails.push({
          id: `briefing-${briefing.id}`,
          type: 'briefing',
          email: briefing.user_email,
          date: briefing.briefing_date,
          sentAt: briefing.email_sent_at,
          status: briefing.delivery_status || 'unknown',
          details: briefing.tools_included?.join(', ') || undefined,
        });
      }
    }

    // Get total briefings count
    const { count: briefingCount } = await supabase
      .from('briefing_log')
      .select('*', { count: 'exact', head: true });
    totalBriefings = briefingCount || 0;

    // Get 7-day stats for briefings
    const { data: recentBriefings } = await supabase
      .from('briefing_log')
      .select('delivery_status')
      .gte('briefing_date', sevenDaysAgo);

    if (recentBriefings) {
      for (const b of recentBriefings) {
        last7Days++;
        if (b.delivery_status === 'failed') failedLast7Days++;
      }
    }
  }

  // Sort all emails by sentAt descending
  emails.sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());

  return NextResponse.json({
    emails: emails.slice(0, 100), // Limit to 100 most recent
    stats: {
      totalAlerts,
      totalBriefings,
      last7Days,
      failedLast7Days,
    },
  });
}
