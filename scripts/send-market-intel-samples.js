const nodemailer = require('nodemailer');

const to = 'evankoffdev@gmail.com';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.office365.com',
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: false,
  auth: {
    user: process.env.SMTP_USER || 'alerts@govcongiants.com',
    pass: process.env.SMTP_PASSWORD,
  },
});

function weeklyHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Weekly Deep Dive</title>
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; background: #f3f4f6; }
    .container { max-width: 680px; margin: 0 auto; background: #ffffff; }
    .header { background: linear-gradient(135deg, #1e3a8a 0%, #7c3aed 100%); color: white; padding: 32px 24px; text-align: center; }
    .header h1 { margin: 0; font-size: 28px; font-weight: 700; }
    .header p { margin: 12px 0 0; font-size: 16px; opacity: 0.9; }
    .note { background: #fff7ed; color: #9a3412; border: 1px solid #fdba74; margin: 20px 24px 0; padding: 12px 14px; border-radius: 10px; font-size: 13px; }
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
      <p>Week of April 7, 2026</p>
    </div>

    <div class="note">
      Screenshot preview sample. This layout mirrors the live weekly deep dive email format while Anthropic generation is temporarily unavailable.
    </div>

    <div class="section">
      <h2>🎯 Top 3 Strategic Opportunities</h2>
      <div class="opportunity">
        <div style="display: flex; align-items: flex-start;">
          <span class="opp-rank">1</span>
          <div>
            <h3 class="opp-title">Enterprise Cloud Operations Modernization</h3>
            <p class="opp-meta">Department of Veterans Affairs • Accenture Federal Services</p>
            <p class="opp-value">$214M estimated value</p>
            <p class="opp-angle">"Position as a modernization partner with lower transition risk and stronger VA mission familiarity."</p>
          </div>
        </div>
      </div>
      <div class="opportunity">
        <div style="display: flex; align-items: flex-start;">
          <span class="opp-rank">2</span>
          <div>
            <h3 class="opp-title">Cybersecurity Operations Support BPA Task</h3>
            <p class="opp-meta">Department of Homeland Security • Booz Allen Hamilton</p>
            <p class="opp-value">$88M estimated value</p>
            <p class="opp-angle">"Compete on speed-to-operate and agency-specific threat response maturity."</p>
          </div>
        </div>
      </div>
      <div class="opportunity">
        <div style="display: flex; align-items: flex-start;">
          <span class="opp-rank">3</span>
          <div>
            <h3 class="opp-title">Data Platform Engineering and Analytics Support</h3>
            <p class="opp-meta">Health and Human Services • Leidos</p>
            <p class="opp-value">$61M estimated value</p>
            <p class="opp-angle">"Use analytics delivery proof points and mission outcomes to break incumbent comfort."</p>
          </div>
        </div>
      </div>
    </div>

    <div class="section">
      <h2>🤝 Teaming Plays</h2>
      <div class="teaming">
        <h4>#1: Agency-incumbent displacement</h4>
        <p><strong>Target:</strong> Mid-tier cyber integrator with DHS footprint</p>
        <p><strong>Why:</strong> Prime-ready scale • Fast past performance alignment • Lower bundling risk</p>
      </div>
      <div class="teaming">
        <h4>#2: Technical wedge partnership</h4>
        <p><strong>Target:</strong> Cloud-native DevSecOps boutique</p>
        <p><strong>Why:</strong> Sharp delivery differentiator • Complements your capture narrative • Strong modernization positioning</p>
      </div>
    </div>

    <div class="section">
      <h2>📡 Market Signals</h2>
      <div class="signal">
        <p class="signal-headline">VA modernization work is concentrating around cloud transition and platform consolidation.</p>
        <p class="signal-implication">Lead messaging with continuity, transition governance, and operational resilience.</p>
      </div>
      <div class="signal">
        <p class="signal-headline">DHS cyber opportunities continue favoring operators who can show immediate mission lift.</p>
        <p class="signal-implication">Shorten value proof and emphasize deployment speed over abstract strategy language.</p>
      </div>
    </div>

    <div class="footer">
      <p>This briefing was generated by <strong>GovCon Giants AI</strong></p>
      <p style="margin-top: 8px;">© 2026 GovCon Giants AI</p>
    </div>
  </div>
</body>
</html>`;
}

function pursuitHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Pursuit Brief</title>
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; background: #f3f4f6; }
    .container { max-width: 680px; margin: 0 auto; background: #ffffff; }
    .header { background: linear-gradient(135deg, #1e3a8a 0%, #7c3aed 100%); color: white; padding: 32px 24px; }
    .header h1 { margin: 0; font-size: 24px; font-weight: 700; }
    .header p { margin: 8px 0 0; font-size: 14px; opacity: 0.9; }
    .score-badge { display: inline-block; background: #059669; color: white; padding: 8px 16px; border-radius: 20px; font-size: 18px; font-weight: 700; margin-top: 16px; }
    .note { background: #fff7ed; color: #9a3412; border: 1px solid #fdba74; margin: 20px 24px 0; padding: 12px 14px; border-radius: 10px; font-size: 13px; }
    .section { padding: 24px; border-bottom: 1px solid #e5e7eb; }
    .section h2 { margin: 0 0 12px; font-size: 16px; color: #1e3a8a; text-transform: uppercase; letter-spacing: 0.5px; }
    .section p { margin: 0; font-size: 15px; color: #374151; line-height: 1.6; }
    .intel-list { margin: 0; padding: 0 0 0 20px; }
    .intel-list li { margin-bottom: 8px; font-size: 14px; color: #374151; }
    .action-item { display: flex; align-items: flex-start; padding: 8px 0; border-bottom: 1px solid #e5e7eb; }
    .action-item:last-child { border-bottom: none; }
    .action-day { background: #7c3aed; color: white; padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight: 600; margin-right: 12px; min-width: 50px; text-align: center; }
    .action-text { font-size: 14px; color: #374151; flex: 1; }
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
      <p>Enterprise Cloud Operations Modernization</p>
      <p>Department of Veterans Affairs • $214M estimated value</p>
      <div class="score-badge">Score: 78/100</div>
    </div>

    <div class="note">
      Screenshot preview sample. This layout mirrors the live pursuit brief email format while Anthropic generation is temporarily unavailable.
    </div>

    <div class="section">
      <h2>Why Worth Pursuing</h2>
      <p>This opportunity fits your modernization and IT services profile, carries enough contract value to justify focused capture effort, and sits in an agency where continuity and execution credibility matter more than novelty.</p>
    </div>

    <div class="section">
      <h2>Working Hypothesis</h2>
      <p>The incumbent is vulnerable if you frame your team as the lower-risk modernization partner that can preserve operations while accelerating cloud transition milestones.</p>
    </div>

    <div class="section">
      <h2>Priority Intel Needed</h2>
      <ul class="intel-list">
        <li>Confirm whether transition friction is the buyer’s top sensitivity.</li>
        <li>Map incumbent subcontractor relationships that can be disrupted or reused.</li>
        <li>Identify the program office voice shaping modernization evaluation language.</li>
      </ul>
    </div>

    <div class="section">
      <h2>First 14 Days</h2>
      <div class="action-item">
        <span class="action-day">Day 1</span>
        <div class="action-text">Validate incumbent scope, option periods, and likely recompete timing.</div>
      </div>
      <div class="action-item">
        <span class="action-day">Day 5</span>
        <div class="action-text">Line up one technical teammate that improves credibility around migration and cutover execution.</div>
      </div>
      <div class="action-item">
        <span class="action-day">Day 10</span>
        <div class="action-text">Draft outreach anchored in continuity, mission uptime, and measurable modernization lift.</div>
      </div>
    </div>

    <div class="section">
      <h2>Key Risks</h2>
      <div class="risk">
        <div class="risk-text">Incumbent familiarity could outweigh technical differentiation.</div>
        <div class="risk-mitigation">Mitigation: sharpen transition proof and emphasize lower disruption risk.</div>
      </div>
      <div class="risk">
        <div class="risk-text">The agency may prefer scale over niche expertise.</div>
        <div class="risk-mitigation">Mitigation: use a prime/partner pairing that signals both stability and specialization.</div>
      </div>
    </div>

    <div class="section">
      <div class="next-move">
        <h3>Recommended next move</h3>
        <p>Open capture with a transition-risk narrative and secure partner alignment before the incumbent shapes the recompete.</p>
      </div>
    </div>

    <div class="footer">
      <p>This briefing was generated by <strong>GovCon Giants AI</strong></p>
      <p style="margin-top: 8px;">© 2026 GovCon Giants AI</p>
    </div>
  </div>
</body>
</html>`;
}

async function main() {
  await transporter.sendMail({
    from: `"GovCon Giants AI" <${process.env.SMTP_USER || 'alerts@govcongiants.com'}>`,
    to,
    subject: '📊 Weekly Deep Dive - Sample Preview for Screenshots',
    html: weeklyHtml(),
    text: 'Weekly Deep Dive sample preview for screenshots.',
  });

  await transporter.sendMail({
    from: `"GovCon Giants AI" <${process.env.SMTP_USER || 'alerts@govcongiants.com'}>`,
    to,
    subject: '🎯 Pursuit Brief - Sample Preview for Screenshots',
    html: pursuitHtml(),
    text: 'Pursuit Brief sample preview for screenshots.',
  });

  console.log(`Sent weekly and pursuit preview samples to ${to}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
