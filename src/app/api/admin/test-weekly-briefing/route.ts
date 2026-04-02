/**
 * Admin: Test Weekly Deep Dive Briefing
 *
 * GET /api/admin/test-weekly-briefing?password=...&email=user@example.com&send=true
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateWeeklyBriefing, WeeklyBriefing } from '@/lib/briefings/delivery/weekly-briefing-generator';
import { sendEmail } from '@/lib/send-email';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const email = searchParams.get('email')?.toLowerCase().trim();
  const sendIt = searchParams.get('send') === 'true';

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!email) {
    return NextResponse.json({ error: 'Email required (?email=...)' }, { status: 400 });
  }

  try {
    console.log(`[TestWeeklyBriefing] Generating for ${email}...`);

    const briefing = await generateWeeklyBriefing(email, {
      maxOpportunities: 10,
      maxTeamingPlays: 3,
    });

    if (!briefing) {
      return NextResponse.json({
        success: false,
        error: 'Briefing returned null - check profile or Anthropic config',
      });
    }

    // Generate email
    const subject = `📊 Weekly Deep Dive - ${briefing.opportunities.length} Strategic Opportunities for Week of ${briefing.weekOf}`;
    const htmlBody = generateWeeklyEmailHtml(briefing);

    // Optionally send
    let emailSent = false;
    if (sendIt) {
      try {
        await sendEmail({
          to: email,
          subject,
          html: htmlBody,
          text: `Weekly Deep Dive for ${email}\n\n${briefing.opportunities.length} opportunities analyzed.`,
        });
        emailSent = true;
        console.log(`[TestWeeklyBriefing] Email sent to ${email}`);
      } catch (emailErr) {
        console.error(`[TestWeeklyBriefing] Email failed:`, emailErr);
      }
    }

    return NextResponse.json({
      success: true,
      email,
      weekOf: briefing.weekOf,
      opportunities: briefing.opportunities.length,
      teamingPlays: briefing.teamingPlays.length,
      marketSignals: briefing.marketSignals.length,
      calendarItems: briefing.calendar.length,
      processingTimeMs: briefing.processingTimeMs,
      rawDataAnalyzed: briefing.rawDataSummary,
      emailSent,
      subject,
      briefing,
    });
  } catch (err) {
    console.error('[TestWeeklyBriefing] Error:', err);
    return NextResponse.json({
      success: false,
      error: String(err),
    }, { status: 500 });
  }
}

function generateWeeklyEmailHtml(briefing: WeeklyBriefing): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Weekly Deep Dive</title>
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background: #f3f4f6; }
    .container { max-width: 680px; margin: 0 auto; background: #ffffff; }
    .header { background: linear-gradient(135deg, #1e3a8a 0%, #7c3aed 100%); color: white; padding: 32px 24px; text-align: center; }
    .header h1 { margin: 0; font-size: 28px; font-weight: 700; }
    .header p { margin: 12px 0 0; font-size: 16px; opacity: 0.9; }
    .section { padding: 24px; border-bottom: 1px solid #e5e7eb; }
    .section h2 { margin: 0 0 16px; font-size: 20px; color: #1e3a8a; }
    .opportunity { background: #f9fafb; border-radius: 8px; padding: 20px; margin-bottom: 16px; border-left: 4px solid #7c3aed; }
    .opp-rank { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; background: #1e3a8a; color: white; border-radius: 50%; font-size: 14px; font-weight: 700; margin-right: 12px; }
    .opp-title { font-size: 17px; font-weight: 700; color: #111827; margin: 0 0 8px; }
    .opp-meta { font-size: 13px; color: #6b7280; margin-bottom: 8px; }
    .opp-value { font-size: 14px; font-weight: 600; color: #059669; }
    .opp-angle { font-size: 14px; color: #374151; margin-top: 12px; font-style: italic; }
    .teaming { background: #fef3c7; border-radius: 8px; padding: 16px; margin-bottom: 12px; }
    .teaming h4 { margin: 0 0 8px; color: #92400e; font-size: 15px; }
    .teaming p { margin: 4px 0; font-size: 14px; color: #78350f; }
    .signal { padding: 12px 0; border-bottom: 1px solid #e5e7eb; }
    .signal:last-child { border-bottom: none; }
    .signal-headline { font-weight: 600; color: #111827; font-size: 14px; }
    .signal-implication { font-size: 13px; color: #6b7280; margin-top: 4px; }
    .footer { background: #f9fafb; padding: 24px; text-align: center; }
    .footer p { margin: 0; font-size: 12px; color: #6b7280; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📊 Weekly Deep Dive</h1>
      <p>Week of ${briefing.weekOf}</p>
    </div>

    <div class="section">
      <h2>🎯 Top ${briefing.opportunities.length} Strategic Opportunities</h2>
      ${briefing.opportunities.map(opp => `
        <div class="opportunity">
          <div style="display: flex; align-items: flex-start;">
            <span class="opp-rank">${opp.rank}</span>
            <div>
              <h3 class="opp-title">${escapeHtml(opp.contractName)}</h3>
              <p class="opp-meta">${escapeHtml(opp.agency)} • ${escapeHtml(opp.incumbent)}</p>
              <p class="opp-value">${escapeHtml(opp.value)}</p>
              <p class="opp-angle">"${escapeHtml(opp.displacementAngle)}"</p>
            </div>
          </div>
        </div>
      `).join('')}
    </div>

    <div class="section">
      <h2>🤝 Teaming Plays</h2>
      ${briefing.teamingPlays.map(play => `
        <div class="teaming">
          <h4>#${play.playNumber}: ${escapeHtml(play.strategyName)}</h4>
          <p><strong>Target:</strong> ${escapeHtml(play.targetCompany)}</p>
          <p><strong>Why:</strong> ${play.whyTarget.map(escapeHtml).join(' • ')}</p>
        </div>
      `).join('')}
    </div>

    ${briefing.marketSignals.length > 0 ? `
    <div class="section">
      <h2>📡 Market Signals</h2>
      ${briefing.marketSignals.map(signal => `
        <div class="signal">
          <p class="signal-headline">${escapeHtml(signal.headline)}</p>
          <p class="signal-implication">${escapeHtml(signal.implication)}</p>
        </div>
      `).join('')}
    </div>
    ` : ''}

    <div class="footer">
      <p>This briefing was generated by <strong>GovCon Giants AI</strong></p>
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
