/**
 * Email Template Generator
 *
 * Creates beautiful HTML emails for daily briefings.
 */

import {
  GeneratedBriefing,
  BriefingItemFormatted,
  EmailTemplate,
} from './types';

const BRAND_COLOR = '#1a365d'; // Navy blue
const ACCENT_COLOR = '#3182ce'; // Blue
const URGENT_COLOR = '#e53e3e'; // Red
const SUCCESS_COLOR = '#38a169'; // Green

/**
 * Generate email template from briefing
 */
export function generateEmailTemplate(briefing: GeneratedBriefing): EmailTemplate {
  const subject = generateSubject(briefing);
  const preheader = briefing.summary.headline;
  const htmlBody = generateHtmlBody(briefing);
  const textBody = generateTextBody(briefing);

  return {
    subject,
    preheader,
    htmlBody,
    textBody,
  };
}

/**
 * Generate email subject line
 */
function generateSubject(briefing: GeneratedBriefing): string {
  const date = new Date(briefing.briefingDate).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  if (briefing.summary.urgentAlerts > 0) {
    return `🚨 ${briefing.summary.urgentAlerts} Urgent Alert${briefing.summary.urgentAlerts > 1 ? 's' : ''} - GovCon Briefing ${date}`;
  }

  return `📊 Your Daily GovCon Briefing - ${date}`;
}

/**
 * Generate HTML email body
 */
function generateHtmlBody(briefing: GeneratedBriefing): string {
  const topItems = briefing.topItems[0]?.items || [];

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Daily GovCon Briefing</title>
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
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; }
    .header { background: ${BRAND_COLOR}; color: white; padding: 24px; text-align: center; }
    .header h1 { margin: 0; font-size: 24px; font-weight: 600; }
    .header p { margin: 8px 0 0; font-size: 14px; opacity: 0.9; }
    .summary { background: #f7fafc; padding: 20px 24px; border-bottom: 1px solid #e2e8f0; }
    .summary h2 { margin: 0 0 8px; font-size: 18px; color: ${BRAND_COLOR}; }
    .summary p { margin: 0; color: #4a5568; font-size: 14px; }
    .stats { display: flex; justify-content: space-between; margin-top: 16px; }
    .stat { text-align: center; flex: 1; }
    .stat-value { font-size: 24px; font-weight: 700; color: ${ACCENT_COLOR}; }
    .stat-label { font-size: 12px; color: #718096; text-transform: uppercase; }
    .section { padding: 24px; border-bottom: 1px solid #e2e8f0; }
    .section h3 { margin: 0 0 16px; font-size: 16px; color: ${BRAND_COLOR}; }
    .item { background: #f7fafc; border-radius: 8px; padding: 16px; margin-bottom: 12px; border-left: 4px solid ${ACCENT_COLOR}; }
    .item.urgent { border-left-color: ${URGENT_COLOR}; }
    .item-header { display: flex; align-items: center; margin-bottom: 8px; }
    .item-icon { font-size: 20px; margin-right: 8px; }
    .item-rank { background: ${ACCENT_COLOR}; color: white; width: 24px; height: 24px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; margin-right: 8px; }
    .item-badge { background: ${URGENT_COLOR}; color: white; font-size: 10px; padding: 2px 6px; border-radius: 4px; font-weight: 600; margin-left: 8px; }
    .item-title { font-size: 15px; font-weight: 600; color: #1a202c; margin: 0; }
    .item-subtitle { font-size: 13px; color: #718096; margin: 4px 0 0; }
    .item-description { font-size: 14px; color: #4a5568; margin: 8px 0; line-height: 1.5; }
    .item-meta { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; }
    .item-amount { font-size: 14px; font-weight: 600; color: ${SUCCESS_COLOR}; }
    .item-cta { background: ${ACCENT_COLOR}; color: white; text-decoration: none; padding: 8px 16px; border-radius: 4px; font-size: 13px; font-weight: 500; display: inline-block; }
    .item-cta:hover { background: #2c5282; }
    .footer { background: #f7fafc; padding: 24px; text-align: center; }
    .footer p { margin: 0; font-size: 12px; color: #718096; }
    .footer a { color: ${ACCENT_COLOR}; text-decoration: none; }
    @media only screen and (max-width: 600px) {
      .stats { flex-wrap: wrap; }
      .stat { flex: 0 0 50%; margin-bottom: 12px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <div class="header">
      <h1>🎯 Daily GovCon Briefing</h1>
      <p>${formatDate(briefing.briefingDate)}</p>
    </div>

    <!-- Summary -->
    <div class="summary">
      <h2>${briefing.summary.headline}</h2>
      <p>${briefing.summary.subheadline}</p>
      <div class="stats">
        ${briefing.summary.quickStats.map(stat => `
          <div class="stat">
            <div class="stat-value">${stat.value}</div>
            <div class="stat-label">${stat.label}</div>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- Top Intelligence -->
    <div class="section">
      <h3>🔥 Today's Top Intelligence</h3>
      ${topItems.map(item => renderItem(item)).join('')}
    </div>

    <!-- Categories -->
    ${Object.entries(briefing.categorizedItems)
      .filter(([_, section]) => section.items.length > 0)
      .slice(0, 3) // Max 3 categories in email
      .map(([category, section]) => `
        <div class="section">
          <h3>${section.title}</h3>
          ${section.items.slice(0, 2).map(item => renderItem(item)).join('')}
        </div>
      `).join('')}

    <!-- Footer -->
    <div class="footer">
      <p>
        This briefing was generated by <strong>GovCon Giants AI</strong>.<br>
        <a href="https://shop.govcongiants.org/briefings/settings">Manage preferences</a> |
        <a href="https://shop.govcongiants.org/briefings/unsubscribe">Unsubscribe</a>
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
 * Render a single item in HTML
 */
function renderItem(item: BriefingItemFormatted): string {
  const isUrgent = item.urgencyBadge === 'URGENT' || item.urgencyBadge === 'HIGH';

  return `
    <div class="item${isUrgent ? ' urgent' : ''}">
      <div class="item-header">
        <span class="item-icon">${item.categoryIcon}</span>
        <span class="item-rank">${item.rank}</span>
        <h4 class="item-title">${escapeHtml(item.title)}</h4>
        ${item.urgencyBadge ? `<span class="item-badge">${item.urgencyBadge}</span>` : ''}
      </div>
      <p class="item-subtitle">${escapeHtml(item.subtitle)}</p>
      <p class="item-description">${escapeHtml(item.description)}</p>
      <div class="item-meta">
        ${item.amount ? `<span class="item-amount">${item.amount}</span>` : '<span></span>'}
        <a href="${escapeHtml(item.actionUrl)}" class="item-cta">${escapeHtml(item.actionLabel)} →</a>
      </div>
    </div>
  `;
}

/**
 * Generate plain text email body
 */
function generateTextBody(briefing: GeneratedBriefing): string {
  const topItems = briefing.topItems[0]?.items || [];

  let text = `
DAILY GOVCON BRIEFING
${formatDate(briefing.briefingDate)}
========================================

${briefing.summary.headline}
${briefing.summary.subheadline}

QUICK STATS:
${briefing.summary.quickStats.map(stat => `• ${stat.label}: ${stat.value}`).join('\n')}

========================================
TODAY'S TOP INTELLIGENCE
========================================

`;

  for (const item of topItems) {
    text += `
${item.rank}. ${item.categoryIcon} ${item.title}
   ${item.subtitle}
   ${item.description}
   ${item.amount ? `Amount: ${item.amount}` : ''}
   → ${item.actionLabel}: ${item.actionUrl}
`;
  }

  text += `
========================================

This briefing was generated by GovCon Giants AI.
Manage preferences: https://shop.govcongiants.org/briefings/settings
Unsubscribe: https://shop.govcongiants.org/briefings/unsubscribe

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
