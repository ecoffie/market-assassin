/**
 * Throughput regression detector for the daily/weekly/pursuit alert
 * crons. Runs once a day at ~9 AM ET (1 hour after the daily alert
 * batch window closes).
 *
 * For each alert_type we compute:
 *   yesterday's distinct user_emails with delivery_status='sent'
 *   7-day rolling baseline (mean of the prior 7 days, excluding
 *   yesterday)
 *
 * If yesterday's count is below `dropThreshold` × baseline AND the
 * baseline itself is meaningful (>50 sends, so we don't fire on
 * brand-new alert types or pre-launch periods), emit a warning email
 * to the admin address.
 *
 * A count that could not be READ is never treated as zero: the type is
 * reported `unknown` with the error (see ./throughput.ts) and the admin is
 * told the check could not run, rather than receiving a false regression.
 *
 * Written 2026-05-31 after the May 28-31 daily-alerts outage where
 * sends collapsed from ~919/day to 1/day and nobody noticed for 4
 * days. This cron closes that detection gap.
 *
 * Auth: x-vercel-cron header, the cron dispatcher's
 * `Authorization: Bearer <CRON_SECRET>`, OR ?password=<ADMIN_PASSWORD>
 * for manual triggering.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendOpsAlert } from '@/lib/ops-alert';
import { hasValidCronSecret } from '@/lib/cron/cron-request-auth';
import { judgeThroughput, windowSum, type AlertType, type ThroughputStatus } from './throughput';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const ALERT_TYPES: AlertType[] = ['daily', 'weekly', 'pursuit'];

// Below this fraction of baseline → regression. 0.5 = "we sent less
// than half what we usually do." Tuned so a single bad day from a SAM
// outage doesn't fire (baseline absorbs one bad day), but a sustained
// collapse like May 28 does.
const DROP_THRESHOLD = 0.5;

// Below this raw count we don't compute a baseline — too noisy.
// Protects new alert types in their first week from false alarms.
const MIN_BASELINE_FOR_ALERT = 50;

// Each alert type is judged over a window matching its CADENCE, not always "1 day
// vs a per-day baseline." `weekly` fires only on Sundays (~434 sends); judged per-day
// it read 0% on all six OFF-days and fired a false WARNING every non-Sunday, training
// us to ignore the alarm. Window it instead: the last `days` vs the mean of the prior
// `baselineWindows` windows of the same length. daily stays 1-day-vs-prior-7 (identical
// to before); weekly becomes last-7-days-vs-prior-weeks, so it only warns on a truly
// missed weekly cycle.
const CADENCE: Record<AlertType, { days: number; baselineWindows: number }> = {
  daily: { days: 1, baselineWindows: 7 },
  weekly: { days: 7, baselineWindows: 4 },
  pursuit: { days: 1, baselineWindows: 7 },
};

const ADMIN_EMAIL = process.env.ALERT_HEALTH_RECIPIENT || 'hello@getmindy.ai';

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface TypeReport {
  alertType: AlertType;
  windowDays: number;
  // recent cadence-window total (= yesterday's count when windowDays===1); null = unreadable
  yesterday: number | null;
  baseline: number | null;
  baselineDays: (number | null)[];
  status: ThroughputStatus;
  ratio: number | null;
  /** Read errors behind an `unknown` status. */
  errors?: string[];
}

export async function GET(request: NextRequest) {
  const isVercelCron = hasValidCronSecret(request);
  const passwordOk = request.nextUrl.searchParams.get('password') === process.env.ADMIN_PASSWORD;
  // The cron dispatcher fires this route with a Bearer CRON_SECRET header
  // (see /api/cron/dispatch). Without this it returned 401 every night and the
  // throughput watchdog was blind — it never ran.
  const hasCronSecret =
    !!process.env.CRON_SECRET && hasValidCronSecret(request);
  if (!isVercelCron && !passwordOk && !hasCronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const client = getAdminClient();
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayKey = ymd(yesterday);

  // Build the 7-day baseline window: days -8 through -2 (relative to
  // today). Yesterday (-1) is what we're testing AGAINST the baseline.
  const baselineDates: string[] = [];
  for (let i = 2; i <= 8; i++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    baselineDates.push(ymd(d));
  }

  const reports: TypeReport[] = [];
  const alerts: TypeReport[] = [];
  const unknowns: TypeReport[] = [];

  for (const alertType of ALERT_TYPES) {
    const { days: w, baselineWindows } = CADENCE[alertType];

    // Recent window (ends yesterday) vs the mean of the prior `baselineWindows`
    // windows of the same length. daily (w=1) → yesterday vs prior 7 single days
    // (unchanged). weekly (w=7) → last 7 days vs prior weeks, so an off-day 0 can't
    // false-trigger; only a genuinely missed weekly cycle drops the window to 0.
    const recentWindow = await windowSum(client, alertType, now, 1, w);
    const errors = [...recentWindow.errors];
    const baselineCounts: (number | null)[] = [];
    for (let b = 1; b <= baselineWindows; b++) {
      const bw = await windowSum(client, alertType, now, 1 + w * b, w);
      errors.push(...bw.errors);
      baselineCounts.push(bw.total);
    }
    const verdict = judgeThroughput({
      recent: recentWindow.total,
      baselineCounts,
      dropThreshold: DROP_THRESHOLD,
      minBaseline: MIN_BASELINE_FOR_ALERT,
    });
    if (errors.length) console.error(`[throughput-check] ${alertType} UNKNOWN — count read failed:`, errors.join('; '));

    const report: TypeReport = {
      alertType,
      windowDays: w,
      yesterday: recentWindow.total,
      baseline: verdict.baselineMean === null ? null : Math.round(verdict.baselineMean),
      baselineDays: baselineCounts,
      status: verdict.status,
      ratio: verdict.ratio,
      ...(errors.length ? { errors } : {}),
    };
    reports.push(report);
    if (verdict.status === 'warning') alerts.push(report);
    if (verdict.status === 'unknown') unknowns.push(report);
  }

  let emailSent = false;
  if (alerts.length > 0 || unknowns.length > 0) {
    const subjectParts: string[] = [];
    if (alerts.length) subjectParts.push(`regression — ${alerts.map(a => a.alertType).join(', ')}`);
    if (unknowns.length) subjectParts.push(`UNKNOWN (count read failed) — ${unknowns.map(a => a.alertType).join(', ')}`);
    const subject = `⚠️ Alert throughput ${subjectParts.join(' · ')}`;
    const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; padding: 24px; color: #1a1a1a;">
  <h2 style="color: #b91c1c; margin-top: 0;">Alert throughput ${alerts.length ? 'regression' : 'check could not run'}</h2>
  ${unknowns.length ? `<p style="color: #92400e;"><strong>UNKNOWN — not zero:</strong> the alert_log count could not be read for ${unknowns.map(u => `<code>${u.alertType}</code>`).join(', ')}, so no regression verdict was made for ${unknowns.length === 1 ? 'it' : 'them'}. Errors: ${escapeHtml(unknowns.flatMap(u => u.errors ?? []).slice(0, 5).join('; '))}</p>` : ''}
  ${alerts.length ? `<p style="color: #444;">
    One or more alert types sent less than ${Math.round(DROP_THRESHOLD * 100)}% of their cadence baseline (window ending ${yesterdayKey}).
    ${alerts.some(a => a.windowDays > 1) ? `(weekly is judged over its full ${CADENCE.weekly.days}-day window, not a single day, so an off-day 0 will NOT trigger this.) ` : ''}This usually means the cron is failing silently after a recent deploy. Check Vercel cron logs for <code>/api/cron/${alerts[0]?.alertType}-alerts</code> first.
  </p>` : ''}
  <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px;">
    <thead>
      <tr style="background: #f3f4f6; text-align: left;">
        <th style="padding: 10px;">Alert type</th>
        <th style="padding: 10px;">Recent</th>
        <th style="padding: 10px;">Baseline</th>
        <th style="padding: 10px;">% of baseline</th>
        <th style="padding: 10px;">Status</th>
      </tr>
    </thead>
    <tbody>
      ${reports.map(r => `
      <tr style="border-bottom: 1px solid #e5e7eb;">
        <td style="padding: 10px; font-family: monospace;">${r.alertType}</td>
        <td style="padding: 10px;">${r.yesterday ?? 'unknown'}${r.windowDays > 1 ? ` <span style="color:#6b7280">(last ${r.windowDays}d)</span>` : ''}</td>
        <td style="padding: 10px;">${r.baseline ?? 'unknown'}${r.windowDays > 1 ? ` <span style="color:#6b7280">/window</span>` : ''}</td>
        <td style="padding: 10px;">${r.ratio === null ? 'unknown' : `${Math.round(r.ratio * 100)}%`}</td>
        <td style="padding: 10px; color: ${r.status === 'warning' ? '#b91c1c' : r.status === 'unknown' ? '#92400e' : r.status === 'no-baseline' ? '#6b7280' : '#16a34a'};">${r.status.toUpperCase()}</td>
      </tr>`).join('')}
    </tbody>
  </table>
  <p style="font-size: 12px; color: #6b7280;">
    Per-day baseline: ${reports[0]?.baselineDays.map((c, i) => `${baselineDates[i]}=${c ?? 'unknown'}`).join(', ')}
  </p>
  <p style="font-size: 12px; color: #6b7280;">
    Threshold: ${Math.round(DROP_THRESHOLD * 100)}% of baseline · Minimum baseline to trigger: ${MIN_BASELINE_FOR_ALERT} sends
  </p>
</div>`;
    try {
      await sendOpsAlert({
        to: ADMIN_EMAIL,
        subject,
        html,
      });
      emailSent = true;
    } catch (e) {
      console.error('[throughput-check] email send failed:', e);
    }
  }

  return NextResponse.json({
    success: true,
    yesterday: yesterdayKey,
    baselineDates,
    reports,
    alerts: alerts.length,
    // Types whose counts could not be read. Never folded into `alerts` or reported as 0 sends.
    unknown: unknowns.map(u => u.alertType),
    emailSent,
  });
}
