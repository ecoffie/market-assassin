/**
 * Dispatcher watchdog — the NATIVE backstop for the cron dispatcher.
 *
 * The cron dispatcher (`/api/cron/dispatch`, docs/PRD-cron-dispatcher.md) is now a
 * SINGLE POINT OF FAILURE: ~20 logical jobs (precompute, syncs, health checks, and
 * the briefing-watchdog itself) fire only when the dispatcher tick runs. The PRD
 * called for a watchdog kept on its OWN native cron so it survives a dispatcher
 * failure — but in Phase 1 the briefing-watchdog got migrated ONTO the dispatcher
 * (scripts/migrate-crons-phase1.ts), so if the dispatcher stops, nothing notices.
 *
 * This route is that missing native backstop. It is scheduled directly in
 * vercel.json (NOT via cron_jobs), so it runs independently of the dispatcher and
 * can detect — and nudge — a dispatcher that has stopped firing.
 *
 * Checks (read-only against cron_jobs / cron_job_runs):
 *   1. LIVENESS  — has ANY job started in the last LIVENESS_MINUTES? If not, the
 *      dispatcher tick is probably dead. This is the headline SPOF signal. On a
 *      liveness miss we POKE `/api/cron/dispatch?tick=hour` to recover a transient
 *      skip, then alert.
 *   2. OVERDUE   — enabled daily-style jobs whose scheduled time passed today and
 *      that haven't run (via the dispatcher's own isMissed()).
 *   3. STUCK     — a run that grabbed the lock and never released it (locked_at far
 *      past timeout_ms → its route hung or the process died mid-run).
 *   4. FAILING   — jobs whose last run ended in 'error'/'timeout'.
 *
 * On any problem it emails ALERT_TO (transactional → bypasses the send guard so a
 * real outage always reaches a human). `?dry_run=true` reports without emailing.
 *
 * Auth: CRON_SECRET bearer (Vercel cron) OR ?password=ADMIN_PASSWORD (manual).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/send-email';
import { isMissed } from '@/lib/cron/cron-expr';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ALERT_TO = process.env.WATCHDOG_ALERT_EMAIL || 'eric@govcongiants.com';

// The dispatcher ticks hourly. If nothing has run in this long, it's almost
// certainly not firing (vs. a one-hour Vercel hiccup, which isMissed catch-up
// absorbs). 150 min = 2.5h leaves margin for a single skipped tick.
const LIVENESS_MINUTES = 150;

interface CronJob {
  job_name: string;
  cron_expr: string;
  enabled: boolean;
  last_run_at: string | null;
  last_status: string | null;
  locked_at: string | null;
  timeout_ms: number;
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const cronSecret = request.headers.get('authorization')?.replace('Bearer ', '');
  const dryRun = searchParams.get('dry_run') === 'true';
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';

  const authorized =
    password === ADMIN_PASSWORD ||
    (process.env.CRON_SECRET && cronSecret === process.env.CRON_SECRET) ||
    isVercelCron;
  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  const now = new Date();

  // 1) Liveness — most recent run across ALL jobs.
  const { data: lastRun } = await supabase
    .from('cron_job_runs')
    .select('started_at')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: jobs, error: jobsErr } = await supabase
    .from('cron_jobs')
    .select('job_name, cron_expr, enabled, last_run_at, last_status, locked_at, timeout_ms')
    .eq('enabled', true);
  if (jobsErr) {
    return NextResponse.json({ error: `Failed to read cron_jobs: ${jobsErr.message}` }, { status: 500 });
  }
  const enabledJobs = (jobs || []) as CronJob[];

  const lastRunAt = lastRun?.started_at ? new Date(lastRun.started_at) : null;
  const minutesSinceLastRun = lastRunAt
    ? Math.round((now.getTime() - lastRunAt.getTime()) / 60000)
    : null;
  // Only call the dispatcher "down" when there ARE enabled jobs but none has run
  // recently — an empty registry isn't an outage.
  const dispatcherLikelyDown =
    enabledJobs.length > 0 && (minutesSinceLastRun === null || minutesSinceLastRun > LIVENESS_MINUTES);

  // 2/3/4) Per-job overdue / stuck / failing.
  const overdue: string[] = [];
  const stuck: string[] = [];
  const failing: string[] = [];
  for (const j of enabledJobs) {
    if (j.last_status === 'error' || j.last_status === 'timeout') failing.push(j.job_name);
    if (j.locked_at) {
      const lockAgeMs = now.getTime() - new Date(j.locked_at).getTime();
      // 3× the job's own timeout → the lock should have auto-expired long ago.
      if (lockAgeMs > j.timeout_ms * 3) stuck.push(j.job_name);
    }
    if (isMissed(j.cron_expr, now, j.last_run_at ? new Date(j.last_run_at) : null)) {
      overdue.push(j.job_name);
    }
  }

  // Self-heal: a liveness miss is most often a single skipped tick — poke the
  // dispatcher so it catches up its missed daily jobs before we wait another cycle.
  let poked = false;
  if (dispatcherLikelyDown && !dryRun) {
    try {
      const origin = new URL(request.url).origin;
      await fetch(`${origin}/api/cron/dispatch?tick=hour`, {
        headers: { authorization: `Bearer ${process.env.CRON_SECRET || ''}`, 'x-dispatcher-watchdog': '1' },
      });
      poked = true;
    } catch {
      // best-effort; the alert below still fires.
    }
  }

  const problems = dispatcherLikelyDown || overdue.length > 0 || stuck.length > 0 || failing.length > 0;

  if (problems && !dryRun) {
    const lines: string[] = [];
    if (dispatcherLikelyDown) {
      lines.push(
        `<p><strong>🔴 DISPATCHER LIKELY DOWN</strong> — last job run ${
          minutesSinceLastRun === null ? 'never recorded' : `${minutesSinceLastRun} min ago`
        } (threshold ${LIVENESS_MINUTES} min). ${poked ? 'Poked /api/cron/dispatch?tick=hour to recover.' : ''}</p>`,
      );
    }
    if (failing.length) lines.push(`<p><strong>❌ Failing (last run errored):</strong> ${failing.join(', ')}</p>`);
    if (stuck.length) lines.push(`<p><strong>🔒 Stuck (lock never released):</strong> ${stuck.join(', ')}</p>`);
    if (overdue.length) lines.push(`<p><strong>⏰ Overdue (daily job past due, not run today):</strong> ${overdue.join(', ')}</p>`);

    await sendEmail({
      to: ALERT_TO,
      transactional: true,
      emailType: 'dispatcher_watchdog',
      subject: `⚠️ Cron dispatcher health alert${dispatcherLikelyDown ? ' — DISPATCHER DOWN' : ''}`,
      html: `<h2>Cron dispatcher watchdog</h2>${lines.join('')}<p style="color:#888">Enabled jobs: ${enabledJobs.length}. Checked ${now.toISOString()}.</p>`,
      text: `Cron dispatcher health alert. down=${dispatcherLikelyDown} failing=[${failing.join(',')}] stuck=[${stuck.join(',')}] overdue=[${overdue.join(',')}]`,
    });
  }

  return NextResponse.json({
    ok: !problems,
    checkedAt: now.toISOString(),
    enabledJobs: enabledJobs.length,
    minutesSinceLastRun,
    dispatcherLikelyDown,
    poked,
    failing,
    stuck,
    overdue,
  });
}
