/**
 * Admin Dashboard API
 *
 * Comprehensive metrics for monitoring all GovCon Giants operations
 * GET /api/admin/dashboard?password=$ADMIN_PASSWORD
 */

import { NextRequest, NextResponse } from 'next/server';
import { getReadClient } from '@/lib/supabase/server-clients';
import { kv } from '@vercel/kv';
import { isExcludedFromMetrics } from '@/lib/mindy/campaign-exclusions';
import { hasCustomProfile } from '@/lib/ghl/tag-sync';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const EMAIL_OPERATIONS_COMPLETE_HOUR_UTC = 9; // After briefings (08:30 UTC) are done - show today's data earlier
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
const BOOTCAMP_ATTENDEE_FILE = path.join(process.cwd(), 'data/bootcamp-attendees-to-enroll.txt');

// This whole dashboard route is a PURE READ (no inserts/updates) of already-synced
// data → point it at the read replica so its heavy full-table scans don't compete
// with live traffic on the memory-constrained primary. Falls back to primary when
// no replica is configured (getReadClient handles that).
function getSupabase() {
  return getReadClient();
}

const SUPABASE_PAGE_SIZE = 1000;

async function safeKvGet<T>(key: string, fallback: T | null = null): Promise<T | null> {
  try {
    return await kv.get<T>(key);
  } catch (error) {
    console.warn(`[Dashboard] KV unavailable for ${key}; using fallback`, error);
    return fallback;
  }
}

// TEMP instrumentation: per-metric timing so we can find the dashboard's real
// bottleneck (returned as `_timings` in the response, ms). Remove once diagnosed.
const _metricTimings: Record<string, number> = {};
async function safeMetric<T>(label: string, getter: () => Promise<T>, fallback: T): Promise<T> {
  const t0 = Date.now();
  try {
    return await getter();
  } catch (error) {
    console.error(`[Dashboard] ${label} failed; using fallback`, error);
    return fallback;
  } finally {
    _metricTimings[label] = Date.now() - t0;
  }
}

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
  const _requestStart = Date.now();
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
    miGrowth,
    outcomeMetrics,
    providerEmailHealth,
    matchingQuality,
    alertTrend,
    briefingTrend,
    deadLetterStats,
    forecastStats,
    sowCatalog,
    revenueMetrics,
    alerts,
    profileReminderLastRun,
    bootcampRollout
  ] = await Promise.all([
    safeMetric('email stats', () => getEmailStats(reportDate), emptyEmailStats(reportDate)),
    safeMetric('user health', getUserHealth, emptyUserHealth()),
    safeMetric('weekly alert health', getWeeklyAlertHealth, emptyWeeklyAlertHealth()),
    safeMetric('beta health', getBetaHealth, emptyBetaHealth()),
    safeMetric('MI growth metrics', getMiGrowthMetrics, emptyMiGrowthMetrics()),
    safeMetric('outcome metrics', getOutcomeMetrics, emptyOutcomeMetrics()),
    safeMetric('provider email health', getProviderEmailHealth, emptyProviderEmailHealth()),
    safeMetric('matching quality', getMatchingQuality, emptyMatchingQuality()),
    safeMetric('alert trend', () => getAlertTrend(sevenDaysAgo), []),
    safeMetric('briefing trend', () => getBriefingTrend(sevenDaysAgo), []),
    safeMetric('dead letter stats', getDeadLetterStats, emptyDeadLetterStats()),
    safeMetric('forecast stats', getForecastStats, emptyForecastStats()),
    safeMetric('sow catalog', getSowCatalogStats, emptySowCatalog()),
    safeMetric('revenue metrics', getRevenueMetrics, { available: false, error: 'Unavailable' }),
    safeMetric('system alerts', () => getSystemAlerts(reportDate), []),
    safeKvGet(PROFILE_REMINDER_LAST_RUN_KEY),
    // bootcampRollout is a pure read — run it IN the parallel block so its ~4s
    // overlaps with the other fetchers instead of adding serially on top.
    safeMetric('bootcampRollout', getBootcampRollout, emptyBootcampRollout())
  ]);
  _metricTimings['_grand_total'] = Date.now() - _requestStart;

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    displayDate: reportDate,
    // TEMP: per-section timing (ms) to locate the bottleneck. Remove once diagnosed.
    _timings: Object.fromEntries(Object.entries(_metricTimings).sort((a, b) => b[1] - a[1])),

    // Section 1: Most Recent completed email operations for the current reporting date
    emailOperations: emailStats,

    // Section 2: User Health
    userHealth,

    // Section 2b: Free weekly alert cron health
    weeklyAlerts: weeklyAlertHealth,

    // Section 2c: Beta monetization / engagement health
    betaHealth,

    // Section 2c.1: Clear MI growth, onboarding, and engagement metrics
    miGrowth,

    // Section 2c.2: Customer-result funnel
    outcomeMetrics,

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

    // Section: SOW/PWS catalog backfill progress (#66)
    sowCatalog,

    // Section 6: Revenue (if available)
    revenue: revenueMetrics,

    // Section 7: System Alerts & Warnings
    systemAlerts: alerts,

    // Section 8: Action agent state
    profileReminderLastRun,

    // Section 9: Bootcamp Rollout Progress
    bootcampRollout
  });
}

function emptyBootcampRollout() {
  return {
    totalAttendees: 0,
    totalBootcampUsers: 0,
    invitationsSent: 0,
    invitationsRemaining: 0,
    profilesCompleted: 0,
    profileCompletionRate: '0%',
    readyForAlerts: 0,
    conversionRate: '0%',
    lastInvitationSent: null as string | null,
    // treatment_type buckets from the 2026-06-30 cleanup. NOTE: this label went
    // stale — many needs_setup users have since configured a profile. Kept for
    // reference/debug, but the card leads with the *real* content test below.
    treatmentAlerts: 0,      // labeled: receiving alerts
    treatmentBriefings: 0,   // labeled: receiving briefings
    treatmentNeedsSetup: 0,  // labeled: pending setup (may be stale)
    treatmentActivated: 0,   // alerts + briefings
    // Source of truth = actual profile content (same hasCustomProfile() test the
    // GHL reignite drip uses), so the dashboard and the campaign agree on who
    // genuinely still needs setup.
    configuredReal: 0,       // has a real profile (custom NAICS / keywords / agencies)
    needsSetupReal: 0,       // empty profile — the true reignite audience
    labelStale: 0            // treatment_type=needs_setup but actually configured
  };
}

async function getBootcampRollout() {
  const DEFAULT_NAICS = ['541512', '541611', '541330', '541990', '561210'];

  const rollout = emptyBootcampRollout();

  try {
    const supabase = getSupabase();
    let bootcampUsers: Array<{
      user_email: string;
      naics_codes?: string[] | null;
      keywords?: string[] | null;
      agencies?: string[] | null;
      alerts_enabled?: boolean | null;
      treatment_type?: string | null;
      invitation_sent_at?: string | null;
      invitation_source?: string | null;
    }> | null = null;

    if (fs.existsSync(BOOTCAMP_ATTENDEE_FILE)) {
      const attendeeEmails = Array.from(new Set(
        fs.readFileSync(BOOTCAMP_ATTENDEE_FILE, 'utf8')
          .split(/\r?\n/)
          .map(email => email.toLowerCase().trim())
          .filter(email => email && email.includes('@') && !email.includes(' '))
      ));
      rollout.totalAttendees = attendeeEmails.length;
      bootcampUsers = [];

      for (let i = 0; i < attendeeEmails.length; i += 500) {
        const chunk = attendeeEmails.slice(i, i + 500);
        const { data, error } = await supabase
          .from('user_notification_settings')
          .select('user_email, naics_codes, keywords, agencies, alerts_enabled, treatment_type, invitation_sent_at, invitation_source')
          .in('user_email', chunk);

        if (error) throw error;
        bootcampUsers.push(...(data || []));
      }
    }

    if (!bootcampUsers) {
      // Fallback: all bootcamp users already enrolled in settings.
      const { data } = await supabase
        .from('user_notification_settings')
        .select('user_email, naics_codes, alerts_enabled, treatment_type, invitation_sent_at, invitation_source')
        .or('treatment_type.eq.needs_setup,invitation_source.eq.bootcamp-batch-enroll');
      const fallbackUsers = data || [];
      bootcampUsers = fallbackUsers;
      rollout.totalAttendees = fallbackUsers.length;
    }

    if (bootcampUsers) {
      rollout.totalBootcampUsers = bootcampUsers.length;

      for (const user of bootcampUsers) {
        // Count invitations sent
        if (user.invitation_sent_at) {
          rollout.invitationsSent++;
          // Track most recent
          if (!rollout.lastInvitationSent || user.invitation_sent_at > rollout.lastInvitationSent) {
            rollout.lastInvitationSent = user.invitation_sent_at;
          }
        }

        // Check if profile is completed (custom NAICS, not default)
        const naics = user.naics_codes || [];
        const hasCustomNaics = naics.length > 0 &&
          !(naics.length === DEFAULT_NAICS.length && naics.every((n: string) => DEFAULT_NAICS.includes(n)));

        if (hasCustomNaics) {
          rollout.profilesCompleted++;
        }

        // Ready for alerts (has custom NAICS and alerts enabled)
        if (hasCustomNaics && user.alerts_enabled && user.treatment_type === 'alerts') {
          rollout.readyForAlerts++;
        }

        // treatment_type buckets (2026-06-30 cleanup label — may be stale).
        if (user.treatment_type === 'alerts') rollout.treatmentAlerts++;
        else if (user.treatment_type === 'briefings') rollout.treatmentBriefings++;
        else if (user.treatment_type === 'needs_setup') rollout.treatmentNeedsSetup++;

        // Real profile-content test (matches the GHL reignite audience).
        const configured = hasCustomProfile(user.naics_codes, user.keywords, user.agencies);
        if (configured) {
          rollout.configuredReal++;
          if (user.treatment_type === 'needs_setup') rollout.labelStale++;
        } else {
          rollout.needsSetupReal++;
        }
      }
      rollout.treatmentActivated = rollout.treatmentAlerts + rollout.treatmentBriefings;

      rollout.invitationsRemaining = Math.max(rollout.totalAttendees - rollout.invitationsSent, 0);
      rollout.profileCompletionRate = rollout.invitationsSent > 0
        ? `${Math.round((rollout.profilesCompleted / rollout.invitationsSent) * 100)}%`
        : '0%';
      rollout.conversionRate = rollout.totalAttendees > 0
        ? `${Math.round((rollout.readyForAlerts / rollout.totalAttendees) * 100)}%`
        : '0%';
    }
  } catch (error) {
    console.error('getBootcampRollout error:', error);
  }

  return rollout;
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

// Default NAICS assigned during bootcamp batch enrollment. "Custom NAICS" on the
// dashboard = a profile whose codes are NOT exactly this set (the original, looser
// definition — display-only, kept for continuity per Eric). The tighter
// sweep/healthcare-aware classification lives in /api/admin/zero-alert-diagnosis.
const DEFAULT_NAICS_SET = new Set(['541512', '541611', '541330', '541990', '561210']);

async function getUserHealth() {
  const health = {
    totalUsers: 0,
    naicsConfigured: 0,      // RAW: custom NAICS beyond the 5 defaults (breakdown line)
    profileConfigured: 0,    // Custom NAICS OR keywords OR agencies (real profile test)
    naicsPercent: '0%',
    defaultNaicsOnly: 0,     // Has NAICS but only defaults
    noNaics: 0,              // No NAICS at all
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
      // Exclude comp/advocate/partner accounts from every user-health count.
      const realUsers = settingsData.filter((u: { user_email?: string }) => !isExcludedFromMetrics(u.user_email));
      health.totalUsers = realUsers.length;

      for (const user of realUsers) {
        const naicsCodes = user.naics_codes || [];
        const hasNaics = naicsCodes.length > 0;
        const hasBusinessType = user.business_type && user.business_type.trim() !== '';
        const normalizedEmail = user.user_email.toLowerCase();

        // Two distinct measures, kept separate on purpose:
        //   naicsConfigured  = RAW custom-NAICS split (Custom / Default-only / None
        //                      sum to totalUsers — the User Inventory Health card).
        //   profileConfigured = real profile test (NAICS OR keywords OR agencies) —
        //                      the same test the Profile Setup card + GHL reignite
        //                      drip + the "no profile configured" alert use.
        const hasOnlyDefaults = hasNaics &&
          naicsCodes.every((code: string) => DEFAULT_NAICS_SET.has(code));
        const hasCustomNaics = hasNaics && !hasOnlyDefaults;

        if (hasCustomProfile(user.naics_codes, user.keywords, user.agencies)) {
          health.profileConfigured++;
        }

        if (hasCustomNaics) {
          health.naicsConfigured++;
        } else if (hasOnlyDefaults) {
          health.defaultNaicsOnly++;
          health.unconfiguredEmails.push(user.user_email);
        } else {
          health.noNaics++;
          health.unconfiguredEmails.push(user.user_email);
        }

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
    eligibleWithCustomNaics: 0,
    eligibleWithDefaultNaicsOnly: 0,
    eligibleNoNaics: 0,
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
      const naicsCodes = user.naics_codes || [];
      const hasNaics = naicsCodes.length > 0;
      if (hasNaics) {
        health.eligibleWithNaics++;
        const hasOnlyDefaults = naicsCodes.every((code: string) => DEFAULT_NAICS_SET.has(code));
        if (hasOnlyDefaults) {
          health.eligibleWithDefaultNaicsOnly++;
        } else {
          health.eligibleWithCustomNaics++;
        }
      } else {
        health.eligibleNoNaics++;
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

function formatEmailClickLabel(label: string): string {
  const cleaned = label.trim();
  const normalized = cleaned.toLowerCase();

  if (normalized === 'feedback_helpful') return 'Feedback CTA: helpful';
  if (normalized === 'feedback_not_helpful') return 'Feedback CTA: not helpful';
  if (normalized === 'sam_gov_opportunity') return 'SAM.gov opportunity';
  if (normalized === 'unsubscribe') return 'Unsubscribe';
  if (normalized === 'unknown') return 'Unknown link';

  return cleaned;
}

function percentNumber(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : 0;
}

function trendMetric(current: number, previous: number) {
  return {
    current,
    previous,
    delta: current - previous,
    direction: current > previous ? 'up' : current < previous ? 'down' : 'flat',
  };
}

function emptyEmailStats(date: string) {
  return {
    date,
    alerts: { sent: 0, failed: 0, skipped: 0, successRate: 'N/A' },
    briefings: {
      sent: 0,
      failed: 0,
      skipped: 0,
      pending: 0,
      successRate: 'N/A',
      byType: { daily: 0, weekly: 0, pursuit: 0 },
    },
  };
}

function emptyUserHealth() {
  return {
    totalUsers: 0,
    naicsConfigured: 0,
    naicsPercent: 'N/A',
    defaultNaicsOnly: 0,
    noNaics: 0,
    businessTypeSet: 0,
    businessTypePercent: 'N/A',
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
    unconfiguredEmails: [] as string[],
  };
}

function emptyWeeklyAlertHealth() {
  const cycle = getWeeklyCycleDates();
  return {
    cycleDate: cycle.cycleDate,
    scheduledAtUtc: cycle.scheduledAtUtc,
    nextScheduledAtUtc: cycle.nextScheduledAtUtc,
    eligibleTotal: 0,
    eligibleWithNaics: 0,
    explicitWeeklyUsers: 0,
    freeFallbackUsers: 0,
    processedFreeFallback: 0,
    eligibleWithCustomNaics: 0,
    eligibleWithDefaultNaicsOnly: 0,
    eligibleNoNaics: 0,
    processedExplicitWeekly: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    processed: 0,
    remaining: 0,
    successRate: 'N/A',
    lastSentAt: null as string | null,
  };
}

function emptyBetaHealth() {
  return {
    weeklyActiveUsers: 0,
    dailyActiveUsers: 0,
    dauWauRatio: 'N/A',
    activeBetaUsers: 0,
    queueSize: 0,
    activationRate7d: 'N/A',
    profileCompletionRate: 'N/A',
    firstClickUsers7d: 0,
  };
}

function emptyProviderEmailHealth() {
  return {
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
}

function emptyMatchingQuality() {
  return {
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
}

function emptyMiGrowthMetrics() {
  return {
    periodDays: 7,
    acquisition: {
      signups: trendMetric(0, 0),
      profilesCompletedOrUpdated: trendMetric(0, 0),
    },
    audience: {
      totalUsers: 0,
      activeAlerts: 0,
      dailyAlerts: 0,
      weeklyAlerts: 0,
      customProfiles: 0,
      defaultProfilesOnly: 0,
      noProfile: 0,
      profileCompletionRate: 'N/A',
      briefingsEntitled: 0,
      briefingsEligible: 0,
      briefingsProfileIncomplete: 0,
    },
    email: {
      sent7d: 0,
      delivered7d: 0,
      opened7d: 0,
      clicked7d: 0,
      openRate: 'N/A',
      clickRate: 'N/A',
      topLinks: [] as Array<{ label: string; count: number }>,
    },
    app: {
      activeUsers: trendMetric(0, 0),
      activeToday: 0,
      totalEvents7d: 0,
      totalMinutes7d: 0,
      avgMinutesPerActiveUser: 0,
      topAreas: [] as Array<{ area: string; minutes: number; events: number; users: number }>,
      trackingNote: 'Admin metric unavailable.',
    },
    levers: [] as Array<{ priority: 'high' | 'medium' | 'low'; label: string; detail: string }>,
    definitions: [] as string[],
  };
}

function emptyOutcomeMetrics() {
  return {
    periodDays: 7,
    findContracts: {
      opportunityClicks: 0,
      uniqueClickers: 0,
      savedOpportunities: 0,
      savers: 0,
      pursuitBriefsRequested: 0,
      pursuitBriefsSent: 0,
      topClicked: [] as Array<{ label: string; count: number }>,
      topAgenciesSaved: [] as Array<{ agency: string; count: number }>,
    },
    winContracts: {
      pipelineItemsCreated: 0,
      pipelineUsers: 0,
      pursuing: 0,
      bidding: 0,
      submitted: 0,
      won: 0,
      lost: 0,
      dueSoon: 0,
      totalPipelineValue: 0,
      whiteGloveHelpRequests: 0,
      nextActionBreakdown: [] as Array<{ action: string; count: number }>,
      stageBreakdown: [] as Array<{ stage: string; count: number }>,
    },
    experience: {
      helpfulRate: 'N/A',
      helpful: 0,
      notHelpful: 0,
      zeroAlertUsers7d: 0,
      highVolumeUsers7d: 0,
    },
    verdicts: {
      findContracts: 'Unavailable',
      winContracts: 'Unavailable',
    },
    levers: [] as Array<{ priority: 'high' | 'medium' | 'low'; label: string; detail: string }>,
  };
}

function emptyDeadLetterStats() {
  return {
    total: 0,
    pending: 0,
    exhausted: 0,
    resolved: 0,
    oldestPending: null as string | null,
  };
}

function emptyForecastStats() {
  return {
    totalForecasts: 0,
    byAgency: {} as Record<string, number>,
    samCacheCount: 0,
    samCacheLastUpdate: null as string | null,
  };
}

function emptySowCatalog() {
  return { hasSow: 0, checked: 0, remaining: 0, total: 0, pctComplete: 0, recompeteRemaining: 0, byType: {} as Record<string, number>, embedded: 0, embedRemaining: 0, embedPct: 0, complete: false };
}

// SOW/PWS catalog backfill progress (#66). The cron does ACTIVE opps first
// (biddable now), then INACTIVE (the recompete corpus — expired solicitations
// whose SOWs we recover for Phase-6). We report active progress as the headline
// and the recompete backlog separately so the bar doesn't look "stuck" once it
// crosses into the ~55K inactive corpus.
async function getSowCatalogStats() {
  const sb = getSupabase();
  // Accept any head:true count query (a PostgREST builder is awaitable/thenable and
  // resolves to { count }). Typed loosely on purpose so all the .eq()/.not() variants
  // below fit one helper.
  const headCount = (q: PromiseLike<{ count: number | null }>) =>
    q.then(({ count }) => count || 0);

  const [hasSow, checkedWithAttach, remaining, totalWithAttach, recompeteRemaining, embedded, embedRemaining] = await Promise.all([
    headCount(sb.from('sam_opportunities').select('*', { count: 'exact', head: true }).eq('has_sow_doc', true)),
    headCount(sb.from('sam_opportunities').select('*', { count: 'exact', head: true }).eq('active', true).not('attachments', 'is', null).not('sow_checked_at', 'is', null)),
    headCount(sb.from('sam_opportunities').select('*', { count: 'exact', head: true }).eq('active', true).not('attachments', 'is', null).is('sow_checked_at', null)),
    headCount(sb.from('sam_opportunities').select('*', { count: 'exact', head: true }).eq('active', true).not('attachments', 'is', null)),
    headCount(sb.from('sam_opportunities').select('*', { count: 'exact', head: true }).eq('active', false).not('attachments', 'is', null).is('sow_checked_at', null)),
    // Embedding progress: SOWs with a vector vs. SOWs still needing one.
    headCount(sb.from('sam_opportunities').select('*', { count: 'exact', head: true }).eq('has_sow_doc', true).not('sow_embedding', 'is', null)),
    headCount(sb.from('sam_opportunities').select('*', { count: 'exact', head: true }).eq('has_sow_doc', true).not('sow_text', 'is', null).is('sow_embedding', null)),
  ]);

  const byType: Record<string, number> = {};
  for (const t of ['pws', 'sow', 'soo', 'combined', 'specs']) {
    const c = await headCount(sb.from('sam_opportunities').select('*', { count: 'exact', head: true }).eq('sow_doc_type', t));
    if (c) byType[t] = c;
  }

  const pctComplete = totalWithAttach ? Math.round((checkedWithAttach / totalWithAttach) * 100) : 0;
  return {
    hasSow, checked: checkedWithAttach, remaining, total: totalWithAttach,
    pctComplete, recompeteRemaining, byType,
    embedded, embedRemaining,
    embedPct: hasSow ? Math.round((embedded / hasSow) * 100) : 0,
    complete: remaining === 0 && totalWithAttach > 0,
  };
}

function isDefaultNaicsOnly(naicsCodes: string[] | null | undefined): boolean {
  const codes = naicsCodes || [];
  return codes.length > 0 && codes.every((code: string) => DEFAULT_NAICS_SET.has(code));
}

function hasCustomNaics(naicsCodes: string[] | null | undefined): boolean {
  const codes = naicsCodes || [];
  return codes.length > 0 && !isDefaultNaicsOnly(codes);
}

function engagementAreaLabel(source?: string | null, metadata?: Record<string, unknown> | null): string {
  const panel = typeof metadata?.panel === 'string' ? metadata.panel : source;
  const normalized = String(panel || 'market_intelligence').replace(/_/g, ' ');
  return normalized
    .split(/[\s-]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

async function getMiGrowthMetrics() {
  const now = new Date();
  const periodDays = 7;
  const periodStart = new Date(now.getTime() - periodDays * 24 * 60 * 60 * 1000);
  const previousStart = new Date(now.getTime() - periodDays * 2 * 24 * 60 * 60 * 1000);
  const todayStart = new Date(now);
  todayStart.setUTCHours(0, 0, 0, 0);

  const metrics = {
    periodDays,
    windows: {
      currentStart: periodStart.toISOString(),
      previousStart: previousStart.toISOString(),
      currentEnd: now.toISOString(),
    },
    acquisition: {
      signups: trendMetric(0, 0),
      profilesCompletedOrUpdated: trendMetric(0, 0),
    },
    audience: {
      totalUsers: 0,
      activeAlerts: 0,
      dailyAlerts: 0,
      weeklyAlerts: 0,
      customProfiles: 0,
      defaultProfilesOnly: 0,
      noProfile: 0,
      profileCompletionRate: '0%',
      briefingsEntitled: 0,
      briefingsEligible: 0,
      briefingsProfileIncomplete: 0,
    },
    email: {
      sent7d: 0,
      delivered7d: 0,
      opened7d: 0,
      clicked7d: 0,
      openRate: 'N/A',
      clickRate: 'N/A',
      topLinks: [] as Array<{ label: string; count: number }>,
    },
    app: {
      activeUsers: trendMetric(0, 0),
      activeToday: 0,
      totalEvents7d: 0,
      totalMinutes7d: 0,
      avgMinutesPerActiveUser: 0,
      topAreas: [] as Array<{ area: string; minutes: number; events: number; users: number }>,
      trackingNote: 'App time is tracked from MI page activity going forward.',
    },
    levers: [] as Array<{ priority: 'high' | 'medium' | 'low'; label: string; detail: string }>,
    definitions: [
      'Audience is the current inventory of users and access flags.',
      'Delivery is what was actually sent for a date or cycle after matching and dedupe.',
      'Engagement is opens, clicks, and app activity inside the selected period.',
    ],
  };

  try {
    const supabase = getSupabase();
    const [
      settings,
      classificationRows,
      engagementRows,
      providerHealth,
    ] = await Promise.all([
      fetchAllRows<{
        user_email: string;
        naics_codes?: string[] | null;
        keywords?: string[] | null;
        agencies?: string[] | null;
        alerts_enabled?: boolean | null;
        alert_frequency?: string | null;
        briefings_enabled?: boolean | null;
        is_active?: boolean | null;
        created_at?: string | null;
        updated_at?: string | null;
      }>((from, to) =>
        supabase
          .from('user_notification_settings')
          .select('user_email, naics_codes, keywords, agencies, alerts_enabled, alert_frequency, briefings_enabled, is_active, created_at, updated_at')
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
      fetchAllRows<{
        user_email: string | null;
        event_type: string;
        event_source?: string | null;
        metadata?: Record<string, unknown> | null;
        created_at: string;
      }>((from, to) =>
        supabase
          .from('user_engagement')
          .select('user_email, event_type, event_source, metadata, created_at')
          .gte('created_at', previousStart.toISOString())
          .range(from, to)
      ),
      getProviderEmailHealth(),
    ]);

    const latestClassificationVersion = classificationRows.reduce(
      (max: number, row: { classification_version?: number | null }) =>
        Math.max(max, Number(row.classification_version || 0)),
      0
    );
    const entitledAccess = new Set(['lifetime', '1_year', '6_month', 'subscription', 'beta_preview']);
    const currentEntitledEmails = new Set<string>();
    const nowMs = now.getTime();

    for (const row of classificationRows) {
      if (Number(row.classification_version || 0) !== latestClassificationVersion) continue;
      if (!entitledAccess.has(row.briefings_access || '')) continue;
      if (row.briefings_expiry && new Date(row.briefings_expiry).getTime() <= nowMs) continue;
      currentEntitledEmails.add(row.email.toLowerCase());
    }

    let signupsCurrent = 0;
    let signupsPrevious = 0;
    let profilesCurrent = 0;
    let profilesPrevious = 0;

    for (const user of settings) {
      const email = user.user_email.toLowerCase();
      const active = user.is_active !== false;
      // Same profile test as the card + GHL drip: NAICS OR keywords OR agencies.
      const customProfile = hasCustomProfile(user.naics_codes, user.keywords, user.agencies);
      const defaultProfile = !customProfile && isDefaultNaicsOnly(user.naics_codes);
      const createdAt = user.created_at ? new Date(user.created_at).getTime() : 0;
      const updatedAt = user.updated_at ? new Date(user.updated_at).getTime() : 0;

      metrics.audience.totalUsers++;
      if (customProfile) metrics.audience.customProfiles++;
      else if (defaultProfile) metrics.audience.defaultProfilesOnly++;
      else metrics.audience.noProfile++;

      if (active && user.alerts_enabled) {
        metrics.audience.activeAlerts++;
        if (user.alert_frequency === 'daily') metrics.audience.dailyAlerts++;
        if (user.alert_frequency === 'weekly') metrics.audience.weeklyAlerts++;
      }

      if (currentEntitledEmails.has(email)) {
        metrics.audience.briefingsEntitled++;
        if (active && user.briefings_enabled) {
          metrics.audience.briefingsEligible++;
          if (!customProfile) metrics.audience.briefingsProfileIncomplete++;
        }
      }

      if (createdAt >= periodStart.getTime()) signupsCurrent++;
      else if (createdAt >= previousStart.getTime() && createdAt < periodStart.getTime()) signupsPrevious++;

      if (customProfile && updatedAt >= periodStart.getTime()) profilesCurrent++;
      else if (customProfile && updatedAt >= previousStart.getTime() && updatedAt < periodStart.getTime()) profilesPrevious++;
    }

    metrics.acquisition.signups = trendMetric(signupsCurrent, signupsPrevious);
    metrics.acquisition.profilesCompletedOrUpdated = trendMetric(profilesCurrent, profilesPrevious);
    metrics.audience.profileCompletionRate = percent(metrics.audience.customProfiles, metrics.audience.totalUsers);

    metrics.email = {
      sent7d: providerHealth.sends7d,
      delivered7d: providerHealth.delivered7d,
      opened7d: providerHealth.opened7d,
      clicked7d: providerHealth.clicked7d,
      openRate: percent(providerHealth.opened7d, providerHealth.delivered7d || providerHealth.sends7d),
      clickRate: providerHealth.clickRate,
      topLinks: providerHealth.topLinks,
    };

    if (metrics.email.sent7d === 0 && metrics.email.opened7d === 0 && metrics.email.clicked7d === 0) {
      const topLinks: Record<string, number> = {};
      for (const row of engagementRows) {
        if (new Date(row.created_at).getTime() < periodStart.getTime()) continue;
        if (row.event_type === 'email_open') metrics.email.opened7d++;
        if (row.event_type === 'link_click') {
          metrics.email.clicked7d++;
          const metadata = row.metadata || {};
          const label = typeof metadata.link_text === 'string'
            ? formatEmailClickLabel(metadata.link_text)
            : typeof metadata.url === 'string'
              ? formatEmailClickLabel(metadata.url)
              : 'Link click';
          topLinks[label] = (topLinks[label] || 0) + 1;
        }
      }
      metrics.email.topLinks = Object.entries(topLinks)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([label, count]) => ({ label, count }));
      metrics.email.openRate = 'Tracked opens';
      metrics.email.clickRate = metrics.email.opened7d > 0
        ? percent(metrics.email.clicked7d, metrics.email.opened7d)
        : 'Tracked clicks';
    }

    const appEventTypes = new Set(['page_view', 'tool_use', 'report_generate', 'export', 'login', 'profile_update', 'onboarding_step']);
    const activeCurrent = new Set<string>();
    const activePrevious = new Set<string>();
    const activeToday = new Set<string>();
    const areas = new Map<string, { minutes: number; events: number; users: Set<string> }>();

    for (const row of engagementRows) {
      if (!appEventTypes.has(row.event_type)) continue;
      const email = row.user_email?.toLowerCase();
      if (!email) continue;
      const createdAt = new Date(row.created_at).getTime();
      const isCurrent = createdAt >= periodStart.getTime();
      const isPrevious = createdAt >= previousStart.getTime() && createdAt < periodStart.getTime();

      if (isCurrent) {
        activeCurrent.add(email);
        metrics.app.totalEvents7d++;
        if (createdAt >= todayStart.getTime()) activeToday.add(email);

        const metadata = row.metadata || {};
        const rawDuration = metadata.duration_ms;
        const durationMs = typeof rawDuration === 'number' && Number.isFinite(rawDuration) ? rawDuration : 0;
        const minutes = Math.round((durationMs / 60000) * 10) / 10;
        metrics.app.totalMinutes7d += minutes;

        const area = engagementAreaLabel(row.event_source, metadata);
        const item = areas.get(area) || { minutes: 0, events: 0, users: new Set<string>() };
        item.minutes += minutes;
        item.events++;
        item.users.add(email);
        areas.set(area, item);
      } else if (isPrevious) {
        activePrevious.add(email);
      }
    }

    metrics.app.activeUsers = trendMetric(activeCurrent.size, activePrevious.size);
    metrics.app.activeToday = activeToday.size;
    metrics.app.totalMinutes7d = Math.round(metrics.app.totalMinutes7d * 10) / 10;
    metrics.app.avgMinutesPerActiveUser = activeCurrent.size > 0
      ? Math.round((metrics.app.totalMinutes7d / activeCurrent.size) * 10) / 10
      : 0;
    metrics.app.topAreas = Array.from(areas.entries())
      .sort((a, b) => (b[1].minutes - a[1].minutes) || (b[1].events - a[1].events))
      .slice(0, 6)
      .map(([area, item]) => ({
        area,
        minutes: Math.round(item.minutes * 10) / 10,
        events: item.events,
        users: item.users.size,
      }));

    const profileGap = metrics.audience.defaultProfilesOnly + metrics.audience.noProfile;
    if (profileGap > 0) {
      metrics.levers.push({
        priority: profileGap > metrics.audience.customProfiles ? 'high' : 'medium',
        label: 'Profile setup is the biggest matching lever',
        detail: `${profileGap.toLocaleString()} users still need custom NAICS/profile data before alerts and briefings can feel personal.`,
      });
    }

    const clickRateNumber = percentNumber(metrics.email.clicked7d, metrics.email.delivered7d || metrics.email.sent7d);
    if (metrics.email.sent7d > 0 && clickRateNumber < 8) {
      metrics.levers.push({
        priority: 'medium',
        label: 'Email clicks need attention',
        detail: `7-day click rate is ${metrics.email.clickRate}. Test stronger first-link placement and subject lines against the top-clicked topics.`,
      });
    }

    if (metrics.app.totalMinutes7d === 0) {
      metrics.levers.push({
        priority: 'high',
        label: 'Start measuring time in MI',
        detail: 'The dashboard now logs panel time from the MI app, so this becomes the Duolingo-style success metric going forward.',
      });
    } else if (metrics.app.avgMinutesPerActiveUser < 5) {
      metrics.levers.push({
        priority: 'medium',
        label: 'Drive users deeper into the app',
        detail: `Average app time is ${metrics.app.avgMinutesPerActiveUser} minutes per active user. Push email CTAs to the panels with the best retention.`,
      });
    }
  } catch (error) {
    console.error('Error fetching MI growth metrics:', error);
  }

  return metrics;
}

async function getOutcomeMetrics() {
  const now = new Date();
  const periodDays = 7;
  const periodStart = new Date(now.getTime() - periodDays * 24 * 60 * 60 * 1000);
  const periodStartIso = periodStart.toISOString();

  const metrics = {
    periodDays,
    findContracts: {
      opportunityClicks: 0,
      uniqueClickers: 0,
      savedOpportunities: 0,
      savers: 0,
      pursuitBriefsRequested: 0,
      pursuitBriefsSent: 0,
      topClicked: [] as Array<{ label: string; count: number }>,
      topAgenciesSaved: [] as Array<{ agency: string; count: number }>,
    },
    winContracts: {
      pipelineItemsCreated: 0,
      pipelineUsers: 0,
      pursuing: 0,
      bidding: 0,
      submitted: 0,
      won: 0,
      lost: 0,
      dueSoon: 0,
      totalPipelineValue: 0,
      whiteGloveHelpRequests: 0,
      nextActionBreakdown: [] as Array<{ action: string; count: number }>,
      stageBreakdown: [] as Array<{ stage: string; count: number }>,
    },
    experience: {
      helpfulRate: 'N/A',
      helpful: 0,
      notHelpful: 0,
      zeroAlertUsers7d: 0,
      highVolumeUsers7d: 0,
    },
    verdicts: {
      findContracts: 'Needs data',
      winContracts: 'Needs data',
    },
    levers: [] as Array<{ priority: 'high' | 'medium' | 'low'; label: string; detail: string }>,
  };

  try {
    const supabase = getSupabase();
    const [
      engagementRows,
      savedOpportunities,
      pursuitBriefs,
      pipelineRows,
      matchingQuality,
    ] = await Promise.all([
      fetchAllRows<{
        user_email: string | null;
        event_type: string;
        metadata?: Record<string, unknown> | null;
        created_at: string;
      }>((from, to) =>
        supabase
          .from('user_engagement')
          .select('user_email, event_type, metadata, created_at')
          .gte('created_at', periodStartIso)
          .range(from, to)
      ),
      fetchAllRows<{
        user_email: string;
        agency?: string | null;
        status?: string | null;
        pursuit_brief_requested?: boolean | null;
        pursuit_brief_sent_at?: string | null;
        created_at: string;
      }>((from, to) =>
        supabase
          .from('user_saved_opportunities')
          .select('user_email, agency, status, pursuit_brief_requested, pursuit_brief_sent_at, created_at')
          .gte('created_at', periodStartIso)
          .range(from, to)
      ).catch(() => []),
      fetchAllRows<{
        user_email: string;
        delivery_status?: string | null;
        sent_at?: string | null;
        created_at: string;
      }>((from, to) =>
        supabase
          .from('pursuit_brief_log')
          .select('user_email, delivery_status, sent_at, created_at')
          .gte('created_at', periodStartIso)
          .range(from, to)
      ).catch(() => []),
      fetchAllRows<{
        user_email: string;
        stage?: string | null;
        next_action?: string | null;
        value_estimate?: string | null;
        award_amount?: string | null;
        response_deadline?: string | null;
        created_at?: string | null;
        updated_at?: string | null;
      }>((from, to) =>
        supabase
          .from('user_pipeline')
          .select('user_email, stage, next_action, value_estimate, award_amount, response_deadline, created_at, updated_at')
          .or(`created_at.gte.${periodStartIso},updated_at.gte.${periodStartIso}`)
          .range(from, to)
      ).catch(() => []),
      getMatchingQuality(),
    ]);

    const clickers = new Set<string>();
    const topClicked: Record<string, number> = {};
    for (const row of engagementRows) {
      if (row.event_type !== 'link_click') continue;
      const metadata = row.metadata || {};
      const label = typeof metadata.link_text === 'string'
        ? metadata.link_text
        : typeof metadata.url === 'string'
          ? metadata.url
          : 'link_click';
      const lowerLabel = label.toLowerCase();
      const isOpportunityClick =
        lowerLabel.includes('sam') ||
        lowerLabel.includes('opportunity') ||
        lowerLabel.includes('pursuit') ||
        lowerLabel.includes('pipeline');

      if (!isOpportunityClick) continue;

      metrics.findContracts.opportunityClicks++;
      if (row.user_email) clickers.add(row.user_email.toLowerCase());
      topClicked[label] = (topClicked[label] || 0) + 1;
    }
    metrics.findContracts.uniqueClickers = clickers.size;
    metrics.findContracts.topClicked = Object.entries(topClicked)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([label, count]) => ({ label, count }));

    const savers = new Set<string>();
    const agencyCounts: Record<string, number> = {};
    for (const row of savedOpportunities) {
      metrics.findContracts.savedOpportunities++;
      savers.add(row.user_email.toLowerCase());
      if (row.pursuit_brief_requested) metrics.findContracts.pursuitBriefsRequested++;
      if (row.pursuit_brief_sent_at) metrics.findContracts.pursuitBriefsSent++;
      const agency = row.agency || 'Unknown';
      agencyCounts[agency] = (agencyCounts[agency] || 0) + 1;
    }
    for (const row of pursuitBriefs) {
      if (row.delivery_status === 'sent' || row.sent_at) metrics.findContracts.pursuitBriefsSent++;
    }
    metrics.findContracts.savers = savers.size;
    metrics.findContracts.topAgenciesSaved = Object.entries(agencyCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([agency, count]) => ({ agency, count }));

    const pipelineUsers = new Set<string>();
    const stages: Record<string, number> = {};
    const nextActions: Record<string, number> = {};
    const soon = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).getTime();
    for (const row of pipelineRows) {
      metrics.winContracts.pipelineItemsCreated++;
      pipelineUsers.add(row.user_email.toLowerCase());
      const stage = row.stage || 'tracking';
      stages[stage] = (stages[stage] || 0) + 1;
      if (stage === 'pursuing') metrics.winContracts.pursuing++;
      if (stage === 'bidding') metrics.winContracts.bidding++;
      if (stage === 'submitted') metrics.winContracts.submitted++;
      if (stage === 'won') metrics.winContracts.won++;
      if (stage === 'lost') metrics.winContracts.lost++;

      if (row.next_action) {
        nextActions[row.next_action] = (nextActions[row.next_action] || 0) + 1;
        if (row.next_action === 'white_glove_help') metrics.winContracts.whiteGloveHelpRequests++;
        if (row.next_action === 'request_pursuit_brief') metrics.findContracts.pursuitBriefsRequested++;
      }

      const deadline = row.response_deadline ? new Date(row.response_deadline).getTime() : 0;
      if (deadline && deadline >= now.getTime() && deadline <= soon) metrics.winContracts.dueSoon++;

      const amountText = String(row.award_amount || row.value_estimate || '').replace(/[^0-9.]/g, '');
      const amount = Number(amountText);
      if (Number.isFinite(amount)) metrics.winContracts.totalPipelineValue += amount;
    }
    metrics.winContracts.pipelineUsers = pipelineUsers.size;
    metrics.winContracts.stageBreakdown = Object.entries(stages)
      .sort((a, b) => b[1] - a[1])
      .map(([stage, count]) => ({ stage, count }));
    metrics.winContracts.nextActionBreakdown = Object.entries(nextActions)
      .sort((a, b) => b[1] - a[1])
      .map(([action, count]) => ({ action, count }));

    metrics.experience = {
      helpfulRate: matchingQuality.helpfulRate,
      helpful: matchingQuality.helpful,
      notHelpful: matchingQuality.notHelpful,
      zeroAlertUsers7d: matchingQuality.zeroAlertUsers7d,
      highVolumeUsers7d: matchingQuality.highVolumeUsers7d,
    };

    metrics.verdicts.findContracts = metrics.findContracts.opportunityClicks > 0 || metrics.findContracts.savedOpportunities > 0
      ? 'Yes, if clicks become saves'
      : 'Not proven this week';
    metrics.verdicts.winContracts = metrics.winContracts.pipelineItemsCreated > 0 || metrics.winContracts.submitted > 0 || metrics.winContracts.won > 0
      ? 'Partially, if pipeline advances'
      : 'Not proven this week';

    if (metrics.findContracts.opportunityClicks > 0 && metrics.findContracts.savedOpportunities === 0) {
      metrics.levers.push({
        priority: 'high',
        label: 'Convert clicks into saved opportunities',
        detail: `${metrics.findContracts.opportunityClicks} opportunity clicks but no saved opportunities. Make Save/Add to Pipeline the obvious next step.`,
      });
    }
    if (metrics.findContracts.savedOpportunities > 0 && metrics.winContracts.pipelineItemsCreated === 0) {
      metrics.levers.push({
        priority: 'high',
        label: 'Connect saved opportunities to pipeline',
        detail: `${metrics.findContracts.savedOpportunities} saved opportunities but no pipeline items. The product should prompt next action and pursuit stage.`,
      });
    }
    if (metrics.winContracts.whiteGloveHelpRequests > 0) {
      metrics.levers.push({
        priority: 'high',
        label: 'Follow up on white-glove signals',
        detail: `${metrics.winContracts.whiteGloveHelpRequests} users asked GovCon Giants for help from the MI next-action prompt.`,
      });
    }
    if (metrics.experience.zeroAlertUsers7d > 0) {
      metrics.levers.push({
        priority: 'medium',
        label: 'Fix users receiving no matches',
        detail: `${metrics.experience.zeroAlertUsers7d} configured users had zero alerts in 7 days. Review NAICS breadth, keywords, and source coverage.`,
      });
    }
    if (metrics.experience.helpfulRate !== 'N/A' && parseInt(metrics.experience.helpfulRate) < 60) {
      metrics.levers.push({
        priority: 'medium',
        label: 'Improve match quality',
        detail: `Helpful rate is ${metrics.experience.helpfulRate}. Use feedback reasons to tune scoring and filters.`,
      });
    }
  } catch (error) {
    console.error('Error fetching outcome metrics:', error);
  }

  return metrics;
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
    // Duolingo-style habit signal: distinct engaged users per day, last 7 days.
    // The return curve — is the same audience coming back day over day?
    returnCurve: [] as Array<{ date: string; activeUsers: number }>,
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
        created_at: string | null;
      }>((from, to) =>
        supabase
          .from('user_engagement')
          .select('user_email, event_type, created_at')
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

    // Return curve: distinct engaged users per UTC day across the last 7 days.
    // Built from the same engagement7d set (now carries created_at). Seed every
    // day at 0 so gaps render as real zero-days, not missing bars.
    const perDay = new Map<string, Set<string>>();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      perDay.set(d.toISOString().split('T')[0], new Set<string>());
    }
    for (const row of engagement7d) {
      if (!row.user_email || !row.created_at) continue;
      const day = row.created_at.split('T')[0];
      perDay.get(day)?.add(row.user_email);
    }
    health.returnCurve = [...perDay.entries()].map(([date, users]) => ({ date, activeUsers: users.size }));
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
              ? link.includes('type=not_helpful')
                ? 'Feedback CTA: not helpful'
                : link.includes('type=helpful')
                  ? 'Feedback CTA: helpful'
                  : 'Feedback CTA'
              : formatEmailClickLabel(link);
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

// The pro-buyer list comes from a cross-site fetch to shop.govcongiants.com pulling
// a FULL YEAR of purchases (~6.7s) — and it's called 3× per dashboard load (userHealth,
// matchingQuality, revenue). It was the dominant dashboard bottleneck (instrumented
// 2026-07-07). Three fixes so it stops costing ~6.7s×3:
//   1) in-request memoization — the 3 calls in one load share ONE fetch
//   2) KV cache (10-min TTL) — most loads skip the shop call entirely
//   3) 8s timeout — a slow/hung shop can't block the dashboard indefinitely
// The buyer list changes slowly, so a few minutes of staleness is fine here.
const WEEKLY_BUYER_CACHE_KEY = 'dashboard:weekly-alert-buyers:v1';
const WEEKLY_BUYER_TTL_SECONDS = 600; // 10 min
let _weeklyBuyerInflight: Promise<Set<string>> | null = null;

async function fetchWeeklyAlertBuyerEmailsUncached(): Promise<Set<string>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch('https://shop.govcongiants.com/api/admin/purchases-report?days=365', {
      headers: { 'x-admin-password': process.env.SHOP_ADMIN_PASSWORD || 'admin123' },
      signal: controller.signal,
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
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWeeklyAlertBuyerEmails(): Promise<Set<string>> {
  // 1) share one fetch across the 3 concurrent callers in a single request.
  if (_weeklyBuyerInflight) return _weeklyBuyerInflight;

  _weeklyBuyerInflight = (async () => {
    // 2) KV cache: a stored email array short-circuits the cross-site call.
    try {
      const cached = await kv.get<string[]>(WEEKLY_BUYER_CACHE_KEY);
      if (Array.isArray(cached)) return new Set(cached);
    } catch { /* KV miss/unavailable → fall through to live fetch */ }

    const fresh = await fetchWeeklyAlertBuyerEmailsUncached();
    // Only cache a non-empty result — an empty set usually means the shop call
    // failed/timed out, and we don't want to pin "no pro buyers" for 10 min.
    if (fresh.size > 0) {
      try { await kv.set(WEEKLY_BUYER_CACHE_KEY, [...fresh], { ex: WEEKLY_BUYER_TTL_SECONDS }); } catch { /* non-fatal */ }
    }
    return fresh;
  })();

  try {
    return await _weeklyBuyerInflight;
  } finally {
    _weeklyBuyerInflight = null; // reset so the next request re-checks cache
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
  const trend: Array<{
    date: string;
    sent: number;
    failed: number;
    skipped: number;
    byType: { daily: number; weekly: number; pursuit: number };
  }> = [];

  try {
    const data = await fetchAllRows<{
      briefing_date: string;
      email_sent_at?: string | null;
      delivery_status: string;
      briefing_type?: string | null;
    }>((from, to) =>
      getSupabase()
        .from('briefing_log')
        .select('briefing_date, email_sent_at, delivery_status, briefing_type')
        .or(`briefing_date.gte.${sinceDate},email_sent_at.gte.${sinceDate}T00:00:00Z`)
        .order('briefing_date', { ascending: true })
        .range(from, to)
    );

    const byDate: Record<string, {
      sent: number;
      failed: number;
      skipped: number;
      byType: { daily: number; weekly: number; pursuit: number };
    }> = {};

    if (data) {
      for (const row of data) {
        // Use email_sent_at date for sent emails (actual send date), otherwise use briefing_date
        const date = row.delivery_status === 'sent' && row.email_sent_at
          ? String(row.email_sent_at).split('T')[0]
          : row.briefing_date;

        if (!date) continue;
        if (!byDate[date]) {
          byDate[date] = {
            sent: 0,
            failed: 0,
            skipped: 0,
            byType: { daily: 0, weekly: 0, pursuit: 0 }
          };
        }

        if (row.delivery_status === 'sent') {
          byDate[date].sent++;
          // Track by type for sent only
          const type = row.briefing_type || 'daily';
          if (type === 'daily') byDate[date].byType.daily++;
          else if (type === 'weekly') byDate[date].byType.weekly++;
          else if (type === 'pursuit') byDate[date].byType.pursuit++;
        } else if (row.delivery_status === 'failed') {
          byDate[date].failed++;
        } else if (row.delivery_status === 'skipped') {
          byDate[date].skipped++;
        }
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
        ...(byDate[date] || { sent: 0, failed: 0, skipped: 0, byType: { daily: 0, weekly: 0, pursuit: 0 } }),
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
      invoice?: string | { id?: string; customer_email?: string | null; subscription?: string | { id?: string; items?: { data?: Array<{ price?: string | { id?: string; nickname?: string | null; product?: string | { id?: string; name?: string }; recurring?: { interval?: string; interval_count?: number } | null; metadata?: Record<string, string> } }> } } | null } | null;
      customer?: string | { id?: string; email?: string | null };
    }) {
      let email =
        charge.billing_details?.email ||
        charge.receipt_email ||
        (typeof charge.customer === 'object' ? charge.customer?.email : null) ||
        null;

      // Don't use generic Stripe descriptions like "Subscription creation"
      const isGenericDescription = !charge.description ||
        charge.description.toLowerCase().includes('subscription creation') ||
        charge.description.toLowerCase().includes('subscription update');

      let product = isGenericDescription
        ? (charge.metadata?.product_name || 'Purchase')
        : (charge.description || 'Purchase');
      let transactionType = 'one-time';

      // Handle invoice - can be object (expanded) or string ID
      const invoiceObj = typeof charge.invoice === 'object' ? charge.invoice : null;
      const invoiceId = typeof charge.invoice === 'string' ? charge.invoice : invoiceObj?.id;

      if (invoiceObj?.customer_email && !email) {
        email = invoiceObj.customer_email;
      }

      // Get subscription reference - could be object or string ID
      const subscriptionRef = invoiceObj?.subscription;
      let foundProductName = false;

      // If there's an invoice with subscription, it's recurring
      if (invoiceId || subscriptionRef) {
        transactionType = 'subscription';
      }

      // Try 1: If subscription is an object with items, use them
      if (subscriptionRef && typeof subscriptionRef === 'object' && subscriptionRef.items?.data?.[0]?.price) {
        const summary = await resolvePriceSummary(subscriptionRef.items.data[0].price);
        // Accept the product name if it's not a generic fallback
        if (summary.product && !['Subscription', 'Purchase'].includes(summary.product)) {
          // Clean up product names like "Copy of PRO Member Group - Monthly"
          product = summary.product.replace(/^Copy of /, '');
          foundProductName = true;
        }
      }
      // Try 2: If subscription is a string ID, fetch it
      else if (subscriptionRef && !foundProductName) {
        const subscriptionId = typeof subscriptionRef === 'string' ? subscriptionRef : subscriptionRef.id;
        if (subscriptionId) {
          try {
            const fullSubscription = await stripe.subscriptions.retrieve(subscriptionId, {
              expand: ['items.data.price.product']
            });
            const subscriptionPrice = fullSubscription.items?.data?.[0]?.price;
            if (subscriptionPrice) {
              const summary = await resolvePriceSummary(subscriptionPrice);
              if (summary.product && !['Subscription', 'Purchase'].includes(summary.product)) {
                product = summary.product.replace(/^Copy of /, '');
                foundProductName = true;
              }
            }
          } catch {
            // Subscription may have been deleted, continue with fallback
          }
        }
      }

      // Try 3: Use already-expanded invoice line item description (no API call needed)
      // The charges.list() call expands data.invoice, which includes lines.data[].description
      if (!foundProductName && invoiceObj) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const invoiceAny = invoiceObj as any;
        const lineItem = invoiceAny.lines?.data?.[0];
        if (lineItem?.description) {
          // Clean up description like "1 × Product Name (at $X.XX / month)"
          const cleanedDesc = lineItem.description
            .replace(/^\d+\s*[×x]\s*/, '')  // Remove "1 × " prefix
            .replace(/\s*\(at \$[\d.,]+\s*\/\s*\w+\)$/, '')  // Remove "(at $X / month)" suffix
            .replace(/^Copy of /, '')  // Remove "Copy of " prefix
            .trim();

          if (cleanedDesc && !cleanedDesc.toLowerCase().includes('subscription')) {
            product = cleanedDesc;
            foundProductName = true;
          }
        }
      }

      // Try 4: Fetch invoice with full expansion (fallback if line description missing)
      if (!foundProductName && invoiceId) {
        try {
          const fullInvoice = await stripe.invoices.retrieve(invoiceId, {
            expand: ['lines.data.price.product']
          });
          const lineItem = fullInvoice.lines?.data?.[0];
          if (lineItem) {
            // Get product name from line item price.product
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const linePrice = (lineItem as any).price;

            if (linePrice && typeof linePrice === 'object') {
              const productObj = linePrice.product;
              // Get name from expanded product object
              const productName = typeof productObj === 'object' ? productObj?.name : null;

              if (productName && productName !== 'Subscription') {
                // Clean up the product name (remove "Copy of " prefix if present)
                product = productName.replace(/^Copy of /, '');
                foundProductName = true;
              } else if (linePrice.nickname) {
                product = linePrice.nickname;
                foundProductName = true;
              }
            }

            // Fall back to cleaned line item description if still no product name
            if (!foundProductName && lineItem.description) {
              // Clean up description like "1 × Product Name (at $X.XX / month)"
              const cleanedDesc = lineItem.description
                .replace(/^\d+\s*[×x]\s*/, '')  // Remove "1 × " prefix
                .replace(/\s*\(at \$[\d.,]+\s*\/\s*\w+\)$/, '')  // Remove "(at $X / month)" suffix
                .replace(/^Copy of /, '')  // Remove "Copy of " prefix
                .trim();

              if (cleanedDesc && !cleanedDesc.toLowerCase().includes('subscription')) {
                product = cleanedDesc;
                foundProductName = true;
              }
            }
          }
        } catch {
          // Invoice fetch failed, continue with fallback
        }
      }

      // Try 5: Last resort - look up customer's subscriptions directly
      // Note: Stripe has a 4-level expansion limit, so we can't use deep expansions
      // Instead, get subscription and then resolve price/product separately
      if (!foundProductName && charge.customer) {
        const customerId = typeof charge.customer === 'string' ? charge.customer : charge.customer.id;
        if (customerId) {
          try {
            const subscriptions = await stripe.subscriptions.list({
              customer: customerId,
              limit: 1,
              // Only expand to 4 levels max
              expand: ['data.items.data.price']
            });
            const sub = subscriptions.data[0];
            const subItem = sub?.items?.data?.[0];
            if (subItem?.price) {
              // Found a subscription for this customer - mark as subscription type
              transactionType = 'subscription';
              // Use resolvePriceSummary to handle product lookup (with caching)
              const summary = await resolvePriceSummary(subItem.price);
              if (summary.product && !['Subscription', 'Purchase'].includes(summary.product)) {
                product = summary.product.replace(/^Copy of /, '');
                foundProductName = true;
              }
            }
          } catch {
            // Subscription lookup failed, continue with fallback
          }
        }
      }

      return {
        email: email || 'N/A',
        product,
        amount: charge.amount / 100,
        date: new Date(charge.created * 1000).toISOString(),
        type: transactionType,
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

      // Exclude comp/advocate/partner accounts from revenue. The charge expands
      // data.customer, so the email is on hand — drop the charge if it's a special
      // account (e.g. a comp Pro that somehow billed) so it doesn't inflate revenue.
      const chargeEmail =
        (typeof charge.customer === 'object' && charge.customer && 'email' in charge.customer
          ? (charge.customer as { email?: string | null }).email
          : null)
        || charge.billing_details?.email
        || charge.receipt_email
        || null;
      if (isExcludedFromMetrics(chargeEmail)) continue;

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

    // Recent 15 transactions - ALWAYS use Stripe charges directly
    // Shows ALL transactions: subscriptions, renewals, white glove, products
    // Critical for 1-1-1 strategy visibility
    metrics.recentPurchases = await Promise.all(
      charges.data
      .filter(c => c.status === 'succeeded')
      .slice(0, 15)
      .map(c => resolveChargePurchase(c as typeof c & {
        invoice?: string | { customer_email?: string | null; subscription?: string | { items?: { data?: Array<{ price?: string | { id?: string; nickname?: string | null; product?: string | { id?: string; name?: string }; recurring?: { interval?: string; interval_count?: number } | null; metadata?: Record<string, string> } }> } } | null };
        customer?: string | { id?: string; email?: string | null };
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
  const profileReminderLastRun = await safeKvGet<{
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
      message: `Weekly digest has no processed records for ${weeklyAlertHealth.cycleDate}`
    });
  } else if (weeklyCycleDue && weeklyAlertHealth.remaining > 0) {
    alerts.push({
      level: 'warning',
      message: `Weekly digest still has ${weeklyAlertHealth.remaining} eligible users remaining for ${weeklyAlertHealth.cycleDate}`
    });
  }

  // Warning: Many unconfigured users — measured by the REAL profile test
  // (profileConfigured), not the raw custom-NAICS split, so it matches the card.
  const profileConfiguredPct = userHealth.totalUsers > 0
    ? Math.round((userHealth.profileConfigured / userHealth.totalUsers) * 100)
    : 0;
  const unconfiguredPercent = 100 - profileConfiguredPct;
  const profileReminderSummary = profileReminderLastRun?.summary;
  const profileReminderQueueComplete = profileReminderSummary
    ? (profileReminderSummary.remaining || 0) === 0 &&
      (profileReminderSummary.eligibleToSend || 0) <=
        (profileReminderSummary.cursorSkipped || 0) + (profileReminderSummary.processed || 0)
    : false;

  if (unconfiguredPercent > 30 && !profileReminderQueueComplete) {
    alerts.push({
      level: 'warning',
      message: `${unconfiguredPercent}% of users (${userHealth.totalUsers - userHealth.profileConfigured}) have no profile configured (no custom NAICS, keywords, or agencies)`
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
          `${process.env.NEXT_PUBLIC_BASE_URL || 'https://getmindy.ai'}/api/cron/daily-alerts?password=${ADMIN_PASSWORD}&email=${encodeURIComponent(email)}&skipTimezone=true&forceResend=true`
        );
        const alertResult = await alertResponse.json();
        return NextResponse.json({ success: true, action: 'send-test-alert', result: alertResult });

      case 'send-test-briefing':
        // Trigger test briefing to specified email
        const briefingResponse = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_URL || 'https://getmindy.ai'}/api/cron/send-briefings-fast?password=${ADMIN_PASSWORD}&email=${email}&test=true`
        );
        const briefingResult = await briefingResponse.json();
        return NextResponse.json({ success: true, action: 'send-test-briefing', result: briefingResult });

      case 'process-dead-letter':
        // Retry all pending dead letter items
        const dlResponse = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_URL || 'https://getmindy.ai'}/api/admin/briefing-dead-letter?password=${ADMIN_PASSWORD}`,
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
          `${process.env.NEXT_PUBLIC_BASE_URL || 'https://getmindy.ai'}/api/cron/weekly-alerts?password=${ADMIN_PASSWORD}&catchup=true`,
          { method: 'GET' }
        );
        const weeklyFallbackResult = await weeklyFallbackResponse.json();
        return NextResponse.json({ success: true, action: 'process-weekly-fallback', result: weeklyFallbackResult });

      case 'send-naics-reminder':
        // Send NAICS reminder to unconfigured users
        const reminderResponse = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_URL || 'https://getmindy.ai'}/api/admin/send-naics-reminder?password=${ADMIN_PASSWORD}&mode=execute&limit=50`,
          { method: 'POST' }
        );
        const reminderResult = await reminderResponse.json();
        return NextResponse.json({ success: true, action: 'send-naics-reminder', result: reminderResult });

      case 'preview-profile-reminders':
        const profilePreviewLimit = Number(body.limit || 50);
        const profilePreviewResponse = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_URL || 'https://getmindy.ai'}/api/admin/send-profile-reminders?password=${ADMIN_PASSWORD}&mode=preview&limit=${profilePreviewLimit}`,
          { method: 'POST' }
        );
        const profilePreviewResult = await profilePreviewResponse.json();
        return NextResponse.json({ success: true, action: 'preview-profile-reminders', result: profilePreviewResult });

      case 'send-profile-reminders':
        const profileSendLimit = Number(body.limit || 25);
        const profileSendBatchSize = Number(body.batchSize || 10);
        const profileSendResponse = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_URL || 'https://getmindy.ai'}/api/admin/send-profile-reminders?password=${ADMIN_PASSWORD}&mode=execute&limit=${profileSendLimit}&batchSize=${profileSendBatchSize}`,
          { method: 'POST' }
        );
        const profileSendResult = await profileSendResponse.json();
        return NextResponse.json({ success: true, action: 'send-profile-reminders', result: profileSendResult });

      case 'preview-naics-reminder':
        // Preview who would receive NAICS reminders
        const previewResponse = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_URL || 'https://getmindy.ai'}/api/admin/send-naics-reminder?password=${ADMIN_PASSWORD}&mode=preview`
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
