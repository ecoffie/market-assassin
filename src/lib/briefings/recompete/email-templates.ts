/**
 * Recompete Briefing Email Templates
 *
 * Generates emails matching Eric's exact format:
 * 1) Top 10 Recompete Opportunities (ranked)
 * 2) 3 Ghosting/Teaming Plays
 * 3) 3 Content Hooks for Eric
 * 4) Priority Scorecard — Must-Watch This Week (Top 3)
 */

import {
  RecompeteBriefing,
  CondensedBriefing,
  RecompeteOpportunity,
  TeamingPlay,
  ContentHook,
  PriorityScorecardEntry,
  RecompeteEmailTemplate,
} from './types';

/**
 * Generate full weekly briefing email
 */
export function generateFullBriefingEmail(briefing: RecompeteBriefing): RecompeteEmailTemplate {
  const date = new Date(briefing.generatedAt);
  const dateStr = date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const timeStr = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  });

  const subject = `Recompete Alerts (Daily Displacement Intel) — ${date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}`;
  const preheader = `Top ${briefing.opportunities.length} recompete opportunities ranked + teaming plays`;

  const htmlBody = generateFullHtmlBody(briefing, dateStr, timeStr);
  const textBody = generateFullTextBody(briefing, dateStr, timeStr);

  return { subject, preheader, htmlBody, textBody };
}

/**
 * Generate condensed daily briefing email
 */
export function generateCondensedBriefingEmail(briefing: CondensedBriefing): RecompeteEmailTemplate {
  const date = new Date(briefing.generatedAt);
  const dateStr = date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const timeStr = `4:15 AM ${briefing.timezone}`;

  const subject = `Daily Recompete Alerts — Displacement Intel (${dateStr})`;
  const preheader = `Top 10 recompete opportunities + 3 teaming plays`;

  const htmlBody = generateCondensedHtmlBody(briefing, dateStr, timeStr);
  const textBody = generateCondensedTextBody(briefing, dateStr, timeStr);

  return { subject, preheader, htmlBody, textBody };
}

/**
 * Generate full HTML body
 */
function generateFullHtmlBody(briefing: RecompeteBriefing, dateStr: string, timeStr: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Recompete Alerts - Daily Displacement Intel</title>
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background: #f5f5f5; }
    .container { max-width: 700px; margin: 0 auto; background: #ffffff; }
    .header { background: linear-gradient(135deg, #1a365d 0%, #2d3748 100%); color: white; padding: 24px 28px; }
    .header h1 { margin: 0; font-size: 22px; font-weight: 700; }
    .header .subtitle { margin: 8px 0 0; font-size: 13px; opacity: 0.9; }
    .header .date { margin: 4px 0 0; font-size: 12px; opacity: 0.7; }

    .section { padding: 24px 28px; border-bottom: 1px solid #e2e8f0; }
    .section-title { margin: 0 0 20px; font-size: 16px; font-weight: 700; color: #1a365d; text-transform: uppercase; letter-spacing: 0.5px; }

    .opportunity { margin-bottom: 24px; padding-bottom: 20px; border-bottom: 1px solid #edf2f7; }
    .opportunity:last-child { margin-bottom: 0; border-bottom: none; padding-bottom: 0; }
    .opp-header { display: flex; align-items: flex-start; margin-bottom: 8px; }
    .opp-rank { background: #3182ce; color: white; width: 24px; height: 24px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; margin-right: 12px; flex-shrink: 0; }
    .opp-name { font-size: 15px; font-weight: 600; color: #1a202c; margin: 0; }
    .opp-detail { font-size: 13px; color: #4a5568; margin: 6px 0 0 36px; line-height: 1.5; }
    .opp-detail strong { color: #2d3748; }
    .opp-vulnerable { background: #fff5f5; border-left: 3px solid #e53e3e; padding: 10px 12px; margin: 12px 0 0 36px; font-size: 13px; color: #c53030; line-height: 1.5; }

    .play { margin-bottom: 20px; padding: 16px; background: #f7fafc; border-radius: 8px; }
    .play:last-child { margin-bottom: 0; }
    .play-title { font-size: 14px; font-weight: 700; color: #2d3748; margin: 0 0 8px; }
    .play-primes { font-size: 13px; color: #4a5568; margin: 0 0 12px; }
    .play-primes strong { color: #2d3748; }
    .play-opener { font-size: 13px; color: #2d3748; background: #edf2f7; padding: 12px; border-radius: 6px; line-height: 1.6; font-style: italic; }

    .hook { margin-bottom: 16px; padding: 14px 16px; background: #f0fff4; border-left: 3px solid #38a169; }
    .hook:last-child { margin-bottom: 0; }
    .hook-title { font-size: 14px; font-weight: 600; color: #22543d; margin: 0 0 6px; }
    .hook-cta { font-size: 13px; color: #276749; margin: 0; }

    .scorecard-item { display: flex; margin-bottom: 16px; padding: 14px 16px; background: #fffbeb; border-radius: 8px; }
    .scorecard-item:last-child { margin-bottom: 0; }
    .scorecard-score { background: #d69e2e; color: white; font-size: 14px; font-weight: 700; padding: 8px 12px; border-radius: 6px; margin-right: 14px; white-space: nowrap; }
    .scorecard-content { flex: 1; }
    .scorecard-name { font-size: 14px; font-weight: 600; color: #744210; margin: 0 0 6px; }
    .scorecard-why { font-size: 12px; color: #975a16; margin: 0 0 4px; }
    .scorecard-action { font-size: 12px; color: #744210; font-weight: 500; margin: 0; }

    .footer { background: #f7fafc; padding: 20px 28px; text-align: center; }
    .footer p { margin: 0; font-size: 11px; color: #718096; }
    .footer a { color: #3182ce; text-decoration: none; }
    .sources { font-size: 11px; color: #a0aec0; margin-top: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <div class="header">
      <h1>Recompete Alerts (Daily Displacement Intel)</h1>
      <p class="subtitle">Your personalized recompete intelligence briefing</p>
      <p class="date">As of ${dateStr}, ${timeStr}</p>
    </div>

    <!-- Section 1: Top 10 Opportunities -->
    <div class="section">
      <h2 class="section-title">1) Top ${briefing.opportunities.length} Recompete Opportunities (Ranked)</h2>
      ${briefing.opportunities.map(opp => renderOpportunity(opp)).join('')}
    </div>

    <!-- Section 2: Teaming Plays -->
    <div class="section">
      <h2 class="section-title">2) ${briefing.teamingPlays.length} Ghosting/Teaming Plays</h2>
      ${briefing.teamingPlays.map((play, idx) => renderTeamingPlay(play, idx)).join('')}
    </div>

    <!-- Section 3: Content Hooks -->
    <div class="section">
      <h2 class="section-title">3) ${briefing.contentHooks.length} Content Hooks for Eric</h2>
      ${briefing.contentHooks.map(hook => renderContentHook(hook)).join('')}
    </div>

    <!-- Section 4: Priority Scorecard -->
    <div class="section">
      <h2 class="section-title">4) Priority Scorecard — Must-Watch This Week (Top 3)</h2>
      ${briefing.priorityScorecard.map(entry => renderScorecardEntry(entry)).join('')}
    </div>

    <!-- Footer -->
    <div class="footer">
      <p class="sources">
        <strong>Sources used:</strong> ${briefing.sourcesUsed.join(', ')}
      </p>
      <p style="margin-top: 16px;">
        This briefing was generated by <strong>GovCon Giants AI</strong>.<br>
        <a href="https://tools.govcongiants.org/briefings/settings">Manage preferences</a> |
        <a href="https://tools.govcongiants.org/briefings/unsubscribe">Unsubscribe</a>
      </p>
      <p style="margin-top: 8px;">
        © ${new Date().getFullYear()} GovCon Giants AI. All rights reserved.
      </p>
    </div>
  </div>
</body>
</html>
`;
}

/**
 * Render a single opportunity
 */
function renderOpportunity(opp: RecompeteOpportunity): string {
  return `
    <div class="opportunity">
      <div class="opp-header">
        <span class="opp-rank">${opp.rank}</span>
        <h3 class="opp-name">${escapeHtml(opp.contractName)} (${opp.agencyAcronym})</h3>
      </div>
      <p class="opp-detail"><strong>Agency:</strong> ${escapeHtml(opp.agency)}</p>
      <p class="opp-detail"><strong>Incumbent:</strong> ${escapeHtml(opp.incumbent)}${opp.incumbentYear ? ` (${opp.incumbentYear} award)` : ''}</p>
      <p class="opp-detail"><strong>Contract value:</strong> ${opp.contractValue}</p>
      <p class="opp-detail"><strong>Expected window / timing signal:</strong> ${escapeHtml(opp.timingSignal)}</p>
      <div class="opp-vulnerable">
        <strong>Why vulnerable (displacement angle):</strong> ${escapeHtml(opp.whyVulnerable)}
      </div>
    </div>
  `;
}

/**
 * Render a teaming play
 */
function renderTeamingPlay(play: TeamingPlay, idx: number): string {
  const letters = ['A', 'B', 'C'];
  return `
    <div class="play">
      <h4 class="play-title">Play ${letters[idx]}: "${play.playName}"</h4>
      <p class="play-primes"><strong>Primes to approach:</strong> ${play.primesToApproach.join(', ')}</p>
      ${play.targetOpportunityNames.length > 0 ? `<p class="play-primes"><strong>Target opportunities:</strong> ${play.targetOpportunityNames.join(', ')}</p>` : ''}
      <div class="play-opener">
        <strong>Suggested opener:</strong><br>
        ${escapeHtml(play.suggestedOpener)}
      </div>
    </div>
  `;
}

/**
 * Render a content hook
 */
function renderContentHook(hook: ContentHook): string {
  return `
    <div class="hook">
      <p class="hook-title"><strong>Title:</strong> "${escapeHtml(hook.title)}"</p>
      <p class="hook-cta"><strong>CTA:</strong> "${escapeHtml(hook.cta)}"</p>
    </div>
  `;
}

/**
 * Render a scorecard entry
 */
function renderScorecardEntry(entry: PriorityScorecardEntry): string {
  return `
    <div class="scorecard-item">
      <div class="scorecard-score">${entry.score}/10</div>
      <div class="scorecard-content">
        <p class="scorecard-name">${escapeHtml(entry.opportunityName)}</p>
        <p class="scorecard-why"><strong>Why now:</strong> ${escapeHtml(entry.whyNow)}</p>
        <p class="scorecard-action"><strong>Immediate action:</strong> ${escapeHtml(entry.immediateAction)}</p>
      </div>
    </div>
  `;
}

/**
 * Generate full text body
 */
function generateFullTextBody(briefing: RecompeteBriefing, dateStr: string, timeStr: string): string {
  let text = `RECOMPETE ALERTS (DAILY DISPLACEMENT INTEL)
As of ${dateStr}, ${timeStr}

================================================================================
1) TOP ${briefing.opportunities.length} RECOMPETE OPPORTUNITIES (RANKED)
================================================================================

`;

  for (const opp of briefing.opportunities) {
    text += `${opp.rank}) ${opp.contractName} (${opp.agencyAcronym})
   Agency: ${opp.agency}
   Incumbent: ${opp.incumbent}
   Contract value: ${opp.contractValue}
   Expected window / timing signal: ${opp.timingSignal}
   Why vulnerable (displacement angle): ${opp.whyVulnerable}

`;
  }

  text += `================================================================================
2) ${briefing.teamingPlays.length} GHOSTING/TEAMING PLAYS
================================================================================

`;

  const letters = ['A', 'B', 'C'];
  for (let i = 0; i < briefing.teamingPlays.length; i++) {
    const play = briefing.teamingPlays[i];
    text += `Play ${letters[i]}: "${play.playName}"
   Primes to approach: ${play.primesToApproach.join(', ')}
   Target opportunities: ${play.targetOpportunityNames.join(', ')}
   Suggested opener:
   ${play.suggestedOpener}

`;
  }

  text += `================================================================================
3) ${briefing.contentHooks.length} CONTENT HOOKS FOR ERIC
================================================================================

`;

  for (const hook of briefing.contentHooks) {
    text += `Title: "${hook.title}"
CTA: "${hook.cta}"

`;
  }

  text += `================================================================================
4) PRIORITY SCORECARD — MUST-WATCH THIS WEEK (TOP 3)
================================================================================

`;

  for (const entry of briefing.priorityScorecard) {
    text += `${entry.opportunityName} — Score: ${entry.score}/10
   Why now: ${entry.whyNow}
   Immediate action: ${entry.immediateAction}

`;
  }

  text += `================================================================================

Sources used: ${briefing.sourcesUsed.join(', ')}

This briefing was generated by GovCon Giants AI.
Manage preferences: https://tools.govcongiants.org/briefings/settings
Unsubscribe: https://tools.govcongiants.org/briefings/unsubscribe

© ${new Date().getFullYear()} GovCon Giants AI. All rights reserved.
`;

  return text;
}

/**
 * Generate condensed HTML body
 */
function generateCondensedHtmlBody(briefing: CondensedBriefing, dateStr: string, timeStr: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Daily Recompete Alerts</title>
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background: #f5f5f5; }
    .container { max-width: 650px; margin: 0 auto; background: #ffffff; }
    .header { background: #1a365d; color: white; padding: 20px 24px; }
    .header h1 { margin: 0; font-size: 18px; font-weight: 600; }
    .header .date { margin: 6px 0 0; font-size: 12px; opacity: 0.8; }
    .section { padding: 20px 24px; border-bottom: 1px solid #e2e8f0; }
    .section-title { margin: 0 0 14px; font-size: 13px; font-weight: 700; color: #1a365d; text-transform: uppercase; }
    .opp-line { font-size: 13px; color: #2d3748; margin: 0 0 10px; line-height: 1.5; }
    .opp-line strong { color: #1a365d; }
    .opp-line em { color: #718096; font-style: normal; }
    .play-line { font-size: 13px; color: #2d3748; margin: 0 0 8px; line-height: 1.5; }
    .footer { background: #f7fafc; padding: 16px 24px; text-align: center; }
    .footer p { margin: 0; font-size: 11px; color: #718096; }
    .footer a { color: #3182ce; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Daily Recompete Alerts — Displacement Intel</h1>
      <p class="date">As of: ${dateStr}, ${timeStr}</p>
    </div>

    <div class="section">
      <h2 class="section-title">Top ${briefing.opportunities.length} recompete opportunities (ranked)</h2>
      ${briefing.opportunities.map((opp, idx) => `
        <p class="opp-line"><strong>${opp.name}</strong> (${opp.incumbent}) — <em>${opp.value}</em>; ${opp.displacementAngle}</p>
      `).join('')}
    </div>

    <div class="section">
      <h2 class="section-title">${briefing.teamingPlays.length} ghosting/teaming plays</h2>
      ${briefing.teamingPlays.map(play => `
        <p class="play-line"><strong>${play.theme}:</strong> approach ${play.primes.join('/')} with ${play.whatYouBring}.</p>
      `).join('')}
    </div>

    <div class="footer">
      <p>
        GovCon Giants AI<br>
        <a href="https://tools.govcongiants.org/briefings/settings">Settings</a> |
        <a href="https://tools.govcongiants.org/briefings/unsubscribe">Unsubscribe</a>
      </p>
    </div>
  </div>
</body>
</html>
`;
}

/**
 * Generate condensed text body
 */
function generateCondensedTextBody(briefing: CondensedBriefing, dateStr: string, timeStr: string): string {
  let text = `Daily Recompete Alerts — Displacement Intel
As of: ${dateStr}, ${timeStr}

Top ${briefing.opportunities.length} recompete opportunities (ranked)
`;

  for (const opp of briefing.opportunities) {
    text += `${opp.name} (${opp.incumbent}) — ${opp.value}; ${opp.displacementAngle}\n`;
  }

  text += `\n${briefing.teamingPlays.length} ghosting/teaming plays\n`;

  for (const play of briefing.teamingPlays) {
    text += `${play.theme}: approach ${play.primes.join('/')} with ${play.whatYouBring}.\n`;
  }

  text += `\n---\nGovCon Giants AI\nSettings: https://tools.govcongiants.org/briefings/settings\n`;

  return text;
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
