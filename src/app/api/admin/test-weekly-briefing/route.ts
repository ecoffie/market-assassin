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

const BRAND_COLOR = '#1e3a8a';
const ACCENT_COLOR = '#7c3aed';
const SUCCESS_COLOR = '#10b981';

function formatValue(value: string | number): string {
  const num = typeof value === 'string' ? parseFloat(value.replace(/[$,]/g, '')) : value;
  if (isNaN(num)) return String(value);
  if (num >= 1_000_000_000) return `$${(num / 1_000_000_000).toFixed(1)}B`;
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(0)}M`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(0)}K`;
  return `$${num}`;
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
    .play-target { font-size: 14px; color: #047857; margin: 8px 0; }
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
    .signal { padding: 12px 0; border-bottom: 1px solid #e5e7eb; }
    .signal:last-child { border-bottom: none; }
    .signal-headline { font-weight: 600; color: #111827; font-size: 14px; }
    .signal-implication { font-size: 13px; color: #6b7280; margin-top: 4px; }
    .footer { background: #f9fafb; padding: 24px; text-align: center; border-top: 1px solid #e5e7eb; }
    .footer p { margin: 0 0 8px; font-size: 12px; color: #6b7280; }
    .footer a { color: ${ACCENT_COLOR}; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div style="background: linear-gradient(135deg, #7c3aed 0%, #a855f7 100%); padding: 10px 20px; text-align: center;">
      <p style="color: white; margin: 0; font-size: 12px; font-weight: 600;">🎁 FREE DURING BETA • Full Market Intelligence at no charge!</p>
    </div>

    <div class="header">
      <h1>📊 Weekly Deep Dive</h1>
      <p>Week of ${briefing.weekOf} • ${briefing.opportunities.length} Opportunities Analyzed</p>
    </div>

    <div class="section">
      <div class="section-header">
        <h2>TOP ${briefing.opportunities.length} OPPORTUNITIES (Full Analysis)</h2>
      </div>
      ${briefing.opportunities.map(opp => `
        <div class="opportunity">
          <h3 class="opp-title">
            <span class="opp-rank">${opp.rank}</span>
            ${escapeHtml(opp.contractName)}
          </h3>
          <div style="margin-bottom: 12px;">
            <div class="opp-meta-row"><span class="opp-meta-label">Agency:</span><span class="opp-meta-value">${escapeHtml(opp.agency)}</span></div>
            <div class="opp-meta-row"><span class="opp-meta-label">Incumbent:</span><span class="opp-meta-value">${escapeHtml(opp.incumbent || 'Unknown')}</span></div>
            <div class="opp-meta-row"><span class="opp-meta-label">Value:</span><span class="opp-meta-value" style="color: ${SUCCESS_COLOR};">${formatValue(opp.value)}</span></div>
            <div class="opp-meta-row"><span class="opp-meta-label">Window:</span><span class="opp-meta-value">${escapeHtml(opp.window || '')}</span></div>
          </div>
          <div class="displacement-box">
            <div class="displacement-label">Displacement Angle</div>
            <p class="displacement-text">${escapeHtml(opp.displacementAngle)}</p>
          </div>
          ${opp.competitiveLandscape && opp.competitiveLandscape.length > 0 ? `
            <div class="landscape-box">
              <div class="landscape-label">Competitive Landscape</div>
              ${opp.competitiveLandscape.map((item: string) => `<div class="landscape-item">${escapeHtml(item)}</div>`).join('')}
            </div>
          ` : ''}
          ${(opp.yourPosition as { recommendedApproach?: string })?.recommendedApproach ? `<div style="font-size: 13px; color: #4b5563; margin-top: 12px;"><strong>Recommended Approach:</strong> ${escapeHtml((opp.yourPosition as { recommendedApproach?: string }).recommendedApproach || '')}</div>` : ''}
        </div>
      `).join('')}
    </div>

    <div class="section" style="background: #f0fdf4;">
      <div class="section-header">
        <h2>🤝 TEAMING PLAYS (with Outreach Templates)</h2>
      </div>
      ${briefing.teamingPlays.map(play => `
        <div class="teaming-play">
          <span class="play-number">PLAY ${play.playNumber}</span>
          <h3 class="play-name">${escapeHtml(play.strategyName)}</h3>
          <p class="play-target"><strong>Target:</strong> ${escapeHtml(play.targetCompany)}</p>
          <p style="font-size: 13px; color: #065f46; margin: 8px 0;"><strong>Why:</strong> ${play.whyTarget.map(escapeHtml).join(' • ')}</p>
          ${play.suggestedOpener ? `
            <div class="opener-box">
              <div class="opener-label">Suggested Opener</div>
              <p class="opener-text">"${escapeHtml(play.suggestedOpener)}"</p>
            </div>
          ` : ''}
        </div>
      `).join('')}
    </div>

    ${briefing.calendar && briefing.calendar.length > 0 ? `
      <div class="section" style="background: #faf5ff;">
        <div class="section-header">
          <h2>📅 KEY DATES (Next 30 Days)</h2>
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

    ${briefing.marketSignals.length > 0 ? `
    <div class="section">
      <div class="section-header">
        <h2>📡 Market Signals</h2>
      </div>
      ${briefing.marketSignals.map(signal => `
        <div class="signal">
          <p class="signal-headline">${signal.actionRequired ? '🔴 ' : ''}${escapeHtml(signal.headline)}</p>
          <p class="signal-implication">${escapeHtml(signal.implication)}</p>
        </div>
      `).join('')}
    </div>
    ` : ''}

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

function escapeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
