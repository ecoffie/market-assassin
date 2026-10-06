import { getAppSupabase } from '@/lib/app/workspace';

export type DeliveryState =
  | 'delivery_ready'
  /** The latest run reported per-search failures but DID deliver alerts. */
  | 'delivery_partial'
  | 'delivery_configured'
  | 'delivery_degraded'
  | 'scheduler_unavailable';

export type DeliveryExecutionHealth =
  | 'recent_success'
  | 'partial_failure'
  | 'not_observed'
  | 'stale_success'
  | 'latest_failed'
  | 'invalid_daily_schedule'
  | 'service_unavailable';

/**
 * SYSTEM-wide alert delivery, as a customer should hear it. Deliberately separate from any one
 * search's status (search-delivery-status.ts): one search failing must never be reported as
 * "your emails won't arrive", and a clean save must never be reported as "delivery works".
 *
 *   healthy               latest run in today's window finished clean.
 *   partial_degradation   latest run reported failures for SOME searches but provably delivered alerts.
 *   degraded_unconfirmed  failures observed; whether alerts went out is not established (no send evidence).
 *   system_failure        CONFIRMED: storage missing, job missing/disabled/unschedulable, or no run in today's window.
 *   not_observed          configured, never seen to complete.
 *   unknown               the probe itself could not read its evidence (never turned into "failure" or "healthy").
 */
export type SystemDeliveryStatus =
  | 'healthy'
  | 'partial_degradation'
  | 'degraded_unconfirmed'
  | 'system_failure'
  | 'not_observed'
  | 'unknown';

export type SavedSearchDeliveryReadiness = {
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
   * Last run with NO processing failures (confirmed recipient suppression is not one). This is a
   * JOB-RUN timestamp, NOT the last time an alert email went out: any one failing search marks a
   * whole run `error`. Never present it as "last successful send" (it once said Sept 29 while
   * alerts were going out daily).
   */
  last_clean_run_at: string | null;
  /** Last saved-search alert the email provider accepted (email_provider_sends). null = none or unreadable. */
  last_alert_sent_at: string | null;
  /** Most recent run row (any status) and whether it falls in today's expected daily window. */
  latest_run_started_at: string | null;
  latest_run_in_window: boolean;
  /** Route-reported failure summary of the latest run, raw, e.g. "unexpected_schedule_error=1,email_send_rejected=3". */
  latest_run_failures: string | null;
  /** Processing-failure classes of the latest run (outage-relevant). */
  latest_run_processing_failures: Record<string, number>;
  /**
   * Confirmed recipient suppressions in the latest run — an ACTION ITEM (review those recipients),
   * never a processing outage, and never reported to other customers as delivery trouble.
   */
  suppression_action_items: Record<string, number>;
  /** Alerts the provider accepted during the latest run. null = not measured / unreadable (never 0). */
  latest_run_alerts_sent: number | null;
  execution_health: DeliveryExecutionHealth;
  delivery_state: DeliveryState;
  system_status: SystemDeliveryStatus;
  /** True when a run in today's window delivered (clean, or partial with provider-accepted sends). */
  delivery_ready: boolean;
};

const SAVED_SEARCH_ALERTS_ROUTE_PREFIX = '/api/cron/saved-search-alerts';
const DAILY_WINDOW_GRACE_MS = 2 * 60 * 60 * 1000;
const EARLY_START_TOLERANCE_MS = 5 * 60 * 1000;
const RUN_HISTORY_LIMIT = 45;

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

/**
 * Failure classes that are CONFIRMED recipient suppression (an email_suppressions row exists) —
 * an action item for that recipient, not a processing outage. Must match SUPPRESSION_CLASSES in
 * src/lib/cron/watchdog-incidents.ts (#1836, which introduces the class via #1834); import it from
 * there once both are on main. The legacy `email_send_rejected` stays a PROCESSING failure: it
 * cannot distinguish a suppression from a provider rejection.
 */
export const CONFIRMED_SUPPRESSION_CLASSES = new Set(['recipient_suppressed']);

/** Parse a route-reported summary ("a=1,b=3") into processing vs confirmed-suppression counts. */
export function classifyRunFailures(summary: string | null | undefined): {
  processing: Record<string, number>;
  suppression: Record<string, number>;
} {
  const processing: Record<string, number> = {};
  const suppression: Record<string, number> = {};
  for (const part of (summary || '').split(',')) {
    const [rawName, rawN] = part.split('=');
    const name = (rawName || '').trim();
    if (!name) continue;
    const n = Number(rawN);
    const count = Number.isFinite(n) && n > 0 ? n : 1;
    (CONFIRMED_SUPPRESSION_CLASSES.has(name) ? suppression : processing)[name] = count;
  }
  return { processing, suppression };
}

/** A failed run whose ONLY failures are confirmed recipient suppressions delivered everything else. */
function isSuppressionOnlyRun(run: CronRunRow): boolean {
  if (run.status !== 'error' && run.status !== 'partial') return false;
  if (typeof run.http_status === 'number' && (run.http_status < 200 || run.http_status >= 300)) return false;
  const { processing, suppression } = classifyRunFailures(run.error);
  return Object.keys(processing).length === 0 && Object.keys(suppression).length > 0;
}

/** The route self-aborts before its 290s platform timeout; a run's sends cannot be later than this. */
const RUN_SEND_WINDOW_MS = 300_000;
const RUN_FINISH_SLACK_MS = 60_000;
const SENT_STATUSES = ['sent', 'delivered'];

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

function isSuccessfulRun(run: CronRunRow): boolean {
  if (isSuppressionOnlyRun(run)) return true;
  if (run.status !== 'success') return false;
  // Long routes self-report after the dispatcher has stopped listening, so
  // http_status remains null. The route-authored terminal status is authoritative;
  // an explicit non-2xx still cannot count as success.
  return run.http_status === null
    || (run.http_status >= 200 && run.http_status < 300);
}

function isFailedRun(run: CronRunRow): boolean {
  if (isSuppressionOnlyRun(run)) return false;
  if (['error', 'timeout', 'failed', 'partial'].includes(run.status)) return true;
  return typeof run.http_status === 'number' && (run.http_status < 200 || run.http_status >= 300);
}

function unavailableReadiness(system_status: SystemDeliveryStatus): SavedSearchDeliveryReadiness {
  return {
    storage_ready: false,
    cron_registered: false,
    cron_enabled: false,
    cron_schedule_daily: false,
    cron_job_name: null,
    cron_route: null,
    cron_expr: null,
    last_run_at: null,
    last_run_status: null,
    last_clean_run_at: null,
    last_alert_sent_at: null,
    latest_run_started_at: null,
    latest_run_in_window: false,
    latest_run_failures: null,
    latest_run_processing_failures: {},
    suppression_action_items: {},
    latest_run_alerts_sent: null,
    execution_health: 'service_unavailable',
    delivery_state: 'scheduler_unavailable',
    system_status,
    delivery_ready: false,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function lastAlertSentAt(supabase: any): Promise<string | null> {
  const { data, error } = await supabase
    .from('email_provider_sends')
    .select('sent_at')
    .eq('email_type', 'saved_search_alert')
    .in('status', SENT_STATUSES)
    .order('sent_at', { ascending: false })
    .limit(1);
  if (error) return null;
  return (data?.[0]?.sent_at as string | undefined) ?? null;
}

/** Provider-accepted alerts sent during one run. null = unreadable — an unknown is never a zero. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function alertsSentDuringRun(supabase: any, run: CronRunRow): Promise<number | null> {
  const start = runTimestamp(run);
  if (!start) return null;
  const finished = run.finished_at ? Date.parse(run.finished_at) : NaN;
  const end = Number.isFinite(finished) ? finished + RUN_FINISH_SLACK_MS : start + RUN_SEND_WINDOW_MS;
  const { count, error } = await supabase
    .from('email_provider_sends')
    .select('id', { count: 'exact', head: true })
    .eq('email_type', 'saved_search_alert')
    .in('status', SENT_STATUSES)
    .gte('sent_at', new Date(start).toISOString())
    .lte('sent_at', new Date(end).toISOString());
  if (error || count === null || count === undefined) return null;
  return count;
}

/**
 * Read-only probe: storage, cron configuration, and sanitized execution evidence.
 * `delivery_ready` is earned by a run in the expected daily window that delivered: a clean
 * terminal success, or a failed/partial run during which the provider accepted alert sends
 * (system_status `partial_degradation` — some searches failed, delivery itself works).
 * Long routes self-report their terminal status after the dispatcher aborts, so http_status
 * may remain null. `dispatched` alone is never success.
 */
export async function getSavedSearchDeliveryReadiness(
  now: Date = new Date(),
): Promise<SavedSearchDeliveryReadiness> {
  const supabase = getAppSupabase();

  const { error: storageErr } = await supabase.from('saved_searches').select('id').limit(1);
  if (storageErr) return unavailableReadiness(tableMissing(storageErr) ? 'system_failure' : 'unknown');

  const { data: cronRows, error: cronErr } = await supabase
    .from('cron_jobs')
    .select('job_name, route, enabled, cron_expr, last_run_at, last_status')
    .ilike('route', `${SAVED_SEARCH_ALERTS_ROUTE_PREFIX}%`)
    .limit(1);

  if (cronErr) return unavailableReadiness('unknown');

  const cronRow = cronRows?.length ? (cronRows[0] as CronConfigRow) : null;
  const cron_registered = !!cronRow;
  const cron_enabled = cron_registered && cronRowEnabled(cronRow.enabled);
  const cron_schedule_daily = cronRow ? parseDailyCron(cronRow.cron_expr) !== null : false;

  const base = {
    storage_ready: true,
    cron_registered,
    cron_enabled,
    cron_schedule_daily,
    cron_job_name: cronRow?.job_name ?? null,
    cron_route: cronRow?.route ?? null,
    cron_expr: cronRow?.cron_expr ?? null,
    last_run_at: cronRow?.last_run_at ?? null,
    last_run_status: cronRow?.last_status ?? null,
  };
  const noRunEvidence = {
    last_clean_run_at: null,
    latest_run_started_at: null,
    latest_run_in_window: false,
    latest_run_failures: null,
    latest_run_processing_failures: {},
    suppression_action_items: {},
    latest_run_alerts_sent: null,
  };

  if (!cronRow || !cron_enabled) {
    return {
      ...base,
      ...noRunEvidence,
      last_alert_sent_at: await lastAlertSentAt(supabase),
      execution_health: 'not_observed',
      delivery_state: 'delivery_degraded',
      system_status: 'system_failure',
      delivery_ready: false,
    };
  }

  if (!cron_schedule_daily) {
    return {
      ...base,
      ...noRunEvidence,
      last_alert_sent_at: await lastAlertSentAt(supabase),
      execution_health: 'invalid_daily_schedule',
      delivery_state: 'delivery_degraded',
      system_status: 'system_failure',
      delivery_ready: false,
    };
  }

  const { data: runRows, error: runsErr } = await supabase
    .from('cron_job_runs')
    .select('started_at, finished_at, status, http_status, error')
    .eq('job_name', cronRow.job_name)
    .order('started_at', { ascending: false })
    .limit(RUN_HISTORY_LIMIT);

  if (runsErr) return unavailableReadiness('unknown');

  const runs = (runRows || []) as CronRunRow[];
  const latestRun = runs[0] ?? null;
  const latestSuccess = runs.find(isSuccessfulRun) ?? null;
  const latestFailure = runs.find(isFailedRun) ?? null;
  const expectedAt = expectedDailyRunAt(cronRow.cron_expr, now);
  const inWindow = (ts: number) => !!expectedAt
    && ts >= expectedAt.getTime() - EARLY_START_TOLERANCE_MS
    && ts <= expectedAt.getTime() + DAILY_WINDOW_GRACE_MS;
  const successAt = latestSuccess ? runTimestamp(latestSuccess) : 0;
  const failureAt = latestFailure ? runTimestamp(latestFailure) : 0;
  const successInWindow = inWindow(successAt);
  const failureSupersedesSuccess = failureAt > successAt;
  const anyRunInWindow = runs.some((r) => inWindow(runTimestamp(r)));

  const evidence = {
    last_clean_run_at: latestSuccess?.started_at ?? null,
    last_alert_sent_at: await lastAlertSentAt(supabase),
    latest_run_started_at: latestRun?.started_at ?? null,
    latest_run_in_window: latestRun ? inWindow(runTimestamp(latestRun)) : false,
    latest_run_failures: latestRun?.error || null,
    latest_run_processing_failures: classifyRunFailures(latestRun?.error).processing,
    suppression_action_items: classifyRunFailures(latestRun?.error).suppression,
    latest_run_alerts_sent: null as number | null,
  };

  if (successInWindow && !failureSupersedesSuccess) {
    return {
      ...base,
      ...evidence,
      execution_health: 'recent_success',
      delivery_state: 'delivery_ready',
      system_status: 'healthy',
      delivery_ready: true,
    };
  }

  if (failureSupersedesSuccess && latestFailure) {
    if (inWindow(failureAt)) {
      // A run "fails" when ANY search fails (one suppressed recipient is enough). Whether customers
      // got email is a separate question, answered by the provider's send ledger for that run.
      const sent = await alertsSentDuringRun(supabase, latestFailure);
      evidence.latest_run_alerts_sent = sent;
      if (sent !== null && sent > 0) {
        return {
          ...base,
          ...evidence,
          execution_health: 'partial_failure',
          delivery_state: 'delivery_partial',
          system_status: 'partial_degradation',
          delivery_ready: true,
        };
      }
      return {
        ...base,
        ...evidence,
        execution_health: 'latest_failed',
        delivery_state: 'delivery_degraded',
        system_status: 'degraded_unconfirmed',
        delivery_ready: false,
      };
    }
    return {
      ...base,
      ...evidence,
      execution_health: 'latest_failed',
      delivery_state: 'delivery_degraded',
      system_status: anyRunInWindow ? 'degraded_unconfirmed' : 'system_failure',
      delivery_ready: false,
    };
  }

  if (latestSuccess) {
    // The last clean run is outside today's window. With no run row in the window at all, the job
    // did not execute today — that is a confirmed miss. A dispatched-but-unreported row is not.
    return {
      ...base,
      ...evidence,
      execution_health: 'stale_success',
      delivery_state: 'delivery_degraded',
      system_status: anyRunInWindow ? 'degraded_unconfirmed' : 'system_failure',
      delivery_ready: false,
    };
  }

  return {
    ...base,
    ...evidence,
    execution_health: 'not_observed',
    delivery_state: 'delivery_configured',
    system_status: 'not_observed',
    delivery_ready: false,
  };
}
