/**
 * Admin Dashboard API
 *
 * Comprehensive metrics for monitoring all GovCon Giants operations
 * GET /api/admin/dashboard?password=galata-assassin-2026
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';
const EMAIL_OPERATIONS_COMPLETE_HOUR_UTC = 13; // After briefings (08:30 UTC) and daily alerts (12:30 UTC) are done
const PAID_TIER_ACCESS_FLAGS = [
  'access_hunter_pro',
  'access_assassin_standard',
  'access_assassin_premium',
  'access_recompete',
  'access_contractor_db',
  'access_content_standard',
  'access_content_full_fix',
  'access_briefings',
];
const PRO_TIER_PRODUCTS = [
  'opportunity-hunter-pro',
  'market-assassin-standard',
  'market-assassin-premium',
  'ultimate-govcon-bundle',
  'contractor-database',
  'recompete-contracts',
  'ai-content-generator',
  'starter-govcon-bundle',
  'pro-giant-bundle',
];

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

export async function GET(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Show today's stats only after the daily send windows should be complete.
  // Before then, keep the dashboard pinned to yesterday to avoid misleading zeros.
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayStr = yesterday.toISOString().split('T')[0];
  const reportDate = now.getUTCHours() >= EMAIL_OPERATIONS_COMPLETE_HOUR_UTC ? todayStr : yesterdayStr;
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  // Gather all metrics in parallel
  const [
    emailStats,
    userHealth,
    alertTrend,
    briefingTrend,
    deadLetterStats,
    forecastStats,
    revenueMetrics,
    alerts
  ] = await Promise.all([
    getEmailStats(reportDate),
    getUserHealth(),
    getAlertTrend(sevenDaysAgo),
    getBriefingTrend(sevenDaysAgo),
    getDeadLetterStats(),
    getForecastStats(),
    getRevenueMetrics(),
    getSystemAlerts(reportDate)
  ]);

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    displayDate: reportDate,

    // Section 1: Most Recent completed email operations for the current reporting date
    emailOperations: emailStats,

    // Section 2: User Health
    userHealth,

    // Section 3: 7-Day Trends (both alerts AND briefings)
    trends: {
      alerts: alertTrend,
      briefings: briefingTrend
    },

    // Section 4: Dead Letter Queue
    deadLetter: deadLetterStats,

    // Section 5: Data Health
    dataHealth: forecastStats,

    // Section 6: Revenue (if available)
    revenue: revenueMetrics,

    // Section 7: System Alerts & Warnings
    systemAlerts: alerts
  });
}

async function getEmailStats(today: string) {
  const stats = {
    date: today,
    alerts: { sent: 0, failed: 0, skipped: 0, successRate: '0%' },
    briefings: {
      sent: 0, failed: 0, skipped: 0, pending: 0, successRate: '0%',
      byType: { daily: 0, weekly: 0, pursuit: 0 }
    }
  };

  try {
    // Alert stats for today
    const { data: alertData } = await getSupabase()
      .from('alert_log')
      .select('delivery_status')
      .eq('alert_date', today);

    if (alertData) {
      for (const row of alertData) {
        if (row.delivery_status === 'sent') stats.alerts.sent++;
        else if (row.delivery_status === 'failed') stats.alerts.failed++;
        else if (row.delivery_status === 'skipped') stats.alerts.skipped++;
      }
      const total = stats.alerts.sent + stats.alerts.failed;
      stats.alerts.successRate = total > 0
        ? `${Math.round((stats.alerts.sent / total) * 100)}%`
        : 'N/A';
    }
  } catch (e) {
    console.error('Error fetching alert stats:', e);
  }

  try {
    // Briefing stats for today - query by email_sent_at timestamp for accuracy
    // (briefing_date may be from a previous day if briefing was created then sent later)
    // Use same query as briefing-status: filter by email_sent_at >= today midnight UTC
    const todayMidnight = `${today}T00:00:00Z`;
    const tomorrowMidnight = new Date(new Date(today).getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0] + 'T00:00:00Z';

    // Query briefings sent today - use briefing_type for accurate type detection
    const { data: briefingData, error: briefingError } = await getSupabase()
      .from('briefing_log')
      .select('delivery_status, briefing_type, tools_included')
      .gte('email_sent_at', todayMidnight)
      .lt('email_sent_at', tomorrowMidnight);

    // Log any query errors for debugging
    if (briefingError) {
      console.error('[Dashboard] Briefing query error:', briefingError);
    }

    // Also get pending/failed/skipped for today by briefing_date (they don't have email_sent_at)
    const { data: pendingData } = await getSupabase()
      .from('briefing_log')
      .select('delivery_status')
      .eq('briefing_date', today)
      .in('delivery_status', ['pending', 'failed', 'skipped']);

    // Count sent briefings (by email_sent_at)
    if (briefingData) {
      for (const row of briefingData) {
        if (row.delivery_status === 'sent') {
          stats.briefings.sent++;
          // Count by briefing_type (primary) or tools_included (fallback)
          const briefingType = row.briefing_type;
          if (briefingType === 'daily') {
            stats.briefings.byType.daily++;
          } else if (briefingType === 'weekly') {
            stats.briefings.byType.weekly++;
          } else if (briefingType === 'pursuit') {
            stats.briefings.byType.pursuit++;
          } else if (row.tools_included) {
            // Fallback for legacy records without briefing_type
            if (row.tools_included.includes('daily_market_intel') || row.tools_included.includes('sam_cache_green')) {
              stats.briefings.byType.daily++;
            } else if (row.tools_included.includes('weekly_deep_dive')) {
              stats.briefings.byType.weekly++;
            } else if (row.tools_included.includes('pursuit_brief')) {
              stats.briefings.byType.pursuit++;
            }
          }
        }
      }
    }

    // Count pending/failed/skipped (by briefing_date)
    if (pendingData) {
      for (const row of pendingData) {
        if (row.delivery_status === 'failed') stats.briefings.failed++;
        else if (row.delivery_status === 'skipped') stats.briefings.skipped++;
        else if (row.delivery_status === 'pending') stats.briefings.pending++;
      }
    }

    const total = stats.briefings.sent + stats.briefings.failed;
    stats.briefings.successRate = total > 0
      ? `${Math.round((stats.briefings.sent / total) * 100)}%`
      : 'N/A';
  } catch (e) {
    console.error('Error fetching briefing stats:', e);
  }

  return stats;
}

async function getUserHealth() {
  const health = {
    totalUsers: 0,
    naicsConfigured: 0,
    naicsPercent: '0%',
    businessTypeSet: 0,
    businessTypePercent: '0%',
    alertsEnabledTotal: 0,
    dailyFrequencyConfigured: 0,
    weeklyFrequencyConfigured: 0,
    postBetaPaidDailyEligible: 0,
    postBetaFreeWeeklyFallback: 0,
    briefingsEnabled: 0,
    unconfiguredEmails: [] as string[]
  };

  try {
    const supabase = getSupabase();
    const [settingsResult, profilesResult, proBuyerEmails] = await Promise.all([
      supabase
        .from('user_notification_settings')
        .select('user_email, naics_codes, business_type, alerts_enabled, alert_frequency, briefings_enabled, is_active'),
      supabase
        .from('user_profiles')
        .select('email, access_hunter_pro, access_assassin_standard, access_assassin_premium, access_recompete, access_contractor_db, access_content_standard, access_content_full_fix, access_briefings'),
      fetchWeeklyAlertBuyerEmails(),
    ]);

    const { data } = settingsResult;
    const paidDailyEmails = new Set(
      (profilesResult.data || [])
        .filter((profile: Record<string, unknown>) =>
          PAID_TIER_ACCESS_FLAGS.some(flag => profile[flag] === true)
        )
        .map((profile: { email: string }) => profile.email.toLowerCase())
    );

    if (data) {
      health.totalUsers = data.length;

      for (const user of data) {
        const hasNaics = user.naics_codes && user.naics_codes.length > 0;
        const hasBusinessType = user.business_type && user.business_type.trim() !== '';
        const normalizedEmail = user.user_email.toLowerCase();

        if (hasNaics) health.naicsConfigured++;
        else health.unconfiguredEmails.push(user.user_email);

        if (hasBusinessType) health.businessTypeSet++;
        if (user.alerts_enabled) {
          health.alertsEnabledTotal++;

          if (user.is_active) {
            if (user.alert_frequency === 'daily') {
              health.dailyFrequencyConfigured++;

              if (paidDailyEmails.has(normalizedEmail)) {
                health.postBetaPaidDailyEligible++;
              }

              if (!proBuyerEmails.has(normalizedEmail)) {
                health.postBetaFreeWeeklyFallback++;
              }
            }

            if (user.alert_frequency === 'weekly') {
              health.weeklyFrequencyConfigured++;
            }
          }
        }
        if (user.briefings_enabled) health.briefingsEnabled++;
      }

      health.naicsPercent = `${Math.round((health.naicsConfigured / health.totalUsers) * 100)}%`;
      health.businessTypePercent = `${Math.round((health.businessTypeSet / health.totalUsers) * 100)}%`;

      // Only include first 10 unconfigured emails
      health.unconfiguredEmails = health.unconfiguredEmails.slice(0, 10);
    }
  } catch (e) {
    console.error('Error fetching user health:', e);
  }

  return health;
}

async function fetchWeeklyAlertBuyerEmails(): Promise<Set<string>> {
  try {
    const res = await fetch('https://shop.govcongiants.org/api/admin/purchases-report?days=365', {
      headers: { 'x-admin-password': 'admin123' },
    });

    if (!res.ok) {
      console.log('[Dashboard] Could not fetch weekly-alert buyer list, defaulting to no pro buyers');
      return new Set();
    }

    const data = await res.json();
    const purchases = data.purchases || [];
    const proEmails = new Set<string>();

    for (const purchase of purchases) {
      const productId = String(purchase.productId || '').toLowerCase();
      const email = String(purchase.email || '').toLowerCase();

      if (email && PRO_TIER_PRODUCTS.some(tier => productId.includes(tier))) {
        proEmails.add(email);
      }
    }

    return proEmails;
  } catch (error) {
    console.error('[Dashboard] Error fetching weekly-alert buyer list:', error);
    return new Set();
  }
}

async function getAlertTrend(sinceDate: string) {
  const trend: Array<{ date: string; sent: number; failed: number; skipped: number }> = [];

  try {
    const { data } = await getSupabase()
      .from('alert_log')
      .select('alert_date, delivery_status')
      .gte('alert_date', sinceDate)
      .order('alert_date', { ascending: true });

    if (data) {
      const byDate: Record<string, { sent: number; failed: number; skipped: number }> = {};

      for (const row of data) {
        const date = row.alert_date;
        if (!byDate[date]) byDate[date] = { sent: 0, failed: 0, skipped: 0 };

        if (row.delivery_status === 'sent') byDate[date].sent++;
        else if (row.delivery_status === 'failed') byDate[date].failed++;
        else if (row.delivery_status === 'skipped') byDate[date].skipped++;
      }

      for (const [date, stats] of Object.entries(byDate)) {
        trend.push({ date, ...stats });
      }
    }
  } catch (e) {
    console.error('Error fetching alert trend:', e);
  }

  return trend;
}

async function getBriefingTrend(sinceDate: string) {
  const trend: Array<{ date: string; sent: number; failed: number; skipped: number }> = [];

  try {
    const { data } = await getSupabase()
      .from('briefing_log')
      .select('briefing_date, email_sent_at, delivery_status')
      .or(`briefing_date.gte.${sinceDate},email_sent_at.gte.${sinceDate}T00:00:00Z`)
      .order('briefing_date', { ascending: true });

    const byDate: Record<string, { sent: number; failed: number; skipped: number }> = {};

    if (data) {
      for (const row of data) {
        const date = row.delivery_status === 'sent' && row.email_sent_at
          ? String(row.email_sent_at).split('T')[0]
          : row.briefing_date;

        if (!date) continue;
        if (!byDate[date]) byDate[date] = { sent: 0, failed: 0, skipped: 0 };

        if (row.delivery_status === 'sent') byDate[date].sent++;
        else if (row.delivery_status === 'failed') byDate[date].failed++;
        else if (row.delivery_status === 'skipped') byDate[date].skipped++;
      }
    }

    // Always return the full 7-day window, including zero days, so the trend keeps moving.
    const start = new Date(`${sinceDate}T00:00:00Z`);
    const end = new Date();
    end.setUTCHours(0, 0, 0, 0);

    for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      const date = cursor.toISOString().split('T')[0];
      trend.push({
        date,
        ...(byDate[date] || { sent: 0, failed: 0, skipped: 0 }),
      });
    }
  } catch (e) {
    console.error('Error fetching briefing trend:', e);
  }

  return trend;
}

async function getDeadLetterStats() {
  const stats = {
    total: 0,
    pending: 0,
    exhausted: 0,
    resolved: 0,
    oldestPending: null as string | null
  };

  try {
    const { data } = await getSupabase()
      .from('briefing_dead_letter')
      .select('status, created_at')
      .order('created_at', { ascending: true });

    if (data) {
      stats.total = data.length;

      for (const row of data) {
        if (row.status === 'pending') {
          stats.pending++;
          if (!stats.oldestPending) stats.oldestPending = row.created_at;
        }
        else if (row.status === 'exhausted') stats.exhausted++;
        else if (row.status === 'resolved') stats.resolved++;
      }
    }
  } catch (e) {
    // Table might not exist
    console.error('Dead letter table not found or error:', e);
  }

  return stats;
}

async function getForecastStats() {
  const stats = {
    totalForecasts: 0,
    byAgency: {} as Record<string, number>,
    samCacheCount: 0,
    samCacheLastUpdate: null as string | null
  };

  try {
    // Total forecast count (use count query to avoid 1000 row limit)
    const { count: totalCount } = await getSupabase()
      .from('agency_forecasts')
      .select('*', { count: 'exact', head: true });

    stats.totalForecasts = totalCount || 0;

    // Forecast counts by agency - use individual COUNT queries to bypass 1000 row limit
    const knownAgencies = ['DHS', 'DOE', 'DOJ', 'DOI', 'NASA', 'VA', 'GSA', 'NRC', 'DOT', 'SSA', 'NSF', 'DOL', 'HHS', 'Treasury', 'EPA', 'USDA', 'DOD'];

    const agencyCountPromises = knownAgencies.map(agency =>
      getSupabase()
        .from('agency_forecasts')
        .select('id', { count: 'exact', head: true })
        .eq('source_agency', agency)
        .then(({ count }: { count: number | null }) => ({ agency, count: count || 0 }))
    );

    const agencyCounts = await Promise.all(agencyCountPromises);
    for (const { agency, count } of agencyCounts) {
      if (count > 0) {
        stats.byAgency[agency] = count;
      }
    }
  } catch (e) {
    console.error('Error fetching forecast stats:', e);
  }

  try {
    // SAM cache stats
    const { count, data } = await getSupabase()
      .from('sam_opportunities')
      .select('created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .limit(1);

    stats.samCacheCount = count || 0;
    if (data && data.length > 0) {
      stats.samCacheLastUpdate = data[0].created_at;
    }
  } catch (e) {
    console.error('Error fetching SAM cache stats:', e);
  }

  return stats;
}

async function getRevenueMetrics() {
  const thirtyDaysAgo = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);
  const sevenDaysAgo = Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60);

  const metrics = {
    available: true,
    thirtyDay: {
      total: 0,
      count: 0,
      avgOrder: 0,
      byProduct: {} as Record<string, { count: number; revenue: number }>,
    },
    sevenDay: {
      total: 0,
      count: 0,
    },
    recentPurchases: [] as Array<{
      email: string;
      product: string;
      amount: number;
      date: string;
      bundle?: string;
    }>,
  };

  // Check if Stripe key is available
  if (!process.env.STRIPE_SECRET_KEY) {
    return { available: false, error: 'Stripe not configured' };
  }

  try {
    // Use dynamic import for Stripe
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    // Get charges from the last 30 days
    const charges = await stripe.charges.list({
      created: { gte: thirtyDaysAgo },
      limit: 100,
    });

    for (const charge of charges.data) {
      if (charge.status !== 'succeeded') continue;

      const amount = charge.amount / 100; // Convert cents to dollars
      const chargeDate = new Date(charge.created * 1000);

      metrics.thirtyDay.total += amount;
      metrics.thirtyDay.count++;

      // Group by product (use description or metadata)
      const productName = charge.description ||
        (charge.metadata?.product_name) ||
        'Subscription';

      if (!metrics.thirtyDay.byProduct[productName]) {
        metrics.thirtyDay.byProduct[productName] = { count: 0, revenue: 0 };
      }
      metrics.thirtyDay.byProduct[productName].count++;
      metrics.thirtyDay.byProduct[productName].revenue += amount;

      // 7-day subset
      if (charge.created >= sevenDaysAgo) {
        metrics.sevenDay.total += amount;
        metrics.sevenDay.count++;
      }
    }

    metrics.thirtyDay.avgOrder = metrics.thirtyDay.count > 0
      ? Math.round(metrics.thirtyDay.total / metrics.thirtyDay.count)
      : 0;

    // Recent 10 purchases with emails
    metrics.recentPurchases = charges.data
      .filter(c => c.status === 'succeeded')
      .slice(0, 10)
      .map(c => ({
        email: c.billing_details?.email || c.receipt_email || 'N/A',
        product: c.description || 'Subscription',
        amount: c.amount / 100,
        date: new Date(c.created * 1000).toISOString(),
        bundle: c.metadata?.bundle || undefined,
      }));

  } catch (e) {
    console.error('Error fetching Stripe revenue metrics:', e);
    return {
      available: false,
      error: 'Failed to fetch Stripe data',
    };
  }

  return metrics;
}

async function getSystemAlerts(today: string) {
  const alerts: Array<{ level: 'critical' | 'warning' | 'info'; message: string }> = [];

  // Check for issues
  const emailStats = await getEmailStats(today);
  const userHealth = await getUserHealth();
  const deadLetter = await getDeadLetterStats();

  // Critical: No sends yesterday (shown after 8 AM today)
  // Note: Dashboard shows yesterday's data since today isn't complete yet
  const hour = new Date().getUTCHours();
  if (hour >= 12 && emailStats.alerts.sent === 0 && emailStats.briefings.sent === 0) {
    alerts.push({
      level: 'critical',
      message: 'No emails sent yesterday - check cron jobs'
    });
  }

  // Warning: High failure rate
  const alertTotal = emailStats.alerts.sent + emailStats.alerts.failed;
  if (alertTotal > 10) {
    const failRate = (emailStats.alerts.failed / alertTotal) * 100;
    if (failRate > 5) {
      alerts.push({
        level: 'warning',
        message: `Alert failure rate at ${failRate.toFixed(1)}% (${emailStats.alerts.failed}/${alertTotal})`
      });
    }
  }

  // Warning: Dead letter queue growing
  if (deadLetter.pending > 10) {
    alerts.push({
      level: 'warning',
      message: `${deadLetter.pending} emails in dead letter queue`
    });
  }

  // Warning: Many unconfigured users
  const unconfiguredPercent = 100 - parseInt(userHealth.naicsPercent);
  if (unconfiguredPercent > 30) {
    alerts.push({
      level: 'warning',
      message: `${unconfiguredPercent}% of users (${userHealth.totalUsers - userHealth.naicsConfigured}) have no NAICS configured`
    });
  }

  // Info: Good status
  if (alerts.length === 0) {
    alerts.push({
      level: 'info',
      message: 'All systems operating normally'
    });
  }

  return alerts;
}

// POST handler for actions
export async function POST(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { action, email } = body;

    switch (action) {
      case 'send-test-alert':
        // Trigger test alert to specified email
        const alertResponse = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_URL || 'https://tools.govcongiants.org'}/api/cron/daily-alerts?password=${ADMIN_PASSWORD}&testEmail=${email}&skipTimezone=true`
        );
        const alertResult = await alertResponse.json();
        return NextResponse.json({ success: true, action: 'send-test-alert', result: alertResult });

      case 'send-test-briefing':
        // Trigger test briefing to specified email
        const briefingResponse = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_URL || 'https://tools.govcongiants.org'}/api/cron/send-briefings-fast?password=${ADMIN_PASSWORD}&email=${email}&test=true`
        );
        const briefingResult = await briefingResponse.json();
        return NextResponse.json({ success: true, action: 'send-test-briefing', result: briefingResult });

      case 'process-dead-letter':
        // Retry all pending dead letter items
        const dlResponse = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_URL || 'https://tools.govcongiants.org'}/api/admin/briefing-dead-letter?password=${ADMIN_PASSWORD}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'retry-all' })
          }
        );
        const dlResult = await dlResponse.json();
        return NextResponse.json({ success: true, action: 'process-dead-letter', result: dlResult });

      case 'send-naics-reminder':
        // Send NAICS reminder to unconfigured users
        const reminderResponse = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_URL || 'https://tools.govcongiants.org'}/api/admin/send-naics-reminder?password=${ADMIN_PASSWORD}&mode=execute&limit=50`,
          { method: 'POST' }
        );
        const reminderResult = await reminderResponse.json();
        return NextResponse.json({ success: true, action: 'send-naics-reminder', result: reminderResult });

      case 'preview-naics-reminder':
        // Preview who would receive NAICS reminders
        const previewResponse = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_URL || 'https://tools.govcongiants.org'}/api/admin/send-naics-reminder?password=${ADMIN_PASSWORD}&mode=preview`
        );
        const previewResult = await previewResponse.json();
        return NextResponse.json({ success: true, action: 'preview-naics-reminder', result: previewResult });

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
