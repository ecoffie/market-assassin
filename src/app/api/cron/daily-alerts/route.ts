import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchSamOpportunities, scoreOpportunity, SAMOpportunity } from '@/lib/briefings/pipelines/sam-gov';
import nodemailer from 'nodemailer';
import Stripe from 'stripe';

// Lazy initialization to avoid build-time errors
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!);
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

// Alert Pro subscription product ID
const ALERT_PRO_PRODUCT_ID = 'prod_U9rOClXY6MFcRu';

// Cache for active subscriptions
let activeSubscriptionsCache: Set<string> | null = null;

/**
 * Check if user has active Alert Pro subscription
 */
async function hasActiveSubscription(email: string): Promise<boolean> {
  // Check cache first
  if (activeSubscriptionsCache?.has(email.toLowerCase())) {
    return true;
  }

  try {
    // Search for customer by email
    const customers = await getStripe().customers.list({ email: email.toLowerCase(), limit: 1 });
    if (customers.data.length === 0) return false;

    const customer = customers.data[0];

    // Check for active subscription to Alert Pro
    const subscriptions = await getStripe().subscriptions.list({
      customer: customer.id,
      status: 'active',
      limit: 10,
    });

    for (const sub of subscriptions.data) {
      for (const item of sub.items.data) {
        if (item.price.product === ALERT_PRO_PRODUCT_ID) {
          return true;
        }
      }
    }

    return false;
  } catch (err) {
    console.error('[Daily Alerts] Error checking subscription:', err);
    return false;
  }
}

/**
 * Load all active Alert Pro subscribers (for caching)
 */
async function loadActiveSubscribers(): Promise<Set<string>> {
  const subscribers = new Set<string>();

  try {
    // Get all active subscriptions for Alert Pro product
    const subscriptions = await getStripe().subscriptions.list({
      status: 'active',
      limit: 100,
      expand: ['data.customer'],
    });

    for (const sub of subscriptions.data) {
      const hasAlertPro = sub.items.data.some(
        item => item.price.product === ALERT_PRO_PRODUCT_ID
      );
      if (hasAlertPro && sub.customer && typeof sub.customer !== 'string' && !('deleted' in sub.customer)) {
        const email = (sub.customer as Stripe.Customer).email?.toLowerCase();
        if (email) subscribers.add(email);
      }
    }

    console.log(`[Daily Alerts] Loaded ${subscribers.size} active Alert Pro subscribers`);
    return subscribers;
  } catch (err) {
    console.error('[Daily Alerts] Error loading subscribers:', err);
    return subscribers;
  }
}

interface AlertUser {
  user_email: string;
  naics_codes: string[];
  business_type: string | null;
  target_agencies: string[];
  location_state: string | null;
  alert_frequency: string;
  is_active: boolean;
}

/**
 * POST /api/cron/daily-alerts
 * Send daily opportunity alerts
 * - Free tier: 5 opps, weekly only (handled by weekly-alerts cron)
 * - Alert Pro ($19/mo): Unlimited opps, daily
 */
export async function POST(request: NextRequest) {
  try {
    // Verify cron secret
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      if (process.env.NODE_ENV === 'production') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    console.log('[Daily Alerts] Starting daily alert job...');

    // Load active subscribers cache
    activeSubscriptionsCache = await loadActiveSubscribers();

    // Get all active daily alert users
    const { data: users, error: usersError } = await getSupabase()
      .from('user_alert_settings')
      .select('*')
      .eq('is_active', true)
      .eq('alert_frequency', 'daily');

    if (usersError) {
      console.error('[Daily Alerts] Error fetching users:', usersError);
      return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
    }

    if (!users || users.length === 0) {
      console.log('[Daily Alerts] No daily alert users found');
      return NextResponse.json({ success: true, message: 'No users to process', sent: 0 });
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
      notSubscribed: 0,
      errors: [] as string[],
    };

    for (const user of users as AlertUser[]) {
      try {
        // Check if user has active Alert Pro subscription
        const isSubscribed = await hasActiveSubscription(user.user_email);

        if (!isSubscribed) {
          console.log(`[Daily Alerts] ${user.user_email} not subscribed, skipping`);
          results.notSubscribed++;
          continue;
        }

        // Build search params
        const setAsides = user.business_type
          ? [businessTypeToSetAside[user.business_type] || user.business_type]
          : [];

        // Fetch opportunities from last 24 hours
        const searchResult = await fetchSamOpportunities({
          naicsCodes: user.naics_codes || [],
          setAsides,
          noticeTypes: ['p', 'r', 'k', 'o'],
          postedFrom: getDateDaysAgo(1), // Last 24 hours
          limit: 100, // Unlimited for Pro
        }, samApiKey);

        const opportunities = searchResult.opportunities;

        // Score and rank - no limit for Pro subscribers
        const scoredOpps = opportunities.map(opp => ({
          ...opp,
          score: scoreOpportunity(opp, {
            naics_codes: user.naics_codes || [],
            agencies: user.target_agencies || [],
            keywords: [],
          }),
        })).sort((a, b) => b.score - a.score);

        if (scoredOpps.length === 0) {
          console.log(`[Daily Alerts] No new opportunities for ${user.user_email}`);
          results.skipped++;
          continue;
        }

        // Send email (unlimited for Pro)
        await sendDailyAlertEmail(user.user_email, scoredOpps, user);

        // Log the alert
        await getSupabase().from('alert_log').upsert({
          user_email: user.user_email,
          alert_date: new Date().toISOString().split('T')[0],
          opportunities_count: scoredOpps.length,
          opportunities_data: scoredOpps.slice(0, 10).map(o => ({
            title: o.title,
            agency: o.department,
            naics: o.naicsCode,
            deadline: o.responseDeadline,
          })),
          sent_at: new Date().toISOString(),
          delivery_status: 'sent',
          alert_type: 'daily',
        }, {
          onConflict: 'user_email,alert_date',
        });

        // Update user stats
        await getSupabase()
          .from('user_alert_settings')
          .update({
            last_alert_sent: new Date().toISOString(),
            last_alert_count: scoredOpps.length,
            total_alerts_sent: (user as any).total_alerts_sent + 1 || 1,
          })
          .eq('user_email', user.user_email);

        console.log(`[Daily Alerts] Sent ${scoredOpps.length} opps to ${user.user_email}`);
        results.sent++;

      } catch (userError: any) {
        console.error(`[Daily Alerts] Error processing ${user.user_email}:`, userError);
        results.failed++;
        results.errors.push(`${user.user_email}: ${userError.message}`);
      }
    }

    console.log(`[Daily Alerts] Complete. Sent: ${results.sent}, Skipped: ${results.skipped}, Not Subscribed: ${results.notSubscribed}, Failed: ${results.failed}`);

    return NextResponse.json({ success: true, results });
  } catch (error: any) {
    console.error('[Daily Alerts] Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/**
 * GET endpoint for status/testing
 */
export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email');

  if (email) {
    const isSubscribed = await hasActiveSubscription(email);
    return NextResponse.json({
      email,
      hasAlertProSubscription: isSubscribed,
      frequency: isSubscribed ? 'daily' : 'weekly',
      limit: isSubscribed ? 'unlimited' : 5,
    });
  }

  return NextResponse.json({
    message: 'Daily Alerts Cron Job',
    usage: 'POST to run, or GET ?email=xxx to check subscription status',
    schedule: 'Every day at 6 AM ET',
    tiers: {
      free: { frequency: 'weekly', limit: 5, price: '$0' },
      alertPro: { frequency: 'daily', limit: 'unlimited', price: '$19/mo' },
    },
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

// Send daily alert email with MA upsell
async function sendDailyAlertEmail(
  email: string,
  opportunities: (SAMOpportunity & { score: number })[],
  user: AlertUser
) {
  const unsubscribeUrl = `https://tools.govcongiants.org/alerts/unsubscribe?email=${encodeURIComponent(email)}`;
  const preferencesUrl = `https://tools.govcongiants.org/alerts/preferences?email=${encodeURIComponent(email)}`;
  const maUrl = 'https://tools.govcongiants.org/market-assassin';

  const opportunitiesHtml = opportunities.slice(0, 20).map((opp, i) => {
    const daysUntil = getDaysUntil(opp.responseDeadline);
    const urgencyColor = daysUntil <= 7 ? '#dc2626' : daysUntil <= 14 ? '#d97706' : '#16a34a';
    const urgencyText = daysUntil <= 7 ? '⚡ Due Soon' : daysUntil <= 14 ? '📅 2 weeks' : '';

    return `
      <tr>
        <td style="padding: 14px 16px; border-bottom: 1px solid #e5e7eb;">
          <div style="margin-bottom: 6px;">
            <span style="background: #dbeafe; color: #1e40af; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">
              ${opp.noticeType || 'Solicitation'}
            </span>
            ${opp.setAside ? `<span style="background: #dcfce7; color: #166534; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; margin-left: 4px;">${opp.setAside}</span>` : ''}
            ${urgencyText ? `<span style="background: ${urgencyColor}15; color: ${urgencyColor}; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; margin-left: 4px;">${urgencyText}</span>` : ''}
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

  <!-- Header -->
  <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 28px 24px; text-align: center; border-radius: 12px 12px 0 0;">
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
      <span style="color: #64748b; font-size: 13px;">+ ${moreCount} more opportunities in your dashboard</span>
    </div>
    ` : ''}
  </div>

  <!-- Market Assassin Upsell -->
  <div style="background: linear-gradient(135deg, #7f1d1d 0%, #991b1b 100%); border-radius: 10px; padding: 24px; margin-top: 20px; text-align: center;">
    <h3 style="color: white; margin: 0 0 8px 0; font-size: 17px; font-weight: 700;">
      🎯 Ready to Win These Contracts?
    </h3>
    <p style="color: #fecaca; margin: 0 0 16px 0; font-size: 13px; line-height: 1.5;">
      Finding opportunities is just step one. <strong>Market Assassin</strong> shows you agency pain points, competitor intel, and exactly how to position your proposal.
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
