/**
 * Send Weekly Deep Dive (Fast) - Uses Pre-computed Templates
 *
 * ENTERPRISE ARCHITECTURE: Matches users to pre-computed weekly templates.
 * Processing time per user: ~100ms (vs 52+ seconds with generation)
 *
 * Schedule: Sunday 7 AM UTC (after precompute-weekly-briefings completes)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/send-email';
import {
  recordBriefingProgramDelivery,
  resolveBriefingAudience,
} from '@/lib/briefings/delivery/rollout';
import crypto from 'crypto';

const BATCH_SIZE = 200; // Increased for better coverage
const BRAND_COLOR = '#1e3a8a';

// Type for briefing templates from Supabase
type BriefingTemplate = { naics_profile_hash: string; naics_profile: string; [key: string]: unknown };

/**
 * Queue a failed briefing for automatic retry (dead letter queue)
 */
async function queueForRetry(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userEmail: string,
  naicsCodes: string[],
  failureReason: string,
  briefingDate: string
): Promise<void> {
  try {
    await supabase.rpc('queue_briefing_retry', {
      p_user_email: userEmail,
      p_briefing_type: 'weekly',
      p_briefing_date: briefingDate,
      p_naics_codes: JSON.stringify(naicsCodes),
      p_failure_reason: failureReason,
    });
  } catch (err) {
    console.error(`[SendWeeklyFast] Failed to queue retry for ${userEmail}:`, err);
  }
}
const ACCENT_COLOR = '#7c3aed';
const SUCCESS_COLOR = '#10b981';

interface WeeklyOpportunity {
  rank: number;
  contractName: string;
  agency: string;
  incumbent: string;
  value: number;
  window: string;
  displacementAngle: string;
  keyDates: { label: string; date: string }[];
  competitiveLandscape: string[];
  recommendedApproach: string;
}

interface WeeklyTeamingPlay {
  playNumber: number;
  strategyName: string;
  targetCompany: string;
  whyTarget: string[];
  whoToContact: string[];
  suggestedOpener: string;
  followUpMessage: string;
}

interface WeeklyBriefing {
  weekOf: string;
  opportunities: WeeklyOpportunity[];
  teamingPlays: WeeklyTeamingPlay[];
  marketSignals: { headline: string; source: string; implication: string; actionRequired: boolean }[];
  calendar: { date: string; event: string; type: string; priority: string }[];
}

function hashNaicsProfile(naicsCodes: string[]): string {
  const sorted = [...naicsCodes].sort();
  return crypto.createHash('md5').update(JSON.stringify(sorted)).digest('hex');
}

/**
 * Extract NAICS prefixes for fallback matching.
 */
function extractNaicsPrefixes(naicsCodes: string[]): string[] {
  const prefixes = new Set<string>();
  for (const code of naicsCodes) {
    const clean = code.replace(/\D/g, '');
    if (clean.length >= 3) {
      prefixes.add(clean.slice(0, 3));
    }
  }
  return Array.from(prefixes);
}

/**
 * Build a prefix-to-template map for fallback matching.
 */
function buildPrefixMap(templates: Array<{ naics_profile: string; naics_profile_hash: string; [key: string]: unknown }>) {
  const prefixMap = new Map<string, typeof templates[0]>();
  for (const template of templates) {
    try {
      const naicsCodes = JSON.parse(template.naics_profile) as string[];
      const prefixes = extractNaicsPrefixes(naicsCodes);
      for (const prefix of prefixes) {
        if (!prefixMap.has(prefix)) {
          prefixMap.set(prefix, template);
        }
      }
    } catch { /* skip */ }
  }
  return prefixMap;
}

function getWeekOfDate(): string {
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0=Sunday, 6=Saturday

  // Calculate Monday of the target week
  // If running Saturday (6), we need NEXT Monday (tomorrow is Sunday, +2 to Monday)
  // If running Sunday (0), we need TODAY's Monday (+1)
  // If running any other day, use current week's Monday
  let daysToAdd: number;
  if (dayOfWeek === 6) {
    // Saturday: next Monday is in 2 days
    daysToAdd = 2;
  } else if (dayOfWeek === 0) {
    // Sunday: today's Monday is tomorrow
    daysToAdd = 1;
  } else {
    // Weekday: current week's Monday
    daysToAdd = 1 - dayOfWeek;
  }

  const monday = new Date(now);
  monday.setUTCDate(monday.getUTCDate() + daysToAdd);
  return monday.toISOString().split('T')[0];
}

function formatValue(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(0)}M`;
  return `${(value / 1_000).toFixed(0)}K`;
}

function escapeHtml(text: string): string {
  if (!text) return '';
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function GET(request: NextRequest) {
  const testEmail = request.nextUrl.searchParams.get('email');
  const isTest = request.nextUrl.searchParams.get('test') === 'true';

  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const authHeader = request.headers.get('authorization');
  const hasCronSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;

  if (!isVercelCron && !hasCronSecret && !(testEmail && isTest)) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({
        message: 'Send Weekly Deep Dive (Fast) - Uses Pre-computed Templates',
        description: 'Matches users to templates, sends in ~100ms per user',
        schedule: 'Sunday 7 AM UTC',
        capacity: '500+ users per run',
      });
    }
  }

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

  // DAY-OF-WEEK GUARD: Weekly Deep Dive only sends on Sunday (UTC)
  const today = new Date();
  const dayOfWeek = today.getUTCDay(); // 0 = Sunday
  const isTestMode = testEmail && isTest;

  if (dayOfWeek !== 0 && !isTestMode) {
    console.log(`[SendWeeklyFast] Skipped - not Sunday (day ${dayOfWeek})`);
    return NextResponse.json({
      success: true,
      message: `Weekly Deep Dive only sends on Sunday. Today is day ${dayOfWeek}.`,
      skipped: true,
      dayOfWeek,
    });
  }

  const startTime = Date.now();
  const weekOf = getWeekOfDate();
  let briefingsSent = 0;
  let briefingsSkipped = 0;
  let briefingsFailed = 0;
  let noTemplateCount = 0;
  const errors: string[] = [];
  let activeCohortId: string | null = null;

  console.log('[SendWeeklyFast] Starting fast template-based delivery...');

  try {
    // Step 1: Get all pre-computed weekly templates
    const { data: templates, error: templatesError } = await getSupabase()
      .from('briefing_templates')
      .select('*')
      .eq('template_date', weekOf)
      .eq('briefing_type', 'weekly');

    if (templatesError) {
      throw new Error(`Failed to fetch templates: ${templatesError.message}`);
    }

    if (!templates || templates.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No weekly templates found. Run precompute-weekly-briefings first.',
        elapsed: Date.now() - startTime,
      });
    }

    const templateMap = new Map<string, BriefingTemplate>();
    templates.forEach((t: BriefingTemplate) => templateMap.set(t.naics_profile_hash, t));

    // Build prefix fallback map
    const prefixMap = buildPrefixMap(templates);

    console.log(`[SendWeeklyFast] Loaded ${templates.length} weekly templates, ${prefixMap.size} prefix mappings`);

    // Step 2: Get users to process
    const audienceResolution = await resolveBriefingAudience(getSupabase());
    let usersToProcess = audienceResolution.users.filter(u => u.naics_codes.length > 0);
    activeCohortId = audienceResolution.activeCohort?.id || null;

    if (testEmail) {
      usersToProcess = usersToProcess.filter(u => u.email === testEmail.toLowerCase());
      if (usersToProcess.length === 0) {
        return NextResponse.json({
          success: false,
          error: `No user found with email: ${testEmail}`,
        });
      }
    }

    // Check for already sent this week
    const { data: sentThisWeek } = await getSupabase()
      .from('briefing_log')
      .select('user_email')
      .eq('briefing_date', weekOf)
      .contains('tools_included', ['weekly_deep_dive']);

    const sentEmails = new Set((sentThisWeek || []).map((s: { user_email: string }) => s.user_email));
    usersToProcess = usersToProcess
      .filter(u => !sentEmails.has(u.email))
      .slice(0, BATCH_SIZE);

    console.log(`[SendWeeklyFast] Processing ${usersToProcess.length} users`);

    // Step 3: Match users to templates and send
    let prefixMatchCount = 0;

    for (const user of usersToProcess) {
      try {
        const userNaics = user.naics_codes || [];
        const naicsHash = hashNaicsProfile(userNaics);
        let template = templateMap.get(naicsHash);
        let matchType = 'exact';

        // Prefix fallback: if no exact match, try matching on primary NAICS prefix
        if (!template && userNaics.length > 0) {
          const userPrefixes = extractNaicsPrefixes(userNaics);
          for (const prefix of userPrefixes) {
            const prefixTemplate = prefixMap.get(prefix);
            if (prefixTemplate) {
              template = prefixTemplate;
              matchType = 'prefix';
              prefixMatchCount++;
              console.log(`[SendWeeklyFast] Prefix match for ${user.email}: ${prefix}`);
              break;
            }
          }
        }

        if (!template) {
          noTemplateCount++;
          await queueForRetry(getSupabase(), user.email, userNaics, 'No matching template (exact or prefix)', weekOf);
          continue;
        }

        const briefing = template.briefing_content as WeeklyBriefing;
        if (!briefing || !briefing.opportunities || briefing.opportunities.length === 0) {
          briefingsSkipped++;
          continue;
        }

        // Generate email HTML
        const emailHtml = generateWeeklyEmailHtml(briefing);
        const emailText = generateWeeklyEmailText(briefing);

        await sendEmail({
          to: user.email,
          subject: `📊 Weekly Deep Dive: ${briefing.opportunities.length} Opportunities - Week of ${briefing.weekOf}`,
          html: emailHtml,
          text: emailText,
        });

        briefingsSent++;

        // Log to database (track match type for analytics)
        await getSupabase().from('briefing_log').upsert({
          user_email: user.email,
          briefing_date: weekOf,
          briefing_content: briefing,
          items_count: briefing.opportunities.length,
          tools_included: ['weekly_deep_dive', matchType === 'exact' ? 'pre_computed_template' : 'prefix_fallback_template'],
          delivery_status: 'sent',
          email_sent_at: new Date().toISOString(),
        }, { onConflict: 'user_email,briefing_date' });

        if (!isTest) {
          await recordBriefingProgramDelivery(activeCohortId, user.email, 'weekly_deep_dive');
        }

        console.log(`[SendWeeklyFast] ✅ Sent to ${user.email}`);

      } catch (err) {
        briefingsFailed++;
        const errorMsg = err instanceof Error ? err.message : String(err);
        errors.push(`${user.email}: ${errorMsg}`);
        console.error(`[SendWeeklyFast] ❌ Failed for ${user.email}:`, err);

        // Queue for automatic retry
        const userNaics = user.naics_codes || [];
        await queueForRetry(getSupabase(), user.email, userNaics, errorMsg, weekOf);
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[SendWeeklyFast] Complete: ${briefingsSent} sent (${prefixMatchCount} prefix), ${noTemplateCount} no template`);

    return NextResponse.json({
      success: true,
      briefingsSent,
      briefingsSkipped,
      briefingsFailed,
      noTemplateCount,
      prefixMatchCount,
      templatesAvailable: templates.length,
      prefixMappings: prefixMap.size,
      totalUsersProcessed: usersToProcess.length,
      elapsed,
    });

  } catch (error) {
    console.error('[SendWeeklyFast] Fatal error:', error);
    return NextResponse.json({
      success: false,
      error: String(error),
      briefingsSent,
      briefingsFailed,
      elapsed: Date.now() - startTime,
    }, { status: 500 });
  }
}

function generateWeeklyEmailHtml(briefing: WeeklyBriefing): string {
  const preferencesUrl = 'https://tools.govcongiants.org/alerts/preferences';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Weekly Deep Dive</title>
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f3f4f6; }
    .container { max-width: 700px; margin: 0 auto; background: #ffffff; }
    .header { background: linear-gradient(135deg, ${BRAND_COLOR} 0%, ${ACCENT_COLOR} 100%); color: white; padding: 32px 24px; text-align: center; }
    .header h1 { margin: 0; font-size: 26px; font-weight: 700; }
    .header p { margin: 12px 0 0; font-size: 15px; opacity: 0.9; }
    .section { padding: 24px; }
    .section-header { margin-bottom: 20px; padding-bottom: 12px; border-bottom: 2px solid #e5e7eb; }
    .section-header h2 { margin: 0; font-size: 18px; color: ${BRAND_COLOR}; font-weight: 700; }
    .opportunity { background: #f9fafb; border-radius: 8px; padding: 20px; margin-bottom: 20px; border-left: 4px solid ${ACCENT_COLOR}; }
    .opp-rank { display: inline-block; width: 28px; height: 28px; background: ${BRAND_COLOR}; color: white; border-radius: 50%; text-align: center; line-height: 28px; font-size: 14px; font-weight: 700; margin-right: 10px; }
    .opp-title { font-size: 17px; font-weight: 700; color: #111827; margin: 0 0 15px; }
    .opp-meta-row { display: flex; margin-bottom: 6px; font-size: 13px; }
    .opp-meta-label { color: #6b7280; width: 100px; }
    .opp-meta-value { color: #111827; font-weight: 600; }
    .displacement-box { background: #fef3c7; border-radius: 6px; padding: 12px; margin: 12px 0; }
    .displacement-label { font-size: 11px; color: #92400e; font-weight: 700; text-transform: uppercase; margin-bottom: 4px; }
    .displacement-text { font-size: 14px; color: #78350f; margin: 0; line-height: 1.5; }
    .landscape-box { background: #f0f9ff; border-radius: 6px; padding: 12px; margin: 12px 0; }
    .landscape-label { font-size: 11px; color: #0369a1; font-weight: 700; text-transform: uppercase; margin-bottom: 8px; }
    .landscape-item { font-size: 13px; color: #0c4a6e; margin: 4px 0; padding-left: 12px; border-left: 2px solid #0ea5e9; }
    .teaming-play { background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%); border-radius: 8px; padding: 20px; margin-bottom: 16px; border-left: 4px solid ${SUCCESS_COLOR}; }
    .play-number { background: ${SUCCESS_COLOR}; color: white; font-size: 12px; padding: 4px 10px; border-radius: 4px; font-weight: 700; }
    .play-name { font-size: 16px; font-weight: 700; color: #065f46; margin: 8px 0 0; }
    .opener-box { background: white; border-radius: 6px; padding: 14px; margin: 12px 0; border: 1px dashed #10b981; }
    .opener-label { font-size: 11px; color: #047857; font-weight: 700; text-transform: uppercase; margin-bottom: 6px; }
    .opener-text { font-size: 13px; color: #1f2937; line-height: 1.5; margin: 0; font-style: italic; }
    .calendar-item { display: flex; padding: 12px; background: #f9fafb; border-radius: 6px; margin-bottom: 8px; align-items: center; }
    .cal-date { font-size: 13px; font-weight: 700; color: ${BRAND_COLOR}; width: 100px; }
    .cal-event { font-size: 13px; color: #111827; flex: 1; }
    .cal-priority { font-size: 11px; padding: 2px 8px; border-radius: 4px; font-weight: 600; }
    .priority-high { background: #fee2e2; color: #991b1b; }
    .priority-medium { background: #fef3c7; color: #92400e; }
    .priority-low { background: #dbeafe; color: #1e40af; }
    .footer { background: #f9fafb; padding: 24px; text-align: center; border-top: 1px solid #e5e7eb; }
    .footer p { margin: 0 0 8px; font-size: 12px; color: #6b7280; }
    .footer a { color: ${ACCENT_COLOR}; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📊 Weekly Deep Dive</h1>
      <p>Week of ${briefing.weekOf} • ${briefing.opportunities.length} Opportunities Analyzed</p>
    </div>

    <div class="section">
      <div class="section-header">
        <h2>TOP ${briefing.opportunities.length} OPPORTUNITIES</h2>
      </div>
      ${briefing.opportunities.map(opp => `
        <div class="opportunity">
          <h3 class="opp-title">
            <span class="opp-rank">${opp.rank}</span>
            ${escapeHtml(opp.contractName)}
          </h3>
          <div style="margin-bottom: 12px;">
            <div class="opp-meta-row"><span class="opp-meta-label">Agency:</span><span class="opp-meta-value">${escapeHtml(opp.agency)}</span></div>
            <div class="opp-meta-row"><span class="opp-meta-label">Incumbent:</span><span class="opp-meta-value">${escapeHtml(opp.incumbent)}</span></div>
            <div class="opp-meta-row"><span class="opp-meta-label">Value:</span><span class="opp-meta-value" style="color: ${SUCCESS_COLOR};">$${formatValue(opp.value)}</span></div>
            <div class="opp-meta-row"><span class="opp-meta-label">Window:</span><span class="opp-meta-value">${escapeHtml(opp.window)}</span></div>
          </div>
          <div class="displacement-box">
            <div class="displacement-label">Displacement Angle</div>
            <p class="displacement-text">${escapeHtml(opp.displacementAngle)}</p>
          </div>
          ${opp.competitiveLandscape?.length > 0 ? `
            <div class="landscape-box">
              <div class="landscape-label">Competitive Landscape</div>
              ${opp.competitiveLandscape.map(item => `<div class="landscape-item">${escapeHtml(item)}</div>`).join('')}
            </div>
          ` : ''}
        </div>
      `).join('')}
    </div>

    <div class="section" style="background: #f0fdf4;">
      <div class="section-header">
        <h2>🤝 TEAMING PLAYS</h2>
      </div>
      ${briefing.teamingPlays.map(play => `
        <div class="teaming-play">
          <span class="play-number">PLAY ${play.playNumber}</span>
          <h3 class="play-name">${escapeHtml(play.strategyName)}</h3>
          <p style="font-size: 14px; color: #047857; margin: 8px 0;"><strong>Target:</strong> ${escapeHtml(play.targetCompany)}</p>
          <div class="opener-box">
            <div class="opener-label">Suggested Opener</div>
            <p class="opener-text">"${escapeHtml(play.suggestedOpener)}"</p>
          </div>
        </div>
      `).join('')}
    </div>

    ${briefing.calendar?.length > 0 ? `
      <div class="section" style="background: #faf5ff;">
        <div class="section-header">
          <h2>📅 KEY DATES</h2>
        </div>
        ${briefing.calendar.map(item => `
          <div class="calendar-item">
            <span class="cal-date">${escapeHtml(item.date)}</span>
            <span class="cal-event">${escapeHtml(item.event)}</span>
            <span class="cal-priority priority-${item.priority}">${item.priority.toUpperCase()}</span>
          </div>
        `).join('')}
      </div>
    ` : ''}

    <div class="footer">
      <p>Generated by <strong>GovCon Giants AI</strong></p>
      <p><a href="${preferencesUrl}">Manage Preferences</a></p>
      <p style="color: #94a3b8; font-size: 11px;">© ${new Date().getFullYear()} GovCon Giants</p>
    </div>
  </div>
</body>
</html>
`;
}

function generateWeeklyEmailText(briefing: WeeklyBriefing): string {
  let text = `📊 WEEKLY DEEP DIVE\nWeek of ${briefing.weekOf}\n${'='.repeat(40)}\n\n`;

  for (const opp of briefing.opportunities) {
    text += `${opp.rank}. ${opp.contractName}\n`;
    text += `   Agency: ${opp.agency}\n`;
    text += `   Incumbent: ${opp.incumbent}\n`;
    text += `   Value: $${formatValue(opp.value)}\n`;
    text += `   DISPLACEMENT: ${opp.displacementAngle}\n\n`;
  }

  return text;
}
