import { getAppSupabase } from '@/lib/app/workspace';

export type DeliveryState =
  | 'delivery_ready'
  | 'delivery_configured'
  | 'delivery_degraded'
  | 'scheduler_unavailable';

export type DeliveryExecutionHealth =
  | 'recent_success'
  | 'not_observed'
  | 'stale_success'
  | 'latest_failed'
  | 'invalid_daily_schedule'
  | 'service_unavailable';

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
  last_success_at: string | null;
  execution_health: DeliveryExecutionHealth;
  delivery_state: DeliveryState;
  /** True only when config is enabled and a recent successful daily run is observed. */
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
  status: string;
  http_status: number | null;
};

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
  if (run.status !== 'success') return false;
  // Long routes self-report after the dispatcher has stopped listening, so
  // http_status remains null. The route-authored terminal status is authoritative;
  // an explicit non-2xx still cannot count as success.
  return run.http_status === null
    || (run.http_status >= 200 && run.http_status < 300);
}

function isFailedRun(run: CronRunRow): boolean {
  if (['error', 'timeout', 'failed', 'partial'].includes(run.status)) return true;
  return typeof run.http_status === 'number' && (run.http_status < 200 || run.http_status >= 300);
}

function unavailableReadiness(): SavedSearchDeliveryReadiness {
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
    last_success_at: null,
    execution_health: 'service_unavailable',
    delivery_state: 'scheduler_unavailable',
    delivery_ready: false,
  };
}

/**
 * Read-only probe: storage, cron configuration, and sanitized execution evidence.
 * `delivery_ready` is earned only by a terminal success in the expected daily window,
 * with no later failed run. Long routes self-report that terminal status after the
 * dispatcher aborts, so http_status may remain null. `dispatched` alone is never success.
 */
export async function getSavedSearchDeliveryReadiness(
  now: Date = new Date(),
): Promise<SavedSearchDeliveryReadiness> {
  const supabase = getAppSupabase();

  const { error: storageErr } = await supabase.from('saved_searches').select('id').limit(1);
  if (storageErr || tableMissing(storageErr)) return unavailableReadiness();

  const { data: cronRows, error: cronErr } = await supabase
    .from('cron_jobs')
    .select('job_name, route, enabled, cron_expr, last_run_at, last_status')
    .ilike('route', `${SAVED_SEARCH_ALERTS_ROUTE_PREFIX}%`)
    .limit(1);

  if (cronErr) return unavailableReadiness();

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

  if (!cronRow || !cron_enabled) {
    return {
      ...base,
      last_success_at: null,
      execution_health: 'not_observed',
      delivery_state: 'delivery_degraded',
      delivery_ready: false,
    };
  }

  if (!cron_schedule_daily) {
    return {
      ...base,
      last_success_at: null,
      execution_health: 'invalid_daily_schedule',
      delivery_state: 'delivery_degraded',
      delivery_ready: false,
    };
  }

  const { data: runRows, error: runsErr } = await supabase
    .from('cron_job_runs')
    .select('started_at, status, http_status')
    .eq('job_name', cronRow.job_name)
    .order('started_at', { ascending: false })
    .limit(RUN_HISTORY_LIMIT);

  if (runsErr) return unavailableReadiness();

  const runs = (runRows || []) as CronRunRow[];
  const latestSuccess = runs.find(isSuccessfulRun) ?? null;
  const latestFailure = runs.find(isFailedRun) ?? null;
  const expectedAt = expectedDailyRunAt(cronRow.cron_expr, now);
  const successAt = latestSuccess ? runTimestamp(latestSuccess) : 0;
  const failureAt = latestFailure ? runTimestamp(latestFailure) : 0;
  const successInWindow = !!expectedAt
    && successAt >= expectedAt.getTime() - EARLY_START_TOLERANCE_MS
    && successAt <= expectedAt.getTime() + DAILY_WINDOW_GRACE_MS;
  const failureSupersedesSuccess = failureAt > successAt;

  if (successInWindow && !failureSupersedesSuccess) {
    return {
      ...base,
      last_success_at: latestSuccess?.started_at ?? null,
      execution_health: 'recent_success',
      delivery_state: 'delivery_ready',
      delivery_ready: true,
    };
  }

  if (failureSupersedesSuccess) {
    return {
      ...base,
      last_success_at: latestSuccess?.started_at ?? null,
      execution_health: 'latest_failed',
      delivery_state: 'delivery_degraded',
      delivery_ready: false,
    };
  }

  if (latestSuccess) {
    return {
      ...base,
      last_success_at: latestSuccess.started_at,
      execution_health: 'stale_success',
      delivery_state: 'delivery_degraded',
      delivery_ready: false,
    };
  }

  return {
    ...base,
    last_success_at: null,
    execution_health: 'not_observed',
    delivery_state: 'delivery_configured',
    delivery_ready: false,
  };
}
