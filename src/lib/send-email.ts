import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import { createSecureAccessUrl } from '@/lib/access-links';

// Primary: Resend (more reliable)
const resendApiKey = process.env.RESEND_API_KEY?.replace(/\\n$/, '').trim();
const resend = resendApiKey ? new Resend(resendApiKey) : null;

// Fallback: Office365 SMTP
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.office365.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER || 'alerts@govcongiants.com',
    pass: process.env.SMTP_PASSWORD,
  },
});

/**
 * Generic email sending function - uses Resend as primary, Office365 as fallback
 */
interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
}

export async function sendEmail({
  to,
  subject,
  html,
  text,
  from,
}: SendEmailParams): Promise<boolean> {
  // Use alerts@govcongiants.com (verified in Resend)
  const fromEmail = process.env.EMAIL_FROM || 'alerts@govcongiants.com';
  const fromName = 'GovCon Giants AI';
  const fromAddress = from || `${fromName} <${fromEmail}>`;

  // Try Resend first (primary)
  if (resend) {
    try {
      const { error } = await resend.emails.send({
        from: fromAddress,
        to: [to],
        subject,
        html,
        text: text || html.replace(/<[^>]*>/g, ''),
      });

      if (error) {
        console.error(`[SendEmail] Resend error for ${to}:`, error);
        throw new Error(error.message);
      }

      console.log(`[SendEmail] ✅ Sent via Resend to ${to}: ${subject}`);
      return true;
    } catch (resendError: any) {
      console.error(`[SendEmail] Resend failed, trying Office365 fallback:`, resendError.message);
    }
  }

  // Fallback to Office365 SMTP
  try {
    await transporter.sendMail({
      from: fromAddress,
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]*>/g, ''),
    });

    console.log(`[SendEmail] ✅ Sent via Office365 to ${to}: ${subject}`);
    return true;
  } catch (error) {
    console.error(`[SendEmail] ❌ Both providers failed for ${to}:`, error);
    throw error;
  }
}

interface SendAccessCodeEmailParams {
  to: string;
  companyName?: string;
  accessCode: string;
  accessLink: string;
}

interface SendDatabaseAccessEmailParams {
  to: string;
  customerName?: string;
  accessLink: string;
}

interface SendOpportunityHunterProEmailParams {
  to: string;
  customerName?: string;
}

// Email for Federal Contractor Database access
export async function sendDatabaseAccessEmail({
  to,
  customerName,
  accessLink,
}: SendDatabaseAccessEmailParams): Promise<boolean> {
  const dailyAlertsLink = await createSecureAccessUrl(to, 'preferences');
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 28px;">GovCon Giants</h1>
    <p style="color: #93c5fd; margin: 10px 0 0 0;">Federal Contractor Database</p>
  </div>

  <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
    <h2 style="color: #1e3a8a; margin-top: 0;">Thank You for Your Purchase!</h2>

    <p>Hi${customerName ? ` ${customerName}` : ''},</p>

    <p>Your payment has been confirmed. You now have <strong>lifetime access</strong> to our Federal Contractor Database featuring:</p>

    <ul style="color: #4b5563;">
      <li><strong>3,500+</strong> federal prime contractors</li>
      <li><strong>$430B+</strong> in contract data</li>
      <li><strong>800+</strong> SBLO contacts with emails</li>
      <li><strong>115+</strong> supplier portal links</li>
      <li>Searchable and filterable by NAICS, agency, contract size</li>
    </ul>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${accessLink}" style="background: #2563eb; color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block; font-size: 18px;">Access Your Database</a>
    </div>

    <p style="color: #6b7280; font-size: 14px;">Or copy and paste this link into your browser:</p>
    <p style="background: #f3f4f6; padding: 12px; border-radius: 6px; word-break: break-all; font-size: 14px;">
      <a href="${accessLink}" style="color: #2563eb;">${accessLink}</a>
    </p>

    <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 20px; margin: 25px 0;">
      <h3 style="color: #166534; margin: 0 0 10px 0;">💡 Pro Tips:</h3>
      <ul style="color: #15803d; margin: 0; padding-left: 20px;">
        <li>Use filters to find contractors by your NAICS codes</li>
        <li>Look for companies with "Supplier Portal" badges to register directly</li>
        <li>Export your filtered results to CSV for outreach</li>
        <li>Bookmark the database page for easy access</li>
      </ul>
    </div>

    <div style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border: 2px solid #22c55e; border-radius: 12px; padding: 25px; margin: 25px 0;">
      <h3 style="color: #166534; margin: 0 0 10px 0; text-align: center;">🎁 BONUS: Free Daily Opportunity Alerts</h3>
      <p style="color: #15803d; margin: 0 0 15px 0; text-align: center;">As a GovCon Giants customer, you're automatically enrolled in our <strong>FREE Daily Alerts</strong> beta!</p>
      <p style="color: #166534; margin: 0 0 15px 0; font-size: 14px;">Get personalized federal contract opportunities delivered to your inbox every day. Set up your NAICS codes to receive opportunities matched to YOUR business:</p>
      <div style="text-align: center;">
        <a href="${dailyAlertsLink}" style="display: inline-block; background: #22c55e; color: white !important; text-decoration: none; padding: 14px 35px; border-radius: 8px; font-weight: 600; font-size: 16px;">Set Up Your Daily Alerts</a>
      </div>
    </div>

    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

    <p style="color: #6b7280; font-size: 12px; text-align: center;">
      Save this email for future access.<br>
      Questions? Reply to this email for support.
    </p>

    <p style="text-align: center; color: #9ca3af; font-size: 12px;">
      &copy; ${new Date().getFullYear()} GovCon Giants. All rights reserved.
    </p>
  </div>
</body>
</html>
`;

  try {
    await transporter.sendMail({
      from: `"GovCon Giants" <${process.env.SMTP_USER || 'hello@govconedu.com'}>`,
      to,
      subject: 'Your Federal Contractor Database Access | GovCon Giants',
      html: htmlContent,
      text: `Thank You for Your Purchase!

Hi${customerName ? ` ${customerName}` : ''},

Your payment has been confirmed. You now have lifetime access to our Federal Contractor Database.

Access your database here: ${accessLink}

Features included:
- 3,500+ federal prime contractors
- $430B+ in contract data
- 800+ SBLO contacts with emails
- 115+ supplier portal links
- Searchable and filterable by NAICS, agency, contract size

Pro Tips:
- Use filters to find contractors by your NAICS codes
- Look for companies with "Supplier Portal" badges to register directly
- Export your filtered results to CSV for outreach
- Bookmark the database page for easy access

Save this email for future access.
Questions? Reply to this email for support.

- GovCon Giants Team`,
    });

    console.log(`✅ Database access email sent to ${to}`);
    return true;
  } catch (error) {
    console.error('❌ Failed to send database email:', error);
    return false;
  }
}

export async function sendAccessCodeEmail({
  to,
  companyName,
  accessCode,
  accessLink,
}: SendAccessCodeEmailParams): Promise<boolean> {
  const dailyAlertsLink = await createSecureAccessUrl(to, 'preferences');
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
        <li><strong>Click "Print All (PDF)"</strong> to save a permanent copy of your report</li>
      </ol>
    </div>

    <div style="background: #eff6ff; border: 2px solid #3b82f6; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center;">
      <h3 style="color: #1e40af; margin: 0 0 10px 0;">🎬 Watch the Tutorial</h3>
      <p style="color: #334155; margin: 0 0 15px 0;">Learn how to get the most out of your Federal Market Assassin report</p>
      <a href="https://vimeo.com/1150857756?fl=tl&fe=ec" style="display: inline-block; background: #1e40af; color: white !important; text-decoration: none; padding: 12px 30px; border-radius: 8px; font-weight: 600;">Watch Now</a>
    </div>

    <div style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border: 2px solid #22c55e; border-radius: 12px; padding: 25px; margin: 25px 0;">
      <h3 style="color: #166534; margin: 0 0 10px 0; text-align: center;">🎁 BONUS: Free Daily Opportunity Alerts</h3>
      <p style="color: #15803d; margin: 0 0 15px 0; text-align: center;">As a GovCon Giants customer, you're automatically enrolled in our <strong>FREE Daily Alerts</strong> beta!</p>
      <p style="color: #166534; margin: 0 0 15px 0; font-size: 14px;">Get personalized federal contract opportunities delivered to your inbox every day. Set up your NAICS codes to receive opportunities matched to YOUR business:</p>
      <div style="text-align: center;">
        <a href="${dailyAlertsLink}" style="display: inline-block; background: #22c55e; color: white !important; text-decoration: none; padding: 14px 35px; border-radius: 8px; font-weight: 600; font-size: 16px;">Set Up Your Daily Alerts</a>
      </div>
    </div>

    <p style="text-align: center; color: #64748b;">
      Questions? Reply to this email or contact us at hello@govconedu.com
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
      text: `Your Federal Market Assassin Report Access\n\nThank you for your purchase!\n\nYour one-time access code: ${accessCode}\n\nAccess your report here: ${accessLink}\n\nHow to Get Your Report:\n1. Click the link above\n2. Enter your business information (NAICS code, location, etc.)\n3. Select the government agencies you want to target\n4. Generate and download your personalized report\n5. Click "Print All (PDF)" to save a permanent copy\n\nWATCH THE TUTORIAL\nLearn how to get the most out of your report:\nhttps://vimeo.com/1150857756?fl=tl&fe=ec\n\nIMPORTANT: This link can only be used once. Make sure to download your report before leaving the page.\n\n- GovCon Giants Team`,
    });

    console.log(`✅ Access code email sent to ${to}`);
    return true;
  } catch (error) {
    console.error('❌ Failed to send email:', error);
    return false;
  }
}

// Email for Opportunity Hunter Pro access
export async function sendOpportunityHunterProEmail({
  to,
  customerName,
}: SendOpportunityHunterProEmailParams): Promise<boolean> {
  const accessLink = 'https://tools.govcongiants.org/opportunity-hunter';
  const dailyAlertsLink = await createSecureAccessUrl(to, 'preferences');

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 28px;">GovCon Giants</h1>
    <p style="color: #fef3c7; margin: 10px 0 0 0;">Opportunity Hunter Pro</p>
  </div>

  <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
    <h2 style="color: #d97706; margin-top: 0;">Welcome to Opportunity Hunter Pro!</h2>

    <p>Hi${customerName ? ` ${customerName}` : ''},</p>

    <p>Thank you for your purchase! Your <strong>Opportunity Hunter Pro</strong> access is now active.</p>

    <div style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border: 2px solid #f59e0b; border-radius: 12px; padding: 20px; margin: 25px 0;">
      <h3 style="color: #92400e; margin: 0 0 15px 0;">🎯 Your Pro Features:</h3>
      <ul style="color: #78350f; margin: 0; padding-left: 20px;">
        <li><strong>Agency Pain Points & Priorities</strong> - Know what challenges your target agencies face</li>
        <li><strong>Market Research Tips</strong> - Actionable guidance for each agency</li>
        <li><strong>CSV Export</strong> - Download results for your BD pipeline</li>
        <li><strong>Print Results</strong> - Save reports for offline use</li>
        <li><strong>Unlimited Searches</strong> - Search as many times as you need</li>
      </ul>
    </div>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${accessLink}" style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block; font-size: 18px;">Access Opportunity Hunter Pro</a>
    </div>

    <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 20px; margin: 25px 0;">
      <h3 style="color: #166534; margin: 0 0 10px 0;">💡 How to Access:</h3>
      <ol style="color: #15803d; margin: 0; padding-left: 20px;">
        <li>Go to <a href="${accessLink}" style="color: #166534;">${accessLink}</a></li>
        <li>Click "I Have Access" and enter your email: <strong>${to}</strong></li>
        <li>Start discovering agencies that buy what you sell!</li>
      </ol>
    </div>

    <p style="background: #eff6ff; border: 1px solid #93c5fd; border-radius: 8px; padding: 15px; color: #1e40af;">
      <strong>Your registered email:</strong> ${to}<br>
      <span style="font-size: 14px;">Use this email to verify your Pro access anytime.</span>
    </p>

    <div style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border: 2px solid #22c55e; border-radius: 12px; padding: 25px; margin: 25px 0;">
      <h3 style="color: #166534; margin: 0 0 10px 0; text-align: center;">🎁 BONUS: Free Daily Opportunity Alerts</h3>
      <p style="color: #15803d; margin: 0 0 15px 0; text-align: center;">As a GovCon Giants customer, you're automatically enrolled in our <strong>FREE Daily Alerts</strong> beta!</p>
      <p style="color: #166534; margin: 0 0 15px 0; font-size: 14px;">Get personalized federal contract opportunities delivered to your inbox every day. Set up your NAICS codes to receive opportunities matched to YOUR business:</p>
      <div style="text-align: center;">
        <a href="${dailyAlertsLink}" style="display: inline-block; background: #22c55e; color: white !important; text-decoration: none; padding: 14px 35px; border-radius: 8px; font-weight: 600; font-size: 16px;">Set Up Your Daily Alerts</a>
      </div>
    </div>

    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

    <p style="color: #6b7280; font-size: 12px; text-align: center;">
      Save this email for future reference.<br>
      Questions? Reply to this email for support.
    </p>

    <p style="text-align: center; color: #9ca3af; font-size: 12px;">
      &copy; ${new Date().getFullYear()} GovCon Giants. All rights reserved.
    </p>
  </div>
</body>
</html>
`;

  try {
    await transporter.sendMail({
      from: `"GovCon Giants" <${process.env.SMTP_USER || 'hello@govconedu.com'}>`,
      to,
      subject: 'Your Opportunity Hunter Pro Access is Ready! | GovCon Giants',
      html: htmlContent,
      text: `Welcome to Opportunity Hunter Pro!

Hi${customerName ? ` ${customerName}` : ''},

Thank you for your purchase! Your Opportunity Hunter Pro access is now active.

Your Pro Features:
- Agency Pain Points & Priorities - Know what challenges your target agencies face
- Market Research Tips - Actionable guidance for each agency
- CSV Export - Download results for your BD pipeline
- Print Results - Save reports for offline use
- Unlimited Searches - Search as many times as you need

How to Access:
1. Go to ${accessLink}
2. Click "I Have Access" and enter your email: ${to}
3. Start discovering agencies that buy what you sell!

Your registered email: ${to}
Use this email to verify your Pro access anytime.

Save this email for future reference.
Questions? Reply to this email for support.

- GovCon Giants Team`,
    });

    console.log(`✅ Opportunity Hunter Pro email sent to ${to}`);
    return true;
  } catch (error) {
    console.error('❌ Failed to send Opportunity Hunter Pro email:', error);
    return false;
  }
}

// Interface for license key email
interface SendLicenseKeyEmailParams {
  to: string;
  customerName?: string;
  licenseKey: string;
  productName: string;
  accessLink?: string;
}

// Generic email for sending license key after purchase
// Interface for free resource confirmation email
interface SendFreeResourceEmailParams {
  to: string;
  name?: string;
  resourceName: string;
  resourceDescription: string;
  downloadUrl: string;
}

// Email for free resource download confirmation
export async function sendFreeResourceEmail({
  to,
  name,
  resourceName,
  resourceDescription,
  downloadUrl,
}: SendFreeResourceEmailParams): Promise<boolean> {
  const fullDownloadUrl = `https://shop.govcongiants.org${downloadUrl}`;
  const freeResourcesUrl = 'https://shop.govcongiants.org/free-resources';
  const storeUrl = 'https://shop.govcongiants.org/store';

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 28px;">GovCon Giants</h1>
    <p style="color: #d1fae5; margin: 10px 0 0 0;">Free Resource Download</p>
  </div>

  <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
    <h2 style="color: #059669; margin-top: 0;">Your Free Resource is Ready!</h2>

    <p>Hi${name ? ` ${name}` : ''},</p>

    <p>Thank you for downloading <strong>${resourceName}</strong> from GovCon Giants!</p>

    <div style="background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%); border: 2px solid #10b981; border-radius: 12px; padding: 25px; margin: 25px 0; text-align: center;">
      <p style="margin: 0 0 5px 0; color: #065f46; font-weight: 600;">${resourceName}</p>
      <p style="margin: 0 0 20px 0; color: #047857; font-size: 14px;">${resourceDescription}</p>
      <a href="${fullDownloadUrl}" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block; font-size: 16px;">Download Now</a>
    </div>

    <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 20px; margin: 25px 0;">
      <h3 style="color: #166534; margin: 0 0 10px 0;">More Free Resources Available:</h3>
      <ul style="color: #15803d; margin: 0; padding-left: 20px;">
        <li>SBLO Contact List - Direct contacts for small business outreach</li>
        <li>December Spend Forecast - Year-end spending predictions</li>
        <li>Capability Statement Template - Professional template to customize</li>
        <li>SBLO Email Scripts - Ready-to-use outreach templates</li>
        <li>Proposal Response Checklist - Comprehensive compliance checklist</li>
      </ul>
      <p style="margin: 15px 0 0 0;">
        <a href="${freeResourcesUrl}" style="color: #059669; font-weight: 600;">View All Free Resources →</a>
      </p>
    </div>

    <div style="background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%); border-radius: 8px; padding: 25px; margin: 25px 0; text-align: center;">
      <h3 style="color: white; margin: 0 0 10px 0;">Ready to Level Up?</h3>
      <p style="color: #93c5fd; margin: 0 0 20px 0;">Check out our premium GovCon tools for serious contractors.</p>
      <a href="${storeUrl}" style="background: #f59e0b; color: #1e3a8a; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">View Premium Tools</a>
    </div>

    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

    <p style="color: #6b7280; font-size: 12px; text-align: center;">
      You received this email because you downloaded a free resource from GovCon Giants.<br>
      <a href="${freeResourcesUrl}" style="color: #6b7280;">Access your resources anytime</a> using this email: ${to}
    </p>

    <p style="text-align: center; color: #9ca3af; font-size: 12px;">
      &copy; ${new Date().getFullYear()} GovCon Giants. All rights reserved.
    </p>
  </div>
</body>
</html>
`;

  try {
    await transporter.sendMail({
      from: `"GovCon Giants" <${process.env.SMTP_USER || 'hello@govconedu.com'}>`,
      to,
      subject: `Your Free Download: ${resourceName} | GovCon Giants`,
      html: htmlContent,
      text: `Your Free Resource is Ready!

Hi${name ? ` ${name}` : ''},

Thank you for downloading ${resourceName} from GovCon Giants!

${resourceDescription}

Download your resource here: ${fullDownloadUrl}

More Free Resources Available:
- SBLO Contact List - Direct contacts for small business outreach
- December Spend Forecast - Year-end spending predictions
- Capability Statement Template - Professional template to customize
- SBLO Email Scripts - Ready-to-use outreach templates
- Proposal Response Checklist - Comprehensive compliance checklist

View all free resources: ${freeResourcesUrl}

Ready to Level Up?
Check out our premium GovCon tools: ${storeUrl}

You received this email because you downloaded a free resource from GovCon Giants.
Access your resources anytime using this email: ${to}

- GovCon Giants Team`,
    });

    console.log(`✅ Free resource email sent to ${to} for ${resourceName}`);
    return true;
  } catch (error) {
    console.error('❌ Failed to send free resource email:', error);
    return false;
  }
}

export async function sendLicenseKeyEmail({
  to,
  customerName,
  licenseKey,
  productName,
  accessLink,
}: SendLicenseKeyEmailParams): Promise<boolean> {
  const activateUrl = 'https://shop.govcongiants.org/activate';

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #1e3a8a 0%, #7c3aed 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 28px;">GovCon Giants</h1>
    <p style="color: #c4b5fd; margin: 10px 0 0 0;">Purchase Confirmation</p>
  </div>

  <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
    <h2 style="color: #1e3a8a; margin-top: 0;">Thank You for Your Purchase!</h2>

    <p>Hi${customerName ? ` ${customerName}` : ''},</p>

    <p>Your payment for <strong>${productName}</strong> has been confirmed.</p>

    <div style="background: linear-gradient(135deg, #eff6ff 0%, #e0e7ff 100%); border: 2px solid #3b82f6; border-radius: 12px; padding: 25px; margin: 25px 0; text-align: center;">
      <p style="margin: 0 0 10px 0; color: #1e40af; font-weight: 600; font-size: 14px;">Your License Key:</p>
      <div style="font-family: monospace; font-size: 24px; font-weight: bold; color: #1e40af; background: white; padding: 15px 25px; border-radius: 8px; display: inline-block; letter-spacing: 2px; border: 2px dashed #3b82f6;">
        ${licenseKey}
      </div>
      <p style="margin: 15px 0 0 0; color: #64748b; font-size: 13px;">Save this key - you'll need it to activate your access</p>
    </div>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${activateUrl}" style="background: linear-gradient(135deg, #3b82f6 0%, #7c3aed 100%); color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block; font-size: 18px;">Activate Your License</a>
    </div>

    <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 20px; margin: 25px 0;">
      <h3 style="color: #166534; margin: 0 0 10px 0;">How to Activate:</h3>
      <ol style="color: #15803d; margin: 0; padding-left: 20px;">
        <li>Go to <a href="${activateUrl}" style="color: #166534;">${activateUrl}</a></li>
        <li>Enter your email: <strong>${to}</strong></li>
        <li>Enter your license key (optional - email alone works too)</li>
        <li>Click "Activate License" to unlock your tools</li>
      </ol>
    </div>

    ${accessLink ? `
    <p style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 15px; color: #92400e;">
      <strong>Direct Access Link:</strong><br>
      <a href="${accessLink}" style="color: #92400e; word-break: break-all;">${accessLink}</a>
    </p>
    ` : ''}

    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

    <p style="color: #6b7280; font-size: 12px; text-align: center;">
      <strong>Keep this email safe!</strong> Your license key is your proof of purchase.<br>
      Questions? Reply to this email or contact support@govcongiants.com
    </p>

    <p style="text-align: center; color: #9ca3af; font-size: 12px;">
      &copy; ${new Date().getFullYear()} GovCon Giants. All rights reserved.
    </p>
  </div>
</body>
</html>
`;

  try {
    await transporter.sendMail({
      from: `"GovCon Giants" <${process.env.SMTP_USER || 'hello@govconedu.com'}>`,
      to,
      subject: `Your ${productName} License Key | GovCon Giants`,
      html: htmlContent,
      text: `Thank You for Your Purchase!

Hi${customerName ? ` ${customerName}` : ''},

Your payment for ${productName} has been confirmed.

Your License Key: ${licenseKey}

How to Activate:
1. Go to ${activateUrl}
2. Enter your email: ${to}
3. Enter your license key (optional - email alone works too)
4. Click "Activate License" to unlock your tools

${accessLink ? `Direct Access Link: ${accessLink}` : ''}

Keep this email safe! Your license key is your proof of purchase.
Questions? Reply to this email or contact support@govcongiants.com

- GovCon Giants Team`,
    });

    console.log(`✅ License key email sent to ${to} for ${productName}`);
    return true;
  } catch (error) {
    console.error('❌ Failed to send license key email:', error);
    return false;
  }
}

// Email for Content Reaper access
interface SendContentReaperEmailParams {
  to: string;
  customerName?: string;
  tier?: 'standard' | 'full_fix';
}

export async function sendContentReaperEmail({
  to,
  customerName,
  tier = 'standard',
}: SendContentReaperEmailParams): Promise<boolean> {
  const accessLink = 'https://tools.govcongiants.org/content-generator';
  const isFullFix = tier === 'full_fix';
  const dailyAlertsLink = await createSecureAccessUrl(to, 'preferences');

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 28px;">GovCon Giants</h1>
    <p style="color: #ddd6fe; margin: 10px 0 0 0;">Content Reaper${isFullFix ? ' Full Fix' : ''}</p>
  </div>

  <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
    <h2 style="color: #7c3aed; margin-top: 0;">Your Content Reaper Access is Ready!</h2>

    <p>Hi${customerName ? ` ${customerName}` : ''},</p>

    <p>Thank you for your purchase! Your <strong>Content Reaper${isFullFix ? ' Full Fix' : ''}</strong> access is now active.</p>

    <div style="background: linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%); border: 2px solid #7c3aed; border-radius: 12px; padding: 20px; margin: 25px 0;">
      <h3 style="color: #5b21b6; margin: 0 0 15px 0;">🚀 What You Can Do:</h3>
      <ul style="color: #6d28d9; margin: 0; padding-left: 20px;">
        <li><strong>Generate up to 30 LinkedIn posts</strong> per click</li>
        <li><strong>250 federal agencies</strong> with AI-powered pain points</li>
        <li><strong>Export to .docx</strong> for easy editing</li>
        <li><strong>Bulk download as .zip</strong> for your content calendar</li>
        ${isFullFix ? '<li><strong>Advanced AI writing</strong> with enhanced prompts</li>' : ''}
        ${isFullFix ? '<li><strong>Quote card graphics</strong> for visual posts</li>' : ''}
      </ul>
    </div>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${accessLink}" style="background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%); color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block; font-size: 18px;">Start Creating Content</a>
    </div>

    <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 20px; margin: 25px 0;">
      <h3 style="color: #166534; margin: 0 0 10px 0;">💡 How to Access:</h3>
      <ol style="color: #15803d; margin: 0; padding-left: 20px;">
        <li>Go to <a href="${accessLink}" style="color: #166534;">${accessLink}</a></li>
        <li>Click "I Have Access" and enter your email: <strong>${to}</strong></li>
        <li>Select your NAICS code and target agencies</li>
        <li>Click "Generate Posts" and watch the magic!</li>
      </ol>
    </div>

    <p style="background: #eff6ff; border: 1px solid #93c5fd; border-radius: 8px; padding: 15px; color: #1e40af;">
      <strong>Your registered email:</strong> ${to}<br>
      <span style="font-size: 14px;">Use this email to verify your access anytime.</span>
    </p>

    <div style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border: 2px solid #22c55e; border-radius: 12px; padding: 25px; margin: 25px 0;">
      <h3 style="color: #166534; margin: 0 0 10px 0; text-align: center;">🎁 BONUS: Free Daily Opportunity Alerts</h3>
      <p style="color: #15803d; margin: 0 0 15px 0; text-align: center;">As a GovCon Giants customer, you're automatically enrolled in our <strong>FREE Daily Alerts</strong> beta!</p>
      <p style="color: #166534; margin: 0 0 15px 0; font-size: 14px;">Get personalized federal contract opportunities delivered to your inbox every day. Set up your NAICS codes to receive opportunities matched to YOUR business:</p>
      <div style="text-align: center;">
        <a href="${dailyAlertsLink}" style="display: inline-block; background: #22c55e; color: white !important; text-decoration: none; padding: 14px 35px; border-radius: 8px; font-weight: 600; font-size: 16px;">Set Up Your Daily Alerts</a>
      </div>
    </div>

    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

    <p style="color: #6b7280; font-size: 12px; text-align: center;">
      Save this email for future reference.<br>
      Questions? Reply to this email for support.
    </p>

    <p style="text-align: center; color: #9ca3af; font-size: 12px;">
      &copy; ${new Date().getFullYear()} GovCon Giants. All rights reserved.
    </p>
  </div>
</body>
</html>
`;

  try {
    await transporter.sendMail({
      from: `"GovCon Giants" <${process.env.SMTP_USER || 'hello@govconedu.com'}>`,
      to,
      subject: `Your Content Reaper${isFullFix ? ' Full Fix' : ''} Access is Ready! | GovCon Giants`,
      html: htmlContent,
      text: `Your Content Reaper${isFullFix ? ' Full Fix' : ''} Access is Ready!

Hi${customerName ? ` ${customerName}` : ''},

Thank you for your purchase! Your Content Reaper${isFullFix ? ' Full Fix' : ''} access is now active.

What You Can Do:
- Generate up to 30 LinkedIn posts per click
- 250 federal agencies with AI-powered pain points
- Export to .docx for easy editing
- Bulk download as .zip for your content calendar
${isFullFix ? '- Advanced AI writing with enhanced prompts\n- Quote card graphics for visual posts' : ''}

How to Access:
1. Go to ${accessLink}
2. Click "I Have Access" and enter your email: ${to}
3. Select your NAICS code and target agencies
4. Click "Generate Posts" and watch the magic!

Your registered email: ${to}

Save this email for future reference.
Questions? Reply to this email for support.

- GovCon Giants Team`,
    });

    console.log(`✅ Content Reaper email sent to ${to}`);
    return true;
  } catch (error) {
    console.error('❌ Failed to send Content Reaper email:', error);
    return false;
  }
}

// Email for Recompete Tracker access
interface SendRecompeteEmailParams {
  to: string;
  customerName?: string;
}

export async function sendRecompeteEmail({
  to,
  customerName,
}: SendRecompeteEmailParams): Promise<boolean> {
  const accessLink = 'https://tools.govcongiants.org/recompete';
  const dailyAlertsLink = await createSecureAccessUrl(to, 'preferences');

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #059669 0%, #047857 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 28px;">GovCon Giants</h1>
    <p style="color: #a7f3d0; margin: 10px 0 0 0;">Recompete Tracker</p>
  </div>

  <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
    <h2 style="color: #059669; margin-top: 0;">Your Recompete Tracker Access is Ready!</h2>

    <p>Hi${customerName ? ` ${customerName}` : ''},</p>

    <p>Thank you for your purchase! Your <strong>Recompete Tracker</strong> access is now active.</p>

    <div style="background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%); border: 2px solid #059669; border-radius: 12px; padding: 20px; margin: 25px 0;">
      <h3 style="color: #065f46; margin: 0 0 15px 0;">📋 What You Can Do:</h3>
      <ul style="color: #047857; margin: 0; padding-left: 20px;">
        <li><strong>6,900+ expiring contracts</strong> ready to recompete</li>
        <li><strong>Filter by NAICS, agency, state, value</strong></li>
        <li><strong>See incumbent contractors</strong> and contract history</li>
        <li><strong>Export to CSV</strong> for your BD pipeline</li>
        <li><strong>AI Win Probability scores</strong> for each opportunity</li>
        <li><strong>Teaming suggestions</strong> based on your profile</li>
      </ul>
    </div>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${accessLink}" style="background: linear-gradient(135deg, #059669 0%, #047857 100%); color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block; font-size: 18px;">Find Recompete Opportunities</a>
    </div>

    <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 20px; margin: 25px 0;">
      <h3 style="color: #166534; margin: 0 0 10px 0;">💡 How to Access:</h3>
      <ol style="color: #15803d; margin: 0; padding-left: 20px;">
        <li>Go to <a href="${accessLink}" style="color: #166534;">${accessLink}</a></li>
        <li>Click "I Have Access" and enter your email: <strong>${to}</strong></li>
        <li>Use filters to find contracts in your NAICS codes</li>
        <li>Click any contract to see details and incumbent info</li>
      </ol>
    </div>

    <p style="background: #eff6ff; border: 1px solid #93c5fd; border-radius: 8px; padding: 15px; color: #1e40af;">
      <strong>Your registered email:</strong> ${to}<br>
      <span style="font-size: 14px;">Use this email to verify your access anytime.</span>
    </p>

    <div style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border: 2px solid #22c55e; border-radius: 12px; padding: 25px; margin: 25px 0;">
      <h3 style="color: #166534; margin: 0 0 10px 0; text-align: center;">🎁 BONUS: Free Daily Opportunity Alerts</h3>
      <p style="color: #15803d; margin: 0 0 15px 0; text-align: center;">As a GovCon Giants customer, you're automatically enrolled in our <strong>FREE Daily Alerts</strong> beta!</p>
      <p style="color: #166534; margin: 0 0 15px 0; font-size: 14px;">Get personalized federal contract opportunities delivered to your inbox every day. Set up your NAICS codes to receive opportunities matched to YOUR business:</p>
      <div style="text-align: center;">
        <a href="${dailyAlertsLink}" style="display: inline-block; background: #22c55e; color: white !important; text-decoration: none; padding: 14px 35px; border-radius: 8px; font-weight: 600; font-size: 16px;">Set Up Your Daily Alerts</a>
      </div>
    </div>

    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

    <p style="color: #6b7280; font-size: 12px; text-align: center;">
      Save this email for future reference.<br>
      Questions? Reply to this email for support.
    </p>

    <p style="text-align: center; color: #9ca3af; font-size: 12px;">
      &copy; ${new Date().getFullYear()} GovCon Giants. All rights reserved.
    </p>
  </div>
</body>
</html>
`;

  try {
    await transporter.sendMail({
      from: `"GovCon Giants" <${process.env.SMTP_USER || 'hello@govconedu.com'}>`,
      to,
      subject: 'Your Recompete Tracker Access is Ready! | GovCon Giants',
      html: htmlContent,
      text: `Your Recompete Tracker Access is Ready!

Hi${customerName ? ` ${customerName}` : ''},

Thank you for your purchase! Your Recompete Tracker access is now active.

What You Can Do:
- 6,900+ expiring contracts ready to recompete
- Filter by NAICS, agency, state, value
- See incumbent contractors and contract history
- Export to CSV for your BD pipeline
- AI Win Probability scores for each opportunity
- Teaming suggestions based on your profile

How to Access:
1. Go to ${accessLink}
2. Click "I Have Access" and enter your email: ${to}
3. Use filters to find contracts in your NAICS codes
4. Click any contract to see details and incumbent info

Your registered email: ${to}

Save this email for future reference.
Questions? Reply to this email for support.

- GovCon Giants Team`,
    });

    console.log(`✅ Recompete Tracker email sent to ${to}`);
    return true;
  } catch (error) {
    console.error('❌ Failed to send Recompete Tracker email:', error);
    return false;
  }
}

// Email for Bundle purchases
interface SendBundleEmailParams {
  to: string;
  customerName?: string;
  bundle: string;
}

export async function sendBundleEmail({
  to,
  customerName,
  bundle,
}: SendBundleEmailParams): Promise<boolean> {
  const activateUrl = 'https://shop.govcongiants.org/activate';
  const dailyAlertsLink = await createSecureAccessUrl(to, 'preferences');

  // Define what's in each bundle
  const bundleContents: Record<string, { name: string; tools: { name: string; link: string; description: string }[] }> = {
    'starter': {
      name: 'GovCon Starter Bundle',
      tools: [
        { name: 'Opportunity Hunter Pro', link: 'https://tools.govcongiants.org/opportunity-hunter', description: 'Find agencies that buy what you sell' },
        { name: 'Recompete Tracker', link: 'https://tools.govcongiants.org/recompete', description: '6,900+ expiring contracts to pursue' },
        { name: 'Federal Contractor Database', link: 'https://tools.govcongiants.org/contractor-database', description: '3,500+ prime contractors with SBLO contacts' },
      ],
    },
    'govcon-starter-bundle': {
      name: 'GovCon Starter Bundle',
      tools: [
        { name: 'Opportunity Hunter Pro', link: 'https://tools.govcongiants.org/opportunity-hunter', description: 'Find agencies that buy what you sell' },
        { name: 'Recompete Tracker', link: 'https://tools.govcongiants.org/recompete', description: '6,900+ expiring contracts to pursue' },
        { name: 'Federal Contractor Database', link: 'https://tools.govcongiants.org/contractor-database', description: '3,500+ prime contractors with SBLO contacts' },
      ],
    },
    'pro': {
      name: 'Pro Giant Bundle',
      tools: [
        { name: 'Federal Contractor Database', link: 'https://tools.govcongiants.org/contractor-database', description: '3,500+ prime contractors with SBLO contacts' },
        { name: 'Recompete Tracker', link: 'https://tools.govcongiants.org/recompete', description: '6,900+ expiring contracts to pursue' },
        { name: 'Market Assassin Standard', link: 'https://tools.govcongiants.org/market-assassin', description: 'Strategic market intelligence reports' },
        { name: 'Content Reaper', link: 'https://tools.govcongiants.org/content-generator', description: 'AI-powered LinkedIn content generator' },
      ],
    },
    'pro-giant-bundle': {
      name: 'Pro Giant Bundle',
      tools: [
        { name: 'Federal Contractor Database', link: 'https://tools.govcongiants.org/contractor-database', description: '3,500+ prime contractors with SBLO contacts' },
        { name: 'Recompete Tracker', link: 'https://tools.govcongiants.org/recompete', description: '6,900+ expiring contracts to pursue' },
        { name: 'Market Assassin Standard', link: 'https://tools.govcongiants.org/market-assassin', description: 'Strategic market intelligence reports' },
        { name: 'Content Reaper', link: 'https://tools.govcongiants.org/content-generator', description: 'AI-powered LinkedIn content generator' },
      ],
    },
    'ultimate': {
      name: 'Ultimate GovCon Bundle',
      tools: [
        { name: 'Content Reaper Full Fix', link: 'https://tools.govcongiants.org/content-generator', description: 'Advanced AI content with quote graphics' },
        { name: 'Federal Contractor Database', link: 'https://tools.govcongiants.org/contractor-database', description: '3,500+ prime contractors with SBLO contacts' },
        { name: 'Recompete Tracker', link: 'https://tools.govcongiants.org/recompete', description: '6,900+ expiring contracts to pursue' },
        { name: 'Market Assassin Premium', link: 'https://tools.govcongiants.org/market-assassin', description: 'All 8 strategic intelligence reports' },
        { name: 'Opportunity Hunter Pro', link: 'https://tools.govcongiants.org/opportunity-hunter', description: 'Find agencies that buy what you sell' },
      ],
    },
    'ultimate-govcon-bundle': {
      name: 'Ultimate GovCon Bundle',
      tools: [
        { name: 'Content Reaper Full Fix', link: 'https://tools.govcongiants.org/content-generator', description: 'Advanced AI content with quote graphics' },
        { name: 'Federal Contractor Database', link: 'https://tools.govcongiants.org/contractor-database', description: '3,500+ prime contractors with SBLO contacts' },
        { name: 'Recompete Tracker', link: 'https://tools.govcongiants.org/recompete', description: '6,900+ expiring contracts to pursue' },
        { name: 'Market Assassin Premium', link: 'https://tools.govcongiants.org/market-assassin', description: 'All 8 strategic intelligence reports' },
        { name: 'Opportunity Hunter Pro', link: 'https://tools.govcongiants.org/opportunity-hunter', description: 'Find agencies that buy what you sell' },
      ],
    },
  };

  const bundleInfo = bundleContents[bundle] || bundleContents['starter'];

  const toolsHtml = bundleInfo.tools.map(tool => `
    <tr>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">
        <a href="${tool.link}" style="color: #1e40af; font-weight: 600; text-decoration: none;">${tool.name}</a>
        <br><span style="color: #6b7280; font-size: 13px;">${tool.description}</span>
      </td>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">
        <a href="${tool.link}" style="background: #3b82f6; color: white; padding: 6px 12px; text-decoration: none; border-radius: 4px; font-size: 13px;">Access →</a>
      </td>
    </tr>
  `).join('');

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #1e3a8a 0%, #7c3aed 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 28px;">GovCon Giants</h1>
    <p style="color: #c4b5fd; margin: 10px 0 0 0;">${bundleInfo.name}</p>
  </div>

  <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
    <h2 style="color: #1e3a8a; margin-top: 0;">🎉 Your Bundle is Ready!</h2>

    <p>Hi${customerName ? ` ${customerName}` : ''},</p>

    <p>Thank you for purchasing the <strong>${bundleInfo.name}</strong>! All your tools are now active and ready to use.</p>

    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; margin: 25px 0; overflow: hidden;">
      <div style="background: #1e3a8a; color: white; padding: 12px 15px; font-weight: 600;">
        Your Included Tools
      </div>
      <table style="width: 100%; border-collapse: collapse;">
        ${toolsHtml}
      </table>
    </div>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${activateUrl}" style="background: linear-gradient(135deg, #3b82f6 0%, #7c3aed 100%); color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block; font-size: 18px;">Activate All Tools</a>
    </div>

    <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 20px; margin: 25px 0;">
      <h3 style="color: #166534; margin: 0 0 10px 0;">💡 How to Access Your Tools:</h3>
      <ol style="color: #15803d; margin: 0; padding-left: 20px;">
        <li>Click any tool link above to go directly to it</li>
        <li>Click "I Have Access" and enter your email: <strong>${to}</strong></li>
        <li>Start using your tools immediately!</li>
      </ol>
    </div>

    <p style="background: #eff6ff; border: 1px solid #93c5fd; border-radius: 8px; padding: 15px; color: #1e40af;">
      <strong>Your registered email:</strong> ${to}<br>
      <span style="font-size: 14px;">Use this email to access all your tools.</span>
    </p>

    <div style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border: 2px solid #22c55e; border-radius: 12px; padding: 25px; margin: 25px 0;">
      <h3 style="color: #166534; margin: 0 0 10px 0; text-align: center;">🎁 BONUS: Free Daily Opportunity Alerts</h3>
      <p style="color: #15803d; margin: 0 0 15px 0; text-align: center;">As a GovCon Giants customer, you're automatically enrolled in our <strong>FREE Daily Alerts</strong> beta!</p>
      <p style="color: #166534; margin: 0 0 15px 0; font-size: 14px;">Get personalized federal contract opportunities delivered to your inbox every day. Set up your NAICS codes to receive opportunities matched to YOUR business:</p>
      <div style="text-align: center;">
        <a href="${dailyAlertsLink}" style="display: inline-block; background: #22c55e; color: white !important; text-decoration: none; padding: 14px 35px; border-radius: 8px; font-weight: 600; font-size: 16px;">Set Up Your Daily Alerts</a>
      </div>
    </div>

    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

    <p style="color: #6b7280; font-size: 12px; text-align: center;">
      Save this email - it's your receipt and access guide.<br>
      Questions? Reply to this email for support.
    </p>

    <p style="text-align: center; color: #9ca3af; font-size: 12px;">
      &copy; ${new Date().getFullYear()} GovCon Giants. All rights reserved.
    </p>
  </div>
</body>
</html>
`;

  try {
    await transporter.sendMail({
      from: `"GovCon Giants" <${process.env.SMTP_USER || 'hello@govconedu.com'}>`,
      to,
      subject: `Your ${bundleInfo.name} is Ready! | GovCon Giants`,
      html: htmlContent,
      text: `Your ${bundleInfo.name} is Ready!

Hi${customerName ? ` ${customerName}` : ''},

Thank you for purchasing the ${bundleInfo.name}! All your tools are now active.

Your Included Tools:
${bundleInfo.tools.map(t => `- ${t.name}: ${t.link}\n  ${t.description}`).join('\n')}

How to Access:
1. Click any tool link above
2. Click "I Have Access" and enter your email: ${to}
3. Start using your tools immediately!

Your registered email: ${to}

Save this email - it's your receipt and access guide.
Questions? Reply to this email for support.

- GovCon Giants Team`,
    });

    console.log(`✅ Bundle email sent to ${to} for ${bundleInfo.name}`);
    return true;
  } catch (error) {
    console.error('❌ Failed to send bundle email:', error);
    return false;
  }
}

// Email for Federal Help Center membership
interface SendFHCWelcomeEmailParams {
  to: string;
  customerName?: string;
}

export async function sendFHCWelcomeEmail({
  to,
  customerName,
}: SendFHCWelcomeEmailParams): Promise<boolean> {
  const fhcLink = 'https://federalhelpcenter.com';
  const maLink = 'https://tools.govcongiants.org/market-assassin';

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 28px;">Welcome to Federal Help Center!</h1>
    <p style="color: #bfdbfe; margin: 10px 0 0 0;">Your GovCon Success Journey Starts Now</p>
  </div>

  <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
    <h2 style="color: #1e40af; margin-top: 0;">🎉 You're In!</h2>

    <p>Hi${customerName ? ` ${customerName}` : ''},</p>

    <p>Welcome to the <strong>Federal Help Center</strong> community! Your membership is now active and you have access to everything.</p>

    <div style="background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); border: 2px solid #3b82f6; border-radius: 12px; padding: 20px; margin: 25px 0;">
      <h3 style="color: #1e40af; margin: 0 0 15px 0;">🎁 Your Membership Includes:</h3>
      <ul style="color: #1e3a8a; margin: 0; padding-left: 20px;">
        <li><strong>Live coaching calls</strong> - Get your questions answered</li>
        <li><strong>Weekly webinars</strong> - Stay updated on GovCon trends</li>
        <li><strong>Training vault</strong> - All our courses and resources</li>
        <li><strong>Community access</strong> - Network with other contractors</li>
        <li><strong>Market Assassin Standard</strong> - Strategic intelligence tool (FREE bonus!)</li>
        <li><strong>Daily Briefings</strong> - Personalized intel delivered to your inbox</li>
      </ul>
    </div>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${fhcLink}" style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block; font-size: 18px; margin: 5px;">Access Federal Help Center</a>
    </div>

    <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 20px; margin: 25px 0;">
      <h3 style="color: #92400e; margin: 0 0 10px 0;">🎯 Your FREE Tool Access:</h3>
      <p style="color: #78350f; margin: 0 0 15px 0;">As a member, you get <strong>Market Assassin Standard</strong> ($297 value) included free!</p>
      <a href="${maLink}" style="background: #f59e0b; color: #78350f; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">Access Market Assassin →</a>
    </div>

    <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 20px; margin: 25px 0;">
      <h3 style="color: #166534; margin: 0 0 10px 0;">📧 Daily Briefings Starting Soon:</h3>
      <p style="color: #15803d; margin: 0;">You'll receive personalized daily intelligence briefings with opportunities, recompetes, and market news tailored to your business. Watch your inbox!</p>
    </div>

    <p style="background: #eff6ff; border: 1px solid #93c5fd; border-radius: 8px; padding: 15px; color: #1e40af;">
      <strong>Your registered email:</strong> ${to}<br>
      <span style="font-size: 14px;">Use this email to access all membership benefits and tools.</span>
    </p>

    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

    <p style="color: #6b7280; font-size: 12px; text-align: center;">
      Questions? Reply to this email or ask in the community.<br>
      We're here to help you win federal contracts!
    </p>

    <p style="text-align: center; color: #9ca3af; font-size: 12px;">
      &copy; ${new Date().getFullYear()} GovCon Giants. All rights reserved.
    </p>
  </div>
</body>
</html>
`;

  try {
    await transporter.sendMail({
      from: `"GovCon Giants" <${process.env.SMTP_USER || 'hello@govconedu.com'}>`,
      to,
      subject: 'Welcome to Federal Help Center! Your Membership is Active | GovCon Giants',
      html: htmlContent,
      text: `Welcome to Federal Help Center!

Hi${customerName ? ` ${customerName}` : ''},

Welcome to the Federal Help Center community! Your membership is now active.

Your Membership Includes:
- Live coaching calls - Get your questions answered
- Weekly webinars - Stay updated on GovCon trends
- Training vault - All our courses and resources
- Community access - Network with other contractors
- Market Assassin Standard - Strategic intelligence tool (FREE bonus!)
- Daily Briefings - Personalized intel delivered to your inbox

Access Federal Help Center: ${fhcLink}

Your FREE Tool Access:
As a member, you get Market Assassin Standard ($297 value) included free!
Access it here: ${maLink}

Daily Briefings Starting Soon:
You'll receive personalized daily intelligence briefings with opportunities, recompetes, and market news tailored to your business.

Your registered email: ${to}

Questions? Reply to this email or ask in the community.
We're here to help you win federal contracts!

- GovCon Giants Team`,
    });

    console.log(`✅ FHC Welcome email sent to ${to}`);
    return true;
  } catch (error) {
    console.error('❌ Failed to send FHC Welcome email:', error);
    return false;
  }
}

// ============ Alert Pro Welcome Email ============

interface SendAlertProWelcomeEmailParams {
  to: string;
  customerName?: string;
}

export async function sendAlertProWelcomeEmail({
  to,
  customerName,
}: SendAlertProWelcomeEmailParams): Promise<boolean> {
  const preferencesLink = await createSecureAccessUrl(to, 'preferences');
  const maLink = 'https://tools.govcongiants.org/market-assassin';

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.5; color: #1f2937; max-width: 600px; margin: 0 auto; padding: 20px; background: #f8fafc;">

  <div style="background: linear-gradient(135deg, #059669 0%, #10b981 100%); padding: 30px; text-align: center; border-radius: 12px 12px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 26px;">🎯 Alert Pro Activated!</h1>
    <p style="color: #d1fae5; margin: 10px 0 0 0; font-size: 16px;">Daily Unlimited Opportunities Start Tomorrow</p>
  </div>

  <div style="background: #ffffff; padding: 28px; border: 1px solid #e2e8f0; border-top: none;">
    <p style="font-size: 16px; margin-top: 0;">Hi${customerName ? ` ${customerName}` : ''},</p>

    <p>Welcome to <strong>Alert Pro</strong>! Starting tomorrow morning, you'll receive daily emails with <em>every</em> SAM.gov opportunity that matches your profile.</p>

    <div style="background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%); border: 2px solid #10b981; border-radius: 10px; padding: 20px; margin: 24px 0;">
      <h3 style="color: #065f46; margin: 0 0 14px 0; font-size: 17px;">✅ Your Alert Pro Benefits:</h3>
      <ul style="color: #047857; margin: 0; padding-left: 20px; line-height: 1.8;">
        <li><strong>Daily alerts</strong> — Fresh opportunities every morning</li>
        <li><strong>Unlimited opportunities</strong> — No artificial caps</li>
        <li><strong>Priority scoring</strong> — Best matches ranked first</li>
        <li><strong>Deadline tracking</strong> — Never miss a due date</li>
      </ul>
    </div>

    <div style="background: #fef3c7; border: 1px solid #fbbf24; border-radius: 8px; padding: 18px; margin: 24px 0;">
      <h4 style="color: #92400e; margin: 0 0 10px 0;">⚙️ Customize Your Alerts</h4>
      <p style="color: #78350f; margin: 0 0 12px 0; font-size: 14px;">Update your NAICS codes, business type, and location to get the most relevant opportunities.</p>
      <a href="${preferencesLink}" style="background: #f59e0b; color: #78350f; padding: 10px 18px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block; font-size: 14px;">Manage Preferences →</a>
    </div>

    <div style="background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%); border: 1px solid #fca5a5; border-radius: 8px; padding: 18px; margin: 24px 0;">
      <h4 style="color: #991b1b; margin: 0 0 10px 0;">🎯 Ready to Win? Try Market Assassin</h4>
      <p style="color: #7f1d1d; margin: 0 0 12px 0; font-size: 14px;">Finding opportunities is step one. Market Assassin shows you exactly how to win them with agency intelligence, competitor analysis, and strategic positioning reports.</p>
      <a href="${maLink}" style="background: #dc2626; color: white; padding: 10px 18px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block; font-size: 14px;">Explore Market Assassin →</a>
    </div>

    <p style="background: #f1f5f9; border-radius: 8px; padding: 14px; color: #475569; font-size: 14px;">
      <strong>Your email:</strong> ${to}<br>
      <strong>Subscription:</strong> $19/month • Cancel anytime
    </p>
  </div>

  <div style="background: #f1f5f9; padding: 18px; border-radius: 0 0 12px 12px; text-align: center;">
    <p style="color: #64748b; font-size: 12px; margin: 0;">
      Questions? Reply to this email or contact <a href="mailto:service@govcongiants.com" style="color: #059669;">service@govcongiants.com</a>
    </p>
    <p style="color: #94a3b8; font-size: 11px; margin: 8px 0 0 0;">
      © ${new Date().getFullYear()} GovCon Giants • tools.govcongiants.org
    </p>
  </div>
</body>
</html>
`;

  try {
    await transporter.sendMail({
      from: `"GovCon Giants" <${process.env.SMTP_USER || 'alerts@govcongiants.com'}>`,
      to,
      subject: '🎯 Alert Pro Activated - Daily Opportunities Start Tomorrow!',
      html: htmlContent,
      text: `Alert Pro Activated!

Hi${customerName ? ` ${customerName}` : ''},

Welcome to Alert Pro! Starting tomorrow morning, you'll receive daily emails with every SAM.gov opportunity that matches your profile.

Your Alert Pro Benefits:
- Daily alerts - Fresh opportunities every morning
- Unlimited opportunities - No artificial caps
- Priority scoring - Best matches ranked first
- Deadline tracking - Never miss a due date

Manage your preferences: ${preferencesLink}

Ready to Win? Try Market Assassin:
Finding opportunities is step one. Market Assassin shows you exactly how to win them.
${maLink}

Your email: ${to}
Subscription: $19/month • Cancel anytime

Questions? Reply to this email or contact service@govcongiants.com

- GovCon Giants Team`,
    });

    console.log(`✅ Alert Pro Welcome email sent to ${to}`);
    return true;
  } catch (error) {
    console.error('❌ Failed to send Alert Pro Welcome email:', error);
    return false;
  }
}
