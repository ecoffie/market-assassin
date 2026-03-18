/**
 * Admin: Manually trigger weekly SAM alerts
 *
 * GET /api/admin/trigger-alerts?password=...&mode=preview
 * GET /api/admin/trigger-alerts?password=...&mode=execute
 * GET /api/admin/trigger-alerts?password=...&mode=execute&limit=5  (test with 5 users)
 * GET /api/admin/trigger-alerts?password=...&mode=execute&email=test@example.com (single user)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchSamOpportunities, scoreOpportunity } from '@/lib/briefings/pipelines/sam-gov';
import { expandNAICSCodes } from '@/lib/utils/naics-expansion';
import nodemailer from 'nodemailer';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';
const SHOP_ADMIN_PASSWORD = 'admin123';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.office365.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER || 'alerts@govcongiants.com',
    pass: process.env.SMTP_PASSWORD,
  },
});

// Alert tier limits
const ALERT_LIMITS = { free: 5, pro: 15 };

// Products that grant Pro tier
const PRO_TIER_PRODUCTS = [
  'opportunity-hunter-pro', 'market-assassin-standard', 'market-assassin-premium',
  'ultimate-govcon-bundle', 'contractor-database', 'recompete-contracts',
  'ai-content-generator', 'starter-govcon-bundle', 'pro-giant-bundle',
];

// Business type to SAM set-aside mapping
const businessTypeToSetAside: Record<string, string> = {
  'SDVOSB': 'SDVOSBC', 'VOSB': 'VSB', '8a': '8A', '8(a)': '8A',
  'WOSB': 'WOSB', 'EDWOSB': 'EDWOSB', 'HUBZone': 'HZC', 'SBA': 'SBA', 'Small Business': 'SBP',
};

interface AlertUser {
  user_email: string;
  naics_codes: string[] | null;
  business_type: string | null;
  target_agencies: string[];
  location_state: string | null;
  is_active: boolean;
}

let buyerEmailsCache: Set<string> | null = null;

async function fetchBuyerEmails(): Promise<Set<string>> {
  if (buyerEmailsCache) return buyerEmailsCache;
  try {
    const res = await fetch('https://shop.govcongiants.org/api/admin/purchases-report?days=365', {
      headers: { 'x-admin-password': SHOP_ADMIN_PASSWORD },
    });
    if (!res.ok) return new Set();
    const data = await res.json();
    const proEmails = new Set<string>();
    for (const p of data.purchases || []) {
      const productId = (p.productId || '').toLowerCase();
      if (PRO_TIER_PRODUCTS.some(tier => productId.includes(tier))) {
        proEmails.add(p.email.toLowerCase());
      }
    }
    buyerEmailsCache = proEmails;
    return proEmails;
  } catch {
    return new Set();
  }
}

// SAM.gov API requires MM/dd/yyyy format
function getDateDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = date.getFullYear();
  return `${month}/${day}/${year}`;
}

function formatDate(dateString: string): string {
  if (!dateString) return 'N/A';
  try {
    return new Date(dateString).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return dateString; }
}

function getDaysUntil(dateString: string): number {
  if (!dateString) return 999;
  const target = new Date(dateString);
  const diff = target.getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const mode = searchParams.get('mode') || 'preview';
  const limit = parseInt(searchParams.get('limit') || '999');
  const singleEmail = searchParams.get('email');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Get all active alert users
  let query = supabase.from('user_alert_settings').select('*').eq('is_active', true);

  if (singleEmail) {
    query = query.eq('user_email', singleEmail.toLowerCase());
  }

  const { data: users, error: usersError } = await query.limit(limit);

  if (usersError) {
    return NextResponse.json({ error: usersError.message }, { status: 500 });
  }

  if (!users || users.length === 0) {
    return NextResponse.json({
      error: 'No active alert users found',
      hint: 'Run /api/admin/seed-alerts first to enroll buyers',
    });
  }

  // Load buyer emails for tier determination
  buyerEmailsCache = null;
  const buyerEmails = await fetchBuyerEmails();

  if (mode === 'preview') {
    const preview = users.map((u: AlertUser) => {
      const isPro = buyerEmails.has(u.user_email.toLowerCase());
      return {
        email: u.user_email,
        tier: isPro ? 'pro' : 'free',
        limit: isPro ? ALERT_LIMITS.pro : ALERT_LIMITS.free,
        naics_count: u.naics_codes?.length || 0,
        business_type: u.business_type,
      };
    });

    return NextResponse.json({
      mode: 'preview',
      total_users: users.length,
      pro_users: preview.filter(p => p.tier === 'pro').length,
      free_users: preview.filter(p => p.tier === 'free').length,
      users: preview,
      instructions: 'Add ?mode=execute to send alerts',
    });
  }

  // Execute mode - send alerts
  const samApiKey = process.env.SAM_API_KEY;
  if (!samApiKey) {
    return NextResponse.json({ error: 'SAM_API_KEY not configured' }, { status: 500 });
  }

  const results = {
    sent: [] as { email: string; opps: number; tier: string }[],
    skipped: [] as { email: string; reason: string }[],
    failed: [] as { email: string; error: string }[],
  };

  for (const user of users as AlertUser[]) {
    try {
      const isPro = buyerEmails.has(user.user_email.toLowerCase());
      const alertLimit = isPro ? ALERT_LIMITS.pro : ALERT_LIMITS.free;
      const tier = isPro ? 'pro' : 'free';

      // Get NAICS codes - try user_alert_settings first, then fall back to smart_user_profiles
      let userNaics = user.naics_codes || [];

      if (userNaics.length === 0) {
        // Fall back to smart_user_profiles
        const { data: smartProfile } = await supabase
          .from('smart_user_profiles')
          .select('naics_codes')
          .eq('email', user.user_email.toLowerCase())
          .single();

        if (smartProfile?.naics_codes && smartProfile.naics_codes.length > 0) {
          userNaics = smartProfile.naics_codes;
          console.log(`[Alerts] Using smart profile NAICS for ${user.user_email}: ${userNaics.join(', ')}`);
        }
      }

      // Skip if still no NAICS codes
      if (userNaics.length === 0) {
        results.skipped.push({ email: user.user_email, reason: 'No NAICS codes configured' });
        continue;
      }

      // EXPAND NAICS codes to include related codes (e.g., 541 → all 541xxx)
      // This gives users broader matches while keeping their core industry focus
      const expandedNaics = expandNAICSCodes(userNaics);
      console.log(`[Alerts] ${user.user_email}: Original ${userNaics.length} codes → Expanded ${expandedNaics.length} codes`);

      const setAsides = user.business_type
        ? [businessTypeToSetAside[user.business_type] || user.business_type]
        : [];

      // Fetch opportunities from SAM.gov with EXPANDED NAICS
      // Note: Don't filter by state - too restrictive, reduces matches significantly
      // Users can still see their location but we search nationwide for their NAICS
      const searchResult = await fetchSamOpportunities({
        naicsCodes: expandedNaics,
        setAsides,
        // state: user.location_state || undefined, // Disabled - too restrictive
        noticeTypes: ['p', 'r', 'k', 'o'],
        postedFrom: getDateDaysAgo(7),
        limit: 50,
      }, samApiKey);

      const opportunities = searchResult.opportunities;

      if (opportunities.length === 0) {
        results.skipped.push({ email: user.user_email, reason: 'No opportunities found' });
        continue;
      }

      // Score and rank - use ORIGINAL naics codes for scoring (core industry focus scores higher)
      const scoredOpps = opportunities.map(opp => ({
        ...opp,
        score: scoreOpportunity(opp, {
          naics_codes: userNaics, // Original codes, not expanded - so exact matches score higher
          agencies: user.target_agencies || [],
          keywords: [],
        }),
      })).sort((a, b) => b.score - a.score);

      const topOpps = scoredOpps.slice(0, alertLimit);
      const totalAvailable = scoredOpps.length;

      // Send email
      await sendAlertEmail(user.user_email, topOpps, user, tier, totalAvailable);

      // Log the alert
      await supabase.from('alert_log').upsert({
        user_email: user.user_email,
        alert_date: new Date().toISOString().split('T')[0],
        opportunities_count: topOpps.length,
        sent_at: new Date().toISOString(),
        delivery_status: 'sent',
      }, { onConflict: 'user_email,alert_date' });

      // Update user stats
      await supabase.from('user_alert_settings').update({
        last_alert_sent: new Date().toISOString(),
        last_alert_count: topOpps.length,
        total_alerts_sent: (user as any).total_alerts_sent + 1 || 1,
      }).eq('user_email', user.user_email);

      results.sent.push({ email: user.user_email, opps: topOpps.length, tier });

    } catch (err) {
      results.failed.push({
        email: user.user_email,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return NextResponse.json({
    mode: 'execute',
    sent: results.sent.length,
    skipped: results.skipped.length,
    failed: results.failed.length,
    details: results,
  });
}

async function sendAlertEmail(
  email: string,
  opportunities: any[],
  user: AlertUser,
  tier: string,
  totalAvailable: number
) {
  const unsubscribeUrl = `https://tools.govcongiants.org/alerts/unsubscribe?email=${encodeURIComponent(email)}`;
  const preferencesUrl = `https://tools.govcongiants.org/alerts/preferences?email=${encodeURIComponent(email)}`;
  const ohProUpgradeUrl = 'https://buy.stripe.com/7sIaGqevYeIcdri147';

  const showUpgrade = tier === 'free' && totalAvailable > 5;

  const opportunitiesHtml = opportunities.map((opp, i) => {
    const daysUntil = getDaysUntil(opp.responseDeadline);
    const urgencyColor = daysUntil <= 7 ? '#dc2626' : daysUntil <= 14 ? '#d97706' : '#16a34a';
    const urgencyText = daysUntil <= 7 ? 'Due Soon!' : daysUntil <= 14 ? '2 weeks' : '';

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
            ${i + 1}. ${(opp.title || '').slice(0, 100)}${(opp.title || '').length > 100 ? '...' : ''}
          </a>
          <div style="color: #6b7280; font-size: 13px; margin-top: 6px;">
            <strong>Agency:</strong> ${opp.department || 'N/A'}<br>
            <strong>NAICS:</strong> ${opp.naicsCode || 'N/A'} &nbsp;|&nbsp;
            <strong style="color: ${urgencyColor};">Due:</strong> <span style="color: ${urgencyColor};">${formatDate(opp.responseDeadline)}</span>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  const upgradeSection = showUpgrade ? `
    <div style="background: linear-gradient(135deg, #059669 0%, #10b981 100%); border-radius: 10px; padding: 24px; margin-top: 25px; text-align: center;">
      <h3 style="color: white; margin: 0 0 10px 0; font-size: 18px;">You're Missing ${totalAvailable - 5} More Opportunities!</h3>
      <p style="color: #d1fae5; margin: 0 0 16px 0; font-size: 14px;">
        Upgrade to Pro for <strong>15 opps/week</strong> instead of 5.
      </p>
      <a href="${ohProUpgradeUrl}" style="background: white; color: #059669; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
        Upgrade to Pro - $49
      </a>
    </div>
  ` : '';

  const htmlContent = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 650px; margin: 0 auto; padding: 20px; background: #f3f4f6;">
  <div style="background: linear-gradient(135deg, #1e3a8a 0%, #7c3aed 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">GovCon Giants</h1>
    <p style="color: #c4b5fd; margin: 8px 0 0 0; font-size: 16px;">Weekly SAM.gov Opportunities</p>
  </div>

  <div style="background: #ffffff; padding: 25px; border: 1px solid #e5e7eb; border-top: none;">
    <p style="margin: 0 0 20px 0; font-size: 16px;">
      <strong>${opportunities.length} opportunities</strong> matched your profile this week:
    </p>

    <table style="width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; border: 1px solid #e5e7eb;">
      ${opportunitiesHtml}
    </table>

    ${upgradeSection}
  </div>

  <div style="background: #f8fafc; padding: 20px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px; text-align: center;">
    <p style="color: #6b7280; font-size: 12px; margin: 0;">
      <a href="${preferencesUrl}" style="color: #1e40af;">Manage Preferences</a>
      &nbsp;|&nbsp;
      <a href="${unsubscribeUrl}" style="color: #6b7280;">Unsubscribe</a>
    </p>
    <p style="color: #9ca3af; font-size: 11px; margin: 10px 0 0 0;">
      &copy; ${new Date().getFullYear()} GovCon Giants | tools.govcongiants.org
    </p>
  </div>
</body>
</html>
`;

  await transporter.sendMail({
    from: `"GovCon Giants" <${process.env.SMTP_USER || 'hello@govconedu.com'}>`,
    to: email,
    subject: `${opportunities.length} New SAM.gov Opportunities - Week of ${formatDate(new Date().toISOString())}`,
    html: htmlContent,
  });
}
