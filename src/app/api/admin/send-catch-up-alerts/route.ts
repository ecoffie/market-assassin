import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchSamOpportunities, scoreOpportunity, SAMOpportunity } from '@/lib/briefings/pipelines/sam-gov';
import nodemailer from 'nodemailer';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

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

interface AlertUser {
  user_email: string;
  naics_codes: string[];
  business_type: string | null;
  target_agencies: string[];
  location_state: string | null;
  alert_frequency: string;
  is_active: boolean;
  last_alert_sent: string | null;
}

/**
 * GET /api/admin/send-catch-up-alerts?password=xxx
 * Send alerts to users who have NEVER received one (last_alert_sent is null)
 *
 * Modes:
 * - preview: shows who would get alerts (default)
 * - execute: actually sends the alerts
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const mode = searchParams.get('mode') || 'preview';

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Get users who have NEVER received an alert
  const { data: users, error: usersError } = await supabase
    .from('user_alert_settings')
    .select('*')
    .eq('is_active', true)
    .is('last_alert_sent', null);

  if (usersError) {
    return NextResponse.json({ error: 'Failed to fetch users', details: usersError.message }, { status: 500 });
  }

  if (!users || users.length === 0) {
    return NextResponse.json({
      success: true,
      message: 'No users need catch-up alerts - everyone has received at least one!',
      users_needing_alerts: 0,
    });
  }

  if (mode === 'preview') {
    return NextResponse.json({
      mode: 'preview',
      users_needing_alerts: users.length,
      users: users.map(u => ({
        email: u.user_email,
        naics_count: u.naics_codes?.length || 0,
        business_type: u.business_type,
      })),
      instructions: 'Add ?mode=execute to send alerts to these users',
    });
  }

  // Execute mode - send alerts
  const samApiKey = process.env.SAM_API_KEY;
  if (!samApiKey) {
    return NextResponse.json({ error: 'SAM_API_KEY not configured' }, { status: 500 });
  }

  const results = {
    sent: 0,
    skipped: 0,
    failed: 0,
    errors: [] as string[],
    sent_to: [] as string[],
  };

  for (const user of users as AlertUser[]) {
    try {
      // Build search params
      const setAsides = user.business_type
        ? [businessTypeToSetAside[user.business_type] || user.business_type]
        : [];

      // Fetch opportunities from SAM.gov
      const searchResult = await fetchSamOpportunities({
        naicsCodes: user.naics_codes || [],
        setAsides,
        state: user.location_state || undefined,
        noticeTypes: ['p', 'r', 'k', 'o'],
        postedFrom: getDateDaysAgo(7),
        limit: 50,
      }, samApiKey);

      const opportunities = searchResult.opportunities;

      // Score and rank
      const scoredOpps = opportunities.map(opp => ({
        ...opp,
        score: scoreOpportunity(opp, {
          naics_codes: user.naics_codes || [],
          agencies: user.target_agencies || [],
          keywords: [],
        }),
      })).sort((a, b) => b.score - a.score);

      // Give new users the pro tier (15 opps) as a welcome
      const topOpps = scoredOpps.slice(0, 15);

      if (topOpps.length === 0) {
        console.log(`[Catch-up] No opportunities for ${user.user_email} (NAICS: ${user.naics_codes?.slice(0,3).join(', ')})`);
        // Still send a welcome email with instructions on how to update preferences
        await sendWelcomeOnlyEmail(user.user_email, user);

        // Mark as sent so they don't get another catch-up
        await supabase
          .from('user_alert_settings')
          .update({
            last_alert_sent: new Date().toISOString(),
            last_alert_count: 0,
            total_alerts_sent: 1,
          })
          .eq('user_email', user.user_email);

        results.sent++;
        results.sent_to.push(user.user_email + ' (welcome only)');
        await new Promise(r => setTimeout(r, 500));
        continue;
      }

      // Send email
      await sendCatchUpEmail(user.user_email, topOpps, user, scoredOpps.length);

      // Log and update
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

      await supabase
        .from('user_alert_settings')
        .update({
          last_alert_sent: new Date().toISOString(),
          last_alert_count: topOpps.length,
          total_alerts_sent: 1,
        })
        .eq('user_email', user.user_email);

      results.sent++;
      results.sent_to.push(user.user_email);
      console.log(`[Catch-up] Sent ${topOpps.length} opportunities to ${user.user_email}`);

      // Small delay to avoid rate limits
      await new Promise(r => setTimeout(r, 500));

    } catch (err: any) {
      console.error(`[Catch-up] Error for ${user.user_email}:`, err);
      results.failed++;
      results.errors.push(`${user.user_email}: ${err.message}`);
    }
  }

  return NextResponse.json({
    mode: 'execute',
    results,
  });
}

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
  const today = new Date();
  const diff = target.getTime() - today.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

async function sendWelcomeOnlyEmail(email: string, user: AlertUser) {
  const preferencesUrl = `https://shop.govcongiants.org/alerts/preferences?email=${encodeURIComponent(email)}`;
  const unsubscribeUrl = `https://shop.govcongiants.org/alerts/unsubscribe?email=${encodeURIComponent(email)}`;
  const maUrl = 'https://tools.govcongiants.org/market-assassin';

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 650px; margin: 0 auto; padding: 20px; background: #f3f4f6;">
  <div style="background: linear-gradient(135deg, #1e3a8a 0%, #7c3aed 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">🎯 Welcome to Market Assassin Alerts!</h1>
    <p style="color: #c4b5fd; margin: 8px 0 0 0; font-size: 16px;">Let's get your profile set up</p>
  </div>

  <div style="background: #ffffff; padding: 25px; border: 1px solid #e5e7eb; border-top: none;">
    <p style="margin: 0 0 20px 0; font-size: 16px;">
      You're now signed up for weekly opportunity alerts! However, we need your specific NAICS codes to find relevant opportunities.
    </p>

    <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
      <p style="margin: 0; color: #92400e; font-size: 14px;">
        <strong>⚠️ Action Needed:</strong> Your current filters are set to general defaults. Update them to get personalized opportunities!
      </p>
    </div>

    <div style="background: #eff6ff; border: 1px solid #93c5fd; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
      <h3 style="margin: 0 0 12px 0; color: #1e40af; font-size: 16px;">⚙️ Two Ways to Update Your Preferences</h3>
      <ol style="margin: 0; padding-left: 20px; color: #1e3a8a; font-size: 14px;">
        <li style="margin-bottom: 12px;">
          <strong>Automatic (Recommended):</strong><br>
          <a href="${maUrl}" style="color: #2563eb; font-weight: 600;">Run a Market Assassin report</a> with your specific NAICS codes. Your alert preferences will auto-update!
        </li>
        <li style="margin-bottom: 8px;">
          <strong>Manual:</strong><br>
          <a href="${preferencesUrl}" style="color: #2563eb; font-weight: 600;">Click here to manage your preferences</a> and set your exact NAICS codes, set-aside type, and location.
        </li>
      </ol>
    </div>

    <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 16px;">
      <p style="margin: 0; color: #166534; font-size: 14px;">
        <strong>💡 Pro Tip:</strong> Use your primary 6-digit NAICS code for the best matches. For example: "541511" (Custom Software) is better than just "541" (Professional Services).
      </p>
    </div>
  </div>

  <div style="background: #f8fafc; padding: 20px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px; text-align: center;">
    <p style="color: #6b7280; font-size: 12px; margin: 0;">
      <a href="${preferencesUrl}" style="color: #1e40af; font-weight: 600;">Manage Preferences</a> &nbsp;|&nbsp;
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
    from: `"GovCon Giants" <${process.env.SMTP_USER || 'alerts@govcongiants.com'}>`,
    to: email,
    subject: `🎯 Welcome to Market Assassin Alerts - Set Up Your Preferences`,
    html: htmlContent,
  });
}

async function sendCatchUpEmail(
  email: string,
  opportunities: (SAMOpportunity & { score: number })[],
  user: AlertUser,
  totalAvailable: number
) {
  const unsubscribeUrl = `https://shop.govcongiants.org/alerts/unsubscribe?email=${encodeURIComponent(email)}`;
  const preferencesUrl = `https://shop.govcongiants.org/alerts/preferences?email=${encodeURIComponent(email)}`;

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
    <h1 style="color: white; margin: 0; font-size: 24px;">🎯 Welcome to Market Assassin Alerts!</h1>
    <p style="color: #c4b5fd; margin: 8px 0 0 0; font-size: 16px;">Your first weekly opportunity digest</p>
  </div>

  <div style="background: #ffffff; padding: 25px; border: 1px solid #e5e7eb; border-top: none;">
    <p style="margin: 0 0 20px 0; font-size: 16px;">
      Welcome! You're now receiving weekly opportunity alerts. Here are <strong>${opportunities.length} opportunities</strong> that match your profile:
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

    <!-- How to Update Preferences -->
    <div style="background: #eff6ff; border: 1px solid #93c5fd; border-radius: 8px; padding: 20px; margin-top: 20px;">
      <h3 style="margin: 0 0 12px 0; color: #1e40af; font-size: 16px;">⚙️ How to Update Your Alert Preferences</h3>
      <p style="margin: 0 0 12px 0; color: #1e3a8a; font-size: 14px;">
        Getting opportunities that don't match your business? Here's how to fix it:
      </p>
      <ol style="margin: 0; padding-left: 20px; color: #1e3a8a; font-size: 14px;">
        <li style="margin-bottom: 8px;"><strong>Automatic:</strong> Run a Market Assassin report with your specific NAICS codes — your alert preferences will auto-update!</li>
        <li style="margin-bottom: 8px;"><strong>Manual:</strong> <a href="${preferencesUrl}" style="color: #2563eb; font-weight: 600;">Click here to manage your preferences</a> and set your exact NAICS codes, set-aside type, and location.</li>
      </ol>
    </div>

    <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 16px; margin-top: 16px;">
      <p style="margin: 0; color: #166534; font-size: 14px;">
        <strong>💡 Pro Tip:</strong> The more specific your NAICS codes, the better your matches. Use your primary 6-digit NAICS instead of broad categories!
      </p>
    </div>
  </div>

  <div style="background: #f8fafc; padding: 20px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px; text-align: center;">
    <p style="color: #6b7280; font-size: 12px; margin: 0;">
      <a href="${preferencesUrl}" style="color: #1e40af; font-weight: 600;">Manage Preferences</a> &nbsp;|&nbsp;
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
    from: `"GovCon Giants" <${process.env.SMTP_USER || 'alerts@govcongiants.com'}>`,
    to: email,
    subject: `🎯 Welcome! ${opportunities.length} Opportunities Match Your Profile`,
    html: htmlContent,
  });
}
