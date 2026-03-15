import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchSamOpportunities, scoreOpportunity, SAMOpportunity } from '@/lib/briefings/pipelines/sam-gov';
import nodemailer from 'nodemailer';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.SMTP_USER || 'hello@govconedu.com',
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
  target_agencies: string[];
  location_state: string | null;
  alert_frequency: string;
  is_active: boolean;
}

/**
 * POST /api/cron/weekly-alerts
 * Send weekly opportunity alerts to MA Premium users
 * Runs every Sunday at 6 PM ET (11 PM UTC)
 */
export async function POST(request: NextRequest) {
  try {
    // Verify cron secret (Vercel sends this)
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      // Allow without secret in development
      if (process.env.NODE_ENV === 'production') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    console.log('[Weekly Alerts] Starting weekly alert job...');

    // Get all active alert users
    const { data: users, error: usersError } = await supabase
      .from('user_alert_settings')
      .select('*')
      .eq('is_active', true)
      .eq('alert_frequency', 'weekly');

    if (usersError) {
      console.error('[Weekly Alerts] Error fetching users:', usersError);
      return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
    }

    if (!users || users.length === 0) {
      console.log('[Weekly Alerts] No active alert users found');
      return NextResponse.json({ success: true, message: 'No users to process', sent: 0 });
    }

    console.log(`[Weekly Alerts] Processing ${users.length} users...`);

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

    // Process each user
    for (const user of users as AlertUser[]) {
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
            agencies: user.target_agencies || [],
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

        // Log the alert
        await supabase.from('alert_log').upsert({
          user_email: user.user_email,
          alert_date: new Date().toISOString().split('T')[0],
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
          onConflict: 'user_email,alert_date',
        });

        // Update user's alert stats
        await supabase
          .from('user_alert_settings')
          .update({
            last_alert_sent: new Date().toISOString(),
            last_alert_count: topOpps.length,
            total_alerts_sent: (user as any).total_alerts_sent + 1 || 1,
          })
          .eq('user_email', user.user_email);

        console.log(`[Weekly Alerts] Sent ${topOpps.length} opportunities to ${user.user_email}`);
        results.sent++;

      } catch (userError: any) {
        console.error(`[Weekly Alerts] Error processing ${user.user_email}:`, userError);
        results.failed++;
        results.errors.push(`${user.user_email}: ${userError.message}`);
      }
    }

    console.log(`[Weekly Alerts] Complete. Sent: ${results.sent}, Skipped: ${results.skipped}, Failed: ${results.failed}`);

    return NextResponse.json({
      success: true,
      results,
    });
  } catch (error: any) {
    console.error('[Weekly Alerts] Error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

/**
 * GET endpoint for manual testing
 */
export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email');

  if (!email) {
    return NextResponse.json({
      message: 'Weekly Alerts Cron Job',
      usage: 'POST to run, or GET ?email=xxx to test for specific user',
    });
  }

  // Test mode for specific user
  const { data: user } = await supabase
    .from('user_alert_settings')
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
      agencies: user.target_agencies,
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
  const preferencesUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://shop.govcongiants.org'}/alerts/preferences?email=${encodeURIComponent(email)}`;
  const briefingsUpgradeUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://shop.govcongiants.org'}/briefings`;
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
        Upgrade to Daily Briefings - $19/mo
      </a>
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
