/**
 * Send Pursuit Brief (Fast) - Uses Pre-computed Templates
 *
 * ENTERPRISE ARCHITECTURE: Matches users to pre-computed pursuit templates.
 * Processing time per user: ~100ms (vs 52+ seconds with generation)
 *
 * Schedule: Monday 7 AM UTC (after precompute-pursuit-briefs completes)
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
const ACCENT_COLOR = '#7c3aed';
const SUCCESS_COLOR = '#10b981';

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
      p_briefing_type: 'pursuit',
      p_briefing_date: briefingDate,
      p_naics_codes: JSON.stringify(naicsCodes),
      p_failure_reason: failureReason,
    });
  } catch (err) {
    console.error(`[SendPursuitFast] Failed to queue retry for ${userEmail}:`, err);
  }
}

interface PursuitBrief {
  contractName: string;
  agency: string;
  value: string;
  opportunityScore: number;
  whyWorthPursuing: string;
  workingHypothesis: string;
  priorityIntel: string[];
  outreachTargets: { priority: number; name: string; role: string; company?: string; approach: string }[];
  actionPlan: { day: number; action: string; owner: string }[];
  risks: { risk: string; likelihood: string; impact: string; mitigation: string }[];
  immediateNextMove: { action: string; owner: string; deadline: string };
  sourceNoticeId?: string;
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

function getMondayDate(): string {
  const today = new Date();
  const day = today.getDay();
  // If it's Monday, use today. Otherwise use next Monday
  if (day === 1) {
    return today.toISOString().split('T')[0];
  }
  const diff = day === 0 ? 1 : (8 - day);
  today.setDate(today.getDate() + diff);
  return today.toISOString().split('T')[0];
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
        message: 'Send Pursuit Brief (Fast) - Uses Pre-computed Templates',
        description: 'Matches users to templates, sends in ~100ms per user',
        schedule: 'Monday 7 AM UTC',
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

  // DAY-OF-WEEK GUARD: Pursuit Brief only sends on Monday (UTC)
  // Can be bypassed with: ?password=xxx&skipDayCheck=true (admin override)
  const today = new Date();
  const dayOfWeek = today.getUTCDay(); // 1 = Monday
  const isTestMode = testEmail && isTest;
  const skipDayCheck = request.nextUrl.searchParams.get('skipDayCheck') === 'true';
  const adminPassword = request.nextUrl.searchParams.get('password');
  const isAdminOverride = skipDayCheck && adminPassword === (process.env.ADMIN_PASSWORD || 'galata-assassin-2026');

  if (dayOfWeek !== 1 && !isTestMode && !isAdminOverride) {
    console.log(`[SendPursuitFast] Skipped - not Monday (day ${dayOfWeek})`);
    return NextResponse.json({
      success: true,
      message: `Pursuit Brief only sends on Monday. Today is day ${dayOfWeek}.`,
      skipped: true,
      dayOfWeek,
    });
  }

  if (isAdminOverride) {
    console.log(`[SendPursuitFast] Admin override - bypassing Monday check (day ${dayOfWeek})`);
  }

  const startTime = Date.now();
  const mondayDate = getMondayDate();
  let briefingsSent = 0;
  let briefingsSkipped = 0;
  let briefingsFailed = 0;
  let noTemplateCount = 0;
  const errors: string[] = [];
  let activeCohortId: string | null = null;

  console.log('[SendPursuitFast] Starting fast template-based delivery...');

  try {
    // Step 1: Get all pre-computed pursuit templates
    const { data: templates, error: templatesError } = await getSupabase()
      .from('briefing_templates')
      .select('*')
      .eq('template_date', mondayDate)
      .eq('briefing_type', 'pursuit');

    if (templatesError) {
      throw new Error(`Failed to fetch templates: ${templatesError.message}`);
    }

    if (!templates || templates.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No pursuit templates found. Run precompute-pursuit-briefs first.',
        mondayDate,
        elapsed: Date.now() - startTime,
      });
    }

    const templateMap = new Map<string, BriefingTemplate>();
    templates.forEach((t: BriefingTemplate) => templateMap.set(t.naics_profile_hash, t));

    // Build prefix fallback map
    const prefixMap = buildPrefixMap(templates);

    console.log(`[SendPursuitFast] Loaded ${templates.length} pursuit templates, ${prefixMap.size} prefix mappings`);

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

    // Check for already sent this week - use briefing_log with briefing_type='pursuit'
    // CRITICAL: Use unified briefing_log table (pursuit_brief_log does not exist)
    // Note: mondayDate is already defined above at function start

    const { data: sentThisWeek } = await getSupabase()
      .from('briefing_log')
      .select('user_email')
      .eq('briefing_date', mondayDate)
      .eq('briefing_type', 'pursuit')
      .in('delivery_status', ['sent', 'skipped']);

    const sentEmails = new Set((sentThisWeek || []).map((s: { user_email: string }) => s.user_email));
    usersToProcess = usersToProcess
      .filter(u => !sentEmails.has(u.email))
      .slice(0, BATCH_SIZE);

    console.log(`[SendPursuitFast] Processing ${usersToProcess.length} users`);

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
              console.log(`[SendPursuitFast] Prefix match for ${user.email}: ${prefix}`);
              break;
            }
          }
        }

        if (!template) {
          noTemplateCount++;
          await queueForRetry(getSupabase(), user.email, userNaics, 'No matching template (exact or prefix)', getMondayDate());
          continue;
        }

        const brief = template.briefing_content as PursuitBrief;
        if (!brief || !brief.contractName) {
          briefingsSkipped++;
          continue;
        }

        // Generate email HTML
        const emailHtml = generatePursuitEmailHtml(brief);
        const emailText = generatePursuitEmailText(brief);
        const scoreLabel = brief.opportunityScore >= 75 ? 'STRONG PURSUIT' : brief.opportunityScore >= 60 ? 'CONDITIONAL' : 'EVALUATE';

        await sendEmail({
          to: user.email,
          subject: `🎯 PURSUIT BRIEF: ${brief.contractName} - Score: ${brief.opportunityScore}/100 (${scoreLabel})`,
          html: emailHtml,
          text: emailText,
        });

        briefingsSent++;

        // Log to briefing_log with briefing_type='pursuit'
        // UNIFIED: Use same table as daily/weekly for consistency
        await getSupabase().from('briefing_log').upsert({
          user_email: user.email,
          briefing_date: mondayDate,
          briefing_type: 'pursuit',
          briefing_content: brief,
          items_count: 1,
          tools_included: ['pursuit_brief', matchType === 'exact' ? 'pre_computed_template' : 'prefix_fallback_template'],
          delivery_status: 'sent',
          email_sent_at: new Date().toISOString(),
        }, { onConflict: 'user_email,briefing_date,briefing_type' });

        if (!isTest) {
          await recordBriefingProgramDelivery(activeCohortId, user.email, 'pursuit_brief');
        }

        console.log(`[SendPursuitFast] ✅ Sent to ${user.email}`);

      } catch (err) {
        briefingsFailed++;
        const errorMsg = err instanceof Error ? err.message : String(err);
        errors.push(`${user.email}: ${errorMsg}`);
        console.error(`[SendPursuitFast] ❌ Failed for ${user.email}:`, err);

        // Queue for automatic retry
        const userNaics = user.naics_codes || [];
        await queueForRetry(getSupabase(), user.email, userNaics, errorMsg, getMondayDate());
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[SendPursuitFast] Complete: ${briefingsSent} sent (${prefixMatchCount} prefix), ${noTemplateCount} no template`);

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
    console.error('[SendPursuitFast] Fatal error:', error);
    return NextResponse.json({
      success: false,
      error: String(error),
      briefingsSent,
      briefingsFailed,
      elapsed: Date.now() - startTime,
    }, { status: 500 });
  }
}

function generatePursuitEmailHtml(brief: PursuitBrief): string {
  const scoreColor = brief.opportunityScore >= 75 ? SUCCESS_COLOR : brief.opportunityScore >= 60 ? '#f59e0b' : '#ef4444';
  const scoreLabel = brief.opportunityScore >= 75 ? 'STRONG PURSUIT' : brief.opportunityScore >= 60 ? 'CONDITIONAL' : 'EVALUATE';
  const preferencesUrl = 'https://tools.govcongiants.org/alerts/preferences';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pursuit Brief</title>
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f3f4f6; }
    .container { max-width: 700px; margin: 0 auto; background: #ffffff; }
    .header { background: linear-gradient(135deg, ${BRAND_COLOR} 0%, ${ACCENT_COLOR} 100%); color: white; padding: 32px 24px; }
    .header h1 { margin: 0; font-size: 24px; font-weight: 700; }
    .header-meta { display: flex; justify-content: space-between; align-items: center; margin-top: 16px; flex-wrap: wrap; gap: 16px; }
    .header-meta p { margin: 0; font-size: 14px; opacity: 0.9; }
    .score-badge { background: ${scoreColor}; color: white; padding: 8px 16px; border-radius: 6px; font-weight: 700; text-align: center; }
    .score-number { font-size: 24px; }
    .score-label { font-size: 11px; text-transform: uppercase; }
    .section { padding: 24px; border-bottom: 1px solid #e5e7eb; }
    .section-title { font-size: 14px; color: ${BRAND_COLOR}; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 12px; }
    .section-content { font-size: 15px; color: #374151; line-height: 1.6; margin: 0; }
    .hypothesis-box { background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); border-radius: 8px; padding: 20px; border-left: 4px solid ${BRAND_COLOR}; }
    .intel-list { list-style: none; padding: 0; margin: 0; }
    .intel-item { display: flex; align-items: flex-start; padding: 10px 0; border-bottom: 1px dashed #e5e7eb; }
    .intel-item:last-child { border-bottom: none; }
    .intel-number { width: 24px; height: 24px; background: ${ACCENT_COLOR}; color: white; border-radius: 50%; font-size: 12px; font-weight: 700; display: flex; align-items: center; justify-content: center; margin-right: 12px; flex-shrink: 0; }
    .intel-text { font-size: 14px; color: #374151; }
    .outreach-card { background: #f9fafb; border-radius: 8px; padding: 16px; margin-bottom: 12px; }
    .outreach-priority { display: inline-block; background: ${BRAND_COLOR}; color: white; font-size: 11px; padding: 2px 8px; border-radius: 4px; font-weight: 600; margin-bottom: 8px; }
    .outreach-name { font-size: 15px; font-weight: 700; color: #111827; margin: 0 0 4px; }
    .outreach-role { font-size: 13px; color: #6b7280; margin: 0 0 8px; }
    .outreach-approach { font-size: 13px; color: #374151; font-style: italic; }
    .action-timeline { background: #f0fdf4; border-radius: 8px; padding: 16px; }
    .action-item { display: flex; padding: 8px 0; border-bottom: 1px dashed #d1fae5; }
    .action-item:last-child { border-bottom: none; }
    .action-day { width: 60px; font-size: 13px; font-weight: 700; color: ${SUCCESS_COLOR}; }
    .action-task { font-size: 13px; color: #374151; flex: 1; }
    .action-owner { font-size: 12px; color: #6b7280; width: 80px; text-align: right; }
    .risk-card { background: #fef2f2; border-radius: 8px; padding: 16px; margin-bottom: 12px; border-left: 4px solid #ef4444; }
    .risk-likelihood { font-size: 11px; padding: 2px 8px; border-radius: 4px; font-weight: 600; }
    .likelihood-high { background: #fee2e2; color: #991b1b; }
    .likelihood-medium { background: #fef3c7; color: #92400e; }
    .likelihood-low { background: #dbeafe; color: #1e40af; }
    .risk-text { font-size: 14px; font-weight: 600; color: #991b1b; margin: 8px 0 0; }
    .risk-mitigation { font-size: 13px; color: #7f1d1d; margin: 8px 0 0; }
    .next-move { background: linear-gradient(135deg, ${SUCCESS_COLOR} 0%, #059669 100%); border-radius: 8px; padding: 24px; color: white; text-align: center; }
    .next-move h3 { margin: 0 0 12px; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; opacity: 0.9; }
    .next-move-action { font-size: 18px; font-weight: 700; margin: 0 0 12px; }
    .next-move-meta { font-size: 14px; opacity: 0.9; }
    .footer { background: #f9fafb; padding: 24px; text-align: center; }
    .footer p { margin: 0 0 8px; font-size: 12px; color: #6b7280; }
    .footer a { color: ${ACCENT_COLOR}; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎯 PURSUIT BRIEF</h1>
      <div class="header-meta">
        <div>
          <p><strong>${escapeHtml(brief.contractName)}</strong></p>
          <p>${escapeHtml(brief.agency)} • ${escapeHtml(brief.value)}</p>
        </div>
        <div class="score-badge">
          <div class="score-number">${brief.opportunityScore}</div>
          <div class="score-label">${scoreLabel}</div>
        </div>
      </div>
    </div>

    <div class="section">
      <h2 class="section-title">Why This Is Worth Pursuing</h2>
      <p class="section-content">${escapeHtml(brief.whyWorthPursuing)}</p>
    </div>

    <div class="section">
      <h2 class="section-title">Working Hypothesis</h2>
      <div class="hypothesis-box">
        <p class="section-content">${escapeHtml(brief.workingHypothesis)}</p>
      </div>
    </div>

    <div class="section">
      <h2 class="section-title">Priority Intelligence Requirements</h2>
      <ul class="intel-list">
        ${brief.priorityIntel.map((intel, i) => `
          <li class="intel-item">
            <span class="intel-number">${i + 1}</span>
            <span class="intel-text">${escapeHtml(intel)}</span>
          </li>
        `).join('')}
      </ul>
    </div>

    <div class="section">
      <h2 class="section-title">First Outreach Targets</h2>
      ${brief.outreachTargets.map(target => `
        <div class="outreach-card">
          <span class="outreach-priority">PRIORITY ${target.priority}</span>
          <h4 class="outreach-name">${escapeHtml(target.name)}</h4>
          <p class="outreach-role">${escapeHtml(target.role)}${target.company ? ` • ${escapeHtml(target.company)}` : ''}</p>
          <p class="outreach-approach">Approach: ${escapeHtml(target.approach)}</p>
        </div>
      `).join('')}
    </div>

    <div class="section">
      <h2 class="section-title">5-Day Action Plan</h2>
      <div class="action-timeline">
        ${brief.actionPlan.map(action => `
          <div class="action-item">
            <span class="action-day">Day ${action.day}</span>
            <span class="action-task">${escapeHtml(action.action)}</span>
            <span class="action-owner">${escapeHtml(action.owner)}</span>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="section">
      <h2 class="section-title">Risk Assessment</h2>
      ${brief.risks.map(risk => `
        <div class="risk-card">
          <span class="risk-likelihood likelihood-${risk.likelihood}">${risk.likelihood.toUpperCase()}</span>
          <span class="risk-likelihood likelihood-${risk.impact}" style="margin-left: 8px;">Impact: ${risk.impact.toUpperCase()}</span>
          <p class="risk-text">${escapeHtml(risk.risk)}</p>
          <p class="risk-mitigation"><strong>Mitigation:</strong> ${escapeHtml(risk.mitigation)}</p>
        </div>
      `).join('')}
    </div>

    <div class="section" style="border-bottom: none;">
      <h2 class="section-title">Immediate Next Move</h2>
      <div class="next-move">
        <h3>Do This Today</h3>
        <p class="next-move-action">${escapeHtml(brief.immediateNextMove.action)}</p>
        <p class="next-move-meta">
          <strong>Owner:</strong> ${escapeHtml(brief.immediateNextMove.owner)} •
          <strong>Deadline:</strong> ${escapeHtml(brief.immediateNextMove.deadline)}
        </p>
      </div>
    </div>

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

function generatePursuitEmailText(brief: PursuitBrief): string {
  return `
🎯 PURSUIT BRIEF
${'='.repeat(40)}

${brief.contractName}
${brief.agency} • ${brief.value}

OPPORTUNITY SCORE: ${brief.opportunityScore}/100

${'='.repeat(40)}
WHY THIS IS WORTH PURSUING
${'='.repeat(40)}
${brief.whyWorthPursuing}

${'='.repeat(40)}
WORKING HYPOTHESIS
${'='.repeat(40)}
${brief.workingHypothesis}

${'='.repeat(40)}
PRIORITY INTELLIGENCE REQUIREMENTS
${'='.repeat(40)}
${brief.priorityIntel.map((intel, i) => `${i + 1}. ${intel}`).join('\n')}

${'='.repeat(40)}
5-DAY ACTION PLAN
${'='.repeat(40)}
${brief.actionPlan.map(a => `Day ${a.day}: ${a.action} [${a.owner}]`).join('\n')}

${'='.repeat(40)}
IMMEDIATE NEXT MOVE
${'='.repeat(40)}
${brief.immediateNextMove.action}
Owner: ${brief.immediateNextMove.owner}
Deadline: ${brief.immediateNextMove.deadline}

Generated by GovCon Giants AI
`;
}
