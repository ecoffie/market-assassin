/**
 * Completion watchdog for the daily SEO health job.
 *
 * The main job runs up to ~4 minutes, longer than the dispatcher's 55s await cap, so the
 * dispatcher records it as 'dispatched' and never sees whether it finished. A run that
 * starts and then dies would otherwise be noticed only when a digest fails to appear. This
 * short check (a separate route, well under 55s, so the dispatcher DOES see its status)
 * reads seo_health_runs and flags:
 *
 *   stale    no run finished 'ok' or 'partial' within the last MAX_AGE_HOURS
 *   stuck    a run has been 'running' for more than STUCK_MINUTES (it died mid-run)
 *   failed   the most recent finished run is 'failed'
 *
 * Read-only: it never repairs, retries or edits runs.
 */
export const WATCHDOG = { maxAgeHours: 26, stuckMinutes: 30 };

export interface RunRow { id: number; status: string; started_at: string; finished_at: string | null }

export interface WatchdogVerdict {
  healthy: boolean;
  problems: Array<{ kind: 'stale' | 'stuck' | 'failed'; message: string }>;
  lastCompleted: { id: number; status: string; finished_at: string } | null;
}

export function evaluateCompletion(runs: RunRow[], now: number): WatchdogVerdict {
  const problems: WatchdogVerdict['problems'] = [];
  const completed = runs.filter((r) => (r.status === 'ok' || r.status === 'partial') && r.finished_at).sort((a, b) => Date.parse(b.finished_at!) - Date.parse(a.finished_at!));
  const last = completed[0] ?? null;
  const ageH = last ? (now - Date.parse(last.finished_at!)) / 3_600_000 : Infinity;
  if (ageH > WATCHDOG.maxAgeHours) {
    problems.push({ kind: 'stale', message: last ? `no SEO health run has completed in ${ageH.toFixed(1)}h (last: run ${last.id} at ${last.finished_at})` : 'no SEO health run has ever completed' });
  }
  for (const r of runs) {
    if (r.status === 'running' && !r.finished_at && (now - Date.parse(r.started_at)) / 60_000 > WATCHDOG.stuckMinutes) {
      problems.push({ kind: 'stuck', message: `run ${r.id} started ${r.started_at} and never finished (died mid-run)` });
    }
  }
  const lastFinished = runs.filter((r) => r.finished_at).sort((a, b) => Date.parse(b.finished_at!) - Date.parse(a.finished_at!))[0];
  if (lastFinished?.status === 'failed') problems.push({ kind: 'failed', message: `most recent run ${lastFinished.id} failed at ${lastFinished.finished_at}` });
  return { healthy: problems.length === 0, problems, lastCompleted: last ? { id: last.id, status: last.status, finished_at: last.finished_at! } : null };
}
