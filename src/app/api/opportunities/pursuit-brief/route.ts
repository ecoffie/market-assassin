/**
 * POST /api/opportunities/pursuit-brief
 *
 * Generate and email a Pursuit Brief for a saved opportunity.
 * Called automatically when user saves an opportunity with requestPursuitBrief=true.
 *
 * Body:
 * - email: user email
 * - savedOpportunityId: UUID of saved opportunity (optional)
 * - noticeId: SAM.gov notice ID
 * - opportunityData: full opportunity object
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/send-email';
import { extractAndParseJSON, generateBriefingJson } from '@/lib/briefings/delivery/llm-router';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function getSupabase() {
  if (!supabaseUrl || !supabaseServiceKey) return null;
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
  });
}

const BRAND_COLOR = '#1e3a8a';
const ACCENT_COLOR = '#7c3aed';
const SUCCESS_COLOR = '#10b981';

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
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const body = await request.json();
    const {
      email,
      savedOpportunityId,
      noticeId,
      opportunityData,
    } = body;

    if (!email || !noticeId) {
      return NextResponse.json(
        { error: 'Missing required fields: email and noticeId' },
        { status: 400 }
      );
    }

    const supabase = getSupabase();
    if (!supabase) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    // Get user's profile for context
    const { data: userSettings } = await supabase
      .from('user_notification_settings')
      .select('naics_codes, agencies, keywords')
      .eq('user_email', email.toLowerCase())
      .single();

    const userNaics = userSettings?.naics_codes || [];
    const userAgencies = userSettings?.agencies || [];
    const userKeywords = userSettings?.keywords || [];

    console.log(`[Pursuit Brief] Generating for ${email}, notice ${noticeId}...`);

    // Generate the pursuit brief
    const brief = await generatePursuitBrief(opportunityData, {
      naics: userNaics,
      agencies: userAgencies,
      keywords: userKeywords,
    });

    // Send the email
    const emailHtml = generatePursuitEmailHtml(brief, opportunityData);
    const emailText = generatePursuitEmailText(brief);

    await sendEmail({
      to: email,
      subject: `🎯 PURSUIT BRIEF: ${brief.contractName} - Score: ${brief.opportunityScore}/100`,
      html: emailHtml,
      text: emailText,
    });

    const processingTime = Date.now() - startTime;

    // Log the pursuit brief
    await supabase.from('pursuit_brief_log').insert({
      user_email: email.toLowerCase(),
      saved_opportunity_id: savedOpportunityId || null,
      notice_id: noticeId,
      brief_data: brief,
      opportunity_score: brief.opportunityScore,
      sent_at: new Date().toISOString(),
      delivery_status: 'sent',
      processing_time_ms: processingTime,
    });

    // Update saved opportunity if we have the ID
    if (savedOpportunityId) {
      await supabase
        .from('user_saved_opportunities')
        .update({
          pursuit_brief_sent_at: new Date().toISOString(),
          pursuit_brief_data: brief,
        })
        .eq('id', savedOpportunityId);
    }

    console.log(`[Pursuit Brief] Sent to ${email} in ${processingTime}ms, score: ${brief.opportunityScore}/100`);

    return NextResponse.json({
      success: true,
      brief: {
        opportunityScore: brief.opportunityScore,
        contractName: brief.contractName,
        agency: brief.agency,
      },
      processingTimeMs: processingTime,
      message: `Pursuit Brief sent to ${email}`,
    });

  } catch (error) {
    console.error('[Pursuit Brief] Error:', error);

    // Log the failure
    const catchSupabase = getSupabase();
    if (catchSupabase) {
      const body = await request.clone().json().catch(() => ({}));
      try {
        await catchSupabase.from('pursuit_brief_log').insert({
          user_email: body.email?.toLowerCase() || 'unknown',
          notice_id: body.noticeId || 'unknown',
          brief_data: {},
          delivery_status: 'failed',
          error_message: error instanceof Error ? error.message : String(error),
          processing_time_ms: Date.now() - startTime,
        });
      } catch {
        // Ignore logging errors
      }
    }

    return NextResponse.json(
      { error: 'Failed to generate pursuit brief', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

async function generatePursuitBrief(
  opportunity: Record<string, unknown>,
  userProfile: { naics: string[]; agencies: string[]; keywords: string[] }
): Promise<PursuitBrief> {
  const prompt = `You are a senior GovCon capture manager. Generate a 1-page Pursuit Brief for this opportunity.

USER PROFILE (the company considering this pursuit):
- NAICS Codes: ${userProfile.naics.join(', ') || 'Not specified'}
- Target Agencies: ${userProfile.agencies.join(', ') || 'Any federal agency'}
- Keywords/Capabilities: ${userProfile.keywords.join(', ') || 'Not specified'}

OPPORTUNITY DATA:
${JSON.stringify(opportunity, null, 2)}

Generate JSON with:
1. "contractName" - descriptive name
2. "agency" - Department / Sub-agency
3. "value" - formatted value (e.g., "$5M", "$500K")
4. "opportunityScore" - 0-100 based on fit and winability. Factors:
   - NAICS match: +25 if matches user's codes
   - Set-aside match: +20 if matches user's certifications
   - Agency fit: +15 if matches target agencies
   - Timeline: +15 if response deadline >14 days
   - Competition level: +25 if limited competition/sole source
5. "whyWorthPursuing" - 2-3 sentence strategic rationale
6. "workingHypothesis" - Theory of the case for winning
7. "priorityIntel" - 5 must-answer questions before bid/no-bid
8. "outreachTargets" - 4 people to contact. Each: priority (1-4), name (title/role), role, company (optional), approach
9. "actionPlan" - 5-day plan. Each: day (1-5), action, owner (role)
10. "risks" - 4 risks. Each: risk, likelihood (high/medium/low), impact (high/medium/low), mitigation
11. "immediateNextMove" - Single most important action: action, owner, deadline

SCORING GUIDE:
- 90-100: Must pursue - perfect fit, high win probability
- 75-89: Strong pursuit - good fit, competitive position
- 60-74: Conditional pursuit - pursue with caveats
- 45-59: Selective pursuit - only if strategic
- Below 45: No-bid likely - poor fit or low win probability

Be specific and actionable. This enables capture team decisions.

Return ONLY valid JSON.`;

  const { text, provider, model } = await generateBriefingJson(
    'pursuit',
    'You are a senior GovCon capture manager. Generate a 1-page Pursuit Brief for this opportunity.',
    prompt,
    3000
  );
  const data = extractAndParseJSON<{
    contractName?: string;
    agency?: string;
    value?: string;
    opportunityScore?: number;
    whyWorthPursuing?: string;
    workingHypothesis?: string;
    priorityIntel?: string[];
    outreachTargets?: { priority: number; name: string; role: string; company?: string; approach: string }[];
    actionPlan?: { day: number; action: string; owner: string }[];
    risks?: { risk: string; likelihood: string; impact: string; mitigation: string }[];
    immediateNextMove?: { action: string; owner: string; deadline: string };
  }>(text);
  console.log(`[PursuitBriefOpportunity] Generated via ${provider}/${model}`);

  // Extract value from opportunity if AI didn't provide it
  const oppValue = opportunity.estimatedValue || opportunity.estimated_value || opportunity.value || 0;
  const formattedValue = formatValue(Number(oppValue));

  return {
    contractName: data.contractName || String(opportunity.title || 'Unknown Opportunity'),
    agency: data.agency || String(opportunity.department || opportunity.agency || 'Unknown Agency'),
    value: data.value || formattedValue,
    opportunityScore: data.opportunityScore || 50,
    whyWorthPursuing: data.whyWorthPursuing || '',
    workingHypothesis: data.workingHypothesis || '',
    priorityIntel: data.priorityIntel || [],
    outreachTargets: data.outreachTargets || [],
    actionPlan: data.actionPlan || [],
    risks: data.risks || [],
    immediateNextMove: data.immediateNextMove || { action: 'Review opportunity', owner: 'Capture Lead', deadline: 'Tomorrow' },
  };
}

function formatValue(value: number): string {
  if (!value) return 'TBD';
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(0)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value}`;
}

function escapeHtml(text: string): string {
  if (!text) return '';
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function generatePursuitEmailHtml(brief: PursuitBrief, opportunity: Record<string, unknown>): string {
  const scoreColor = brief.opportunityScore >= 75 ? SUCCESS_COLOR : brief.opportunityScore >= 60 ? '#f59e0b' : '#ef4444';
  const scoreLabel = brief.opportunityScore >= 75 ? 'STRONG PURSUIT' : brief.opportunityScore >= 60 ? 'CONDITIONAL' : 'EVALUATE';

  const preferencesUrl = 'https://tools.govcongiants.org/alerts/preferences';
  const samLink = `https://sam.gov/opp/${opportunity.noticeId || ''}/view`;

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
    .risk-header { display: flex; align-items: center; margin-bottom: 8px; gap: 8px; flex-wrap: wrap; }
    .risk-likelihood { font-size: 11px; padding: 2px 8px; border-radius: 4px; font-weight: 600; }
    .likelihood-high { background: #fee2e2; color: #991b1b; }
    .likelihood-medium { background: #fef3c7; color: #92400e; }
    .likelihood-low { background: #dbeafe; color: #1e40af; }
    .risk-text { font-size: 14px; font-weight: 600; color: #991b1b; margin: 0; }
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
          <div class="risk-header">
            <span class="risk-likelihood likelihood-${risk.likelihood}">${risk.likelihood.toUpperCase()}</span>
            <span class="risk-likelihood likelihood-${risk.impact}">Impact: ${risk.impact.toUpperCase()}</span>
          </div>
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

    <div style="padding: 24px; text-align: center;">
      <a href="${samLink}" style="background: ${BRAND_COLOR}; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">
        View on SAM.gov →
      </a>
    </div>

    <div class="footer">
      <p>Generated by <strong>GovCon Giants AI</strong></p>
      <p><a href="${preferencesUrl}">Manage Preferences</a></p>
      <p style="color: #94a3b8; font-size: 11px;">© ${new Date().getFullYear()} GovCon Giants • tools.govcongiants.org</p>
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
FIRST OUTREACH TARGETS
${'='.repeat(40)}
${brief.outreachTargets.map(t => `[Priority ${t.priority}] ${t.name}\nRole: ${t.role}${t.company ? ` • ${t.company}` : ''}\nApproach: ${t.approach}`).join('\n\n')}

${'='.repeat(40)}
5-DAY ACTION PLAN
${'='.repeat(40)}
${brief.actionPlan.map(a => `Day ${a.day}: ${a.action} [${a.owner}]`).join('\n')}

${'='.repeat(40)}
RISK ASSESSMENT
${'='.repeat(40)}
${brief.risks.map(r => `⚠️ ${r.risk}\n   Likelihood: ${r.likelihood} | Impact: ${r.impact}\n   Mitigation: ${r.mitigation}`).join('\n\n')}

${'='.repeat(40)}
IMMEDIATE NEXT MOVE
${'='.repeat(40)}
${brief.immediateNextMove.action}
Owner: ${brief.immediateNextMove.owner}
Deadline: ${brief.immediateNextMove.deadline}

Generated by GovCon Giants AI
`;
}
