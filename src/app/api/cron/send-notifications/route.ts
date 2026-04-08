/**
 * Daily Alerts Notifications Cron
 *
 * Sends daily alert emails only:
 * - Sends alerts if alerts_enabled (SAM.gov opportunities)
 *
 * Briefings are owned by `/api/cron/send-briefings` and must not be sent here,
 * otherwise briefing_log and delivery telemetry become ambiguous.
 *
 * Schedule: 13/15/17/19 UTC daily (timezone coverage)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchSamOpportunities, scoreOpportunity, SAMOpportunity } from '@/lib/briefings/pipelines/sam-gov';
import { expandNAICSCodes } from '@/lib/utils/naics-expansion';
import { expandStateForSearch } from '@/lib/utils/state-expansion';
import nodemailer from 'nodemailer';
import { createSecureAccessUrl } from '@/lib/access-links';

// Lazy initialization
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

// Fallback NAICS if user has none
const FALLBACK_NAICS = ['541512', '541611', '541330', '541990', '561210'];

// Business type to SAM.gov set-aside mapping
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

interface NotificationUser {
  user_email: string;
  naics_codes: string[];
  keywords: string[] | null;
  business_type: string | null;
  agencies: string[];
  location_state: string | null; // State code for place of performance filter (e.g., 'FL', 'VA')
  alerts_enabled: boolean;
  alert_frequency: string;
  is_active: boolean;
  timezone?: string;
  last_alert_sent?: string;
  total_alerts_sent?: number;
}

interface FetchedData {
  opportunities: (SAMOpportunity & { score: number })[];
}

/**
 * Fetch alert data for a user.
 */
async function fetchDataForUser(
  user: NotificationUser,
  samApiKey: string
): Promise<FetchedData> {
  const userNaics = user.naics_codes?.length > 0 ? user.naics_codes : FALLBACK_NAICS;
  const expandedNaics = expandNAICSCodes(userNaics);
  const userKeywords = user.keywords || [];
  const setAsides = user.business_type
    ? [businessTypeToSetAside[user.business_type] || user.business_type]
    : [];

  // Smart state expansion: automatically include border states for better coverage
  // 'borders' = selected state + all adjacent states + DC
  const expandedStates = expandStateForSearch(user.location_state, 'borders');
  if (expandedStates) {
    console.log(`[Notifications] State expansion for ${user.user_email}: ${user.location_state} → ${expandedStates.join(', ')}`);
  }

  const opportunitiesResult = user.alerts_enabled
    ? await fetchSamOpportunities({
        naicsCodes: expandedNaics,
        keywords: userKeywords.length > 0 ? userKeywords : undefined,
        setAsides,
        noticeTypes: ['p', 'r', 'k', 'o', 's', 'i'],
        states: expandedStates || undefined,
        postedFrom: getDateDaysAgo(7),
        limit: 100,
      }, samApiKey).catch(err => {
        console.error(`[Notifications] SAM.gov fetch failed for ${user.user_email}:`, err.message);
        return { opportunities: [] };
      })
    : { opportunities: [] };

  // Score opportunities
  const scoredOpportunities = opportunitiesResult.opportunities.map(opp => ({
    ...opp,
    score: scoreOpportunity(opp, {
      naics_codes: userNaics,
      agencies: user.agencies || [],
      keywords: userKeywords,
    }),
  })).sort((a, b) => b.score - a.score);

  return {
    opportunities: scoredOpportunities,
  };
}

/**
 * Get recently sent opportunity IDs (for deduplication)
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
 * Send daily alert email (opportunities)
 */
async function sendAlertEmail(
  email: string,
  opportunities: (SAMOpportunity & { score: number })[]
): Promise<void> {
  const preferencesUrl = await createSecureAccessUrl(email, 'preferences');
  const unsubscribeUrl = `https://tools.govcongiants.org/api/alerts/unsubscribe?email=${encodeURIComponent(email)}`;

  const opportunitiesHtml = opportunities.slice(0, 15).map((opp, i) => {
    const daysUntil = getDaysUntil(opp.responseDeadline);
    const urgencyColor = daysUntil <= 7 ? '#dc2626' : daysUntil <= 14 ? '#d97706' : '#16a34a';
    const scoreColor = opp.score >= 75 ? '#16a34a' : opp.score >= 50 ? '#84cc16' : '#eab308';

    return `
      <tr>
        <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb;">
          <div style="margin-bottom: 4px;">
            <span style="background: #dbeafe; color: #1e40af; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600;">${opp.noticeType || 'Solicitation'}</span>
            ${opp.setAside ? `<span style="background: #dcfce7; color: #166534; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; margin-left: 4px;">${opp.setAside}</span>` : ''}
            <span style="background: ${scoreColor}20; color: ${scoreColor}; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; margin-left: 4px;">${opp.score}%</span>
          </div>
          <a href="${opp.uiLink}" style="color: #1e40af; font-weight: 600; text-decoration: none; font-size: 13px;">
            ${i + 1}. ${opp.title.slice(0, 80)}${opp.title.length > 80 ? '...' : ''}
          </a>
          <div style="color: #6b7280; font-size: 11px; margin-top: 4px;">
            ${opp.department} • NAICS ${opp.naicsCode || 'N/A'} • <span style="color: ${urgencyColor};">Due ${formatDate(opp.responseDeadline)}</span>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  const htmlContent = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f8fafc;">
  <div style="background: linear-gradient(135deg, #7c3aed 0%, #a855f7 100%); padding: 8px 16px; text-align: center; border-radius: 8px 8px 0 0;">
    <p style="color: white; margin: 0; font-size: 11px; font-weight: 600;">🎁 FREE PREVIEW • Daily Alerts free during beta</p>
  </div>

  <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 24px; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 20px;">🎯 ${opportunities.length} New Opportunities</h1>
    <p style="color: #94a3b8; margin: 4px 0 0 0; font-size: 13px;">${formatDate(new Date().toISOString())}</p>
  </div>

  <div style="background: white; border: 1px solid #e2e8f0;">
    <table style="width: 100%; border-collapse: collapse;">
      ${opportunitiesHtml}
    </table>
    ${opportunities.length > 15 ? `<div style="padding: 12px; background: #f8fafc; text-align: center; font-size: 12px; color: #64748b;">+ ${opportunities.length - 15} more matches</div>` : ''}
  </div>

  <div style="background: #f1f5f9; padding: 16px; border-radius: 0 0 8px 8px; text-align: center;">
    <p style="color: #64748b; font-size: 11px; margin: 0;">
      <a href="${preferencesUrl}" style="color: #475569;">Preferences</a> • <a href="${unsubscribeUrl}" style="color: #475569;">Unsubscribe</a>
    </p>
  </div>
</body>
</html>`;

  await getTransporter().sendMail({
    from: `"GovCon Giants" <${process.env.SMTP_USER || 'alerts@govcongiants.com'}>`,
    to: email,
    subject: `🎯 ${opportunities.length} New Opportunities - ${formatDate(new Date().toISOString())}`,
    html: htmlContent,
  });
}

/**
 * Main notification job
 */
async function runNotificationJob(options?: {
  testEmail?: string;
  skipTimezoneCheck?: boolean;
}): Promise<NextResponse> {
  const startTime = Date.now();
  console.log('[Notifications] Starting unified notification job...');

  const samApiKey = process.env.SAM_API_KEY;
  if (!samApiKey) {
    return NextResponse.json({ error: 'SAM API key not configured' }, { status: 500 });
  }

  // Build query
  let query = getSupabase()
    .from('user_notification_settings')
    .select('*')
    .eq('is_active', true)
    .eq('alerts_enabled', true);

  if (options?.testEmail) {
    query = query.eq('user_email', options.testEmail);
  }

  const { data: users, error: usersError } = await query.limit(200);

  if (usersError) {
    console.error('[Notifications] Error fetching users:', usersError);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }

  if (!users || users.length === 0) {
    return NextResponse.json({ success: true, message: 'No users to process', elapsed: Date.now() - startTime });
  }

  console.log(`[Notifications] Processing ${users.length} users...`);

  const results = {
    processed: 0,
    alertsSent: 0,
    skipped: 0,
    failed: 0,
    errors: [] as string[],
    debug: [] as { email: string; oppsFound: number; newOpps: number }[],
  };

  for (const user of users as NotificationUser[]) {
    try {
      results.processed++;
      const needsAlert = user.alerts_enabled && user.alert_frequency === 'daily';

      if (!needsAlert) {
        results.skipped++;
        continue;
      }

      console.log(`[Notifications] Fetching data for ${user.user_email}...`);
      const data = await fetchDataForUser(user, samApiKey);

      const debugInfo = {
        email: user.user_email,
        oppsFound: data.opportunities.length,
        newOpps: 0,
      };

      // Send ALERT if enabled
      if (needsAlert && data.opportunities.length > 0) {
        // Deduplicate
        const recentlySent = await getRecentlySentOpportunityIds(user.user_email);
        const newOpps = data.opportunities.filter(o => !recentlySent.has(o.noticeId));
        debugInfo.newOpps = newOpps.length;

        if (newOpps.length > 0) {
          try {
            await sendAlertEmail(user.user_email, newOpps);

            // Log alert
            await getSupabase().from('alert_log').upsert({
              user_email: user.user_email,
              alert_date: new Date().toISOString().split('T')[0],
              opportunities_count: newOpps.length,
              opportunities_data: newOpps.slice(0, 20).map(o => ({
                noticeId: o.noticeId,
                title: o.title,
                agency: o.department,
                naics: o.naicsCode,
                deadline: o.responseDeadline,
                score: o.score,
              })),
              sent_at: new Date().toISOString(),
              delivery_status: 'sent',
            }, { onConflict: 'user_email,alert_date' });

            // Update stats
            await getSupabase()
              .from('user_notification_settings')
              .update({
                last_alert_sent: new Date().toISOString(),
                total_alerts_sent: (user.total_alerts_sent || 0) + 1,
              })
              .eq('user_email', user.user_email);

            results.alertsSent++;
            console.log(`[Notifications] ✅ Alert sent to ${user.user_email} (${newOpps.length} opps)`);
          } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            console.error(`[Notifications] Alert failed for ${user.user_email}:`, errorMessage);
            results.errors.push(`Alert ${user.user_email}: ${errorMessage}`);
          }
        }
      }

      results.debug.push(debugInfo);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[Notifications] Error processing ${user.user_email}:`, errorMessage);
      results.failed++;
      results.errors.push(`${user.user_email}: ${errorMessage}`);
    }
  }

  const elapsed = Date.now() - startTime;
  console.log(`[Notifications] Complete in ${elapsed}ms. Alerts: ${results.alertsSent}, Failed: ${results.failed}`);

  return NextResponse.json({
    success: true,
    elapsed,
    results,
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

/**
 * GET - Vercel cron trigger
 */
export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email');
  const test = request.nextUrl.searchParams.get('test') === 'true';

  if (email && test) {
    return runNotificationJob({ testEmail: email, skipTimezoneCheck: true });
  }

  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const authHeader = request.headers.get('authorization');
  const hasCronSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;

  if (isVercelCron || hasCronSecret) {
    return runNotificationJob();
  }

  return NextResponse.json({
    message: 'Unified Notifications Cron',
    description: 'Sends daily alerts only. Briefings are handled by /api/cron/send-briefings.',
    usage: {
      test: 'GET ?email=xxx&test=true',
      manual: 'POST with Authorization: Bearer {CRON_SECRET}',
    },
    features: [
      'Alerts: SAM.gov opportunities',
      'Respects alerts_enabled preferences',
      'Timezone-aware coverage via multiple cron runs',
      'Deduplication for recent alerts',
    ],
  });
}

/**
 * POST - Manual trigger
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  return runNotificationJob({
    testEmail: body.testEmail,
    skipTimezoneCheck: body.skipTimezoneCheck,
  });
}
