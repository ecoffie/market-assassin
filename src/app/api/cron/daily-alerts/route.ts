import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchSamOpportunities, scoreOpportunity, SAMOpportunity } from '@/lib/briefings/pipelines/sam-gov';
import { expandNAICSCodes } from '@/lib/utils/naics-expansion';
import { getPSCsForNAICS } from '@/lib/utils/psc-crosswalk';
import nodemailer from 'nodemailer';

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
  agencies: string[];  // renamed from target_agencies
  location_state: string | null;
  alert_frequency: string;
  alerts_enabled: boolean;
  is_active: boolean;
  timezone?: string;
  last_alert_sent?: string;
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
  await getSupabase()
    .from('alert_log')
    .upsert({
      user_email: email,
      alert_date: new Date().toISOString().split('T')[0],
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
    }, {
      onConflict: 'user_email,alert_date',
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
 * Core job logic - FREE FOR EVERYONE (no subscription check)
 */
async function runDailyAlertJob(options?: {
  skipTimezoneCheck?: boolean;
  testEmail?: string;
}): Promise<NextResponse> {
  try {
    console.log('[Daily Alerts] Starting daily alert job (FREE FOR ALL)...');

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

    console.log(`[Daily Alerts] Processing ${users.length} daily users...`);

    const samApiKey = process.env.SAM_API_KEY;
    if (!samApiKey) {
      return NextResponse.json({ error: 'SAM API key not configured' }, { status: 500 });
    }

    const results = {
      sent: 0,
      skipped: 0,
      failed: 0,
      noNaics: 0,
      noOpps: 0,
      wrongTimezone: 0,
      deduplicated: 0,
      errors: [] as string[],
    };

    for (const user of users as AlertUser[]) {
      try {
        // Check timezone (skip if not delivery time for this user)
        if (!options?.skipTimezoneCheck && !isDeliveryTimeForTimezone(user.timezone)) {
          console.log(`[Daily Alerts] ${user.user_email} timezone ${user.timezone || 'ET'} - not delivery time, skipping`);
          results.wrongTimezone++;
          continue;
        }

        // Get NAICS codes - try user_notification_settings first, then fall back to smart_user_profiles
        let userNaics = user.naics_codes || [];

        if (userNaics.length === 0) {
          // Fall back to smart_user_profiles
          const { data: smartProfile } = await getSupabase()
            .from('smart_user_profiles')
            .select('naics_codes')
            .eq('email', user.user_email.toLowerCase())
            .single();

          if (smartProfile?.naics_codes && smartProfile.naics_codes.length > 0) {
            userNaics = smartProfile.naics_codes;
            console.log(`[Daily Alerts] Using smart profile NAICS for ${user.user_email}: ${userNaics.join(', ')}`);
          }
        }

        // Skip if still no NAICS codes
        if (userNaics.length === 0) {
          console.log(`[Daily Alerts] ${user.user_email} has no NAICS codes, skipping`);
          results.noNaics++;
          continue;
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

        // Fetch opportunities using NAICS + keywords (primary search)
        const searchResult = await fetchSamOpportunities({
          naicsCodes: expandedNaics,
          keywords: userKeywords.length > 0 ? userKeywords : undefined,
          setAsides,
          noticeTypes: ['p', 'r', 'k', 'o'],
          postedFrom: getDateDaysAgo(1), // Last 24 hours
          limit: 100,
        }, samApiKey);

        let opportunities = searchResult.opportunities;

        // DEDUPLICATE: Filter out opportunities already sent in last 7 days
        const beforeDedup = opportunities.length;
        opportunities = opportunities.filter(opp => !recentlySentIds.has(opp.noticeId));
        const dedupCount = beforeDedup - opportunities.length;
        if (dedupCount > 0) {
          console.log(`[Daily Alerts] ${user.user_email}: Deduplicated ${dedupCount} already-sent opportunities`);
          results.deduplicated += dedupCount;
        }

        // Score and rank - use ORIGINAL codes for scoring (exact matches rank higher)
        const scoredOpps = opportunities.map(opp => ({
          ...opp,
          score: scoreOpportunity(opp, {
            naics_codes: userNaics, // Original codes, not expanded
            agencies: user.agencies || [],
            keywords: userKeywords,
          }),
        })).sort((a, b) => b.score - a.score);

        if (scoredOpps.length === 0) {
          console.log(`[Daily Alerts] No new opportunities for ${user.user_email}`);
          results.noOpps++;
          continue;
        }

        // Send email
        try {
          await sendDailyAlertEmail(user.user_email, scoredOpps, user);

          // Log the alert with opportunity IDs for deduplication
          await getSupabase().from('alert_log').upsert({
            user_email: user.user_email,
            alert_date: new Date().toISOString().split('T')[0],
            opportunities_count: scoredOpps.length,
            opportunities_data: scoredOpps.slice(0, 20).map(o => ({
              noticeId: o.noticeId,
              title: o.title,
              agency: o.department,
              naics: o.naicsCode,
              deadline: o.responseDeadline,
              score: o.score,
            })),
            sent_at: new Date().toISOString(),
            delivery_status: 'sent',
            alert_type: 'daily',
            retry_count: 0,
          }, {
            onConflict: 'user_email,alert_date',
          });

          // Update user stats (unified table)
          await getSupabase()
            .from('user_notification_settings')
            .update({
              last_alert_sent: new Date().toISOString(),
              total_alerts_sent: (user as any).total_alerts_sent + 1 || 1,
            })
            .eq('user_email', user.user_email);

          console.log(`[Daily Alerts] ✅ Sent ${scoredOpps.length} opps to ${user.user_email}`);
          results.sent++;

        } catch (emailError: any) {
          console.error(`[Daily Alerts] Email send failed for ${user.user_email}:`, emailError.message);

          // Save for retry
          await saveFailedAlert(user.user_email, scoredOpps, emailError.message);

          results.failed++;
          results.errors.push(`${user.user_email}: ${emailError.message}`);
        }

      } catch (userError: any) {
        console.error(`[Daily Alerts] Error processing ${user.user_email}:`, userError);
        results.failed++;
        results.errors.push(`${user.user_email}: ${userError.message}`);
      }
    }

    console.log(`[Daily Alerts] Complete. Sent: ${results.sent}, No Opps: ${results.noOpps}, No NAICS: ${results.noNaics}, Wrong TZ: ${results.wrongTimezone}, Failed: ${results.failed}, Deduplicated: ${results.deduplicated}`);

    return NextResponse.json({ success: true, results, retryResults });
  } catch (error: any) {
    console.error('[Daily Alerts] Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
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
  });
}

/**
 * GET endpoint - runs the cron job when called by Vercel cron
 */
export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email');
  const test = request.nextUrl.searchParams.get('test') === 'true';

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
    message: 'Daily Alerts Cron Job (FREE FOR EVERYONE)',
    usage: {
      test: 'GET ?email=xxx&test=true to send test alert',
      manual: 'POST with Authorization: Bearer {CRON_SECRET}',
    },
    schedule: 'Every day at 6 AM local time (based on user timezone)',
    features: [
      'FREE for all users (no paywall)',
      'Respects alert_frequency column (daily users only)',
      'Deduplication (won\'t send same opp twice in 7 days)',
      'Retry failed emails (up to 3 attempts)',
      'Timezone-aware delivery (~6 AM local)',
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

// Send daily alert email
async function sendDailyAlertEmail(
  email: string,
  opportunities: (SAMOpportunity & { score: number })[],
  user: AlertUser
) {
  const unsubscribeUrl = `https://tools.govcongiants.org/api/alerts/unsubscribe?email=${encodeURIComponent(email)}`;
  const preferencesUrl = `https://tools.govcongiants.org/alerts/preferences?email=${encodeURIComponent(email)}`;
  const maUrl = 'https://tools.govcongiants.org/market-assassin';

  const opportunitiesHtml = opportunities.slice(0, 20).map((opp, i) => {
    const daysUntil = getDaysUntil(opp.responseDeadline);
    const urgencyColor = daysUntil <= 7 ? '#dc2626' : daysUntil <= 14 ? '#d97706' : '#16a34a';
    const urgencyText = daysUntil <= 7 ? '⚡ Due Soon' : daysUntil <= 14 ? '📅 2 weeks' : '';

    // Score badge
    const scoreColor = opp.score >= 75 ? '#16a34a' : opp.score >= 50 ? '#84cc16' : opp.score >= 30 ? '#eab308' : '#f97316';
    const scoreBadge = `<span style="background: ${scoreColor}20; color: ${scoreColor}; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; margin-left: 4px;">${opp.score}%</span>`;

    return `
      <tr>
        <td style="padding: 14px 16px; border-bottom: 1px solid #e5e7eb;">
          <div style="margin-bottom: 6px;">
            <span style="background: #dbeafe; color: #1e40af; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">
              ${opp.noticeType || 'Solicitation'}
            </span>
            ${opp.setAside ? `<span style="background: #dcfce7; color: #166534; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; margin-left: 4px;">${opp.setAside}</span>` : ''}
            ${urgencyText ? `<span style="background: ${urgencyColor}15; color: ${urgencyColor}; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; margin-left: 4px;">${urgencyText}</span>` : ''}
            ${scoreBadge}
          </div>
          <a href="${opp.uiLink}" style="color: #1e40af; font-weight: 600; text-decoration: none; font-size: 14px; line-height: 1.4;">
            ${i + 1}. ${opp.title.slice(0, 90)}${opp.title.length > 90 ? '...' : ''}
          </a>
          <div style="color: #6b7280; font-size: 12px; margin-top: 5px;">
            ${opp.department}${opp.subTier ? ` › ${opp.subTier}` : ''} &nbsp;•&nbsp;
            NAICS ${opp.naicsCode || 'N/A'} &nbsp;•&nbsp;
            <span style="color: ${urgencyColor};">Due ${formatDate(opp.responseDeadline)}</span>
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
      🎯 Your Daily Opportunities
    </h1>
    <p style="color: #94a3b8; margin: 6px 0 0 0; font-size: 14px;">
      ${formatDate(new Date().toISOString())} • ${opportunities.length} matches found
    </p>
  </div>

  <!-- Filter summary -->
  <div style="background: #1e293b; padding: 12px 20px; border-bottom: 1px solid #334155;">
    <p style="color: #cbd5e1; font-size: 12px; margin: 0;">
      <strong style="color: #f8fafc;">Filters:</strong>
      NAICS ${user.naics_codes?.slice(0, 3).join(', ') || 'Any'}${user.naics_codes?.length > 3 ? ` +${user.naics_codes.length - 3}` : ''}
      ${user.business_type ? ` • ${user.business_type}` : ''}
    </p>
  </div>

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

  <!-- Market Assassin Upsell -->
  <div style="background: linear-gradient(135deg, #7f1d1d 0%, #991b1b 100%); border-radius: 10px; padding: 24px; margin-top: 20px; text-align: center;">
    <h3 style="color: white; margin: 0 0 8px 0; font-size: 17px; font-weight: 700;">
      🎯 Ready to Win These Contracts?
    </h3>
    <p style="color: #fecaca; margin: 0 0 16px 0; font-size: 13px; line-height: 1.5;">
      Finding opportunities is step one. <strong>Market Assassin</strong> shows you agency pain points, competitor intel, and exactly how to position your proposal.
    </p>
    <a href="${maUrl}" style="background: white; color: #991b1b; padding: 11px 24px; text-decoration: none; border-radius: 6px; font-weight: 700; font-size: 14px; display: inline-block;">
      Get Market Assassin →
    </a>
    <p style="color: #fca5a5; font-size: 11px; margin: 10px 0 0 0;">
      Starting at $297 • Agency intelligence + strategic reports
    </p>
  </div>

  <!-- Footer -->
  <div style="background: #f1f5f9; padding: 18px 20px; border-radius: 0 0 12px 12px; text-align: center; margin-top: 1px;">
    <p style="color: #64748b; font-size: 12px; margin: 0;">
      <a href="${preferencesUrl}" style="color: #475569; text-decoration: none;">Manage Preferences</a>
      &nbsp;•&nbsp;
      <a href="${unsubscribeUrl}" style="color: #475569; text-decoration: none;">Unsubscribe</a>
    </p>
    <p style="color: #94a3b8; font-size: 11px; margin: 8px 0 0 0;">
      © ${new Date().getFullYear()} GovCon Giants • tools.govcongiants.org
    </p>
  </div>
</body>
</html>
`;

  await getTransporter().sendMail({
    from: `"GovCon Giants" <${process.env.SMTP_USER || 'alerts@govcongiants.com'}>`,
    to: email,
    subject: `🎯 ${opportunities.length} New Opportunities - ${formatDate(new Date().toISOString())}`,
    html: htmlContent,
  });
}
