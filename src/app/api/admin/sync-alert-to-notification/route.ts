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

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({
      error: 'Unauthorized',
      usage: {
        preview: 'GET ?password=xxx',
        execute: 'POST ?password=xxx&mode=execute',
      }
    }, { status: 401 });
  }

  const supabase = getSupabase();

  // Get all users in user_alert_settings
  const { data: alertUsers, error: alertError } = await supabase
    .from('user_alert_settings')
    .select('user_email, naics_codes, keywords, target_agencies, timezone, alerts_enabled, briefings_enabled, is_active')
    .eq('is_active', true);

  if (alertError) {
    return NextResponse.json({ error: alertError.message }, { status: 500 });
  }

  // Get all users already in user_notification_settings
  const { data: notifUsers } = await supabase
    .from('user_notification_settings')
    .select('user_email');

  const existingEmails = new Set((notifUsers || []).map(u => u.user_email.toLowerCase()));

  // Find users NOT in notification_settings
  const needsSync = (alertUsers || []).filter(u =>
    !existingEmails.has(u.user_email.toLowerCase())
  );

  return NextResponse.json({
    success: true,
    totalAlertUsers: alertUsers?.length || 0,
    alreadyInNotification: existingEmails.size,
    needsSync: needsSync.length,
    emails: needsSync.slice(0, 50).map(u => u.user_email),
    usage: 'POST ?password=xxx&mode=execute to sync',
  });
}

export async function POST(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');
  const mode = request.nextUrl.searchParams.get('mode');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (mode !== 'execute') {
    return NextResponse.json({ error: 'Use mode=execute' }, { status: 400 });
  }

  const supabase = getSupabase();

  // Get all users in user_alert_settings
  const { data: alertUsers, error: alertError } = await supabase
    .from('user_alert_settings')
    .select('user_email, naics_codes, keywords, target_agencies, timezone, alerts_enabled, briefings_enabled, is_active')
    .eq('is_active', true);

  if (alertError) {
    return NextResponse.json({ error: alertError.message }, { status: 500 });
  }

  // Get all users already in user_notification_settings
  const { data: notifUsers } = await supabase
    .from('user_notification_settings')
    .select('user_email');

  const existingEmails = new Set((notifUsers || []).map(u => u.user_email.toLowerCase()));

  // Find users NOT in notification_settings
  const needsSync = (alertUsers || []).filter(u =>
    !existingEmails.has(u.user_email.toLowerCase())
  );

  if (needsSync.length === 0) {
    return NextResponse.json({
      success: true,
      message: 'All users already synced',
      synced: 0,
    });
  }

  // Sync users
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

  return NextResponse.json({
    success: true,
    totalNeeded: needsSync.length,
    synced,
    failed,
    errors: errors.slice(0, 10),
  });
}
