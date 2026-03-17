/**
 * MA Briefing Email Templates
 *
 * Generates emails with:
 * 1) Budget & Spending Shifts
 * 2) Pain Point Updates
 * 3) Competitor Activity
 * 4) Capture Signals
 */

import {
  MABriefing,
  CondensedMABriefing,
  BudgetShift,
  PainPointUpdate,
  CompetitorActivity,
  CaptureSignal,
  MAEmailTemplate,
} from './types';

/**
 * Generate full MA briefing email
 */
export function generateMABriefingEmail(briefing: MABriefing): MAEmailTemplate {
  const date = new Date(briefing.generatedAt);
  const dateStr = date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const subject = `Market Intel Briefing — ${date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}`;
  const preheader = `${briefing.summary.totalAlerts} alerts: ${briefing.summary.newOpportunities} opportunities, ${briefing.competitorActivity.length} competitor moves`;

  const htmlBody = generateFullHtmlBody(briefing, dateStr);
  const textBody = generateFullTextBody(briefing, dateStr);

  return { subject, preheader, htmlBody, textBody };
}

/**
 * Generate condensed MA briefing email
 */
export function generateCondensedMABriefingEmail(briefing: CondensedMABriefing): MAEmailTemplate {
  const date = new Date(briefing.generatedAt);
  const dateStr = date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const subject = `Quick Market Intel — ${dateStr}`;
  const preheader = `${briefing.newSignalsCount} new signals, ${briefing.competitorMovesCount} competitor moves`;

  const htmlBody = generateCondensedHtmlBody(briefing, dateStr);
  const textBody = generateCondensedTextBody(briefing, dateStr);

  return { subject, preheader, htmlBody, textBody };
}

/**
 * Generate full HTML body
 */
function generateFullHtmlBody(briefing: MABriefing, dateStr: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Market Intel Briefing</title>
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background: #f5f5f5; }
    .container { max-width: 700px; margin: 0 auto; background: #ffffff; }
    .header { background: linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%); color: white; padding: 24px 28px; }
    .header h1 { margin: 0; font-size: 22px; font-weight: 700; }
    .header .subtitle { margin: 8px 0 0; font-size: 13px; opacity: 0.9; }
    .header .date { margin: 4px 0 0; font-size: 12px; opacity: 0.7; }

    .summary { background: #f8fafc; padding: 16px 28px; border-bottom: 1px solid #e2e8f0; display: flex; gap: 20px; flex-wrap: wrap; }
    .stat { text-align: center; }
    .stat-value { font-size: 24px; font-weight: 700; color: #4f46e5; }
    .stat-label { font-size: 11px; color: #64748b; text-transform: uppercase; }

    .section { padding: 24px 28px; border-bottom: 1px solid #e2e8f0; }
    .section-title { margin: 0 0 20px; font-size: 16px; font-weight: 700; color: #1e293b; text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; gap: 8px; }
    .section-icon { width: 24px; height: 24px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 14px; }

    .item { margin-bottom: 20px; padding: 16px; background: #f8fafc; border-radius: 8px; border-left: 4px solid #4f46e5; }
    .item:last-child { margin-bottom: 0; }
    .item-header { font-size: 14px; font-weight: 600; color: #1e293b; margin: 0 0 8px; }
    .item-badge { display: inline-block; font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 4px; margin-left: 8px; }
    .badge-increase { background: #dcfce7; color: #166534; }
    .badge-decrease { background: #fee2e2; color: #991b1b; }
    .badge-new { background: #dbeafe; color: #1e40af; }
    .badge-urgent { background: #fef3c7; color: #92400e; }
    .item-body { font-size: 13px; color: #475569; line-height: 1.6; margin: 0 0 8px; }
    .item-action { font-size: 12px; color: #4f46e5; font-weight: 500; margin: 0; }
    .item-source { font-size: 11px; color: #94a3b8; margin: 8px 0 0; }

    .competitor-item { border-left-color: #f59e0b; }
    .signal-item { border-left-color: #10b981; }
    .pain-item { border-left-color: #ef4444; }

    .footer { background: #f8fafc; padding: 20px 28px; text-align: center; }
    .footer p { margin: 0; font-size: 11px; color: #64748b; }
    .footer a { color: #4f46e5; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <div class="header">
      <h1>Market Intel Briefing</h1>
      <p class="subtitle">Your personalized GovCon market intelligence</p>
      <p class="date">${dateStr}</p>
    </div>

    <!-- Summary Stats -->
    <div class="summary">
      <div class="stat">
        <div class="stat-value">${briefing.summary.totalAlerts}</div>
        <div class="stat-label">Total Alerts</div>
      </div>
      <div class="stat">
        <div class="stat-value">${briefing.summary.newOpportunities}</div>
        <div class="stat-label">Capture Signals</div>
      </div>
      <div class="stat">
        <div class="stat-value">${briefing.competitorActivity.length}</div>
        <div class="stat-label">Competitor Moves</div>
      </div>
      <div class="stat">
        <div class="stat-value">${briefing.summary.agenciesCovered.length}</div>
        <div class="stat-label">Agencies Tracked</div>
      </div>
    </div>

    <!-- Section 1: Budget Shifts -->
    ${briefing.budgetShifts.length > 0 ? `
    <div class="section">
      <h2 class="section-title">
        <span class="section-icon" style="background: #dbeafe;">💰</span>
        Budget & Spending Shifts
      </h2>
      ${briefing.budgetShifts.map(shift => renderBudgetShift(shift)).join('')}
    </div>
    ` : ''}

    <!-- Section 2: Pain Points -->
    ${briefing.painPointUpdates.length > 0 ? `
    <div class="section">
      <h2 class="section-title">
        <span class="section-icon" style="background: #fee2e2;">🎯</span>
        Pain Point Updates
      </h2>
      ${briefing.painPointUpdates.map(pp => renderPainPoint(pp)).join('')}
    </div>
    ` : ''}

    <!-- Section 3: Competitor Activity -->
    ${briefing.competitorActivity.length > 0 ? `
    <div class="section">
      <h2 class="section-title">
        <span class="section-icon" style="background: #fef3c7;">👀</span>
        Competitor Activity
      </h2>
      ${briefing.competitorActivity.map(comp => renderCompetitor(comp)).join('')}
    </div>
    ` : ''}

    <!-- Section 4: Capture Signals -->
    ${briefing.captureSignals.length > 0 ? `
    <div class="section">
      <h2 class="section-title">
        <span class="section-icon" style="background: #dcfce7;">📡</span>
        Capture Signals
      </h2>
      ${briefing.captureSignals.map(signal => renderSignal(signal)).join('')}
    </div>
    ` : ''}

    <!-- Footer -->
    <div class="footer">
      <p style="margin-bottom: 12px;">
        <strong>Sources:</strong> ${briefing.sourcesUsed.join(', ')}
      </p>
      <p>
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
 * Render budget shift item
 */
function renderBudgetShift(shift: BudgetShift): string {
  const badgeClass = shift.shiftType === 'increase' ? 'badge-increase' : 'badge-decrease';
  const badgeText = shift.shiftType === 'increase' ? '↑ INCREASE' : '↓ DECREASE';

  return `
    <div class="item">
      <p class="item-header">
        ${escapeHtml(shift.agency)} (${shift.agencyAcronym})
        <span class="item-badge ${badgeClass}">${badgeText}</span>
      </p>
      <p class="item-body"><strong>${shift.amount}</strong> — ${escapeHtml(shift.description)}</p>
      <p class="item-action">→ ${escapeHtml(shift.impactOnUser)}</p>
      <p class="item-source">Source: ${escapeHtml(shift.source)}</p>
    </div>
  `;
}

/**
 * Render pain point item
 */
function renderPainPoint(pp: PainPointUpdate): string {
  return `
    <div class="item pain-item">
      <p class="item-header">
        ${escapeHtml(pp.agency)} (${pp.agencyAcronym})
        <span class="item-badge badge-new">${pp.updateType.toUpperCase()}</span>
      </p>
      <p class="item-body">${escapeHtml(pp.painPoint)}</p>
      <p class="item-action">→ ${escapeHtml(pp.opportunityAngle)}</p>
      <p class="item-source">Source: ${escapeHtml(pp.source)}</p>
    </div>
  `;
}

/**
 * Render competitor item
 */
function renderCompetitor(comp: CompetitorActivity): string {
  return `
    <div class="item competitor-item">
      <p class="item-header">
        ${escapeHtml(comp.companyName)}
        <span class="item-badge badge-urgent">${comp.activityType.toUpperCase()}</span>
      </p>
      <p class="item-body">${escapeHtml(comp.description)}${comp.amount ? ` (${comp.amount})` : ''}</p>
      <p class="item-action">→ ${escapeHtml(comp.implication)}</p>
      <p class="item-source">Source: ${escapeHtml(comp.source)}</p>
    </div>
  `;
}

/**
 * Render capture signal item
 */
function renderSignal(signal: CaptureSignal): string {
  return `
    <div class="item signal-item">
      <p class="item-header">
        ${escapeHtml(signal.title)}
        <span class="item-badge badge-new">${signal.signalType.replace('_', ' ').toUpperCase()}</span>
      </p>
      <p class="item-body">${escapeHtml(signal.agency)} — ${escapeHtml(signal.description.substring(0, 150))}...</p>
      <p class="item-action">→ ${escapeHtml(signal.actionRequired)}</p>
      ${signal.actionUrl ? `<p class="item-source"><a href="${escapeHtml(signal.actionUrl)}" target="_blank">View Details →</a></p>` : ''}
    </div>
  `;
}

/**
 * Generate full text body
 */
function generateFullTextBody(briefing: MABriefing, dateStr: string): string {
  let text = `MARKET INTEL BRIEFING
${dateStr}

SUMMARY
- Total Alerts: ${briefing.summary.totalAlerts}
- Capture Signals: ${briefing.summary.newOpportunities}
- Competitor Moves: ${briefing.competitorActivity.length}
- Agencies: ${briefing.summary.agenciesCovered.join(', ')}

================================================================================
1) BUDGET & SPENDING SHIFTS
================================================================================
`;

  for (const shift of briefing.budgetShifts) {
    text += `
${shift.agency} (${shift.agencyAcronym}) — ${shift.shiftType.toUpperCase()}
${shift.amount}
${shift.description}
→ ${shift.impactOnUser}
Source: ${shift.source}
`;
  }

  text += `
================================================================================
2) PAIN POINT UPDATES
================================================================================
`;

  for (const pp of briefing.painPointUpdates) {
    text += `
${pp.agency} (${pp.agencyAcronym})
${pp.painPoint}
→ ${pp.opportunityAngle}
Source: ${pp.source}
`;
  }

  text += `
================================================================================
3) COMPETITOR ACTIVITY
================================================================================
`;

  for (const comp of briefing.competitorActivity) {
    text += `
${comp.companyName} — ${comp.activityType.toUpperCase()}
${comp.description}
→ ${comp.implication}
Source: ${comp.source}
`;
  }

  text += `
================================================================================
4) CAPTURE SIGNALS
================================================================================
`;

  for (const signal of briefing.captureSignals) {
    text += `
${signal.title}
${signal.agency} — ${signal.signalType.replace('_', ' ')}
${signal.description.substring(0, 200)}...
→ ${signal.actionRequired}
${signal.actionUrl || ''}
`;
  }

  text += `
================================================================================

Sources: ${briefing.sourcesUsed.join(', ')}

This briefing was generated by GovCon Giants AI.
Manage: https://tools.govcongiants.org/briefings/settings

© ${new Date().getFullYear()} GovCon Giants AI
`;

  return text;
}

/**
 * Generate condensed HTML body
 */
function generateCondensedHtmlBody(briefing: CondensedMABriefing, dateStr: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Quick Market Intel</title>
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background: #f5f5f5; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; }
    .header { background: #4f46e5; color: white; padding: 16px 24px; }
    .header h1 { margin: 0; font-size: 18px; font-weight: 600; }
    .header .date { margin: 4px 0 0; font-size: 12px; opacity: 0.8; }
    .section { padding: 16px 24px; border-bottom: 1px solid #e2e8f0; }
    .section-title { font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; margin: 0 0 8px; }
    .item { font-size: 14px; color: #1e293b; margin: 0; line-height: 1.5; }
    .footer { background: #f8fafc; padding: 12px 24px; text-align: center; }
    .footer p { margin: 0; font-size: 11px; color: #64748b; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Quick Market Intel</h1>
      <p class="date">${dateStr} • ${briefing.newSignalsCount} signals, ${briefing.competitorMovesCount} competitor moves</p>
    </div>

    ${briefing.topBudgetShift ? `
    <div class="section">
      <p class="section-title">💰 Budget Alert</p>
      <p class="item"><strong>${briefing.topBudgetShift.agency}:</strong> ${briefing.topBudgetShift.summary}</p>
    </div>
    ` : ''}

    ${briefing.topPainPoint ? `
    <div class="section">
      <p class="section-title">🎯 Pain Point</p>
      <p class="item"><strong>${briefing.topPainPoint.agency}:</strong> ${briefing.topPainPoint.summary}</p>
    </div>
    ` : ''}

    ${briefing.topCompetitorMove ? `
    <div class="section">
      <p class="section-title">👀 Competitor</p>
      <p class="item"><strong>${briefing.topCompetitorMove.company}:</strong> ${briefing.topCompetitorMove.summary}</p>
    </div>
    ` : ''}

    ${briefing.topCaptureSignal ? `
    <div class="section">
      <p class="section-title">📡 Capture Signal</p>
      <p class="item"><strong>${briefing.topCaptureSignal.agency}:</strong> ${briefing.topCaptureSignal.title}${briefing.topCaptureSignal.deadline ? ` (Due: ${briefing.topCaptureSignal.deadline})` : ''}</p>
    </div>
    ` : ''}

    <div class="footer">
      <p>GovCon Giants AI • <a href="https://tools.govcongiants.org/briefings" style="color: #4f46e5;">View Full Briefing</a></p>
    </div>
  </div>
</body>
</html>
`;
}

/**
 * Generate condensed text body
 */
function generateCondensedTextBody(briefing: CondensedMABriefing, dateStr: string): string {
  let text = `QUICK MARKET INTEL — ${dateStr}
${briefing.newSignalsCount} signals, ${briefing.competitorMovesCount} competitor moves

`;

  if (briefing.topBudgetShift) {
    text += `BUDGET: ${briefing.topBudgetShift.agency} — ${briefing.topBudgetShift.summary}\n`;
  }
  if (briefing.topPainPoint) {
    text += `PAIN POINT: ${briefing.topPainPoint.agency} — ${briefing.topPainPoint.summary}\n`;
  }
  if (briefing.topCompetitorMove) {
    text += `COMPETITOR: ${briefing.topCompetitorMove.company} — ${briefing.topCompetitorMove.summary}\n`;
  }
  if (briefing.topCaptureSignal) {
    text += `SIGNAL: ${briefing.topCaptureSignal.agency} — ${briefing.topCaptureSignal.title}\n`;
  }

  text += `\nFull briefing: https://tools.govcongiants.org/briefings\n`;

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
