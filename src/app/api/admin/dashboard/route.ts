/**
 * Admin Dashboard API
 *
 * Comprehensive metrics for monitoring all GovCon Giants operations
 * GET /api/admin/dashboard?password=galata-assassin-2026
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { kv } from '@vercel/kv';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

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
const PROFILE_REMINDER_LAST_RUN_KEY = 'admin:profile-reminder:last-run';

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

const SUPABASE_PAGE_SIZE = 1000;

async function fetchAllRows<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message?: string } | null }>
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;

  while (true) {
    const to = from + SUPABASE_PAGE_SIZE - 1;
    const { data, error } = await buildQuery(from, to);

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      break;
    }

    rows.push(...data);

    if (data.length < SUPABASE_PAGE_SIZE) {
      break;
    }

    from += SUPABASE_PAGE_SIZE;
  }

  return rows;
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
    weeklyAlertHealth,
    betaHealth,
    providerEmailHealth,
    matchingQuality,
    alertTrend,
    briefingTrend,
    deadLetterStats,
    forecastStats,
    revenueMetrics,
    alerts,
    profileReminderLastRun
  ] = await Promise.all([
    getEmailStats(reportDate),
    getUserHealth(),
    getWeeklyAlertHealth(),
    getBetaHealth(),
    getProviderEmailHealth(),
    getMatchingQuality(),
    getAlertTrend(sevenDaysAgo),
    getBriefingTrend(sevenDaysAgo),
    getDeadLetterStats(),
    getForecastStats(),
    getRevenueMetrics(),
    getSystemAlerts(reportDate),
    kv.get(PROFILE_REMINDER_LAST_RUN_KEY)
  ]);

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    displayDate: reportDate,

    // Section 1: Most Recent completed email operations for the current reporting date
    emailOperations: emailStats,

    // Section 2: User Health
    userHealth,

    // Section 2b: Free weekly alert cron health
    weeklyAlerts: weeklyAlertHealth,

    // Section 2c: Beta monetization / engagement health
    betaHealth,

    // Section 2d: Resend/provider delivery health
    providerEmailHealth,

    // Section 2e: Matching quality
    matchingQuality,

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
    systemAlerts: alerts,

    // Section 8: Action agent state
    profileReminderLastRun
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
    const alertData = await fetchAllRows<{ delivery_status: string }>((from, to) =>
      getSupabase()
        .from('alert_log')
        .select('delivery_status')
        .eq('alert_date', today)
        .range(from, to)
    );

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
    let briefingError: { message?: string } | null = null;
    let briefingData: Array<{
      delivery_status: string;
      briefing_type?: string | null;
      tools_included?: string[] | null;
    }> = [];

    try {
      briefingData = await fetchAllRows<{
        delivery_status: string;
        briefing_type?: string | null;
        tools_included?: string[] | null;
      }>((from, to) =>
        getSupabase()
          .from('briefing_log')
          .select('delivery_status, briefing_type, tools_included')
          .gte('email_sent_at', todayMidnight)
          .lt('email_sent_at', tomorrowMidnight)
          .range(from, to)
      );
    } catch (error) {
      briefingError = error as { message?: string };
    }

    // Log any query errors for debugging
    if (briefingError) {
      console.error('[Dashboard] Briefing query error:', briefingError);
    }

    // Also get pending/failed/skipped for today by briefing_date (they don't have email_sent_at)
    const pendingData = await fetchAllRows<{ delivery_status: string }>((from, to) =>
      getSupabase()
        .from('briefing_log')
        .select('delivery_status')
        .eq('briefing_date', today)
        .in('delivery_status', ['pending', 'failed', 'skipped'])
        .range(from, to)
    );

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
    briefingsProfileIncomplete: 0,
    briefingsProfileIncompleteEmails: [] as string[],
    briefingsEnabled: 0,
    briefingsEntitled: 0,
    briefingsCronEligible: 0,
    briefingsExpired: 0,
    internalExcluded: 0,
    unconfiguredEmails: [] as string[]
  };

  try {
    const supabase = getSupabase();
    const [settingsData, profilesData, classificationRows, proBuyerEmails] = await Promise.all([
      fetchAllRows<{
        user_email: string;
        naics_codes: string[] | null;
        business_type: string | null;
        alerts_enabled: boolean | null;
        alert_frequency: string | null;
        keywords?: string[] | null;
        agencies?: string[] | null;
        briefings_enabled: boolean | null;
        is_active: boolean | null;
      }>((from, to) =>
        supabase
          .from('user_notification_settings')
          .select('user_email, naics_codes, business_type, keywords, agencies, alerts_enabled, alert_frequency, briefings_enabled, is_active')
          .range(from, to)
      ),
      fetchAllRows<Record<string, unknown> & { email: string }>((from, to) =>
        supabase
          .from('user_profiles')
          .select('email, access_hunter_pro, access_assassin_standard, access_assassin_premium, access_recompete, access_contractor_db, access_content_standard, access_content_full_fix, access_briefings')
          .range(from, to)
      ),
      fetchAllRows<{
        email: string;
        briefings_access?: string | null;
        briefings_expiry?: string | null;
        classification_version?: number | null;
      }>((from, to) =>
        supabase
          .from('customer_classifications')
          .select('email, briefings_access, briefings_expiry, classification_version')
          .range(from, to)
      ),
      fetchWeeklyAlertBuyerEmails(),
    ]);

    const latestClassificationVersion = classificationRows.reduce(
      (max: number, row: { classification_version?: number | null }) =>
        Math.max(max, Number(row.classification_version || 0)),
      0
    );
    const entitledAccess = new Set(['lifetime', '1_year', '6_month', 'subscription', 'beta_preview']);
    const now = Date.now();
    const classificationsByEmail = new Map(
      classificationRows
        .filter((row: { classification_version?: number | null }) =>
          Number(row.classification_version || 0) === latestClassificationVersion
        )
        .map((row: { email: string }) => [row.email.toLowerCase(), row])
    );
    const entitledEmails = new Set<string>();
    const currentEntitledEmails = new Set<string>();
    for (const row of classificationsByEmail.values() as Iterable<{
      email: string;
      briefings_access?: string | null;
      briefings_expiry?: string | null;
    }>) {
      const email = row.email.toLowerCase();
      if (row.briefings_access === 'excluded') {
        health.internalExcluded++;
      }
      if (!entitledAccess.has(row.briefings_access || '')) {
        continue;
      }
      entitledEmails.add(email);
      if (row.briefings_expiry && new Date(row.briefings_expiry).getTime() <= now) {
        health.briefingsExpired++;
        continue;
      }
      currentEntitledEmails.add(email);
    }
    health.briefingsEntitled = entitledEmails.size;

    const paidDailyEmails = new Set(
      profilesData
        .filter((profile: Record<string, unknown>) =>
          PAID_TIER_ACCESS_FLAGS.some(flag => profile[flag] === true)
        )
        .map((profile: { email: string }) => profile.email.toLowerCase())
    );

    if (settingsData) {
      health.totalUsers = settingsData.length;

      for (const user of settingsData) {
        const hasNaics = user.naics_codes && user.naics_codes.length > 0;
        const hasBusinessType = user.business_type && user.business_type.trim() !== '';
        const normalizedEmail = user.user_email.toLowerCase();

        if (hasNaics) health.naicsConfigured++;
        else health.unconfiguredEmails.push(user.user_email);

        if (hasBusinessType) health.businessTypeSet++;
        const isCurrentBriefingsEntitled = currentEntitledEmails.has(normalizedEmail);

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
        if (user.briefings_enabled) {
          health.briefingsEnabled++;
          const hasAnyBriefingProfileSignal =
            (user.naics_codes || []).length > 0 ||
            (user.keywords || []).length > 0 ||
            (user.agencies || []).length > 0;
          if (user.is_active && !hasAnyBriefingProfileSignal) {
            health.briefingsProfileIncomplete++;
            health.briefingsProfileIncompleteEmails.push(user.user_email);
          }
          if (user.is_active && isCurrentBriefingsEntitled) {
            health.briefingsCronEligible++;
          }
        }
      }

      health.naicsPercent = `${Math.round((health.naicsConfigured / health.totalUsers) * 100)}%`;
      health.businessTypePercent = `${Math.round((health.businessTypeSet / health.totalUsers) * 100)}%`;

      // Only include first 10 unconfigured emails
      health.unconfiguredEmails = health.unconfiguredEmails.slice(0, 10);
      health.briefingsProfileIncompleteEmails = health.briefingsProfileIncompleteEmails.slice(0, 10);
    }
  } catch (e) {
    console.error('Error fetching user health:', e);
  }

  return health;
}

function getWeeklyCycleDates() {
  const now = new Date();
  const currentCycle = new Date(now);
  currentCycle.setUTCHours(0, 0, 0, 0);
  currentCycle.setUTCDate(currentCycle.getUTCDate() - currentCycle.getUTCDay());

  const nextScheduled = new Date(currentCycle);
  nextScheduled.setUTCHours(23, 0, 0, 0);

  if (now >= nextScheduled) {
    nextScheduled.setUTCDate(nextScheduled.getUTCDate() + 7);
  }

  return {
    cycleDate: currentCycle.toISOString().split('T')[0],
    scheduledAtUtc: `${currentCycle.toISOString().split('T')[0]}T23:00:00Z`,
    nextScheduledAtUtc: nextScheduled.toISOString(),
  };
}

async function getWeeklyAlertHealth() {
  const cycle = getWeeklyCycleDates();
  const health = {
    cycleDate: cycle.cycleDate,
    scheduledAtUtc: cycle.scheduledAtUtc,
    nextScheduledAtUtc: cycle.nextScheduledAtUtc,
    eligibleTotal: 0,
    eligibleWithNaics: 0,
    explicitWeeklyUsers: 0,
    freeFallbackUsers: 0,
    processedFreeFallback: 0,
    processedExplicitWeekly: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    processed: 0,
    remaining: 0,
    successRate: 'N/A',
    lastSentAt: null as string | null,
  };

  try {
    const supabase = getSupabase();
    const [settings, proBuyerEmails, weeklyLogs] = await Promise.all([
      fetchAllRows<{
        user_email: string;
        naics_codes?: string[] | null;
        alerts_enabled: boolean;
        alert_frequency: string | null;
        is_active: boolean;
      }>((from, to) =>
        supabase
          .from('user_notification_settings')
          .select('user_email, naics_codes, alerts_enabled, alert_frequency, is_active')
          .eq('is_active', true)
          .eq('alerts_enabled', true)
          .range(from, to)
      ),
      fetchWeeklyAlertBuyerEmails(),
      fetchAllRows<{
        user_email: string | null;
        delivery_status: string | null;
        sent_at: string | null;
        opportunities_data?: Array<{ alertSource?: string }> | null;
      }>((from, to) =>
        supabase
          .from('alert_log')
          .select('user_email, delivery_status, sent_at, opportunities_data')
          .eq('alert_type', 'weekly')
          .eq('alert_date', cycle.cycleDate)
          .range(from, to)
      ),
    ]);

    const eligibleEmails = new Set<string>();

    for (const user of settings || []) {
      const email = user.user_email.toLowerCase();
      const isExplicitWeekly = user.alert_frequency === 'weekly';
      const isFreeFallback = !proBuyerEmails.has(email);

      if (!isExplicitWeekly && !isFreeFallback) {
        continue;
      }

      eligibleEmails.add(email);
      if ((user.naics_codes || []).length > 0) {
        health.eligibleWithNaics++;
      }
      if (isExplicitWeekly) {
        health.explicitWeeklyUsers++;
      }
      if (isFreeFallback) {
        health.freeFallbackUsers++;
      }
    }

    health.eligibleTotal = eligibleEmails.size;
    const processedEligibleEmails = new Set<string>();

    for (const row of weeklyLogs || []) {
      if (row.delivery_status === 'sent') health.sent++;
      else if (row.delivery_status === 'failed') health.failed++;
      else if (row.delivery_status === 'skipped') health.skipped++;

      const email = row.user_email?.toLowerCase();
      if (email && eligibleEmails.has(email)) {
        processedEligibleEmails.add(email);
      }

      const alertSource = Array.isArray(row.opportunities_data)
        ? row.opportunities_data[0]?.alertSource
        : null;
      if (alertSource === 'free_weekly_fallback') {
        health.processedFreeFallback++;
      } else if (alertSource === 'explicit_weekly') {
        health.processedExplicitWeekly++;
      }

      if (row.sent_at && (!health.lastSentAt || row.sent_at > health.lastSentAt)) {
        health.lastSentAt = row.sent_at;
      }
    }

    health.processed = processedEligibleEmails.size;
    health.remaining = Math.max(health.eligibleTotal - health.processed, 0);

    const attempted = health.sent + health.failed;
    health.successRate = attempted > 0
      ? `${Math.round((health.sent / attempted) * 100)}%`
      : 'N/A';
  } catch (e) {
    console.error('Error fetching weekly alert health:', e);
  }

  return health;
}

function percent(numerator: number, denominator: number): string {
  return denominator > 0 ? `${Math.round((numerator / denominator) * 100)}%` : 'N/A';
}

async function getBetaHealth() {
  const now = new Date();
  const sevenDaysAgoIso = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const todayIso = now.toISOString().split('T')[0];

  const health = {
    weeklyActiveUsers: 0,
    dailyActiveUsers: 0,
    dauWauRatio: 'N/A',
    activeBetaUsers: 0,
    queueSize: 0,
    activationRate7d: 'N/A',
    profileCompletionRate: '0%',
    firstClickUsers7d: 0,
  };

  try {
    const supabase = getSupabase();
    const [settings, queueResult, engagement7d, engagementToday] = await Promise.all([
      fetchAllRows<{
        user_email: string;
        naics_codes?: string[] | null;
        alerts_enabled?: boolean | null;
        is_active?: boolean | null;
      }>((from, to) =>
        supabase
          .from('user_notification_settings')
          .select('user_email, naics_codes, alerts_enabled, is_active')
          .range(from, to)
      ),
      supabase
        .from('waitlist_queue')
        .select('id', { count: 'exact', head: true }),
      fetchAllRows<{
        user_email: string | null;
        event_type: string;
      }>((from, to) =>
        supabase
          .from('user_engagement')
          .select('user_email, event_type')
          .in('event_type', ['email_open', 'link_click'])
          .gte('created_at', sevenDaysAgoIso)
          .range(from, to)
      ),
      fetchAllRows<{
        user_email: string | null;
        event_type: string;
      }>((from, to) =>
        supabase
          .from('user_engagement')
          .select('user_email, event_type')
          .in('event_type', ['email_open', 'link_click'])
          .gte('created_at', `${todayIso}T00:00:00Z`)
          .range(from, to)
      ),
    ]);

    const activeSettings = settings.filter(user => user.is_active !== false && user.alerts_enabled !== false);
    const completedProfiles = activeSettings.filter(user => (user.naics_codes || []).length > 0);
    const weeklyActiveEmails = new Set(engagement7d.map(row => row.user_email).filter(Boolean) as string[]);
    const dailyActiveEmails = new Set(engagementToday.map(row => row.user_email).filter(Boolean) as string[]);
    const firstClickEmails = new Set(
      engagement7d
        .filter(row => row.event_type === 'link_click')
        .map(row => row.user_email)
        .filter(Boolean) as string[]
    );

    health.activeBetaUsers = activeSettings.length;
    health.profileCompletionRate = percent(completedProfiles.length, activeSettings.length);
    health.weeklyActiveUsers = weeklyActiveEmails.size;
    health.dailyActiveUsers = dailyActiveEmails.size;
    health.dauWauRatio = percent(dailyActiveEmails.size, weeklyActiveEmails.size);
    health.firstClickUsers7d = firstClickEmails.size;
    health.queueSize = queueResult.error ? 0 : queueResult.count || 0;
    health.activationRate7d = percent(weeklyActiveEmails.size, activeSettings.length);
  } catch (error) {
    console.error('Error fetching beta health:', error);
  }

  return health;
}

async function getProviderEmailHealth() {
  const sevenDaysAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const health = {
    sends7d: 0,
    delivered7d: 0,
    opened7d: 0,
    clicked7d: 0,
    bounced7d: 0,
    complained7d: 0,
    failed7d: 0,
    deliveryRate: 'N/A',
    clickRate: 'N/A',
    complaintRate: 'N/A',
    topLinks: [] as Array<{ label: string; count: number }>,
  };

  try {
    const supabase = getSupabase();
    const [sends, events] = await Promise.all([
      fetchAllRows<{ provider_message_id: string | null }>((from, to) =>
        supabase
          .from('email_provider_sends')
          .select('provider_message_id')
          .gte('sent_at', sevenDaysAgoIso)
          .range(from, to)
      ),
      fetchAllRows<{
        event_type: string;
        metadata?: { resend?: { click?: { link?: string } } } | null;
      }>((from, to) =>
        supabase
          .from('email_provider_events')
          .select('event_type, metadata')
          .gte('occurred_at', sevenDaysAgoIso)
          .range(from, to)
      ),
    ]);

    const topLinks: Record<string, number> = {};
    health.sends7d = sends.length;

    for (const event of events) {
      if (event.event_type === 'email.delivered') health.delivered7d++;
      else if (event.event_type === 'email.opened') health.opened7d++;
      else if (event.event_type === 'email.clicked') {
        health.clicked7d++;
        const link = event.metadata?.resend?.click?.link || 'unknown';
        const label = link.includes('sam.gov')
          ? 'SAM.gov'
          : link.includes('market-intelligence')
            ? 'Market Intelligence'
            : link.includes('feedback')
              ? 'Feedback'
              : link;
        topLinks[label] = (topLinks[label] || 0) + 1;
      } else if (event.event_type === 'email.bounced') health.bounced7d++;
      else if (event.event_type === 'email.complained') health.complained7d++;
      else if (event.event_type === 'email.failed') health.failed7d++;
    }

    health.deliveryRate = percent(health.delivered7d, health.sends7d);
    health.clickRate = percent(health.clicked7d, health.delivered7d || health.sends7d);
    health.complaintRate = percent(health.complained7d, health.delivered7d || health.sends7d);
    health.topLinks = Object.entries(topLinks)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([label, count]) => ({ label, count }));
  } catch (error) {
    console.error('Error fetching provider email health:', error);
  }

  return health;
}

async function getMatchingQuality() {
  const sevenDaysAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgoDate = sevenDaysAgoIso.split('T')[0];
  const quality = {
    totalFeedback: 0,
    helpful: 0,
    notHelpful: 0,
    helpfulRate: 'N/A',
    last7Days: { total: 0, helpful: 0, notHelpful: 0, helpfulRate: 'N/A' },
    byType: {
      daily: { helpful: 0, notHelpful: 0, helpfulRate: 'N/A' },
      weekly: { helpful: 0, notHelpful: 0, helpfulRate: 'N/A' },
      pursuit: { helpful: 0, notHelpful: 0, helpfulRate: 'N/A' },
    },
    usersNeedingAttention: 0,
    repeatNegative: [] as Array<{ email: string; count: number }>,
    zeroAlertUsers7d: 0,
    highVolumeUsers7d: 0,
  };

  try {
    const supabase = getSupabase();
    const [feedback, settings, alertLogs] = await Promise.all([
      fetchAllRows<{
        user_email: string;
        rating: string;
        briefing_type: 'daily' | 'weekly' | 'pursuit' | string | null;
        created_at: string;
      }>((from, to) =>
        supabase
          .from('briefing_feedback')
          .select('user_email, rating, briefing_type, created_at')
          .neq('rating', 'outreach_sent')
          .range(from, to)
      ),
      fetchAllRows<{
        user_email: string;
        alerts_enabled?: boolean | null;
        is_active?: boolean | null;
        naics_codes?: string[] | null;
      }>((from, to) =>
        supabase
          .from('user_notification_settings')
          .select('user_email, alerts_enabled, is_active, naics_codes')
          .eq('alerts_enabled', true)
          .eq('is_active', true)
          .range(from, to)
      ),
      fetchAllRows<{
        user_email: string;
        opportunities_count?: number | null;
      }>((from, to) =>
        supabase
          .from('alert_log')
          .select('user_email, opportunities_count')
          .gte('alert_date', sevenDaysAgoDate)
          .eq('delivery_status', 'sent')
          .range(from, to)
      ),
    ]);

    const negativeByUser: Record<string, number> = {};
    for (const row of feedback) {
      const rating = row.rating;
      const type = row.briefing_type;
      const isLast7 = row.created_at >= sevenDaysAgoIso;

      if (rating === 'helpful') {
        quality.helpful++;
        if (isLast7) quality.last7Days.helpful++;
        if (type && type in quality.byType) quality.byType[type as keyof typeof quality.byType].helpful++;
      } else if (rating === 'not_helpful') {
        quality.notHelpful++;
        negativeByUser[row.user_email] = (negativeByUser[row.user_email] || 0) + 1;
        if (isLast7) quality.last7Days.notHelpful++;
        if (type && type in quality.byType) quality.byType[type as keyof typeof quality.byType].notHelpful++;
      }
      if (isLast7) quality.last7Days.total++;
    }

    quality.totalFeedback = quality.helpful + quality.notHelpful;
    quality.helpfulRate = percent(quality.helpful, quality.totalFeedback);
    quality.last7Days.helpfulRate = percent(quality.last7Days.helpful, quality.last7Days.total);
    for (const type of Object.keys(quality.byType) as Array<keyof typeof quality.byType>) {
      const item = quality.byType[type];
      item.helpfulRate = percent(item.helpful, item.helpful + item.notHelpful);
    }

    quality.repeatNegative = Object.entries(negativeByUser)
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([email, count]) => ({ email, count }));
    quality.usersNeedingAttention = quality.repeatNegative.length;

    const alertCountsByUser: Record<string, number> = {};
    for (const row of alertLogs) {
      alertCountsByUser[row.user_email.toLowerCase()] = (alertCountsByUser[row.user_email.toLowerCase()] || 0) + (row.opportunities_count || 0);
    }

    const activeWithNaics = settings.filter(user => (user.naics_codes || []).length > 0);
    quality.zeroAlertUsers7d = activeWithNaics.filter(user => !alertCountsByUser[user.user_email.toLowerCase()]).length;
    quality.highVolumeUsers7d = Object.values(alertCountsByUser).filter(count => count >= 30).length;
  } catch (error) {
    console.error('Error fetching matching quality:', error);
  }

  return quality;
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
    const data = await fetchAllRows<{ alert_date: string; delivery_status: string }>((from, to) =>
      getSupabase()
        .from('alert_log')
        .select('alert_date, delivery_status')
        .gte('alert_date', sinceDate)
        .order('alert_date', { ascending: true })
        .range(from, to)
    );

    const byDate: Record<string, { sent: number; failed: number; skipped: number }> = {};

    if (data) {
      for (const row of data) {
        const date = row.alert_date;
        if (!date) continue;
        if (!byDate[date]) byDate[date] = { sent: 0, failed: 0, skipped: 0 };

        if (row.delivery_status === 'sent') byDate[date].sent++;
        else if (row.delivery_status === 'failed') byDate[date].failed++;
        else if (row.delivery_status === 'skipped') byDate[date].skipped++;
      }
    }

    // Always return the full rolling window, including zero days, so the trend keeps moving.
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
    console.error('Error fetching alert trend:', e);
  }

  return trend;
}

async function getBriefingTrend(sinceDate: string) {
  const trend: Array<{ date: string; sent: number; failed: number; skipped: number }> = [];

  try {
    const data = await fetchAllRows<{
      briefing_date: string;
      email_sent_at?: string | null;
      delivery_status: string;
    }>((from, to) =>
      getSupabase()
        .from('briefing_log')
        .select('briefing_date, email_sent_at, delivery_status')
        .or(`briefing_date.gte.${sinceDate},email_sent_at.gte.${sinceDate}T00:00:00Z`)
        .order('briefing_date', { ascending: true })
        .range(from, to)
    );

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
      details?: string;
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
    const priceCache = new Map<string, { product: string; bundle?: string; details?: string }>();
    const productCache = new Map<string, string>();

    async function resolveProductName(productRef: string | { id?: string; name?: string } | null | undefined): Promise<string | null> {
      if (!productRef) return null;
      if (typeof productRef === 'object' && 'name' in productRef && productRef.name) {
        return productRef.name;
      }

      const productId = typeof productRef === 'string' ? productRef : productRef.id;
      if (!productId) return null;
      if (productCache.has(productId)) {
        return productCache.get(productId)!;
      }

      try {
        const product = await stripe.products.retrieve(productId);
        const name = product.name || null;
        if (name) {
          productCache.set(productId, name);
        }
        return name;
      } catch {
        return null;
      }
    }

    async function resolvePriceSummary(
      priceRef: string | { id?: string; nickname?: string | null; product?: string | { id?: string; name?: string }; recurring?: { interval?: string; interval_count?: number } | null; metadata?: Record<string, string> } | null | undefined
    ): Promise<{ product: string; bundle?: string; details?: string }> {
      if (!priceRef) {
        return { product: 'Subscription' };
      }

      const priceId = typeof priceRef === 'string' ? priceRef : priceRef.id;
      if (priceId && priceCache.has(priceId)) {
        return priceCache.get(priceId)!;
      }

      let price = priceRef;
      if (typeof priceRef === 'string') {
        try {
          price = await stripe.prices.retrieve(priceRef, { expand: ['product'] });
        } catch {
          return { product: 'Subscription' };
        }
      }

      const nickname = (typeof price === 'object' && 'nickname' in price) ? price.nickname : null;
      const recurring = (typeof price === 'object' && 'recurring' in price) ? price.recurring : null;
      const metadata = (typeof price === 'object' && 'metadata' in price) ? price.metadata : undefined;
      const productName = await resolveProductName(typeof price === 'object' && 'product' in price ? price.product : null);

      const interval = recurring?.interval
        ? `${recurring.interval_count && recurring.interval_count > 1 ? `${recurring.interval_count} ` : ''}${recurring.interval}`
        : null;

      const summary = {
        product: nickname || metadata?.product_name || productName || 'Subscription',
        bundle: metadata?.bundle || undefined,
        details: interval ? `${interval}${priceId ? ` • ${priceId}` : ''}` : (priceId || undefined),
      };

      if (priceId) {
        priceCache.set(priceId, summary);
      }

      return summary;
    }

    async function resolveChargePurchase(charge: {
      id: string;
      description: string | null;
      amount: number;
      created: number;
      billing_details?: { email?: string | null };
      receipt_email?: string | null;
      metadata: Record<string, string>;
      invoice?: string | { customer_email?: string | null; subscription?: string | { items?: { data?: Array<{ price?: string | { id?: string; nickname?: string | null; product?: string | { id?: string; name?: string }; recurring?: { interval?: string; interval_count?: number } | null; metadata?: Record<string, string> } }> } } | null } | null;
      customer?: string | { email?: string | null };
    }) {
      let email =
        charge.billing_details?.email ||
        charge.receipt_email ||
        (typeof charge.customer === 'object' ? charge.customer?.email : null) ||
        null;

      let product = charge.description || charge.metadata?.product_name || 'Subscription';
      let bundle = charge.metadata?.bundle || undefined;
      let details: string | undefined;

      const invoice = typeof charge.invoice === 'object' ? charge.invoice : null;
      if (invoice?.customer_email && !email) {
        email = invoice.customer_email;
      }

      const subscription = invoice && typeof invoice.subscription === 'object'
        ? invoice.subscription
        : null;

      const subscriptionPrice = subscription?.items?.data?.[0]?.price;
      if (subscriptionPrice) {
        const summary = await resolvePriceSummary(subscriptionPrice);
        product = summary.product || product;
        bundle = summary.bundle || bundle;
        details = summary.details || details;
      }

      return {
        email: email || 'N/A',
        product,
        amount: charge.amount / 100,
        date: new Date(charge.created * 1000).toISOString(),
        bundle,
        details,
      };
    }

    // Get charges from the last 30 days
    const charges = await stripe.charges.list({
      created: { gte: thirtyDaysAgo },
      limit: 100,
      expand: ['data.invoice', 'data.invoice.subscription', 'data.customer'],
    });

    for (const charge of charges.data) {
      if (charge.status !== 'succeeded') continue;

      const amount = charge.amount / 100; // Convert cents to dollars

      metrics.thirtyDay.total += amount;
      metrics.thirtyDay.count++;

      // Group by product (use description or metadata)
      let productName = charge.description ||
        (charge.metadata?.product_name) ||
        'Subscription';

      const expandedCharge = charge as typeof charge & {
        invoice?: string | { subscription?: string | { items?: { data?: Array<{ price?: string | { id?: string; nickname?: string | null; product?: string | { id?: string; name?: string }; recurring?: { interval?: string; interval_count?: number } | null; metadata?: Record<string, string> } }> } } | null };
      };
      const invoice = typeof expandedCharge.invoice === 'object' ? expandedCharge.invoice : null;
      const subscription = invoice && typeof invoice.subscription === 'object'
        ? invoice.subscription
        : null;
      const subscriptionPrice = subscription?.items?.data?.[0]?.price;
      if (subscriptionPrice) {
        const summary = await resolvePriceSummary(subscriptionPrice);
        productName = summary.product || productName;
      }

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
    metrics.recentPurchases = await Promise.all(
      charges.data
      .filter(c => c.status === 'succeeded')
      .slice(0, 10)
      .map(c => resolveChargePurchase(c as typeof c & {
        invoice?: string | { customer_email?: string | null; subscription?: string | { items?: { data?: Array<{ price?: string | { id?: string; nickname?: string | null; product?: string | { id?: string; name?: string }; recurring?: { interval?: string; interval_count?: number } | null; metadata?: Record<string, string> } }> } } | null };
        customer?: string | { email?: string | null };
      }))
    );

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
  const weeklyAlertHealth = await getWeeklyAlertHealth();
  const deadLetter = await getDeadLetterStats();
  const profileReminderLastRun = await kv.get<{
    summary?: {
      eligibleToSend?: number;
      cursorSkipped?: number;
      processed?: number;
      remaining?: number;
    };
  }>(PROFILE_REMINDER_LAST_RUN_KEY);

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

  const weeklyCycleDue = new Date() > new Date(weeklyAlertHealth.scheduledAtUtc);
  if (weeklyCycleDue && weeklyAlertHealth.eligibleTotal > 0 && weeklyAlertHealth.processed === 0) {
    alerts.push({
      level: 'critical',
      message: `Weekly alert fallback has no processed records for ${weeklyAlertHealth.cycleDate}`
    });
  } else if (weeklyCycleDue && weeklyAlertHealth.remaining > 0) {
    alerts.push({
      level: 'warning',
      message: `Weekly alert fallback still has ${weeklyAlertHealth.remaining} eligible users remaining for ${weeklyAlertHealth.cycleDate}`
    });
  }

  // Warning: Many unconfigured users
  const unconfiguredPercent = 100 - parseInt(userHealth.naicsPercent);
  const profileReminderSummary = profileReminderLastRun?.summary;
  const profileReminderQueueComplete = profileReminderSummary
    ? (profileReminderSummary.remaining || 0) === 0 &&
      (profileReminderSummary.eligibleToSend || 0) <=
        (profileReminderSummary.cursorSkipped || 0) + (profileReminderSummary.processed || 0)
    : false;

  if (unconfiguredPercent > 30 && !profileReminderQueueComplete) {
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

      case 'process-weekly-fallback':
        // Process the next weekly alert fallback batch. The cron endpoint owns its batch size.
        const weeklyFallbackResponse = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_URL || 'https://tools.govcongiants.org'}/api/cron/weekly-alerts?password=${ADMIN_PASSWORD}&catchup=true`,
          { method: 'GET' }
        );
        const weeklyFallbackResult = await weeklyFallbackResponse.json();
        return NextResponse.json({ success: true, action: 'process-weekly-fallback', result: weeklyFallbackResult });

      case 'send-naics-reminder':
        // Send NAICS reminder to unconfigured users
        const reminderResponse = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_URL || 'https://tools.govcongiants.org'}/api/admin/send-naics-reminder?password=${ADMIN_PASSWORD}&mode=execute&limit=50`,
          { method: 'POST' }
        );
        const reminderResult = await reminderResponse.json();
        return NextResponse.json({ success: true, action: 'send-naics-reminder', result: reminderResult });

      case 'preview-profile-reminders':
        const profilePreviewLimit = Number(body.limit || 50);
        const profilePreviewResponse = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_URL || 'https://tools.govcongiants.org'}/api/admin/send-profile-reminders?password=${ADMIN_PASSWORD}&mode=preview&limit=${profilePreviewLimit}`,
          { method: 'POST' }
        );
        const profilePreviewResult = await profilePreviewResponse.json();
        return NextResponse.json({ success: true, action: 'preview-profile-reminders', result: profilePreviewResult });

      case 'send-profile-reminders':
        const profileSendLimit = Number(body.limit || 25);
        const profileSendBatchSize = Number(body.batchSize || 10);
        const profileSendResponse = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_URL || 'https://tools.govcongiants.org'}/api/admin/send-profile-reminders?password=${ADMIN_PASSWORD}&mode=execute&limit=${profileSendLimit}&batchSize=${profileSendBatchSize}`,
          { method: 'POST' }
        );
        const profileSendResult = await profileSendResponse.json();
        return NextResponse.json({ success: true, action: 'send-profile-reminders', result: profileSendResult });

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
