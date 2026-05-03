import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  fetchSamOpportunities,
  fetchSamOpportunitiesFromCache,
  fetchSamOpportunityNoticeSummaryFromCache,
  scoreOpportunity,
  SAMOpportunity,
  SAMNoticeSummary,
} from '@/lib/briefings/pipelines/sam-gov';
import { searchGrantsByNAICS, scoreGrant, GrantOpportunity } from '@/lib/briefings/pipelines/grants-gov';
import { expandNAICSCodes } from '@/lib/utils/naics-expansion';
import { getPSCsForNAICS } from '@/lib/utils/psc-crosswalk';
import nodemailer from 'nodemailer';
import Anthropic from '@anthropic-ai/sdk';
import {
  IntelligenceMetrics,
  logIntelligenceDelivery,
  GuardrailMonitor,
  CircuitBreaker,
  postSendValidation,
} from '@/lib/intelligence';
import { createSecureAccessUrl } from '@/lib/access-links';
import { logToolError, ToolNames, ErrorTypes } from '@/lib/tool-errors';
import { persistSentAlert, upsertAlertLog } from '@/lib/alerts/delivery-log';
import { sendEmail } from '@/lib/send-email';
import { appendEmailUtm, createEmailTrackingToken, generateTrackedLink, generateTrackingPixel } from '@/lib/engagement';

// BATCH_SIZE: Process this many users per cron run
// Apr 23, 2026: Reduced from 100 to 35 to prevent Vercel 60s timeout
// With 29 runs/day (11:00-15:40 UTC, every 10 min), 35 users × 29 = 1015 users/day
// Each user requires ~2-3 Supabase queries, so 35 users ≈ 105 queries in 60s
const BATCH_SIZE = 35;

// Lazy initialization to avoid build-time errors
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.office365.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.SMTP_USER || 'alerts@govcongiants.com',
      pass: process.env.SMTP_PASSWORD,
    },
  });
}

// Map business type to SAM.gov set-aside code
const businessTypeToSetAside: Record<string, string> = {
  'SDVOSB': 'SDVOSBC',
  'VOSB': 'VSB',
  '8a': '8A',
  '8(a)': '8A',
  'WOSB': 'WOSB',
  'EDWOSB': 'EDWOSB',
  'HUBZone': 'HZC',
  'SBA': 'SBA',
  'Small Business': 'SBP',
};

// Timezone hour offsets (UTC offset for delivery at ~6 AM local)
const TIMEZONE_OFFSETS: Record<string, number> = {
  'America/New_York': -5,      // 11 UTC = 6 AM ET
  'America/Chicago': -6,       // 12 UTC = 6 AM CT
  'America/Denver': -7,        // 13 UTC = 6 AM MT
  'America/Los_Angeles': -8,   // 14 UTC = 6 AM PT
  'America/Phoenix': -7,       // No DST
  'Pacific/Honolulu': -10,     // 16 UTC = 6 AM HT
  'America/Anchorage': -9,     // 15 UTC = 6 AM AK
};

interface AlertUser {
  user_email: string;
  naics_codes: string[];
  keywords: string[] | null;
  business_type: string | null;
  business_description?: string | null;
  agencies: string[];  // renamed from target_agencies
  location_state: string | null;
  location_states: string[] | null; // Multi-state support
  alert_frequency: string;
  alerts_enabled: boolean;
  is_active: boolean;
  timezone?: string;
  last_alert_sent?: string;
}

// Alert tier types
type AlertTier = 'free' | 'paid';

// Products that grant paid tier (daily alerts)
const PAID_TIER_ACCESS_FLAGS = [
  'access_hunter_pro',       // Alert Pro subscription
  'access_assassin_standard',
  'access_assassin_premium',
  'access_recompete',
  'access_contractor_db',
  'access_content_standard',
  'access_content_full_fix',
  'access_briefings',
];

/**
 * Check if user has paid tier access (any product purchase)
 * Free tier users should use weekly-alerts cron instead
 */
async function getUserAlertTier(email: string): Promise<AlertTier> {
  try {
    // Check user_profiles for any access flag
    const { data: profile } = await getSupabase()
      .from('user_profiles')
      .select('*')
      .eq('email', email.toLowerCase())
      .single();

    if (!profile) {
      return 'free';
    }

    // Check if user has ANY paid access flag
    for (const flag of PAID_TIER_ACCESS_FLAGS) {
      if ((profile as any)[flag] === true) {
        return 'paid';
      }
    }

    return 'free';
  } catch (error) {
    console.error(`[Daily Alerts] Error checking tier for ${email}:`, error);
    return 'free'; // Default to free on error
  }
}

interface SentOpportunity {
  noticeId: string;
  title: string;
}

/**
 * Get opportunities already sent to user in the last 7 days (for deduplication)
 */
async function getRecentlySentOpportunityIds(email: string): Promise<Set<string>> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const { data } = await getSupabase()
    .from('alert_log')
    .select('opportunities_data')
    .eq('user_email', email)
    .gte('alert_date', sevenDaysAgo.toISOString().split('T')[0]);

  const sentIds = new Set<string>();
  if (data) {
    for (const log of data) {
      if (log.opportunities_data && Array.isArray(log.opportunities_data)) {
        for (const opp of log.opportunities_data) {
          if (opp.noticeId) sentIds.add(opp.noticeId);
        }
      }
    }
  }

  return sentIds;
}

/**
 * Check if it's the right time to send to this user based on their timezone
 * We want to deliver around 6 AM local time
 */
function isDeliveryTimeForTimezone(timezone: string | undefined): boolean {
  const currentHourUTC = new Date().getUTCHours();

  // Default to Eastern Time
  const tz = timezone || 'America/New_York';
  const offset = TIMEZONE_OFFSETS[tz] || -5;

  // We run at 11 UTC. Calculate what hour that is in user's timezone
  // For ET (offset -5): 11 + (-5) = 6 AM ✓
  // For PT (offset -8): 11 + (-8) = 3 AM (too early, skip)
  // For CT (offset -6): 11 + (-6) = 5 AM (close enough)

  const localHour = (currentHourUTC + offset + 24) % 24;

  // Allow delivery if local time is between 5 AM and 8 AM
  return localHour >= 5 && localHour <= 8;
}

/**
 * Save failed email for retry
 */
async function saveFailedAlert(
  email: string,
  opportunities: (SAMOpportunity & { score: number })[],
  error: string
) {
  await upsertAlertLog(getSupabase(), {
    user_email: email,
    alert_date: new Date().toISOString().split('T')[0],
    alert_type: 'daily',
    opportunities_count: opportunities.length,
    opportunities_data: opportunities.slice(0, 20).map(o => ({
      noticeId: o.noticeId,
      title: o.title,
      agency: o.department,
      naics: o.naicsCode,
      deadline: o.responseDeadline,
    })),
    delivery_status: 'failed',
    error_message: error,
    retry_count: 0,
  });
}

async function saveSkippedAlert(
  email: string,
  reason: string,
  context?: Record<string, unknown>
) {
  await upsertAlertLog(getSupabase(), {
    user_email: email,
    alert_date: new Date().toISOString().split('T')[0],
    alert_type: 'daily',
    opportunities_count: 0,
    opportunities_data: context ? [context] : [],
    delivery_status: 'skipped',
    error_message: reason,
    retry_count: 0,
  });
}

/**
 * Retry failed alerts from previous runs
 */
async function retryFailedAlerts(): Promise<{ retried: number; succeeded: number }> {
  const results = { retried: 0, succeeded: 0 };

  // Get failed alerts from last 3 days with retry_count < 3
  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

  const { data: failedAlerts } = await getSupabase()
    .from('alert_log')
    .select('*')
    .eq('delivery_status', 'failed')
    .lt('retry_count', 3)
    .gte('alert_date', threeDaysAgo.toISOString().split('T')[0]);

  if (!failedAlerts || failedAlerts.length === 0) return results;

  console.log(`[Daily Alerts] Retrying ${failedAlerts.length} failed alerts...`);

  for (const alert of failedAlerts) {
    results.retried++;

    try {
      // Get user settings (unified table)
      const { data: user } = await getSupabase()
        .from('user_notification_settings')
        .select('*')
        .eq('user_email', alert.user_email)
        .single();

      if (!user || !alert.opportunities_data) continue;

      // Resend email
      await sendDailyAlertEmail(
        alert.user_email,
        alert.opportunities_data.map((o: any) => ({
          ...o,
          score: 50, // Default score for retry
          uiLink: `https://sam.gov/opp/${o.noticeId}/view`,
        })),
        user as AlertUser
      );

      // Mark as sent
      await getSupabase()
        .from('alert_log')
        .update({
          delivery_status: 'sent',
          sent_at: new Date().toISOString(),
          error_message: null,
        })
        .eq('id', alert.id);

      results.succeeded++;
      console.log(`[Daily Alerts] Retry succeeded for ${alert.user_email}`);

    } catch (err: any) {
      // Increment retry count
      await getSupabase()
        .from('alert_log')
        .update({
          retry_count: (alert.retry_count || 0) + 1,
          error_message: err.message,
        })
        .eq('id', alert.id);

      console.error(`[Daily Alerts] Retry failed for ${alert.user_email}:`, err.message);
    }
  }

  return results;
}

/**
 * Core job logic - PAID TIER ONLY
 * Free tier users are skipped (they get weekly alerts via weekly-alerts cron)
 * Paid tier = any product purchase (MA, Recompete, Content, Database, etc.)
 */
async function runDailyAlertJob(options?: {
  skipTimezoneCheck?: boolean;
  testEmail?: string;
  forceResend?: boolean;
}): Promise<NextResponse> {
  // Initialize metrics and guardrails
  const metrics = new IntelligenceMetrics('daily_alerts');
  const guardrails = new GuardrailMonitor('daily-alerts');
  const circuitBreaker = new CircuitBreaker('daily-alerts');

  // Check if circuit breaker is open (too many recent failures)
  if (await circuitBreaker.isOpen()) {
    const breakerMessage = 'Circuit breaker is open due to recent failures. Will retry in 30 minutes.';
    console.error('[Daily Alerts] Circuit breaker is OPEN - skipping this run');
    metrics.recordCircuitBreakerTripped();
    metrics.recordGuardrailWarning();
    await metrics.save();
    await logToolError({
      tool: ToolNames.ALERTS,
      errorType: ErrorTypes.INTERNAL,
      errorMessage: breakerMessage,
      requestPath: '/api/cron/daily-alerts',
    }).catch(() => {});
    return NextResponse.json({
      success: false,
      error: breakerMessage,
      circuitBreakerOpen: true,
    }, { status: 503 });
  }

  try {
    console.log('[Daily Alerts] Starting daily alert job (PAID TIER ONLY)...');

    // First, retry any failed alerts from previous runs
    const retryResults = await retryFailedAlerts();
    if (retryResults.retried > 0) {
      console.log(`[Daily Alerts] Retried ${retryResults.retried} failed alerts, ${retryResults.succeeded} succeeded`);
    }

    // Build query for daily alert users (unified table)
    let query = getSupabase()
      .from('user_notification_settings')
      .select('*')
      .eq('is_active', true)
      .eq('alerts_enabled', true)
      .eq('alert_frequency', 'daily');

    // If test email specified, only process that user
    if (options?.testEmail) {
      query = query.eq('user_email', options.testEmail);
    }

    const { data: users, error: usersError } = await query;

    if (usersError) {
      console.error('[Daily Alerts] Error fetching users:', usersError);
      return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
    }

    if (!users || users.length === 0) {
      console.log('[Daily Alerts] No daily alert users found');
      return NextResponse.json({
        success: true,
        message: 'No users to process',
        sent: 0,
        retryResults
      });
    }

    const totalEligible = users.length;
    console.log(`[Daily Alerts] Found ${totalEligible} total eligible users`);
    metrics.recordUserEligible(); // Track total eligible before filtering

    // =====================================================
    // BATCHING: Only process users who haven't received alerts today
    // Multiple cron runs (11, 12, 14, 16 UTC) will process all users
    // =====================================================
    const today = new Date().toISOString().split('T')[0];
    const { data: alreadySentToday } = await getSupabase()
      .from('alert_log')
      .select('user_email')
      .eq('alert_date', today)
      .eq('delivery_status', 'sent');

    const alreadySentEmails = new Set((alreadySentToday || []).map((s: { user_email: string }) => s.user_email));
    if (options?.forceResend && options.testEmail) {
      alreadySentEmails.delete(options.testEmail);
    }
    const alreadySentCount = alreadySentEmails.size;

    // Filter out already-sent users and apply BATCH_SIZE limit
    let usersToProcess = (users as AlertUser[])
      .filter(u => !alreadySentEmails.has(u.user_email))
      .slice(0, BATCH_SIZE);

    const remainingAfterFilter = (users as AlertUser[]).filter(u => !alreadySentEmails.has(u.user_email)).length;
    const remainingAfterBatch = remainingAfterFilter - usersToProcess.length;

    console.log(`[Daily Alerts] Batching: ${alreadySentCount} already sent today, processing ${usersToProcess.length} of ${remainingAfterFilter} remaining (${remainingAfterBatch} for next run)`);

    if (usersToProcess.length === 0) {
      console.log('[Daily Alerts] All users already processed today');
      return NextResponse.json({
        success: true,
        message: 'All users already received alerts today',
        sent: 0,
        alreadySent: alreadySentCount,
        totalEligible,
        retryResults
      });
    }

    const samApiKey = process.env.SAM_API_KEY;
    if (!samApiKey) {
      console.warn('[Daily Alerts] SAM_API_KEY not configured - cache fallback to live SAM API is disabled');
    }

    const results = {
      sent: 0,
      skipped: 0,
      failed: 0,
      noNaics: 0,
      noOpps: 0,
      wrongTimezone: 0,
      deduplicated: 0,
      freeTierSkipped: 0, // Free tier users (they get weekly alerts instead)
      errors: [] as string[],
    };

    for (const user of usersToProcess) {
      // Check guardrails before processing each user
      const guardrailCheck = guardrails.check();
      if (!guardrailCheck.continue) {
        console.error(`[Daily Alerts] Guardrail triggered: ${guardrailCheck.reason}`);
        await guardrails.logEvent('trip', guardrailCheck.reason!);
        metrics.recordCircuitBreakerTripped();
        break; // Stop processing more users
      }

      try {
        // DISABLED: Timezone filtering removed Apr 17, 2026
        // All daily-frequency users receive alerts in same batch (not staggered by timezone)
        // Note: Only processes users with alert_frequency='daily' per query filter (line 327)
        // if (!options?.skipTimezoneCheck && !isDeliveryTimeForTimezone(user.timezone)) {
        //   continue;
        // }

        // BETA MODE: Skip tier check for users with alert_frequency='daily' (Apr 19, 2026)
        // Note: This route ONLY processes users where alert_frequency='daily' (line 327 query filter)
        // Users with alert_frequency='weekly' go through weekly-alerts route instead
        // After beta ends, re-enable tier check to limit free users to weekly-only
        const BETA_END_DATE = new Date('2026-05-28');
        const isBetaPeriod = new Date() < BETA_END_DATE;

        if (!isBetaPeriod) {
          // Post-beta: Check tier - free tier users should use weekly alerts
          const tier = await getUserAlertTier(user.user_email);
          if (tier === 'free') {
            console.log(`[Daily Alerts] ${user.user_email} is free tier - will receive weekly alerts instead`);
            results.freeTierSkipped++;
            metrics.recordUserSkipped();
            continue;
          }
        }
        // During beta: All daily-frequency users get alerts (tier check skipped)

        // Get NAICS codes - use defaults if user has none configured
        // Note: smart_user_profiles table was removed, using default NAICS as fallback
        const DEFAULT_NAICS = ['541512', '541611', '541330', '541990', '561210'];
        let userNaics = user.naics_codes || [];

        if (userNaics.length === 0) {
          // Use default NAICS codes for users without profile
          userNaics = DEFAULT_NAICS;
          console.log(`[Daily Alerts] Using default NAICS for ${user.user_email}: ${userNaics.join(', ')}`);
        }

        // EXPAND NAICS codes to include related codes (e.g., 541 → all 541xxx)
        const expandedNaics = expandNAICSCodes(userNaics);

        // Get related PSC codes for broader search
        const relatedPSCs: string[] = [];
        for (const naics of userNaics.slice(0, 3)) { // Top 3 NAICS
          const pscMatches = getPSCsForNAICS(naics, 3); // Top 3 PSCs per NAICS
          relatedPSCs.push(...pscMatches.map(p => p.pscCode));
        }
        const uniquePSCs = [...new Set(relatedPSCs)];

        // Get user keywords
        const userKeywords = user.keywords || [];

        console.log(`[Daily Alerts] ${user.user_email}: ${userNaics.length} NAICS → ${expandedNaics.length} expanded, ${uniquePSCs.length} PSCs, ${userKeywords.length} keywords`);

        // Get recently sent opportunity IDs for deduplication
        const recentlySentIds = await getRecentlySentOpportunityIds(user.user_email);

        // Build search params
        const setAsides = user.business_type
          ? [businessTypeToSetAside[user.business_type] || user.business_type]
          : [];

        // Get states to search (multi-state or single state with expansion)
        const userStates = user.location_states?.length
          ? user.location_states
          : user.location_state
            ? [user.location_state]
            : undefined;

        // Fetch opportunities from Supabase cache (much faster, no rate limits)
        metrics.recordApiCall();
        let newOpportunities: SAMOpportunity[] = [];
        let allActiveOpportunities: SAMOpportunity[] = [];
        let noticeSummary: SAMNoticeSummary | undefined;
        try {
          noticeSummary = await fetchSamOpportunityNoticeSummaryFromCache({
            naicsCodes: expandedNaics,
            keywords: userKeywords.length > 0 ? userKeywords : undefined,
            setAsides,
            states: userStates,
          });

          const cacheResult = await fetchSamOpportunitiesFromCache({
            naicsCodes: expandedNaics,
            keywords: userKeywords.length > 0 ? userKeywords : undefined,
            setAsides,
            states: userStates,
            limit: 200, // Get more from cache, filter locally
          });

          allActiveOpportunities = cacheResult.opportunities;

          // Filter for "new" opportunities (posted in last 24 hours)
          const oneDayAgo = new Date();
          oneDayAgo.setDate(oneDayAgo.getDate() - 1);
          newOpportunities = allActiveOpportunities.filter(opp => {
            const postedDate = new Date(opp.postedDate);
            return postedDate >= oneDayAgo;
          });

          console.log(`[Daily Alerts] ${user.user_email}: Found ${allActiveOpportunities.length} from cache, ${newOpportunities.length} new (last 24h)`);
        } catch (cacheError: any) {
          metrics.recordApiError();
          guardrails.recordApiError('SAM Cache');
          console.error(`[Daily Alerts] SAM cache error for ${user.user_email}:`, cacheError.message);

          // Fallback to live API if cache fails
          if (samApiKey) {
            try {
              const newResult = await fetchSamOpportunities({
                naicsCodes: expandedNaics,
                keywords: userKeywords.length > 0 ? userKeywords : undefined,
                setAsides,
                states: userStates,
                noticeTypes: ['p', 'r', 'k', 'o'],
                postedFrom: getDateDaysAgo(1),
                limit: 50,
              }, samApiKey);
              newOpportunities = newResult.opportunities;
              console.log(`[Daily Alerts] ${user.user_email}: Fallback to API, found ${newOpportunities.length} new`);
            } catch (apiError: any) {
              console.error(`[Daily Alerts] API fallback also failed for ${user.user_email}:`, apiError.message);
            }
          } else {
            console.warn(`[Daily Alerts] ${user.user_email}: Skipping live SAM fallback because SAM_API_KEY is not configured`);
          }
        }

        // FAILSAFE: If no NEW opportunities, fall back to ALL active opportunities
        // Users paying $19/mo expect something - 3-day-old data is better than 0 results
        let opportunities = newOpportunities;
        let isUsingFallback = false;

        if (newOpportunities.length === 0 && allActiveOpportunities.length > 0) {
          console.log(`[Daily Alerts] ${user.user_email}: No new opps, using ${allActiveOpportunities.length} ACTIVE opportunities as fallback`);
          opportunities = allActiveOpportunities;
          isUsingFallback = true;
        }

        metrics.recordOpportunitiesTotal(opportunities.length);

        // DEDUPLICATE: Filter out opportunities already sent in last 7 days
        const beforeDedup = opportunities.length;
        opportunities = opportunities.filter(opp => !recentlySentIds.has(opp.noticeId));
        const dedupCount = beforeDedup - opportunities.length;
        if (dedupCount > 0) {
          console.log(`[Daily Alerts] ${user.user_email}: Deduplicated ${dedupCount} already-sent opportunities`);
          results.deduplicated += dedupCount;
        }

        // Score and rank - use ORIGINAL codes for scoring (exact matches rank higher)
        let scoredOpps = opportunities.map(opp => ({
          ...opp,
          score: scoreOpportunity(opp, {
            naics_codes: userNaics, // Original codes, not expanded
            agencies: user.agencies || [],
            keywords: userKeywords,
            business_description: user.business_description || null,
          }),
        })).sort((a, b) => b.score - a.score);

        // Limit fallback results to top 15 to avoid overwhelming users
        if (isUsingFallback && scoredOpps.length > 15) {
          scoredOpps = scoredOpps.slice(0, 15);
        }

        // Fetch Grants.gov opportunities (parallel to contracts)
        let scoredGrants: (GrantOpportunity & { score: number })[] = [];
        try {
          const grantsResult = await searchGrantsByNAICS(userNaics, {
            limit: 15,
            postedFrom: getDateDaysAgo(7), // Last 7 days for grants (less frequent posting)
          });

          // Score and filter grants
          scoredGrants = grantsResult.grants
            .filter(g => !recentlySentIds.has(g.oppNumber)) // Dedupe
            .map(g => ({
              ...g,
              score: scoreGrant(g, {
                naics_codes: userNaics,
                keywords: userKeywords,
                agencies: user.agencies || [],
                business_description: user.business_description || null,
              }),
            }))
            .filter(g => g.score >= 20) // Only include relevant grants
            .sort((a, b) => b.score - a.score)
            .slice(0, 5); // Top 5 grants

          if (scoredGrants.length > 0) {
            console.log(`[Daily Alerts] ${user.user_email}: Found ${scoredGrants.length} matching grants`);
          }
        } catch (grantsError) {
          console.error(`[Daily Alerts] Grants.gov error for ${user.user_email}:`, grantsError);
          // Continue without grants - don't fail the whole alert
        }

        // If dedupe eliminated everything, resurface a small set of active opportunities
        // instead of sending nothing. This keeps daily alerts behaving like a daily pulse
        // product rather than an exact-match-only trigger.
        let usedRepeatFallback = false;
        if (scoredOpps.length === 0 && allActiveOpportunities.length > 0) {
          const resurfacedOpps = allActiveOpportunities
            .map(opp => ({
              ...opp,
              score: scoreOpportunity(opp, {
                naics_codes: userNaics,
                agencies: user.agencies || [],
                keywords: userKeywords,
                business_description: user.business_description || null,
              }),
            }))
            .filter(opp => getDaysUntil(opp.responseDeadline) <= 14)
            .sort((a, b) => {
              if (b.score !== a.score) return b.score - a.score;
              return getDaysUntil(a.responseDeadline) - getDaysUntil(b.responseDeadline);
            })
            .slice(0, 10);

          if (resurfacedOpps.length > 0) {
            scoredOpps = resurfacedOpps;
            usedRepeatFallback = true;
            console.log(`[Daily Alerts] ${user.user_email}: Resurfacing ${scoredOpps.length} active opportunities after dedupe`);
          }
        }

        // Even if no NEW opportunities, we still want to send if there are deadlines or active opportunities
        const hasNewOpps = scoredOpps.length > 0 || scoredGrants.length > 0;
        const hasActiveDeadlines = allActiveOpportunities.length > 0;

        if (!hasNewOpps && !hasActiveDeadlines) {
          console.log(`[Daily Alerts] No new or active opportunities for ${user.user_email}`);
          await saveSkippedAlert(user.user_email, 'no_new_or_active_opportunities', {
            naicsCodes: userNaics.slice(0, 5),
            keywordCount: userKeywords.length,
            deduplicatedCount: dedupCount,
          });
          results.noOpps++;
          results.skipped++;
          metrics.recordUserSkipped();
          continue;
        }

        // Track matched opportunities
        if (hasNewOpps) {
          metrics.recordOpportunityMatched(scoredOpps.length + scoredGrants.length, scoredOpps[0]?.score);
        }

        // Generate AI action tips based on all active opportunities
        const actionTips = await generateActionTips(
          allActiveOpportunities.length > 0 ? allActiveOpportunities : scoredOpps,
          user.business_type || undefined
        );

        // Send email - now includes all active opportunities for deadline tracking and action tips
        try {
          metrics.recordEmailAttempted();
          await sendDailyAlertEmail(
            user.user_email,
            scoredOpps,
            user,
            scoredGrants,
            allActiveOpportunities,
            actionTips,
            noticeSummary
          );

          // Track successful send
          metrics.recordEmailSent();
          guardrails.recordSuccess();
          circuitBreaker.record(true);

          // Log to intelligence_log for tracking
          await logIntelligenceDelivery({
            userEmail: user.user_email,
            intelligenceType: 'daily_alert',
            deliveryStatus: 'sent',
            itemsCount: scoredOpps.length + scoredGrants.length,
            itemIds: scoredOpps.slice(0, 20).map(o => o.noticeId),
          });

          await persistSentAlert({
            supabase: getSupabase(),
            email: user.user_email,
            alertType: 'daily',
            opportunitiesCount: scoredOpps.length,
            opportunitiesData: scoredOpps.slice(0, 20).map(o => ({
              noticeId: o.noticeId,
              title: o.title,
              agency: o.department,
              naics: o.naicsCode,
              deadline: o.responseDeadline,
              score: o.score,
              repeatFallback: usedRepeatFallback || undefined,
            })),
            currentTotalAlertsSent: (user as any).total_alerts_sent,
          });

          console.log(`[Daily Alerts] ✅ Sent ${scoredOpps.length} opps to ${user.user_email}`);
          results.sent++;

        } catch (emailError: any) {
          console.error(`[Daily Alerts] Email send failed for ${user.user_email}:`, emailError.message);

          // Track failure
          metrics.recordEmailFailed();
          guardrails.recordFailure(emailError.message);
          circuitBreaker.record(false);

          // Log to intelligence_log
          await logIntelligenceDelivery({
            userEmail: user.user_email,
            intelligenceType: 'daily_alert',
            deliveryStatus: 'failed',
            itemsCount: scoredOpps.length,
            errorMessage: emailError.message,
          });

          // Save for retry
          await saveFailedAlert(user.user_email, scoredOpps, emailError.message);

          results.failed++;
          results.errors.push(`${user.user_email}: ${emailError.message}`);
        }

      } catch (userError: any) {
        const errorMsg = userError instanceof Error
          ? userError.message
          : (typeof userError === 'object' && userError !== null && 'message' in userError)
            ? String((userError as { message: unknown }).message)
            : JSON.stringify(userError);
        console.error(`[Daily Alerts] Error processing ${user.user_email}:`, userError);
        metrics.recordEmailFailed();
        guardrails.recordFailure(errorMsg);
        circuitBreaker.record(false);
        results.failed++;
        results.errors.push(`${user.user_email}: ${errorMsg}`);

        // Log to tool_errors for dashboard visibility
        await logToolError({
          tool: ToolNames.ALERTS,
          errorType: ErrorTypes.EMAIL_FAILURE,
          errorMessage: errorMsg,
          userEmail: user.user_email,
          errorStack: userError instanceof Error ? userError.stack : undefined,
          requestPath: '/api/cron/daily-alerts',
        }).catch(() => {}); // Don't let logging failure break the flow
      }
    }

    console.log(`[Daily Alerts] Complete. Batch: ${usersToProcess.length}/${totalEligible}, Sent: ${results.sent}, No Opps: ${results.noOpps}, No NAICS: ${results.noNaics}, Free Tier: ${results.freeTierSkipped}, Failed: ${results.failed}, Remaining: ${remainingAfterBatch}`);

    // Save metrics to database
    await metrics.save();

    // Run post-send validation
    await postSendValidation('daily-alerts', {
      attempted: results.sent + results.failed,
      sent: results.sent,
      failed: results.failed,
      failedRecipients: results.errors.map(e => e.split(':')[0]),
      duration: metrics.getSnapshot().duration_ms,
    });

    return NextResponse.json({
      success: true,
      results,
      batching: {
        batchSize: BATCH_SIZE,
        totalEligible,
        alreadySentToday: alreadySentCount,
        processedThisRun: usersToProcess.length,
        remainingForNextRun: remainingAfterBatch,
      },
      retryResults,
      metrics: metrics.getSnapshot(),
      guardrailStats: guardrails.getStats(),
    });
  } catch (error: any) {
    console.error('[Daily Alerts] Error:', error);

    // Properly serialize errors
    const errorMessage = error instanceof Error
      ? error.message
      : (typeof error === 'object' && error !== null && 'message' in error)
        ? String((error as { message: unknown }).message)
        : JSON.stringify(error);

    // Log to tool_errors for dashboard visibility
    await logToolError({
      tool: ToolNames.ALERTS,
      errorType: ErrorTypes.INTERNAL,
      errorMessage,
      errorStack: error instanceof Error ? error.stack : undefined,
      requestPath: '/api/cron/daily-alerts',
    }).catch(() => {});

    // Still try to save metrics on error
    metrics.recordGuardrailWarning();
    await metrics.save();

    return NextResponse.json({ success: false, error: errorMessage }, { status: 500 });
  }
}

/**
 * POST /api/cron/daily-alerts
 * Manual trigger with CRON_SECRET
 */
export async function POST(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const body = await request.json().catch(() => ({}));
  return runDailyAlertJob({
    skipTimezoneCheck: body.skipTimezoneCheck,
    testEmail: body.testEmail,
    forceResend: body.forceResend,
  });
}

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

/**
 * GET endpoint - runs the cron job when called by Vercel cron
 */
export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email');
  const test = request.nextUrl.searchParams.get('test') === 'true';
  const password = request.nextUrl.searchParams.get('password');
  const skipTimezone = request.nextUrl.searchParams.get('skipTimezone') === 'true';
  const forceResend = request.nextUrl.searchParams.get('forceResend') === 'true';
  const limit = parseInt(request.nextUrl.searchParams.get('limit') || '0');

  // Admin override - allows manual triggering with timezone skip
  if (password === ADMIN_PASSWORD) {
    console.log('[Daily Alerts] Admin override triggered', { skipTimezone, limit: limit || 'all' });
    return runDailyAlertJob({
      skipTimezoneCheck: skipTimezone,
      testEmail: email || undefined,
      forceResend: forceResend && Boolean(email),
    });
  }

  // If checking/testing for a specific email
  if (email && test) {
    return runDailyAlertJob({ testEmail: email, skipTimezoneCheck: true });
  }

  // Check if this is a Vercel cron request
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const authHeader = request.headers.get('authorization');
  const hasCronSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;

  // Run the job if triggered by Vercel cron or has CRON_SECRET
  if (isVercelCron || hasCronSecret) {
    return runDailyAlertJob();
  }

  // Otherwise return documentation
  return NextResponse.json({
    message: 'Daily Alerts Cron Job (PAID TIER ONLY)',
    usage: {
      test: 'GET ?email=xxx&test=true to send test alert',
      manual: 'POST with Authorization: Bearer {CRON_SECRET}',
      admin: 'GET ?password=xxx&skipTimezone=true to send all (bypass timezone)',
    },
    schedule: 'Every day at 6 AM local time (based on user timezone)',
    tiers: {
      free: 'Free tier users get WEEKLY alerts (5 opps max via weekly-alerts cron)',
      paid: 'Paid tier users get DAILY alerts (unlimited opps via this cron)',
    },
    features: [
      'Paid tier users only (any product purchase)',
      'Free tier users redirected to weekly-alerts cron',
      'Deduplication (won\'t send same opp twice in 7 days)',
      'Retry failed emails (up to 3 attempts)',
      'Timezone-aware delivery (~6 AM local)',
      'Includes grants from Grants.gov',
    ],
  });
}

// Helper functions
function getDateDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split('T')[0];
}

function formatDate(dateString: string): string {
  if (!dateString) return 'N/A';
  try {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateString;
  }
}

function getDaysUntil(dateString: string): number {
  if (!dateString) return 999;
  const target = new Date(dateString);
  const diff = target.getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

// Count notice types for summary
function countNoticeTypes(opps: SAMOpportunity[]): SAMNoticeSummary {
  const counts: SAMNoticeSummary = {
    totalMatched: opps.length,
    rfp: 0,
    rfq: 0,
    sourcesSought: 0,
    preSol: 0,
    combined: 0,
    other: 0,
  };
  for (const opp of opps) {
    const type = (opp.noticeType || '').toLowerCase();
    if (type.includes('solicitation') || type.includes('rfp')) counts.rfp++;
    else if (type.includes('rfq') || type.includes('quote')) counts.rfq++;
    else if (type.includes('sources sought') || type.includes('rfi')) counts.sourcesSought++;
    else if (type.includes('presol') || type.includes('pre-sol')) counts.preSol++;
    else if (type.includes('combined')) counts.combined++;
    else counts.other++;
  }
  return counts;
}

// Get urgency color based on days remaining
function getUrgencyColor(days: number): string {
  if (days <= 3) return '#dc2626';
  if (days <= 7) return '#f97316';
  if (days <= 14) return '#eab308';
  return '#22c55e';
}

// Get urgency label
function getUrgencyLabel(days: number): string {
  if (days <= 0) return 'TODAY!';
  if (days === 1) return 'TOMORROW';
  if (days <= 3) return `🔥 ${days} DAYS`;
  if (days <= 7) return `⚡ ${days} days`;
  return `${days} days`;
}

// Generate AI action tips based on opportunities
async function generateActionTips(
  opportunities: SAMOpportunity[],
  userBusinessType?: string
): Promise<string[]> {
  const defaultTips = [
    'Review solicitation documents within 48 hours of receiving this brief',
    'Identify teaming partners for larger opportunities',
    'Check SAM.gov for amendments and Q&A updates',
  ];

  if (opportunities.length === 0) {
    return defaultTips;
  }

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const oppSummary = opportunities.slice(0, 5).map(o => ({
      title: o.title?.slice(0, 80),
      agency: o.department,
      deadline: o.responseDeadline,
      setAside: o.setAside,
      noticeType: o.noticeType,
    }));

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Based on these federal opportunities, provide 2-3 brief, actionable tips for a ${userBusinessType || 'small business'} contractor:

${JSON.stringify(oppSummary, null, 2)}

Return ONLY a JSON array of strings, each tip under 100 characters:
["tip 1", "tip 2", "tip 3"]`,
      }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text : '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const tips = JSON.parse(jsonMatch[0]);
      if (Array.isArray(tips) && tips.length > 0) {
        return tips.slice(0, 3);
      }
    }
  } catch (err) {
    console.error('[Daily Alerts] Action tips generation error:', err);
  }

  return defaultTips;
}

// Send daily alert email - alert product format (distinct from Market Intelligence briefings)
async function sendDailyAlertEmail(
  email: string,
  opportunities: (SAMOpportunity & { score: number })[],
  user: AlertUser,
  grants: (GrantOpportunity & { score: number })[] = [],
  allActiveOpportunities: SAMOpportunity[] = [],
  actionTips: string[] = [],
  noticeSummary?: SAMNoticeSummary
) {
  const emailDate = new Date().toISOString().split('T')[0];
  const tokenResult = await createEmailTrackingToken(email, 'daily_alert', emailDate);
  const trackingToken = tokenResult?.token;
  const trackedUrl = (url: string, label: string, content = label) => {
    const urlWithUtm = appendEmailUtm(url, {
      campaign: 'daily_alert',
      content,
    });
    return trackingToken ? generateTrackedLink(trackingToken, urlWithUtm, label) : urlWithUtm;
  };

  const unsubscribeUrl = `https://tools.govcongiants.org/api/alerts/unsubscribe?email=${encodeURIComponent(email)}`;
  const preferencesUrl = await createSecureAccessUrl(email, 'preferences');
  const dailyBriefingsUrl = 'https://shop.govcongiants.org/market-intelligence';
  const totalCount = opportunities.length + grants.length;

  const opportunitiesHtml = opportunities.slice(0, 20).map((opp, i) => {
    const daysUntil = getDaysUntil(opp.responseDeadline);
    const urgencyColor = daysUntil <= 7 ? '#dc2626' : daysUntil <= 14 ? '#d97706' : '#16a34a';
    const urgencyBadge = daysUntil <= 3
      ? `<span style="background: #dc2626; color: white; padding: 3px 10px; border-radius: 4px; font-size: 11px; font-weight: 700; margin-left: 4px;">🔥 ${daysUntil <= 0 ? 'DUE NOW' : `${daysUntil} DAYS LEFT`}</span>`
      : daysUntil <= 7
        ? `<span style="background: #f97316; color: white; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; margin-left: 4px;">⚡ ${daysUntil} days</span>`
        : daysUntil <= 14
          ? `<span style="background: #fef3c7; color: #92400e; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; margin-left: 4px;">📅 2 weeks</span>`
          : '';

    const noticeTypeColors: Record<string, { bg: string; text: string }> = {
      'Solicitation': { bg: '#dcfce7', text: '#166534' },
      'RFP': { bg: '#dcfce7', text: '#166534' },
      'RFQ': { bg: '#dbeafe', text: '#1e40af' },
      'Sources Sought': { bg: '#f3e8ff', text: '#7c3aed' },
      'Presolicitation': { bg: '#ffedd5', text: '#c2410c' },
      'Combined Synopsis/Solicitation': { bg: '#ccfbf1', text: '#0f766e' },
    };
    const noticeColors = noticeTypeColors[opp.noticeType || ''] || { bg: '#f1f5f9', text: '#475569' };
    const scoreColor = opp.score >= 75 ? '#16a34a' : opp.score >= 50 ? '#84cc16' : opp.score >= 30 ? '#eab308' : '#f97316';
    const scoreBadge = `<span style="background: ${scoreColor}20; color: ${scoreColor}; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; margin-left: 4px;">${opp.score}%</span>`;

    return `
      <tr>
        <td style="padding: 14px 16px; border-bottom: 1px solid #e5e7eb;${daysUntil <= 3 ? ' background: #fef2f2;' : ''}">
          <div style="margin-bottom: 6px;">
            <span style="background: ${noticeColors.bg}; color: ${noticeColors.text}; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">
              ${opp.noticeType || 'Solicitation'}
            </span>
            ${opp.setAside ? `<span style="background: #e0e7ff; color: #3730a3; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; margin-left: 4px;">${opp.setAside}</span>` : ''}
            ${urgencyBadge}
            ${scoreBadge}
          </div>
          <a href="${trackedUrl(opp.uiLink, 'sam_gov_opportunity', `opportunity_${opp.noticeId || i + 1}`)}" style="color: #1e40af; font-weight: 600; text-decoration: none; font-size: 14px; line-height: 1.4;">
            ${i + 1}. ${opp.title.slice(0, 90)}${opp.title.length > 90 ? '...' : ''}
          </a>
          <div style="color: #6b7280; font-size: 12px; margin-top: 5px;">
            ${opp.department || 'Federal'}${opp.subTier ? ` › ${opp.subTier}` : ''} &nbsp;•&nbsp;
            NAICS ${opp.naicsCode || 'N/A'}
          </div>
          <div style="color: #64748b; font-size: 11px; margin-top: 4px;">
            📅 Posted ${formatDate(opp.postedDate)} &nbsp;•&nbsp;
            <span style="color: ${urgencyColor}; font-weight: 600;">Due ${formatDate(opp.responseDeadline)}</span>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  const moreCount = opportunities.length > 20 ? opportunities.length - 20 : 0;

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.5; color: #1f2937; max-width: 620px; margin: 0 auto; padding: 20px; background: #f8fafc;">

  <!-- FREE PREVIEW Banner -->
  <div style="background: linear-gradient(135deg, #7c3aed 0%, #a855f7 100%); padding: 10px 20px; text-align: center; border-radius: 12px 12px 0 0;">
    <p style="color: white; margin: 0; font-size: 12px; font-weight: 600; letter-spacing: 0.5px;">
      🎁 FREE PREVIEW • You're testing our daily alerts — no charge during beta!
    </p>
  </div>

  <!-- Header -->
  <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 28px 24px; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 22px; font-weight: 700;">
      🎯 Saved Search Alert
    </h1>
    <p style="color: #94a3b8; margin: 6px 0 0 0; font-size: 14px;">
      ${formatDate(new Date().toISOString())} • ${totalCount} matches found
    </p>
    <p style="color: #cbd5e1; margin: 10px auto 0 auto; font-size: 12px; line-height: 1.5; max-width: 440px;">
      New matches from your saved filters. Daily Briefings prioritize the best opportunities and show the full market view.
    </p>
  </div>

  <!-- Filter summary -->
  <div style="background: #1e293b; padding: 12px 20px; border-bottom: 1px solid #334155;">
    <p style="color: #cbd5e1; font-size: 12px; margin: 0;">
      <strong style="color: #f8fafc;">Filters:</strong>
      NAICS ${user.naics_codes?.slice(0, 3).join(', ') || 'Any'}${user.naics_codes?.length > 3 ? ` +${user.naics_codes.length - 3}` : ''}
      ${user.business_type ? ` • ${user.business_type}` : ''}
      ${user.location_state ? ` • ${user.location_state}` : ''}
    </p>
  </div>

  ${opportunities.length > 0 ? `
  <!-- Opportunities list -->
  <div style="background: #ffffff; border: 1px solid #e2e8f0; border-top: none;">
    <table style="width: 100%; border-collapse: collapse;">
      ${opportunitiesHtml}
    </table>
    ${moreCount > 0 ? `
    <div style="padding: 14px 16px; background: #f8fafc; text-align: center; border-top: 1px solid #e5e7eb;">
      <span style="color: #64748b; font-size: 13px;">+ ${moreCount} more opportunities matching your profile</span>
    </div>
    ` : ''}
  </div>
  ` : `
  <!-- No New Opportunities Message -->
  <div style="background: #ffffff; padding: 24px;">
    <div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 10px; padding: 20px; text-align: center;">
      <div style="font-size: 36px; margin-bottom: 12px;">📭</div>
      <h3 style="color: #0369a1; margin: 0 0 8px 0; font-size: 16px; font-weight: 700;">No New Opportunities Today</h3>
      <p style="color: #0c4a6e; margin: 0; font-size: 14px; line-height: 1.5;">
        No new opportunities matching your alert filters were available today.
      </p>
    </div>
  </div>
  `}

  ${grants.length > 0 ? `
  <!-- Grants Section -->
  <div style="margin-top: 24px;">
    <div style="background: linear-gradient(135deg, #065f46 0%, #059669 100%); padding: 16px 20px; border-radius: 12px 12px 0 0;">
      <h2 style="color: white; margin: 0; font-size: 18px; font-weight: 700;">
        🎓 Grant Opportunities
      </h2>
      <p style="color: #a7f3d0; margin: 4px 0 0 0; font-size: 13px;">
        ${grants.length} federal grants matching your profile
      </p>
    </div>
    <div style="background: #ffffff; border: 1px solid #d1fae5; border-top: none; border-radius: 0 0 12px 12px;">
      <table style="width: 100%; border-collapse: collapse;">
        ${grants.map((grant, i) => {
          const daysUntil = getDaysUntil(grant.closeDate);
          const urgencyColor = daysUntil <= 14 ? '#dc2626' : daysUntil <= 30 ? '#d97706' : '#16a34a';
          const scoreColor = grant.score >= 60 ? '#16a34a' : grant.score >= 40 ? '#84cc16' : '#eab308';
          const fundingText = grant.awardCeiling ? `Up to $${(grant.awardCeiling / 1000).toFixed(0)}K` : '';

          return `
            <tr>
              <td style="padding: 14px 16px; border-bottom: 1px solid #e5e7eb;">
                <div style="margin-bottom: 6px;">
                  <span style="background: #dcfce7; color: #166534; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">
                    GRANT
                  </span>
                  ${fundingText ? `<span style="background: #fef3c7; color: #92400e; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; margin-left: 4px;">${fundingText}</span>` : ''}
                  <span style="background: ${scoreColor}20; color: ${scoreColor}; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; margin-left: 4px;">${grant.score}%</span>
                </div>
                <a href="${trackedUrl(grant.link, 'grants_gov_opportunity', `grant_${grant.oppNumber || i + 1}`)}" style="color: #065f46; font-weight: 600; text-decoration: none; font-size: 14px; line-height: 1.4;">
                  ${i + 1}. ${grant.title.slice(0, 90)}${grant.title.length > 90 ? '...' : ''}
                </a>
                <div style="color: #6b7280; font-size: 12px; margin-top: 5px;">
                  ${grant.agency} &nbsp;•&nbsp;
                  <span style="color: ${urgencyColor};">Closes ${formatDate(grant.closeDate)}</span>
                </div>
              </td>
            </tr>
          `;
        }).join('')}
      </table>
    </div>
  </div>
  ` : ''}

  <!-- Feedback Section -->
  <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 10px; padding: 16px 20px; margin-top: 20px; text-align: center;">
    <p style="color: #166534; margin: 0 0 12px 0; font-size: 14px; font-weight: 600;">
      Was this alert helpful?
    </p>
    <div style="display: inline-block;">
      <a href="${trackedUrl(`https://tools.govcongiants.org/api/feedback?email=${encodeURIComponent(email)}&type=helpful&source=daily_alert`, 'feedback_helpful')}" style="background: #22c55e; color: white; padding: 8px 20px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 13px; display: inline-block; margin: 0 6px;">
        👍 Yes
      </a>
      <a href="${trackedUrl(`https://tools.govcongiants.org/api/feedback?email=${encodeURIComponent(email)}&type=not_helpful&source=daily_alert`, 'feedback_not_helpful')}" style="background: #ef4444; color: white; padding: 8px 20px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 13px; display: inline-block; margin: 0 6px;">
        👎 No
      </a>
    </div>
  </div>

  <div style="background: linear-gradient(135deg, #4c1d95 0%, #7c3aed 100%); border-radius: 10px; padding: 24px; margin-top: 20px; text-align: center;">
    <h3 style="color: white; margin: 0 0 8px 0; font-size: 17px; font-weight: 700;">
      Want the Daily Briefing?
    </h3>
    <p style="color: #ddd6fe; margin: 0 0 16px 0; font-size: 13px; line-height: 1.5;">
      Alerts tell you what matched. <strong>Daily Briefings</strong> rank your top priorities, explain why they matter, and link you to the full opportunity dashboard.
    </p>
    <a href="${trackedUrl(dailyBriefingsUrl, 'upgrade_market_intelligence')}" style="background: white; color: #5b21b6; padding: 11px 24px; text-decoration: none; border-radius: 6px; font-weight: 700; font-size: 14px; display: inline-block;">
      Upgrade to Daily Briefings →
    </a>
    <p style="color: #c4b5fd; font-size: 11px; margin: 10px 0 0 0;">
      Top priorities in your inbox + browse all matching opportunities
    </p>
  </div>

  <!-- Footer -->
  <div style="background: #f1f5f9; padding: 18px 20px; border-radius: 0 0 12px 12px; text-align: center; margin-top: 1px;">
    <p style="color: #64748b; font-size: 12px; margin: 0;">
      <a href="${trackedUrl(preferencesUrl, 'manage_preferences')}" style="color: #475569; text-decoration: none;">Manage Preferences</a>
      &nbsp;•&nbsp;
      <a href="${trackedUrl(unsubscribeUrl, 'unsubscribe')}" style="color: #475569; text-decoration: none;">Unsubscribe</a>
    </p>
    <p style="color: #94a3b8; font-size: 11px; margin: 8px 0 0 0;">
      © ${new Date().getFullYear()} GovCon Giants • tools.govcongiants.org
    </p>
  </div>
  ${trackingToken ? generateTrackingPixel(trackingToken) : ''}
</body>
</html>
`;

  await sendEmail({
    from: `"Alerts" <${process.env.SMTP_USER || 'alerts@govcongiants.com'}>`,
    to: email,
    subject: `🎯 ${totalCount} New Opportunities${grants.length > 0 ? ' + Grants' : ''} - ${formatDate(new Date().toISOString())}`,
    html: htmlContent,
    emailType: 'daily_alert',
    eventSource: 'daily_alert',
    tags: {
      email_type: 'daily_alert',
      alert_type: 'daily',
      match_count: totalCount,
      sam_match_count: opportunities.length,
      grant_match_count: grants.length,
      naics_primary: user.naics_codes?.[0] || 'none',
      user_segment: user.business_type || 'uncertified',
      state: user.location_state || 'none',
    },
    metadata: {
      tracking_token: trackingToken || null,
      naics_codes: user.naics_codes || [],
      business_type: user.business_type || null,
      location_state: user.location_state || null,
      opportunity_ids: opportunities.slice(0, 20).map(opp => opp.noticeId).filter(Boolean),
    },
  });
}
