/**
 * Daily Bid Target Email Template
 *
 * Generates HTML/text emails for the paid Daily Bid Target product.
 * Format: THE ONE bid target + "Why You Can Win" + "Also on Radar"
 */

const BRAND_COLOR = '#1e3a8a'; // Navy blue
const ACCENT_COLOR = '#7c3aed'; // Purple
const SUCCESS_COLOR = '#10b981'; // Green
const WARNING_COLOR = '#f59e0b'; // Amber

export interface BidTargetOpportunity {
  title: string;
  agency: string;
  value: string;
  daysLeft: number;
  closeDate: string;
  naicsCode: string;
  setAside: string;
  noticeType: string;
  samLink: string;
  bidScore: number;
  winReasons: string[];
  actionSteps: string[];
}

export interface BidTargetEmailData {
  userName: string;
  userEmail: string;
  briefingDate: string;
  bidTarget: BidTargetOpportunity;
  alsoOnRadar: BidTargetOpportunity[];
}

export interface BidTargetEmailTemplate {
  subject: string;
  preheader: string;
  htmlBody: string;
  textBody: string;
}

/**
 * Generate email template for Daily Bid Target
 */
export function generateBidTargetEmail(data: BidTargetEmailData): BidTargetEmailTemplate {
  const date = formatDate(data.briefingDate);
  const bt = data.bidTarget;

  // Subject: "Your bid target: [Agency] [SetAside] - $[Value] - [Days] days left"
  const setAsideLabel = bt.setAside && bt.setAside !== 'None' ? `${bt.setAside} ` : '';
  const subject = `🎯 ${data.userName || 'Your'} bid target: ${bt.agency.split('/')[0]} ${setAsideLabel}- ${bt.value} - ${bt.daysLeft} days left`;

  const preheader = `Bid Score: ${bt.bidScore}/100 • ${bt.winReasons[0] || 'Strong match for your profile'}`;

  return {
    subject,
    preheader,
    htmlBody: generateHtmlBody(data, date),
    textBody: generateTextBody(data, date),
  };
}

/**
 * Generate HTML email body
 */
function generateHtmlBody(data: BidTargetEmailData, date: string): string {
  const bt = data.bidTarget;
  const feedbackBaseUrl = 'https://tools.govcongiants.org/api/briefings/feedback';
  const feedbackParams = `?email=${encodeURIComponent(data.userEmail)}&date=${data.briefingDate}&type=daily`;
  const helpfulUrl = `${feedbackBaseUrl}${feedbackParams}&rating=helpful`;
  const notHelpfulUrl = `${feedbackBaseUrl}${feedbackParams}&rating=not_helpful`;

  // Badge color based on score
  const badgeColor = bt.bidScore >= 80 ? SUCCESS_COLOR : bt.bidScore >= 60 ? WARNING_COLOR : '#6b7280';
  const badgeText = bt.bidScore >= 80 ? 'EXCELLENT FIT' : bt.bidScore >= 60 ? 'GOOD FIT' : 'POSSIBLE FIT';

  // Urgency styling
  const urgencyColor = bt.daysLeft <= 7 ? '#dc2626' : bt.daysLeft <= 14 ? '#f59e0b' : '#10b981';
  const urgencyText = bt.daysLeft <= 7 ? '🔥 URGENT' : bt.daysLeft <= 14 ? '⚡ ACT SOON' : '📅 ON TRACK';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Bid Target</title>
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
    .header h1 { margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.5px; }
    .header .greeting { margin: 8px 0 0; font-size: 16px; opacity: 0.9; }
    .header .date { margin: 4px 0 0; font-size: 14px; opacity: 0.7; }
    .section { padding: 24px; }
    .bid-target-card { background: linear-gradient(135deg, #faf5ff 0%, #f3e8ff 100%); border-radius: 12px; padding: 24px; border: 2px solid ${ACCENT_COLOR}; }
    .bid-score { display: inline-block; background: ${badgeColor}; color: white; font-size: 14px; padding: 6px 14px; border-radius: 20px; font-weight: 700; margin-bottom: 16px; }
    .bid-title { font-size: 20px; font-weight: 700; color: #111827; margin: 0 0 16px; line-height: 1.4; }
    .bid-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; }
    .bid-meta-item { font-size: 14px; }
    .bid-meta-label { color: #6b7280; font-weight: 500; display: block; }
    .bid-meta-value { color: #111827; font-weight: 600; }
    .bid-value { color: ${SUCCESS_COLOR}; font-weight: 700; font-size: 18px; }
    .bid-urgency { display: inline-block; background: ${urgencyColor}; color: white; font-size: 12px; padding: 4px 10px; border-radius: 4px; font-weight: 600; }
    .why-win { background: #ecfdf5; border-radius: 8px; padding: 16px; margin-top: 20px; }
    .why-win-header { font-size: 14px; font-weight: 700; color: #065f46; margin: 0 0 12px; text-transform: uppercase; letter-spacing: 0.5px; }
    .why-win-list { margin: 0; padding: 0; list-style: none; }
    .why-win-list li { font-size: 14px; color: #047857; padding: 6px 0; border-bottom: 1px solid #d1fae5; }
    .why-win-list li:last-child { border-bottom: none; }
    .action-section { background: #fef3c7; border-radius: 8px; padding: 16px; margin-top: 20px; }
    .action-header { font-size: 14px; font-weight: 700; color: #92400e; margin: 0 0 12px; text-transform: uppercase; letter-spacing: 0.5px; }
    .action-list { margin: 0; padding: 0; list-style: none; }
    .action-list li { font-size: 14px; color: #78350f; padding: 6px 0; }
    .action-list li::before { content: "→ "; font-weight: bold; }
    .cta-button { display: inline-block; background: ${ACCENT_COLOR}; color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-size: 16px; font-weight: 600; margin-top: 20px; }
    .also-radar { margin-top: 32px; padding-top: 24px; border-top: 2px solid #e5e7eb; }
    .also-radar-header { font-size: 14px; font-weight: 700; color: #6b7280; margin: 0 0 16px; text-transform: uppercase; letter-spacing: 0.5px; }
    .radar-item { background: #f9fafb; border-radius: 8px; padding: 16px; margin-bottom: 12px; border-left: 4px solid #d1d5db; }
    .radar-title { font-size: 15px; font-weight: 600; color: #374151; margin: 0 0 8px; }
    .radar-meta { font-size: 13px; color: #6b7280; }
    .radar-score { display: inline-block; background: #e5e7eb; color: #374151; font-size: 12px; padding: 2px 8px; border-radius: 4px; font-weight: 600; }
    .feedback { background: #f0f9ff; padding: 20px; text-align: center; border-top: 1px solid #e0f2fe; }
    .feedback p { margin: 0 0 12px; font-size: 14px; color: #0369a1; font-weight: 600; }
    .feedback-btn { display: inline-block; padding: 10px 24px; margin: 0 8px; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 600; }
    .footer { background: #f9fafb; padding: 24px; text-align: center; border-top: 1px solid #e5e7eb; }
    .footer p { margin: 0 0 8px; font-size: 12px; color: #6b7280; }
    .footer a { color: ${ACCENT_COLOR}; text-decoration: none; }
    @media only screen and (max-width: 600px) {
      .bid-meta { grid-template-columns: 1fr; }
      .header h1 { font-size: 20px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <div class="header">
      <h1>🎯 YOUR BID TARGET TODAY</h1>
      <p class="greeting">Good morning${data.userName ? `, ${escapeHtml(data.userName)}` : ''}.</p>
      <p class="date">${date}</p>
    </div>

    <!-- Main Bid Target -->
    <div class="section">
      <div class="bid-target-card">
        <span class="bid-score">${bt.bidScore}/100 ${badgeText}</span>

        <h2 class="bid-title">${escapeHtml(bt.title)}</h2>

        <div class="bid-meta">
          <div class="bid-meta-item">
            <span class="bid-meta-label">Agency</span>
            <span class="bid-meta-value">${escapeHtml(bt.agency)}</span>
          </div>
          <div class="bid-meta-item">
            <span class="bid-meta-label">Value</span>
            <span class="bid-meta-value bid-value">${escapeHtml(bt.value)}</span>
          </div>
          <div class="bid-meta-item">
            <span class="bid-meta-label">Set-Aside</span>
            <span class="bid-meta-value">${escapeHtml(bt.setAside || 'Full & Open')}</span>
          </div>
          <div class="bid-meta-item">
            <span class="bid-meta-label">Closes</span>
            <span class="bid-meta-value">
              ${escapeHtml(bt.closeDate)}
              <span class="bid-urgency">${urgencyText} • ${bt.daysLeft} days</span>
            </span>
          </div>
          <div class="bid-meta-item">
            <span class="bid-meta-label">NAICS</span>
            <span class="bid-meta-value">${escapeHtml(bt.naicsCode)}</span>
          </div>
          <div class="bid-meta-item">
            <span class="bid-meta-label">Notice Type</span>
            <span class="bid-meta-value">${escapeHtml(bt.noticeType)}</span>
          </div>
        </div>

        <!-- Why You Can Win -->
        <div class="why-win">
          <h3 class="why-win-header">Why You Can Win This</h3>
          <ul class="why-win-list">
            ${bt.winReasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join('')}
          </ul>
        </div>

        <!-- Your Action Today -->
        <div class="action-section">
          <h3 class="action-header">Your Action Today</h3>
          <ul class="action-list">
            ${bt.actionSteps.map(step => `<li>${escapeHtml(step)}</li>`).join('')}
          </ul>
        </div>

        <a href="${escapeHtml(bt.samLink)}" class="cta-button" style="color: white;">View on SAM.gov →</a>
      </div>

      <!-- Also on Radar -->
      ${data.alsoOnRadar.length > 0 ? `
      <div class="also-radar">
        <h3 class="also-radar-header">📊 Also on Your Radar (but focus on above first)</h3>
        ${data.alsoOnRadar.map(opp => `
        <div class="radar-item">
          <h4 class="radar-title">${escapeHtml(opp.title)}</h4>
          <p class="radar-meta">
            ${escapeHtml(opp.agency)} • ${escapeHtml(opp.value)} • Closes ${opp.closeDate}
            <span class="radar-score">${opp.bidScore}/100</span>
          </p>
        </div>
        `).join('')}
      </div>
      ` : ''}
    </div>

    <!-- Feedback Section -->
    <div class="feedback">
      <p>Was this bid target helpful?</p>
      <div>
        <a href="${helpfulUrl}" class="feedback-btn" style="background: ${SUCCESS_COLOR}; color: white;">
          👍 Yes, helpful!
        </a>
        <a href="${notHelpfulUrl}" class="feedback-btn" style="background: #6b7280; color: white;">
          👎 Needs work
        </a>
      </div>
      <p style="margin: 12px 0 0; font-size: 12px; color: #64748b;">
        Your feedback helps us find better matches for you
      </p>
    </div>

    <!-- Footer -->
    <div class="footer">
      <p>
        <strong>GovCon Giants AI</strong> • Daily Bid Target<br>
        <a href="https://tools.govcongiants.org/briefings">View Dashboard</a> |
        <a href="https://tools.govcongiants.org/briefings">Manage Preferences</a> |
        <a href="https://tools.govcongiants.org/unsubscribe?email=${encodeURIComponent(data.userEmail)}">Unsubscribe</a>
      </p>
      <p style="margin-top: 12px;">
        © ${new Date().getFullYear()} GovCon Giants. All rights reserved.
      </p>
    </div>
  </div>
</body>
</html>
`;
}

/**
 * Generate plain text email body
 */
function generateTextBody(data: BidTargetEmailData, date: string): string {
  const bt = data.bidTarget;
  const feedbackBaseUrl = 'https://tools.govcongiants.org/api/briefings/feedback';
  const feedbackParams = `?email=${encodeURIComponent(data.userEmail)}&date=${data.briefingDate}&type=daily`;

  let text = `
🎯 YOUR BID TARGET TODAY
========================================
Good morning${data.userName ? `, ${data.userName}` : ''}.
${date}
========================================

📋 ${bt.title}
   ${bt.agency}

💰 ${bt.value}
⏰ Closes in ${bt.daysLeft} days (${bt.closeDate})
🎯 Bid Score: ${bt.bidScore}/100

WHY YOU CAN WIN THIS:
${bt.winReasons.map(r => `✅ ${r}`).join('\n')}

YOUR ACTION TODAY:
${bt.actionSteps.map(s => `→ ${s}`).join('\n')}

View on SAM.gov: ${bt.samLink}

`;

  if (data.alsoOnRadar.length > 0) {
    text += `
========================================
📊 ALSO ON YOUR RADAR (but focus on above first):
========================================

`;
    for (const opp of data.alsoOnRadar) {
      text += `• ${opp.title}
  ${opp.agency} • ${opp.value} • Closes ${opp.closeDate} • Score: ${opp.bidScore}

`;
    }
  }

  text += `
========================================
WAS THIS BID TARGET HELPFUL?
========================================

Yes, helpful: ${feedbackBaseUrl}${feedbackParams}&rating=helpful
Needs work: ${feedbackBaseUrl}${feedbackParams}&rating=not_helpful

========================================

GovCon Giants AI • Daily Bid Target
View Dashboard: https://tools.govcongiants.org/briefings
Manage Preferences: https://tools.govcongiants.org/briefings

© ${new Date().getFullYear()} GovCon Giants. All rights reserved.
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
