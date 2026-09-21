/**
 * Let a LONG cron route report its own outcome.
 *
 * THE BLIND SPOT THIS CLOSES
 * The dispatcher fires every due job in one Promise.all, so it cannot await a
 * job that outlives DISPATCH_AWAIT_CAP_MS (55s). Jobs with timeout_ms above the
 * cap are fire-and-forget: it waits LONG_JOB_ACK_MS (12s), aborts the client
 * fetch, and records `dispatched` — a status the watchdog deliberately IGNORES,
 * because a false `timeout` would alert on every healthy long job.
 *
 * The cost is that ANY outcome after the 12s mark is invisible. Measured
 * 2026-07-30: 1,126 runs across 36 jobs recorded `dispatched` at exactly
 * 12,002ms with http_status null. sync-dibbs ran two full days returning 1 row
 * and looked healthy the whole time, because its HTTP 500 landed on a
 * connection the dispatcher had already closed.
 *
 * WHY NOT JUST RAISE THE CAP: 72 of 73 enabled jobs are "long" (up to 300s).
 * Awaiting them would time out the dispatcher itself and take every job with
 * it. The dispatcher's timing is correct — the gap is that slow routes had no
 * way to speak after it stopped listening.
 *
 * So the route writes its own terminal status straight to cron_jobs, which is
 * exactly what the watchdog reads (`last_status === 'error' || 'timeout'`).
 *
 * Best-effort by design: a failure to report must never mask, or become, the
 * job's real outcome. Every path swallows its own errors.
 */
import { createClient } from '@supabase/supabase-js';

/** Only meaningful for jobs the dispatcher fire-and-forgets. */
export type CronOutcome = 'success' | 'error' | 'partial';

/**
 * Write a terminal status for `jobName` into cron_jobs (and close out its most
 * recent cron_job_runs row, so run history matches).
 *
 * Call it at the END of a long route, after the real work resolves:
 *   await reportCronOutcome('sync-dibbs', 'error', 'STARVED: fetched 1');
 *
 * Safe to call from a short route too — it just overwrites a status the
 * dispatcher already recorded with the same value.
 */
export async function reportCronOutcome(
  jobName: string,
  outcome: CronOutcome,
  errorMessage?: string,
): Promise<void> {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return;
    const sb = createClient(url, key, { auth: { persistSession: false } });

    // cron_jobs.last_status is what the watchdog reads. Do NOT touch
    // last_run_at (the dispatcher owns the claim) or locked_at (releasing a
    // lock we do not hold could let a second instance fire the job).
    await sb.from('cron_jobs').update({ last_status: outcome }).eq('job_name', jobName);

    // Close out the newest run row so cron_job_runs agrees with cron_jobs.
    // Scoped to this job's most recent row; a miss is harmless.
    const { data: latest } = await sb
      .from('cron_job_runs')
      .select('id')
      .eq('job_name', jobName)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latest?.id) {
      await sb
        .from('cron_job_runs')
        .update({
          status: outcome,
          finished_at: new Date().toISOString(),
          error: errorMessage ?? null,
        })
        .eq('id', latest.id);
    }
  } catch {
    // Never let self-reporting throw into the job's own result path.
  }
}
