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
  MarketIntel,
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

    .intel { margin-bottom: 16px; padding: 14px 16px; background: #f0f9ff; border-left: 3px solid #0284c7; }
    .intel:last-child { margin-bottom: 0; }
    .intel-headline { font-size: 14px; font-weight: 600; color: #0c4a6e; margin: 0 0 6px; }
    .intel-headline a { color: #0284c7; text-decoration: none; }
    .intel-meta { font-size: 11px; color: #64748b; margin: 0 0 6px; }
    .intel-summary { font-size: 13px; color: #334155; margin: 0 0 4px; line-height: 1.5; }
    .intel-relevance { font-size: 12px; color: #0369a1; font-style: italic; margin: 0; }

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

    <!-- Section 3: Market Intel -->
    <div class="section">
      <h2 class="section-title">3) Market Intel — What's Moving This Week</h2>
      ${briefing.marketIntel.length > 0
        ? briefing.marketIntel.map(intel => renderMarketIntel(intel)).join('')
        : '<p style="font-size: 13px; color: #64748b;">No significant market news this period.</p>'
      }
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
 * Render a market intel item
 */
function renderMarketIntel(intel: MarketIntel): string {
  const categoryIcon: Record<string, string> = {
    award: '🏆',
    policy: '📋',
    budget: '💰',
    personnel: '👤',
    acquisition: '📑',
    other: '📰',
  };
  return `
    <div class="intel">
      <p class="intel-headline">${categoryIcon[intel.category] || '📰'} <a href="${escapeHtml(intel.url)}" target="_blank">${escapeHtml(intel.headline)}</a></p>
      <p class="intel-meta">${escapeHtml(intel.source)}${intel.publishedDate ? ` • ${intel.publishedDate}` : ''}</p>
      <p class="intel-summary">${escapeHtml(intel.summary)}</p>
      <p class="intel-relevance">→ ${escapeHtml(intel.relevance)}</p>
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
3) MARKET INTEL — WHAT'S MOVING THIS WEEK
================================================================================

`;

  if (briefing.marketIntel.length > 0) {
    for (const intel of briefing.marketIntel) {
      text += `${intel.headline}
   Source: ${intel.source}${intel.publishedDate ? ` (${intel.publishedDate})` : ''}
   ${intel.summary}
   → ${intel.relevance}
   ${intel.url}

`;
    }
  } else {
    text += `No significant market news this period.\n\n`;
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
  <title>Daily Recompete Intel</title>
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background: #0f172a; }
    .container { max-width: 680px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; margin-top: 20px; margin-bottom: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.15); }

    .header { background: linear-gradient(135deg, #1e3a8a 0%, #7c3aed 100%); color: white; padding: 28px 32px; }
    .header-badge { display: inline-block; background: rgba(255,255,255,0.2); padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px; }
    .header h1 { margin: 0; font-size: 24px; font-weight: 700; }
    .header .subtitle { margin: 8px 0 0; font-size: 14px; opacity: 0.9; }
    .header .date { margin: 4px 0 0; font-size: 12px; opacity: 0.7; }

    .stats-bar { background: #f8fafc; padding: 16px 32px; display: flex; gap: 32px; border-bottom: 1px solid #e2e8f0; }
    .stat { text-align: center; }
    .stat-value { font-size: 28px; font-weight: 700; color: #7c3aed; }
    .stat-label { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }

    .section { padding: 24px 32px; }
    .section-header { display: flex; align-items: center; gap: 10px; margin-bottom: 20px; }
    .section-icon { width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 16px; }
    .section-title { margin: 0; font-size: 14px; font-weight: 700; color: #1e293b; text-transform: uppercase; letter-spacing: 0.5px; }

    .opp-card { display: flex; margin-bottom: 16px; background: #f8fafc; border-radius: 10px; overflow: hidden; border: 1px solid #e2e8f0; }
    .opp-rank { width: 48px; background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%); color: white; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 700; }
    .opp-content { flex: 1; padding: 14px 16px; }
    .opp-name { font-size: 14px; font-weight: 600; color: #1e293b; margin: 0 0 4px; }
    .opp-meta { font-size: 12px; color: #64748b; margin: 0 0 8px; }
    .opp-meta .value { color: #059669; font-weight: 600; }
    .opp-angle { font-size: 12px; color: #475569; margin: 0; line-height: 1.5; }

    .play-card { background: #fef3c7; border-radius: 8px; padding: 14px 16px; margin-bottom: 12px; border-left: 4px solid #f59e0b; }
    .play-theme { font-size: 13px; font-weight: 600; color: #92400e; margin: 0 0 6px; }
    .play-detail { font-size: 12px; color: #78350f; margin: 0; line-height: 1.5; }

    .cta-section { background: linear-gradient(135deg, #7c3aed 0%, #a855f7 100%); padding: 20px 32px; text-align: center; }
    .cta-text { color: white; font-size: 13px; margin: 0 0 12px; opacity: 0.9; }
    .cta-button { display: inline-block; background: white; color: #7c3aed; padding: 10px 24px; border-radius: 6px; font-size: 13px; font-weight: 600; text-decoration: none; }

    .footer { background: #1e293b; padding: 20px 32px; text-align: center; }
    .footer p { margin: 0; font-size: 11px; color: #94a3b8; }
    .footer a { color: #a5b4fc; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <span class="header-badge">Daily Intel</span>
      <h1>Displacement Briefing</h1>
      <p class="subtitle">Top recompete opportunities ranked by vulnerability</p>
      <p class="date">${dateStr} • ${timeStr}</p>
    </div>

    <div class="stats-bar">
      <div class="stat">
        <div class="stat-value">${briefing.opportunities.length}</div>
        <div class="stat-label">Opportunities</div>
      </div>
      <div class="stat">
        <div class="stat-value">${briefing.teamingPlays.length}</div>
        <div class="stat-label">Teaming Plays</div>
      </div>
      <div class="stat">
        <div class="stat-value">$${calculateTotalValue(briefing.opportunities)}</div>
        <div class="stat-label">Total Value</div>
      </div>
    </div>

    <div class="section">
      <div class="section-header">
        <span class="section-icon" style="background: #dbeafe;">🎯</span>
        <h2 class="section-title">Top ${briefing.opportunities.length} Recompete Targets</h2>
      </div>
      ${briefing.opportunities.map((opp, idx) => `
        <div class="opp-card">
          <div class="opp-rank">${idx + 1}</div>
          <div class="opp-content">
            <p class="opp-name">${escapeHtml(opp.name)}</p>
            <p class="opp-meta"><span class="value">${escapeHtml(opp.value)}</span> • ${escapeHtml(opp.incumbent)}</p>
            <p class="opp-angle">${escapeHtml(truncateToSentence(opp.displacementAngle, 180))}</p>
          </div>
        </div>
      `).join('')}
    </div>

    <div class="section" style="background: #fffbeb; padding-top: 24px; padding-bottom: 24px;">
      <div class="section-header">
        <span class="section-icon" style="background: #fef3c7;">🤝</span>
        <h2 class="section-title">Teaming Plays</h2>
      </div>
      ${briefing.teamingPlays.map(play => `
        <div class="play-card">
          <p class="play-theme">${escapeHtml(play.theme)}</p>
          <p class="play-detail">Approach <strong>${play.primes.join(', ')}</strong> with ${escapeHtml(play.whatYouBring)}</p>
        </div>
      `).join('')}
    </div>

    <div class="cta-section">
      <p class="cta-text">Want full displacement analysis with action plans?</p>
      <a href="https://tools.govcongiants.org/briefings" class="cta-button">View Full Briefing →</a>
    </div>

    <div class="footer">
      <p>
        <strong>GovCon Giants AI</strong><br>
        <a href="https://tools.govcongiants.org/briefings/settings">Settings</a> •
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
 * Truncate text to nearest sentence ending within limit
 */
function truncateToSentence(text: string, maxLength: number): string {
  if (!text) return '';
  // Remove leading quotes/special chars
  let cleaned = text.replace(/^["'"\s]+/, '');

  if (cleaned.length <= maxLength) return cleaned;

  // Find the last sentence-ending punctuation within the limit
  const truncated = cleaned.substring(0, maxLength);
  const lastPeriod = truncated.lastIndexOf('.');
  const lastComma = truncated.lastIndexOf(',');

  // Prefer ending at a period, then comma, then just cut
  if (lastPeriod > maxLength * 0.6) {
    return truncated.substring(0, lastPeriod + 1);
  } else if (lastComma > maxLength * 0.6) {
    return truncated.substring(0, lastComma) + '...';
  }

  return truncated + '...';
}

/**
 * Calculate total value from opportunities
 */
function calculateTotalValue(opportunities: { value: string }[]): string {
  let totalMillions = 0;

  for (const opp of opportunities) {
    // Extract number from strings like "~$48M", "$30M", ">$100M", "$56M-$106M"
    const matches = opp.value.match(/\$?([\d.]+)M/gi);
    if (matches) {
      for (const match of matches) {
        const num = parseFloat(match.replace(/[^\d.]/g, ''));
        if (!isNaN(num)) totalMillions += num;
      }
    }
    // Check for billions
    const billionMatch = opp.value.match(/\$?([\d.]+)B/i);
    if (billionMatch) {
      const num = parseFloat(billionMatch[1]);
      if (!isNaN(num)) totalMillions += num * 1000;
    }
  }

  if (totalMillions >= 1000) {
    return `${(totalMillions / 1000).toFixed(1)}B+`;
  }
  return `${Math.round(totalMillions)}M+`;
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
