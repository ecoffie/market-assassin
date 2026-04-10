/**
 * AI Briefing Email Template
 *
 * Generates HTML/text emails for AI-powered market intel briefings.
 * Format: Top 10 Opportunities + 3 Ghosting/Teaming Plays
 */

import { AIGeneratedBriefing, AIBriefingOpportunity, AIBriefingTeamingPlay } from './ai-briefing-generator';

const BRAND_COLOR = '#1e3a8a'; // Navy blue
const ACCENT_COLOR = '#7c3aed'; // Purple
const SUCCESS_COLOR = '#10b981'; // Green

export interface AIEmailTemplate {
  subject: string;
  preheader: string;
  htmlBody: string;
  textBody: string;
}

/**
 * Generate email template from AI briefing
 */
export function generateAIEmailTemplate(briefing: AIGeneratedBriefing, userEmail?: string): AIEmailTemplate {
  const date = formatDate(briefing.briefingDate);
  const oppCount = briefing.opportunities.length;
  const topOpp = briefing.opportunities[0];

  // Subject line with top opportunity hook
  const subject = topOpp
    ? `🎯 ${oppCount} Displacement Opportunities - ${topOpp.agency.split('/')[0]} ${topOpp.value} recompete`
    : `🎯 ${oppCount} Displacement Opportunities - ${date}`;

  const preheader = topOpp?.displacementAngle || 'Your daily competitive intel briefing';

  return {
    subject,
    preheader,
    htmlBody: generateHtmlBody(briefing, date, userEmail),
    textBody: generateTextBody(briefing, date, userEmail),
  };
}

/**
 * Generate HTML email body
 */
function generateHtmlBody(briefing: AIGeneratedBriefing, date: string, userEmail?: string): string {
  const feedbackBaseUrl = 'https://tools.govcongiants.org/api/briefings/feedback';
  const feedbackParams = userEmail
    ? `?email=${encodeURIComponent(userEmail)}&date=${briefing.briefingDate}&type=daily`
    : '';
  const helpfulUrl = feedbackParams ? `${feedbackBaseUrl}${feedbackParams}&rating=helpful` : '';
  const notHelpfulUrl = feedbackParams ? `${feedbackBaseUrl}${feedbackParams}&rating=not_helpful` : '';
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Daily Market Intel</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background: #f3f4f6; }
    .container { max-width: 680px; margin: 0 auto; background: #ffffff; }
    .header { background: linear-gradient(135deg, ${BRAND_COLOR} 0%, ${ACCENT_COLOR} 100%); color: white; padding: 32px 24px; text-align: center; }
    .header h1 { margin: 0; font-size: 28px; font-weight: 700; letter-spacing: -0.5px; }
    .header p { margin: 12px 0 0; font-size: 16px; opacity: 0.9; }
    .section { padding: 24px; }
    .section-header { display: flex; align-items: center; margin-bottom: 20px; padding-bottom: 12px; border-bottom: 2px solid #e5e7eb; }
    .section-header h2 { margin: 0; font-size: 18px; color: ${BRAND_COLOR}; font-weight: 700; }
    .section-header .count { background: ${ACCENT_COLOR}; color: white; font-size: 14px; padding: 4px 12px; border-radius: 20px; margin-left: 12px; font-weight: 600; }
    .opportunity { background: #f9fafb; border-radius: 8px; padding: 20px; margin-bottom: 16px; border-left: 4px solid ${ACCENT_COLOR}; }
    .opp-rank { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; background: ${BRAND_COLOR}; color: white; border-radius: 50%; font-size: 14px; font-weight: 700; margin-right: 12px; }
    .opp-title { font-size: 17px; font-weight: 700; color: #111827; margin: 0 0 12px; line-height: 1.4; }
    .opp-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px; }
    .opp-meta-item { font-size: 13px; }
    .opp-meta-label { color: #6b7280; font-weight: 500; }
    .opp-meta-value { color: #111827; font-weight: 600; }
    .opp-value { color: ${SUCCESS_COLOR}; font-weight: 700; }
    .opp-displacement { background: #fef3c7; border-radius: 6px; padding: 12px; margin-top: 12px; }
    .opp-displacement-label { font-size: 11px; color: #92400e; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
    .opp-displacement-text { font-size: 14px; color: #78350f; line-height: 1.5; margin: 0; }
    .teaming-play { background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%); border-radius: 8px; padding: 20px; margin-bottom: 16px; border-left: 4px solid ${SUCCESS_COLOR}; }
    .play-header { display: flex; align-items: center; margin-bottom: 12px; }
    .play-number { background: ${SUCCESS_COLOR}; color: white; font-size: 12px; padding: 4px 10px; border-radius: 4px; font-weight: 700; margin-right: 10px; }
    .play-name { font-size: 16px; font-weight: 700; color: #065f46; margin: 0; }
    .play-targets { font-size: 13px; color: #047857; margin: 8px 0; }
    .play-rationale { font-size: 14px; color: #064e3b; line-height: 1.5; margin: 8px 0; }
    .play-opener { background: white; border-radius: 6px; padding: 14px; margin-top: 12px; border: 1px dashed #10b981; }
    .play-opener-label { font-size: 11px; color: #047857; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
    .play-opener-text { font-size: 13px; color: #1f2937; line-height: 1.5; margin: 0; font-style: italic; }
    .footer { background: #f9fafb; padding: 24px; text-align: center; border-top: 1px solid #e5e7eb; }
    .footer p { margin: 0 0 8px; font-size: 12px; color: #6b7280; }
    .footer a { color: ${ACCENT_COLOR}; text-decoration: none; }
    @media only screen and (max-width: 600px) {
      .opp-meta { grid-template-columns: 1fr; }
      .header h1 { font-size: 24px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Free Preview Banner -->
    <div style="background: linear-gradient(90deg, #f59e0b 0%, #f97316 100%); padding: 10px 20px; text-align: center;">
      <p style="color: white; margin: 0; font-size: 12px; font-weight: 600;">
        🎁 FREE PREVIEW • Exclusive displacement intel + teaming plays
      </p>
    </div>

    <!-- Header -->
    <div class="header">
      <h1>🎯 Daily Market Intel</h1>
      <p>${date}</p>
    </div>

    <!-- Top 10 Opportunities -->
    <div class="section">
      <div class="section-header">
        <h2>TOP RECOMPETE OPPORTUNITIES</h2>
        <span class="count">${briefing.opportunities.length} RANKED</span>
      </div>
      ${briefing.opportunities.map(opp => renderOpportunity(opp)).join('')}
    </div>

    <!-- Teaming Plays -->
    <div class="section" style="background: #f0fdf4;">
      <div class="section-header">
        <h2>🤝 GHOSTING/TEAMING PLAYS</h2>
        <span class="count" style="background: ${SUCCESS_COLOR};">${briefing.teamingPlays.length} PLAYS</span>
      </div>
      ${briefing.teamingPlays.map(play => renderTeamingPlay(play)).join('')}
    </div>

    <!-- Feedback Section -->
    ${userEmail ? `
    <div style="background: #f0f9ff; padding: 20px; text-align: center; border-top: 1px solid #e0f2fe;">
      <p style="margin: 0 0 12px; font-size: 14px; color: #0369a1; font-weight: 600;">
        Was this briefing helpful?
      </p>
      <div style="display: inline-block;">
        <a href="${helpfulUrl}" style="display: inline-block; padding: 10px 24px; margin: 0 8px; background: ${SUCCESS_COLOR}; color: white; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 600;">
          👍 Yes, helpful!
        </a>
        <a href="${notHelpfulUrl}" style="display: inline-block; padding: 10px 24px; margin: 0 8px; background: #6b7280; color: white; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 600;">
          👎 Needs work
        </a>
      </div>
      <p style="margin: 12px 0 0; font-size: 12px; color: #64748b;">
        Your feedback helps us improve your briefings
      </p>
    </div>
    ` : ''}

    <!-- Footer -->
    <div class="footer">
      <p>
        This briefing was generated by <strong>GovCon Giants AI</strong>.<br>
        <a href="https://tools.govcongiants.org/briefings">View in dashboard</a> |
        <a href="https://tools.govcongiants.org/briefings">Manage preferences</a>
      </p>
      <p style="margin-top: 12px;">
        © ${new Date().getFullYear()} GovCon Giants AI. All rights reserved.
      </p>
    </div>
  </div>
</body>
</html>
`;
}

/**
 * Render a single opportunity in HTML
 */
function renderOpportunity(opp: AIBriefingOpportunity): string {
  return `
    <div class="opportunity">
      <h3 class="opp-title">
        <span class="opp-rank">${opp.rank}</span>
        ${escapeHtml(opp.contractName)}
      </h3>
      <div class="opp-meta">
        <div class="opp-meta-item">
          <span class="opp-meta-label">Agency:</span>
          <span class="opp-meta-value">${escapeHtml(opp.agency)}</span>
        </div>
        <div class="opp-meta-item">
          <span class="opp-meta-label">Incumbent:</span>
          <span class="opp-meta-value">${escapeHtml(opp.incumbent)}</span>
        </div>
        <div class="opp-meta-item">
          <span class="opp-meta-label">Value:</span>
          <span class="opp-meta-value opp-value">${escapeHtml(opp.value)}</span>
        </div>
        <div class="opp-meta-item">
          <span class="opp-meta-label">Window:</span>
          <span class="opp-meta-value">${escapeHtml(opp.window)}</span>
        </div>
      </div>
      <div class="opp-displacement">
        <div class="opp-displacement-label">Displacement Angle</div>
        <p class="opp-displacement-text">${escapeHtml(opp.displacementAngle)}</p>
      </div>
    </div>
  `;
}

/**
 * Render a single teaming play in HTML
 */
function renderTeamingPlay(play: AIBriefingTeamingPlay): string {
  return `
    <div class="teaming-play">
      <div class="play-header">
        <span class="play-number">PLAY ${play.playNumber}</span>
        <h3 class="play-name">${escapeHtml(play.strategyName)}</h3>
      </div>
      <p class="play-targets"><strong>Target:</strong> ${play.targetPrimes.map(p => escapeHtml(p)).join(', ')}</p>
      <p class="play-rationale">${escapeHtml(play.rationale)}</p>
      <div class="play-opener">
        <div class="play-opener-label">Suggested Opener (Copy & Paste)</div>
        <p class="play-opener-text">"${escapeHtml(play.suggestedOpener)}"</p>
      </div>
    </div>
  `;
}

/**
 * Generate plain text email body
 */
function generateTextBody(briefing: AIGeneratedBriefing, date: string, userEmail?: string): string {
  const feedbackBaseUrl = 'https://tools.govcongiants.org/api/briefings/feedback';
  const feedbackParams = userEmail
    ? `?email=${encodeURIComponent(userEmail)}&date=${briefing.briefingDate}&type=daily`
    : '';
  let text = `
🎁 FREE PREVIEW - Exclusive displacement intel + teaming plays
========================================

🎯 DAILY MARKET INTEL
${date}
========================================

TOP ${briefing.opportunities.length} RECOMPETE OPPORTUNITIES (RANKED)
========================================

`;

  for (const opp of briefing.opportunities) {
    text += `
${opp.rank}. ${opp.contractName}

   Agency: ${opp.agency}
   Incumbent: ${opp.incumbent}
   Value: ${opp.value}
   Window: ${opp.window}

   DISPLACEMENT ANGLE: ${opp.displacementAngle}

----------------------------------------
`;
  }

  text += `

🤝 ${briefing.teamingPlays.length} GHOSTING/TEAMING PLAYS
========================================

`;

  for (const play of briefing.teamingPlays) {
    text += `
PLAY ${play.playNumber}: ${play.strategyName}

• Target: ${play.targetPrimes.join(', ')}
• ${play.rationale}

SUGGESTED OPENER:
"${play.suggestedOpener}"

----------------------------------------
`;
  }

  if (userEmail) {
    text += `
========================================
WAS THIS BRIEFING HELPFUL?
========================================

Yes, helpful: ${feedbackBaseUrl}${feedbackParams}&rating=helpful
Needs work: ${feedbackBaseUrl}${feedbackParams}&rating=not_helpful

Your feedback helps us improve your briefings.
`;
  }

  text += `
========================================

This briefing was generated by GovCon Giants AI.
View dashboard: https://tools.govcongiants.org/briefings
Manage preferences: https://tools.govcongiants.org/briefings

© ${new Date().getFullYear()} GovCon Giants AI. All rights reserved.
`;

  return text;
}

/**
 * Format date for display
 */
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Escape HTML entities
 */
function escapeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
