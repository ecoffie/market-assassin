import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchSamOpportunitiesFromCache, scoreOpportunity, SAMOpportunity } from '@/lib/briefings/pipelines/sam-gov';
import { createSecureAccessUrl } from '@/lib/access-links';
import { persistSentAlert, upsertAlertLog } from '@/lib/alerts/delivery-log';
import { sendEmail } from '@/lib/send-email';
import { appendEmailUtm, createEmailTrackingToken, generateTrackedLink, generateTrackingPixel } from '@/lib/engagement';

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

// Alert tier limits
const ALERT_LIMITS = {
  free: 5,      // Free tier: 5 opps/week
  pro: 15,      // Any paid product: 15 opps/week
};

// Uses local SAM cache instead of per-user SAM.gov API calls, so the Sunday batch
// window can cover the free weekly audience without external API rate limits.
const BATCH_SIZE = 75;

// Products that grant Pro tier (15 opps)
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

// Cache for buyer emails (refreshed on each cron run)
let buyerEmailsCache: Set<string> | null = null;

/**
 * Fetch buyer emails from shop.govcongiants.org purchases
 */
async function fetchBuyerEmails(): Promise<Set<string>> {
  if (buyerEmailsCache) return buyerEmailsCache;

  try {
    const res = await fetch('https://shop.govcongiants.org/api/admin/purchases-report?days=365', {
      headers: { 'x-admin-password': 'admin123' },
    });
    if (!res.ok) {
      console.log('[Weekly Alerts] Could not fetch buyer list, defaulting to free tier');
      return new Set();
    }
    const data = await res.json();
    const purchases = data.purchases || [];

    // Build set of emails who bought pro-tier products
    const proEmails = new Set<string>();
    for (const p of purchases) {
      const productId = (p.productId || '').toLowerCase();
      if (PRO_TIER_PRODUCTS.some(tier => productId.includes(tier))) {
        proEmails.add(p.email.toLowerCase());
      }
    }
    buyerEmailsCache = proEmails;
    console.log(`[Weekly Alerts] Loaded ${proEmails.size} pro tier buyers`);
    return proEmails;
  } catch (err) {
    console.error('[Weekly Alerts] Error fetching buyers:', err);
    return new Set();
  }
}

/**
 * Get alert limit for a user based on purchase history
 */
async function getAlertLimit(email: string): Promise<{ limit: number; tier: 'free' | 'pro' }> {
  const buyerEmails = await fetchBuyerEmails();
  const normalizedEmail = email.toLowerCase();

  if (buyerEmails.has(normalizedEmail)) {
    return { limit: ALERT_LIMITS.pro, tier: 'pro' };
  }
  return { limit: ALERT_LIMITS.free, tier: 'free' };
}

interface AlertUser {
  user_email: string;
  naics_codes: string[];
  business_type: string | null;
  business_description?: string | null;
  agencies: string[];
  location_state: string | null;
  alert_frequency: string;
  alerts_enabled: boolean;
  is_active: boolean;
  total_alerts_sent?: number | null;
}

type WeeklyAlertSource = 'explicit_weekly' | 'free_weekly_fallback';

interface WeeklyAlertJobOptions {
  force?: boolean;
  email?: string | null;
}

function getWeeklyCycleDate(referenceDate = new Date()): string {
  const cycle = new Date(referenceDate);
  cycle.setUTCHours(0, 0, 0, 0);
  cycle.setUTCDate(cycle.getUTCDate() - cycle.getUTCDay());
  return cycle.toISOString().split('T')[0];
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

function getAlertSource(user: AlertUser, tier: 'free' | 'pro'): WeeklyAlertSource | null {
  if (user.alert_frequency === 'weekly') {
    return 'explicit_weekly';
  }
  if (tier === 'free') {
    return 'free_weekly_fallback';
  }
  return null;
}

async function persistProcessedWeeklyAlert({
  user,
  alertDate,
  status,
  source,
  tier,
  opportunitiesCount,
  opportunitiesData,
  errorMessage,
}: {
  user: AlertUser;
  alertDate: string;
  status: 'skipped' | 'failed';
  source: WeeklyAlertSource;
  tier: 'free' | 'pro';
  opportunitiesCount: number;
  opportunitiesData?: Record<string, unknown>[];
  errorMessage?: string;
}) {
  const processedAt = new Date().toISOString();

  await upsertAlertLog(getSupabase(), {
    user_email: user.user_email,
    alert_date: alertDate,
    alert_type: 'weekly',
    opportunities_count: opportunitiesCount,
    opportunities_data: opportunitiesData || [{
      alertSource: source,
      tier,
      reason: errorMessage || status,
    }],
    sent_at: processedAt,
    delivery_status: status,
    error_message: errorMessage || null,
  });
}

/**
 * Core job logic - extracted so GET and POST can both use it
 *
 * Processes TWO groups of users:
 * 1. Users with alert_frequency='weekly' (explicitly chose weekly)
 * 2. Free tier users with alert_frequency='daily' (skipped by daily-alerts cron)
 */
async function runWeeklyAlertJob(options: WeeklyAlertJobOptions = {}): Promise<NextResponse> {
  try {
    console.log('[Weekly Alerts] Starting weekly alert job...');
    const alertDate = getWeeklyCycleDate();

    // Get all active alert users who want alerts (weekly OR daily)
    // Daily-alerts cron skips free tier users, so we include them here
    const { data: allUsers, error: usersError } = await getSupabase()
      .from('user_notification_settings')
      .select('*')
      .eq('is_active', true)
      .eq('alerts_enabled', true);

    if (usersError) {
      console.error('[Weekly Alerts] Error fetching users:', usersError);
      return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
    }

    if (!allUsers || allUsers.length === 0) {
      console.log('[Weekly Alerts] No active alert users found');
      return NextResponse.json({ success: true, message: 'No users to process', sent: 0 });
    }

    // Refresh buyer cache first
    buyerEmailsCache = null;
    await fetchBuyerEmails();

    // Filter to:
    // 1. Users who chose weekly
    // 2. Free tier users (no product purchase) regardless of preference
    let users: AlertUser[] = [];
    for (const user of allUsers) {
      const { tier } = await getAlertLimit(user.user_email);

      // Include if explicitly weekly OR free tier
      if (user.alert_frequency === 'weekly' || tier === 'free') {
        users.push(user as AlertUser);
      }
    }

    if (options.email) {
      users = users.filter(user => user.user_email.toLowerCase() === options.email?.toLowerCase());
    }

    if (users.length === 0) {
      console.log('[Weekly Alerts] No users to process after tier filtering');
      return NextResponse.json({ success: true, message: 'No users to process', sent: 0 });
    }

    // Check for already processed this week (deduplication)
    const { data: processedThisWeek } = await getSupabase()
      .from('alert_log')
      .select('user_email')
      .eq('alert_date', alertDate)
      .eq('alert_type', 'weekly');

    const processedEmails = new Set((processedThisWeek || []).map((r: { user_email: string }) => r.user_email.toLowerCase()));

    // Filter out already processed and limit to batch size
    const usersToProcess = users
      .filter(u => !processedEmails.has(u.user_email.toLowerCase()))
      .slice(0, BATCH_SIZE);

    console.log(`[Weekly Alerts] Processing ${usersToProcess.length}/${users.length} users (${processedEmails.size} already processed this week)...`);

    if (usersToProcess.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'All users already processed this week',
        sent: 0,
        alreadyProcessed: processedEmails.size,
      });
    }

    const results = {
      sent: 0,
      skipped: 0,
      failed: 0,
      noNaics: 0,
      noMatches: 0,
      errors: [] as string[],
    };

    // Clear buyer cache for fresh data
    buyerEmailsCache = null;

    // Process each user in this batch
    for (const user of usersToProcess) {
      try {
        // Determine user's alert tier based on purchase history
        const { limit: alertLimit, tier } = await getAlertLimit(user.user_email);
        const alertSource = getAlertSource(user, tier);

        if (!alertSource) {
          continue;
        }

        if (!user.naics_codes || user.naics_codes.length === 0) {
          await persistProcessedWeeklyAlert({
            user,
            alertDate,
            status: 'skipped',
            source: alertSource,
            tier,
            opportunitiesCount: 0,
            errorMessage: 'No NAICS configured',
          });
          results.skipped++;
          results.noNaics++;
          continue;
        }

        // Build search params from user profile
        const setAsides = user.business_type
          ? [businessTypeToSetAside[user.business_type] || user.business_type]
          : [];

        // Fetch opportunities from the local SAM cache. The cache is synced by cron
        // and avoids per-user SAM.gov API calls in the weekly send hot path.
        const searchResult = await fetchSamOpportunitiesFromCache({
          naicsCodes: user.naics_codes || [],
          setAsides,
          state: user.location_state || undefined,
          // Only actionable opportunity types
          noticeTypes: ['p', 'r', 'k', 'o'], // presolicitation, sources sought, combined, solicitation
          postedFrom: getDateDaysAgo(7), // Last 7 days
          limit: 50,
        });

        const opportunities = searchResult.opportunities;

        // Score and rank opportunities
        const scoredOpps = opportunities.map(opp => ({
          ...opp,
          score: scoreOpportunity(opp, {
            naics_codes: user.naics_codes || [],
            agencies: user.agencies || [],
            keywords: [],
            business_description: user.business_description || null,
          }),
        })).sort((a, b) => b.score - a.score);

        // Apply tier-based limit (5 for free, 15 for paid)
        const topOpps = scoredOpps.slice(0, alertLimit);
        console.log(`[Weekly Alerts] ${user.user_email}: tier=${tier}, limit=${alertLimit}, found=${scoredOpps.length}`);

        if (topOpps.length === 0) {
          console.log(`[Weekly Alerts] No opportunities found for ${user.user_email}`);
          await persistProcessedWeeklyAlert({
            user,
            alertDate,
            status: 'skipped',
            source: alertSource,
            tier,
            opportunitiesCount: 0,
            errorMessage: 'No matching opportunities found',
          });
          results.skipped++;
          results.noMatches++;
          continue;
        }

        // Send email with tier info
        await sendAlertEmail(user.user_email, topOpps, user, tier, scoredOpps.length);

        await persistSentAlert({
          supabase: getSupabase(),
          email: user.user_email,
          alertType: 'weekly',
          alertDate,
          opportunitiesCount: topOpps.length,
          opportunitiesData: topOpps.slice(0, 5).map((o, i) => ({
            alertSource,
            tier,
            rank: i + 1,
            title: o.title,
            agency: o.department,
            naics: o.naicsCode,
            deadline: o.responseDeadline,
          })),
          currentTotalAlertsSent: user.total_alerts_sent,
          lastAlertCount: topOpps.length,
        });

        console.log(`[Weekly Alerts] Sent ${topOpps.length} opportunities to ${user.user_email}`);
        results.sent++;

      } catch (userError: unknown) {
        console.error(`[Weekly Alerts] Error processing ${user.user_email}:`, userError);
        const { tier } = await getAlertLimit(user.user_email);
        const alertSource = getAlertSource(user, tier) || 'free_weekly_fallback';
        const errorMessage = getErrorMessage(userError);
        await persistProcessedWeeklyAlert({
          user,
          alertDate,
          status: 'failed',
          source: alertSource,
          tier,
          opportunitiesCount: 0,
          errorMessage,
        }).catch(logError => {
          console.error(`[Weekly Alerts] Failed to persist failure for ${user.user_email}:`, logError);
        });
        results.failed++;
        results.errors.push(`${user.user_email}: ${errorMessage}`);
      }
    }

    const remainingUsers = users.length - processedEmails.size - usersToProcess.length;
    console.log(`[Weekly Alerts] Complete. Sent: ${results.sent}, Skipped: ${results.skipped}, Failed: ${results.failed}, Remaining: ${remainingUsers}`);

    return NextResponse.json({
      success: true,
      results,
      batch: {
        processed: usersToProcess.length,
        alreadyProcessed: processedEmails.size,
        remaining: remainingUsers,
        totalEligible: users.length,
        batchSize: BATCH_SIZE,
        alertDate,
      },
    });
  } catch (error: unknown) {
    console.error('[Weekly Alerts] Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/cron/weekly-alerts
 * Legacy endpoint - still works for manual triggers with CRON_SECRET
 */
export async function POST(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  const adminPassword = request.nextUrl.searchParams.get('password');
  const hasAdminPassword = adminPassword === (process.env.ADMIN_PASSWORD || 'galata-assassin-2026');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !hasAdminPassword) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const { searchParams } = request.nextUrl;
  return runWeeklyAlertJob({
    force: searchParams.get('force') === 'true' || searchParams.get('catchup') === 'true',
    email: searchParams.get('email'),
  });
}

/**
 * GET endpoint - runs the cron job when called by Vercel cron
 * Vercel crons use GET requests, so we run the job here
 */
export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email');
  const isTest = request.nextUrl.searchParams.get('test') === 'true';
  const isCatchup = request.nextUrl.searchParams.get('catchup') === 'true';
  const force = request.nextUrl.searchParams.get('force') === 'true' || isCatchup;

  // Check if this is a Vercel cron request
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const authHeader = request.headers.get('authorization');
  const hasCronSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const adminPassword = request.nextUrl.searchParams.get('password');
  const hasAdminPassword = adminPassword === (process.env.ADMIN_PASSWORD || 'galata-assassin-2026');

  // Run the job if triggered by Vercel cron or has CRON_SECRET
  if (isVercelCron || hasCronSecret || hasAdminPassword) {
    // DAY-OF-WEEK GUARD: Weekly alerts only send on Sunday (UTC)
    const today = new Date();
    const dayOfWeek = today.getUTCDay(); // 0 = Sunday

    if (dayOfWeek !== 0 && !force) {
      console.log(`[Weekly Alerts] Skipped - not Sunday (day ${dayOfWeek})`);
      return NextResponse.json({
        success: true,
        message: `Weekly alerts only send on Sunday unless catchup=true or force=true. Today is day ${dayOfWeek}.`,
        skipped: true,
        dayOfWeek,
      });
    }

    return runWeeklyAlertJob({ force, email: isTest ? email : null });
  }

  // If checking specific user (not cron trigger)
  if (!email) {
    return NextResponse.json({
      message: 'Weekly Alerts Cron Job',
      usage: 'GET ?email=xxx to inspect a user. Use authorized GET/POST with ?catchup=true for manual catch-up.',
      schedule: 'Sunday batch window from 23:00 UTC into Monday 00:30 UTC',
      batchSize: BATCH_SIZE,
    });
  }

  // Test mode for specific user
  const { data: user } = await getSupabase()
    .from('user_notification_settings')
    .select('*')
    .eq('user_email', email.toLowerCase())
    .single();

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  return NextResponse.json({
    user: {
      email: user.user_email,
      naicsCodes: user.naics_codes,
      businessType: user.business_type,
      agencies: user.agencies,
      isActive: user.is_active,
      lastAlertSent: user.last_alert_sent,
    },
    message: 'Use POST to send test alert',
  });
}

// Helper: Get date N days ago in YYYY-MM-DD format
function getDateDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split('T')[0];
}

// Helper: Format date for display
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

// Helper: Get days until deadline
function getDaysUntil(dateString: string): number {
  if (!dateString) return 999;
  const target = new Date(dateString);
  const today = new Date();
  const diff = target.getTime() - today.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

// Send alert email
async function sendAlertEmail(
  email: string,
  opportunities: (SAMOpportunity & { score: number })[],
  user: AlertUser,
  tier: 'free' | 'pro' = 'free',
  totalAvailable: number = 0
) {
  const emailDate = new Date().toISOString().split('T')[0];
  const tokenResult = await createEmailTrackingToken(email, 'weekly_alert', emailDate);
  const trackingToken = tokenResult?.token;
  const trackedUrl = (url: string, label: string, content = label) => {
    const urlWithUtm = appendEmailUtm(url, {
      campaign: 'weekly_alert',
      content,
    });
    return trackingToken ? generateTrackedLink(trackingToken, urlWithUtm, label) : urlWithUtm;
  };

  const unsubscribeUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://shop.govcongiants.org'}/alerts/unsubscribe?email=${encodeURIComponent(email)}`;
  const preferencesUrl = await createSecureAccessUrl(email, 'preferences');
  const briefingsUpgradeUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://tools.govcongiants.org'}/market-intelligence`;
  const ohProUpgradeUrl = 'https://buy.stripe.com/7sIaGqevYeIcdri147'; // OH Pro payment link

  const showUpgradeToOHPro = tier === 'free' && totalAvailable > 5;

  const opportunitiesHtml = opportunities.map((opp, i) => {
    const daysUntil = getDaysUntil(opp.responseDeadline);
    const urgencyColor = daysUntil <= 7 ? '#dc2626' : daysUntil <= 14 ? '#d97706' : '#16a34a';
    const urgencyText = daysUntil <= 7 ? 'Due Soon!' : daysUntil <= 14 ? 'Due in 2 weeks' : '';

    return `
      <tr>
        <td style="padding: 16px; border-bottom: 1px solid #e5e7eb;">
          <div style="margin-bottom: 8px;">
            <span style="background: #dbeafe; color: #1e40af; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 500;">
              ${opp.noticeType || 'Solicitation'}
            </span>
            ${opp.setAside ? `<span style="background: #dcfce7; color: #166534; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 500; margin-left: 4px;">${opp.setAside}</span>` : ''}
            ${urgencyText ? `<span style="background: ${urgencyColor}20; color: ${urgencyColor}; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 500; margin-left: 4px;">${urgencyText}</span>` : ''}
          </div>
          <a href="${trackedUrl(opp.uiLink, 'sam_gov_opportunity', `opportunity_${opp.noticeId || i + 1}`)}" style="color: #1e40af; font-weight: 600; text-decoration: none; font-size: 15px;">
            ${i + 1}. ${opp.title.slice(0, 100)}${opp.title.length > 100 ? '...' : ''}
          </a>
          <div style="color: #6b7280; font-size: 13px; margin-top: 6px;">
            <strong>Agency:</strong> ${opp.department}${opp.subTier ? ` - ${opp.subTier}` : ''}<br>
            <strong>NAICS:</strong> ${opp.naicsCode || 'N/A'} &nbsp;|&nbsp;
            <strong>Posted:</strong> ${formatDate(opp.postedDate)} &nbsp;|&nbsp;
            <strong style="color: ${urgencyColor};">Due:</strong> <span style="color: ${urgencyColor};">${formatDate(opp.responseDeadline)}</span>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 650px; margin: 0 auto; padding: 20px; background: #f3f4f6;">
  <div style="background: linear-gradient(135deg, #1e3a8a 0%, #7c3aed 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">Market Assassin</h1>
    <p style="color: #c4b5fd; margin: 8px 0 0 0; font-size: 16px;">Weekly Opportunity Alert</p>
  </div>

  <div style="background: #ffffff; padding: 25px; border: 1px solid #e5e7eb; border-top: none;">
    <p style="margin: 0 0 20px 0; font-size: 16px;">
      <strong>${opportunities.length} new opportunities</strong> matched your profile this week:
    </p>

    <div style="background: #f8fafc; padding: 12px 16px; border-radius: 8px; margin-bottom: 20px; font-size: 14px; color: #64748b;">
      <strong>Your filters:</strong>
      NAICS: ${user.naics_codes?.slice(0, 3).join(', ') || 'Any'}${user.naics_codes?.length > 3 ? ` +${user.naics_codes.length - 3} more` : ''}
      ${user.business_type ? ` | Set-aside: ${user.business_type}` : ''}
      ${user.location_state ? ` | Location: ${user.location_state}` : ''}
    </div>

    <table style="width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; border: 1px solid #e5e7eb;">
      ${opportunitiesHtml}
    </table>

    ${showUpgradeToOHPro ? `
    <!-- OH Pro Upgrade CTA (for free tier with more opps available) -->
    <div style="background: linear-gradient(135deg, #059669 0%, #10b981 100%); border-radius: 10px; padding: 24px; margin-top: 25px; text-align: center;">
      <h3 style="color: white; margin: 0 0 10px 0; font-size: 18px;">You're Missing ${totalAvailable - 5} More Opportunities!</h3>
      <p style="color: #d1fae5; margin: 0 0 16px 0; font-size: 14px;">
        Free tier shows 5 opps/week. We found <strong>${totalAvailable}</strong> matches for your profile.<br>
        Upgrade to Pro for <strong>15 opps/week</strong> + priority ranking.
      </p>
      <a href="${trackedUrl(ohProUpgradeUrl, 'upgrade_opportunity_hunter_pro')}" style="background: white; color: #059669; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
        Upgrade to OH Pro - $99 one-time
      </a>
    </div>
    ` : ''}

    <!-- Briefings Upsell CTA -->
    <div style="background: linear-gradient(135deg, #7c3aed 0%, #a855f7 100%); border-radius: 10px; padding: 24px; margin-top: 25px; text-align: center;">
      <h3 style="color: white; margin: 0 0 10px 0; font-size: 18px;">Want AI-Ranked Daily Intel?</h3>
      <p style="color: #e9d5ff; margin: 0 0 16px 0; font-size: 14px;">
        Daily Briefings gives you AI-ranked opportunities with win probability,<br>
        competitor intel, and specific action steps. Every morning.
      </p>
      <a href="${trackedUrl(briefingsUpgradeUrl, 'upgrade_market_intelligence')}" style="background: white; color: #7c3aed; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
        Upgrade to Market Intelligence - $149/mo
      </a>
    </div>

    <!-- Feedback Section -->
    <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 10px; padding: 16px 20px; margin-top: 25px; text-align: center;">
      <p style="color: #166534; margin: 0 0 12px 0; font-size: 14px; font-weight: 600;">
        Was this weekly digest helpful?
      </p>
      <div>
        <a href="${trackedUrl(`https://tools.govcongiants.org/api/feedback?email=${encodeURIComponent(email)}&type=helpful&source=weekly_digest`, 'feedback_helpful')}" style="background: #22c55e; color: white; padding: 8px 20px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 13px; display: inline-block; margin: 0 6px;">
          👍 Yes
        </a>
        <a href="${trackedUrl(`https://tools.govcongiants.org/api/feedback?email=${encodeURIComponent(email)}&type=not_helpful&source=weekly_digest`, 'feedback_not_helpful')}" style="background: #ef4444; color: white; padding: 8px 20px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 13px; display: inline-block; margin: 0 6px;">
          👎 No
        </a>
      </div>
    </div>
  </div>

  <div style="background: #f8fafc; padding: 20px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px; text-align: center;">
    <p style="color: #6b7280; font-size: 12px; margin: 0;">
      <a href="${trackedUrl(preferencesUrl, 'manage_preferences')}" style="color: #6b7280;">Manage Preferences</a> &nbsp;|&nbsp;
      <a href="${trackedUrl(unsubscribeUrl, 'unsubscribe')}" style="color: #6b7280;">Unsubscribe</a>
    </p>
    <p style="color: #9ca3af; font-size: 11px; margin: 10px 0 0 0;">
      &copy; ${new Date().getFullYear()} GovCon Giants | shop.govcongiants.org
    </p>
  </div>
  ${trackingToken ? generateTrackingPixel(trackingToken) : ''}
</body>
</html>
`;

  await sendEmail({
    from: `"GovCon Giants" <${process.env.EMAIL_FROM || 'alerts@govcongiants.com'}>`,
    to: email,
    subject: `${opportunities.length} New Opportunities Match Your Profile - Week of ${formatDate(new Date().toISOString())}`,
    html: htmlContent,
    text: `${opportunities.length} new opportunities matched your profile this week. Manage preferences: ${preferencesUrl}`,
    emailType: 'weekly_alert',
    eventSource: 'weekly_alert',
    tags: {
      email_type: 'weekly_alert',
      alert_type: 'weekly',
      match_count: opportunities.length,
      total_available: totalAvailable,
      tier,
      naics_primary: user.naics_codes?.[0] || 'none',
      user_segment: user.business_type || 'uncertified',
      state: user.location_state || 'none',
    },
    metadata: {
      tracking_token: trackingToken || null,
      naics_codes: user.naics_codes || [],
      business_type: user.business_type || null,
      location_state: user.location_state || null,
      opportunity_ids: opportunities.map(opp => opp.noticeId).filter(Boolean),
    },
  });
}
