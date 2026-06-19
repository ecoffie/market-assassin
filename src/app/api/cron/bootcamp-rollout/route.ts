import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { sendEmail } from '@/lib/send-email';
import { MINDY_FROM_NAME, MINDY_SITE_URL, renderMindyEmailLogo } from '@/lib/mindy/email-branding';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const DEFAULT_LIMIT = 200;
const DEFAULT_NAICS: string[] = [];
const ATTENDEE_FILE = path.join(process.cwd(), 'data/bootcamp-attendees-to-enroll.txt');

type NotificationRow = {
  user_email: string;
  invitation_sent_at: string | null;
};

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

function normalizeEmail(email: string) {
  return email.toLowerCase().trim();
}

function isAuthorized(request: NextRequest) {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const authHeader = request.headers.get('authorization');
  const hasCronSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const hasPassword = request.nextUrl.searchParams.get('password') === ADMIN_PASSWORD;
  return isVercelCron || hasCronSecret || hasPassword;
}

function loadAttendeeEmails() {
  const raw = fs.readFileSync(ATTENDEE_FILE, 'utf8');
  return Array.from(new Set(
    raw
      .split(/\r?\n/)
      .map(normalizeEmail)
      .filter(email => email && email.includes('@') && !email.includes(' '))
  ));
}

async function fetchExistingRows(supabase: ReturnType<typeof getSupabase>, emails: string[]) {
  const rows = new Map<string, NotificationRow>();
  const chunkSize = 500;

  for (let i = 0; i < emails.length; i += chunkSize) {
    const chunk = emails.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from('user_notification_settings')
      .select('user_email, invitation_sent_at')
      .in('user_email', chunk);

    if (error) throw error;
    for (const row of (data || []) as NotificationRow[]) {
      rows.set(normalizeEmail(row.user_email), row);
    }
  }

  return rows;
}

async function upsertNeedsSetupRows(supabase: ReturnType<typeof getSupabase>, emails: string[]) {
  if (emails.length === 0) return;
  const now = new Date().toISOString();
  const records = emails.map(email => ({
    user_email: email,
    naics_codes: DEFAULT_NAICS,
    keywords: [],
    agencies: [],
    alerts_enabled: false,
    briefings_enabled: false,
    treatment_type: 'needs_setup',
    is_active: true,
    invitation_source: 'bootcamp-batch-enroll',
    created_at: now,
    updated_at: now,
  }));

  const { error } = await supabase
    .from('user_notification_settings')
    .upsert(records, { onConflict: 'user_email', ignoreDuplicates: true });

  if (error) throw error;
}

async function markInvitationsSent(supabase: ReturnType<typeof getSupabase>, emails: string[]) {
  if (emails.length === 0) return;
  const now = new Date().toISOString();
  const chunkSize = 50;

  for (let i = 0; i < emails.length; i += chunkSize) {
    const chunk = emails.slice(i, i + chunkSize);
    const { error } = await supabase
      .from('user_notification_settings')
      .update({
        invitation_sent_at: now,
        invitation_source: 'bootcamp-batch-enroll',
        updated_at: now,
      })
      .in('user_email', chunk);

    if (error) throw error;
  }
}

function generateEmailHtml(email: string) {
  const setupUrl = `${MINDY_SITE_URL}/alerts/signup?email=${encodeURIComponent(email)}`;

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background-color:#f4f4f5;">
  <div style="max-width:600px;margin:0 auto;padding:20px;">
    <div style="background:linear-gradient(135deg,#1e3a8a 0%,#7c3aed 100%);border-radius:12px 12px 0 0;padding:30px;text-align:center;">
      ${renderMindyEmailLogo(52)}
      <h1 style="color:white;margin:0;font-size:24px;">Your Free Gift from the Bootcamp</h1>
    </div>
    <div style="background:white;padding:30px;border-radius:0 0 12px 12px;">
      <p style="color:#374151;font-size:16px;line-height:1.6;">Hey Giant,</p>
      <p style="color:#374151;font-size:16px;line-height:1.6;">It's Eric from GovCon Giants.</p>
      <p style="color:#374151;font-size:16px;line-height:1.6;">Because you attended one of our bootcamps, I'm giving you <strong>FREE access to Mindy</strong> - specifically the Daily Opportunity Alerts.</p>
      <p style="color:#374151;font-size:16px;line-height:1.6;"><strong>What you'll get:</strong></p>
      <ul style="color:#374151;font-size:16px;line-height:1.8;">
        <li>Daily emails with federal contract opportunities matching YOUR business</li>
        <li>Opportunities from SAM.gov filtered by your NAICS codes</li>
        <li>No more checking 11 different websites every morning</li>
      </ul>
      <div style="background:#f3f4f6;border-radius:8px;padding:20px;margin:20px 0;text-align:center;">
        <p style="color:#374151;font-size:14px;margin:0 0 12px 0;"><strong>Want to see it in action?</strong></p>
        <a href="https://www.youtube.com/watch?v=aq-_4bbODNQ" style="color:#7c3aed;font-weight:bold;text-decoration:none;">Watch Eric explain Mindy</a>
      </div>
      <p style="color:#374151;font-size:16px;line-height:1.6;">But I need you to <strong>set up your profile first</strong> so we know what opportunities to send you. Takes 60 seconds:</p>
      <div style="text-align:center;margin:30px 0;">
        <a href="${setupUrl}" style="display:inline-block;background:linear-gradient(135deg,#7c3aed 0%,#a855f7 100%);color:white;text-decoration:none;padding:16px 40px;border-radius:8px;font-weight:bold;font-size:18px;">Set Up My Free Alerts</a>
      </div>
      <p style="color:#6b7280;font-size:14px;line-height:1.6;">Once your profile is complete, you'll start getting opportunities matched to your business.</p>
    </div>
  </div>
</body>
</html>`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const mode = request.nextUrl.searchParams.get('mode') || 'execute';
  const limit = Math.min(
    Math.max(Number(request.nextUrl.searchParams.get('limit') || DEFAULT_LIMIT), 1),
    2000
  );

  try {
    const supabase = getSupabase();
    const attendeeEmails = loadAttendeeEmails();
    const existingRows = await fetchExistingRows(supabase, attendeeEmails);
    const unsentExisting = attendeeEmails.filter(email => {
      const row = existingRows.get(email);
      return row && !row.invitation_sent_at;
    });
    const notEnrolled = attendeeEmails.filter(email => !existingRows.has(email));
    const candidates = [...unsentExisting, ...notEnrolled].slice(0, limit);

    if (mode === 'preview') {
      return NextResponse.json({
        success: true,
        mode,
        summary: {
          totalAttendees: attendeeEmails.length,
          enrolled: existingRows.size,
          notEnrolled: notEnrolled.length,
          unsentExisting: unsentExisting.length,
          wouldProcess: candidates.length,
          limit,
        },
        sample: candidates.slice(0, 25),
      });
    }

    if (mode !== 'execute' && mode !== 'send') {
      return NextResponse.json({ success: false, error: 'Use mode=preview or mode=execute' }, { status: 400 });
    }

    await upsertNeedsSetupRows(supabase, candidates.filter(email => !existingRows.has(email)));

    const sentEmails: string[] = [];
    const failed: Array<{ email: string; error: string }> = [];
    const pendingMark: string[] = [];

    for (const email of candidates) {
      try {
        const delivered = await sendEmail({
          to: email,
          from: `"${MINDY_FROM_NAME}" <alerts@govcongiants.com>`,
          subject: 'Set Up Your Mindy Alerts Profile',
          html: generateEmailHtml(email),
          emailType: 'bootcamp_profile_setup',
          eventSource: 'bootcamp-rollout-cron',
          tags: { campaign: 'bootcamp_rollout', source: 'cron' },
        });

        if (!delivered) {
          throw new Error('Email provider returned false');
        }

        sentEmails.push(email);
        pendingMark.push(email);

        if (pendingMark.length >= 50) {
          await markInvitationsSent(supabase, pendingMark.splice(0, pendingMark.length));
        }
      } catch (error) {
        failed.push({ email, error: error instanceof Error ? error.message : 'Unknown error' });
      }
    }

    await markInvitationsSent(supabase, pendingMark);

    return NextResponse.json({
      success: true,
      mode,
      summary: {
        totalAttendees: attendeeEmails.length,
        enrolledBeforeRun: existingRows.size,
        notEnrolledBeforeRun: notEnrolled.length,
        unsentExistingBeforeRun: unsentExisting.length,
        processed: candidates.length,
        sent: sentEmails.length,
        failed: failed.length,
        remainingEstimate: Math.max(notEnrolled.length + unsentExisting.length - sentEmails.length, 0),
      },
      failed: failed.slice(0, 25),
    });
  } catch (error) {
    console.error('[Bootcamp Rollout] Failed:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Server error' },
      { status: 500 }
    );
  }
}
