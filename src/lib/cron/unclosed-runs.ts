/**
 * UNCLOSED RUNS — cron_job_runs rows that never reached a terminal status.
 *
 * THE BLIND SPOT THIS CLOSES
 * The dispatcher (`/api/cron/dispatch`) inserts every run as `running`, then rewrites it:
 *   - short jobs  → a terminal status (success / error / timeout) once the fetch settles;
 *   - long jobs (timeout_ms > 55s) → `dispatched` after a 12s ack window, and the route itself
 *     later writes its terminal status with reportCronOutcome() (src/lib/cron-self-report.ts).
 * A run the platform kills (maxDuration, OOM, instance recycle) never closes:
 *   - a dispatcher that dies mid-fire leaves its row `running` forever;
 *   - a self-reporting long route that is killed leaves its row `dispatched` forever.
 * The dispatcher-watchdog's FAILING check reads only `error` / `timeout`, so both were silent.
 *
 * THE RULE (read-only; these rows are reported, never mutated)
 *   - A row counts as unclosed once now > started_at + cron_jobs.timeout_ms + margin.
 *   - `running` past that deadline is always unclosed: the dispatcher rewrites `running` within
 *     DISPATCH_AWAIT_CAP_MS for every job, so a surviving `running` row means it never got there.
 *   - `dispatched` is ONLY unclosed for a job that is known to self-report. Most long routes do
 *     NOT call reportCronOutcome, and for them `dispatched` is the permanent, healthy record of
 *     every run (the dispatcher deliberately records it instead of a false timeout). Flagging
 *     those would alert on every healthy run. Evidence that a job self-reports = an earlier run
 *     of the same job that reached a terminal status AFTER the ack window (duration_ms >=
 *     LONG_JOB_ACK_MS on a long job — the dispatcher itself never writes a terminal status that
 *     late for a long job, so only the route's own report can have closed it). The evidence must
 *     predate the candidate, so runs from before a job adopted self-reporting are not flagged.
 */

/** Mirrors src/app/api/cron/dispatch/route.ts. */
export const DISPATCH_AWAIT_CAP_MS = 55_000;
/** Mirrors src/app/api/cron/dispatch/route.ts. */
export const LONG_JOB_ACK_MS = 12_000;
/** Grace past the job's own timeout before a still-open row is reported. */
export const UNCLOSED_MARGIN_MS = 15 * 60_000;
/** How far back open rows are examined. Older orphans age out of the report (and its incident). */
export const UNCLOSED_LOOKBACK_HOURS = 48;
/** How far back self-report evidence is searched. */
export const SELF_REPORT_EVIDENCE_LOOKBACK_DAYS = 7;
/** Terminal statuses a route can self-report (CronOutcome). */
export const SELF_REPORT_STATUSES = ['success', 'error', 'partial'] as const;

export type OpenRunRow = {
  id: string;
  job_name: string;
  started_at: string;
  status: string;
};

export type UnclosedJobFinding = {
  job_name: string;
  status: 'running' | 'dispatched';
  runs: number;
  oldest_started_at: string;
  newest_started_at: string;
  /** timeout_ms + margin that each listed run has exceeded. */
  deadline_ms: number;
  /** Up to 5 run ids, newest first — for manual inspection only. */
  run_ids: string[];
};

export function isLongJob(timeoutMs: number): boolean {
  return timeoutMs > DISPATCH_AWAIT_CAP_MS;
}

export function findUnclosedRuns(input: {
  openRuns: OpenRunRow[];
  /** Enabled jobs and their configured timeout. Runs of jobs not listed are ignored. */
  jobs: { job_name: string; timeout_ms: number }[];
  /**
   * job_name → started_at of the OLDEST self-reported run in the evidence window, for jobs that
   * have one. A job absent from the map has no proof it self-reports, so its `dispatched` rows
   * are not judged.
   */
  selfReportEvidence: Map<string, string>;
  now: Date;
  marginMs?: number;
}): UnclosedJobFinding[] {
  const marginMs = input.marginMs ?? UNCLOSED_MARGIN_MS;
  const timeouts = new Map(input.jobs.map((j) => [j.job_name, j.timeout_ms]));
  const groups = new Map<string, { job_name: string; status: 'running' | 'dispatched'; deadline: number; runs: OpenRunRow[] }>();

  for (const r of input.openRuns) {
    if (r.status !== 'running' && r.status !== 'dispatched') continue;
    const timeout = timeouts.get(r.job_name);
    if (timeout === undefined) continue;
    const started = Date.parse(r.started_at);
    if (!Number.isFinite(started)) continue;
    const deadline = timeout + marginMs;
    if (input.now.getTime() - started <= deadline) continue;

    if (r.status === 'dispatched') {
      const evidence = input.selfReportEvidence.get(r.job_name);
      if (!evidence || Date.parse(evidence) >= started) continue;
    }

    const key = `${r.job_name}|${r.status}`;
    const g = groups.get(key) ?? { job_name: r.job_name, status: r.status, deadline, runs: [] };
    g.runs.push(r);
    groups.set(key, g);
  }

  return [...groups.values()]
    .map((g) => {
      const runs = [...g.runs].sort((a, b) => b.started_at.localeCompare(a.started_at));
      return {
        job_name: g.job_name,
        status: g.status,
        runs: runs.length,
        oldest_started_at: runs[runs.length - 1].started_at,
        newest_started_at: runs[0].started_at,
        deadline_ms: g.deadline,
        run_ids: runs.slice(0, 5).map((r) => r.id),
      };
    })
    .sort((a, b) => a.job_name.localeCompare(b.job_name) || a.status.localeCompare(b.status));
}

export function describeUnclosed(f: UnclosedJobFinding): string {
  const mins = Math.round(f.deadline_ms / 60_000);
  return `${f.runs} run(s) still '${f.status}' past timeout + margin (${mins} min); newest started ${f.newest_started_at.slice(0, 16)}Z — the platform likely killed the run before it closed its row`;
}
