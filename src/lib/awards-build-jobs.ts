import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { alert } from './awards-refresh';

/**
 * Durable job state for the awards rebuild.
 *
 * WHY A QUEUE AND NOT A LONGER TIMEOUT
 * ------------------------------------
 * The rebuild takes ~4 minutes; the dispatcher allows 55 seconds. Raising the
 * timeout would hide that mismatch and still lose the work whenever the request
 * is terminated mid-build — Vercel can cut a function at any point, and an
 * in-flight promise dies with it.
 *
 * So the check route ENQUEUES (fast, well inside 55s) and a separate worker
 * EXECUTES. The job row is the durable handoff: if the worker dies at minute
 * three, the row still says 'running' with a stale lease, and the next worker
 * reclaims it. Nothing is lost to a terminated request.
 *
 * Deliberately built on the existing `proposal_jobs` pattern (20260729) rather
 * than a new queue abstraction: same status vocabulary, same `locked_at` lease,
 * same partial index for cheap polling.
 */

export type JobStatus = 'queued' | 'running' | 'validated' | 'promoted' | 'failed';

export interface BuildJob {
  id: number;
  source_version: string;
  status: JobStatus;
  attempts: number;
  locked_at: string | null;
  locked_by: string | null;
  heartbeat_at: string | null;
  staging_version: string | null;
  error: string | null;
  telemetry: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

/** A lease older than this is presumed dead and may be reclaimed. */
export const LEASE_STALE_MINUTES = 15;
/** A job running longer than this is stuck; alert rather than let it sit. */
export const STUCK_JOB_MINUTES = 30;
/** Give up after this many attempts rather than retrying a poisoned job forever. */
export const MAX_ATTEMPTS = 3;

function db(): SupabaseClient {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) throw new Error('Supabase env missing');
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Enqueue a build for one upstream source version.
 *
 * IDEMPOTENT BY THE UNIQUE CONSTRAINT, not by a read-then-write check — two
 * checks racing on the same day would both see "no job" and both insert. The
 * database decides instead: the second insert conflicts and returns the existing
 * row. One build per upstream generation, always.
 */
export async function enqueueBuild(
  sourceVersion: string,
): Promise<{ job: BuildJob | null; created: boolean; error?: string }> {
  const supa = db();
  const { data: existing } = await supa
    .from('awards_build_jobs')
    .select('*')
    .eq('source_version', sourceVersion)
    .limit(1)
    .maybeSingle();

  if (existing) {
    // Already promoted for this source version — nothing to do. This is what
    // stops a retry from promoting the same generation twice.
    return { job: existing as BuildJob, created: false };
  }

  const { data, error } = await supa
    .from('awards_build_jobs')
    .insert({ source_version: sourceVersion, status: 'queued' })
    .select()
    .limit(1)
    .maybeSingle();

  if (error) {
    // 23505 = unique violation: another check won the race. Not an error.
    if (error.code === '23505') {
      const { data: raced } = await supa
        .from('awards_build_jobs')
        .select('*')
        .eq('source_version', sourceVersion)
        .limit(1)
        .maybeSingle();
      return { job: (raced ?? null) as BuildJob | null, created: false };
    }
    return { job: null, created: false, error: error.message };
  }
  return { job: data as BuildJob, created: true };
}

/**
 * Claim the next runnable job.
 *
 * Claims a 'queued' job, or reclaims a 'running' one whose lease went stale —
 * a worker that died mid-build must not strand its job forever. The UPDATE is
 * conditional on the row still looking claimable, so two workers cannot both win.
 */
export async function claimNextJob(workerId: string): Promise<BuildJob | null> {
  const supa = db();
  const staleBefore = new Date(Date.now() - LEASE_STALE_MINUTES * 60_000).toISOString();

  const { data: candidates } = await supa
    .from('awards_build_jobs')
    .select('*')
    .in('status', ['queued', 'running'])
    .lt('attempts', MAX_ATTEMPTS)
    .order('created_at', { ascending: true })
    .limit(5);

  for (const c of (candidates ?? []) as BuildJob[]) {
    const claimable = c.status === 'queued' || !c.locked_at || c.locked_at < staleBefore;
    if (!claimable) continue;

    const now = new Date().toISOString();
    // Conditional claim: only if the lease is still what we saw. A second worker
    // racing us fails this predicate and moves on.
    const q = supa
      .from('awards_build_jobs')
      .update({
        status: 'running', locked_at: now, locked_by: workerId,
        heartbeat_at: now, attempts: c.attempts + 1, updated_at: now,
      })
      .eq('id', c.id)
      .eq('attempts', c.attempts);

    const { data, error } = await (c.locked_at
      ? q.eq('locked_at', c.locked_at)
      : q.is('locked_at', null)
    ).select().limit(1).maybeSingle();

    if (!error && data) return data as BuildJob;
  }
  return null;
}

/** Keep the lease alive during a long build so it is not reclaimed mid-flight. */
export async function heartbeat(jobId: number, workerId: string): Promise<void> {
  const now = new Date().toISOString();
  await db().from('awards_build_jobs')
    .update({ heartbeat_at: now, updated_at: now })
    .eq('id', jobId)
    .eq('locked_by', workerId);
}

export async function setJobStatus(
  jobId: number,
  status: JobStatus,
  patch: Partial<Pick<BuildJob, 'staging_version' | 'error' | 'telemetry'>> = {},
): Promise<void> {
  await db().from('awards_build_jobs')
    .update({ status, ...patch, updated_at: new Date().toISOString() })
    .eq('id', jobId);
}

/**
 * Find jobs that have been 'running' too long and alert.
 *
 * A stuck job is silent by nature — nothing fails, nothing retries, the build
 * simply never finishes and the table quietly goes stale. Exactly the shape of
 * the original incident, so it gets an explicit watchdog.
 */
export async function alertOnStuckJobs(): Promise<number> {
  const supa = db();
  const stuckBefore = new Date(Date.now() - STUCK_JOB_MINUTES * 60_000).toISOString();
  const { data, error } = await supa
    .from('awards_build_jobs')
    .select('id, source_version, attempts, locked_by, heartbeat_at')
    .eq('status', 'running')
    .lt('heartbeat_at', stuckBefore)
    .limit(20);

  // A watchdog that swallows its own read error is worse than no watchdog: it
  // reports "0 stuck jobs" whether or not that is true. Surface it instead.
  if (error) {
    console.error('[awards-jobs] stuck-job scan FAILED:', error.message);
    await alert('Awards stuck-job watchdog could not run', `<pre>${error.message}</pre>`);
    return 0;
  }
  const stuck = data ?? [];
  if (stuck.length > 0) {
    await alert(
      'Awards build job STUCK',
      `<p>${stuck.length} build job(s) have been running with no heartbeat for over ` +
        `${STUCK_JOB_MINUTES} minutes.</p><ul>` +
        stuck.map((j) => `<li>job ${j.id} · source ${j.source_version} · attempt ${j.attempts} · worker ${j.locked_by} · last heartbeat ${j.heartbeat_at}</li>`).join('') +
        `</ul><p>The lease goes stale after ${LEASE_STALE_MINUTES} min, so the next worker ` +
        `will reclaim it. Repeated reclaims mean the build itself is failing.</p>`,
    );
  }
  return stuck.length;
}

/** Jobs that exhausted their retries. Alert once, then leave them alone. */
export async function alertOnFailedJobs(): Promise<number> {
  const supa = db();
  const { data, error } = await supa
    .from('awards_build_jobs')
    .select('id, source_version, attempts, error')
    .eq('status', 'failed')
    .gte('updated_at', new Date(Date.now() - 24 * 3600_000).toISOString())
    .limit(20);

  if (error) {
    console.error('[awards-jobs] failed-job scan FAILED:', error.message);
    await alert('Awards failed-job watchdog could not run', `<pre>${error.message}</pre>`);
    return 0;
  }
  const failed = data ?? [];
  if (failed.length > 0) {
    await alert(
      'Awards build job FAILED',
      `<p>${failed.length} build job(s) failed in the last 24h. The live generation is ` +
        `untouched — pages serve the previous data rather than nothing.</p><ul>` +
        failed.map((j) => `<li>job ${j.id} · source ${j.source_version} · ${j.attempts} attempts · ${String(j.error).slice(0, 200)}</li>`).join('') +
        `</ul>`,
    );
  }
  return failed.length;
}

export { db as jobsDb };
