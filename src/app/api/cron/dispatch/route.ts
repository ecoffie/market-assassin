/**
 * Cron Dispatcher — Phase 1 (docs/PRD-cron-dispatcher.md).
 *
 * A small fixed set of Vercel cron ticks (see vercel.json) all hit THIS route.
 * Per tick it: reads enabled jobs from `cron_jobs`, fires the ones that are due
 * (cron_expr matches this minute AND not already fired this minute), with an
 * overlap lock so a long job never double-fires, and records each run in
 * `cron_job_runs`.
 *
 * This is how we escape Vercel's 100-cron cap: ~6 tick entries support
 * thousands of logical jobs. Adding a job = INSERT a cron_jobs row, no deploy.
 *
 * Auth: CRON_SECRET bearer (Vercel cron) OR ?password=ADMIN_PASSWORD (manual).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isDue, isMissed } from '@/lib/cron/cron-expr';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

interface CronJob {
  id: string;
  job_name: string;
  route: string;
  cron_expr: string;
  enabled: boolean;
  last_run_at: string | null;
  locked_at: string | null;
  timeout_ms: number;
  payload: Record<string, unknown>;
}

// Round a date down to the minute — our dedupe granularity (a job fires at most
// once per matching minute, even if a tick is retried within that minute).
function minuteKey(d: Date): string {
  return d.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const cronSecret = request.headers.get('authorization')?.replace('Bearer ', '');
  const tick = searchParams.get('tick') || 'manual';
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
  const thisMinute = minuteKey(now);

  // Pull enabled jobs (the partial index keeps this cheap).
  const { data: jobs, error } = await supabase
    .from('cron_jobs')
    .select('*')
    .eq('enabled', true);
  if (error) {
    return NextResponse.json({ error: `Failed to read cron_jobs: ${error.message}` }, { status: 500 });
  }

  const due: CronJob[] = [];
  const skipped: Array<{ job: string; reason: string }> = [];

  for (const job of (jobs || []) as CronJob[]) {
    // Fire on an exact schedule match OR if a daily job MISSED its run (Vercel's
    // hourly tick occasionally skips an hour; without catch-up a once-daily job
    // pinned to that hour is silently skipped — that's what froze the command
    // center's snapshot-metrics + aggregate-profiles).
    const dueNow = isDue(job.cron_expr, now);
    const missed = !dueNow && isMissed(job.cron_expr, now, job.last_run_at ? new Date(job.last_run_at) : null);
    if (!dueNow && !missed) continue;

    // Dedupe: already fired this minute?
    if (job.last_run_at && minuteKey(new Date(job.last_run_at)) === thisMinute) {
      skipped.push({ job: job.job_name, reason: 'already ran this minute' });
      continue;
    }
    // Overlap guard: a non-stale lock means the previous run is still going.
    if (job.locked_at) {
      const lockAge = now.getTime() - new Date(job.locked_at).getTime();
      if (lockAge < job.timeout_ms) {
        skipped.push({ job: job.job_name, reason: 'still running (locked)' });
        continue;
      }
      // stale lock → previous run died; fall through and re-fire.
    }
    due.push(job);
  }

  if (dryRun) {
    return NextResponse.json({
      success: true, tick, dryRun: true, now: now.toISOString(),
      wouldFire: due.map((j) => j.job_name), skipped,
    });
  }

  // Fire each due job. Acquire the lock (compare-and-set on last_run minute) so
  // two overlapping ticks can't both fire the same job.
  const results = await Promise.all(due.map((job) => fireJob(supabase, job, now, tick, request)));

  return NextResponse.json({
    success: true,
    tick,
    now: now.toISOString(),
    fired: results.filter((r) => r.fired).map((r) => r.job_name),
    failed: results.filter((r) => r.fired && r.status === 'error').map((r) => ({ job: r.job_name, error: r.error })),
    skipped,
  });
}

// The dispatcher fires every due job in one Promise.all, so it can only safely
// wait this long per job before its OWN function would time out.
const DISPATCH_AWAIT_CAP_MS = 55000;
// For long-running jobs (timeout_ms beyond the cap) we fire-and-forget: wait
// just long enough to catch an immediate failure (auth/500), then let the job
// finish on its own function instance (verified: a Vercel function continues to
// completion after the dispatcher aborts the client fetch).
const LONG_JOB_ACK_MS = 12000;

async function fireJob(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  job: CronJob,
  now: Date,
  tick: string,
  request: NextRequest,
): Promise<{ job_name: string; fired: boolean; status?: string; error?: string }> {
  // Claim the job: set last_run_at + lock, but ONLY if it hasn't already been
  // claimed for this minute (the CAS guard against two concurrent ticks). We
  // match on the job's CURRENT last_run_at via .eq() — PostgREST handles a
  // null/timestamp equality cleanly, unlike .or() with a colon-laden ISO
  // string (which it mis-parses). If another tick claimed it first, the
  // last_run_at we read no longer matches → 0 rows → we back off.
  const claimMinute = minuteKey(now);
  // Already claimed this minute? (belt-and-suspenders with the loop's dedupe)
  if (job.last_run_at && minuteKey(new Date(job.last_run_at)) === claimMinute) {
    return { job_name: job.job_name, fired: false };
  }
  let claimQ = supabase
    .from('cron_jobs')
    .update({ last_run_at: now.toISOString(), locked_at: now.toISOString(), last_status: 'running' })
    .eq('id', job.id);
  claimQ = job.last_run_at === null
    ? claimQ.is('last_run_at', null)
    : claimQ.eq('last_run_at', job.last_run_at);
  const { data: claimed, error: claimErr } = await claimQ.select('id').maybeSingle();
  if (claimErr || !claimed) {
    return { job_name: job.job_name, fired: false };
  }

  // Record the run row.
  const { data: runRow } = await supabase
    .from('cron_job_runs')
    .insert({ job_name: job.job_name, status: 'running', tick })
    .select('id')
    .maybeSingle();

  const start = Date.now();
  let status = 'success';
  let httpStatus: number | null = null;
  let errorMsg: string | null = null;

  // Long jobs can't be fully awaited without timing out the dispatcher itself,
  // so we fire-and-forget them (see LONG_JOB_ACK_MS): the route keeps running on
  // its own instance to completion, and we record 'dispatched' (which the
  // watchdog ignores) instead of a false 'timeout' that would also alert.
  const isLongJob = job.timeout_ms > DISPATCH_AWAIT_CAP_MS;
  try {
    // Build the absolute URL for the internal route fetch.
    const origin = new URL(request.url).origin;
    const url = job.route.startsWith('http') ? job.route : `${origin}${job.route}`;
    const waitMs = isLongJob ? LONG_JOB_ACK_MS : Math.min(job.timeout_ms, DISPATCH_AWAIT_CAP_MS);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), waitMs);
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET || ''}`, 'x-cron-dispatch': '1' },
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    httpStatus = res.status;
    if (!res.ok) {
      status = 'error';
      errorMsg = `route returned ${res.status}`;
    } else if ((res.headers.get('content-type') || '').includes('text/html')) {
      // Cron routes return JSON. An HTML 200 means the fetch never reached a cron
      // route at all — prod serves the homepage (200) to any request carrying an
      // Authorization header on a path with no route, so a cron_jobs row pointing at
      // a nonexistent route logs "success" forever. build-discover-panels did exactly
      // that daily from Jul 19-23, 2026 while its route sat on an unmerged branch.
      status = 'error';
      errorMsg = `route returned HTML, not JSON — route likely does not exist on this deployment`;
    }
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') {
      // Long job still running past the ack window → it completes on its own.
      // Short job → a genuine timeout.
      status = isLongJob ? 'dispatched' : 'timeout';
      errorMsg = isLongJob ? null : ((e as Error)?.message || 'timed out');
    } else {
      status = 'error';
      errorMsg = (e as Error)?.message || 'fire failed';
    }
  }

  const duration = Date.now() - start;

  // Release lock + record final status.
  await supabase.from('cron_jobs').update({ locked_at: null, last_status: status }).eq('id', job.id);
  if (runRow?.id) {
    await supabase
      .from('cron_job_runs')
      .update({ finished_at: new Date().toISOString(), status, duration_ms: duration, http_status: httpStatus, error: errorMsg })
      .eq('id', runRow.id);
  }

  return { job_name: job.job_name, fired: true, status, error: errorMsg || undefined };
}
