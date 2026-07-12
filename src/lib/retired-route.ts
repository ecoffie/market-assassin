import { NextRequest, NextResponse } from 'next/server';

/**
 * Loud 410 for retired admin routes that targeted the dropped `user_alert_settings`
 * (and/or the never-existed `user_briefing_profile`) alerts subsystem. The real profile +
 * alert config now lives entirely in `user_notification_settings` and is written directly.
 *
 * These routes must NOT be re-pointed at the real table — that revives a deliberately-retired
 * subsystem (memory: project_mindy_deadletter_automation — "sync-*-to-alerts routes are DEAD
 * — never re-schedule"). A loud 410 (behind the existing admin/cron auth) means a stale
 * cron_jobs row or a human never mistakes them for working.
 * tasks/smart-profile-dead-table-findings.md
 */

// Auth kept so these are not open endpoints: ?password=ADMIN_PASSWORD or the cron
// dispatcher (Bearer CRON_SECRET / x-cron-dispatch).
function authed(request: NextRequest): boolean {
  const pw = new URL(request.url).searchParams.get('password');
  const bearer = request.headers.get('authorization')?.replace('Bearer ', '');
  const isCron = request.headers.get('x-cron-dispatch') === '1'
    || (!!process.env.CRON_SECRET && bearer === process.env.CRON_SECRET);
  return (!!pw && pw === process.env.ADMIN_PASSWORD) || isCron;
}

export function retiredAlertRoute(routeName: string) {
  return (request: NextRequest) => {
    if (!authed(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({
      error: `Gone: ${routeName} is retired`,
      reason: 'user_alert_settings was dropped; profile + alert config lives in user_notification_settings and is written directly.',
      action: 'none — do not re-schedule this route',
    }, { status: 410 });
  };
}
