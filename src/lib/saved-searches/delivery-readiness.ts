import { getAppSupabase } from '@/lib/app/workspace';
import { classifyObservation } from '@/lib/cron/watchdog-incidents';

/**
 * Status of the SAVED-SEARCH ALERTS job (cron `saved-search-alerts`) — one named job, never "Mindy
 * email" in general. Deliberately separate from any one search's status (search-delivery-status.ts).
 *
 * Failure classes come from the job's own self-report (`cron_job_runs.error`, e.g.
 * "unexpected_schedule_error=1,recipient_suppressed=3") and are split by the SAME classifier the
 * watchdog uses (`classifyObservation` in src/lib/cron/watchdog-incidents.ts) so the two can never
 * drift: `recipient_suppressed` is the only non-outage class; `suppression_lookup_failed`,
 * `invalid_recipient_address`, legacy `email_send_rejected` etc. are processing failures.
 *
 * Reporting rules:
 *   healthy          the run in today's window finished with no processing failure. Confirmed
 *                    suppressions are listed as action items, not failures.
 *   partial_failure  some searches failed (per-search classes, or a capacity backlog) and the job
 *                    otherwise ran: it evaluated searches or the provider accepted alerts.
 *   job_failure      CONFIRMED: storage missing, job missing/disabled/unschedulable, no run in today's
 *                    window, a run-level failure (timeout, saved_search_query_failed, non-2xx,
 *                    unclassifiable error), or a failed run that evaluated nothing and sent nothing.
 *   not_observed     configured, never seen to run.
 *   unknown          evidence unreadable or today's run not yet reported — never turned into 0 or healthy.
 * Zero alerts sent is NOT by itself a failure: no new matches and baseline-only runs send nothing.
 */
export type SavedSearchJobStatus = 'healthy' | 'partial_failure' | 'job_failure' | 'not_observed' | 'unknown';

export type DeliveryState =
  | 'delivery_ready'
  | 'delivery_partial'
  | 'delivery_configured'
  | 'delivery_degraded'
  | 'delivery_unknown'
  | 'scheduler_unavailable';

export type DeliveryExecutionHealth =
  | 'recent_success'
  | 'partial_failure'
  | 'latest_failed'
  | 'unreported'
  | 'stale_success'
  | 'not_observed'
  | 'invalid_daily_schedule'
  | 'service_unavailable';

export const SAVED_SEARCH_ALERTS_JOB = 'saved-search-alerts' as const;

export type SavedSearchDeliveryReadiness = {
  /** Always 'saved-search-alerts': every job-level field below is about this one named job. */
  job: typeof SAVED_SEARCH_ALERTS_JOB;
  storage_ready: boolean;
  cron_registered: boolean;
  cron_enabled: boolean;
  cron_schedule_daily: boolean;
  cron_job_name: string | null;
  cron_route: string | null;
  cron_expr: string | null;
  last_run_at: string | null;
  last_run_status: string | null;
  /**
   * Last run with NO processing failure (confirmed suppression is not one). A JOB-RUN time, NOT the
   * last alert email: one failing search marks a whole run `error`. Never present it as "last
   * successful send" (it once read Sept 29 while alerts were going out daily).
   */
  last_clean_run_at: string | null;
  /** Last saved-search alert ACCEPTED BY THE EMAIL PROVIDER. Not inbox delivery. null = none or unreadable. */
  last_alert_provider_accepted_at: string | null;
  /** Inbox placement is never observed by Mindy; acceptance by the provider is the furthest evidence. */
  inbox_delivery: 'not_observable';
  /** The run this status judges (latest terminal run in today's window), if any. */
  latest_run_started_at: string | null;
  latest_run_in_window: boolean;
  /** Raw self-reported failure summary of that run. */
  latest_run_failures: string | null;
  /** Processing-failure classes (outage-relevant), split by the watchdog's classifier. */
  latest_run_processing_failures: Record<string, number>;
  /** Confirmed recipient suppressions: an ACTION ITEM for those recipients, never an outage. */
  suppression_action_items: Record<string, number>;
  /** Alerts the provider accepted during that run. null = unreadable / not measured (never 0). */
  latest_run_alerts_provider_accepted: number | null;
  /** Searches the run evaluated (stamped). null = unreadable / not measured (never 0). */
  latest_run_searches_evaluated: number | null;
  /** Why the job status is what it is, in plain words, prefixed with the job name. */
  job_status_reason: string;
  execution_health: DeliveryExecutionHealth;
  delivery_state: DeliveryState;
  job_status: SavedSearchJobStatus;
  /** True when the run in today's window delivered (healthy or partial_failure). */
  delivery_ready: boolean;
};

const SAVED_SEARCH_ALERTS_ROUTE_PREFIX = '/api/cron/saved-search-alerts';
const DAILY_WINDOW_GRACE_MS = 2 * 60 * 60 * 1000;
const EARLY_START_TOLERANCE_MS = 5 * 60 * 1000;
const RUN_HISTORY_LIMIT = 45;
/** The route self-aborts before its 290s platform timeout; a run's effects cannot be later than this. */
const RUN_EFFECT_WINDOW_MS = 300_000;
const RUN_FINISH_SLACK_MS = 60_000;
/** Provider statuses meaning "accepted for delivery" (Resend 'delivered' = handed to the receiving server, not the inbox). */
const ACCEPTED_STATUSES = ['sent', 'delivered'];
/** Failure classes that mean the job itself could not run, not that one search failed. */
const RUN_LEVEL_CLASSES = new Set(['saved_search_query_failed']);
const TERMINAL_STATUSES = new Set(['success', 'error', 'partial', 'timeout', 'failed']);

type CronConfigRow = {
  job_name: string;
  route: string;
  enabled: boolean | string;
  cron_expr: string;
  last_run_at: string | null;
  last_status: string | null;
};

type CronRunRow = {
  started_at: string;
  finished_at?: string | null;
  status: string;
  http_status: number | null;
  error?: string | null;
};

/** Split a run's self-reported failures with the watchdog's classifier (single source of truth). */
export function classifyRunFailures(status: string | null | undefined, error: string | null | undefined) {
  const c = classifyObservation({ key: SAVED_SEARCH_ALERTS_JOB, kind: 'failing', status: status ?? 'error', error: error ?? null });
  return {
    processing: c.processing,
    suppression: c.suppression,
    suppressionOnly: c.suppressionOnly,
    /** Free-text error that is not a class list — cannot be attributed to individual searches. */
    unclassified: !!(error && error.trim()) && c.signature.includes('|msg:'),
  };
}

function tableMissing(error: { code?: string; message?: string } | null): boolean {
  return !!error && (error.code === '42P01' || (error.message || '').includes('saved_searches'));
}

function cronRowEnabled(enabled: unknown): boolean {
  return enabled === true || enabled === 'true';
}

function parseDailyCron(cronExpr: string): { minute: number; hour: number } | null {
  const [minuteRaw, hourRaw, dayOfMonth, month, dayOfWeek, ...extra] = cronExpr.trim().split(/\s+/);
  if (extra.length || dayOfMonth !== '*' || month !== '*' || dayOfWeek !== '*') return null;

  const minute = Number(minuteRaw);
  const hour = Number(hourRaw);
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  return { minute, hour };
}

function expectedDailyRunAt(cronExpr: string, now: Date): Date | null {
  const schedule = parseDailyCron(cronExpr);
  if (!schedule) return null;

  const today = new Date(now);
  today.setUTCHours(schedule.hour, schedule.minute, 0, 0);
  if (now.getTime() < today.getTime() + DAILY_WINDOW_GRACE_MS) {
    today.setUTCDate(today.getUTCDate() - 1);
  }
  return today;
}

function runTimestamp(run: CronRunRow): number {
  const timestamp = Date.parse(run.started_at);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function non2xx(run: CronRunRow): boolean {
  return typeof run.http_status === 'number' && (run.http_status < 200 || run.http_status >= 300);
}

/** A run with no processing failure: success, or failures that are ONLY confirmed suppressions. */
function isCleanRun(run: CronRunRow): boolean {
  if (non2xx(run)) return false;
  if (run.status === 'success') return true;
  return run.status === 'error' && classifyRunFailures(run.status, run.error).suppressionOnly;
}

function runWindow(run: CronRunRow): { start: string; end: string } | null {
  const start = runTimestamp(run);
  if (!start) return null;
  const finished = run.finished_at ? Date.parse(run.finished_at) : NaN;
  const end = Number.isFinite(finished) ? finished + RUN_FINISH_SLACK_MS : start + RUN_EFFECT_WINDOW_MS;
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function lastAlertAcceptedAt(supabase: any): Promise<string | null> {
  const { data, error } = await supabase
    .from('email_provider_sends')
    .select('sent_at')
    .eq('email_type', 'saved_search_alert')
    .in('status', ACCEPTED_STATUSES)
    .order('sent_at', { ascending: false })
    .limit(1);
  if (error) return null;
  return (data?.[0]?.sent_at as string | undefined) ?? null;
}

/** Provider-accepted alerts during one run. null = unreadable — an unknown is never a zero. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function alertsAcceptedDuringRun(supabase: any, run: CronRunRow): Promise<number | null> {
  const w = runWindow(run);
  if (!w) return null;
  const { count, error } = await supabase
    .from('email_provider_sends')
    .select('id', { count: 'exact', head: true })
    .eq('email_type', 'saved_search_alert')
    .in('status', ACCEPTED_STATUSES)
    .gte('sent_at', w.start)
    .lte('sent_at', w.end);
  if (error || count === null || count === undefined) return null;
  return count;
}

/**
 * Searches the run evaluated: every evaluation (baseline, no new matches, send) stamps
 * last_alerted_at, so the count stamped inside the run's window is the run's evaluated set. Valid for
 * the LATEST run only (a later run re-stamps). null = unreadable.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function searchesEvaluatedDuringRun(supabase: any, run: CronRunRow): Promise<number | null> {
  const w = runWindow(run);
  if (!w) return null;
  const { count, error } = await supabase
    .from('saved_searches')
    .select('id', { count: 'exact', head: true })
    .gte('last_alerted_at', w.start)
    .lte('last_alerted_at', w.end);
  if (error || count === null || count === undefined) return null;
  return count;
}

function counts(c: Record<string, number>): string {
  return Object.entries(c).map(([k, n]) => `${k}=${n}`).join(', ');
}

function stateFor(job: SavedSearchJobStatus): DeliveryState {
  switch (job) {
    case 'healthy': return 'delivery_ready';
    case 'partial_failure': return 'delivery_partial';
    case 'job_failure': return 'delivery_degraded';
    case 'not_observed': return 'delivery_configured';
    case 'unknown': return 'delivery_unknown';
  }
}

const NO_RUN_EVIDENCE = {
  last_clean_run_at: null,
  latest_run_started_at: null,
  latest_run_in_window: false,
  latest_run_failures: null,
  latest_run_processing_failures: {},
  suppression_action_items: {},
  latest_run_alerts_provider_accepted: null,
  latest_run_searches_evaluated: null,
};

function unavailableReadiness(job_status: SavedSearchJobStatus, reason: string): SavedSearchDeliveryReadiness {
  return {
    job: SAVED_SEARCH_ALERTS_JOB,
    storage_ready: false,
    cron_registered: false,
    cron_enabled: false,
    cron_schedule_daily: false,
    cron_job_name: null,
    cron_route: null,
    cron_expr: null,
    last_run_at: null,
    last_run_status: null,
    ...NO_RUN_EVIDENCE,
    last_alert_provider_accepted_at: null,
    inbox_delivery: 'not_observable',
    job_status_reason: `saved-search alerts: ${reason}`,
    execution_health: 'service_unavailable',
    delivery_state: job_status === 'job_failure' ? 'scheduler_unavailable' : 'delivery_unknown',
    job_status,
    delivery_ready: false,
  };
}

/**
 * Read-only probe of the saved-search alerts job. Judges the latest terminal run in today's expected
 * daily window with the rules in the header. `dispatched` alone is never success; long routes
 * self-report their terminal status after the dispatcher aborts, so http_status may be null.
 */
export async function getSavedSearchDeliveryReadiness(
  now: Date = new Date(),
): Promise<SavedSearchDeliveryReadiness> {
  const supabase = getAppSupabase();

  const { error: storageErr } = await supabase.from('saved_searches').select('id').limit(1);
  if (storageErr) {
    return tableMissing(storageErr)
      ? unavailableReadiness('job_failure', 'saved-search storage is missing')
      : unavailableReadiness('unknown', 'saved-search storage could not be read');
  }

  const { data: cronRows, error: cronErr } = await supabase
    .from('cron_jobs')
    .select('job_name, route, enabled, cron_expr, last_run_at, last_status')
    .ilike('route', `${SAVED_SEARCH_ALERTS_ROUTE_PREFIX}%`)
    .limit(1);
  if (cronErr) return unavailableReadiness('unknown', 'the job registration could not be read');

  const cronRow = cronRows?.length ? (cronRows[0] as CronConfigRow) : null;
  const cron_registered = !!cronRow;
  const cron_enabled = cron_registered && cronRowEnabled(cronRow.enabled);
  const cron_schedule_daily = cronRow ? parseDailyCron(cronRow.cron_expr) !== null : false;

  const base = {
    job: SAVED_SEARCH_ALERTS_JOB,
    storage_ready: true,
    cron_registered,
    cron_enabled,
    cron_schedule_daily,
    cron_job_name: cronRow?.job_name ?? null,
    cron_route: cronRow?.route ?? null,
    cron_expr: cronRow?.cron_expr ?? null,
    last_run_at: cronRow?.last_run_at ?? null,
    last_run_status: cronRow?.last_status ?? null,
    inbox_delivery: 'not_observable' as const,
  };

  const finish = (
    job_status: SavedSearchJobStatus,
    execution_health: DeliveryExecutionHealth,
    reason: string,
    evidence: Omit<SavedSearchDeliveryReadiness, keyof typeof base | 'job_status' | 'execution_health' | 'job_status_reason' | 'delivery_state' | 'delivery_ready'>,
  ): SavedSearchDeliveryReadiness => ({
    ...base,
    ...evidence,
    job_status,
    execution_health,
    job_status_reason: `saved-search alerts: ${reason}`,
    delivery_state: stateFor(job_status),
    delivery_ready: job_status === 'healthy' || job_status === 'partial_failure',
  });

  if (!cronRow || !cron_enabled) {
    return finish('job_failure', 'not_observed', cronRow ? 'the job is disabled' : 'the job is not registered', {
      ...NO_RUN_EVIDENCE, last_alert_provider_accepted_at: await lastAlertAcceptedAt(supabase),
    });
  }
  if (!cron_schedule_daily) {
    return finish('job_failure', 'invalid_daily_schedule', `the job schedule "${cronRow.cron_expr}" is not daily`, {
      ...NO_RUN_EVIDENCE, last_alert_provider_accepted_at: await lastAlertAcceptedAt(supabase),
    });
  }

  const { data: runRows, error: runsErr } = await supabase
    .from('cron_job_runs')
    .select('started_at, finished_at, status, http_status, error')
    .eq('job_name', cronRow.job_name)
    .order('started_at', { ascending: false })
    .limit(RUN_HISTORY_LIMIT);
  if (runsErr) return unavailableReadiness('unknown', 'the job run history could not be read');

  const runs = (runRows || []) as CronRunRow[];
  const expectedAt = expectedDailyRunAt(cronRow.cron_expr, now);
  // A run counts as current if it started at or after the most recent expected run (minus a small
  // early-start tolerance). No upper bound: today's run that already finished inside its grace period
  // is newer evidence than yesterday's, and judging the older one would read stamps it overwrote.
  const inWindow = (r: CronRunRow) => !!expectedAt && runTimestamp(r) >= expectedAt.getTime() - EARLY_START_TOLERANCE_MS;
  const judged = runs.find((r) => inWindow(r) && TERMINAL_STATUSES.has(r.status)) ?? null;
  const lastClean = runs.find(isCleanRun) ?? null;
  const acceptedAt = await lastAlertAcceptedAt(supabase);

  const shared = {
    ...NO_RUN_EVIDENCE,
    last_clean_run_at: lastClean?.started_at ?? null,
    last_alert_provider_accepted_at: acceptedAt,
  };

  if (!judged) {
    if (runs.some(inWindow)) return finish('unknown', 'unreported', "today's run has started but not reported an outcome", shared);
    if (!runs.length) return finish('not_observed', 'not_observed', 'the job has never been seen to run', shared);
    return finish('job_failure', 'stale_success', "the job did not run in today's window", shared);
  }

  const cls = classifyRunFailures(judged.status, judged.error);
  const [sent, evaluated] = await Promise.all([
    alertsAcceptedDuringRun(supabase, judged),
    searchesEvaluatedDuringRun(supabase, judged),
  ]);
  const evidence = {
    ...shared,
    latest_run_started_at: judged.started_at,
    latest_run_in_window: true,
    latest_run_failures: judged.error || null,
    latest_run_processing_failures: cls.processing,
    suppression_action_items: cls.suppression,
    latest_run_alerts_provider_accepted: sent,
    latest_run_searches_evaluated: evaluated,
  };
  const ran = `evaluated ${evaluated ?? 'an unknown number of'} searches, ${sent ?? 'an unknown number of'} alerts accepted by the email provider`;

  if (isCleanRun(judged)) {
    const sup = Object.keys(cls.suppression).length ? `; action item: ${counts(cls.suppression)} (confirmed suppressed recipients)` : '';
    return finish('healthy', 'recent_success', `latest run completed (${ran})${sup}`, evidence);
  }

  const runLevel = Object.keys(cls.processing).filter((k) => RUN_LEVEL_CLASSES.has(k));
  const unattributed = judged.status === 'error' && !Object.keys(cls.processing).length && !Object.keys(cls.suppression).length;
  if (non2xx(judged) || judged.status === 'timeout' || judged.status === 'failed' || cls.unclassified || unattributed || runLevel.length) {
    const why = runLevel.length ? counts(Object.fromEntries(runLevel.map((k) => [k, cls.processing[k]])))
      : cls.unclassified ? (judged.error || '').slice(0, 120) : unattributed ? 'run error with no failure detail' : `run ${judged.status}${judged.http_status ? ` (HTTP ${judged.http_status})` : ''}`;
    return finish('job_failure', 'latest_failed', `latest run failed as a whole (${why})`, evidence);
  }

  // Per-search processing failures and/or a capacity backlog: the job ran; some searches failed.
  if (sent === null || evaluated === null) {
    return finish('unknown', 'latest_failed', `latest run reported ${counts(cls.processing) || 'a backlog'}; whether other searches were processed could not be read`, evidence);
  }
  if (sent === 0 && evaluated === 0) {
    return finish('job_failure', 'latest_failed', `latest run reported ${counts(cls.processing) || 'a backlog'} and evaluated no searches`, evidence);
  }
  const what = Object.keys(cls.processing).length ? `${counts(cls.processing)} failed` : 'a backlog was left unprocessed';
  return finish('partial_failure', 'partial_failure', `partial failure: ${what}; the rest ran (${ran})`, evidence);
}
