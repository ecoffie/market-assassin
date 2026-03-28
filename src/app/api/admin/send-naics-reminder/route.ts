/**
 * Send NAICS Setup Reminder Email
 *
 * Sends an explainer email to all users who:
 * 1. Are enrolled in alerts/briefings
 * 2. Haven't set their NAICS codes yet
 *
 * Usage:
 * GET ?password=xxx&mode=preview  - Preview who would receive (default)
 * POST ?password=xxx&mode=execute - Actually send emails
 * POST ?password=xxx&mode=execute&email=xxx - Send to specific user
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';
const BATCH_SIZE = 10;

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.office365.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
  });
}

function generateReminderEmail(email: string): { subject: string; html: string; text: string } {
  const preferencesUrl = `https://tools.govcongiants.org/alerts/preferences?email=${encodeURIComponent(email)}`;

  const subject = "🎯 Unlock Personalized GovCon Intel - Set Your NAICS Codes (30 seconds)";

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1e293b; max-width: 600px; margin: 0 auto; padding: 20px; background: #f8fafc;">
  <div style="background: white; border-radius: 12px; padding: 40px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
    <div style="text-align: center; margin-bottom: 30px;">
      <span style="font-size: 28px; font-weight: 700; color: #1d4ed8;">GovCon</span><span style="font-size: 28px; font-weight: 700; color: #f59e0b;">Giants</span>
    </div>

    <h1 style="color: #1e40af; text-align: center; margin-bottom: 10px;">You're Missing Out on Personalized Intel!</h1>

    <p style="text-align: center; color: #64748b; margin-bottom: 30px;">Take 30 seconds to unlock the full power of your GovCon Giants alerts</p>

    <div style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border: 2px solid #f59e0b; border-radius: 12px; padding: 20px; margin: 25px 0;">
      <h3 style="color: #92400e; margin: 0 0 15px 0;">⚠️ Your Current Status:</h3>
      <p style="color: #78350f; margin: 0;">You're enrolled in our <strong>FREE Daily Alerts</strong> and <strong>Market Intelligence</strong> system, but you haven't set your NAICS codes yet.</p>
      <p style="color: #78350f; margin: 10px 0 0 0;">Right now, you're receiving <em>generic</em> opportunities. Set your NAICS to get opportunities <strong>matched to YOUR business</strong>.</p>
    </div>

    <div style="background: #f0fdf4; border: 2px solid #22c55e; border-radius: 12px; padding: 20px; margin: 25px 0;">
      <h3 style="color: #166534; margin: 0 0 15px 0;">🎁 What You'll Get (FREE):</h3>
      <ul style="color: #15803d; margin: 0; padding-left: 20px;">
        <li><strong>Daily Opportunity Alerts</strong> - Live SAM.gov opportunities in YOUR NAICS codes</li>
        <li><strong>Daily Market Intelligence</strong> - Recompete analysis, competitor wins, teaming leads</li>
        <li><strong>Weekly Pursuit Brief</strong> - Full capture strategy for your TOP opportunity</li>
        <li><strong>Weekly Deep Dive</strong> - Comprehensive market analysis report</li>
      </ul>
    </div>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${preferencesUrl}" style="display: inline-block; background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); color: white; text-decoration: none; padding: 18px 45px; border-radius: 8px; font-weight: 700; font-size: 18px;">Set My NAICS Codes Now</a>
    </div>

    <div style="background: #eff6ff; border: 1px solid #93c5fd; border-radius: 8px; padding: 20px; margin: 25px 0;">
      <h3 style="color: #1e40af; margin: 0 0 10px 0;">💡 Don't Know Your NAICS?</h3>
      <p style="color: #1e40af; margin: 0; font-size: 14px;">No problem! On the preferences page, you can:</p>
      <ul style="color: #1e40af; margin: 10px 0 0 0; padding-left: 20px; font-size: 14px;">
        <li>Choose from popular industry presets (IT, Construction, Healthcare, etc.)</li>
        <li>Enter keywords and we'll match them to NAICS codes</li>
        <li>Select your business type (8(a), SDVOSB, WOSB, HUBZone, etc.)</li>
      </ul>
    </div>

    <p style="text-align: center; color: #64748b; font-size: 14px;">
      This takes less than 30 seconds and dramatically improves your results.
    </p>

    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;">

    <div style="text-align: center; color: #64748b; font-size: 12px;">
      <p style="margin: 0 0 5px 0;"><span style="font-weight: 700; color: #1d4ed8;">GovCon</span><span style="font-weight: 700; color: #f59e0b;">Giants</span> - Your AI-Powered GovCon Intel</p>
      <p style="margin: 0;">Questions? Reply to this email or contact service@govcongiants.com</p>
      <p style="margin: 10px 0 0 0;">
        <a href="https://tools.govcongiants.org/alerts/preferences?email=${encodeURIComponent(email)}&action=unsubscribe" style="color: #94a3b8;">Unsubscribe</a>
      </p>
    </div>
  </div>
</body>
</html>
`;

  const text = `
You're Missing Out on Personalized GovCon Intel!

Take 30 seconds to unlock the full power of your GovCon Giants alerts.

YOUR CURRENT STATUS:
You're enrolled in our FREE Daily Alerts and Market Intelligence system, but you haven't set your NAICS codes yet. Right now, you're receiving generic opportunities. Set your NAICS to get opportunities matched to YOUR business.

WHAT YOU'LL GET (FREE):
- Daily Opportunity Alerts - Live SAM.gov opportunities in YOUR NAICS codes
- Daily Market Intelligence - Recompete analysis, competitor wins, teaming leads
- Weekly Pursuit Brief - Full capture strategy for your TOP opportunity
- Weekly Deep Dive - Comprehensive market analysis report

SET YOUR NAICS CODES NOW:
${preferencesUrl}

DON'T KNOW YOUR NAICS?
No problem! On the preferences page, you can:
- Choose from popular industry presets (IT, Construction, Healthcare, etc.)
- Enter keywords and we'll match them to NAICS codes
- Select your business type (8(a), SDVOSB, WOSB, HUBZone, etc.)

This takes less than 30 seconds and dramatically improves your results.

---
GovCon Giants - Your AI-Powered GovCon Intel
Questions? Reply to this email or contact service@govcongiants.com
`;

  return { subject, html, text };
}

export async function GET(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({
      error: 'Unauthorized',
      usage: 'GET ?password=xxx&mode=preview to see users without NAICS'
    }, { status: 401 });
  }

  const supabase = getSupabase();

  // Find users enrolled in alerts but without NAICS codes
  const { data: alertSettings, error } = await supabase
    .from('user_alert_settings')
    .select('user_email, naics_codes, keywords, business_type, created_at')
    .eq('is_active', true)
    .or('alerts_enabled.eq.true,briefings_enabled.eq.true');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Filter to users without NAICS
  const usersWithoutNaics = (alertSettings || []).filter(user => {
    const naics = user.naics_codes;
    return !naics || naics.length === 0;
  });

  // Also check notification settings table
  const { data: notifSettings } = await supabase
    .from('user_notification_settings')
    .select('user_email, naics_codes, aggregated_profile')
    .eq('is_active', true)
    .eq('briefings_enabled', true);

  const usersWithoutNaicsFromNotif = (notifSettings || []).filter(user => {
    const naics = user.naics_codes;
    const jsonb = user.aggregated_profile as Record<string, unknown> | null;
    const jsonbNaics = jsonb?.naics_codes as string[] | null;
    return (!naics || naics.length === 0) && (!jsonbNaics || jsonbNaics.length === 0);
  });

  // Combine and dedupe
  const allEmails = new Set([
    ...usersWithoutNaics.map(u => u.user_email.toLowerCase()),
    ...usersWithoutNaicsFromNotif.map(u => u.user_email.toLowerCase()),
  ]);

  return NextResponse.json({
    success: true,
    message: `Found ${allEmails.size} users without NAICS codes`,
    totalAlertUsers: alertSettings?.length || 0,
    usersWithoutNaics: allEmails.size,
    emails: Array.from(allEmails).slice(0, 50), // Preview first 50
    usage: {
      preview: 'GET ?password=xxx (current)',
      sendAll: 'POST ?password=xxx&mode=execute',
      sendOne: 'POST ?password=xxx&mode=execute&email=xxx',
    },
  });
}

export async function POST(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');
  const mode = request.nextUrl.searchParams.get('mode');
  const specificEmail = request.nextUrl.searchParams.get('email');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (mode !== 'execute') {
    return NextResponse.json({
      error: 'Use mode=execute to actually send emails',
      usage: 'POST ?password=xxx&mode=execute'
    }, { status: 400 });
  }

  const supabase = getSupabase();
  const transporter = getTransporter();

  // Find users without NAICS
  const { data: alertSettings } = await supabase
    .from('user_alert_settings')
    .select('user_email, naics_codes')
    .eq('is_active', true)
    .or('alerts_enabled.eq.true,briefings_enabled.eq.true');

  const usersWithoutNaics = (alertSettings || []).filter(user => {
    const naics = user.naics_codes;
    return !naics || naics.length === 0;
  });

  let emailsToSend = usersWithoutNaics.map(u => u.user_email.toLowerCase());

  // Filter to specific email if provided
  if (specificEmail) {
    emailsToSend = emailsToSend.filter(e => e === specificEmail.toLowerCase());
    if (emailsToSend.length === 0) {
      // Send anyway even if user has NAICS (for testing)
      emailsToSend = [specificEmail.toLowerCase()];
    }
  }

  const results = {
    sent: 0,
    failed: 0,
    errors: [] as string[],
  };

  // Process in batches
  for (let i = 0; i < emailsToSend.length; i += BATCH_SIZE) {
    const batch = emailsToSend.slice(i, i + BATCH_SIZE);

    const batchPromises = batch.map(async (email) => {
      try {
        const template = generateReminderEmail(email);

        await transporter.sendMail({
          from: `"GovCon Giants" <${process.env.SMTP_USER || 'hello@govconedu.com'}>`,
          to: email,
          subject: template.subject,
          html: template.html,
          text: template.text,
        });

        results.sent++;
        console.log(`[NAICSReminder] ✅ Sent to ${email}`);
      } catch (err) {
        results.failed++;
        results.errors.push(`${email}: ${err}`);
        console.error(`[NAICSReminder] ❌ Failed for ${email}:`, err);
      }
    });

    await Promise.all(batchPromises);

    // Small delay between batches
    if (i + BATCH_SIZE < emailsToSend.length) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  return NextResponse.json({
    success: true,
    totalTargeted: emailsToSend.length,
    sent: results.sent,
    failed: results.failed,
    errors: results.errors.slice(0, 10),
  });
}
