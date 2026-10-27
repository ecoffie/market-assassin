#!/usr/bin/env tsx
/**
 * Send Profile Setup Emails (Drip Campaign)
 *
 * Usage:
 *   npx tsx scripts/send-profile-setup-emails.ts --dry-run     # Preview only
 *   npx tsx scripts/send-profile-setup-emails.ts --limit=2000  # Send up to 2000
 *   npx tsx scripts/send-profile-setup-emails.ts               # Default: 2000/run
 *
 * Sends profile setup emails to bootcamp enrollees who haven't set up their profiles.
 * Run daily for 4-5 days to complete the 8K user drip.
 *
 * Sends through the shared sendEmail() (Resend, from Mindy <alerts@mail.getmindy.ai>), so the
 * suppression list and per-recipient daily cap apply. This script used to build its own
 * Office365 transport and send as "GovCon Giants" <alerts@govcongiants.com>; Mindy mail never
 * goes out on govcongiants.com (sender isolation, 2026-10-27). A send the guard blocks is
 * counted as blocked and NOT stamped invitation_sent_at, so it is not recorded as delivered.
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// send-email.ts builds its Resend client from RESEND_API_KEY at module load. A static import is
// hoisted above dotenv.config(), so load it dynamically in main(), after the env is in place.
type SendEmailFn = (p: {
  to: string; subject: string; html: string; emailType?: string; eventSource?: string;
}) => Promise<boolean>;
let sendEmail: SendEmailFn;

const SUPABASE_URL = 'https://krpyelfrbicmvsmwovti.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string;

if (!process.env.RESEND_API_KEY) {
  console.error('ERROR: RESEND_API_KEY not found in environment (.env.local)');
  process.exit(1);
}

const DEFAULT_LIMIT = 2000;

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

  const users: { user_email: string }[] = await res.json();
  ({ sendEmail } = (await import('../src/lib/send-email')) as unknown as { sendEmail: SendEmailFn });
  console.log(`Found ${users.length} users to email`);

  if (users.length === 0) {
    console.log('No users need setup emails. Done!');
    return;
  }

  if (isDryRun) {
    console.log('\nDRY RUN - Sample of first 10:');
    users.slice(0, 10).forEach((u) => console.log(`  - ${u.user_email}`));
    console.log(`\nWould send ${users.length} emails.`);
    return;
  }

  // Send one by one through sendEmail()
  let sent = 0;
  let blocked = 0;
  let failed = 0;
  const sentEmails: string[] = [];

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
      const ok = await sendEmail({
        to: email,
        subject: '🎯 Set Up Your GovCon Alerts Profile',
        html: generateEmailHtml(email),
        emailType: 'profile_reminder',
        eventSource: 'script:send-profile-setup-emails',
      });
      if (!ok) {
        // Suppressed or over the daily cap: nothing was sent, so do not stamp it as sent.
        blocked++;
        continue;
      }

      sentEmails.push(email);
      sent++;

      // Mark as sent every 50 emails
      if (sentEmails.length >= 50) {
        await markAsSent(sentEmails);
        sentEmails.length = 0;
      }

      process.stdout.write(`\rProgress: ${sent}/${users.length} sent, ${blocked} blocked, ${failed} failed`);

      // Rate limit: small delay between emails
      await new Promise(r => setTimeout(r, 100));
    } catch (err) {
      console.error(`\nFailed to send to ${email}:`, (err as Error).message);
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
  console.log(`Blocked (suppressed / daily cap, not stamped): ${blocked}`);
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

async function markAsSent(emails: string[]) {
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

function generateEmailHtml(email: string) {
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
        <a href="mailto:service@govcongiants.com" style="color: #7c3aed;">service@govcongiants.com</a> • 508-290-6692
      </p>
    </div>
  </div>
</body>
</html>
  `.trim();
}

main().catch(console.error);
