import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchSamOpportunities, scoreOpportunity, SAMOpportunity } from '@/lib/briefings/pipelines/sam-gov';
import nodemailer from 'nodemailer';
import { createSecureAccessUrl } from '@/lib/access-links';

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

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.office365.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER || 'alerts@govcongiants.com',
    pass: process.env.SMTP_PASSWORD,
  },
});

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

// Batch size to avoid Vercel timeout (60s limit)
// Each user takes ~2-3s for SAM.gov fetch + email send
const BATCH_SIZE = 15;

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
  agencies: string[];
  location_state: string | null;
  alert_frequency: string;
  alerts_enabled: boolean;
  is_active: boolean;
  total_alerts_sent?: number | null;
}

/**
 * Core job logic - extracted so GET and POST can both use it
 *
 * Processes TWO groups of users:
 * 1. Users with alert_frequency='weekly' (explicitly chose weekly)
 * 2. Free tier users with alert_frequency='daily' (skipped by daily-alerts cron)
 */
async function runWeeklyAlertJob(): Promise<NextResponse> {
  try {
    console.log('[Weekly Alerts] Starting weekly alert job...');

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
    const users: AlertUser[] = [];
    for (const user of allUsers) {
      const { tier } = await getAlertLimit(user.user_email);

      // Include if explicitly weekly OR free tier
      if (user.alert_frequency === 'weekly' || tier === 'free') {
        users.push(user as AlertUser);
      }
    }

    if (users.length === 0) {
      console.log('[Weekly Alerts] No users to process after tier filtering');
      return NextResponse.json({ success: true, message: 'No users to process', sent: 0 });
    }

    // Check for already processed this week (deduplication)
    const today = new Date();
    const startOfWeek = new Date(today);
    const dayOfWeek = startOfWeek.getUTCDay();
    const daysToSubtract = dayOfWeek === 0 ? 0 : dayOfWeek; // Go back to Sunday
    startOfWeek.setUTCDate(startOfWeek.getUTCDate() - daysToSubtract);
    startOfWeek.setUTCHours(0, 0, 0, 0);

    const { data: processedThisWeek } = await getSupabase()
      .from('alert_log')
      .select('user_email')
      .gte('sent_at', startOfWeek.toISOString())
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

    const samApiKey = process.env.SAM_API_KEY;
    if (!samApiKey) {
      console.error('[Weekly Alerts] SAM_API_KEY not configured');
      return NextResponse.json({ error: 'SAM API key not configured' }, { status: 500 });
    }

    const results = {
      sent: 0,
      skipped: 0,
      failed: 0,
      errors: [] as string[],
    };

    // Clear buyer cache for fresh data
    buyerEmailsCache = null;

    // Process each user in this batch
    for (const user of usersToProcess) {
      try {
        // Determine user's alert tier based on purchase history
        const { limit: alertLimit, tier } = await getAlertLimit(user.user_email);

        // Build search params from user profile
        const setAsides = user.business_type
          ? [businessTypeToSetAside[user.business_type] || user.business_type]
          : [];

        // Fetch opportunities from SAM.gov
        const searchResult = await fetchSamOpportunities({
          naicsCodes: user.naics_codes || [],
          setAsides,
          state: user.location_state || undefined,
          // Only actionable opportunity types
          noticeTypes: ['p', 'r', 'k', 'o'], // presolicitation, sources sought, combined, solicitation
          postedFrom: getDateDaysAgo(7), // Last 7 days
          limit: 50,
        }, samApiKey);

        const opportunities = searchResult.opportunities;

        // Score and rank opportunities
        const scoredOpps = opportunities.map(opp => ({
          ...opp,
          score: scoreOpportunity(opp, {
            naics_codes: user.naics_codes || [],
            agencies: user.agencies || [],
            keywords: [],
          }),
        })).sort((a, b) => b.score - a.score);

        // Apply tier-based limit (5 for free, 15 for paid)
        const topOpps = scoredOpps.slice(0, alertLimit);
        console.log(`[Weekly Alerts] ${user.user_email}: tier=${tier}, limit=${alertLimit}, found=${scoredOpps.length}`);

        if (topOpps.length === 0) {
          console.log(`[Weekly Alerts] No opportunities found for ${user.user_email}`);
          results.skipped++;
          continue;
        }

        // Send email with tier info
        await sendAlertEmail(user.user_email, topOpps, user, tier, scoredOpps.length);

        // Log the alert (include alert_type for proper deduplication)
        await getSupabase().from('alert_log').upsert({
          user_email: user.user_email,
          alert_date: new Date().toISOString().split('T')[0],
          alert_type: 'weekly',
          opportunities_count: topOpps.length,
          opportunities_data: topOpps.slice(0, 5).map(o => ({
            title: o.title,
            agency: o.department,
            naics: o.naicsCode,
            deadline: o.responseDeadline,
          })),
          sent_at: new Date().toISOString(),
          delivery_status: 'sent',
        }, {
          onConflict: 'user_email,alert_date,alert_type',
        });

        // Update user's alert stats
        await getSupabase()
          .from('user_notification_settings')
          .update({
            last_alert_sent: new Date().toISOString(),
            last_alert_count: topOpps.length,
            total_alerts_sent: (user.total_alerts_sent || 0) + 1,
          })
          .eq('user_email', user.user_email);

        console.log(`[Weekly Alerts] Sent ${topOpps.length} opportunities to ${user.user_email}`);
        results.sent++;

      } catch (userError: unknown) {
        console.error(`[Weekly Alerts] Error processing ${user.user_email}:`, userError);
        results.failed++;
        results.errors.push(`${user.user_email}: ${userError instanceof Error ? userError.message : 'Unknown error'}`);
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
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  return runWeeklyAlertJob();
}

/**
 * GET endpoint - runs the cron job when called by Vercel cron
 * Vercel crons use GET requests, so we run the job here
 */
export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email');

  // Check if this is a Vercel cron request
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const authHeader = request.headers.get('authorization');
  const hasCronSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;

  // Run the job if triggered by Vercel cron or has CRON_SECRET
  if (isVercelCron || hasCronSecret) {
    // DAY-OF-WEEK GUARD: Weekly alerts only send on Sunday (UTC)
    const today = new Date();
    const dayOfWeek = today.getUTCDay(); // 0 = Sunday

    if (dayOfWeek !== 0) {
      console.log(`[Weekly Alerts] Skipped - not Sunday (day ${dayOfWeek})`);
      return NextResponse.json({
        success: true,
        message: `Weekly alerts only send on Sunday. Today is day ${dayOfWeek}.`,
        skipped: true,
        dayOfWeek,
      });
    }

    return runWeeklyAlertJob();
  }

  // If checking specific user (not cron trigger)
  if (!email) {
    return NextResponse.json({
      message: 'Weekly Alerts Cron Job',
      usage: 'GET ?email=xxx to test for specific user',
      schedule: 'Every Sunday at 6 PM ET (23:00 UTC)',
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
          <a href="${opp.uiLink}" style="color: #1e40af; font-weight: 600; text-decoration: none; font-size: 15px;">
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
      <a href="${ohProUpgradeUrl}" style="background: white; color: #059669; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
        Upgrade to OH Pro - $49 one-time
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
      <a href="${briefingsUpgradeUrl}" style="background: white; color: #7c3aed; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
        Upgrade to Market Intelligence - $49/mo
      </a>
    </div>

    <!-- Feedback Section -->
    <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 10px; padding: 16px 20px; margin-top: 25px; text-align: center;">
      <p style="color: #166534; margin: 0 0 12px 0; font-size: 14px; font-weight: 600;">
        Was this weekly digest helpful?
      </p>
      <div>
        <a href="https://tools.govcongiants.org/api/feedback?email=${encodeURIComponent(email)}&type=helpful&source=weekly_digest" style="background: #22c55e; color: white; padding: 8px 20px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 13px; display: inline-block; margin: 0 6px;">
          👍 Yes
        </a>
        <a href="https://tools.govcongiants.org/api/feedback?email=${encodeURIComponent(email)}&type=not_helpful&source=weekly_digest" style="background: #ef4444; color: white; padding: 8px 20px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 13px; display: inline-block; margin: 0 6px;">
          👎 No
        </a>
      </div>
    </div>
  </div>

  <div style="background: #f8fafc; padding: 20px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px; text-align: center;">
    <p style="color: #6b7280; font-size: 12px; margin: 0;">
      <a href="${preferencesUrl}" style="color: #6b7280;">Manage Preferences</a> &nbsp;|&nbsp;
      <a href="${unsubscribeUrl}" style="color: #6b7280;">Unsubscribe</a>
    </p>
    <p style="color: #9ca3af; font-size: 11px; margin: 10px 0 0 0;">
      &copy; ${new Date().getFullYear()} GovCon Giants | shop.govcongiants.org
    </p>
  </div>
</body>
</html>
`;

  await transporter.sendMail({
    from: `"GovCon Giants" <${process.env.SMTP_USER || 'hello@govconedu.com'}>`,
    to: email,
    subject: `${opportunities.length} New Opportunities Match Your Profile - Week of ${formatDate(new Date().toISOString())}`,
    html: htmlContent,
  });
}
