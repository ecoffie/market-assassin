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
import { kv } from '@vercel/kv';
import nodemailer from 'nodemailer';
import { createSecureAccessUrl } from '@/lib/access-links';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';
const SEND_DELAY_MS = 750;
const CONCURRENCY_RETRY_DELAY_MS = 5000;
const MAX_SEND_ATTEMPTS = 2;
const LAST_RUN_KEY = 'admin:naics-reminder:last-run';
const DEFAULT_BATCH_LIMIT = 100;
const MAX_BATCH_LIMIT = 349;
const REMINDER_COOLDOWN_DAYS = 14;

interface ReminderRunRecord {
  runAt: string;
  mode: 'execute' | 'retry-failed' | 'single';
  totalAudience: number;
  usersWithProfileData: number;
  usersWithFallback: number;
  totalTargeted: number;
  sent: number;
  failed: number;
  failedEmails: string[];
  sampleErrors: string[];
  skippedRecentlyReminded?: number;
  batchLimit?: number;
}

interface FallbackAudienceUser {
  email: string;
  source: 'notification_settings' | 'smart_profiles';
  hasNaics: boolean;
  hasAgencies: boolean;
}

function isIgnorableMissingTableError(message: string): boolean {
  return message.includes('Could not find the table') || message.includes('schema cache');
}

function isConcurrencyLimitError(message: string): boolean {
  return message.includes('432 4.3.2') || message.toLowerCase().includes('concurrent connections limit exceeded');
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function getReminderSentKey(email: string): string {
  return `admin:naics-reminder:last-sent:${email.toLowerCase()}`;
}

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

async function generateReminderEmail(email: string): Promise<{ subject: string; html: string; text: string }> {
  const preferencesUrl = await createSecureAccessUrl(email, 'preferences');

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
      <p style="color: #78350f; margin: 10px 0 0 0;">Right now, you're receiving <em>healthcare-related</em> opportunities (hospitals, nursing homes, medical labs) as placeholders. Unless you're in healthcare, these probably aren't relevant!</p>
      <p style="color: #78350f; margin: 10px 0 0 0;"><strong>Set your NAICS codes</strong> to get opportunities <strong>matched to YOUR business</strong>.</p>
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
        <a href="https://tools.govcongiants.org/api/alerts/unsubscribe?email=${encodeURIComponent(email)}" style="color: #94a3b8;">Unsubscribe</a>
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
You're enrolled in our FREE Daily Alerts and Market Intelligence system, but you haven't set your NAICS codes yet. Right now, you're receiving healthcare-related opportunities (hospitals, nursing homes, medical labs) as placeholders. Unless you're in healthcare, these probably aren't relevant! Set your NAICS codes to get opportunities matched to YOUR business.

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

async function getBriefingFallbackAudience() {
  const supabase = getSupabase();

  const { data: notificationSettings, error: notificationError } = await supabase
    .from('user_notification_settings')
    .select('user_email, naics_codes, agencies, aggregated_profile')
    .eq('is_active', true);

  if (notificationError) {
    throw new Error(notificationError.message);
  }

  const { data: smartProfiles, error: smartProfilesError } = await supabase
    .from('smart_user_profiles')
    .select('email, naics_codes, agencies');

  if (smartProfilesError && !isIgnorableMissingTableError(smartProfilesError.message)) {
    throw new Error(smartProfilesError.message);
  }

  const seenEmails = new Set<string>();
  const fallbackUsers: FallbackAudienceUser[] = [];
  let totalAudience = 0;
  let usersWithProfileData = 0;

  for (const profile of notificationSettings || []) {
    const email = profile.user_email?.toLowerCase();
    if (!email || seenEmails.has(email)) continue;
    seenEmails.add(email);
    totalAudience++;

    const aggregated = profile.aggregated_profile as Record<string, unknown> | null;
    const aggregatedNaics = aggregated && Array.isArray(aggregated.naics_codes)
      ? aggregated.naics_codes
      : [];
    const aggregatedAgencies = aggregated && Array.isArray(aggregated.agencies)
      ? aggregated.agencies
      : [];
    const naics = Array.isArray(profile.naics_codes) ? profile.naics_codes : [];
    const agencies = Array.isArray(profile.agencies) ? profile.agencies : [];
    const hasNaics = aggregatedNaics.length > 0 || naics.length > 0;
    const hasAgencies = aggregatedAgencies.length > 0 || agencies.length > 0;

    if (hasNaics || hasAgencies) {
      usersWithProfileData++;
      continue;
    }

    fallbackUsers.push({
      email,
      source: 'notification_settings',
      hasNaics,
      hasAgencies,
    });
  }

  for (const profile of smartProfiles || []) {
    const email = profile.email?.toLowerCase();
    if (!email || seenEmails.has(email)) continue;
    seenEmails.add(email);
    totalAudience++;

    const naics = Array.isArray(profile.naics_codes) ? profile.naics_codes : [];
    const agencies = Array.isArray(profile.agencies) ? profile.agencies : [];
    const hasNaics = naics.length > 0;
    const hasAgencies = agencies.length > 0;

    if (hasNaics || hasAgencies) {
      usersWithProfileData++;
      continue;
    }

    fallbackUsers.push({
      email,
      source: 'smart_profiles',
      hasNaics,
      hasAgencies,
    });
  }

  return {
    totalAudience,
    usersWithProfileData,
    usersWithFallback: fallbackUsers.length,
    fallbackUsers,
  };
}

export async function GET(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({
      error: 'Unauthorized',
      usage: 'GET ?password=xxx&mode=preview to see users without NAICS'
    }, { status: 401 });
  }

  try {
    const audience = await getBriefingFallbackAudience();
    const lastRun = await kv.get<ReminderRunRecord>(LAST_RUN_KEY);
    const recentlyRemindedCount = (
      await Promise.all(
        audience.fallbackUsers.slice(0, 200).map(async (user) => {
          const lastSent = await kv.get<string>(getReminderSentKey(user.email));
          return lastSent ? 1 : 0;
        })
      )
    ).reduce<number>((sum, count) => sum + count, 0);

    return NextResponse.json({
      success: true,
      message: `Found ${audience.usersWithFallback} beta briefing users using fallback targeting`,
      audienceLabel: 'beta_briefing_fallback_pool',
      totalAudience: audience.totalAudience,
      usersWithProfileData: audience.usersWithProfileData,
      usersWithFallback: audience.usersWithFallback,
      fallbackEmails: audience.fallbackUsers.slice(0, 100).map((user) => ({
        email: user.email,
        source: user.source,
      })),
      reminderCooldownDays: REMINDER_COOLDOWN_DAYS,
      defaultBatchLimit: DEFAULT_BATCH_LIMIT,
      recentlyRemindedSampleCount: recentlyRemindedCount,
      lastRun,
      usage: {
        preview: 'GET ?password=xxx (current)',
        sendAll: 'POST ?password=xxx&mode=execute&limit=100',
        sendOne: 'POST ?password=xxx&mode=execute&email=xxx',
        retryFailed: 'POST ?password=xxx&mode=retry-failed',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to build fallback audience' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');
  const mode = request.nextUrl.searchParams.get('mode');
  const specificEmail = request.nextUrl.searchParams.get('email');
  const limitParam = request.nextUrl.searchParams.get('limit');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (mode !== 'execute' && mode !== 'retry-failed') {
    return NextResponse.json({
      error: 'Use mode=execute or mode=retry-failed',
      usage: 'POST ?password=xxx&mode=execute | POST ?password=xxx&mode=retry-failed'
    }, { status: 400 });
  }

  const transporter = getTransporter();
  const audience = await getBriefingFallbackAudience();
  let emailsToSend = audience.fallbackUsers.map((user) => user.email);
  const lastRun = await kv.get<ReminderRunRecord>(LAST_RUN_KEY);
  const batchLimit = specificEmail
    ? 1
    : Math.min(
        Math.max(parseInt(limitParam || String(DEFAULT_BATCH_LIMIT), 10) || DEFAULT_BATCH_LIMIT, 1),
        MAX_BATCH_LIMIT
      );

  if (mode === 'retry-failed') {
    emailsToSend = lastRun?.failedEmails || [];
    if (emailsToSend.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No failed reminder recipients found to retry',
        lastRun,
      });
    }
  }

  // Filter to specific email if provided
  if (specificEmail) {
    emailsToSend = emailsToSend.filter(e => e === specificEmail.toLowerCase());
    if (emailsToSend.length === 0) {
      // Send anyway even if user has NAICS (for testing)
      emailsToSend = [specificEmail.toLowerCase()];
    }
  }

  let skippedRecentlyReminded = 0;
  if (!specificEmail && mode === 'execute') {
    const filteredEmails: string[] = [];
    for (const email of emailsToSend) {
      const lastSent = await kv.get<string>(getReminderSentKey(email));
      if (lastSent) {
        skippedRecentlyReminded++;
        continue;
      }
      filteredEmails.push(email);
      if (filteredEmails.length >= batchLimit) break;
    }
    emailsToSend = filteredEmails;
  } else if (!specificEmail && mode === 'retry-failed') {
    emailsToSend = emailsToSend.slice(0, batchLimit);
  }

  const results = {
    sent: 0,
    failed: 0,
    failedEmails: [] as string[],
    errors: [] as string[],
  };

  for (let i = 0; i < emailsToSend.length; i++) {
    const email = emailsToSend[i];

    let sent = false;
    for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
      try {
        const template = await generateReminderEmail(email);

        await transporter.sendMail({
          from: `"GovCon Giants" <${process.env.SMTP_USER || 'hello@govconedu.com'}>`,
          to: email,
          subject: template.subject,
          html: template.html,
          text: template.text,
        });

        results.sent++;
        sent = true;
        await kv.set(getReminderSentKey(email), new Date().toISOString(), {
          ex: REMINDER_COOLDOWN_DAYS * 24 * 60 * 60,
        });
        console.log(`[NAICSReminder] ✅ Sent to ${email}`);
        break;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        const shouldRetry = attempt < MAX_SEND_ATTEMPTS && isConcurrencyLimitError(errorMessage);

        if (shouldRetry) {
          console.warn(`[NAICSReminder] Retrying ${email} after SMTP concurrency limit`);
          await sleep(CONCURRENCY_RETRY_DELAY_MS);
          continue;
        }

        results.failed++;
        results.failedEmails.push(email);
        results.errors.push(`${email}: ${errorMessage}`);
        console.error(`[NAICSReminder] ❌ Failed for ${email}:`, errorMessage);
        break;
      }
    }

    if (sent && i + 1 < emailsToSend.length) {
      await sleep(SEND_DELAY_MS);
    }
  }

  const runRecord: ReminderRunRecord = {
    runAt: new Date().toISOString(),
    mode: specificEmail ? 'single' : mode,
    totalAudience: audience.totalAudience,
    usersWithProfileData: audience.usersWithProfileData,
    usersWithFallback: audience.usersWithFallback,
    totalTargeted: emailsToSend.length,
    sent: results.sent,
    failed: results.failed,
    failedEmails: results.failedEmails,
    sampleErrors: results.errors.slice(0, 20),
    skippedRecentlyReminded,
    batchLimit,
  };

  await kv.set(LAST_RUN_KEY, runRecord, { ex: 14 * 24 * 60 * 60 });

  return NextResponse.json({
    success: true,
    audienceLabel: 'beta_briefing_fallback_pool',
    totalAudience: audience.totalAudience,
    usersWithProfileData: audience.usersWithProfileData,
    usersWithFallback: audience.usersWithFallback,
    mode: specificEmail ? 'single' : mode,
    batchLimit,
    skippedRecentlyReminded,
    totalTargeted: emailsToSend.length,
    sent: results.sent,
    failed: results.failed,
    failedEmails: results.failedEmails,
    errors: results.errors.slice(0, 10),
  });
}
