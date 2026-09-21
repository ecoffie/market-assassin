/**
 * RETIRED (410 Gone). This route synced `user_alert_settings` from `user_briefing_profile`
 * — BOTH dead tables (user_briefing_profile never existed; user_alert_settings was DROPPED
 * on purpose; memory project_mindy_deadletter_automation: "sync-*-to-alerts routes are DEAD
 * — never re-schedule"). The real profile + alert config now lives entirely in
 * `user_notification_settings` and is written directly at save time. Do NOT re-point this at
 * the real table — that revives the retired subsystem. Kept as a loud 410 so a stale
 * cron_jobs row or a human never mistakes it for working.
 * tasks/smart-profile-dead-table-findings.md
 *
 * GET /api/admin/sync-alert-profiles?password=... → 410 Gone
 */

import { NextRequest, NextResponse } from 'next/server';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// Auth kept so this isn't an open endpoint; via ?password=ADMIN_PASSWORD or the
// cron dispatcher (Bearer CRON_SECRET / x-cron-dispatch).
function authed(request: NextRequest): boolean {
  const pw = new URL(request.url).searchParams.get('password');
  const bearer = request.headers.get('authorization')?.replace('Bearer ', '');
  const isCron = request.headers.get('x-cron-dispatch') === '1'
    || (!!process.env.CRON_SECRET && bearer === process.env.CRON_SECRET);
  return (!!pw && pw === ADMIN_PASSWORD) || isCron;
}

export async function GET(request: NextRequest) {
  if (!authed(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({
    error: 'Gone: sync-alert-profiles is retired',
    reason: 'user_alert_settings + user_briefing_profile are dead; profile + alert config lives in user_notification_settings and is written directly.',
    action: 'none — do not re-schedule this route',
  }, { status: 410 });
}
