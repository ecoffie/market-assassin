/**
 * Sync user_alert_settings to user_notification_settings
 *
 * Ensures users enrolled in alerts are also in notification_settings
 * so they receive Daily Briefs, Pursuit Briefs, and Deep Dives.
 *
 * Usage:
 * GET ?password=xxx - Preview who would be synced
 * POST ?password=xxx&mode=execute - Actually sync users
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// Auth: human via ?password=ADMIN_PASSWORD, or the cron dispatcher via
// Bearer CRON_SECRET / x-cron-dispatch header (see /api/cron/dispatch).
function authed(request: NextRequest): boolean {
  const pw = request.nextUrl.searchParams.get('password');
  const bearer = request.headers.get('authorization')?.replace('Bearer ', '');
  const isCron = request.headers.get('x-cron-dispatch') === '1'
    || (!!process.env.CRON_SECRET && bearer === process.env.CRON_SECRET);
  return (!!pw && pw === ADMIN_PASSWORD) || isCron;
}

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function findNeedsSync(supabase: any) {
  const { data: alertUsers, error: alertError } = await supabase
    .from('user_alert_settings')
    .select('user_email, naics_codes, keywords, target_agencies, timezone, alerts_enabled, briefings_enabled, is_active')
    .eq('is_active', true);
  if (alertError) throw new Error(alertError.message);

  const { data: notifUsers } = await supabase
    .from('user_notification_settings')
    .select('user_email');
  const existingEmails = new Set((notifUsers || []).map((u: { user_email: string }) => u.user_email.toLowerCase()));

  const needsSync = (alertUsers || []).filter((u: { user_email: string }) =>
    !existingEmails.has(u.user_email.toLowerCase())
  );
  return { totalAlertUsers: alertUsers?.length || 0, existingCount: existingEmails.size, needsSync };
}

async function runSync() {
  const supabase = getSupabase();
  const { totalAlertUsers, needsSync } = await findNeedsSync(supabase);

  if (needsSync.length === 0) {
    return { success: true, message: 'All users already synced', totalAlertUsers, synced: 0, failed: 0 };
  }

  let synced = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const user of needsSync) {
    try {
      const { error: insertError } = await supabase
        .from('user_notification_settings')
        .insert({
          user_email: user.user_email.toLowerCase(),
          naics_codes: user.naics_codes || [],
          keywords: user.keywords || [],
          agencies: user.target_agencies || [],
          timezone: user.timezone || 'America/New_York',
          alerts_enabled: user.alerts_enabled,
          alert_frequency: 'daily',
          briefings_enabled: user.briefings_enabled,
          briefing_frequency: 'daily',
          sms_enabled: false,
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

      if (insertError) {
        failed++;
        errors.push(`${user.user_email}: ${insertError.message}`);
      } else {
        synced++;
      }
    } catch (err) {
      failed++;
      errors.push(`${user.user_email}: ${err}`);
    }
  }

  console.log(`[SyncAlertToNotification] Synced ${synced}, failed ${failed}`);
  return { success: true, totalNeeded: needsSync.length, synced, failed, errors: errors.slice(0, 10) };
}

export async function GET(request: NextRequest) {
  if (!authed(request)) {
    return NextResponse.json({
      error: 'Unauthorized',
      usage: { preview: 'GET ?password=xxx', execute: 'POST ?password=xxx&mode=execute' },
    }, { status: 401 });
  }

  // Dispatcher fires GET → execute so alert users stay wired for notifications.
  const isCron = request.headers.get('x-cron-dispatch') === '1';
  if (isCron) {
    return NextResponse.json(await runSync());
  }

  // Human GET = preview only.
  const { totalAlertUsers, existingCount, needsSync } = await findNeedsSync(getSupabase());
  return NextResponse.json({
    success: true,
    totalAlertUsers,
    alreadyInNotification: existingCount,
    needsSync: needsSync.length,
    emails: needsSync.slice(0, 50).map((u: { user_email: string }) => u.user_email),
    usage: 'POST ?password=xxx&mode=execute to sync',
  });
}

export async function POST(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get('mode');

  if (!authed(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (mode !== 'execute') {
    return NextResponse.json({ error: 'Use mode=execute' }, { status: 400 });
  }

  return NextResponse.json(await runSync());
}
