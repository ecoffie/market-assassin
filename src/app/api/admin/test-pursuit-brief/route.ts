/**
 * Admin: Test Pursuit Brief Generation
 *
 * GET /api/admin/test-pursuit-brief?password=...&email=user@example.com&contract=W91RUS18C0024
 *
 * Or POST with opportunity details in body.
 */

import { NextRequest, NextResponse } from 'next/server';
import { generatePursuitBrief, PursuitBrief } from '@/lib/briefings/delivery/pursuit-brief-generator';
import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/send-email';
import { fetchExpiringContractsFromLocal, fetchExpiringContracts } from '@/lib/briefings/pipelines/fpds-recompete';
import { prioritizeNaicsByIndustry } from '@/lib/industry-presets';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const email = searchParams.get('email')?.toLowerCase().trim();
  const contractNumber = searchParams.get('contract');
  const sendIt = searchParams.get('send') === 'true';

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!email) {
    return NextResponse.json({ error: 'Email required (?email=...)' }, { status: 400 });
  }

  // Create Supabase client
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // If contract number provided, look it up in snapshots
  let opportunity: Record<string, unknown> = {};

  if (contractNumber) {
    // Search in recompete snapshots
    const { data: snapshots } = await supabase
      .from('briefing_snapshots')
      .select('raw_data')
      .eq('user_email', email)
      .eq('tool', 'recompete')
      .order('snapshot_date', { ascending: false })
      .limit(1);

    if (snapshots?.[0]?.raw_data) {
      const data = snapshots[0].raw_data as { contracts?: unknown[] };
      const contracts = data.contracts || [];
      const found = contracts.find((c: unknown) => {
        const contract = c as Record<string, unknown>;
        return contract.contractNumber === contractNumber || contract.piid === contractNumber;
      });
      if (found) {
        opportunity = found as Record<string, unknown>;
      }
    }
  }

  // If no contract found in snapshots, fetch real data from USASpending
  if (Object.keys(opportunity).length === 0) {
    console.log(`[TestPursuitBrief] No contract in snapshots, fetching live recompete data from USASpending...`);
    try {
      // Get user's NAICS codes and primary industry
      const { data: profileData } = await supabase
        .from('user_notification_settings')
        .select('naics_codes, primary_industry')
        .eq('user_email', email)
        .single();

      const rawNaicsCodes = (profileData?.naics_codes && profileData.naics_codes.length > 0)
        ? profileData.naics_codes as string[]
        : ['541512', '541611', '541330'];

      // Prioritize by primary industry
      const primaryIndustry = (profileData?.primary_industry as string) || null;
      const naicsCodes = prioritizeNaicsByIndustry(rawNaicsCodes, primaryIndustry);
      console.log(`[TestPursuitBrief] Primary industry: ${primaryIndustry || 'none'}, prioritized NAICS: ${naicsCodes.slice(0, 5).join(', ')}...`);

      // PRIMARY: Use local FPDS data dump (contracts-data.js)
      const recompeteResult = await fetchExpiringContractsFromLocal({
        naicsCodes,
        monthsToExpiration: 12,
        limit: 10,
      });

      if (recompeteResult.contracts.length > 0) {
        // Pick the first high-value contract
        const contract = recompeteResult.contracts[0];
        opportunity = {
          contractName: contract.naicsDescription || contract.contractNumber,
          contractNumber: contract.contractNumber,
          agency: `${contract.department || contract.agency} / ${contract.contractingOfficeName || ''}`.replace('/ ', '').trim(),
          incumbent: contract.incumbentName,
          value: contract.baseAndAllOptionsValue || contract.obligatedAmount,
          naicsCode: contract.naicsCode,
          description: contract.naicsDescription,
          deadline: contract.currentCompletionDate,
          rawData: contract,
        };
        console.log(`[TestPursuitBrief] Using real contract: ${contract.incumbentName} - $${(contract.baseAndAllOptionsValue / 1000000).toFixed(1)}M`);
      } else {
        return NextResponse.json({
          success: false,
          error: 'No expiring contracts found in USASpending. Try specifying a contract number (?contract=...).',
        }, { status: 404 });
      }
    } catch (fetchErr) {
      console.error(`[TestPursuitBrief] USASpending fetch failed:`, fetchErr);
      return NextResponse.json({
        success: false,
        error: `Failed to fetch real contract data: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`,
      }, { status: 500 });
    }
  }

  try {
    console.log(`[TestPursuitBrief] Generating for ${opportunity.contractName || contractNumber}...`);

    const brief = await generatePursuitBrief(email, opportunity);

    if (!brief) {
      return NextResponse.json({
        success: false,
        error: 'Failed to generate pursuit brief - check profile or Anthropic config',
      });
    }

    // Generate email
    const subject = `🎯 Pursuit Brief: ${brief.contractName} - Score ${brief.opportunityScore}/100`;
    const htmlBody = generatePursuitEmailHtml(brief);

    // Optionally send
    let emailSent = false;
    if (sendIt) {
      try {
        await sendEmail({
          to: email,
          subject,
          html: htmlBody,
          text: `Pursuit Brief for ${brief.contractName}\nScore: ${brief.opportunityScore}/100`,
        });
        emailSent = true;
        console.log(`[TestPursuitBrief] Email sent to ${email}`);
      } catch (emailErr) {
        console.error(`[TestPursuitBrief] Email failed:`, emailErr);
      }
    }

    return NextResponse.json({
      success: true,
      email,
      contractName: brief.contractName,
      opportunityScore: brief.opportunityScore,
      processingTimeMs: brief.processingTimeMs,
      emailSent,
      subject,
      brief,
    });

  } catch (err) {
    console.error('[TestPursuitBrief] Error:', err);
    return NextResponse.json({
      success: false,
      error: String(err),
    }, { status: 500 });
  }
}

function generatePursuitEmailHtml(brief: PursuitBrief): string {
  const scoreColor = brief.opportunityScore >= 75 ? '#059669' : brief.opportunityScore >= 60 ? '#d97706' : '#dc2626';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pursuit Brief</title>
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background: #f3f4f6; }
    .container { max-width: 680px; margin: 0 auto; background: #ffffff; }
    .header { background: linear-gradient(135deg, #1e3a8a 0%, #7c3aed 100%); color: white; padding: 32px 24px; }
    .header h1 { margin: 0; font-size: 24px; font-weight: 700; }
    .header p { margin: 8px 0 0; font-size: 14px; opacity: 0.9; }
    .score-badge { display: inline-block; background: ${scoreColor}; color: white; padding: 8px 16px; border-radius: 20px; font-size: 18px; font-weight: 700; margin-top: 16px; }
    .section { padding: 24px; border-bottom: 1px solid #e5e7eb; }
    .section h2 { margin: 0 0 12px; font-size: 16px; color: #1e3a8a; text-transform: uppercase; letter-spacing: 0.5px; }
    .section p { margin: 0; font-size: 15px; color: #374151; line-height: 1.6; }
    .intel-list { margin: 0; padding: 0 0 0 20px; }
    .intel-list li { margin-bottom: 8px; font-size: 14px; color: #374151; }
    .outreach { background: #f9fafb; border-radius: 8px; padding: 12px 16px; margin-bottom: 8px; }
    .outreach-priority { background: #1e3a8a; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }
    .outreach-name { font-weight: 600; color: #111827; margin-left: 8px; }
    .outreach-role { font-size: 13px; color: #6b7280; margin-top: 4px; }
    .action-item { display: flex; align-items: flex-start; padding: 8px 0; border-bottom: 1px solid #e5e7eb; }
    .action-item:last-child { border-bottom: none; }
    .action-day { background: #7c3aed; color: white; padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight: 600; margin-right: 12px; min-width: 50px; text-align: center; }
    .action-text { font-size: 14px; color: #374151; flex: 1; }
    .action-owner { font-size: 12px; color: #6b7280; margin-left: 8px; }
    .risk { background: #fef2f2; border-left: 4px solid #dc2626; padding: 12px 16px; margin-bottom: 8px; border-radius: 0 8px 8px 0; }
    .risk-text { font-size: 14px; color: #991b1b; font-weight: 500; margin-bottom: 4px; }
    .risk-mitigation { font-size: 13px; color: #7f1d1d; }
    .next-move { background: #ecfdf5; border: 2px solid #10b981; border-radius: 8px; padding: 16px; text-align: center; }
    .next-move h3 { margin: 0 0 8px; color: #065f46; font-size: 14px; text-transform: uppercase; }
    .next-move p { margin: 0; font-size: 16px; color: #047857; font-weight: 600; }
    .footer { background: #f9fafb; padding: 24px; text-align: center; }
    .footer p { margin: 0; font-size: 12px; color: #6b7280; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎯 Pursuit Brief</h1>
      <p>${escapeHtml(brief.contractName)}</p>
      <p>${escapeHtml(brief.agency)} • ${escapeHtml(brief.value)}</p>
      <div class="score-badge">Score: ${brief.opportunityScore}/100</div>
    </div>

    <div class="section">
      <h2>Why Worth Pursuing</h2>
      <p>${escapeHtml(brief.whyWorthPursuing)}</p>
    </div>

    <div class="section">
      <h2>Working Hypothesis</h2>
      <p>${escapeHtml(brief.workingHypothesis)}</p>
    </div>

    <div class="section">
      <h2>Priority Intel Needed</h2>
      <ul class="intel-list">
        ${brief.priorityIntel.map(intel => `<li>${escapeHtml(intel)}</li>`).join('')}
      </ul>
    </div>

    <div class="section">
      <h2>First Outreach Targets</h2>
      ${brief.outreachTargets.map(target => `
        <div class="outreach">
          <span class="outreach-priority">#${target.priority}</span>
          <span class="outreach-name">${escapeHtml(target.name)}</span>
          <p class="outreach-role">${escapeHtml(target.role)}${target.company ? ` • ${escapeHtml(target.company)}` : ''}</p>
        </div>
      `).join('')}
    </div>

    <div class="section">
      <h2>5-Day Action Plan</h2>
      ${brief.actionPlan.map(item => `
        <div class="action-item">
          <span class="action-day">Day ${item.day}</span>
          <span class="action-text">${escapeHtml(item.action)}</span>
          <span class="action-owner">${escapeHtml(item.owner)}</span>
        </div>
      `).join('')}
    </div>

    <div class="section">
      <h2>Risks & Mitigations</h2>
      ${brief.risks.map(risk => `
        <div class="risk">
          <p class="risk-text">⚠️ ${escapeHtml(risk.risk)}</p>
          <p class="risk-mitigation">→ ${escapeHtml(risk.mitigation)}</p>
        </div>
      `).join('')}
    </div>

    <div class="section">
      <div class="next-move">
        <h3>Immediate Next Move</h3>
        <p>${escapeHtml(brief.immediateNextMove.action)}</p>
        <p style="font-size: 13px; margin-top: 8px; color: #047857;">Owner: ${escapeHtml(brief.immediateNextMove.owner)} • Deadline: ${escapeHtml(brief.immediateNextMove.deadline)}</p>
      </div>
    </div>

    <div class="footer">
      <p>This pursuit brief was generated by <strong>GovCon Giants AI</strong></p>
      <p style="margin-top: 8px;">© ${new Date().getFullYear()} GovCon Giants AI</p>
    </div>
  </div>
</body>
</html>
`;
}

function escapeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const email = searchParams.get('email')?.toLowerCase().trim();

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!email) {
    return NextResponse.json({ error: 'Email required (?email=...)' }, { status: 400 });
  }

  try {
    const opportunity = await request.json();

    console.log(`[TestPursuitBrief] POST - Generating for ${opportunity.contractName}...`);

    const brief = await generatePursuitBrief(email, opportunity);

    if (!brief) {
      return NextResponse.json({
        success: false,
        error: 'Failed to generate pursuit brief',
      });
    }

    return NextResponse.json({
      success: true,
      email,
      contractName: brief.contractName,
      opportunityScore: brief.opportunityScore,
      processingTimeMs: brief.processingTimeMs,
      brief,
    });

  } catch (err) {
    console.error('[TestPursuitBrief] Error:', err);
    return NextResponse.json({
      success: false,
      error: String(err),
    }, { status: 500 });
  }
}
