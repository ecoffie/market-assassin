import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.SMTP_USER || 'hello@govconedu.com',
    pass: process.env.SMTP_PASSWORD,
  },
});

interface SendAccessCodeEmailParams {
  to: string;
  companyName?: string;
  accessCode: string;
  accessLink: string;
}

export async function sendAccessCodeEmail({
  to,
  companyName,
  accessCode,
  accessLink,
}: SendAccessCodeEmailParams): Promise<boolean> {
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1e293b; max-width: 600px; margin: 0 auto; padding: 20px; background: #f8fafc; }
    .container { background: white; border-radius: 12px; padding: 40px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
    .brand { text-align: center; margin-bottom: 30px; }
    .brand-govcon { font-size: 28px; font-weight: 700; color: #1d4ed8; }
    .brand-giants { font-size: 28px; font-weight: 700; color: #f59e0b; }
    h1 { color: #1e40af; text-align: center; margin-bottom: 10px; }
    .subtitle { text-align: center; color: #64748b; margin-bottom: 30px; }
    .access-box { background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); border: 2px solid #3b82f6; border-radius: 12px; padding: 30px; text-align: center; margin: 30px 0; }
    .access-code { font-family: monospace; font-size: 24px; font-weight: bold; color: #1e40af; background: white; padding: 10px 20px; border-radius: 8px; display: inline-block; margin: 10px 0; letter-spacing: 2px; }
    .cta-button { display: inline-block; background: #3b82f6; color: white !important; text-decoration: none; padding: 16px 40px; border-radius: 8px; font-weight: 600; font-size: 18px; margin: 20px 0; }
    .cta-button:hover { background: #2563eb; }
    .warning { background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 15px; margin: 20px 0; }
    .warning-title { color: #92400e; font-weight: 600; margin-bottom: 5px; }
    .warning-text { color: #78350f; font-size: 14px; }
    .steps { background: #f0fdf4; border-radius: 8px; padding: 20px; margin: 20px 0; }
    .steps h3 { color: #166534; margin-top: 0; }
    .steps ol { margin: 0; padding-left: 20px; color: #15803d; }
    .steps li { margin-bottom: 8px; }
    .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="brand">
      <span class="brand-govcon">GovCon</span><span class="brand-giants">Giants</span>
    </div>

    <h1>Your Report Access is Ready!</h1>
    <p class="subtitle">Thank you for your purchase${companyName ? `, ${companyName}` : ''}!</p>

    <div class="access-box">
      <p style="margin: 0 0 10px 0; color: #1e40af; font-weight: 600;">Your One-Time Access Code:</p>
      <div class="access-code">${accessCode}</div>
      <br><br>
      <a href="${accessLink}" class="cta-button">Access Your Report Now</a>
    </div>

    <div class="warning">
      <div class="warning-title">⚠️ Important: One-Time Use Only</div>
      <div class="warning-text">This access link can only be used once. Make sure to download and save your report before leaving the page.</div>
    </div>

    <div class="steps">
      <h3>How to Get Your Report:</h3>
      <ol>
        <li>Click the button above or copy this link: ${accessLink}</li>
        <li>Enter your business information (NAICS code, location, etc.)</li>
        <li>Select the government agencies you want to target</li>
        <li>Generate and download your personalized report</li>
      </ol>
    </div>

    <p style="text-align: center; color: #64748b;">
      Questions? Reply to this email or contact us at service@govcongiants.com
    </p>

    <div class="footer">
      <span class="brand-govcon">GovCon</span><span class="brand-giants">Giants</span>
      <p>Federal Market Assassin - Your Strategic Advantage in Government Contracting</p>
      <p>&copy; ${new Date().getFullYear()} GovCon Giants. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
`;

  try {
    await transporter.sendMail({
      from: `"GovCon Giants" <${process.env.SMTP_USER || 'hello@govconedu.com'}>`,
      to,
      subject: 'Your Federal Market Assassin Report Access | GovCon Giants',
      html: htmlContent,
      text: `Your Federal Market Assassin Report Access\n\nThank you for your purchase!\n\nYour one-time access code: ${accessCode}\n\nAccess your report here: ${accessLink}\n\nIMPORTANT: This link can only be used once. Make sure to download your report before leaving the page.\n\n- GovCon Giants Team`,
    });

    console.log(`✅ Access code email sent to ${to}`);
    return true;
  } catch (error) {
    console.error('❌ Failed to send email:', error);
    return false;
  }
}
