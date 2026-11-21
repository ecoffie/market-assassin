/**
 * LAUNCH SIGNALS — three cheap checks the hourly db-health-watch run evaluates, each posting a
 * deduped Slack ops alert (via sendOpsAlert) on a state TRANSITION and a recovery on clear.
 *
 * Why these three: each covers an outcome no existing monitor can see.
 *   1. daily_alert_pending — users due a daily alert today who still have NO alert_log row by
 *      15:00 UTC. dispatcher-watchdog cannot see this: daily-alerts runs longer than 55s, so its
 *      cron_job_runs rows are 'dispatched' with no http_status — the real outcome is invisible.
 *   2. billing_errors — mcp_call_log rows in the last 60 min whose outcome is
 *      'billing_unavailable' or 'debit_failed' (a tool ran but billing could not be established).
 *   3. alert_tool_errors — tool_errors rows for the daily-alerts tool in the last 60 min
 *      (the cron logs one when recipients remain at window end).
 *
 * RULE (CLAUDE.md Bug Prevention #11): a query error or a null count is UNKNOWN, never 0. An
 * unknown result posts its own "check failed" alert; it is never reported as healthy.
 *
 * Each check is failure-isolated: one throwing (or KV/Slack failing) never stops the others or
 * the db-health probes that call this module.
 */

import { fetchAllPaged } from '@/lib/supabase/paged-read';
import { ToolNames } from '@/lib/tool-errors';

export type SignalKey = 'daily_alert_pending' | 'billing_errors' | 'alert_tool_errors';

/** 'skipped' = not evaluated this run (e.g. before 15:00 UTC) — never changes stored state. */
export type SignalStatus = 'ok' | 'alert' | 'unknown' | 'skipped';
export type StoredState = 'ok' | 'alert' | 'unknown';

export interface SignalResult {
  key: SignalKey;
  status: SignalStatus;
  /** null whenever the number could not be established. */
  count: number | null;
  detail: string;
  /** Daily-scoped signals carry the UTC date so state resets each day. */
  stateScope?: string;
}

export const DAILY_PENDING_CHECK_HOUR_UTC = 15;
export const WINDOW_MINUTES = 60;
export const BILLING_ERROR_CODES = ['billing_unavailable', 'debit_failed'] as const;
export const DAILY_FREQUENCIES = ['daily', 'weekdays', 'weekends', 'mwf', 'tth'] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any;

// ─── pure rules ──────────────────────────────────────────────────────────────

/** Mirrors the day-of-week skip in cron/daily-alerts. utcDay: 0=Sun … 6=Sat. */
export function isDueToday(frequency: string | null | undefined, utcDay: number): boolean {
  const weekend = utcDay === 0 || utcDay === 6;
  switch (frequency) {
    case 'daily': return true;
    case 'weekdays': return !weekend;
    case 'weekends': return weekend;
    case 'mwf': return utcDay === 1 || utcDay === 3 || utcDay === 5;
    case 'tth': return utcDay === 2 || utcDay === 4;
    default: return false;
  }
}

function nonEmptyList(v: unknown): boolean {
  if (Array.isArray(v)) return v.some((x) => typeof x === 'string' ? x.trim().length > 0 : x != null);
  if (typeof v === 'string') return v.trim().length > 0;
  return false;
}

/** A user with neither NAICS nor keywords is skipped by daily-alerts by design — not pending. */
export function hasTargeting(row: { naics_codes?: unknown; keywords?: unknown }): boolean {
  return nonEmptyList(row.naics_codes) || nonEmptyList(row.keywords);
}

/** count → status. A null count is UNKNOWN — never coerced to 0. */
export function classifyCount(count: number | null | undefined): 'ok' | 'alert' | 'unknown' {
  if (typeof count !== 'number' || !Number.isFinite(count)) return 'unknown';
  return count > 0 ? 'alert' : 'ok';
}

export type TransitionAction = 'alert' | 'unknown' | 'recover' | 'none';

/**
 * Dedupe: only a CHANGE of state posts. ok→alert alerts once; a sustained alert stays silent;
 * alert/unknown→ok posts a recovery; anything→unknown posts "check failed" once.
 */
export function decideTransition(prev: StoredState, status: SignalStatus): { action: TransitionAction; next: StoredState } {
  if (status === 'skipped') return { action: 'none', next: prev };
  if (status === prev) return { action: 'none', next: prev };
  if (status === 'alert') return { action: 'alert', next: 'alert' };
  if (status === 'unknown') return { action: 'unknown', next: 'unknown' };
  return { action: 'recover', next: 'ok' };
}

export function stateKeyFor(r: SignalResult): string {
  return `launchsignal:${r.key}${r.stateScope ? `:${r.stateScope}` : ''}`;
}

const LABELS: Record<SignalKey, string> = {
  daily_alert_pending: 'Daily alerts pending',
  billing_errors: 'MCP billing errors',
  alert_tool_errors: 'Daily-alerts tool errors',
};

export function buildMessage(r: SignalResult, action: TransitionAction): { subject: string; html: string } {
  const label = LABELS[r.key];
  if (action === 'alert') {
    return { subject: `[Mindy launch] ${label}: ${r.count}`, html: `<p>${r.detail}</p>` };
  }
  if (action === 'unknown') {
    return {
      subject: `[Mindy launch] ${label}: check failed (UNKNOWN, not zero)`,
      html: `<p>The check could not establish a number. Treat as unknown until it recovers.</p><p>${r.detail}</p>`,
    };
  }
  return { subject: `[Mindy launch] ${label}: recovered`, html: `<p>${r.detail}</p>` };
}

// ─── checks ──────────────────────────────────────────────────────────────────

function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export async function checkDailyAlertPending(sb: Sb, now: Date): Promise<SignalResult> {
  const today = utcDate(now);
  const base = { key: 'daily_alert_pending' as const, stateScope: today };
  if (now.getUTCHours() < DAILY_PENDING_CHECK_HOUR_UTC) {
    return { ...base, status: 'skipped', count: null, detail: `before ${DAILY_PENDING_CHECK_HOUR_UTC}:00 UTC` };
  }
  try {
    type U = { user_email: string; alert_frequency: string | null; naics_codes: unknown; keywords: unknown };
    const users = await fetchAllPaged<U>(() =>
      sb
        .from('user_notification_settings')
        .select('user_email, alert_frequency, naics_codes, keywords') // truncation-ok: fetchAllPaged pages until drained
        .eq('is_active', true)
        .eq('alerts_enabled', true)
        .in('alert_frequency', [...DAILY_FREQUENCIES])
        .order('user_email', { ascending: true }),
    );
    const logged = await fetchAllPaged<{ user_email: string }>(() =>
      sb
        .from('alert_log')
        .select('user_email') // truncation-ok: fetchAllPaged pages until drained
        .eq('alert_date', today)
        .eq('alert_type', 'daily')
        .order('user_email', { ascending: true }),
    );
    const done = new Set(logged.map((r) => (r.user_email || '').toLowerCase()));
    const day = now.getUTCDay();
    const due = users.filter((u) => isDueToday(u.alert_frequency, day) && hasTargeting(u));
    const pending = due.filter((u) => !done.has((u.user_email || '').toLowerCase()));
    const status = classifyCount(pending.length);
    return {
      ...base,
      status,
      count: pending.length,
      detail: `${pending.length} of ${due.length} targeted users due today (${today}) have no daily alert_log row at ${now.toISOString()}.`,
    };
  } catch (err) {
    return { ...base, status: 'unknown', count: null, detail: `pending check failed: ${(err as Error).message}` };
  }
}

async function countSince(
  sb: Sb,
  table: string,
  since: string,
  filter: (q: Sb) => Sb,
): Promise<{ count: number | null; error: string | null }> {
  const { count, error } = await filter(
    sb.from(table).select('id', { count: 'exact', head: true }).gte('created_at', since),
  );
  if (error) return { count: null, error: error.message || String(error) };
  return { count: typeof count === 'number' ? count : null, error: null };
}

export async function checkBillingErrors(sb: Sb, now: Date): Promise<SignalResult> {
  const since = new Date(now.getTime() - WINDOW_MINUTES * 60_000).toISOString();
  try {
    const { count, error } = await countSince(sb, 'mcp_call_log', since, (q) => q.in('error_code', [...BILLING_ERROR_CODES]));
    const status = error ? 'unknown' : classifyCount(count);
    return {
      key: 'billing_errors',
      status,
      count: error ? null : count,
      detail: error
        ? `billing check failed: ${error}`
        : status === 'unknown'
          ? 'billing check returned no count (unknown)'
          : `${count} mcp_call_log rows with error_code in (${BILLING_ERROR_CODES.join(', ')}) since ${since}.`,
    };
  } catch (err) {
    return { key: 'billing_errors', status: 'unknown', count: null, detail: `billing check failed: ${(err as Error).message}` };
  }
}

export async function checkAlertToolErrors(sb: Sb, now: Date): Promise<SignalResult> {
  const since = new Date(now.getTime() - WINDOW_MINUTES * 60_000).toISOString();
  try {
    const { count, error } = await countSince(sb, 'tool_errors', since, (q) => q.eq('tool_name', ToolNames.ALERTS));
    const status = error ? 'unknown' : classifyCount(count);
    return {
      key: 'alert_tool_errors',
      status,
      count: error ? null : count,
      detail: error
        ? `tool_errors check failed: ${error}`
        : status === 'unknown'
          ? 'tool_errors check returned no count (unknown)'
          : `${count} tool_errors rows for ${ToolNames.ALERTS} since ${since}.`,
    };
  } catch (err) {
    return { key: 'alert_tool_errors', status: 'unknown', count: null, detail: `tool_errors check failed: ${(err as Error).message}` };
  }
}

// ─── runner ──────────────────────────────────────────────────────────────────

export interface SignalDeps {
  kvGet: (key: string) => Promise<StoredState | null>;
  kvSet: (key: string, value: StoredState) => Promise<void>;
  send: (msg: { subject: string; html: string }) => Promise<{ ok: boolean; error?: string }>;
}

export interface SignalOutcome extends SignalResult {
  prev: StoredState;
  action: TransitionAction;
  sent: boolean;
}

export type SignalCheck = { key: SignalKey; run: (sb: Sb, now: Date) => Promise<SignalResult> };

export const DEFAULT_CHECKS: SignalCheck[] = [
  { key: 'daily_alert_pending', run: checkDailyAlertPending },
  { key: 'billing_errors', run: checkBillingErrors },
  { key: 'alert_tool_errors', run: checkAlertToolErrors },
];

export async function runLaunchSignals(
  sb: Sb,
  deps: SignalDeps,
  now: Date = new Date(),
  checks: SignalCheck[] = DEFAULT_CHECKS,
): Promise<SignalOutcome[]> {
  const settled = await Promise.allSettled(checks.map((c) => c.run(sb, now)));
  const out: SignalOutcome[] = [];
  for (let i = 0; i < settled.length; i++) {
    const s = settled[i];
    const result: SignalResult =
      s.status === 'fulfilled'
        ? s.value
        : { key: checks[i].key, status: 'unknown', count: null, detail: `check threw: ${String((s as PromiseRejectedResult).reason)}` };
    const key = stateKeyFor(result);
    let prev: StoredState = 'ok';
    try { prev = (await deps.kvGet(key)) || 'ok'; } catch { /* KV down → baseline ok */ }
    const { action, next } = decideTransition(prev, result.status);
    let sent = false;
    if (action !== 'none') {
      try {
        const r = await deps.send(buildMessage(result, action));
        sent = r.ok;
      } catch (err) {
        console.error(`[launch-signals] send failed for ${result.key}:`, (err as Error).message);
      }
      // Persist only once the transition was announced, so a failed Slack post retries next hour.
      if (sent) {
        try { await deps.kvSet(key, next); } catch { /* ignore */ }
      }
    }
    out.push({ ...result, prev, action, sent });
  }
  return out;
}
