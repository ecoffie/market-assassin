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

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

type AlertType = 'daily' | 'weekly' | 'pursuit';
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

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function distinctSentCount(client: ReturnType<typeof getAdminClient>, alertType: AlertType, date: string): Promise<number> {
  // We can't use SELECT DISTINCT through PostgREST cleanly, so pull
  // user_email and de-dupe in JS. At 1000s of rows/day this is fine.
  const { data, error } = await client
    .from('alert_log')
    .select('user_email')
    .eq('alert_type', alertType)
    .eq('alert_date', date)
    .eq('delivery_status', 'sent');
  if (error) {
    console.error(`[throughput-check] read failed (${alertType} ${date}):`, error.message);
    return 0;
  }
  const set = new Set<string>();
  for (const r of data || []) {
    if (r.user_email) set.add(r.user_email);
  }
  return set.size;
}

// Sum of distinct-per-day sends over the `days`-long window ending `startOffset` days
// before `now` (startOffset=1 → the window ends yesterday). For a weekly cron whose
// sends land on one day, a trailing 7-day window always contains exactly one send day,
// so the sum tracks the weekly volume regardless of which weekday "yesterday" is.
async function windowSum(
  client: ReturnType<typeof getAdminClient>,
  alertType: AlertType,
  now: Date,
  startOffset: number,
  days: number,
): Promise<number> {
  let total = 0;
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - (startOffset + i));
    total += await distinctSentCount(client, alertType, ymd(d));
  }
  return total;
}

interface TypeReport {
  alertType: AlertType;
  windowDays: number;
  yesterday: number; // recent cadence-window total (= yesterday's count when windowDays===1)
  baseline: number;
  baselineDays: number[];
  status: 'healthy' | 'warning' | 'no-baseline';
  ratio: number;
}

export async function GET(request: NextRequest) {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const passwordOk = request.nextUrl.searchParams.get('password') === process.env.ADMIN_PASSWORD;
  // The cron dispatcher fires this route with a Bearer CRON_SECRET header
  // (see /api/cron/dispatch). Without this it returned 401 every night and the
  // throughput watchdog was blind — it never ran.
  const hasCronSecret =
    !!process.env.CRON_SECRET && request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`;
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

  for (const alertType of ALERT_TYPES) {
    const { days: w, baselineWindows } = CADENCE[alertType];

    // Recent window (ends yesterday) vs the mean of the prior `baselineWindows`
    // windows of the same length. daily (w=1) → yesterday vs prior 7 single days
    // (unchanged). weekly (w=7) → last 7 days vs prior weeks, so an off-day 0 can't
    // false-trigger; only a genuinely missed weekly cycle drops the window to 0.
    const recent = await windowSum(client, alertType, now, 1, w);
    const baselineCounts: number[] = [];
    for (let b = 1; b <= baselineWindows; b++) {
      baselineCounts.push(await windowSum(client, alertType, now, 1 + w * b, w));
    }
    const baselineMean = baselineCounts.reduce((a, b) => a + b, 0) / baselineCounts.length;

    let status: TypeReport['status'] = 'healthy';
    if (baselineMean < MIN_BASELINE_FOR_ALERT) {
      status = 'no-baseline';
    } else if (recent < baselineMean * DROP_THRESHOLD) {
      status = 'warning';
    }

    const report: TypeReport = {
      alertType,
      windowDays: w,
      yesterday: recent,
      baseline: Math.round(baselineMean),
      baselineDays: baselineCounts,
      status,
      ratio: baselineMean > 0 ? +(recent / baselineMean).toFixed(2) : 0,
    };
    reports.push(report);
    if (status === 'warning') alerts.push(report);
  }

  let emailSent = false;
  if (alerts.length > 0) {
    const subject = `⚠️ Alert throughput regression — ${alerts.map(a => a.alertType).join(', ')}`;
    const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; padding: 24px; color: #1a1a1a;">
  <h2 style="color: #b91c1c; margin-top: 0;">Alert throughput regression</h2>
  <p style="color: #444;">
    One or more alert types sent less than ${Math.round(DROP_THRESHOLD * 100)}% of their cadence baseline (window ending ${yesterdayKey}).
    ${alerts.some(a => a.windowDays > 1) ? `(weekly is judged over its full ${CADENCE.weekly.days}-day window, not a single day, so an off-day 0 will NOT trigger this.) ` : ''}This usually means the cron is failing silently after a recent deploy. Check Vercel cron logs for <code>/api/cron/${alerts[0].alertType}-alerts</code> first.
  </p>
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
        <td style="padding: 10px;">${r.yesterday}${r.windowDays > 1 ? ` <span style="color:#6b7280">(last ${r.windowDays}d)</span>` : ''}</td>
        <td style="padding: 10px;">${r.baseline}${r.windowDays > 1 ? ` <span style="color:#6b7280">/window</span>` : ''}</td>
        <td style="padding: 10px;">${Math.round(r.ratio * 100)}%</td>
        <td style="padding: 10px; color: ${r.status === 'warning' ? '#b91c1c' : r.status === 'no-baseline' ? '#6b7280' : '#16a34a'};">${r.status.toUpperCase()}</td>
      </tr>`).join('')}
    </tbody>
  </table>
  <p style="font-size: 12px; color: #6b7280;">
    Per-day baseline: ${reports[0]?.baselineDays.map((c, i) => `${baselineDates[i]}=${c}`).join(', ')}
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
    emailSent,
  });
}
