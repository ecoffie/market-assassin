/**
 * Contractor DB Briefing Email Templates
 *
 * Generates emails with:
 * 1) Top Teaming Opportunities
 * 2) SBLO Contact Updates
 * 3) New Subcontracting Plans
 * 4) Partnership Signals
 */

import {
  ContractorDBBriefing,
  CondensedContractorDBBriefing,
  TeamingOpportunity,
  SBLOUpdate,
  SubcontractingPlan,
  PartnershipSignal,
  ContractorDBEmailTemplate,
} from './types';

/**
 * Generate full contractor DB briefing email
 */
export function generateContractorDBBriefingEmail(briefing: ContractorDBBriefing): ContractorDBEmailTemplate {
  const date = new Date(briefing.generatedAt);
  const dateStr = date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const subject = `Teaming Intel Briefing - ${date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}`;
  const preheader = `${briefing.summary.totalOpportunities} teaming opportunities, ${briefing.summary.newSbloContacts} SBLO contacts`;

  const htmlBody = generateFullHtmlBody(briefing, dateStr);
  const textBody = generateFullTextBody(briefing, dateStr);

  return { subject, preheader, htmlBody, textBody };
}

/**
 * Generate condensed contractor DB briefing email
 */
export function generateCondensedContractorDBBriefingEmail(briefing: CondensedContractorDBBriefing): ContractorDBEmailTemplate {
  const date = new Date(briefing.generatedAt);
  const dateStr = date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const subject = `Quick Teaming Intel - ${dateStr}`;
  const preheader = `${briefing.teamingOppsCount} teaming opportunities today`;

  const htmlBody = generateCondensedHtmlBody(briefing, dateStr);
  const textBody = generateCondensedTextBody(briefing, dateStr);

  return { subject, preheader, htmlBody, textBody };
}

/**
 * Generate full HTML body
 */
function generateFullHtmlBody(briefing: ContractorDBBriefing, dateStr: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Teaming Intel Briefing</title>
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background: #f5f5f5; }
    .container { max-width: 700px; margin: 0 auto; background: #ffffff; }
    .header { background: linear-gradient(135deg, #059669 0%, #10b981 100%); color: white; padding: 24px 28px; }
    .header h1 { margin: 0; font-size: 22px; font-weight: 700; }
    .header .subtitle { margin: 8px 0 0; font-size: 13px; opacity: 0.9; }
    .header .date { margin: 4px 0 0; font-size: 12px; opacity: 0.7; }

    .summary { background: #f8fafc; padding: 16px 28px; border-bottom: 1px solid #e2e8f0; display: flex; gap: 20px; flex-wrap: wrap; }
    .stat { text-align: center; }
    .stat-value { font-size: 24px; font-weight: 700; color: #059669; }
    .stat-label { font-size: 11px; color: #64748b; text-transform: uppercase; }

    .section { padding: 24px 28px; border-bottom: 1px solid #e2e8f0; }
    .section-title { margin: 0 0 20px; font-size: 16px; font-weight: 700; color: #1e293b; text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; gap: 8px; }
    .section-icon { width: 24px; height: 24px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 14px; }

    .opp-card { margin-bottom: 20px; padding: 16px; background: #f8fafc; border-radius: 8px; border-left: 4px solid #059669; }
    .opp-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }
    .opp-company { font-size: 15px; font-weight: 600; color: #1e293b; margin: 0; }
    .opp-score { background: #059669; color: white; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
    .opp-meta { font-size: 12px; color: #64748b; margin: 0 0 8px; }
    .opp-reasons { font-size: 12px; color: #475569; margin: 0 0 8px; }
    .opp-action { font-size: 12px; color: #059669; font-weight: 500; margin: 0; }
    .opp-contact { font-size: 12px; color: #1e293b; background: #ecfdf5; padding: 8px 12px; border-radius: 4px; margin-top: 8px; }

    .sblo-card { margin-bottom: 16px; padding: 12px 16px; background: #eff6ff; border-radius: 8px; border-left: 4px solid #3b82f6; }
    .sblo-company { font-size: 14px; font-weight: 600; color: #1e293b; margin: 0 0 4px; }
    .sblo-contact { font-size: 13px; color: #1e40af; margin: 0 0 4px; }
    .sblo-insight { font-size: 12px; color: #475569; margin: 0; }

    .subk-card { margin-bottom: 16px; padding: 12px 16px; background: #fef3c7; border-radius: 8px; border-left: 4px solid #f59e0b; }
    .subk-company { font-size: 14px; font-weight: 600; color: #1e293b; margin: 0 0 4px; }
    .subk-meta { font-size: 12px; color: #92400e; margin: 0 0 4px; }
    .subk-opp { font-size: 12px; color: #475569; margin: 0; }

    .signal-card { margin-bottom: 16px; padding: 12px 16px; background: #f8fafc; border-radius: 8px; border-left: 4px solid #8b5cf6; }
    .signal-headline { font-size: 14px; font-weight: 600; color: #1e293b; margin: 0 0 4px; }
    .signal-headline a { color: #1e293b; text-decoration: none; }
    .signal-meta { font-size: 11px; color: #64748b; margin: 0 0 4px; }
    .signal-relevance { font-size: 12px; color: #475569; margin: 0; }

    .footer { background: #f8fafc; padding: 20px 28px; text-align: center; }
    .footer p { margin: 0; font-size: 11px; color: #64748b; }
    .footer a { color: #059669; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Teaming Intel Briefing</h1>
      <p class="subtitle">Your daily contractor teaming opportunities</p>
      <p class="date">${dateStr}</p>
    </div>

    <div class="summary">
      <div class="stat">
        <div class="stat-value">${briefing.summary.totalOpportunities}</div>
        <div class="stat-label">Teaming Opps</div>
      </div>
      <div class="stat">
        <div class="stat-value">${briefing.summary.newSbloContacts}</div>
        <div class="stat-label">SBLO Contacts</div>
      </div>
      <div class="stat">
        <div class="stat-value">${briefing.summary.newSubkPlans}</div>
        <div class="stat-label">SubK Plans</div>
      </div>
      <div class="stat">
        <div class="stat-value">${briefing.summary.partnershipSignals}</div>
        <div class="stat-label">Signals</div>
      </div>
    </div>

    ${briefing.teamingOpportunities.length > 0 ? `
    <div class="section">
      <h2 class="section-title">
        <span class="section-icon" style="background: #dcfce7;">🤝</span>
        Top Teaming Opportunities
      </h2>
      ${briefing.teamingOpportunities.map(opp => renderTeamingOpp(opp)).join('')}
    </div>
    ` : ''}

    ${briefing.sbloUpdates.length > 0 ? `
    <div class="section">
      <h2 class="section-title">
        <span class="section-icon" style="background: #dbeafe;">👤</span>
        SBLO Contacts
      </h2>
      ${briefing.sbloUpdates.map(update => renderSBLOUpdate(update)).join('')}
    </div>
    ` : ''}

    ${briefing.newSubcontractingPlans.length > 0 ? `
    <div class="section">
      <h2 class="section-title">
        <span class="section-icon" style="background: #fef3c7;">📋</span>
        Subcontracting Plans
      </h2>
      ${briefing.newSubcontractingPlans.map(plan => renderSubkPlan(plan)).join('')}
    </div>
    ` : ''}

    ${briefing.partnershipSignals.length > 0 ? `
    <div class="section">
      <h2 class="section-title">
        <span class="section-icon" style="background: #ede9fe;">📰</span>
        Partnership Signals
      </h2>
      ${briefing.partnershipSignals.map(signal => renderSignal(signal)).join('')}
    </div>
    ` : ''}

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
 * Render teaming opportunity card
 */
function renderTeamingOpp(opp: TeamingOpportunity): string {
  return `
    <div class="opp-card">
      <div class="opp-header">
        <p class="opp-company">${escapeHtml(opp.company)}</p>
        <span class="opp-score">${opp.teamingScore}/100</span>
      </div>
      <p class="opp-meta">${escapeHtml(opp.contractValue)} • ${opp.agencies.slice(0, 2).join(', ')}</p>
      <p class="opp-reasons">${opp.teamingReasons.slice(0, 3).join(' • ')}</p>
      <p class="opp-action">→ ${escapeHtml(opp.suggestedAction)}</p>
      ${opp.sbloEmail ? `
      <div class="opp-contact">
        <strong>SBLO:</strong> ${escapeHtml(opp.sbloName || 'Contact')} •
        <a href="mailto:${escapeHtml(opp.sbloEmail)}" style="color: #059669;">${escapeHtml(opp.sbloEmail)}</a>
        ${opp.sbloPhone ? ` • ${escapeHtml(opp.sbloPhone)}` : ''}
      </div>
      ` : ''}
    </div>
  `;
}

/**
 * Render SBLO update card
 */
function renderSBLOUpdate(update: SBLOUpdate): string {
  return `
    <div class="sblo-card">
      <p class="sblo-company">${escapeHtml(update.company)}</p>
      <p class="sblo-contact">
        ${escapeHtml(update.newContact.name)} (${escapeHtml(update.newContact.title)}) •
        <a href="mailto:${escapeHtml(update.newContact.email)}" style="color: #1e40af;">${escapeHtml(update.newContact.email)}</a>
      </p>
      <p class="sblo-insight">→ ${escapeHtml(update.actionableInsight)}</p>
    </div>
  `;
}

/**
 * Render subcontracting plan card
 */
function renderSubkPlan(plan: SubcontractingPlan): string {
  return `
    <div class="subk-card">
      <p class="subk-company">${escapeHtml(plan.company)}</p>
      <p class="subk-meta">${escapeHtml(plan.contractValue)} • ${plan.agencies.slice(0, 2).join(', ')}</p>
      <p class="subk-opp">→ ${escapeHtml(plan.opportunity)}</p>
    </div>
  `;
}

/**
 * Render partnership signal card
 */
function renderSignal(signal: PartnershipSignal): string {
  const typeLabel: Record<string, string> = {
    teaming: 'Teaming',
    jv: 'Joint Venture',
    mentor_protege: 'Mentor-Protege',
    acquisition: 'M&A',
    partnership: 'Partnership',
  };

  return `
    <div class="signal-card">
      <p class="signal-headline"><a href="${escapeHtml(signal.url)}" target="_blank">${escapeHtml(signal.headline)}</a></p>
      <p class="signal-meta">${escapeHtml(signal.source)} • ${typeLabel[signal.signalType] || 'News'}</p>
      <p class="signal-relevance">→ ${escapeHtml(signal.relevance)}</p>
    </div>
  `;
}

/**
 * Generate condensed HTML body
 */
function generateCondensedHtmlBody(briefing: CondensedContractorDBBriefing, dateStr: string): string {
  const hasContent = briefing.topTeamingOpp || briefing.topSbloUpdate || briefing.topSubkPlan || briefing.topPartnershipSignal;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Teaming Intel Snapshot</title>
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background: #0f172a; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; margin-top: 20px; margin-bottom: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.15); }

    .header { background: linear-gradient(135deg, #059669 0%, #10b981 100%); color: white; padding: 24px 28px; text-align: center; }
    .header-badge { display: inline-block; background: rgba(255,255,255,0.2); padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px; }
    .header h1 { margin: 0; font-size: 22px; font-weight: 700; }
    .header .date { margin: 6px 0 0; font-size: 13px; opacity: 0.85; }

    .stats-row { display: flex; background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
    .stat-box { flex: 1; padding: 16px 20px; text-align: center; border-right: 1px solid #e2e8f0; }
    .stat-box:last-child { border-right: none; }
    .stat-value { font-size: 28px; font-weight: 700; color: #059669; }
    .stat-label { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 2px; }

    .intel-card { margin: 16px; padding: 16px 18px; border-radius: 10px; }
    .intel-card .icon { font-size: 20px; margin-bottom: 8px; }
    .intel-card .label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
    .intel-card .company { font-size: 15px; font-weight: 600; color: #1e293b; margin: 0 0 4px; }
    .intel-card .summary { font-size: 13px; color: #475569; margin: 0; line-height: 1.5; }

    .card-teaming { background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%); border-left: 4px solid #059669; }
    .card-teaming .label { color: #059669; }
    .card-sblo { background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); border-left: 4px solid #3b82f6; }
    .card-sblo .label { color: #2563eb; }
    .card-subk { background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%); border-left: 4px solid #f59e0b; }
    .card-subk .label { color: #d97706; }
    .card-signal { background: linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%); border-left: 4px solid #8b5cf6; }
    .card-signal .label { color: #7c3aed; }

    .cta-section { background: linear-gradient(135deg, #059669 0%, #10b981 100%); padding: 20px 28px; text-align: center; }
    .cta-text { color: rgba(255,255,255,0.9); font-size: 13px; margin: 0 0 12px; }
    .cta-button { display: inline-block; background: white; color: #059669; padding: 10px 24px; border-radius: 6px; font-size: 13px; font-weight: 600; text-decoration: none; }

    .footer { background: #1e293b; padding: 16px 28px; text-align: center; }
    .footer p { margin: 0; font-size: 11px; color: #94a3b8; }
    .footer a { color: #6ee7b7; text-decoration: none; }

    .empty-state { padding: 40px 28px; text-align: center; }
    .empty-state p { color: #64748b; font-size: 14px; margin: 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <span class="header-badge">Daily Snapshot</span>
      <h1>Teaming Intel</h1>
      <p class="date">${dateStr}</p>
    </div>

    <div class="stats-row">
      <div class="stat-box">
        <div class="stat-value">${briefing.teamingOppsCount}</div>
        <div class="stat-label">Teaming Opps</div>
      </div>
      <div class="stat-box">
        <div class="stat-value">${briefing.sbloUpdatesCount}</div>
        <div class="stat-label">SBLO Contacts</div>
      </div>
    </div>

    ${!hasContent ? `
    <div class="empty-state">
      <p>No significant teaming activity today. Check back tomorrow!</p>
    </div>
    ` : ''}

    ${briefing.topTeamingOpp ? `
    <div class="intel-card card-teaming">
      <div class="icon">🤝</div>
      <div class="label">Top Teaming Opportunity</div>
      <p class="company">${escapeHtml(briefing.topTeamingOpp.company)} <span style="color: #059669; font-weight: normal;">(${briefing.topTeamingOpp.score}/100)</span></p>
      <p class="summary">${escapeHtml(briefing.topTeamingOpp.value)} • ${escapeHtml(briefing.topTeamingOpp.reason)}</p>
    </div>
    ` : ''}

    ${briefing.topSbloUpdate ? `
    <div class="intel-card card-sblo">
      <div class="icon">👤</div>
      <div class="label">SBLO Contact</div>
      <p class="company">${escapeHtml(briefing.topSbloUpdate.company)}</p>
      <p class="summary">${escapeHtml(briefing.topSbloUpdate.contact)}</p>
    </div>
    ` : ''}

    ${briefing.topSubkPlan ? `
    <div class="intel-card card-subk">
      <div class="icon">📋</div>
      <div class="label">Subcontracting Plan</div>
      <p class="company">${escapeHtml(briefing.topSubkPlan.company)}</p>
      <p class="summary">${escapeHtml(briefing.topSubkPlan.goals)}</p>
    </div>
    ` : ''}

    ${briefing.topPartnershipSignal ? `
    <div class="intel-card card-signal">
      <div class="icon">📰</div>
      <div class="label">Partnership Signal</div>
      <p class="company">${escapeHtml(briefing.topPartnershipSignal.headline)}</p>
      <p class="summary">${escapeHtml(briefing.topPartnershipSignal.source)}</p>
    </div>
    ` : ''}

    <div class="cta-section">
      <p class="cta-text">Get full teaming analysis and all SBLO contacts</p>
      <a href="https://tools.govcongiants.org/briefings" class="cta-button">View Full Briefing</a>
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
 * Generate full text body
 */
function generateFullTextBody(briefing: ContractorDBBriefing, dateStr: string): string {
  let text = `TEAMING INTEL BRIEFING
${dateStr}

SUMMARY
- ${briefing.summary.totalOpportunities} Teaming Opportunities
- ${briefing.summary.newSbloContacts} SBLO Contacts
- ${briefing.summary.newSubkPlans} Subcontracting Plans
- ${briefing.summary.partnershipSignals} Partnership Signals

================================================================================
TOP TEAMING OPPORTUNITIES
================================================================================

`;

  for (const opp of briefing.teamingOpportunities) {
    text += `${opp.company} (Score: ${opp.teamingScore}/100)
  Value: ${opp.contractValue}
  Agencies: ${opp.agencies.join(', ')}
  Why: ${opp.teamingReasons.join('; ')}
  Action: ${opp.suggestedAction}
  ${opp.sbloEmail ? `SBLO: ${opp.sbloName || 'Contact'} - ${opp.sbloEmail}` : ''}

`;
  }

  if (briefing.sbloUpdates.length > 0) {
    text += `================================================================================
SBLO CONTACTS
================================================================================

`;
    for (const update of briefing.sbloUpdates) {
      text += `${update.company}
  ${update.newContact.name} (${update.newContact.title})
  Email: ${update.newContact.email}
  Insight: ${update.actionableInsight}

`;
    }
  }

  text += `---
GovCon Giants AI
Settings: https://tools.govcongiants.org/briefings/settings
`;

  return text;
}

/**
 * Generate condensed text body
 */
function generateCondensedTextBody(briefing: CondensedContractorDBBriefing, dateStr: string): string {
  let text = `QUICK TEAMING INTEL - ${dateStr}
${briefing.teamingOppsCount} teaming opportunities, ${briefing.sbloUpdatesCount} SBLO contacts

`;

  if (briefing.topTeamingOpp) {
    text += `TOP OPP: ${briefing.topTeamingOpp.company} (${briefing.topTeamingOpp.score}/100) - ${briefing.topTeamingOpp.value}\n`;
  }
  if (briefing.topSbloUpdate) {
    text += `SBLO: ${briefing.topSbloUpdate.company} - ${briefing.topSbloUpdate.contact}\n`;
  }
  if (briefing.topPartnershipSignal) {
    text += `SIGNAL: ${briefing.topPartnershipSignal.headline}\n`;
  }

  text += `\n---\nGovCon Giants AI\nhttps://tools.govcongiants.org/briefings\n`;

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
