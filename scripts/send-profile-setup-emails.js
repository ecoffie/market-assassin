#!/usr/bin/env node
/**
 * Send Profile Setup Emails (Drip Campaign)
 *
 * Usage:
 *   node scripts/send-profile-setup-emails.js --dry-run     # Preview only
 *   node scripts/send-profile-setup-emails.js --limit=2000  # Send up to 2000
 *   node scripts/send-profile-setup-emails.js               # Default: 2000/run
 *
 * Sends profile setup emails to bootcamp enrollees who haven't set up their profiles.
 * Run daily for 4-5 days to complete the 8K user drip.
 */

const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

// Load environment variables from .env.local file
const envPath = path.join(__dirname, '../.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length) {
      const value = valueParts.join('=').replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
  });
}

const SUPABASE_URL = 'https://krpyelfrbicmvsmwovti.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtycHllbGZyYmljbXZzbXdvdnRpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODA3NTUwMCwiZXhwIjoyMDgzNjUxNTAwfQ.vt66ATmjPwS0HclhBP1g1-dQ-aEPEbWwG4xcn8j4GCg';

// Office365 SMTP transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.office365.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER || 'alerts@govcongiants.com',
    pass: process.env.SMTP_PASSWORD,
  },
});

if (!process.env.SMTP_PASSWORD) {
  console.error('ERROR: SMTP_PASSWORD not found in environment');
  process.exit(1);
}

const DEFAULT_LIMIT = 2000;
const BATCH_SIZE = 100; // Resend batch limit

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const limitArg = args.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1]) : DEFAULT_LIMIT;

  console.log('='.repeat(60));
  console.log('Profile Setup Email Campaign');
  console.log('='.repeat(60));
  console.log(`Mode: ${isDryRun ? 'DRY RUN' : 'EXECUTE'}`);
  console.log(`Limit: ${limit} emails`);
  console.log('');

  // Get users who need setup emails (haven't been sent one yet)
  console.log('Fetching users who need profile setup emails...');
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/user_notification_settings?` +
    `treatment_type=eq.needs_setup&` +
    `invitation_sent_at=is.null&` +
    `select=user_email&` +
    `limit=${limit}`,
    {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      }
    }
  );

  if (!res.ok) {
    console.error('Failed to fetch users:', await res.text());
    process.exit(1);
  }

  const users = await res.json();
  console.log(`Found ${users.length} users to email`);

  if (users.length === 0) {
    console.log('No users need setup emails. Done!');
    return;
  }

  if (isDryRun) {
    console.log('\nDRY RUN - Sample of first 10:');
    users.slice(0, 10).forEach(u => console.log(`  - ${u.user_email}`));
    console.log(`\nWould send ${users.length} emails.`);
    return;
  }

  // Send emails one by one (Office365 doesn't support batch)
  let sent = 0;
  let failed = 0;
  const sentEmails = [];

  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    const email = user.user_email;

    // Skip invalid emails
    if (!email || !email.includes('@') || email.includes(' ')) {
      console.log(`\nSkipping invalid email: ${email}`);
      failed++;
      continue;
    }

    try {
      await transporter.sendMail({
        from: '"GovCon Giants" <alerts@govcongiants.com>',
        to: email,
        subject: '🎯 Set Up Your GovCon Alerts Profile',
        html: generateEmailHtml(email),
      });

      sentEmails.push(email);
      sent++;

      // Mark as sent every 50 emails
      if (sentEmails.length >= 50) {
        await markAsSent(sentEmails);
        sentEmails.length = 0;
      }

      process.stdout.write(`\rProgress: ${sent}/${users.length} sent, ${failed} failed`);

      // Rate limit: small delay between emails
      await new Promise(r => setTimeout(r, 100));
    } catch (err) {
      console.error(`\nFailed to send to ${email}:`, err.message);
      failed++;
    }
  }

  // Mark remaining as sent
  if (sentEmails.length > 0) {
    await markAsSent(sentEmails);
  }

  console.log('\n');
  console.log('='.repeat(60));
  console.log('RESULTS');
  console.log('='.repeat(60));
  console.log(`Sent: ${sent}`);
  console.log(`Failed: ${failed}`);
  console.log('');

  // Show remaining count
  const remainingRes = await fetch(
    `${SUPABASE_URL}/rest/v1/user_notification_settings?` +
    `treatment_type=eq.needs_setup&invitation_sent_at=is.null&select=id&limit=1`,
    {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'count=exact',
      }
    }
  );
  const range = remainingRes.headers.get('content-range');
  const remaining = range ? range.split('/')[1] : 'unknown';
  console.log(`Remaining to send: ${remaining}`);
}

async function markAsSent(emails) {
  // Update in batches of 50 for the IN clause
  for (let i = 0; i < emails.length; i += 50) {
    const chunk = emails.slice(i, i + 50);
    const emailFilter = chunk.map(e => `"${e}"`).join(',');

    await fetch(
      `${SUPABASE_URL}/rest/v1/user_notification_settings?user_email=in.(${emailFilter})`,
      {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({
          invitation_sent_at: new Date().toISOString(),
        }),
      }
    );
  }
}

function generateEmailHtml(email) {
  const setupUrl = `https://tools.govcongiants.org/alerts/signup?email=${encodeURIComponent(email)}`;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f4f4f5;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">

    <!-- Header -->
    <div style="background: linear-gradient(135deg, #1e3a8a 0%, #7c3aed 100%); border-radius: 12px 12px 0 0; padding: 30px; text-align: center;">
      <h1 style="color: white; margin: 0; font-size: 24px;">Your Free Gift from the Bootcamp</h1>
    </div>

    <!-- Body -->
    <div style="background: white; padding: 30px; border-radius: 0 0 12px 12px;">
      <p style="color: #374151; font-size: 16px; line-height: 1.6;">
        Hey Giant,
      </p>

      <p style="color: #374151; font-size: 16px; line-height: 1.6;">
        It's Eric from GovCon Giants.
      </p>

      <p style="color: #374151; font-size: 16px; line-height: 1.6;">
        Because you attended one of our bootcamps, I'm giving you <strong>FREE access to our new Market Intelligence platform</strong> — specifically the Daily Opportunity Alerts.
      </p>

      <p style="color: #374151; font-size: 16px; line-height: 1.6;">
        <strong>What you'll get:</strong>
      </p>

      <ul style="color: #374151; font-size: 16px; line-height: 1.8;">
        <li>Daily emails with federal contract opportunities matching YOUR business</li>
        <li>Opportunities from SAM.gov filtered by your NAICS codes</li>
        <li>No more checking 11 different websites every morning</li>
      </ul>

      <!-- Video Section -->
      <div style="background: #f3f4f6; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center;">
        <p style="color: #374151; font-size: 14px; margin: 0 0 12px 0;">
          <strong>🎬 Want to see it in action?</strong>
        </p>
        <a href="https://www.youtube.com/watch?v=aq-_4bbODNQ" style="color: #7c3aed; font-weight: bold; text-decoration: none;">
          Watch Eric explain the new Market Intelligence platform →
        </a>
      </div>

      <p style="color: #374151; font-size: 16px; line-height: 1.6;">
        But I need you to <strong>set up your profile first</strong> so we know what opportunities to send you. Takes 60 seconds:
      </p>

      <div style="text-align: center; margin: 30px 0;">
        <a href="${setupUrl}" style="display: inline-block; background: linear-gradient(135deg, #7c3aed 0%, #a855f7 100%); color: white; text-decoration: none; padding: 16px 40px; border-radius: 8px; font-weight: bold; font-size: 18px;">
          Set Up My Free Alerts →
        </a>
      </div>

      <p style="color: #6b7280; font-size: 14px; line-height: 1.6;">
        Once you complete your profile, you'll start receiving daily alerts at 7 AM with opportunities that match YOUR NAICS codes and target agencies.
      </p>

      <p style="color: #374151; font-size: 16px; line-height: 1.6; margin-top: 24px;">
        Talk soon,<br>
        <strong>Eric Coffie</strong><br>
        <span style="color: #6b7280;">Founder, GovCon Giants</span>
      </p>

      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

      <p style="color: #9ca3af; font-size: 12px; text-align: center;">
        GovCon Giants • Helping small businesses win federal contracts<br>
        <a href="mailto:service@govcongiants.com" style="color: #7c3aed;">service@govcongiants.com</a> • 786-477-0477
      </p>
    </div>
  </div>
</body>
</html>
  `.trim();
}

main().catch(console.error);
